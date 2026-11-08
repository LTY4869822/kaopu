import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index.mjs';
import {applyPlannerPatch, buildPlanner, plannerToday} from '../server/planner.mjs';
import {createSeed} from '../server/seed.mjs';

const now = new Date('2026-11-04T08:00:00Z'); // 16:00 in Shanghai
const today = '2026-11-04';
const course = (id, extra = {}) => ({id, name: id, examDate: '2026-11-08', target: 80, mastery: 40, difficulty: 3, chapters: 4, remainingHours: 3, ...extra});
function fixture(courses = [course('math')], planner = {}) {
  return {courses, documents: courses.map(item => ({id: `doc-${item.id}`, courseId: item.id})), questions: [], cards: [],
    settings: {dailyMinutes: 150, goal: 'balanced', planner: {startDate: today, mode: 'timeline', reservePercent: 10, windows: [{start: '19:00', end: '23:00'}], ...planner}}, completedTasks: [], completedTaskDetails: {}};
}
const plan = (state, date = today, days = 14, time = now) => buildPlanner(state, {date, days, now: time});
const mins = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

test('rolling planner respects each daily budget, buffer, preparation start, and exam cutoff', () => {
  const state = fixture([course('math'), course('later', {prepStartDate: '2026-11-06', examDate: '2026-11-10'})], {weeklyMinutes: [0, 90, 150, 60, 120, 30, 45]});
  const result = plan(state);
  for (const day of result.days) {
    assert.ok(day.allocated + day.reserveMinutes + day.breakMinutes <= day.budget);
    assert.equal(day.tasks.reduce((sum, task) => sum + task.minutes, 0), day.allocated);
    for (const task of day.tasks) {
      const item = state.courses.find(item => item.id === task.courseId);
      assert.ok(day.date < item.examDate);
      if (item.prepStartDate) assert.ok(day.date >= item.prepStartDate);
    }
  }
  assert.ok(result.days.find(day => day.date === '2026-11-09').tasks.every(task => task.courseId !== 'math'));
  assert.deepEqual(plan(state).days, result.days, 'same inputs are deterministic');
});

test('deadline prefix protection prevents a huge later course from starving tomorrow exam', () => {
  const state = fixture([course('early', {examDate: '2026-11-05', remainingHours: .75, difficulty: 1, mastery: 90}), course('large', {examDate: '2026-11-10', remainingHours: 100, difficulty: 5})],
    {weeklyMinutes: Array(7).fill(50), reservePercent: 0, blockMinutes: 50, breakMinutes: 5});
  const result = plan(state);
  const early = result.days[0].tasks.filter(task => task.courseId === 'early').reduce((sum, task) => sum + task.minutes, 0);
  assert.equal(early, 45);
  assert.equal(result.courses.find(item => item.courseId === 'early').shortfallMinutes, 0);
  assert.match(result.warnings[0], /最早时间瓶颈/);
});

test('day and timeline share tasks while slots remain bounded, split focus blocks and take breaks', () => {
  const state = fixture([course('math', {remainingHours: 6})], {windows: [{start: '19:00', end: '19:50'}, {start: '20:30', end: '21:30'}], blockMinutes: 25, breakMinutes: 5, reservePercent: 0});
  const timeline = plan(state).days[0];
  state.settings.planner.mode = 'day';
  const daily = plan(state).days[0];
  assert.deepEqual(daily.tasks, timeline.tasks);
  assert.ok(timeline.slots.some(slot => slot.kind === 'break'));
  assert.ok(timeline.unscheduledMinutes > 0);
  assert.equal(timeline.slots.filter(slot => slot.kind === 'study').reduce((sum, slot) => sum + slot.minutes, 0) + timeline.unscheduledMinutes, timeline.allocated);
  for (let i = 0; i < timeline.slots.length; i++) {
    const slot = timeline.slots[i];
    assert.ok(slot.start < slot.end);
    assert.equal(slot.minutes, mins(slot.end) - mins(slot.start));
    assert.ok(state.settings.planner.windows.some(window => slot.start >= window.start && slot.end <= window.end));
    if (i) assert.ok(timeline.slots[i - 1].end <= slot.start);
    if (slot.kind === 'study') assert.ok(slot.minutes <= 25);
  }
});

test('an ordinary multi-course evening gives meaningful activities instead of a few minutes per kind', () => {
  const state = createSeed(now);
  state.settings.dailyMinutes = 180;
  state.settings.planner = {startDate: today, windows: [{start: '19:00', end: '23:00'}]};
  const result = plan(state).days[0];
  assert.ok(result.tasks.length <= 8, 'four courses should not fan out into every possible activity');
  assert.equal(result.unscheduledMinutes, 0);
  for (const task of result.tasks) {
    assert.ok(task.minutes >= (task.kind === 'review' ? 10 : 20), 'a substantial course allocation should open a substantial activity');
    const pieces = result.slots.filter(slot => slot.taskId === task.id);
    if (task.minutes <= 40) assert.equal(pieces.length, 1, 'a full task that fits a focus block should stay intact');
  }
  assert.ok(result.slots.filter(slot => slot.kind === 'study').every(slot => slot.minutes >= 10));
  assert.ok(result.allocated + result.reserveMinutes + result.breakMinutes <= result.budget);
});

test('a long activity is balanced across focus blocks and a genuinely tiny time window remains explicit', () => {
  const state = fixture([course('math', {remainingHours: 47 / 60})], {weeklyMinutes: Array(7).fill(60), reservePercent: 0});
  let day = plan(state).days[0];
  assert.equal(day.allocated, 47);
  assert.equal(day.unscheduledMinutes, 0);
  const studies = day.slots.filter(slot => slot.kind === 'study');
  assert.equal(studies.length, 2);
  assert.ok(studies.every(slot => slot.minutes >= 20), 'a 47-minute task should not become 40+7');
  assert.ok(day.breakMinutes + day.allocated <= day.budget);
  state.settings.planner.windows = [{start: '19:00', end: '19:03'}, {start: '19:10', end: '19:13'}];
  day = plan(state).days[0];
  assert.equal(day.unscheduledMinutes, 41);
  assert.ok(day.warnings.some(text => text.includes('放不下')));
  assert.ok(day.slots.every(slot => slot.minutes <= 3), 'hard window edges remain authoritative');
});

test('consolidation preserves exact course allocation and small budgets without spilling wall-clock time', () => {
  for (const budget of [0, 1, 5, 9, 15, 19, 20, 25, 35, 49, 50, 59, 60, 90, 150, 180, 240, 720]) {
    const state = fixture([course('a'), course('b'), course('c')], {weeklyMinutes: Array(7).fill(budget), reservePercent: 0});
    state.questions = state.courses.map(item => ({id: `q-${item.id}`, courseId: item.id}));
    state.cards = state.courses.map(item => ({id: `c-${item.id}`, courseId: item.id, due: now.toISOString()}));
    const result = plan(state, today, 1);
    const day = result.days[0];
    assert.ok(day.allocated + day.reserveMinutes + day.breakMinutes <= budget, `budget ${budget}`);
    assert.equal(day.tasks.reduce((sum, task) => sum + task.minutes, 0), day.allocated);
    assert.equal(day.slots.filter(slot => slot.kind === 'study').reduce((sum, slot) => sum + slot.minutes, 0) + day.unscheduledMinutes, day.allocated);
    assert.ok(day.tasks.every(task => task.minutes > 0));
    for (const summary of result.courses) assert.equal(summary.scheduledMinutes + summary.shortfallMinutes, summary.remainingMinutes);
  }
});

test('live timeline never places new work before now and preserves the common daily task list', () => {
  const state = fixture();
  const before = plan(state).days[0];
  const late = plan(state, today, 14, new Date('2026-11-04T12:12:30Z')).days[0];
  assert.deepEqual(late.tasks, before.tasks);
  assert.ok(late.slots.every(slot => slot.start >= '20:13'));
  const afterWindow = plan(state, today, 14, new Date('2026-11-04T15:30:00Z')).days[0];
  assert.equal(afterWindow.slots.length, 0);
  assert.equal(afterWindow.unscheduledMinutes, afterWindow.allocated);
  assert.match(afterWindow.warnings[0], /可用时段/);
});

test('date overrides including zero budget, global start, and missing exams are explicit', () => {
  const state = fixture([course('math'), course('unknown', {examDate: ''})], {startDate: '2026-11-05', overrides: [{date: '2026-11-06', minutes: 0}]});
  const result = plan(state);
  assert.equal(result.days[0].tasks.length, 0);
  assert.equal(result.days.find(day => day.date === '2026-11-06').allocated, 0);
  assert.equal(result.courses.find(item => item.courseId === 'unknown').status, 'missing-date');
  assert.ok(result.warnings.some(text => text.includes('还没有考试日期')));
});

test('completed minutes and original slots remain immutable after preferences change; undo restores work', () => {
  const state = fixture();
  const first = plan(state).days[0];
  const task = first.tasks[0];
  const snapshot = {...task, completed: true, plannedSlots: first.slots.filter(slot => slot.taskId === task.id)};
  state.completedTasks.push(task.id); state.completedTaskDetails[task.id] = snapshot;
  state.settings.planner.weeklyMinutes = Array(7).fill(15);
  const next = plan(state);
  assert.deepEqual(next.days[0].tasks.find(item => item.id === task.id), snapshot);
  assert.equal(next.days[0].completedMinutes, task.minutes);
  assert.equal(next.courses[0].remainingMinutes, 180 - task.minutes);
  assert.equal(next.days[0].tasks.filter(item => item.id === task.id).length, 1);
  state.completedTasks = []; delete state.completedTaskDetails[task.id];
  assert.equal(plan(state).courses[0].remainingMinutes, 180);
});

test('legacy completed snapshots migrate without renaming, repeating their activity, or spending the budget twice', () => {
  const state = fixture([course('math'), course('other')], {weeklyMinutes: Array(7).fill(60), reservePercent: 0});
  const old = {id: `${today}:math:learn`, courseId: 'math', title: '旧版完成的概念复习', kind: 'learn', minutes: 40, reason: '保存时的原始任务说明', completed: true};
  state.completedTasks.push(old.id);
  state.completedTaskDetails[old.id] = old;
  const result = plan(state);
  const day = result.days[0];
  assert.deepEqual(day.tasks.find(task => task.id === old.id), old);
  assert.equal(day.completedMinutes, 40);
  assert.ok(day.allocated + day.breakMinutes <= day.budget);
  assert.ok(!day.tasks.some(task => task.courseId === 'math' && task.kind === 'learn' && !task.completed));
  assert.equal(result.courses.find(item => item.courseId === 'math').remainingMinutes, 140);
  state.settings.planner.weeklyMinutes = Array(7).fill(15);
  const reduced = plan(state).days[0];
  assert.equal(reduced.completedMinutes, 40);
  assert.equal(reduced.tasks.length, 1, 'completed legacy work consumes all reduced budget');
  assert.match(reduced.warnings.join(' '), /保留历史记录/);
  const tomorrow = plan(state, '2026-11-05', 1, new Date('2026-11-05T08:00:00Z'));
  assert.equal(tomorrow.courses.find(item => item.courseId === 'math').remainingMinutes, 140, 'old completion still credits later rolling plans');
});

test('remaining effort edits start a new baseline and null restores transparent estimates', () => {
  const state = fixture();
  const task = plan(state).days[0].tasks[0];
  state.completedTasks = [task.id]; state.completedTaskDetails[task.id] = {...task, completed: true};
  const update = applyPlannerPatch(state, {courses: [{id: 'math', remainingHours: 2}]}, now);
  Object.assign(state, update);
  assert.equal(plan(state).courses[0].remainingMinutes, 120, 'new estimate does not deduct old completed time');
  assert.equal(plan(state).courses[0].estimated, false);
  Object.assign(state, applyPlannerPatch(state, {courses: [{id: 'math', remainingHours: null}]}, now));
  assert.equal(plan(state).courses[0].estimated, true);
});

test('missed days do not silently complete work, future previews reuse allocations, and assessment exceeds 14 days', () => {
  const state = fixture([course('math', {examDate: '2026-12-10', remainingHours: 6})]);
  const result = plan(state);
  assert.equal(result.courses[0].shortfallMinutes, 0);
  assert.equal(result.courses[0].scheduledMinutes, 360);
  const later = plan(state, '2026-11-05', 14, new Date('2026-11-05T08:00:00Z'));
  assert.equal(later.courses[0].remainingMinutes, 360);
  const futurePreview = plan(state, '2026-11-07', 1);
  assert.deepEqual(futurePreview.days[0], result.days.find(day => day.date === '2026-11-07'));
});

test('shortfall differentiates day budgets from time-window feasibility and never claims far deadlines assessed', () => {
  const state = fixture([course('math', {remainingHours: 4})], {weeklyMinutes: Array(7).fill(240), windows: [{start: '19:00', end: '19:15'}]});
  const result = plan(state);
  assert.equal(result.courses[0].shortfallMinutes, 0);
  assert.ok(result.courses[0].timelineShortfallMinutes > 0);
  assert.ok(result.warnings.some(text => text.includes('未放入当前可用时段')));
  state.courses[0].examDate = '2027-04-10';
  assert.ok(plan(state).warnings.some(text => text.includes('90 天评估范围之外')));
});

test('preference validation rejects overlaps and malformed values without any partial mutation', () => {
  const state = fixture();
  const original = structuredClone(state);
  const bad = [
    {settings: {weeklyMinutes: [1, 2]}},
    {settings: {windows: [{start: '19:00', end: '21:00'}, {start: '20:00', end: '22:00'}]}},
    {settings: {startDate: '2026-02-30'}},
    {settings: {reservePercent: 26}},
    {settings: {overrides: [{date: today, minutes: -1}]}},
    {settings: {goal: 'high'}, courses: [{id: 'math', difficulty: 6}]},
    {courses: [{id: 'math', prepStartDate: '2026-11-09'}]},
    {courses: [{id: 'math', remainingHours: '2'}]},
  ];
  for (const value of bad) {
    assert.throws(() => applyPlannerPatch(state, value, now));
    assert.deepEqual(state, original);
  }
  assert.throws(() => plan(state, '2030-01-01'), /一年以内/);
  assert.throws(() => plan(state, today, 100), /预览天数/);
});

test('goal changes affect allocation and strategy while missing resources yield truthful preparation tasks', () => {
  const state = fixture([course('math', {remainingHours: undefined})]);
  state.questions.push({id: 'q', courseId: 'math'});
  state.settings.goal = 'pass';
  const pass = plan(state);
  state.settings.goal = 'high';
  const high = plan(state);
  assert.ok(pass.days[0].tasks.some(task => task.title.includes('基础巩固')));
  assert.ok(high.days[0].tasks.some(task => task.title.includes('强化练习')));
  assert.ok(high.courses[0].remainingMinutes > pass.courses[0].remainingMinutes);
  state.documents = []; state.questions = [];
  assert.ok(plan(state).days[0].tasks.every(task => task.title.includes('补充资料')));
});

test('planner API atomically persists preferences, records server task snapshots, rejects future completion and restores on restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-planner-test-'));
  let server;
  try {
    server = await new Promise(resolve => {const instance = createApp({dataDir: dir, provider: {}}).listen(0, '127.0.0.1', () => resolve(instance));});
    let base = `http://127.0.0.1:${server.address().port}/api`;
    const api = async (route, method = 'GET', body) => {
      const response = await fetch(`${base}${route}`, {method, headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
      return {status: response.status, body: await response.json()};
    };
    const initial = (await api('/state')).body;
    const bad = await api('/planner', 'PATCH', {settings: {goal: 'high'}, courses: [{id: initial.courses[0].id, difficulty: 9}]});
    assert.equal(bad.status, 400);
    assert.deepEqual((await api('/state')).body.settings, initial.settings);
    const saved = await api('/planner', 'PATCH', {settings: {mode: 'day', goal: 'high', weeklyMinutes: Array(7).fill(120)}, courses: [{id: initial.courses[0].id, difficulty: 5, remainingHours: 2}]});
    assert.equal(saved.status, 200);
    let result = (await api('/planner?days=2')).body;
    assert.equal(result.settings.goal, 'high');
    assert.equal(result.days.length, 2);
    const task = result.days[0].tasks[0];
    assert.ok(task);
    assert.equal((await api(`/planner/tasks/${encodeURIComponent(task.id)}/complete`, 'POST', {completed: true, minutes: 9999})).status, 200);
    let updated = (await api('/state')).body;
    assert.equal(updated.completedTaskDetails[task.id].minutes, task.minutes);
    assert.equal((await api(`/planner/tasks/${encodeURIComponent(task.id)}/complete`, 'POST', {completed: true})).status, 200);
    assert.equal((await api('/state')).body.completedTasks.filter(id => id === task.id).length, 1);
    result = (await api('/planner?days=2')).body;
    const futureTask = result.days[1].tasks[0];
    if (futureTask) assert.equal((await api(`/planner/tasks/${encodeURIComponent(futureTask.id)}/complete`, 'POST', {completed: true})).status, 400);
    assert.equal((await api('/planner?days=100')).status, 400);
    assert.equal((await api('/planner?date=2026-02-30')).status, 400);
    await new Promise(resolve => server.close(resolve));
    server = await new Promise(resolve => {const instance = createApp({dataDir: dir, provider: {}}).listen(0, '127.0.0.1', () => resolve(instance));});
    base = `http://127.0.0.1:${server.address().port}/api`;
    updated = (await api('/state')).body;
    assert.equal(updated.settings.planner.mode, 'day');
    assert.ok(updated.completedTasks.includes(task.id));
    assert.equal((await api(`/planner/tasks/${encodeURIComponent(task.id)}/complete`, 'POST', {completed: false})).status, 200);
    assert.ok(!(await api('/state')).body.completedTasks.includes(task.id));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('shifen-planner-test-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
});

test('legacy completion flows into the new planner and can be undone there without manufacturing old IDs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-planner-legacy-test-'));
  let server;
  try {
    server = await new Promise(resolve => {const instance = createApp({dataDir: dir, provider: {}}).listen(0, '127.0.0.1', () => resolve(instance));});
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const api = async (route, method = 'GET', body) => {
      const response = await fetch(`${base}${route}`, {method, headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
      return {status: response.status, body: await response.json()};
    };
    const old = (await api('/plan')).body.tasks[0];
    assert.ok(old && !old.id.endsWith(':planner'));
    const completion = `/planner/tasks/${encodeURIComponent(old.id)}/complete`;
    assert.equal((await api(completion, 'POST', {completed: true})).status, 404, 'new API cannot create an arbitrary legacy completion');
    assert.equal((await api(`/tasks/${encodeURIComponent(old.id)}/complete`, 'POST', {completed: true})).status, 200);
    let day = (await api('/planner?days=1')).body.days[0];
    assert.equal(day.tasks.find(task => task.id === old.id)?.minutes, old.minutes);
    assert.equal(day.completedMinutes, old.minutes);
    assert.ok(!day.tasks.some(task => task.courseId === old.courseId && task.kind === old.kind && !task.completed));
    assert.equal((await api(completion, 'POST', {completed: true})).status, 200, 'repeated completion is idempotent');
    assert.equal((await api('/state')).body.completedTasks.filter(id => id === old.id).length, 1);
    assert.equal((await api('/plan')).body.tasks.find(task => task.id === old.id)?.minutes, old.minutes, 'old API still sees the unchanged completion');
    assert.equal((await api(completion, 'POST', {completed: false})).status, 200);
    assert.ok(!(await api('/state')).body.completedTasks.includes(old.id));
    day = (await api('/planner?days=1')).body.days[0];
    assert.equal(day.completedMinutes, 0);
    assert.ok(!day.tasks.some(task => task.id === old.id));
    assert.equal((await api(completion, 'POST', {completed: true})).status, 404, 'undo does not turn the old ID into an available new task');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('shifen-planner-legacy-test-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
});
