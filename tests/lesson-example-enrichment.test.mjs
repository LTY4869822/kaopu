import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrichLessonExamples, hasExampleExplanation, pendingLessonExamples } from '../server/lesson-example-enrichment.mjs';
import { mountLessons } from '../server/lessons.mjs';

const provider = { baseUrl: 'http://localhost:11434/v1', model: 'offline-fixture', apiKey: 'private-fixture' };
const explanation = '补充推导：在实数范围内，对任意输入x都有-1≤sin(x)≤1，因此取正数M=1便满足|sin(x)|≤M，所以该函数在实数范围内有界。';
const example = id => ({ id, title: '正弦有界性', prompt: '说明sin(x)在R上有界。', solution: '', cueIds: ['cue-1'], frameIds: ['frame-0001'], needsReview: true });
const fixture = () => ({ id: 'lecture-a', courseId: 'course-a', title: '函数', url: '', part: 1, scope: '', status: 'completed',
  cues: [{ id: 'cue-1', start: 0, end: 5, text: 'y=sin x在R上有界。' }],
  visual: { id: 'visual-a', frames: [{ id: 'frame-0001', time: 2 }], observations: [{ frameId: 'frame-0001', time: 2, visibleText: 'y=sin x 在R上有界', latex: ['y=\\sin x'], uncertainties: [] }] },
  notes: { mode: 'ai', sections: [{ id: 'section-1', title: '有界性', text: '正弦函数在R上有界。', cueIds: ['cue-1'], inScope: null }], overview: ['有界性需要指明范围。'], examples: [example('example-1')], warnings: [], coverage: { cueCount: 1, processedCueCount: 1, visual: true }, createdAt: '2026-11-01' } });
const envelope = examples => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ examples }) } }] }));
const complete = id => ({ id, status: 'complete', detailedSolution: explanation, solutionSteps: ['确定范围为R', '利用-1≤sin(x)≤1', '取M=1核对有界定义'] });

test('one model request enriches at most eight existing questions and truthfully reports the remainder', async () => {
  const lesson = fixture(), examples = Array.from({ length: 10 }, (_, index) => example(`example-${index + 1}`)), before = structuredClone(examples);
  let calls = 0;
  const result = await enrichLessonExamples(provider, lesson, examples, { fetchImpl: async (_url, options) => {
    calls++; const body = JSON.parse(options.body), source = JSON.parse(body.messages.find(item => item.role === 'user').content);
    assert.equal(body.max_tokens, 8000); assert.equal(source.examples.length, 8); assert.ok(JSON.stringify(source).length <= 24000);
    assert.doesNotMatch(JSON.stringify(body.messages), /private-fixture/);
    return envelope(source.examples.map(item => complete(item.id)));
  } });
  assert.equal(calls, 1); assert.equal(result.stats.completed, 8); assert.equal(result.stats.remaining, 2); assert.equal(result.examples.length, 10);
  assert.match(result.warnings.join(' '), /仍有 2/); assert.match(result.examples[0].detailedSolution, /非老师原话/);
  assert.equal(result.examples[0].prompt, examples[0].prompt); assert.equal(result.examples[0].solution, ''); assert.deepEqual(examples, before);
});

test('unconfirmed prompts require visible conditional assumptions and foreign references are ignored', async () => {
  const lesson = fixture();
  const gap = { ...example('example-2'), prompt: 'D(x)第二分支为[模糊]，讨论周期性。' };
  const result = await enrichLessonExamples(provider, lesson, [example('example-1'), gap], { fetchImpl: async () => envelope([
    { ...complete('example-1'), cueIds: ['foreign-cue'] },
    { id: gap.id, status: 'conditional', assumptions: ['第二分支为x∉Q时D(x)=0'], detailedSolution: '若所列条件成立，任意正有理数T都不改变x的有理无理性质，从而D(x+T)=D(x)。正有理数可以任意小，所以此条件下没有最小正周期。', solutionSteps: ['分有理与无理两类验证'] },
  ]) });
  assert.equal(hasExampleExplanation(result.examples[0]), false); assert.equal(result.stats.remaining, 1);
  assert.match(result.examples[1].detailedSolution.split('\n')[0], /仅在以下条件成立/);
  assert.match(result.examples[1].solutionSteps[0], /第二分支为x∉Q/); assert.equal(result.examples[1].explanationStatus, 'conditional');
  assert.match(result.warnings.join(' '), /引用未通过/);
  const notAssumed = await enrichLessonExamples(provider, lesson, [gap], { fetchImpl: async () => envelope([{ ...complete(gap.id), detailedSolution: explanation }]) });
  assert.equal(hasExampleExplanation(notAssumed.examples[0]), false); assert.equal(notAssumed.examples[0].explanationStatus, 'needs-confirmation');
  assert.equal(pendingLessonExamples(notAssumed.examples).length, 0); assert.equal(notAssumed.stats.needsConfirmation, 1);
});

test('missing/short model answers remain retryable, and timeout or abort never leaks diagnostics', async () => {
  const lesson = fixture();
  const result = await enrichLessonExamples(provider, lesson, [example('example-1')], { fetchImpl: async () => envelope([{ ...complete('example-1'), detailedSolution: '请回看原课。' }]) });
  assert.equal(result.stats.remaining, 1); assert.equal(result.stats.completed, 0); assert.equal(result.examples[0].explanationStatus, undefined);
  const controller = new AbortController(); controller.abort(new Error('private-fixture'));
  await assert.rejects(enrichLessonExamples(provider, lesson, [example('example-1')], { signal: controller.signal, fetchImpl: () => assert.fail() }), error => error.status === 499 && !error.message.includes('private-fixture'));
  const keeper = setTimeout(() => {}, 300);
  try { await assert.rejects(enrichLessonExamples(provider, lesson, [example('example-1')], { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }), { status: 504 }); }
  finally { clearTimeout(keeper); }
});

test('partial API enriches only examples, AI analysis auto-fills missing solutions, and cancellation preserves replacement sources', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-example-test-'));
  const first = fixture(), cancel = { ...fixture(), id: 'lecture-cancel' };
  fs.writeFileSync(path.join(directory, 'lessons.json'), JSON.stringify({ version: 1, lessons: [first, cancel] }));
  let calls = 0, held, hold = false;
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), source = JSON.parse(body.messages.find(item => item.role === 'user').content); calls++;
    if (hold) await new Promise(resolve => { held = resolve; });
    const value = source.untrustedSourceCues ? { sections: [{ title: '有界性', text: '正弦函数在R上有界。', cueIds: source.allowedRawCueIds }],
      examples: [{ title: '正弦有界性', prompt: '说明sin(x)在R上有界。', solution: '', cueIds: source.allowedRawCueIds }], warnings: [], overview: [] }
      : { examples: source.examples.map(item => complete(item.id)) };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const app = express(); app.use(express.json());
  const manager = mountLessons(app, { dataDir: directory, getState: () => ({ courses: [{ id: 'course-a' }], documents: [] }), saveState() {},
    provider: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'offline-fixture', apiKey: 'fixture' } });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : '内部错误' }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lessons`;
  const api = async (suffix, method = 'GET', body) => {
    const response = await fetch(`${base}${suffix}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const wait = async id => { for (let i = 0; i < 500; i++) { const next = (await api(`/${id}`)).body; if (!['queued', 'analyzing'].includes(next.status)) return next; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('mock task did not finish'); };
  try {
    assert.equal((await api('/lecture-a/enrich-examples', 'POST', { exampleIds: ['foreign-example'] })).status, 400);
    const queued = await api('/lecture-a/enrich-examples', 'POST', {}); assert.equal(queued.status, 202); assert.ok(queued.body.notes.readingSections);
    let result = await wait('lecture-a'); assert.equal(result.status, 'completed'); assert.equal(result.notes.exampleEnrichment.completed, 1);
    assert.deepEqual(result.notes.sections, first.notes.sections); assert.deepEqual(result.notes.overview, first.notes.overview); assert.deepEqual(result.cues, first.cues);
    assert.equal((await api('/lecture-a/enrich-examples', 'POST', {})).status, 200); assert.equal(calls, 1, 'already completed questions are not re-generated');
    const created = (await api('', 'POST', { courseId: 'course-a', title: '新课', transcript: '正弦函数在R上有界。' })).body;
    await api(`/${created.id}/analyze`, 'POST', { mode: 'ai' }); result = await wait(created.id);
    assert.equal(result.status, 'completed'); assert.equal(result.notes.exampleEnrichment.completed, 1); assert.ok(result.notes.examples[0].detailedSolution);
    hold = true; await api('/lecture-cancel/enrich-examples', 'POST', {});
    for (let i = 0; i < 200 && !held; i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(held);
    await api('/lecture-cancel/source', 'PUT', { text: '用户替换后的原文。' }); held();
    await new Promise(resolve => setTimeout(resolve, 30)); result = (await api('/lecture-cancel')).body;
    assert.equal(result.notes, undefined); assert.equal(result.cues[0].text, '用户替换后的原文。');
  } finally {
    held?.(); manager.close(); server.closeAllConnections(); model.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => model.close(resolve))]);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
