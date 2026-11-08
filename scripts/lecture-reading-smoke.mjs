import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { lessonStudy, updateLessonStudy } from '../server/lesson-study.mjs';

// Isolated React/Vite harness. All course text, images and API responses below are synthetic.
// No production server, database, account, transcript, provider or model is contacted.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results/lecture-reading');
fs.mkdirSync(output, { recursive: true });
const canvas = createCanvas(1200, 675), drawing = canvas.getContext('2d');
drawing.fillStyle = '#fffdf5'; drawing.fillRect(0, 0, 1200, 675);
drawing.fillStyle = '#c7502a'; drawing.fillRect(0, 0, 1200, 12);
drawing.font = 'bold 34px Arial'; drawing.fillStyle = '#272b25';
drawing.fillText('SYNTHETIC EXERCISE - TEST ONLY', 55, 72);
drawing.font = '30px Arial'; drawing.fillText('Given y = 2, with x in [0, 1]: find the range.', 55, 145);
drawing.font = '24px Arial'; drawing.fillStyle = '#69705f'; drawing.fillText('Not a real lecture frame. No user data.', 55, 195);
drawing.strokeStyle = '#4f5848'; drawing.lineWidth = 3;
drawing.beginPath(); drawing.moveTo(170, 555); drawing.lineTo(1070, 555); drawing.moveTo(220, 590); drawing.lineTo(220, 265); drawing.stroke();
drawing.strokeStyle = '#c7502a'; drawing.lineWidth = 7; drawing.beginPath(); drawing.moveTo(220, 360); drawing.lineTo(950, 360); drawing.stroke();
drawing.fillStyle = '#c7502a'; for (const x of [220, 950]) { drawing.beginPath(); drawing.arc(x, 360, 8, 0, Math.PI * 2); drawing.fill(); }
drawing.font = '28px Arial'; drawing.fillText('y = 2', 760, 328); drawing.fillText('0', 205, 600); drawing.fillText('1', 940, 600);
const picture = canvas.toBuffer('image/png'); fs.writeFileSync(path.join(output, 'synthetic-exercise.png'), picture);

const course = id => ({ id: `course-${id}`, name: `合成课程${id.toUpperCase()}`, examDate: '2026-12-01', target: 80, mastery: 0, color: 'orange', icon: 'book', chapters: 2, description: '隔离测试课程' });
function lesson(id) {
  const label = id.toUpperCase(), section = { id: 'reading-1', title: `${label}：函数、定义域与值域`, text: '先确定自变量允许取哪些数，再观察函数值组成的集合。', cueIds: ['cue-1', 'cue-2'], frameIds: ['frame-0001'], inScope: true, sourceSectionIds: ['section-1', 'section-2'], teacherExplanation: `${label}课程教师解释：定义域描述输入的范围，值域描述所有实际输出。不要把常数函数值当成定义域。`, intuition: '把函数想成一台有输入限制的机器。', prerequisites: ['集合与区间的表示'], steps: ['先读出题目对自变量的限制。', '让自变量取遍允许范围，收集实际函数值。'], pitfalls: ['常值函数的定义域不由常数值决定。'], checkQuestion: { prompt: '若x只允许取[0,1]，y恒等于2，值域是什么？', answer: '值域是{2}。', explanation: '输入范围改变，但所有输出仍是2。' }, explanationOrigin: 'ai-supplement' };
  section.frameIds.push('frame-0003');
  section.subsections = [{ id: 'section-1', title: '合成定义域原始讲义', text: '原始讲义一：定义域是允许输入的集合，必须核对题目条件。', cueIds: ['cue-1'], frameIds: ['frame-0001'], inScope: true }, { id: 'section-2', title: '合成值域原始讲义', text: '原始讲义二：值域是实际输出的集合，不是输入范围。', cueIds: ['cue-2'], frameIds: ['frame-0003'], inScope: true }];
  const example = { id: 'example-1', title: `${label}：常值函数的定义域和值域`, prompt: '已知 $y=2$，且 $x\\in[0,1]$，求定义域和值域。', solution: '原课整理：定义域为[0,1]，值域为{2}。', cueIds: ['cue-2'], frameIds: ['frame-0002', 'frame-0003', 'frame-0004'], needsReview: false, detailedSolution: `${label}题目补充讲解：先区分题目给定的输入条件与函数输出。`, solutionSteps: ['读出条件：x属于闭区间[0,1]。', '由y恒等于2得到所有输出只有2。', '以集合形式写出值域{2}，并核对端点条件。'], solutionOrigin: 'ai-supplement' };
  return { id: `lesson-${id}`, courseId: `course-${id}`, title: `合成网课${label}：函数与定义域`, url: 'https://www.bilibili.com/video/BV1xx411c7mD/', part: id === 'a' ? 3 : 4, scope: '函数的概念与定义域', status: 'completed', error: '', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z', sourceName: '合成字幕.srt', sourceFormat: 'srt', cues: [{ id: 'cue-1', start: 80, end: 100, text: `${label}合成来源：定义域是自变量允许取值的集合。` }, { id: 'cue-2', start: 160, end: 180, text: `${label}合成来源：y=2，x属于[0,1]，值域为{2}。` }, { id: 'cue-3', start: 230, end: 240, text: `${label}合成附录来源：课间安排与资料说明。` }], visualCues: [],
    visual: { id: `visual-${id}`, lessonId: `lesson-${id}`, status: 'completed', frames: [1, 2, 3, 4].map((n, index) => ({ id: `frame-000${n}`, time: [80, 160, 180, 200][index], imageUrl: `/api/lessons/lesson-${id}/visual/visual-${id}/frame-000${n}`, width: 1200, height: 675 })), observations: [1, 2, 3, 4].map((n, index) => ({ frameId: `frame-000${n}`, time: [80, 160, 180, 200][index], visibleText: '合成题图：y=2，x属于[0,1]', latex: ['y=2'], description: '供界面测试的合成题图', uncertainties: [], inferences: [] })), warnings: [], coverage: { durationSeconds: 240, sampledFrameCount: 4, recognizedFrameCount: 4, maxGapSeconds: 80, complete: false } },
    notes: { mode: 'ai', overview: ['旧版速览仅用于兼容测试。'], readingOverview: [`${label}课程阅读速览：区分输入范围与实际输出。`], sections: [{ ...section, id: 'section-1', title: '旧分块一' }, { ...section, id: 'section-2', title: '旧分块二' }], readingSections: [section, { id: 'reading-2', title: `${label}：检查函数成立的条件`, text: '每个允许的输入都应对应唯一输出。', cueIds: ['cue-1'], frameIds: [], inScope: true }], examples: [example, { ...example, id: 'example-duplicate' }], readingExamples: [example], readingAppendix: [{ id: 'appendix-1', title: '合成课堂安排', text: '这里保留课间安排与来源说明，避免正文碎片化。', cueIds: ['cue-3'], inScope: null }], readingWarnings: ['合成讲义：用于隔离界面验收。'], warnings: [], coverage: { cueCount: 3, processedCueCount: 3, visual: true, sampledFrameCount: 4, recognizedFrameCount: 4, visualComplete: false }, createdAt: '2026-11-05T00:00:00Z' } };
}
const lessons = [lesson('a'), lesson('b')], courses = [course('a'), course('b')];
const fingerprint = id => (id === 'lesson-a' ? 'a' : 'b').repeat(32);
const report = { syntheticOnly: true, allApiMocked: true, externalRequests: [], unexpectedApi: [], checks: [], layouts: [], apiCalls: [], pageErrors: [], chatAborts: [], assetCalls: {} };
const timers = new Set();
const later = (callback, delay) => { const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay); timers.add(timer); return timer; };
const stage = value => { report.stage = value; console.log(`[lecture-reading] ${value}`); };
const wait = async (check, label, timeout = 12000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error(label); };
const json = (res, body, status = 200) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
let vite, browser, page, baseUrl;

const harness = `import {StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';import LessonStudio from '/src/LessonStudio.tsx';import LessonEvidenceImage from '/src/LessonEvidenceImage.tsx';import '/src/styles.css';import '/src/internal-ui.css';import '/src/ui-system.css';
window.__sessionExpired=0;window.__alerts=[];window.__frameFetches=[];window.addEventListener('shifen:session-expired',()=>window.__sessionExpired++);window.alert=value=>window.__alerts.push(String(value));const originalFetch=window.fetch;window.fetch=(input,init)=>{if(String(input).includes('/visual/'))window.__frameFetches.push({url:String(input),credentials:init?.credentials,redirect:init?.redirect,cache:init?.cache});return originalFetch(input,init)};
function AssetHarness(){const mode=new URLSearchParams(location.search).get('asset');const frames=mode==='auth'?[3,4]:[mode==='retry'?2:1];return <section aria-label="合成图片组件验收">{frames.map(n=><LessonEvidenceImage key={n} eager frame={{id:'frame-000'+n,time:n*80,imageUrl:'/api/lessons/lesson-asset/visual/visual-'+mode+'/frame-000'+n,width:1200,height:675}} caption="合成验收图片"/>)}</section>}
function Harness(){const [shown,setShown]=useState(true);window.__setShown=setShown;return <div className="app-shell" style={{display:'block',minHeight:'100vh'}}><main className="lecture-test-shell">{location.search.includes('asset=')?<AssetHarness/>:shown&&<LessonStudio courses={${JSON.stringify(courses)}} providerConfigured onRefresh={async()=>{window.__refreshes=(window.__refreshes||0)+1}} onNotify={message=>window.__notice=message} onOpenCourse={id=>window.__course=id} onAddCourse={()=>window.__addCourse=true}/>}</main></div>}createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);`;
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>.lecture-test-shell{max-width:1500px;margin:0 auto;padding:24px;min-width:0}@media(max-width:760px){.lecture-test-shell{padding:20px}}@media(max-width:360px){.lecture-test-shell{padding:16px}}</style></head><body><div id="root"></div><script type="module" src="/lecture-harness.tsx"></script></body></html>';

async function mockedApi(req, res) {
  const url = new URL(req.url, 'http://fixture.local'), pathname = url.pathname;
  let body = null;
  if (['POST', 'PUT'].includes(req.method)) { let raw = ''; for await (const chunk of req) raw += chunk; body = raw ? JSON.parse(raw) : {}; }
  report.apiCalls.push({ pathname, method: req.method, ...(body ? { body } : {}) });
  if (pathname === '/api/lessons' && req.method === 'GET') return json(res, { lessons, capabilities: { model: true, bilinote: true, vision: true, visionCapture: true, sourceKind: 'local' } });
  if (/\/visual\/[^/]+\/frame-\d{4}$/.test(pathname)) {
    report.assetCalls[pathname] = (report.assetCalls[pathname] || 0) + 1;
    if (pathname.includes('visual-auth')) return json(res, { error: '合成登录失效' }, 401);
    if (pathname.includes('visual-retry') && report.assetCalls[pathname] === 1) return json(res, { error: '合成临时错误' }, 500);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': picture.length }); return res.end(picture);
  }
  const study = pathname.match(/^\/api\/lessons\/([^/]+)\/study$/);
  if (study) { const current = lessons.find(item => item.id === study[1]); if (!current) return json(res, {error:'missing fixture'}, 404); return json(res, req.method === 'PUT' ? updateLessonStudy(current, body) : lessonStudy(current)); }
  const context = pathname.match(/^\/api\/lessons\/([^/]+)\/chat\/context$/);
  if (context) return json(res, { lessonId: context[1], fingerprint: fingerprint(context[1]), modelConfigured: true });
  const chat = pathname.match(/^\/api\/lessons\/([^/]+)\/chat$/);
  if (chat && req.method === 'POST') {
    const id = chat[1], current = lessons.find(item => item.id === id);
    if (body.fingerprint !== fingerprint(id)) return json(res, { error: '合成课程已变化' }, 409);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
    const emit = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const slow = /停止测试|切课测试|变更位置测试/.test(body.message), answer = `${id === 'lesson-a' ? 'A' : 'B'}课程独立回答：先确定定义域，再观察实际函数值。`;
    let complete = false;
    res.on('close', () => { if (!complete) report.chatAborts.push({ lessonId: id, message: body.message }); });
    emit('meta', { lessonId: id, fingerprint: fingerprint(id) });
    later(() => emit('delta', { text: slow ? '合成流式片段，等待继续。' : answer.slice(0, 10) }), 70);
    later(() => {
      emit('delta', { text: slow ? '旧课程迟到内容，不应泄漏到新课程。' : answer.slice(10) });
      const citations = [{ id: 'reading-1', kind: 'section', title: current.notes.readingSections[0].title, lessonId: id, time: 80, cueIds: ['cue-1'] }, { id: 'example-1', kind: 'example', title: current.notes.readingExamples[0].title, lessonId: id, time: 160, cueIds: ['cue-2'] }, { id: 'cue-1', kind: 'cue', title: '合成原文定位', lessonId: id, time: 80 }, { id: 'frame-0001', kind: 'frame', title: '合成画面定位', lessonId: id, time: 80 }, { id: 'foreign', kind: 'section', title: '跨课不应出现', lessonId: id === 'lesson-a' ? 'lesson-b' : 'lesson-a' }];
      emit('done', { answer, mode: 'model', citations, fingerprint: fingerprint(id) }); complete = true; if (!res.destroyed) res.end();
    }, slow ? 2200 : 230);
    return;
  }
  report.unexpectedApi.push({ pathname, method: req.method }); return json(res, { error: '未定义的合成接口' }, 404);
}

async function assertLayout(label, width) {
  await page.setViewportSize({ width, height: 960 });
  const result = await page.evaluate(() => {
    const visible = el => el.checkVisibility() && el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1 && !el.closest('[aria-hidden="true"],.sr-only,.lesson-chat-sr-only');
    const roots = '.lesson-studio,.lesson-chat,.lesson-image-dialog,[aria-label="合成图片组件验收"]';
    const nodes = [...document.querySelectorAll(roots)].flatMap(el => [...el.querySelectorAll('button,summary,input:not([type="checkbox"]):not([type="radio"]),select,textarea,a[href]')]);
    const controls = [...new Set(nodes)].filter(visible).map(el => ({ label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 45), tag: el.tagName, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
    const auxiliary = [...document.querySelectorAll('.lesson-studio small,.lesson-studio label,.lesson-studio summary,.lesson-studio figcaption,.lesson-studio p,.lesson-studio button,.lesson-studio select,.lesson-chat label,.lesson-chat p,.lesson-chat button,.lesson-chat select,.lesson-chat-message-label,.lesson-image-dialog p,.lesson-evidence-image figcaption')].filter(visible);
    const prose = [...document.querySelectorAll('.lecture-document .lesson-text,.lesson-chat-message > .lesson-text,.lesson-transcript .lesson-body-text')].filter(visible);
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyFont: parseFloat(getComputedStyle(document.querySelector('.app-shell')).fontSize), shortControls: controls.filter(el => el.height < 43.9 || el.width < 43.9), smallAuxiliary: auxiliary.filter(el => parseFloat(getComputedStyle(el).fontSize) < 14).map(el => ({ text: el.textContent.trim().slice(0, 45), font: getComputedStyle(el).fontSize })), smallProse: prose.filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => ({ text: el.textContent.trim().slice(0, 45), font: getComputedStyle(el).fontSize })) };
  });
  report.layouts.push({ label, ...result });
  assert.equal(result.documentWidth, width, `${label}/${width}: horizontal overflow`);
  assert.ok(result.bodyFont >= 16, `${label}/${width}: body <16px`);
  assert.deepEqual(result.smallAuxiliary, [], `${label}/${width}: auxiliary <14px`);
  assert.deepEqual(result.smallProse, [], `${label}/${width}: prose <16px`);
  assert.deepEqual(result.shortControls, [], `${label}/${width}: controls <44px`);
  await page.screenshot({ path: path.join(output, `${label}-${width}.png`), fullPage: true });
}
async function sendQuestion(question) {
  await page.getByRole('textbox', { name: '向讲义助手提问' }).fill(question);
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
}
async function closeChat() {
  const close = page.getByRole('button', { name: '收起讲义助手', exact: true });
  if (await close.isVisible()) await close.click();
  await wait(() => page.locator('.lesson-chat').count().then(count => count === 0), 'chat closes');
}

try {
  stage('starting isolated fixtures');
  vite = await createServer({ root, cacheDir: path.join(os.tmpdir(), 'shifen-lecture-reading-vite-cache'), configFile: false, appType: 'custom', logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [react(), { name: 'lecture-reading-harness', configureServer(server) { server.middlewares.use((req, res, next) => { if (req.url?.startsWith('/api/')) { void mockedApi(req, res).catch(error => { report.unexpectedApi.push({ error: error.message }); json(res, { error: '合成API异常' }, 500); }); return; } if (new URL(req.url, 'http://fixture.local').pathname !== '/') return next(); void server.transformIndexHtml('/', html).then(value => { res.setHeader('Content-Type', 'text/html'); res.end(value); }).catch(next); }); }, resolveId(id) { if (id === '/lecture-harness.tsx') return '\0lecture-harness.tsx'; }, async load(id) { if (id === '\0lecture-harness.tsx') return (await transformWithEsbuild(harness, 'lecture-harness.tsx', { loader: 'tsx', jsx: 'automatic' })).code; } }] });
  await vite.listen(); baseUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228', '1223'].map(version => path.join(os.homedir(), 'AppData/Local/ms-playwright', `chromium-${version}/chrome-win64/chrome.exe`))].filter(Boolean);
  const executablePath = candidates.find(value => fs.existsSync(value)); assert.ok(executablePath, 'a local Playwright Chromium is available');
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.route(/^https?:\/\//, route => { const url = new URL(route.request().url()); if (url.origin === baseUrl) return route.continue(); report.externalRequests.push(url.origin + url.pathname); return route.abort('blockedbyclient'); });
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.locator('.lecture-knowledge').first().waitFor({ timeout: 45000 });
  assert.equal(await page.locator('.lecture-knowledge').count(), 2); assert.equal(await page.locator('.lecture-example').count(), 1);
  assert.match(await page.locator('.lecture-overview').innerText(), /A课程阅读速览/); assert.doesNotMatch(await page.locator('.lecture-overview').innerText(), /旧版速览/);
  assert.match(await page.locator('.lecture-teacher').first().innerText(), /教师解释/);
  assert.equal(await page.locator('.lecture-example .lecture-steps li').count(), 3);
  const firstKnowledge = page.locator('.lecture-knowledge').first(), firstExample = page.locator('.lecture-example');
  assert.equal(await firstKnowledge.locator('.lesson-evidence-image').count(), 1, 'knowledge starts with one mounted frame');
  assert.equal(await firstExample.locator('.lesson-evidence-image').count(), 2, 'exercise starts with two mounted frames');
  await firstKnowledge.getByText('更多课堂截图（1）', { exact: true }).click();
  assert.equal(await firstKnowledge.locator('.lesson-evidence-image').count(), 2, 'extra knowledge frame mounts on demand');
  await firstKnowledge.getByText('更多课堂截图（1）', { exact: true }).click();
  await firstExample.getByText('更多课堂截图（1）', { exact: true }).click();
  assert.equal(await firstExample.locator('.lesson-evidence-image').count(), 3, 'extra exercise frame mounts on demand');
  await firstExample.getByText('更多课堂截图（1）', { exact: true }).click();
  const classroomDetail = firstKnowledge.getByText('课堂细节 · 2 段原始讲义', { exact: true });
  await classroomDetail.click(); assert.match(await firstKnowledge.innerText(), /原始讲义一/); assert.match(await firstKnowledge.innerText(), /原始讲义二/); await classroomDetail.click();
  await page.locator('.lecture-knowledge .lesson-asset img').first().waitFor();
  assert.ok((await page.locator('.lecture-knowledge .lesson-asset img').first().getAttribute('src')).startsWith('blob:'), 'authenticated frame renders from a fetched blob');
  report.checks.push('derived document, one deduplicated example, teacher explanation, solution steps and authenticated frame');

  stage('directory and source navigation');
  await page.getByRole('navigation', { name: '全课内容目录' }).getByRole('button', { name: 'A：检查函数成立的条件', exact: true }).click();
  await wait(() => page.locator('#lecture-lesson-a-section-reading-2').evaluate(el => el === document.activeElement), 'directory jump focuses section');
  await page.locator('.lecture-appendix > summary').click(); assert.match(await page.locator('.lecture-appendix').innerText(), /避免正文碎片化/);
  await page.locator('.lecture-knowledge').first().getByRole('button', { name: '对照原文', exact: true }).click();
  await wait(() => page.getByRole('tab', { name: '原文', exact: true }).getAttribute('aria-selected').then(value => value === 'true'), 'source click opens original transcript');
  assert.match(await page.locator('.lesson-transcript .is-located').innerText(), /A合成来源/);
  await page.getByRole('tab', { name: '讲义', exact: true }).click();
  await page.getByRole('tab', { name: '讲义', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: /^例题/ }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home'); assert.equal(await page.getByRole('tab', { name: '讲义', exact: true }).getAttribute('aria-selected'), 'true');
  const zoomTrigger = page.locator('.lecture-knowledge').first().getByRole('button', { name: '放大图片', exact: true });
  await zoomTrigger.click(); await page.getByRole('dialog', { name: '课程 01:20 的原始画面', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await wait(() => zoomTrigger.evaluate(el => el === document.activeElement), 'Escape returns image focus');
  report.checks.push('whole-course directory focus, appendix, transcript source location, image zoom Escape focus restoration');

  stage('responsive reading document');
  for (const width of [1440, 1024, 768, 390, 320]) await assertLayout('document', width);
  const mobileDirectory = page.getByRole('button', { name: /^讲次目录/ });
  assert.equal(await mobileDirectory.getAttribute('aria-expanded'), 'false'); await mobileDirectory.click();
  await page.getByRole('navigation', { name: '全课内容目录' }).getByRole('button', { name: /^例 1/ }).click();
  await wait(() => page.locator('#lecture-lesson-a-example-example-1').evaluate(el => el === document.activeElement), 'mobile directory focuses example');
  assert.equal(await mobileDirectory.getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({ width: 1440, height: 960 });
  stage('contextual SSE conversation and citations');
  await page.locator('.lecture-knowledge').first().getByRole('button', { name: '问这个知识点', exact: true }).click();
  await wait(() => page.getByLabel('正在讨论', { exact: true }).inputValue().then(value => value === 'section:reading-1'), 'section context selected');
  await sendQuestion('请解释当前知识点');
  await wait(() => page.locator('.lesson-chat-message.is-assistant').last().innerText().then(value => value.includes('A课程独立回答')), 'streamed model answer');
  await page.locator('.lesson-chat-citations button').first().waitFor();
  assert.equal(await page.getByRole('button', { name: /跨课不应出现/ }).count(), 0);
  const firstPost = report.apiCalls.find(call => call.pathname === '/api/lessons/lesson-a/chat' && call.method === 'POST');
  assert.deepEqual(firstPost.body.context, { sectionId: 'reading-1' }); assert.equal(firstPost.body.fingerprint, fingerprint('lesson-a'));
  await page.getByRole('button', { name: /知识点 · A：函数、定义域与值域/ }).click();
  await wait(() => page.locator('#lecture-lesson-a-section-reading-1').evaluate(el => el === document.activeElement), 'citation focuses knowledge section');
  await page.getByRole('button', { name: /原文 · 合成原文定位/ }).click();
  await wait(() => page.locator('.lesson-transcript .is-located').count().then(count => count === 1), 'citation opens transcript cue');
  await page.getByRole('button', { name: /画面 · 合成画面定位/ }).click();
  await wait(() => page.getByRole('tab', { name: '板书', exact: true }).getAttribute('aria-selected').then(value => value === 'true'), 'citation opens matching visual evidence');
  await page.getByRole('button', { name: /例题 · A：常值函数的定义域和值域/ }).click();
  await wait(() => page.locator('#lecture-lesson-a-example-example-1').evaluate(el => el === document.activeElement), 'citation focuses example');
  await closeChat(); await page.locator('.lecture-example').getByRole('button', { name: '问这道题', exact: true }).click();
  assert.equal(await page.getByLabel('正在讨论', { exact: true }).inputValue(), 'example:example-1');
  await sendQuestion('这道题为什么这样解');
  await wait(() => page.locator('.lesson-chat-citations button').count().then(count => count >= 4), 'example answer includes citations');
  const examplePost = report.apiCalls.filter(call => call.pathname.endsWith('/chat') && call.method === 'POST').at(-1);
  assert.deepEqual(examplePost.body.context, { exampleId: 'example-1' });
  report.checks.push('real chunked SSE, section/example request context, fingerprint, filtered foreign citation and section/example/transcript jumps');

  stage('cancel, context change and cross-course isolation');
  await sendQuestion('停止测试：保持流式连接'); await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await wait(() => page.locator('.lesson-chat-message.is-assistant').last().innerText().then(value => value.includes('合成流式片段')), 'partial response arrives before cancel');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await wait(() => page.locator('.lesson-chat-message.is-assistant').last().innerText().then(value => value.includes('已停止')), 'cancel keeps partial response and stopped state');
  await wait(() => report.chatAborts.some(item => item.message.includes('停止测试')), 'HTTP stream aborted by cancel');
  await sendQuestion('变更位置测试：保持流式连接'); await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await page.getByLabel('正在讨论', { exact: true }).selectOption('section:reading-2');
  await wait(() => report.chatAborts.some(item => item.message.includes('变更位置测试')), 'context change aborts previous stream');
  await wait(() => page.getByRole('button', { name: '发送问题', exact: true }).count().then(count => count === 1), 'context change resets busy state');
  await sendQuestion('切课测试：保持流式连接'); await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  await page.locator('.lesson-list-item').filter({ hasText: lessons[1].title }).click();
  await wait(() => page.locator('.lesson-reader-heading h2').innerText().then(value => value === lessons[1].title), 'second lecture selected');
  await wait(() => report.chatAborts.some(item => item.message.includes('切课测试')), 'lecture switch aborts old stream');
  await page.getByRole('button', { name: '打开讲义助手', exact: true }).click();
  assert.equal(await page.getByLabel('正在讨论', { exact: true }).inputValue(), 'lesson');
  assert.doesNotMatch(await page.locator('.lesson-chat').innerText(), /A课程独立回答|停止测试|旧课程迟到内容/);
  await sendQuestion('B课程独立提问');
  await wait(() => page.locator('.lesson-chat-message.is-assistant').last().innerText().then(value => value.includes('B课程独立回答')), 'second course answer stays isolated');
  const lastPost = report.apiCalls.filter(call => call.pathname.endsWith('/chat') && call.method === 'POST').at(-1);
  assert.equal(lastPost.pathname, '/api/lessons/lesson-b/chat'); assert.deepEqual(lastPost.body.history, []); assert.equal(lastPost.body.fingerprint, fingerprint('lesson-b'));
  report.checks.push('cancel aborts HTTP, retains partial text, context changes abort, lecture switch isolates shared IDs/history/fingerprint');

  stage('responsive assistant and modal keyboard behavior');
  for (const width of [1440, 1024, 768, 390, 320]) await assertLayout('assistant', width);
  await page.keyboard.press('Escape'); await wait(() => page.locator('.lesson-chat').count().then(count => count === 0), 'mobile Escape closes assistant');
  assert.equal(await page.getByRole('button', { name: '打开讲义助手', exact: true }).evaluate(el => el === document.activeElement), true);
  report.checks.push('assistant at 1440/1024/768/390/320, drawer Escape returns focus');

  stage('authenticated image recovery');
  await page.goto(`${baseUrl}/?asset=retry`, { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: '重新加载图片', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__sessionExpired), 0, 'temporary 500 does not expire owner session');
  await page.getByRole('button', { name: '重新加载图片', exact: true }).click();
  await page.locator('.lesson-asset img').waitFor(); assert.equal(report.assetCalls['/api/lessons/lesson-asset/visual/visual-retry/frame-0002'], 2);
  await wait(() => page.locator('.lesson-asset img').evaluate(el => el.complete && el.naturalWidth > 0), 'retried image decodes successfully');
  await assertLayout('image-recovered', 320);
  const imageButton = page.getByRole('button', { name: '放大图片', exact: true }); await imageButton.click();
  await page.getByRole('dialog').waitFor(); await assertLayout('image-zoom', 320); await page.keyboard.press('Escape');
  await wait(() => imageButton.evaluate(el => el === document.activeElement), 'image Escape restores its own trigger');
  report.checks.push('temporary image 500 is retryable, successful blob decode, 320px image zoom and focus return');
  stage('owner-session expiry event');
  await page.goto(`${baseUrl}/?asset=auth`, { waitUntil: 'domcontentloaded' });
  await wait(() => page.locator('.lesson-asset-error').count().then(count => count === 2), 'both unauthorized images show recovery state');
  assert.equal(await page.evaluate(() => window.__sessionExpired), 1, 'simultaneous 401 image failures dispatch one expiry event');
  assert.deepEqual(await page.evaluate(() => window.__alerts), [], 'image expiry does not open a browser alert');
  const imageRequests = await page.evaluate(() => window.__frameFetches);
  assert.equal(imageRequests.length, 2); assert.ok(imageRequests.every(item => item.credentials === 'same-origin' && item.redirect === 'error' && item.cache === 'no-store'));
  report.checks.push('parallel image 401s dispatch exactly one session-expired event; authenticated no-store fetch; no alert');
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.unexpectedApi, []); assert.deepEqual(report.pageErrors, []);
  report.status = 'passed'; stage('passed');
} catch (error) {
  report.status = 'failed'; report.failure = { stage: report.stage, message: error.message, stack: error.stack };
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  timers.forEach(clearTimeout); timers.clear();
  await browser?.close(); await vite?.close();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Lecture UI report: ${path.join(output, 'report.json')}`);
}

