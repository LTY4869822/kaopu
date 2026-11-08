import test from 'node:test';
import assert from 'node:assert/strict';
import { recompileLesson, validateExampleGroups, editorialRequest } from '../server/lesson-editorial.mjs';
import { currentEditorial, editorialFingerprint } from '../server/lesson-editorial-state.mjs';
import { decorateLessonNotes } from '../server/lesson-document.mjs';
import { evidenceCandidates, validateEvidenceSelection } from '../server/lesson-evidence-selection.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { mountLessons } from '../server/lessons.mjs';

const provider = { baseUrl: 'http://localhost:9876/v1', model: 'fixture-model' };
function fixture() {
  return { id: 'lesson-a', cues: [{ id: 'cue-1', text: '定义域是允许输入的集合，值域是实际输出的集合。', start: 10, end: 20 }], visualCues: [],
    notes: { mode: 'ai', overview: ['先区分输入与输出。'], sections: [{ id: 'section-1', title: '函数的定义域和值域', text: '定义域是允许输入的集合，值域是实际输出的集合。', cueIds: ['cue-1'], frameIds: ['frame-0001'] }], examples: [
      { id: 'example-1', title: '常值函数', prompt: 'y=2，x∈[0,1]，求值域。', solution: '值域为{2}。', cueIds: ['cue-1'], frameIds: ['frame-0001'], explanationStatus: 'complete' },
      { id: 'example-2', title: '常值函数重复片段', prompt: 'y=2，x∈[0,1]，求值域。', solution: '值域为{2}。', cueIds: ['cue-1'], frameIds: ['frame-0001'] },
    ], warnings: [], coverage: { cueCount: 1, processedCueCount: 1 } },
    visual: { id: 'visual-a', frames: [{ id: 'frame-0001', time: 12, sha256: 'a' }, { id: 'frame-0002', time: 19, sha256: 'b' }, { id: 'frame-0003', time: 900, sha256: 'c' }], observations: [] } };
}
const chapter = { text: '定义域是题目允许输入的全部数构成的集合，值域是这些输入实际产生的输出构成的集合。\n\n阅读题目时，先记录给定的区间限制，再查看函数表达式的意义，不能把函数值当作自变量范围。\n\n对于常值函数，所有允许输入都得到同一个输出，但这不会改变题目给定的定义域。', takeaway: '先看允许输入，再看实际输出。', teacherExplanation: '可以把输入限制想成机器的入口条件。', pitfalls: ['不要把常数输出当作定义域。'] };
const exercise = { title: '常值函数的值域', prompt: 'y=2，x∈[0,1]，求值域。', solution: '值域为{2}。', detailedSolution: '所有允许的输入都输出2，因此值域只包含2。', solutionSteps: ['读出自变量范围[0,1]。', '收集所有实际输出，得到{2}。'], explanationStatus: 'complete', explanationGap: '', assumptions: [] };
const groups = { groups: [{ sourceExampleIds: ['example-1', 'example-2'], canonicalExampleId: 'example-1', reason: '同一题目条件完全相同。' }] };
const mock = handler => async (_url, options) => {
  const request = JSON.parse(options.body), input = JSON.parse(request.messages[1].content);
  const value = input.chapters ? { checks: input.chapters.map(item => ({ id: item.id, status: 'ok', reason: '合成课程概念一致。' })), revisions: [] } : await handler(input, request);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
};

test('whole-course edition rewrites instead of concatenating, retains originals, and shares the reading projection', async () => {
  const lesson = fixture(), before = structuredClone(lesson);
  const progress = [];
  const edition = await recompileLesson(provider, lesson, { fetchImpl: mock(input => input.title ? chapter : input.canonicalExampleId ? exercise : groups), onProgress: item => progress.push(item) });
  assert.deepEqual(lesson, before);
  assert.equal(edition.chapters.length, 1); assert.equal(edition.exercises.length, 1);
  assert.deepEqual(edition.exercises[0].sourceExampleIds, ['example-1', 'example-2']);
  lesson.notes.editorial = edition;
  const reading = decorateLessonNotes(lesson.notes, lesson);
  assert.equal(reading.readingSections[0].text, chapter.text);
  assert.equal(reading.readingSections[0].editorial, true);
  assert.equal(reading.readingSections[0].subsections[0].text, before.notes.sections[0].text);
  assert.equal(reading.readingExamples[0].prompt, exercise.prompt);
  assert.deepEqual(reading.sections, before.notes.sections);
  assert.deepEqual(reading.examples, before.notes.examples);
  assert.equal(reading.readingSections[0].evidence.status, 'unreviewed');
  assert.deepEqual(reading.readingSections[0].frameIds, [], 'unreviewed images are never silently auto-inserted');
  assert.ok(progress.some(item => item.phase === 'exercises' && item.done === 1));
});

test('a subtitle-only lesson reports missing video frames instead of directing students to nonexistent board images', async () => {
  const lesson = fixture(); delete lesson.visual;
  lesson.notes.sections[0].frameIds = []; lesson.notes.examples.forEach(item => { item.frameIds = []; });
  lesson.notes.editorial = await recompileLesson(provider, lesson, { fetchImpl: mock(input => input.title ? chapter : input.canonicalExampleId ? exercise : groups) });
  const reading = decorateLessonNotes(lesson.notes, lesson);
  for (const item of [...reading.readingSections, ...reading.readingExamples]) {
    assert.equal(item.evidence.status, 'missing'); assert.deepEqual(item.frameIds, []); assert.match(item.evidence.note, /只有文字原文/); assert.ok(!item.evidence.note.includes('查看原始画面'));
  }
});

test('every original exercise appears once; missing, duplicate, unknown and canonical-outside-group IDs are rejected', () => {
  const examples = fixture().notes.examples;
  assert.equal(validateExampleGroups(groups, examples).length, 1);
  for (const value of [ { groups: [] }, { groups: [{ ...groups.groups[0], sourceExampleIds: ['example-1'] }] },
    { groups: [{ ...groups.groups[0], sourceExampleIds: ['example-1', 'example-1', 'example-2'] }] },
    { groups: [{ ...groups.groups[0], canonicalExampleId: 'unknown' }] },
    { groups: [{ ...groups.groups[0], sourceExampleIds: ['example-1', 'unknown'] }] } ]) assert.throws(() => validateExampleGroups(value, examples));
});

test('source, scope, question, OCR and image revision invalidate the previous edition; UI metadata does not', async () => {
  const lesson = fixture();
  lesson.notes.editorial = await recompileLesson(provider, lesson, { fetchImpl: mock(input => input.title ? chapter : input.canonicalExampleId ? exercise : groups) });
  assert.ok(currentEditorial(lesson));
  for (const mutate of [l => l.cues[0].text += '新内容', l => l.notes.examples[0].prompt += '新条件', l => l.scope = '新范围', l => l.visual.frames[0].sha256 = 'changed', l => l.visual.observations.push({ frameId: 'frame-0001', visibleText: '新识别内容' })]) {
    const changed = structuredClone(lesson); mutate(changed); assert.equal(currentEditorial(changed), null);
    assert.equal(decorateLessonNotes(changed.notes, changed).readingSections[0].editorial, undefined);
  }
  const unchanged = structuredClone(lesson); unchanged.status = 'analyzing'; unchanged.updatedAt = 'later';
  assert.equal(editorialFingerprint(unchanged), editorialFingerprint(lesson));
});

test('ambiguous problems are kept unanswered instead of promoting a fabricated solution or blocking the whole course', async () => {
  const lesson = fixture(); lesson.notes.examples.forEach(item => item.explanationStatus = 'needs-confirmation');
  lesson.notes.editorial = { old: 'keep' };
  const before = structuredClone(lesson);
  const result = await recompileLesson(provider, lesson, { fetchImpl: mock(input => input.title ? chapter : input.canonicalExampleId ? exercise : groups) });
  assert.equal(result.exercises[0].explanationStatus, 'needs-confirmation');
  assert.equal(result.exercises[0].detailedSolution, ''); assert.deepEqual(result.exercises[0].solutionSteps, []);
  assert.deepEqual(lesson, before);
});

test('candidate retrieval stays within real item references or bounded source intervals; no whole-video nearest-frame guesses', () => {
  const lesson = fixture();
  const target = { title: '函数', kind: 'exercise', sourceExampleIds: ['example-1'] };
  assert.deepEqual(evidenceCandidates(lesson, target).map(frame => frame.id), ['frame-0001', 'frame-0002']);
  lesson.notes.examples[0].cueIds = []; lesson.notes.examples[0].frameIds = [];
  assert.deepEqual(evidenceCandidates(lesson, target), []);
});

test('image selection requires actual assessment of every candidate, relevance, clarity and completeness', () => {
  const candidates = [{ id: 'frame-0001' }, { id: 'frame-0002' }];
  const reply = { assessments: candidates.map(frame => ({ frameId: frame.id, legibility: 'clear', completeness: 'complete', relevant: true, reason: '该帧题干条件完整可见。' })), selections: [{ frameId: 'frame-0002', role: 'problem', caption: '已写完的常值函数题干' }], note: '' };
  assert.equal(validateEvidenceSelection(reply, candidates, true).status, 'selected');
  for (const mutate of [v => v.assessments.pop(), v => v.assessments[1].legibility = 'partial', v => v.assessments[1].completeness = 'partial', v => v.assessments[1].relevant = false, v => v.selections[0].frameId = 'unknown', v => v.selections.push(v.selections[0])]) {
    const changed = structuredClone(reply); mutate(changed); assert.throws(() => validateEvidenceSelection(changed, candidates, true));
  }
  const noMatch = structuredClone(reply); noMatch.selections = []; noMatch.note = '题干被老师遮挡。';
  assert.equal(validateEvidenceSelection(noMatch, candidates, true).status, 'no-clear-match');
});

test('only visually selected frames reach the document and their captions remain available', async () => {
  const lesson = fixture();
  const selected = { status: 'selected', selections: [{ frameId: 'frame-0002', role: 'problem', caption: '已完成的题干' }], note: '' };
  lesson.notes.editorial = await recompileLesson(provider, lesson, { fetchImpl: mock(input => input.title ? chapter : input.canonicalExampleId ? exercise : groups), selectEvidence: async (_lesson, targets) => new Map(targets.map(item => [item.id, selected])) });
  const reading = decorateLessonNotes(lesson.notes, lesson);
  assert.deepEqual(reading.readingExamples[0].frameIds, ['frame-0002']);
  assert.equal(reading.readingExamples[0].evidence.selections[0].caption, '已完成的题干');
});

test('model cancellation and malformed output do not silently produce fake successful editions', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(recompileLesson(provider, fixture(), { signal: controller.signal, fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0);
  await assert.rejects(editorialRequest(provider, 'fixture', {}, value => value, { fetchImpl: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '{broken' } }] })); } }));
  assert.equal(calls, 2, 'at most one bounded repair');
});

test('interrupted generation resumes saved chapters and groups, while changed evidence starts a fresh edition', async () => {
  const lesson = fixture(); let saved, chapterCalls = 0;
  await assert.rejects(recompileLesson(provider, lesson, { onCheckpoint: value => { saved = structuredClone(value); }, fetchImpl: mock(input => {
    if (input.title) { chapterCalls++; return chapter; }
    if (input.canonicalExampleId) throw new Error('synthetic connection interruption');
    return groups;
  }) }), /连接中断/);
  assert.equal(saved.chapters.length, 1); assert.equal(saved.groups.length, 1);
  lesson.editorialDraft = saved;
  const edition = await recompileLesson(provider, lesson, { fetchImpl: mock(input => {
    assert.ok(input.canonicalExampleId, 'saved chapters and groups do not need a repeat model request'); return exercise;
  }) });
  assert.equal(edition.exercises.length, 1); assert.equal(chapterCalls, 1);
  lesson.cues[0].text += 'changed';
  await recompileLesson(provider, lesson, { fetchImpl: mock(input => { if (input.title) { chapterCalls++; return chapter; } return input.canonicalExampleId ? exercise : groups; }) });
  assert.equal(chapterCalls, 2);
});

test('queued recompile API publishes one edition atomically and cancellation cannot overwrite it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-editorial-'));
  const lesson = fixture(); lesson.courseId = 'course-a'; lesson.status = 'completed';
  const raw = structuredClone(lesson.notes);
  fs.writeFileSync(path.join(dir, 'lessons.json'), JSON.stringify({ version: 1, lessons: [lesson] }));
  let blocked = false, requests = 0, release;
  const model = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(JSON.parse(body).messages[1].content); requests++;
    if (blocked) await new Promise(resolve => { release = resolve; });
    const result = input.chapters ? { checks: input.chapters.map(item => ({ id: item.id, status: 'ok', reason: '合成校对通过。' })), revisions: [] }
      : input.title ? chapter : input.canonicalExampleId ? exercise : groups;
    if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const app = express(); app.use(express.json());
  let imageRuns = 0;
  const visionService = { configured: () => true, curate: async (_lesson, targets) => {
    imageRuns++;
    return new Map(targets.map(item => [item.id, imageRuns === 1 ? { status: 'unreviewed', selections: [], note: '合成可重试状态。' }
      : { status: 'selected', selections: [{ frameId: 'frame-0002', role: 'illustration', caption: '合成已筛选画面' }], note: '' }]));
  } };
  const manager = mountLessons(app, { dataDir: dir, getState: () => ({ courses: [{ id: 'course-a' }], documents: [] }), saveState: () => {}, visionService, provider: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'fixture', apiKey: 'test-only-key' } });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const api = async (suffix = '', method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/lessons/lesson-a${suffix}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const start = await api('/recompile', 'POST', {}); assert.equal(start.status, 202);
    let completed;
    for (let i = 0; i < 100; i++) {
      completed = (await api()).body;
      if (completed.status === 'completed' || completed.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(completed.status, 'completed', completed.error);
    assert.equal(completed.notes.readingExamples.length, 1); assert.equal(completed.notes.examples.length, 2);
    assert.deepEqual(completed.notes.sections, raw.sections);
    assert.equal(completed.notes.readingSections[0].text, chapter.text);
    assert.equal(completed.editorialDraft, undefined); assert.equal(completed.editorialProgress, undefined);
    const modelRequests = requests;
    assert.equal((await api('/retry-evidence', 'POST', {})).status, 202);
    for (let i = 0; i < 100; i++) {
      completed = (await api()).body;
      if (completed.status === 'completed' || completed.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(completed.status, 'completed', completed.error);
    assert.equal(requests, modelRequests + 1, 'image retry only runs one final alignment, not the original chapter or exercise generators');
    assert.equal(completed.notes.readingSections[0].text, chapter.text);
    assert.deepEqual(completed.notes.readingSections[0].frameIds, ['frame-0002']);
    const edition = completed.notes.editorial;
    blocked = true; const previous = requests;
    await api('/recompile', 'POST', {});
    for (let i = 0; i < 100 && requests === previous; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(requests > previous);
    await api('/cancel', 'POST', {}); release?.();
    await new Promise(resolve => setTimeout(resolve, 25));
    const cancelled = (await api()).body;
    assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(cancelled.notes.editorial, edition);
  } finally {
    release?.(); manager.close(); server.closeAllConnections(); model.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => model.close(resolve))]);
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir(), 'shifen-editorial-')));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
