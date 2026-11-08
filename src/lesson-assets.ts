const MAX_BYTES = 4 * 1024 * 1024;
const CACHE_BYTES = 20 * 1024 * 1024;
const cache = new Map<string, { blob: Blob; at: number }>();
const pending = new Map<string, Promise<Blob>>();
let expiredAt = 0;
let sessionGeneration = 0;

export function clearLessonImageCache() {
  sessionGeneration++;
  cache.clear();
  pending.clear();
}

export function lessonVisualImageUrl(value: string) {
  if (typeof value !== "string" || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "http://lesson.local");
    if (url.origin !== "http://lesson.local" || !/^\/api\/lessons\/[a-zA-Z0-9_-]+\/visual\/[a-zA-Z0-9_-]+\/frame-\d{4}$/.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch { return null; }
}

function retain(url: string, blob: Blob) {
  cache.delete(url); cache.set(url, { blob, at: Date.now() });
  let bytes = [...cache.values()].reduce((sum, item) => sum + item.blob.size, 0);
  for (const [key, item] of cache) {
    if (cache.size <= 32 && bytes <= CACHE_BYTES) break;
    cache.delete(key); bytes -= item.blob.size;
  }
}

/** The image element must not silently swallow an expired owner session. */
export function loadLessonImage(value: string, refresh = false): Promise<Blob> {
  const url = lessonVisualImageUrl(value);
  if (!url) return Promise.reject(new Error("图片地址不可用，请刷新讲次。"));
  if (refresh) cache.delete(url);
  const saved = cache.get(url);
  if (saved && Date.now() - saved.at < 120000) return Promise.resolve(saved.blob);
  if (pending.has(url)) return pending.get(url)!;
  const generation = sessionGeneration;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
      if (response.status === 401) {
        clearLessonImageCache();
        if (Date.now() - expiredAt > 3000) { expiredAt = Date.now(); window.dispatchEvent(new Event("shifen:session-expired")); }
        throw new Error("登录已失效，重新登录后即可查看原图。" );
      }
      if (response.status === 404) throw new Error("这张图片文件不可用，请刷新讲次后重试。" );
      if (!response.ok) throw new Error("图片暂时未加载，请重试。" );
      if (!/^image\/(jpeg|png|webp)(?:;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("接口未返回有效图片，请重新加载。" );
      if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("图片超过显示上限，请查看原课。" );
      const blob = await response.blob();
      if (!blob.size || blob.size > MAX_BYTES) throw new Error("图片内容不可用，请重新加载。" );
      if (generation === sessionGeneration) retain(url, blob);
      return blob;
    } catch (cause) {
      if (controller.signal.aborted) throw new Error("图片加载超时，点击重试即可。" );
      if (cause instanceof TypeError) throw new Error("暂时无法连接图片服务，请检查网络后重试。" );
      throw cause;
    } finally { clearTimeout(timeout); }
  })();
  pending.set(url, request);
  void request.finally(() => { if (pending.get(url) === request) pending.delete(url); }).catch(() => {});
  return request;
}

export function forgetLessonImage(value: string) { cache.delete(value); }

export const lessonFrameTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds || 0)), hours = Math.floor(whole / 3600);
  return `${hours ? `${hours}:` : ""}${String(Math.floor(whole / 60) % 60).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};
