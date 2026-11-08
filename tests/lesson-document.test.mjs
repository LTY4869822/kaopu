import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadingSections, decorateLessonNotes, auditMathExplanation, normalizeConstantFunctionClaim } from '../server/lesson-document.mjs';

const section = (id, title, value, cueIds = [id], extra = {}) => ({ id, title, text: value, cueIds, inScope: null, ...extra });
const notesFor = (sections, extra = {}) => ({ mode: 'ai', sections, examples: [], overview: [], warnings: [], coverage: { cueCount: 10, processedCueCount: 10, visual: false }, createdAt: '2026-11-05', ...extra });
const originalIds = sections => sections.map(item => item.id).sort();

test('reading projection combines certain repeated text and retains every original source and teaching field', () => {
  const input = [
    section('s1', '有界性', '在指定区间存在统一的界。', ['c1'], { frameIds: ['f1'], prerequisites: ['绝对值'], steps: ['先指定区间'], teacherExplanation: '先明确考察范围。', explanationOrigin: 'ai-supplement' }),
    section('s2', '定义域', '定义域由自变量允许取值组成。', ['c2']),
    section('s3', '有界性', '在指定区间存在统一的界。', ['c3', 'c1'], { frameIds: ['f2'], pitfalls: ['不能忽略区间'], checkQuestion: { prompt: '区间改变会怎样？', answer: '需要重新判断。' } }),
  ];
  const before = structuredClone(input), result = buildReadingSections(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, input[0].text);
  assert.deepEqual(result[0].cueIds, ['c1', 'c3']);
  assert.deepEqual(result[0].frameIds, ['f1', 'f2']);
  assert.deepEqual(result[0].sourceSectionIds, ['s1', 's3']);
  assert.equal(result[0].subsections.length, 2);
  assert.equal(result[0].teacherExplanation, input[0].teacherExplanation);
  assert.deepEqual(result[0].pitfalls, ['不能忽略区间']);
  assert.equal(result[0].checkQuestion.answer, '需要重新判断。');
  assert.deepEqual(input, before);
});

test('validated whole-course mapping controls reading order, while every source maps exactly once', () => {
  const sections = [section('a', '定义', '定义原文'), section('b', '方法', '方法原文'), section('c', '比较', '比较原文'), section('d', '课间安排', '休息十分钟')];
  const outline = [{ title: '从定义理解方法', sectionIds: ['a', 'b'], summary: '先理解再应用。' }, { title: '比较与边界', sectionIds: ['c'] }, { title: '课间安排', kind: 'appendix', sectionIds: ['d'] }];
  const result = decorateLessonNotes(notesFor(sections, { readingOutline: outline }));
  assert.deepEqual(result.readingSections.map(item => item.title), ['从定义理解方法', '比较与边界']);
  assert.equal(result.readingSections[0].summary, '先理解再应用。');
  assert.equal(result.readingSections[0].text, '先理解再应用。');
  assert.deepEqual(result.readingSections[0].subsections.map(item => item.text), ['定义原文', '方法原文']);
  assert.deepEqual(originalIds(result.readingAppendix), ['d']);
  assert.deepEqual([...result.readingSections.flatMap(item => item.sourceSectionIds), ...originalIds(result.readingAppendix)].sort(), originalIds(sections));
  assert.deepEqual(result.readingWarnings, []);
});

test('invalid, partial or duplicate outline mappings fall back with a visible warning and no lost sections', () => {
  const sections = [section('a', '知识甲', '甲'), section('b', '知识乙', '乙')];
  for (const outline of [[{ title: '一', sectionIds: ['a'] }], [{ title: '一', sectionIds: ['a', 'b', 'b'] }], [{ title: '一', sectionIds: ['a', 'missing'] }]]) {
    const result = decorateLessonNotes(notesFor(sections, { readingOutline: outline }));
    assert.equal(result.readingWarnings.length, 1);
    assert.deepEqual(result.readingSections.flatMap(item => item.sourceSectionIds).sort(), ['a', 'b']);
  }
});

test('function curriculum fallback groups many fragments into a compact topic directory without deleting distinct conditions', () => {
  const titles = ['函数的概念与记号', '定义域及其记号', '值域及其记号', '常值函数的定义域与值域', '绝对值函数y=|x|', '符号函数的定义', '取整函数的定义', '上界的定义', '下界的定义', '有界性须指明所在范围', '无界性的定义', '单调性的定义', '单调性必须指明区间', '奇偶性的前提', '偶函数与奇函数的定义', '周期性的定义', '并非每个周期函数都有最小正周期', '反函数的定义', '横线法则', '复合函数的定义与中间变量', '复合函数成立的条件', '函数乘法运算', '函数除法运算及定义域条件', '函数分解为偶函数与奇函数之和', '来源说明：画面事实与信息缺口', '课堂闲谈：考试与高考成绩'];
  const sections = titles.flatMap((title, index) => [section(`s${index}-a`, title, `原文条件${index}：在(0,1)讨论。`), section(`s${index}-b`, title, `原文条件${index}：在[1,2]讨论。`)]);
  const result = decorateLessonNotes(notesFor(sections));
  assert.ok(result.readingSections.length >= 8 && result.readingSections.length <= 15);
  assert.equal(result.readingAppendix.length, 4);
  assert.deepEqual([...result.readingSections.flatMap(item => item.sourceSectionIds), ...originalIds(result.readingAppendix)].sort(), originalIds(sections));
  const allText = result.readingSections.map(item => item.text).join('\n');
  assert.match(allText, /在\(0,1\)讨论/); assert.match(allText, /在\[1,2\]讨论/);
});

test('other subjects do not receive an invented mathematics curriculum or arbitrary hard truncation', () => {
  const sections = Array.from({ length: 26 }, (_, index) => section(`s${index}`, `历史事件${index}`, `事件原文${index}`));
  const result = buildReadingSections(sections);
  assert.equal(result.length, 26);
  assert.deepEqual(result.flatMap(item => item.sourceSectionIds), sections.map(item => item.id));
  assert.equal(result.at(-1).text, '事件原文25');
});

test('high-confidence display duplicates keep the complete longer statement while preserving original subsections', () => {
  const original = '讨论函数是否有界时应先指定考察区间，再寻找能够同时约束该区间上所有函数值的统一常数。判断过程中始终保留原题的区间限制，避免把不同范围上的结论混在一起。';
  const expanded = `大家注意，${original}`;
  const source = [section('a', '有界性', original, ['c1']), section('b', '有界性', expanded, ['c2'])];
  const [result] = buildReadingSections(source);
  assert.equal(result.text, expanded);
  assert.equal(result.subsections.length, 2); assert.deepEqual(result.cueIds, ['c1', 'c2']);
  assert.equal(result.subsections[0].text, original);
});

test('similar-looking mathematical content with changed numbers, operators, conditions or formulas remains displayed', () => {
  const prose = '这个结论的使用必须保留原题条件。我们逐步比较函数在指定范围内的输出，检查题干给出的限制，最后以集合形式写出结果，并核对边界是否包含。';
  const values = [`${prose}x∈(0,1)，f(x)>0。`, `${prose}x∈(0,1]，f(x)>0。`, `${prose}x∈(0,1)，f(x)≥0。`, `${prose}x∈(0,2)，f(x)>0。`, `${prose}x∈(0,1)，f(x)不连续。`, `${prose}x∈(0,1)，f(x)连续。`];
  const [result] = buildReadingSections(values.map((value, index) => section(`s${index}`, '判断方法', value)));
  for (const value of values) assert.ok(result.text.includes(value));
  assert.equal(result.subsections.length, values.length);
});

test('frame evidence maps through actual cue/frame IDs, keeps original references, and never guesses the nearest frame', () => {
  const source = notesFor([section('s1', '方法', '原文', ['c1', 'visual-frame-2', 'legacy-unknown'], { frameIds: ['f0'] })]);
  source.examples = [{ id: 'e1', title: '题一', prompt: '求函数的性质。', solution: '原课解法', cueIds: ['c1'], needsReview: false }];
  const lesson = { cues: [{ id: 'c1', text: '原文', start: 10, frameId: 'f1' }], visual: { frames: [{ id: 'f1', time: 10 }, { id: 'frame-2', time: 11 }, { id: 'nearby', time: 10.1 }] } };
  const result = decorateLessonNotes(source, lesson);
  assert.deepEqual(result.readingSections[0].frameIds, ['f0', 'f1', 'frame-2']);
  assert.deepEqual(result.readingSections[0].cueIds, ['c1', 'visual-frame-2', 'legacy-unknown']);
  assert.deepEqual(result.readingExamples[0].frameIds, ['f1']);
  assert.ok(!result.readingExamples[0].frameIds.includes('nearby'));
});

test('reading examples deduplicate only certain copies, preserve every original solution and all supplementary steps', () => {
  const examples = [
    { id: 'e1', title: '绝对值函数在x=0处的左右导数', prompt: '求 y=|x| 在 x=0 处的左右导数。', solution: '左导数为-1。', cueIds: ['c1'], frameIds: ['f1'], detailedSolution: '从差商出发。', solutionSteps: ['分左右讨论'], solutionOrigin: 'ai-supplement' },
    { id: 'e2', title: '绝对值函数在x=0处的左右导数（板书）', prompt: '求 y=|x| 在 x=0 处的左右导数。', solution: '右导数为1，所以不可导。', cueIds: ['c2'], frameIds: ['f2'], solutionSteps: ['比较两个极限'], needsReview: true },
  ];
  const input = notesFor([], { examples }), before = structuredClone(input);
  const result = decorateLessonNotes(input);
  assert.equal(result.readingExamples.length, 1);
  const example = result.readingExamples[0];
  assert.deepEqual(example.sourceExampleIds, ['e1', 'e2']);
  assert.match(example.solution, /左导数为-1/); assert.match(example.solution, /右导数为1/);
  assert.deepEqual(example.frameIds, ['f1', 'f2']);
  assert.deepEqual(example.solutionSteps, ['分左右讨论', '比较两个极限']);
  assert.equal(example.solutionOrigin, 'ai-supplement'); assert.equal(example.needsReview, true);
  assert.deepEqual(input, before); assert.deepEqual(result.examples, examples);
});

test('different points, precise decimals, formulas and domain boundaries never become one example', () => {
  const examples = [
    ['在x=0处的导数', '求导数。'], ['在x=1处的导数', '求导数。'],
    ['函数在指定点的导数', 'x=1.00000000000000001'], ['函数在指定点的导数', 'x=1.00000000000000002'],
    ['在(0,1)上的有界性', '判断有界性。'], ['在[0,1]上的有界性', '判断有界性。'],
    ['y=x²的性质', '判断性质。'], ['y=x2的性质', '判断性质。'],
    ['在(1,23)上的有界性', '判断有界性。'], ['在(12,3)上的有界性', '判断有界性。'],
    ['函数F的性质', '讨论F的性质。'], ['函数f的性质', '讨论f的性质。'],
  ].map(([title, prompt], index) => ({ id: `e${index}`, title, prompt, solution: '', cueIds: [`c${index}`] }));
  assert.equal(decorateLessonNotes(notesFor([], { examples })).readingExamples.length, examples.length);
});

test('the known constant-function domain mistake is corrected in derived text without assuming R', () => {
  for (const claim of ['常值函数y=2的定义域与值域均为{2}。', '对于常值函数y=2，其定义域和值域都是集合{2}。']) {
    assert.equal(auditMathExplanation(claim).needsReview, true);
    const result = normalizeConstantFunctionClaim(claim, '给定自变量范围为[0,1]。');
    assert.match(result, /值域在非空定义域上为\{2\}/);
    assert.match(result, /定义域由原题对自变量的限制确定/);
    assert.doesNotMatch(result, /定义域.{0,5}(?:实数|R|ℝ)/);
    assert.equal(auditMathExplanation(result).needsReview, false);
  }
});

test('a genuinely singleton supplied domain is not rewritten and unrelated functions are untouched', () => {
  const valid = '常值函数y=2的定义域与值域均为{2}。';
  assert.equal(normalizeConstantFunctionClaim(valid, '题目指定定义域为{2}，求y=2的值域。'), valid);
  assert.equal(auditMathExplanation(valid, 'x∈{2}，y=2。').needsReview, false);
  assert.equal(auditMathExplanation(valid, '给定D={2}，y=2。').needsReview, false);
  for (const value of ['函数y=x的定义域和值域都是集合{2}。', '常值函数y=2的值域为{2}。', '常值函数y=2的定义域和值域均为{3}。']) assert.equal(normalizeConstantFunctionClaim(value), value);
});

test('math clarification keeps raw notes, overview, subsection text and existing warnings intact', () => {
  const wrong = '对于常值函数y=2，其定义域和值域都是集合{2}。';
  const input = notesFor([section('s1', '常值函数的定义域与值域', wrong)], { overview: [wrong], warnings: ['原有转写提示'] });
  const before = structuredClone(input), result = decorateLessonNotes(input);
  assert.match(result.readingSections[0].text, /定义域由原题/);
  assert.equal(result.readingSections[0].subsections[0].text, wrong);
  assert.match(result.readingOverview[0], /定义域由原题/);
  assert.equal(result.readingWarnings.length, 2);
  assert.deepEqual(result.warnings, ['原有转写提示']);
  assert.deepEqual(input, before); assert.equal(result.sections, input.sections); assert.equal(result.examples, input.examples); assert.equal(result.overview, input.overview);
});

test('explicitly rejected constant-function claims are not rewritten into the opposite meaning', () => {
  for (const value of [
    '常值函数y=2，不能说其定义域与值域均为{2}。',
    '常值函数y=2不意味着定义域与值域均为{2}。',
    '常值函数y=2，绝不能写成定义域与值域均为{2}。',
    '常值函数y=2的定义域与值域均为{2}，这种说法是错误的。',
    '常值函数y=2的定义域与值域均为{2}是不对的。',
  ]) {
    assert.equal(auditMathExplanation(value).needsReview, false, value);
    assert.equal(normalizeConstantFunctionClaim(value), value);
  }
});

test('mixed correct rejections and actual assertions are audited and changed individually', () => {
  const rejected = '常值函数y=2，不能说定义域与值域均为{2}。';
  const wrong = '另一个错误整理写道：常值函数y=2的定义域与值域均为{2}。';
  const input = rejected + wrong;
  assert.equal(auditMathExplanation(input).issues.length, 1);
  const result = normalizeConstantFunctionClaim(input);
  assert.ok(result.startsWith(rejected)); assert.match(result, /定义域由原题/);
  const realAssertion = '常值函数y=2不能只写2，因为定义域和值域都是集合{2}。';
  assert.equal(auditMathExplanation(realAssertion).needsReview, true);
});

test('an existing outline summary receives the same narrow correction without altering the stored outline', () => {
  const wrong = '常值函数y=2的定义域与值域均为{2}。';
  const input = notesFor([section('s1', '常值函数', '这里讨论常值函数y=2。')], { readingOutline: [{ title: '常值函数', sectionIds: ['s1'], summary: wrong }] });
  const result = decorateLessonNotes(input);
  assert.match(result.readingSections[0].text, /定义域由原题/);
  assert.equal(input.readingOutline[0].summary, wrong);
  assert.equal(result.readingOutline[0].summary, wrong);
  assert.ok(result.readingWarnings.some(item => item.includes('知识点概要')));
});

test('global composition claims are qualified separately from the natural domain, including summary and teaching steps', () => {
  const raw = section('s1', '复合函数成立的条件', '原课指出复合函数要求内层g的值域R_g包含于外层f的定义域D_f，即R_g⊂D_f。', ['c1'], {
    teacherExplanation: '复合函数 y=f[g(x)] 要有意义，必须保证 g(x) 的每一个取值都能代入 f。因此要求 R_g⊂D_f。',
    steps: ['1. 求R_g；2. 写D_f；3. 检查 R_g⊂D_f；4. 若求复合函数定义域，解 g(x)∈D_f。'],
    pitfalls: ['R_g⊂D_f 是复合函数有意义的条件，不是定义域的完整答案。'], frameIds: ['f1'],
  });
  const notes = notesFor([raw], { readingOutline: [{ title: '复合函数', sectionIds: ['s1'], summary: '复合函数成立的条件是R_g⊂D_f。' }] }), before = structuredClone(notes);
  const result = decorateLessonNotes(notes), reading = result.readingSections[0];
  assert.match(reading.teacherExplanation, /整个定义域 D_g/);
  assert.match(reading.teacherExplanation, /\{x∈D_g : g\(x\)∈D_f\}/);
  assert.match(reading.teacherExplanation, /也可能在这个子集上有意义/);
  assert.match(reading.text, /若要求在整个 D_g 上成立/);
  assert.match(reading.steps[0], /若要求在整个 D_g 上复合，再检查/);
  assert.match(reading.steps[0], /同时满足 x∈D_g 和 g\(x\)∈D_f/);
  assert.match(reading.pitfalls[0], /整个 D_g 上有定义时的条件/);
  assert.deepEqual(reading.cueIds, ['c1']); assert.deepEqual(reading.frameIds, ['f1']);
  assert.deepEqual(reading.subsections[0], raw); assert.deepEqual(notes, before);
  assert.ok(result.readingWarnings.some(value => value.includes('自然定义域')));
});

test('already scoped composition conditions and unrelated subset facts are left untouched', () => {
  for (const raw of [
    section('s1', '复合函数', '若要求复合函数在整个 D_g 上都有定义，需要R_g⊂D_f；自然定义域为{x∈D_g:g(x)∈D_f}。', [], { teacherExplanation: '在整个D_g上讨论复合函数成立的条件是R_g⊂D_f。' }),
    section('s1', '复合表达式', '复合函数要有意义，并非必须让R_g⊂D_f；可以取自然定义域。'),
    section('s1', '集合包含关系', 'A⊂B表示集合A包含于集合B。'),
  ]) {
    const result = decorateLessonNotes(notesFor([raw]));
    assert.equal(result.readingSections[0].text, raw.text);
    assert.equal(result.readingSections[0].teacherExplanation, raw.teacherExplanation);
    assert.deepEqual(result.readingWarnings, []);
  }
});

test('the independent terse overview claim is scoped while its following operations statement remains unchanged', () => {
  const operations = '函数四则运算的定义域一般取交集，除法还需分母不为零。';
  const overview = `复合函数y=f[g(x)]要求内层值域包含于外层定义域；${operations}`;
  const notes = notesFor([], { overview: [overview] }), result = decorateLessonNotes(notes);
  assert.match(result.readingOverview[0], /若要求复合函数y=f\[g\(x\)\]在g的整个定义域 D_g 上成立/);
  assert.match(result.readingOverview[0], /自然定义域为\{x∈D_g:g\(x\)∈D_f\}/);
  assert.ok(result.readingOverview[0].endsWith(operations)); assert.equal(notes.overview[0], overview);
  const correct = `若要求复合函数y=f[g(x)]在g的整个定义域上成立，内层值域须包含于外层定义域；一般求自然定义域应取{x∈D_g:g(x)∈D_f}；${operations}`;
  assert.equal(decorateLessonNotes(notesFor([], { overview: [correct] })).readingOverview[0], correct);
  for (const qualified of [
    '复合函数y=f[g(x)]要求内层值域包含于外层定义域；这里仅指在g的整个定义域上成立，通常自然定义域为{x∈D_g:g(x)∈D_f}。',
    '不能说复合函数y=f[g(x)]要求内层值域包含于外层定义域。',
  ]) assert.equal(decorateLessonNotes(notesFor([], { overview: [qualified] })).readingOverview[0], qualified);
});

test('the x-squared endpoint example is qualified without retaining a blanket monotonicity claim', () => {
  const raw = section('s1', '分界点是否包含不影响单调性判断', '对于 y=x²，0可以同时属于左右两个单调区间。考察单调性时，对某一个端点处的情况其实不是特别在乎；这个点算在增区间还是减区间都可以。', ['c1'], {
    teacherExplanation: '单调性关注整体趋势，端点处个别点的归属不会改变“在区间上递增或递减”的结论。因此把0归入两边都不算错。',
    intuition: '分界点归到哪边都不影响整体趋势。', pitfalls: ['不要因为端点归属不同就认为单调性结论错了；写区间时应规范。'],
  });
  const result = decorateLessonNotes(notesFor([raw])), reading = result.readingSections[0];
  assert.match(reading.teacherExplanation, /这里只讨论 y=x² 在0处/);
  assert.match(reading.teacherExplanation, /一般函数的端点取值仍须/);
  assert.doesNotMatch(reading.teacherExplanation, /端点处个别点的归属不会改变/);
  assert.match(reading.intuition, /不能把本例推广/);
  assert.match(reading.pitfalls[0], /一般函数的端点函数值仍须检查/);
  assert.deepEqual(reading.subsections[0], raw);
});

test('already limited x-squared examples and other functions do not receive targeted endpoint rewriting', () => {
  for (const raw of [
    section('s1', '端点与单调性', '仅就本例 y=x² 的0而言，分界点是否包含不影响单调性判断；一般函数的端点取值仍须核对。'),
    section('s1', '另一个函数', '对于y=x³，0是分界点。端点处个别点的归属不会改变单调性的结论。'),
  ]) {
    const result = decorateLessonNotes(notesFor([raw]));
    assert.equal(result.readingSections[0].text, raw.text); assert.deepEqual(result.readingWarnings, []);
  }
});

test('an uncertain second branch is placed before an AI solution that assumes irrational inputs', () => {
  const example = { id: 'e14', title: '分段函数周期性', prompt: 'D(x)={1,x∈Q;0,x∈[模糊]}，第二行集合符号模糊，需复核。', solution: '', detailedSolution: 'AI补充：若x为无理数，则x+T仍为无理数，所以任意非零有理数都是周期。', solutionSteps: ['分x∈Q和x∉Q两种情况验证。'], solutionOrigin: 'ai-supplement', cueIds: ['c1'], frameIds: ['f1'], needsReview: true };
  const notes = notesFor([], { examples: [example] }), before = structuredClone(notes), result = decorateLessonNotes(notes), reading = result.readingExamples[0];
  assert.ok(reading.detailedSolution.startsWith('条件性补充解法：'));
  assert.match(reading.detailedSolution, /仅在该分支确为无理数（x∉Q）时/);
  assert.match(reading.detailedSolution, /不能视为已确认的原题答案/);
  assert.match(reading.solutionSteps[0], /^条件性补充解法/);
  assert.equal(reading.solutionSteps[1], example.solutionSteps[0]);
  assert.ok(reading.detailedSolution.endsWith(example.detailedSolution));
  assert.equal(reading.needsReview, true); assert.deepEqual(reading.sourceExamples[0], example);
  assert.deepEqual(reading.cueIds, ['c1']); assert.deepEqual(reading.frameIds, ['f1']);
  assert.deepEqual(notes, before); assert.deepEqual(decorateLessonNotes(result), result);
});

test('complete exercises and incomplete exercises without supplementary answers are not reinterpreted', () => {
  const examples = [
    { id: 'e1', title: '完整题干', prompt: 'D(x)有理点取1，无理点取0，讨论周期性。', detailedSolution: '分有理数和无理数验证。', solutionSteps: ['取有理数周期'], needsReview: true, cueIds: [] },
    { id: 'e2', title: '尚无补解', prompt: '第二分支[模糊]。', detailedSolution: '', solutionSteps: [], needsReview: true, cueIds: [] },
  ];
  const result = decorateLessonNotes(notesFor([], { examples }));
  assert.equal(result.readingExamples[0].detailedSolution, examples[0].detailedSolution);
  assert.equal(result.readingExamples[1].detailedSolution, '');
  assert.deepEqual(result.readingWarnings, []);
  const unknown = decorateLessonNotes(notesFor([], { examples: [{ id: 'e3', title: '缺少条件的计算题', prompt: '题干不完整：某个参数[缺失]。', detailedSolution: '按补充假设计算结果。', cueIds: [] }] })).readingExamples[0];
  assert.match(unknown.detailedSolution, /原始题干含未确认条件/); assert.doesNotMatch(unknown.detailedSolution, /无理数/);
});

test('the real-line exponential proof uses a strict witness for every positive M and correctly describes all lower bounds', () => {
  const detailedSolution = '对 y=e^x，任取 M>0，令 x₁=ln M（若 M≤1 可取 x₁=0 等），则 e^{x₁}=M；再取稍大的 x 即可使 e^x>M。不存在统一的上界，故 e^x 在 (-∞,+∞) 上无界。注意它只有下界 0（e^x>0），无上界，值域为(0,+∞)。';
  const example = { id: 'e6', title: 'y=e^x 无界的说明', prompt: '证明y=e^x在实数域无上界。', solution: '', detailedSolution, solutionSteps: [
    '写出无界定义：∀M>0，∃x₁，使 |f(x₁)|>M。',
    '对 e^x 取 x₁=ln M，则 e^{x₁}=M。',
    '取 x₁ 稍大于 ln M，即得 e^{x₁}>M，突破该界。',
    'M 任意大，故不存在上界，函数无界。',
    '核对：e^x>0 恒成立，有下界 0，但无界性只要求某一侧突破。',
  ], cueIds: ['c1'], frameIds: ['f1'], solutionOrigin: 'ai-supplement', needsReview: true };
  const audit = auditMathExplanation(detailedSolution);
  assert.deepEqual(audit.issues.map(issue => issue.code), ['exponential-lower-bound', 'exponential-strict-witness']);
  const notes = notesFor([], { examples: [example] }), before = structuredClone(notes), reading = decorateLessonNotes(notes).readingExamples[0];
  assert.match(reading.detailedSolution, /x₁=ln\(M\+1\)/); assert.match(reading.detailedSolution, /e\^\{x₁\}=M\+1>M/);
  assert.doesNotMatch(reading.detailedSolution, /M≤1.*可取.*=0|只有下界/);
  assert.match(reading.detailedSolution, /0为下界和下确界，所有≤0的实数也都是它的下界/);
  assert.match(reading.detailedSolution, /无上界，值域为\(0,\+∞\)/);
  assert.match(reading.solutionSteps[1], /M\+1>M/); assert.doesNotMatch(reading.solutionSteps[2], /稍大于 ln M/);
  assert.equal(reading.solutionSteps[0], example.solutionSteps[0]); assert.equal(reading.solutionSteps[3], example.solutionSteps[3]); assert.equal(reading.solutionSteps[4], example.solutionSteps[4]);
  assert.deepEqual(reading.sourceExamples[0], example); assert.deepEqual(notes, before);
  assert.deepEqual(reading.cueIds, ['c1']); assert.deepEqual(reading.frameIds, ['f1']);
});

test('correct exponential proofs, valid lower-bound statements and explicitly rejected errors are not rewritten', () => {
  for (const value of [
    'y=e^x在R上无上界。对M>0取x=ln(M+1)，e^x=M+1>M。0是下界和下确界，所有≤0的实数都是下界，值域(0,+∞)。',
    'y=e^x在R上无界。取x=ln M，再取稍大的x，便有e^x>M。0是它的一个下界。',
    'y=e^x在R上无界。不能说它只有下界0，实际上每个≤0的数都是下界。',
    'y=e^x在R上无界。若0<M<1可取x₁=0，此时e^0=1>M；M≥1时取x₁=ln(M+1)。',
  ]) {
    const example = { id: 'correct', title: 'y=e^x的无界性', prompt: '讨论无界性。', detailedSolution: value, cueIds: [] };
    assert.equal(auditMathExplanation(value).needsReview, false);
    assert.equal(decorateLessonNotes(notesFor([], { examples: [example] })).readingExamples[0].detailedSolution, value);
  }
});

test('the exponential-specific correction does not alter other functions or bounded-domain examples', () => {
  for (const value of [
    'y=2^x在R上无界，只有下界0。',
    'y=e^{-x}在R上无界，只有下界0。',
    'y=e^x在[0,1]上讨论，只有下界0。',
    'y=e^x在(-∞,0]上有界，取x₁=ln M。',
  ]) {
    const example = { id: 'other', title: '其它范围的题目', prompt: '按题目给定范围讨论。', detailedSolution: value, cueIds: [] };
    assert.equal(auditMathExplanation(value).needsReview, false);
    assert.equal(decorateLessonNotes(notesFor([], { examples: [example] })).readingExamples[0].detailedSolution, value);
  }
});

test('empty input, cancellation-era partial notes, and repeated decoration remain deterministic', () => {
  assert.deepEqual(buildReadingSections([]), []);
  assert.equal(decorateLessonNotes(null), null);
  const input = notesFor([section('s1', '知识', '正文')]);
  const first = decorateLessonNotes(input), second = decorateLessonNotes(first);
  assert.deepEqual(second, first);
});
