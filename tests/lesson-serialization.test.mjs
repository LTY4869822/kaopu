import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mountLessons } from '../server/lessons.mjs';

test('queued and cancelled lecture responses use the same canonical reading projection as GET without persisting it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-serialization-'));
  const wrong = '常值函数y=2的定义域与值域均为{2}。';
  const original = { mode: 'ai', overview: [wrong], examples: [], warnings: [], createdAt: '2026-11-01',
    sections: [{ id: 'section-1', title: '定义域', text: '定义域给出输入范围。', cueIds: ['cue-1'], inScope: null },
      { id: 'section-2', title: '定义域', text: '定义域给出输入范围。', cueIds: ['cue-1'], inScope: null },
      { id: 'section-3', title: '常值函数的定义域与值域', text: wrong, cueIds: ['cue-2'], inScope: null }],
    readingOutline: [{ title: '输入与输出', sectionIds: ['section-1', 'section-2', 'section-3'], kind: 'knowledge', summary: '定义域由输入条件决定，常值函数y=2的值域为{2}。' }],
    coverage: { cueCount: 2, processedCueCount: 2, visual: false } };
  const lecture = { id: 'lecture-a', courseId: 'course-a', title: '函数', url: 'https://www.bilibili.com/video/BV1Eb411u7Fw', part: 3, scope: '',
    createdAt: '2026-11-01', updatedAt: '2026-11-01', status: 'completed', sourceName: 'fixture', sourceFormat: 'json', notes: original,
    cues: [{ id: 'cue-1', start: 0, end: 4, text: '定义域是输入集合。' }, { id: 'cue-2', start: 5, end: 10, text: '常值函数y=2对任何给定的输入范围，输出均为2。' }] };
  const filename = path.join(directory, 'lessons.json'); fs.writeFileSync(filename, JSON.stringify({ version: 1, lessons: [lecture] }));
  const model = http.createServer(() => {}); await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const pending = (_lesson, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const app = express(); app.use(express.json());
  const manager = mountLessons(app, { dataDir: directory, getState: () => ({ courses: [{ id: 'course-a' }], documents: [] }), saveState() {},
    provider: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'held-fixture', apiKey: 'fixture' },
    fetchSource: pending, visionService: { capture: pending, remove() {}, configured: () => false } });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : '内部错误' }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lessons/${lecture.id}`;
  const check = lesson => {
    assert.equal(lesson.notes.readingSections.length, 1); assert.doesNotMatch(lesson.notes.readingOverview.join('\n'), /定义域与值域均为/);
    assert.equal(lesson.notes.sections.length, 3); assert.equal(lesson.notes.sections[2].text, wrong);
  };
  const post = async (suffix, body) => { const response = await fetch(`${base}${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  try {
    check(await (await fetch(base)).json());
    for (const [route, body] of [['/analyze', { mode: 'ai' }], ['/fetch', {}], ['/visual', { mode: 'capture' }]]) {
      const queued = await post(route, body); assert.equal(queued.status, 202); check(queued.body);
      const cancelled = await post('/cancel', {}); assert.equal(cancelled.status, 200); check(cancelled.body);
    }
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8')).lessons[0];
    assert.deepEqual(saved.notes, original); assert.equal(saved.notes.readingSections, undefined); assert.equal(saved.notes.readingOverview, undefined);
  } finally {
    manager.close(); server.closeAllConnections(); model.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => model.close(resolve))]);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
