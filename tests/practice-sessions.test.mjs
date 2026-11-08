import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountPracticeSessions } from '../server/practice-sessions.mjs';

const question = (id, type = 'single-choice') => ({ id, courseId: 'math', type, topic: '链式法则', prompt: `练习 ${id}`, options: type === 'single-choice' ? [{ id: 'A', text: '相加' }, { id: 'B', text: '相乘' }] : [], answerKey: 'B', expectedAnswer: '外导乘内导', explanation: '来源解析', steps: ['辨认内外层', '分别求导并相乘'], sources: [{ documentId: 'doc', documentName: '讲义', chunkId: 'c1', page: 1, locationKind: 'page', text: '复合函数求导外导乘内导' }], sourceRevision: 1 });
const answer = (v = 'B', skipped = false) => ({ answer: skipped ? '' : v, skipped });
async function fixture(t, options = {}) {
  const state = { courses: [{ id: 'math', name: '高等数学', mastery: 0 }, { id: 'other', name: '其他课' }], attempts: [], assessments: { version: 1, questions: [], attempts: [] } };
  const questions = [question('q1'), question('q2', 'short-answer'), question('q3')];
  let modelCalls = 0, saves = 0, failSaveAt = 0;
  const app = express(); app.use(express.json());
  mountPracticeSessions(app, { getState: () => state, saveState: () => { saves++; if (saves === failSaveAt) throw new Error('disk'); },
    resolveQuestion: (id, _mode, courseId) => questions.find(q => q.id === id && q.courseId === courseId), configured: () => options.configured !== false,
    recordOutcome: ({ courseId, correct }) => { state.courses.find(c => c.id === courseId).mastery += correct ? 1 : -1; },
    review: async (payload, signal) => { modelCalls++; if (options.review) return options.review(payload, signal);
      return { summary: '先补齐内层求导，再练一题变式。', recommendations: ['练习内层为平方的复合函数'], items: payload.questions.map(q => ({ questionId: q.id, status: 'correct', confidence: 0.9, feedback: '请注意内层导数。', explanation: '先识别复合层级，再求外导并乘以内导。', steps: ['辨认内层函数', '求导后检查因子'] })) }; },
  });
  app.use((e, _req, res, _next) => res.status(e.status || 500).json({ error: e.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const call = async (path, body) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/practice${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  const create = async (ids = ['q1', 'q2'], mode = 'understanding') => (await call('/sets', { courseId: 'math', mode, questionIds: ids })).body.set;
  return { state, questions, call, create, modelCalls: () => modelCalls, saves: () => saves, failSave: (offset = 1) => { failSaveAt = saves + offset; } };
}
test('batch creation and drafts never disclose keys, sources or explanations; no model call until final submission', async t => {
  const f = await fixture(t), set = await f.create(); assert.equal(set.questions.length, 2);
  assert.equal(f.modelCalls(), 0);
  for (const q of set.questions) for (const k of ['answerKey', 'expectedAnswer', 'explanation', 'steps', 'sources']) assert.equal(q[k], undefined);
  await f.call(`/sets/${set.id}/draft`, { revision: 1, answers: { q1: answer() } });
  const latest = await f.call('/sets?courseId=math&mode=understanding'); assert.equal(latest.body.set.answers.q1.answer, 'B'); assert.equal(latest.body.set.report, undefined); assert.equal(f.modelCalls(), 0);
  assert.equal((await f.call(`/sets/${set.id}/submit`, { revision: 1, answers: { q1: answer() } })).status, 400);
  assert.equal(f.modelCalls(), 0); assert.equal(f.state.assessments.attempts.length, 0);
});
test('only whole-set submission calls AI once, objective scoring stays deterministic and duplicate submission is idempotent', async t => {
  const f = await fixture(t), set = await f.create();
  const res = await f.call(`/sets/${set.id}/submit`, { revision: 1, answers: { q1: answer('A'), q2: answer('外导乘内导') } });
  assert.equal(res.status, 200); assert.equal(res.body.set.status, 'reviewed'); assert.equal(f.modelCalls(), 1);
  assert.equal(res.body.set.report.items[0].status, 'incorrect'); assert.equal(res.body.set.report.items[1].status, 'correct');
  assert.equal(res.body.set.report.items[0].counted, true); assert.equal(res.body.set.report.items[1].counted, false); assert.equal(f.state.courses[0].mastery, -1);
  assert.equal((await f.call(`/sets/${set.id}/submit`, {})).status, 200); assert.equal(f.modelCalls(), 1); assert.equal(f.state.assessments.attempts.length, 2);
  assert.equal((await f.call(`/sets/${set.id}/draft`, { revision: 2, answers: {} })).status, 409);
});
test('review failure keeps all answers and retry records outcomes once', async t => {
  let calls = 0;
  const f = await fixture(t, { review: async payload => { if (++calls === 1) throw new Error('secret upstream details'); return { summary: '复习定义', recommendations: ['再做一道'], items: payload.questions.map(q => ({ questionId: q.id, status: 'partial', confidence: 0.9, feedback: '补全细节', explanation: '按原文推导', steps: ['第一步'] })) }; } });
  const set = await f.create(), body = { revision: 1, answers: { q1: answer(), q2: answer('', true) } };
  const failed = await f.call(`/sets/${set.id}/submit`, body); assert.equal(failed.status, 502); assert.equal(failed.body.set.status, 'review-failed'); assert.equal(failed.body.set.answers.q1.answer, 'B');
  assert.ok(!JSON.stringify(failed.body).includes('secret upstream')); assert.equal(f.state.assessments.attempts.length, 0);
  const retried = await f.call(`/sets/${set.id}/submit`, {}); assert.equal(retried.status, 200); assert.equal(retried.body.set.report.items[1].status, 'incorrect'); assert.equal(f.state.assessments.attempts.length, 2);
});
test('out-of-order draft writes cannot overwrite a newer answer; stale final submissions are rejected', async t => {
  const f = await fixture(t), set = await f.create(['q1']);
  await f.call(`/sets/${set.id}/draft`, { revision: 3, answers: { q1: answer('B') } });
  await f.call(`/sets/${set.id}/draft`, { revision: 2, answers: { q1: answer('A') } });
  assert.equal((await f.call('/sets?courseId=math&mode=understanding')).body.set.answers.q1.answer, 'B');
  assert.equal((await f.call(`/sets/${set.id}/submit`, { revision: 2, answers: { q1: answer('A') } })).status, 409);
});
test('AI validation failure, low-confidence subjective results and offline recall have explicit outcomes', async t => {
  const invalid = await fixture(t, { review: async () => ({ summary: 'bad', recommendations: [], items: [] }) });
  const a = await invalid.create(['q1']); assert.equal((await invalid.call(`/sets/${a.id}/submit`, { revision: 0, answers: { q1: answer() } })).status, 502); assert.equal(invalid.state.assessments.attempts.length, 0);
  const low = await fixture(t, { review: async () => ({ summary: '待核对', recommendations: ['核对原文'], items: [{ questionId: 'q2', status: 'correct', confidence: 0.4, feedback: '可能符合', explanation: '结合原文确认', steps: ['核对条件'] }] }) });
  const b = await low.create(['q2']); assert.equal((await low.call(`/sets/${b.id}/submit`, { revision: 0, answers: { q2: answer('推导') } })).body.set.report.items[0].status, 'ungraded'); assert.equal(low.state.courses[0].mastery, 0);
  const offline = await fixture(t, { configured: false }), c = await offline.create(['q1'], 'recall');
  assert.equal((await offline.call(`/sets/${c.id}/submit`, { revision: 0, answers: { q1: answer() } })).body.set.report.mode, 'source'); assert.equal(offline.modelCalls(), 0);
});
test('source revisions and cross-course IDs are rejected without recording attempts', async t => {
  const f = await fixture(t), set = await f.create(['q1']); f.questions[0].sourceRevision++;
  assert.equal((await f.call(`/sets/${set.id}/submit`, { revision: 0, answers: { q1: answer() } })).status, 409);
  assert.equal((await f.call('/sets', { courseId: 'other', mode: 'understanding', questionIds: ['q1'] })).status, 409); assert.equal(f.modelCalls(), 0);
});
test('concurrent submission is locked; malformed answers and duplicate IDs cannot create partial records', async t => {
  let release, entered; const ready = new Promise(r => { entered = r; }); const gate = new Promise(r => { release = r; });
  const f = await fixture(t, { review: async payload => { entered(); await gate; return { summary: '完成', recommendations: ['核对'], items: payload.questions.map(q => ({ questionId: q.id, status: 'correct', confidence: 1, feedback: '符合', explanation: '详细解释', steps: ['核对原文'] })) }; } });
  assert.equal((await f.call('/sets', { courseId: 'math', mode: 'recall', questionIds: ['q1', 'q1'] })).status, 400);
  const set = await f.create(['q1']); const pending = f.call(`/sets/${set.id}/submit`, { revision: 0, answers: { q1: answer() } }); await ready;
  assert.equal((await f.call(`/sets/${set.id}/submit`, {})).status, 409); release(); assert.equal((await pending).status, 200); assert.equal(f.modelCalls(), 1);
});
test('save failure rolls back reports, attempts and mastery together', async t => {
  const f = await fixture(t), set = await f.create(['q1']); f.failSave();
  assert.equal((await f.call(`/sets/${set.id}/submit`, { revision: 0, answers: { q1: answer() } })).status, 500);
  assert.equal(f.state.practiceSessions[0].status, 'draft'); assert.equal(f.state.assessments.attempts.length, 0); assert.equal(f.state.courses[0].mastery, 0);
});
test('a failure at the final report save never exposes an unpersisted report; retry counts once', async t => {
  const f = await fixture(t), set = await f.create(['q1']); f.failSave(3);
  const result = await f.call(`/sets/${set.id}/submit`, { revision: 1, answers: { q1: answer() } });
  assert.equal(result.status, 500); assert.equal(result.body.set.status, 'review-failed'); assert.equal(result.body.set.report, undefined);
  assert.equal(f.state.practiceSessions[0].answers.q1.answer, 'B'); assert.equal(f.state.assessments.attempts.length, 0); assert.equal(f.state.courses[0].mastery, 0);
  assert.equal((await f.call(`/sets/${set.id}/submit`, {})).status, 200); assert.equal(f.state.assessments.attempts.length, 1); assert.equal(f.state.courses[0].mastery, 1);
});
