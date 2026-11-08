import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createHandwritingParser } from '../server/handwriting.mjs';

const provider = { baseUrl: 'https://vision.example.test/v1', model: 'vision-test', apiKey: 'test-credential-never-real' };
const canvas = createCanvas(480, 320), context = canvas.getContext('2d');
context.fillStyle = '#fff'; context.fillRect(0, 0, 480, 320); context.fillStyle = '#111'; context.font = '24px sans-serif'; context.fillText('Derivative notes', 24, 60);
const png = canvas.toBuffer('image/png');
const file = (buffer = png, originalname = '高等数学笔记.png', mimetype = 'image/png') => ({ buffer, originalname, mimetype });
const reply = (value = { text: '单侧导数\n$f^{\prime}_{-}(x_0)=f^{\prime}_{+}(x_0)$\n[无法辨认]', uncertainties: ['第三行的上标需要核对'] }) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
const model = (fetchImpl, extra = {}) => createHandwritingParser({ provider, fetchImpl, ...extra });

function pdfDocument() {
  const content = 'BT /F1 18 Tf 20 250 Td (Derivative notes) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let text = '%PDF-1.4\n', offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

function fakePdf(total, { infoWait, renderWait, wrongPage = false } = {}) {
  const calls = [], instances = [];
  class Parser {
    constructor() { this.destroyed = false; instances.push(this); }
    async getInfo(options) {
      calls.push({ kind: 'info', options });
      if (infoWait) return new Promise(() => {});
      return { total, pages: Array.from({ length: total }, (_, index) => ({ pageNumber: index + 1, width: 480, height: 320 })) };
    }
    async getScreenshot(options) {
      calls.push({ kind: 'render', options });
      if (renderWait) return new Promise(() => {});
      return { total, pages: [{ pageNumber: wrongPage ? 999 : options.partial[0], data: png, width: 480, height: 320 }] };
    }
    async destroy() { this.destroyed = true; }
  }
  return { Parser, calls, instances };
}

test('handwriting image reads actual pixels inline and preserves review provenance without claiming formula accuracy', async () => {
  const requests = [];
  const parser = model(async (url, init) => { requests.push({ url: String(url), init, body: JSON.parse(init.body) }); return reply(); });
  assert.equal(parser.configured, true);
  assert.equal(parser.supports('notes.JPEG'), true); assert.equal(parser.supports('notes.pdf'), true); assert.equal(parser.supports('notes.svg'), false);
  const result = await parser.parse(file());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://vision.example.test/v1/chat/completions');
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${provider.apiKey}`);
  const image = requests[0].body.messages[1].content.find(item => item.type === 'image_url').image_url;
  assert.match(image.url, /^data:image\/jpeg;base64,/); assert.equal(image.detail, 'high');
  assert.ok(Buffer.from(image.url.split(',')[1], 'base64').length > 100);
  assert.match(requests[0].body.messages[0].content, /不推导、不总结、不纠错/);
  assert.equal(result.type, 'PNG'); assert.equal(result.locationKind, 'page');
  assert.equal(result.parser.engine, 'vision'); assert.equal(result.parser.formula, false); assert.equal(result.parser.handwriting, true);
  assert.equal(result.recognition.needsReview, true);
  assert.deepEqual(result.recognition.pages, [{ page: 1, warnings: ['第三行的上标需要核对'] }]);
  assert.equal(result.chunks[0].page, 1); assert.match(result.chunks[0].text, /\[无法辨认\]/);
  assert.equal(result.structure.blocks[0].id, result.chunks[0].blockId);
  assert.ok(!JSON.stringify(result).includes('data:image')); assert.ok(!JSON.stringify(result).includes(provider.apiKey));
});

test('JPEG and WebP decode paths accept native encoded pixels and normalize JPEG type', async () => {
  const parser = model(async () => reply({ text: 'notes', uncertainties: [] }));
  const jpeg = await parser.parse(file(canvas.toBuffer('image/jpeg'), 'note.JPEG', 'image/jpeg'));
  assert.equal(jpeg.type, 'JPG');
  const webp = await parser.parse(file(canvas.toBuffer('image/webp'), 'note.webp', 'image/webp'));
  assert.equal(webp.type, 'WEBP');
  assert.equal(webp.structure.pages[0].width, 480);
});

test('phone JPEG EXIF orientation is applied before recognition rather than rejecting a valid portrait photo', async () => {
  const jpeg = canvas.toBuffer('image/jpeg');
  const tiff = Buffer.alloc(26);
  tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(6, 18);
  const metadata = Buffer.concat([Buffer.from('Exif\0\0'), tiff]), marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1); marker.writeUInt16BE(metadata.length + 2, 2);
  const oriented = Buffer.concat([jpeg.subarray(0, 2), marker, metadata, jpeg.subarray(2)]);
  const result = await model(async () => reply({ text: '手机拍摄的笔记', uncertainties: [] })).parse(file(oriented, 'phone.jpg', 'image/jpeg'));
  assert.deepEqual(result.structure.pages[0], { page: 1, width: 320, height: 480 });
});

test('unsupported, spoofed, oversized and truncated files are rejected before any model request', async () => {
  let calls = 0;
  const parser = model(async () => { calls++; return reply(); });
  const oversizedDimensions = Buffer.from(png); oversizedDimensions.writeUInt32BE(16001, 16);
  const fakePng = Buffer.from(png.subarray(0, 33));
  const samples = [
    file(Buffer.from('hello'), 'x.png'), file(png, 'x.svg', 'image/svg+xml'), file(png, 'x.jpg', 'image/jpeg'),
    file(png, 'x.png', 'image/jpeg'), file(Buffer.alloc(0)), file(Buffer.alloc(20 * 1024 * 1024 + 1)), file(oversizedDimensions), file(fakePng),
    file(png, 'x.webp', 'image/webp'), file(Buffer.from('not a PDF'), 'x.pdf', 'application/pdf'),
  ];
  for (const sample of samples) await assert.rejects(parser.parse(sample), error => error.status === 422);
  assert.equal(calls, 0);
});

test('a valid header without decodable pixels cannot be sent to the model', async () => {
  const forged = Buffer.from(png); const idat = forged.indexOf(Buffer.from('IDAT'));
  forged.fill(0, idat + 4, Math.min(forged.length - 12, idat + 30));
  let calls = 0;
  await assert.rejects(model(async () => { calls++; return reply(); }).parse(file(forged)), error => error.status === 422);
  assert.equal(calls, 0);
});

test('disabled configuration and invalid remote endpoints never call a model', async () => {
  let calls = 0;
  for (const config of [{}, { baseUrl: 'http://vision.example.test', model: 'x', apiKey: 'private' }, { ...provider, baseUrl: 'https://user:private@example.test' }]) {
    const parser = createHandwritingParser({ provider: config, fetchImpl: async () => { calls++; return reply(); } });
    assert.equal(parser.configured, false);
    await assert.rejects(parser.parse(file()), error => error.status === 503);
  }
  assert.equal(calls, 0);
});

test('provider keys survive non-enumerable getters and multi-page work uses one explicit snapshot', async () => {
  const pdf = fakePdf(2), requests = [];
  let current = { ...provider };
  const getters = {};
  for (const field of ['baseUrl', 'model', 'apiKey']) Object.defineProperty(getters, field, { enumerable: field !== 'apiKey', get: () => current[field] });
  const parser = createHandwritingParser({ provider: () => getters, PDFParseClass: pdf.Parser, fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(init.body) });
    current = { baseUrl: 'https://changed.example.test/v2', model: 'changed', apiKey: 'changed-credential' };
    return reply({ text: `第${requests.length}页笔记`, uncertainties: [] });
  } });
  const result = await parser.parse(file(Buffer.from('%PDF-fake only metadata is injected'), 'notes.pdf', 'application/pdf'));
  assert.equal(requests.length, 2); assert.ok(requests.every(item => item.url.startsWith(provider.baseUrl)));
  assert.ok(requests.every(item => item.init.headers.Authorization === `Bearer ${provider.apiKey}`));
  assert.deepEqual(result.chunks.map(chunk => chunk.page), [1, 2]);
  assert.equal(result.recognition.pages.length, 2);
  assert.ok(pdf.calls.filter(item => item.kind === 'render').every(item => item.options.imageDataUrl === false && item.options.imageBuffer === true));
  assert.equal(pdf.instances[0].destroyed, true);
});

test('PDF page limit and unexpected renderer page IDs fail without silent truncation', async () => {
  for (const pdf of [fakePdf(9), fakePdf(1, { wrongPage: true })]) {
    let calls = 0;
    const parser = model(async () => { calls++; return reply(); }, { PDFParseClass: pdf.Parser });
    await assert.rejects(parser.parse(file(Buffer.from('%PDF-mocked'), 'notes.pdf', 'application/pdf')), error => error.status === 422);
    assert.equal(calls, 0); assert.equal(pdf.instances[0].destroyed, true);
  }
});

test('real PDF page rasterization supplies pixels to the model and preserves page 1', async () => {
  let calls = 0;
  const result = await model(async (_url, init) => { calls++; assert.match(JSON.parse(init.body).messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/); return reply({ text: 'Generated PDF test content', uncertainties: [] }); }).parse(file(pdfDocument(), 'generated.pdf', 'application/pdf'));
  assert.equal(calls, 1); assert.equal(result.type, 'PDF'); assert.equal(result.chunks[0].page, 1);
  assert.ok(result.structure.pages[0].width > 400);
});

test('invalid model JSON, empty text, invalid warnings and incomplete responses never produce a document', async () => {
  for (const value of [{}, { text: '', uncertainties: [] }, { text: '[无法辨认]', uncertainties: ['整页模糊'] }, { text: '可读', uncertainties: 'bad' }, { text: 'x'.repeat(16001), uncertainties: [] }]) {
    await assert.rejects(model(async () => reply(value)).parse(file()), error => [422, 502].includes(error.status));
  }
  await assert.rejects(model(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"text":"partial"' } }] }))).parse(file()), /输出限制/);
  await assert.rejects(model(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not JSON' } }] }))).parse(file()), /有效JSON/);
});

test('upstream errors are sanitized and any echoed configured credential is removed', async () => {
  await assert.rejects(model(async () => new Response(JSON.stringify({ error: provider.apiKey }), { status: 401 })).parse(file()), error => error.status === 502 && !error.message.includes(provider.apiKey));
  await assert.rejects(model(async () => { throw new Error(provider.apiKey); }).parse(file()), error => error.status === 502 && !error.message.includes(provider.apiKey));
  const result = await model(async () => reply({ text: `有效笔记 ${provider.apiKey}`, uncertainties: [provider.apiKey] })).parse(file());
  assert.ok(!JSON.stringify(result).includes(provider.apiKey));
});

test('bounded model streams are cancelled instead of retaining an oversized response', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(model(async () => new Response(stream), { maxResponseBytes: 512 }).parse(file()), /响应过大/);
  assert.equal(cancelled, true);
});

test('cancellation stops a non-cooperative model without leaking the supplied abort reason', async () => {
  const controller = new AbortController();
  const pending = model(async () => new Promise(() => {})).parse(file(), { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(new Error('private-reason')), 30);
  try { await assert.rejects(pending, error => error.status === 499 && !error.message.includes('private-reason')); }
  finally { clearTimeout(timer); }
});

test('per-page timeout bounds a non-cooperative model', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(model(async () => new Promise(() => {}), { requestTimeoutMs: 20 }).parse(file()), error => error.status === 504); }
  finally { clearTimeout(keepAlive); }
});

test('PDF cancellation destroys the renderer and a later failed page does not yield a partial document', async () => {
  const controller = new AbortController(), waiting = fakePdf(2, { infoWait: true });
  const pending = model(async () => reply(), { PDFParseClass: waiting.Parser }).parse(file(Buffer.from('%PDF-mocked'), 'notes.pdf', 'application/pdf'), { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 20);
  try { await assert.rejects(pending, error => error.status === 499); }
  finally { clearTimeout(timer); }
  assert.equal(waiting.instances[0].destroyed, true);
  const pdf = fakePdf(2); let calls = 0;
  await assert.rejects(model(async () => ++calls === 1 ? reply() : new Response('bad', { status: 503 }), { PDFParseClass: pdf.Parser }).parse(file(Buffer.from('%PDF-mocked'), 'notes.pdf', 'application/pdf')), error => error.status === 502);
  assert.equal(calls, 2); assert.equal(pdf.instances[0].destroyed, true);
});

test('DeepSeek vision uses official JSON mode, disables thinking and loopback model needs no key', async () => {
  for (const connection of [{ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'fake-test-key' }, { baseUrl: 'http://127.0.0.1:9999/v1', model: 'local', apiKey: '' }]) {
    await createHandwritingParser({ provider: connection, fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body);
      if (connection.apiKey) { assert.deepEqual(payload.response_format, { type: 'json_object' }); assert.deepEqual(payload.thinking, { type: 'disabled' }); }
      else assert.equal(init.headers.Authorization, undefined);
      return reply({ text: 'notes', uncertainties: [] });
    } }).parse(file());
  }
});
