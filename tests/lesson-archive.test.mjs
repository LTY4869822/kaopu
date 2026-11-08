import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';
import { mountLessons } from '../server/lessons.mjs';

test('explicit publication upgrades an old archive to canonical reading content, retains source lineage and stays idempotent', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-archive-test-'));
  const wrongClaim = '常值函数y=2的定义域与值域均为{2}。';
  const lesson = { id: 'lecture-archive', courseId: 'course-a', title: '函数的输入与输出', url: '', part: 1, scope: '',
    createdAt: '2026-11-01', updatedAt: '2026-11-01', status: 'completed', sourceName: 'fixture', sourceFormat: 'json',
    cues: [{ id: 'cue-1', start: 0, end: 10, text: '定义域是允许输入的集合。' }, { id: 'cue-2', start: 11, end: 20, text: '常值函数y=2，当x取遍R时，输出总是2。' }],
    notes: { mode: 'ai', overview: [wrongClaim], createdAt: '2026-11-01', warnings: [], coverage: { cueCount: 2, processedCueCount: 2, visual: false },
      sections: [{ id: 'section-1', title: '函数的概念与记号', text: '定义域指输入集合。', cueIds: ['cue-1'], inScope: null },
        { id: 'section-2', title: '常值函数的定义域与值域', text: wrongClaim, cueIds: ['cue-2'], inScope: null,
          teacherExplanation: '输入范围需要先看题目限制，输出值则始终为2。', steps: ['先读输入范围', '再收集输出值'], explanationOrigin: 'ai-supplement' }],
      readingOutline: [{ title: '定义域与值域', sectionIds: ['section-1', 'section-2'], kind: 'knowledge', summary: '定义域给出输入集合，值域收集全部输出；常值函数y=2的值域为{2}，定义域由题目限制决定。' }],
      examples: [{ id: 'example-1', title: '原课常值函数', prompt: '当x∈[0,1]且y=2时，确定输入和输出集合。', solution: '定义域[0,1]，值域{2}。', cueIds: ['cue-2'], needsReview: true,
        detailedSolution: '补充解法：先读取区间，再判断输出是否变化。', solutionSteps: ['从题设读出[0,1]', '输出恒等于2'], solutionOrigin: 'ai-supplement' }] } };
  fs.writeFileSync(path.join(directory, 'lessons.json'), JSON.stringify({ version: 1, lessons: [lesson] }));
  const oldFingerprint = createHash('sha256').update(JSON.stringify({ cues: lesson.cues, notes: lesson.notes, title: lesson.title, url: lesson.url, part: lesson.part })).digest('hex').slice(0, 24);
  const state = { courses: [{ id: 'course-a' }], documents: [{ id: `lesson-${lesson.id}`, courseId: 'course-a', lessonFingerprint: oldFingerprint, createdAt: '2026-10-01', summary: [wrongClaim], chunks: [{ id: 'old', page: 1, text: wrongClaim }] }] };
  const app = express(); app.use(express.json()); let saves = 0;
  const manager = mountLessons(app, { dataDir: directory, getState: () => state, saveState: () => saves++ });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : '内部错误' }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lessons/${lesson.id}`;
  try {
    const before = await (await fetch(base)).json();
    assert.equal(state.documents[0].summary[0], wrongClaim, 'reading alone never rewrites an existing archive');
    assert.equal(before.notes.sections[1].text, wrongClaim, 'the original generated fragment is retained');
    let response = await fetch(`${base}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200); assert.equal((await response.json()).created, false);
    assert.equal(saves, 1); assert.equal(state.documents.length, 1);
    const document = state.documents[0], archived = document.chunks.map(chunk => chunk.text).join('\n');
    assert.notEqual(document.lessonFingerprint, oldFingerprint); assert.doesNotMatch(document.summary.join('\n'), /定义域与值域均为/);
    assert.doesNotMatch(archived, /定义域与值域均为\{2\}/);
    assert.match(archived, /AI 补充讲解（非老师原话/); assert.match(archived, /AI 补充详细题解/);
    assert.match(archived, /原始讲义片段引用：section-1、section-2/);
    assert.match(archived, /字幕引用：cue-2/); assert.match(archived, /\/api\/lessons\/lecture-archive/);
    assert.equal(document.sourceLessonId, lesson.id); assert.equal(document.createdAt, '2026-10-01');
    response = await fetch(`${base}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200); assert.equal((await response.json()).created, false);
    assert.equal(saves, 1); assert.equal(state.documents.length, 1);
    const retained = await (await fetch(base)).json(); assert.equal(retained.notes.sections[1].text, wrongClaim);
    assert.deepEqual(retained.cues, lesson.cues);
  } finally {
    manager.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
