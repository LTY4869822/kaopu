import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { decorateLessonNotes } from '../server/lesson-document.mjs';
import { currentEditorial } from '../server/lesson-editorial-state.mjs';
import { readLessonFrame } from '../server/lesson-assets.mjs';

// Read-only local acceptance harness: real generated content, isolated UI, no model calls or account changes.
const root = path.resolve(import.meta.dirname, '..'), dataDir = path.join(root, 'data');
const lesson = JSON.parse(fs.readFileSync(path.join(dataDir, 'lessons.json'), 'utf8')).lessons[0];
assert.ok(currentEditorial(lesson), 'Complete the real lesson edition before running content acceptance');
lesson.notes = decorateLessonNotes(lesson.notes, lesson);
const output = path.join(root, 'test-results/lecture-editorial'); fs.mkdirSync(output, { recursive: true });
const report = { realContent: true, productionWrites: false, checks: [], layouts: [], errors: [], externalRequests: [] };
const harness = `import {useState} from 'react';import{createRoot}from'react-dom/client';import LectureDocument from '/src/LectureDocument.tsx';import '/src/styles.css';import '/src/lesson-evidence-image.css';
const lesson=${JSON.stringify(lesson)};function Harness(){const[examples,setExamples]=useState(false);return <main style={{maxWidth:900,margin:'0 auto',padding:'32px 24px'}}><header><h1>${lesson.title.replace(/[<>&]/g, '')}</h1><p>整课重编 · 本地内容验收</p><button onClick={()=>setExamples(!examples)}>{examples?'返回讲义':'只看课堂例题'}</button></header><LectureDocument lesson={lesson} examplesOnly={examples} onAsk={c=>window.__asked=c} onLocate={id=>window.__located=id} onOpenFrame={id=>window.__frame=id} onSaveCard={()=>{}} isCardSaved={()=>false}/></main>}createRoot(document.getElementById('root')).render(<Harness/>);`;
let vite, browser;
try {
  vite = await createServer({ root, cacheDir: path.join(os.tmpdir(), 'shifen-editorial-vite-cache'), configFile: false, appType: 'custom', logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [react(), { name: 'editorial-acceptance', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const pathname = new URL(req.url, 'http://fixture.local').pathname;
      if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(await server.transformIndexHtml('/', '<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/editorial-harness.tsx"></script></body></html>')); }
      if (pathname.startsWith('/api/lessons/')) {
        const frame = lesson.visual.frames.find(item => new URL(item.imageUrl, 'http://fixture.local').pathname === pathname);
        if (!frame) { res.statusCode = 404; return res.end(); }
        const { bytes, mime } = await readLessonFrame(dataDir, lesson, frame.id); res.setHeader('Content-Type', mime); return res.end(bytes);
      }
      next();
    });
  }, resolveId(id) { if (id === '/editorial-harness.tsx') return '\0editorial-harness.tsx'; }, async load(id) { if (id === '\0editorial-harness.tsx') return (await transformWithEsbuild(harness, 'editorial-harness.tsx', { loader: 'tsx', jsx: 'automatic' })).code; } }] });
  await vite.listen(); const baseUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  assert.ok(executablePath, 'Chromium is available'); browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.route(/^https?:\/\//, route => { const url = new URL(route.request().url()); if (url.origin === baseUrl) return route.continue(); report.externalRequests.push(url.origin); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(baseUrl); await page.getByText('整课重编讲义', { exact: true }).waitFor();
  const main = page.locator('.lecture-knowledge').first();
  assert.ok(await main.locator('.lecture-edited-prose').isVisible());
  assert.equal(await main.locator('.lecture-editorial-supplement[open]').count(), 0);
  assert.equal(await main.locator('.lecture-source-details[open]').count(), 0);
  await main.getByRole('button', { name: '问这个知识点' }).click();
  assert.equal((await page.evaluate(() => window.__asked)).sectionId, lesson.notes.readingSections[0].id);
  report.checks.push('coherent main text; optional AI/source layers collapsed; ask uses current chapter ID');
  const summary = main.locator('.lecture-editorial-supplement > summary');
  if (await summary.count()) { await summary.click(); assert.ok(await main.locator('.lecture-editorial-supplement[open]').count()); await summary.click(); }
  const zoom = page.getByRole('button', { name: '放大图片', exact: true }).first();
  if (await zoom.count()) { await zoom.click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0); report.checks.push('selected real image zoom opens and Escape returns to reading'); }
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => window.scrollTo(0, 0));
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(dimensions.content <= dimensions.viewport + 1, `overflow at ${width}: ${JSON.stringify(dimensions)}`);
    report.layouts.push(dimensions); await page.screenshot({ path: path.join(output, `reading-${width}.png`) });
  }
  await page.getByRole('button', { name: '只看课堂例题', exact: true }).click();
  assert.equal(await page.locator('.lecture-example').count(), lesson.notes.readingExamples.length);
  await page.locator('.lecture-practice-answer > summary').nth(1).click();
  assert.equal(await page.locator('.lecture-practice-answer[open]').count(), 1);
  report.checks.push('deduplicated example count; solution opens on demand');
  await page.screenshot({ path: path.join(output, 'examples-mobile.png') });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
  console.log(JSON.stringify({ checks: report.checks, layouts: report.layouts, errors: report.errors }));
} finally {
  await browser?.close(); await vite?.close();
  fs.writeFileSync(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2));
}
