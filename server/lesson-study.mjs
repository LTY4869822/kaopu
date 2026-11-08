import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const error = (status, message) => Object.assign(new Error(message), { status });
const sections = lesson => lesson.notes?.readingSections?.length ? lesson.notes.readingSections : lesson.notes?.sections || [];
const examples = lesson => lesson.notes?.readingExamples?.length ? lesson.notes.readingExamples : lesson.notes?.examples || [];
const signature = item => digest(item);
const itemsFor = lesson => new Map([...sections(lesson).map(item => [`section:${item.id}`, item]), ...examples(lesson).map(item => [`example:${item.id}`, item])]);

/** Processing counts describe source handling, never teaching accuracy or mastery. */
export function lessonStudy(lesson) {
  const items = itemsFor(lesson);
  const version = digest([lesson.cues, lesson.visual?.id, lesson.visual?.observations, lesson.notes]);
  const marks = {};
  for (const [key, item] of items) {
    const saved = lesson.study?.marks?.[key];
    if (saved?.signature === signature(item)) marks[key] = saved.status;
  }
  const saved = lesson.study?.bookmark;
  const bookmarked = saved && items.get(`${saved.kind}:${saved.id}`);
  const bookmark = bookmarked && saved.signature === signature(bookmarked) ? { kind: saved.kind, id: saved.id, title: bookmarked.title } : null;
  const issues = [];
  const add = (kind, id, title, detail, extra = {}) => issues.push({ kind, id, title, detail, ...extra });
  if (lesson.notes?.evidenceOutdated) add('notes', 'outdated', '新画面尚未合入讲义', '现有讲义已保留。更新讲义后再归档或出题。');
  const observed = new Map((lesson.visual?.observations || []).map(item => [item.frameId, item]));
  for (const frame of lesson.visual?.frames || []) {
    const observation = observed.get(frame.id);
    if (!observation) add('frame', frame.id, '这张板书还未识别', '重试未完成画面，不必重新导入整节课。', { time: frame.time, action: 'read' });
    else if (observation.uncertainties?.length) add('frame', frame.id, '板书有模糊内容', observation.uncertainties.join('；').slice(0, 600), { time: frame.time });
  }
  for (const item of examples(lesson)) {
    if (item.explanationStatus === 'needs-confirmation' || !item.prompt?.trim()) add('example', item.id, item.title, item.explanationGap || '题干条件不完整，请对照原文、原图核对。');
    else if (!item.detailedSolution?.trim() && !item.solutionSteps?.length) add('example', item.id, item.title, '还没有详细题解，可以补齐后再核对。', { action: 'enrich' });
  }
  for (const id of lesson.sourceDiagnostics?.reviewCueIds || []) {
    const cue = lesson.cues.find(item => item.id === id);
    if (cue) add('cue', id, '这段转写需要回听', cue.text.slice(0, 180), { time: cue.start });
  }
  const gaps = (lesson.visual?.coverage?.unobservedIntervals || []).filter(item => item.end - item.start >= 60).sort((a, b) => b.end - b.start - (a.end - a.start));
  for (const gap of gaps.slice(0, 5)) {
    const start = Math.round((gap.start + gap.end) / 2 - Math.min(60, (gap.end - gap.start) / 2));
    add('gap', `gap-${start}`, '这一段画面间隔较长', '间隔不代表一定有遗漏；如这里有推导或例题，可补采最多两分钟。', { start, end: Math.min(Math.ceil(gap.end), start + 120), time: start });
  }
  return { version, marks, bookmark, issues: issues.slice(0, 100), issueCount: issues.length,
    progress: { sectionCount: sections(lesson).length, readCount: sections(lesson).filter(item => marks[`section:${item.id}`] === 'read').length,
      weakCount: Object.values(marks).filter(status => status === 'weak').length,
      practicedCount: examples(lesson).filter(item => marks[`example:${item.id}`] === 'practiced').length } };
}

export function updateLessonStudy(lesson, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, '学习记录参数无效。');
  const snapshot = lessonStudy(lesson);
  if (body.version !== snapshot.version) throw error(409, '讲义已更新，请刷新后再记录进度。');
  const { kind, id, status } = body;
  const item = itemsFor(lesson).get(`${kind}:${id}`);
  if (!['section', 'example'].includes(kind) || !item) throw error(400, '请选择当前讲义中的知识点或例题。');
  const allowed = kind === 'section' ? ['read', 'weak', 'none', 'bookmark'] : ['practiced', 'weak', 'none', 'bookmark'];
  if (!allowed.includes(status)) throw error(400, '学习状态无效。');
  const marks = {};
  for (const [key, current] of itemsFor(lesson)) {
    if (snapshot.marks[key]) marks[key] = { signature: signature(current), status: snapshot.marks[key] };
  }
  if (status !== 'bookmark') {
    if (status === 'none') delete marks[`${kind}:${id}`];
    else marks[`${kind}:${id}`] = { signature: signature(item), status };
  }
  lesson.study = { marks, bookmark: { kind, id, signature: signature(item) }, updatedAt: new Date().toISOString() };
  return lessonStudy(lesson);
}

export function mountLessonStudy(app, { lessonById, readableLesson, touch }) {
  app.get('/api/lessons/:id/study', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(lessonStudy(readableLesson(lessonById(req.params.id))));
  });
  app.put('/api/lessons/:id/study', (req, res) => {
    const lesson = lessonById(req.params.id), readable = readableLesson(lesson);
    const result = updateLessonStudy(readable, req.body), previous = lesson.study;
    lesson.study = readable.study;
    try { touch(lesson); } catch (cause) { lesson.study = previous; throw cause; }
    res.json(result);
  });
}
