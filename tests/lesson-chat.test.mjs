import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mountLessons } from '../server/lessons.mjs';
import { answerLessonChat, lessonFingerprint, retrieveLessonEvidence, validateLessonChatRequest } from '../server/lesson-chat.mjs';

const fixture = () => ({ id: 'lecture-a', courseId: 'course-a', title: '单侧导数', url: '', part: 1, scope: '',
  cues: [{ id: 'cue-1', start: 0, end: 10, text: '左导数和右导数分别对应差商的左右极限。' },
    { id: 'cue-2', start: 11, end: 20, text: '一点可导需要左右导数都存在且相等。' }],
  notes: { sections: [{ id: 'section-1', title: '可导条件', text: '左右导数存在且相等。', cueIds: ['cue-1', 'cue-2'] }],
    examples: [{ id: 'example-1', title: '绝对值函数', prompt: '判断y=|x|在0处的可导性。', solution: '左右导数分别为-1、1，不可导。', cueIds: ['cue-2'], frameIds: ['frame-0001'] }] },
  visual: { id: 'visual-a', frames: [{ id: 'frame-0001', time: 15 }], observations: [{ frameId: 'frame-0001', visibleText: '左导数-1，右导数1', latex: [], uncertainties: [], description: '绝对值图像' }] },
});
const request = (message = '为什么必须左右导数相等？', context = {}) => validateLessonChatRequest({ message, history: [], context });
const provider = { baseUrl: 'https://model.example/v1', model: 'fixture-model', apiKey: 'private-fixture-key' };
const encoder = new TextEncoder();
function streamResponse(chunks) {
  return new Response(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const delta = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;

test('lesson retrieval ranks the selected concept and only resolves references in the current lecture', () => {
  const lesson = fixture();
  const result = retrieveLessonEvidence(lesson, request('这道题如何判断？', { exampleId: 'example-1' }));
  assert.equal(result.evidence[0].id, 'example-1');
  assert.ok(result.evidence.some(item => item.id === 'cue-2'));
  assert.ok(result.evidence.every(item => item.lessonId === lesson.id));
  assert.throws(() => retrieveLessonEvidence(lesson, request('讲解', { sectionId: 'section-other-lecture' })), /已变化/);
  assert.throws(() => retrieveLessonEvidence(lesson, request('讲解', { frameId: 'frame-9999' })), /已变化/);
  const fingerprint = lessonFingerprint(lesson); lesson.cues[0].text += '来源已更新。';
  assert.notEqual(lessonFingerprint(lesson), fingerprint);
});

test('bounded histories do not admit system messages, oversized payloads or forged course selectors', () => {
  for (const body of [{ message: '' }, { message: '问'.repeat(2001) }, { message: '问题', history: [{ role: 'system', content: '越权指令' }] },
    { message: '问题', history: Array.from({ length: 21 }, () => ({ role: 'user', content: '问题' })) },
    { message: '问题', history: Array.from({ length: 5 }, () => ({ role: 'user', content: '问'.repeat(4000) })) },
    { message: '问题', context: { frameId: '../other' } }, { message: '问题', fingerprint: 'not-a-hash' }]) assert.throws(() => validateLessonChatRequest(body));
  const safe = validateLessonChatRequest({ message: '追问', context: { lessonId: 'foreign-lesson', sectionId: 'section-1' }, apiKey: 'forged' });
  assert.deepEqual(safe.context, { sectionId: 'section-1' }); assert.equal(safe.apiKey, undefined);
});

test('without a configured model the assistant returns honest source retrieval with real citations and no fake typing', async () => {
  const events = [];
  const result = await answerLessonChat(fixture(), request(), {}, { onEvent: (name, data) => events.push({ name, data }), fetchImpl: () => assert.fail('must not call a model') });
  assert.equal(result.mode, 'retrieval'); assert.match(result.answer, /左右导数/); assert.match(result.answer, /未调用文字模型/);
  assert.deepEqual(events.map(item => item.name), ['meta', 'done']);
  assert.ok(result.citations.length > 0); assert.ok(result.citations.every(item => item.lessonId === 'lecture-a'));
  await assert.rejects(answerLessonChat(fixture(), { ...request(), fingerprint: '0'.repeat(32) }, {}, {}), { status: 409 });
});

test('unrelated questions do not receive arbitrary opening evidence while whole-course questions use the actual scope', async () => {
  const lesson = fixture();
  const unrelated = retrieveLessonEvidence(lesson, request('明天火星天气怎样？'));
  assert.deepEqual(unrelated.evidence, []);
  const answer = await answerLessonChat(lesson, request('明天火星天气怎样？'), provider, { fetchImpl: () => assert.fail('no model call without relevant evidence') });
  assert.equal(answer.mode, 'retrieval'); assert.deepEqual(answer.citations, []); assert.match(answer.answer, /没有找到.*直接相关/);
  lesson.notes.overview = ['本课讨论单侧导数的定义与可导条件。'];
  const scope = retrieveLessonEvidence(lesson, request('总结整节课的知识点'));
  assert.equal(scope.wholeCourse, true); assert.deepEqual(scope.overview, lesson.notes.overview);
  assert.equal(scope.outline[0].id, 'section-1'); assert.ok(scope.evidence.length > 0);
  assert.equal(retrieveLessonEvidence(lesson, request('我不懂', { exampleId: 'example-1' })).evidence[0].id, 'example-1');
});

test('legacy context identifiers retrieve corrected reading content instead of uncorrected duplicate fragments', () => {
  const lesson = fixture();
  lesson.notes.sections[0].text = '旧错误讲解，不应重新送入模型。';
  lesson.notes.readingSections = [{ id: 'reading-1', title: '规范知识点', text: '规范后的条件与适用范围。', cueIds: ['cue-1'], sourceSectionIds: ['section-1'] }];
  lesson.notes.examples.push({ ...lesson.notes.examples[0], id: 'example-2', detailedSolution: '旧无条件错误解法。' });
  lesson.notes.readingExamples = [{ ...lesson.notes.examples[0], detailedSolution: '若缺失条件成立，以下仅为条件性解法。', sourceExampleIds: ['example-1', 'example-2'] }];
  const section = retrieveLessonEvidence(lesson, request('说明条件', { sectionId: 'section-1' }));
  assert.equal(section.evidence[0].id, 'reading-1'); assert.ok(!section.evidence.some(item => item.id === 'section-1'));
  assert.ok(section.evidence.every(item => !item.text.includes('旧错误')));
  const example = retrieveLessonEvidence(lesson, request('讲解这题', { exampleId: 'example-2' }));
  assert.equal(example.evidence[0].id, 'example-1'); assert.match(example.evidence[0].text, /仅为条件性解法/);
  assert.ok(!example.evidence.some(item => item.id === 'example-2')); assert.ok(example.evidence.every(item => !item.text.includes('旧无条件')));
});

test('model deltas are actual UTF-8 SSE fragments, keep current context and redact keys and unknown citations', async () => {
  const events = []; let input;
  const answer = '补充解释：'.repeat(18) + '先看左右两侧的极限。[cue-2] 不可引用别的课。[cue-9999] ' + provider.apiKey + ' 🔎';
  const wire = encoder.encode(delta(answer.slice(0, 100)) + delta(answer.slice(100)) + 'data: [DONE]\r\n\r\n');
  const chunks = []; for (let i = 0; i < wire.length; i += 7) chunks.push(wire.slice(i, i + 7));
  const result = await answerLessonChat(fixture(), request('讲透这个条件', { sectionId: 'section-1' }), provider, {
    fetchImpl: async (url, options) => { assert.equal(url.toString(), 'https://model.example/v1/chat/completions'); input = JSON.parse(options.body); return streamResponse(chunks); },
    onEvent: (name, data) => events.push({ name, data }),
  });
  assert.equal(input.stream, true); assert.match(input.messages[1].content, /section-1/); assert.doesNotMatch(JSON.stringify(input.messages), /private-fixture-key/);
  assert.equal(result.mode, 'model'); assert.ok(events.filter(item => item.name === 'delta').length >= 2);
  assert.equal(events.filter(item => item.name === 'delta').map(item => item.data.text).join(''), result.answer);
  assert.doesNotMatch(JSON.stringify(events), /private-fixture-key|\[cue-9999\]/); assert.match(result.answer, /🔎/);
  assert.deepEqual(result.citations.map(item => item.id), ['cue-2']);
});

test('stream cancellation, changed lecture and malformed model data stop without exposing provider diagnostics', async () => {
  const controller = new AbortController(); let invoked = false;
  const keeper = setTimeout(() => {}, 1000);
  try {
    const run = answerLessonChat(fixture(), request(), provider, { signal: controller.signal, fetchImpl: () => { invoked = true; return new Promise(() => {}); } });
    await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(new Error('private-fixture-key'));
    await assert.rejects(run, error => error.status === 499 && !error.message.includes(provider.apiKey)); assert.equal(invoked, true);
    await assert.rejects(answerLessonChat(fixture(), request(), provider, { isCurrent: () => false, fetchImpl: () => assert.fail() }), { status: 409 });
    await assert.rejects(answerLessonChat(fixture(), request(), provider, { fetchImpl: async () => streamResponse(['data: not-json\n\n']) }), /无效的流式/);
    await assert.rejects(answerLessonChat(fixture(), request(), provider, { fetchImpl: async () => { throw Object.assign(new Error(provider.apiKey), { status: 502 }); } }), error => !error.message.includes(provider.apiKey));
    await assert.rejects(answerLessonChat(fixture(), request(), provider, { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }), { status: 504 });
  } finally { clearTimeout(keeper); }
});

test('lesson chat HTTP uses SSE, rejects stale fingerprints and never lets context select another lecture', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-chat-test-'));
  const app = express(); app.use(express.json());
  const manager = mountLessons(app, { dataDir: directory, getState: () => ({ courses: [{ id: 'course-a' }], documents: [] }), saveState() {} });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : '内部错误' }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lessons`;
  const json = async (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const lesson = await (await json(base, 'POST', { courseId: 'course-a', title: '函数定义', transcript: '函数的定义域是输入变量的允许取值集合。' })).json();
    const context = await (await fetch(`${base}/${lesson.id}/chat/context`)).json();
    assert.equal(context.lessonId, lesson.id); assert.equal(context.modelConfigured, false); assert.match(context.fingerprint, /^[a-f0-9]{32}$/);
    const response = await json(`${base}/${lesson.id}/chat`, 'POST', { message: '解释定义域', fingerprint: context.fingerprint });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const stream = await response.text(); assert.match(stream, /event: meta/); assert.match(stream, /event: done/); assert.match(stream, /允许取值集合/);
    assert.equal((await json(`${base}/${lesson.id}/chat`, 'POST', { message: '问题', context: { sectionId: 'other-lecture' } })).status, 400);
    await json(`${base}/${lesson.id}/source`, 'PUT', { text: '更新后的来源。' });
    assert.equal((await json(`${base}/${lesson.id}/chat`, 'POST', { message: '旧问题', fingerprint: context.fingerprint })).status, 409);
  } finally {
    manager.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
