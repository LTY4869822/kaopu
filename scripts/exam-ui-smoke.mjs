import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone component harness: every API is mocked; no user files/accounts/models.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.env.EXAM_UI_OUTPUT || 'test-results/practice-polish'); fs.mkdirSync(output, { recursive: true });
const course = { id: 'course-a', name: '虚构高等数学', examDate: '2026-12-01', target: 80, mastery: 0, color: 'orange', icon: 'book', chapters: 3, description: '' };
const document = { id: 'doc-a', courseId: course.id, name: '虚构课程讲义.pdf', type: 'PDF', size: 300, status: 'ready', createdAt: '2026-11-05', locationKind: 'page', summary: [], chunks: [{ id: 'chunk-a', page: 2, text: '复合函数的导数等于外层函数导数与内层函数导数的乘积。求导前需要确认函数可导。' }] };
const source = { documentId: document.id, documentName: document.name, chunkId: 'chunk-a', page: 2, locationKind: 'page', text: document.chunks[0].text };
const fixture = { courses: [course, { ...course, id: 'course-b', name: '虚构线性代数' }], documents: [document, { ...document, id: 'doc-b', courseId: 'course-b' }], cards: [], questions: [], attempts: [], settings: { dailyMinutes: 90, goal: 'balanced', name: '隔离测试' }, completedTasks: [], focusMinutes: 0, providerConfigured: true };
const harness = `import {StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';import ExamStudio from '/src/ExamStudio.tsx';import '/src/styles.css';import '/src/internal-ui.css';import '/src/ui-system.css';
function Harness(){const [state,setState]=useState(${JSON.stringify(fixture)});const [courseId,setCourse]=useState('course-a');const [shown,setShown]=useState(true);const [entry,setEntry]=useState({});Object.assign(window,{__setCourse:setCourse,__setShown:setShown,__setEntry:setEntry,__patchState:patch=>setState(s=>({...s,...patch}))});return <main className="app-shell" style={{display:'block',padding:'24px',minHeight:'100vh'}}><div style={{maxWidth:1200,margin:'0 auto'}}>{shown&&<ExamStudio {...entry} state={state} courseId={courseId} onCourseChange={setCourse} onRefresh={async()=>{window.__refreshes=(window.__refreshes||0)+1}} onNotify={text=>window.__notice=text} onOpenSource={source=>{window.__source=source;setShown(false)}}/>}</div></main>}createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);`;
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/exam-harness.tsx"></script></body></html>';
const report = { allApiMocked: true, checks: [], layouts: [], interactions: [], pageErrors: [] };
const step = value => { report.stage = value; console.log(`[exam-ui] ${value}`); };
let vite, browser, page;
let papers = [], attempts = [], templates = [], jobs = [], cards = [], calls = [];
let failNextJob = false;
let holdServerJob = false;
let deadlineMs = null, holdPatch = null, patchSeen = null, releasePatch = null;
let heldListing = null, releaseListing = null;
const clone = value => JSON.parse(JSON.stringify(value));
const optionsFor = type => type === 'true-false' ? [{ id: 'true', text: '正确' }, { id: 'false', text: '错误' }] : ['single-choice', 'multiple-choice'].includes(type) ? [{ id: 'A', text: '外层导数与内层导数相乘' }, { id: 'B', text: '只求外层导数' }, { id: 'C', text: '需确认两层函数可导' }, { id: 'D', text: '内外层导数相加' }] : [];
function makePaper(body) {
  const id = `paper-${papers.length + 1}`; let number = 0;
  const questions = body.sections.flatMap((section, index) => Array.from({ length: section.count }, () => ({ id: `${id}-q${++number}`, sectionId: `section-${index}`, number, type: section.type, points: section.points, difficulty: section.difficulty, topic: section.topics[0] || '复合函数求导', prompt: `虚构第 ${number} 题：根据讲义，复合函数 $f(g(x))$ 求导时需要注意什么？`, options: optionsFor(section.type), origin: body.sourcePolicy === 'extended' && number === 1 ? 'ai-extension' : 'material-based' })));
  return { ...body, id, totalQuestions: questions.length, totalPoints: questions.reduce((sum, question) => sum + question.points, 0), createdAt: new Date().toISOString(), warning: '虚构测试卷：参考答案和推导应对照原件，不代表考试预测。', available: true, questions };
}
function summary(attempt) { return { ...attempt, paper: undefined, answers: undefined, flaggedQuestionIds: undefined, helpedQuestionIds: undefined, results: undefined }; }
function submitAttempt(attempt, body) {
  if (!attempt.deadlineAt || Date.now() < Date.parse(attempt.deadlineAt)) { attempt.answers = body.answers; attempt.flaggedQuestionIds = body.flaggedQuestionIds || []; }
  const results = attempt.paper.questions.map(question => {
    const answer = attempt.answers[question.id] || '', helpUsed = attempt.helpedQuestionIds.includes(question.id);
    const expected = question.type === 'multiple-choice' ? ['A', 'C'] : question.type === 'single-choice' ? 'A' : question.type === 'true-false' ? 'true' : '内层导数';
    const objective = ['single-choice', 'multiple-choice', 'true-false'].includes(question.type) || question.type === 'fill-blank' && answer === expected;
    const present = Array.isArray(answer) ? answer.length > 0 : !!answer;
    const correct = JSON.stringify(answer) === JSON.stringify(expected);
    return { questionId: question.id, answer, status: !present ? 'unanswered' : objective ? correct ? 'correct' : 'incorrect' : 'ungraded', earned: objective ? correct ? question.points : 0 : null, points: question.points, expectedAnswer: readable(expected), answerKey: expected, rubric: '同时保留内外层导数，检查可导条件。', explanation: '依据讲义，复合函数求导要保留内层导数，不能只求外层导数。', steps: ['识别内外层函数。', '分别求导并相乘。'], sources: [source], helpUsed, feedback: '请根据参考要点复盘。' };
  });
  attempt.status = 'submitted'; attempt.submittedAt = new Date().toISOString(); attempt.revision++; attempt.results = results;
  attempt.summary = { objectiveEarned: results.reduce((sum, result) => sum + (result.earned || 0), 0), objectiveTotal: results.filter(result => result.earned !== null).reduce((sum, result) => sum + result.points, 0), pendingPoints: results.filter(result => result.earned === null).reduce((sum, result) => sum + result.points, 0), totalPoints: attempt.paper.totalPoints, answered: results.filter(result => result.status !== 'unanswered').length, totalQuestions: results.length, correct: results.filter(result => result.status === 'correct').length, incorrect: results.filter(result => result.status === 'incorrect').length, ungraded: results.filter(result => result.status === 'ungraded').length, helped: attempt.helpedQuestionIds.length, independent: !attempt.helpedQuestionIds.length };
  return attempt;
}
const readable = value => Array.isArray(value) ? value.join('、') : value;
const wait = async (check, label, ms = 15000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error(label); };
async function revealAnswerSheet() {
  const toggle = page.locator('.es-sheet-toggle');
  await toggle.waitFor({ state: 'visible' });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function jumpToQuestion(number) {
  await revealAnswerSheet();
  await page.getByRole('button', { name: new RegExp(`跳到第${number}题`) }).click();
}
async function verifyMobileAnswerSheet(width) {
  const toggle = page.locator('.es-sheet-toggle');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `${width} answer sheet starts folded`);
  assert.equal(await page.locator('.es-answer-grid').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: '交卷并复盘', exact: true }).isVisible(), true, 'submit remains outside folded body');
  await toggle.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const focus = await toggle.evaluate(el => ({ visible: el.matches(':focus-visible'), width: parseFloat(getComputedStyle(el).outlineWidth), style: getComputedStyle(el).outlineStyle }));
  assert.equal(focus.visible, true); assert.ok(focus.width >= 2 && focus.style !== 'none', `${width} keyboard focus has a visible outline`);
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true'); assert.equal(await page.locator('.es-answer-grid').isVisible(), true);
  const targets = await page.locator('.es-answer-grid button').evaluateAll(buttons => buttons.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  assert.ok(targets.every(target => target.width >= 43.9 && target.height >= 43.9), `${width} expanded answer sheet has 44px targets`);
  const current = page.locator('.es-answer-grid button[aria-current="step"]');
  await current.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'mobile jump folds answer sheet');
  await wait(() => page.locator('.es-question-card').evaluate(el => el === document.activeElement), 'mobile jump focuses current question');
  report.interactions.push({ label: 'mobile-answer-sheet', width, keyboardToggle: true, questionFocus: true, submitAlwaysVisible: true });
}
async function layout(label, width) {
  await page.setViewportSize({ width, height: 900 });
  const result = await page.evaluate(() => {
    const visible = el => el.checkVisibility() && !el.closest('[aria-hidden="true"]');
    const text = '.exam-studio p,.exam-studio label,.exam-studio small,.exam-studio summary,.exam-studio .es-disclaimer,.exam-studio .es-save-status,.exam-studio .es-section-name strong,.exam-studio .es-question-card .lesson-text,.exam-studio .es-review-question .lesson-text';
    const controls = '.exam-studio button,.exam-studio summary,.exam-studio input:not([type="checkbox"]):not([type="radio"]),.exam-studio select,.exam-studio textarea';
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, smallText: [...document.querySelectorAll(text)].filter(el => visible(el) && parseFloat(getComputedStyle(el).fontSize) < 14).map(el => el.textContent.slice(0, 50)), shortControls: [...document.querySelectorAll(controls)].filter(el => visible(el) && el.getBoundingClientRect().height < 43.9).map(el => ({ text: el.textContent.slice(0, 40) || el.getAttribute('aria-label'), height: el.getBoundingClientRect().height })), narrowControls: [...document.querySelectorAll('.exam-studio button,.exam-studio summary')].filter(el => visible(el) && el.getBoundingClientRect().width < 43.9).map(el => ({ text: el.textContent.slice(0, 40) || el.getAttribute('aria-label'), width: el.getBoundingClientRect().width })), bodyFont: parseFloat(getComputedStyle(document.querySelector('.exam-studio')).fontSize) };
  });
  report.layouts.push({ label, ...result }); assert.equal(result.documentWidth, result.width, `${label}/${width} overflow`); assert.deepEqual(result.smallText, [], `${label}/${width} small text`); assert.deepEqual(result.shortControls, [], `${label}/${width} small controls`); assert.deepEqual(result.narrowControls, [], `${label}/${width} narrow controls`); assert.ok(result.bodyFont >= 16, `${label}/${width} body font >=16px`);
  await page.screenshot({ path: path.join(output, `${label}-${width}.png`), fullPage: true });
  if (label === 'practice' && width <= 900) await verifyMobileAnswerSheet(width);
}
async function layoutMatrix(label) {
  for (const width of [1440, 768, 390, 320]) await layout(label, width);
}
async function verifySubmitConfirm() {
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  await wait(() => dialog.evaluate(el => el.contains(document.activeElement)), 'submit confirmation receives focus');
  const targets = await dialog.getByRole('button').evaluateAll(buttons => buttons.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  assert.ok(targets.every(target => target.width >= 43.9 && target.height >= 43.9), 'submit dialog uses 44px targets');
  const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320, '320px submit dialog stays in viewport');
  await page.screenshot({ path: path.join(output, 'submit-confirm-320.png'), fullPage: true });
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '检查并交卷', exact: true }).evaluate(el => el === document.activeElement), true, 'cancel returns focus to submit trigger');
  await page.getByRole('button', { name: '检查并交卷', exact: true }).click();
  report.interactions.push({ label: 'submit-confirm', width: 320, focusContained: true, escapeRestoresFocus: true, minimumTarget: 44 });
}
try {
  step('starting isolated component');
  vite = await createServer({ root, cacheDir: path.join(os.tmpdir(), "shifen-mock-exam-ui-cache"), configFile: false, plugins: [react(), { name: 'exam-harness', configureServer(server) { server.middlewares.use((req, res, next) => { if (req.url !== '/') return next(); void server.transformIndexHtml('/', html).then(value => { res.setHeader('Content-Type', 'text/html'); res.end(value); }).catch(next); }); }, resolveId(id) { if (id === '/exam-harness.tsx') return '\0exam-harness.tsx'; }, async load(id) { if (id === '\0exam-harness.tsx') return (await transformWithEsbuild(harness, 'exam-harness.tsx', { loader: 'tsx', jsx: 'automatic' })).code; } }], server: { host: '127.0.0.1', port: 0 }, appType: 'custom', logLevel: 'error' });
  await vite.listen();
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228', '1223'].map(version => path.join(os.homedir(), 'AppData/Local/ms-playwright', `chromium-${version}/chrome-win64/chrome.exe`))].filter(Boolean);
  const executablePath = candidates.find(value => fs.existsSync(value)); assert.ok(executablePath);
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', acceptDownloads: true });
  await context.route('**/api/**', async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname, method = req.method();
    const body = req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null; calls.push({ pathname, method, body });
    const fulfill = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(clone(data)) }).catch(() => {});
    if (pathname === '/api/exams') {
      const courseId = new URL(req.url()).searchParams.get('courseId');
      const value = { configured: true, templates: templates.filter(item => item.courseId === courseId), papers: papers.filter(item => item.courseId === courseId).map(item => ({ ...item, questions: undefined })), attempts: attempts.filter(item => item.courseId === courseId).map(summary), jobs: jobs.filter(item => item.courseId === courseId).slice().reverse() };
      if (heldListing) { const gate = heldListing; heldListing = null; await gate; value.configured = false; }
      return fulfill(value);
    }
    if (pathname === '/api/exams/templates/analyze') { const value = { id: `template-${templates.length + 1}`, courseId: body.courseId, title: '虚构历年高数试卷', sections: ['single-choice','multiple-choice','true-false','fill-blank','short-answer','calculation'].map(type => ({ type, count: 1, points: 5, difficulty: 'medium', topics: ['链式法则'] })), durationMinutes: 45, focus: '链式法则与可导条件', documentIds: body.documentIds, confirmed: false, createdAt: '2026-11-05', updatedAt: '2026-11-05', warning: '难度为估计，请对照原卷确认。', sources: [source], sourceCoverage: { sampledChunks: 20, totalChunks: 30, sampledCharacters: 20000, truncated: true } }; templates.push(value); return fulfill(value); }
    const templateMatch = pathname.match(/\/templates\/([^/]+)\/confirm$/);
    if (templateMatch) { const value = templates.find(item => item.id === templateMatch[1]); Object.assign(value, body, { confirmed: true }); return fulfill(value); }
    if (pathname === '/api/documents' && method === 'POST') return fulfill({ id: 'uploaded-past-paper' }, 201);
    if (pathname === '/api/exams/papers' && method === 'POST') { const paper = makePaper(body); papers.push(paper); const job = { id: `job-${jobs.length + 1}`, courseId: body.courseId, status: 'generating', completed: 0, total: paper.totalQuestions, message: '正在核对来源', paperId: paper.id }; jobs.push(job); return fulfill({ jobId: job.id }, 202); }
    const jobMatch = pathname.match(/\/jobs\/([^/]+)(\/cancel)?$/);
    if (jobMatch) { const job = jobs.find(item => item.id === jobMatch[1]); if (holdServerJob && job.id === 'job-server-only') return fulfill(job); job.status = jobMatch[2] ? 'cancelled' : failNextJob ? 'failed' : 'completed'; if (failNextJob) { job.message = '虚构模型来源校验未通过，请调整范围后重试。'; failNextJob = false; } job.completed = job.total; return fulfill(job); }
    const startMatch = pathname.match(/\/papers\/([^/]+)\/start$/);
    if (startMatch) { const paper = papers.find(item => item.id === startMatch[1]); const value = { id: `attempt-${attempts.length + 1}`, paperId: paper.id, courseId: paper.courseId, title: paper.title, mode: body.mode, status: 'in-progress', revision: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deadlineAt: body.mode === 'exam' ? new Date(Date.now() + (deadlineMs || 3600000)).toISOString() : null, available: true, paper, answers: {}, flaggedQuestionIds: [], helpedQuestionIds: [] }; attempts.push(value); return fulfill(value); }
    const paperMatch = pathname.match(/\/papers\/([^/]+)$/); if (paperMatch) return fulfill(papers.find(item => item.id === paperMatch[1]));
    const attemptMatch = pathname.match(/\/attempts\/([^/]+)(\/(submit|hints|review))?$/);
    if (attemptMatch) {
      const attempt = attempts.find(item => item.id === attemptMatch[1]); if (!attempt) return fulfill({ error: '未找到答卷' }, 404);
      const action = attemptMatch[3];
      if (method === 'GET') return fulfill(attempt);
      if (action === 'hints') { if (attempt.mode === 'exam') return fulfill({ error: '模考不提供提示' }, 409); attempt.helpedQuestionIds = [...new Set([...attempt.helpedQuestionIds, body.questionId])]; attempt.revision++; return fulfill({ questionId: body.questionId, level: body.level, text: body.level === 3 ? '完整参考讲解：分别求出内外层导数，再相乘。' : '先区分内层和外层函数，再检查可导条件。', sources: [source], attempt }); }
      if (action === 'review') { const result = attempt.results.find(item => item.questionId === body.questionId); result.review = { ...result.review, ...body }; return fulfill(attempt); }
      if (action === 'submit') { if (attempt.status === 'submitted') return fulfill(attempt); if (body.revision !== attempt.revision) return fulfill({ error: '答卷已变化，请重新读取' }, 409); return fulfill(submitAttempt(attempt, body)); }
      if (method === 'PATCH') { if (holdPatch) { const gate = holdPatch; holdPatch = null; patchSeen?.(); await gate; } if (attempt.deadlineAt && Date.now() >= Date.parse(attempt.deadlineAt)) return fulfill({ error: '限时已结束，请按已保存答案交卷' }, 409); if (body.revision !== attempt.revision) return fulfill({ error: '答卷已变化，请重新读取' }, 409); Object.assign(attempt, { answers: body.answers, flaggedQuestionIds: body.flaggedQuestionIds, revision: attempt.revision + 1 }); return fulfill(attempt); }
    }
    if (pathname === '/api/cards') { cards.push(body); return fulfill({ id: `card-${cards.length}`, ...body }); }
    if (pathname === '/api/model-service') { const model = { configured: true, verified: true, baseUrl: 'https://example.test/v1', model: 'fixture', hasKey: true, maskedKey: '****mock', useTextProvider: false, verifiedAt: '2026-11-05' }; return fulfill({ text: model, vision: { ...model, configured: false } }); }
    return fulfill({ error: `Unexpected ${method} ${pathname}` }, 404);
  });
  page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
  const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('region', { name: '期末模拟考工作台' }).waitFor({ timeout: 90000 });
  await layoutMatrix('home');
  await page.setViewportSize({ width: 1440, height: 900 });
  step('custom blueprint and all six question types');
  await page.getByRole('button', { name: '自定义组卷', exact: false }).click();
  assert.equal(await page.getByLabel('多选题数量2', { exact: true }).isVisible(), false);
  await page.getByRole('button', { name: '添加其他题型', exact: true }).click();
  await page.locator('.es-topic-focus > summary').click();
  const names = ['单选题','多选题','判断题','填空题','简答题','计算 / 证明题'];
  for (let index = 0; index < names.length; index++) await page.getByLabel(`${names[index]}数量${index + 1}`, { exact: true }).fill('1');
  await page.getByLabel('组卷知识点', { exact: true }).fill('复合函数求导与适用条件');
  await page.getByLabel('试卷名称', { exact: true }).fill('虚构六题型练习卷');
  await page.getByLabel('练习时长', { exact: true }).fill('25');
  await wait(() => page.evaluate(() => JSON.parse(localStorage.getItem('shifen:exam-builder:course-a') || '{}').durationMinutes === 25), 'builder persisted');
  await page.evaluate(() => window.__setShown(false)); await page.getByRole('region', { name: '期末模拟考工作台' }).waitFor({ state: 'detached' });
  await page.evaluate(() => window.__setShown(true)); await page.getByRole('button', { name: '自定义组卷', exact: false }).click();
  assert.equal(await page.getByLabel('试卷名称', { exact: true }).inputValue(), '虚构六题型练习卷');
  assert.equal(await page.getByLabel('组卷知识点', { exact: true }).inputValue(), '复合函数求导与适用条件');
  assert.equal(await page.getByLabel('练习时长', { exact: true }).inputValue(), '25');
  for (let index = 0; index < names.length; index++) assert.equal(await page.getByLabel(`${names[index]}数量${index + 1}`, { exact: true }).inputValue(), '1');
  report.checks.push('StrictMode builder hydration preserves six-type counts, title, knowledge focus and 25-minute budget after unmount/remount');
  await layoutMatrix('builder');
  for (const width of [1199, 1120, 1100, 900]) await layout('builder', width);
  for (const [width, height, columns, position] of [[1440,900,2,'sticky'],[1440,650,2,'static'],[1199,900,1,'static'],[1100,900,1,'static'],[900,900,1,'static']]) {
    await page.setViewportSize({ width, height });
    const value = await page.evaluate(() => { const grid = document.querySelector('.es-builder-grid'), summary = document.querySelector('.es-build-summary'); return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, position: getComputedStyle(summary).position, documentWidth: document.documentElement.scrollWidth, width: innerWidth }; });
    assert.equal(value.columns, columns, `${width}x${height} builder columns`); assert.equal(value.position, position, `${width}x${height} summary position`); assert.ok(value.documentWidth <= value.width + 1);
  }
  report.checks.push('builder uses one ordered column below 1200px and only sticks the summary on sufficiently tall wide screens');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '生成这套试卷', exact: true }).click();
  await page.getByRole('button', { name: '边练边学', exact: false }).waitFor();
  assert.equal(papers[0].totalQuestions, 6); assert.equal(calls.find(call => call.pathname === '/api/exams/papers').body.focus, '复合函数求导与适用条件');
  assert.equal(await page.getByText('参考答案', { exact: true }).count(), 0);
  await layoutMatrix('paper');
  await page.setViewportSize({ width: 1440, height: 900 });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载试卷 · Markdown', exact: true }).click(); await download;
  await page.getByRole('button', { name: '边练边学', exact: false }).click();
  assert.equal(await page.getByRole('button', { name: '上一题', exact: true }).isDisabled(), true);
  report.interactions.push({ label: 'first-question', previousDisabled: true });
  await page.getByRole('group', { name: '试卷答案选项' }).getByRole('button', { name: /^B / }).click();
  await page.getByRole('button', { name: '给我方向', exact: true }).click(); await page.getByText('本题已使用帮助，按辅助练习记录。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await page.getByRole('group', { name: '试卷答案选项' }).getByRole('button', { name: /^A / }).click(); await page.getByRole('group', { name: '试卷答案选项' }).getByRole('button', { name: /^C / }).click();
  await page.getByRole('button', { name: '下一题', exact: true }).click(); await page.getByRole('group', { name: '试卷答案选项' }).getByRole('button', { name: /正确$/ }).click();
  await page.getByRole('button', { name: '下一题', exact: true }).click(); await page.getByLabel('本题作答', { exact: true }).fill('内层导数');
  await page.getByRole('button', { name: '下一题', exact: true }).click(); await page.getByLabel('本题作答', { exact: true }).fill('需确认可导并保留内层导数。');
  await page.getByRole('button', { name: '下一题', exact: true }).click(); await page.getByLabel('本题作答', { exact: true }).fill('先识别内外层，再将导数相乘。');
  await wait(() => attempts[0].answers['paper-1-q6'], 'autosave final question');
  await layoutMatrix('practice');
  await page.reload({ waitUntil: 'networkidle' });
  await jumpToQuestion(6); assert.equal(await page.getByLabel('本题作答', {exact:true}).inputValue(), '先识别内外层，再将导数相乘。');
  await page.getByRole('button', { name: '检查并交卷', exact: true }).click(); await verifySubmitConfirm(); await page.getByRole('button', { name: '确认交卷', exact: false }).click();
  await page.getByText('可自动核对的参考得分', { exact: true }).waitFor();
  assert.equal(attempts[0].summary.pendingPoints, 20); assert.equal(attempts[0].summary.independent, false);
  await page.getByLabel('第5题自评', { exact: true }).selectOption('partial'); await wait(() => attempts[0].results[4].review?.selfAssessment === 'partial', 'subjective self review');
  await page.getByLabel('第1题错因', { exact: true }).selectOption('method'); await wait(() => attempts[0].results[0].review?.reason === 'method', 'mistake reason');
  await page.getByRole('button', { name: '收进记忆卡', exact: true }).first().click(); await wait(() => cards.length === 1, 'memory card');
  await layoutMatrix('report');
  await page.getByRole('button', { name: /生成复练卷/ }).click(); await page.getByRole('button', { name: '限时模考', exact: false }).waitFor();
  assert.equal(calls.filter(call => call.pathname === '/api/exams/papers').at(-1).body.retryFrom.attemptId, attempts[0].id);
  report.checks.push('six-type custom paper → private exam view → auto-save/reload → assisted practice → submit → objective/pending report → self review/reason/card → new mistake paper');
  step('past-paper blueprint confirmation and 100-question configuration');
  await page.getByRole('button', { name: '返回我的试卷', exact: true }).click(); await page.getByRole('button', { name: '参照历年真题', exact: false }).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '分析真题结构', exact: true }).click(); await page.getByText(/本次分析抽取 20 \/ 30/).waitFor();
  assert.equal(await page.getByRole('button', { name: '生成这套试卷', exact: true }).isDisabled(), true);
  await page.getByLabel('单选题数量1', { exact: true }).fill('42'); await page.getByRole('button', { name: '确认当前题型与考察方向', exact: true }).click();
  await wait(() => templates[0].confirmed && templates[0].sections[0].count === 42, 'confirm edited 47-question template');
  await wait(() => page.getByRole('button', { name: '生成这套试卷', exact: true }).isEnabled(), 'confirmed template enables generation');
  await page.getByLabel('单选题数量1', { exact: true }).fill('1'); await page.getByRole('button', { name: '确认当前题型与考察方向', exact: true }).click();
  await wait(() => templates[0].sections[0].count === 1, 'reconfirm template'); await page.getByRole('button', { name: '生成这套试卷', exact: true }).click(); await page.getByRole('button', { name: '限时模考', exact: false }).waitFor();
  report.checks.push('past-paper analysis → source sampling warning → user edited/confirmed blueprint including >40 questions → confirmed-template paper');
  step('expired unsaved answer can still submit server snapshot');
  deadlineMs = 250; await page.getByRole('button', { name: '限时模考', exact: false }).click(); await page.getByRole('group', { name: '试卷答案选项' }).getByRole('button', { name: /^B / }).click();
  await page.getByText('可自动核对的参考得分', { exact: true }).waitFor();
  assert.equal(attempts.at(-1).status, 'submitted', 'deadline submits without a second click');
  const expired = attempts.at(-1); assert.equal(expired.summary.answered, 0); assert.equal(await page.getByRole('button', { name: '下载草稿备份', exact: true }).count(), 1);
  report.checks.push('deadline with dirty answer freezes editor, submits only saved answers, preserves separate downloadable draft');
  step('pending autosave + parent course switch cannot submit a different attempt or lose late edits');
  deadlineMs = null; await page.getByRole('button', { name: '返回我的试卷', exact: true }).click(); await page.getByRole('button', { name: '查看试卷', exact: false }).first().click(); await page.getByRole('button', { name: '边练边学', exact: false }).click();
  const raceAttempt = attempts.at(-1);
  await jumpToQuestion(5);
  holdPatch = new Promise(resolve => { releasePatch = resolve; }); const patchCaptured = new Promise(resolve => { patchSeen = resolve; });
  await page.getByLabel('本题作答', {exact:true}).fill('旧答案'); await patchCaptured; await page.getByLabel('本题作答', {exact:true}).fill('后来输入的新答案，不应丢失');
  await page.getByRole('button', { name: '交卷并复盘', exact: true }).click(); const countBefore = calls.filter(call => call.pathname.endsWith('/submit')).length; await page.getByRole('button', { name: '确认交卷', exact: false }).click();
  const bPaper = makePaper({ ...papers[0], courseId: 'course-b', title: '父切课竞态用独立卷' }); papers.push(bPaper);
  const bAttempt = { id: 'attempt-b-race', paperId: bPaper.id, courseId: 'course-b', title: bPaper.title, mode: 'practice', status: 'in-progress', revision: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deadlineAt: null, available: true, paper: bPaper, answers: {}, flaggedQuestionIds: [], helpedQuestionIds: [] }; attempts.push(bAttempt);
  await page.evaluate(() => { localStorage.setItem('shifen:exam-active:course-b', JSON.stringify('attempt-b-race')); window.__setCourse('course-b'); });
  await page.getByRole('group', { name: '试卷答案选项' }).getByRole('button', { name: /^A / }).click();
  await page.getByRole('button', { name: '给我方向', exact: true }).click(); releasePatch();
  await wait(() => bAttempt.helpedQuestionIds.length === 1, 'new course hint waits for its own save after old course save');
  assert.equal(bAttempt.answers[`${bPaper.id}-q1`], 'A');
  assert.equal(calls.filter(call => call.pathname.endsWith('/submit')).length, countBefore);
  await page.evaluate(() => window.__setCourse('course-a')); await jumpToQuestion(5); assert.equal(await page.getByLabel('本题作答', {exact:true}).inputValue(), '后来输入的新答案，不应丢失');
  await wait(() => raceAttempt.answers[`${raceAttempt.paperId}-q5`] === '后来输入的新答案，不应丢失', 'late draft revision recovery saves fresh input');
  report.checks.push('late autosave increments old draft revision without dropping newer input; old submit fenced after parent course switch; new course hint waits for its own save; returned course auto-restores and saves fresh draft');
  step('late listing cannot overwrite newest library state');
  await page.getByRole('button', { name: '保存并返回', exact: true }).click();
  heldListing = new Promise(resolve => { releaseListing = resolve; }); await page.evaluate(() => window.__setShown(false)); await page.evaluate(() => window.__setShown(true));
  await page.getByRole('button', { name: '保存并返回', exact: true }).click(); await page.getByRole('button', { name: '刷新记录', exact: true }).click(); releaseListing();
  await page.getByRole('button', { name: '自定义组卷', exact: false }).click(); assert.equal(await page.getByRole('button', { name: '生成这套试卷', exact: true }).isEnabled(), true);
  report.checks.push('late initial listing cannot clear configured model state after a newer library refresh');
  step('failed job is an alert, preserves builder and allows retry');
  await page.getByLabel('试卷名称',{exact:true}).fill('失败后仍应保留的配置'); failNextJob = true;
  await page.getByRole('button',{name:'生成这套试卷',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'虚构模型来源校验未通过'}).waitFor();
  assert.equal(await page.getByLabel('试卷名称',{exact:true}).inputValue(),'失败后仍应保留的配置');
  assert.equal(await page.evaluate(()=>localStorage.getItem('shifen:exam-job:course-a')),null);
  assert.equal(await page.getByRole('button',{name:'生成这套试卷',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'生成这套试卷',exact:true}).click();
  await page.getByRole('button',{name:'限时模考',exact:false}).waitFor();
  report.checks.push('failed job uses alert, clears persisted job id, retains builder inputs and can retry successfully');
  step('server-only active job restores progress without a local job id');
  holdServerJob = true;
  jobs.push({ id: 'job-server-only', courseId: 'course-a', status: 'generating', completed: 2, total: 6, message: '服务器仍在继续组卷', paperId: papers.at(-1).id });
  await page.evaluate(() => { localStorage.removeItem('shifen:exam-job:course-a'); localStorage.removeItem('shifen:exam-active:course-a'); window.__setShown(false); });
  await page.getByRole('region', { name: '期末模拟考工作台' }).waitFor({ state: 'detached' });
  await page.evaluate(() => window.__setShown(true));
  await page.getByRole('region', { name: '试卷生成进度' }).waitFor();
  await page.getByText('服务器仍在继续组卷', { exact: true }).waitFor();
  const progress = page.getByRole('region', { name: '试卷生成进度' }).getByRole('progressbar');
  assert.equal(await progress.getAttribute('value'), '2'); assert.equal(await progress.getAttribute('max'), '6');
  assert.equal(await page.getByRole('button', { name: '自定义组卷', exact: false }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '取消组卷', exact: true }).isEnabled(), true);
  report.interactions.push({ label: 'server-job-loading', progress: '2/6', duplicateGenerationDisabled: true, cancelAvailable: true });
  holdServerJob = false;
  await page.getByRole('button', { name: '限时模考', exact: false }).waitFor();
  await page.getByRole('button', { name: '返回我的试卷', exact: true }).click();
  await page.getByRole('button', { name: '自定义组卷', exact: false }).click();
  const listingCount = calls.filter(call => call.pathname === '/api/exams').length;
  await page.evaluate(documents => window.__patchState({ documents: documents.map(doc => ({ ...doc, name: `${doc.name} · 刷新标记` })) }), fixture.documents);
  await wait(() => calls.filter(call => call.pathname === '/api/exams').length > listingCount, 'source refresh reloads library');
  await page.getByLabel('试卷名称', { exact: true }).waitFor();
  report.checks.push('server library restores active progress when local job pointer is absent; completion opens saved paper; historical completed job does not force navigation');
  await page.getByRole('button',{name:'返回我的试卷',exact:true}).click();
  await page.getByLabel('搜索模拟试卷',{exact:true}).fill('本次搜索不存在的试卷');
  await page.getByRole('heading',{name:'没有符合条件的试卷',exact:true}).waitFor();
  await page.getByRole('button',{name:'查看全部试卷',exact:true}).click();
  await page.getByRole('button',{name:'已交卷',exact:true}).click();
  assert.equal(await page.locator('.es-paper-list > article').count(), new Set(attempts.filter(a=>a.courseId==='course-a'&&a.status==='submitted').map(a=>a.paperId)).size);
  await page.getByRole('button',{name:'未完成',exact:true}).click();
  assert.equal(await page.locator('.es-paper-list > article').count(), new Set(attempts.filter(a=>a.courseId==='course-a'&&a.status==='in-progress').map(a=>a.paperId)).size);
  await page.getByRole('button',{name:'全部试卷',exact:true}).click();
  await layout('library',1440); await layout('library',390);
  report.checks.push('mock exam search and status filters match actual saved attempt records');
  await page.evaluate(()=>{window.__setShown(false);window.__setEntry({initialDocumentIds:['doc-a']})});
  await page.getByRole('region',{name:'期末模拟考工作台'}).waitFor({state:'detached'});
  await page.evaluate(()=>window.__setShown(true));
  await page.getByLabel('试卷名称',{exact:true}).waitFor();
  assert.equal(await page.locator('.es-builder-main .es-document-list input').first().isChecked(),true,'course entry preserves selected source in StrictMode');
  await page.evaluate(id=>{window.__setShown(false);window.__setEntry({initialPaperId:id})},papers[0].id);
  await page.getByRole('region',{name:'期末模拟考工作台'}).waitFor({state:'detached'});
  await page.evaluate(()=>window.__setShown(true));
  await page.getByRole('button',{name:'限时模考',exact:false}).waitFor();
  report.checks.push('StrictMode direct course-source and saved-paper entries consume intent and retain the right screen');
  assert.deepEqual(report.pageErrors, []); report.passed = true;
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  releasePatch?.(); releaseListing?.(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser?.close(); await vite?.close();
}
console.log(`Exam UI passed: ${report.checks.length} workflow groups, ${report.layouts.length} responsive/readability checks; isolated mocks only.`);
