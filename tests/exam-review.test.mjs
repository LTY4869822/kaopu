// Independent black-box checks for the exam workflow. Synthetic data/model only.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountExams } from '../server/exams.mjs';

const sourceText = '矩阵乘法与复合函数求导均需先核对适用条件。复合函数求导时，外层函数导数乘以内层函数导数。变量A与变量a表示不同对象。';
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
const provider = { configured: true, baseUrl: 'https://exam-fixture.example.test/v1', model: 'fixture-model', apiKey: 'fixture-secret-only' };
const seed = () => ({ courses: [{ id: 'course-a', name: '合成微积分', mastery: 25 }, { id: 'course-b', name: '合成物理', mastery: 50 }],
  documents: [{ id: 'doc-a', courseId: 'course-a', name: '合成讲义.pdf', type: 'PDF', status: 'ready', contentHash: 'fixture-v1', locationKind: 'page',
    chunks: [{ id: 'chunk-a', page: 2, text: sourceText }] },
  { id: 'doc-b', courseId: 'course-b', name: '另一课程.pdf', type: 'PDF', status: 'ready', locationKind: 'page', chunks: [{ id: 'chunk-b', page: 1, text: '这份合成资料属于另一课程，不得在微积分试卷里引用。' }] }], cards: [], questions: [], attempts: [] });

function modelQuestions(payload) {
  return { questions: payload.slots.map(slot => {
    const options = ['single-choice', 'multiple-choice'].includes(slot.type)
      ? [{ id: 'A', text: '保留内层函数的导数' }, { id: 'B', text: '忽略所有适用条件' }, { id: 'C', text: '核对内外层的可导条件' }, { id: 'D', text: '只比较表达式长度' }]
      : slot.type === 'true-false' ? [{ id: 'true', text: '正确' }, { id: 'false', text: '错误' }] : [];
    const answerKey = slot.type === 'single-choice' ? 'A' : slot.type === 'multiple-choice' ? ['A', 'C'] : slot.type === 'true-false' ? 'true' : null;
    const expectedAnswer = slot.type === 'single-choice' ? options[0].text : slot.type === 'multiple-choice' ? '保留内层函数的导数；核对内外层的可导条件' : slot.type === 'true-false' ? '正确' : slot.type === 'fill-blank' ? 'A' : '先核对可导条件，再保留内层函数导数。';
    return { slotId: slot.id, type: slot.type, topic: slot.topic, difficulty: slot.difficulty,
      prompt: `合成练习第${slot.number}题：${slot.topic}中，如何依据适用条件选择正确步骤？`, options, answerKey, expectedAnswer,
      acceptedAnswers: slot.type === 'fill-blank' ? ['A'] : [],
      rubric: 'PRIVATE_RUBRIC_MARKER：按原文核对适用条件与内层导数。',
      explanation: 'PRIVATE_EXPLANATION_MARKER：复合函数求导需同时核对内外层条件。',
      steps: ['先核对内外层函数的适用条件。', '保留内层导数，再核对原文。'],
      hints: ['PRIVATE_HINT_MARKER：先识别复合关系。', '需要保留内层函数导数。'],
      sources: payload.sources.length ? [{ sourceId: payload.sources[0].sourceId, quote: payload.sources[0].text.slice(0, 35) }] : [],
      origin: payload.sources.length ? 'material-based' : 'ai-extension' };
  }) };
}

async function fixture(t, options = {}) {
  let state = seed();
  const calls = [];
  let failSave = false;
  const app = express(); app.use(express.json());
  const service = mountExams(app, { getState: () => state, saveState: () => { if (failSave) throw new Error('synthetic disk error'); }, provider, ...(options.now ? { now: options.now } : {}),
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(JSON.parse(init.body).messages[1].content); calls.push(payload);
      const override = await options.model?.(payload, init);
      if (override) return override;
      if (payload.task === 'exam-template') return response({ title: '合成历年卷结构', durationMinutes: 30, focus: '复合求导与条件核查',
        sections: [{ type: 'single-choice', count: 2, points: 3, difficulty: 'medium', topics: ['复合函数求导'] }],
        sources: [{ sourceId: payload.sources[0].sourceId, quote: payload.sources[0].text.slice(0, 35) }] });
      if (payload.task === 'exam-questions') return response(modelQuestions(payload));
      if (payload.task === 'repair-exam-questions') return response(modelQuestions(payload.original));
      throw new Error(`Unexpected test task ${payload.task}`);
    } });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status === 500 ? '暂时无法保存' : error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(async () => { app.emit('shifen:close'); service.close?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/exams`;
  const api = async (suffix = '', body, method = body === undefined ? 'GET' : 'POST') => {
    const result = await fetch(base + suffix, { method, headers: { Connection: 'close', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: result.status, body: await result.json() };
  };
  const waitJob = async id => {
    for (let index = 0; index < 500; index++) {
      const result = await api(`/jobs/${id}`);
      assert.equal(result.status, 200);
      if (['completed', 'failed', 'cancelled'].includes(result.body.status)) return result.body;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Synthetic exam job did not finish');
  };
  const request = (types = ['single-choice']) => ({ courseId: 'course-a', title: '合成训练卷', durationMinutes: 15, goal: 'balanced', focus: '可导条件与复合求导', sourcePolicy: 'materials', documentIds: ['doc-a'],
    sections: types.map((type, index) => ({ type, count: 1, points: index + 1, difficulty: 'medium', topics: [`合成知识点${index + 1}`] })) });
  const generate = async (types, extra = {}) => {
    const created = await api('/papers', { ...request(types), ...extra });
    assert.equal(created.status, 202, JSON.stringify(created.body));
    const job = await waitJob(created.body.jobId);
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const result = await api(`/papers/${job.paperId}`);
    assert.equal(result.status, 200);
    return result.body;
  };
  return { api, waitJob, request, generate, calls, service, get state() { return state; }, setState(value) { state = value; }, setFailSave(value) { failSave = value; } };
}

const noPrivateAnswers = value => {
  const serialized = JSON.stringify(value);
  for (const marker of ['PRIVATE_RUBRIC_MARKER', 'PRIVATE_EXPLANATION_MARKER', 'PRIVATE_HINT_MARKER']) assert.ok(!serialized.includes(marker), `Leaked ${marker}`);
  const inspect = item => {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      assert.ok(!['answerKey', 'expectedAnswer', 'acceptedAnswers', 'rubric', 'explanation', 'steps', 'hints'].includes(key), `Unsubmitted view leaked ${key}`);
      inspect(child);
    }
  };
  inspect(value);
};

test('exam public views never reveal private answers before submitting, even after refresh', async t => {
  const fx = await fixture(t), paper = await fx.generate(['single-choice', 'short-answer']);
  noPrivateAnswers(paper); noPrivateAnswers((await fx.api('?courseId=course-a')).body);
  const started = await fx.api(`/papers/${paper.id}/start`, { mode: 'exam' });
  assert.equal(started.status, 200); noPrivateAnswers(started.body);
  const refreshed = await fx.api(`/attempts/${started.body.id}`);
  assert.equal(refreshed.status, 200); noPrivateAnswers(refreshed.body);
  const forbiddenHint = await fx.api(`/attempts/${started.body.id}/hints`, { questionId: paper.questions[0].id, level: 3 });
  assert.ok([400, 409].includes(forbiddenHint.status)); noPrivateAnswers(forbiddenHint.body);
  const submitted = await fx.api(`/attempts/${started.body.id}/submit`, { revision: started.body.revision, answers: {}, flaggedQuestionIds: [] });
  assert.equal(submitted.status, 200);
  assert.ok(JSON.stringify(submitted.body).includes('PRIVATE_EXPLANATION_MARKER'));
  assert.equal(fx.state.courses[0].mastery, 25);
});

test('stale autosaves cannot overwrite a newer draft and repeat submission is idempotent', async t => {
  const fx = await fixture(t), paper = await fx.generate(), question = paper.questions[0];
  const { body: started } = await fx.api(`/papers/${paper.id}/start`, { mode: 'exam' });
  const current = await fx.api(`/attempts/${started.id}`, { revision: started.revision, answers: { [question.id]: 'A' }, flaggedQuestionIds: [question.id] }, 'PATCH');
  assert.equal(current.status, 200);
  const stale = await fx.api(`/attempts/${started.id}`, { revision: started.revision, answers: { [question.id]: 'B' }, flaggedQuestionIds: [] }, 'PATCH');
  assert.equal(stale.status, 409);
  const loaded = (await fx.api(`/attempts/${started.id}`)).body;
  assert.equal(loaded.answers[question.id], 'A'); assert.deepEqual(loaded.flaggedQuestionIds, [question.id]);
  const submitted = await fx.api(`/attempts/${started.id}/submit`, { revision: current.body.revision, answers: loaded.answers, flaggedQuestionIds: loaded.flaggedQuestionIds });
  assert.equal(submitted.status, 200); assert.equal(submitted.body.results[0].status, 'correct');
  const again = await fx.api(`/attempts/${started.id}/submit`, { revision: -1, answers: { [question.id]: 'B' } });
  assert.equal(again.status, 200); assert.deepEqual(again.body.results, submitted.body.results);
  assert.equal((await fx.api(`/attempts/${started.id}`, { revision: submitted.body.revision, answers: { [question.id]: 'B' } }, 'PATCH')).status, 409);
});

test('mixed answers use exact IDs and symbol-sensitive fill-in; subjective work remains pending', async t => {
  const fx = await fixture(t), paper = await fx.generate(['single-choice', 'multiple-choice', 'true-false', 'fill-blank', 'short-answer', 'calculation']);
  const { body: started } = await fx.api(`/papers/${paper.id}/start`, { mode: 'practice' });
  const answers = {};
  for (const question of paper.questions) answers[question.id] = question.type === 'multiple-choice' ? ['C', 'A'] : question.type === 'true-false' ? 'true' : question.type === 'fill-blank' ? 'a' : question.type === 'single-choice' ? 'A' : '我先检查可导条件，再进行求导。';
  const submitted = await fx.api(`/attempts/${started.id}/submit`, { revision: started.revision, answers, flaggedQuestionIds: [] });
  assert.equal(submitted.status, 200);
  const byType = type => submitted.body.results.find(item => item.questionId === paper.questions.find(question => question.type === type).id);
  for (const type of ['single-choice', 'multiple-choice', 'true-false']) assert.equal(byType(type).status, 'correct');
  for (const type of ['fill-blank', 'short-answer', 'calculation']) { assert.equal(byType(type).status, 'ungraded'); assert.equal(byType(type).earned, null); }
  assert.equal(submitted.body.summary.pendingPoints, 4 + 5 + 6); assert.equal(submitted.body.summary.objectiveEarned, 1 + 2 + 3);
  assert.equal(fx.state.courses[0].mastery, 25);
});

test('generation rejects cross-course sources before contacting a model', async t => {
  const fx = await fixture(t);
  const invalid = await fx.api('/papers', { ...fx.request(), documentIds: ['doc-b'] });
  assert.ok([400, 404, 409, 422].includes(invalid.status));
  const template = await fx.api('/templates/analyze', { courseId: 'course-a', documentIds: ['doc-b'] });
  assert.ok([400, 404, 409, 422].includes(template.status));
  assert.equal(fx.calls.length, 0);
});

test('source changes block starting an old paper rather than grading against stale evidence', async t => {
  const fx = await fixture(t), paper = await fx.generate();
  fx.state.documents[0].chunks[0].text = '重新解析后的合成讲义内容已经变化，不能复用旧题来源。';
  const stale = await fx.api(`/papers/${paper.id}/start`, { mode: 'exam' });
  assert.ok([404, 409, 410].includes(stale.status));
  const listing = await fx.api('?courseId=course-a');
  const listed = listing.body.papers.find(item => item.id === paper.id);
  assert.ok(!listed || listed.available === false);
  assert.equal(fx.state.courses[0].mastery, 25);
});

test('exam expiry freezes the persisted draft and refuses answers supplied after its deadline', async t => {
  let time = Date.parse('2026-11-05T10:00:00.000Z');
  const fx = await fixture(t, { now: () => time }), paper = await fx.generate(), question = paper.questions[0];
  const { body: started } = await fx.api(`/papers/${paper.id}/start`, { mode: 'exam' });
  const { body: saved } = await fx.api(`/attempts/${started.id}`, { revision: started.revision, answers: { [question.id]: 'B' }, flaggedQuestionIds: [] }, 'PATCH');
  time += 16 * 60_000;
  assert.equal((await fx.api(`/attempts/${started.id}`, { revision: saved.revision, answers: { [question.id]: 'A' } }, 'PATCH')).status, 409);
  const submitted = await fx.api(`/attempts/${started.id}/submit`, { revision: saved.revision, answers: { [question.id]: 'A' } });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.results[0].answer, 'B'); assert.equal(submitted.body.results[0].status, 'incorrect');
});

test('failed draft saves roll back answers and revision without corrupting the persisted attempt', async t => {
  const fx = await fixture(t), paper = await fx.generate(), question = paper.questions[0];
  const { body: started } = await fx.api(`/papers/${paper.id}/start`, { mode: 'exam' });
  fx.setFailSave(true);
  const failed = await fx.api(`/attempts/${started.id}`, { revision: started.revision, answers: { [question.id]: 'A' }, flaggedQuestionIds: [] }, 'PATCH');
  assert.equal(failed.status, 500);
  fx.setFailSave(false);
  const actual = (await fx.api(`/attempts/${started.id}`)).body;
  assert.equal(actual.revision, started.revision); assert.deepEqual(actual.answers, {});
});

test('seeing a solution in a parallel practice attempt prevents independent credit in an already-open exam', async t => {
  const fx = await fixture(t), paper = await fx.generate(), question = paper.questions[0];
  const { body: exam } = await fx.api(`/papers/${paper.id}/start`, { mode: 'exam' });
  const { body: practice } = await fx.api(`/papers/${paper.id}/start`, { mode: 'practice' });
  const hint = await fx.api(`/attempts/${practice.id}/hints`, { questionId: question.id, level: 3 });
  assert.equal(hint.status, 200); assert.ok(hint.body.text.includes('PRIVATE_EXPLANATION_MARKER'));
  const current = (await fx.api(`/attempts/${exam.id}`)).body;
  const submitted = await fx.api(`/attempts/${exam.id}/submit`, { revision: current.revision, answers: { [question.id]: 'A' } });
  assert.equal(submitted.status, 200); assert.equal(submitted.body.summary.independent, false);
  assert.equal(submitted.body.results[0].helpUsed, true);
});

test('cancelling generation cannot commit a late model result, even when a provider ignores abort', async t => {
  let release;
  const fx = await fixture(t, { model: payload => payload.task === 'exam-questions' ? new Promise(resolve => { release = () => resolve(response(modelQuestions(payload))); }) : undefined });
  const created = await fx.api('/papers', fx.request());
  assert.equal(created.status, 202); assert.equal(typeof release, 'function');
  const cancelled = await fx.api(`/jobs/${created.body.jobId}/cancel`, {});
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.status, 'cancelled');
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  const job = await fx.waitJob(created.body.jobId);
  assert.equal(job.status, 'cancelled'); assert.deepEqual((await fx.api('?courseId=course-a')).body.papers, []);
});

test('space reset fences pending jobs and cannot repopulate the replacement state', async t => {
  let release;
  const fx = await fixture(t, { model: payload => payload.task === 'exam-questions' ? new Promise(resolve => { release = () => resolve(response(modelQuestions(payload))); }) : undefined });
  const created = await fx.api('/papers', fx.request());
  assert.equal(created.status, 202);
  fx.service.reset(); fx.setState(seed());
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  const job = await fx.waitJob(created.body.jobId);
  assert.equal(job.status, 'cancelled');
  assert.deepEqual((await fx.api('?courseId=course-a')).body.papers, []);
});
