import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const safeId = (value, label) => {
  if (typeof value !== 'string' || !ID.test(value)) throw Object.assign(new Error(`${label}无效。`), { status: 400 });
  return value;
};
const digest = value => createHash('sha256').update(value).digest('hex');
const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';

/** Immutable, content-addressed source bytes. Markdown mirrors never write here. */
export function createRawStore({ dataDir }) {
  if (!dataDir) throw new Error('Raw store requires dataDir');
  const workspace = path.resolve(dataDir);
  const root = path.resolve(dataDir, 'knowledge', '_raw');
  const resolveRef = rawRef => {
    if (typeof rawRef !== 'string' || !rawRef.startsWith('knowledge/_raw/') || rawRef.length > 500) throw Object.assign(new Error('Raw 引用无效。'), { status: 400 });
    const relative = rawRef.slice('knowledge/_raw/'.length);
    const segments = relative.split('/');
    if (segments.some(part => !part || part === '.' || part === '..')) throw Object.assign(new Error('Raw 引用无效。'), { status: 400 });
    const target = path.resolve(root, ...segments);
    const inside = path.relative(root, target);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw Object.assign(new Error('Raw 引用无效。'), { status: 400 });
    return target;
  };

  function put({ courseId, sourceId, artifactId, data, kind = 'source', mime = 'application/octet-stream', fileName = 'payload.bin', source = {}, extractor = 'shifen-raw-v1', references = [] }) {
    safeId(courseId, '课程标识'); safeId(sourceId, '来源标识');
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    if (!bytes.length) throw Object.assign(new Error('不能归档空的原始内容。'), { status: 422 });
    if (bytes.length > 2 * 1024 * 1024 * 1024) throw Object.assign(new Error('原始内容超过 2 GB 上限。'), { status: 413 });
    const sha256 = digest(bytes);
    const id = safeId(artifactId || `${String(kind).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'source'}-${sha256.slice(0, 20)}`, '产物标识');
    const directory = path.join(root, courseId, sourceId, id);
    const rawRef = `knowledge/_raw/${courseId}/${sourceId}/${id}/payload.bin`;
    const payload = resolveRef(rawRef);
    const manifestPath = path.join(directory, 'manifest.json');
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(payload)) {
      const existing = fs.readFileSync(payload);
      if (digest(existing) !== sha256) throw Object.assign(new Error('Raw 产物标识已被不同内容占用，拒绝覆盖不可变原件。'), { status: 409 });
      return { rawRef, sha256, size: existing.length, duplicate: true };
    }
    const suffix = randomUUID();
    const temporary = `${payload}.${suffix}.tmp`;
    const temporaryManifest = `${manifestPath}.${suffix}.tmp`;
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      if (digest(fs.readFileSync(temporary)) !== sha256) throw new Error('Raw 写入校验失败。');
      try { fs.linkSync(temporary, payload); }
      catch (error) {
        if (error.code !== 'EEXIST') { fs.renameSync(temporary, payload); }
      }
      if (!fs.existsSync(payload)) fs.renameSync(temporary, payload);
      if (digest(fs.readFileSync(payload)) !== sha256) throw Object.assign(new Error('Raw 原件哈希冲突，拒绝覆盖。'), { status: 409 });
      const manifest = {
        version: 1, courseId, sourceId, artifactId: id, kind: text(kind, 80), mime: text(mime, 200), fileName: text(fileName, 240),
        size: bytes.length, sha256, rawRef, ingestedAt: new Date().toISOString(), extractor: text(extractor, 120),
        source: {
          url: text(source.url, 1000), bvid: text(source.bvid, 30), part: Number.isInteger(source.part) ? source.part : undefined,
          title: text(source.title, 300), originalName: text(source.originalName, 240), legacyDerived: source.legacyDerived === true || undefined,
        },
        references: Array.isArray(references) ? references.filter(item => item && typeof item === 'object').slice(0, 100).map(item => ({
          kind: text(item.kind, 40), id: text(item.id, 120), rawRef: text(item.rawRef, 500),
        })) : [],
      };
      fs.writeFileSync(temporaryManifest, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
      if (!fs.existsSync(manifestPath)) fs.renameSync(temporaryManifest, manifestPath);
    } finally {
      for (const filename of [temporary, temporaryManifest]) if (fs.existsSync(filename)) fs.unlinkSync(filename);
    }
    return { rawRef, sha256, size: bytes.length, duplicate: false };
  }

  function read(rawRef, { verify = false } = {}) {
    const reference = resolveRef(rawRef), manifestPath = path.join(path.dirname(reference), 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw Object.assign(new Error('Raw 原件清单不存在。'), { status: 404 });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let realPayload;
    if (manifest.externalPath) {
      if (typeof manifest.externalPath !== 'string' || manifest.externalPath.length > 500) throw Object.assign(new Error('Raw 外部原件路径无效。'), { status: 400 });
      const candidate = path.resolve(workspace, ...manifest.externalPath.split('/'));
      const outside = path.relative(workspace, candidate);
      if (outside.startsWith('..') || path.isAbsolute(outside) || !fs.existsSync(candidate)) throw Object.assign(new Error('Raw 外部原件不存在或路径无效。'), { status: 404 });
      realPayload = fs.realpathSync(candidate);
      const realOutside = path.relative(fs.realpathSync(workspace), realPayload);
      if (realOutside.startsWith('..') || path.isAbsolute(realOutside)) throw Object.assign(new Error('Raw 外部原件路径无效。'), { status: 400 });
    } else {
      if (!fs.existsSync(reference)) throw Object.assign(new Error('Raw 原件不存在。'), { status: 404 });
      realPayload = fs.realpathSync(reference);
      const inside = path.relative(fs.realpathSync(root), realPayload);
      if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw Object.assign(new Error('Raw 引用无效。'), { status: 400 });
    }
    const data = fs.readFileSync(realPayload);
    if (verify && (digest(data) !== manifest.sha256 || data.length !== manifest.size)) throw Object.assign(new Error('Raw 原件哈希校验失败。'), { status: 409 });
    return { data, manifest, path: realPayload };
  }

  function verify(rawRef) {
    try {
      const { data, manifest } = read(rawRef);
      const actual = digest(data);
      return { rawRef, ok: actual === manifest.sha256 && data.length === manifest.size, expected: manifest.sha256, actual, size: data.length };
    } catch (error) { return { rawRef, ok: false, error: error.message }; }
  }

  function registerFile(options) {
    // 新摄取的关键帧也复制到内容寻址 Raw 存储，避免工作文件被覆盖后破坏原件。
    // read() 仍兼容早期 external manifest，已有数据无需迁移即可校验。
    if (!options?.path || !fs.existsSync(options.path)) throw Object.assign(new Error('Raw 原文件不存在。'), { status: 404 });
    const relative = path.relative(workspace, path.resolve(options.path));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('Raw 外部原件必须位于当前用户工作区。'), { status: 400 });
    return putFile(options);
  }

  function putFile(options) {
    if (!options?.path || !fs.existsSync(options.path)) throw Object.assign(new Error('Raw 原文件不存在。'), { status: 404 });
    return put({ ...options, data: fs.readFileSync(options.path) });
  }

  return { root, put, putFile, registerFile, read, verify, resolveRef };
}
