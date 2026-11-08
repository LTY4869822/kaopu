import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { mountLessons, parseLessonSource, normalizeLessonUrl, chunkLessonCues, validateLessonModelResult, extractLessonNotes } from '../server/lessons.mjs';
import { createRawStore } from '../server/raw-store.mjs';

const srt = '1\n00:00:01,000 --> 00:00:08,500\n导数定义：函数在某一点的变化率。\n\n2\n00:00:09,000 --> 00:00:19,000\n例题：求 f(x)=x² 在 x=2 的导数。\n\n3\n00:00:20,000 --> 00:00:32,000\n解：由定义或幂函数求导，f′(x)=2x，因此 f′(2)=4。';
const course = { id: 'course-1', name: '高数', examDate: '', target: 80 };
const errorHandler = (error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status ? error.message : '内部错误' });
const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const asrMarkerSource = (count = 3, characters = 600) => {
  const text = '学'.repeat(characters - count) + '\uFFFD'.repeat(count);
  return JSON.stringify({ body: Array.from({ length: Math.ceil(text.length / 5000) }, (_, index) => ({ from: index * 10, to: index * 10 + 9, content: text.slice(index * 5000, (index + 1) * 5000) })) });
};

async function harness(options = {}) {
  const dir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-lessons-'));
  const state = options.state || { courses: [{ ...course }], documents: [], cards: [] };
  let saves = 0;
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const visionService = options.visionService || options.visionFactory?.(dir);
  const manager = mountLessons(app, { dataDir: dir, getState: () => state, saveState: () => { saves++; options.onSave?.(); }, provider: options.provider || {}, fetchSource: options.fetchSource, visionService, catalog: options.catalog, checkLocalEnvironment: options.checkLocalEnvironment, createOutputJob: options.createOutputJob });
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, method = 'GET', data) => {
    const response = await fetch(`${base}/api/lessons${route}`, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  };
  const waitFor = async (id, statuses = ['completed', 'failed', 'cancelled', 'ready']) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      const result = await api(`/${id}`);
      if (statuses.includes(result.body.status)) return result.body;
      await delay(10);
    }
    throw new Error('Lesson did not finish within test deadline');
  };
  const close = async (remove = true) => {
    manager.close(); server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (remove) {
      const resolved = path.resolve(dir);
      assert.ok(resolved.startsWith(path.resolve(os.tmpdir(), 'shifen-lessons-')));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  };
  return { dir, state, api, waitFor, close, saveCount: () => saves, manager, base, visionService };
}

async function modelServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const source = JSON.parse(request.messages.find(message => message.role === 'user').content);
    requests.push({ request, source, url: req.url, auth: req.headers.authorization });
    const value = await handler(source, requests.length);
    if (res.destroyed) return;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { requests, provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test-key', model: 'test-model' }, close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}

test('lesson source parser preserves SRT/VTT/JSON timing and never invents TXT timestamps', () => {
  const parsed = parseLessonSource(srt, 'srt');
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed[0], { id: 'cue-1', start: 1, end: 8.5, text: '导数定义：函数在某一点的变化率。' });
  const vtt = parseLessonSource('WEBVTT\n\nNOTE source\nkept outside subtitles\n\n00:01.000 --> 00:02.000 align:start\n<c.green>矩阵</c> &amp; 向量\n\n00:02.000 --> 00:03.000\n第二段', 'vtt');
  assert.equal(vtt[0].text, '矩阵 & 向量');
  assert.equal(vtt[1].start, 2);
  assert.equal(parseLessonSource(JSON.stringify({ body: [{ from: 2.5, to: 8, content: '线性代数' }] }), 'json')[0].start, 2.5);
  assert.equal(parseLessonSource('第一段\n\n第二段', 'txt')[1].start, null);
  assert.equal(parseLessonSource('第一段\n\n第二段', 'txt')[1].end, null);
  for (const [text, format] of [['broken', 'srt'], ['1\n00:00:03,000 --> 00:00:01,000\n倒序', 'srt'], ['WEBVTT\n\n00:63.000 --> 01:02.000\n错误', 'vtt'], ['{"body":[{"from":"1","to":3,"content":"错类型"}]}', 'json'], ['\0binary', 'txt'], ['乱码���', 'txt'], ['x'.repeat(250001), 'txt']]) {
    assert.throws(() => parseLessonSource(text, format), (error) => [400, 413, 422].includes(error.status));
  }
  assert.throws(() => parseLessonSource(srt, 'txt'), /SRT 或 VTT/);
  assert.throws(() => parseLessonSource('1\n00:00:02,000 --> 00:00:03,000\n二\n\n2\n00:00:01,000 --> 00:00:02,000\n一', 'srt'), /开始时间排列/);
});

test('sparse ASR replacement markers are bounded by decoded content and retain the raw characters', () => {
  const options = { allowSparseAsrMarkers: true };
  for (const count of [1, 2]) {
    const source = asrMarkerSource(count, count);
    assert.equal(parseLessonSource(source, 'json', options)[0].text, '\uFFFD'.repeat(count));
    assert.equal(parseLessonSource(source, 'json')[0].text, '\uFFFD'.repeat(count), 'short ASR keeps the existing public allowance');
  }
  for (const [count, characters] of [[3, 600], [100, 20000]]) {
    const source = asrMarkerSource(count, characters);
    for (const value of [source, source.replace(/\uFFFD/g, '\\ufffd')]) {
      const cues = parseLessonSource(value, 'json', options);
      assert.equal(cues.map(cue => cue.text).join('').length, characters);
      assert.equal((cues.map(cue => cue.text).join('').match(/\uFFFD/g) || []).length, count);
      assert.deepEqual(cues.map(cue => ({ start: cue.start, end: cue.end })), JSON.parse(source).body.map(cue => ({ start: cue.from, end: cue.to })));
      assert.throws(() => parseLessonSource(value, 'json'), error => error.status === 400, 'public parser remains strict for both literal and escaped characters');
    }
  }
  for (const source of [asrMarkerSource(3, 599), asrMarkerSource(101, 20200)]) {
    assert.throws(() => parseLessonSource(source, 'json', options), error => error.status === 400);
  }
  const padded = JSON.parse(asrMarkerSource(3, 10)); padded.unusedMetadata = '学'.repeat(20000);
  assert.throws(() => parseLessonSource(JSON.stringify(padded), 'json', options), error => error.status === 400, 'JSON metadata cannot dilute the marker ratio');
  for (const format of ['txt', 'md', 'srt', 'vtt']) {
    assert.throws(() => parseLessonSource('学'.repeat(597) + '\uFFFD'.repeat(3), format, options), error => error.status === 400, 'internal opt-in applies only to structured ASR JSON');
  }
});

test('decoded JSON control characters are rejected for public and trusted ASR sources', () => {
  for (const character of ['\u0000', '\u0001', '\u0008', '\u000b', '\u000c', '\u001f']) {
    const source = JSON.stringify({ body: [{ from: 0, to: 1, content: '课程内容' + character + '仍须拒绝' }] });
    assert.equal(source.includes(character), false, 'fixture contains JSON-escaped control characters');
    for (const options of [undefined, { allowSparseAsrMarkers: true }]) {
      assert.throws(() => parseLessonSource(source, 'json', options), error => error.status === 400);
    }
  }
  const allowed = '课程文字\n换行与\t制表';
  assert.equal(parseLessonSource(JSON.stringify({ body: [{ from: 0, to: 1, content: allowed }] }), 'json')[0].text, allowed);
});

test('lesson URLs constrain external sources and retain selected part without retaining tracking tokens', () => {
  assert.deepEqual(normalizeLessonUrl('https://www.bilibili.com/video/BV1B7411m7LV/?p=3&share_source=x'), { url: 'https://www.bilibili.com/video/BV1B7411m7LV', part: 3 });
  assert.deepEqual(normalizeLessonUrl('BV1B7411m7LV', 2), { url: 'https://www.bilibili.com/video/BV1B7411m7LV', part: 2 });
  assert.deepEqual(normalizeLessonUrl(''), { url: '', part: 1 });
  for (const value of ['https://b23.tv/test', 'https://bilibili.com.attacker.test/video/BV1B7411m7LV', 'http://localhost/video/BV1B7411m7LV', 'javascript:alert(1)', 'https://user:pass@www.bilibili.com/video/BV1B7411m7LV', 'https://www.bilibili.com/video/BV1B7411m7LV?p=-2']) assert.throws(() => normalizeLessonUrl(value));
});

test('local examples retain adjacent question conditions and explicit solution without swallowing the next topic', () => {
  const body = [
    '好，同学们，我们开始今天的课。', '导数定义：函数在某点的变化率。',
    '例题一：设 f(x)=x²，', '求 f 在 x=2 处的导数。', '解：由幂函数求导，', 'f′(x)=2x，因此 f′(2)=4。',
    '例题二：计算 lim(x→0) sin(x)/x。答案：这是基本极限，结果为 1。',
    '链式法则：外层导数乘以内层导数。', '例题：判断题目条件是否满足。', '本题尚未提供解答。',
    '接下来我们学习积分。',
  ].map((content, index) => ({ from: index * 10, to: index * 10 + 8, content }));
  const cues = parseLessonSource(JSON.stringify({ body }), 'json');
  const notes = extractLessonNotes(cues);
  assert.equal(notes.mode, 'extractive');
  assert.equal(notes.examples.length, 3);
  assert.ok(notes.examples[0].prompt.includes('求 f 在 x=2'));
  assert.ok(notes.examples[0].solution.includes('f′(2)=4'));
  assert.ok(!notes.examples[0].solution.includes('lim('));
  assert.deepEqual(notes.examples[0].cueIds, ['cue-3', 'cue-4', 'cue-5', 'cue-6']);
  assert.ok(notes.examples[1].solution.includes('结果为 1'));
  assert.ok(!notes.examples[1].solution.includes('链式法则'));
  assert.equal(notes.examples[2].solution, '');
  assert.ok(notes.examples.every((item) => item.needsReview));
  assert.equal(notes.sections[0].title, '导数定义');
  assert.ok(notes.sections.some((section) => section.title === '链式法则'));
  const full = notes.sections.map((section) => section.text).join('\n');
  assert.ok(cues.every((cue) => full.includes(cue.text)));
});

test('local example extraction separates multiple examples in one cue and marks bounded windows honestly', () => {
  const text = '例题：求 x² 的导数。解：答案为 2x。例题：求 x³ 的导数。解：答案为 3x²。';
  const notes = extractLessonNotes(parseLessonSource(text, 'txt'));
  assert.equal(notes.examples.length, 2);
  assert.ok(notes.examples[0].solution.includes('2x'));
  assert.ok(!notes.examples[0].solution.includes('3x²'));
  assert.ok(notes.examples[1].prompt.includes('x³'));
  const body = Array.from({ length: 45 }, (_, index) => ({ from: index * 10, to: index * 10 + 9, content: index === 0 ? '例题：求一个需要较长推导的极限。' : index === 1 ? '解：以下是老师的推导。' : `继续计算第 ${index} 步。` }));
  const bounded = extractLessonNotes(parseLessonSource(JSON.stringify({ body }), 'json'));
  assert.ok(bounded.warnings.some((warning) => warning.includes('上下文窗口')));
  assert.equal(bounded.coverage.processedCueCount, 45);
  const negative = extractLessonNotes(parseLessonSource('没有例题，今天只讲定义。\n\n我们来看一道例题。', 'txt'));
  assert.equal(negative.examples.length, 0);
});

test('spoken example cues keep the actual explanation and ASR errors without inventing formulas', () => {
  const body = [
    '那这里边我们最常举的例子啊', '就是Y等X的绝对值', '那它的图像是这个样子的',
    '当X小0的时候Y等于F,F,F,F,F', '它的这个右导述是个1', '它的左导述是等一个富裔',
    '所以在这个点它的导述就不存在', '有一个充要条件', '在某点可导啊它的充要条件是',
  ].map((content, index) => ({ from: 228 + index * 5, to: 232 + index * 5, content }));
  const cues = parseLessonSource(JSON.stringify({ body }), 'json');
  const notes = extractLessonNotes(cues);
  assert.equal(notes.examples.length, 1);
  assert.equal(notes.examples[0].title, 'Y等X的绝对值');
  assert.ok(notes.examples[0].prompt.includes('F,F,F,F,F'));
  assert.ok(notes.examples[0].prompt.includes('富裔'));
  assert.ok(!notes.examples[0].prompt.includes('充要条件'));
  assert.equal(notes.examples[0].solution, '');
  assert.ok(!notes.examples[0].prompt.includes('f(x)=|x|'));
  assert.ok(notes.warnings.some((warning) => warning.includes('重复字母式转写')));
  assert.equal(notes.coverage.processedCueCount, cues.length);
});

test('oral examples stop near two minutes despite garbled topic transitions and keep the rest in the transcript', () => {
  const body = Array.from({ length: 32 }, (_, index) => ({ from: 223 + index * 10, to: 231 + index * 10,
    content: index === 0 ? '那这里边我们最常举的例子啊' : index < 14 ? `这是老师第${index}段原话，Y等X绝对值，左右导数仍需回看核对。` : `充藥条线后的第${index}段新讲解，原文仍完整保留，不应被前一个口语例子吞进去。` }));
  const cues = parseLessonSource(JSON.stringify({ body }), 'json');
  const notes = extractLessonNotes(cues);
  assert.equal(notes.examples.length, 1);
  const example = notes.examples[0];
  assert.equal(example.cueIds.at(-1), 'cue-13');
  assert.ok(!example.prompt.includes('充藥条线后的'));
  assert.equal(example.solution, '');
  assert.ok(notes.warnings.some((warning) => warning.includes('上下文窗口')));
  assert.equal(notes.coverage.processedCueCount, body.length);
  assert.equal(cues.at(-1).text, body.at(-1).content);
  const normalized = notes.sections.map((section) => section.text).join('').replace(/\s+/g, '');
  assert.ok(cues.every((cue) => normalized.includes(cue.text.replace(/\s+/g, ''))));
  assert.ok([...notes.sections.flatMap((section) => section.text.split(/\n\n/)), ...example.prompt.split(/\n\n/)].every((paragraph) => paragraph.length <= 240));
  const explicit = extractLessonNotes(parseLessonSource(JSON.stringify({ body: body.map((item, index) => ({ ...item, content: index === 0 ? '例题：求函数在指定点的导数。' : item.content })) }), 'json'));
  assert.ok(explicit.examples[0].cueIds.length > example.cueIds.length);
});

test('long plain-text lectures remain fully readable and no invented timestamp is attached', () => {
  const paragraph = '链式法则：先识别外层函数和内层函数。'.repeat(450);
  const cues = parseLessonSource(paragraph, 'txt');
  assert.ok(cues.length > 5);
  assert.equal(cues.map((cue) => cue.text).join(''), paragraph);
  assert.ok(cues.every((cue) => cue.start === null && cue.end === null));
  const notes = extractLessonNotes(cues);
  assert.equal(notes.coverage.processedCueCount, cues.length);
  assert.ok(notes.sections.every((section) => section.text.length <= 1800));
  assert.ok(notes.sections.every((section) => section.title === '链式法则'));
  assert.equal(parseLessonSource('流程：A --> B --> C。', 'txt')[0].text, '流程：A --> B --> C。');
});

test('Markdown time anchors preserve imported visual descriptions, unknown ends and inference provenance', () => {
  const markdown = '# 导数公开课\n\n## 基本信息\n- 平台：B站\n\n## 口播/对白\n我们来看一道例题。\n\n## 视觉时间线\n### 00:03:25.500–00:04:12.000\n**同期口播**\n例题：求 x² 的导数。\n解：由幂函数求导得到 2x。\n**画面事实**\n- 老师在黑板上书写。\n**屏幕文字**\n- f(x)=x²\n**模型推断（需复核）**\n例题：推测老师接下来会求 x³ 的导数。\n\n## [00:05:10] 单点标记\n屏幕上出现链式法则。\n\n[00:06:10] 另一条时间原文\n\n## Agent 选段\n例题：这只是处理建议，不是课堂题目。\n\n## 信息缺口\n最后一段没有画面分析。';
  const cues = parseLessonSource(markdown, 'markdown');
  const spoken = cues.find((cue) => cue.text.startsWith('**同期口播**'));
  assert.equal(spoken.start, 205.5);
  assert.equal(spoken.end, 252);
  assert.ok(cues.some((cue) => cue.text.includes('f(x)=x²') && cue.start === 205.5));
  const point = cues.find((cue) => cue.text.includes('单点标记'));
  assert.equal(point.start, 310);
  assert.equal(point.end, null);
  assert.equal(cues.find((cue) => cue.text.includes('另一条时间原文')).start, 370);
  assert.equal(cues.find((cue) => cue.text.startsWith('## Agent')).start, null);
  const notes = extractLessonNotes(cues);
  assert.equal(notes.coverage.visual, false);
  assert.ok(notes.warnings.some((warning) => warning.includes('外部材料中的画面描述')));
  assert.ok(notes.warnings.some((warning) => warning.includes('外部模型推断')));
  assert.equal(notes.examples.length, 1);
  assert.ok(notes.examples[0].solution.includes('2x'));
  assert.ok(!notes.examples[0].solution.includes('画面事实'));
  assert.ok(!notes.examples[0].prompt.includes('推测'));
  assert.ok(notes.sections.some((section) => section.title.startsWith('外部推断（需复核）')));
  assert.ok(!notes.overview.some((title) => /信息缺口|Agent|基本信息|需复核/.test(title)));
  const all = notes.sections.map((section) => section.text).join('\n');
  assert.ok(cues.every((cue) => all.includes(cue.text)));
  const code = parseLessonSource('# 普通课程笔记\n\n```text\n## [00:01:20] code sample\nA --> B\n```', 'md');
  assert.ok(code.every((cue) => cue.start === null));
  assert.ok(code.some((cue) => cue.text.includes('A --> B')));
  assert.throws(() => parseLessonSource('## 00:63:20\n无效时间', 'md'), /超出范围/);
  assert.throws(() => parseLessonSource('## 00:04:00–00:03:00\n倒序区间', 'md'), /时间无效/);
});

test('Markdown audio and visual tracks retain true overlapping times without assigning metadata to a clip', () => {
  const source = '# 双轨课程\n\n## 口播/对白\n### 00:00:00.000–00:00:12.000\n口播第一段。\n### 00:00:12.000–00:00:30.000\n口播第二段。\n\n## 视觉时间线\n### 00:00:10.000–00:00:20.000\n**画面事实**\n- 老师展示矩阵。\n**屏幕文字**\n- A = [[1, 2], [3, 4]]\n**模型推断（需复核）**\n例题：这段只是模型推断。\n\n## Agent 选段\n例题：这不是课堂题目。\n\n## 证据与使用说明\n文本引用：00:00:10 cue-1；不要当时间标题。';
  const cues = parseLessonSource(source, 'md');
  assert.deepEqual(cues.filter((cue) => cue.sourceTrack === 'speech' && cue.start !== null).map((cue) => cue.start), [0, 12]);
  assert.ok(cues.some((cue) => cue.sourceTrack === 'visual' && cue.start === 10 && cue.end === 20 && cue.text.includes('老师展示矩阵')));
  assert.equal(cues.find((cue) => cue.text.startsWith('## Agent')).start, null);
  assert.equal(cues.find((cue) => cue.text.startsWith('## 证据')).start, null);
  const notes = extractLessonNotes(cues);
  assert.equal(notes.examples.length, 0);
  assert.equal(notes.coverage.visual, false);
  assert.ok(notes.warnings.some((warning) => warning.includes('口播与视觉双轨')));
  assert.throws(() => parseLessonSource('## 口播/对白\n### 00:00:12–00:00:30\n第二段\n### 00:00:00–00:00:12\n第一段', 'md'), /同一轨道/);
  assert.equal(parseLessonSource('## 讲义\n来源时间：00:00:10 cue-1\n正文包含 [00:00:20] 参考位置。', 'md')[0].start, null);
});

test('local lecture workflow preserves every cue, publishes idempotently and keeps per-course boundaries', async () => {
  const running = await harness();
  try {
    assert.deepEqual((await running.api('')).body.capabilities, { model: false, bilinote: false, sourceKind: null, vision: false, visionCapture: false });
    let response = await running.api('', 'POST', { courseId: course.id, title: '导数 · 第一讲', url: 'BV1B7411m7LV', part: 3, scope: '导数定义', transcript: srt, format: 'srt', sourceName: '老师字幕.srt' });
    assert.equal(response.status, 201);
    const id = response.body.id;
    assert.equal(response.body.status, 'ready');
    assert.equal((await running.api(`/${id}/analyze`, 'POST', { mode: 'ai' })).status, 503);
    assert.equal((await running.api(`/${id}/publish`, 'POST', {})).status, 422);
    assert.equal((await running.api(`/${id}/fetch`, 'POST', {})).status, 503);
    assert.equal((await running.api(`/${id}/analyze`, 'POST', { mode: 'extractive' })).status, 202);
    const lesson = await running.waitFor(id);
    assert.equal(lesson.status, 'completed');
    assert.equal(lesson.notes.mode, 'extractive');
    assert.deepEqual(lesson.notes.coverage, { cueCount: 3, processedCueCount: 3, visual: false });
    assert.equal(lesson.notes.examples.length, 1);
    assert.equal(lesson.notes.examples[0].solution, '解：由定义或幂函数求导，f′(x)=2x，因此 f′(2)=4。');
    assert.deepEqual(lesson.notes.examples[0].cueIds, ['cue-2', 'cue-3']);
    assert.equal(lesson.notes.examples[0].needsReview, true);
    const full = lesson.notes.sections.map((section) => section.text).join('\n');
    assert.ok(lesson.cues.every((cue) => full.includes(cue.text)));
    response = await running.api(`/${id}/publish`, 'POST', {});
    assert.equal(response.status, 200);
    assert.equal(response.body.created, true);
    const publishedId = response.body.documentId;
    assert.equal((await running.api(`/${id}/publish`, 'POST', {})).body.created, false);
    assert.equal(running.state.documents.length, 1);
    const doc = running.state.documents[0];
    assert.equal(doc.id, publishedId);
    assert.equal(doc.courseId, course.id);
    assert.equal(doc.locationKind, 'section');
    assert.ok(doc.chunks.some((chunk) => chunk.text.includes('00:00:01')));
    assert.ok(doc.chunks[0].text.includes('第 3 P'));
    assert.ok(doc.warning.includes('板书'));
    assert.equal((await running.api('', 'POST', { courseId: 'missing', title: '无课程' })).status, 404);
    running.state.courses = [];
    assert.equal((await running.api('')).body.lessons.length, 0);
    assert.equal((await running.api(`/${id}/publish`, 'POST', {})).status, 404);
  } finally { await running.close(); }
});

test('multi-block AI analysis accounts for full source and restores omitted cues verbatim', async () => {
  const model = await modelServer((source) => ({ overview: ['来源概览'], sections: [{ title: '模型整理', text: '已整理第一条内容。', cueIds: [source.untrustedSourceCues[0].id] }], examples: [], warnings: [] }));
  const running = await harness({ provider: model.provider });
  try {
    const body = Array.from({ length: 35 }, (_, index) => ({ from: index * 12, to: index * 12 + 10, content: `知识点${index}：${'数学讲解与适用条件。'.repeat(65)}` }));
    const response = await running.api('', 'POST', { courseId: course.id, title: '长课程', transcript: JSON.stringify({ body }), format: 'json' });
    const id = response.body.id;
    await running.api(`/${id}/analyze`, 'POST', { mode: 'ai' });
    const lesson = await running.waitFor(id);
    assert.equal(lesson.status, 'completed');
    assert.ok(model.requests.length >= 3);
    assert.equal(lesson.notes.coverage.processedCueCount, body.length);
    const processed = model.requests.flatMap((item) => item.source.untrustedSourceCues.map((cue) => cue.id));
    assert.deepEqual([...new Set(processed)].sort(), lesson.cues.map((cue) => cue.id).sort());
    const referenced = new Set(lesson.notes.sections.flatMap((section) => section.cueIds));
    assert.equal(referenced.size, body.length);
    assert.ok(lesson.notes.warnings.some((warning) => warning.includes('已按原文补入')));
    assert.equal(model.requests[0].url, '/v1/chat/completions');
    assert.equal(model.requests[0].auth, 'Bearer test-key');
    assert.ok(model.requests[0].request.messages[0].content.includes('非可信'));
    assert.equal(chunkLessonCues(lesson.cues).flat().length, body.length);
  } finally { await running.close(); await model.close(); }
});

test('updated source invalidates old archive status and publication respects manual course reassignment', async () => {
  const running = await harness();
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '归档版本', transcript: srt, format: 'srt' })).body;
    await running.api(`/${created.id}/analyze`, 'POST', { mode: 'extractive' });
    const analyzed = await running.waitFor(created.id); assert.equal(analyzed.status, 'completed', analyzed.error);
    const publishResponse = await running.api(`/${created.id}/publish`, 'POST', {}); assert.equal(publishResponse.status, 200, publishResponse.body.error);
    const published = publishResponse.body;
    assert.equal((await running.api(`/${created.id}`)).body.documentId, published.documentId);
    const changed = (await running.api(`/${created.id}/source`, 'PUT', { text: '新来源：矩阵的定义。', format: 'txt' })).body;
    assert.equal(changed.documentId, undefined);
    assert.ok(running.state.documents[0].warning.includes('旧版本'));
    await running.api(`/${created.id}/analyze`, 'POST', { mode: 'extractive' });
    const updated = await running.waitFor(created.id);
    assert.equal(updated.documentId, undefined);
    assert.equal((await running.api(`/${created.id}/publish`, 'POST', {})).body.created, false);
    assert.equal(running.state.documents.length, 1);
    assert.ok(running.state.documents[0].chunks.some((chunk) => chunk.text.includes('新来源')));
    assert.ok(!running.state.documents[0].warning.includes('旧版本'));
    running.state.courses.push({ id: 'course-2', name: '其他课程' });
    running.state.documents[0].courseId = 'course-2';
    assert.equal((await running.api(`/${created.id}/publish`, 'POST', {})).status, 409);
    assert.equal(running.state.documents[0].courseId, 'course-2');
  } finally { await running.close(); }
});

test('AI invalid citations fail safely without replacing retained source', async () => {
  const model = await modelServer(() => ({ sections: [{ title: '不存在的来源', text: '错误内容', cueIds: ['cue-9999'] }], examples: [] }));
  const running = await harness({ provider: model.provider });
  try {
    const created = await running.api('', 'POST', { courseId: course.id, title: '拒绝伪引用', transcript: srt, format: 'srt' });
    await running.api(`/${created.body.id}/analyze`, 'POST', { mode: 'ai' });
    const failed = await running.waitFor(created.body.id);
    assert.equal(failed.status, 'failed');
    assert.ok(failed.error.includes('来源引用'));
    assert.equal(failed.cues.length, 3);
    assert.equal(failed.notes, undefined);
    assert.equal((await running.api(`/${failed.id}/publish`, 'POST', {})).status, 422);
    assert.throws(() => validateLessonModelResult({ sections: [{ title: 'bad', text: 'bad', cueIds: [] }] }, failed.cues), /来源引用/);
  } finally { await running.close(); await model.close(); }
});

test('oversized model replies are rejected while retaining source and keeping publication disabled', async () => {
  const model = await modelServer((source) => ({ sections: [{ title: '过量响应', text: 'x'.repeat(600000), cueIds: [source.untrustedSourceCues[0].id] }], examples: [] }));
  const running = await harness({ provider: model.provider });
  try {
    const lesson = (await running.api('', 'POST', { courseId: course.id, title: '有界响应', transcript: srt, format: 'srt' })).body;
    await running.api(`/${lesson.id}/analyze`, 'POST', { mode: 'ai' });
    const failed = await running.waitFor(lesson.id);
    assert.equal(failed.status, 'failed');
    assert.ok(failed.error.includes('超出限制'));
    assert.equal(failed.cues.length, 3);
    assert.equal(failed.notes, undefined);
    assert.equal((await running.api(`/${lesson.id}/publish`, 'POST', {})).status, 422);
  } finally { await running.close(); await model.close(); }
});

test('cancel and replacement source prevent late remote results from overwriting current lecture', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const model = await modelServer(async (source) => { began(); await pending; return { sections: [{ title: '旧任务', text: '应被丢弃', cueIds: [source.untrustedSourceCues[0].id] }], examples: [] }; });
  const running = await harness({ provider: model.provider });
  try {
    const created = await running.api('', 'POST', { courseId: course.id, title: '取消任务', transcript: srt, format: 'srt' });
    const id = created.body.id;
    await running.api(`/${id}/analyze`, 'POST', { mode: 'ai' }); await started;
    const cancelled = await running.api(`/${id}/cancel`, 'POST', {});
    assert.equal(cancelled.body.status, 'cancelled');
    const changed = await running.api(`/${id}/source`, 'PUT', { text: '新的字幕：矩阵的秩。', format: 'txt', sourceName: '新来源.txt' });
    assert.equal(changed.body.status, 'ready');
    release(); await delay(25);
    const latest = (await running.api(`/${id}`)).body;
    assert.equal(latest.status, 'ready');
    assert.equal(latest.cues[0].text, '新的字幕：矩阵的秩。');
    assert.equal(latest.notes, undefined);
  } finally { release(); await running.close(); await model.close(); }
});

test('local transcription environment check is exposed before dynamic lesson routes', async () => {
  const expected = { enabled: false, ready: false, missingDependencies: ['faster-whisper'], modelCached: false, message: '本机缺少 faster-whisper，需要管理员自行安装。' };
  let calls = 0;
  const running = await harness({ checkLocalEnvironment: async () => { calls++; return expected; } });
  try {
    const response = await running.api('/local-transcription/check');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, expected);
    assert.equal(calls, 1);
  } finally { await running.close(); }
});

test('missing public subtitles retain a specific error code for the subtitle import action', async () => {
  const running = await harness({ fetchSource: async () => {
    throw Object.assign(new Error('这个视频没有公开字幕，请导入字幕文件。'), { status: 422, code: 'NO_PUBLIC_SUBTITLES' });
  } });
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '无公开字幕', url: 'BV1B7411m7LV' })).body;
    assert.equal((await running.api(`/${created.id}/fetch`, 'POST', {})).status, 202);
    const failed = await running.waitFor(created.id, ['failed']);
    assert.equal(failed.errorCode, 'NO_PUBLIC_SUBTITLES');
    assert.equal(failed.error, '这个视频没有公开字幕，请导入字幕文件。');
    assert.equal(failed.failedStage, 'fetch');
    assert.equal(failed.retryable, true);
  } finally { await running.close(); }
});

test('BiliNote fetch queues asynchronously, can be cancelled, and accepts only real subtitle source', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let callCount = 0;
  const running = await harness({ fetchSource: async (_lesson, { signal }) => { callCount++; if (callCount === 1) await pending; assert.equal(typeof signal.aborted, 'boolean'); return { text: JSON.stringify({ body: [{ from: 1, to: 3, content: '真实字幕' }] }), format: 'json', sourceName: 'BiliNote字幕' }; } });
  try {
    const created = await running.api('', 'POST', { courseId: course.id, title: '远程字幕', url: 'BV1B7411m7LV', part: 2 });
    const id = created.body.id;
    assert.equal(created.body.status, 'waiting_source');
    assert.equal((await running.api('')).body.capabilities.bilinote, true);
    const queued = await running.api(`/${id}/fetch`, 'POST', {});
    assert.equal(queued.status, 202);
    assert.equal(queued.body.status, 'queued');
    for (let index = 0; index < 30 && !callCount; index++) await delay(5);
    await running.api(`/${id}/cancel`, 'POST', {}); await delay(20);
    const cancelled = (await running.api(`/${id}`)).body; assert.equal(cancelled.status, 'cancelled', cancelled.error);
    assert.equal((await running.api(`/${id}`)).body.cues.length, 0);
    assert.equal((await running.api(`/${id}/fetch`, 'POST', {})).status, 202);
    const result = await running.waitFor(id, ['ready', 'failed']);
    assert.equal(result.status, 'ready');
    assert.equal(result.cues[0].text, '真实字幕');
    assert.equal(result.cues[0].start, 1);
    release(); await delay(15);
    assert.equal((await running.api(`/${id}`)).body.status, 'ready');
  } finally { release(); await running.close(); }
});

test('video fetch can continue directly into source organization and validates automatic AI before remote work', async () => {
  let calls = 0;
  const fetchSource = async () => { calls++; return { text: srt, format: 'srt', sourceName: '本地语音转写' }; };
  fetchSource.kind = 'local';
  const running = await harness({ fetchSource });
  try {
    assert.equal((await running.api('')).body.capabilities.sourceKind, 'local');
    const created = (await running.api('', 'POST', { courseId: course.id, title: '一次操作', url: 'BV1B7411m7LV' })).body;
    assert.equal((await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'bad' })).status, 400);
    assert.equal((await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'ai' })).status, 503);
    assert.equal(calls, 0);
    assert.equal((await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'extractive' })).status, 202);
    const lesson = await running.waitFor(created.id, ['completed', 'failed']);
    assert.equal(lesson.status, 'completed');
    assert.equal(lesson.notes.mode, 'extractive');
    assert.equal(lesson.notes.coverage.processedCueCount, 3);
    assert.ok(lesson.notes.examples[0].solution.includes('f′(2)=4'));
    assert.equal(calls, 1);
  } finally { await running.close(); }
});

test('verified local ASR preserves sparse markers, marks review cues and survives restart', async () => {
  const body = [
    { from: 0, to: 9, content: '定义原文。'.repeat(100) + '\uFFFD' },
    { from: 10, to: 19, content: '应回听的另一段。'.repeat(100) },
    { from: 20, to: 29, content: '例题原文。'.repeat(100) + '\uFFFD\uFFFD' },
    { from: 30, to: 39, content: '无需标记的完整原文。'.repeat(100) },
  ];
  const fetchSource = async () => ({ text: JSON.stringify({ body }), format: 'json', sourceName: '本地自动语音转写', warnings: ['基础转写提示。'], provenance: { source_kind: 'asr', review_ranges: [{ from: 15, to: 16 }], private_path: 'DO-NOT-STORE' } });
  fetchSource.kind = 'local';
  let running = await harness({ fetchSource });
  const dir = running.dir;
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '有界标记来源', url: 'BV1CAxaeHEeH', part: 3 })).body;
    assert.equal((await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'extractive' })).status, 202);
    const lesson = await running.waitFor(created.id, ['completed', 'failed']);
    assert.equal(lesson.status, 'completed', lesson.error);
    assert.deepEqual(lesson.cues.map(cue => cue.text), body.map(cue => cue.content));
    assert.deepEqual(lesson.cues.map(cue => [cue.start, cue.end]), body.map(cue => [cue.from, cue.to]));
    assert.deepEqual(lesson.sourceDiagnostics.reviewCueIds, ['cue-1', 'cue-2', 'cue-3']);
    assert.match(lesson.sourceDiagnostics.warnings[0], /3 个.*字符.*2 段.*保留.*回听/);
    assert.ok(lesson.sourceDiagnostics.warnings.includes('基础转写提示。'));
    assert.ok(lesson.notes.warnings.includes(lesson.sourceDiagnostics.warnings[0]));
    assert.equal(lesson.notes.coverage.processedCueCount, 4);
    assert.equal(JSON.stringify(lesson).includes('DO-NOT-STORE'), false);
    assert.equal(JSON.stringify(lesson).includes('allowSparseAsrMarkers'), false);
    await running.close(false);
    running = await harness({ dir });
    const restored = (await running.api(`/${lesson.id}`)).body;
    assert.deepEqual(restored.cues, lesson.cues);
    assert.deepEqual(restored.sourceDiagnostics, lesson.sourceDiagnostics);
    assert.deepEqual(restored.notes, lesson.notes);
  } finally { await running.close(); }
});

test('public source routes cannot opt into ASR marker compatibility or overwrite valid source on failure', async () => {
  const running = await harness();
  const forged = { text: asrMarkerSource(), format: 'json', sourceName: '本地自动语音转写', allowSparseAsrMarkers: true, kind: 'local', options: { allowSparseAsrMarkers: true }, provenance: { source_kind: 'asr', processed_entire_selected_audio: true } };
  try {
    const attempt = await running.api('', 'POST', { ...forged, transcript: forged.text, title: '伪造内部来源', courseId: course.id });
    assert.equal(attempt.status, 400);
    assert.equal((await running.api('')).body.lessons.length, 0);
    const created = (await running.api('', 'POST', { courseId: course.id, title: '保留已验证来源', transcript: srt, format: 'srt' })).body;
    await running.api(`/${created.id}/analyze`, 'POST', { mode: 'extractive' });
    const previous = await running.waitFor(created.id, ['completed', 'failed']);
    assert.equal(previous.status, 'completed');
    for (const text of [forged.text, forged.text.replace(/\uFFFD/g, '\\ufffd')]) {
      const changed = await running.api(`/${created.id}/source`, 'PUT', { ...forged, text });
      assert.equal(changed.status, 400);
      const latest = (await running.api(`/${created.id}`)).body;
      assert.deepEqual(latest.cues, previous.cues);
      assert.deepEqual(latest.notes, previous.notes);
      assert.deepEqual(latest.sourceDiagnostics, previous.sourceDiagnostics);
    }
  } finally { await running.close(); }
});

test('external and non-ASR fetches cannot claim local marker compatibility', async () => {
  for (const [kind, sourceKind] of [[undefined, 'asr'], ['external', 'asr'], ['local', 'platform-subtitles'], ['local', 'local-asr'], ['local', undefined]]) {
    const fetchSource = async () => ({ text: asrMarkerSource(), format: 'json', sourceName: '伪装转写', allowSparseAsrMarkers: true, provenance: { source_kind: sourceKind, processed_entire_selected_audio: true } });
    if (kind) fetchSource.kind = kind;
    const running = await harness({ fetchSource });
    try {
      const created = (await running.api('', 'POST', { courseId: course.id, title: '限定可信入口', url: 'BV1CAxaeHEeH', part: 3 })).body;
      await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'extractive', allowSparseAsrMarkers: true });
      const failed = await running.waitFor(created.id, ['completed', 'failed']);
      assert.equal(failed.status, 'failed', `${kind}/${sourceKind}`);
      assert.deepEqual(failed.cues, []);
      assert.equal(failed.notes, undefined);
      assert.equal(running.state.documents.length, 0);
    } finally { await running.close(); }
  }
});

test('failed ASR marker import stays retryable and accepts a later bounded source without losing markers', async () => {
  let calls = 0;
  const fetchSource = async () => ({ text: ++calls === 1 ? asrMarkerSource(3, 599) : asrMarkerSource(), format: 'json', sourceName: '本地自动语音转写', provenance: { source_kind: 'asr' } });
  fetchSource.kind = 'local';
  const running = await harness({ fetchSource });
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '失败后重试', url: 'BV1CAxaeHEeH', part: 3 })).body;
    await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'extractive' });
    const failed = await running.waitFor(created.id, ['completed', 'failed']);
    assert.equal(failed.status, 'failed'); assert.deepEqual(failed.cues, []); assert.equal(failed.notes, undefined);
    assert.equal((await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'extractive' })).status, 202);
    const completed = await running.waitFor(created.id, ['completed', 'failed']);
    assert.equal(completed.status, 'completed', completed.error);
    assert.equal(completed.cues[0].text, JSON.parse(asrMarkerSource()).body[0].content);
    assert.equal((completed.cues[0].text.match(/\uFFFD/g) || []).length, 3);
    assert.deepEqual(completed.sourceDiagnostics.reviewCueIds, ['cue-1']);
    assert.equal(completed.error, undefined);
    assert.equal(calls, 2);
  } finally { await running.close(); }
});

test('cancelled video import never runs stale follow-up analysis after a replacement source', async () => {
  let release, began;
  const pending = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { began = resolve; });
  const running = await harness({ fetchSource: async () => { began(); await pending; return { text: srt, format: 'srt', sourceName: '过期视频来源' }; } });
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '失效来源', url: 'BV1B7411m7LV' })).body;
    await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'extractive' }); await started;
    await running.api(`/${created.id}/cancel`, 'POST', {});
    await running.api(`/${created.id}/source`, 'PUT', { text: '新材料：矩阵定义。', format: 'txt' });
    release(); await delay(20);
    const current = (await running.api(`/${created.id}`)).body;
    assert.equal(current.status, 'ready');
    assert.equal(current.cues[0].text, '新材料：矩阵定义。');
    assert.equal(current.notes, undefined);
  } finally { release(); await running.close(); }
});

test('automatic AI follow-up owns a fresh cancellation controller after video source is stored', async () => {
  let release, began;
  const pending = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { began = resolve; });
  const model = await modelServer(async (source) => { began(); await pending; return { sections: [{ title: '旧视频讲义', text: '旧结果', cueIds: [source.untrustedSourceCues[0].id] }], examples: [] }; });
  const running = await harness({ provider: model.provider, fetchSource: async () => ({ text: srt, format: 'srt', sourceName: '视频来源' }) });
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '跟随任务', url: 'BV1B7411m7LV' })).body;
    await running.api(`/${created.id}/fetch`, 'POST', { analyzeMode: 'ai' }); await started;
    assert.equal((await running.api(`/${created.id}/cancel`, 'POST', {})).body.status, 'cancelled');
    await running.api(`/${created.id}/source`, 'PUT', { text: '替换后的原文。', format: 'txt' });
    release(); await delay(25);
    const current = (await running.api(`/${created.id}`)).body;
    assert.equal(current.status, 'ready');
    assert.equal(current.cues[0].text, '替换后的原文。');
    assert.equal(current.notes, undefined);
  } finally { release(); await running.close(); await model.close(); }
});

test('source persists across restart; interrupted work becomes visibly retryable', async () => {
  let running = await harness();
  const dir = running.dir;
  try {
    const created = await running.api('', 'POST', { courseId: course.id, title: '持久化讲次', transcript: srt, format: 'srt' });
    await running.close(false);
    const filename = path.join(dir, 'lessons.json');
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    saved.lessons[0].status = 'analyzing';
    fs.writeFileSync(filename, JSON.stringify(saved), 'utf8');
    running = await harness({ dir });
    const restored = (await running.api(`/${created.body.id}`)).body;
    assert.equal(restored.status, 'failed');
    assert.ok(restored.error.includes('服务已重启'));
    assert.equal(restored.cues.length, 3);
    assert.equal((await running.api(`/${restored.id}/analyze`, 'POST', { mode: 'extractive' })).status, 202);
    assert.equal((await running.waitFor(restored.id)).status, 'completed');
  } finally { await running.close(); }
});

test('reset and course-removal hooks remove persisted lecture sources and cancel queued work', async () => {
  const running = await harness();
  try {
    const create = (title) => running.api('', 'POST', { courseId: course.id, title, transcript: srt, format: 'srt' });
    const first = (await create('第一讲')).body;
    assert.equal(running.manager.removeCourse(course.id), 1);
    assert.equal((await running.api(`/${first.id}`)).status, 404);
    assert.equal((await running.api('')).body.lessons.length, 0);
    await create('第二讲');
    await create('第三讲');
    assert.equal(running.manager.reset(), 2);
    assert.equal((await running.api('')).body.lessons.length, 0);
    const stored = JSON.parse(fs.readFileSync(path.join(running.dir, 'lessons.json'), 'utf8'));
    assert.deepEqual(stored.lessons, []);
  } finally { await running.close(); }
});

function fakeVision(dir, { enabled = true, beforeRead } = {}) {
  const calls = [], removed = [];
  const assetPath = (lessonId, evidenceId, frameId) => path.join(dir, 'lesson-visual', lessonId, evidenceId, `${frameId}.jpg`);
  return {
    calls, removed, assetPath, configured: () => enabled,
    async capture(lesson) {
      calls.push('capture');
      const id = 'evidence-one';
      const frames = [10, 25].map((time, index) => ({ id: `frame-000${index + 1}`, time, fileName: `frame-000${index + 1}.jpg`, imagePath: assetPath(lesson.id, id, `frame-000${index + 1}`), width: 1280, height: 720 }));
      fs.mkdirSync(path.dirname(frames[0].imagePath), { recursive: true });
      for (const frame of frames) fs.writeFileSync(frame.imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return { id, lessonId: lesson.id, status: 'captured', frames, observations: [], coverage: { durationSeconds: 30, complete: false } };
    },
    async read(evidence) {
      calls.push('read'); await beforeRead?.();
      return { ...evidence, status: 'completed', observations: evidence.frames.map(frame => ({ frameId: frame.id, time: frame.time, visibleText: '左导数与右导数；可导的充要条件。', latex: ["f'_-(x_0)=f'_+(x_0)"], description: '黑板公式', uncertainties: ['边缘符号需要核对'], inferences: ['外部推断不可当作事实'] })) };
    },
    async remove(id) { removed.push(id); fs.rmSync(path.join(dir, 'lesson-visual', id), { recursive: true, force: true }); },
  };
}

test('visual queue preserves raw cues, serves only owned images and uses recognized visual evidence separately', async () => {
  const running = await harness({ visionFactory: dir => fakeVision(dir) });
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '导数', url: 'BV1Eb411u7Fw', part: 20, transcript: srt, format: 'srt' })).body;
    const before = created.cues;
    assert.equal((await running.api('')).body.capabilities.vision, true);
    assert.equal((await running.api(`/${created.id}/visual`, 'POST', { mode: 'capture' })).status, 202);
    let lesson = await running.waitFor(created.id, ['ready', 'failed']);
    assert.equal(lesson.visual.status, 'captured'); assert.equal(lesson.visualCues.length, 0);
    assert.equal(JSON.stringify(lesson.visual).includes('imagePath'), false);
    const image = await fetch(`${running.base}${lesson.visual.frames[0].imageUrl}`);
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(`${running.base}/api/lessons/${lesson.id}/visual/another-evidence/frame-0001`)).status, 404);
    assert.equal((await running.api(`/${lesson.id}/visual`, 'POST', { mode: 'read', analyzeMode: 'extractive' })).status, 202);
    lesson = await running.waitFor(lesson.id, ['completed', 'failed']);
    assert.equal(lesson.status, 'completed'); assert.deepEqual(lesson.cues, before);
    assert.equal(lesson.visualCues.length, 2); assert.equal(lesson.visualCues[0].id, 'visual-frame-0001');
    assert.equal(lesson.visualCues.some(cue => cue.text.includes('外部推断')), false);
    assert.equal(lesson.notes.coverage.visual, true); assert.equal(lesson.notes.coverage.visualComplete, false);
    assert.equal(lesson.notes.coverage.recognizedFrameCount, 2); assert.equal(lesson.notes.coverage.cueCount, before.length + 2);
    assert.ok(lesson.notes.sections.some(section => section.frameIds?.includes('frame-0001')));
    await running.api(`/${lesson.id}`, 'DELETE');
    assert.ok(running.visionService.removed.includes(lesson.id));
    assert.equal((await fetch(`${running.base}${lesson.visual.frames[0].imageUrl}`)).status, 404);
  } finally { await running.close(); }
});

test('captured frames are not described as recognized when a vision model is unavailable', async () => {
  const running = await harness({ visionFactory: dir => fakeVision(dir, { enabled: false }) });
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '未接视觉模型', url: 'BV1Eb411u7Fw', transcript: '已有来源文字。' })).body;
    await running.api(`/${created.id}/visual`, 'POST', { analyzeMode: 'extractive' });
    const lesson = await running.waitFor(created.id, ['completed', 'failed']);
    assert.equal(lesson.notes.coverage.visual, false); assert.equal(lesson.notes.coverage.recognizedFrameCount, 0);
    assert.equal(lesson.visual.status, 'captured'); assert.deepEqual(running.visionService.calls, ['capture']);
    assert.equal((await running.api(`/${created.id}/visual`, 'POST', { mode: 'read' })).status, 503);
  } finally { await running.close(); }
});

test('fetch -> visual -> AI interleaves sources, validates corrections and stores only safe speech diagnostics', async () => {
  const model = await modelServer(source => {
    const raw = source.untrustedSourceCues.find(cue => !cue.frameId);
    return { sections: [{ title: '校对后的讲义', text: '左导数与右导数须分别存在且相等。', cueIds: source.untrustedSourceCues.map(cue => cue.id), frameIds: ['frame-0001'] }], examples: [],
      corrections: [{ cueIds: [raw.id], frameIds: ['frame-0001'], original: '左老数', corrected: '左导数', reason: '已识别板书使用左导数。' }] };
  });
  const fetchSource = async () => ({ text: JSON.stringify({ body: [{ from: 0, to: 15, content: '左老数与右老数需要分别存在。' }, { from: 20, to: 30, content: '最后是可导的充要条件。' }] }), format: 'json', sourceName: '语音转写', warnings: ['转写可能有误。'], provenance: { source_kind: 'local-asr', review_ranges: [{ from: 0, to: 11 }], private_path: 'DO-NOT-STORE' } });
  const running = await harness({ provider: model.provider, fetchSource, visionFactory: dir => fakeVision(dir) });
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '一次完整处理', url: 'BV1Eb411u7Fw' })).body;
    await running.api(`/${created.id}/fetch`, 'POST', { withVisual: true, analyzeMode: 'ai' });
    const lesson = await running.waitFor(created.id, ['completed', 'failed']);
    assert.equal(lesson.status, 'completed', lesson.error); assert.equal(lesson.cues[0].text, '左老数与右老数需要分别存在。');
    assert.equal(lesson.notes.corrections[0].original, '左老数'); assert.equal(lesson.notes.corrections[0].corrected, '左导数');
    assert.equal(lesson.notes.corrections[0].needsReview, true);
    assert.deepEqual(lesson.sourceDiagnostics, { kind: 'local-asr', warnings: ['转写可能有误。'], reviewCueIds: ['cue-1'] });
    assert.equal(JSON.stringify(lesson).includes('DO-NOT-STORE'), false);
    assert.deepEqual(running.visionService.calls, ['capture', 'read']);
    const input = model.requests[0].source;
    assert.deepEqual(input.untrustedSourceCues.map(cue => cue.start), [0, 10, 20, 25]);
    assert.equal(input.identifiedVisualFacts.length, 2);
    assert.deepEqual(lesson.notes.sections[0].frameIds, ['frame-0001']);
    await running.api(`/${lesson.id}/source`, 'PUT', { text: '人工修订后的原文。' });
    const updated = (await running.api(`/${lesson.id}`)).body;
    assert.equal(updated.visual.id, lesson.visual.id); assert.equal(updated.notes, undefined);
  } finally { await running.close(); await model.close(); }
});

test('model corrections must quote real source and cannot fabricate unsupported formula corrections', () => {
  const cues = [{ id: 'cue-1', start: 0, end: 10, text: '公式是F,F,F。左老数。' }];
  const base = { sections: [{ title: '定义', text: '原文整理', cueIds: ['cue-1'] }] };
  const fabricated = validateLessonModelResult({ ...base, corrections: [{ cueIds: ['cue-1'], original: '不存在的原文', corrected: '猜测', reason: '猜测' }] }, cues);
  assert.deepEqual(fabricated.corrections, []); assert.match(fabricated.warnings[0], /校对候选未通过/);
  const forged = validateLessonModelResult({ ...base, corrections: [{ cueIds: ['cue-1'], frameIds: ['forged'], original: '左老数', corrected: '左导数', reason: '猜测' }] }, cues);
  assert.deepEqual(forged.corrections, []);
  const result = validateLessonModelResult({ ...base, corrections: [{ cueIds: ['cue-1'], original: 'F,F,F', corrected: 'f(x)=x^2', reason: '公式校正' }] }, cues);
  assert.equal(result.corrections[0].corrected, ''); assert.match(result.corrections[0].reason, /缺少画面证据/);
  const withVisual = [...cues, { id: 'visual-frame-0001', frameId: 'frame-0001', start: 0, end: null, text: '板书原文。' }];
  const mapped = validateLessonModelResult({ sections: [{ title: '板书', text: '图上内容', cueIds: ['frame-0001'], frameIds: ['visual-frame-0001'] }] }, withVisual, { frames: [{ frameId: 'frame-0001' }] });
  assert.deepEqual(mapped.sections[0].cueIds, ['visual-frame-0001']); assert.deepEqual(mapped.sections[0].frameIds, ['frame-0001']);
  assert.throws(() => validateLessonModelResult({ sections: [{ title: '伪造', text: '猜测', cueIds: ['frame-9999'] }] }, withVisual, { frames: [{ frameId: 'frame-0001' }] }), /来源引用/);
});

test('ASR correction quotes restore only real whitespace, never invented source characters', () => {
  const cues = [{ id: 'cue-22', start: 0, end: 3, text: '说  h 去与零负' }, { id: 'cue-23', start: 3, end: 6, text: '用 f  f 临加 h 尖 f 与 s 临比 h' }];
  const value = { sections: [{ title: '定义', text: '整理', cueIds: ['cue-22'] }], corrections: [{ cueIds: ['cue-22', 'cue-23'], frameIds: ['frame-0001'], original: '说 h 去与零负 用 f f 临加 h 尖 f 与 s 临比 h', corrected: '依据板书的公式候选', reason: '图中文字' }] };
  const validated = validateLessonModelResult(value, cues, { frames: [{ frameId: 'frame-0001' }] });
  assert.equal(validated.corrections[0].original, `${cues[0].text}\n${cues[1].text}`);
  const changedCharacters = structuredClone(value); changedCharacters.corrections[0].original += '根本不存在的字';
  assert.equal(validateLessonModelResult(changedCharacters, cues, { frames: [{ frameId: 'frame-0001' }] }).corrections.length, 0);
});

test('a nearby supplied frame fact can relocate its visual cue alias without accepting cross-block raw cues', () => {
  const cues = [{ id: 'cue-1', start: 0, end: 10, text: '本块原文。' }];
  const frames = [{ frameId: 'frame-0013' }, { frameId: 'frame-0014' }, { frameId: 'frame-0016' }];
  const value = { sections: [{ title: '左导数', text: '由给出的板书整理。', cueIds: ['cue-1', 'visual-frame-0016'], frameIds: ['frame-0013', 'frame-0014', 'frame-0016'] }] };
  const validated = validateLessonModelResult(value, cues, { frames });
  assert.deepEqual(validated.sections[0].cueIds, ['cue-1']); assert.deepEqual(validated.sections[0].frameIds, ['frame-0013', 'frame-0014', 'frame-0016']);
  const onlyFrame = structuredClone(value); onlyFrame.sections[0].cueIds = ['visual-frame-0016-2'];
  assert.deepEqual(validateLessonModelResult(onlyFrame, cues, { frames }).sections[0].cueIds, []);
  const unknownRaw = structuredClone(value); unknownRaw.sections[0].cueIds.push('cue-29');
  assert.throws(() => validateLessonModelResult(unknownRaw, cues, { frames }), /来源引用/);
  const unknownFrame = structuredClone(value); unknownFrame.sections[0].cueIds.push('visual-frame-0048');
  assert.throws(() => validateLessonModelResult(unknownFrame, cues, { frames }), /来源引用/);
});

test('reset and course removal clean the associated visual evidence without changing other courses', async () => {
  const running = await harness({ visionFactory: dir => fakeVision(dir) });
  try {
    const first = (await running.api('', 'POST', { courseId: course.id, title: '带图来源', url: 'BV1Eb411u7Fw' })).body;
    await running.api(`/${first.id}/visual`, 'POST', { mode: 'capture' });
    const captured = await running.waitFor(first.id, ['waiting_source', 'failed']);
    const file = running.visionService.assetPath(first.id, captured.visual.id, 'frame-0001');
    assert.ok(fs.existsSync(file));
    running.manager.removeCourse(course.id); assert.equal(fs.existsSync(file), false);
    const second = (await running.api('', 'POST', { courseId: course.id, title: '重置带图来源', url: 'BV1Eb411u7Fw' })).body;
    await running.api(`/${second.id}/visual`, 'POST', { mode: 'capture' }); await running.waitFor(second.id, ['waiting_source', 'failed']);
    assert.equal(running.manager.reset(), 1); assert.ok(running.visionService.removed.includes(second.id));
    assert.equal(fs.existsSync(path.join(running.dir, 'lesson-visual', second.id)), false);
  } finally { await running.close(); }
});

test('cancelled visual recognition cannot restore stale notes after the source is replaced', async () => {
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const running = await harness({ visionFactory: dir => fakeVision(dir, { beforeRead: async () => { started(); await pending; } }) });
  try {
    const created = (await running.api('', 'POST', { courseId: course.id, title: '取消画面', url: 'BV1Eb411u7Fw', transcript: '最初来源。' })).body;
    await running.api(`/${created.id}/visual`, 'POST', { analyzeMode: 'extractive' }); await began;
    await running.api(`/${created.id}/cancel`, 'POST', {});
    await running.api(`/${created.id}/source`, 'PUT', { text: '更新来源。' });
    release(); await delay(25);
    const lesson = (await running.api(`/${created.id}`)).body;
    assert.equal(lesson.status, 'ready'); assert.equal(lesson.cues[0].text, '更新来源。'); assert.equal(lesson.notes, undefined);
    assert.equal(lesson.visual.status, 'captured');
  } finally { release(); await running.close(); }
});

test('batch import queues selected parts, skips duplicates and auto-archives finished lectures', async () => {
  const bvidUrl = 'https://www.bilibili.com/video/BV1xx411c7mD';
  const calls = [];
  const fetchSource = async (lesson) => { calls.push(lesson.part); return { text: srt, format: 'srt', sourceName: '本地语音转写' }; };
  fetchSource.kind = 'local';
  const running = await harness({ fetchSource });
  try {
    assert.equal((await running.api('/import', 'POST', { courseId: course.id, url: bvidUrl, items: [], analyzeMode: 'extractive', autoPublish: true })).status, 400);
    assert.equal((await running.api('/import', 'POST', { courseId: course.id, url: 'https://example.com/video/BV1xx411c7mD', items: [{ part: 1 }], analyzeMode: 'extractive', autoPublish: true })).status, 400);
    assert.equal((await running.api('/import', 'POST', { courseId: course.id, url: bvidUrl, items: [{ part: 1 }, { part: 1 }], analyzeMode: 'extractive', autoPublish: true })).status, 400);
    assert.equal((await running.api('/import', 'POST', { courseId: course.id, url: bvidUrl, items: [{ part: 1 }], analyzeMode: 'ai', autoPublish: true })).status, 503);
    assert.equal((await running.api('/import', 'POST', { courseId: 'missing', url: bvidUrl, items: [{ part: 1 }], analyzeMode: 'extractive', autoPublish: true })).status, 404);

    const imported = await running.api('/import', 'POST', { courseId: course.id, url: bvidUrl, items: [{ part: 1, title: '极限' }, { part: 2, title: '导数' }], analyzeMode: 'extractive', autoPublish: true, scope: '导数' });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.created.length, 2);
    assert.equal(imported.body.skipped.length, 0);
    const done = [];
    for (const lesson of imported.body.created) done.push(await running.waitFor(lesson.id, ['completed', 'failed']));
    assert.deepEqual(done.map(lesson => lesson.status), ['completed', 'completed'], JSON.stringify(done.map(lesson => ({ part: lesson.part, error: lesson.error, failedStage: lesson.failedStage }))));
    assert.equal(running.state.documents.length, 2);
    assert.ok(done.every(lesson => lesson.documentId && !lesson.archiveError));
    assert.deepEqual(calls.sort(), [1, 2]);

    const again = await running.api('/import', 'POST', { courseId: course.id, url: `${bvidUrl}?p=1`, items: [{ part: 1 }, { part: 3, title: '积分' }], analyzeMode: 'extractive', autoPublish: false });
    assert.equal(again.status, 201);
    assert.equal(again.body.created.length, 1);
    assert.equal(again.body.created[0].part, 3);
    assert.equal(again.body.skipped.length, 1);
    assert.match(again.body.skipped[0].reason, /已在/);
    await running.waitFor(again.body.created[0].id, ['completed', 'failed']);
    assert.equal(running.state.documents.length, 2);
  } finally { await running.close(); }
});

test('batch Raw metadata is immutable and one Wiki-derived Output job starts after the whole batch', async () => {
  const bvidUrl = 'https://www.bilibili.com/video/BV1xx411c7mD', outputCalls = [];
  const fetchSource = async lesson => ({
    text: srt, format: 'srt', sourceName: 'B站公开字幕',
    rawPayload: { body: [{ from: 1, to: 2, content: `第${lesson.part}集原始字幕` }] },
    rawMetadata: { bvid: 'BV1xx411c7mD', part: lesson.part, title: `第${lesson.part}集` },
  });
  const running = await harness({ fetchSource, provider: { baseUrl: 'https://model.example/v1', apiKey: 'test', model: 'test' },
    createOutputJob: input => { outputCalls.push(input); return { id: 'output-job-1', status: 'queued' }; } });
  try {
    const rejected = await running.api('/import', 'POST', { courseId: course.id, url: bvidUrl, items: [{ part: 1 }], analyzeMode: 'extractive', autoPublish: false, autoOutput: 'review' });
    assert.equal(rejected.status, 400); assert.equal(outputCalls.length, 0);
    const imported = await running.api('/import', 'POST', { courseId: course.id, url: bvidUrl, items: [{ part: 1 }, { part: 2 }], analyzeMode: 'extractive', autoPublish: true, autoOutput: 'exam-checklist' });
    assert.equal(imported.status, 201);
    const done = [];
    for (const item of imported.body.created) done.push(await running.waitFor(item.id, ['completed', 'failed']));
    assert.ok(done.every(item => item.status === 'completed'), JSON.stringify(done.map(item => item.error)));
    assert.equal(outputCalls.length, 1); assert.equal(outputCalls[0].action, 'exam-checklist'); assert.equal(outputCalls[0].documentIds.length, 2);
    assert.ok(done.every(item => item.outputJobId === 'output-job-1' && item.outputKind === 'exam-checklist'));
    const rawStore = createRawStore({ dataDir: running.dir });
    for (const item of done) {
      assert.ok(item.rawMetadataRawRef); assert.equal(item.rawRefs.length, 3);
      const metadata = rawStore.read(item.rawMetadataRawRef, { verify: true });
      assert.equal(JSON.parse(metadata.data.toString('utf8')).part, item.part);
      assert.equal(metadata.manifest.kind, 'video-metadata');
    }
  } finally { await running.close(); }
});

test('catalog route is reachable before the lesson id route and surfaces validation errors', async () => {
  const running = await harness({ catalog: async (value) => {
    if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error('请填写有效的 B 站 BV 链接或 BV 号。'), { status: 400 });
    return { bvid: 'BV1xx411c7mD', title: '高数强化课', owner: '老师', pages: [{ part: 1, title: '极限', duration: 60 }], truncated: false };
  } });
  try {
    const listed = await running.api(`/bilibili?url=${encodeURIComponent('BV1xx411c7mD')}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.title, '高数强化课');
    assert.deepEqual(listed.body.pages, [{ part: 1, title: '极限', duration: 60 }]);
    assert.equal((await running.api('/bilibili')).status, 400);
  } finally { await running.close(); }
});
