import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

const types = ['single-choice', 'multiple-choice', 'true-false', 'fill-blank', 'short-answer', 'calculation'];
const content = '合成期末试卷及复习范围：本卷考察复合函数、导数条件和矩阵运算。复合函数的导数等于外层导数与内层导数的乘积。大写变量A和小写变量a含义不同。请核对可导条件。';
const plan = types.map((type, index) => ({ type, count: 1, points: index + 1, difficulty: 'medium', topics: [`复合求导训练${index + 1}`] }));
const provider = { baseUrl: 'https://exam-model.example.test/v1', model: 'synthetic', apiKey: 'synthetic-only-secret' };
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
function model() {
  let batch = 0;
  return async (_url, init) => {
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    const source = payload.sources[0];
    if (payload.task === 'exam-template') return response({ title: '合成期末样卷结构', durationMinutes: 30, focus: '复合求导、变量与适用条件', sections: plan, sources: [{ sourceId: source.sourceId, quote: source.text.slice(0, 36) }] });
    if (payload.task !== 'exam-questions') throw new Error('Unexpected synthetic task');
    batch++;
    return response({ questions: payload.slots.map(slot => {
      const options = ['single-choice', 'multiple-choice'].includes(slot.type) ? [
        { id: 'A', text: '外层导数乘以内层导数' }, { id: 'B', text: '两层导数相加' }, { id: 'C', text: '核对内外层的可导条件' }, { id: 'D', text: '省略内层导数' },
      ] : [];
      return { slotId: slot.id, type: slot.type, topic: slot.topic, difficulty: slot.difficulty,
        prompt: `第${batch}批第${slot.number}道合成题：${slot.topic}如何核对条件和保留内层导数？`, options,
        answerKey: slot.type === 'single-choice' ? 'A' : slot.type === 'multiple-choice' ? ['A', 'C'] : slot.type === 'true-false' ? 'true' : null,
        expectedAnswer: slot.type === 'fill-blank' ? 'A' : '核对可导条件，外层导数乘以内层导数。', acceptedAnswers: slot.type === 'fill-blank' ? ['A'] : [],
        rubric: 'PRIVATE_EXAM_RUBRIC：核对条件并保留内层函数导数。', explanation: 'PRIVATE_EXAM_EXPLANATION：依据资料进行复合函数求导。',
        steps: ['先识别复合函数的内外层关系。', '核对条件，保留内层导数。'], hints: ['先识别函数的复合关系。', '分别思考内层和外层的导数。'],
        sources: [{ sourceId: source.sourceId, quote: source.text.slice(0, 36) }], origin: 'material-based' };
    }) });
  };
}

async function fixture(t, authEnabled = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-exam-integration-'));
  const instances = [], fetchImpl = model();
  let cookie;
  const open = async () => {
    const app = createApp({ dataDir: directory, provider, examFetch: fetchImpl, authEnabled });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const instance = { app, server, closed: false }; instances.push(instance);
    const api = async (route, body, method = body === undefined ? 'GET' : 'POST', useCookie = true) => {
      const result = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method,
        headers: { Connection: 'close', ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(cookie && useCookie ? { Cookie: cookie } : {}) },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
      return { status: result.status, body: await result.json(), cookie: result.headers.get('set-cookie') };
    };
    return { api, close: async () => { if (instance.closed) return; instance.closed = true; app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
  };
  t.after(async () => {
    for (const instance of instances) if (!instance.closed) { instance.app.emit('shifen:close'); instance.server.closeAllConnections(); await new Promise(resolve => instance.server.close(resolve)); }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('shifen-exam-integration-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const initial = await open();
  return { ...initial, open, directory, setCookie(value) { cookie = value; } };
}

async function setup(api) {
  assert.equal((await api('/reset', { mode: 'empty' })).status, 200);
  const course = (await api('/courses', { name: '合成高数课程', target: 80 })).body;
  const file = new FormData(); file.append('courseId', course.id); file.append('file', new Blob([content]), '合成期末试卷.txt');
  const imported = await api('/documents', file);
  assert.equal(imported.status, 201);
  return { course, document: imported.body };
}

async function generated(api, request) {
  const created = await api('/exams/papers', request);
  assert.equal(created.status, 202, JSON.stringify(created.body));
  for (let i = 0; i < 500; i++) {
    const result = await api(`/exams/jobs/${created.body.jobId}`);
    if (result.body.status === 'completed') return (await api(`/exams/papers/${result.body.paperId}`)).body;
    assert.ok(!['failed', 'cancelled'].includes(result.body.status), JSON.stringify(result.body));
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Synthetic paper generation exceeded test deadline');
}

test('root app connects original upload, editable past-paper template, six-type paper, saved answer and review', async t => {
  const fx = await fixture(t), { api } = fx;
  const { course, document } = await setup(api);
  const analyzed = await api('/exams/templates/analyze', { courseId: course.id, documentIds: [document.id] });
  assert.equal(analyzed.status, 200); assert.equal(analyzed.body.confirmed, false);
  const template = (await api(`/exams/templates/${analyzed.body.id}/confirm`, { title: '已核对的合成样卷', durationMinutes: 30, sections: analyzed.body.sections, focus: analyzed.body.focus })).body;
  assert.equal(template.confirmed, true);
  const paper = await generated(api, { courseId: course.id, title: '合成全题型练习', sections: template.sections, durationMinutes: 30,
    goal: 'balanced', focus: template.focus, sourcePolicy: 'materials', documentIds: [document.id], templateId: template.id });
  assert.equal(paper.questions.length, 6); assert.deepEqual(paper.questions.map(q => q.type), types);
  assert.equal(paper.totalPoints, 21); assert.ok(!JSON.stringify(paper).includes('PRIVATE_EXAM_'));
  assert.equal((await api('/state')).body.exams, undefined);
  const attempt = (await api(`/exams/papers/${paper.id}/start`, { mode: 'exam' })).body;
  const answers = Object.fromEntries(paper.questions.map(q => [q.id, q.type === 'multiple-choice' ? ['C', 'A'] : q.type === 'true-false' ? 'true' : q.type === 'fill-blank' || q.type === 'single-choice' ? 'A' : '先识别内外层并核对可导条件。']));
  const saved = await api(`/exams/attempts/${attempt.id}`, { revision: attempt.revision, answers, flaggedQuestionIds: [paper.questions[5].id] }, 'PATCH');
  assert.equal(saved.status, 200);
  const submitted = await api(`/exams/attempts/${attempt.id}/submit`, { revision: saved.body.revision, answers });
  assert.equal(submitted.status, 200); assert.equal(submitted.body.status, 'submitted');
  assert.equal(submitted.body.summary.pendingPoints, 11); assert.equal(submitted.body.summary.objectiveEarned, 10);
  assert.equal(submitted.body.results.find(r => r.questionId === paper.questions[4].id).status, 'ungraded');
  assert.ok(submitted.body.results.every(r => r.sources[0].documentId === document.id));
  const reviewed = await api(`/exams/attempts/${attempt.id}/review`, { questionId: paper.questions[5].id, selfAssessment: 'incorrect', reason: 'method' }, 'PATCH');
  assert.equal(reviewed.status, 200);
  const exported = (await api('/export')).body;
  assert.ok(JSON.stringify(exported.exams).includes('PRIVATE_EXAM_RUBRIC'));
  assert.ok(!JSON.stringify(exported).includes('synthetic-only-secret'));
  assert.equal((await api('/state')).body.courses[0].mastery, 0);
  await fx.close();
  const reopened = await fx.open();
  const restored = await reopened.api(`/exams/attempts/${attempt.id}`);
  assert.equal(restored.status, 200); assert.deepEqual(restored.body.answers, submitted.body.answers);
  assert.equal(restored.body.results.at(-1).review.reason, 'method');
  assert.equal((await reopened.api(`/documents/${document.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await reopened.api(`/exams/papers/${paper.id}`)).status, 404);
  assert.equal((await reopened.api('/exams')).body.attempts.length, 0);
});

test('root owner guard protects paper analysis, jobs and answer endpoints', async t => {
  const fx = await fixture(t, true);
  assert.equal((await fx.api('/exams')).status, 401);
  assert.equal((await fx.api('/exams/templates/analyze', {})).status, 401);
  assert.equal((await fx.api('/exams/papers', {})).status, 401);
  const registered = await fx.api('/auth/register', { email: 'exam-fixture@example.test', name: '合成测试', password: 'Synthetic-only-password-42' });
  assert.equal(registered.status, 201); fx.setCookie(registered.cookie.split(';')[0]);
  assert.equal((await fx.api('/exams')).status, 200);
  assert.equal((await fx.api('/exams/jobs/not-a-job', undefined, 'GET', false)).status, 401);
  assert.equal((await fx.api('/exams/attempts/not-an-attempt', {}, 'PATCH', false)).status, 401);
  assert.equal((await fx.api('/exams/attempts/not-an-attempt/submit', {}, 'POST', false)).status, 401);
});

test('course rename, material reassignment and reset invalidate root exam references', async t => {
  const fx = await fixture(t), { api } = fx;
  for (const action of ['rename', 'reassign', 'reset']) {
    const { course, document } = await setup(api);
    const paper = await generated(api, { courseId: course.id, title: `合成${action}检验卷`, sections: [plan[0]], durationMinutes: 15, goal: 'pass', focus: '复合求导', sourcePolicy: 'materials', documentIds: [document.id] });
    if (action === 'rename') assert.equal((await api(`/courses/${course.id}`, { name: '已经更名的课程' }, 'PATCH')).status, 200);
    if (action === 'reassign') {
      const other = (await api('/courses', { name: '合成另一课程' })).body;
      assert.equal((await api(`/documents/${document.id}`, { courseId: other.id }, 'PATCH')).status, 200);
    }
    if (action === 'reset') assert.equal((await api('/reset', { mode: 'empty' })).status, 200);
    assert.equal((await api(`/exams/papers/${paper.id}`)).status, 404);
    assert.equal((await api('/exams')).body.papers.length, 0);
  }
});
