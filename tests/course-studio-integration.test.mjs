import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

async function harness(options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-studio-integration-'));
  const app = createApp({ dataDir, provider: {}, videoFetcher: null, ...options });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { base: `http://127.0.0.1:${server.address().port}/api`, dataDir, async close() {
    app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('shifen-studio-integration-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  } };
}

test('an existing course deleted during AI classification is not silently recreated', async () => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const h = await harness({ courseClassifier: { async classify() { started(); await waiting; return { status: 'classified', subject: '高等数学', courseId: 'math', confidence: .85, engine: 'ai', reason: '识别出数学资料。' }; } } });
  try {
    const form = new FormData(); form.append('file', new Blob(['导数描述变化率；复合函数求导要乘以内层导数。']), '第八周资料.txt');
    const pending = fetch(`${h.base}/documents/auto`, { method: 'POST', body: form });
    await entered;
    assert.equal((await fetch(`${h.base}/courses/math`, { method: 'DELETE' })).status, 200);
    release(); const response = await pending; const result = await response.json();
    assert.equal(response.status, 201); assert.equal(result.course, null); assert.equal(result.document.courseId, '');
    assert.equal(result.classification.status, 'needs-review');
    const state = await (await fetch(`${h.base}/state`)).json(); assert.ok(!state.courses.some(course => course.name === '高等数学'));
    assert.ok(!('courseStudio' in state));
  } finally { release(); await h.close(); }
});

test('the owner guard protects course artifacts and all new subjective submission routes', async () => {
  const h = await harness({ authEnabled: true });
  try {
    for (const [route, method] of [
      ['/course-studio?courseId=math', 'GET'], ['/course-studio/jobs', 'POST'], ['/course-studio/jobs/unknown', 'DELETE'],
      ['/course-studio/artifacts/unknown/export', 'GET'], ['/exams/attempts/unknown/submission', 'POST'],
      ['/exams/attempts/unknown/grade', 'POST'], ['/exams/grading-jobs/unknown', 'GET'],
    ]) assert.equal((await fetch(h.base + route, { method })).status, 401, route);
  } finally { await h.close(); }
});
