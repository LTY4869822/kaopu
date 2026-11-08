import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { lessonStudy, updateLessonStudy } from '../server/lesson-study.mjs';
import { mountLessons } from '../server/lessons.mjs';
import { createApp } from '../server/index.mjs';

const fixture = () => ({ id: 'lesson-study', courseId: 'course-a', title: '学习验收合成课', url: 'https://www.bilibili.com/video/BV1Eb411u7Fw/', part: 20,
  status: 'completed', updatedAt: '2026-11-05', cues: [{ id: 'cue-1', start: 0, end: 20, text: '定义域由输入限制决定。' }],
  sourceDiagnostics: { reviewCueIds: ['cue-1', 'unknown'] },
  visual: { id: 'visual-a', frames: [{ id: 'frame-0001', time: 0 }, { id: 'frame-0002', time: 200 }],
    observations: [{ frameId: 'frame-0001', uncertainties: ['右上角符号模糊。'] }], coverage: { durationSeconds: 240, unobservedIntervals: [{ start: 0, end: 200 }] } },
  notes: { mode: 'ai', createdAt: '2026-11-05', coverage: { cueCount: 1, processedCueCount: 1, visual: true }, warnings: [], overview: [],
    sections: [{ id: 'section-1', title: '定义域', text: '输入需要符合题目限制。', cueIds: ['cue-1'] }, { id: 'section-2', title: '值域', text: '函数实际输出的集合。', cueIds: ['cue-1'] }],
    examples: [{ id: 'example-1', title: '条件缺失的题目', prompt: '求集合。', explanationStatus: 'needs-confirmation', explanationGap: '缺少自变量范围。', cueIds: ['cue-1'] }] } });

test('study checklist distinguishes observed failures, uncertain evidence and gaps without claiming completeness', () => {
  const lesson = fixture(), before = JSON.stringify(lesson), result = lessonStudy(lesson);
  assert.equal(result.issueCount, 5);
  assert.equal(result.issues.find(item => item.id === 'frame-0002').action, 'read');
  assert.match(result.issues.find(item => item.id === 'example-1').detail, /缺少自变量/);
  const gap = result.issues.find(item => item.kind === 'gap');
  assert.equal(gap.end - gap.start, 120); assert.equal(gap.start, 40);
  assert.match(gap.detail, /不代表一定有遗漏/);
  assert.equal(JSON.stringify(lesson), before, 'reading never mutates evidence or study data');
});

test('read/weak/practiced marks are idempotent, versioned and retained only for unchanged content', () => {
  const lesson = fixture(), initial = lessonStudy(lesson), evidence = JSON.stringify([lesson.cues, lesson.notes, lesson.visual]);
  const mark = (kind, id, status) => updateLessonStudy(lesson, { version: lessonStudy(lesson).version, kind, id, status });
  mark('section', 'section-1', 'read');
  assert.equal(mark('section', 'section-1', 'read').progress.readCount, 1);
  const weak = mark('section', 'section-2', 'weak'); assert.equal(weak.progress.weakCount, 1);
  assert.equal(weak.bookmark.id, 'section-2');
  assert.equal(mark('example', 'example-1', 'practiced').progress.practicedCount, 1);
  assert.equal(mark('section', 'section-1', 'bookmark').progress.readCount, 1);
  assert.throws(() => mark('section', 'foreign-id', 'read'), /当前讲义/);
  assert.throws(() => mark('example', 'example-1', 'read'), /状态无效/);
  assert.equal(JSON.stringify([lesson.cues, lesson.notes, lesson.visual]), evidence);
  lesson.notes.sections[0].text += '新的限制条件。';
  assert.equal(lessonStudy(lesson).marks['section:section-1'], undefined);
  assert.equal(lessonStudy(lesson).marks['section:section-2'], 'weak');
  assert.equal(lessonStudy(lesson).bookmark, null);
  assert.throws(() => updateLessonStudy(lesson, { version: initial.version, kind: 'section', id: 'section-1', status: 'read' }), /讲义已更新/);
});

async function serve(directory, visionService) {
  const state = { courses: [{ id: 'course-a' }], documents: [] };
  const app = express(); app.use(express.json());
  const manager = mountLessons(app, { dataDir: directory, getState: () => state, saveState() {}, visionService });
  app.use((cause, _req, res, _next) => res.status(cause.status || 500).json({ error: cause.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lessons/lesson-study`;
  return { manager, state, request: async (suffix = '', method = 'GET', body) => { const res = await fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() }; }, close: async () => { manager.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('study API survives restart, validates course/version, and keeps raw source bytes unchanged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-study-test-')), lesson = fixture();
  fs.writeFileSync(path.join(dir, 'lessons.json'), JSON.stringify({ version: 1, lessons: [lesson] }));
  let app = await serve(dir);
  try {
    const current = (await app.request('/study')).data;
    const section = (await app.request()).data.notes.readingSections[0];
    const result = await app.request('/study', 'PUT', { version: current.version, kind: 'section', id: section.id, status: 'weak' });
    assert.equal(result.status, 200); assert.equal(result.data.progress.weakCount, 1);
    assert.equal((await app.request('/study', 'PUT', { version: 'stale', kind: 'section', id: section.id, status: 'read' })).status, 409);
    await app.close(); app = await serve(dir);
    assert.equal((await app.request('/study')).data.progress.weakCount, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'lessons.json'))).lessons[0];
    assert.deepEqual(saved.cues, lesson.cues); assert.deepEqual(saved.visual, lesson.visual); assert.deepEqual(saved.notes, lesson.notes);
    app.state.courses = [];
    assert.equal((await app.request('/study')).status, 404);
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('supplement queues safely, keeps the old lecture readable and blocks stale export/publication until regenerated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-study-test-')), lesson = fixture();
  fs.writeFileSync(path.join(dir, 'lessons.json'), JSON.stringify({ version: 1, lessons: [lesson] }));
  const visual = { configured: () => false, supplement: async (current, { range }) => {
    assert.deepEqual(range, { start: 30, end: 60 });
    const evidence = { ...current.visual, id: 'visual-b', frames: [...current.visual.frames, { id: 'frame-0003', time: 45, width: 1200, height: 675 }], observations: current.visual.observations, warnings: [] };
    const frames = path.join(dir, 'lesson-visual', current.id, evidence.id); fs.mkdirSync(frames, { recursive: true });
    for (const frame of evidence.frames) fs.writeFileSync(path.join(frames, `${frame.id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return evidence;
  } };
  const app = await serve(dir, visual);
  try {
    for (const range of [{ start: 0, end: 121 }, { start: -1, end: 5 }, { start: 230, end: 250 }, { start: true, end: 20 }, null]) {
      assert.equal((await app.request('/visual', 'POST', { mode: 'supplement', range })).status, 400);
    }
    assert.equal((await app.request('/visual', 'POST', { mode: 'supplement', range: { start: 30, end: 60 } })).status, 202);
    let updated;
    for (let i = 0; i < 80; i++) { updated = (await app.request()).data; if (!['queued', 'analyzing'].includes(updated.status)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(updated.status, 'completed', updated.error); assert.equal(updated.visual.frames.length, 3);
    assert.deepEqual(updated.cues, lesson.cues); assert.deepEqual(updated.notes.sections, lesson.notes.sections);
    assert.equal(updated.notes.evidenceOutdated, true);
    assert.equal((await app.request('/publish', 'POST', {})).status, 422);
    assert.equal((await app.request('/document')).status, 422);
    assert.equal((await app.request('/study')).data.issues[0].kind, 'notes');
    await app.request('/analyze', 'POST', { mode: 'extractive' });
    for (let i = 0; i < 80; i++) { updated = (await app.request()).data; if (!['queued', 'analyzing'].includes(updated.status)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(updated.notes.evidenceOutdated, undefined);
    assert.equal((await app.request('/publish', 'POST', {})).status, 200);
    assert.equal((await app.request('/publish', 'POST', {})).status, 200);
    assert.equal(app.state.documents.length, 1);
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('new study read and mutation routes stay behind the owner session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-study-test-'));
  const app = createApp({ dataDir: dir, provider: {}, authEnabled: true });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    for (const method of ['GET', 'PUT']) assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/lessons/lesson-study/study`, { method })).status, 401);
  } finally { app.emit('shifen:close'); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
