import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLessonOverview, mergeLessonExamples } from '../server/lesson-overview.mjs';

const provider = { baseUrl: 'https://api.deepseek.com/v1', model: 'test-model', apiKey: 'private-sentinel-key' };
const overview = ['左、右导数分别从两个方向的差商极限定义。', '一点可导的条件是左右导数存在且相等。', '绝对值函数在零处的左右导数不相等，故不可导。', '闭区间端点分别考察朝区间内侧的单侧导数。'];
const response = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } });
const chapters = [{ title: '定义', text: '左右导数通过差商的单侧极限定义。' }, { title: '条件', text: '可导等价于左右导数存在且相等。' }, { title: '课尾边界', text: '闭区间左端点看右导数，右端点看左导数。' }];

test('whole-course overview includes every chapter within a balanced input budget and DeepSeek JSON settings', async () => {
  let body;
  const sources = Array.from({ length: 24 }, (_, index) => ({ title: `主题${index}`, text: `开头${index} ` + '知识内容'.repeat(1800) + ` 中段${index} ` + '后续内容'.repeat(1800) + ` 末尾${index}` }));
  const result = await summarizeLessonOverview(provider, sources, { fetchImpl: async (url, options) => {
    assert.equal(url.toString(), 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer private-sentinel-key');
    body = JSON.parse(options.body);
    const data = JSON.parse(body.messages[1].content.split('\n').slice(1).join('\n'));
    assert.equal(data.length, 24);
    assert.ok(JSON.stringify(data).length <= 20000);
    for (let index = 0; index < 24; index++) {
      assert.equal(data[index].title, `主题${index}`);
      assert.ok(data[index].text.includes(`开头${index}`));
      assert.ok(data[index].text.includes(`末尾${index}`));
    }
    return response({ overview });
  } });
  assert.deepEqual(result, overview);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.doesNotMatch(body.messages.map(item => item.content).join(''), /private-sentinel-key/);
});

test('local compatible models need no key and source metadata is excluded from learning facts', async () => {
  await summarizeLessonOverview({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'local' }, [...chapters, { title: '语音转写来源说明', text: '来源处理说明不应混入学习要点。' }], { fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(body.thinking, undefined); assert.equal(body.response_format, undefined);
    assert.doesNotMatch(body.messages[1].content, /语音转写来源说明/);
    assert.match(body.messages[1].content, /课尾边界/);
    return response({ overview });
  } });
});

test('bad summaries fail explicitly instead of leaking metadata, long text or pretending to succeed', async () => {
  for (const value of [
    { overview: overview.slice(0, 2) }, { overview: [...overview, '第5条。', '第6条。'] },
    { overview: ['本块讨论导数。', ...overview.slice(1)] },
    { overview: ['考试范围仅作为组织参考。', ...overview.slice(1)] },
    { overview: ['字'.repeat(161), ...overview.slice(1)] },
    { overview: [overview[0], overview[0], overview[2]] },
    { overview: ['private-sentinel-key', ...overview.slice(1)] },
  ]) await assert.rejects(summarizeLessonOverview(provider, chapters, { fetchImpl: async () => response(value) }), error => {
    assert.doesNotMatch(error.message, /private-sentinel-key/); return true;
  });
  await assert.rejects(summarizeLessonOverview(provider, chapters, { fetchImpl: async () => new Response('private-sentinel-key', { status: 401 }) }), /HTTP 401/);
  await assert.rejects(summarizeLessonOverview(provider, chapters, { fetchImpl: async () => { throw Object.assign(new Error('速览模型private-sentinel-key'), { status: 502 }); } }), error => {
    assert.doesNotMatch(error.message, /private-sentinel-key/); return true;
  });
});

test('response streaming limits and abort/timeout end even a non-cooperative fetch', async () => {
  await assert.rejects(summarizeLessonOverview(provider, chapters, { fetchImpl: async () => new Response('x'.repeat(64 * 1024 + 1)) }), /过大/);
  const controller = new AbortController(); controller.abort(new Error('private-sentinel-key'));
  let started = false;
  await assert.rejects(summarizeLessonOverview(provider, chapters, { signal: controller.signal, fetchImpl: async () => { started = true; return response({ overview }); } }), /已取消/);
  assert.equal(started, false);
  // A normal timer keeps the test process alive while AbortSignal.timeout is unref'd.
  const keeper = setTimeout(() => {}, 500);
  try { await assert.rejects(summarizeLessonOverview(provider, chapters, { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }), /超时/); }
  finally { clearTimeout(keeper); }
});

test('certain absolute-value duplicates merge references and preserve the only existing full solution', () => {
  const examples = [
    { id: 'a', title: 'y=|x| 在 x=0 处的左右导数与可导性', prompt: '讨论 y=|x| 在 0 处的左导数、右导数，并判断是否可导。', solution: '板书给出右导数1、左导数-1；不相等，故不可导。', cueIds: ['c1'], frameIds: ['f1'], needsReview: true },
    { id: 'b', title: 'y=|x| 在 x=0 处的左右导数', prompt: '讨论函数在 x=0 的单侧导数。', solution: '', cueIds: ['c2'] },
    { id: 'c', title: 'y=|x|在x=0处的左右导数（板书标注）', prompt: '板书给出右导数1、左导数-1，未给完整推导。', solution: '', cueIds: ['c3', 'c1'], frameIds: ['f2'] },
  ];
  const original = structuredClone(examples);
  const result = mergeLessonExamples(examples);
  assert.equal(result.length, 1);
  assert.equal(result[0].solution, examples[0].solution);
  assert.equal(result[0].prompt, examples[0].prompt);
  assert.deepEqual(result[0].cueIds, ['c1', 'c2', 'c3']);
  assert.deepEqual(result[0].frameIds, ['f1', 'f2']);
  assert.deepEqual(examples, original);
});

test('different point values and generic titles with different prompt numbers never merge', () => {
  const example = (title, prompt, solution = '') => ({ title, prompt, solution, cueIds: [] });
  assert.equal(mergeLessonExamples([
    example('y=|x| 在 x=0 处的左右导数', '求左右导数'),
    example('y=|x| 在 x=1 处的左右导数', '求左右导数'),
  ]).length, 2);
  assert.equal(mergeLessonExamples([
    example('函数在指定点的导数', 'x=1.00000000000000001'),
    example('函数在指定点的导数', 'x=1.00000000000000002'),
  ]).length, 2);
  assert.equal(mergeLessonExamples([
    example('绝对值函数的左右导数', '求 x=0 处的左右导数'),
    example('绝对值函数的左右导数', '求 x=1 处的左右导数'),
  ]).length, 2);
  assert.equal(mergeLessonExamples([
    example('函数定义（在x=0）', '讨论原函数'),
    example('函数定义（在x=1）', '讨论原函数'),
  ]).length, 2);
  const merged = mergeLessonExamples([example('同一道原课例题', '条件相同', '原解。'), example('同一道原课例题', '条件相同', '原有更完整的解答。')]);
  assert.equal(merged[0].solution, '原有更完整的解答。');
});

test('duplicate merging retains supplementary solutions and steps in either arrival order', () => {
  const plain = { title: '同一道原课题', prompt: '判断y=x²的单调性', solution: '', cueIds: ['cue-a'] };
  const detailed = { ...plain, cueIds: ['cue-b'], detailedSolution: '在(-∞,0]上递减，在[0,+∞)上递增。', solutionSteps: ['分左右区间比较'], solutionOrigin: 'ai-supplement' };
  const before = structuredClone([plain, detailed]);
  for (const inputs of [[plain, detailed], [detailed, plain]]) {
    const result = mergeLessonExamples(inputs); assert.equal(result.length, 1);
    assert.equal(result[0].detailedSolution, detailed.detailedSolution); assert.deepEqual(result[0].solutionSteps, detailed.solutionSteps);
    assert.equal(result[0].solutionOrigin, 'ai-supplement'); assert.deepEqual(new Set(result[0].cueIds), new Set(['cue-a', 'cue-b']));
  }
  assert.deepEqual([plain, detailed], before);
});
