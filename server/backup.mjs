import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import multer from 'multer';

const FORMAT = 'shifen-full-backup';
const VERSION = 1;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const FIXED_FILES = new Set(['state.json', 'lessons.json', 'auth.json', 'model-service.json', 'bilibili-session.json']);
const EXCLUDED_ROOT_FILES = new Set(['before-reset.json', 'before-reset-lessons.json', 'auth-recovery.json']);
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const sha256 = data => createHash('sha256').update(data).digest('hex');
const safeId = value => /^[A-Za-z0-9_-]{1,100}$/.test(value);
const temporaryName = name => name.endsWith('.tmp') || name.endsWith('.using');

function allowedDataPath(relative) {
  if (FIXED_FILES.has(relative) || relative === 'knowledge/log.md') return true;
  if (/^documents\/[A-Za-z0-9_-]{1,100}\.bin$/.test(relative)) return true;
  if (/^knowledge\/_raw\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\/(?:payload\.bin|manifest\.json)$/.test(relative)) return true;
  return /^lesson-visual\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\/(?:manifest\.json|frame-\d{4}\.jpg)$/.test(relative);
}

function validRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 600 || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every(part => part && part !== '.' && part !== '..');
}

async function listDataFiles(dataDir, withData = false) {
  const root = path.resolve(dataDir);
  const rootStat = await fsp.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw fail(500, '学习数据目录不可用。');
  const files = [], seen = new Set();
  let total = 0;
  async function add(absolute, relative) {
    const normalized = relative.split(path.sep).join('/');
    const key = normalized.toLowerCase();
    if (!validRelativePath(normalized) || !allowedDataPath(normalized) || seen.has(key)) throw fail(500, '发现未登记或冲突的数据文件，已停止备份。');
    const stat = await fsp.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) throw fail(500, '数据目录包含不支持的链接或文件类型。');
    if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_TOTAL_BYTES || files.length >= MAX_FILES) throw fail(413, '学习数据超过当前备份格式上限，请先清理不需要的资料。');
    seen.add(key); total += stat.size;
    const data = withData ? await fsp.readFile(absolute) : null;
    if (data && data.length !== stat.size) throw fail(409, '数据正在变化，请等待当前任务完成后重试。');
    files.push({ path: normalized, absolute, size: stat.size, data });
  }
  async function directoryEntries(directory) {
    const stat = await fsp.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail(500, '数据目录包含不支持的链接或文件类型。');
    return (await fsp.readdir(directory)).sort((a, b) => a.localeCompare(b));
  }
  for (const name of await directoryEntries(root)) {
    const absolute = path.join(root, name), stat = await fsp.lstat(absolute);
    if (stat.isSymbolicLink()) throw fail(500, '数据目录包含不支持的链接或文件类型。');
    if (stat.isDirectory()) {
      if (name === 'documents') {
        for (const child of await directoryEntries(absolute)) await add(path.join(absolute, child), `documents/${child}`);
      } else if (name === 'lesson-visual') {
        for (const lessonId of await directoryEntries(absolute)) {
          const lessonDir = path.join(absolute, lessonId);
          for (const evidenceId of await directoryEntries(lessonDir)) {
            const evidenceDir = path.join(lessonDir, evidenceId);
            for (const child of await directoryEntries(evidenceDir)) await add(path.join(evidenceDir, child), `lesson-visual/${lessonId}/${evidenceId}/${child}`);
          }
        }
      } else if (name === 'knowledge') {
        for (const child of await directoryEntries(absolute)) {
          const childPath = path.join(absolute, child);
          if (child === 'log.md') {
            await add(childPath, 'knowledge/log.md');
          } else if (child === '_raw') {
            for (const courseId of await directoryEntries(childPath)) {
              const courseDir = path.join(childPath, courseId);
              for (const sourceId of await directoryEntries(courseDir)) {
                const sourceDir = path.join(courseDir, sourceId);
                for (const artifactId of await directoryEntries(sourceDir)) {
                  const artifactDir = path.join(sourceDir, artifactId);
                  for (const filename of await directoryEntries(artifactDir)) {
                    if (temporaryName(filename)) continue;
                    await add(path.join(artifactDir, filename), `knowledge/_raw/${courseId}/${sourceId}/${artifactId}/${filename}`);
                  }
                }
              }
            }
          }
          // All other knowledge entries are generated mirrors and are rebuilt after restore.
        }
      } else if (name === 'runtime' || name === 'uploads') {
        // 可再生成的运行时与未完成的上传不属于学习数据。
      } else throw fail(500, '发现未登记的数据目录，已停止备份以避免遗漏。');
    } else if (!EXCLUDED_ROOT_FILES.has(name) && !temporaryName(name)) await add(absolute, name);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function createBackupArchive({ dataDir }) {
  const first = await listDataFiles(dataDir, true);
  if (!first.some(file => file.path === 'state.json')) throw fail(500, '学习数据缺少主状态文件，无法创建完整备份。');
  const second = await listDataFiles(dataDir);
  if (first.length !== second.length || first.some((file, index) => file.path !== second[index].path || file.size !== second[index].size)) throw fail(409, '数据正在变化，请等待当前任务完成后重试。');
  for (let index = 0; index < second.length; index++) {
    const current = await fsp.readFile(second[index].absolute);
    if (sha256(current) !== sha256(first[index].data)) throw fail(409, '数据正在变化，请等待当前任务完成后重试。');
  }
  const manifest = {
    format: FORMAT, formatVersion: VERSION, createdAt: new Date().toISOString(), containsSensitiveData: true,
    files: first.map(file => ({ path: file.path, bytes: file.data.length, sha256: sha256(file.data) })),
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  for (const file of first) zip.file(`payload/${file.path}`, file.data);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (bytes.length > MAX_ARCHIVE_BYTES) throw fail(413, '备份包超过当前格式上限，请先清理不需要的资料。');
  return { bytes, filename: `shifen-full-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`, fileCount: first.length };
}

function readCentralDirectory(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw fail(400, '请选择有效的考谱完整备份ZIP。');
  const minimum = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= minimum; index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0 || eocd + 22 + buffer.readUInt16LE(eocd + 20) !== buffer.length) throw fail(400, '备份ZIP目录不完整或已损坏。');
  const disk = buffer.readUInt16LE(eocd + 4), centralDisk = buffer.readUInt16LE(eocd + 6);
  const count = buffer.readUInt16LE(eocd + 10), diskCount = buffer.readUInt16LE(eocd + 8);
  const centralSize = buffer.readUInt32LE(eocd + 12), centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk || centralDisk || count !== diskCount || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw fail(400, '不支持多卷或ZIP64备份，请使用考谱生成的完整备份。');
  if (count > MAX_FILES + 1 || centralOffset + centralSize > eocd) throw fail(413, '备份ZIP条目数量或目录大小超出限制。');
  const entries = [], names = new Set();
  let cursor = centralOffset, total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) throw fail(400, '备份ZIP目录结构无效。');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const compressedBytes = buffer.readUInt32LE(cursor + 20), bytes = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const start = cursor + 46, end = start + nameLength + extraLength + commentLength;
    if (end > eocd || compressedBytes === 0xffffffff || bytes === 0xffffffff || (flags & 1) || ![0, 8].includes(method)) throw fail(400, '备份ZIP使用了不支持的压缩或加密方式。');
    const name = buffer.subarray(start, start + nameLength).toString('utf8'), directory = name.endsWith('/');
    const normalized = directory ? name.slice(0, -1) : name;
    if (name.includes('\uFFFD') || !validRelativePath(normalized)) throw fail(400, '备份ZIP包含不安全或不支持的文件路径。');
    if (directory) { cursor = end; continue; }
    const key = name.toLowerCase();
    if (names.has(key)) throw fail(400, '备份ZIP包含重复或大小写冲突的文件路径。');
    if (bytes > MAX_FILE_BYTES || total + bytes > MAX_TOTAL_BYTES) throw fail(413, '备份解压后的内容超过当前恢复上限。');
    names.add(key); total += bytes; entries.push({ name, bytes }); cursor = end;
  }
  return entries;
}

function parseJson(data, label) {
  try { return JSON.parse(data.toString('utf8')); }
  catch { throw fail(400, `${label}不是有效JSON，备份未恢复。`); }
}

function rawReference(rawRef) {
  const match = /^(knowledge\/_raw\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,100}))\/(payload\.bin|external)$/.exec(rawRef);
  if (!match) throw fail(400, '备份中的 Raw 引用路径无效。');
  return { base: match[1], manifestPath: `${match[1]}/manifest.json`, external: match[5] === 'external' };
}

function validateSemanticFiles(files, authEnabled) {
  const byPath = new Map(files.map(file => [file.path, file.data]));
  const state = parseJson(byPath.get('state.json'), 'state.json');
  for (const key of ['courses', 'documents', 'cards', 'questions', 'attempts', 'completedTasks']) {
    if (!Array.isArray(state?.[key])) throw fail(400, `备份主状态缺少有效的${key}数据。`);
  }
  let savedLessons = [];
  if (byPath.has('lessons.json')) {
    const saved = parseJson(byPath.get('lessons.json'), 'lessons.json');
    if (saved?.version !== 1 || !Array.isArray(saved.lessons) || saved.lessons.length > 100 || saved.lessons.some(item => !item || typeof item.id !== 'string' || !Array.isArray(item.cues))) throw fail(400, '备份中的网课数据结构无效。');
    savedLessons = saved.lessons;
    for (const lesson of savedLessons) {
      if (!lesson.visual?.id) continue;
      if (!safeId(lesson.id) || !safeId(lesson.visual.id) || !Array.isArray(lesson.visual.frames)) throw fail(400, '备份中的网课视觉证据引用无效。');
      const root = `lesson-visual/${lesson.id}/${lesson.visual.id}`;
      if (!byPath.has(`${root}/manifest.json`)) throw fail(400, '备份缺少网课视觉证据清单。');
      for (const frame of lesson.visual.frames) {
        if (!/^frame-\d{4}$/.test(frame?.id) || !byPath.has(`${root}/${frame.id}.jpg`)) throw fail(400, '备份缺少网课关键帧图片。');
      }
    }
  }
  if (byPath.has('model-service.json')) {
    const settings = parseJson(byPath.get('model-service.json'), 'model-service.json');
    if (settings?.version !== 1 || !settings.text || !settings.vision || !settings.verification || typeof settings.verification !== 'object') throw fail(400, '备份中的模型配置结构无效。');
  }
  if (byPath.has('auth.json')) {
    const account = parseJson(byPath.get('auth.json'), 'auth.json');
    if (account?.version !== 1 || account.algorithm !== 'scrypt-N32768-r8-p1' || typeof account.name !== 'string' || typeof account.email !== 'string' || !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{128}$/.test(account.hash)) throw fail(400, '备份中的账户数据结构无效。');
  } else if (authEnabled) throw fail(400, '启用账户登录时，完整备份必须包含auth.json。');
  if (byPath.has('bilibili-session.json')) {
    const session = parseJson(byPath.get('bilibili-session.json'), 'bilibili-session.json');
    if (!session || typeof session.cookieHeader !== 'string' || !session.cookieHeader.includes('SESSDATA=') || session.cookieHeader.length > 8192 || /[\u0000-\u001f\u007f]/.test(session.cookieHeader)
      || typeof session.uname !== 'string' || session.uname.length > 60 || !Number.isFinite(session.savedAt)) throw fail(400, '备份中的 B 站会话结构无效。');
  }
  for (const document of state.documents) {
    if (document?.hasOriginal && (!safeId(document.id) || !byPath.has(`documents/${document.id}.bin`))) throw fail(400, '备份缺少已声明的资料原件。');
  }
  for (const file of files) {
    if (/^lesson-visual\/.+\/manifest\.json$/.test(file.path)) {
      const manifest = parseJson(file.data, file.path);
      if (!manifest || typeof manifest !== 'object' || !safeId(manifest.id) || !safeId(manifest.lessonId)) throw fail(400, '备份中的视觉证据清单结构无效。');
    }
  }

  const referencedRaw = [];
  for (const document of state.documents) if (document?.rawRef) referencedRaw.push(document.rawRef);
  for (const lesson of savedLessons) {
    referencedRaw.push(...[lesson.rawRef, lesson.rawMetadataRawRef, lesson.mediaRawRef, ...(Array.isArray(lesson.rawRefs) ? lesson.rawRefs : [])].filter(Boolean));
    if (Array.isArray(lesson.visual?.frames)) referencedRaw.push(...lesson.visual.frames.map(frame => frame?.rawRef).filter(Boolean));
  }
  for (const rawRef of referencedRaw) {
    const reference = rawReference(rawRef);
    if (!byPath.has(reference.manifestPath)) throw fail(400, '备份缺少已引用的 Raw 清单。');
  }
  for (const file of files) {
    if (!/^knowledge\/_raw\/.+\/manifest\.json$/.test(file.path)) continue;
    const manifest = parseJson(file.data, file.path);
    const match = /^(knowledge\/_raw\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9_-]{1,100}))\/manifest\.json$/.exec(file.path);
    if (!match || manifest?.version !== 1 || manifest.courseId !== match[2] || manifest.sourceId !== match[3] || manifest.artifactId !== match[4]
      || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || manifest.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw fail(400, '备份中的 Raw 清单结构无效。');
    const external = Object.hasOwn(manifest, 'externalPath');
    if (manifest.rawRef !== `${match[1]}/${external ? 'external' : 'payload.bin'}`) throw fail(400, '备份中的 Raw 引用与清单不一致。');
    let payloadPath = `${match[1]}/payload.bin`;
    if (external) {
      payloadPath = manifest.externalPath;
      if (!validRelativePath(payloadPath) || payloadPath.startsWith('knowledge/_raw/') || !allowedDataPath(payloadPath)) throw fail(400, '备份中的 Raw 外部原件路径无效。');
    }
    const payload = byPath.get(payloadPath);
    if (!payload || payload.length !== manifest.size || sha256(payload) !== manifest.sha256) throw fail(400, '备份中的 Raw 原件缺失或哈希不一致。');
  }
  for (const file of files) {
    if (/^knowledge\/_raw\/.+\/payload\.bin$/.test(file.path) && !byPath.has(file.path.replace(/payload\.bin$/, 'manifest.json'))) throw fail(400, '备份中的 Raw 原件缺少清单。');
  }
}

export async function inspectBackupArchive(archive, { authEnabled = false } = {}) {
  if (!Buffer.isBuffer(archive) || archive.length > MAX_ARCHIVE_BYTES) throw fail(413, '备份ZIP超过256 MiB上传上限。');
  const entries = readCentralDirectory(archive);
  const entryMap = new Map(entries.map(entry => [entry.name, entry]));
  if (!entryMap.has('manifest.json') || entryMap.get('manifest.json').bytes > MAX_MANIFEST_BYTES) throw fail(400, '备份缺少有效的manifest.json。');
  let zip;
  try { zip = await JSZip.loadAsync(archive, { checkCRC32: false }); }
  catch { throw fail(400, '备份ZIP无法读取或已损坏。'); }
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw fail(400, '备份缺少manifest.json。');
  const manifest = parseJson(await manifestEntry.async('nodebuffer'), 'manifest.json');
  if (manifest?.format !== FORMAT || manifest.formatVersion !== VERSION || manifest.containsSensitiveData !== true || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES) throw fail(400, '备份清单格式或版本不受支持。');
  const expected = new Set(['manifest.json']), seen = new Set();
  for (const file of manifest.files) {
    if (!validRelativePath(file?.path) || !allowedDataPath(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(file.sha256)) throw fail(400, '备份清单包含无效的文件记录。');
    const key = file.path.toLowerCase(), entryName = `payload/${file.path}`;
    if (seen.has(key) || !entryMap.has(entryName) || entryMap.get(entryName).bytes !== file.bytes) throw fail(400, '备份清单与ZIP文件集合或大小不一致。');
    seen.add(key); expected.add(entryName);
  }
  if (entryMap.size !== expected.size || [...entryMap.keys()].some(name => !expected.has(name))) throw fail(400, '备份ZIP包含清单之外的文件。');
  if (!seen.has('state.json') || (authEnabled && !seen.has('auth.json'))) throw fail(400, '备份缺少恢复当前服务所需的主状态或账户文件。');
  const files = [];
  let total = 0;
  for (const record of manifest.files) {
    const entryName = `payload/${record.path}`, entry = zip.file(entryName);
    if (!entry) throw fail(400, '备份ZIP缺少清单声明的文件。');
    let data;
    try { data = await entry.async('nodebuffer'); }
    catch { throw fail(400, '备份ZIP中的文件无法解压。'); }
    total += data.length;
    if (data.length !== record.bytes || sha256(data) !== record.sha256 || total > MAX_TOTAL_BYTES) throw fail(400, '备份文件大小或SHA256校验失败。');
    files.push({ path: record.path, data });
  }
  validateSemanticFiles(files, authEnabled);
  return { manifest, files };
}

function restorePaths(dataDir) {
  const root = path.resolve(dataDir);
  return { root, pending: `${root}.restore-pending`, rollback: `${root}.restore-rollback` };
}

export async function stageBackupRestore({ dataDir, archive, authEnabled = false }) {
  const { root, pending, rollback } = restorePaths(dataDir);
  if (fs.existsSync(pending) || fs.existsSync(rollback)) throw fail(409, '已有待完成的恢复操作，请先重启服务。');
  const { manifest, files } = await inspectBackupArchive(archive, { authEnabled });
  const work = `${root}.restore-work-${randomUUID()}`, workData = path.join(work, 'data');
  try {
    await fsp.mkdir(workData, { recursive: true });
    await fsp.writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    for (const file of files) {
      const target = path.resolve(workData, ...file.path.split('/'));
      if (!target.startsWith(workData + path.sep)) throw fail(400, '备份文件路径逃逸恢复目录。');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, file.data, { flag: 'wx' });
    }
    if (fs.existsSync(pending) || fs.existsSync(rollback)) throw fail(409, '已有待完成的恢复操作，请先重启服务。');
    await fsp.rename(work, pending);
    return { fileCount: files.length };
  } catch (error) {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    if (error.status) throw error;
    throw fail(500, '恢复包未能暂存，正式数据未更改。');
  }
}

export function preparePendingRestore(dataDir) {
  const { root, pending, rollback } = restorePaths(dataDir);
  const rootExists = fs.existsSync(root), pendingExists = fs.existsSync(pending), rollbackExists = fs.existsSync(rollback);
  if (!pendingExists) {
    if (rollbackExists) {
      if (rootExists) fs.rmSync(rollback, { recursive: true, force: true });
      else fs.renameSync(rollback, root);
    }
    return { applied: false };
  }
  if (rootExists && rollbackExists) {
    // A crash before commit is always resolved in favour of the last running dataset.
    fs.rmSync(root, { recursive: true, force: true });
    fs.renameSync(rollback, root);
    fs.rmSync(pending, { recursive: true, force: true });
    return { applied: false };
  }
  if (rootExists) fs.renameSync(root, rollback);
  fs.renameSync(path.join(pending, 'data'), root);
  return { applied: true };
}

export function commitPendingRestore(dataDir) {
  const { pending, rollback } = restorePaths(dataDir);
  fs.rmSync(pending, { recursive: true, force: true });
  fs.rmSync(rollback, { recursive: true, force: true });
}

export function abortPendingRestore(dataDir) {
  const { root, pending, rollback } = restorePaths(dataDir);
  fs.rmSync(root, { recursive: true, force: true });
  if (fs.existsSync(rollback)) fs.renameSync(rollback, root);
  fs.rmSync(pending, { recursive: true, force: true });
}

export function createBackupManager({ dataDir, authEnabled = false }) {
  let phase = 'idle';
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1, fields: 0, parts: 1 } });
  const status = (_req, res) => res.json({ phase, restartRequired: phase === 'restart-required' });
  const guard = (req, res, next) => {
    if (phase === 'restart-required') return res.status(503).json({ error: '恢复包已准备好，请重启考谱服务后继续。', code: 'RESTART_REQUIRED', restartRequired: true });
    if (phase !== 'idle' && (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) || ['/backup', '/backup/restore'].includes(req.path))) return res.status(409).json({ error: '另一项备份或恢复操作正在进行，请稍后重试。', code: 'BACKUP_BUSY' });
    next();
  };
  const run = async (next, operation) => {
    if (phase !== 'idle') throw fail(409, '另一项备份或恢复操作正在进行，请稍后重试。', 'BACKUP_BUSY');
    phase = 'exporting';
    try { return await operation(); }
    finally { phase = 'idle'; }
  };
  const mountRoutes = app => {
    app.get('/api/backup', async (_req, res, next) => {
      try {
        const result = await run(next, () => createBackupArchive({ dataDir }));
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Length', String(result.bytes.length));
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.bytes);
      } catch (error) { next(error); }
    });
    app.post('/api/backup/restore', (req, res, next) => {
      upload.single('file')(req, res, error => {
        if (error) return next(fail(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? '备份ZIP超过256 MiB上传上限。' : '请只上传一份完整备份ZIP。'));
        next();
      });
    }, async (req, res, next) => {
      if (phase !== 'idle') return next(fail(409, '另一项备份或恢复操作正在进行，请稍后重试。', 'BACKUP_BUSY'));
      if (!req.file) return next(fail(400, '请选择要恢复的完整备份ZIP。'));
      phase = 'validating-restore';
      try {
        const result = await stageBackupRestore({ dataDir, archive: req.file.buffer, authEnabled });
        phase = 'restart-required';
        res.status(202).json({ ok: true, restartRequired: true, fileCount: result.fileCount, message: '恢复包已验证，请重启服务完成恢复。' });
        setImmediate(() => app.emit('shifen:close'));
      } catch (error) { phase = 'idle'; next(error); }
    });
  };
  return { status, guard, mountRoutes };
}
