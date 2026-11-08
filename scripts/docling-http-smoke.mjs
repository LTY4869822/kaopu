// Real local Docling smoke test; synthetic input and isolated application data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';
import { createDocumentParser } from '../server/docling.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = await fs.readFile(path.join(root, '.local/docling-smoke/scan.pdf'));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-docling-http-'));
const parser = createDocumentParser();
const started = performance.now();
let app, server;
try {
  const status = await parser.status();
  assert.equal(status.available, true); assert.equal(status.ocrReady, true);
  app = createApp({ dataDir: directory, provider: {}, documentParser: parser });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const reset = await fetch(`${base}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'empty' }) });
  assert.equal(reset.status, 200); await reset.arrayBuffer();
  const body = new FormData();
  body.append('file', new Blob([input], { type: 'application/pdf' }), '线性代数扫描讲义.pdf');
  body.append('parseMode', 'auto');
  const response = await fetch(`${base}/documents/auto`, { method: 'POST', body, signal: AbortSignal.timeout(180_000) });
  const imported = await response.json();
  assert.equal(response.status, 201, JSON.stringify(imported));
  const { document, course } = imported;
  assert.equal(document.parser.engine, 'docling'); assert.equal(document.parser.ocr, true); assert.equal(document.parser.formula, false);
  assert.equal(document.hasOriginal, true); assert.equal(document.locationKind, 'page');
  assert.match(document.chunks.map(chunk => chunk.text).join(' '), /线性代数/);
  assert.match(document.chunks.map(chunk => chunk.text).join(' '), /Matrix/i);
  assert.ok(document.chunks.every(chunk => chunk.page === 1 && chunk.blockId && chunk.bbox && chunk.sourceRef));
  assert.equal(course.name, '线性代数');
  const original = await fetch(`${base}/documents/${document.id}/original`);
  assert.equal(original.status, 200); assert.deepEqual(Buffer.from(await original.arrayBuffer()), input);
  const state = await (await fetch(`${base}/state`)).json();
  const saved = state.documents.find(item => item.id === document.id);
  assert.deepEqual(saved.structure, document.structure);
  const report = { passed: true, isolatedData: true, elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(1)), parser: document.parser,
    course: course.name, chunks: document.chunks.length, pages: document.structure.pages, originalBytesVerified: true,
    sourceText: document.chunks.map(chunk => chunk.text), checks: ['auto detects image-only PDF', 'real local OCR', 'actual page and block provenance', 'automatic course classification', 'original bytes preserved', 'structured result persists'] };
  await fs.mkdir(path.join(root, 'test-results/integration'), { recursive: true });
  await fs.writeFile(path.join(root, 'test-results/integration/docling-http.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  app?.emit('shifen:close');
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('shifen-docling-http-'));
  await fs.rm(directory, { recursive: true, force: true });
}
