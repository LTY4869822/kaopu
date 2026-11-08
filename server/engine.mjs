import { createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs';

const DAY = 86_400_000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('日期格式应为 YYYY-MM-DD');
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new RangeError('日期不存在');
  }
  return timestamp;
}

/**
 * Budget-constrained, explainable heuristic, not an exam-score predictor.
 * Reserve a short block for each course before allocating marginal five-minute
 * blocks by urgency / accumulated allocation. FSRS due dates are never changed.
 */
export function buildPlan(state, dateStr) {
  const day = calendarDate(dateStr);
  const budget = clamp(Math.floor(number(state.settings?.dailyMinutes, 150)), 0, 720);
  const endOfDay = Date.parse(`${dateStr}T23:59:59.999+08:00`);
  const completed = new Set(state.completedTasks ?? []);
  const warnings = [];
  const goal = state.settings?.goal ?? 'balanced';
  const courses = [];
  const courseIds = new Set((state.courses ?? []).map(course => course.id));
  const completedSnapshots = Object.entries(state.completedTaskDetails ?? {})
    .filter(([id, task]) => id.startsWith(`${dateStr}:`) && completed.has(id)
      && task && courseIds.has(task.courseId) && ['learn', 'practice', 'review'].includes(task.kind)
      && id === `${dateStr}:${task.courseId}:${task.kind}` && Number.isFinite(task.minutes) && task.minutes > 0)
    .map(([id, task]) => ({id, courseId: task.courseId, title: task.title, kind: task.kind,
      minutes: Math.floor(task.minutes), reason: task.reason, completed: true}));
  const completedIds = new Set(completedSnapshots.map(task => task.id));
  const spent = completedSnapshots.reduce((sum, task) => sum + task.minutes, 0);

  for (const course of state.courses ?? []) {
    if (course.examDate == null || course.examDate === '') {
      warnings.push(`${course.name}尚未设置考试日期，补充后可加入复习计划。`);
      continue;
    }
    let days;
    try { days = Math.round((calendarDate(course.examDate) - day) / DAY); }
    catch { warnings.push(`${course.name}的考试日期无效，请重新设置。`); continue; }
    if (days <= 0) {
      warnings.push(days === 0 ? `${course.name}今天考试，未安排新的学习任务。` : `${course.name}的考试日期已过，未纳入计划。`);
      continue;
    }
    const mastery = clamp(number(course.mastery), 0, 100);
    const target = clamp(number(course.target, 80), 1, 100);
    const documents = (state.documents ?? []).filter(item => item.courseId === course.id);
    const questions = (state.questions ?? []).filter(item => item.courseId === course.id);
    const dueCards = (state.cards ?? []).filter(item => item.courseId === course.id && Number.isFinite(Date.parse(item.due)) && Date.parse(item.due) <= endOfDay);
    const urgency = 1 + 3 / Math.sqrt(days);
    const weakness = 0.35 + (100 - mastery) / 100;
    const ambition = 0.75 + target / 200 + (goal === 'high' ? 0.15 : 0);
    const priority = urgency * weakness * ambition + Math.min(0.4, dueCards.length / 20);
    const baseReason = `距考试 ${days} 天，当前掌握估计 ${Math.round(mastery)}%，目标 ${target} 分`;
    let candidates = [];

    if (dueCards.length) {
      candidates.push({kind: 'review', title: `主动回忆 · ${dueCards.length} 张到期卡片`, max: Math.min(25, Math.max(10, dueCards.length * 2)), multiplier: 1.3,
        reason: `${dueCards.length} 张卡片已到复习时间；先回忆，再核对答案。${baseReason}。`});
    }
    if (questions.length) {
      const kindGoal = goal === 'pass' ? '基础题' : goal === 'high' ? '进阶练习' : '薄弱点练习';
      candidates.push({kind: 'practice', title: `${kindGoal} · ${questions[0].topic || course.name}`, max: days <= 3 ? 35 : 30, multiplier: mastery >= 50 ? 1.15 : 0.95,
        reason: `${baseReason}。用独立作答检查理解，错题反馈更新后续优先级。`});
    }
    if (documents.length) {
      candidates.push({kind: 'learn', title: mastery < 50 ? '补齐概念 · 梳理核心知识' : '重点回顾 · 回到原始资料', max: mastery < 50 ? 35 : 25, multiplier: mastery < 50 ? 1.2 : 0.85,
        reason: `${baseReason}。从 ${documents.length} 份课程资料中梳理定义、公式及适用条件。`});
    }
    if (!candidates.length) {
      candidates.push({kind: 'learn', title: '建立起点 · 补充资料与考试范围', max: 20, multiplier: 1,
        reason: `${baseReason}。先上传讲义、整理考试范围，再开始针对性复习。`});
      warnings.push(`${course.name}尚无资料、练习或到期卡片，先安排准备任务。`);
    }
    candidates = candidates.filter(task => !completedIds.has(`${dateStr}:${course.id}:${task.kind}`));
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.multiplier - a.multiplier);
    for (const candidate of candidates) candidate.minutes = 0;
    courses.push({course, priority, candidates, minutes: 0});
  }
  courses.sort((a, b) => b.priority - a.priority || String(a.course.id).localeCompare(String(b.course.id)));

  const remainingBudget = Math.max(0, budget - spent);
  let remaining = remainingBudget;
  // Every course receives one meaningful block when the budget permits it.
  for (const item of courses) {
    if (remaining <= 0) break;
    const minutes = Math.min(10, remaining, item.candidates[0].max);
    item.candidates[0].minutes += minutes;
    item.minutes += minutes;
    remaining -= minutes;
  }
  while (remaining > 0) {
    const choices = courses.flatMap(item => item.candidates
      .filter(task => task.minutes < task.max)
      .map(task => ({item, task, score: item.priority * task.multiplier / (15 + item.minutes) / (1 + task.minutes / task.max)})));
    if (!choices.length) break;
    choices.sort((a, b) => b.score - a.score || String(a.item.course.id).localeCompare(String(b.item.course.id)));
    const {item, task} = choices[0];
    const added = Math.min(remaining, 5, task.max - task.minutes);
    item.minutes += added;
    task.minutes += added;
    remaining -= added;
  }

  const tasks = courses.flatMap(item => item.candidates.filter(task => task.minutes > 0).map(task => {
    const id = `${dateStr}:${item.course.id}:${task.kind}`;
    return {id, courseId: item.course.id, title: task.title, kind: task.kind, minutes: task.minutes, reason: task.reason, completed: completed.has(id)};
  })).concat(completedSnapshots);
  const requested = courses.reduce((sum, item) => sum + item.candidates.reduce((subtotal, task) => subtotal + task.max, 0), 0);
  const unallocatedCourses = courses.filter(item => !item.minutes);
  if (unallocatedCourses.length) {
    warnings.push(`今天的时间不足以覆盖全部课程：${unallocatedCourses.map(item => item.course.name).join('、')}尚未安排。可调整预算或考试优先级。`);
  } else if (requested > remainingBudget && courses.length) {
    warnings.push(`剩余可选复习内容约 ${requested} 分钟，已压缩到剩余的 ${remainingBudget} 分钟；优先照顾临近考试和薄弱课程，其余留待后续安排。`);
  }
  if (spent > budget) warnings.unshift(`已完成 ${spent} 分钟，超过调整后的 ${budget} 分钟预算；保留真实记录，今天不再新增任务。`);
  if (budget === 0 && courses.length) warnings.push('今日可用时间为 0 分钟，请在设置中增加学习时间。');
  return {date: dateStr, budget, allocated: spent + remainingBudget - remaining, tasks, warnings};
}

const STOP_TERMS = new Set(['什么', '怎么', '如何', '为什么', '请问', '一下', '这个', '那个', '一个', '我们', '你们', '它们', '是否', '可以', '需要', '就是', '以及', '还有', '进行', '什么是', 'the', 'and', 'for', 'with', 'this', 'that', 'what', 'how', 'is', 'to', 'of', 'a', 'an']);

function tokenize(text) {
  const normalized = String(text ?? '').normalize('NFKC').toLowerCase();
  const terms = normalized.match(/[a-z][a-z0-9_]+|\d+(?:\.\d+)?/g) ?? [];
  // Character bigrams work without a model download and retain formula keywords.
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (run.length === 1) continue;
    for (let i = 0; i < run.length - 1; i++) terms.push(run.slice(i, i + 2));
  }
  return terms.filter(term => !STOP_TERMS.has(term));
}

function termCounts(terms) {
  const counts = new Map();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

/** Local lexical retrieval only. Scores mean relevance, never exam likelihood. */
export function retrieve(question, documents, courseId) {
  const query = [...new Set(tokenize(String(question ?? '').slice(0, 2000)))];
  if (!query.length) return [];
  const passages = (documents ?? []).filter(doc => !courseId || doc.courseId === courseId).flatMap(doc =>
    (doc.chunks ?? []).filter(chunk => typeof chunk.text === 'string' && chunk.text.trim()).map(chunk => {
      const terms = tokenize(chunk.text);
      const locationKind = doc.locationKind ?? (['DOCX', 'TXT', 'MD'].includes(String(doc.type ?? '').toUpperCase()) ? 'section' : 'page');
      return {documentName: doc.name, page: chunk.page, locationKind, text: chunk.text, terms, counts: termCounts(terms)};
    }));
  if (!passages.length) return [];
  const averageLength = passages.reduce((sum, chunk) => sum + chunk.terms.length, 0) / passages.length || 1;
  const documentFrequency = new Map(query.map(term => [term, passages.filter(chunk => chunk.counts.has(term)).length]));
  const k1 = 1.2;
  const b = 0.75;
  const ranked = passages.map(chunk => {
    let score = 0;
    let matched = 0;
    for (const term of query) {
      const tf = chunk.counts.get(term) ?? 0;
      if (!tf) continue;
      matched++;
      const df = documentFrequency.get(term);
      const idf = Math.log(1 + (passages.length - df + 0.5) / (df + 0.5));
      score += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * chunk.terms.length / averageLength));
    }
    // Give wider query coverage preference over a single repeated keyword.
    score *= 0.4 + 0.6 * matched / query.length;
    return {documentName: chunk.documentName, page: chunk.page, locationKind: chunk.locationKind, text: chunk.text, score: Number(score.toFixed(5))};
  }).filter(chunk => chunk.score > 0).sort((a, b) => b.score - a.score);
  const seen = new Set();
  return ranked.filter(chunk => {
    const key = `${chunk.documentName}\u0000${chunk.page}\u0000${chunk.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

/** Extractive summary: every returned phrase comes from the original source. */
export function extractSummary(chunks, locationKind = 'page') {
  const candidates = [];
  const seen = new Set();
  for (const chunk of chunks ?? []) {
    const sentences = String(chunk.text ?? '').replace(/\r/g, '').split(/(?<=[。！？；.!?;])\s*|\n+/u);
    for (const sentence of sentences) {
      const text = sentence.trim().replace(/\s+/g, ' ');
      if (text.length < 8 || seen.has(text)) continue;
      seen.add(text);
      candidates.push({text, page: chunk.page, terms: tokenize(text), index: candidates.length});
    }
  }
  if (!candidates.length) return [];
  const frequency = termCounts(candidates.flatMap(item => [...new Set(item.terms)]));
  for (const item of candidates) {
    const centrality = [...new Set(item.terms)].reduce((sum, term) => sum + Math.log(1 + (frequency.get(term) ?? 0)), 0) / Math.sqrt(Math.max(1, item.terms.length));
    const structure = /定义|定理|性质|公式|条件|步骤|重点|结论|注意|方法|概念|definition|theorem|formula/i.test(item.text) ? 2 : 0;
    item.score = centrality + structure + 1 / (item.index + 1);
  }
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const selected = [];
  const pageCounts = new Map();
  for (const item of ranked) {
    // Keep a single long page from occupying all six summary slots.
    if (pageCounts.get(item.page) >= 2 && new Set(candidates.map(row => row.page)).size > 2) continue;
    selected.push(item);
    pageCounts.set(item.page, (pageCounts.get(item.page) ?? 0) + 1);
    if (selected.length >= 6) break;
  }
  return selected.sort((a, b) => a.index - b.index).map(item => {
    const text = item.text.length > 220 ? `${item.text.slice(0, 220)}…` : item.text;
    return `${text}${Number.isFinite(Number(item.page)) ? `（第 ${item.page} ${locationKind === 'section' ? '段' : '页'}）` : ''}`;
  });
}

const memoryScheduler = fsrs(generatorParameters({request_retention: 0.9, enable_fuzz: false}));

/** Real FSRS scheduling. The planner may add study blocks but never cap FSRS due. */
export function scheduleCard(card, rating, nowDate = new Date()) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) throw new RangeError('记忆评分应为 1 至 4');
  const now = new Date(nowDate);
  if (!Number.isFinite(now.getTime())) throw new RangeError('复习时间无效');
  const current = card.fsrs ? {...card.fsrs} : createEmptyCard(now);
  current.due = new Date(current.due);
  if (current.last_review) current.last_review = new Date(current.last_review);
  if (!Number.isFinite(current.due.getTime()) || (current.last_review && !Number.isFinite(current.last_review.getTime()))) {
    throw new RangeError('记忆卡时间记录无效');
  }
  if (current.last_review && current.last_review.getTime() > now.getTime()) throw new RangeError('复习时间不能早于上次记录');
  const scheduled = memoryScheduler.next(current, now, rating).card;
  return {...card, due: scheduled.due.toISOString(), fsrs: JSON.parse(JSON.stringify(scheduled))};
}

/** Small prior-weighted update; this is a study signal, not a calibrated score. */
export function updateMastery(current, correct, difficulty) {
  const prior = clamp(number(current), 0, 100) / 100;
  const level = String(difficulty ?? '').toLowerCase();
  const hard = /hard|挑战|困难|难题|进阶/.test(level);
  const easy = /easy|基础|简单/.test(level);
  const weight = correct ? (hard ? 1.25 : easy ? 0.75 : 1) : (hard ? 0.75 : easy ? 1.25 : 1);
  const updated = (prior * 8 + (correct ? weight : 0)) / (8 + weight);
  return Math.round(clamp(updated * 100, 0, 100) * 10) / 10;
}
