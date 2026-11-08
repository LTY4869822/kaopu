import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {createApp} from '../server/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-batch-ui-'));
const reportDir = path.join(root, 'test-results', 'batch-import');
const screenshots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(reportDir, {recursive:true}); fs.mkdirSync(screenshots, {recursive:true});
const report = {checks:[], pageErrors:[], layouts:[], maxConcurrentUploads:0,autoRequests:0,courseCreateRequests:0,requestsBeforeExplicitStart:null};
let browser, server, page;
async function openImportPage() {
  const mobile = page.viewportSize().width <= 760;
  await page.locator(mobile ? '.mobile-nav' : '.sidebar').getByRole('button',{name:mobile ? '导入':'资料导入',exact:true}).click();
}
const until = async (check, message) => {for(let i=0;i<150;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,80));}throw new Error(message);};
const file = (name, text) => ({name,mimeType:'text/plain',buffer:Buffer.from(text)});
async function layout(name) {const data=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));report.layouts.push({name,...data});assert.ok(data.width<=data.viewport+1,`Overflow ${name}`);}
try {
  server=await new Promise(resolve=>{const item=createApp({dataDir,provider:{}}).listen(0,'127.0.0.1',()=>resolve(item));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const state=async()=> (await fetch(`${base}/api/state`)).json();
  await fetch(`${base}/api/reset`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'empty'})});
  const executablePath=[chromium.executablePath(),...['1228','1223'].map(version=>path.join(os.homedir(),'AppData','Local','ms-playwright',`chromium-${version}`,'chrome-win64','chrome.exe'))].find(item=>fs.existsSync(item));
  browser=await chromium.launch({headless:true,executablePath});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
  let uploads=0, injectedFailure=false;
  await context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    const uploading=url.pathname==='/api/documents/auto'&&request.method()==='POST';
    if(uploading){uploads++;report.autoRequests++;report.maxConcurrentUploads=Math.max(report.maxConcurrentUploads,uploads);}
    if(url.pathname==='/api/courses'&&request.method()==='POST')report.courseCreateRequests++;
    try{
      if(uploading&&request.postDataBuffer()?.includes(Buffer.from('transient-retry-marker'))&&!injectedFailure){
        injectedFailure=true; await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'临时读取失败，请重试。'})});return;
      }
      if(uploading)await new Promise(resolve=>setTimeout(resolve,180));
      const response=await route.fetch({url:`${base}${url.pathname}${url.search}`});await route.fulfill({response});
    }finally{if(uploading)uploads--;}
  });
  page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(process.env.UI_TEST_URL||'http://localhost:5174',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'把资料放进来，剩下的交给考谱',exact:true}).waitFor();
  await page.getByRole('heading',{name:'拖拽文件到这里',exact:true}).waitFor();
  const input=page.getByLabel('批量导入学习资料');
  const start=page.getByRole('button',{name:'开始分析',exact:true});
  assert.ok(await start.isDisabled());
  await input.setInputFiles(file('移除测试.txt','本地选择，不应上传或分析。'));
  await input.setInputFiles(file('清空测试.txt','再次选择只应该追加本地队列。'));
  assert.equal(await page.locator('.batch-staged-row').count(),2);
  await page.getByRole('button',{name:'移除移除测试.txt',exact:true}).click();
  assert.equal(await page.locator('.batch-staged-row').count(),1);
  await page.getByRole('button',{name:'清空待分析',exact:true}).click();
  assert.equal(await page.locator('.batch-staged-row').count(),0);
  assert.ok(await start.isDisabled());
  report.checks.push('selection appends locally; individual remove and clear work; empty start button is disabled');
  await input.setInputFiles(Array.from({length:100},(_,index)=>file(`容量检查${index}.txt`,'只用于检查本地文件队列上限。')));
  await input.setInputFiles(file('第101份.txt','不应该添加到超过上限的批次。'));
  assert.equal(await page.locator('.batch-staged-row').count(),100);
  assert.ok((await page.locator('.batch-error').innerText()).includes('100'));
  await page.getByRole('button',{name:'清空待分析',exact:true}).click();
  report.checks.push('100-file staging limit enforced across selections without uploading');
  const dataTransfer=await page.evaluateHandle(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['今天记录了校园里不同场所的使用体验。下次需要继续补充访谈提纲和现场描述。'],'观察记录.txt',{type:'text/plain'}));return transfer;});
  await page.locator('.batch-drop').dispatchEvent('drop',{dataTransfer});
  await dataTransfer.dispose();
  assert.equal(await page.locator('.batch-staged-row').count(),1);
  await page.waitForTimeout(250);
  report.requestsBeforeExplicitStart={uploads:report.autoRequests,courses:report.courseCreateRequests};
  assert.deepEqual(report.requestsBeforeExplicitStart,{uploads:0,courses:0});
  assert.equal((await state()).documents.length,0);
  assert.equal((await state()).courses.length,0);
  report.checks.push('drag/drop remains local: zero upload requests and zero course creation before explicit Start analysis');
  await layout('desktop staged files');
  await start.click();
  assert.ok(await input.isDisabled());
  assert.ok(await page.getByRole('button',{name:'选择文件',exact:true}).isDisabled());
  await page.getByRole('heading',{name:'这 1 份，帮我确认一下科目',exact:true}).waitFor();
  await until(async()=>await input.isEnabled(),'import did not finish');
  assert.equal((await state()).courses.length,0,'unknown file should not create an invented course');
  const row=page.locator('.batch-review-row').filter({hasText:'观察记录.txt'});
  await row.getByRole('combobox').selectOption({label:'＋ 新建一门课程'});
  await row.getByRole('textbox').fill('城市观察方法');
  await row.getByRole('button',{name:'确认归档'}).click();
  await until(async()=>!(await state()).documents.some(doc=>!doc.courseId),'manual classification did not persist');
  await page.getByRole('heading',{name:'资料分析完成',exact:true}).waitFor();
  let current=await state();
  assert.equal(current.courses[0].examDate,'','new course should not invent exam date');
  assert.equal(current.courses[0].name,'城市观察方法');
  report.checks.push('empty-space unknown upload, disabled concurrent input, inline creation without exam date, persistent assignment');
  await page.getByRole('button',{name:'查看我的课程',exact:true}).click();
  await page.getByRole('heading',{name:'我的课程',exact:true}).waitFor();
  await page.locator('.course-tile-main').filter({hasText:'城市观察方法'}).click();
  await page.getByRole('heading',{name:'城市观察方法',exact:true}).waitFor();
  report.checks.push('completed analysis opens My courses; course tile enters the classified workspace');
  await openImportPage();
  const math='高等数学：导数用于描述函数变化率。定积分与极限是本章节的复习重点。';
  await input.setInputFiles([
    file('高等数学复习.txt',math),
    file('线性代数讲义.txt','线性代数：矩阵与行列式，特征值与特征向量，线性方程组与线性空间。'),
    file('随手记.txt','这是一份需要进一步整理的课堂记录。下次补充每个章节的具体要求与阅读范围。'),
    file('高等数学补充.txt','transient-retry-marker 高等数学：定积分计算需要掌握导数与极限。'),
    file('旧课件.doc','legacy binary placeholder'),
    file('同内容副本.txt',math),
  ]);
  const requestsBeforeSecondStart=report.autoRequests;
  await page.waitForTimeout(150);
  assert.equal(report.autoRequests,requestsBeforeSecondStart);
  assert.equal(await page.locator('.batch-staged-row').count(),6);
  await start.click();
  await until(async()=>await input.isEnabled(),'mixed import did not finish');
  assert.equal(await page.locator('.batch-file-row.status-failed').count(),2);
  assert.equal(await page.locator('.batch-file-row.status-duplicate').count(),1);
  assert.equal(await page.locator('.batch-file-row.status-needs-review').count(),1);
  assert.ok((await page.locator('.batch-file-row').filter({hasText:'旧课件.doc'}).innerText()).includes('.docx'));
  assert.equal(report.maxConcurrentUploads,1,'uploads must stay sequential');
  report.checks.push('six-file mixed batch: sequential upload, two subjects, unknown, duplicate skip and legacy format error');
  const retryRow=page.locator('.batch-file-row').filter({hasText:'高等数学补充.txt'});
  await retryRow.getByRole('button',{name:/重试/}).click();
  await until(async()=>await retryRow.getAttribute('class').then(value=>value.includes('status-success')),'single-file retry failed');
  await until(async()=>await input.isEnabled(),'retry refresh did not finish');
  assert.equal(await page.locator('.batch-file-row.status-failed').count(),1);
  report.checks.push('retry only transiently failed file, preserving all other results');
  await layout('desktop batch results');
  await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  await page.screenshot({path:path.join(screenshots,'batch-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await layout('mobile batch results');
  await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  await page.screenshot({path:path.join(screenshots,'batch-mobile.png'),fullPage:true});
  const review=page.locator('.batch-review-row').filter({hasText:'随手记.txt'});
  current=await state();const mathCourse=current.courses.find(course=>course.name==='高等数学');
  await review.getByRole('combobox').selectOption(mathCourse.id);
  await review.getByRole('button',{name:'确认归档'}).click();
  await until(async()=>!(await state()).documents.some(doc=>!doc.courseId),'existing-course manual assignment did not persist');
  report.checks.push('mobile existing-course selection and assignment');
  await layout('mobile after assignment');
  assert.deepEqual(report.pageErrors,[]);
  assert.equal((await state()).documents.length,5,'duplicates and retries must not add extra documents');
  report.checks.push('five unique documents persisted, no page errors, no horizontal overflow');
  await input.setInputFiles(file('外部归档测试.txt','课堂记录需要按专题重新整理，先补充观察步骤、阅读提纲和整理依据。'));
  await start.click();
  await until(async()=>await input.isEnabled(),'external-edit fixture import did not finish');
  await page.getByRole('button',{name:'查看我的课程',exact:true}).click();
  await page.getByRole('button',{name:'去归档',exact:true}).click();
  const externalRow=page.locator('.document-row').filter({hasText:'外部归档测试.txt'});
  await externalRow.locator('.document-assignment').selectOption(mathCourse.id);
  await until(async()=>(await state()).documents.find(doc=>doc.name==='外部归档测试.txt')?.courseId===mathCourse.id,'external assignment did not persist');
  await openImportPage();
  await until(async()=>await page.locator('.batch-review-row').count()===0,'batch retained stale pending row after external assignment');
  assert.ok((await page.locator('.batch-course-groups').innerText()).includes('高等数学'));
  report.checks.push('assignment in main materials view synchronizes the permanently mounted batch view');
  await page.getByRole('button',{name:'查看我的课程',exact:true}).click();
  await page.locator('.course-tile-main').filter({hasText:'高等数学'}).click();
  if (page.viewportSize().width <= 760) await page.locator('.cs-mobile-tabs').getByRole('tab',{name:/^资料/}).click();
  else await page.getByRole('group',{name:'工作台布局',exact:true}).getByRole('button',{name:'资料',exact:true}).click();
  await page.getByLabel('管理外部归档测试.txt',{exact:true}).click();
  await page.locator('.cs-source-row').filter({hasText:'外部归档测试.txt'}).getByRole('button',{name:'删除资料',exact:true}).click();
  await until(async()=>!(await state()).documents.some(doc=>doc.name==='外部归档测试.txt'),'external deletion did not persist');
  await openImportPage();
  await until(async()=>await page.locator('.batch-file-row').filter({hasText:'外部归档测试.txt'}).count()===0,'batch retained a deleted document');
  assert.ok(await page.locator('.batch-course-group').count()>0,'earlier completed batches must remain available');
  report.checks.push('external document deletion clears stale batch rows and workspace links');
  report.passed=true;
  console.log(`Batch import passed: ${report.checks.length} scenario groups, ${report.layouts.length} layout checks; sequential max=${report.maxConcurrentUploads}.`);
}catch(error){report.passed=false;report.error=error.stack||String(error);console.error(report.error);process.exitCode=1;if(page)await page.screenshot({path:path.join(reportDir,'failure.png'),fullPage:true}).catch(()=>{});}
finally{fs.writeFileSync(path.join(reportDir,'report.json'),JSON.stringify(report,null,2));await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));const target=path.resolve(dataDir);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('shifen-batch-ui-'))throw new Error('Unexpected cleanup path');fs.rmSync(target,{recursive:true,force:true});}
