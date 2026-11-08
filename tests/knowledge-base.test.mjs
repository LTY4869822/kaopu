import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { mountKnowledgeBase } from '../server/knowledge-base.mjs';
import { createBackupArchive } from '../server/backup.mjs';
import { createRawStore } from '../server/raw-store.mjs';

const lesson = {
  id: 'lesson-1', courseId: 'course-1', title: '函数与极限', url: 'https://www.bilibili.com/video/BV1xx411c7mD',
  part: 1, scope: '', createdAt: '2026-11-01', updatedAt: '2026-11-02', status: 'completed',
  sourceName: '字幕', sourceFormat: 'txt',
  cues: [
    { id: 'cue-1', start: 5, end: 12, text: '先看函数极限的定义。' },
    { id: 'cue-2', start: 65, end: 80, text: '注意 <script>alert(1)</script> 只是原文里的普通文字。' },
  ],
  visual: {
    id: 'evidence-1', lessonId: 'lesson-1', status: 'completed',
    frames: [{ id: 'frame-0001', time: 12, imageUrl: '/api/lessons/lesson-1/visual/evidence-1/frame-0001', width: 320, height: 180 }],
    observations: [], warnings: [],
    coverage: { durationSeconds: 120, sampledFrameCount: 1, recognizedFrameCount: 1, maxGapSeconds: 60, complete: false },
  },
  notes: {
    mode: 'ai', overview: ['本节从极限定义出发，建立连续与间断的判断方法。'], createdAt: '2026-11-02',
    warnings: ['例题二的原话需要核对。'], coverage: { cueCount: 2, processedCueCount: 2, visual: true },
    sections: [{
      id: 'section-1', title: '函数极限的定义', text: '当 x 无限接近 a 时，f(x) 无限接近 L。', cueIds: ['cue-1', 'cue-2'],
      frameIds: ['frame-0001'], inScope: null, steps: ['先找自变量趋近点', '再判断函数值趋势'], pitfalls: ['不要忽略定义域'],
    }],
    examples: [{ id: 'example-1', title: '求极限', prompt: '求 lim(x→0) sin x / x。', solution: '结果为 1。', cueIds: ['cue-1'], needsReview: true }],
  },
};

function writeFixture(directory) {
  const state = {
    courses: [{ id: 'course-1', name: '高等数学' }],
    documents: [{
      id: 'doc-1', courseId: 'course-1', name: '第一章讲义', type: 'PDF', size: 2048, createdAt: '2026-10-30', status: 'ready',
      summary: ['极限的直观定义与基本性质。'],
      chunks: [{ id: 'chunk-1', page: 1, text: '函数极限的严格定义来自 ε-δ 语言。' }],
    }],
    cards: [], questions: [], attempts: [], completedTasks: [],
  };
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(directory, 'lessons.json'), JSON.stringify({ version: 1, lessons: [lesson] }));
  const frameDir = path.join(directory, 'lesson-visual', lesson.id, lesson.visual.id);
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, 'frame-0001.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]));
  return state;
}

async function startServer(directory, state, options = {}) {
  const app = express(); app.use(express.json());
  const manager = mountKnowledgeBase(app, { dataDir: directory, getState: () => state, ...options });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  return { server, base: `http://127.0.0.1:${server.address().port}/api/knowledge`, manager };
}

test('knowledge base mirrors courses, lessons and documents into a linked Markdown vault', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-knowledge-'));
  const state = writeFixture(directory);
  const { server, base } = await startServer(directory, state);
  try {
    const tree = await (await fetch(`${base}/tree`)).json();
    assert.equal(tree.courses.length, 1);
    assert.equal(tree.courses[0].dir, '高等数学');
    const files = tree.courses[0].files.map((file) => file.path);
    assert.ok(files.every((file) => file.startsWith('高等数学/')), 'every mirrored file stays inside the course folder');
    const wikiLesson = files.find((file) => file.startsWith('高等数学/wiki/') && file.includes('第01讲') && !file.includes('原文'));
    const rawLesson = files.find((file) => file.startsWith('高等数学/raw/') && file.includes('原文') && file.includes('第01讲'));
    const index = files.find((file) => file.endsWith('00-索引.md'));
    const concept = files.find((file) => file.includes('考点-函数极限的定义'));
    const resource = files.find((file) => file.startsWith('高等数学/resources/') && file.endsWith('frame-0001.jpg'));
    assert.ok(wikiLesson && rawLesson && index && concept && resource, JSON.stringify(files));
    assert.deepEqual(tree.counts.images, 1);

    const raw = await (await fetch(`${base}/file?path=${encodeURIComponent(rawLesson)}`)).json();
    assert.match(raw.content, /先看函数极限的定义/);
    assert.match(raw.content, /\[\[高等数学 · 第01讲/, 'raw notes link back to the structured wiki note');
    assert.doesNotMatch(raw.html, /<script>/, 'raw HTML from study material is escaped');
    assert.match(raw.html, /&lt;script&gt;/, 'escaped HTML stays visible as text');

    const wiki = await (await fetch(`${base}/file?path=${encodeURIComponent(wikiLesson)}`)).json();
    const rawTarget = rawLesson.replace(/^高等数学\/raw\//, '').replace(/\.md$/, '');
    assert.match(wiki.content, new RegExp(`\\[\\[${rawTarget}\\]\\]`), 'wiki note links to its raw source');
    assert.match(wiki.content, /\[\[高等数学 · 00-索引\]\]/);
    assert.match(wiki.content, /\[\[高等数学 · 考点-函数极限的定义\]\]/, 'section titles become reusable concept notes');
    assert.match(wiki.html, /\/api\/knowledge\/asset\?path=/, 'relative frame images are rewritten for the preview');
    assert.doesNotMatch(wiki.html, /%25/, 'frame image paths are encoded exactly once');
    assert.match(wiki.html, /class="kb-wikilink"[^>]*data-kb-path="[^"]+\.md"/, 'wiki links become clickable preview links');
    assert.doesNotMatch(wiki.html, /本文件由「考谱」知识库镜像自动生成/, 'the generated-file marker is hidden from the preview');

    const conceptFile = await (await fetch(`${base}/file?path=${encodeURIComponent(concept)}`)).json();
    assert.match(conceptFile.content, new RegExp(`\\[\\[${wikiLesson.replace(/^高等数学\/wiki\//, '').replace(/\.md$/, '')}\\]\\]`), 'concept notes link back to the lesson that produced them');

    const asset = await fetch(`${base}/asset?path=${encodeURIComponent(resource)}`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/jpeg');

    const again = await (await fetch(`${base}/tree?refresh=1`)).json();
    assert.deepEqual(again.courses[0].files.map((file) => file.path).sort(), files.slice().sort(), 'refreshing is idempotent');

    const backup = await createBackupArchive({ dataDir: directory });
    assert.ok(backup.fileCount > 0, 'generated knowledge folder never blocks a full backup');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('courses with no usable lessons or documents stay out of the vault', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-knowledge-empty-'));
  const state = writeFixture(directory);
  state.courses.push({ id: 'course-2', name: '数据结构' });
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'lessons.json'), 'utf8'));
  stored.lessons.push({
    id: 'lesson-2', courseId: 'course-2', title: '数据结构 · 第 1 讲', part: 1, status: 'failed',
    cues: [], visual: { id: 'evidence-2', frames: [] },
    notes: { overview: [], sections: [], examples: [], warnings: [] },
  });
  fs.writeFileSync(path.join(directory, 'lessons.json'), JSON.stringify(stored));
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  const { server, base } = await startServer(directory, state);
  try {
    const tree = await (await fetch(`${base}/tree`)).json();
    assert.deepEqual(tree.courses.map((course) => course.id), ['course-1'], 'empty courses are not listed');
    assert.equal(tree.counts.courses, 1);
    assert.equal(tree.counts.lessons, 1, 'failed lessons without content are not mirrored');
    assert.equal(tree.counts.documents, 1);
    const all = tree.courses.flatMap((course) => course.files.map((file) => file.path));
    assert.ok(all.every((file) => !file.includes('数据结构')), 'no empty lesson shows up in the tree');
    assert.equal(fs.existsSync(path.join(directory, 'knowledge', '数据结构')), false, 'no empty course folder is left behind');
    assert.equal((await fetch(`${base}/graph?courseId=course-2`)).status, 404, 'empty courses have no graph to show');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('knowledge file API refuses traversal and unsupported file types', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-knowledge-guard-'));
  const state = writeFixture(directory);
  const { server, base } = await startServer(directory, state);
  try {
    const traversal = await fetch(`${base}/file?path=${encodeURIComponent('../state.json')}`);
    assert.equal(traversal.status, 400);
    const absolute = await fetch(`${base}/file?path=${encodeURIComponent('/etc/passwd')}`);
    assert.equal(absolute.status, 400);
    const tree = await (await fetch(`${base}/tree`)).json();
    const image = tree.courses[0].files.find((file) => file.kind === 'image').path;
    const notMarkdown = await fetch(`${base}/file?path=${encodeURIComponent(image)}`);
    assert.equal(notMarkdown.status, 404);
    const missing = await fetch(`${base}/file?path=${encodeURIComponent('高等数学/wiki/不存在.md')}`);
    assert.equal(missing.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('knowledge graph links notes together and reports hub and orphan pages', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-knowledge-graph-'));
  const state = writeFixture(directory);
  const { server, base } = await startServer(directory, state);
  try {
    const graph = await (await fetch(`${base}/graph?courseId=course-1`)).json();
    assert.equal(graph.course.id, 'course-1');
    assert.ok(graph.nodes.length >= 4, JSON.stringify(graph.counts));
    const concept = graph.nodes.find((node) => node.kind === 'concept');
    const index = graph.nodes.find((node) => node.kind === 'index');
    assert.ok(concept, 'section titles appear as concept nodes');
    assert.ok(index, 'the course index is a node');
    assert.ok(graph.edges.some((edge) => edge.target === concept.path), 'other notes point at the concept');
    assert.ok(concept.degree >= 2);
    assert.equal(graph.counts.links, graph.edges.length);
    assert.deepEqual(graph.counts.nodes, graph.nodes.length);
    assert.ok(graph.hubs.includes(concept.path) || graph.hubs.includes(index.path), 'hub pages are ranked by connections');
    assert.ok(Array.isArray(graph.orphans));
    assert.ok(graph.nodes.every((node) => node.path.startsWith('高等数学/')), 'course scope stays inside the course folder');

    const everything = await (await fetch(`${base}/graph`)).json();
    assert.ok(everything.nodes.every((node) => node.kind !== 'system'), 'cross-course graph hides helper files');
    assert.ok(everything.nodes.some((node) => node.kind === 'index'));
    assert.ok(everything.counts.nodes >= graph.counts.nodes);

    assert.equal((await fetch(`${base}/graph?courseId=../escape`)).status, 400);
    assert.equal((await fetch(`${base}/graph?courseId=missing-course`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Wiki query reads the course index, returns only real citations and saves grounded answers', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-knowledge-query-'));
  const state = writeFixture(directory); let wikiPath = ''; let forged = false; const payloads = [];
  const saveState = () => fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  const fetchImpl = async (_url, input) => {
    const payload = JSON.parse(JSON.parse(input.body).messages[1].content); payloads.push(payload);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: '极限定义需要核对趋近条件。', citations: [{ path: forged ? '高等数学/wiki/伪造.md' : wikiPath, reason: '原文摘要依据' }] }) } }] }));
  };
  const { server, base } = await startServer(directory, state, { provider: { baseUrl: 'https://model.example/v1', model: 'test' }, fetchImpl, saveState });
  try {
    const tree = await (await fetch(`${base}/tree`)).json();
    wikiPath = tree.courses[0].files.find(file => file.path.includes('/wiki/') && file.path.includes('第一章讲义')).path;
    const post = body => fetch(`${base}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await post({ courseId: 'course-1', question: '函数极限的定义是什么？', save: true });
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.citations.length, 1); assert.equal(result.citations[0].path, wikiPath); assert.deepEqual(result.citations[0].chunkIds, ['chunk-1']);
    assert.match(payloads[0].index.content, /00-索引|函数极限/); assert.ok(payloads[0].notes.some(note => note.path === wikiPath));
    assert.ok(result.savedId); assert.equal(state.knowledgeQuestions.length, 1);
    forged = true; const rejected = await post({ courseId: 'course-1', question: '继续解释极限', save: false });
    assert.equal(rejected.status, 502); assert.equal(state.knowledgeQuestions.length, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Lint verifies immutable Raw bytes and broken links while repair only regenerates mirrors', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-knowledge-lint-'));
  const state = writeFixture(directory); const rawStore = createRawStore({ dataDir: directory });
  const raw = rawStore.put({ courseId: 'course-1', sourceId: 'doc-1', data: '原始讲义字节', kind: 'upload', fileName: '第一章.pdf' });
  state.documents[0].rawRef = raw.rawRef; fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  const storedLessons = JSON.parse(fs.readFileSync(path.join(directory, 'lessons.json'), 'utf8'));
  const framePath = path.join(directory, 'lesson-visual', lesson.id, lesson.visual.id, 'frame-0001.jpg');
  const keyframe = rawStore.registerFile({ courseId: 'course-1', sourceId: lesson.visual.id, artifactId: 'frame-0001', path: framePath });
  storedLessons.lessons[0].visual.frames[0].rawRef = keyframe.rawRef;
  fs.writeFileSync(path.join(directory, 'lessons.json'), JSON.stringify(storedLessons));
  const { server, base } = await startServer(directory, state, { rawStore });
  try {
    const tree = await (await fetch(`${base}/tree`)).json();
    const wiki = tree.courses[0].files.find(file => file.path.includes('/wiki/') && file.path.includes('第一章讲义')).path;
    fs.appendFileSync(path.join(directory, 'knowledge', wiki), '\n[[不存在的笔记]]\n');
    fs.writeFileSync(rawStore.resolveRef(raw.rawRef), '被篡改');
    fs.appendFileSync(rawStore.resolveRef(keyframe.rawRef), 'tampered');
    const post = body => fetch(`${base}/lint`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const report = await (await post({})).json();
    assert.ok(report.issues.some(issue => issue.kind === 'raw-hash')); assert.ok(report.issues.some(issue => issue.kind === 'broken-link'));
    assert.ok(report.issues.some(issue => issue.kind === 'raw-hash' && issue.target === keyframe.rawRef), 'Lint verifies immutable keyframe bytes');
    const repaired = await (await post({ repair: true })).json(); assert.equal(repaired.repaired, true);
    assert.ok(repaired.issues.some(issue => issue.kind === 'raw-hash'), 'repair never rewrites or hides Raw tampering');
    assert.doesNotMatch(fs.readFileSync(path.join(directory, 'knowledge', wiki), 'utf8'), /不存在的笔记/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('keyframe Raw registration is idempotent, isolates immutable bytes and detects Raw tampering', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-keyframe-raw-'));
  try {
    writeFixture(directory); const rawStore = createRawStore({ dataDir: directory });
    const framePath = path.join(directory, 'lesson-visual', lesson.id, lesson.visual.id, 'frame-0001.jpg');
    const original = fs.readFileSync(framePath);
    const options = { courseId: 'course-1', sourceId: lesson.visual.id, artifactId: 'frame-0001', path: framePath };
    const first = rawStore.registerFile(options), second = rawStore.registerFile(options);
    assert.equal(first.duplicate, false); assert.equal(second.duplicate, true); assert.equal(second.rawRef, first.rawRef);
    assert.equal(fs.existsSync(rawStore.resolveRef(first.rawRef)), true, 'the Raw store owns an immutable JPEG copy');
    assert.deepEqual(rawStore.read(first.rawRef, { verify: true }).data, original);
    fs.appendFileSync(framePath, 'working-file-changed');
    assert.equal(rawStore.verify(first.rawRef).ok, true, 'editing a working frame never changes the archived Raw bytes');
    fs.appendFileSync(rawStore.resolveRef(first.rawRef), 'tampered');
    assert.equal(rawStore.verify(first.rawRef).ok, false);
    assert.throws(() => rawStore.read(first.rawRef, { verify: true }), error => error.status === 409);
    const outside = path.join(os.tmpdir(), `shifen-outside-${process.pid}.jpg`);
    fs.writeFileSync(outside, original);
    try { assert.throws(() => rawStore.registerFile({ ...options, artifactId: 'frame-0002', path: outside }), error => error.status === 400); }
    finally { fs.rmSync(outside, { force: true }); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Output mirror preserves revision history, source Wiki links and stale status', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-knowledge-output-'));
  const state = writeFixture(directory);
  const generated = { id: 'output-doc', courseId: 'course-1', name: '导数考点清单.md', type: 'MD', status: 'ready', chunks: [{ id: 'output-chunk', page: 1, text: '- [ ] 掌握导数定义' }] };
  state.documents.push(generated);
  const artifact = { id: 'artifact-1', courseId: 'course-1', documentId: generated.id, kind: 'exam-checklist', title: '导数考点清单', body: '# 导数考点清单\n\n- [ ] 掌握导数定义', sourceDocumentIds: ['doc-1'], sourceNoteIds: ['doc-1'], sourceFingerprints: [], revision: 1 };
  state.courseStudio = { artifacts: [artifact, { ...artifact, id: 'artifact-2', title: '导数考点清单', revision: 2, sourceFingerprints: [{ id: 'doc-1', hash: 'changed' }] }] };
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  const { server, base, manager } = await startServer(directory, state);
  try {
    const tree = await (await fetch(`${base}/tree`)).json(); const outputs = tree.courses[0].files.filter(file => file.path.includes('/output/'));
    assert.equal(outputs.length, 2); assert.ok(outputs.some(file => file.path.endsWith('/r1.md'))); assert.ok(outputs.some(file => file.path.endsWith('/r2.md')));
    const current = await (await fetch(`${base}/file?path=${encodeURIComponent(outputs.find(file => file.path.endsWith('/r2.md')).path)}`)).json();
    assert.match(current.content, /来源已变化/); assert.match(current.content, /\[\[高等数学 · 第一章讲义 · 摘要\]\]/); assert.match(current.content, /exam-checklist/);

    const exported = manager.writeOutputExport({ artifact, format: 'docx', bytes: Buffer.from('first-export') });
    manager.writeOutputExport({ artifact, format: 'docx', bytes: Buffer.from('must-not-overwrite') });
    assert.equal(fs.readFileSync(path.join(directory, 'knowledge', exported), 'utf8'), 'first-export');
    const refreshed = await (await fetch(`${base}/tree?refresh=1`)).json();
    const refreshedOutputs = refreshed.courses[0].files.filter(file => file.path.includes('/output/'));
    assert.equal(refreshedOutputs.length, 3); assert.ok(refreshedOutputs.some(file => file.path === exported));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});
