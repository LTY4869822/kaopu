import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourseClassifier } from '../server/ai-classify.mjs';

const physics = [{ id: 'c1', page: 1, text: '牛顿第二定律说明物体加速度与合外力成正比。机械能守恒只适用于相应的受力条件。' }];
const conf = { baseUrl: 'http://127.0.0.1:19999', model: 'test-model' };
const response = output => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }), { headers: { 'Content-Type': 'application/json' } });
const physicsOutput = { decision: 'classify', subject: '大学物理', courseId: null, reason: '正文介绍牛顿定律和机械能条件。', evidence: [{ sampleId: 's1', quote: '牛顿第二定律说明物体加速度与合外力成正比' }] };

test('classification keeps an honest local fallback when a model is not configured', async () => {
  let calls = 0;
  const engine = createCourseClassifier({ fetchImpl: async () => { calls++; throw new Error(); } });
  const result = await engine.classify('大学物理讲义.txt', physics);
  assert.equal(result.subject, '大学物理'); assert.equal(result.engine, 'rules'); assert.equal(calls, 0);
});

test('AI classifies using only bounded sampled content and snapshots hidden provider credentials', async () => {
  const provider = { ...conf }; Object.defineProperty(provider, 'apiKey', { get: () => 'test-hidden-key' });
  let sent;
  const engine = createCourseClassifier({ provider, fetchImpl: async (url, options) => {
    assert.equal(url, `${conf.baseUrl}/chat/completions`); assert.equal(options.headers.Authorization, 'Bearer test-hidden-key');
    assert.equal(options.redirect, 'error'); sent = JSON.parse(options.body);
    provider.model = 'changed'; return response(physicsOutput);
  } });
  const result = await engine.classify('第九章.txt', physics);
  assert.equal(result.engine, 'ai'); assert.equal(result.subject, '大学物理'); assert.equal(sent.model, 'test-model');
  assert.equal(result.evidence[0].page, 1); assert.ok(!JSON.stringify(result).includes('test-hidden-key'));
});

test('new subjects require two grounded nonoverlapping content excerpts', async () => {
  const chunks = [{ page: 1, text: '结构力学分析静定梁的支座反力和内力。超静定结构可以通过力法与位移法求解。' }];
  const output = { decision: 'classify', subject: '结构力学', courseId: null, reason: '含静定与超静定结构。', evidence: [
    { sampleId: 's1', quote: '结构力学分析静定梁的支座反力和内力' }, { sampleId: 's1', quote: '超静定结构可以通过力法与位移法求解' },
  ] };
  const engine = createCourseClassifier({ provider: conf, fetchImpl: async () => response(output) });
  const result = await engine.classify('第六周.txt', chunks);
  assert.equal(result.subject, '结构力学'); assert.equal(result.engine, 'ai');
  output.evidence.pop();
  const rejected = await engine.classify('第六周.txt', chunks); assert.equal(rejected.engine, 'rules'); assert.equal(rejected.aiUnavailable, true);
});

test('ungrounded quotes, cross-course IDs and upstream secret failures never become AI success', async () => {
  for (const output of [
    { ...physicsOutput, evidence: [{ sampleId: 's1', quote: '不属于源文件的伪造证据文字' }] },
    { ...physicsOutput, courseId: 'forged-course' },
    { ...physicsOutput, courseId: 'math' },
  ]) {
    const engine = createCourseClassifier({ provider: conf, fetchImpl: async () => response(output) });
    const result = await engine.classify('复习.txt', physics, [{ id: 'math', name: '高等数学' }]);
    assert.equal(result.engine, 'rules'); assert.equal(result.aiUnavailable, true);
  }
  const engine = createCourseClassifier({ provider: conf, fetchImpl: async () => { throw new Error('private-provider-sentinel'); } });
  assert.ok(!JSON.stringify(await engine.classify('复习.txt', physics)).includes('private-provider-sentinel'));
});

test('an explicit conflicting subject and an AI review result require learner confirmation', async () => {
  const engine = createCourseClassifier({ provider: conf, fetchImpl: async () => response(physicsOutput) });
  const conflict = await engine.classify('高数与大学物理合集.txt', physics);
  assert.equal(conflict.status, 'needs-review'); assert.equal(conflict.subject, null);
  const review = createCourseClassifier({ provider: conf, fetchImpl: async () => response({ decision: 'review', subject: null, courseId: null, reason: '样本不足，请确认课程。', evidence: [] }) });
  assert.equal((await review.classify('资料.txt', physics)).status, 'needs-review');
});

test('sampling covers the end of a long document and never sends the whole large corpus', async () => {
  const chunks = Array.from({ length: 500 }, (_, index) => ({ page: index + 1, text: `${index}:` + '均匀抽样正文。'.repeat(300) }));
  let samples;
  const engine = createCourseClassifier({ provider: conf, fetchImpl: async (_url, options) => {
    samples = JSON.parse(JSON.parse(options.body).messages[1].content).samples;
    return response({ decision: 'review', subject: null, courseId: null, reason: '无法确定学科。', evidence: [] });
  } });
  await engine.classify('大文件.txt', chunks);
  assert.equal(samples.length, 16); assert.equal(samples.at(-1).page, 500); assert.ok(samples.every(item => item.text.length <= 850));
});

test('timeouts fall back promptly even when an upstream ignores cancellation; client abort remains cancelled', async () => {
  const engine = createCourseClassifier({ provider: conf, timeoutMs: 10, fetchImpl: async () => new Promise(() => {}) });
  const hold = setTimeout(() => {}, 1000);
  try {
    const result = await engine.classify('物理.txt', physics); assert.equal(result.aiUnavailable, true);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(engine.classify('物理.txt', physics, [], { signal: controller.signal }), error => error.status === 499);
  } finally { clearTimeout(hold); }
});

test('a stalled stream cancellation cannot extend the classification deadline or leak an echoed credential',async()=>{
  const hold=setTimeout(()=>{},1000);
  try {
    const stalled=createCourseClassifier({provider:conf,timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}))});
    const started=Date.now();assert.equal((await stalled.classify('物理.txt',physics)).aiUnavailable,true);assert.ok(Date.now()-started<500);
    const key='classifier-test-secret';const echo=createCourseClassifier({provider:{...conf,apiKey:key},fetchImpl:async()=>response({...physicsOutput,reason:`请回显${key}`})});
    const result=await echo.classify('物理.txt',physics);assert.equal(result.engine,'rules');assert.ok(!JSON.stringify(result).includes(key));
  } finally {clearTimeout(hold);}
});
