import { resolveBilibiliInput } from './bilibili.mjs';

const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const loginRequired = (message) => Object.assign(fail(message, 401), { code: 'BILIBILI_LOGIN_REQUIRED' });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const API_HOSTS = ['api.bilibili.com'];
const SUBTITLE_HOSTS = ['hdslb.com', 'bilibili.com'];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CUES = 5000;
const MAX_CHARACTERS = 250000;
const MAX_DURATION_SECONDS = 7200;

function allowed(url, hosts) {
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
    && hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

async function readJson(url, { fetchImpl, signal, timeoutMs, hosts, cookie = '' }) {
  let parsed;
  try { parsed = new URL(url); } catch { throw fail('字幕来源地址无效，请导入字幕。'); }
  if (!allowed(parsed, hosts)) throw fail('字幕来源不在 B 站公开域名内，已停止读取。');
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(parsed.href, {
      redirect: 'follow', signal: requestSignal,
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://www.bilibili.com/',
        // The login cookie is only attached after the Bilibili host whitelist check above.
        ...(cookie ? { Cookie: cookie } : {}) },
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    throw fail('暂时无法连接 B 站字幕服务，请稍后重试或导入字幕。');
  }
  if (!response.ok) throw fail(`B 站字幕服务返回 HTTP ${response.status}，请稍后重试或导入字幕。`);
  if (!allowed(new URL(response.url || parsed.href), hosts)) throw fail('字幕来源跳转到了非 B 站域名，已停止读取。');
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw fail('字幕内容过大，请导入较短讲次的字幕。');
  const reader = response.body?.getReader();
  if (!reader) throw fail('字幕服务没有返回可读取的内容，请导入字幕。');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw fail('字幕内容过大，请导入较短讲次的字幕。'); }
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw fail('B 站字幕内容不是有效 JSON，请导入字幕。'); }
}

function subtitleBody(value, duration) {
  const rows = value?.body;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_CUES) throw fail('这个视频的公开字幕无法解析，请导入字幕文件。', 422);
  const body = [];
  let previous = -1;
  let characters = 0;
  for (const row of rows) {
    const start = row?.from;
    const end = row?.to;
    const content = row?.content;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previous || start < 0 || end < start || end > duration + 5
      || typeof content !== 'string' || !content.trim() || content.length > 6000) {
      throw fail('这个视频的公开字幕时间轴无效，请导入字幕文件。', 422);
    }
    characters += content.length;
    if (characters > MAX_CHARACTERS) throw fail('这个视频的字幕超过 25 万字，请按较短讲次处理。', 422);
    body.push({ from: start, to: end, content: content.trim() });
    previous = start;
  }
  return body;
}

function preference(item) {
  const lan = item.lan.toLowerCase();
  return [lan.startsWith('zh') ? 0 : lan.includes('zh') ? 1 : 2, lan.startsWith('ai') ? 1 : 0, lan];
}

/**
 * Reads a Bilibili subtitle track with plain HTTP and no Python.
 * Without a login only public tracks are visible; after the owner scans the Bilibili
 * login QR code, the saved cookie unlocks account-visible AI subtitles. The cookie
 * is never read from the user's browser and only goes to whitelisted Bilibili hosts.
 */
export function createBilibiliSubtitleFetcher({ fetchImpl = fetch, timeoutMs = 12000, getCookie } = {}) {
  if (typeof fetchImpl !== 'function') return undefined;
  const fetcher = async (lesson, { signal } = {}) => {
    const cookie = typeof getCookie === 'function' ? getCookie() || '' : '';
    const { bvid, part } = await resolveBilibiliInput(lesson?.url, { fetchImpl, timeoutMs });
    const selectedPart = Number.isInteger(lesson?.part) ? lesson.part : part;
    if (!Number.isInteger(selectedPart) || selectedPart < 1 || selectedPart > 1000) throw fail('请填写 1–1000 之间的有效分 P 编号。', 400);

    const view = await readJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      { fetchImpl, signal, timeoutMs, hosts: API_HOSTS, cookie });
    if (view?.code === -404 || view?.code === 62002) throw fail('这个视频不存在或不可公开访问，请检查链接。', 404);
    if (view?.code !== 0 || !view?.data) throw fail('暂时没有读取到 B 站视频信息，请稍后重试或导入字幕。');
    const data = view.data;
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const page = pages.find(item => item?.page === selectedPart) || pages[selectedPart - 1];
    const duration = Number(page?.duration);
    const cid = page?.cid;
    if (!page || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS || !Number.isInteger(cid)) {
      throw fail('没有读到这个分集的公开字幕信息，请核对分 P 或导入字幕。', 422);
    }

    const player = await readJson(`https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
      { fetchImpl, signal, timeoutMs, hosts: API_HOSTS, cookie });
    if (player?.code === -101) throw loginRequired('B 站登录态已失效，请重新扫码登录后继续。');
    const info = player?.code === 0 ? player.data : null;
    if (!info) throw fail('暂时没有读取到字幕列表，请稍后重试或导入字幕。');
    if (info.need_login_subtitle) throw loginRequired('这个视频的字幕需要登录 B 站后读取，扫码登录后会自动继续。');

    const available = Array.isArray(info.subtitle?.subtitles) ? info.subtitle.subtitles : [];
    const choices = available
      .filter(item => item && typeof item.subtitle_url === 'string' && item.subtitle_url && typeof item.lan === 'string')
      .sort((a, b) => {
        const left = preference(a), right = preference(b);
        return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
      });
    if (!choices.length) throw Object.assign(fail('这个视频没有公开字幕，请导入字幕文件。', 422), { code: 'NO_PUBLIC_SUBTITLES' });

    let lastError;
    for (const item of choices.slice(0, 4)) {
      try {
        const url = item.subtitle_url.startsWith('//') ? `https:${item.subtitle_url}` : item.subtitle_url;
        const payload = await readJson(url, { fetchImpl, signal, timeoutMs, hosts: SUBTITLE_HOSTS, cookie });
        const body = subtitleBody(payload, duration);
        const title = `${data.title || bvid}${page.part ? ` · ${page.part}` : ''}`.slice(0, 120);
        return {
          text: JSON.stringify({ body }),
          rawPayload: payload,
          rawMetadata: {
            bvid, cid, part: selectedPart, title: data.title || '', partTitle: page.part || '', duration,
            subtitle: { lan: item.lan, lanDoc: item.lan_doc || '', url },
          },
          format: 'json',
          sourceName: `B站公开字幕 · ${title}`.slice(0, 180),
          warnings: ['已优先导入 B 站公开字幕；平台自动字幕也可能误识，公式与未念出的板书仍需核对。'],
          provenance: {
            source_kind: 'platform-subtitles', language: item.lan, model: null,
            source_duration_seconds: duration, audio_duration_seconds: duration,
            source_title: `${data.title || ''}${page.part ? ` · ${page.part}` : ''}`.slice(0, 300),
            part: selectedPart, url: `https://www.bilibili.com/video/${bvid}/?p=${selectedPart}`,
            processed_entire_source: true, processed_entire_selected_audio: false,
            has_visual_evidence: false, browser_cookies_read: false, login_used: !!cookie,
            review_ranges: [],
          },
        };
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        lastError = error;
      }
    }
    throw lastError || fail('这个视频的公开字幕暂时无法解析，请导入字幕文件。', 422);
  };
  fetcher.kind = 'platform-subtitles';
  return fetcher;
}
