import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { renderLessonDocument } from '../server/lesson-export.mjs';
import { readLessonFrame } from '../server/lesson-assets.mjs';
import { createApp } from '../server/index.mjs';

const fixture = () => ({ id: 'lecture-a', title: '合成高数 <script>bad()</script>', url: 'https://www.bilibili.com/video/BV1CAxaeHEeH', part: 3,
  cues: [{ id: 'cue-1', start: 12, end: 20, text: '合成原文：方程条件需要核对。' }],
  visual: { id: 'evidence-a', frames: [{ id: 'frame-0001', time: 12, width: 1920, height: 1080 }] },
  notes: { overview: ['OLD_OVERVIEW'], sections: [{ title: 'OLD_SECTION', text: 'old' }], examples: [],
    readingOverview: ['先核对条件，再求解。'], readingSections: [{ id: 'read-a', title: '方程与条件', text: '考虑 \\(x^2-3x+2=0\\)。<img src=x onerror="bad()">', cueIds: ['cue-1'], frameIds: ['frame-0001'], teacherExplanation: '先因式分解，再检查结果。', steps: ['分解为 \\((x-1)(x-2)=0\\)。', '逐一代回原方程。'], pitfalls: ['不要遗漏定义域。'] }],
    readingExamples: [{ id: 'example-a', title: '合成题', prompt: '求解 \\(x^2-3x+2=0\\)。', solution: '因式分解。', detailedSolution: '分别令两个因式为零。', solutionSteps: ['得到 x=1 或 x=2。', '代回核对。'], cueIds: ['cue-1'], frameIds: ['frame-0001'] }], warnings: [] } });

test('offline document embeds course images and math fonts, uses reading chapters and separates teacher supplements', async () => {
  const lesson = fixture(), before = structuredClone(lesson); let reads = 0;
  const result = await renderLessonDocument(lesson, { readImage: async () => { reads++; return { bytes: Buffer.from([255,216,255,217]), mime: 'image/jpeg' }; } });
  assert.match(result.html, /data:image\/jpeg;base64,/);
  assert.match(result.html, /data:font\/woff2;base64,/);
  assert.doesNotMatch(result.html, /url\(fonts\//);
  assert.doesNotMatch(result.html, /(?:src|href)="\/api\//);
  assert.match(result.html, /AI 补充讲解/); assert.match(result.html, /AI 补充解题/);
  assert.match(result.html, /课堂解法/); assert.match(result.html, /完整讲解原文/);
  assert.match(result.html, /p=3&amp;t=12/); assert.match(result.html, /katex/);
  assert.doesNotMatch(result.html, /OLD_OVERVIEW|OLD_SECTION|<script>bad|<img src=x/);
  assert.match(result.html, /&lt;script&gt;bad/);
  assert.equal(reads, 1); assert.equal(result.imageCount, 1);
  assert.deepEqual(lesson, before);
});

test('missing images remain visible as an honest note, not a broken local API URL', async () => {
  const result = await renderLessonDocument(fixture(), { readImage: async () => { throw new Error('private path /secret'); } });
  assert.equal(result.missingImageCount, 1); assert.equal(result.imageCount, 0);
  assert.match(result.html, /原图暂不可用/); assert.match(result.html, /1 张引用图片未能打包/);
  assert.doesNotMatch(result.html, /private path|\/secret/);
  await assert.rejects(renderLessonDocument({ title: '未整理' }), { status: 422 });
});

test('visual-only lesson evidence retains its source time and count in the exported document', async () => {
  const lesson = fixture();
  lesson.cues = [];
  lesson.visualCues = [{ id: 'visual-cue-1', start: 84, end: 85, text: '画面可确认的题干。' }];
  lesson.notes.readingSections[0].cueIds = ['visual-cue-1'];
  lesson.notes.readingExamples[0].cueIds = ['visual-cue-1'];
  const result = await renderLessonDocument(lesson, { readImage: async () => ({ bytes: Buffer.from([255,216,255,217]), mime: 'image/jpeg' }) });
  assert.match(result.html, /p=3&amp;t=84/);
  assert.match(result.html, /1 段原文/);
});

test('export preserves the concrete missing condition instead of presenting an unfinished problem as solved', async () => {
  const lesson = fixture();
  Object.assign(lesson.notes.readingExamples[0], { explanationStatus: 'needs-confirmation', explanationGap: '请核对第二分支的集合条件 <script>bad()</script>。', detailedSolution: undefined, solutionSteps: [] });
  const result = await renderLessonDocument(lesson, { readImage: async () => ({ bytes: Buffer.from([255,216,255,217]), mime: 'image/jpeg' }) });
  assert.match(result.html, /请核对第二分支的集合条件 &lt;script&gt;bad/);
  assert.doesNotMatch(result.html, /<script>bad|AI 补充解题/);
});

async function temporary() { return fs.mkdtemp(path.join(os.tmpdir(), 'shifen-lecture-export-')); }
async function clean(directory) { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('shifen-lecture-export-')); await fs.rm(directory, { recursive: true, force: true }); }

test('frame reader owns the current lecture path, checks the hash and rejects wrong IDs and files', async () => {
  const directory = await temporary(), lesson = fixture();
  const bytes = Buffer.from([255,216,255,217]);
  lesson.visual.frames[0].sha256 = createHash('sha256').update(bytes).digest('hex');
  const folder = path.join(directory, 'lesson-visual', lesson.id, lesson.visual.id);
  try {
    await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, 'frame-0001.jpg'), bytes);
    assert.deepEqual((await readLessonFrame(directory, lesson, 'frame-0001')).bytes, bytes);
    await assert.rejects(readLessonFrame(directory, lesson, '../../auth'));
    await assert.rejects(readLessonFrame(directory, lesson, 'frame-0002'));
    await fs.writeFile(path.join(folder, 'frame-0001.jpg'), Buffer.from('not an image'));
    await assert.rejects(readLessonFrame(directory, lesson, 'frame-0001'));
  } finally { await clean(directory); }
});

test('document download stays behind the owner session and returns a portable HTML attachment', async () => {
  const directory = await temporary();
  const app = createApp({ dataDir: directory, authEnabled: true, videoFetcher: undefined, provider: {} });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const api = async (route, body) => {
    const response = await fetch(base + '/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    assert.ok(response.ok, `${route} failed ${response.status}`); return response.json();
  };
  try {
    assert.equal((await fetch(base + '/api/lessons/none/document')).status, 401);
    await api('/auth/register', { email: 'lecture-export@example.test', name: '合成测试', password: 'fixture-only-password' });
    const course = await api('/courses', { name: '合成课程', target: 80 });
    const lesson = await api('/lessons', { courseId: course.id, title: '离线讲义测试', transcript: '函数定义需要同时指定定义域和对应法则。', format: 'txt' });
    await api(`/lessons/${lesson.id}/analyze`, { mode: 'extractive' });
    for (let i=0; i<100; i++) { const state = await api(`/lessons/${lesson.id}`); if (state.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 20)); }
    const response = await fetch(base + `/api/lessons/${lesson.id}/document`, { headers: { cookie } });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-disposition'), /attachment;.*filename\*=UTF-8/);
    const html = await response.text(); assert.match(html, /函数定义/); assert.match(html, /本课目录/);
    assert.doesNotMatch(html, /fixture-only-password|dataDir|apiKey/);
  } finally { app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await clean(directory); }
});
