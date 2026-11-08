import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSourceQuestions } from '../server/questions.mjs';

const doc = (text, overrides = {}) => ({ id: 'd1', courseId: 'c1', name: '概念笔记.docx', type: 'DOCX', locationKind: 'section', chunks: [{ text, page: 3 }], ...overrides });

test('source cloze preserves exact answer, sentence, source and unambiguous source reconstruction', () => {
  const documents = [doc('导数是函数的瞬时变化率。积分是带符号面积的累积。矩阵是按行和列排列的数表。')];
  const result = generateSourceQuestions(documents, 'c1');
  assert.equal(result.mode, 'source-cloze');
  assert.equal(result.questions.length, 3);
  for (const q of result.questions) {
    assert.ok(q.options.length >= 2 && q.options.length <= 4);
    assert.equal(new Set(q.options).size, q.options.length);
    assert.ok(documents[0].chunks[0].text.includes(q.originalSentence));
    assert.ok(q.originalSentence.includes(q.options[q.answer]));
    assert.match(q.prompt, /____/);
    assert.match(q.source, /第 3 段/);
    assert.match(q.explanation, /只检查/);
    assert.ok(q.explanation.includes(q.originalSentence));
  }
});

test('single clear definition can produce one literal recall item, without invented vocabulary', () => {
  const documents = [doc('导数是函数的瞬时变化率。')];
  const result = generateSourceQuestions(documents, 'c1');
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].options.length, 2);
  assert.ok(result.questions[0].options.every((term) => documents[0].chunks[0].text.includes(term)));
  assert.equal(generateSourceQuestions([doc('二阶导数是导数的导数。')], 'c1').questions[0].topic, '二阶导数');
});

test('repeated generation and duplicated uploads do not keep growing the question bank', () => {
  const documents = [doc('链式法则：外层导数乘以内层导数。极限描述自变量趋近某点时函数值的趋势。')];
  const first = generateSourceQuestions(documents, 'c1');
  const second = generateSourceQuestions([...documents, { ...documents[0], id: 'duplicated', name: 'duplicate.txt' }], 'c1', first.questions);
  assert.deepEqual(second.questions, first.questions);
  assert.equal(second.newQuestions.length, 0);
  assert.match(second.warning, /未重复/);
});

test('insufficient or unrelated course data returns actionable 422, and output is bounded', () => {
  assert.throws(() => generateSourceQuestions([doc('你好。')], 'c1'), (error) => error.status === 422 && /补充/.test(error.message));
  assert.throws(() => generateSourceQuestions([doc('导数是变化率。')], 'missing'), (error) => error.status === 422);
  const texts = Array.from({ length: 20 }, (_, index) => `概念${index}是本资料中第${index}个需要记忆的定义。`).join('');
  assert.equal(generateSourceQuestions([doc(texts)], 'c1').questions.length, 8);
});
