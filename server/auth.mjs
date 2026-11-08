import fs from 'node:fs';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { accountFingerprint, recoveryPath, recoveryPage } from './auth-recovery.mjs';
import { accountIdFor, normalizeAccountEmail, readAccountStore, validAccountEmail, validAccountName, writeAccountStore } from './account-store.mjs';

const derive = promisify(scrypt);
const COOKIE = 'shifen_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(value).digest('hex');
const validPassword = value => typeof value === 'string' && value.length >= 8 && value.length <= 128;

/** 本机多账户认证。会话只保存在内存，服务重启后需要重新登录。 */
export function mountAuth(app, { dataDir, now = Date.now, sessionMs = SESSION_MS, secureCookies = process.env.AUTH_COOKIE_SECURE === 'true', onAccountCreated } = {}) {
  let { accounts } = readAccountStore(dataDir);
  const sessions = new Map();
  const attempts = new Map();
  let registering = false;
  let recovering = false;
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = Buffer.alloc(64);
  const publicUser = account => ({ name: account.name, email: account.email });
  const tokenFrom = req => {
    const part = String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`));
    const token = part?.slice(COOKIE.length + 1);
    return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : '';
  };
  const prune = () => {
    const time = now();
    for (const [key, session] of sessions) if (session.expires <= time) sessions.delete(key);
    for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
  };
  const authenticated = req => {
    prune();
    const token = tokenFrom(req);
    if (!token) return null;
    const session = sessions.get(digest(token));
    if (!session) return null;
    return accounts.find(account => accountIdFor(account) === session.accountId) || null;
  };
  const cookie = (req, res, token, lifetime) => {
    const secure = secureCookies || req.secure;
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(lifetime / 1000)}${secure ? '; Secure' : ''}`);
  };
  const signIn = (req, res, account) => {
    prune();
    const old = tokenFrom(req);
    if (old) sessions.delete(digest(old));
    while (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    sessions.set(digest(token), { accountId: accountIdFor(account), expires: now() + sessionMs });
    cookie(req, res, token, sessionMs);
    return { authenticated: true, accountExists: true, user: publicUser(account) };
  };
  const limit = (req, res, next) => {
    prune();
    const key = req.ip || req.socket.remoteAddress || 'local';
    const perIp = attempts.get(key);
    const global = attempts.get('*');
    if ((perIp?.count || 0) >= 10 || (global?.count || 0) >= 60) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(((perIp?.until || global.until) - now()) / 1000))));
      return next(fail(429, '尝试次数较多，请 15 分钟后再试。'));
    }
    for (const item of [key, '*']) {
      const entry = attempts.get(item) || { count: 0, until: now() + WINDOW_MS };
      entry.count += 1;
      attempts.set(item, entry);
    }
    next();
  };

  app.get('/api/auth/status', (req, res) => {
    const account = authenticated(req);
    res.json({ authenticated: !!account, accountExists: accounts.length > 0, ...(account ? { user: publicUser(account) } : {}) });
  });
  app.post('/api/auth/register', limit, async (req, res) => {
    if (registering) throw fail(409, '另一个账户正在创建，请稍后重试。');
    const { name, password } = req.body || {};
    const email = normalizeAccountEmail(req.body?.email);
    if (!validAccountName(name)) throw fail(400, '称呼需为 1–40 个字符。');
    if (!validAccountEmail(email)) throw fail(400, '请输入有效的邮箱地址。');
    if (!validPassword(password)) throw fail(400, '密码需为 8–128 个字符。');
    if (accounts.some(account => account.email === email)) throw fail(409, '这个邮箱已创建账户，请直接登录。');
    registering = true;
    try {
      const salt = randomBytes(16).toString('hex');
      const hash = (await derive(password, salt, 64, SCRYPT_OPTIONS)).toString('hex');
      if (accounts.some(account => account.email === email)) throw fail(409, '这个邮箱已创建账户，请直接登录。');
      const record = { version: 1, name: name.trim(), email, algorithm: 'scrypt-N32768-r8-p1', salt, hash, createdAt: new Date(now()).toISOString() };
      const nextAccounts = [...accounts, record];
      writeAccountStore(dataDir, nextAccounts);
      accounts = nextAccounts;
      onAccountCreated?.(record);
      res.status(201).json(signIn(req, res, record));
    } finally { registering = false; }
  });
  app.post('/api/auth/login', limit, async (req, res) => {
    const email = normalizeAccountEmail(req.body?.email);
    const password = req.body?.password;
    if (!validAccountEmail(email) || !validPassword(password)) throw fail(401, '邮箱或密码不正确，请重新输入。');
    const account = accounts.find(item => item.email === email);
    const candidate = await derive(password, account?.salt || dummySalt, 64, SCRYPT_OPTIONS);
    const matches = timingSafeEqual(candidate, account ? Buffer.from(account.hash, 'hex') : dummyHash);
    if (!account || !matches) throw fail(401, '邮箱或密码不正确，请重新输入。');
    res.json(signIn(req, res, account));
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = tokenFrom(req);
    if (token) sessions.delete(digest(token));
    cookie(req, res, '', 0);
    res.json({ authenticated: false, accountExists: accounts.length > 0 });
  });
  app.get('/auth/recovery', (_req, res) => {
    const nonce = randomBytes(24).toString('base64');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
    res.type('html').send(recoveryPage(nonce));
  });
  app.post('/api/auth/recover', async (req, res) => {
    const remote = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) throw fail(403, '请在运行考谱的电脑上恢复账户。');
    if (recovering) throw fail(409, '正在保存密码，请稍等。');
    const { token, password } = req.body || {};
    if (!validPassword(password)) throw fail(400, '密码需为 8–128 个字符。');
    const filename = recoveryPath(dataDir);
    const validate = file => {
      let record;
      try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw fail(401, '恢复链接无效或已使用，请重新生成本机恢复链接。'); }
      const account = record.accountId ? accounts.find(item => accountIdFor(item) === record.accountId) : accounts.length === 1 ? accounts[0] : null;
      if (!account || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || ![1, 2].includes(record.version) || !/^[a-f0-9]{64}$/.test(record.tokenHash)
        || !Number.isFinite(record.expiresAt) || record.expiresAt <= now() || record.expiresAt > now() + 15 * 60 * 1000
        || record.accountFingerprint !== accountFingerprint(account) || !timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(record.tokenHash, 'hex'))) throw fail(401, '恢复链接已失效，请重新生成本机恢复链接。');
      return { record, account };
    };
    validate(filename);
    recovering = true;
    const claimed = `${filename}.${randomBytes(8).toString('hex')}.using`;
    let changed = false;
    try {
      const salt = randomBytes(16).toString('hex');
      const hash = (await derive(password, salt, 64, SCRYPT_OPTIONS)).toString('hex');
      validate(filename);
      fs.renameSync(filename, claimed);
      const { account } = validate(claimed);
      const updated = { ...account, salt, hash, updatedAt: new Date(now()).toISOString() };
      const nextAccounts = accounts.map(item => accountIdFor(item) === accountIdFor(account) ? updated : item);
      writeAccountStore(dataDir, nextAccounts);
      accounts = nextAccounts;
      changed = true;
      for (const [key, session] of sessions) if (session.accountId === accountIdFor(account)) sessions.delete(key);
      attempts.clear();
      res.json(signIn(req, res, updated));
    } finally {
      recovering = false;
      if (fs.existsSync(claimed)) {
        if (!changed && !fs.existsSync(filename)) fs.renameSync(claimed, filename);
        else fs.unlinkSync(claimed);
      }
    }
  });
  app.use('/api', (req, _res, next) => {
    const account = authenticated(req);
    if (!account) return next(fail(401, '请先登录，再继续你的复习。'));
    req.account = account;
    req.user = { id: accountIdFor(account), ...publicUser(account) };
    next();
  });
}
