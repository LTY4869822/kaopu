import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

// Focused synthetic UI check. Does not start the application server or read its data/models.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results/lecture-layering'); fs.mkdirSync(output, { recursive: true });
const math = '$$\n\\begin{aligned}\na &= b \\\\\n\nc &= d\n\\end{aligned}\n$$';
const code = '```text\nCODE_START\n\nCODE_END\n```';
const paragraphs = ['讲解第一段：先理解输入范围。', '讲解第二段：再看实际输出。', math, '讲解第四段：这里是展开后才能看到的补充内容。', '讲解第五段：最后检查所有边界条件。'];
const long = paragraphs.join('\n\n');
const section = (id, title, teacherExplanation, extra = {}) => ({ id, title, text: '合成讲义依据。', teacherExplanation, cueIds: ['cue-1'], frameIds: [], inScope: true, ...extra });
const lesson = { id: 'layering', title: '合成长讲义验收', courseId: 'course-synthetic', url: '', part: 1, scope: '', status: 'completed', sourceName: '合成文本', sourceFormat: 'txt', createdAt: '2026-11-05', updatedAt: '2026-11-05', cues: [{ id: 'cue-1', start: null, end: null, text: '仅供UI测试的合成来源。' }], notes: { mode: 'ai', overview: [], sections: [
  section('long', '长内容与数学块', long, { intuition: [1, 2, 3, 4, 5].map(index => `直觉第${index}段：用机器输入输出理解函数。`).join('\n\n'), steps: Array.from({ length: 8 }, (_, index) => `步骤${index + 1}：保留条件并逐步核对。`), pitfalls: Array.from({ length: 7 }, (_, index) => `易错点${index + 1}：不要遗漏条件。`) }),
  section('short', '短内容保持直接可读', '短讲解第一段。\n\n短讲解第二段。', { intuition: '短直觉。', steps: ['短步骤1', '短步骤2'], pitfalls: ['短易错点1'] }),
  section('code', '代码块的内部空行', ['代码前第一段。', '代码前第二段。', code, '代码块后隐藏补充。'].join('\n\n')),
  section('budget', '自然段软预算', ['预算首段：' + '完整自然段不可从中间切开。'.repeat(65), '预算第二段：' + '第二自然段在展开后显示。'.repeat(65), '预算第三段：保留完整结尾。'].join('\n\n')),
], examples: [], warnings: [], coverage: { cueCount: 1, processedCueCount: 1, visual: false }, createdAt: '2026-11-05' } };
const citations = [{ id: 'reading-1', lessonId: lesson.id, kind: 'section', title: '合成知识点', cueIds: ['cue-1'] }, { id: 'cue-1', lessonId: lesson.id, kind: 'cue', title: '合成原文' }];
const answer = ['### 合成讲解', '先看 **输入范围** [reading-1]，再看原文 [cue-1]。未知引用 [unknown-id] 应保持原样。', '1. 先确认输入。\n2. 再观察输出。', '- 核对条件。\n- 保留边界。', math, '公式里的引用字样保持为原式：$[reading-1]+x$。', '<img src="https://example.invalid/x" onerror="window.__xss=1"><script>window.__xss=2</script>', '[恶意外链](https://example.invalid/link) <a href="javascript:window.__xss=3">伪链接</a>'].join('\n\n');
const report = { syntheticOnly: true, allApiMocked: true, checks: [], externalRequests: [], unexpectedApi: [], pageErrors: [], bootstrap: [], transport: [], productAssertionsRun: false };
const wait = async (check, message, ms = 12000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error(message); };
let vite, browser, page, baseUrl;
const stage = value => { report.stage = value; console.log(`[lecture-layering] ${value}`); };
const harness = `import {StrictMode,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import LectureDocument from '/src/LectureDocument.tsx';import LessonChat,{LessonChatAnswer} from '/src/LessonChat.tsx';import '/src/styles.css';import '/src/internal-ui.css';import '/src/ui-system.css';
const lesson=${JSON.stringify(lesson)},citations=${JSON.stringify(citations)};window.__xss=0;
function Harness(){const [value,setValue]=useState(${JSON.stringify(answer)});const [context,setContext]=useState({});const [open,setOpen]=useState(true);const trigger=useRef(null);window.__setAnswer=setValue;const params=new URLSearchParams(location.search);return <div className="app-shell" style={{display:'block',minHeight:'100vh'}}><main className="layer-test-shell">{params.has('renderer')?<article className="lesson-chat-message"><LessonChatAnswer text={value} citations={citations}/></article>:params.has('chat')?<LessonChat lesson={lesson} open={open} context={context} onContextChange={setContext} returnFocusRef={trigger} onClose={()=>setOpen(false)} onLocate={citation=>window.__located=citation} onSettings={()=>{}}/>:<LectureDocument lesson={lesson} onAsk={()=>{}} onLocate={()=>{}} onOpenFrame={()=>{}} onSaveCard={()=>{}} isCardSaved={()=>false}/>}</main></div>}createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);`;
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>.layer-test-shell{width:min(100%,960px);padding:24px;margin:0 auto;min-width:0}@media(max-width:600px){.layer-test-shell{padding:16px}}</style></head><body><div id="root"></div><script type="module" src="/layer-harness.tsx"></script></body></html>';

try {
  stage('isolated startup');
  vite = await createServer({ root, cacheDir: path.join(os.tmpdir(), 'shifen-lecture-layering-vite-cache'), configFile: false, appType: 'custom', logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [react(), { name: 'layering-harness', configureServer(server) { server.middlewares.use((req, res, next) => {
    const pathname = new URL(req.url, 'http://fixture.local').pathname;
    if (pathname === '/api/lessons/layering/chat/context') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ lessonId: lesson.id, fingerprint: 'a'.repeat(32), modelConfigured: true })); }
    if (pathname === '/api/lessons/layering/chat' && req.method === 'POST') { res.setHeader('Content-Type', 'text/event-stream'); return res.end(`event: done\ndata: ${JSON.stringify({ answer, citations, mode: 'model', fingerprint: 'a'.repeat(32) })}\n\n`); }
    if (pathname.startsWith('/api/')) { report.unexpectedApi.push(pathname); res.writeHead(404); return res.end('{}'); }
    if (pathname !== '/') return next(); void server.transformIndexHtml('/', html).then(value => { res.setHeader('Content-Type', 'text/html'); res.end(value); }).catch(next);
  }); }, resolveId(id) { if (id === '/layer-harness.tsx') return '\0layer-harness.tsx'; }, async load(id) { if (id === '\0layer-harness.tsx') return (await transformWithEsbuild(harness, 'layer-harness.tsx', { loader: 'tsx', jsx: 'automatic' })).code; } }] });
  report.bootstrap.push({ at: new Date().toISOString(), event: 'vite-created' });
  await vite.listen(); baseUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  report.bootstrap.push({ at: new Date().toISOString(), event: 'vite-listening', url: baseUrl }); stage('Vite listening');
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228', '1223'].map(version => path.join(os.homedir(), 'AppData/Local/ms-playwright', `chromium-${version}/chrome-win64/chrome.exe`))].filter(Boolean).find(value => fs.existsSync(value));
  assert.ok(executablePath, 'local Chromium is installed'); browser = await chromium.launch({ executablePath, headless: true });
  report.bootstrap.push({ at: new Date().toISOString(), event: 'chromium-launched' }); stage('Chromium launched');
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.route(/^https?:\/\//, route => { const url = new URL(route.request().url()); if (url.origin === baseUrl) return route.continue(); report.externalRequests.push(url.origin + url.pathname); return route.abort('blockedbyclient'); });
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => report.pageErrors.push(error.message));
  const transport = value => { if (report.transport.length < 600) report.transport.push({ at: new Date().toISOString(), ...value }); };
  page.on('request', request => transport({ event: 'request', type: request.resourceType(), url: request.url() }));
  page.on('response', response => transport({ event: 'response', status: response.status(), url: response.url() }));
  page.on('requestfailed', request => transport({ event: 'requestfailed', url: request.url(), error: request.failure()?.errorText }));
  page.on('console', message => { if (message.type() === 'error') transport({ event: 'console-error', message: message.text() }); });
  report.bootstrap.push({ at: new Date().toISOString(), event: 'first-navigation', url: baseUrl, waitUntil: 'domcontentloaded', timeout: 45000 }); stage('first navigation (DOMContentLoaded)');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.locator('#lecture-layering-section-long').waitFor({ timeout: 45000 });
  report.bootstrap.push({ at: new Date().toISOString(), event: 'fixture-visible' }); report.productAssertionsRun = true;
  stage('default disclosure and indivisible blocks');
  assert.equal(await page.locator('.lecture-main-prose').first().isVisible(),true);
  assert.match(await page.locator('.lecture-main-prose').first().innerText(),/合成讲义依据/);
  assert.equal(await page.locator('.lecture-editorial-supplement').first().evaluate(node=>node.open),false);
  report.checks.push('source lecture text stays directly visible; AI supplement is separate and collapsed');
  for(const summary of await page.locator('.lecture-editorial-supplement > summary').all())await summary.click();
  const longSection = page.locator('#lecture-layering-section-long'), teacher = longSection.locator('.lecture-teacher').first(), preview = teacher.locator('.lecture-content-preview');
  assert.match(await preview.innerText(), /讲解第一段/); assert.match(await preview.innerText(), /讲解第二段/); assert.doesNotMatch(await preview.innerText(), /讲解第四段/);
  assert.equal(await preview.locator('.katex-display').count(), 1, 'display math with internal blank line stays one block');
  const formula = await preview.locator('annotation').textContent(); assert.ok(formula.includes('a &= b') && formula.includes('c &= d'));
  assert.equal(await longSection.locator('.lecture-teacher').nth(1).locator('li:visible').count(), 6);
  assert.equal(await longSection.locator('.lecture-pitfalls li:visible').count(), 5);
  assert.doesNotMatch(await longSection.locator('.lecture-intuition .lecture-content-preview').innerText(), /直觉第4段/);
  const codePreview = page.locator('#lecture-layering-section-code .lecture-content-preview');
  assert.match(await codePreview.innerText(), /CODE_START[\s\S]*CODE_END/); assert.doesNotMatch(await codePreview.innerText(), /代码块后隐藏补充/);
  assert.doesNotMatch(await page.locator('#lecture-layering-section-budget .lecture-content-preview').innerText(), /预算第二段/);
  assert.equal(await page.locator('#lecture-layering-section-short .lecture-content-more').count(), 0, 'short content does not acquire progressive controls');
  report.checks.push('3-paragraph preview, 6 steps, 5 pitfalls, atomic math/code blocks, soft character budget and unchanged short content');
  await page.screenshot({ path: path.join(output, 'collapsed-390.png'), fullPage: true });

  stage('390px disclosure keyboard and full content');
  const proseSummary = teacher.locator('.lecture-content-more > summary'); await proseSummary.scrollIntoViewIfNeeded();
  const bounds = await proseSummary.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390.5 && bounds.height >= 43.9);
  await proseSummary.focus(); await page.keyboard.press('Enter');
  assert.match(await teacher.innerText(), /讲解第四段/); assert.match(await teacher.innerText(), /讲解第五段/); assert.equal(await teacher.locator('.katex-display').count(), 1);
  await longSection.getByText('展开完整直觉说明（共5段）', { exact: true }).click(); assert.match(await longSection.locator('.lecture-intuition').innerText(), /直觉第5段/);
  await longSection.getByText('展开其余推导步骤（共8步）', { exact: true }).click();
  const continuation = longSection.locator('.lecture-teacher').nth(1).locator('details ol'); assert.equal(await continuation.getAttribute('start'), '7'); assert.equal(await continuation.locator('li:visible').count(), 2);
  await longSection.getByText('展开其余易错点（共7条）', { exact: true }).click(); assert.equal(await longSection.locator('.lecture-pitfalls li:visible').count(), 7);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  const tiny = await page.locator('.lecture-content-more > summary,.lecture-content-preview,.lecture-content-more > .lesson-text').evaluateAll(nodes => nodes.filter(el => el.checkVisibility()).filter(el => parseFloat(getComputedStyle(el).fontSize) < (el.tagName === 'SUMMARY' ? 14 : 16)).map(el => el.textContent.slice(0, 30)));
  assert.deepEqual(tiny, []); report.checks.push('390px reachable summaries, Enter expands, full tail preserved, step numbering resumes at 7, no overflow and readable type');
  await page.screenshot({ path: path.join(output, 'expanded-390.png'), fullPage: true });

  stage('safe formatted assistant rendering');
  await page.goto(`${baseUrl}/?renderer=1`, { waitUntil: 'domcontentloaded' }); const renderer = page.locator('.lesson-chat-answer'); await renderer.waitFor();
  assert.equal(await renderer.locator('strong').count(), 1); assert.equal(await renderer.locator('ol li').count(), 2); assert.equal(await renderer.locator('ul li').count(), 2);
  assert.equal(await renderer.locator('.katex-display').count(), 1); assert.match(await renderer.innerText(), /输入范围 \[1\].*原文 \[2\]/);
  assert.match(await renderer.innerText(), /\[unknown-id\]/); assert.ok((await renderer.locator('annotation').allTextContents()).some(value => value.includes('[reading-1]+x')));
  assert.equal(await renderer.locator('script,img,a').count(), 0); assert.equal(await page.evaluate(() => window.__xss), 0);
  await page.evaluate(() => window.__setAnswer('流式未完成：**加粗尚未闭合 $x+1 <img src="https://example.invalid/partial" onerror="window.__xss=4">'));
  assert.equal(await renderer.locator('script,img,a').count(), 0); assert.equal(await page.evaluate(() => window.__xss), 0);
  assert.match(await renderer.innerText(), /流式未完成/); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  report.checks.push('React paragraphs/bold/ordered/unordered lists, math, validated citation numbers, unknown IDs retained, no HTML/link execution, incomplete stream safe');
  await page.screenshot({ path: path.join(output, 'stream-safe-390.png'), fullPage: true });

  stage('actual assistant source numbering');
  await page.goto(`${baseUrl}/?chat=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: '向讲义助手提问' }).fill('合成安全排版问题'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.locator('.lesson-chat-citations button').first().waitFor();
  assert.match(await page.locator('.lesson-chat-citations button').first().innerText(), /^\[1\] 知识点/);
  assert.match(await page.locator('.lesson-chat-citations button').nth(1).innerText(), /^\[2\] 原文/);
  assert.match(await page.locator('.lesson-chat-message.is-assistant').innerText(), /输入范围 \[1\]/);
  assert.equal(await page.locator('.lesson-chat-message.is-assistant .lesson-chat-answer a').count(), 0);
  await page.locator('.lesson-chat-citations button').first().click(); await wait(() => page.evaluate(() => window.__located?.id === 'reading-1'), 'numbered source locates validated citation');
  report.checks.push('actual assistant [1]/[2] source buttons match in-text numbers and retain source navigation');
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.unexpectedApi, []); assert.deepEqual(report.pageErrors, []);
  report.status = 'passed'; stage('passed');
} catch (error) {
  report.status = report.productAssertionsRun ? 'failed' : 'startup-incomplete'; report.failure = { stage: report.stage, message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
} finally {
  await browser?.close(); await vite?.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Layering report: ${path.join(output, 'report.json')}`);
}
