import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';

// Browser integration against disposable state only. Every API call is redirected.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = process.env.UI_TEST_URL || 'http://localhost:5174';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-threeui-'));
const screenshots = path.join(root, 'docs', 'screenshots');
const reportDir = path.join(root, 'test-results', 'threeui');
fs.mkdirSync(screenshots, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });
const report = { isolatedBackend: true, checks: [], layouts: [], pageErrors: [], failures: [] };
let server, browser, page;

async function examine(label) {
  await page.locator('main').waitFor();
  const result = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    font: getComputedStyle(document.querySelector('.app-shell')).fontSize,
    bodyWidth: document.body.scrollWidth,
  }));
  report.layouts.push({ label, ...result });
  assert.ok(Math.max(result.scrollWidth, result.bodyWidth) <= result.width + 1, `Overflow: ${label} ${JSON.stringify(result)}`);
}
async function nav(name) {
  const mobile = page.viewportSize().width <= 760;
  const labels = { '我的课程': '课程', '复习计划': '计划', '练习与讲解': '练习', '记忆卡片': '记忆', '网课精读': '精读' };
  const label = mobile ? labels[name] || name : name;
  await page.locator(mobile ? '.mobile-nav' : '.sidebar').getByRole('button', { name: new RegExp(`^${label}(?:\\s*\\d+)?$`) }).click();
}
async function snapshot(name) {
  await page.screenshot({ path: path.join(screenshots, `threeui-${name}.png`), fullPage: true, animations: 'disabled' });
}

try {
  server = await new Promise(resolve => { const instance = createApp({ dataDir: directory, provider: {}, authEnabled: false }).listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const initial = await (await fetch(`${base}/api/state`)).json();
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228', '1223'].map(version => path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', `chromium-${version}`, 'chrome-win64', 'chrome.exe'))].find(item => item && fs.existsSync(item));
  assert.ok(executablePath, 'Chromium is required');
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const response = await fetch(base + url.pathname + url.search, { method: request.method(), headers: { ...(request.headers()['content-type'] ? { 'Content-Type': request.headers()['content-type'] } : {}) }, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) });
    await route.fulfill({ status: response.status, contentType: response.headers.get('content-type') || 'application/json', body: Buffer.from(await response.arrayBuffer()) });
  });
  page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell').waitFor();
  await examine('1440/home');
  await snapshot('desktop-home');

  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: '快速找到你的学习内容' }).waitFor();
  assert.equal(await page.getByRole('combobox').evaluate(element => document.activeElement === element), true);
  await snapshot('command');
  await page.getByRole('combobox').fill(initial.courses[0].name);
  await page.keyboard.press('Enter');
  await page.locator('.course-workspace').waitFor();
  assert.ok((await page.locator('main h1').innerText()).includes(initial.courses[0].name));
  report.checks.push('Ctrl+K focuses search; Enter opens a real course');

  await page.getByRole('button', { name: '打开快捷搜索', exact: true }).click();
  const doc = initial.documents.find(item => item.courseId && item.chunks.length);
  assert.ok(doc);
  await page.getByRole('combobox').fill(doc.name);
  await page.getByRole('option').filter({ hasText: doc.name }).first().click();
  await page.locator('.cw-reader-heading h2').filter({ hasText: doc.name }).waitFor();
  report.checks.push('document result opens its own course and source reader');

  await page.getByRole('button', { name: '打开快捷搜索', exact: true }).click();
  await page.getByRole('combobox').fill('没有这个结果-0432');
  await page.getByText('还没有找到匹配的内容', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.sf-command-panel').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开快捷搜索');
  assert.equal(await page.getByRole('button', { name: '打开快捷搜索', exact: true }).evaluate(element => document.activeElement === element), true);
  report.checks.push('empty search is useful; Escape closes and restores focus');

  for (const [width, height] of [[1440, 1000], [1024, 900], [768, 1024], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    for (const name of ['首页', '我的课程', '复习计划', '练习与讲解', '记忆卡片', '网课精读']) {
      await nav(name);
      if (name === '复习计划') await page.locator('.sp-calendar-heading').waitFor();
      if (name === '网课精读') await page.locator('.lesson-studio').waitFor();
      await examine(`${width}/${name}`);
      if (width === 1440 && name === '我的课程') await snapshot('desktop-courses');
      if (width === 1440 && name === '复习计划') await snapshot('desktop-planner');
      if (width === 390 && name === '首页') await snapshot('mobile-home');
      if (width === 390 && name === '复习计划') await snapshot('mobile-planner');
    }
    await page.getByRole('button', { name: '打开快捷搜索', exact: true }).click();
    await page.getByRole('combobox').fill('复习计划');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.locator('.study-planner').waitFor();
  }
  report.checks.push('all six learning pages fit desktop/tablet/mobile widths; keyboard palette works at each width');
  assert.deepEqual(report.pageErrors, []);
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failures.push(error.message);
  if (page) await page.screenshot({ path: path.join(screenshots, 'threeui-failure.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(directory, { recursive: true, force: true });
}
