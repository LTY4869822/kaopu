import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { accountIdForEmail } from '../server/account-store.mjs';
import { workspacePath } from '../server/workspaces.mjs';
import { issueLocalRecovery } from '../server/auth-recovery.mjs';

const password = 'workspace-test-password';
const account = (name, email) => ({ name, email, password });
const cookiePair = value => value.split(';')[0];

async function harness(t, dataDir, options = {}) {
  const directory = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-workspaces-'));
  const app = createApp({ dataDir: directory, authEnabled: true, provider: {}, videoFetcher: null, ...options });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = 'GET', body, cookie } = {}) => {
    const response = await fetch(`${origin}/api${route}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, cookie: response.headers.get('set-cookie'), data: type.includes('json') ? await response.json() : await response.text() };
  };
  const register = async value => {
    const result = await request('/auth/register', { method: 'POST', body: value });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return cookiePair(result.cookie);
  };
  const close = async () => {
    app.emit('shifen:close');
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  t.after(async () => {
    if (server.listening) await close();
    if (!dataDir) fs.rmSync(directory, { recursive: true, force: true });
  });
  return { app, directory, request, register, close };
}

function addLesson(directory, email, courseId, marker) {
  const workspace = workspacePath(directory, accountIdForEmail(email));
  const lesson = {
    id: `lesson-${marker}`, courseId, title: `${marker} 专属讲次`, url: '', part: 1, scope: '',
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z', status: 'completed',
    cues: [{ id: `cue-${marker}`, start: 0, end: 8, text: `${marker} 的原文字幕` }],
    visual: { id: `evidence-${marker}`, frames: [{ id: 'frame-0001', time: 0 }], observations: [], warnings: [] },
    notes: {
      mode: 'extractive', overview: [`${marker} 的概览`], examples: [], warnings: [],
      sections: [{ id: `section-${marker}`, title: `${marker} 考点`, text: `${marker} 的结构化内容`, cueIds: [`cue-${marker}`], frameIds: ['frame-0001'] }],
    },
  };
  fs.writeFileSync(path.join(workspace, 'lessons.json'), JSON.stringify({ version: 1, lessons: [lesson] }));
  const frameDirectory = path.join(workspace, 'lesson-visual', lesson.id, lesson.visual.id);
  fs.mkdirSync(frameDirectory, { recursive: true });
  fs.writeFileSync(path.join(frameDirectory, 'frame-0001.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]));
  return workspace;
}

test('each account owns an independent course, lesson and raw/wiki/resources vault', async t => {
  const h = await harness(t);
  const a = account('账户 A', 'a@example.test');
  const b = account('账户 B', 'b@example.test');
  const cookieA = await h.register(a);
  const cookieB = await h.register(b);
  const createdA = await h.request('/courses', { method: 'POST', cookie: cookieA, body: { name: 'A 的课程', target: 80 } });
  const createdB = await h.request('/courses', { method: 'POST', cookie: cookieB, body: { name: 'B 的课程', target: 80 } });
  assert.equal(createdA.status, 201);
  assert.equal(createdB.status, 201);
  const workspaceA = addLesson(h.directory, a.email, createdA.data.id, 'A');
  const workspaceB = addLesson(h.directory, b.email, createdB.data.id, 'B');
  assert.notEqual(workspaceA, workspaceB);

  const treeAResponse = await h.request('/knowledge/tree?refresh=1', { cookie: cookieA });
  const treeBResponse = await h.request('/knowledge/tree?refresh=1', { cookie: cookieB });
  assert.equal(treeAResponse.status, 200, JSON.stringify(treeAResponse.data));
  assert.equal(treeBResponse.status, 200, JSON.stringify(treeBResponse.data));
  const treeA = treeAResponse.data;
  const treeB = treeBResponse.data;
  assert.equal(treeA.root, path.join(workspaceA, 'knowledge'));
  assert.equal(treeB.root, path.join(workspaceB, 'knowledge'));
  const courseA = treeA.courses.find(course => course.id === createdA.data.id);
  const courseB = treeB.courses.find(course => course.id === createdB.data.id);
  assert.ok(courseA && courseB);
  assert.ok(!treeA.courses.some(course => course.id === createdB.data.id));
  assert.ok(!treeB.courses.some(course => course.id === createdA.data.id));
  const pathsA = courseA.files.map(file => file.path);
  assert.ok(pathsA.some(file => file.includes('/raw/') && file.includes('A 专属讲次')));
  assert.ok(pathsA.some(file => file.includes('/wiki/') && file.includes('A 考点')));
  assert.ok(pathsA.some(file => file.includes('/resources/') && file.endsWith('frame-0001.jpg')));
  const privateFile = pathsA.find(file => file.includes('/wiki/') && file.includes('A 考点'));
  assert.equal((await h.request(`/knowledge/file?path=${encodeURIComponent(privateFile)}`, { cookie: cookieA })).status, 200);
  assert.equal((await h.request(`/knowledge/file?path=${encodeURIComponent(privateFile)}`, { cookie: cookieB })).status, 404);

  await h.close();
  const restarted = await harness(t, h.directory);
  const loginA = await restarted.request('/auth/login', { method: 'POST', body: { email: a.email, password } });
  const loginB = await restarted.request('/auth/login', { method: 'POST', body: { email: b.email, password } });
  const lessonsA = await restarted.request('/lessons', { cookie: cookiePair(loginA.cookie) });
  const lessonsB = await restarted.request('/lessons', { cookie: cookiePair(loginB.cookie) });
  assert.match(JSON.stringify(lessonsA.data), /A 专属讲次/);
  assert.doesNotMatch(JSON.stringify(lessonsA.data), /B 专属讲次/);
  assert.doesNotMatch(JSON.stringify(lessonsB.data), /A 专属讲次/);
  assert.equal((await restarted.request('/state')).status, 401);
});

test('legacy single-owner files migrate to the same account without losing credentials or study data', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-workspace-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const owner = account('旧账户', 'legacy@example.test');
  const first = await harness(t, directory);
  const cookie = await first.register(owner);
  const created = await first.request('/courses', { method: 'POST', cookie, body: { name: '旧版课程', target: 85 } });
  assert.equal(created.status, 201);
  await first.close();

  const workspace = workspacePath(directory, accountIdForEmail(owner.email));
  for (const name of ['state.json', 'lessons.json', 'model-service.json', 'documents', 'lesson-visual', 'knowledge']) {
    const source = path.join(workspace, name);
    if (fs.existsSync(source)) fs.renameSync(source, path.join(directory, name));
  }
  fs.rmSync(path.join(directory, 'users'), { recursive: true, force: true });
  const store = JSON.parse(fs.readFileSync(path.join(directory, 'auth.json'), 'utf8'));
  fs.writeFileSync(path.join(directory, 'auth.json'), JSON.stringify(store.accounts[0], null, 2));

  const second = await harness(t, directory);
  assert.equal(fs.existsSync(path.join(directory, 'state.json')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'auth.json'), 'utf8')).version, 2);
  assert.match(fs.readFileSync(path.join(workspace, 'state.json'), 'utf8'), /旧版课程/);
  const login = await second.request('/auth/login', { method: 'POST', body: { email: owner.email, password } });
  assert.equal(login.status, 200);
  const state = await second.request('/state', { cookie: cookiePair(login.cookie) });
  assert.equal(state.status, 200);
  assert.ok(state.data.courses.some(course => course.name === '旧版课程'));
});

test('local recovery selects one account and never changes another account password', async t => {
  const h = await harness(t);
  const a = account('恢复 A', 'recover-a@example.test');
  const b = account('恢复 B', 'recover-b@example.test');
  await h.register(a);
  await h.register(b);
  assert.throws(() => issueLocalRecovery({ dataDir: h.directory }), /多个账户/);
  const link = issueLocalRecovery({ dataDir: h.directory, email: b.email });
  const token = new URL(link.url).hash.slice(1);
  const recovered = await h.request('/auth/recover', { method: 'POST', body: { token, password: 'new-password-for-b' } });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.user.email, b.email);
  assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: a.email, password } })).status, 200);
  assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: b.email, password } })).status, 401);
  assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: b.email, password: 'new-password-for-b' } })).status, 200);
});

test('default Bilibili authentication is isolated per account and ignores the legacy global session', async t => {
  const options = { videoFetcher: undefined };
  const first = await harness(t, undefined, options);
  const a = account('登录 A', 'bili-a@example.test');
  const b = account('登录 B', 'bili-b@example.test');
  const globalSession = { cookieHeader: 'SESSDATA=legacy-global', uname: '旧全局账户', savedAt: 1 };
  fs.writeFileSync(path.join(first.directory, 'bilibili-session.json'), JSON.stringify(globalSession));
  await first.register(a);
  await first.register(b);
  const session = name => ({ cookieHeader: `SESSDATA=${name}-secret`, uname: `${name} 的 B 站账户`, savedAt: 2 });
  const workspaceA = workspacePath(first.directory, accountIdForEmail(a.email));
  const workspaceB = workspacePath(first.directory, accountIdForEmail(b.email));
  fs.writeFileSync(path.join(workspaceA, 'bilibili-session.json'), JSON.stringify(session('A')));
  fs.writeFileSync(path.join(workspaceB, 'bilibili-session.json'), JSON.stringify(session('B')));
  await first.close();

  const second = await harness(t, first.directory, options);
  const loginA = await second.request('/auth/login', { method: 'POST', body: { email: a.email, password } });
  const loginB = await second.request('/auth/login', { method: 'POST', body: { email: b.email, password } });
  const cookieA = cookiePair(loginA.cookie), cookieB = cookiePair(loginB.cookie);
  const statusA = await second.request('/bilibili/auth/status', { cookie: cookieA });
  const statusB = await second.request('/bilibili/auth/status', { cookie: cookieB });
  assert.deepEqual(statusA.data, { loggedIn: true, uname: 'A 的 B 站账户' });
  assert.deepEqual(statusB.data, { loggedIn: true, uname: 'B 的 B 站账户' });
  assert.equal((await second.request('/bilibili/auth/logout', { method: 'POST', cookie: cookieA })).status, 200);
  assert.equal(fs.existsSync(path.join(workspaceA, 'bilibili-session.json')), false);
  assert.equal(fs.existsSync(path.join(workspaceB, 'bilibili-session.json')), true);
  assert.deepEqual((await second.request('/bilibili/auth/status', { cookie: cookieB })).data, { loggedIn: true, uname: 'B 的 B 站账户' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first.directory, 'bilibili-session.json'), 'utf8')), globalSession);
});
