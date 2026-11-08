import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlan, extractSummary, retrieve, scheduleCard, updateMastery} from '../server/engine.mjs';

const date = '2026-11-04';
const course = (id, days = 10, mastery = 40) => ({id, name: id, examDate: new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10), target: 80, mastery});
const stateFor = (courses, budget = 150) => ({
  courses, settings: {dailyMinutes: budget, goal: 'balanced'}, completedTasks: [], cards: [],
  documents: courses.map(item => ({courseId: item.id, name: item.name, chunks: []})),
  questions: courses.map(item => ({courseId: item.id, topic: '函数与极限'})),
});

test('planner stays within exact minute budget, includes every course and is deterministic', () => {
  const state = stateFor([course('a', 3), course('b', 15), course('c', 20), course('d', 30)]);
  const plan = buildPlan(state, date);
  assert.equal(plan.allocated, 150);
  assert.equal(plan.tasks.reduce((total, task) => total + task.minutes, 0), plan.allocated);
  assert.equal(new Set(plan.tasks.map(task => task.courseId)).size, 4);
  assert.deepEqual(plan, buildPlan(state, date));
  const minutes = id => plan.tasks.filter(task => task.courseId === id).reduce((sum, task) => sum + task.minutes, 0);
  assert.ok(minutes('a') >= minutes('d'));
});

test('same-day, expired and invalid exams are excluded with an explanation', () => {
  const state = stateFor([course('today', 0), course('past', -1), {...course('bad'), examDate: '2026-02-30'}]);
  const plan = buildPlan(state, date);
  assert.equal(plan.tasks.length, 0);
  assert.equal(plan.allocated, 0);
  assert.equal(plan.warnings.length, 3);
  assert.throws(() => buildPlan(state, '2026-02-30'), RangeError);
  assert.throws(() => buildPlan(state, 'not a date'), RangeError);
});

test('an unset exam date does not invent new tasks and preserves completed history', () => {
  const state = stateFor([{ ...course('math'), examDate: '' }]);
  let plan = buildPlan(state, date);
  assert.equal(plan.tasks.length, 0);
  assert.match(plan.warnings[0], /尚未设置考试日期，补充后可加入复习计划/);
  assert.doesNotMatch(plan.warnings[0], /无效/);
  const done = { id: `${date}:math:practice`, courseId: 'math', title: '已完成练习', kind: 'practice', minutes: 20, reason: '既有计划' };
  state.completedTasks = [done.id];
  state.completedTaskDetails = { [done.id]: done };
  plan = buildPlan(state, date);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].completed, true);
  assert.equal(plan.allocated, 20);
});

test('tiny or zero budgets never spill or create negative tasks', () => {
  for (const budget of [0, 1, 3, 7, 13, 29, 150, 720]) {
    const plan = buildPlan(stateFor([course('a'), course('b')], budget), date);
    assert.ok(plan.allocated <= budget);
    assert.ok(plan.tasks.every(task => task.minutes > 0 && Number.isInteger(task.minutes)));
    assert.equal(plan.tasks.reduce((sum, task) => sum + task.minutes, 0), plan.allocated);
  }
  assert.deepEqual(buildPlan(stateFor([], 90), date), {date, budget: 90, allocated: 0, tasks: [], warnings: []});
});

test('completion IDs stay stable and due cards are scheduled by China calendar day', () => {
  const state = stateFor([course('math')], 90);
  state.cards = [
    {courseId: 'math', due: '2026-11-04T15:59:59.000Z'},
    {courseId: 'math', due: '2026-11-04T16:00:00.000Z'},
  ];
  state.completedTasks = [`${date}:math:review`];
  const review = buildPlan(state, date).tasks.find(task => task.kind === 'review');
  assert.ok(review);
  assert.equal(review.completed, true);
  assert.match(review.title, /1 张/);
});

test('new course has an actionable preparation task and no fabricated exercise', () => {
  const state = stateFor([course('new')]);
  state.documents = [];
  state.questions = [];
  const plan = buildPlan(state, date);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].kind, 'learn');
  assert.match(plan.tasks[0].title, /补充资料/);
});

test('the planner preserves valid targets below 60 instead of silently raising them', () => {
  const state = stateFor([{...course('math'), target: 55}]);
  const plan = buildPlan(state, date);
  assert.ok(plan.tasks.every(task => task.reason.includes('目标 55 分')));
});

test('completed work keeps its original minutes after due cards move and plans adapt', () => {
  const state = stateFor([course('math')], 90);
  state.cards = [{courseId: 'math', due: '2026-11-03T08:00:00Z'}];
  const first = buildPlan(state, date);
  const review = first.tasks.find(task => task.kind === 'review');
  state.completedTasks = [review.id];
  state.completedTaskDetails = {[review.id]: review};
  state.cards[0].due = '2026-12-01T08:00:00Z';
  const next = buildPlan(state, date);
  assert.deepEqual(next.tasks.find(task => task.id === review.id), {...review, completed: true});
  assert.equal(next.tasks.filter(task => task.id === review.id).length, 1);
  assert.ok(next.allocated <= next.budget);
  assert.equal(next.tasks.reduce((sum, task) => sum + task.minutes, 0), next.allocated);
});

test('a budget lowered below historical completed work creates no extra assignments', () => {
  const state = stateFor([course('math')], 5);
  const done = {id: `${date}:math:practice`, courseId: 'math', title: '独立作答', kind: 'practice', minutes: 30, reason: '既有计划'};
  state.completedTasks = [done.id];
  state.completedTaskDetails = {[done.id]: done};
  const plan = buildPlan(state, date);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].completed, true);
  assert.equal(plan.allocated, 30, 'historical time must not be silently shortened');
  assert.match(plan.warnings[0], /今天不再新增/);
});

const docs = [
  {name: '高数讲义', courseId: 'math', chunks: [
    {id: '1', page: 3, text: '导数的定义：函数在一点的变化率，是差商的极限。可导一定连续，连续不一定可导。'},
    {id: '2', page: 8, text: '定积分表示有向面积。牛顿莱布尼茨公式将定积分转化为原函数在端点的差。'},
  ]},
  {name: '物理讲义', courseId: 'physics', chunks: [{id: '3', page: 6, text: '电场强度是单位电荷受到的电场力。点电荷电场强度与距离的平方成反比。'}]},
];

test('Chinese lexical retrieval ranks relevant source and preserves original page', () => {
  const found = retrieve('导数的定义是什么？', docs, 'math');
  assert.ok(found.length);
  assert.equal(found[0].documentName, '高数讲义');
  assert.equal(found[0].page, 3);
  assert.ok(found[0].score > 0);
  assert.equal(retrieve('电场强度', docs, 'math').length, 0);
  assert.equal(retrieve('莎士比亚戏剧', docs).length, 0);
  assert.equal(retrieve('什么', docs).length, 0);
});

test('extractive summaries quote source text, deduplicate and carry page attribution', () => {
  const summary = extractSummary([...docs[0].chunks, docs[0].chunks[0]]);
  assert.ok(summary.length > 0 && summary.length <= 6);
  assert.equal(new Set(summary).size, summary.length);
  for (const line of summary) {
    assert.match(line, /（第 [38] 页）$/);
    const text = line.replace(/（第 \d+ 页）$/, '');
    assert.ok(docs[0].chunks.some(chunk => chunk.text.includes(text)));
  }
  assert.deepEqual(extractSummary([]), []);
});

test('section-based document locations remain sections in retrieval and summaries', () => {
  const doc = {...docs[0], type: 'DOCX', locationKind: 'section'};
  assert.equal(retrieve('导数', [doc])[0].locationKind, 'section');
  assert.ok(extractSummary(doc.chunks, 'section').every(line => /第 \d+ 段/.test(line)));
  const fallback = {...doc, type: 'TXT', locationKind: undefined};
  assert.equal(retrieve('导数', [fallback])[0].locationKind, 'section');
});

test('FSRS schedules ratings, persists JSON dates, and accepts the next review', () => {
  const now = new Date('2026-11-04T08:00:00.000Z');
  const card = {id: 'one', courseId: 'math', front: '可导与连续', back: '可导必连续', due: now.toISOString(), source: '讲义'};
  const forgotten = scheduleCard(card, 1, now);
  const remembered = scheduleCard(card, 4, now);
  assert.ok(Date.parse(forgotten.due) > now.getTime());
  assert.ok(Date.parse(remembered.due) > Date.parse(forgotten.due));
  assert.equal(remembered.fsrs.reps, 1);
  assert.equal(typeof remembered.fsrs.last_review, 'string');
  assert.equal(card.fsrs, undefined, 'input card must not be mutated');
  const next = scheduleCard(JSON.parse(JSON.stringify(remembered)), 3, new Date(remembered.due));
  assert.equal(next.fsrs.reps, 2);
  assert.equal(next.front, card.front);
  assert.ok(Date.parse(next.due) > Date.parse(remembered.due));
  assert.deepEqual(scheduleCard(card, 3, now), scheduleCard(card, 3, now), 'fuzz is disabled');
});

test('FSRS rejects bad ratings and dates', () => {
  assert.throws(() => scheduleCard({}, 0, new Date()), RangeError);
  assert.throws(() => scheduleCard({}, '3', new Date()), RangeError);
  assert.throws(() => scheduleCard({}, 3, 'bad date'), RangeError);
});

test('mastery is a bounded gradual estimate, with smaller penalties for hard errors', () => {
  assert.ok(updateMastery(40, true, '基础') > 40);
  assert.ok(updateMastery(40, true, '基础') < 50);
  assert.ok(updateMastery(60, false, '困难') > updateMastery(60, false, '基础'));
  for (const current of [-100, 0, 50, 100, 900, NaN, Infinity]) {
    for (const correct of [false, true]) {
      const updated = updateMastery(current, correct, '基础');
      assert.ok(Number.isFinite(updated) && updated >= 0 && updated <= 100);
    }
  }
});
