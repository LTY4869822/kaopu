import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zip = new JSZip();
const manifest = [];
const folders = ['src', 'server', 'public', 'tests', 'scripts', 'vendor'];
const files = ['package.json', 'package-lock.json', 'requirements-local.txt', 'requirements-docling.txt', 'tsconfig.json', 'vite.config.ts', 'index.html', '.env.example', '.gitignore', 'README.md', 'PRODUCT.md', 'DESIGN.md', 'THIRD_PARTY_NOTICES.md'];
// Top-level allowlists already omit model/runtime directories. Keep this guard
// for nested paths and future allowlist changes as well.
const excludedSegments = new Set(['.local', '.venv-docling', '__pycache__']);
async function include(relative) {
  if (relative.split(/[\\/]/).some((segment) => excludedSegments.has(segment)) || relative.endsWith('.pyc')) return;
  const absolute = path.join(root, relative);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`打包不包含符号链接：${relative}`);
  if (stat.isDirectory()) {
    for (const name of (await fs.readdir(absolute)).sort()) await include(`${relative}/${name}`);
    return;
  }
  const data = await fs.readFile(absolute);
  zip.file(`shifen/${relative}`, data);
  manifest.push({ path: relative, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
for (const folder of folders) await include(folder);
for (const file of files) await include(file);
// Only authored product docs; downloaded third-party research is deliberately absent.
for (const name of (await fs.readdir(path.join(root, 'docs'))).sort()) if (name.endsWith('.md')) await include(`docs/${name}`);
zip.file('shifen/BUILD_MANIFEST.json', JSON.stringify({ createdAt: new Date().toISOString(),
  description: '本次打包文件及哈希；不代表历史提交记录、原创证明或赛事批准。',
  exclusions: ['data/', '.env', '.local/', '.venv-docling/', 'node_modules/', 'dist/', 'docs/research/', 'docs/design-references/', 'test-results/'], files: manifest }, null, 2));
await fs.mkdir(path.join(root, 'output'), { recursive: true });
const target = path.join(root, 'output', 'shifen-competition-source.zip');
await fs.writeFile(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
console.log(`参赛源码包：${target}（${manifest.length} 个文件，未包含个人数据、密钥或外站研究下载）`);
