import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { accountIdForEmail } from '../server/account-store.mjs';
import { workspacePath } from '../server/workspaces.mjs';

test('lecture integration preserves owner guard, repeat-safe memory cards and reset/course boundaries', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-lecture-integration-'));
  const app = createApp({ dataDir, provider: {}, authEnabled: true });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`${base}/api${route}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), response };
  };
  try {
    assert.equal((await request('/lessons')).status, 401);
    const registration = await request('/auth/register', 'POST', { name: 'Test', email: 'lecture@example.test', password: 'Test-Only-2026' });
    cookie = registration.response.headers.get('set-cookie').split(';')[0];
    const workspace = workspacePath(dataDir, accountIdForEmail('lecture@example.test'));
    const initial = (await request('/state')).data;
    const courseId = initial.courses[0].id;
    const lesson = (await request('/lessons', 'POST', { title: '隔离测试讲次', courseId, transcript: '定义：测试来源原文。', format: 'txt' })).data;
    assert.equal(lesson.status, 'ready');
    const card = { courseId, front: '回忆定义', back: '测试来源原文。', source: '网课：隔离测试讲次', sourceKey: `lesson:${lesson.id}:section-1` };
    const first = await request('/cards', 'POST', card);
    const repeat = await request('/cards', 'POST', card);
    assert.equal(first.data.id, repeat.data.id);
    assert.equal((await request('/state')).data.cards.length, initial.cards.length + 1);
    await request(`/courses/${courseId}`, 'DELETE');
    assert.equal((await request('/lessons')).data.lessons.length, 0);
    await request('/reset', 'POST', { mode: 'demo' });
    assert.equal((await request('/lessons')).data.lessons.length, 0);
    assert.ok(fs.existsSync(path.join(workspace, 'before-reset-lessons.json')));
    const id = (await request('/state')).data.courses[0].id;
    await request('/lessons', 'POST', { title: '重置测试', courseId: id, transcript: '重置前的来源。' });
    await request('/reset', 'POST', { mode: 'demo' });
    assert.equal((await request('/lessons')).data.lessons.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'before-reset-lessons.json'), 'utf8')).lessons.length > 0, true);
  } finally {
    app.emit('shifen:close');
    await new Promise(resolve => server.close(resolve));
    // Only the freshly-created temporary test directory is removed.
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
