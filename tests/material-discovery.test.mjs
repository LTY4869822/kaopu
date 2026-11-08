import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

async function harness(options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-discovery-'));
  const app = createApp({ dataDir, provider: {}, videoFetcher: null, ...options });
  const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  return { base: `http://127.0.0.1:${server.address().port}/api`, dataDir, async close() {
    app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('shifen-discovery-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  } };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function course(base, name) {
  const response = await fetch(`${base}/courses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  assert.equal(response.status, 201);
  return response.json();
}
async function search(base, body) {
  const response = await fetch(`${base}/course-studio/discovery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function importSelection(base, body) {
  const response = await fetch(`${base}/course-studio/discovery/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const aiPayload = {
  chapters: [
    { title: '树的进阶', points: [
      { title: '线索二叉树', detail: '利用空指针域保存前驱与后继线索，使中序遍历不需要递归或栈，插入删除后需要维护线索。', keywords: ['线索', '中序遍历'], difficulty: '进阶' },
      { title: '并查集', detail: '并查集维护不相交集合，支持查找与合并；路径压缩与按秩合并可以接近常数时间。', keywords: ['并查集', '路径压缩'], difficulty: '中等' },
      { title: '哈夫曼树', detail: '哈夫曼树按权值构造带权路径长度最小的二叉树，可用于前缀编码与文件压缩。', keywords: ['哈夫曼', '前缀编码'], difficulty: '中等' },
    ] },
    { title: '图算法补充', points: [
      { title: '拓扑排序', detail: '有向无环图可以拓扑排序；不断取出入度为零的顶点，若剩余顶点则说明存在环。', keywords: ['拓扑排序', '入度'], difficulty: '中等' },
      { title: '关键路径', detail: '关键路径是工期最长的路径，决定项目最短完成时间；通过最早与最晚开始时间计算。', keywords: ['关键路径', '工期'], difficulty: '进阶' },
      { title: '强连通分量', detail: '强连通分量中任意两点互相可达；Tarjan 算法用深度优先搜索与栈一次求出全部分量。', keywords: ['强连通', 'Tarjan'], difficulty: '进阶' },
    ] },
    { title: '复杂度与取舍', points: [
      { title: '摊还分析', detail: '摊还分析把偶发的高成本操作平均到一系列操作上，动态数组扩容是典型例子。', keywords: ['摊还', '动态数组'], difficulty: '进阶' },
      { title: '空间换时间', detail: '哈希表与索引用额外空间换取更快查询；选择结构时要同时考虑数据规模与更新频率。', keywords: ['空间换时间', '哈希表'], difficulty: '中等' },
      { title: '工程取舍', detail: '实际系统常混合多种结构，例如哈希加链表；要结合缓存、并发与持久化需求评估。', keywords: ['工程', '混合结构'], difficulty: '中等' },
    ] },
  ],
};

test('built-in subjects match the offline knowledge framework without network access', async () => {
  const h = await harness();
  try {
    const created = await course(h.base, '数据结构');
    const result = await search(h.base, { courseId: created.id });
    assert.equal(result.status, 200);
    assert.equal(result.body.subject, '数据结构');
    assert.equal(result.body.matched, true);
    assert.equal(result.body.engine, 'catalog');
    assert.ok(result.body.knowledgePoints.length >= 9);
    assert.ok(result.body.knowledgePoints.every(point => point.source === 'catalog' && point.title && point.detail));
    assert.ok(result.body.resources.length >= 3);
    assert.ok(result.body.resources.every(resource => /^https:\/\//.test(resource.url) && resource.license && resource.provider));
    assert.deepEqual(result.body.warnings, []);
    const chapterNames = new Set(result.body.knowledgePoints.map(point => point.chapter));
    assert.ok(chapterNames.size >= 3);
  } finally { await h.close(); }
});

test('an unknown subject falls back to a generic outline with a warning', async () => {
  const h = await harness();
  try {
    const created = await course(h.base, '量子信息导论');
    const result = await search(h.base, { courseId: created.id, query: '第一章' });
    assert.equal(result.status, 200);
    assert.equal(result.body.matched, false);
    assert.equal(result.body.subject, '量子信息导论');
    assert.equal(result.body.engine, 'catalog');
    assert.ok(result.body.knowledgePoints.length >= 6);
    assert.equal(result.body.warnings.length, 1);
    assert.match(result.body.warnings[0], /通用起步结构/);
  } finally { await h.close(); }
});

test('AI expansion is optional, labelled, and never supplies links', async () => {
  const calls = [];
  const h = await harness({
    provider: { baseUrl: 'http://127.0.0.1:9/v1', model: 'fake-model', apiKey: 'sk-test' },
    discoveryFetch: async (url, options) => {
      calls.push({ url: String(url), body: options?.body });
      return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(aiPayload) } }] });
    },
  });
  try {
    const created = await course(h.base, '数据结构');
    const result = await search(h.base, { courseId: created.id, useAI: true });
    assert.equal(result.status, 200);
    assert.equal(result.body.engine, 'catalog+ai');
    const aiPoints = result.body.knowledgePoints.filter(point => point.source === 'ai');
    assert.equal(aiPoints.length, 9);
    assert.ok(aiPoints.every(point => !/https?:\/\//.test(`${point.title}${point.detail}`)));
    assert.ok(result.body.warnings.some(warning => /未经人工核对/.test(warning)));
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/chat\/completions$/);
    assert.ok(!calls[0].body.includes('sk-test'));
  } finally { await h.close(); }
});

test('AI failures keep the catalog result and add a warning', async () => {
  const h = await harness({
    provider: { baseUrl: 'http://127.0.0.1:9/v1', model: 'fake-model', apiKey: 'sk-test' },
    discoveryFetch: async () => json({ error: 'unavailable' }, 503),
  });
  try {
    const created = await course(h.base, '数据结构');
    const result = await search(h.base, { courseId: created.id, useAI: true });
    assert.equal(result.status, 200);
    assert.equal(result.body.engine, 'catalog');
    assert.ok(!result.body.knowledgePoints.some(point => point.source === 'ai'));
    assert.ok(result.body.warnings.some(warning => /模型扩展暂不可用/.test(warning)));
  } finally { await h.close(); }
});

test('AI outlines containing URLs are rejected instead of being imported', async () => {
  const unsafe = { chapters: aiPayload.chapters.map((chapter, index) => index ? chapter : { ...chapter, points: chapter.points.map((point, pointIndex) => pointIndex ? point : { ...point, detail: `${point.detail} 参考 https://example.com/notes` }) }) };
  const h = await harness({
    provider: { baseUrl: 'http://127.0.0.1:9/v1', model: 'fake-model', apiKey: 'sk-test' },
    discoveryFetch: async () => json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(unsafe) } }] }),
  });
  try {
    const created = await course(h.base, '数据结构');
    const result = await search(h.base, { courseId: created.id, useAI: true });
    assert.equal(result.status, 200);
    assert.ok(!result.body.knowledgePoints.some(point => point.source === 'ai'));
    assert.ok(result.body.warnings.some(warning => /模型扩展暂不可用/.test(warning)));
  } finally { await h.close(); }
});

test('online search adds attributed Wikipedia resources only when requested', async () => {
  const calls = [];
  const h = await harness({
    discoveryFetch: async url => {
      calls.push(String(url));
      return json({ query: { search: [
        { title: '二叉树', pageid: 12345, snippet: '<span class="searchmatch">二叉树</span>是每个节点最多有两个子节点的树结构，常用于表达层次关系。' },
        { title: '图论', pageid: 23456, snippet: '图论研究由顶点和边组成的图，与数据结构中的图存储与遍历密切相关。' },
      ] } });
    },
  });
  try {
    const created = await course(h.base, '数据结构');
    const offline = await search(h.base, { courseId: created.id });
    assert.equal(offline.body.engine, 'catalog');
    assert.ok(!offline.body.resources.some(resource => resource.provider === '维基百科' && resource.id !== 'r1'));
    assert.equal(calls.length, 0);
    const online = await search(h.base, { courseId: created.id, online: true });
    assert.equal(online.status, 200);
    assert.equal(online.body.engine, 'catalog+online');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/zh\.wikipedia\.org\/w\/api\.php\?/);
    assert.ok(online.body.knowledgePoints.some(point => point.source === 'wikipedia' && point.chapter === '在线延伸阅读'));
    assert.ok(online.body.resources.some(resource => resource.provider === '维基百科' && resource.license === 'CC BY-SA 4.0' && /^https:\/\/zh\.wikipedia\.org\/\?curid=12345$/.test(resource.url)));
  } finally { await h.close(); }
});

test('import saves a source-attributed course document and deduplicates identical selections', async () => {
  const h = await harness();
  try {
    const created = await course(h.base, '数据结构');
    const found = await search(h.base, { courseId: created.id });
    const pointIds = found.body.knowledgePoints.slice(0, 4).map(point => point.id);
    const resourceIds = found.body.resources.slice(0, 2).map(resource => resource.id);
    const first = await importSelection(h.base, { courseId: created.id, pointIds, resourceIds });
    assert.equal(first.status, 201);
    assert.equal(first.body.duplicate, false);
    assert.equal(first.body.document.courseId, created.id);
    assert.equal(first.body.document.origin.kind, 'discovered');
    assert.equal(first.body.document.origin.revision, 1);
    assert.equal(first.body.document.locationKind, 'section');
    assert.equal(first.body.document.hasOriginal, false);
    assert.equal(first.body.document.parser.engine, 'native');
    assert.equal(first.body.document.status, 'ready');
    assert.ok(first.body.document.chunks.length > 0);
    assert.ok(first.body.document.chunks.every(chunk => chunk.text.length <= 1400));
    assert.match(first.body.document.name, /起步资料\.md$/);
    const text = first.body.document.chunks.map(chunk => chunk.text).join('\n');
    assert.match(text, /本地知识框架/);
    assert.ok(pointIds.length === 4);
    const titles = found.body.knowledgePoints.filter(point => pointIds.includes(point.id)).map(point => point.title);
    assert.ok(titles.every(title => text.includes(title)));
    assert.match(text, /参考资源/);

    const state = await (await fetch(`${h.base}/state`)).json();
    assert.equal(state.documents.filter(document => document.courseId === created.id).length, 1);

    const again = await importSelection(h.base, { courseId: created.id, pointIds, resourceIds });
    assert.equal(again.status, 201);
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.document.id, first.body.document.id);
    const after = await (await fetch(`${h.base}/state`)).json();
    assert.equal(after.documents.filter(document => document.courseId === created.id).length, 1);
  } finally { await h.close(); }
});

test('discovery validates the course, topic, and selected point ids', async () => {
  const h = await harness();
  try {
    assert.equal((await search(h.base, { courseId: 'missing' })).status, 404);
    const created = await course(h.base, '数据结构');
    assert.equal((await search(h.base, { courseId: created.id, query: 'x'.repeat(121) })).status, 400);
    assert.equal((await search(h.base, { courseId: created.id, online: 'yes' })).status, 400);
    assert.equal((await importSelection(h.base, { courseId: created.id, pointIds: [] })).status, 400);
    await search(h.base, { courseId: created.id });
    assert.equal((await importSelection(h.base, { courseId: created.id, pointIds: ['not-a-point'] })).status, 409);
    assert.equal((await importSelection(h.base, { courseId: created.id, pointIds: ['c1-1'], resourceIds: ['not-a-resource'] })).status, 400);
  } finally { await h.close(); }
});

test('deleting a course keeps discovery cache isolated and rejects later imports', async () => {
  const h = await harness();
  try {
    const created = await course(h.base, '数据结构');
    const found = await search(h.base, { courseId: created.id });
    const pointIds = [found.body.knowledgePoints[0].id];
    assert.equal((await fetch(`${h.base}/courses/${created.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await search(h.base, { courseId: created.id })).status, 404);
    assert.equal((await importSelection(h.base, { courseId: created.id, pointIds })).status, 404);
  } finally { await h.close(); }
});
