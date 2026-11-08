import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const fail = (status, message) => Object.assign(new Error(message), { status });
const EMPTY = Object.freeze({ baseUrl: '', apiKey: '', model: '', useTextProvider: false });
const validKind = kind => { if (!['text', 'vision'].includes(kind)) throw fail(400, '请选择文字模型或视觉模型。'); };
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
const fingerprint = config => createHash('sha256').update(JSON.stringify([config.baseUrl, config.model, config.apiKey])).digest('hex');

export function normalizeModelBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) throw fail(400, '请填写模型服务的完整接口地址。');
  if (!value.trim()) return '';
  let url;
  try { url = new URL(value.trim()); } catch { throw fail(400, '模型地址无效，请填写完整的 HTTP 或 HTTPS 接口地址。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail(400, '模型地址不能包含账户、密码、查询参数或片段。');
  if (url.protocol === 'http:' && !loopback(url.hostname)) throw fail(400, '远程模型请使用 HTTPS；HTTP 仅用于本机 localhost 服务。');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/, '');
  return url.href.replace(/\/+$/, '');
}

function normalizeConfig(patch, previous, kind) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail(400, '模型配置格式无效。');
  if (patch.useTextProvider !== undefined && typeof patch.useTextProvider !== 'boolean') throw fail(400, '请选择是否复用文字模型。');
  if (patch.clearKey !== undefined && typeof patch.clearKey !== 'boolean') throw fail(400, '密钥清除选项无效。');
  const useTextProvider = kind === 'vision' && (patch.useTextProvider ?? previous.useTextProvider ?? false);
  if (kind === 'text' && patch.useTextProvider) throw fail(400, '文字模型不能引用自身配置。');
  if (useTextProvider) return { ...EMPTY, useTextProvider: true };
  const baseUrl = normalizeModelBaseUrl(patch.baseUrl ?? previous.baseUrl ?? '');
  const model = patch.model ?? previous.model ?? '';
  if (typeof model !== 'string' || model.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(model)) throw fail(400, '模型名称最多200字，不能包含控制字符。');
  if (patch.apiKey !== undefined && (typeof patch.apiKey !== 'string' || patch.apiKey.length > 8192 || /[\u0000-\u0020\u007f]/.test(patch.apiKey))) throw fail(400, '密钥格式无效，请重新填写。');
  if (patch.apiKey && /[•●*]{4}/.test(patch.apiKey)) throw fail(400, '请填写真实密钥，不能使用遮罩文本。');
  // Never forward an existing credential to a newly entered endpoint.
  const apiKey = patch.clearKey ? '' : patch.apiKey || (baseUrl === previous.baseUrl ? previous.apiKey || '' : '');
  return { baseUrl, model: model.trim(), apiKey, useTextProvider: false };
}

export function isModelConfigured(config) {
  if (!config?.baseUrl || !config.model) return false;
  try { return !!normalizeModelBaseUrl(config.baseUrl) && (!!config.apiKey || loopback(new URL(config.baseUrl).hostname)); } catch { return false; }
}

function requireConnection(config, requireModel = true) {
  if (!config.baseUrl) throw fail(400, '请先填写模型接口地址。');
  if (requireModel && !config.model) throw fail(400, '请先填写模型名称。');
  if (!config.apiKey && !loopback(new URL(config.baseUrl).hostname)) throw fail(400, '远程服务需要密钥；更换接口地址后，请为新服务重新填写密钥。');
}

// Generate a small, local OCR challenge; no user content or public image host is used.
const DIGITS = [
  ['111', '101', '101', '101', '111'], ['010', '110', '010', '010', '111'],
  ['111', '001', '111', '100', '111'], ['111', '001', '111', '001', '111'],
  ['101', '101', '111', '001', '001'], ['111', '100', '111', '001', '111'],
  ['111', '100', '111', '101', '111'], ['111', '001', '001', '001', '001'],
  ['111', '101', '111', '101', '111'], ['111', '101', '111', '001', '111'],
];
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(name, data) {
  const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}
export function createVisionConnectionProbe(number) {
  if (!Number.isInteger(number) || number < 10 || number > 99) throw new Error('Probe requires two digits');
  const width = 176, height = 112, scale = 16, margin = 16;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) pixels[y * (width * 3 + 1)] = 0;
  for (const [position, digit] of [...String(number)].entries()) {
    for (let row = 0; row < 5; row++) for (let column = 0; column < 3; column++) {
      if (DIGITS[Number(digit)][row][column] !== '1') continue;
      for (let y = margin + row * scale; y < margin + (row + 1) * scale; y++) {
        for (let x = margin + position * 80 + column * scale; x < margin + position * 80 + (column + 1) * scale; x++) {
          const offset = y * (width * 3 + 1) + 1 + x * 3;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
        }
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function responseJson(response, maxBytes) {
  if (!response.body || Number(response.headers.get('content-length') || 0) > maxBytes) {
    await response.body?.cancel(); throw fail(502, '模型服务返回内容为空或超出限制。');
  }
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw fail(502, '模型服务返回内容超出限制。'); }
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(502, '模型服务未返回有效 JSON，请检查兼容接口地址。'); }
}
function messageText(data) {
  const message = data?.choices?.[0]?.message;
  if (message?.refusal) throw fail(502, '模型拒绝了连接测试，请换用可用的模型。');
  if (typeof message?.content === 'string') return message.content.trim();
  if (Array.isArray(message?.content)) return message.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('').trim();
  return '';
}

/** Local owner-only configuration store. Call mountRoutes after the owner guard. */
export function createModelService({ dataDir, provider = {}, visionProvider = {}, fetchImpl = fetch, timeoutMs = 45000, randomIntImpl = randomInt } = {}) {
  if (!dataDir || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Model service requires valid dataDir and timeout');
  fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, 'model-service.json');
  const initial = config => normalizeConfig({ baseUrl: config.baseUrl || '', model: config.model || '', apiKey: config.apiKey || '' }, EMPTY, 'text');
  let settings = { version: 1, text: initial(provider), vision: initial(visionProvider), verification: {} };
  if (fs.existsSync(filename)) {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { throw new Error('模型配置文件无法读取，请备份后检查 model-service.json。'); }
    if (saved?.version !== 1 || !saved.text || !saved.vision || typeof saved.verification !== 'object' || saved.verification === null) throw new Error('模型配置文件结构无效，请备份后检查 model-service.json。');
    settings = { version: 1, text: normalizeConfig(saved.text, EMPTY, 'text'), vision: normalizeConfig(saved.vision, EMPTY, 'vision'), verification: saved.verification };
  }
  let saving = false;
  const resolved = (kind, candidate) => {
    const value = candidate || settings[kind];
    return kind === 'vision' && value.useTextProvider ? settings.text : value;
  };
  const prepare = (kind, patch) => { validKind(kind); return normalizeConfig(patch || {}, settings[kind], kind); };
  const statusFor = kind => {
    const config = resolved(kind), verification = settings.verification[kind];
    const verified = isModelConfigured(config) && !!verification?.at && verification.fingerprint === fingerprint(config);
    return { configured: isModelConfigured(config), verified, baseUrl: config.baseUrl, model: config.model, hasKey: !!config.apiKey, maskedKey: config.apiKey ? '••••••••' : '', useTextProvider: !!settings[kind].useTextProvider, verifiedAt: verified ? verification.at : null };
  };
  const status = () => ({ text: statusFor('text'), vision: statusFor('vision') });
  const view = kind => Object.freeze(Object.defineProperties({}, {
    baseUrl: { enumerable: true, get: () => resolved(kind).baseUrl },
    model: { enumerable: true, get: () => resolved(kind).model },
    apiKey: { enumerable: false, get: () => resolved(kind).apiKey },
    configured: { enumerable: true, get: () => isModelConfigured(resolved(kind)) },
    verified: { enumerable: true, get: () => statusFor(kind).verified },
  }));
  async function request(config, suffix, body, { signal } = {}) {
    requireConnection(config, suffix !== '/models');
    const deadline = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${suffix}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch {
      if (signal?.aborted) throw fail(499, '模型连接测试已取消。');
      if (deadline.aborted) throw fail(504, '模型连接超时，请检查服务状态后重试。');
      throw fail(502, '无法连接模型服务，请检查地址、网络及服务状态。');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw fail(502, `模型服务拒绝认证（HTTP ${response.status}），请检查密钥及模型权限。`);
      if (response.status === 404) throw fail(502, '模型或接口路径不存在（HTTP 404），请核对接口前缀和模型名称。');
      if (response.status === 429) throw fail(502, '模型服务限流或额度受限（HTTP 429），请在服务商处检查。');
      throw fail(502, `模型服务暂不可用（HTTP ${response.status}），请稍后重试。`);
    }
    try { return await responseJson(response, suffix === '/models' ? 1024 * 1024 : 256 * 1024); }
    catch (error) {
      if (signal?.aborted) throw fail(499, '模型连接测试已取消。');
      if (deadline.aborted) throw fail(504, '模型连接超时，请检查服务状态后重试。');
      if (error.status) throw error;
      throw fail(502, '模型服务响应中断，请检查网络后重试。');
    }
  }
  async function testCandidate(kind, candidate, options) {
    const config = resolved(kind, candidate); requireConnection(config);
    const expected = kind === 'text' ? `SHIFEN-${randomBytes(8).toString('hex')}` : String(randomIntImpl(10, 100));
    const content = kind === 'text' ? `连接测试：只返回这段字符，不能增加说明：${expected}` : [
      { type: 'text', text: '请识别图片中的两位数字，只返回这两位数字。不能看图时返回 NO_IMAGE。' },
      { type: 'image_url', image_url: { url: createVisionConnectionProbe(Number(expected)), detail: 'high' } },
    ];
    const data = await request(config, '/chat/completions', { model: config.model, messages: [{ role: 'user', content }], max_tokens: 256, stream: false,
      ...(new URL(config.baseUrl).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {}),
    }, options);
    if (messageText(data) !== expected) throw fail(502, kind === 'text' ? '模型未通过文字生成测试，请确认该模型支持 Chat Completions。' : '模型未正确读取测试图片，请选择支持图片输入和文字识别的视觉模型。');
    return { ok: true, kind, model: config.model, verifiedAt: new Date().toISOString() };
  }
  const service = {
    provider: view('text'), visionProvider: view('vision'), status,
    async test(kind, patch, options) { return testCandidate(kind, prepare(kind, patch), options); },
    async save(kind, patch, options) {
      if (saving) throw fail(409, '另一份模型配置正在测试，请完成后再保存。');
      const candidate = prepare(kind, patch); saving = true;
      let temporary;
      try {
        const result = await testCandidate(kind, candidate, options);
        if (options?.signal?.aborted) throw fail(499, '模型配置保存已取消。');
        const next = { ...settings, [kind]: candidate, verification: { ...settings.verification, [kind]: { at: result.verifiedAt, fingerprint: fingerprint(resolved(kind, candidate)) } } };
        temporary = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, filename); temporary = undefined; settings = next;
        return status();
      } catch (error) {
        if (error.status) throw error;
        throw fail(500, '模型配置未能保存，原配置保持不变，请检查本地目录权限。');
      } finally { if (temporary) { try { fs.unlinkSync(temporary); } catch {} } saving = false; }
    },
    async models(kind, patch, options) {
      const config = resolved(kind, prepare(kind, patch));
      const data = await request(config, '/models', undefined, options);
      if (!Array.isArray(data?.data) || data.data.length > 5000) throw fail(502, '服务未返回兼容的模型列表，请直接填写模型名称。');
      return { models: [...new Set(data.data.map(item => item?.id).filter(id => typeof id === 'string' && id.trim() && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id) && (!config.apiKey || !id.includes(config.apiKey))))].map(id => ({ id })) };
    },
    mountRoutes(app, { prefix = '/api/model-service' } = {}) {
      const run = async (req, res, operation) => {
        const controller = new AbortController();
        const closed = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', closed);
        try { res.json(await operation(req.params.kind, req.body, { signal: controller.signal })); }
        finally { res.removeListener('close', closed); }
      };
      app.get(prefix, (_req, res) => res.json(status()));
      app.put(`${prefix}/:kind`, async (req, res) => run(req, res, service.save));
      app.post(`${prefix}/:kind/test`, async (req, res) => run(req, res, service.test));
      app.post(`${prefix}/:kind/models`, async (req, res) => run(req, res, service.models));
    },
  };
  return service;
}
