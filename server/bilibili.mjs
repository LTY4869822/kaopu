const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const BVID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const HOSTS = ['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'];
const SHORT_HOSTS = ['b23.tv', 'bili2233.cn'];
const MAX_PAGES = 100;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function readPart(url) {
  const part = Number(url.searchParams.get('p'));
  return Number.isInteger(part) && part >= 1 && part <= 10000 ? part : 1;
}

export function normalizeBilibiliInput(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw fail('请填写有效的 B 站 BV 链接或 BV 号。');
  const input = value.trim();
  if (BVID.test(input)) return { bvid: input, part: 1 };
  let url;
  try { url = new URL(input); } catch { throw fail('请使用完整的 B 站视频链接或 BV 号。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port))) throw fail('仅支持 bilibili.com 的公开 BV 视频链接。');
  if (SHORT_HOSTS.includes(url.hostname)) throw fail('B 站短链接需要先展开，请稍后重试或粘贴完整视频链接。');
  if (!HOSTS.includes(url.hostname)) throw fail('仅支持 bilibili.com 的公开 BV 视频链接。');
  const match = url.pathname.match(/^\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})\/?$/);
  if (match) return { bvid: match[1], part: readPart(url) };
  // 播放列表 / 稍后再看 / 合集分享链接把 BV 号放在 bvid 查询参数里。
  if (url.pathname.startsWith('/list/')) {
    const bvid = url.searchParams.get('bvid') || '';
    if (!BVID.test(bvid)) throw fail('这个合集链接里没有可识别的 BV 号，请打开具体讲次后复制链接。');
    return { bvid, part: readPart(url) };
  }
  if (url.pathname.includes('/channel/collectiondetail') || url.pathname.includes('/channel/seriesdetail')) {
    throw fail('空间合集暂不支持直接导入，请打开具体讲次后复制该视频链接。');
  }
  throw fail('请粘贴包含 BV 号的视频链接。合集请先选择具体讲次。');
}

/**
 * Expands b23.tv / bili2233.cn share links into a canonical BV video.
 * Only follows one redirect and only to an allowed Bilibili host.
 */
export async function resolveBilibiliInput(value, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw fail('请填写有效的 B 站 BV 链接或 BV 号。');
  const input = value.trim();
  let url;
  try { url = new URL(input); } catch { return normalizeBilibiliInput(input); }
  if (!SHORT_HOSTS.includes(url.hostname)) return normalizeBilibiliInput(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw fail('请使用有效的 B 站分享短链接。');
  if (!/^\/[A-Za-z0-9_-]{1,80}$/.test(url.pathname)) throw fail('请检查 B 站分享短链接是否完整。');
  if (typeof fetchImpl !== 'function') throw fail('当前暂时无法展开 B 站短链接，请粘贴完整视频链接。', 503);
  let response;
  try {
    response = await fetchImpl(input, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'text/html', Referer: 'https://www.bilibili.com/' },
    });
  } catch { throw fail('暂时无法展开 B 站短链接，请稍后重试或粘贴完整视频链接。', 502); }
  const location = response.headers.get('location');
  if (!location) throw fail('这个 B 站短链接没有指向视频，请粘贴完整 BV 链接。', 400);
  let target;
  try { target = new URL(location, input); } catch { throw fail('这个 B 站短链接没有指向可识别的视频。', 400); }
  if (!['https:', 'http:'].includes(target.protocol) || !HOSTS.includes(target.hostname) || target.username || target.password) {
    throw fail('这个 B 站短链接没有指向可识别的视频。', 400);
  }
  return normalizeBilibiliInput(target.href);
}

const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

/**
 * Reads the public page (分集) catalog of one Bilibili video.
 * Only anonymous metadata is fetched; the server never uses cookies or login state.
 */
export async function bilibiliCatalog(value, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const { bvid } = await resolveBilibiliInput(value, { fetchImpl, timeoutMs });
  if (typeof fetchImpl !== 'function') throw fail('当前暂时无法读取 B 站目录，请手动选择集数。', 503);
  let response;
  try {
    response = await fetchImpl(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json', Referer: 'https://www.bilibili.com/',
      },
    });
  } catch { throw fail('暂时无法连接 B 站，请稍后重试或手动选择集数。', 502); }
  if (!response.ok) throw fail(`B 站返回 HTTP ${response.status}，请稍后重试。`, 502);
  let payload;
  try { payload = await response.json(); } catch { throw fail('B 站没有返回有效数据，请稍后重试。', 502); }
  if (payload?.code === -404 || payload?.code === 62002) throw fail('这个视频不存在或不可公开访问，请检查链接。', 404);
  if (payload?.code !== 0 || !payload?.data) throw fail('没有读取到这门课的分集目录，请稍后重试或手动导入。', 502);
  const data = payload.data;
  const rawPages = Array.isArray(data.pages) ? data.pages : [];
  if (!rawPages.length) throw fail('这个视频没有可读取的分集，请手动导入字幕。', 502);
  const seen = new Set();
  const pages = [];
  for (const [index, item] of rawPages.entries()) {
    const part = Number.isInteger(item?.page) && item.page >= 1 && item.page <= 10000 ? item.page : index + 1;
    const title = clean(item?.part, 160) || `第 ${part} 集`;
    if (seen.has(part)) continue;
    seen.add(part);
    pages.push({ part, title, duration: Number.isFinite(item?.duration) && item.duration > 0 ? Math.round(item.duration) : 0 });
  }
  if (!pages.length) throw fail('这个视频没有可读取的分集，请手动导入字幕。', 502);
  return {
    bvid,
    title: clean(data.title, 160) || bvid,
    owner: clean(data.owner?.name, 80),
    pages: pages.slice(0, MAX_PAGES),
    truncated: pages.length > MAX_PAGES,
  };
}
