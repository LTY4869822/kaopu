import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-settings-ui-'));
const output = path.resolve('test-results/settings-navigation'); fs.mkdirSync(output, { recursive: true });
const report = { isolatedBackend: true, modelApiMocked: true, checks: [], layouts: [], errors: [] };
const status = () => ({ configured: false, verified: false, baseUrl: '', model: '', hasKey: false, maskedKey: '', useTextProvider: false, verifiedAt: null });
const connections = { text: status(), vision: status() }, calls = [];
let app, server, browser;
try {
  app = createApp({ dataDir: temp }); server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'empty' }) });
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228','1223'].map(v => path.join(os.homedir(),'AppData/Local/ms-playwright',`chromium-${v}`,'chrome-win64/chrome.exe'))].filter(Boolean).find(fs.existsSync); assert.ok(executablePath);
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname === '/api/auth/status') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, accountExists: true, user: { name: '测试同学' } }) });
    if (u.pathname.startsWith('/api/model-service')) {
      const body = req.postDataJSON();
      if (req.method() !== 'GET') calls.push({ path: u.pathname, method: req.method(), hasKey: !!body?.apiKey, reuse: body?.useTextProvider });
      if (req.method() === 'PUT') { const kind = u.pathname.split('/').at(-1), value = body.useTextProvider ? connections.text : body;
        connections[kind] = { configured: true, verified: true, baseUrl: value.baseUrl, model: value.model, hasKey: !!body.apiKey || connections[kind].hasKey, maskedKey: '****test', useTextProvider: !!body.useTextProvider, verifiedAt: '2026-11-05T00:00:00Z' }; }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(req.method() === 'POST' ? { ok: true } : connections) });
    }
    const res = await route.fetch({ url: `${base}${u.pathname}${u.search}` }); await route.fulfill({ response: res });
  });
  const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto('http://localhost:5174/?page=settings', { waitUntil: 'domcontentloaded' });
  await page.getByRole('region', { name: '应用设置' }).waitFor();
  assert.deepEqual(await page.locator('.sidebar nav button').allTextContents(), ['资料导入','我的课程','复习规划','网课笔记','练习答疑','期末模考']);
  assert.equal(await page.locator('.sidebar-bottom .nav-item').innerText(), '设置');
  assert.equal(await page.locator('.sidebar-bottom .nav-item').getAttribute('aria-current'), 'page');
  await page.getByLabel('模型接口地址', { exact: true }).fill('https://fixture.test/v1');
  await page.getByLabel('模型名称', { exact: true }).fill('fixture-text');
  await page.getByLabel('API 密钥', { exact: true }).fill('synthetic-ui-key');
  await page.getByRole('button', { name: '仅测试', exact: true }).click(); await page.getByText('文字生成测试通过，保存后即可使用。', { exact: true }).waitFor();
  assert.equal(connections.text.configured, false);
  await page.getByRole('button', { name: '测试并保存', exact: true }).click(); await page.getByText('已验证', { exact: true }).waitFor(); assert.equal(await page.getByLabel('API 密钥', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: '视觉模型', exact: true }).click(); await page.getByRole('checkbox', { name: /复用文字模型/ }).check();
  await page.getByRole('button', { name: '测试并保存', exact: true }).click(); await page.getByText('视觉模型已连接，可以识别板书。', { exact: true }).waitFor();
  assert.ok(calls.some(c => c.path === '/api/model-service/text/test' && c.method === 'POST'));
  assert.ok(calls.some(c => c.path === '/api/model-service/text' && c.method === 'PUT' && c.hasKey));
  assert.ok(calls.some(c => c.path === '/api/model-service/vision' && c.reuse));
  report.checks.push('navigation names/order match learning flow; embedded text API test/save clears key; vision reuse saves through existing API');
  await page.getByRole('tab', { name: '复习偏好', exact: true }).click();
  await page.getByLabel('怎么称呼你', { exact: true }).fill('期末复习同学');
  await page.getByLabel('默认每天复习时间', { exact: true }).fill('135');
  await page.getByRole('radio', { name: /面向高分冲刺/ }).check();
  await page.getByRole('button', { name: '保存复习偏好', exact: true }).click(); await page.getByText('复习偏好已保存。', { exact: true }).waitFor();
  let state = await (await fetch(`${base}/api/state`)).json(); assert.equal(state.settings.dailyMinutes, 135); assert.equal(state.settings.goal, 'high');
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  await page.getByRole('tab', { name: '复习偏好', exact: true }).click(); assert.equal(await page.getByLabel('默认每天复习时间', { exact: true }).inputValue(), '135');
  await page.getByRole('tab', { name: '复习偏好', exact: true }).press('ArrowRight'); assert.equal(await page.getByRole('tab', { name: '账户与数据', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('link', { name: '导出学习数据', exact: true }).getAttribute('href'), '/api/export');
  await page.locator('.st-advanced > summary').click(); await page.getByRole('button', { name: '打开清空确认', exact: true }).click();
  await page.getByRole('dialog', { name: '开始自己的复习空间', exact: true }).waitFor();
  assert.equal((await (await fetch(`${base}/api/state`)).json()).settings.dailyMinutes, 135);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  report.checks.push('preferences persist through reload; settings tabs support keyboard; export and destructive confirmation remain separated');
  async function inspect(label) { const v = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, small: [...document.querySelectorAll('.app-settings button,.app-settings a.secondary,.app-settings input:not([type="radio"]):not([type="checkbox"]),.app-settings summary')].filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43).map(e => e.textContent || e.getAttribute('aria-label')) })); report.layouts.push({ label, ...v }); assert.ok(v.scrollWidth <= v.width + 1, label); assert.deepEqual(v.small, [], label); }
  for (const width of [1440, 980, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1050 });
    for (const [tab, name] of [['api','API 与模型'], ['study','复习偏好'], ['account','账户与数据']]) { await page.getByRole('tab', { name, exact: true }).click(); await inspect(tab); if (width === 1440 || width === 390) await page.screenshot({ path: path.join(output, `${tab}-${width}.png`), fullPage: true }); }
  }
  assert.deepEqual(await page.locator('.mobile-nav button').allTextContents(), ['导入','课程','规划','网课','练习','模考']);
  await page.setViewportSize({ width: 1440, height: 1050 });
  for (const [label, title] of [['我的课程','我的课程'],['复习规划','复习规划'],['网课笔记','网课笔记'],['练习答疑','练习答疑'],['期末模考','期末模考']]) { await page.locator('.sidebar nav').getByRole('button', { name: label, exact: true }).click(); await page.getByRole('heading', { name: title, exact: true }).waitFor(); }
  await page.getByRole('button', { name: '打开快捷搜索', exact: true }).click(); await page.locator('.sf-command-search input').fill('设置');
  await page.getByRole('option').filter({ hasText: 'API 配置' }).click(); await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  report.checks.push('15 responsive layouts fit; mobile order matches desktop; renamed pages and command search reach the expected destinations');
  assert.deepEqual(report.errors, []); report.passed = true; console.log(JSON.stringify({ checks: report.checks.length, layouts: report.layouts.length, output }));
} catch (e) { report.failure = e.stack; throw e; }
finally { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser?.close(); app?.emit('shifen:close'); if (server) await new Promise(r => { server.closeAllConnections(); server.close(r); }); assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith('shifen-settings-ui-')); fs.rmSync(temp, { recursive: true, force: true }); }
