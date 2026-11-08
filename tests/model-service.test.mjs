import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createModelService, normalizeModelBaseUrl, isModelConfigured, createVisionConnectionProbe } from '../server/model-service.mjs';

const secret = 'test-only-model-key';
const config = { baseUrl: 'https://models.example.test/v1', model: 'text-test', apiKey: secret };
const completion = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'Content-Type': 'application/json' } });
function goodFetch(calls = []) {
  return async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'text-test' }, { id: 'vision-test' }, { id: 'text-test' }] }));
    const content = body.messages[0].content;
    return completion(typeof content === 'string' ? content.match(/SHIFEN-[0-9a-f]+/)[0] : '42');
  };
}
function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-model-service-test-'));
  const service = createModelService({ dataDir, fetchImpl: goodFetch(), randomIntImpl: () => 42, ...options });
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return { service, dataDir, filename: path.join(dataDir, 'model-service.json') };
}

test('model endpoints permit loopback HTTP, require remote HTTPS and reject URL credentials', () => {
  assert.equal(normalizeModelBaseUrl(' https://models.example.test/v1/chat/completions/ '), 'https://models.example.test/v1');
  assert.equal(normalizeModelBaseUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.equal(normalizeModelBaseUrl('http://[::1]:1234/v1/models'), 'http://[::1]:1234/v1');
  for (const value of ['http://remote.example.test/v1', 'http://10.1.1.1/v1', 'https://name:secret@remote.example.test/v1', 'https://remote.example.test/v1?key=secret', 'https://remote.example.test/v1#secret', 'file:///private', 'not a URL']) assert.throws(() => normalizeModelBaseUrl(value));
  assert.equal(isModelConfigured({ baseUrl: 'http://localhost:11434/v1', model: 'local' }), true);
  assert.equal(isModelConfigured({ baseUrl: 'https://remote.example.test/v1', model: 'remote' }), false);
  assert.equal(isModelConfigured({ baseUrl: 'file:///private', model: 'invalid', apiKey: 'anything' }), false);
});

test('environment configuration is usable but not falsely verified and never serialized with its key', t => {
  const { service } = fixture(t, { provider: config });
  const status = service.status();
  assert.equal(status.text.configured, true); assert.equal(status.text.verified, false);
  assert.equal(status.vision.configured, false); assert.equal(status.text.maskedKey, '••••••••');
  assert.equal(service.provider.apiKey, secret);
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(JSON.stringify(service.provider).includes(secret), false);
  assert.equal(Object.keys(service.provider).includes('apiKey'), false);
  assert.equal(Object.isFrozen(service.provider), true);
});

test('save really generates a challenge response before atomically persisting and updates stable views', async t => {
  const calls = [];
  const { service, dataDir, filename } = fixture(t, { fetchImpl: goodFetch(calls) });
  const view = service.provider;
  const saved = await service.save('text', config);
  assert.equal(saved.text.verified, true); assert.equal(saved.text.configured, true);
  assert.equal(view.model, 'text-test'); assert.equal(view.apiKey, secret); assert.equal(view, service.provider);
  assert.equal(calls.length, 1); assert.match(calls[0].url, /\/v1\/chat\/completions$/);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(calls[0].body.stream, false);
  const restart = createModelService({ dataDir });
  assert.equal(restart.provider.apiKey, secret); assert.equal(restart.status().text.verified, true);
  assert.equal(JSON.parse(fs.readFileSync(filename)).text.apiKey, secret);
  assert.equal(fs.readdirSync(dataDir).some(name => name.endsWith('.tmp')), false);
});

test('HTTP 200 without valid generation and failed provider responses never replace the working configuration', async t => {
  let failure;
  const { service, filename } = fixture(t, { fetchImpl: async (...args) => failure ? failure() : goodFetch()(...args) });
  await service.save('text', config);
  const previous = fs.readFileSync(filename, 'utf8');
  const cases = [
    () => new Response('bad credentials ' + secret, { status: 401 }),
    () => new Response('upstream secret ' + secret, { status: 404 }),
    () => new Response('upstream limit ' + secret, { status: 429 }),
    () => new Response('not JSON ' + secret),
    () => new Response('{}'),
    () => completion(''),
    () => completion('connected, but not following the challenge'),
    () => { throw new Error('network diagnostic ' + secret); },
  ];
  for (failure of cases) {
    await assert.rejects(service.save('text', { model: 'broken' }), error => { assert.equal(error.message.includes(secret), false); return !!error.status; });
    assert.equal(fs.readFileSync(filename, 'utf8'), previous);
    assert.equal(service.provider.model, 'text-test'); assert.equal(service.status().text.verified, true);
  }
});

test('blank key preserves credentials only for the same normalized endpoint', async t => {
  const calls = [];
  const { service } = fixture(t, { provider: config, fetchImpl: goodFetch(calls) });
  await service.save('text', { model: 'same-service', apiKey: '' });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
  for (const baseUrl of ['https://other.example.test/v1', 'https://models.example.test/other']) {
    const count = calls.length;
    await assert.rejects(service.test('text', { baseUrl, apiKey: '' }), /重新填写密钥/);
    assert.equal(calls.length, count);
  }
  await service.save('text', { baseUrl: 'http://localhost:11434/v1', model: 'local', apiKey: '' });
  assert.equal(calls.at(-1).init.headers.Authorization, undefined);
  assert.equal(service.status().text.configured, true); assert.equal(service.status().text.hasKey, false);
});

test('vision must read a generated image, can share the text provider, and loses verification when that provider changes', async t => {
  const calls = [];
  const { service } = fixture(t, { provider: config, fetchImpl: goodFetch(calls) });
  const saved = await service.save('vision', { useTextProvider: true });
  assert.equal(saved.vision.verified, true); assert.equal(saved.vision.useTextProvider, true);
  const message = calls[0].body.messages[0].content;
  assert.equal(Array.isArray(message), true); assert.equal(message[0].text.includes('42'), false);
  assert.match(message[1].image_url.url, /^data:image\/png;base64,/);
  const png = Buffer.from(message[1].image_url.url.split(',')[1], 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 176);
  assert.equal(service.visionProvider.apiKey, secret);
  await service.save('text', { model: 'another-model' });
  assert.equal(service.status().vision.verified, false); assert.equal(service.visionProvider.model, 'another-model');
  assert.throws(() => createVisionConnectionProbe(9));
});

test('text-only or image-blind services cannot be marked vision-capable', async t => {
  const { service } = fixture(t, { provider: config, fetchImpl: async () => completion('NO_IMAGE') });
  await assert.rejects(service.save('vision', { useTextProvider: true }), /未正确读取测试图片/);
  assert.equal(service.status().vision.configured, false); assert.equal(service.status().vision.verified, false);
});

test('models can be listed before choosing a model and never return echoed key strings', async t => {
  const { service } = fixture(t, { fetchImpl: async (_url, init) => {
    assert.equal(init.method, 'GET');
    return new Response(JSON.stringify({ data: [{ id: 'one' }, { id: 'one' }, { id: '' }, { id: secret }, { id: 'two\n' }, { id: 'two' }] }));
  } });
  const listed = await service.models('text', { baseUrl: config.baseUrl, apiKey: secret });
  assert.deepEqual(listed, { models: [{ id: 'one' }, { id: 'two' }] });
  assert.equal(service.provider.configured, false);
});

test('connection cancellation and timeouts expose no provider diagnostics or credentials', async t => {
  const { service } = fixture(t, { provider: config, timeoutMs: 15, fetchImpl: async (_url, init) => {
    await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 1000); init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error(secret)); }, { once: true }); });
    return completion('too late');
  } });
  await assert.rejects(service.test('text'), error => error.status === 504 && !error.message.includes(secret));
  const controller = new AbortController();
  const checking = service.test('text', {}, { signal: controller.signal }); controller.abort();
  await assert.rejects(checking, error => error.status === 499 && !error.message.includes(secret));
});

test('unbounded streamed response bodies are stopped before becoming configuration or API output', async t => {
  let cancelled = false;
  const { service } = fixture(t, { provider: config, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(300 * 1024)); }, cancel() { cancelled = true; },
  })) });
  await assert.rejects(service.test('text'), /超出限制/); assert.equal(cancelled, true);
  assert.equal(service.status().text.verified, false);
});

test('concurrent saves cannot overwrite an in-flight successful configuration', async t => {
  let release;
  const { service } = fixture(t, { fetchImpl: async (...args) => { await new Promise(resolve => { release = resolve; }); return goodFetch()(...args); } });
  const first = service.save('text', config);
  await assert.rejects(service.save('text', { ...config, model: 'other' }), error => error.status === 409);
  release(); await first; assert.equal(service.provider.model, 'text-test');
});

test('owner-guarded API returns only masks and validated model output', async t => {
  const { service } = fixture(t);
  const app = express(); app.use(express.json());
  app.use('/api/model-service', (req, res, next) => req.headers['x-test-owner'] === 'yes' ? next() : res.status(401).json({ error: 'login required' }));
  service.mountRoutes(app);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/model-service`;
  assert.equal((await fetch(base)).status, 401);
  const headers = { 'Content-Type': 'application/json', 'x-test-owner': 'yes' };
  const response = await fetch(`${base}/text`, { method: 'PUT', headers, body: JSON.stringify(config) });
  assert.equal(response.status, 200);
  const body = await response.text(); assert.equal(body.includes(secret), false); assert.equal(JSON.parse(body).text.verified, true);
  const read = await fetch(base, { headers }); assert.equal((await read.text()).includes(secret), false);
});

test('DeepSeek probe disables reasoning without sending provider-specific options elsewhere', async t => {
  const calls = [];
  const { service } = fixture(t, { fetchImpl: goodFetch(calls) });
  await service.test('text', { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: secret });
  assert.deepEqual(calls[0].body.thinking, { type: 'disabled' });
  await service.test('text', config); assert.equal(calls[1].body.thinking, undefined);
});
