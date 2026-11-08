import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
export const normalizeAccountEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validAccountEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validAccountName = value => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 40 && !/[\u0000-\u001f\u007f]/.test(value);
export const accountIdForEmail = email => digest(normalizeAccountEmail(email)).slice(0, 32);
export const accountIdFor = account => accountIdForEmail(account?.email);

function validAccount(account) {
  return account && validAccountName(account.name) && validAccountEmail(account.email)
    && account.algorithm === 'scrypt-N32768-r8-p1' && /^[a-f0-9]{32}$/.test(account.salt)
    && /^[a-f0-9]{128}$/.test(account.hash) && typeof account.createdAt === 'string';
}

/** 根目录只保存账户凭据索引，学习资料永远存放在各账户自己的工作目录。 */
export function readAccountStore(dataDir) {
  const filename = path.join(dataDir, 'auth.json');
  if (!fs.existsSync(filename)) return { accounts: [], legacy: false };
  let saved;
  try { saved = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch { throw new Error('本地账户文件无法读取。请先备份 data/auth.json，修复文件后再启动。'); }
  if (saved?.version === 1 && validAccount(saved)) return { accounts: [saved], legacy: true };
  if (saved?.version !== 2 || !Array.isArray(saved.accounts) || !saved.accounts.every(validAccount)) {
    throw new Error('本地账户文件无法读取。请先备份 data/auth.json，修复文件后再启动。');
  }
  const emails = saved.accounts.map(account => account.email);
  if (new Set(emails).size !== emails.length) throw new Error('本地账户文件包含重复邮箱，请先备份并修复 data/auth.json。');
  return { accounts: saved.accounts, legacy: false };
}

export function writeAccountStore(dataDir, accounts) {
  if (!Array.isArray(accounts) || !accounts.every(validAccount)) throw new Error('账户记录无效，已停止保存。');
  const filename = path.join(dataDir, 'auth.json');
  fs.mkdirSync(dataDir, { recursive: true });
  const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 2, accounts }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filename);
    try { fs.chmodSync(filename, 0o600); } catch { /* Windows 由用户目录控制权限。 */ }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
