import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mountLessons } from '../server/lessons.mjs';

test('nullable supplements succeed in one request and required-schema repair shares one total retry budget', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-model-repair-'));
  let strategy, calls = [];
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), source = JSON.parse(body.messages.find(item => item.role === 'user').content);
    calls.push(body);
    const choice = strategy(source, calls.length);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [choice] }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const app = express(); app.use(express.json());
  const manager = mountLessons(app, { dataDir: directory, getState: () => ({ courses: [{ id: 'course-a' }], documents: [] }), saveState() {},
    provider: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'offline-fixture', apiKey: 'fixture' } });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : '内部错误' }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lessons`;
  const api = async (suffix, body) => {
    const response = await fetch(`${base}${suffix}`, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    assert.ok(response.ok); return response.json();
  };
  const wait = async id => {
    for (let turn = 0; turn < 500; turn++) { const lesson = await api(`/${id}`); if (['completed', 'failed'].includes(lesson.status)) return lesson; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error('mock analysis did not finish');
  };
  const created = () => api('', { courseId: 'course-a', title: '定义域', transcript: '定义域是自变量允许取值的集合。' });
  const complete = source => ({ message: { content: JSON.stringify({ sections: [{ title: '定义域', text: '定义域是自变量允许取值的集合。', cueIds: source.allowedRawCueIds,
    teacherExplanation: '先读题目给出的输入范围。', intuition: null, prerequisites: null, steps: null, pitfalls: null, checkQuestion: null }], examples: [], overview: [], warnings: [] }) }, finish_reason: 'stop' });
  try {
    strategy = source => complete(source); calls = [];
    let lesson = await created(); await api(`/${lesson.id}/analyze`, { mode: 'ai' }); let result = await wait(lesson.id);
    assert.equal(result.status, 'completed'); assert.equal(calls.length, 1); assert.equal(result.notes.sections[0].checkQuestion, undefined);
    const instructions = calls[0].messages.filter(item => item.role === 'system').map(item => item.content).join('\n');
    assert.match(instructions, /自然定义域/); assert.match(instructions, /加入端点必须检验/); assert.match(instructions, /条件性解法/);
    assert.equal(result.notes.sections[0].teacherExplanation, '先读题目给出的输入范围。');

    strategy = (source, index) => index === 1 ? { message: { content: JSON.stringify({ sections: [{ title: '缺正文', cueIds: source.allowedRawCueIds }] }) }, finish_reason: 'stop' } : complete(source);
    calls = []; lesson = await created(); await api(`/${lesson.id}/analyze`, { mode: 'ai' }); result = await wait(lesson.id);
    assert.equal(result.status, 'completed'); assert.deepEqual(calls.map(call => call.max_tokens), [12000, 7000]);

    lesson = await created(); await api(`/${lesson.id}/analyze`, { mode: 'extractive' }); const original = await wait(lesson.id);
    strategy = (_source, index) => index === 1 ? { message: { content: '{' }, finish_reason: 'length' }
      : { message: { content: JSON.stringify({ sections: [{ title: '无效引用', text: '不能保存', cueIds: ['foreign-cue'] }] }) }, finish_reason: 'stop' };
    calls = []; await api(`/${lesson.id}/analyze`, { mode: 'ai' }); result = await wait(lesson.id);
    assert.equal(result.status, 'failed'); assert.equal(calls.length, 2, 'JSON repair and schema repair must not add up to a third request');
    assert.deepEqual(result.notes, original.notes); assert.deepEqual(result.cues, original.cues); assert.match(result.error, /来源引用/);
  } finally {
    manager.close(); server.closeAllConnections(); model.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => model.close(resolve))]);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
