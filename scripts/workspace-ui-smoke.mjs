import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {createApp} from '../server/index.mjs';

// Every API request is redirected to a temporary server; real data/ is never used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = process.env.UI_TEST_URL || 'http://localhost:5174';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-workspace-ui-'));
const reportDir = path.join(root, 'test-results', 'workspace-ui');
const screenshots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(reportDir, {recursive: true});
fs.mkdirSync(screenshots, {recursive: true});
const report = {appUrl, isolatedBackend: true, checks: [], layouts: [], pageErrors: [], failures: []};
let server, browser, page, nextDelayedAsk;
const gates = new Set();
const until = async (check, message, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 70)); }
  throw new Error(message);
};
const bounded = (promise, label) => Promise.race([promise, new Promise((_, reject) => {const timer = setTimeout(() => reject(new Error(label)), 12000); timer.unref();})]);
const defer = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
function delayNextAsk(marker) {
  const gate = {marker, captured: defer(), released: defer(), fulfilled: defer()};
  nextDelayedAsk = gate; gates.add(gate); return gate;
}
async function release(gate) {
  gate.released.resolve(); await bounded(gate.fulfilled.promise, 'delayed /ask was not released'); gates.delete(gate);
  // Let the fetch continuation and its React commit run before checking absence.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function nav(name) {
  const mobile = (page.viewportSize()?.width || 1440) <= 760;
  await page.locator(mobile ? '.mobile-nav' : '.sidebar').getByRole('button', {name, exact: true}).click();
}
async function catalog() { await nav((page.viewportSize()?.width || 1440) <= 760 ? '课程' : '我的课程'); await page.locator('.course-catalog').waitFor(); }
async function openCourse(name) { await catalog(); await page.getByRole('button', {name: `打开${name}`, exact: true}).click(); await page.locator('.course-workspace').waitFor(); }
async function expandAssistant() {
  if (!(await page.locator('.cw-assistant').evaluate(element => element.open))) await page.locator('.cw-assistant > summary').click();
}
async function ask(question) {
  await expandAssistant(); await page.getByLabel('询问本课程知识点').fill(question);
  await page.locator('.cw-assistant').getByRole('button', {name: '查找相关资料', exact: true}).click();
}
async function directory() { if (!(await page.locator('.cw-directory').evaluate(element => element.open))) await page.locator('.cw-directory > summary').click(); }
async function readDocument(name) { await directory(); await page.getByRole('button', {name: `阅读${name}`, exact: true}).click(); await page.locator('.cw-reader-heading h2').filter({hasText: name}).waitFor(); }
async function allDocuments() { await directory(); await page.locator('.cw-directory-all').click(); await page.locator('.cw-library').waitFor(); }
async function examine(label) {
  const layout = await page.evaluate(() => ({width: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('.app-shell *')].filter(node => {const rect = node.getBoundingClientRect();return rect.width > 0 && getComputedStyle(node).display !== 'none' && (rect.right > innerWidth + 1 || rect.left < -1);}).slice(0, 6).map(node => ({tag:node.tagName, className:String(node.className), text:node.textContent.slice(0,60)}))}));
  report.layouts.push({label, ...layout});
  assert.ok(Math.max(layout.body, layout.document) <= layout.width + 1, `Horizontal overflow in ${label}: ${JSON.stringify(layout)}`);
}

try {
  server = await new Promise(resolve => {const instance = createApp({dataDir: tempDir, provider: {}}).listen(0, '127.0.0.1', () => resolve(instance));});
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (url, method = 'GET', body) => {
    const response = await fetch(`${base}/api${url}`, {method, ...(body === undefined ? {} : body instanceof FormData ? {body} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const result = await response.json(); assert.ok(response.ok, `${method} ${url}: ${JSON.stringify(result)}`); return result;
  };
  const upload = async (name, text, courseId = 'math') => {const form = new FormData();form.append('courseId', courseId);form.append('file', new Blob([text], {type:'text/plain'}), name);return api('/documents', 'POST', form);};
  const initial = await api('/state');
  const firstName = '参数方程曲率复习笔记.txt';
  const secondName = '泰勒展开余项补充说明.txt';
  await upload(firstName, '参数方程曲率：平面曲线的曲率描述切线方向随弧长变化的快慢。参数方程曲率的计算要同时考虑一阶导数和二阶导数。\n\n曲率半径：曲率非零时，曲率半径等于曲率的倒数。');
  await upload(secondName, '泰勒展开余项：泰勒多项式近似函数时，余项刻画近似误差。拉格朗日型余项包含某个中间点的高阶导数。\n\n泰勒展开的使用：展开前应检查所需阶数的可导性，并明确所考察的邻域。');
  const longName = '跨学科综合复习ResearchMethodsAndInterdisciplinaryAnalysis期末专题课程';
  const longCourse = await api('/courses', 'POST', {name:longName, examDate:'', target:85});
  const longFile = 'VeryLongUnbrokenDocumentTitleForResponsiveWorkspaceVerificationABCDEFGHIJKLMNOPQRSTUVWXYZ_跨学科综合专题与复习方法梳理.txt';
  await upload(longFile, '研究方法：资料归纳应保留证据来源。复习时先梳理知识关系，再通过练习检查理解程度。\n\n交叉学科：不同学科的概念不能仅凭词语相似就视为同一概念。', longCourse.id);
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228','1223'].map(version => path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', `chromium-${version}`, 'chrome-win64', 'chrome.exe'))].find(candidate => candidate && fs.existsSync(candidate));
  assert.ok(executablePath, 'Install Chromium with npx playwright install chromium');
  browser = await chromium.launch({headless:true, executablePath});
  const context = await browser.newContext({viewport:{width:1440,height:1000}, locale:'zh-CN', timezoneId:'Asia/Shanghai', reducedMotion:'reduce'});
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const gate = url.pathname === '/api/ask' && route.request().method() === 'POST' ? nextDelayedAsk : undefined;
    if (gate) nextDelayedAsk = undefined;
    const response = await route.fetch({url:`${base}${url.pathname}${url.search}`});
    if (gate) {
      const actual = await response.json(); gate.captured.resolve(); await gate.released.promise;
      try {await route.fulfill({status:response.status(),contentType:'application/json',body:JSON.stringify({...actual,answer:`${gate.marker}\n${actual.answer}`})});}
      finally {gate.fulfilled.resolve();}
    } else await route.fulfill({response});
  });
  page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(appUrl, {waitUntil:'domcontentloaded'}); await page.locator('.sidebar').waitFor();

  await catalog();
  const defaultNames = await page.locator('.course-tile-title').allTextContents();
  await page.getByLabel('课程排序').selectOption('name');
  assert.deepEqual(await page.locator('.course-tile-title').allTextContents(), [...defaultNames].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true})));
  await page.getByLabel('课程排序').selectOption('default');
  assert.deepEqual(await page.locator('.course-tile-title').allTextContents(), defaultNames);
  report.checks.push('course sorting changes actual order and restores default order');

  await openCourse('高等数学'); await readDocument(firstName);
  assert.ok((await page.locator('.cw-source').innerText()).includes('参数方程曲率'));
  await readDocument(secondName); assert.ok((await page.locator('.cw-source').innerText()).includes('泰勒展开余项'));
  assert.equal(await page.locator('.cw-directory-file[aria-current="true"]').count(),1);
  const sourceTab = page.getByRole('tab',{name:'阅读原文',exact:true});
  const summaryTab = page.getByRole('tab',{name:'重点摘录',exact:true});
  await summaryTab.click(); assert.equal(await summaryTab.getAttribute('aria-selected'),'true'); assert.ok(await page.locator('.cw-extracted').isVisible()); assert.ok(!(await page.locator('.cw-source').isVisible()));
  await summaryTab.press('ArrowRight'); assert.equal(await sourceTab.getAttribute('aria-selected'),'true');
  await sourceTab.press('End'); assert.equal(await summaryTab.getAttribute('aria-selected'),'true');
  await summaryTab.press('Home'); assert.equal(await sourceTab.getAttribute('aria-selected'),'true');
  await sourceTab.press('ArrowLeft'); assert.equal(await summaryTab.getAttribute('aria-selected'),'true');
  await summaryTab.press('Home');
  assert.ok(await sourceTab.evaluate(node => node === document.activeElement));
  report.checks.push('directory switches files and reader tabs respond to click, ArrowLeft/Right, Home/End with focus');

  await ask('泰勒展开余项如何描述误差？'); await page.locator('.cw-answer').waitFor();
  assert.ok((await page.locator('.cw-answer').innerText()).includes(secondName));
  await page.locator('.cw-answer details').filter({hasText:secondName}).first().locator('summary').click();
  assert.ok((await page.locator('.cw-answer details[open] p').first().innerText()).includes('泰勒展开余项'));
  report.checks.push('workspace question retrieves real course text with expandable source citation');

  let gate = delayNextAsk('STALE_AFTER_FILE_SWITCH');
  await ask('泰勒展开余项'); await bounded(gate.captured.promise, 'delayed /ask was not captured'); await readDocument(firstName); await release(gate);
  assert.equal(await page.locator('.cw-answer').count(),0); assert.equal(await page.getByLabel('询问本课程知识点').inputValue(),'');
  report.checks.push('delayed workspace reply is discarded after changing selected document');
  gate = delayNextAsk('STALE_AFTER_COURSE_SWITCH');
  await ask('参数方程曲率'); await bounded(gate.captured.promise, 'delayed /ask was not captured'); await page.getByLabel('筛选课程').selectOption('linear'); await release(gate);
  assert.equal(await page.locator('.cw-answer').count(),0); assert.equal(await page.locator('.cw-reader').count(),0);
  assert.equal(await page.locator('.cw-directory-file').count(),1);
  assert.ok(!(await page.locator('main').innerText()).includes(firstName));
  report.checks.push('delayed workspace reply and old file are discarded after course switch');

  await openCourse('高等数学'); await ask('参数方程曲率'); await page.locator('.cw-answer').waitFor();
  assert.ok((await page.locator('.cw-answer').innerText()).includes(firstName));
  await page.getByLabel(`调整${firstName}的学科`,{exact:true}).selectOption('linear');
  await until(async()=>await page.locator('.cw-answer').count()===0,'answer remains after source is moved from all-files view');
  assert.equal(await page.getByRole('button',{name:`阅读${firstName}`,exact:true}).count(),0);
  report.checks.push('all-files workspace answer clears when source document is reassigned');
  await ask('泰勒展开余项'); await page.locator('.cw-answer').waitFor();
  assert.ok((await page.locator('.cw-answer').innerText()).includes(secondName));
  await page.getByRole('button',{name:`删除${secondName}`,exact:true}).click();
  await until(async()=>await page.locator('.cw-answer').count()===0,'answer remains after source is deleted from all-files view');
  assert.ok(!(await api('/state')).documents.some(doc=>doc.name===secondName));
  report.checks.push('all-files workspace answer clears when source document is deleted');

  await nav('练习与讲解'); await page.getByRole('tab',{name:'资料答疑',exact:true}).click(); await page.getByLabel('答疑课程').selectOption('math');
  gate = delayNextAsk('STALE_PRACTICE_REPLY');
  await page.getByLabel('输入知识点问题').fill('链式法则如何求导？');
  await page.getByRole('button',{name:'查找相关资料',exact:true}).click();
  await bounded(gate.captured.promise, 'delayed /ask was not captured'); await page.getByLabel('答疑课程').selectOption('linear'); await release(gate);
  assert.equal(await page.locator('.retrieval-result').count(),0);
  assert.ok(await page.getByRole('button',{name:'查找相关资料',exact:true}).isEnabled());
  report.checks.push('practice delayed reply is discarded and submit unlocks after course switch');

  await openCourse(longName);
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:width < 500 ? 844:1000});
    await allDocuments(); await examine(`${width} long-name library`);
    await readDocument(longFile); await examine(`${width} long-name reader`);
    if(width<=900) {
      assert.equal(await page.locator('.cw-directory').evaluate(element=>element.open),false);
      await directory(); assert.ok(await page.getByRole('button',{name:`阅读${longFile}`,exact:true}).isVisible());
      await page.getByRole('button',{name:`阅读${longFile}`,exact:true}).click();
      assert.equal(await page.locator('.cw-directory').evaluate(element=>element.open),false);
    }
    await expandAssistant(); await page.getByLabel('询问本课程知识点').fill('研究方法'); await examine(`${width} long-name assistant`);
  }
  report.checks.push('1440/768/390/320px long-name library, reader, assistant layouts fit; mobile directory collapses after selection');

  await api('/reset','POST',{mode:'demo'}); await page.setViewportSize({width:1440,height:1000}); await page.reload({waitUntil:'domcontentloaded'});
  await openCourse('高等数学'); await readDocument(initial.documents[0].name);
  await page.screenshot({path:path.join(screenshots,'workbench-reader.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await examine('390 clean reader screenshot');
  await page.screenshot({path:path.join(screenshots,'workbench-mobile.png'),fullPage:true});
  assert.deepEqual(report.pageErrors,[]);
  report.passed=true;
  console.log(`Workspace UI passed: ${report.checks.length} workflow checks, ${report.layouts.length} layouts; isolated data only.`);
} catch(error) {
  report.passed=false; report.failures.push(error.stack||error.message); process.exitCode=1;
  if(page)await page.screenshot({path:path.join(reportDir,'failure.png'),fullPage:true}).catch(()=>{});
  console.error(error.stack||error.message);
} finally {
  for(const gate of gates)gate.released.resolve();
  fs.writeFileSync(path.join(reportDir,'report.json'),JSON.stringify(report,null,2));
  await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  const resolved=path.resolve(tempDir);
  if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('shifen-workspace-ui-'))throw new Error('Refusing unexpected cleanup path');
  fs.rmSync(resolved,{recursive:true,force:true});
}


