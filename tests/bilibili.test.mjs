import test from 'node:test';
import assert from 'node:assert/strict';
import { bilibiliCatalog, normalizeBilibiliInput, resolveBilibiliInput } from '../server/bilibili.mjs';

const bvid = 'BV1xx411c7mD';
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const payload = (overrides = {}) => ({ code: 0, data: {
  bvid, title: ' 高数强化课 ', owner: { name: '老师' },
  pages: [{ page: 1, part: '极限', duration: 125.4 }, { page: 2, part: '导数', duration: 60 }],
  ...overrides,
} });

test('normalizeBilibiliInput accepts BV ids and video links with part', () => {
  assert.deepEqual(normalizeBilibiliInput(bvid), { bvid, part: 1 });
  assert.deepEqual(normalizeBilibiliInput(`https://www.bilibili.com/video/${bvid}?p=3`), { bvid, part: 3 });
  assert.deepEqual(normalizeBilibiliInput(`https://m.bilibili.com/video/${bvid}/?p=0`), { bvid, part: 1 });
  assert.deepEqual(normalizeBilibiliInput(`https://bilibili.com/video/${bvid}`), { bvid, part: 1 });
  assert.deepEqual(normalizeBilibiliInput(`https://www.bilibili.com/list/watchlater?bvid=${bvid}&oid=1`), { bvid, part: 1 });
  assert.deepEqual(normalizeBilibiliInput(`https://www.bilibili.com/list/ml123456?bvid=${bvid}&p=2`), { bvid, part: 2 });
  assert.throws(() => normalizeBilibiliInput('https://b23.tv/abc123'), { status: 400 });
  assert.throws(() => normalizeBilibiliInput(''), { status: 400 });
  assert.throws(() => normalizeBilibiliInput('https://example.com/video/BV1xx411c7mD'), { status: 400 });
  assert.throws(() => normalizeBilibiliInput('https://www.bilibili.com/bangumi/play/ep1'), { status: 400 });
  assert.throws(() => normalizeBilibiliInput('https://www.bilibili.com/video/BV1xx411c7m'), { status: 400 });
});

test('resolveBilibiliInput expands b23.tv share links with one redirect', async () => {
  const requests = [];
  const resolved = await resolveBilibiliInput('https://b23.tv/abc123', {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response('', { status: 302, headers: { location: `https://www.bilibili.com/video/${bvid}?p=2&share_source=copy` } });
    },
  });
  assert.deepEqual(resolved, { bvid, part: 2 });
  assert.equal(requests[0].url, 'https://b23.tv/abc123');
  assert.equal(requests[0].init.redirect, 'manual');
});

test('resolveBilibiliInput rejects short links that leave Bilibili or have no target', async () => {
  await assert.rejects(resolveBilibiliInput('https://b23.tv/abc123', {
    fetchImpl: async () => new Response('', { status: 302, headers: { location: `https://evil.test/video/${bvid}` } }),
  }), { status: 400 });
  await assert.rejects(resolveBilibiliInput('https://b23.tv/abc123', {
    fetchImpl: async () => new Response('expired', { status: 200 }),
  }), { status: 400 });
  await assert.rejects(resolveBilibiliInput('https://b23.tv/abc123', {
    fetchImpl: async () => { throw new Error('network down'); },
  }), { status: 502 });
});

test('bilibiliCatalog reads anonymous page metadata and normalizes parts', async () => {
  const requests = [];
  const catalog = await bilibiliCatalog(`https://www.bilibili.com/video/${bvid}?p=2`, {
    fetchImpl: async (url, init) => { requests.push({ url, init }); return json(payload()); },
  });
  assert.equal(catalog.bvid, bvid);
  assert.equal(catalog.title, '高数强化课');
  assert.equal(catalog.owner, '老师');
  assert.deepEqual(catalog.pages, [
    { part: 1, title: '极限', duration: 125 },
    { part: 2, title: '导数', duration: 60 },
  ]);
  assert.equal(catalog.truncated, false);
  assert.match(requests[0].url, /^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?bvid=BV1xx411c7mD$/);
  assert.match(requests[0].init.headers.Referer, /bilibili\.com/);
  assert.equal(requests[0].init.redirect, 'error');
});

test('bilibiliCatalog reports Bilibili error codes and transport failures', async () => {
  await assert.rejects(bilibiliCatalog(bvid, { fetchImpl: async () => json({ code: -404, message: '啥都木有' }) }), { status: 404 });
  await assert.rejects(bilibiliCatalog(bvid, { fetchImpl: async () => json({ code: -400, message: '请求错误' }) }), { status: 502 });
  await assert.rejects(bilibiliCatalog(bvid, { fetchImpl: async () => new Response('busy', { status: 503 }) }), { status: 502 });
  await assert.rejects(bilibiliCatalog(bvid, { fetchImpl: async () => new Response('not json', { status: 200 }) }), { status: 502 });
  await assert.rejects(bilibiliCatalog(bvid, { fetchImpl: async () => { throw new Error('network down'); } }), { status: 502 });
  await assert.rejects(bilibiliCatalog(bvid, { fetchImpl: async () => json(payload({ pages: [] })) }), { status: 502 });
});

test('bilibiliCatalog truncates long courses and fills malformed page numbers', async () => {
  const pages = Array.from({ length: 120 }, (_, index) => ({ page: index === 1 ? 'x' : index + 1, part: `第 ${index + 1} 讲`, duration: index }));
  const catalog = await bilibiliCatalog(bvid, { fetchImpl: async () => json(payload({ pages })) });
  assert.equal(catalog.pages.length, 100);
  assert.equal(catalog.truncated, true);
  assert.equal(catalog.pages[1].part, 2);
  assert.equal(catalog.pages[0].duration, 0);
});

test('bilibiliCatalog rejects unsupported input before requesting the network', async () => {
  let called = false;
  await assert.rejects(bilibiliCatalog('ftp://www.bilibili.com/video/BV1xx411c7mD', { fetchImpl: async () => { called = true; return json(payload()); } }), { status: 400 });
  assert.equal(called, false);
});
