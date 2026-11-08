import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

const text = '链式法则：复合函数的导数等于外层导数与内层导数的乘积。使用前需要确认内外层函数在相应位置可导。';
const complete = data => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] }), { headers: { 'Content-Type': 'application/json' } });
function model(_url, init) {
  const input = JSON.parse(JSON.parse(init.body).messages[1].content);
  if (input.task === 'blueprint') return complete({ blueprint: [{ id: 'p1', type: 'single-choice', topic: '链式法则', difficulty: 'medium', sourceIds: [input.sources[0].sourceId] }] });
  if (input.task === 'questions') {
    const plan = input.blueprint[0], source = input.sources.find(item => item.sourceId === plan.sourceIds[0]);
    return complete({ questions: [{ blueprintId: plan.id, type: plan.type, topic: plan.topic, difficulty: plan.difficulty,
      prompt: '根据讲义，复合函数的导数应如何计算？', options: [{ id: 'A', text: '外层导数与内层导数相乘' }, { id: 'B', text: '只求外层导数' }, { id: 'C', text: '内外层导数相加' }, { id: 'D', text: '将内层函数视为常数' }],
      answerKey: 'A', expectedAnswer: '外层导数与内层导数相乘', acceptedAnswers: [], rubric: 'private rubric marker: 同时包含内层和外层导数。',
      explanation: '讲义中明确说明两层导数相乘，并指出可导前提。', steps: ['确认复合关系。', '分别求导后相乘。'], sources: [{ sourceId: source.sourceId, quote: source.text.slice(0, 40) }],
    }] });
  }
  throw new Error(`Unexpected mock request: ${input.task}`);
}

async function fixture(t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-study-integration-'));
  const app = createApp({ dataDir: directory, provider: { baseUrl: 'http://127.0.0.1:9876/v1', model: 'fixture', apiKey: 'test-only-key' }, assessmentFetch: model, ...extra });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, method = body === undefined ? 'GET' : 'POST', cookie) => {
    const response = await fetch(`${base}/api${route}`, { method, headers: { Connection: 'close', ...(body instanceof FormData || body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
    const contentType = response.headers.get('content-type') || '';
    return { status: response.status, body: contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()), cookie: response.headers.get('set-cookie'), headers: response.headers };
  };
  t.after(async () => {
    app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('shifen-study-integration-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { request, directory };
}

test('document parser, original source, private question contract, grading and source deletion work together', async t => {
  const modes = [];
  // Contract-level injected parser; real Docling conversions are tested separately.
  const documentParser = { status: async () => ({ available: true, ocrReady: true }), parse: async (_file, options) => {
    modes.push(options.mode);
    return { type: 'PDF', locationKind: 'page', chunks: [{ id: `source-${modes.length}`, page: 2, text, blockId: 'block-1', bbox: { l: 20, t: 30, r: 500, b: 80, coordOrigin: 'TOPLEFT' } }], parser: { engine: 'docling', ocr: true, formula: false }, structure: { blocks: [{ id: 'block-1', text, label: 'text', page: 2 }] } };
  } };
  const { request, directory } = await fixture(t, { documentParser });
  assert.equal((await request('/reset', { mode: 'empty' })).status, 200);
  const bytes = Buffer.from('%PDF-1.4\nparser-contract-fixture');
  const upload = () => { const body = new FormData(); body.append('file', new Blob([bytes]), '高等数学复习.pdf'); body.append('parseMode', 'structured'); return request('/documents/auto', body); };
  const imported = await upload();
  assert.equal(imported.status, 201); assert.equal(imported.body.document.parser.engine, 'docling'); assert.equal(imported.body.document.hasOriginal, true);
  assert.deepEqual(modes, ['structured']);
  const document = imported.body.document, courseId = imported.body.course.id;
  const original = await request(`/documents/${document.id}/original`);
  assert.equal(original.status, 200); assert.deepEqual(original.body, bytes); assert.match(original.headers.get('content-type'), /application\/pdf/);
  const generated = await request('/assessment/generate', { courseId, count: 1, types: ['single-choice'] });
  assert.equal(generated.status, 200); const question = generated.body.questions[0];
  assert.equal(question.sources[0].documentId, document.id); assert.equal(question.sources[0].page, 2);
  assert.equal(question.sources[0].bbox.l, 20); assert.ok(!('answerKey' in question));
  const visible = await request('/state');
  assert.equal(visible.body.assessments, undefined); assert.ok(!JSON.stringify(visible.body).includes('private rubric marker'));
  const mastery = visible.body.courses.find(course => course.id === courseId).mastery;
  const result = await request('/assessment/attempts', { questionId: question.id, answer: 'A' });
  assert.equal(result.status, 200); assert.equal(result.body.status, 'correct'); assert.equal(result.body.counted, true);
  assert.ok((await request('/state')).body.courses.find(course => course.id === courseId).mastery > mastery);
  assert.equal((await request('/assessment/attempts', { questionId: question.id, answer: 'A' })).body.counted, false);
  const exported = await request('/export');
  assert.equal(exported.body.assessments.questions[0].answerKey, 'A'); assert.ok(!JSON.stringify(exported.body).includes('test-only-key'));
  const reparsed = await upload();
  assert.equal(reparsed.body.document.id, document.id); assert.equal(reparsed.body.reparsed, true);
  assert.equal((await request(`/assessment?courseId=${courseId}`)).body.questions.length, 0);
  const next = (await request('/assessment/generate', { courseId, count: 1, types: ['single-choice'] })).body.questions[0];
  assert.ok(next);
  assert.equal((await request(`/documents/${document.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await request(`/documents/${document.id}/original`)).status, 404);
  assert.equal((await request(`/assessment?courseId=${courseId}`)).body.questions.length, 0);
  assert.equal(fs.readdirSync(path.join(directory, 'documents')).length, 0);
});

test('original files and parser/assessment APIs remain behind the owner session', async t => {
  const { request } = await fixture(t, { authEnabled: true });
  for (const route of ['/document-parser', '/assessment', '/documents/nonexistent/original']) assert.equal((await request(route)).status, 401);
  const registered = await request('/auth/register', { email: 'fixture@example.test', name: '测试', password: 'isolated-password-42' });
  assert.equal(registered.status, 201);
  const cookie = registered.cookie.split(';')[0];
  assert.equal((await request('/document-parser', undefined, 'GET', cookie)).status, 200);
  assert.equal((await request('/assessment', undefined, 'GET', cookie)).status, 200);
});

test('legacy recall with source assistance does not increase mastery', async t => {
  const { request } = await fixture(t);
  const state = (await request('/state')).body, question = state.questions[0];
  const before = state.courses.find(course => course.id === question.courseId).mastery;
  const helped = await request('/attempts', { questionId: question.id, selected: question.answer, helpUsed: true });
  assert.equal(helped.status, 200); assert.equal(helped.body.counted, false);
  assert.equal((await request('/state')).body.courses.find(course => course.id === question.courseId).mastery, before);
  assert.equal((await request('/attempts', { questionId: question.id, selected: question.answer })).body.counted, false);
});
