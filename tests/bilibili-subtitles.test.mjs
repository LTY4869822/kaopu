import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilibiliSubtitleFetcher } from '../server/bilibili-subtitles.mjs';

const bvid = 'BV1xx411c7mD';
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const lesson = { url: `https://www.bilibili.com/video/${bvid}`, part: 1, title: '极限' };
const view = (overrides = {}) => ({ code: 0, data: {
  title: '高数强化课', pages: [{ page: 1, part: '极限', duration: 125.4, cid: 987 }], ...overrides,
} });
const player = (overrides = {}) => ({ code: 0, data: {
  need_login_subtitle: false,
  subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '//i0.hdslb.com/bfs/subtitle/1.json' }] },
  ...overrides,
} });
const track = { body: [{ from: 0, to: 2.5, content: '极限的定义' }, { from: 2.5, to: 5, content: '连续' }] };

function fixture({ viewBody = view(), playerBody = player(), trackBody = track } = {}) {
  const requests = [], inits = [];
  const fetchImpl = async (url, init) => {
    requests.push(String(url)); inits.push(init || {});
    if (String(url).includes('/x/web-interface/view')) return json(viewBody);
    if (String(url).includes('/x/player/wbi/v2')) return json(playerBody);
    return json(trackBody);
  };
  return { requests, inits, fetchImpl };
}

test('fetcher reads public platform subtitles without cookies or Python', async () => {
  const { requests, fetchImpl } = fixture();
  const fetcher = createBilibiliSubtitleFetcher({ fetchImpl });
  const result = await fetcher(lesson);
  assert.equal(fetcher.kind, 'platform-subtitles');
  assert.equal(result.format, 'json');
  assert.deepEqual(JSON.parse(result.text).body, track.body);
  assert.match(result.sourceName, /B站公开字幕/);
  assert.equal(result.provenance.source_kind, 'platform-subtitles');
  assert.equal(result.provenance.login_used, false);
  assert.equal(result.provenance.browser_cookies_read, false);
  assert.match(requests[0], /x\/web-interface\/view\?bvid=/);
  assert.match(requests[1], /x\/player\/wbi\/v2\?bvid=.*cid=987/);
  assert.match(requests[2], /^https:\/\/i0\.hdslb\.com\//);
});

test('fetcher prefers a non-AI Chinese track', async () => {
  const { requests, fetchImpl } = fixture({ playerBody: player({ subtitle: { subtitles: [
    { lan: 'ai-zh', subtitle_url: '//i0.hdslb.com/bfs/subtitle/ai.json' },
    { lan: 'en-US', subtitle_url: '//i0.hdslb.com/bfs/subtitle/en.json' },
    { lan: 'zh-CN', subtitle_url: '//i0.hdslb.com/bfs/subtitle/zh.json' },
  ] } }) });
  const fetcher = createBilibiliSubtitleFetcher({ fetchImpl });
  const result = await fetcher(lesson);
  assert.equal(result.provenance.language, 'zh-CN');
  assert.match(requests[2], /zh\.json$/);
});

test('fetcher explains login-only subtitles and missing tracks', async () => {
  const loginOnly = createBilibiliSubtitleFetcher({ fetchImpl: fixture({ playerBody: player({ need_login_subtitle: true }) }).fetchImpl });
  await assert.rejects(loginOnly(lesson), { status: 401, code: 'BILIBILI_LOGIN_REQUIRED' });
  const expired = createBilibiliSubtitleFetcher({ fetchImpl: fixture({ playerBody: { code: -101, message: '账号未登录' } }).fetchImpl });
  await assert.rejects(expired(lesson), { status: 401, code: 'BILIBILI_LOGIN_REQUIRED' });
  const noTracks = createBilibiliSubtitleFetcher({ fetchImpl: fixture({ playerBody: player({ subtitle: { subtitles: [] } }) }).fetchImpl });
  await assert.rejects(noTracks(lesson), { status: 422, code: 'NO_PUBLIC_SUBTITLES', message: '这个视频没有公开字幕，请导入字幕文件。' });
});

test('fetcher attaches the saved login cookie to every Bilibili request', async () => {
  const { inits, fetchImpl } = fixture();
  const fetcher = createBilibiliSubtitleFetcher({ fetchImpl, getCookie: () => 'SESSDATA=abc123; bili_jct=def456' });
  const result = await fetcher(lesson);
  assert.equal(result.provenance.login_used, true);
  assert.equal(inits.length, 3);
  for (const init of inits) assert.equal(init.headers.Cookie, 'SESSDATA=abc123; bili_jct=def456');
});

test('fetcher rejects unknown parts, invalid subtitles and network failures', async () => {
  const missingPart = createBilibiliSubtitleFetcher({ fetchImpl: fixture().fetchImpl });
  await assert.rejects(missingPart({ ...lesson, part: 2 }), { status: 422 });

  const invalidTrack = createBilibiliSubtitleFetcher({ fetchImpl: fixture({ trackBody: { body: [{ from: 3, to: 2, content: '倒序' }] } }).fetchImpl });
  await assert.rejects(invalidTrack(lesson), { status: 422 });

  const offline = createBilibiliSubtitleFetcher({ fetchImpl: async () => { throw new Error('network down'); } });
  await assert.rejects(offline(lesson), { status: 502 });
});
