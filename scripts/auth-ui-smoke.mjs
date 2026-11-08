import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createEmpty} from '../server/seed.mjs';

// This frontend has no backend. Every API request is fulfilled locally, including
// failures and delayed responses; no real account, cookie, or study data is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const anonymous = {authenticated:false, accountExists:true};
const signedIn = {...anonymous, authenticated:true, user:{name:'认证测试', email:'audit@example.test'}};
const unavailable = {status:503, json:{error:'Isolated authentication test failure'}};
const checks = [];
const pageErrors = [];
const unexpectedRequests = [];
const contexts = [];
let vite, browser, appUrl;
const defer = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};

async function fixture(onStatus) {
  const context = await browser.newContext({locale:'zh-CN', reducedMotion:'reduce', serviceWorkers:'block'});
  contexts.push(context);
  const counts = {status:0, login:0, logout:0};
  let expired = false;
  await context.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/status' && request.method() === 'GET') return onStatus(route, ++counts.status);
    if (pathname === '/api/auth/login' && request.method() === 'POST') {
      counts.login++;
      assert.deepEqual(request.postDataJSON(), {email:'audit@example.test', password:'synthetic-password-42'});
      expired = false;
      return route.fulfill({status:200, json:signedIn});
    }
    if (pathname === '/api/auth/logout' && request.method() === 'POST') {
      counts.logout++;
      return route.fulfill({status:200, json:anonymous});
    }
    if (pathname === '/api/state' && request.method() === 'GET') {
      return route.fulfill(expired
        ? {status:401, json:{error:'请先登录，再继续你的复习。'}}
        : {status:200, json:{...createEmpty(), providerConfigured:false}});
    }
    unexpectedRequests.push(`${request.method()} ${pathname}`);
    return route.fulfill(unavailable);
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(appUrl, {waitUntil:'domcontentloaded'});
  await page.locator('.auth-page, .app-shell').first().waitFor();
  return {page, counts, expire:async () => {
    expired = true;
    // Exercise the production API wrapper's 401 -> session-expired event path.
    await page.evaluate(async () => {
      const {api} = await import('/src/api.ts');
      try {await api('/state');} catch { /* Expected mocked 401. */ }
    });
    await page.locator('.auth-page').waitFor();
  }};
}

async function login(page) {
  await page.getByRole('button', {name:'登录考谱', exact:true}).click();
  await page.getByLabel('邮箱', {exact:true}).fill('audit@example.test');
  await page.getByLabel('密码', {exact:true}).fill('synthetic-password-42');
  await page.getByRole('button', {name:'登录，继续考谱', exact:true}).click();
  await page.locator('.app-shell').waitFor();
}

async function release(page, pending, response) {
  const route = await pending.promise;
  const received = page.waitForResponse(response => response.request() === route.request());
  await route.fulfill(response);
  await (await received).finished();
  // Allow the fetch continuation and React commit while other requests stay held.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

try {
  vite = await createServer({root, server:{host:'127.0.0.1', port:0, strictPort:false}, logLevel:'error'});
  await vite.listen();
  appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(),
    ...['1228', '1223'].map(version => path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', `chromium-${version}`, 'chrome-win64', 'chrome.exe'))]
    .find(candidate => candidate && fs.existsSync(candidate));
  assert.ok(executablePath, 'Install Chromium with npx playwright install chromium');
  browser = await chromium.launch({headless:true, executablePath});

  for (const lateFailure of [false, true]) {
    const pending = defer();
    const {page, counts, expire} = await fixture((route, count) => {
      if (count === 1) {pending.resolve(route); return;}
      return route.fulfill({status:200, json:anonymous});
    });
    await login(page);
    assert.equal(counts.status, 2, 'StrictMode should exercise both initial status requests');
    await release(page, pending, lateFailure ? unavailable : {status:200, json:anonymous});
    assert.equal(await page.locator('.app-shell').count(), 1, 'Late status must not undo successful login');
    await expire();
    await page.getByRole('button', {name:'登录考谱', exact:true}).click();
    assert.equal(await page.locator('.auth-error').count(), 0, 'Late status errors must not survive expiration');
    assert.equal(await page.getByRole('button', {name:'登录，继续考谱', exact:true}).isEnabled(), true);
    checks.push(lateFailure ? 'late status failure ignored after login; API 401 expires normally' : 'late anonymous status cannot overwrite successful login');
    await page.context().close();
  }

  {
    const pending = [defer(), defer()];
    const {page} = await fixture((route, count) => {pending[count - 1].resolve(route);});
    await Promise.all(pending.map(item => item.promise));
    await page.evaluate(() => window.dispatchEvent(new Event('shifen:session-expired')));
    for (const item of pending) await release(page, item, {status:200, json:signedIn});
    assert.equal(await page.locator('.auth-page').count(), 1, 'Expiration must invalidate pending authenticated status');
    assert.equal(await page.locator('.app-shell').count(), 0);
    checks.push('expiration ignores pending authenticated status');
    await page.context().close();
  }

  {
    const pending = defer();
    const {page, counts} = await fixture((route, count) => {
      if (count === 1) {pending.resolve(route); return;}
      return route.fulfill(count === 2 ? unavailable : {status:200, json:anonymous});
    });
    await page.getByRole('button', {name:'登录考谱', exact:true}).click();
    await page.getByText('暂时无法连接考谱服务，请检查服务后重试。', {exact:true}).waitFor();
    assert.equal(await page.getByRole('button', {name:'登录，继续考谱', exact:true}).isEnabled(), false);
    await page.getByRole('button', {name:'重试', exact:true}).click();
    await page.getByRole('button', {name:'登录，继续考谱', exact:true}).waitFor({state:'visible'});
    await page.getByLabel('邮箱', {exact:true}).fill('audit@example.test');
    await page.getByLabel('密码', {exact:true}).fill('synthetic-password-42');
    await page.getByRole('button', {name:'登录，继续考谱', exact:true}).click();
    await page.locator('.app-shell').waitFor();
    await page.getByRole('button', {name:'退出登录', exact:true}).click();
    await page.locator('.auth-page').waitFor();
    await release(page, pending, {status:200, json:signedIn});
    assert.equal(await page.locator('.app-shell').count(), 0, 'Late status must not reverse logout');
    assert.equal(await page.locator('.auth-page').count(), 1);
    assert.deepEqual(counts, {status:3, login:1, logout:1});
    checks.push('retry recovers connection failure; logout ignores late authenticated status');
    await page.context().close();
  }

  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({allApiMocked:true, checks, pageErrors}, null, 2));
} finally {
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser?.close();
  await vite?.close();
}
