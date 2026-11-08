import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';
import { issueLocalRecovery } from '../server/auth-recovery.mjs';
import { accountIdForEmail } from '../server/account-store.mjs';
import { workspacePath } from '../server/workspaces.mjs';

async function harness() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-recovery-'));
  const app = createApp({ dataDir, authEnabled: true, provider: {}, videoFetcher: null });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, value) => fetch(`${origin}/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const registered = await post('register', { name: '测试同学', email: 'owner@example.test', password: 'old-test-password' });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  return { dataDir, origin, post, cookie, async close() {
    app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith('shifen-recovery-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  } };
}

test('local one-time recovery changes only the credential, signs in the owner and revokes old sessions', async () => {
  const h = await harness();
  try {
    const before = JSON.parse(await fs.readFile(path.join(h.dataDir, 'auth.json'), 'utf8')).accounts[0];
    const workspaceState = path.join(workspacePath(h.dataDir, accountIdForEmail(before.email)), 'state.json');
    const stateBefore = await fs.readFile(workspaceState, 'utf8');
    const link = issueLocalRecovery(h), token = new URL(link.url).hash.slice(1);
    assert.ok(!await fs.readFile(path.join(h.dataDir, 'auth-recovery.json'), 'utf8').then(text => text.includes(token)));
    const response = await h.post('recover', { token, password: 'new-test-password' }); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.authenticated, true); assert.equal(result.user.email, before.email);
    const after = JSON.parse(await fs.readFile(path.join(h.dataDir, 'auth.json'), 'utf8')).accounts[0];
    assert.equal(after.name, before.name); assert.equal(after.createdAt, before.createdAt); assert.notEqual(after.hash, before.hash);
    assert.ok(!JSON.stringify(after).includes('new-test-password')); assert.equal(await fs.readFile(workspaceState, 'utf8'), stateBefore);
    assert.equal((await fetch(h.origin + '/api/state', { headers: { Cookie: h.cookie } })).status, 401);
    assert.equal((await h.post('login', { email: before.email, password: 'old-test-password' })).status, 401);
    assert.equal((await h.post('login', { email: before.email, password: 'new-test-password' })).status, 200);
    assert.equal((await h.post('recover', { token, password: 'another-password' })).status, 401);
  } finally { await h.close(); }
});

test('invalid, expired or replaced recovery links cannot change the password', async () => {
  const h = await harness();
  try {
    const before = await fs.readFile(path.join(h.dataDir, 'auth.json'), 'utf8');
    assert.equal((await h.post('recover', { token: '0'.repeat(64), password: 'invalid-link-password' })).status, 401);
    const expired = issueLocalRecovery({ ...h, now: Date.now() - 16 * 60 * 1000 });
    assert.equal((await h.post('recover', { token: new URL(expired.url).hash.slice(1), password: 'expired-link-password' })).status, 401);
    const old = issueLocalRecovery(h), current = issueLocalRecovery(h);
    assert.equal((await h.post('recover', { token: new URL(old.url).hash.slice(1), password: 'replaced-link-password' })).status, 401);
    assert.equal((await h.post('recover', { token: new URL(current.url).hash.slice(1), password: 'short' })).status, 400);
    assert.equal(await fs.readFile(path.join(h.dataDir, 'auth.json'), 'utf8'), before);
    assert.throws(() => issueLocalRecovery({ ...h, origin: 'https://external.example' }), /本机/);
  } finally { await h.close(); }
});

test('recovery page has isolated content, clears its URL fragment and never issues a token remotely', async () => {
  const h = await harness();
  try {
    const response = await fetch(h.origin + '/auth/recovery'); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text(); assert.match(html, /autocomplete="new-password"/); assert.match(html, /history.replaceState/);
    assert.match(html, /课程、资料、笔记和学习记录都会保留/); assert.ok(!html.includes('owner@example.test'));
    assert.equal((await h.post('recovery', {})).status, 401);
  } finally { await h.close(); }
});
