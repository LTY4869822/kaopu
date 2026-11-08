import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/index.mjs';
import { mountAuth } from '../server/auth.mjs';
import { accountIdForEmail } from '../server/account-store.mjs';
import { workspacePath } from '../server/workspaces.mjs';

const owner = { name: '考谱同学', email: 'Student@Example.edu', password: 'study-password-42' };
async function fixture(t, { dataDir, app } = {}) {
  const directory = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-auth-test-'));
  const server = await new Promise((resolve) => {
    const instance = (app || createApp({ dataDir: directory, provider: {}, authEnabled: true })).listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const response = await fetch(`${base}/api${route}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers };
  };
  const close = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  t.after(async () => {
    if (server.listening) await close();
    if (!dataDir) {
      assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  return { directory, request, close };
}
const post = (request, route, body, cookie) => request(route, { method: 'POST', body, cookie });
const cookiePair = (value) => value.split(';')[0];

test('owner registration protects study APIs, persists only a salted hash, and supports login/logout', async (t) => {
  const { directory, request } = await fixture(t);
  assert.deepEqual((await request('/auth/status')).data, { authenticated: false, accountExists: false });
  for (const route of ['/state', '/export', '/plan', '/health']) assert.equal((await request(route)).status, 401);
  assert.equal((await post(request, '/reset', { mode: 'empty' })).status, 401);
  const created = await post(request, '/auth/register', owner);
  assert.equal(created.status, 201);
  assert.deepEqual(created.data, { authenticated: true, accountExists: true, user: { name: owner.name, email: owner.email.toLowerCase() } });
  assert.match(created.cookie, /HttpOnly/);
  assert.match(created.cookie, /SameSite=Strict/);
  assert.match(created.cookie, /Max-Age=604800/);
  const cookie = cookiePair(created.cookie);
  const record = JSON.parse(fs.readFileSync(path.join(directory, 'auth.json'), 'utf8')).accounts[0];
  assert.equal(record.algorithm, 'scrypt-N32768-r8-p1');
  assert.match(record.hash, /^[a-f0-9]{128}$/);
  assert.match(record.salt, /^[a-f0-9]{32}$/);
  assert.ok(!JSON.stringify(record).includes(owner.password));
  assert.ok(!JSON.stringify(record).includes(cookie.slice(cookie.indexOf('=') + 1)));
  assert.ok(!fs.readFileSync(path.join(workspacePath(directory, accountIdForEmail(owner.email)), 'state.json'), 'utf8').includes(record.hash));
  const exported = await request('/export', { cookie });
  assert.equal(exported.status, 200);
  assert.ok(!JSON.stringify(exported.data).includes(record.hash));
  assert.equal((await request('/auth/status', { cookie })).data.authenticated, true);
  assert.equal((await request('/state', { cookie: 'shifen_session=forged' })).status, 401);
  assert.equal((await post(request, '/auth/register', owner)).status, 409);
  const signedOut = await post(request, '/auth/logout', undefined, cookie);
  assert.match(signedOut.cookie, /Max-Age=0/);
  assert.equal((await request('/state', { cookie })).status, 401);
  const wrongEmail = await post(request, '/auth/login', { ...owner, email: 'other@example.edu' });
  const wrongPassword = await post(request, '/auth/login', { ...owner, password: 'wrong-password' });
  assert.equal(wrongEmail.status, 401);
  assert.deepEqual(wrongEmail.data, wrongPassword.data);
  const signedIn = await post(request, '/auth/login', { email: ' student@example.edu ', password: owner.password });
  assert.equal(signedIn.status, 200);
  assert.notEqual(cookiePair(signedIn.cookie), cookie);
  assert.equal((await request('/state', { cookie: cookiePair(signedIn.cookie) })).status, 200);
});

test('registration validates input and keeps existing cross-origin write protection', async (t) => {
  const { request, directory } = await fixture(t);
  for (const changes of [{ name: ' ' }, { name: 'a\n' }, { email: 'invalid' }, { password: 'short' }, { password: 'a'.repeat(129) }]) {
    assert.equal((await post(request, '/auth/register', { ...owner, ...changes })).status, 400);
  }
  const rejected = await request('/auth/register', { method: 'POST', body: owner, headers: { Origin: 'https://malicious.example' } });
  assert.equal(rejected.status, 403);
  assert.equal(fs.existsSync(path.join(directory, 'auth.json')), false);
  assert.equal((await post(request, '/auth/register', { ...owner, password: '12345678' })).status, 201);
});

test('single owner survives restart while sessions do not; simultaneous registration cannot replace it', async (t) => {
  const first = await fixture(t);
  const results = await Promise.all([
    post(first.request, '/auth/register', owner),
    post(first.request, '/auth/register', { ...owner, name: '另一个人', email: 'second@example.edu' }),
  ]);
  assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
  const created = results.find((item) => item.status === 201);
  const raw = fs.readFileSync(path.join(first.directory, 'auth.json'), 'utf8');
  await first.close();
  const second = await fixture(t, { dataDir: first.directory });
  assert.deepEqual((await second.request('/auth/status', { cookie: cookiePair(created.cookie) })).data, { authenticated: false, accountExists: true });
  assert.equal((await post(second.request, '/auth/register', owner)).status, 409);
  assert.equal(fs.readFileSync(path.join(first.directory, 'auth.json'), 'utf8'), raw);
  assert.equal((await post(second.request, '/auth/login', { email: created.data.user.email, password: owner.password })).status, 200);
  await second.close();
});

test('repeated login attempts are rate limited with Retry-After', async (t) => {
  const { request } = await fixture(t);
  for (let i = 0; i < 10; i += 1) assert.equal((await post(request, '/auth/login', { email: owner.email, password: 'short' })).status, 401);
  const limited = await post(request, '/auth/login', owner);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await request('/auth/status')).status, 200);
});

test('session TTL is enforced on the server and HTTPS deployments can require Secure cookies', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-auth-ttl-'));
  let time = Date.now();
  const app = express();
  app.use(express.json());
  mountAuth(app, { dataDir: directory, now: () => time, sessionMs: 2000, secureCookies: true });
  app.get('/api/private', (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const { request, close } = await fixture(t, { dataDir: directory, app });
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const result = await post(request, '/auth/register', owner);
  assert.match(result.cookie, /; Secure/);
  const cookie = cookiePair(result.cookie);
  assert.equal((await request('/private', { cookie })).status, 200);
  time += 2001;
  assert.equal((await request('/private', { cookie })).status, 401);
  assert.equal((await request('/auth/status', { cookie })).data.authenticated, false);
  await close();
});
