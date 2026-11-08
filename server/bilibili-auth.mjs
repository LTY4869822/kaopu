import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PASSPORT_HOST = 'passport.bilibili.com';
const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
// Only these cookies are kept, and they are only ever sent back to Bilibili hosts.
const COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'];
const fail = (message, status = 502) => Object.assign(new Error(message), { status });

function cookieFromSetCookie(lines) {
  const pairs = [];
  for (const line of lines) {
    const [pair] = String(line).split(';', 1);
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!COOKIE_NAMES.includes(name) || !value || /[\x00-\x1f\x7f;]/.test(value)) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.join('; ');
}

function cookieFromLoginUrl(value) {
  // The official scan-poll response also carries the same credentials in its redirect URL.
  try {
    const url = new URL(value);
    if (!/(^|\.)bilibili\.com$/.test(url.hostname)) return '';
    const pairs = [];
    for (const name of COOKIE_NAMES) {
      const item = url.searchParams.get(name);
      if (item && !/[\x00-\x1f\x7f;]/.test(item)) pairs.push(`${name}=${item}`);
    }
    return pairs.join('; ');
  } catch { return ''; }
}

export function createBilibiliAuth({ dataDir, fetchImpl = fetch, timeoutMs = 12000, now = () => Date.now() } = {}) {
  const file = path.join(dataDir, 'bilibili-session.json');
  let session = null;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && typeof saved.cookieHeader === 'string' && saved.cookieHeader.includes('SESSDATA=')
      && typeof saved.uname === 'string' && Number.isFinite(saved.savedAt)) session = { cookieHeader: saved.cookieHeader, uname: saved.uname.slice(0, 60), savedAt: saved.savedAt };
  } catch { /* No saved login, or an unreadable file is treated as logged out. */ }

  const save = () => {
    if (!session) { fs.rmSync(file, { force: true }); return; }
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(session), { mode: 0o600 });
    fs.renameSync(temporary, file);
  };

  async function request(url, { cookie = false } = {}) {
    const parsed = new URL(url);
    let response;
    try {
      response = await fetchImpl(parsed.href, {
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Accept: 'application/json, text/plain, */*',
          ...(cookie && session ? { Cookie: session.cookieHeader } : {}) },
      });
    } catch { throw fail('暂时无法连接 B 站登录服务，请稍后重试。'); }
    if (!response.ok) throw fail(`B 站登录服务返回 HTTP ${response.status}，请稍后重试。`);
    let body;
    try { body = await response.json(); }
    catch { throw fail('B 站登录服务返回了无法识别的内容，请稍后重试。'); }
    return { response, body };
  }

  async function readUname() {
    try {
      const { body } = await request(NAV_URL, { cookie: true });
      if (body?.code === 0 && typeof body.data?.uname === 'string') return body.data.uname.slice(0, 60);
      return '';
    } catch { return ''; }
  }

  return {
    cookieHeader: () => session?.cookieHeader || '',
    status: () => ({ loggedIn: !!session, uname: session?.uname || '' }),
    logout: () => { session = null; save(); },
    async qrcode() {
      const { body } = await request(`https://${PASSPORT_HOST}/x/passport-login/web/qrcode/generate`);
      const key = body?.data?.qrcode_key, url = body?.data?.url;
      if (body?.code !== 0 || typeof key !== 'string' || !key || key.length > 200 || typeof url !== 'string'
        || !/^https:\/\/(passport|account)\.bilibili\.com\//.test(url)) throw fail('没有获取到 B 站登录二维码，请稍后重试。');
      const image = await QRCode.toDataURL(url, { width: 264, margin: 1, errorCorrectionLevel: 'M' });
      return { key, image };
    },
    async poll(key) {
      if (typeof key !== 'string' || !key || key.length > 200) throw fail('登录状态无效，请重新获取二维码。', 400);
      const { response, body } = await request(`https://${PASSPORT_HOST}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`);
      const code = body?.data?.code;
      if (body?.code !== 0 || !Number.isInteger(code)) throw fail('没有读到 B 站登录状态，请稍后重试。');
      if (code === 86101) return { status: 'pending' };
      if (code === 86090) return { status: 'scanned' };
      if (code === 86038) return { status: 'expired' };
      if (code !== 0) return { status: 'pending' };
      const cookieHeader = cookieFromSetCookie(response.headers.getSetCookie?.() || []) || cookieFromLoginUrl(body.data.url);
      if (!cookieHeader.includes('SESSDATA=')) throw fail('登录已完成，但没有取得可用登录态，请重新扫码。');
      session = { cookieHeader, uname: '', savedAt: now() };
      session.uname = await readUname();
      save();
      return { status: 'success', uname: session.uname };
    },
  };
}

export function mountBilibiliAuthRoutes(app, auth) {
  app.get('/api/bilibili/auth/status', (_req, res) => res.json(auth.status()));
  app.post('/api/bilibili/auth/qrcode', async (_req, res, next) => {
    try { res.json(await auth.qrcode()); } catch (error) { next(error); }
  });
  app.post('/api/bilibili/auth/poll', async (req, res, next) => {
    try { res.json(await auth.poll(req.body?.key)); } catch (error) { next(error); }
  });
  app.post('/api/bilibili/auth/logout', (_req, res) => { auth.logout(); res.json({ loggedIn: false }); });
  return auth;
}
