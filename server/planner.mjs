/**
 * Rolling-horizon study planner. Deadline/slack-aware marginal allocation and
 * deterministic time-window packing; no score prediction or optimality claim.
 * Calendar dates and the live clock use Asia/Shanghai throughout.
 */
import { examReviewFocus } from './exams.mjs';
const DAY = 86_400_000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fail = message => { throw Object.assign(new Error(message), {status: 400}); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const plannerToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai'}).format(now);
export const validPlannerDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const stamp = value => Date.parse(`${value}T00:00:00Z`);
const addDays = (date, count) => new Date(stamp(date) + count * DAY).toISOString().slice(0, 10);
const distance = (a, b) => Math.round((stamp(b) - stamp(a)) / DAY);
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const time = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const validHours = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 300;

function validateWindows(value) {
  if (!Array.isArray(value) || value.length > 6) fail('每天最多设置 6 个复习时段。');
  const windows = value.map(item => {
    if (!object(item) || !validTime(item.start) || !validTime(item.end) || item.start >= item.end) fail('复习时段需为同一天内有效的开始和结束时间。');
    return {start: item.start, end: item.end};
  }).sort((a, b) => a.start.localeCompare(b.start));
  if (windows.some((item, i) => i && item.start < windows[i - 1].end)) fail('复习时段不能重叠，请调整后保存。');
  return windows;
}

export function plannerSettings(state, now = new Date()) {
  const input = state.settings?.planner || {};
  return {
    startDate: validPlannerDate(input.startDate) ? input.startDate : plannerToday(now),
    mode: input.mode === 'day' ? 'day' : 'timeline',
    goal: ['pass', 'high', 'balanced'].includes(state.settings?.goal) ? state.settings.goal : 'balanced',
    blockMinutes: [25, 40, 50].includes(input.blockMinutes) ? input.blockMinutes : 40,
    breakMinutes: [5, 10].includes(input.breakMinutes) ? input.breakMinutes : 10,
    reservePercent: clamp(Math.floor(finite(input.reservePercent, 10)), 0, 25),
    windows: Array.isArray(input.windows) ? input.windows : [{start: '19:00', end: '23:00'}],
    weeklyMinutes: Array.isArray(input.weeklyMinutes) && input.weeklyMinutes.length === 7 ? input.weeklyMinutes : Array(7).fill(clamp(Math.floor(finite(state.settings?.dailyMinutes, 150)), 0, 720)),
    overrides: Array.isArray(input.overrides) ? input.overrides : [],
  };
}

/** Validate into detached copies so one bad field never partially saves. */
export function applyPlannerPatch(state, body, now = new Date()) {
  if (!object(body) || (body.settings === undefined && body.courses === undefined)) fail('请提供复习偏好或课程信息。');
  if (Object.keys(body).some(key => !['settings', 'courses'].includes(key))) fail('包含不支持的规划设置。');
  const nextSettings = {...state.settings};
  const nextPlanner = {...(state.settings?.planner || {})};
  const nextCourses = state.courses.map(course => ({...course}));
  if (body.settings !== undefined) {
    if (!object(body.settings)) fail('复习偏好格式无效。');
    const value = body.settings;
    const accepted = new Set(['startDate', 'mode', 'goal', 'blockMinutes', 'breakMinutes', 'reservePercent', 'windows', 'weeklyMinutes', 'overrides']);
    if (Object.keys(value).some(key => !accepted.has(key))) fail('包含不支持的复习偏好字段。');
    if (value.startDate !== undefined) { if (!validPlannerDate(value.startDate)) fail('请选择有效的准备开始日期。'); nextPlanner.startDate = value.startDate; }
    if (value.mode !== undefined) { if (!['day', 'timeline'].includes(value.mode)) fail('请选择按天或时间线模式。'); nextPlanner.mode = value.mode; }
    if (value.goal !== undefined) { if (!['pass', 'balanced', 'high'].includes(value.goal)) fail('请选择有效的复习目标。'); nextSettings.goal = value.goal; }
    if (value.blockMinutes !== undefined) { if (![25, 40, 50].includes(value.blockMinutes)) fail('专注时长请选择 25、40 或 50 分钟。'); nextPlanner.blockMinutes = value.blockMinutes; }
    if (value.breakMinutes !== undefined) { if (![5, 10].includes(value.breakMinutes)) fail('休息时长请选择 5 或 10 分钟。'); nextPlanner.breakMinutes = value.breakMinutes; }
    if (value.reservePercent !== undefined) { if (!integer(value.reservePercent, 0, 25)) fail('弹性缓冲需在 0–25% 之间。'); nextPlanner.reservePercent = value.reservePercent; }
    if (value.windows !== undefined) nextPlanner.windows = validateWindows(value.windows);
    if (value.weeklyMinutes !== undefined) {
      if (!Array.isArray(value.weeklyMinutes) || value.weeklyMinutes.length !== 7 || !value.weeklyMinutes.every(item => integer(item, 0, 720))) fail('请为周一到周日分别填写 0–720 分钟。');
      nextPlanner.weeklyMinutes = [...value.weeklyMinutes];
    }
    if (value.overrides !== undefined) {
      if (!Array.isArray(value.overrides) || value.overrides.length > 90) fail('单日调整最多保留 90 天。');
      const dates = new Set();
      nextPlanner.overrides = value.overrides.map(item => {
        if (!object(item) || !validPlannerDate(item.date) || !integer(item.minutes, 0, 720) || dates.has(item.date)) fail('单日调整需使用不重复的有效日期和 0–720 分钟。');
        dates.add(item.date);
        return {date: item.date, minutes: item.minutes, ...(item.windows !== undefined ? {windows: validateWindows(item.windows)} : {})};
      }).sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  if (body.courses !== undefined) {
    if (!Array.isArray(body.courses) || body.courses.length > 30) fail('课程设置格式无效。');
    const seen = new Set();
    for (const input of body.courses) {
      if (!object(input) || typeof input.id !== 'string' || seen.has(input.id)) fail('课程设置含有重复或无效的课程。');
      seen.add(input.id);
      const course = nextCourses.find(item => item.id === input.id);
      if (!course) fail('课程已被删除，请刷新后重试。');
      const accepted = new Set(['id', 'examDate', 'examTime', 'difficulty', 'target', 'mastery', 'remainingHours', 'prepStartDate']);
      if (Object.keys(input).some(key => !accepted.has(key))) fail('包含不支持的课程规划字段。');
      if (input.examDate !== undefined) { if (input.examDate !== '' && !validPlannerDate(input.examDate)) fail('请选择有效的考试日期。'); course.examDate = input.examDate; }
      if (input.examTime !== undefined) { if (input.examTime !== '' && !validTime(input.examTime)) fail('请选择有效的考试时间。'); course.examTime = input.examTime; }
      if (input.prepStartDate !== undefined) { if (input.prepStartDate !== '' && !validPlannerDate(input.prepStartDate)) fail('请选择有效的课程准备日期。'); course.prepStartDate = input.prepStartDate; }
      if (input.difficulty !== undefined) { if (!integer(input.difficulty, 1, 5)) fail('课程难度应为 1–5 级。'); course.difficulty = input.difficulty; }
      if (input.target !== undefined) { if (typeof input.target !== 'number' || !Number.isFinite(input.target) || input.target < 1 || input.target > 100) fail('目标分数应在 1–100 之间。'); course.target = Math.round(input.target); }
      if (input.mastery !== undefined) { if (typeof input.mastery !== 'number' || !Number.isFinite(input.mastery) || input.mastery < 0 || input.mastery > 100) fail('掌握程度应在 0–100 之间。'); course.mastery = Math.round(input.mastery); }
      if (input.remainingHours !== undefined) {
        if (input.remainingHours !== null && !validHours(input.remainingHours)) fail('剩余复习时长应为 0–300 小时，留空可恢复估算。');
        if (input.remainingHours === null) { delete course.remainingHours; delete course.planningBaselineCompletedMinutes; }
        else if (course.remainingHours !== input.remainingHours) {
          course.remainingHours = input.remainingHours;
          course.planningBaselineCompletedMinutes = completedRecords(state).filter(item => item.courseId === course.id).reduce((sum, item) => sum + item.minutes, 0);
          course.planningBaselineAt = now.toISOString();
        }
      }
      if (course.examDate && course.prepStartDate && course.prepStartDate >= course.examDate) fail(`${course.name}的准备开始日期需早于考试日期。`);
    }
  }
  nextSettings.planner = nextPlanner;
  return {settings: nextSettings, courses: nextCourses};
}

function completedRecords(state) {
  const done = new Set(state.completedTasks || []);
  const courses = new Set(state.courses.map(course => course.id));
  return Object.entries(state.completedTaskDetails || {}).filter(([id, task]) => done.has(id) && task && courses.has(task.courseId)
    && ['learn', 'practice', 'review'].includes(task.kind)
    && [ `${id.slice(0, 10)}:${task.courseId}:${task.kind}`, `${id.slice(0, 10)}:${task.courseId}:${task.kind}:planner` ].includes(id)
    && validPlannerDate(id.slice(0, 10)) && Number.isInteger(task.minutes) && task.minutes > 0)
    .map(([id, task]) => ({...task, id, date: id.slice(0, 10), completed: true}));
}

function budgetFor(settings, date) {
  const override = settings.overrides.find(item => item.date === date);
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return {minutes: override?.minutes ?? settings.weeklyMinutes[weekday], windows: override?.windows ?? settings.windows};
}
function capacity(budget, block, rest) {
  // Count breaks only between sessions, never after the final session.
  let study = 0, remaining = budget;
  while (remaining > 0) {
    const part = Math.min(block, remaining); study += part; remaining -= part;
    if (remaining <= rest) break;
    remaining -= rest;
  }
  return study;
}
const phase = (days, mastery) => days <= 3 ? '考前冲刺' : days <= 7 ? '集中巩固' : mastery < 45 ? '补齐基础' : '稳步提分';

function workload(state, course, records) {
  const manual = validHours(course.remainingHours);
  const difficulty = clamp(Math.round(finite(course.difficulty, 3)), 1, 5);
  const mastery = clamp(finite(course.mastery), 0, 100);
  const target = clamp(finite(course.target, 80), 1, 100);
  const chapters = clamp(finite(course.chapters, 6) || 6, 1, 30);
  const goalFactor = state.settings?.goal === 'pass' ? 0.8 : state.settings?.goal === 'high' ? 1.25 : 1;
  const raw = manual ? Math.round(course.remainingHours * 60)
    : Math.round(Math.max(60, chapters * (25 + difficulty * 12) * (.3 + Math.max(0, target - mastery) / 65) * goalFactor) / 5) * 5;
  const totalDone = records.filter(item => item.courseId === course.id).reduce((sum, item) => sum + item.minutes, 0);
  const credited = Math.max(0, totalDone - (manual ? finite(course.planningBaselineCompletedMinutes) : 0));
  return {minutes: Math.max(0, raw - credited), estimated: !manual, difficulty, mastery, target};
}

function candidatesFor(state, item, date, goal) {
  const course = item.course;
  const days = distance(date, course.examDate);
  const dueEnd = Date.parse(`${date}T23:59:59.999+08:00`);
  const documents = state.documents.filter(doc => doc.courseId === course.id);
  const questions = state.questions.filter(question => question.courseId === course.id);
  const due = state.cards.filter(card => card.courseId === course.id && Date.parse(card.due) <= dueEnd);
  const details = `距考试 ${days} 天，难度 ${item.difficulty}/5，掌握估计 ${Math.round(item.mastery)}%，目标 ${item.target} 分`;
  const choices = [];
  const examFocus = examReviewFocus(state, course.id);
  if (due.length) choices.push({kind: 'review', title: `主动回忆 · ${due.length} 张到期卡片`, weight: 1.3,
    max: Math.min(30, Math.max(10, due.length * 3)), reason: `${details}；复习已到期卡片，保持提取练习。`, action: 'memory'});
  if (examFocus) choices.push({kind: 'practice', title: `模拟考订正 · ${examFocus.topics.join('、') || '错题与未答题'}`, weight: 1.5,
    max: Math.min(90, Math.max(15, examFocus.questionIds.length * 8)), reason: `${details}；最近一轮模考有${examFocus.questionIds.length}道错题、未答题或自评待订正项。回看解法与来源后再练，不直接改变掌握度。`, action: 'exams', attemptId: examFocus.attemptId});
  else if (questions.length) choices.push({kind: 'practice', title: goal === 'pass' ? '基础巩固 · 独立作答与订正' : goal === 'high' ? '强化练习 · 作答、订正与方法复盘' : '薄弱点练习 · 作答与订正',
    weight: goal === 'high' ? 1.5 : goal === 'pass' ? 1.05 : 1.25, max: 120,
    reason: `${details}；使用已有练习检查理解。题目难度以实际题库为准。`, action: 'practice'});
  if (documents.length) choices.push({kind: 'learn', title: days <= 3 ? '考前回顾 · 核心概念与适用条件' : item.mastery < 45 ? '补齐基础 · 梳理课程资料' : '重点回顾 · 原文与主动回忆',
    weight: item.mastery < 45 ? (goal === 'pass' ? 1.5 : 1.3) : .9, max: 120,
    reason: `${details}；从 ${documents.length} 份已上传资料中整理定义、公式和适用条件。`, action: 'materials'});
  if (!choices.length) choices.push({kind: 'learn', title: '准备复习 · 补充资料与确认考试范围', weight: 1, max: 30,
    reason: `${details}；当前缺少资料和题库，先上传讲义并确认考试范围。`, action: 'materials'});
  return choices;
}

function consolidateTasks(choices, total) {
  // Minute-level competition decides each course's total. Within that total,
  // open a meaningful activity rather than publishing three tiny fragments.
  // Completed snapshots never enter this redistribution.
  const consolidated = choices.map(choice => ({...choice, minutes: 0}));
  const review = consolidated.find(choice => choice.kind === 'review');
  const main = consolidated.filter(choice => choice.kind !== 'review').sort((a, b) => b.weight - a.weight || a.kind.localeCompare(b.kind));
  if (!main.length) {
    if (review) review.minutes = total;
    return consolidated;
  }
  let remaining = total;
  if (review && total >= 30) { review.minutes = Math.min(10, review.max); remaining -= review.minutes; }
  else if (review && total <= 10 && review.weight >= main[0].weight) { review.minutes = total; return consolidated; }
  // A second substantial activity earns its place after the principal task
  // has enough uninterrupted time; a 20+5 split is one 25-minute activity.
  if (main.length > 1 && remaining >= 50) {
    main[1].minutes = Math.min(main[1].max, Math.max(20, Math.floor(remaining * .35 / 5) * 5));
    remaining -= main[1].minutes;
  }
  for (const choice of [...main, ...(review ? [review] : [])]) {
    const added = Math.min(remaining, choice.max - choice.minutes);
    choice.minutes += added; remaining -= added;
  }
  // In unusual cap-bound cases preserve every assigned minute. Merge tails
  // only when the recipient has capacity; tiny total budgets remain honest.
  for (const tail of consolidated.filter(choice => choice.minutes > 0 && choice.minutes < 10)) {
    const recipient = main.find(choice => choice !== tail && choice.minutes > 0 && choice.minutes + tail.minutes <= choice.max)
      || consolidated.find(choice => choice !== tail && choice.minutes > 0 && choice.minutes + tail.minutes <= choice.max);
    if (recipient) { recipient.minutes += tail.minutes; tail.minutes = 0; }
  }
  return consolidated;
}

function packTasks(tasks, windows, settings, date, now, breakBudget) {
  const today = plannerToday(now);
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now);
  const currentMinute = minute(parts) + 1;
  const spans = windows.map(window => ({start: minute(window.start), end: minute(window.end)}));
  const fixed = tasks.filter(task => task.completed).flatMap(task => (task.plannedSlots || []).filter(slot => validTime(slot.start) && validTime(slot.end) && slot.start < slot.end)
    .map(slot => ({...slot, taskId: task.id, kind: 'study', minutes: minute(slot.end) - minute(slot.start)})));
  const slots = [...fixed];
  const free = [];
  for (const span of spans) {
    let cursor = date === today ? Math.max(span.start, currentMinute) : span.start;
    if (date < today) cursor = span.end;
    for (const occupied of fixed.map(slot => ({start: minute(slot.start), end: minute(slot.end)})).sort((a, b) => a.start - b.start)) {
      if (occupied.end <= cursor || occupied.start >= span.end) continue;
      if (occupied.start > cursor) free.push({start: cursor, end: Math.min(occupied.start, span.end)});
      cursor = Math.max(cursor, occupied.end);
    }
    if (cursor < span.end) free.push({start: cursor, end: span.end});
  }
  const pending = tasks.filter(task => !task.completed).map(task => ({task, left: task.minutes}));
  let sessionUsed = 0;
  let breaksUsed = 0;
  const piece = item => item.left > settings.blockMinutes ? Math.ceil(item.left / Math.ceil(item.left / settings.blockMinutes)) : item.left;
  for (let spanIndex = 0; spanIndex < free.length; spanIndex++) {
    const span = free[spanIndex];
    let cursor = span.start;
    sessionUsed = 0;
    while (cursor < span.end && pending.some(item => item.left > 0)) {
      const focusLeft = settings.blockMinutes - sessionUsed;
      const windowLeft = span.end - cursor;
      const candidates = pending.filter(item => item.left > 0);
      let item = candidates.find(item => piece(item) <= focusLeft && piece(item) <= windowLeft);
      if (!item && !candidates.some(item => piece(item) <= focusLeft)) {
        // Take an early break rather than turn a complete 20-minute task into
        // 2 minutes now and 18 later. Extra breaks still consume the day budget.
        if (cursor + settings.breakMinutes >= span.end || breaksUsed + settings.breakMinutes > breakBudget) break;
        slots.push({id: `${date}:break:${cursor}`, kind: 'break', start: time(cursor), end: time(cursor + settings.breakMinutes), minutes: settings.breakMinutes});
        cursor += settings.breakMinutes; breaksUsed += settings.breakMinutes; sessionUsed = 0;
        continue;
      }
      let used;
      if (item) used = piece(item);
      else {
        item = candidates.find(item => piece(item) <= focusLeft);
        // A real window boundary can force a split. If a later window can hold
        // the complete piece, carry it there instead of using a tiny edge.
        if (free.slice(spanIndex + 1).some(later => later.end - later.start >= piece(item))) break;
        used = Math.min(piece(item), focusLeft, windowLeft);
        const tail = item.left - used;
        if (tail > 0 && tail < 10 && used >= 20) used -= 10 - tail;
      }
      slots.push({id: `${item.task.id}:${cursor}`, taskId: item.task.id, kind: 'study', start: time(cursor), end: time(cursor + used), minutes: used});
      cursor += used; item.left -= used; sessionUsed += used;
    }
  }
  slots.sort((a, b) => a.start.localeCompare(b.start));
  return {slots, unscheduledMinutes: pending.reduce((sum, item) => sum + item.left, 0), breakMinutes: slots.filter(slot => slot.kind === 'break').reduce((sum, slot) => sum + slot.minutes, 0)};
}

export function buildPlanner(state, {date = plannerToday(), days = 14, now = new Date()} = {}) {
  if (!validPlannerDate(date)) fail('计划日期无效。');
  if (!integer(days, 1, 90)) fail('预览天数需为 1–90 天。');
  const today = plannerToday(now);
  if (Math.abs(distance(today, date)) > 365) fail('请选择前后一年以内的计划日期。');
  const settings = plannerSettings(state, now);
  const records = completedRecords(state);
  const warnings = [];
  const items = state.courses.map(course => {
    const work = workload(state, course, records);
    const daysLeft = validPlannerDate(course.examDate) ? distance(today, course.examDate) : null;
    const prep = validPlannerDate(course.prepStartDate) ? course.prepStartDate : settings.startDate;
    const start = prep > settings.startDate ? prep : settings.startDate;
    const status = daysLeft === null ? 'missing-date' : daysLeft <= 0 ? 'finished' : start > today ? 'not-started' : 'ready';
    return {course, ...work, remaining: work.minutes, scheduled: 0, timelineScheduled: 0, daysLeft, start, status};
  });
  const displayEnd = addDays(date, days - 1);
  // Demand assessment always reaches the full 90-day assessment boundary, not
  // merely the 14-day preview. Deadlines beyond it are disclosed below.
  const assessmentEnd = addDays(today, 89);
  const simulationEnd = displayEnd > assessmentEnd ? displayEnd : assessmentEnd;
  const simulationStart = date < today ? date : today;
  const output = [];
  for (let day = simulationStart; day <= simulationEnd; day = addDays(day, 1)) {
    const available = budgetFor(settings, day);
    const budget = clamp(Math.floor(finite(available.minutes)), 0, 720);
    const reserveMinutes = Math.floor(budget * settings.reservePercent / 100);
    const done = records.filter(task => task.date === day).map(({date: _date, ...task}) => task);
    const doneMinutes = done.reduce((sum, task) => sum + task.minutes, 0);
    const dayWarnings = [];
    const studyLimit = capacity(Math.max(0, budget - reserveMinutes), settings.blockMinutes, settings.breakMinutes);
    let remaining = Math.max(0, studyLimit - doneMinutes);
    const dayAllocations = [];
    if (day >= today && day >= settings.startDate) {
      const active = items.filter(item => item.status !== 'missing-date' && day < item.course.examDate && day >= item.start && item.remaining > 0);
      for (const item of active) {
        const choices = candidatesFor(state, item, day, settings.goal).filter(choice => !done.some(task => task.courseId === item.course.id && task.kind === choice.kind));
        const futureCapacity = Array.from({length: Math.min(90, Math.max(0, distance(day, item.course.examDate)))}, (_, i) => addDays(day, i))
          .filter(value => value >= item.start).reduce((sum, value) => {
            const valueBudget = budgetFor(settings, value).minutes;
            return sum + capacity(Math.max(0, valueBudget - Math.floor(valueBudget * settings.reservePercent / 100)), settings.blockMinutes, settings.breakMinutes);
          }, 0);
        const pressure = item.remaining / Math.max(5, futureCapacity);
        const daysLeft = Math.max(1, distance(day, item.course.examDate));
        const goalWeight = settings.goal === 'pass' ? 1 + Math.max(0, 60 - item.mastery) / 65 : settings.goal === 'high' ? 1 + item.target / 120 : 1 + Math.max(0, item.target - item.mastery) / 130;
        const priority = (1 + 4 / Math.sqrt(daysLeft)) * (1 + Math.min(4, pressure) * 2) * (0.8 + item.difficulty / 5) * goalWeight;
        dayAllocations.push({item, choices: choices.map(choice => ({...choice, minutes: 0})), minutes: 0, priority});
      }
      // Protect deadline prefixes before marginal scoring. Work for a late,
      // difficult exam must not consume capacity required by an earlier exam.
      // This is an EDF feasibility guard for preemptible minute budgets, not
      // a claim to solve the full release-date / study-effect optimization.
      const deadlines = [...new Set(active.map(item => item.course.examDate))].sort();
      for (const deadline of deadlines) {
        const prefix = dayAllocations.filter(allocation => allocation.item.course.examDate <= deadline);
        const demand = prefix.reduce((sum, allocation) => sum + allocation.item.remaining, 0);
        let laterCapacity = 0;
        for (let future = addDays(day, 1); future < deadline && future <= assessmentEnd; future = addDays(future, 1)) {
          if (future < settings.startDate) continue;
          const futureBudget = budgetFor(settings, future).minutes;
          laterCapacity += capacity(Math.max(0, futureBudget - Math.floor(futureBudget * settings.reservePercent / 100)), settings.blockMinutes, settings.breakMinutes);
        }
        let required = Math.max(0, demand - laterCapacity - prefix.reduce((sum, allocation) => sum + allocation.minutes, 0));
        for (const allocation of [...prefix].sort((a, b) => a.item.course.examDate.localeCompare(b.item.course.examDate) || a.item.course.id.localeCompare(b.item.course.id))) {
          while (required > 0 && remaining > 0 && allocation.minutes < allocation.item.remaining) {
            const choice = [...allocation.choices].filter(choice => choice.minutes < choice.max)
              .sort((a, b) => b.weight / (1 + b.minutes / 35) - a.weight / (1 + a.minutes / 35))[0];
            if (!choice) break;
            const used = Math.min(5, required, remaining, choice.max - choice.minutes, allocation.item.remaining - allocation.minutes);
            choice.minutes += used; allocation.minutes += used; remaining -= used; required -= used;
          }
        }
      }
      while (remaining > 0) {
        const choices = dayAllocations.flatMap(allocation => allocation.choices.filter(choice => choice.minutes < choice.max && allocation.minutes < allocation.item.remaining)
          .map(choice => ({allocation, choice, score: allocation.priority * choice.weight / (15 + allocation.minutes) / (1 + choice.minutes / 35)})));
        choices.sort((a, b) => b.score - a.score || a.allocation.item.course.id.localeCompare(b.allocation.item.course.id) || a.choice.kind.localeCompare(b.choice.kind));
        if (!choices.length) break;
        const {allocation, choice} = choices[0];
        const used = Math.min(5, remaining, choice.max - choice.minutes, allocation.item.remaining - allocation.minutes);
        choice.minutes += used; allocation.minutes += used; remaining -= used;
      }
    }
    const tasks = [...done];
    for (const allocation of dayAllocations) {
      allocation.item.remaining -= allocation.minutes;
      allocation.item.scheduled += allocation.minutes;
      for (const choice of consolidateTasks(allocation.choices, allocation.minutes).filter(choice => choice.minutes > 0)) {
        const {weight: _weight, max: _max, ...task} = choice;
        tasks.push({...task, id: `${day}:${allocation.item.course.id}:${choice.kind}:planner`, courseId: allocation.item.course.id, completed: false});
      }
    }
    const allocated = tasks.reduce((sum, task) => sum + task.minutes, 0);
    const packed = packTasks(tasks, available.windows, settings, day, now, Math.max(0, budget - reserveMinutes - allocated));
    if (day >= today && day <= assessmentEnd) {
      for (const slot of packed.slots.filter(slot => slot.kind === 'study')) {
        const task = tasks.find(task => task.id === slot.taskId && !task.completed);
        if (task) items.find(item => item.course.id === task.courseId).timelineScheduled += slot.minutes;
      }
    }
    if (day === today && packed.unscheduledMinutes > 0) dayWarnings.push(packed.slots.some(slot => slot.kind === 'study' && !done.some(task => task.id === slot.taskId))
      ? `今天的剩余时段放不下 ${packed.unscheduledMinutes} 分钟任务。可调整今天的时段，或使用按天模式完成。`
      : `今天已没有足够的未来可用时段，${packed.unscheduledMinutes} 分钟任务仍保留在按天清单中。可调整今天的时段。`);
    else if (packed.unscheduledMinutes > 0 && day >= today) dayWarnings.push(`设置的时段放不下 ${packed.unscheduledMinutes} 分钟任务，可增加时段或减少当天预算。`);
    if (doneMinutes > budget) dayWarnings.push(`已完成 ${doneMinutes} 分钟，超过当前 ${budget} 分钟预算；保留历史记录，今天不再追加。`);
    if (day < settings.startDate && day >= today) dayWarnings.push(`准备从 ${settings.startDate} 开始，这一天不安排新任务。`);
    if (day >= date && day <= displayEnd) output.push({date: day, budget, allocated, completedMinutes: doneMinutes, reserveMinutes, ...packed, tasks, warnings: dayWarnings});
  }
  const summaries = items.map(item => {
    const assessed = item.status !== 'missing-date' && item.daysLeft > 0 && item.daysLeft <= 90;
    const shortfallMinutes = assessed ? item.remaining : 0;
    if (item.status === 'missing-date') warnings.push(`${item.course.name}还没有考试日期，暂不加入排期。`);
    else if (item.daysLeft > 90) warnings.push(`${item.course.name}考试在 90 天评估范围之外，尚未判断最终时间缺口。`);
    else if (shortfallMinutes > 0) warnings.push(`${item.course.name}按当前设置，考前仍缺约 ${shortfallMinutes} 分钟复习时间。可调整目标、剩余时长或可用时间。`);
    return {courseId: item.course.id, remainingMinutes: item.minutes, scheduledMinutes: item.scheduled, shortfallMinutes,
      timelineScheduledMinutes: item.timelineScheduled, timelineShortfallMinutes: assessed ? Math.max(0, item.minutes - item.timelineScheduled) : 0,
      daysLeft: item.daysLeft, estimated: item.estimated,
      status: item.status, phase: item.daysLeft === null ? '待补考试日期' : item.daysLeft <= 0 ? '考试已到或已结束' : phase(item.daysLeft, item.mastery)};
  });
  const timelineExtra = summaries.reduce((sum, item) => sum + Math.max(0, item.timelineShortfallMinutes - item.shortfallMinutes), 0);
  if (timelineExtra) warnings.push(`工作量缺口按每日预算测算；另有 ${timelineExtra} 分钟已分配的任务未放入当前可用时段。时间线仍需调整时段，或在按天模式自行完成。`);
  const deadlines = [...new Set(items.filter(item => item.daysLeft > 0 && item.daysLeft <= 90).map(item => item.course.examDate))].sort();
  for (const deadline of deadlines) {
    const prefix = items.filter(item => item.daysLeft > 0 && item.course.examDate <= deadline);
    const demand = prefix.reduce((sum, item) => sum + item.minutes, 0);
    let supply = 0;
    for (let value = today; value < deadline; value = addDays(value, 1)) {
      if (value < settings.startDate) continue;
      const daily = budgetFor(settings, value).minutes;
      supply += capacity(Math.max(0, daily - Math.floor(daily * settings.reservePercent / 100)), settings.blockMinutes, settings.breakMinutes);
    }
    if (demand > supply) { warnings.unshift(`最早时间瓶颈在 ${deadline}：此前考试的课程合计至少缺 ${demand - supply} 分钟，已优先保障更早截止的任务。`); break; }
  }
  return {date, days: output, courses: summaries, warnings, algorithm: 'rolling-slack-v1', generatedAt: now.toISOString(), settings,
    assessmentEnd, explanation: '按截止日期、剩余工作量、难度与掌握程度分配时间；预留缓冲，时间线按真实时段装入任务。属于可解释启发式，不预测成绩。'};
}
