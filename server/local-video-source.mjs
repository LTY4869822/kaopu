import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/transcribe-course.py', import.meta.url));
const MAX_OUTPUT = 2 * 1024 * 1024;
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const ERRORS = {
  DEPENDENCIES_MISSING: '本地转写缺少 Python 依赖，请检查 yt-dlp、faster-whisper、PyAV 和 imageio-ffmpeg。',
  MODEL_CACHE_MISSING: '本机没有所选语音模型的完整缓存；本功能不会自动下载模型。请准备模型缓存后重试，或导入字幕。',
  CUDA_UNAVAILABLE: '本机 GPU 转写运行库不可用，请将 LOCAL_TRANSCRIPTION_DEVICE 改为 cpu，或准备兼容的 CUDA/cuDNN 运行库。',
  ACCESS_UNAVAILABLE: '无法匿名获取这节课的公开音频；请导入有权使用的字幕或文字。本功能不读取 Cookie 或绕过登录限制。',
  PART_UNAVAILABLE: '未取得指定的单个分 P，请检查课程链接和分 P 编号。',
  DURATION_LIMIT: '这节课超过本地转写时长限制；请分讲次处理或导入字幕。',
  DURATION_UNAVAILABLE: '无法确认这节课的有效时长，请重试或导入字幕。',
  SIZE_LIMIT: '课程音频超过本地处理大小限制，请按较短讲次处理。',
  MEDIA_HOST_UNSUPPORTED: '课程音频未使用支持的公开媒体地址，请导入字幕继续。',
  AUDIO_UNAVAILABLE: '没有取得可用的独立音轨，请导入字幕继续。',
  TRANSCRIPT_LIMIT: '转写内容超过 25 万字或 5000 段，请按较短讲次处理。',
  EMPTY_TRANSCRIPT: '没有识别到有效讲解文字，请检查原课音频或导入字幕。',
  TRANSCRIPTION_FAILED: '本地语音转写未完成，请检查 Python、模型缓存与音频格式后重试。',
  INVALID_REQUEST: '本地转写请求无效，请检查课程链接与服务配置。',
};

function durationLimitMessage(maxDurationSeconds, actual = false) {
  const subject = actual ? '音频实际时长' : '这节课';
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) return `${subject}超过本地转写时长限制；请分讲次处理或导入字幕。`;
  const limit = maxDurationSeconds % 60 === 0 ? `${maxDurationSeconds / 60} 分钟` : `${maxDurationSeconds} 秒`;
  return `${subject}超过本地转写时长限制（当前单讲上限 ${limit}）；请分讲次处理或导入字幕。`;
}

export function normalizeLocalVideoRequest(lesson) {
  let url;
  try { url = new URL(lesson?.url); } catch { throw fail('请使用有效的 B 站 BV 课程链接。', 400); }
  const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
  if (url.protocol !== 'https:' || !['www.bilibili.com', 'bilibili.com'].includes(url.hostname) || url.port || url.username || url.password || !match) throw fail('仅支持 B 站官方 HTTPS BV 视频链接。', 400);
  if (!Number.isInteger(lesson.part) || lesson.part < 1 || lesson.part > 1000) throw fail('请填写 1–1000 之间的有效分 P 编号。', 400);
  const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
  return { bvid: match[1], part: lesson.part, title: clean(lesson.title, 300), scope: clean(lesson.scope, 4000) };
}

async function terminateTree(child) {
  if (!child.pid || child.exitCode !== null && child.exitCode !== undefined) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      killer.once('error', () => { child.kill('SIGKILL'); resolve(); });
      killer.once('close', () => resolve());
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { child.kill('SIGKILL'); }
  }
}

function execute(python, input, { signal, timeoutMs, spawnImpl, killImpl, scriptArgs = [] }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    let child;
    try {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(AI_|BILINOTE_|VISION_)|COOKIE|SESSDATA|(?:^|_)(?:API_KEY|API_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD|TOKEN|CREDENTIALS)(?:_|$)/i.test(key)));
      env.HF_HUB_OFFLINE = '1'; env.HF_HUB_DISABLE_TELEMETRY = '1'; env.PYTHONIOENCODING = 'utf-8';
      child = spawnImpl(python, [SCRIPT, ...scriptArgs], { shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env });
    } catch { reject(fail('无法启动本地转写，请检查 Python 路径及运行权限。', 503)); return; }
    const output = []; let bytes = 0, settled = false, stopping = false, failure, forceTimer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const stop = (reason) => {
      if (stopping || settled) return;
      stopping = true; failure = reason;
      Promise.resolve(killImpl(child)).catch(() => { child.kill('SIGKILL'); });
      forceTimer = setTimeout(() => finish(failure), 3000);
      forceTimer.unref?.();
    };
    const abort = () => stop(signal.reason);
    const timer = setTimeout(() => stop(fail('本地课程转写已超时，请按较短分 P 重试。', 504)), timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(fail('无法启动本地转写，请检查 Python 路径、依赖和运行权限。', 503)));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) { stop(fail('本地转写返回内容过大，请分讲次处理。')); return; }
      output.push(Buffer.from(chunk));
    });
    // Drain diagnostics without returning local paths, credentials or media URLs.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('close', code => {
      if (failure) { finish(failure); return; }
      let result;
      try { result = JSON.parse(Buffer.concat(output).toString('utf8')); }
      catch { finish(fail('本地转写未返回有效结果，请检查 Python 依赖与模型缓存。')); return; }
      if (code !== 0 || result?.ok !== true) { finish(fail(result?.code === 'DURATION_LIMIT' ? durationLimitMessage(input.max_duration_seconds) : ERRORS[result?.code] || '本地转写未完成，请检查课程访问与模型缓存。', result?.code === 'MODEL_CACHE_MISSING' || result?.code === 'DEPENDENCIES_MISSING' ? 503 : 502)); return; }
      finish(null, result);
    });
    child.stdin.end(JSON.stringify(input));
    if (signal?.aborted) abort();
  });
}

function validateResult(result, maxDurationSeconds) {
  if (!Array.isArray(result?.body) || !result.body.length || result.body.length > 5000) throw fail('本地转写没有返回有效的逐段原文。');
  const duration = result.provenance?.audio_duration_seconds;
  if (!Number.isFinite(duration) || duration <= 0) throw fail('本地转写返回的音频时长无效，请重试或导入字幕。');
  if (duration > 7200 || duration > maxDurationSeconds + 5) throw fail(durationLimitMessage(maxDurationSeconds, true));
  let characters = 0, previous = 0;
  const body = result.body.map(item => {
    if (!Number.isFinite(item?.from) || !Number.isFinite(item?.to) || item.from < previous || item.to < item.from || item.to > duration + 5 || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 6000) throw fail('本地转写返回的文字或时间轴无效。');
    previous = item.from; characters += item.content.length;
    return { from: item.from, to: item.to, content: item.content };
  });
  const complete = result.provenance?.source_kind === 'platform-subtitles'
    ? result.provenance.processed_entire_source === true
    : result.provenance?.processed_entire_selected_audio === true;
  if (characters > 250000 || !complete) throw fail('本地来源没有完整处理当前讲次，结果未作为完整来源导入。');
  return body;
}

/** Opt-in only. Construction never starts Python, downloads media or models. */
export function createLocalVideoFetcher({
  enabled = process.env.LOCAL_TRANSCRIPTION === '1',
  python = process.env.LOCAL_TRANSCRIPTION_PYTHON || (process.platform === 'win32' ? 'py' : 'python'),
  timeoutMs = 30 * 60 * 1000,
  maxDurationSeconds = 2 * 60 * 60,
  maxAudioBytes = 96 * 1024 * 1024,
  model = process.env.LOCAL_TRANSCRIPTION_MODEL || 'auto',
  device = process.env.LOCAL_TRANSCRIPTION_DEVICE || 'cpu',
  language = process.env.LOCAL_TRANSCRIPTION_LANGUAGE || 'zh',
  preferSubtitles = true,
  spawnImpl = spawn,
  killImpl = terminateTree,
} = {}) {
  if (!enabled) return undefined;
  if (typeof python !== 'string' || !python.trim() || python.includes('\0') || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30 * 60 * 1000 || !Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 1 || maxDurationSeconds > 7200 || !Number.isInteger(maxAudioBytes) || maxAudioBytes < 1024 || maxAudioBytes > 160 * 1024 * 1024) throw new Error('本地转写配置无效。');
  if (typeof model !== 'string' || !model.trim() || model.length > 500 || /[\u0000-\u001f\u007f]/.test(model) || !['cpu', 'cuda'].includes(device) || !['auto', 'zh', 'en'].includes(language) || typeof preferSubtitles !== 'boolean') throw new Error('语音模型、设备或语言配置无效。');
  const fetcher = async (lesson, { signal } = {}) => {
    const source = normalizeLocalVideoRequest(lesson);
    if (signal?.aborted) throw signal.reason;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-local-video-'));
    try {
      const result = await execute(python, { ...source, max_duration_seconds: maxDurationSeconds, max_audio_bytes: maxAudioBytes, work_dir: directory, model, device, language, prefer_subtitles: preferSubtitles }, { signal, timeoutMs, spawnImpl, killImpl });
      const body = validateResult(result, maxDurationSeconds);
      const title = typeof result.provenance.source_title === 'string' && result.provenance.source_title.trim()
        ? result.provenance.source_title.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : source.title || source.bvid;
      return {
        text: JSON.stringify({ body }), format: 'json',
        sourceName: `${result.provenance.source_kind === 'platform-subtitles' ? '平台字幕' : '本地自动语音转写'} · ${title}（术语与公式需核对，未识别板书）`.slice(0, 180),
        warnings: Array.isArray(result.warnings) ? result.warnings.filter(item => typeof item === 'string').slice(0, 10) : [],
        provenance: result.provenance,
      };
    } finally {
      const target = path.resolve(directory), root = path.resolve(os.tmpdir());
      if (path.dirname(target) !== root || !path.basename(target).startsWith('shifen-local-video-')) throw new Error('本地转写临时目录校验失败。');
      await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  };
  fetcher.kind = 'local';
  return fetcher;
}

const DEPENDENCY_LABELS = {
  yt_dlp: 'yt-dlp',
  faster_whisper: 'faster-whisper',
  av: 'PyAV',
  imageio_ffmpeg: 'imageio-ffmpeg',
  huggingface_hub: 'huggingface-hub',
};

export async function checkLocalTranscriptionSupport({
  enabled = process.env.LOCAL_TRANSCRIPTION === '1',
  python = process.env.LOCAL_TRANSCRIPTION_PYTHON || (process.platform === 'win32' ? 'py' : 'python'),
  timeoutMs = 15000,
  spawnImpl = spawn,
  killImpl = terminateTree,
} = {}) {
  try {
    const result = await execute(python, {}, { timeoutMs, spawnImpl, killImpl, scriptArgs: ['--check'] });
    if (!result?.dependencies || typeof result.dependencies !== 'object' || Array.isArray(result.dependencies)) throw new Error('Invalid environment check');
    const missingDependencies = Object.entries(DEPENDENCY_LABELS)
      .filter(([name]) => result.dependencies[name] !== true)
      .map(([, label]) => label);
    const modelCached = result.model_cached === true;
    const ready = enabled && missingDependencies.length === 0 && modelCached;
    const message = missingDependencies.length
      ? `本机缺少 ${missingDependencies.join('、')}，需要管理员自行安装。`
      : !modelCached
        ? '本机缺少已缓存的语音模型，需要管理员自行准备；应用不会自动下载模型。'
        : !enabled
          ? '本机依赖与模型已就绪，但本机转写尚未启用，需要管理员修改服务配置并重启。'
          : '本机转写环境已就绪，可以重新获取这节课程。';
    return { enabled, ready, missingDependencies, modelCached, message };
  } catch {
    return {
      enabled,
      ready: false,
      missingDependencies: [],
      modelCached: false,
      message: '未能完成本机环境检测，需要管理员检查 Python、转写依赖和语音模型缓存。',
    };
  }
}
