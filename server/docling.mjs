import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { access, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { parseDocument, validateDocumentFile } from './parsers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TEXT = 1_000_000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const SAFE_ERROR = Symbol('public-docling-error');
const supported = new Set(['.pdf', '.docx', '.pptx']);
const issue = (message, status = 422, code = 'DOCLING_ERROR') => Object.assign(new Error(message), { status, code, [SAFE_ERROR]: true });
const aborted = () => issue('解析已取消。', 499, 'ABORT_ERR');

function killOwnedProcess(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // The adapter uses in-process Office parsing / ONNX threads, no shell or
    // external OCR process. TerminateProcess avoids slow taskkill/WMI startup.
    child.kill();
  } else child.kill('SIGKILL');
}

export async function runDoclingProcess({ pythonPath, args, signal, timeoutMs, maxOutputBytes }) {
  let executable = pythonPath;
  const environment = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1' };
  // CPython's Windows venv python.exe is a redirector which spawns another
  // Python. Run the configured base interpreter with this venv's site-packages
  // first, so the process we own/terminate is the actual extraction worker.
  if (process.platform === 'win32' && /[\\/]Scripts[\\/]python(?:\.exe)?$/i.test(pythonPath)) {
    try {
      const venv = path.dirname(path.dirname(pythonPath));
      const configuration = await readFile(path.join(venv, 'pyvenv.cfg'), 'utf8');
      const home = configuration.match(/^home\s*=\s*(.+)$/m)?.[1]?.trim();
      const candidate = home && path.join(home, 'python.exe');
      if (candidate && path.isAbsolute(candidate)) {
        await access(candidate);
        executable = candidate;
        environment.PYTHONPATH = path.join(venv, 'Lib', 'site-packages');
        environment.VIRTUAL_ENV = venv;
      }
    } catch { /* Non-venv custom interpreters are launched as configured. */ }
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const child = spawn(executable, args, {
      cwd: ROOT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: environment,
    });
    const output = [];
    let bytes = 0;
    let fatal;
    const stop = (error) => { if (!fatal) { fatal = error; killOwnedProcess(child); } };
    const onAbort = () => stop(aborted());
    const timer = setTimeout(() => stop(issue('结构化解析超时，请拆分文档或改用基础解析。', 504, 'DOCLING_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (data) => {
      bytes += data.length;
      if (bytes > maxOutputBytes) stop(issue('解析结果过大，请按章节拆分文档。', 422, 'DOCLING_LIMIT'));
      else output.push(data);
    });
    // Drain logging without retaining or returning paths, file content, or keys.
    child.stderr.on('data', () => {});
    child.on('error', () => { fatal ||= issue('无法启动 Docling，请检查隔离环境或 DOCLING_PYTHON 配置。', 503, 'DOCLING_UNAVAILABLE'); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (fatal) reject(fatal);
      else resolve({ stdout: Buffer.concat(output).toString('utf8'), exitCode });
    });
  });
}

function nativeResult(parsed) {
  return {
    ...parsed, parser: { engine: 'native', ocr: false, formula: false },
    structure: { blocks: parsed.chunks.map((chunk) => ({
      id: chunk.id, text: chunk.text, label: 'text',
      ...(parsed.locationKind === 'section' ? { section: chunk.page } : { page: chunk.page }),
    })) },
  };
}

function normalizeResult(raw, extension, pageCount) {
  const section = extension === '.docx';
  if (!raw || raw.parser?.engine !== 'docling' || !Array.isArray(raw.chunks) || !raw.chunks.length || !Array.isArray(raw.structure?.blocks)
      || raw.chunks.length > 5000 || raw.structure.blocks.length > 10000) throw issue('没有提取到可定位文字，请检查原件或导出为含文字的 PDF。');
  if (Array.isArray(raw.structure.pages) && raw.structure.pages.length > 250) throw issue('单个文档最多支持 250 页，请拆分后重试。');
  const text = (v, limit = 20000) => {
    if (typeof v !== 'string' || v.length > limit) throw issue('解析结果过大或格式不完整，请拆分文档后重试。', 422, 'DOCLING_LIMIT');
    return v.replace(/\u0000/g, '');
  };
  const bbox = (v) => {
    if (!v || !['l', 't', 'r', 'b'].every((key) => Number.isFinite(v[key]) && Math.abs(v[key]) <= 1e9)) return undefined;
    return { l: v.l, t: v.t, r: v.r, b: v.b, coordOrigin: v.coordOrigin === 'BOTTOMLEFT' ? 'BOTTOMLEFT' : 'TOPLEFT' };
  };
  const location = (item) => {
    if (section) return {};
    if (!Number.isInteger(item.page) || item.page < 1 || item.page > Math.min(pageCount || 250, 250)) throw issue('解析页码与原文件不匹配，请重新导出文件。');
    return { page: item.page };
  };
  let blockChars = 0;
  const blocks = raw.structure.blocks.map((block) => {
    const content = text(block.text, MAX_TEXT);
    blockChars += content.length;
    if (blockChars > MAX_TEXT) throw issue('提取的文字超过 100 万字符，请按章节拆分后重试。');
    return { id: text(block.id, 2000), text: content, label: text(block.label || 'text', 100),
      ...(!section && block.page != null ? location(block) : {}),
      ...(section && Number.isInteger(block.section) ? { section: block.section } : {}),
      ...(bbox(block.bbox) ? { bbox: bbox(block.bbox) } : {}),
      ...(typeof block.sourceRef === 'string' ? { sourceRef: text(block.sourceRef, 2000) } : {}),
      ...(Array.isArray(block.charspan) && block.charspan.length === 2 && block.charspan.every(Number.isSafeInteger) ? { charspan: block.charspan } : {}),
    };
  });
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  let chunkChars = 0;
  const chunks = raw.chunks.map((chunk) => {
    const block = blockMap.get(chunk.blockId);
    if (!block) throw issue('解析结果缺少原文关联，请重新解析文件。');
    const content = text(chunk.text, 12000);
    chunkChars += content.length;
    if (chunkChars > 1_250_000) throw issue('提取的文字超过上限，请按章节拆分后重试。');
    if (section && (!Number.isInteger(chunk.page) || chunk.page < 1 || chunk.page > 10000)) throw issue('文档分节信息无效，请重新导出文件。');
    if (!section && chunk.page !== block.page) throw issue('解析结果的原文位置不一致，请重新解析文件。');
    return { id: text(chunk.id, 2000), text: content, ...(section ? { page: chunk.page, section: chunk.page } : location(chunk)),
      blockId: block.id, ...(block.bbox ? { bbox: block.bbox } : {}), ...(block.sourceRef ? { sourceRef: block.sourceRef } : {}),
      ...(block.charspan ? { charspan: block.charspan } : {}),
    };
  });
  const pages = !section && Array.isArray(raw.structure.pages) ? raw.structure.pages.slice(0, 250).map((p) => ({
    ...location(p), ...(Number.isFinite(p.width) ? { width: p.width } : {}), ...(Number.isFinite(p.height) ? { height: p.height } : {}),
  })) : undefined;
  // Cell text is already represented in the corresponding table block. Keep a
  // bounded structural table summary, with no arbitrary paths/HTML from Python.
  const tables = Array.isArray(raw.structure.tables) ? raw.structure.tables.slice(0, 1000).map((table) => ({
    id: text(table.id, 2000), ...(Number.isInteger(table.rows) ? { rows: table.rows } : {}), ...(Number.isInteger(table.columns) ? { columns: table.columns } : {}),
  })) : undefined;
  return {
    type: extension.slice(1).toUpperCase(), chunks, locationKind: section ? 'section' : 'page',
    parser: { engine: 'docling', ...(typeof raw.parser?.version === 'string' ? { version: text(raw.parser.version, 100) } : {}), ...(raw.parser?.backend === 'pypdfium2' ? { backend: 'pypdfium2' } : {}), ocr: extension === '.pdf' && raw.parser?.ocr === true, formula: false },
    structure: { blocks, ...(pages ? { pages } : {}), ...(tables ? { tables } : {}) },
    warning: section ? 'Word 按结构分节，引用编号不是原文页码。图片中的文字需导出 PDF 后使用 OCR。' : '已保留原文位置；公式富化未开启，表格、图片和识别文字请对照原件检查。',
  };
}

export function createDocumentParser(options = {}) {
  const pythonPath = options.pythonPath || process.env.DOCLING_PYTHON || path.join(ROOT, '.venv-docling', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const artifactsPath = options.artifactsPath || process.env.DOCLING_ARTIFACTS_PATH || path.join(ROOT, '.local', 'docling-models');
  const scriptPath = path.join(ROOT, 'scripts', 'docling-convert.py');
  const runProcess = options.runProcess || runDoclingProcess;
  const native = options.nativeParser || parseDocument;
  const validate = options.validateFile || validateDocumentFile;
  const timeoutMs = Math.max(100, Math.min(options.timeoutMs || 180000, 600000));
  const maxOutputBytes = Math.min(options.maxOutputBytes || MAX_OUTPUT, MAX_OUTPUT);
  let active = false;
  const queue = [];
  let cachedStatus;
  let cachedAt = 0;
  let pendingProbe;

  async function serial(task, signal) {
    if (signal?.aborted) throw aborted();
    if (queue.length >= 8) throw issue('解析队列已满，请等待当前文档处理完成。', 429, 'DOCLING_BUSY');
    await new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: undefined };
      entry.onAbort = () => { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); reject(aborted()); };
      if (!active) { active = true; resolve(); }
      else { queue.push(entry); signal?.addEventListener('abort', entry.onAbort, { once: true }); }
    });
    try { if (signal?.aborted) throw aborted(); return await task(); }
    finally {
      const next = queue.shift();
      if (next) { next.signal?.removeEventListener('abort', next.onAbort); next.resolve(); }
      else active = false;
    }
  }

  async function status() {
    if (cachedStatus && Date.now() - cachedAt < 30000) return { ...cachedStatus };
    if (pendingProbe) return pendingProbe;
    pendingProbe = serial(async () => {
      const unavailable = { available: false, engine: 'docling', ocrReady: false, formula: false, message: 'Docling 尚未就绪，请按接入文档安装隔离环境；当前仍可使用基础解析。' };
      try {
        if (!options.runProcess) await access(pythonPath);
        const result = await runProcess({ pythonPath, args: [scriptPath, '--probe', '--artifacts-path', artifactsPath], timeoutMs: Math.min(timeoutMs, 60000), maxOutputBytes: 32768 });
        if (Buffer.byteLength(result.stdout || '', 'utf8') > 32768) return unavailable;
        const probe = JSON.parse(result.stdout);
        if (result.exitCode || probe.available !== true) return unavailable;
        return { available: true, engine: 'docling', ocrReady: probe.ocrReady === true, structuredPdfReady: probe.structuredPdfReady === true, formula: false,
          ...(typeof probe.version === 'string' ? { version: probe.version.slice(0, 100) } : {}),
          message: probe.ocrReady ? 'Docling 已就绪，可结构化解析和扫描 PDF OCR；公式富化关闭。' : 'Docling 可读取 Word 和 PPTX；本地 OCR 模型尚未就绪，扫描 PDF 需先下载模型。' };
      } catch { return unavailable; }
    }).then((value) => { cachedStatus = value; cachedAt = Date.now(); return { ...value }; }).finally(() => { pendingProbe = undefined; });
    return pendingProbe;
  }

  async function parse(file, { mode = 'auto', signal } = {}) {
    if (!['auto', 'structured', 'basic'].includes(mode)) throw issue('请选择自动、结构化或基础解析模式。', 400);
    if (signal?.aborted) throw aborted();
    const { extension, pageCount } = await validate(file);
    if (mode === 'structured' && !supported.has(extension)) throw issue('结构化解析支持 PDF、DOCX 和 PPTX；此文件请使用基础解析。');
    let initial;
    let nativeError;
    if (mode !== 'structured') {
      try { initial = await native(file); }
      catch (error) {
        if (mode === 'basic' || !supported.has(extension) || !/没有提取|扫描|OCR/i.test(error.message || '')) throw error;
        nativeError = error;
      }
      if (signal?.aborted) throw aborted();
      const content = initial?.chunks?.map((c) => c.text).join('') || '';
      const coveredPages = new Set(initial?.chunks?.filter((c) => c.text?.trim()).map((c) => c.page)).size;
      const lowCoverage = extension === '.pdf' && pageCount > 1 && coveredPages / pageCount < 0.8;
      const enough = !lowCoverage && content.replace(/\s/g, '').length >= Math.max(40, (pageCount || 1) * 15) && (content.match(/\uFFFD/g)?.length || 0) < content.length * 0.03;
      if (initial && (mode === 'basic' || !supported.has(extension) || enough)) return nativeResult(initial);
    }
    const health = await status();
    if (signal?.aborted) throw aborted();
    if (!health.available) {
      if (mode === 'auto' && initial) return { ...nativeResult(initial), warning: `${initial.warning || ''} 文字较少，Docling 尚未就绪，可安装后重新解析。`.trim() };
      throw issue(nativeError ? '此文件需要 OCR，但 Docling 尚未就绪。请安装本地解析环境和模型，或上传含文字的文件。' : 'Docling 尚未就绪，请安装隔离环境后重试，或选择基础解析。', 503, 'DOCLING_UNAVAILABLE');
    }
    return serial(async () => {
      let directory;
      try {
        directory = await mkdtemp(path.join(os.tmpdir(), 'shifen-docling-'));
        const inputPath = path.join(directory, `input${extension}`);
        await writeFile(inputPath, file.buffer);
        const result = await runProcess({ pythonPath, args: [scriptPath, '--input', inputPath, '--type', extension.slice(1), '--artifacts-path', artifactsPath, '--ocr', 'auto'], signal, timeoutMs, maxOutputBytes });
        if (signal?.aborted) throw aborted();
        if (Buffer.byteLength(result.stdout || '', 'utf8') > maxOutputBytes) throw issue('解析结果过大，请拆分文档。', 422, 'DOCLING_LIMIT');
        let raw;
        try { raw = JSON.parse(result.stdout); } catch { throw issue('Docling 未返回有效结果，请重新导出文件或使用基础解析。'); }
        if (result.exitCode || raw.error) {
          const code = raw.error?.code;
          if (code === 'MODELS_MISSING') throw issue('本地 OCR／版面模型尚未就绪，请按接入文档下载模型后重试。', 503, code);
          if (code === 'LIMIT_EXCEEDED') throw issue('文档或解析结果超过上限，请按章节拆分后重试。');
          throw issue('Docling 无法解析此文件，请检查是否损坏、加密或包含不支持的图形；可尝试导出 PDF 或使用基础解析。');
        }
        return normalizeResult(raw, extension, pageCount);
      } catch (error) {
        if (signal?.aborted) throw aborted();
        if (error[SAFE_ERROR]) throw error;
        // Never expose third-party tracebacks, environment values, or temp paths.
        throw issue('结构化解析失败，请检查本地环境、重新导出文件或选择基础解析。');
      } finally { if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {}); }
    }, signal);
  }
  return { parse, status };
}
