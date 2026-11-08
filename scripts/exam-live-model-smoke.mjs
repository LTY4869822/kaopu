// Explicit live-provider smoke. Only synthetic course content is transmitted.
// Existing configured credentials are read through the model service in memory;
// the production state, account and model configuration are never modified.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';
import { createModelService } from '../server/model-service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results', 'exam-live-model-smoke');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-exam-live-'));
const started = performance.now();
const types = ['single-choice', 'multiple-choice', 'true-false', 'fill-blank', 'short-answer', 'calculation'];
const tasks = ['exam-questions', 'repair-exam-questions'];
const exactSeed = process.argv.includes('--seed');
const diagnostics = [];
let app, server;
const report = { syntheticDataOnly: true, productionDataModified: false, fixture: exactSeed ? 'unchanged-default-doc-math' : 'synthetic-single-text', passed: false, status: 'starting', diagnostics };
const material = `【隔离联调合成讲义，不是本校考试资料】
极限描述自变量趋近某点时函数值的趋势。若当x趋于a时f(x)趋于L，则记作lim(x→a)f(x)=L。
函数在点a连续要求三个条件同时成立：f(a)有定义；当x趋于a时f(x)的极限存在；该极限等于f(a)。
链式法则：若y=f(g(x))，外层和内层函数在对应位置可导，则y′=f′(g(x))·g′(x)。复合函数求导时必须保留内层导数因子。
例题：y=sin(x²)，外层sin的导数为cos，内层x²的导数为2x，所以y′=2x cos(x²)。常见错误是漏乘内层导数2x。
求导训练可以先识别内层g(x)和外层f(u)，分别求导，再将f′(g(x))与g′(x)相乘。连续性检查不能只看f(a)有定义，还必须检查极限存在和等于函数值。`;

async function safeDiagnostic(response, payload) {
  const entry = { task: tasks.includes(payload.task) ? payload.task : 'other', httpStatus: response.status };
  diagnostics.push(entry);
  if (!response.body) { entry.response = 'empty'; return; }
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    while (true) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength; if (size > 512 * 1024) { entry.response = 'too-large'; return; } parts.push(Buffer.from(r.value)); }
    const raw = JSON.parse(Buffer.concat(parts).toString('utf8')), msg = raw?.choices?.[0]?.message;
    entry.finishReason = ['stop', 'length'].includes(raw?.choices?.[0]?.finish_reason) ? raw.choices[0].finish_reason : 'other';
    const content = typeof msg?.content === 'string' ? msg.content : '';
    const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1'));
    const original = payload.original || payload, questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    entry.requestedQuestions = original.slots?.length || 0; entry.returnedQuestions = questions.length;
    if (payload.task === 'repair-exam-questions') entry.repairReason = payload.validationError;
    entry.questionTypeCounts = Object.fromEntries(types.map(t => [t, questions.filter(q => q.type === t).length]));
    entry.questions = questions.map(q => ({ slotId: /^q\d{1,3}$/.test(q?.slotId) ? q.slotId : 'invalid', type: types.includes(q?.type) ? q.type : 'invalid',
      origin: ['material-based', 'ai-extension'].includes(q?.origin) ? q.origin : 'invalid', sourceCount: Array.isArray(q?.sources) ? q.sources.length : -1 }));
    entry.references = questions.flatMap(q => Array.isArray(q.sources) ? q.sources : []).map(ref => {
      const source = original.sources?.find(s => s.sourceId === ref?.sourceId), candidate = source?.citations?.find(c => c.id === ref?.citationId);
      return { hasCitationId: typeof ref?.citationId === 'string', hasQuote: typeof ref?.quote === 'string', sourceExists: !!source,
        citationBelongsToSource: !!candidate, quoteMatches: typeof ref?.quote === 'string' ? !!source?.text.includes(ref.quote) : null,
        citationAndQuoteAgree: ref?.citationId !== undefined && ref?.quote !== undefined ? candidate?.text === ref.quote : null };
    });
  } catch { entry.response = 'unreadable-json'; }
  finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
}

try {
  const modelService = createModelService({ dataDir: path.join(root, 'data') });
  assert.equal(modelService.provider.configured, true, '现有文字模型未配置，未发送任何合成内容。');
  app = createApp({ dataDir: directory, provider: modelService.provider, examFetch: async (url, init) => {
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    const response = await fetch(url, init);
    await safeDiagnostic(response.clone(), payload);
    return response;
  } });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, { method, signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  let courseId, documentId, texts;
  if (exactSeed) {
    const state = (await api('/state')).body;
    const original = state.documents.find(d => d.id === 'doc-math'); assert.ok(original);
    courseId = 'math'; documentId = original.id; texts = original.chunks.map(c => c.text);
  } else {
    assert.equal((await api('/reset', { mode: 'empty' })).status, 200);
    const createdCourse = await api('/courses', { name: '隔离联调合成高等数学', target: 80 }); assert.equal(createdCourse.status, 201);
    courseId = createdCourse.body.id; const upload = new FormData(); upload.append('courseId', courseId); upload.append('parseMode', 'basic');
    upload.append('file', new Blob([material], { type: 'text/plain' }), '隔离联调合成高数讲义.txt');
    const imported = await api('/documents', upload); assert.equal(imported.status, 201); documentId = imported.body.id; texts = [material];
  }
  const created = await api('/exams/papers', { courseId, title: '高数六题型真实模型隔离联调', durationMinutes: 25, goal: 'balanced',
    focus: exactSeed ? '函数极限、连续性、复合函数求导。计算题使用可直接核对的简单函数，并写明适用条件。' : '极限与连续三条件、链式法则和复合函数求导',
    sourcePolicy: 'materials', documentIds: [documentId], sections: types.map((type, index) => ({ type, count: 1, points: exactSeed ? index < 4 ? 5 : 10 : 2,
      difficulty: exactSeed && index === 0 ? 'easy' : 'medium', topics: exactSeed ? [] : ['极限与连续', '链式法则'] })) });
  assert.equal(created.status, 202); report.status = 'generating';
  let job; const end = Date.now() + 360000;
  while (Date.now() < end) {
    job = (await api(`/exams/jobs/${created.body.jobId}`)).body;
    if (!['queued', 'generating'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  report.status = job?.status || 'timeout'; report.completedQuestions = job?.completed || 0;
  if (job?.status !== 'completed') {
    if (['queued', 'generating'].includes(job?.status)) { await api(`/exams/jobs/${created.body.jobId}/cancel`, {}); report.status = 'timeout'; }
    report.error = typeof job?.message === 'string' ? job.message : '组卷未在限定时间内完成。';
    process.exitCode = 1;
  } else {
    const paper = (await api(`/exams/papers/${job.paperId}`)).body;
    assert.equal(paper.questions.length, 6);
    report.questionTypeCounts = Object.fromEntries(types.map(t => [t, paper.questions.filter(q => q.type === t).length]));
    assert.ok(Object.values(report.questionTypeCounts).every(n => n === 1));
    assert.ok(paper.questions.every(q => q.origin === 'material-based'));
    assert.ok(paper.questions.every(q => q.answerKey === undefined && q.expectedAnswer === undefined && q.sources === undefined));
    const startedAttempt = await api(`/exams/papers/${paper.id}/start`, { mode: 'exam' }); assert.equal(startedAttempt.status, 200);
    const graded = await api(`/exams/attempts/${startedAttempt.body.id}/submit`, { revision: 0, answers: {} }); assert.equal(graded.status, 200);
    assert.equal(graded.body.results.length, 6);
    report.referencesVerified = graded.body.results.every(r => r.sources.length >= 1 && r.sources.every(s => texts.some(text => text.includes(s.text)) && s.documentId === documentId && s.citations === undefined));
    assert.equal(report.referencesVerified, true);
    report.privateAnswersHiddenBeforeSubmission = true; report.passed = true;
  }
} catch {
  report.status = 'failed'; report.error ||= '隔离组卷或结果校验未完成，请查看安全的结构诊断。'; process.exitCode = 1;
} finally {
  report.elapsedSeconds = Number(((performance.now() - started) / 1000).toFixed(1));
  app?.emit('shifen:close');
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('shifen-exam-live-'));
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, exactSeed ? 'report-default-seed.json' : 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
