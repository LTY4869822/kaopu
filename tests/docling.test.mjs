import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { createDocumentParser, runDoclingProcess } from '../server/docling.mjs';

// Process-contract tests deliberately inject validation/runner. The integration
// verification also runs the real converter against synthetic Office/OCR files.
const file = (name = 'lesson.pdf') => ({ originalname: name, buffer: Buffer.from('%PDF-1.7\nsynthetic process-contract input\n') });
const nativeText = 'This is a sufficiently long native course paragraph about linear algebra and matrix multiplication. '.repeat(8);
const nativeResult = () => ({ type: 'PDF', locationKind: 'page', chunks: [{ id: 'native-1', page: 1, text: nativeText }] });
const probe = { available: true, version: '2.146.0', ocrReady: true, message: 'Docling ready' };
const converted = (type = 'PDF') => ({
  type, locationKind: type === 'DOCX' ? 'section' : 'page',
  parser: { engine: 'docling', version: '2.146.0', ocr: true, formula: false },
  chunks: [{ id: 'chunk-1', page: 1, text: '真实提取的矩阵定义与计算步骤。', blockId: 'block-1', sourceRef: '#/texts/0', ...(type === 'DOCX' ? { section: 1 } : { bbox: { l: 10, t: 20, r: 100, b: 40, coordOrigin: 'TOPLEFT' } }) }],
  structure: { blocks: [{ id: 'block-1', text: '真实提取的矩阵定义与计算步骤。', label: 'text', sourceRef: '#/texts/0', ...(type === 'DOCX' ? { section: 1 } : { page: 1, bbox: { l: 10, t: 20, r: 100, b: 40, coordOrigin: 'TOPLEFT' } }) }] },
});
const validateFile = async input => ({ extension: path.extname(input.originalname).toLowerCase(), pageCount: 1 });
const runner = (output = converted(), fn) => async request => {
  if (request.args.includes('--probe')) return { stdout: JSON.stringify(probe), exitCode: 0 };
  if (fn) return fn(request);
  return { stdout: JSON.stringify(output), exitCode: 0 };
};
const parser = options => createDocumentParser({ pythonPath: process.execPath, validateFile, nativeParser: async () => nativeResult(), runProcess: runner(), ...options });
const turn = () => new Promise(resolve => setImmediate(resolve));
const waitUntil = async condition => {
  for (let n = 0; n < 100 && !condition(); n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), 'the injected process should have started');
};

test('basic parsing always uses native extraction and never probes or launches Docling', async () => {
  let calls = 0;
  const documentParser = parser({ runProcess: async () => { calls++; throw new Error('unexpected process'); } });
  const result = await documentParser.parse(file(), { mode: 'basic' });
  assert.equal(result.parser.engine, 'native');
  assert.equal(result.chunks[0].text, nativeText);
  assert.equal(calls, 0);
});

test('auto keeps sufficient native text without loading a heavy parser', async () => {
  let calls = 0;
  const result = await parser({ runProcess: async () => { calls++; throw new Error('unexpected process'); } }).parse(file());
  assert.equal(result.parser.engine, 'native');
  assert.equal(calls, 0);
});

test('auto can recover a scanned PDF through Docling, preserving block evidence', async () => {
  const result = await parser({ nativeParser: async () => { throw Object.assign(new Error('没有提取到可用文字。这可能是扫描版 PDF。'), { status: 422 }); } }).parse(file());
  assert.equal(result.parser.engine, 'docling');
  assert.equal(result.parser.formula, false);
  assert.equal(result.chunks[0].blockId, result.structure.blocks[0].id);
  assert.deepEqual(result.chunks[0].bbox, converted().chunks[0].bbox);
  assert.equal(result.chunks[0].sourceRef, '#/texts/0');
});

test('structured mode reports unavailable Docling instead of silently returning native text', async () => {
  let nativeCalls = 0;
  const documentParser = parser({
    nativeParser: async () => { nativeCalls++; return nativeResult(); },
    runProcess: async () => ({ stdout: JSON.stringify({ available: false, ocrReady: false, message: 'not installed' }), exitCode: 0 }),
  });
  await assert.rejects(documentParser.parse(file(), { mode: 'structured' }), error => error.status === 503);
  assert.equal(nativeCalls, 0);
});

test('public status contains availability and an honest OCR readiness flag', async () => {
  const status = await parser().status();
  assert.equal(status.available, true);
  assert.equal(status.engine, 'docling');
  assert.equal(status.ocrReady, true);
  assert.equal(typeof status.message, 'string');
});

test('DOCX retains section locations without fabricating physical page provenance', async () => {
  const result = await parser({ runProcess: runner(converted('DOCX')) }).parse(file('lesson.docx'), { mode: 'structured' });
  assert.equal(result.locationKind, 'section');
  assert.equal(result.chunks[0].page, 1); // compatibility field is a section index
  assert.equal(result.structure.blocks[0].page, undefined);
  assert.equal(result.structure.blocks[0].section, 1);
});

test('conversion stages the actual buffer and removes its temporary input afterwards', async () => {
  let stagedPath;
  const input = file('private-original-name.pdf');
  const documentParser = parser({ runProcess: runner(undefined, async request => {
    stagedPath = request.args[request.args.indexOf('--input') + 1];
    assert.deepEqual(await readFile(stagedPath), input.buffer);
    assert.ok(!stagedPath.includes('private-original-name'));
    return { stdout: JSON.stringify(converted()), exitCode: 0 };
  }) });
  await documentParser.parse(input, { mode: 'structured' });
  assert.ok(stagedPath);
  await assert.rejects(access(stagedPath));
});

test('only one converter runs at once and queued jobs are eventually released', { timeout: 5000 }, async () => {
  let active = 0, maximum = 0, started = 0;
  const releases = [];
  const documentParser = parser({ runProcess: runner(undefined, async () => {
    active++; started++; maximum = Math.max(maximum, active);
    await new Promise(resolve => releases.push(resolve));
    active--;
    return { stdout: JSON.stringify(converted()), exitCode: 0 };
  }) });
  const first = documentParser.parse(file(), { mode: 'structured' });
  const second = documentParser.parse(file(), { mode: 'structured' });
  await waitUntil(() => started === 1);
  await turn();
  assert.equal(started, 1);
  releases.shift()();
  await first;
  await waitUntil(() => started === 2);
  releases.shift()();
  await second;
  assert.equal(maximum, 1);
});

test('an aborted running conversion rejects and frees the worker for the next file', { timeout: 5000 }, async () => {
  let started = 0;
  const documentParser = parser({ runProcess: runner(undefined, async ({ signal }) => {
    started++;
    if (started === 1) await new Promise((resolve, reject) => {
      if (signal.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      else signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
    return { stdout: JSON.stringify(converted()), exitCode: 0 };
  }) });
  const controller = new AbortController();
  const first = documentParser.parse(file(), { mode: 'structured', signal: controller.signal });
  const rejection = assert.rejects(first);
  await waitUntil(() => started === 1);
  controller.abort();
  await rejection;
  assert.equal((await documentParser.parse(file(), { mode: 'structured' })).parser.engine, 'docling');
  assert.equal(started, 2);
});

test('invalid or oversized converter responses never become usable course text', async () => {
  const outputs = [
    '{broken-json',
    JSON.stringify({ ...converted(), chunks: [{ id: 'too-long', page: 1, text: 'x'.repeat(1_000_001) }] }),
    'x'.repeat(8 * 1024 * 1024 + 1),
  ];
  for (const stdout of outputs) {
    await assert.rejects(parser({ runProcess: runner(undefined, async () => ({ stdout, exitCode: 0 })) }).parse(file(), { mode: 'structured' }));
  }
});

test('raw process errors do not disclose paths or provider secrets', async () => {
  const secret = 'example-provider-secret-do-not-return';
  const privatePath = 'C:\\Users\\Private User\\.env';
  const documentParser = parser({ runProcess: runner(undefined, async () => { throw new Error(`failure ${secret} ${privatePath}`); }) });
  await assert.rejects(documentParser.parse(file(), { mode: 'structured' }), error => !error.message.includes(secret) && !error.message.includes(privatePath));
});

test('untrusted input limits are enforced before the converter can run', async () => {
  let calls = 0;
  const documentParser = createDocumentParser({ pythonPath: process.execPath, runProcess: async () => { calls++; return { stdout: JSON.stringify(probe) }; } });
  await assert.rejects(documentParser.parse({ originalname: 'huge.pdf', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) }, { mode: 'structured' }));
  await assert.rejects(documentParser.parse({ originalname: 'program.exe', buffer: Buffer.from('no') }, { mode: 'structured' }));
  assert.equal(calls, 0);
});

test('a canceled queued conversion never starts and does not block later work', { timeout: 5000 }, async () => {
  let started = 0;
  let release;
  const documentParser = parser({ runProcess: runner(undefined, async () => {
    started++;
    if (started === 1) await new Promise(resolve => { release = resolve; });
    return { stdout: JSON.stringify(converted()), exitCode: 0 };
  }) });
  const first = documentParser.parse(file(), { mode: 'structured' });
  await waitUntil(() => started === 1);
  const controller = new AbortController();
  const queued = documentParser.parse(file(), { mode: 'structured', signal: controller.signal });
  const rejected = assert.rejects(queued, error => error.code === 'ABORT_ERR');
  await turn();
  controller.abort();
  await rejected;
  release();
  await first;
  await documentParser.parse(file(), { mode: 'structured' });
  assert.equal(started, 2);
});

test('the actual child-process runner terminates a timed-out owned process', { timeout: 15000 }, async () => {
  await assert.rejects(runDoclingProcess({
    pythonPath: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'],
    timeoutMs: 200, maxOutputBytes: 1024,
  }), error => error.status === 504 && error.code === 'DOCLING_TIMEOUT');
});

test('the actual child-process runner bounds stdout and honors cancellation', { timeout: 15000 }, async () => {
  await assert.rejects(runDoclingProcess({
    pythonPath: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(8192));setInterval(()=>{},1000)"],
    timeoutMs: 10000, maxOutputBytes: 128,
  }), error => error.code === 'DOCLING_LIMIT');
  const controller = new AbortController();
  const result = runDoclingProcess({
    pythonPath: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'],
    signal: controller.signal, timeoutMs: 10000, maxOutputBytes: 1024,
  });
  const rejected = assert.rejects(result, error => error.code === 'ABORT_ERR');
  controller.abort();
  await rejected;
});
