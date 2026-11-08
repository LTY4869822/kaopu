// Real application + isolated Express state; deterministic AI, never touches user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-practice-batch-'));
const output = path.resolve('test-results/practice-batch'); fs.mkdirSync(output, { recursive: true });
const report = { isolatedBackend: true, syntheticModel: true, checks: [], layouts: [], errors: [], reviewCalls: 0 };
let app, browser, server, sequence = 0, failReview = false, failGeneration = false;
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
const model = async (_url, init) => {
  const p = JSON.parse(JSON.parse(init.body).messages[1].content);
  if (p.task === 'practice-review') {
    report.reviewCalls++; if (failReview) return new Response('', { status: 503 });
    return response({ summary: '本组已完成。复合函数求导需要先识别内外层；你对概念已有印象，下一步重点检查内层导数是否遗漏。', recommendations: ['先复述链式法则，再完成一道内层为平方函数的变式题。', '把暂时不会的知识点加入回忆复习，明天再次检验。'], items: p.questions.map(q => ({ questionId: q.id, status: 'partial', confidence: 0.9, feedback: q.skipped ? '你标记了暂时不会，建议先从内外层识别开始。' : '思路已经写出，注意补全内层函数的导数。', explanation: '设函数由外层 f 和内层 g 复合而成，使用链式法则时先求外层导数，再乘以内层导数。例如 y=sin(x²)，外层的导数是 cos(x²)，内层的导数是 2x，因此结果为 2x cos(x²)。', steps: ['识别内层函数 g(x)=x² 和外层函数 f(u)=sin u。', '分别计算内外层导数，再相乘；检查是否遗漏 2x。'] })) });
  }
  if (p.task === 'blueprint') return response({ blueprint: Array.from({ length: p.count }, (_, i) => ({ id: `b${i}`, topic: `链式法则知识点${i + 1}`, type: p.types[i % p.types.length], difficulty: 'medium', sourceIds: [p.sources[0].sourceId] })) });
  if (failGeneration && ['questions', 'repair-questions'].includes(p.task)) return response({ questions: [] });
  if (p.task === 'questions') { sequence++; return response({ questions: p.blueprint.map((b, i) => ({ blueprintId: b.id, topic: b.topic, type: b.type, difficulty: b.difficulty, prompt: b.type === 'single-choice' ? `练习 ${sequence}-${i + 1}：求复合函数的导数时，以下哪种处理方式正确？` : `练习 ${sequence}-${i + 1}：请解释复合函数求导的步骤，并说明为什么不能遗漏内层导数。`, options: b.type === 'single-choice' ? [{ id: 'A', text: '只对外层函数求导' }, { id: 'B', text: '外层导数乘以内层导数' }, { id: 'C', text: '将内外层导数直接相加' }, { id: 'D', text: '直接忽略内层函数' }] : [], answerKey: b.type === 'single-choice' ? 'B' : null, expectedAnswer: '外层导数乘以内层导数', acceptedAnswers: [], rubric: '明确内外层并保留内层导数，说明求导过程。', explanation: '复合函数求导需保留内外两层，先求外层再乘内层。', steps: ['识别内层与外层函数。', '分别求导并相乘。'], sources: [{ sourceId: b.sourceIds[0], quote: p.sources[0].text.slice(0, 32) }] })) }); }
  throw new Error(`Unexpected model task: ${p.task}`);
};
try {
  app = createApp({ dataDir: temp, provider: { baseUrl: 'https://fixture.test/v1', apiKey: 'isolated-key', model: 'fixture' }, assessmentFetch: model });
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, body) => { const r = await fetch(`${base}/api${route}`, { method: body === undefined ? 'GET' : 'POST', headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) }); const v = await r.json(); assert.ok(r.ok, JSON.stringify(v)); return v; };
  await api('/reset', { mode: 'empty' });
  const c = await api('/courses', { name: '高等数学', target: 85, examDate: '2026-11-12' });
  const form = new FormData(); form.append('courseId', c.id); form.append('file', new Blob(['链式法则：复合函数的导数等于外层函数导数与内层函数导数的乘积。乘积法则：两函数乘积的导数要保留两个加项。连续性：函数在某点的极限与该点函数值相等。导数：函数变化率的极限。积分：连续累积的量。极限：变量变化过程中的趋近值。']), '高数复习讲义.txt'); await api('/documents', form);
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), ...['1228', '1223'].map(v => path.join(os.homedir(), 'AppData/Local/ms-playwright', `chromium-${v}`, 'chrome-win64/chrome.exe'))].filter(Boolean).find(fs.existsSync); assert.ok(executablePath);
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.route('**/api/**', async route => { const u = new URL(route.request().url()); const r = await route.fetch({ url: `${base}${u.pathname}${u.search}`, timeout: 90000 }); await route.fulfill({ response: r }); });
  const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto('http://localhost:5174/?page=practice', { waitUntil: 'domcontentloaded' });
  await page.getByRole('dialog', { name: '新手指引', exact: true }).waitFor();
  assert.ok(await page.getByText('先选课，再选练习方式', { exact: true }).isVisible());
  await page.getByRole('button', { name: '以后不再提示', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '整卷模拟', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '前往回忆复习', exact: true }).count(), 1);
  await page.getByLabel('筛选课程', { exact: true }).selectOption(c.id);
  await page.getByRole('button', { name: '理解应用', exact: true }).click();
  await page.getByRole('button', { name: '模型设置 · 已连接', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '模型设置 · 已连接', exact: true }).count(), 1);
  assert.equal(await page.locator('.pb-steps [aria-current="step"] strong').textContent(), '设置练习');
  await page.getByLabel('每组题量', { exact: true }).fill('3');
  failGeneration = true;
  await page.getByRole('button', { name: '开始练习', exact: true }).click();
  await page.getByRole('heading', { name: '这次题目没有生成成功', exact: true }).waitFor();
  assert.match(await page.locator('.pb-error-reason').textContent(), /题目数量不符/);
  await page.getByRole('button', { name: '调整练习设置', exact: true }).click();
  assert.ok(await page.locator('.pb-settings').evaluate(element => element.open));
  assert.equal((await api('/assessment')).questions.length, 0);
  failGeneration = false;
  await page.getByRole('button', { name: '开始练习', exact: true }).click();
  await page.locator('.pb-question-title').waitFor(); assert.equal(await page.locator('.pb-question-numbers button').count(), 3); assert.equal(report.reviewCalls, 0);
  assert.equal(await page.locator('.pb-steps [aria-current="step"] strong').textContent(), '完成作答');
  report.checks.push('newbie guide, unique utilities and model entry, three-step state, actionable validation failure with atomic retry');
  assert.equal(await page.getByText('参考答案', { exact: true }).count(), 0); assert.equal(await page.locator('.pb-sources').count(), 0);
  await page.getByRole('radio', { name: /外层导数乘以内层导数/ }).check();
  await page.getByRole('radio', { name: /外层导数乘以内层导数/ }).press('ArrowUp');
  assert.ok(await page.getByRole('radio', { name: /只对外层函数求导/ }).isChecked());
  await page.getByRole('radio', { name: /只对外层函数求导/ }).press('ArrowDown');
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await page.getByLabel('你的解题思路与答案').fill('先识别内外层，再求外层导数。');
  await page.getByRole('button', { name: '上一题', exact: true }).click(); assert.ok(await page.getByRole('radio', { name: /外层导数乘以内层导数/ }).isChecked());
  await page.getByRole('button', { name: '刷新资料', exact: true }).click();
  await page.getByText('资料已刷新，当前作答已保留。', { exact: true }).waitFor();
  assert.ok(await page.getByRole('radio', { name: /外层导数乘以内层导数/ }).isChecked());
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  assert.equal(await page.getByLabel('你的解题思路与答案').inputValue(), '先识别内外层，再求外层导数。');
  await page.getByRole('button', { name: '上一题', exact: true }).click();
  report.checks.push('manual material refresh preserves current answers');
  assert.ok(await page.getByRole('button', { name: '提交整组 · 3 题', exact: true }).isDisabled());
  await page.waitForFunction(() => document.querySelector('.pb-question-meta small')?.textContent === '已保存');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('筛选课程', { exact: true }).selectOption(c.id); await page.getByRole('button', { name: '理解应用', exact: true }).click();
  await page.locator('.pb-question-title').waitFor(); assert.ok(await page.getByRole('radio', { name: /外层导数乘以内层导数/ }).isChecked());
  await page.getByRole('button', { name: /^第 2 题/ }).click(); assert.equal(await page.getByLabel('你的解题思路与答案').inputValue(), '先识别内外层，再求外层导数。');
  await page.getByRole('button', { name: '下一题', exact: true }).click(); await page.getByRole('button', { name: '这题暂时不会', exact: true }).click();
  assert.equal(report.reviewCalls, 0); assert.ok(await page.getByRole('button', { name: '提交整组 · 3 题', exact: true }).isEnabled());
  report.checks.push('exact custom count; all answers retained across question changes and reload; no analysis before final submission');
  async function inspect(label) { const v = await page.evaluate(() => ({ width: innerWidth, contentWidth: document.documentElement.scrollWidth, font: getComputedStyle(document.querySelector('.practice-batch')).fontFamily, controls: [...document.querySelectorAll('.practice-batch button,.practice-batch select,.practice-batch textarea,.practice-batch input[type="number"]')].filter(e => !e.closest('.newbie-guide') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43).map(e => e.textContent || e.getAttribute('aria-label')) })); report.layouts.push({ label, ...v }); assert.ok(v.contentWidth <= v.width + 1, label); assert.deepEqual(v.controls, [], label); assert.ok(v.font.includes('Noto Sans')); }
  for (const width of [1440, 980, 768, 390, 320]) { await page.setViewportSize({ width, height: width < 500 ? 900 : 1050 }); await inspect('answering'); if (width === 1440 || width === 390) await page.screenshot({ path: path.join(output, `answering-${width}.png`), fullPage: true }); }
  failReview = true; await page.getByRole('button', { name: '提交整组 · 3 题', exact: true }).click(); await page.getByRole('button', { name: '重新生成讲评', exact: true }).waitFor();
  assert.equal((await api('/assessment')).attempts.length, 0); failReview = false;
  await page.getByRole('button', { name: '重新生成讲评', exact: true }).click(); await page.getByRole('heading', { name: '本组讲评', exact: true }).waitFor();
  assert.equal(await page.locator('.pb-steps [aria-current="step"] strong').textContent(), '查看讲评');
  assert.equal((await api('/assessment')).attempts.length, 3); assert.equal(report.reviewCalls, 2);
  report.checks.push('failed AI review preserves locked answers, retry produces one complete report and exactly three attempt records');
  for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: 1050 }); await inspect('report'); if (width === 1440 || width === 390) await page.screenshot({ path: path.join(output, `report-${width}.png`), fullPage: true }); }
  await page.locator('.pb-sources > summary').first().click(); await page.getByRole('button', { name: '查看原文', exact: true }).first().waitFor();
  await page.getByRole('button', { name: '加入回忆复习', exact: true }).first().click(); await page.getByRole('button', { name: '已加入回忆复习', exact: true }).first().waitFor();
  assert.equal((await api('/state')).cards.length, 1); assert.equal((await api('/state')).practiceSessions, undefined);
  await page.getByRole('button', { name: '原文回忆', exact: true }).click(); await page.getByRole('button', { name: '开始练习', exact: true }).click(); await page.locator('.pb-question-title').waitFor();
  assert.equal(await page.locator('.pb-question-numbers button').count(), 3); assert.equal(await page.getByText('参考答案', { exact: true }).count(), 0);
  report.checks.push('sources and memory card actions are available after submission; recall also respects batch count');
  await context.route('**/api/practice/sets**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '登录已过期' }) }));
  await page.getByRole('button', { name: '理解应用', exact: true }).click(); await page.locator('.practice-batch').waitFor({ state: 'hidden' });
  report.checks.push('native radio keyboard navigation works; expired sessions return to the authentication gate'); assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ checks: report.checks.length, layouts: report.layouts.length, output }));
} catch (error) { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report, failure: error.stack }, null, 2)); throw error; }
finally { await browser?.close(); app?.emit('shifen:close'); if (server) await new Promise(r => { server.closeAllConnections(); server.close(r); });
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith('shifen-practice-batch-'));
  fs.rmSync(temp, { recursive: true, force: true }); }
