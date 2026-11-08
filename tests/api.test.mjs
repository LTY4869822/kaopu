import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import JSZip from 'jszip';
import { createApp } from '../server/index.mjs';
import { parseDocument } from '../server/parsers.mjs';

async function start(dataDir, provider = {}) {
  const app = createApp({ dataDir, provider });
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, method = 'GET', data, headers = {}) => {
    const response = await fetch(`${base}/api${route}`, { method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  };
  const close = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return { api, base, close };
}

test('API persists the study workflow, rejects invalid writes, and preserves counted feedback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-api-test-'));
  let running;
  try {
    running = await start(dir);
    const { api, base } = running;
    let result = await api('/state');
    assert.equal(result.status, 200);
    assert.equal(result.body.courses.length, 4);
    assert.ok(result.body.questions.length >= 8);
    assert.ok(result.body.documents.every((item) => item.isDemo));
    const initial = result.body;
    assert.equal((await api('/courses', 'POST', { name: '错日期', examDate: '2026-02-30', target: 80 })).status, 400);
    assert.equal((await api('/courses', 'POST', { name: '越界目标', examDate: '2027-01-01', target: 101 })).status, 400);
    assert.equal((await api('/settings', 'PATCH', { dailyMinutes: 0 })).status, 400);
    assert.equal((await api('/settings', 'PATCH', { dailyMinutes: 90 }, { Origin: 'https://malicious.example' })).status, 403);
    const course = (await api('/courses', 'POST', { name: '测试课程', examDate: '2027-01-10', target: 85 })).body;
    assert.ok(course.id);
    const form = new FormData();
    form.append('courseId', course.id);
    form.append('file', new Blob(['链式法则：外层导数乘以内层导数。\n\n复合函数求导需要识别内层与外层。'], { type: 'text/plain' }), '复习笔记.txt');
    const uploaded = await fetch(`${base}/api/documents`, { method: 'POST', body: form });
    assert.equal(uploaded.status, 201);
    const document = await uploaded.json();
    assert.equal(document.name, '复习笔记.txt');
    assert.equal(document.locationKind, 'section');
    assert.equal(document.chunks.length, 2);
    assert.ok(document.summary.length);
    assert.ok(document.summary.every((item) => /第 \d+ 段/.test(item) && !/第 \d+ 页/.test(item)));
    const generated = await api('/questions/generate', 'POST', { courseId: course.id });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.mode, 'source-cloze');
    assert.ok(generated.body.questions.length);
    const generatedQuestion = generated.body.questions[0];
    const repeated = await api('/questions/generate', 'POST', { courseId: course.id });
    assert.deepEqual(repeated.body.questions.map((q) => q.id), generated.body.questions.map((q) => q.id));
    assert.equal((await api('/state')).body.questions.filter((q) => q.courseId === course.id).length, generated.body.questions.length);
    assert.equal((await api('/attempts', 'POST', { questionId: generatedQuestion.id, selected: generatedQuestion.answer })).body.correct, true);
    const answer = await api('/ask', 'POST', { courseId: course.id, question: '链式法则如何求导' });
    assert.equal(answer.body.mode, 'retrieval');
    assert.ok(answer.body.sources.some((item) => item.documentName === '复习笔记.txt'));
    const unrelated = await api('/ask', 'POST', { courseId: course.id, question: 'Quantum chromodynamics' });
    assert.equal(unrelated.body.sources.length, 0);
    const malformed = new FormData();
    malformed.append('courseId', course.id);
    malformed.append('file', new Blob(['legacy']), 'old.doc');
    const rejected = await fetch(`${base}/api/documents`, { method: 'POST', body: malformed });
    assert.equal(rejected.status, 422);
    assert.match((await rejected.json()).error, /DOCX/);
    const plan = (await api('/plan')).body;
    assert.ok(plan.tasks.length);
    assert.ok(plan.allocated <= plan.budget);
    const task = plan.tasks[0];
    assert.equal((await api(`/tasks/${encodeURIComponent(task.id)}/complete`, 'POST', { completed: true })).status, 200);
    assert.ok((await api('/state')).body.completedTasks.includes(task.id));
    assert.equal((await api('/tasks/made-up/complete', 'POST', { completed: true })).status, 404);
    const question = initial.questions[0];
    const first = await api('/attempts', 'POST', { questionId: question.id, selected: question.answer });
    const second = await api('/attempts', 'POST', { questionId: question.id, selected: question.answer });
    assert.equal(first.body.correct, true);
    assert.equal(first.body.counted, true);
    assert.equal(second.body.counted, false);
    assert.equal(first.body.mastery, second.body.mastery);
    assert.equal((await api('/attempts', 'POST', { questionId: question.id, selected: -1 })).status, 400);
    const card = (await api('/cards', 'POST', { courseId: course.id, front: '定义？', back: '答案。', source: document.name })).body;
    const review = await api(`/cards/${card.id}/review`, 'POST', { rating: 3 });
    assert.equal(review.status, 200);
    assert.ok(review.body.fsrs);
    assert.ok(Date.parse(review.body.due) > Date.now());
    assert.equal((await api('/focus', 'POST', { minutes: 25 })).body.focusMinutes, 25);
    const settings = await api('/settings', 'PATCH', { dailyMinutes: 90, goal: 'pass', name: '测试同学' });
    assert.equal(settings.status, 200);
    assert.equal((await api('/plan')).body.budget, 90);
    await running.close();
    running = await start(dir);
    const persisted = (await running.api('/state')).body;
    assert.equal(persisted.settings.name, '测试同学');
    assert.equal(persisted.focusMinutes, 25);
    assert.ok(persisted.documents.some((item) => item.id === document.id));
    assert.equal((await running.api(`/documents/${document.id}`, 'DELETE')).status, 200);
    const afterDocumentDeletion = (await running.api('/state')).body;
    assert.ok(!afterDocumentDeletion.documents.some((item) => item.id === document.id));
    assert.ok(!afterDocumentDeletion.questions.some((item) => item.sourceDocumentId === document.id));
    const removedQuestionIds = new Set(generated.body.questions.map((item) => item.id));
    assert.ok(!afterDocumentDeletion.attempts.some((item) => removedQuestionIds.has(item.questionId)));
    assert.ok(afterDocumentDeletion.questions.some((item) => item.id === question.id));
    assert.ok(afterDocumentDeletion.attempts.some((item) => item.questionId === question.id));
    assert.equal(afterDocumentDeletion.cards.find((item) => item.id === card.id)?.source, document.name);
    assert.equal((await running.api(`/courses/${course.id}`, 'DELETE')).status, 200);
    const removed = (await running.api('/state')).body;
    assert.ok(!removed.documents.some((item) => item.courseId === course.id));
    assert.ok(!removed.cards.some((item) => item.courseId === course.id));
    assert.equal((await running.api('/reset', 'POST', { mode: 'empty' })).body.courses.length, 0);
    assert.ok(fs.existsSync(path.join(dir, 'before-reset.json')));
    assert.equal((await running.api('/reset', 'POST', { mode: 'demo' })).body.courses.length, 4);
  } finally {
    if (running) await running.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Office parsers extract DOCX paragraphs and PPTX slide text with source locations', async () => {
  const docx = new JSZip();
  docx.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  docx.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>链式法则是复合函数的求导方法。</w:t></w:r></w:p><w:p><w:r><w:t>第二段内容。</w:t></w:r></w:p></w:body></w:document>');
  const parsedDocx = await parseDocument({ originalname: 'notes.docx', buffer: await docx.generateAsync({ type: 'nodebuffer' }) });
  assert.equal(parsedDocx.type, 'DOCX');
  assert.equal(parsedDocx.locationKind, 'section');
  assert.match(parsedDocx.chunks[0].text, /链式法则/);
  assert.equal(parsedDocx.chunks[1].page, 2);
  const pptx = new JSZip();
  pptx.file('ppt/presentation.xml', '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId2"/><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>');
  pptx.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>');
  pptx.file('ppt/slides/slide2.xml', '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>第二页复习内容</a:t></a:r></a:p></p:sld>');
  pptx.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>第一页复习内容</a:t></a:r></a:p></p:sld>');
  const parsedPptx = await parseDocument({ originalname: 'lecture.pptx', buffer: await pptx.generateAsync({ type: 'nodebuffer' }) });
  assert.equal(parsedPptx.type, 'PPTX');
  assert.equal(parsedPptx.chunks[0].page, 1);
  // Actual presentation order can differ from the embedded slide file numbers.
  assert.match(parsedPptx.chunks[0].text, /第二页/);
  assert.equal(parsedPptx.chunks[1].page, 2);
});

function makePdf(text) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

test('PDF parser retains real page number and rejects an image-only/empty PDF', async () => {
  const parsed = await parseDocument({ originalname: 'text.pdf', buffer: makePdf('Calculus chain rule revision notes') });
  assert.equal(parsed.type, 'PDF');
  assert.equal(parsed.chunks[0].page, 1);
  assert.match(parsed.chunks[0].text, /chain rule/);
  await assert.rejects(parseDocument({ originalname: 'scan.pdf', buffer: makePdf('') }), /OCR/);
  await assert.rejects(parseDocument({ originalname: 'fake.pdf', buffer: Buffer.from('hello') }), /有效 PDF/);
});

test('optional model adapter grounds requests in excerpts and falls back without leaking secrets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-model-test-'));
  let fail = false;
  let received;
  const providerServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    received = { body: JSON.parse(body), authorization: req.headers.authorization, url: req.url };
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = fail ? 500 : 200;
    res.end(JSON.stringify(fail ? { error: 'private-provider-error-test-secret' } : { choices: [{ message: { content: '链式法则需要把内层导数乘上外层导数。[1]' } }] }));
  });
  await new Promise((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
  let running;
  try {
    running = await start(dir, { baseUrl: `http://127.0.0.1:${providerServer.address().port}/v1`, apiKey: 'test-secret', model: 'test-model' });
    const answer = await running.api('/ask', 'POST', { courseId: 'math', question: '复合函数链式求导' });
    assert.equal(answer.body.mode, 'ai');
    assert.ok(answer.body.sources.length);
    assert.equal(received.url, '/v1/chat/completions');
    assert.equal(received.authorization, 'Bearer test-secret');
    assert.equal(received.body.model, 'test-model');
    assert.match(received.body.messages[0].content, /非可信/);
    assert.ok(JSON.parse(received.body.messages[1].content).untrustedSourceExcerpts.length);
    fail = true;
    const fallback = await running.api('/ask', 'POST', { courseId: 'math', question: '复合函数链式求导' });
    assert.equal(fallback.body.mode, 'retrieval');
    assert.match(fallback.body.answer, /暂时不可用/);
    assert.doesNotMatch(JSON.stringify(fallback.body), /test-secret|private-provider/);
    assert.doesNotMatch(JSON.stringify((await running.api('/state')).body), /test-secret/);
    assert.doesNotMatch(JSON.stringify((await running.api('/export')).body), /test-secret/);
  } finally {
    if (running) await running.close();
    await new Promise((resolve) => providerServer.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
