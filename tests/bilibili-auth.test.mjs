import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBilibiliAuth } from '../server/bilibili-auth.mjs';

const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const qrBody = { code: 0, data: { qrcode_key: 'key-1', url: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&qrcode_key=abc&from=' } };
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-bili-auth-'));

function fixture({ pollBody, withCookies = true } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/qrcode/generate')) return json(qrBody);
    if (String(url).includes('/qrcode/poll')) {
      const response = json(pollBody);
      if (withCookies) {
        response.headers.append('set-cookie', 'SESSDATA=secret-session; Path=/; HttpOnly');
        response.headers.append('set-cookie', 'bili_jct=csrf-token; Path=/');
        response.headers.append('set-cookie', 'unrelated=should-not-be-stored; Path=/');
      }
      return response;
    }
    if (String(url).includes('/x/web-interface/nav')) return json({ code: 0, data: { uname: '测试用户' } });
    throw new Error(`unexpected ${url}`);
  };
  return { requests, fetchImpl };
}

test('qrcode renders the official Bilibili login URL as an image', async () => {
  const dir = tempDir();
  const { requests, fetchImpl } = fixture();
  const auth = createBilibiliAuth({ dataDir: dir, fetchImpl });
  const result = await auth.qrcode();
  assert.equal(result.key, 'key-1');
  assert.match(result.image, /^data:image\/png;base64,/);
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests[0].init.headers.Cookie, undefined);
  assert.equal(requests[0].init.headers.Referer, 'https://www.bilibili.com/');
  assert.deepEqual(auth.status(), { loggedIn: false, uname: '' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('poll maps Bilibili scan states without writing a session', async () => {
  const dir = tempDir();
  const auth = createBilibiliAuth({ dataDir: dir, fetchImpl: fixture({ pollBody: { code: 0, data: { code: 86101 } } }).fetchImpl });
  assert.deepEqual(await auth.poll('key-1'), { status: 'pending' });
  const scanned = createBilibiliAuth({ dataDir: dir, fetchImpl: fixture({ pollBody: { code: 0, data: { code: 86090 } } }).fetchImpl });
  assert.deepEqual(await scanned.poll('key-1'), { status: 'scanned' });
  const expired = createBilibiliAuth({ dataDir: dir, fetchImpl: fixture({ pollBody: { code: 0, data: { code: 86038 } } }).fetchImpl });
  assert.deepEqual(await expired.poll('key-1'), { status: 'expired' });
  assert.equal(auth.status().loggedIn, false);
  assert.equal(fs.existsSync(path.join(dir, 'bilibili-session.json')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a confirmed scan keeps only whitelisted cookies on the server and survives restart', async () => {
  const dir = tempDir();
  const { requests, fetchImpl } = fixture({ pollBody: { code: 0, data: { code: 0, url: '' } } });
  const auth = createBilibiliAuth({ dataDir: dir, fetchImpl });
  const result = await auth.poll('key-1');
  assert.deepEqual(result, { status: 'success', uname: '测试用户' });
  assert.equal(auth.status().loggedIn, true);
  assert.match(auth.cookieHeader(), /SESSDATA=secret-session/);
  assert.match(auth.cookieHeader(), /bili_jct=csrf-token/);
  assert.equal(auth.cookieHeader().includes('should-not-be-stored'), false);
  const nav = requests.find(item => item.url.includes('/nav'));
  assert.match(nav.init.headers.Cookie, /SESSDATA=secret-session/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'bilibili-session.json'), 'utf8'));
  assert.equal(saved.uname, '测试用户');
  const restored = createBilibiliAuth({ dataDir: dir, fetchImpl });
  assert.equal(restored.status().loggedIn, true);
  restored.logout();
  assert.equal(restored.status().loggedIn, false);
  assert.equal(fs.existsSync(path.join(dir, 'bilibili-session.json')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('poll falls back to the official redirect URL when Set-Cookie is unavailable', async () => {
  const dir = tempDir();
  const url = `https://www.bilibili.com/?SESSDATA=fallback-session&bili_jct=fallback-csrf`;
  const auth = createBilibiliAuth({ dataDir: dir, fetchImpl: fixture({ pollBody: { code: 0, data: { code: 0, url } }, withCookies: false }).fetchImpl });
  const result = await auth.poll('key-1');
  assert.equal(result.status, 'success');
  assert.match(auth.cookieHeader(), /SESSDATA=fallback-session/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('poll rejects missing credentials, invalid keys and transport failures', async () => {
  const dir = tempDir();
  const empty = createBilibiliAuth({ dataDir: dir, fetchImpl: fixture({ pollBody: { code: 0, data: { code: 0, url: '' } }, withCookies: false }).fetchImpl });
  await assert.rejects(empty.poll('key-1'), { status: 502 });
  assert.equal(empty.status().loggedIn, false);
  await assert.rejects(empty.poll(''), { status: 400 });
  const offline = createBilibiliAuth({ dataDir: dir, fetchImpl: async () => { throw new Error('network down'); } });
  await assert.rejects(offline.qrcode(), { status: 502 });
  fs.rmSync(dir, { recursive: true, force: true });
});
