import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { accountIdFor, normalizeAccountEmail, readAccountStore } from './account-store.mjs';

export const recoveryPath = dataDir => path.join(dataDir, 'auth-recovery.json');
export const accountFingerprint = account => createHash('sha256').update(JSON.stringify([account.email, account.salt, account.hash, account.createdAt])).digest('hex');

/** This operation is local-file-only. There is deliberately no HTTP issuer. */
export function issueLocalRecovery({ dataDir, origin = 'http://127.0.0.1:3001', now = Date.now(), email = '' } = {}) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('恢复入口必须使用本机考谱地址。');
  const { accounts } = readAccountStore(dataDir);
  const normalized = normalizeAccountEmail(email);
  const account = normalized ? accounts.find(item => item.email === normalized) : accounts.length === 1 ? accounts[0] : null;
  if (!account) throw new Error(accounts.length > 1 && !normalized ? '本机有多个账户，请执行 npm run recover -- 你的邮箱。' : '没有可恢复的有效本机账户。');
  const token = randomBytes(32).toString('hex');
  const expiresAt = now + 15 * 60 * 1000;
  const filename = recoveryPath(dataDir), temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 2, tokenHash: createHash('sha256').update(token).digest('hex'), accountId: accountIdFor(account), accountFingerprint: accountFingerprint(account), expiresAt }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  url.pathname = '/auth/recovery'; url.hash = token;
  return { url: url.href, expiresAt: new Date(expiresAt).toISOString() };
}

export function recoveryPage(nonce) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>重设密码 · 考谱</title><style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#f4f5ef;color:#253020;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif;min-height:100dvh;display:grid;place-items:center;padding:24px}main{width:min(440px,100%);background:#fff;border:1px solid #dfe4d8;border-radius:22px;padding:36px;box-shadow:0 18px 70px #24331a09}.brand{font-weight:700;font-size:18px;letter-spacing:.06em;color:#65784e;margin-bottom:32px}h1{font-size:28px;line-height:1.3;letter-spacing:-.04em;margin:0 0 12px}p{color:#6b7563;font-size:14px;margin:0 0 24px}label{display:block;font-size:14px;margin:18px 0 8px}input{width:100%;border:1px solid #d9dfd1;border-radius:10px;padding:13px;font:inherit;background:#fafbf7;outline-offset:3px}button{width:100%;padding:14px;margin-top:26px;font:inherit;font-weight:600;border:0;border-radius:10px;background:#60764a;color:#fff;cursor:pointer}button:disabled{opacity:.55;cursor:wait}a{color:#60764a;text-decoration:none;font-size:14px}footer{text-align:center;margin-top:22px}#message{margin-top:18px;font-size:14px;white-space:pre-wrap;color:#a13f2f}code{word-break:break-all}#missing{background:#f4f6ed;border-radius:10px;padding:16px;font-size:14px;color:#536348}#missing p{margin:8px 0 0}small{display:block;color:#79816f;font-size:12px;margin-top:8px}
</style></head><body><main><div class="brand">考谱 KAOPU</div><h1>重新设置密码。</h1><p>课程、资料、笔记和学习记录都会保留。</p><div id="missing" hidden>需要本机恢复链接。<p>在运行考谱的电脑、项目文件夹中执行 <code>npm run recover</code>，然后打开生成的链接。链接15分钟内有效，只能使用一次。</p></div><form id="form" hidden><label for="password">新密码</label><input id="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required><small>8–128个字符，不要把密码发到聊天里。</small><label for="confirm">再输入一次</label><input id="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required><button type="submit" id="submit">保存新密码，进入考谱 →</button></form><div id="message" role="status" aria-live="polite"></div><footer><a href="/?auth=login">返回登录</a></footer></main><script nonce="${nonce}">
(() => {
 let token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
 const form=document.getElementById('form'),missing=document.getElementById('missing'),message=document.getElementById('message'),password=document.getElementById('password'),confirm=document.getElementById('confirm'),button=document.getElementById('submit');
 if(!/^[a-f0-9]{64}$/.test(token)){missing.hidden=false;return;}form.hidden=false;password.focus();
 confirm.addEventListener('input',()=>confirm.setCustomValidity(''));password.addEventListener('input',()=>confirm.setCustomValidity(''));
 form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;if(password.value!==confirm.value){confirm.setCustomValidity('两次输入的密码不一致。');confirm.reportValidity();return;}button.disabled=true;message.textContent='正在保存…';
 try{const response=await fetch('/api/auth/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:password.value})});const result=await response.json();if(!response.ok)throw new Error(result.error||'暂时未能保存，请重试。');token='';form.reset();form.hidden=true;message.style.color='#536f3f';message.textContent='密码已更新，正在进入学习空间…';setTimeout(()=>location.replace('/'),600);}catch(error){message.textContent=error.message||'连接中断，请重试。';button.disabled=false;}});
})();</script></body></html>`;
}
