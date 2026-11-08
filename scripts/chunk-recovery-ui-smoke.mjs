import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';
import { browserExecutable } from '../server/study-document.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-chunk-recovery-'));
const out = path.resolve('.local/deep-audit/chunk-recovery'); fs.mkdirSync(out, {recursive:true});
let app, server, browser;
try {
  app = createApp({dataDir:temp}); server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless:true,executablePath:await browserExecutable()});
  for (const persistent of [false,true]) {
    const context = await browser.newContext({viewport:{width:1360,height:950},reducedMotion:'reduce'});
    let failed = 0;
    await context.route('**/assets/AppSettings-*.js', route => ++failed === 1 || persistent ? route.fulfill({status:404,body:'Old chunk removed'}) : route.continue());
    const page = await context.newPage();
    await page.goto(`${base}/?page=materials`); await page.getByRole('heading',{name:'我的课程',exact:true}).waitFor();
    await page.getByRole('button',{name:'设置',exact:true}).click();
    if (!persistent) {
      await page.getByRole('region',{name:'应用设置',exact:true}).waitFor({timeout:15000});
      assert.equal(failed,2); assert.equal(new URL(page.url()).searchParams.get('page'),'settings');
    } else {
      await page.getByRole('heading',{name:'页面暂时未打开',exact:true}).waitFor({timeout:15000});
      // StrictMode makes two import attempts per load: initial attempt plus one reload.
      assert.equal(failed,4); await page.getByRole('link',{name:'返回我的课程',exact:true}).click();
      await page.getByRole('heading',{name:'我的课程',exact:true}).waitFor();
    }
    await page.screenshot({path:path.join(out,persistent?'persistent-recovery.png':'automatic-recovery.png'),fullPage:true});
    await context.close();
  }
  const context = await browser.newContext(); let release;
  const latch = new Promise(resolve=>{release=resolve;});
  await context.route('**/api/auth/status',async route=>{await latch;await route.fulfill({contentType:'application/json',body:JSON.stringify({authenticated:true,accountExists:false})});});
  const page = await context.newPage(); await page.goto(`${base}/?page=materials`,{waitUntil:'domcontentloaded'});
  await page.getByRole('status').filter({hasText:'正在恢复你的学习空间'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'开始我的复习',exact:true}).count(),0);
  release(); await page.getByRole('heading',{name:'我的课程',exact:true}).waitFor(); await context.close();
  console.log(JSON.stringify({passed:true,checks:3,coverage:['transient chunk failure reloads current route','persistent failure shows recovery without a loop','auth check does not flash the landing page'],output:out}));
} finally {
  await browser?.close(); app?.emit('shifen:close'); if(server)await new Promise(r=>{server.closeAllConnections();server.close(r);});
  assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('shifen-chunk-recovery-'));fs.rmSync(temp,{recursive:true,force:true});
}
