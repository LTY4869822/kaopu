import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountCourseStudio, collectStudioSources } from '../server/course-studio.mjs';

const provider = () => ({ baseUrl: 'https://model.example/v1', apiKey: 'private-test-key', model: 'text-test' });
const document = (id = 'doc-1', text = '导数是函数在一点的瞬时变化率。可导函数必连续，连续不一定可导。') => ({ id, courseId: 'math', name: `${id}.md`, type: 'MD', locationKind: 'section', status: 'ready', chunks: [{ id: `${id}-chunk`, page: 1, text }] });
const seed = () => ({ courses: [{ id: 'math', name: '高等数学' }, { id: 'physics', name: '大学物理' }], documents: [document(), { ...document('other'), courseId: 'physics' }] });
const envelope = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
function successful(input) {
  const payload = JSON.parse(JSON.parse(input.body).messages[1].content);
  if (payload.task === 'course-notes-outline') return envelope({ title: '合并复习笔记', groups: [{ title: '导数和条件', sectionIds: payload.sections.map(section => section.sectionId) }] });
  if (payload.task === 'course-chat') return envelope({ answer: '可导必连续，反过来一般不成立；请核对给定条件。', sourceIds: [payload.sources[0].id] });
  const sources = payload.sources;
  const full = payload.detailedSections ? payload.detailedSections.map(item => item.content).join('\n') : sources.map(item => item.text).join('\n');
  const compressed = full.length > 15000 ? `${full.slice(0, 7000)}\n合并重复表述\n${full.slice(-7000)}` : full;
  return envelope({ title: '导数复习笔记', sections: [{ title: '导数与连续', content: `${payload.instruction}。${compressed}\n保留条件与原课例题，疑难公式待核对。`, sourceIds: sources.map(item => item.id) }] });
}
async function setup({ initial = seed(), fetchImpl = async (_url, input) => successful(input), config = provider(), timeoutMs = 1000, jobTimeoutMs = 10000, save, onKnowledgeChange, onOutputExport } = {}) {
  let state = initial, writes = 0;
  const app = express();app.use(express.json({ limit: '64kb' }));
  const manager = mountCourseStudio(app, { getState: () => state, saveState: () => { writes++; save?.(state); }, provider: config, fetchImpl, timeoutMs, jobTimeoutMs, onKnowledgeChange, onOutputExport });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const handle = app.listen(0, '127.0.0.1', () => resolve(handle)); });
  const base = `http://127.0.0.1:${server.address().port}/api/course-studio`;
  const request = async (path = '', method = 'GET', body) => { const response = await fetch(`${base}${path}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  const start = (body = {}) => request('/jobs', 'POST', { courseId: 'math', documentIds: ['doc-1'], prompt: '详细总结笔记', action: 'notes', ...body });
  const wait = async id => {
    for (let index = 0; index < 150; index++) {
      const result = await request(`/jobs/${id}`);
      if (!['queued', 'running'].includes(result.body.status)) return result.body;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('job did not finish');
  };
  return { request, start, wait, base, manager, get state() { return state; }, get writes() { return writes; }, replaceState(next) { state = next; }, async close() { manager.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('studio saves detailed grounded notes as an artifact and reusable course document; chat and revisions persist', async () => {
  const api = await setup();
  try {
    assert.equal((await api.request('?courseId=math')).body.configured, true);
    const started = await api.start();assert.equal(started.status, 202);
    const finished = await api.wait(started.body.id);assert.equal(finished.status, 'completed');
    const workspace = (await api.request('?courseId=math')).body;assert.equal(workspace.artifacts.length, 1);assert.equal(workspace.messages.length, 2);
    const note = workspace.artifacts[0];assert.equal(note.status, 'ready');assert.equal(note.coverage.complete, true);assert.equal(note.sourceRefs[0].text, api.state.documents[0].chunks[0].text);assert.match(note.body, /来源 s1/);
    const doc = api.state.documents.find(doc => doc.id === note.documentId);assert.equal(doc.origin.kind, 'ai-notes');assert.equal(doc.courseId, 'math');assert.match(doc.structure.blocks[0].text, /可导函数必连续/);assert.equal(doc.hasOriginal, false);
    assert.ok(!JSON.stringify(api.state.courseStudio).includes('private-test-key'));
    const download = await fetch(`${api.base}/artifacts/${note.id}/export`);assert.match(download.headers.get('content-type'), /text\/markdown/);assert.match(download.headers.get('content-disposition'), /^attachment/);assert.match(await download.text(), /来源索引/);
    const chat = await api.start({ action: 'chat', prompt: '可导和连续有什么区别？' });assert.equal((await api.wait(chat.body.id)).status, 'completed');assert.equal(api.state.courseStudio.artifacts.length, 1);assert.match(api.state.courseStudio.messages.at(-1).content, /反过来/);
    const revised = await api.start({ action: 'revise', prompt: '补全条件并按例题组织', artifactId: note.id, documentIds: [] });assert.equal(revised.status, 202);assert.equal((await api.wait(revised.body.id)).status, 'completed');
    const notes = api.state.courseStudio.artifacts;assert.equal(notes.length, 2);assert.equal(notes[1].revision, 2);assert.equal(notes[1].previousId, notes[0].id);assert.ok(api.state.documents.find(doc => doc.id === notes[0].documentId));
  } finally { await api.close(); }
});

test('multi-document processing transmits all source characters and merges all section IDs without silently dropping the tail', async () => {
  const initial = seed(); initial.documents = [document('first', '甲'.repeat(14000) + 'FIRST-END'), document('second', '乙'.repeat(14000) + 'LAST-END')];
  const requests = [], api = await setup({ initial, fetchImpl: async (_url, input) => { requests.push(JSON.parse(JSON.parse(input.body).messages[1].content));return successful(input); } });
  try {
    const started = await api.start({ documentIds: ['first', 'second'] });const job = await api.wait(started.body.id);assert.equal(job.status, 'completed');
    const extracts = requests.filter(item => item.task === 'course-notes-extract');assert.ok(extracts.length > 1);assert.equal(extracts.flatMap(item => item.sources).reduce((n, source) => n + source.text.length, 0), 28017);
    assert.ok(extracts.some(item => item.sources.some(source => source.text.endsWith('LAST-END'))));
    const note = api.state.courseStudio.artifacts[0];assert.equal(note.coverage.sourceCharacters, 28017);assert.equal(note.coverage.sourceChunkCount, 2);assert.equal(note.coverage.processedChunkCount, 2);assert.match(note.body, /LAST-END/);
    assert.ok(requests.some(item => item.task === 'course-notes-outline'));assert.ok(requests.some(item => item.task === 'course-notes-merge'));
  } finally { await api.close(); }
});

test('an omitted source is reread once and combined with the original sections without dropping coverage', async () => {
  const initial = seed(); initial.documents = [document('first', '第一段正文介绍极限与连续条件。'), document('second', '目录：导数、积分与典型例题。')];
  const payloads = [], api = await setup({ initial, fetchImpl: async (_url, input) => {
    const payload = JSON.parse(JSON.parse(input.body).messages[1].content); payloads.push(payload);
    if (payload.task === 'course-notes-extract' && !payload.recovery) return envelope({ title: '完整笔记', sections: [{ title: '极限', content: '极限描述函数在自变量趋近给定点时的变化趋势。', sourceIds: [payload.sources[0].id] }] });
    return successful(input);
  } });
  try {
    const job = await api.start({ documentIds: ['first', 'second'] }); assert.equal((await api.wait(job.body.id)).status, 'completed');
    const repair = payloads.find(p => p.recovery); assert.equal(repair.sources.length, 1); assert.match(repair.sources[0].text, /目录/);
    assert.equal(api.state.courseStudio.artifacts[0].coverage.complete, true);
    assert.equal(api.state.courseStudio.artifacts[0].sourceRefs.length, 2);
  } finally { await api.close(); }
});

test('a course question uses one bounded contextual call instead of generating an entire note first', async () => {
  const initial = seed(); initial.documents = [document('first', '链式法则：外层求导乘以内层导数。'.repeat(900)), document('second', '定积分计算曲线下面积。'.repeat(900))];
  const payloads = [], api = await setup({ initial, fetchImpl: async (_url, input) => { payloads.push(JSON.parse(JSON.parse(input.body).messages[1].content)); return successful(input); } });
  try {
    const job = await api.start({ action: 'chat', documentIds: ['first', 'second'], prompt: '链式法则为什么要乘内层导数？' });
    assert.equal((await api.wait(job.body.id)).status, 'completed'); assert.equal(payloads.length, 1); assert.equal(payloads[0].task, 'course-chat');
    assert.ok(payloads[0].sourceNotes.length <= 18000); assert.ok(!JSON.stringify(payloads).includes('不可跨课'));
    assert.equal(api.state.courseStudio.artifacts.length, 0); assert.match(api.state.courseStudio.messages.at(-1).content, /可导/);
  } finally { await api.close(); }
});

test('request validation fences course, files, limits and missing model before paid calls', async () => {
  let calls = 0;const api = await setup({ fetchImpl: async (_url, input) => { calls++;return successful(input); } });
  try {
    for (const body of [{ documentIds: [] }, { documentIds: ['other'] }, { documentIds: ['doc-1', 'doc-1'] }, { prompt: '' }, { courseId: 'missing' }, { action: 'invented' }, { action: 'revise', artifactId: 'absent' }]) assert.ok((await api.start(body)).status >= 400);
    assert.equal(calls, 0);
    api.state.documents[0].chunks[0].text = 'x'.repeat(240001);assert.equal((await api.start()).status, 422);assert.equal(calls, 0);
  } finally { await api.close(); }
  const unavailable = await setup({ config: {} });try { assert.equal((await unavailable.start()).status, 503);assert.equal(unavailable.state.courseStudio.messages.length, 0); } finally { await unavailable.close(); }
});

test('every quoted source ID must be real and every input unit covered, or no artifact/document is committed', async () => {
  for (const ids of [['invented'], []]) {
    const api = await setup({ fetchImpl: async () => envelope({ title: '不合法笔记', sections: [{ title: '部分内容', content: '这是一个来源未能核实的段落。', sourceIds: ids }] }) });
    try { const result = await api.start();assert.equal((await api.wait(result.body.id)).status, 'failed');assert.equal(api.state.courseStudio.artifacts.length, 0);assert.equal(api.state.documents.length, 2);assert.equal(api.state.courseStudio.messages.length, 1); } finally { await api.close(); }
  }
});

test('one failed batch never saves a partial note or reuses a model-generated source quote', async () => {
  const initial = seed();initial.documents = [document('first', '甲'.repeat(15000)), document('second', '乙'.repeat(15000))];let calls = 0;
  const api = await setup({ initial, fetchImpl: async (_url, input) => { if (++calls === 2) return new Response('raw private-test-key', { status: 500 });return successful(input); } });
  try { const job = await api.start({ documentIds: ['first', 'second'] });const result = await api.wait(job.body.id);assert.equal(result.status, 'failed');assert.ok(!JSON.stringify(result).includes('private-test-key'));assert.equal(api.state.courseStudio.artifacts.length, 0);assert.equal(api.state.documents.length, 2); }
  finally { await api.close(); }
});

test('source changes while a model runs cannot attach stale notes, and existing artifacts are marked stale afterwards', async () => {
  let release, entered;const waitEntered = new Promise(resolve => { entered = resolve; });
  const api = await setup({ fetchImpl: async (_url, input) => { entered();return new Promise(resolve => { release = () => resolve(successful(input)); }); } });
  try { const start = await api.start();await waitEntered;api.state.documents[0].chunks[0].text = '已修改的正文';release();assert.equal((await api.wait(start.body.id)).status, 'failed');assert.equal(api.state.courseStudio.artifacts.length, 0); }
  finally { await api.close(); }
  const ready = await setup();try { const job = await ready.start();await ready.wait(job.body.id);ready.state.documents[0].chunks[0].text = '又一次修改';assert.equal((await ready.request('?courseId=math')).body.artifacts[0].status, 'stale'); }
  finally { await ready.close(); }
});

test('cancellation is immediate even for a non-cooperative fetch and a late response cannot save notes', async () => {
  let release;const api = await setup({ fetchImpl: (_url, input) => new Promise(resolve => { release = () => resolve(successful(input)); }) });
  try {
    const started = await api.start();assert.equal((await api.start()).status, 429);
    const result = await api.request(`/jobs/${started.body.id}`, 'DELETE');assert.equal(result.body.status, 'cancelled');assert.equal((await api.wait(started.body.id)).status, 'cancelled');
    release();await new Promise(resolve => setTimeout(resolve, 10));assert.equal(api.state.courseStudio.artifacts.length, 0);assert.equal(api.state.documents.length, 2);
  } finally { await api.close(); }
});

test('a reset replaces the dataset and fences every delayed write', async () => {
  let release;const api = await setup({ fetchImpl: (_url, input) => new Promise(resolve => { release = () => resolve(successful(input)); }) });
  try {
    const started = await api.start();api.replaceState(seed());release();await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await api.request(`/jobs/${started.body.id}`)).status, 404);assert.equal(api.state.courseStudio.artifacts.length, 0);assert.equal(api.state.courseStudio.messages.length, 0);
  } finally { await api.close(); }
});

test('provider configuration is snapshotted once, including a non-enumerable credential getter', async () => {
  let key = 'first-secret', model = 'first-model';const config = Object.defineProperties({}, { baseUrl: { get: () => 'https://model.example/v1' }, model: { get: () => model }, apiKey: { get: () => key } });
  const initial = seed();initial.documents = [document('first', '甲'.repeat(12000)), document('second', '乙'.repeat(12000))];const seen = [];
  const api = await setup({ config, initial, fetchImpl: async (_url, input) => { seen.push({ auth: input.headers.Authorization, model: JSON.parse(input.body).model });key = 'second-secret';model = 'second-model';return successful(input); } });
  try { const job = await api.start({ documentIds: ['first', 'second'] });assert.equal((await api.wait(job.body.id)).status, 'completed');assert.ok(seen.length > 1);assert.ok(seen.every(item => item.auth === 'Bearer first-secret' && item.model === 'first-model'));assert.ok(!JSON.stringify(api.state.courseStudio).includes('first-secret')); }
  finally { await api.close(); }
});

test('bounded timeout, output length, refused output and credential echoes are explicit failures without raw diagnostics', async () => {
  const responses = [
    () => new Promise(() => {}),
    () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })),
    () => new Response(JSON.stringify({ choices: [{ message: { refusal: 'private-test-key', content: '{}' } }] })),
    () => envelope({ title: 'private-test-key', sections: [] }),
    () => new Response('x'.repeat(524289), { headers: { 'Content-Length': '524289' } }),
  ];
  for (const fetchImpl of responses) {
    const api = await setup({ fetchImpl, timeoutMs: 20 });
    try { const job = await api.start();const result = await api.wait(job.body.id);assert.equal(result.status, 'failed');assert.ok(!JSON.stringify(result).includes('private-test-key'));assert.equal(api.state.courseStudio.artifacts.length, 0); }
    finally { await api.close(); }
  }
});

test('server restart marks pending jobs interrupted and keeps user input; close and course deletion prevent late commits', async () => {
  const initial = seed();initial.courseStudio = { version: 1, messages: [{ id: 'message', courseId: 'math', role: 'user', content: '保留这个指令' }], artifacts: [], jobs: [{ id: 'interrupted', courseId: 'math', status: 'running', documentIds: ['doc-1'] }] };
  const api = await setup({ initial });
  try { const stored = (await api.request('?courseId=math')).body;assert.equal(stored.jobs[0].status, 'failed');assert.equal(stored.jobs[0].phase, 'interrupted');assert.equal(stored.messages[0].content, '保留这个指令');assert.equal(api.writes, 1); }
  finally { await api.close(); }
  let release;const removed = await setup({ fetchImpl: (_url, input) => new Promise(resolve => { release = () => resolve(successful(input)); }) });
  try { await removed.start();removed.manager.removeCourse('math');release();await new Promise(resolve => setTimeout(resolve, 10));assert.equal(removed.state.courseStudio.jobs.length, 0);assert.equal(removed.state.courseStudio.artifacts.length, 0); }
  finally { await removed.close(); }
});

test('source collector preserves parser chunk locations and rejects malformed or excessive text instead of skipping it', () => {
  const doc = document();doc.chunks.push({ id: 'second', page: 2, text: '来源的后半部分不能被省略。' });const result = collectStudioSources([doc]);assert.equal(result.sources.length, 2);assert.equal(result.sources[1].page, 2);assert.equal(result.sources[1].chunkId, 'second');
  assert.throws(() => collectStudioSources([{ ...doc, chunks: [] }]), /没有可读取/);
  assert.throws(() => collectStudioSources([{ ...doc, chunks: [{ id: 'broken', page: 0, text: '无页码' }] }]), /片段无效/);
});

test('revision reads every old-note chunk to locate old sections and does not accumulate every ancestor as new evidence', async () => {
  const requests = [], api = await setup({ fetchImpl: async (_url, input) => { requests.push(JSON.parse(JSON.parse(input.body).messages[1].content));return successful(input); } });
  try {
    const first = await api.start();await api.wait(first.body.id);const original = api.state.courseStudio.artifacts[0];
    const oldDoc = api.state.documents.find(doc => doc.id === original.documentId);const secondText = '这一段仅在学生看到的旧稿第二节出现，用于检验修订定位。';oldDoc.chunks.push({ id: 'old-note-section-2', page: 2, text: secondText });
    const revised = await api.start({ action: 'revise', artifactId: original.id, documentIds: [], prompt: '把第二节重新解释' });assert.equal((await api.wait(revised.body.id)).status, 'completed');
    const contexts = requests.flatMap(item => item.sources || []).filter(item => item.contextRole === 'previous-note');assert.ok(contexts.some(item => item.page === 2 && item.text === secondText));assert.ok(contexts.every(item => item.documentId === original.documentId));
    const latest = api.state.courseStudio.artifacts[1];assert.deepEqual(latest.sourceDocumentIds, ['doc-1']);assert.equal(latest.coverage.contextDocumentCount, 1);
    const third = await api.start({ action: 'revise', artifactId: latest.id, documentIds: [], prompt: '补充第三版说明' });assert.equal((await api.wait(third.body.id)).status, 'completed');assert.deepEqual(api.state.courseStudio.artifacts[2].sourceDocumentIds, ['doc-1']);
  } finally { await api.close(); }
});

test('redirected responses, including misleading successful status codes, never create a note', async () => {
  for (const fetchImpl of [async () => new Response('', { status: 302 }), async (_url, input) => { const response = successful(input);Object.defineProperty(response, 'redirected', { value: true });return response; }]) {
    const api = await setup({ fetchImpl });try { const job = await api.start();const outcome = await api.wait(job.body.id);assert.equal(outcome.status, 'failed');assert.match(outcome.error, /重定向/);assert.equal(api.state.courseStudio.artifacts.length, 0); }
    finally { await api.close(); }
  }
});

test('failed final persistence rolls back document, artifact and assistant message together', async () => {
  const api = await setup({ save(state) { if (state.courseStudio.artifacts.length) throw new Error('disk failure private diagnostics'); } });
  try { const job = await api.start();const outcome = await api.wait(job.body.id);assert.equal(outcome.status, 'failed');assert.equal(api.state.documents.length, 2);assert.equal(api.state.courseStudio.artifacts.length, 0);assert.equal(api.state.courseStudio.messages.length, 1);assert.ok(!JSON.stringify(outcome).includes('private diagnostics')); }
  finally { await api.close(); }
});

test('review and exam checklist outputs keep their kind, citations, revisions and trigger the Wiki mirror', async () => {
  const tasks = [], exports = []; let mirrors = 0;
  const api = await setup({ onKnowledgeChange: () => { mirrors++; }, onOutputExport: input => { exports.push(input); }, fetchImpl: async (_url, input) => {
    const payload = JSON.parse(JSON.parse(input.body).messages[1].content); tasks.push(payload.task);
    if (payload.task.includes('exam-checklist')) return envelope({ title: '导数考点清单', sections: [{ title: '可导与连续', content: '- [ ] 说出可导与连续的关系及适用条件。\n- [ ] 核对原课例题中的结论。', sourceIds: payload.sources.map(item => item.id) }] });
    return successful(input);
  } });
  try {
    const review = await api.start({ action: 'review', prompt: '生成可执行的复习资料' });
    assert.equal((await api.wait(review.body.id)).status, 'completed');
    assert.equal(api.state.courseStudio.artifacts[0].kind, 'review');
    assert.deepEqual(api.state.courseStudio.artifacts[0].sourceNoteIds, ['doc-1']);
    assert.equal(api.state.documents.at(-1).origin.outputKind, 'review');
    const checklist = await api.start({ action: 'exam-checklist', prompt: '生成可勾选的考点清单' });
    assert.equal((await api.wait(checklist.body.id)).status, 'completed');
    const output = api.state.courseStudio.artifacts[1];
    assert.equal(output.kind, 'exam-checklist'); assert.match(output.body, /- \[ \]/); assert.match(output.body, /来源 s1/);
    const download = await fetch(`${api.base}/artifacts/${output.id}/export?format=docx`);
    assert.equal(download.status, 200); assert.match(download.headers.get('content-type'), /wordprocessingml/);
    const bytes = Buffer.from(await download.arrayBuffer()); assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    assert.equal(exports.length, 1); assert.equal(exports[0].artifact, output); assert.equal(exports[0].format, 'docx'); assert.deepEqual(exports[0].bytes, bytes);
    const revised = await api.start({ action: 'revise', prompt: '保留清单格式并补充条件', artifactId: output.id, documentIds: [] });
    assert.equal((await api.wait(revised.body.id)).status, 'completed');
    assert.equal(api.state.courseStudio.artifacts[2].kind, 'exam-checklist');
    assert.equal(api.state.courseStudio.artifacts[2].revision, 2);
    assert.equal(mirrors, 3); assert.ok(tasks.some(task => task === 'course-review-extract')); assert.ok(tasks.some(task => task === 'course-exam-checklist-extract'));
  } finally { await api.close(); }
});
