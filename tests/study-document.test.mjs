import test from 'node:test';
import { htmlPdf } from '../server/study-document.mjs';

test('PDF renderer has a deadline and closes browsers that stall or finish launching too late', async () => {
  let closed = 0;
  const hung = { setDefaultTimeout() {}, setContent: () => new Promise(() => {}) };
  await assert.rejects(htmlPdf('<p>test</p>', { timeoutMs: 25, launchBrowser: async () => ({ newContext: async () => ({ route: async () => {}, newPage: async () => hung }), close: async () => { closed++; } }) }), /排版超时/);
  assert.equal(closed, 1);
  let lateResolve;
  const late = htmlPdf('<p>late</p>', { timeoutMs: 25, launchBrowser: () => new Promise(resolve => { lateResolve = resolve; }) });
  await assert.rejects(late, /排版超时/);
  lateResolve({ close: async () => { closed++; } }); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, 2);
});
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { PDFParse } from 'pdf-parse';
import { createApp } from '../server/index.mjs';
import { accountIdForEmail } from '../server/account-store.mjs';
import { workspacePath } from '../server/workspaces.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { documentTokens, studyDocumentHtml, studyDocumentWord, wordMath, createStudyDocumentExporter } from '../server/study-document.mjs';
import { studyNote } from './fixtures/study-note.mjs';
import { studioDocumentState } from './fixtures/studio-document-state.mjs';

test('document parser keeps mathematical delimiters, tables and source anchors while rejecting executable HTML', async () => {
  const tokens = documentTokens(studyNote), math = tokens.flatMap(t => t.children || []).filter(t => t.type === 'study_math');
  assert.ok(math.length > 12); assert.ok(tokens.some(t => t.type === 'study_math_block')); assert.ok(tokens.some(t => t.type === 'table_open'));
  const html = await studyDocumentHtml({ ...studyNote, body: studyNote.body + '\n<script>fetch("https://evil.invalid")</script>\n![remote](https://evil.invalid/pixel)\n[bad](javascript:alert(1))' });
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img')); assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /href="#source-s1"/); assert.match(html, /id="source-s1"/); assert.match(html, /data:font\/woff2;base64/);
  assert.match(html, /线性代数知识框架/);
  const literal = documentTokens({ title: '代码', body: '`$x$` 和 $x$' }).flatMap(t => t.children || []);
  assert.equal(literal.filter(t => t.type === 'study_math').length, 1); assert.ok(literal.some(t => t.type === 'code_inline' && t.content === '$x$'));
});

test('Word output is real OOXML with editable fractions, matrices, styles, source bookmarks and a valid package', async () => {
  const bytes = await studyDocumentWord(studyNote, { paginate:false }), zip = await JSZip.loadAsync(bytes), xml = await zip.file('word/document.xml').async('string');
  assert.equal(XMLValidator.validate(xml), true); assert.match(xml, /<m:f>/); assert.match(xml, /<m:m>/); assert.match(xml, /<m:rad>/); assert.match(xml, /<m:sSup>/);
  assert.match(xml, /w:pStyle w:val="Title"/); assert.match(xml, /w:anchor="source_s1"/); assert.match(xml, /w:name="source_s1"/);
  assert.match(xml, /w:anchor="heading_1"/); assert.match(xml, /目录/);
  assert.match(xml,/TOC \\o/); assert.match(xml,/PAGEREF heading_1/); assert.match(xml,/w:leader="dot"/);
  assert.ok(!xml.includes('\\frac')); assert.ok(!xml.includes('\\begin'));
  for (const file of Object.values(zip.files).filter(file => file.name.endsWith('.xml') || file.name.endsWith('.rels'))) assert.equal(XMLValidator.validate(await file.async('string')), true, file.name);
  assert.match(wordMath(String.raw`\frac{a+b}{c+d}`), /<m:num>.*a.*b.*<\/m:num>.*<m:den>.*c.*d/s);
});

test('PDF output contains searchable Chinese text, correct signatures and deduplicated cached output', async () => {
  const exporter = createStudyDocumentExporter();
  const [first, second] = await Promise.all([exporter.render(studyNote, 'pdf'), exporter.render(studyNote, 'pdf')]);
  assert.equal(first, second); assert.ok(first.subarray(0, 5).equals(Buffer.from('%PDF-')));
  const parser = new PDFParse({ data: first });
  try { const parsed = await parser.getText(); assert.ok(parsed.total >= 2); assert.match(parsed.text, /线性代数期末复习讲义/); assert.match(parsed.text, /来源索引/); assert.match(parsed.text, /零向量/); }
  finally { await parser.destroy(); }
  await assert.rejects(exporter.render(studyNote, 'exe'), /PDF 或 Word/);
});

test('long conventional contents stays compact and its page numbers agree with rendered chapter pages', async () => {
  const body = Array.from({length:3},(_,chapter)=>`## 主题${chapter+1}\n\n`+Array.from({length:5},(_,section)=>`### 方法${chapter+1}.${section+1}\n\n根据已有公式梳理解题条件与步骤，保留推导和出处。\n\n`).join('')).join('');
  const bytes = await createStudyDocumentExporter().render({...studyNote,body},'pdf');
  const parser = new PDFParse({data:bytes});
  try {
    const parsed = await parser.getText();
    assert.match(parsed.pages[0].text,/方法3\.5/);
    assert.match(parsed.pages[0].text,/主题1\s+2/);
    assert.match(parsed.pages[1].text,/主题1/);
    assert.ok(parsed.total>=2);
  } finally { await parser.destroy(); }
});

test('document APIs preserve old Markdown, serve real PDF/Word and retain the owner boundary', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-doc-api-'));
  let app = createApp({ dataDir, provider: {}, visionProvider: {}, videoFetcher: null }); app.emit('shifen:close');
  const filename = path.join(dataDir, 'state.json'), state = studioDocumentState(JSON.parse(await fs.readFile(filename, 'utf8')));
  await fs.writeFile(filename, JSON.stringify(state)); const before = await fs.readFile(filename);
  app = createApp({ dataDir, provider: {}, visionProvider: {}, videoFetcher: null, authEnabled: true });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); const base = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${base}/api/course-studio/artifacts/fixture-note/export`;
  try {
    assert.equal((await fetch(`${endpoint}?format=pdf`)).status, 401);
    const register = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '文档验收', email: 'document@example.test', password: 'fixture-only-password' }) });
    const cookie = register.headers.get('set-cookie').split(';')[0];
    for (const format of ['pdf', 'docx', 'md']) {
      const response = await fetch(`${endpoint}?format=${format}&inline=1`, { headers: { cookie } }); assert.equal(response.status, 200);
      assert.match(response.headers.get('content-disposition'), format === 'pdf' ? /^inline;/ : /^attachment;/);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (format === 'pdf') assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
      if (format === 'docx') assert.ok((await JSZip.loadAsync(bytes)).file('word/document.xml'));
      if (format === 'md') assert.match(bytes.toString(), /来源索引/);
    }
    assert.equal((await fetch(`${endpoint}?format=exe`, { headers: { cookie } })).status, 400);
    assert.equal((await fetch(`${base}/api/course-studio/artifacts/foreign/export?format=pdf`, { headers: { cookie } })).status, 404);
    const after = JSON.parse(await fs.readFile(path.join(workspacePath(dataDir, accountIdForEmail('document@example.test')), 'state.json'), 'utf8'));
    assert.deepEqual(after.courseStudio.artifacts, JSON.parse(before).courseStudio.artifacts); assert.deepEqual(after.documents, state.documents);
  } finally { app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir())); await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('lecture PDF/Word retain owned evidence images and teaching content without appending the full raw transcript', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-doc-lecture-'));
  const seed = createApp({ dataDir, provider: {}, visionProvider: {}, videoFetcher: null }); seed.emit('shifen:close');
  const courseId = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'))).courses[0].id;
  const canvas = createCanvas(320, 180), context = canvas.getContext('2d'); context.fillStyle = '#283c34'; context.fillRect(0, 0, 320, 180);
  const image = canvas.toBuffer('image/jpeg'), imageDir = path.join(dataDir, 'lesson-visual', 'lecture-doc', 'evidence-doc'); await fs.mkdir(imageDir, { recursive: true }); await fs.writeFile(path.join(imageDir, 'frame-0001.jpg'), image);
  const lecture = { id: 'lecture-doc', courseId, title: '文档格式验收讲次', url: '', part: 1, status: 'completed', cues: [{ id: 'cue-1', start: 10, end: 20, text: 'ONLY_RAW_TRANSCRIPT_SENTINEL' }],
    visual: { id: 'evidence-doc', frames: [{ id: 'frame-0001', time: 10, width: 320, height: 180 }] },
    notes: { mode: 'ai', overview: ['先判断题目条件。'], warnings: [], createdAt: '2026-11-05', coverage: { cueCount: 1, processedCueCount: 1, visual: true },
      sections: [{ id: 'section-1', title: '矩阵与特征值', text: '矩阵特征值需要满足 $Av=\\lambda v$，其中 $v\\ne0$。', teacherExplanation: '特征向量必须是非零向量。', cueIds: ['cue-1'], frameIds: ['frame-0001'] }], examples: [] } };
  await fs.writeFile(path.join(dataDir, 'lessons.json'), JSON.stringify({ version: 1, lessons: [lecture] }));
  const app = createApp({ dataDir, provider: {}, visionProvider: {}, videoFetcher: null }); const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lessons/lecture-doc/document`;
  try {
    const word = await fetch(`${base}?format=docx`); assert.equal(word.status, 200);
    const zip = await JSZip.loadAsync(Buffer.from(await word.arrayBuffer())), xml = await zip.file('word/document.xml').async('string');
    assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.jpg')).length, 1); assert.match(xml, /w:drawing/); assert.match(xml, /特征向量必须是非零向量/); assert.ok(!xml.includes('ONLY_RAW_TRANSCRIPT_SENTINEL'));
    assert.equal(XMLValidator.validate(xml), true);
    const pdf = await fetch(`${base}?format=pdf`); assert.equal(pdf.status, 200);
    const parser = new PDFParse({ data: Buffer.from(await pdf.arrayBuffer()) });
    try { const parsed = await parser.getText(); assert.match(parsed.text, /特征向量必须是非零向量/); assert.ok(!parsed.text.includes('ONLY_RAW_TRANSCRIPT_SENTINEL')); }
    finally { await parser.destroy(); }
  } finally { app.emit('shifen:close'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir())); await fs.rm(dataDir, { recursive: true, force: true }); }
});
