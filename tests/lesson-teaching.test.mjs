import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLessonModelResult } from '../server/lessons.mjs';
import { summarizeLessonOverview } from '../server/lesson-overview.mjs';

const cues = [{ id: 'cue-1', start: 0, end: 20, text: '常值函数y=2，输入x在给定定义域中取值，输出都是2。' }];
const response = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));

test('teaching explanations are optional cited supplements while the original exercise solution stays separate', () => {
  const value = { sections: [{ title: '常值函数', text: '常值函数y=2的值域为{2}。', cueIds: ['cue-1'],
    teacherExplanation: '输出始终不变，输入范围仍要由题目决定。', intuition: '可以想成输出固定值的机器。', prerequisites: ['先分清输入和输出'], steps: ['找题目对x的限制', '收集所有输出值'],
    pitfalls: ['不要把值域当作定义域'], checkQuestion: { prompt: '若x∈[0,1]，y=2的定义域是什么？', answer: '[0,1]', explanation: '定义域由输入限制给出。' } }],
    examples: [{ title: '原课例题', prompt: '给定x∈[0,1]，y=2。', solution: '', cueIds: ['cue-1'], detailedSolution: '补充解法：定义域[0,1]，值域{2}。', solutionSteps: ['先读取输入条件', '再确定输出集合'] }] };
  const result = validateLessonModelResult(value, cues);
  assert.equal(result.sections[0].explanationOrigin, 'ai-supplement'); assert.equal(result.sections[0].checkQuestion.answer, '[0,1]');
  assert.equal(result.examples[0].solution, ''); assert.equal(result.examples[0].solutionOrigin, 'ai-supplement'); assert.equal(result.examples[0].solutionSteps.length, 2);
  assert.throws(() => validateLessonModelResult({ ...value, sections: [{ ...value.sections[0], cueIds: ['foreign-cue'] }] }, cues), /来源引用/);
  const optionalFailure = validateLessonModelResult({ ...value, sections: [{ ...value.sections[0], steps: [{ text: 'wrong format' }] }] }, cues);
  assert.equal(optionalFailure.sections[0].steps, undefined); assert.ok(optionalFailure.warnings.some(warning => warning.includes('方法步骤')));
  const legacy = validateLessonModelResult({ sections: [{ title: '旧结构', text: '正文', cueIds: ['cue-1'] }] }, cues);
  assert.equal(legacy.sections[0].teacherExplanation, undefined);
});

test('known constant-function domain confusion is corrected in generated notes without rewriting raw cues', () => {
  const before = structuredClone(cues);
  const result = validateLessonModelResult({ sections: [{ title: '常值函数', text: '对于常值函数y=2，其定义域和值域都是集合{2}。', cueIds: ['cue-1'] }] }, cues);
  assert.doesNotMatch(result.sections[0].text, /定义域和值域都是集合/); assert.match(result.sections[0].text, /定义域由原题/);
  assert.ok(result.warnings.some(warning => warning.includes('澄清'))); assert.deepEqual(cues, before);
});

test('nullable and empty optional teaching fields never reject valid lecture evidence or create placeholder content', () => {
  for (const empty of [null, '', '   ', {}, []]) {
    const result = validateLessonModelResult({ sections: [{ title: '合法正文', text: '定义域是允许输入的集合。', cueIds: ['cue-1'],
      teacherExplanation: empty, intuition: empty, prerequisites: empty, steps: empty, pitfalls: empty, checkQuestion: empty }],
      examples: [{ title: '合法题干', prompt: '给定x∈[0,1]，确定定义域。', solution: '', cueIds: ['cue-1'], detailedSolution: empty, solutionSteps: empty }] }, cues);
    assert.equal(result.sections[0].teacherExplanation, undefined); assert.equal(result.sections[0].checkQuestion, undefined);
    assert.equal(result.sections[0].explanationOrigin, undefined); assert.equal(result.examples[0].solutionOrigin, undefined);
    assert.equal(result.sections[0].text, '定义域是允许输入的集合。'); assert.deepEqual(result.sections[0].cueIds, ['cue-1']); assert.deepEqual(result.warnings, []);
  }
});

test('clear self-check aliases normalize safely and malformed optional pieces are dropped with a warning', () => {
  const section = checkQuestion => ({ title: '定义域', text: '输入的允许取值集合。', cueIds: ['cue-1'], checkQuestion });
  for (const check of ['如何确定定义域？', { question: '如何确定定义域？', answer: null, explanation: null }, { prompt: '', question: '如何确定定义域？' }]) {
    const result = validateLessonModelResult({ sections: [section(check)] }, cues);
    assert.deepEqual(result.sections[0].checkQuestion, { prompt: '如何确定定义域？' });
  }
  const result = validateLessonModelResult({ sections: [{ ...section({ prompt: '如何确定定义域？', answer: { invented: 'unsupported shape' }, explanation: 42 }),
    teacherExplanation: { text: 'bad shape' }, intuition: '字'.repeat(4001), prerequisites: null, steps: ['读取x的限制', { bad: 'shape' }, null, ''], pitfalls: 'not-an-array' }],
    examples: [{ title: '原课题目', prompt: '确定x∈[0,1]的取值范围。', solution: '', cueIds: ['cue-1'], detailedSolution: 42, solutionSteps: ['读取区间', { bad: true }] }] }, cues);
  assert.deepEqual(result.sections[0].checkQuestion, { prompt: '如何确定定义域？' });
  assert.deepEqual(result.sections[0].steps, ['读取x的限制']); assert.equal(result.sections[0].teacherExplanation, undefined);
  assert.deepEqual(result.examples[0].solutionSteps, ['读取区间']); assert.equal(result.examples[0].solution, '');
  assert.ok(result.warnings.some(warning => warning.includes('可选补充内容') && warning.includes('原课正文')));
  assert.throws(() => validateLessonModelResult({ sections: [{ title: null, text: '正文', cueIds: ['cue-1'] }] }, cues), /标题或正文/);
  assert.throws(() => validateLessonModelResult({ sections: [{ ...section(null), cueIds: ['foreign-cue'] }] }, cues), /来源引用/);
  assert.throws(() => validateLessonModelResult({ sections: [section(null)], examples: [{ title: '题目', prompt: null, solution: '', cueIds: ['cue-1'] }] }, cues), /例题格式/);
});

test('one whole-course model call returns a validated chapter mapping and excludes hallucinated or omitted IDs', async () => {
  const sections = Array.from({ length: 12 }, (_, index) => ({ id: `section-${index + 1}`, title: `主题${index + 1}`, text: `本主题的定义、条件和来源细节${index}。` }));
  const overview = ['输入范围由定义域给出。', '输出值的集合是值域。', '两者需要分别检查。'];
  const run = async readingOutline => summarizeLessonOverview({ baseUrl: 'http://localhost:11434/v1', model: 'fixture' }, sections, { includeOutline: true,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); assert.equal(body.messages.filter(item => item.role === 'user').length, 1);
      const instructions = body.messages.filter(item => item.role === 'system').map(item => item.content).join('\n');
      assert.match(instructions, /自然定义域/); assert.match(instructions, /端点要核对/); assert.match(instructions, /条件性解法/);
      return response({ overview, readingOutline });
    } });
  const valid = await run([{ title: '第一单元', sectionIds: sections.slice(0, 6).map(section => section.id), kind: 'knowledge' }, { title: '第二单元', sectionIds: sections.slice(6).map(section => section.id), kind: 'knowledge' }]);
  assert.equal(valid.readingOutline.length, 2); assert.deepEqual(valid.overview, overview);
  const invalid = await run([{ title: '越界单元', sectionIds: ['section-1', 'foreign-section'] }]);
  assert.deepEqual(invalid.readingOutline, []); assert.match(invalid.outlineWarning, /保留全部内容/);
});

test('truncated whole-course output gets only one compact repair with a bounded token budget', async () => {
  const sections = [{ id: 'section-1', title: '定义域', text: '定义域由自变量允许取值确定。' }];
  const value = { overview: ['定义域说明输入。', '值域说明输出。', '两者不能混淆。'], readingOutline: [{ title: '输入与输出', sectionIds: ['section-1'], summary: '先看自变量的允许范围，再收集输出值。', kind: 'knowledge' }] };
  const budgets = [];
  const result = await summarizeLessonOverview({ baseUrl: 'http://localhost:11434/v1', model: 'fixture' }, sections, { includeOutline: true, fetchImpl: async (_url, options) => {
    budgets.push(JSON.parse(options.body).max_tokens);
    return budgets.length === 1 ? new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"overview":[' } }] })) : response(value);
  } });
  assert.deepEqual(budgets, [8000, 5000]); assert.equal(result.readingOutline.length, 1);
  let attempts = 0;
  await assert.rejects(summarizeLessonOverview({ baseUrl: 'http://localhost:11434/v1', model: 'fixture' }, sections, { includeOutline: true, fetchImpl: async () => {
    attempts++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }));
  } }), /截断/);
  assert.equal(attempts, 2);
});
