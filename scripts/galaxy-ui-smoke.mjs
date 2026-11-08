import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'shifen-galaxy-ui-'));
const output = path.resolve('test-results/galaxy-ui'); fs.mkdirSync(output,{recursive:true});
const report = { isolatedBackend:true, normalAndReducedMotion:true, checks:[], errors:[] };
let app, server, browser, releaseTest, testCalls = 0;
const gate = new Promise(r=>{releaseTest=r;});
try {
 app=createApp({dataDir:directory}); server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); const base=`http://127.0.0.1:${server.address().port}`;
 const executablePath=[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,chromium.executablePath(),...['1228','1223'].map(v=>path.join(os.homedir(),'AppData/Local/ms-playwright',`chromium-${v}`,'chrome-win64/chrome.exe'))].filter(Boolean).find(fs.existsSync);
 browser=await chromium.launch({headless:true,executablePath}); const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'zh-CN',reducedMotion:'no-preference'});
 await context.route('**/api/**',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/api/model-service') { const c={configured:false,verified:false,baseUrl:'',model:'',hasKey:false,maskedKey:'',useTextProvider:false,verifiedAt:null};return route.fulfill({contentType:'application/json',body:JSON.stringify({text:c,vision:c})}); }
  if(u.pathname==='/api/model-service/text/test') {testCalls++;await gate;return route.fulfill({contentType:'application/json',body:'{"ok":true}'});}
  const r=await route.fetch({url:`${base}${u.pathname}${u.search}`});await route.fulfill({response:r}); });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(process.env.UI_TEST_URL || 'http://localhost:5174/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('.sf-drop-symbol').waitFor();assert.equal(await page.locator('.batch-file-stack').count(),0);assert.ok(await page.getByRole('button',{name:'开始分析',exact:true}).isDisabled());
 assert.equal(await page.locator('.batch-drop').evaluate(el=>getComputedStyle(el).backgroundImage),'none');await page.screenshot({path:path.join(output,'import-desktop.png'),fullPage:true});
 await page.locator('.sidebar').getByRole('button',{name:'我的课程',exact:true}).click();await page.locator('.course-tile').first().waitFor();await page.locator('.course-tile').first().hover();
 assert.equal(await page.locator('.course-tile-book').first().evaluate(el=>getComputedStyle(el).transform),'none');await page.screenshot({path:path.join(output,'courses-desktop.png'),fullPage:true});
 report.checks.push('simplified import has no fake paper stack; course hover retains a stable flat cover; empty analysis is disabled');
 await page.locator('.sidebar-bottom').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'视觉模型',exact:true}).click();
 await page.waitForFunction(()=>{const el=document.querySelector('.model-service-tabs');const s=getComputedStyle(el,'::before');return s.transform!=='none'&&Math.abs(new DOMMatrix(s.transform).m41-parseFloat(s.width))<1;});
 await page.getByRole('button',{name:'文字模型',exact:true}).click();await page.waitForFunction(()=>Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.model-service-tabs'),'::before').transform).m41)<1);
 await page.getByLabel('模型接口地址',{exact:true}).fill('https://fixture.test/v1');await page.getByLabel('模型名称',{exact:true}).fill('test-model');
 await page.getByRole('button',{name:'仅测试',exact:true}).click();await page.locator('.sf-action[aria-busy="true"] .sf-loading-mark').waitFor();assert.equal(testCalls,1);
 assert.ok(await page.getByRole('button',{name:'正在测试…',exact:true}).isDisabled());assert.equal(await page.locator('.sf-action .sf-loading-mark').evaluate(el=>getComputedStyle(el).animationName),'sf-control-spin');
 await page.screenshot({path:path.join(output,'pending-desktop.png'),fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.sf-action .sf-loading-mark').evaluate(el=>getComputedStyle(el).animationName),'none');
 releaseTest();await page.getByText('文字生成测试通过，保存后即可使用。',{exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'仅测试',exact:true}).isEnabled());assert.equal(testCalls,1);
 report.checks.push('selected segment reaches both ends; pending state blocks repeat action; reduced motion stops spinner without hiding status');
 await page.getByRole('tab',{name:'复习偏好',exact:true}).click();await page.getByRole('radio',{name:/优先基础保过/}).check();await page.getByRole('radio',{name:/优先基础保过/}).press('ArrowDown');assert.ok(await page.getByRole('radio',{name:/面向高分冲刺/}).isChecked());
 await page.getByRole('tab',{name:'API 与模型',exact:true}).click();await page.getByRole('button',{name:'视觉模型',exact:true}).click();
 // Connection is intentionally absent, so the reuse checkbox remains a genuine disabled input.
 assert.ok(await page.getByRole('checkbox',{name:/复用文字模型/}).isDisabled());
 for(const width of [390,320]) {await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`settings-${width}.png`),fullPage:true});}
 report.checks.push('native radio keyboard operation and disabled checkbox semantics remain intact; small phone layouts fit');assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({checks:report.checks.length,output}));
} catch(e){report.failure=e.stack;throw e;}
finally{releaseTest?.();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();app?.emit('shifen:close');if(server)await new Promise(r=>{server.closeAllConnections();server.close(r);});assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('shifen-galaxy-ui-'));fs.rmSync(directory,{recursive:true,force:true});}
