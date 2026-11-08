import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {createApp} from '../server/index.mjs';

// Exercise the real Vite app against an isolated backend. Never touches data/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = process.env.UI_TEST_URL || 'http://localhost:5174';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-ui-smoke-'));
const screenshotDir = path.join(root, 'docs', 'screenshots');
const reportDir = path.join(root, 'test-results', 'ui-smoke');
fs.mkdirSync(screenshotDir, {recursive: true});
fs.mkdirSync(reportDir, {recursive: true});
const report = {appUrl, isolatedBackend: true, interactions: [], viewports: [], pageErrors: [], failures: []};
let server;
let browser;
let activePage;

const expect = async (check, message, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(message);
};

async function examine(page, viewport, surface) {
  await page.locator('main').waitFor();
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    offenders: [...document.querySelectorAll('main *, header *, nav *')]
      .filter(element => {const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width && (rect.right > innerWidth + 1 || rect.left < -1);})
      .slice(0, 8).map(element => ({tag: element.tagName, className: String(element.className), text: element.textContent?.slice(0, 80)})),
  }));
  report.viewports.push({viewport, surface, ...layout});
  if (Math.max(layout.documentWidth, layout.bodyWidth) > layout.width + 1) report.failures.push(`${viewport}/${surface}: horizontal overflow ${layout.documentWidth}px > ${layout.width}px`);
}

async function nav(page, name, mobile = false) {
  const container = page.locator(mobile ? '.mobile-nav' : '.sidebar');
  await container.getByRole('button', {name: new RegExp(`^${name}`)}).click();
  await page.locator('main h1').waitFor();
}

try {
  server = await new Promise(resolve => {const instance = createApp({dataDir: tempDir, provider: {}}).listen(0, '127.0.0.1', () => resolve(instance));});
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const readState = async () => (await fetch(`${apiBase}/api/state`)).json();
  const initial = await readState();
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228','1223'].map(version => path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', `chromium-${version}`, 'chrome-win64', 'chrome.exe'))].filter(Boolean);
  const executablePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!executablePath) throw new Error('No installed Chromium executable. Run npx playwright install chromium.');
  browser = await chromium.launch({headless: true, executablePath});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce'});
  await context.route('**/api/**', async route => {
    const original = new URL(route.request().url());
    const response = await route.fetch({url: `${apiBase}${original.pathname}${original.search}`});
    await route.fulfill({response});
  });
  const page = activePage = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(appUrl, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /把资料放进来/}).waitFor();
  await examine(page, 'desktop', 'dashboard-initial');

  await nav(page, '我的课程');
  const testCourseName = '交互测试课程';
  await page.getByRole('button', {name: '新建课程', exact: true}).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('[name="name"]').fill(testCourseName);
  const exam = new Date(); exam.setDate(exam.getDate() + 40);
  await dialog.locator('[name="examDate"]').fill(exam.toISOString().slice(0, 10));
  await dialog.locator('[name="target"]').fill('55');
  await dialog.getByRole('button', {name: '创建课程'}).click();
  await dialog.waitFor({state: 'hidden'});
  let state = await readState();
  const course = state.courses.find(item => item.name === testCourseName);
  assert.ok(course?.id, 'course creation persists');
  assert.equal(course.target, 55);
  report.interactions.push('add course with target 55');

  await page.locator('.course-tile-main').filter({hasText: initial.courses[1].name}).click();
  assert.equal(await page.getByLabel('筛选课程').inputValue(), initial.courses[1].id);
  assert.ok(await page.getByRole('button',{name:'添加到此学科'}).isVisible());
  await examine(page, 'desktop', 'second-course-upload-destination');
  await nav(page, '我的课程');
  await page.locator('.course-tile-main').filter({hasText: testCourseName}).click();
  assert.equal(await page.getByLabel('筛选课程').inputValue(), course.id);
  assert.ok(await page.getByRole('button',{name:'添加到此学科'}).isVisible());
  report.interactions.push('enter second course and synchronize upload destination on course changes');
  const uploadedText = '链式法则的定义：复合函数的导数等于外层函数的导数乘以内层函数的导数。\n\n连续性：函数在某点的极限等于该点的函数值。\n\n导数：函数值随自变量变化的瞬时变化率。';
  await page.getByLabel('上传学习资料').setInputFiles({name: '交互测试笔记.txt', mimeType: 'text/plain', buffer: Buffer.from(uploadedText)});
  await page.locator('.document-name').filter({hasText: '交互测试笔记.txt'}).waitFor();
  await page.locator('.document-name').filter({hasText: '交互测试笔记.txt'}).click();
  await page.getByRole('heading', {name: '原文与出处'}).waitFor();
  assert.ok(await page.locator('.source-pages').getByText(/链式法则的定义/).isVisible());
  await examine(page, 'desktop', 'document-reader');
  report.interactions.push('upload TXT and inspect extracted summary/source');

  await nav(page, '练习与讲解');
  await page.getByRole('tab', {name: '资料答疑', exact: true}).click();
  await page.getByLabel('输入知识点问题').fill('链式法则如何求导？');
  await page.getByRole('button', {name: '查找相关资料'}).click();
  await page.locator('.retrieval-result').waitFor();
  assert.ok((await page.locator('.retrieval-result').innerText()).includes('交互测试笔记.txt'));
  assert.ok((await page.locator('.retrieval-result summary').first().innerText()).includes('段'));
  await examine(page, 'desktop', 'retrieval-answer');
  report.interactions.push('query uploaded notes with source attribution');

  await page.getByRole('tab', {name: '专项练习', exact: true}).click();
  await page.getByRole('button', {name: '从资料生成练习', exact: true}).click();
  await expect(async () => (await readState()).questions.some(item => item.courseId === course.id), 'source recall questions not generated');
  const generatedQuestion = (await readState()).questions.find(item => item.courseId === course.id);
  await page.locator('.option').nth((generatedQuestion.answer + 1) % generatedQuestion.options.length).click();
  await page.getByRole('button', {name: '提交答案'}).click();
  await page.locator('.answer-panel.wrong').waitFor();
  await page.getByRole('button', {name: '只练错题', exact: true}).click();
  await page.getByRole('button', {name: '查看全部题目', exact: true}).waitFor();
  assert.equal((await page.locator('.question-prompt').innerText()).replace(/\s+/g, ''), generatedQuestion.prompt.replace(/\s+/g, ''));
  await examine(page, 'desktop', 'generated-wrong-question-filter');
  report.interactions.push('generate source recall questions, answer incorrectly and filter mistakes');

  await page.locator('.option').nth(generatedQuestion.answer).click();
  await page.getByRole('button', {name: '提交答案'}).click();
  await page.locator('.answer-panel.right').waitFor();
  await expect(async () => (await readState()).attempts.filter(item => item.questionId === generatedQuestion.id).at(-1)?.correct === true, 'correct retry not persisted');
  assert.equal((await page.locator('.question-prompt').innerText()).replace(/\s+/g, ''), generatedQuestion.prompt.replace(/\s+/g, ''), 'wrong-only mode must retain the answered question until Next');
  assert.ok((await page.locator('.answer-panel.right').innerText()).includes(generatedQuestion.options[generatedQuestion.answer]));
  assert.ok(await page.getByRole('button', {name: '下一题', exact: true}).isEnabled());
  await examine(page, 'desktop', 'wrong-filter-correct-answer-retained');
  await page.getByRole('button', {name: '下一题', exact: true}).click();
  await page.getByRole('heading', {name: '当前没有待巩固的错题', exact: true}).waitFor();
  assert.equal(await page.locator('.question-prompt').count(), 0);
  assert.equal(await page.locator('.answer-panel').count(), 0);
  await examine(page, 'desktop', 'wrong-filter-empty-after-next');
  await page.getByRole('button', {name: '查看全部题目', exact: true}).click();
  report.interactions.push('retain correct retry feedback in wrong-only mode until Next removes the resolved mistake');

  await nav(page, '记忆卡片');
  await page.getByRole('button', {name: '新建卡片'}).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('[name="courseId"]').selectOption(course.id);
  await dialog.locator('[name="front"]').fill('链式法则的关键是什么？');
  await dialog.locator('[name="back"]').fill('外层导数乘以内层导数，分清复合结构。');
  await dialog.getByRole('button', {name: '保存卡片'}).click();
  await dialog.waitFor({state: 'hidden'});
  await page.getByRole('button', {name: '看看答案'}).click();
  assert.ok((await page.locator('.card-back').innerText()).includes('外层导数'));
  await examine(page, 'desktop', 'memory-flipped');
  await page.getByRole('button', {name: '记得清楚', exact: true}).click();
  await expect(async () => (await readState()).cards.find(item => item.courseId === course.id)?.fsrs?.reps === 1, 'FSRS review not persisted');
  report.interactions.push('create flashcard, flip, rate and persist FSRS schedule');

  await nav(page, '练习与讲解');
  await page.getByRole('tab', {name: '专项练习', exact: true}).click();
  await page.getByLabel('筛选课程').selectOption(initial.courses[0].id);
  const beforeAttemptCount = (await readState()).attempts.length;
  await page.locator('.option').first().click();
  await page.getByRole('button', {name: '提交答案'}).click();
  await page.locator('.answer-panel').waitFor();
  await expect(async () => (await readState()).attempts.length === beforeAttemptCount + 1, 'practice attempt not persisted');
  assert.ok((await page.locator('.answer-panel li').count()) > 0);
  await examine(page, 'desktop', 'practice-feedback');
  report.interactions.push('answer question and inspect stepwise feedback');
  const answeredPrompt = await page.locator('.question-prompt').innerText();
  await page.getByRole('button', {name: '下一题', exact: true}).click();
  await expect(async () => (await page.locator('.question-prompt').innerText()) !== answeredPrompt, 'Next did not advance to another question in all-questions mode');
  assert.equal(await page.locator('.answer-panel').count(), 0);
  assert.ok(await page.getByRole('button', {name: '提交答案'}).isDisabled(), 'next question must require a fresh selection');
  await examine(page, 'desktop', 'next-question-clears-feedback');
  report.interactions.push('advance to a new question in all-questions mode with cleared selection and explanation');

  await nav(page, '复习计划');
  let check = page.locator('.plan-list .task-check').first();
  const label = await check.getAttribute('aria-label');
  await check.click();
  await expect(async () => (await readState()).completedTasks.length === initial.completedTasks.length + 1, 'task completion not persisted');
  await page.getByRole('button', {name: label.replace(/^完成/, '恢复'), exact: true}).click();
  await expect(async () => (await readState()).completedTasks.length === initial.completedTasks.length, 'task undo not persisted');
  await examine(page, 'desktop', 'plan');
  report.interactions.push('complete and undo plan task');

  await page.getByRole('button', {name: '学习偏好', exact: true}).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('[name="dailyMinutes"]').fill('120');
  await dialog.getByRole('button', {name: '保存学习偏好'}).click();
  await dialog.waitFor({state: 'hidden'});
  assert.equal((await readState()).settings.dailyMinutes, 120);
  await page.getByRole('button', {name: '学习偏好', exact: true}).click();
  await page.getByRole('dialog').locator('[name="dailyMinutes"]').fill(String(initial.settings.dailyMinutes));
  await page.getByRole('dialog').getByRole('button', {name: '保存学习偏好'}).click();
  await page.getByRole('dialog').waitFor({state: 'hidden'});
  report.interactions.push('save study budget and restore original preference');

  await nav(page, '我的课程');
  await page.getByRole('button', {name: `编辑${testCourseName}`, exact: true}).click();
  await page.getByRole('dialog').getByRole('button', {name: '删除课程及其资料'}).click();
  await page.getByRole('dialog').waitFor({state: 'hidden'});
  state = await readState();
  assert.ok(!state.courses.some(item => item.id === course.id));
  assert.ok(!state.documents.some(item => item.courseId === course.id));
  assert.ok(!state.cards.some(item => item.courseId === course.id));
  report.interactions.push('delete temporary course and verify cascade');

  // Restore only the isolated demo for clean review screenshots.
  await fetch(`${apiBase}/api/reset`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode: 'demo'})});
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /把资料放进来/}).waitFor();
  await page.screenshot({path: path.join(screenshotDir, 'desktop.png'), fullPage: true});
  await nav(page, '我的课程');
  await expect(async()=>await page.locator('.course-tile-cover img').evaluateAll(images=>images.length>0&&images.every(image=>image.complete&&image.naturalWidth>0)), 'course cover images not loaded');
  assert.equal(await page.locator('.course-catalog-grid').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),4);
  await examine(page,'desktop','course-catalog');
  await page.screenshot({path: path.join(screenshotDir, 'courses-desktop.png'),fullPage:true});
  await page.locator('.course-tile-main').first().click();
  await examine(page,'desktop','course-workbench');
  assert.equal(await page.locator('.document-row').count(),1,'workbench must show only the selected course documents');
  await page.screenshot({path:path.join(screenshotDir,'workbench-desktop.png'),fullPage:true});
  for (const name of ['我的课程', '复习计划', '练习与讲解', '记忆卡片', '精选学习资源']) {
    await nav(page, name);
    await examine(page, 'desktop', name);
    const shotName = {'复习计划': 'plan', '练习与讲解': 'practice', '记忆卡片': 'memory'}[name];
    if (shotName) await page.screenshot({path: path.join(screenshotDir, `${shotName}-desktop.png`), fullPage: true});
  }

  await page.setViewportSize({width: 390, height: 844});
  await nav(page, '首页', true);
  await examine(page, 'mobile', 'dashboard');
  await page.screenshot({path: path.join(screenshotDir, 'mobile.png'), fullPage: true});
  await nav(page,'课程',true);
  await expect(async()=>await page.locator('.course-tile-cover img').evaluateAll(images=>images.length>0&&images.every(image=>image.complete&&image.naturalWidth>0)), 'mobile covers not loaded');
  await page.screenshot({path:path.join(screenshotDir,'courses-mobile.png'),fullPage:true});
  for (const name of ['课程', '计划', '练习', '记忆']) {
    await nav(page, name, true);
    await examine(page, 'mobile', name);
  }
  await page.getByRole('button', {name: '学习设置', exact: true}).click();
  await examine(page, 'mobile', 'settings-dialog');
  await page.getByRole('dialog').getByRole('button', {name: '精选资源', exact: true}).click();
  await examine(page, 'mobile', 'resources');
  assert.deepEqual(report.pageErrors, [], 'browser page errors');
  assert.deepEqual(report.failures, [], 'layout failures');
  report.passed = true;
  console.log(`UI smoke passed: ${report.interactions.length} workflows, ${report.viewports.length} viewport/state checks, no page errors or horizontal overflow.`);
} catch (error) {
  report.passed = false;
  report.failures.push(error.stack || error.message);
  if (activePage) await activePage.screenshot({path: path.join(reportDir, 'failure.png'), fullPage: true}).catch(() => {});
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  // Restrict recursive cleanup to the exact mkdtemp directory we created.
  const resolved = path.resolve(tempDir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('shifen-ui-smoke-')) throw new Error('Refusing unexpected cleanup path');
  fs.rmSync(resolved, {recursive: true, force: true});
}
