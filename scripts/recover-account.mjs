import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueLocalRecovery } from '../server/auth-recovery.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try {
  const email = process.argv.slice(2).find(argument => argument !== '--json');
  const result = issueLocalRecovery({ dataDir: process.env.DATA_DIR || path.join(root, 'data'), origin: 'http://127.0.0.1:3001', email });
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else console.log(`请在本机浏览器打开下面的15分钟一次性恢复链接，并自行设置新密码。学习资料会保留。\n${result.url}\n请勿把链接或新密码发给其他人。`);
} catch (error) { console.error(error.message || '未能创建恢复入口，请确认本机账户存在，且在正确的项目目录运行。'); process.exitCode = 1; }
