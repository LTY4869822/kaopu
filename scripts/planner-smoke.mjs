import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {createApp} from '../server/index.mjs';

// All API calls target this script's temporary backend. Never writes to data/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = process.env.UI_TEST_URL || 'http://localhost:5174';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-planner-ui-'));
const reportDir = path.join(root, 'test-results', 'planner');
const screenshotDir = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(reportDir, {recursive:true}); fs.mkdirSync(screenshotDir, {recursive:true});
const report = {appUrl, isolatedBackend:true, checks:[], layouts:[], pageErrors:[], failures:[]};
const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai'}).format(new Date());
const day = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0,10);
const weekNames = ['周一','周二','周三','周四','周五','周六','周日'];
const weekday = value => (new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7;
const minutes = value => Number(value.slice(0,2)) * 60 + Number(value.slice(3));
const until = async (condition, message, timeout = 15000) => {
  const end = Date.now() + timeout;
  while(Date.now() < end) {if(await condition()) return; await new Promise(resolve => setTimeout(resolve,80));}
  throw new Error(message);
};
let browser, server, page, failNextGet = false, failNextPatch = false;
async function settle() { await until(async()=> (await page.locator('.sp-sync').innerText()).includes('随学习进度更新'), 'planner did not settle'); }
async function planner() {
  const mobile = page.viewportSize().width <= 760;
  await page.locator(mobile ? '.mobile-nav' : '.sidebar').getByRole('button',{name:mobile ? '规划':'复习规划',exact:true}).click();
  await page.locator('.study-planner').waitFor(); await settle();
}
async function reload() {await page.reload({waitUntil:'domcontentloaded'}); await page.locator('.app-shell').waitFor(); await planner();}
async function openConfig(tab='目标与时间') {
  if(!await page.locator('.sp-configuration').count()) await page.getByRole('button',{name:'调整规划',exact:true}).click();
  await page.getByRole('tab',{name:tab,exact:true}).click();
}
async function closeConfig() {if(await page.locator('.sp-configuration').count()) await page.getByRole('button',{name:'关闭规划设置',exact:true}).click();}
async function saveConfig() {
  await page.getByRole('button',{name:'保存并重新规划',exact:true}).click();
  await page.locator('.sp-configuration').waitFor({state:'hidden'}); await settle();
}
async function view(mode) {
  const button = page.getByRole('button',{name:mode === 'timeline' ? '时间线':'按天完成',exact:true});
  if(await button.getAttribute('aria-pressed') !== 'true') {await button.click(); await until(async()=>await button.getAttribute('aria-pressed') === 'true' && await button.isEnabled(),'view switch did not save'); await settle();}
}
async function selectDate(value) {
  if(await page.getByLabel('查看计划日期').inputValue() === value) return;
  const response = page.waitForResponse(response => {const url=new URL(response.url()); return url.pathname==='/api/planner'&&url.searchParams.get('date')===value&&response.request().method()==='GET';});
  await page.getByLabel('查看计划日期').fill(value); await response; await settle();
}
async function courseEditor(name) {
  const editor = page.locator('.sp-course-editor').filter({has:page.locator('summary strong').filter({hasText:name})});
  if(!await editor.evaluate(node=>node.open)) await editor.locator('summary').click();
  return editor;
}
async function examine(label) {
  const layout = await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth,
    viewButtons:[...document.querySelectorAll('.sp-view-toggle button')].map(button=>({text:button.textContent,height:Math.round(button.getBoundingClientRect().height)})),
    completionTargets:[...document.querySelectorAll('.sp-task-check')].map(button=>({width:Math.round(button.getBoundingClientRect().width),height:Math.round(button.getBoundingClientRect().height)})),
    offenders:[...document.querySelectorAll('.app-shell *')].filter(node=>{const r=node.getBoundingClientRect(); const style=getComputedStyle(node); return r.width>0&&style.display!=='none'&&style.visibility!=='hidden'&&(r.right>innerWidth+1||r.left< -1);}).slice(0,8).map(node=>({tag:node.tagName,className:String(node.className),text:node.textContent.slice(0,60)}))}));
  report.layouts.push({label,...layout}); assert.ok(Math.max(layout.body,layout.document)<=layout.width+1,`${label}: ${JSON.stringify(layout)}`);
  assert.ok(layout.viewButtons.every(button=>button.height<=52),`${label}: view buttons wrap into vertical text: ${JSON.stringify(layout.viewButtons)}`);
  assert.ok(layout.completionTargets.every(button=>button.width>=44&&button.height>=44),`${label}: completion hit area is smaller than 44px: ${JSON.stringify(layout.completionTargets)}`);
  assert.equal(await page.locator('.sp-day-heading button').count(),0,`${label}: day heading must not duplicate the planning entry`);
  assert.equal(await page.locator('.sp-assistant-note button').count(),0,`${label}: assistant note must not duplicate the planning entry`);
  assert.equal(await page.locator('.sp-exam-list button').count(),0,`${label}: exam countdown must stay read-only`);
}

async function capture(name, fullPage=true) {
  await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.evaluate(()=>scrollY),0,'capture must start at document top');
  await page.screenshot({path:path.join(screenshotDir,name),fullPage});
}
async function mobileSummaryFollowsAgenda(label) {
  await page.locator('.sp-mobile-alert').waitFor({state:'visible'});
  // The redesign keeps day-specific conflicts inline and places the aggregate
  // course summary beside the assistant after the agenda, reducing repetition.
  const placement=await page.evaluate(()=>({alert:document.querySelector('.sp-mobile-alert').getBoundingClientRect().top,agenda:document.querySelector('.sp-agenda').getBoundingClientRect().bottom,text:document.querySelector('.sp-mobile-alert').textContent,inAssistant:!!document.querySelector('.sp-assistant > .sp-mobile-alert')}));
  assert.ok(placement.inAssistant && placement.alert>=placement.agenda,`${label}: aggregate warning missing from assistant: ${JSON.stringify(placement)}`);
  assert.ok(placement.text.trim().length>0);
  assert.ok(await page.locator('.sp-mobile-alert').getByRole('button').isEnabled());
}

try {
  server = await new Promise(resolve=>{const instance=createApp({dataDir:tempDir,provider:{}}).listen(0,'127.0.0.1',()=>resolve(instance));});
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (url,method='GET',body) => {
    const response=await fetch(`${base}/api${url}`,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const result=await response.json(); assert.ok(response.ok,`${method} ${url}: ${JSON.stringify(result)}`); return result;
  };
  const getPlan = (value=today) => api(`/planner?date=${value}&days=14`);
  const initial=await api('/state');
  const longName='跨学科ResearchMethodsAndInterdisciplinaryAnalysis综合期末复习课程';
  await api('/courses','POST',{name:longName,examDate:'',target:85});
  const executablePath=[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,chromium.executablePath(),...['1228','1223'].map(version=>path.join(os.homedir(),'AppData','Local','ms-playwright',`chromium-${version}`,'chrome-win64','chrome.exe'))].find(candidate=>candidate&&fs.existsSync(candidate));
  assert.ok(executablePath,'Install Chromium with npx playwright install chromium');
  browser=await chromium.launch({headless:true,executablePath});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
  await context.route('**/api/**',async route=>{
    const url=new URL(route.request().url()); const method=route.request().method();
    if(url.pathname==='/api/planner'&&method==='GET'&&failNextGet){failNextGet=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试：规划服务暂时不可用，请重试。'})});return;}
    if(url.pathname==='/api/planner'&&method==='PATCH'&&failNextPatch){failNextPatch=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试：保存失败，请保留设置并重试。'})});return;}
    const response=await route.fetch({url:`${base}${url.pathname}${url.search}`});await route.fulfill({response});
  });
  page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(appUrl,{waitUntil:'domcontentloaded'});await page.locator('.app-shell').waitFor();await planner();
  await examine('1440 initial planner');
  await page.evaluate(()=>scrollTo(0, Math.round(document.body.scrollHeight * 0.5)));
  await page.waitForTimeout(150);
  const railScrollY=await page.evaluate(()=>scrollY), railViewport=await page.evaluate(()=>innerHeight), railBox=await page.locator('.sp-assistant').boundingBox();
  assert.ok(railScrollY>0&&railBox&&railBox.y>=0&&railBox.y+railBox.height<=railViewport+1,`assistant rail must stay in view while the agenda scrolls: ${JSON.stringify({railScrollY,railViewport,railBox})}`);
  report.checks.push('assistant rail sticks below the topbar instead of ending early beside a long agenda');
  await page.evaluate(()=>scrollTo(0,0));
  const focus = page.locator('.sp-focus details');
  await focus.locator('summary').click();
  const clock = focus.locator('.focus-body > strong'), clockBox = await clock.boundingBox();
  assert.ok(clockBox && clockBox.height < 70, `focus clock wrapped into multiple lines: ${JSON.stringify(clockBox)}`);
  await focus.getByLabel('专注时长',{exact:true}).selectOption('45');
  assert.equal((await clock.innerText()).trim(),'45:00','choosing a focus length should update the clock');
  assert.equal(await focus.getByRole('button',{name:'开始45分钟专注',exact:true}).count(),1,'focus length should drive the start button');
  await focus.getByRole('button',{name:'开始45分钟专注',exact:true}).click();
  const resetFocus=focus.getByRole('button',{name:'重新计时',exact:true});
  await resetFocus.waitFor({state:'visible'});
  await resetFocus.click();
  assert.equal((await clock.innerText()).trim(),'45:00','reset should follow the chosen focus length');
  await focus.getByLabel('专注时长',{exact:true}).selectOption('25');
  assert.equal((await clock.innerText()).trim(),'25:00','focus length stays editable after reset');
  await focus.locator('summary').click();
  report.checks.push('focus timer keeps the clock on one line and lets the focus length be changed and reset');

  // Enter every planning input through the actual form, then inspect persistence.
  await openConfig();
  await page.getByRole('radio',{name:/高绩点/}).check();
  const weekly=[120,150,180,0,180,240,90];weekly[weekday(today)]=180;weekly[(weekday(today)+2)%7]=0;
  for(let i=0;i<7;i++) await page.getByLabel(`${weekNames[i]}可用分钟`,{exact:true}).fill(String(weekly[i]));
  await page.getByLabel('开始准备日期',{exact:true}).fill(today);
  await page.getByLabel('单次专注时长').selectOption('25');await page.getByLabel('段间休息时长').selectOption('5');
  await page.getByLabel('弹性缓冲比例').fill('10');
  await page.getByLabel('空闲时段1开始',{exact:true}).fill('00:00');await page.getByLabel('空闲时段1结束',{exact:true}).fill('12:00');
  await page.getByRole('button',{name:'添加空闲时段',exact:true}).click();
  await page.getByLabel('空闲时段2开始',{exact:true}).fill('12:10');await page.getByLabel('空闲时段2结束',{exact:true}).fill('23:59');
  await page.getByRole('tab',{name:'科目设置',exact:true}).click();
  for(const [index,course] of initial.courses.entries()) {
    await courseEditor(course.name);
    await page.getByLabel(`${course.name}考试日期`,{exact:true}).fill(day([3,7,10,12][index]));
    await page.getByLabel(`${course.name}考试时间`,{exact:true}).fill('14:00');
    await page.getByLabel(`${course.name}难度`,{exact:true}).selectOption(String([5,2,4,2][index]));
    await page.getByLabel(`${course.name}目标分数`,{exact:true}).fill(String([92,85,85,80][index]));
    await page.getByLabel(`${course.name}当前掌握估计`,{exact:true}).fill(String([30,60,40,70][index]));
    await page.getByLabel(`${course.name}预计剩余复习小时`,{exact:true}).fill(String([12,8,16,5][index]));
    await page.getByLabel(`${course.name}准备起点`,{exact:true}).fill(index===1?day(1):today);
  }
  await saveConfig();let state=await api('/state');
  assert.equal(state.settings.goal,'high');assert.deepEqual(state.settings.planner.weeklyMinutes,weekly);assert.equal(state.settings.planner.windows.length,2);
  assert.equal(state.courses.find(item=>item.id==='math').remainingHours,12);assert.equal(state.courses.find(item=>item.id==='math').difficulty,5);assert.equal(state.courses.find(item=>item.id==='linear').prepStartDate,day(1));
  await reload();await openConfig();assert.equal(await page.getByLabel('开始准备日期').inputValue(),today);assert.equal(await page.getByLabel('空闲时段2开始').inputValue(),'12:10');
  await page.getByRole('tab',{name:'科目设置',exact:true}).click();await courseEditor('高等数学');assert.equal(await page.getByLabel('高等数学预计剩余复习小时').inputValue(),'12');await closeConfig();
  report.checks.push('full form saves weekly capacity, multiple windows, cadence, start date, exam times, difficulty, target, mastery and remaining hours; survives reload');

  for(const [goal,label] of [['pass','及格优先'],['balanced','兼顾提分'],['high','高绩点']]) {
    await openConfig();await page.getByRole('radio',{name:new RegExp(label)}).check();await saveConfig();
    assert.equal((await api('/state')).settings.goal,goal);assert.ok((await page.locator('.sp-current-goal').innerText()).includes(label));
  }
  report.checks.push('all three goal strategies persist and update assistant strategy');

  await openConfig();
  const timeTab=page.getByRole('tab',{name:'目标与时间',exact:true}), courseTab=page.getByRole('tab',{name:'科目设置',exact:true}), overrideTab=page.getByRole('tab',{name:'单日调整',exact:true});
  await timeTab.focus(); await timeTab.press('ArrowRight'); assert.equal(await courseTab.getAttribute('aria-selected'),'true'); assert.ok(await courseTab.evaluate(node=>node===document.activeElement));
  await courseTab.press('End'); assert.equal(await overrideTab.getAttribute('aria-selected'),'true'); assert.ok(await overrideTab.evaluate(node=>node===document.activeElement));
  await overrideTab.press('Home'); assert.equal(await timeTab.getAttribute('aria-selected'),'true');
  await timeTab.press('ArrowLeft'); assert.equal(await overrideTab.getAttribute('aria-selected'),'true');
  await closeConfig();await until(async()=>await page.locator('.sp-adjust').evaluate(node=>node===document.activeElement),'closing settings did not restore focus to adjust button');
  report.checks.push('configuration tabs support ArrowLeft/Right, Home/End with active focus; closing restores focus to adjust control');

  let plan=await getPlan();const fingerprint=value=>value.days.map(item=>({date:item.date,tasks:item.tasks.map(task=>({id:task.id,minutes:task.minutes,completed:task.completed}))}));
  await view('timeline');const before=await getPlan();const timelineHint=(await page.locator('.sp-view-hint').innerText()).trim();
  await view('day');const after=await getPlan();
  assert.deepEqual(fingerprint(before),fingerprint(after));
  const dayHint=(await page.locator('.sp-view-hint').innerText()).trim();
  assert.ok(timelineHint&&dayHint&&timelineHint!==dayHint,`view hint must explain how the two modes differ: ${JSON.stringify({timelineHint,dayHint})}`);
  assert.equal(await page.locator('.sp-daily-task').count(),after.days[0].tasks.length);
  await reload();assert.equal(await page.getByRole('button',{name:'按天完成',exact:true}).getAttribute('aria-pressed'),'true');
  report.checks.push('timeline and day modes share identical task IDs, durations and completion status; mode persists');

  plan=await getPlan();
  for(const entry of plan.days) {
    assert.ok(entry.allocated<=entry.budget,`${entry.date} allocation exceeds budget`);
    let previousEnd=-1;
    for(const slot of entry.slots) {
      assert.ok(minutes(slot.start)>=previousEnd,`${entry.date} overlapping segments`);previousEnd=minutes(slot.end);
      assert.ok(plan.settings.windows.some(window=>slot.start>=window.start&&slot.end<=window.end),`${entry.date} segment escapes window`);
      assert.equal(minutes(slot.end)-minutes(slot.start),slot.minutes);
    }
    assert.equal(entry.slots.filter(slot=>slot.kind==='break').reduce((sum,slot)=>sum+slot.minutes,0),entry.breakMinutes);
    assert.ok(entry.tasks.every(task=>task.courseId!=='linear'||entry.date>=day(1)),'course scheduled before its preparation start');
    assert.ok(entry.tasks.every(task=>entry.date<state.courses.find(course=>course.id===task.courseId).examDate),'task placed on/after exam day');
  }
  assert.ok(plan.days.some(entry=>entry.breakMinutes>0),'expected explicit breaks');
  const weeklyRest=plan.days.find(entry=>weekly[weekday(entry.date)]===0);assert.ok(weeklyRest&&weeklyRest.tasks.length===0,'weekly rest day scheduled tasks');
  assert.ok(await page.locator('.sp-shortfall').count()>0,'shortfall should be visible with overloaded fixture');
  report.checks.push('real output obeys day budgets, preparation starts and exam deadlines; windows and breaks never overlap; rest days empty and shortages visible');

  // Today completion is recorded once, survives mode switch, and can be undone.
  const first=plan.days[0].tasks[0];assert.ok(first,'today requires a task');
  const complete=page.getByRole('button',{name:`完成${first.title}`,exact:true}).first();await complete.click();
  await until(async()=>(await api('/state')).completedTasks.includes(first.id),'completion not persisted');await settle();
  await view('timeline');assert.ok((await getPlan()).days[0].tasks.find(task=>task.id===first.id)?.completed);
  await view('day');await page.getByRole('button',{name:`恢复${first.title}`,exact:true}).first().click();
  await until(async()=>!(await api('/state')).completedTasks.includes(first.id),'undo not persisted');await settle();
  report.checks.push('complete and undo persist, retaining the completed task across view switches');
  plan=await getPlan();const jumpTask=plan.days[0].tasks[0];
  await page.locator('.sp-daily-task').first().getByRole('button',{name:'开始学习',exact:true}).click();
  await until(async()=>await page.locator('.study-planner').count()===0,'task action did not navigate');
  assert.equal(await page.getByLabel('筛选课程').inputValue(),jumpTask.courseId);
  await planner();
  const future=plan.days.find(entry=>entry.date>today&&entry.tasks.length);await selectDate(future.date);
  assert.ok(await page.locator('.sp-task-check').first().isDisabled(),'future completion must be disabled');await selectDate(today);
  report.checks.push('start-learning opens the matching course workspace/practice/memory and future preview cannot be completed');

  // Day-specific rest/override must redistribute only future work.
  await openConfig('单日调整');await page.getByLabel('单日调整日期').fill(today);await page.getByRole('button',{name:'这天休息',exact:true}).click();await saveConfig();
  assert.equal((await getPlan()).days[0].budget,0);assert.ok(await page.getByRole('heading',{name:'这一天，安心休息',exact:true}).isVisible());
  await openConfig('单日调整');await page.getByLabel('单日可用分钟').fill('60');await page.getByRole('button',{name:'加入调整',exact:true}).click();await saveConfig();assert.equal((await getPlan()).days[0].budget,60);
  await openConfig('单日调整');await page.getByRole('button',{name:'恢复常规',exact:true}).first().click();await saveConfig();assert.equal((await getPlan()).days[0].budget,weekly[weekday(today)]);
  report.checks.push('single-day rest, reduced capacity and restore work and replan without changing weekly defaults');

  await openConfig();await page.getByLabel('空闲时段2开始').fill('11:00');await page.getByRole('button',{name:'保存并重新规划',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'重叠'}).waitFor();assert.equal((await api('/state')).settings.planner.windows[1].start,'12:10');await page.getByLabel('空闲时段2开始').fill('12:10');
  failNextPatch=true;await page.getByRole('button',{name:'保存并重新规划',exact:true}).click();await page.getByRole('alert').filter({hasText:'保存失败'}).waitFor();assert.equal(await page.getByLabel('空闲时段2开始').inputValue(),'12:10');await saveConfig();
  failNextGet=true;await page.getByRole('button',{name:'重新计算',exact:true}).click();await page.getByRole('alert').filter({hasText:'暂时不可用'}).waitFor();await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.locator('.sp-error').waitFor({state:'hidden'});await settle();
  report.checks.push('overlap validation blocks writes; server-save failure preserves drafts and retries; load failure recovers');

  // Preserve records made by the previous /plan implementation and undo via the new UI.
  const oldPlan=await api(`/plan?date=${today}`), legacy=oldPlan.tasks.find(task=>!task.completed);assert.ok(legacy,'legacy fixture requires one task');
  await api(`/tasks/${encodeURIComponent(legacy.id)}/complete`,'POST',{completed:true});await reload();
  const migrated=(await getPlan()).days[0];assert.ok(migrated.tasks.find(task=>task.id===legacy.id)?.completed,'legacy completed snapshot disappeared');assert.ok(migrated.completedMinutes>=legacy.minutes,'legacy time not counted');
  await view('day');await page.getByRole('button',{name:`恢复${legacy.title}`,exact:true}).first().click();await until(async()=>!(await api('/state')).completedTasks.includes(legacy.id),'legacy completion cannot be undone in new UI');await settle();
  report.checks.push('previous /plan completed snapshot appears with its original minutes and can be undone from new planner');

  // The whole exam day is reserved; its label must not say the exam already ended.
  await api('/planner','PATCH',{courses:[{id:'math',examDate:today,prepStartDate:''}]});await reload();
  const todayExam=page.locator('.sp-exam-item').filter({hasText:'高等数学'});assert.ok((await todayExam.innerText()).includes('已预留考试日'));assert.ok(!(await todayExam.innerText()).includes('考试已结束'));
  await api('/planner','PATCH',{courses:[{id:'math',examDate:day(3),prepStartDate:today}]});await reload();
  report.checks.push('exam happening today is labelled as reserved exam day, not already ended');

  for(const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:width<=500?844:1000});await view('timeline');await examine(`${width} timeline with shortages and long course`);
    await view('day');await examine(`${width} day task list`);
    await openConfig();await examine(`${width} time configuration`);
    await page.getByRole('tab',{name:'科目设置',exact:true}).click();await courseEditor(longName);await examine(`${width} long-name course configuration`);
    await page.getByRole('tab',{name:'单日调整',exact:true}).click();await examine(`${width} single-day adjustment`);await closeConfig();
  }
  report.checks.push('1440/768/390/320 timeline, day list, time settings, long course editor and override layouts fit');

  await page.setViewportSize({width:390,height:844});await view('timeline');await mobileSummaryFollowsAgenda('missing-date and overload');
  const savedWindows=(await getPlan()).settings.windows;
  await api('/planner','PATCH',{settings:{windows:[{start:'00:00',end:'00:05'}]}});await reload();await view('timeline');await mobileSummaryFollowsAgenda('narrow windows');
  assert.ok((await getPlan()).courses.some(course=>course.timelineShortfallMinutes>0),'narrow-window shortage not reported');
  assert.ok(await page.locator('.sp-day-notices').isVisible(), 'day-specific scheduling conflict must remain in the agenda');
  await examine('390 day-specific alert and aggregate assistant warning');await capture('planner-shortage-mobile-viewport.png',false);
  await api('/planner','PATCH',{settings:{windows:savedWindows}});await reload();
  report.checks.push('mobile aggregate warnings remain actionable after agenda; day-specific conflicts stay inline');

  // Save clean demo captures from the same isolated backend.
  await api('/reset','POST',{mode:'demo'});
  await api('/planner','PATCH',{settings:{startDate:today,mode:'timeline',goal:'balanced',windows:[{start:'19:00',end:'23:00'}],weeklyMinutes:Array(7).fill(180),blockMinutes:40,breakMinutes:10,reservePercent:10}});
  await page.setViewportSize({width:1440,height:1000});await reload();await view('timeline');await capture('planner-timeline-desktop.png');await capture('planner-timeline-desktop-viewport.png',false);
  await view('day');await capture('planner-day-desktop.png');await capture('planner-day-desktop-viewport.png',false);
  await page.setViewportSize({width:390,height:844});await view('timeline');await page.evaluate(()=>scrollTo(0,0));
  const firstAction=await page.evaluate(()=>{const nav=document.querySelector('.mobile-nav').getBoundingClientRect();const elements=[document.querySelector('.sp-next-start'),document.querySelector('.sp-task-check'),document.querySelector('.sp-session-bottom > button')].filter(Boolean);return {bottomNav:nav.top,actions:elements.map(element=>{const rect=element.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};})};});
  assert.ok(firstAction.actions.some(action=>action.width>=44&&action.height>=44&&action.top>=0&&action.bottom<=firstAction.bottomNav),`390px first study action hidden beneath bottom navigation: ${JSON.stringify(firstAction)}`);
  const nextTask=(await getPlan()).days.find(entry=>entry.date===today).tasks.find(task=>!task.completed);
  assert.ok(nextTask,'demo must have a real next task');
  await page.getByRole('button',{name:`开始学习：${nextTask.title}`,exact:true}).click();
  await until(async()=>await page.locator('.study-planner').count()===0,'mobile quick start did not navigate');
  assert.equal(await page.getByLabel('筛选课程').inputValue(),nextTask.courseId);
  await planner();await view('timeline');
  await examine('390 compact timeline shows first study action above bottom navigation');await capture('planner-mobile.png');await capture('planner-mobile-viewport.png',false);
  await openConfig();await capture('planner-settings-mobile.png');await capture('planner-settings-mobile-viewport.png',false);await closeConfig();
  report.checks.push('390px first study action is visible above fixed navigation; all completion buttons retain 44px touch targets');

  await api('/reset','POST',{mode:'empty'});await reload();await page.getByRole('heading',{name:'先告诉我，你要考哪些科目',exact:true}).waitFor();await examine('390 empty planner');
  await page.getByRole('button',{name:'添加考试科目',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.getByRole('dialog').locator('[name="name"]').isVisible());
  report.checks.push('empty planner offers working add-course action');
  assert.deepEqual(report.pageErrors,[]);report.passed=true;
  console.log(`Planner UI passed: ${report.checks.length} workflows, ${report.layouts.length} layouts; isolated data only.`);
} catch(error) {
  report.passed=false;report.failures.push(error.stack||error.message);process.exitCode=1;
  if(page) await page.screenshot({path:path.join(reportDir,'failure.png'),fullPage:true}).catch(()=>{});
  console.error(error.stack||error.message);
} finally {
  fs.writeFileSync(path.join(reportDir,'report.json'),JSON.stringify(report,null,2));await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  const resolved=path.resolve(tempDir);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('shifen-planner-ui-')) throw new Error('Refusing unexpected cleanup path');
  fs.rmSync(resolved,{recursive:true,force:true});
}
