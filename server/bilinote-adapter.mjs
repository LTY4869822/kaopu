import { setTimeout as delay } from 'node:timers/promises';

const fail = (message, status = 502) => Object.assign(new Error(message), { status });
// HTTP adapter written for Shifen; upstream code is not bundled or copied.
// Contract inspected: JefferyHcool/BiliNote backend/app/routers/note.py (v2.4.x).
export function createBiliNoteFetcher({
  baseUrl = process.env.BILINOTE_BASE_URL,
  providerId = process.env.BILINOTE_PROVIDER_ID,
  modelName = process.env.BILINOTE_MODEL,
  token = process.env.BILINOTE_API_TOKEN,
  fetchImpl = fetch,
  pollMs = 2500,
  timeoutMs = 20 * 60 * 1000,
} = {}) {
  if (!baseUrl || !providerId || !modelName) return undefined;
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('BILINOTE_BASE_URL 需要是不含凭据或查询参数的 HTTP 服务地址。');
  const root = base.href.replace(/\/+$/, '').replace(/\/api$/, '');
  async function request(path, init, signal) {
    let response;
    try {
      response = await fetchImpl(`${root}/api${path}`, {
        ...init, redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw fail('无法连接 BiliNote 服务，请检查服务地址和运行状态。');
    }
    if (!response.ok) throw fail(`BiliNote 服务返回 HTTP ${response.status}，请检查服务配置。`);
    const maxBytes = 8 * 1024 * 1024;
    if (Number(response.headers.get('content-length') || 0) > maxBytes) throw fail('BiliNote 返回内容过大，请按分 P 分别处理。');
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > maxBytes) { await reader.cancel(); throw fail('BiliNote 返回内容过大，请按分 P 分别处理。'); }
        chunks.push(Buffer.from(part.value));
      }
    } finally { reader.releaseLock(); }
    let envelope;
    try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail('BiliNote 未返回有效 JSON，请检查服务版本。'); }
    if (envelope.code !== 0) throw fail('BiliNote 未能完成课程处理。请在该服务中检查模型、字幕访问或转写配置；也可以导入字幕继续。');
    return envelope.data;
  }
  return async (lesson, { signal: suppliedSignal } = {}) => {
    const signal = suppliedSignal ? AbortSignal.any([suppliedSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const url = new URL(lesson.url);
    // Never forward tracking parameters, credentials, arbitrary hosts or local paths.
    if (url.protocol !== 'https:' || !['www.bilibili.com', 'bilibili.com'].includes(url.hostname) || !/^\/video\/BV[0-9A-Za-z]{10}\/?$/.test(url.pathname)) throw fail('请使用有效的 B 站 BV 视频链接。', 400);
    const clean = new URL(`https://www.bilibili.com${url.pathname}`);
    clean.searchParams.set('p', String(lesson.part));
    try {
      const task = await request('/generate_note', {
        method: 'POST', body: JSON.stringify({ video_url: clean.href, platform: 'bilibili', quality: 'fast', screenshot: false, link: true, provider_id: providerId, model_name: modelName, format: [], style: 'detailed', video_understanding: false }),
      }, signal);
      const id = task?.task_id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw fail('BiliNote 未返回有效任务编号。');
      while (!signal.aborted) {
        const state = await request(`/task_status/${encodeURIComponent(id)}`, { method: 'GET' }, signal);
        if (state?.status === 'FAILED') throw fail('BiliNote 处理失败，请在该服务中查看失败阶段，或导入字幕。');
        if (state?.status === 'SUCCESS') {
          const segments = state.result?.transcript?.segments;
          // A generated Markdown summary is not a substitute for the original transcript.
          if (!Array.isArray(segments) || !segments.length) throw fail('BiliNote 没有返回逐段原文，不能把摘要当作完整课程来源。');
          if (segments.length > 5000) throw fail('课程超过 5000 段，请分讲次导入。');
          const body = segments.map(item => ({ from: item.start, to: item.end, content: item.text }));
          return { text: JSON.stringify({ body }), format: 'json', sourceName: 'BiliNote 课程转写（未识别板书）' };
        }
        await delay(pollMs, undefined, { signal });
      }
      throw signal.reason;
    } catch (error) {
      if (suppliedSignal?.aborted) throw error;
      if (signal.aborted) throw fail('BiliNote 处理已超时，请按较短分 P 重试，或导入字幕。', 504);
      throw error;
    }
  };
}
