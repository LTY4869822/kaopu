import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { createApp } from '../server/index.mjs';

// Real application and local APIs, synthetic learning content, isolated temp data.
// Never reads the user's account, model configuration, courses or cookies.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results/lecture-study'); fs.mkdirSync(output, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-study-ui-'));
const report = { checks: [], pageErrors: [], externalRequests: [], failedApi: [] };
let app, apiServer, vite, browser;
const examModel = async (_url, init) => {
  const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
  assert.equal(payload.task, 'exam-questions');
  const source = payload.sources.find(item => /定义域/.test(item.text) && !item.text.startsWith('网课：')) || payload.sources[0];
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: payload.slots.map(slot => ({
    slotId: slot.id, type: slot.type, difficulty: slot.difficulty, topic: slot.topic,
    prompt: '合成训练：已知y=2且x属于[0,1]，下列哪个集合是函数的值域？',
    options: [{id:'A',text:'{2}'},{id:'B',text:'[0,1]'},{id:'C',text:'R'},{id:'D',text:'空集'}], answerKey:'A',
    expectedAnswer:'值域是{2}。', acceptedAnswers:[], rubric:'区分输入范围和实际输出。', explanation:'所有允许的输入都输出2。',
    steps:['读出输入范围。','收集实际输出。'], hints:['考虑函数实际能输出什么。','把输入集合和实际输出集合分开比较。'],
    sources:[{sourceId:source.sourceId,quote:source.text.slice(0,50)}], origin:'material-based'
  })) }) } }] }), {headers:{'Content-Type':'application/json'}});
};
try {
  const seed = createApp({ dataDir, provider: {}, visionProvider: {}, videoFetcher: null }); seed.emit('shifen:close');
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  const course = state.courses[0]; course.name = '高等数学 · 合成验收'; state.courses = [course]; state.documents = []; state.cards = []; state.questions = []; state.attempts = [];
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(state));
  const canvas = createCanvas(1280, 720), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#283c34'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#fffdf2'; ctx.font = '36px Arial';
  ctx.fillText('SYNTHETIC LECTURE - TEST ONLY', 55, 80); ctx.fillText('y = 2,  x in [0,1]', 70, 210); ctx.fillText('Domain: [0,1]     Range: {2}', 70, 310);
  const bytes = canvas.toBuffer('image/jpeg'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const makeLesson = id => ({ id, courseId: course.id, title: id === 'study-a' ? '函数的输入与输出 · 合成课' : '另一节合成课', url: 'https://www.bilibili.com/video/BV1Eb411u7Fw/', part: 20, scope: '',
    sourceName: '合成来源.json', sourceFormat: 'json', createdAt: '2026-11-05', updatedAt: '2026-11-05', status: 'completed',
    cues: [{ id: 'cue-1', start: 0, end: 20, text: '定义域是自变量允许取值的集合。' }, { id: 'cue-2', start: 150, end: 180, text: '例题：当x属于[0,1]，y=2，求定义域和值域。解：定义域[0,1]，值域{2}。' }],
    sourceDiagnostics: { kind: 'fixture', warnings: [], reviewCueIds: ['cue-2'] },
    visual: { id: `evidence-${id}`, lessonId: id, status: 'completed', createdAt: '2026-11-05', updatedAt: '2026-11-05',
      frames: [{ id: 'frame-0001', time: 0, width: 1280, height: 720, sha256, fileName: 'frame-0001.jpg', imageUrl: `/api/lessons/${id}/visual/evidence-${id}/frame-0001` }],
      observations: [{ frameId: 'frame-0001', time: 0, visibleText: 'y=2, x∈[0,1]', latex: ['y=2'], description: '合成的板书验收图', uncertainties: ['右上角符号模糊，请核对。'], inferences: [] }], warnings: [], coverage: { durationSeconds: 240, sampledFrameCount: 1, recognizedFrameCount: 1, maxGapSeconds: 240, unobservedIntervals: [{ start: 0, end: 240 }], complete: false } },
    notes: { mode: 'ai', overview: ['先看题目给定的输入限制，再找所有可能的输出。'], warnings: [], createdAt: '2026-11-05', coverage: { cueCount: 2, processedCueCount: 2, visual: true, sampledFrameCount: 1, recognizedFrameCount: 1 },
      sections: [{ id: 'section-1', title: '定义域与值域', text: '定义域收集允许输入，值域收集实际输出。', teacherExplanation: '拿到一道题，先圈出自变量的取值限制，再观察函数能输出哪些值。常值函数的输出固定，但它的输入范围仍取决于题目条件。', prerequisites: ['集合与区间'], pitfalls: ['不要把常数2当成定义域。'], cueIds: ['cue-1'], frameIds: ['frame-0001'], inScope: null }],
      examples: [{ id: 'example-1', title: '常值函数的两个集合', prompt: '已知 $y=2$，且 $x\\in[0,1]$，求定义域和值域。', solution: '定义域[0,1]，值域{2}。', detailedSolution: '先从题设读取输入范围，再收集函数实际输出。', solutionSteps: ['输入范围是[0,1]。', '所有输入都输出2，所以值域是{2}。'], solutionOrigin: 'ai-supplement', needsReview: false, cueIds: ['cue-2'], frameIds: ['frame-0001'] }] } });
  const lessons = ['study-a', 'study-b'].map(makeLesson);
  for (const lesson of lessons) { const dir = path.join(dataDir, 'lesson-visual', lesson.id, lesson.visual.id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'frame-0001.jpg'), bytes); fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(lesson.visual)); }
  fs.writeFileSync(path.join(dataDir, 'lessons.json'), JSON.stringify({ version: 1, lessons }));
  app = createApp({ dataDir, provider: {baseUrl:'https://isolated.example.test/v1',apiKey:'synthetic-fixture-key',model:'fixture'}, visionProvider: {}, videoFetcher: null, examFetch:examModel });
  apiServer = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const apiBase = `http://127.0.0.1:${apiServer.address().port}`;
  const base = apiBase; // Exercise the built application; no Vite development server.
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228', '1223'].map(version => path.join(os.homedir(), 'AppData/Local/ms-playwright', `chromium-${version}/chrome-win64/chrome.exe`))].filter(Boolean);
  const executablePath = candidates.find(value => fs.existsSync(value)); assert.ok(executablePath);
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.route(/^https?:\/\//, route => { const url = new URL(route.request().url()); if (url.origin === base) return route.continue(); report.externalRequests.push(url.origin + url.pathname); return route.abort(); });
  const page = await context.newPage(); page.setDefaultTimeout(45000); page.on('pageerror', cause => report.pageErrors.push(cause.message));
  page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400) report.failedApi.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.goto(`${base}/?page=lessons`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '标为已读', exact: true }).first().waitFor();
  await page.getByRole('button', {name:'PDF / Word 阅读',exact:true}).click();
  await page.getByRole('dialog',{name:/^文档阅读/}).locator('iframe').waitFor();
  await page.getByRole('button',{name:'关闭文档阅读',exact:true}).click();
  report.checks.push('lecture PDF/Word reader opens the actual lecture PDF endpoint and returns without losing reading state');
  await page.getByRole('button', { name: '标为已读', exact: true }).first().click();
  await page.getByRole('button', { name: '已读', exact: true }).first().waitFor();
  assert.match(await page.locator('.lesson-study-progress').innerText(), /1\/1/);
  const example = page.locator('.lecture-example').first();
  assert.equal(await example.locator('.lecture-practice-answer').getAttribute('open'), null);
  assert.equal(await example.locator('.lecture-teacher').isVisible(), false);
  await example.locator('.lecture-practice-answer > summary').click();
  assert.equal(await example.locator('.lecture-teacher').isVisible(), true);
  await example.getByRole('button', { name: '还需巩固', exact: true }).click();
  await page.getByRole('button', { name: /只看需巩固/ }).waitFor();
  report.checks.push('real study API stores read progress; example answer hidden until opened; weak self-mark');
  await page.getByRole('button', { name: /只看需巩固/ }).click();
  assert.equal(await page.locator('.lecture-knowledge').count(), 0); assert.equal(await page.locator('.lecture-example').count(), 1);
  await page.getByRole('button', { name: '全部内容', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /只看需巩固/ }).waitFor();
  assert.match(await page.locator('.lesson-study-progress').innerText(), /1\/1/);
  assert.equal(await page.locator('.lecture-practice-answer').getAttribute('open'), null);
  await page.getByRole('button', { name: '继续上次阅读', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.classList.contains('lecture-example'));
  report.checks.push('read and weak marks persist after reload; continue returns keyboard focus to exact example');
  await page.locator('.lesson-study-issues > summary').click();
  await page.getByRole('button', { name: '补采这段', exact: true }).first().click();
  assert.equal(await page.getByLabel('补采开始时间').inputValue(), '01:00');
  assert.equal(await page.getByLabel('补采结束时间').inputValue(), '03:00');
  await page.getByLabel('补采结束时间').fill('99:99');
  await page.getByRole('button', { name: '补采画面', exact: true }).click();
  await page.getByText('请填写有效的起止时间，一次补采 1–120 秒。', { exact: true }).waitFor();
  report.checks.push('gap links prefill a bounded time range; invalid input is blocked before network');
  await page.getByLabel('补采结束时间').fill('03:00');
  await page.locator('.lesson-study-supplement > summary').click();
  await page.locator('.lesson-study-issues > summary').click();
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '练本课', exact: true }).click();
  const selectedSources = page.locator('.exam-studio input[type="checkbox"]:checked');
  await selectedSources.first().waitFor({state:'attached'});
  assert.equal(await selectedSources.first().isChecked(),true);
  assert.ok(await selectedSources.count() >= 1);
  const published = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'))).documents;
  assert.equal(published.length, 1); assert.equal(published[0].sourceLessonId, 'study-a');
  assert.match(await page.locator('.exam-studio').innerText(), /已选用 1 份资料/);
  if(!process.argv.includes('--lecture-only')){
  const labels = ['单选题','多选题','判断题','填空题','简答题','计算 / 证明题'];
  for(let i=0;i<labels.length;i++) await page.getByLabel(`${labels[i]}数量${i+1}`,{exact:true}).fill(i===0?'1':'0');
  await page.getByRole('button',{name:'生成这套试卷',exact:true}).click();
  await page.getByRole('button',{name:/^限时模考/}).click();
  await page.locator('.es-answer-options button').nth(1).click();
  await page.getByRole('button',{name:'交卷并复盘',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确认交卷',exact:true}).click();
  await page.locator('.es-report').waitFor();
  const sourceDetails=page.locator('.es-report details').filter({has:page.locator('button').filter({hasText:'查看原文'})}).last();
  await sourceDetails.locator('summary').click();
  await sourceDetails.getByRole('button',{name:'查看原文',exact:true}).first().click();
  await page.locator('.lesson-study-progress').waitFor();
  await page.waitForFunction(()=>document.activeElement?.classList.contains('lecture-knowledge'));
  report.checks.push('actual exam job, wrong objective answer and submitted feedback return to the exact lecture section; model is a deterministic fixture');
  } else {
    await page.getByRole('button',{name:'网课笔记',exact:true}).first().click();
    await page.locator('.lesson-study-progress').waitFor();
  }
  report.checks.push('practice action actually publishes one lecture document and opens the real exam builder with selected material');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.equal(layout.scrollWidth, width, `no horizontal overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `mobile-${width}.png`), fullPage: true });
    await page.locator('.lesson-study').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `mobile-${width}-viewport.png`) });
  }
  report.checks.push('390px and 320px layouts fit without horizontal overflow');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.failedApi, []); assert.deepEqual(report.externalRequests, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, checks: report.checks.length, output }));
} catch (cause) { report.error = cause.stack; const lastPage=browser?.contexts()[0]?.pages()[0]; if(lastPage){await lastPage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});report.readerState=await lastPage.locator('.study-document-reader').innerText().catch(()=>'');} console.error(cause.stack); process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await vite?.close(); app?.emit('shifen:close');
  if (apiServer) await new Promise(resolve => apiServer.close(resolve));
  const resolved = path.resolve(dataDir); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('shifen-study-ui-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
}
