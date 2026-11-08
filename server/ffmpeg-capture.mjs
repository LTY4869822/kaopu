import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const API_HOSTS = ['api.bilibili.com'];
const MEDIA_HOSTS = ['bilivideo.com', 'bilivideo.cn', 'hdslb.com', 'akamaized.net'];
const BUNDLED_GZIP_SHA256 = '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77';
const BUNDLED_EXE_SHA256 = '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00';
const BUNDLED_EXE_SIZE = 82797568;
const fail = code => Object.assign(new Error(code), { captureCode: code });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function allowedUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

/** Unpack the pinned, compressed Windows binary into private runtime storage. */
export async function resolveFfmpeg({ dataDir, ffmpegPath = process.env.LESSON_FFMPEG || '', platform = process.platform, arch = process.arch } = {}) {
  if (ffmpegPath) return ffmpegPath;
  if (platform !== 'win32' || arch !== 'x64') return 'ffmpeg';
  const archive = fileURLToPath(new URL('../vendor/ffmpeg/win32-x64/ffmpeg.exe.gz', import.meta.url));
  if (!fs.existsSync(archive)) return 'ffmpeg';
  if (sha256(await fsp.readFile(archive)) !== BUNDLED_GZIP_SHA256) throw fail('DEPENDENCIES_MISSING');
  if (!dataDir) throw fail('INVALID_REQUEST');
  const runtime = path.resolve(dataDir, 'runtime');
  const target = path.join(runtime, 'ffmpeg-6.1.1-win32-x64.exe');
  await fsp.mkdir(runtime, { recursive: true });
  const valid = async filename => {
    try {
      const stat = await fsp.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== BUNDLED_EXE_SIZE) return false;
      return sha256(await fsp.readFile(filename)) === BUNDLED_EXE_SHA256;
    } catch { return false; }
  };
  if (await valid(target)) return target;
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await pipeline(fs.createReadStream(archive), createGunzip(), fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (!await valid(temporary)) throw fail('DEPENDENCIES_MISSING');
    await fsp.rename(temporary, target);
  } finally { await fsp.rm(temporary, { force: true }).catch(() => {}); }
  if (!await valid(target)) throw fail('DEPENDENCIES_MISSING');
  return target;
}

async function readJson(url, { fetchImpl, signal, cookie = '', timeoutMs = 12000 }) {
  if (!allowedUrl(url, API_HOSTS)) throw fail('INVALID_REQUEST');
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.bilibili.com/', ...(cookie ? { Cookie: cookie } : {}) },
    });
  } catch (error) { if (signal?.aborted) throw error; throw fail('ACCESS_UNAVAILABLE'); }
  if (!response.ok || !allowedUrl(response.url || url, API_HOSTS)) throw fail('ACCESS_UNAVAILABLE');
  if (Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024) throw fail('ACCESS_UNAVAILABLE');
  let payload;
  try { payload = await response.json(); } catch { throw fail('ACCESS_UNAVAILABLE'); }
  return payload;
}

async function download(url, target, { fetchImpl, signal, timeoutMs, maxVideoBytes, referer }) {
  if (!allowedUrl(url, MEDIA_HOSTS)) throw fail('ACCESS_UNAVAILABLE');
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: '*/*', Referer: referer },
    });
  } catch (error) { if (signal?.aborted) throw error; throw fail('ACCESS_UNAVAILABLE'); }
  if (!response.ok || !allowedUrl(response.url || url, MEDIA_HOSTS)) throw fail('ACCESS_UNAVAILABLE');
  if (Number(response.headers.get('content-length') || 0) > maxVideoBytes) { await response.body?.cancel(); throw fail('VIDEO_LIMIT'); }
  const reader = response.body?.getReader();
  if (!reader) throw fail('NO_VIDEO');
  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle;
  let bytes = 0;
  try {
    handle = await fsp.open(temporary, 'wx', 0o600);
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > maxVideoBytes) { await reader.cancel(); throw fail('VIDEO_LIMIT'); }
      await handle.write(part.value);
      signal?.throwIfAborted();
    }
    if (!bytes) throw fail('NO_VIDEO');
    await handle.close(); handle = undefined;
    await fsp.rename(temporary, target);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (error.captureCode) throw error;
    throw fail('ACCESS_UNAVAILABLE');
  } finally {
    reader.releaseLock();
    if (handle) await handle.close().catch(() => {});
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
  return target;
}

/** Download one anonymous/account-visible BV part without yt-dlp. */
export async function downloadBilibiliVideo({ bvid, part, outputDir, maxDurationSeconds, maxVideoBytes, fetchImpl = fetch, getCookie, signal, timeoutMs = 30 * 60 * 1000 }) {
  const cookie = typeof getCookie === 'function' ? getCookie() || '' : '';
  const options = { fetchImpl, signal, cookie };
  const view = await readJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, options);
  if (view?.code !== 0 || !view?.data) throw fail(view?.code === -404 || view?.code === 62002 ? 'PART_UNAVAILABLE' : 'ACCESS_UNAVAILABLE');
  const pages = Array.isArray(view.data.pages) ? view.data.pages : [];
  const page = pages.find(item => item?.page === part);
  if (!page || !Number.isInteger(page.cid)) throw fail('PART_UNAVAILABLE');
  const pageDuration = Number(page.duration);
  if (!Number.isFinite(pageDuration) || pageDuration <= 0) throw fail('DURATION_UNAVAILABLE');
  if (pageDuration > Math.min(7200, maxDurationSeconds)) throw fail('DURATION_LIMIT');
  const play = await readJson(`https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${page.cid}&qn=80&fnval=16&fourk=0`, options);
  if (play?.code !== 0 || !play?.data) throw fail('ACCESS_UNAVAILABLE');
  const duration = Number(play.data.timelength) / 1000 || pageDuration;
  if (!Number.isFinite(duration) || duration <= 0) throw fail('DURATION_UNAVAILABLE');
  if (duration > Math.min(7200, maxDurationSeconds)) throw fail('DURATION_LIMIT');
  const videos = Array.isArray(play.data.dash?.video) ? play.data.dash.video : [];
  const candidates = videos.filter(item => Number.isFinite(item?.height) && item.height > 0 && item.height <= 1080
    && (!Number.isFinite(item.width) || item.width <= 1920) && typeof (item.baseUrl || item.base_url) === 'string')
    .sort((a, b) => b.height - a.height || (String(a.codecs).startsWith('avc') ? -1 : 0) - (String(b.codecs).startsWith('avc') ? -1 : 0) || (a.bandwidth || 0) - (b.bandwidth || 0));
  const selected = candidates[0];
  const durl = Array.isArray(play.data.durl) ? play.data.durl[0] : null;
  const url = selected ? selected.baseUrl || selected.base_url : durl?.url;
  const expectedSize = Number(selected?.size || durl?.size || 0);
  if (!url || expectedSize > maxVideoBytes) throw fail(expectedSize > maxVideoBytes ? 'VIDEO_LIMIT' : 'ACCESS_UNAVAILABLE');
  const filename = path.join(outputDir, selected ? 'capture-source.m4s' : 'capture-source.mp4');
  await download(url, filename, { fetchImpl, signal, timeoutMs, maxVideoBytes, referer: `https://www.bilibili.com/video/${bvid}/?p=${part}` });
  return { path: filename, durationSeconds: duration };
}

async function terminateTree(child) {
  if (!child.pid || child.exitCode != null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      killer.once('close', resolve); killer.once('error', () => { child.kill('SIGKILL'); resolve(); });
    });
  } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

function execute(binary, args, { signal, timeoutMs, spawnImpl, killImpl, maxLog = 2 * 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(binary, args, { windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { reject(fail('DEPENDENCIES_MISSING')); return; }
    const logs = [];
    let bytes = 0, settled = false, failure, grace;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(value); };
    const stop = error => { if (failure || settled) return; failure = error; Promise.resolve(killImpl(child)).catch(() => child.kill('SIGKILL')); grace = setTimeout(() => finish(error), 3000); grace.unref?.(); };
    const abort = () => stop(signal.reason || fail('CAPTURE_FAILED'));
    const timer = setTimeout(() => stop(fail('CAPTURE_FAILED')), timeoutMs); timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(fail('DEPENDENCIES_MISSING')));
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > maxLog) { stop(fail('CAPTURE_FAILED')); return; } logs.push(Buffer.from(chunk)); });
    child.once('close', code => finish(failure, { code, log: Buffer.concat(logs).toString('utf8') }));
    if (signal?.aborted) abort();
  });
}

async function probeDuration(ffmpegPath, source, options) {
  const result = await execute(ffmpegPath, ['-hide_banner', '-i', source], { ...options, timeoutMs: Math.min(options.timeoutMs, 15000) });
  const match = result.log.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) throw fail('DURATION_UNAVAILABLE');
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(duration) || duration <= 0) throw fail('DURATION_UNAVAILABLE');
  return duration;
}

function grayPixels(image, width, height) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) gray[index] = rgba[index * 4] * 0.299 + rgba[index * 4 + 1] * 0.587 + rgba[index * 4 + 2] * 0.114;
  return gray;
}

async function metrics(filename, previous) {
  const image = await loadImage(filename);
  const gray = grayPixels(image, 160, 90);
  let difference = 0;
  if (previous) for (let index = 0; index < gray.length; index += 1) difference += Math.abs(gray[index] - previous[index]);
  const detail = grayPixels(image, 320, 180);
  let laplacian = 0;
  for (let y = 1; y < 179; y += 1) for (let x = 1; x < 319; x += 1) {
    const index = y * 320 + x;
    laplacian += Math.abs(detail[index - 320] + detail[index + 320] + detail[index - 1] + detail[index + 1] - 4 * detail[index]);
  }
  let edges = 0, total = 0;
  for (let y = 15; y < 149; y += 1) for (let x = 20; x < 299; x += 1) {
    const index = y * 320 + x;
    edges += Math.abs(detail[index] - detail[index + 1]) > 20 ? 1 : 0;
    edges += Math.abs(detail[index] - detail[index + 320]) > 20 ? 1 : 0;
    total += 2;
  }
  const small = grayPixels(image, 9, 8);
  let bits = '';
  for (let y = 0; y < 8; y += 1) for (let x = 1; x < 9; x += 1) bits += small[y * 9 + x] > small[y * 9 + x - 1] ? '1' : '0';
  return {
    width: image.width, height: image.height, gray,
    changeScore: previous ? difference / gray.length / 255 : 1,
    sharpnessScore: Math.min(1, laplacian / (178 * 318) / 24),
    contentScore: total ? edges / total : 0,
    visualHash: BigInt(`0b${bits}`).toString(16).padStart(16, '0'),
  };
}

export function chooseFrames(candidates, limit) {
  if (candidates.length <= limit) return candidates.map((_, index) => index);
  const anchors = Math.max(2, Math.ceil(limit * (limit >= 24 ? 0.75 : 0.5)));
  const quality = index => 0.55 * (candidates[index].sharpnessScore ?? 0.5) + 0.45 * (1 - Math.min(1, candidates[index].changeScore * 10));
  const selected = new Set([0, candidates.length - 1]);
  const radius = Math.min(3, Math.max(1, Math.floor(candidates.length / (anchors * 4))));
  for (let index = 1; index < anchors - 1; index += 1) {
    const anchor = Math.round(index * (candidates.length - 1) / (anchors - 1));
    let best = anchor;
    for (let current = Math.max(1, anchor - radius); current < Math.min(candidates.length - 1, anchor + radius + 1); current += 1) {
      if (quality(current) - 0.12 * Math.abs(current - anchor) / radius > quality(best) - 0.12 * Math.abs(best - anchor) / radius) best = current;
    }
    selected.add(best);
  }
  const erasures = [];
  for (let index = 1; index < candidates.length; index += 1) {
    if ((candidates[index - 1].contentScore ?? 0) > 0.08 && candidates[index].contentScore < candidates[index - 1].contentScore * 0.6) erasures.push(index);
  }
  erasures.sort((a, b) => (candidates[b - 1].contentScore - candidates[b].contentScore) - (candidates[a - 1].contentScore - candidates[a].contentScore));
  for (const index of erasures) {
    if (selected.size >= Math.min(limit, anchors + Math.max(1, Math.floor(limit / 8)))) break;
    let best = Math.max(0, index - 3);
    for (let current = best; current < index; current += 1) if (quality(current) + candidates[current].contentScore > quality(best) + candidates[best].contentScore) best = current;
    selected.add(best);
  }
  const duplicate = index => candidates[index].visualHash && [...selected].some(chosen => {
    const other = candidates[chosen].visualHash;
    if (!other) return false;
    let differing = BigInt(`0x${candidates[index].visualHash}`) ^ BigInt(`0x${other}`), count = 0;
    while (differing) { count += Number(differing & 1n); differing >>= 1n; }
    return count <= 3;
  });
  const changes = candidates.map((_, index) => index).sort((a, b) => candidates[b].changeScore - candidates[a].changeScore);
  for (const index of changes) {
    if (selected.size >= limit) break;
    let best = index;
    for (let current = index; current < Math.min(candidates.length, index + 4); current += 1) if (quality(current) > quality(best)) best = current;
    if (!duplicate(best)) selected.add(best);
  }
  const qualityOrder = candidates.map((_, index) => index).sort((a, b) => quality(b) - quality(a));
  for (const index of qualityOrder) { if (selected.size >= limit) break; selected.add(index); }
  return [...selected].sort((a, b) => a - b);
}

/** Extract timestamped candidates in one decode pass, then apply the original selection policy. */
export async function extractFfmpegFrames({ ffmpegPath, source, outputDir, maxDurationSeconds, maxFrames, sampleIntervalSeconds, range, signal, timeoutMs = 30 * 60 * 1000, spawnImpl = spawn, killImpl = terminateTree }) {
  const options = { signal, timeoutMs, spawnImpl, killImpl };
  let duration = await probeDuration(ffmpegPath, source, options);
  if (duration > Math.min(7200, maxDurationSeconds + 1)) throw fail('DURATION_LIMIT');
  const start = range?.start || 0, end = range ? Math.min(range.end, duration) : duration;
  if (end <= start) throw fail('INVALID_REQUEST');
  const interval = Math.max(sampleIntervalSeconds, duration / 1200);
  const filter = `fps=1/${interval}:start_time=0:round=down,scale='min(1920,iw)':-2,showinfo`;
  const args = ['-hide_banner', '-nostdin', '-y'];
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', source, '-t', String(end - start), '-an', '-sn', '-dn', '-vf', filter, '-fps_mode', 'passthrough', '-q:v', '2', path.join(outputDir, 'candidate-%04d.jpg'));
  const result = await execute(ffmpegPath, args, options);
  if (result.code !== 0) throw fail('CAPTURE_FAILED');
  const times = [...result.log.matchAll(/pts_time:\s*([\d.]+)/g)].map(match => Number(match[1]));
  let names = (await fsp.readdir(outputDir)).filter(name => /^candidate-\d{4}\.jpg$/.test(name)).sort();
  if (!names.length || names.length !== times.length) throw fail('CAPTURE_FAILED');
  const lastTime = end - 0.1;
  if (!times.length || start + times[times.length - 1] < lastTime - Math.min(1, interval / 2)) {
    const lastName = `candidate-${String(names.length + 1).padStart(4, '0')}.jpg`;
    const lastArgs = ['-hide_banner', '-nostdin', '-y', '-ss', String(Math.max(start, lastTime)), '-i', source, '-frames:v', '1', '-an', '-vf', "scale='min(1920,iw)':-2", '-q:v', '2', '-update', '1', path.join(outputDir, lastName)];
    const last = await execute(ffmpegPath, lastArgs, { ...options, timeoutMs: Math.min(timeoutMs, 30000) });
    if (last.code === 0 && fs.existsSync(path.join(outputDir, lastName))) { names.push(lastName); times.push(lastTime - start); }
  }
  const candidates = [];
  let previous, candidateBytes = 0;
  for (let index = 0; index < names.length; index += 1) {
    signal?.throwIfAborted();
    const filename = names[index], absolute = path.join(outputDir, filename);
    const stat = await fsp.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail('CAPTURE_FAILED');
    candidateBytes += stat.size;
    if (candidateBytes > 512 * 1024 * 1024) throw fail('VIDEO_LIMIT');
    const scored = await metrics(absolute, previous); previous = scored.gray;
    const time = Math.max(start, Math.min(end, start + times[index]));
    candidates.push({ time: Math.round(time * 1000) / 1000, fileName: filename, width: scored.width, height: scored.height,
      changeScore: Math.round(scored.changeScore * 100000) / 100000, sharpnessScore: Math.round(scored.sharpnessScore * 100000) / 100000,
      contentScore: Math.round(scored.contentScore * 100000) / 100000, visualHash: scored.visualHash });
  }
  const selected = new Set(chooseFrames(candidates, maxFrames));
  const frames = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index], old = path.join(outputDir, candidate.fileName);
    if (!selected.has(index)) { await fsp.unlink(old); continue; }
    const id = `frame-${String(frames.length + 1).padStart(4, '0')}`, fileName = `${id}.jpg`, target = path.join(outputDir, fileName);
    await fsp.rename(old, target);
    const bytes = await fsp.readFile(target);
    frames.push({ id, time: candidate.time, fileName, width: candidate.width, height: candidate.height,
      reason: index === 0 ? 'first' : index === candidates.length - 1 ? 'last' : candidate.changeScore >= 0.035 ? 'change' : 'interval',
      changeScore: candidate.changeScore, sha256: sha256(bytes) });
  }
  if (!frames.length) throw fail('NO_VIDEO');
  return { ok: true, durationSeconds: Math.round(duration * 1000) / 1000, candidateCount: candidates.length, frames };
}

/** Convert user-owned screenshots to the same bounded JPEG evidence format. */
export async function normalizeUploadedImage(source, target) {
  let image;
  try { image = await loadImage(source); } catch { throw fail('NO_VIDEO'); }
  if (!image.width || !image.height || image.width > 12000 || image.height > 12000) throw fail('NO_VIDEO');
  const scale = Math.min(1, 1920 / image.width, 1080 / image.height);
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
  const bytes = canvas.toBuffer('image/jpeg', 92);
  if (bytes.length > 4 * 1024 * 1024) throw fail('VIDEO_LIMIT');
  await fsp.writeFile(target, bytes, { flag: 'wx' });
  return { width, height, sha256: sha256(bytes) };
}
