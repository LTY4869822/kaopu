import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountExams } from '../server/exams.mjs';

const provider = { baseUrl: 'https://exam-model.example.test/v1', model: 'fixture', apiKey: 'secret-only-fixture-exams' };
const seed = () => ({ courses: [{ id: 'math', name: '高等数学', mastery: 30 }, { id: 'other', name: '另一门课程' }], documents: [
  { id: 'doc', courseId: 'math', name: '虚构讲义.pdf', type: 'PDF', chunks: [{ id: 'chunk', page: 1, text: '链式法则要求外层函数求导后乘以内层函数的导数，计算时不能遗漏内层导数因子。\n一、单项选择题（每题2分，共4题）。' }] },
  { id: 'otherdoc', courseId: 'other', name: '另一门资料.txt', type: 'TXT', chunks: [{ id: 'otherchunk', page: 1, text: '这些文字属于另一门课程不可跨课引用。' }] },
] });
const completion = content => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }), { headers: { 'Content-Type': 'application/json' } });
const section = (type = 'single-choice', count = 1) => ({ type, count, points: 2, difficulty: 'medium', topics: ['链式法则'] });
const request = (sections = [section()]) => ({ courseId: 'math', title: '虚构导数练习卷', sections, durationMinutes: 25, goal: 'balanced', focus: '复合函数求导', sourcePolicy: 'materials', documentIds: ['doc'] });
function questionOutput(payload, serial) {
  return { questions: payload.slots.map(s => {
    const options = ['single-choice', 'multiple-choice'].includes(s.type) ? ['A', 'B', 'C', 'D'].map((id, i) => ({ id, text: ['外层导数相乘', '保留内层导数', '丢掉内层因子', '使用导数定义'][i] })) : [];
    return { slotId: s.id, type: s.type, difficulty: s.difficulty, topic: s.topic, prompt: `虚构导数练习第${serial}批第${s.number}题，请根据讲义说明正确处理方式。`, options,
      answerKey: s.type === 'single-choice' ? 'B' : s.type === 'multiple-choice' ? ['A', 'B'] : s.type === 'true-false' ? 'true' : null,
      expectedAnswer: s.type === 'fill-blank' ? 'x' : '外层函数求导后乘以内层函数导数', acceptedAnswers: [], rubric: '完整保留内层导数和外层求导两个要点。',
      explanation: '根据所引用的链式法则讲义，需要识别并保留两层导数。', steps: ['先识别函数中的复合关系。', '求外层导数后再乘以内层导数。'], hints: ['先找清楚外层和内层函数。', '检查是否还遗漏一个求导因子。'],
      sources: payload.sources.length ? [{ sourceId: payload.sources[0].sourceId, quote: payload.sources[0].text.slice(0, 30) }] : [], origin: payload.sources.length ? 'material-based' : 'ai-extension' };
  }) };
}
function templateOutput(payload) {
  return { title: '虚构历年结构样卷', durationMinutes: 25, focus: '根据可见题型分析，难度仅作估计。', sections: [section('single-choice', 4)], sources: [{ sourceId: payload.sources[0].sourceId, quote: payload.sources[0].text.slice(0, 30) }] };
}
async function fixture(t, options = {}) {
  let state = options.state || seed(), saves = 0, serialized = '', now = Date.now();
  const calls = [], app = express(); app.use(express.json({ limit: '512kb' }));
  const service = mountExams(app, { getState: () => state, saveState: () => { options.saveState?.(); serialized = JSON.stringify(state); saves++; }, provider: options.provider || provider, timeoutMs: options.timeoutMs || 2000, now: () => now,
    fetchImpl: async (url, init) => {
      const raw = JSON.parse(init.body), payload = JSON.parse(raw.messages[1].content); calls.push({ url, init, payload });
      const override = await options.model?.(payload, calls.length, init); if (override !== undefined) return override;
      const original = payload.task.startsWith('repair-') ? payload.original : payload;
      return completion(payload.task.includes('template') ? templateOutput(original) : questionOutput(original, calls.length));
    } });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status === 500 ? '记录暂时未保存' : error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(async () => { service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const api = async (route = '', body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/exams${route}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const finish = async id => {
    const end = Date.now() + 4000;
    while (Date.now() < end) { const value = (await api(`/jobs/${id}`)).body; if (!['queued', 'generating'].includes(value.status)) return value; await new Promise(resolve => setTimeout(resolve, 8)); }
    throw new Error('fixture job did not finish');
  };
  const generate = async body => { const created = await api('/papers', body || request()); assert.equal(created.status, 202, JSON.stringify(created.body)); return finish(created.body.jobId); };
  return { api, generate, finish, service, calls, get state() { return state; }, setState(next) { state = next; }, get saves() { return saves; }, get serialized() { return serialized; }, advance(ms) { now += ms; } };
}

test('analyzed past-paper structure requires confirmation and preserves exact section counts and marks', async t => {
  const f = await fixture(t);
  const t0 = await f.api('/templates/analyze', { courseId: 'math', documentIds: ['doc'] });
  assert.equal(t0.status, 200); assert.equal(t0.body.confirmed, false); assert.equal(t0.body.sections[0].count, 4); assert.match(t0.body.warning, /估计/);
  const configuration = { ...request(t0.body.sections), templateId: t0.body.id };
  assert.equal((await f.api('/papers', configuration)).status, 400);
  const confirmed = await f.api(`/templates/${t0.body.id}/confirm`, { sections: t0.body.sections, durationMinutes: 25, title: t0.body.title });
  assert.equal(confirmed.body.confirmed, true);
  assert.equal((await f.api('/papers', { ...configuration, durationMinutes: 30 })).status, 400);
  const done = await f.generate(configuration); assert.equal(done.status, 'completed', done.message);
  const paper = (await f.api(`/papers/${done.paperId}`)).body;
  assert.equal(paper.questions.length, 4); assert.equal(paper.totalPoints, 8); assert.deepEqual(paper.sections, confirmed.body.sections);
  assert.equal(f.calls.find(c => c.payload.task === 'exam-questions').payload.referenceStyle.sections[0].count, 4);
});

test('generation batches are bounded and an entire paper commits atomically', async t => {
  let release, held;
  const wait = new Promise(resolve => { held = resolve; });
  const f = await fixture(t, { model: async p => { if (p.task === 'exam-questions' && p.slots[0].number === 5) { held(); await new Promise(resolve => { release = resolve; }); } } });
  const created = await f.api('/papers', request([section('single-choice', 6)])); await wait;
  assert.equal((await f.api()).body.papers.length, 0); assert.equal(f.state.exams.papers.length, 0);
  const progress = await f.api(`/jobs/${created.body.jobId}`); assert.equal(progress.body.completed, 4); assert.equal(progress.body.total, 6);
  assert.equal((await f.api('/papers', request())).status, 409);
  release(); const done = await f.finish(created.body.jobId); assert.equal(done.status, 'completed');
  assert.equal(f.state.exams.papers[0].questions.length, 6); assert.ok(f.calls.every(c => c.payload.slots.length <= 4));
});

test('cancelled jobs cannot commit even when a provider ignores the abort signal', async t => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { model: async p => { if (p.task === 'exam-questions') { started(); await new Promise(resolve => { release = resolve; }); } } });
  const created = await f.api('/papers', request()); await waiting;
  assert.equal((await f.api(`/jobs/${created.body.jobId}/cancel`, {})).body.status, 'cancelled'); release();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.state.exams.papers.length, 0);
  assert.equal((await f.api(`/jobs/${created.body.jobId}`)).body.status, 'cancelled');
});

test('invalid generation gets one bounded repair; forged sources never enter the paper store', async t => {
  const f = await fixture(t, { model: p => { const value = questionOutput(p.original || p, 1); value.questions[0].sources[0].quote = '伪造的原文引用不在任何资料之中'; return completion(value); } });
  const done = await f.generate(); assert.equal(done.status, 'failed'); assert.match(done.message, /引用/);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].payload.task, 'repair-exam-questions'); assert.equal(f.state.exams.papers.length, 0);
});

test('help is persisted before disclosure and stale autosaves must reload their revision', async t => {
  let failSave = false;
  const f = await fixture(t, { saveState: () => { if (failSave) throw new Error('disk issue'); } });
  const done = await f.generate(), started = (await f.api(`/papers/${done.paperId}/start`, { mode: 'practice' })).body;
  const questionId = started.paper.questions[0].id;
  failSave = true;
  const denied = await f.api(`/attempts/${started.id}/hints`, { questionId, level: 3 }); assert.equal(denied.status, 500); assert.equal(denied.body.text, undefined);
  failSave = false;
  assert.deepEqual((await f.api(`/attempts/${started.id}`)).body.helpedQuestionIds, []);
  const hint = await f.api(`/attempts/${started.id}/hints`, { questionId, level: 1 });
  assert.equal(hint.status, 200); assert.ok(hint.body.text); assert.equal(hint.body.sources[0].documentId, 'doc'); assert.equal(hint.body.attempt.revision, 1);
  assert.equal((await f.api(`/attempts/${started.id}`, { revision: 0, answers: {} }, 'PATCH')).status, 409);
  const result = (await f.api(`/attempts/${started.id}/submit`, { revision: 1, answers: { [questionId]: 'B' } })).body;
  assert.equal(result.summary.helped, 1); assert.equal(result.summary.independent, false); assert.equal(result.results[0].helpUsed, true);
  assert.equal(f.state.courses[0].mastery, 30);
});

test('a sibling attempt exposing hints after exam start cannot create independent evidence', async t => {
  const f = await fixture(t), done = await f.generate();
  const exam = (await f.api(`/papers/${done.paperId}/start`, { mode: 'exam' })).body;
  const practice = (await f.api(`/papers/${done.paperId}/start`, { mode: 'practice' })).body;
  const id = exam.paper.questions[0].id;
  assert.equal((await f.api(`/attempts/${exam.id}/hints`, { questionId: id, level: 3 })).status, 409);
  await f.api(`/attempts/${practice.id}/hints`, { questionId: id, level: 2 });
  const result = (await f.api(`/attempts/${exam.id}/submit`, { revision: 0, answers: { [id]: 'B' } })).body;
  assert.equal(result.summary.independent, false); assert.equal(result.results[0].helpUsed, true);
  const repeated = (await f.api(`/papers/${done.paperId}/start`, { mode: 'exam' })).body;
  assert.notEqual(repeated.id, exam.id); assert.deepEqual(repeated.helpedQuestionIds, [id]);
});

test('expired exams reject edits and grade only the last saved answers', async t => {
  const f = await fixture(t), done = await f.generate();
  const a = (await f.api(`/papers/${done.paperId}/start`, { mode: 'exam' })).body, id = a.paper.questions[0].id;
  const saved = await f.api(`/attempts/${a.id}`, { revision: 0, answers: { [id]: 'A' } }, 'PATCH'); assert.equal(saved.status, 200);
  f.advance(26 * 60000);
  assert.equal((await f.api(`/attempts/${a.id}`, { revision: 1, answers: { [id]: 'B' } }, 'PATCH')).status, 409);
  const result = (await f.api(`/attempts/${a.id}/submit`, { revision: 1, answers: { [id]: 'B' } })).body;
  assert.equal(result.answers[id], 'A'); assert.equal(result.results[0].status, 'incorrect'); assert.equal(result.summary.objectiveEarned, 0);
});

test('mixed paper grading keeps all subjective points pending and records self-review separately', async t => {
  const f = await fixture(t), done = await f.generate(request(['single-choice', 'multiple-choice', 'true-false', 'fill-blank', 'short-answer', 'calculation'].map(type => section(type))));
  const a = (await f.api(`/papers/${done.paperId}/start`, { mode: 'exam' })).body, questions = a.paper.questions;
  const answers = Object.fromEntries(questions.map(q => [q.id, q.type === 'single-choice' ? 'B' : q.type === 'multiple-choice' ? ['B', 'A'] : q.type === 'true-false' ? 'true' : q.type === 'fill-blank' ? 'X' : '我给出的解题过程']));
  const submitted = (await f.api(`/attempts/${a.id}/submit`, { revision: 0, answers })).body;
  assert.equal(submitted.summary.objectiveEarned, 6); assert.equal(submitted.summary.objectiveTotal, 6); assert.equal(submitted.summary.pendingPoints, 6); assert.equal(submitted.summary.ungraded, 3);
  const target = questions.find(q => q.type === 'calculation'), original = submitted.results.find(r => r.questionId === target.id);
  const reviewed = (await f.api(`/attempts/${a.id}/review`, { questionId: target.id, selfAssessment: 'incorrect', reason: 'method', note: '需要先识别内外层。' }, 'PATCH')).body;
  const result = reviewed.results.find(r => r.questionId === target.id);
  assert.equal(result.status, 'ungraded'); assert.equal(result.earned, null); assert.deepEqual(result.review, { selfAssessment: 'incorrect', reason: 'method', note: '需要先识别内外层。' });
  assert.equal(reviewed.summary.pendingPoints, 6); assert.deepEqual(original.answerKey, null);
});

test('AI extension without material is explicitly labeled; material-only mode cannot silently fall back', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/papers', { ...request(), documentIds: [] })).status, 400);
  const done = await f.generate({ ...request(), sourcePolicy: 'extended', documentIds: [] }); assert.equal(done.status, 'completed');
  const p = (await f.api(`/papers/${done.paperId}`)).body;
  assert.equal(p.questions[0].origin, 'ai-extension'); assert.deepEqual(p.documentIds, []);
});

test('course reset fences pending results; deletion prunes dependent private papers and answers', async t => {
  const f = await fixture(t), done = await f.generate(); await f.api(`/papers/${done.paperId}/start`, { mode: 'practice' });
  f.service.pruneDocument('doc'); assert.equal(f.state.exams.papers.length, 0); assert.equal(f.state.exams.attempts.length, 0);
  let release, held; const waiting = new Promise(resolve => { held = resolve; });
  const slow = await fixture(t, { model: async p => { if (p.task === 'exam-questions') { held(); await new Promise(resolve => { release = resolve; }); } } });
  const job = await slow.api('/papers', request()); await waiting; slow.service.reset(); release();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(slow.state.exams.papers.length, 0); assert.equal((await slow.api(`/jobs/${job.body.jobId}`)).body.status, 'cancelled');
});

test('saved papers and unfinished answers survive serialized reload; failed saves roll back', async t => {
  let denySave = false;
  const f = await fixture(t, { saveState: () => { if (denySave) throw new Error('disk full'); } }), done = await f.generate();
  const a = (await f.api(`/papers/${done.paperId}/start`, { mode: 'practice' })).body, id = a.paper.questions[0].id;
  denySave = true;
  assert.equal((await f.api(`/attempts/${a.id}`, { revision: 0, answers: { [id]: 'B' } }, 'PATCH')).status, 500);
  assert.equal((await f.api(`/attempts/${a.id}`)).body.revision, 0); denySave = false;
  await f.api(`/attempts/${a.id}`, { revision: 0, answers: { [id]: 'B' } }, 'PATCH');
  const reloaded = await fixture(t, { state: JSON.parse(f.serialized) });
  const saved = (await reloaded.api(`/attempts/${a.id}`)).body;
  assert.equal(saved.answers[id], 'B'); assert.equal(saved.revision, 1); assert.equal(saved.results, undefined);
  const oldJob = await reloaded.api(`/jobs/${done.id}`); assert.equal(oldJob.status, 404);
});

test('unconfigured models fail honestly and requests enforce timeout/redaction boundaries', async t => {
  const noModel = await fixture(t, { provider: {} }); assert.equal((await noModel.api('/papers', request())).status, 503); assert.equal(noModel.calls.length, 0);
  const secret = await fixture(t, { model: () => completion(provider.apiKey) });
  const failed = await secret.generate(); assert.equal(failed.status, 'failed'); assert.ok(!JSON.stringify(failed).includes(provider.apiKey));
  const slow = await fixture(t, { timeoutMs: 25, model: () => new Promise(() => {}) });
  const timed = await slow.generate(); assert.equal(timed.status, 'failed'); assert.match(timed.message, /超时/); assert.equal(slow.state.exams.papers.length, 0);
});

test('a 100-question objective paper remains bounded and 101 questions are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/papers', request([section('single-choice', 101)]))).status, 400);
  const done = await f.generate(request([section('single-choice', 100)])); assert.equal(done.status, 'completed', done.message);
  const paper = (await f.api(`/papers/${done.paperId}`)).body;
  assert.equal(paper.questions.length, 100); assert.equal(paper.totalPoints, 200); assert.equal(paper.questions[99].number, 100);
  assert.equal(f.calls.length, 25); assert.ok(f.calls.every(c => c.payload.slots.length === 4));
});

test('template analysis reports sampled coverage and a modified template fences an active paper job', async t => {
  const state = seed(); state.documents[0].chunks = Array.from({ length: 205 }, (_, i) => ({ id: `chunk-${i}`, page: i + 1, text: `第${i + 1}个真实文字片段，说明复合函数求导时必须保留外层与内层的关系。` }));
  let release, held; const waiting = new Promise(resolve => { held = resolve; });
  const f = await fixture(t, { state, model: async p => { if (p.task === 'exam-questions') { held(); await new Promise(resolve => { release = resolve; }); } } });
  const template = (await f.api('/templates/analyze', { courseId: 'math', documentIds: ['doc'] })).body;
  assert.equal(template.sourceCoverage.totalChunks, 205); assert.equal(template.sourceCoverage.sampledChunks, 200); assert.equal(template.sourceCoverage.truncated, true);
  await f.api(`/templates/${template.id}/confirm`, {});
  const created = await f.api('/papers', { ...request(template.sections), templateId: template.id }); await waiting;
  await f.api(`/templates/${template.id}/confirm`, { focus: '模板方向已修改' }); release();
  const done = await f.finish(created.body.jobId); assert.equal(done.status, 'failed'); assert.match(done.message, /模板.*修改/); assert.equal(f.state.exams.papers.length, 0);
});

test('server citation IDs backfill exact original mathematical excerpts for templates and all six question types', async t => {
  const state = seed(); state.documents[0].chunks[0].text = '链式法则：若 y=f(g(x))，则 y′=f′(g(x))·g′(x)。例如 y=sin(x²)，则 y′=2x cos(x²)。不要把 x 与 X 或 ∈ 与 = 混淆。';
  const seen = [];
  const f = await fixture(t, { state, model: p => {
    const payload = p.original || p, value = p.task.includes('template') ? templateOutput(payload) : questionOutput(payload, seen.length + 1);
    for (const source of payload.sources) {
      assert.ok(source.citations.length > 0 && source.citations.length <= 4);
      for (const c of source.citations) assert.ok(source.text.includes(c.text));
    }
    assert.ok(payload.sources.flatMap(s => s.citations).reduce((n, c) => n + c.text.length, 0) <= 12000);
    const source = payload.sources[0], candidate = source.citations[0]; seen.push(candidate.text);
    if (p.task.includes('template')) value.sources = [{ sourceId: source.sourceId, citationId: candidate.id }];
    else for (const question of value.questions) question.sources = [{ sourceId: source.sourceId, citationId: candidate.id }];
    return completion(value);
  } });
  const template = (await f.api('/templates/analyze', { courseId: 'math', documentIds: ['doc'] })).body;
  assert.equal(template.sources[0].text, seen[0]); assert.ok(template.sources[0].text.includes('y′=f′(g(x))·g′(x)'));
  assert.equal(template.sources[0].citations, undefined); assert.equal(template.sources[0].citationId, undefined);
  const done = await f.generate(request(['single-choice', 'multiple-choice', 'true-false', 'fill-blank', 'short-answer', 'calculation'].map(type => section(type))));
  assert.equal(done.status, 'completed', done.message);
  const paper = (await f.api(`/papers/${done.paperId}`)).body;
  assert.ok(!JSON.stringify(paper).includes('citations')); assert.ok(!JSON.stringify(paper).includes('citationId')); assert.ok(!JSON.stringify(paper).includes('f′(g(x))'));
  const a = (await f.api(`/papers/${done.paperId}/start`, { mode: 'exam' })).body;
  const submitted = (await f.api(`/attempts/${a.id}/submit`, { revision: 0, answers: {} })).body;
  for (const r of submitted.results) {
    assert.ok(state.documents[0].chunks[0].text.includes(r.sources[0].text));
    assert.equal(r.sources[0].citations, undefined); assert.equal(r.sources[0].citationId, undefined);
  }
});

test('nonexistent citation IDs and IDs borrowed from a different source are rejected without fuzzy fallback', async t => {
  for (const bad of ['nonexistent', 'cross-source']) {
    const state = seed(); state.documents[0].chunks.push({ id: 'second-chunk', page: 2, text: '第二条原文依据专门讨论乘积法则，两个可导函数相乘时要保留两项求导结果。' });
    const f = await fixture(t, { state, model: p => {
      const payload = p.original || p, value = questionOutput(payload, 1);
      const first = payload.sources[0], second = payload.sources[1];
      value.questions[0].sources = [{ sourceId: bad === 'cross-source' ? second.sourceId : first.sourceId, citationId: bad === 'cross-source' ? first.citations[0].id : 's1-imaginary' }];
      return completion(value);
    } });
    const failed = await f.generate(); assert.equal(failed.status, 'failed'); assert.match(failed.message, /引文编号/); assert.equal(f.state.exams.papers.length, 0); assert.equal(f.calls.length, 2);
  }
});

test('a citation ID cannot authenticate a rewritten or contradictory quote', async t => {
  const f = await fixture(t, { model: p => {
    const payload = p.original || p, value = questionOutput(payload, 1), source = payload.sources[0];
    value.questions[0].sources = [{ sourceId: source.sourceId, citationId: source.citations[0].id, quote: source.citations[0].text.replace('导数', '微分') }];
    return completion(value);
  } });
  const failed = await f.generate(); assert.equal(failed.status, 'failed'); assert.match(failed.message, /不一致/); assert.equal(f.state.exams.papers.length, 0);
});

test('library recovers active jobs and only five recent finished jobs with a course-filtered public shape', async t => {
  let release, held; const waiting = new Promise(resolve => { held = resolve; });
  const f = await fixture(t, { model: async p => { if (p.task === 'exam-questions' && p.focus === '等待恢复任务') { held(); await new Promise(resolve => { release = resolve; }); } } });
  const finished = [];
  for (let i = 0; i < 7; i++) finished.push(await f.generate());
  await f.generate({ ...request(), courseId: 'other', documentIds: ['otherdoc'] });
  const started = await f.api('/papers', { ...request(), focus: '等待恢复任务' }); await waiting;
  const listing = (await f.api('?courseId=math')).body;
  assert.equal(listing.jobs.length, 6); assert.equal(listing.jobs[0].id, started.body.jobId); assert.equal(listing.jobs[0].status, 'generating');
  assert.deepEqual(listing.jobs.slice(1).map(j => j.id), finished.slice(-5).reverse().map(j => j.id));
  for (const j of listing.jobs) {
    assert.equal(j.courseId, 'math');
    assert.ok(Object.keys(j).every(k => ['id', 'courseId', 'status', 'completed', 'total', 'message', 'paperId'].includes(k)));
    assert.equal(j.controller, undefined); assert.equal(j.sources, undefined); assert.equal(j.payload, undefined);
  }
  assert.equal((await f.api('?courseId=other')).body.jobs.length, 1);
  await f.api(`/jobs/${started.body.jobId}/cancel`, {}); release();
});

test('different real citation candidates from the same chunk are preserved', async t => {
  const state = seed(); state.documents[0].chunks[0].text = '链式法则要求保留外层求导和内层导数因子。连续性需要函数值有定义、极限存在并等于函数值。';
  let chosen;
  const f = await fixture(t, { state, model: p => {
    const payload = p.original || p, value = questionOutput(payload, 1), source = payload.sources[0];
    assert.ok(source.citations.length >= 2); chosen = source.citations.slice(0, 2);
    value.questions[0].sources = chosen.map(c => ({ sourceId: source.sourceId, citationId: c.id }));
    return completion(value);
  } });
  const done = await f.generate(); assert.equal(done.status, 'completed', done.message); assert.equal(f.calls.length, 1);
  const refs = f.state.exams.papers[0].questions[0].sources;
  assert.equal(refs.length, 2); assert.deepEqual(refs.map(s => s.text), chosen.map(c => c.text));
  assert.equal(refs[0].chunkId, refs[1].chunkId); assert.equal(refs[0].page, refs[1].page);
});

test('identical references are idempotently deduplicated only after full validation', async t => {
  const f = await fixture(t, { model: p => {
    const payload = p.original || p, value = questionOutput(payload, 1), source = payload.sources[0], candidate = source.citations[0];
    value.questions[0].sources = [
      { sourceId: source.sourceId, citationId: candidate.id },
      { sourceId: source.sourceId, quote: candidate.text },
      { sourceId: source.sourceId, citationId: candidate.id, quote: candidate.text },
    ];
    return completion(value);
  } });
  const done = await f.generate(); assert.equal(done.status, 'completed', done.message); assert.equal(f.calls.length, 1);
  assert.equal(f.state.exams.papers[0].questions[0].sources.length, 1);
});

test('a duplicate reference list containing an illegal ID is still rejected', async t => {
  const f = await fixture(t, { model: p => {
    const payload = p.original || p, value = questionOutput(payload, 1), source = payload.sources[0], candidate = source.citations[0];
    value.questions[0].sources = [
      { sourceId: source.sourceId, citationId: candidate.id },
      { sourceId: source.sourceId, citationId: candidate.id },
      { sourceId: source.sourceId, citationId: 's1-does-not-exist' },
    ];
    return completion(value);
  } });
  const done = await f.generate(); assert.equal(done.status, 'failed'); assert.match(done.message, /引文编号/); assert.equal(f.calls.length, 2); assert.equal(f.state.exams.papers.length, 0);
});

test('citation validation distinguishes absent evidence from excess or malformed references and identifies the failed slot', async t => {
  for (const kind of ['empty', 'over-limit', 'malformed']) {
    const f = await fixture(t, { model: p => {
      if (p.task !== 'exam-questions') return undefined;
      const value = questionOutput(p, 1), ref = value.questions[0].sources[0];
      value.questions[0].sources = kind === 'empty' ? [] : kind === 'over-limit' ? Array.from({ length: 5 }, () => ({ ...ref })) : null;
      return completion(value);
    } });
    const done = await f.generate(); assert.equal(done.status, 'completed'); assert.equal(f.calls.length, 2);
    const reason = f.calls[1].payload.validationError;
    assert.match(reason, /第1题（single-choice）/);
    if (kind === 'empty') assert.match(reason, /缺少.*0条/);
    else if (kind === 'over-limit') { assert.match(reason, /超限.*5条.*最多4条/); assert.ok(!reason.includes('缺少')); }
    else { assert.match(reason, /须为数组/); assert.ok(!reason.includes('缺少')); }
    assert.ok(!reason.includes(provider.apiKey)); assert.ok(!reason.includes(seed().documents[0].chunks[0].text));
  }
});
