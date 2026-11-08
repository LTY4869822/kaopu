// Full React app + real Express exam APIs, isolated state and deterministic model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-exam-app-'));
const output = path.join(root, 'test-results/exam-app-smoke'); fs.mkdirSync(output, { recursive: true });
const types = ['single-choice', 'multiple-choice', 'true-false', 'fill-blank', 'short-answer', 'calculation'];
const labels = ['单选题', '多选题', '判断题', '填空题', '简答题', '计算 / 证明题'];
const report = { isolatedBackend: true, syntheticModel: true, checks: [], layouts: [], pageErrors: [] };
let sequence = 0, app, server, browser, page;
const modelResponse = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
const model = async (_url, init) => {
  const payload = JSON.parse(JSON.parse(init.body).messages[1].content), source = payload.sources[0];
  if (payload.task === 'exam-template') return modelResponse({ title: '合成2025年期末样卷', durationMinutes: 30, focus: '复合函数求导与条件核查',
    sections: types.map(type => ({ type, count: 1, points: 5, difficulty: 'medium', topics: ['复合函数求导'] })), sources: [{ sourceId: source.sourceId, quote: source.text.slice(0, 32) }] });
  assert.equal(payload.task, 'exam-questions'); sequence++;
  return modelResponse({ questions: payload.slots.map(slot => ({ slotId: slot.id, type: slot.type, difficulty: slot.difficulty, topic: slot.topic,
    prompt: `合成训练 ${sequence}-${slot.number}：在复合函数求导中，怎样核对条件并处理内层导数？`,
    options: ['single-choice', 'multiple-choice'].includes(slot.type) ? [{ id: 'A', text: '保留内层导数' }, { id: 'B', text: '省略所有适用条件' }, { id: 'C', text: '核对内外层的可导条件' }, { id: 'D', text: '只对外层函数求导' }] : [],
    answerKey: slot.type === 'single-choice' ? 'A' : slot.type === 'multiple-choice' ? ['A', 'C'] : slot.type === 'true-false' ? 'true' : null,
    expectedAnswer: slot.type === 'fill-blank' ? '内层导数' : '核对可导条件，外层导数乘以内层导数。', acceptedAnswers: [],
    rubric: '核对内外层可导条件，说明内层导数不可遗漏。', explanation: '复合函数求导需要内外两层共同参与，先识别关系再应用链式法则。',
    steps: ['识别外层函数和内层函数。', '核对可导条件后将两层导数相乘。'], hints: ['先识别函数的复合关系。', '想想内层函数如何改变自变量。'],
    sources: [{ sourceId: source.sourceId, quote: source.text.slice(0, 32) }], origin: 'material-based' })) });
};
async function inspect(label) {
  const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    smallControls: [...document.querySelectorAll('.practice-hub button,.practice-hub select,.practice-hub textarea,.practice-hub input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),.practice-hub label:has(input[type="checkbox"]),.practice-hub label:has(input[type="radio"])')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height < 43).map(el => ({ text: (el.textContent || el.getAttribute('aria-label') || el.tagName).slice(0, 30), height: el.getBoundingClientRect().height })) }));
  report.layouts.push({ label, ...layout });
  assert.ok(layout.documentWidth <= layout.width + 1, `Overflow: ${label}`); assert.equal(layout.smallControls.length, 0, `Small controls: ${label}`);
}
const stage = text => { report.stage = text; console.log(`[exam-app] ${text}`); };
try {
  app = createApp({ dataDir: directory, provider: { baseUrl: 'https://synthetic.example.test/v1', apiKey: 'isolated-fixture-key', model: 'fixture' }, examFetch: model });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`${base}/api${route}`, { method, ...(body === undefined ? {} : body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  await api('/reset', { mode: 'empty' });
  const course = await api('/courses', { name: '合成高等数学', target: 80, examDate: '2026-11-12' });
  const upload = new FormData(); upload.append('courseId', course.id); upload.append('file', new Blob(['复合函数求导：复合函数的导数等于外层函数导数乘以内层函数导数，应用前需要核对内外层的可导条件。函数连续时需要函数值存在、极限存在并相等。']), '合成高数讲义.txt');
  await api('/documents', upload);
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228', '1223'].map(v => path.join(os.homedir(), 'AppData/Local/ms-playwright', `chromium-${v}`, 'chrome-win64/chrome.exe'))].filter(Boolean).find(p => fs.existsSync(p));
  assert.ok(executablePath, 'An installed Playwright Chromium is required');
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
  await context.route('**/api/**', async route => { const url = new URL(route.request().url()); const response = await route.fetch({ url: `${base}${url.pathname}${url.search}` }); await route.fulfill({ response }); });
  page = await context.newPage(); page.on('pageerror', e => report.pageErrors.push(e.message));
  stage('opening unified mock exam page');
  await page.goto(process.env.UI_TEST_URL || 'http://localhost:5174/', { waitUntil: 'networkidle' });
  await page.locator('.sidebar').getByRole('button', { name: '期末模考', exact: true }).click();
  assert.equal(await page.locator('.sidebar').getByRole('button', {name:'记忆卡片',exact:true}).count(),0); assert.equal(await page.getByRole('tab',{name:'智能组卷'}).count(),0);
  await page.getByLabel('组卷课程', { exact: true }).selectOption(course.id);
  await page.getByRole('button', { name: /^自定义组卷/ }).click();
  await page.getByLabel('试卷名称', { exact: true }).fill('完整App合成六题型卷');
  await page.locator('.es-topic-focus > summary').click();
  await page.getByRole('button', { name: '添加其他题型', exact: true }).click();
  await page.getByLabel('组卷知识点', { exact: true }).fill('复合函数与适用条件');
  for (let i = 0; i < labels.length; i++) await page.getByLabel(`${labels[i]}数量${i + 1}`, { exact: true }).fill('1');
  await inspect('1440 custom builder'); await page.screenshot({ path: path.join(output, 'builder-desktop.png'), fullPage: true });
  stage('generating six types through actual backend');
  await page.getByRole('button', { name: '生成这套试卷', exact: true }).click();
  await page.getByRole('button', { name: /^限时模考/ }).waitFor({ timeout: 30000 });
  assert.equal((await api('/exams')).papers[0].totalQuestions, 6); report.checks.push('actual App custom builder -> real API job -> six-type saved paper');
  await page.getByRole('button', { name: /^限时模考/ }).click();
  assert.equal(await page.getByRole('button', { name: '给我方向', exact: true }).count(), 0);
  stage('answering and resuming an autosaved exam');
  await page.locator('.es-answer-options button').nth(1).click();
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await page.locator('.es-answer-options button').nth(0).click(); await page.locator('.es-answer-options button').nth(2).click();
  await page.getByRole('button', { name: '保存并返回', exact: true }).click();
  await page.getByRole('button', { name: '继续作答', exact: true }).click();
  await page.getByRole('button', { name: /^跳到第2题/ }).click();
  assert.equal(await page.locator('.es-answer-options button.is-selected').count(), 2);
  for (let i = 2; i < 6; i++) {
    await page.getByRole('button', { name: new RegExp(`^跳到第${i + 1}题`) }).click();
    if (i === 2) await page.locator('.es-answer-options button').first().click();
    else await page.getByLabel('本题作答', { exact: true }).fill(i === 3 ? '内层导数' : '先识别内外层，再核对条件。');
  }
  await page.getByRole('button', { name: '交卷并复盘', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认交卷', exact: true }).click();
  await page.locator('.es-report').waitFor();
  const library = await api('/exams'), attemptId = library.attempts[0].id;
  const result = await api(`/exams/attempts/${attemptId}`);
  assert.equal(result.status, 'submitted'); assert.equal(result.results.length, 6); assert.ok(result.summary.pendingPoints > 0);
  report.checks.push('all answer types -> autosave -> resume -> confirmation -> actual submission and pending subjective marks');
  await inspect('1440 review');
  const schedule = await api('/planner?date=2026-11-05&days=3'); assert.ok(schedule.days.flatMap(day=>day.tasks).some(task=>task.action==='exams'&&task.attemptId===attemptId), 'latest mock exam mistakes enter the real rolling planner');
  report.checks.push('real submitted exam mistakes link into budgeted review plan');
  await page.getByRole('button',{name:'查看复习安排',exact:true}).click();
  await page.locator('.sp-session,.sp-daily-task').filter({hasText:'模拟考订正'}).first().getByRole('button',{name:'开始学习',exact:true}).click();
  await page.locator('.es-report').waitFor();
  assert.match(await page.locator('.es-report-summary h2').innerText(),/完整App合成六题型卷/);
  report.checks.push('report -> review plan -> exact original attempt is navigable in the full App');
  await page.getByLabel('第1题错因', { exact: true }).selectOption('condition');
  await page.locator('.es-review-controls').first().getByRole('button', { name: '收进记忆卡', exact: true }).click();
  await page.locator('.es-review-controls').first().getByRole('button',{name:'已收进记忆卡',exact:true}).waitFor();
  assert.equal((await api('/state')).cards.length, 1);
  assert.equal((await api(`/exams/attempts/${attemptId}`)).results[0].review.reason, 'condition');
  await page.getByRole('button', { name: /^生成复练卷/ }).click();
  await page.getByRole('button', { name: /^边练边学/ }).waitFor({ timeout: 30000 });
  assert.equal((await api('/exams')).papers.length, 2); report.checks.push('review reason -> shared memory card -> newly generated wrong-topic paper');
  await page.getByRole('button', { name: /^边练边学/ }).click();
  await page.getByRole('button', { name: '给我方向', exact: true }).click();
  await page.locator('.es-hint-content').waitFor(); assert.match(await page.locator('.es-help-note').innerText(), /辅助/);
  await page.getByRole('button', { name: '保存并返回', exact: true }).click();
  await page.getByRole('button', { name: /^参照历年真题/ }).click();
  await page.locator('.es-builder-main .es-document-list').first().getByRole('checkbox').check();
  await page.getByRole('button', { name: '分析真题结构', exact: true }).click();
  await page.locator('.es-template-receipt').waitFor();
  await page.locator('.es-confirm-template').click();
  assert.equal((await api('/exams')).templates[0].confirmed, true); report.checks.push('past-paper analysis -> editable structure -> confirmed reusable template');
  for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: width < 500 ? 880 : 1100 }); await inspect(`${width} template builder`); }
  await page.screenshot({ path: path.join(output, 'builder-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('.sidebar').getByRole('button', {name:'练习答疑',exact:true}).click();
  await page.getByRole('tab', { name: '专项练习', exact: true }).click(); assert.ok(await page.locator('.practice-studio').isVisible());
  await page.getByRole('button', { name: '理解应用', exact: true }).click();
  await page.locator('.pb-settings[open]').waitFor();
  await page.getByLabel('练习重点', { exact: true }).fill('检查平板侧栏下的出题设置');
  for (const width of [1440, 980, 810, 768, 761, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 880 : 900 });
    await inspect(`${width} understanding practice`);
  }
  await page.screenshot({ path: path.join(output, 'practice-mobile.png'), fullPage: true });
  await page.getByRole('tab', { name: '资料答疑', exact: true }).click();
  await page.getByLabel('输入知识点问题').fill('复合函数求导');
  for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: 900 }); await inspect(`${width} source Q&A`); }
  await page.getByRole('tab', { name: '资料答疑', exact: true }).press('ArrowLeft');
  assert.equal(await page.getByRole('tab', { name: '专项练习', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByLabel('练习重点', { exact: true }).inputValue(), '检查平板侧栏下的出题设置');
  await page.getByRole('tab', { name: '专项练习', exact: true }).press('End');
  assert.equal(await page.getByLabel('输入知识点问题').inputValue(), '复合函数求导');
  await page.getByRole('tab', { name: '资料答疑', exact: true }).press('Home');
  // Retrieval stays local when no contextual model output is supplied by the fixture.
  assert.equal(await page.getByRole('tab',{name:'专项练习',exact:true}).getAttribute('aria-selected'),'true'); await page.getByRole('button',{name:'整卷模拟',exact:true}).click(); await page.getByRole('region',{name:'期末模拟考工作台'}).waitFor();
  report.checks.push('two practice tabs retain their drafts; whole-paper entry goes to the single mock exam page');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.sidebar').getByRole('button',{name:'练习答疑',exact:true}).click();
  await page.getByRole('button',{name:'回忆复习',exact:true}).click();
  await page.getByRole('heading',{name:'复习回忆',exact:true}).waitFor();
  assert.ok(await page.locator('.saved-cards').isVisible());
  assert.equal((await api('/state')).cards.length,1,'previous cards are retained and reachable inside practice');
  await page.locator('.sidebar').getByRole('button',{name:'期末模考',exact:true}).click();
  report.checks.push('legacy memory cards remain reachable from daily practice with no separate sidebar entry');
  await page.goto(`${base}?page=practice`, {waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'练习答疑',exact:true}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'练习答疑',exact:true}).waitFor();
  await page.getByRole('region',{name:'课程练习',exact:true}).waitFor();
  report.checks.push('practice deep link and refresh stay in the requested workspace');
  assert.deepEqual(report.pageErrors, []); report.passed = true; stage('passed');
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (page && !report.passed) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await browser?.close(); app?.emit('shifen:close');
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('shifen-exam-app-'));
  fs.rmSync(directory, { recursive: true, force: true });
}
