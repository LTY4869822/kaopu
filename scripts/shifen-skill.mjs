const DEFAULT_BASE = 'http://127.0.0.1:3001';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'ready']);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function endpoint() {
  const base = new URL(process.env.SHIFEN_API_URL || DEFAULT_BASE);
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(base.hostname)) throw new Error('本地 skill 仅允许连接本机考谱后端。');
  return base.origin;
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${endpoint()}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(process.env.SHIFEN_COOKIE ? { Cookie: process.env.SHIFEN_COOKIE } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`后端返回了非 JSON 响应（HTTP ${response.status}）。`); }
  if (!response.ok) throw new Error(data.error || `后端请求失败（HTTP ${response.status}）。`);
  return data;
}

function payload(args) {
  if (!args.length) return {};
  try { return JSON.parse(args[0]); } catch { throw new Error('参数必须是单个完整 JSON 字符串。'); }
}

async function waitLesson(id) {
  for (let attempt = 0; attempt < 1800; attempt++) {
    const lesson = await request(`/api/lessons/${encodeURIComponent(id)}`);
    if (TERMINAL.has(lesson.status)) return lesson;
    await pause(2000);
  }
  throw new Error('等待讲次处理完成超时。');
}

async function waitOutput(id) {
  for (let attempt = 0; attempt < 1800; attempt++) {
    const job = await request(`/api/course-studio/jobs/${encodeURIComponent(id)}`);
    if (TERMINAL.has(job.status)) return job;
    await pause(2000);
  }
  throw new Error('等待 Output 生成超时。');
}

async function raw(command, input) {
  if (command === 'catalog') return request(`/api/lessons/bilibili?url=${encodeURIComponent(input.url || '')}`);
  if (command !== 'import') throw new Error('Raw 用法：run.mjs catalog|import \'{"courseId":"...","url":"..."}\'');
  const result = await request('/api/lessons/import', { method: 'POST', body: input });
  const lessons = [];
  for (const item of result.created) lessons.push(await waitLesson(item.id));
  const outputJobId = lessons.find(item => item.outputJobId)?.outputJobId;
  const output = outputJobId ? await waitOutput(outputJobId) : undefined;
  return { ...result, lessons, ...(output ? { output } : {}) };
}

async function wiki(command, input) {
  if (command === 'sync') return request('/api/knowledge/tree?refresh=1');
  if (command === 'lint') return request('/api/knowledge/lint', { method: 'POST', body: { repair: input.repair === true } });
  if (command !== 'analyze' || !input.lessonId) throw new Error('Wiki 用法：run.mjs analyze|sync|lint \'{"lessonId":"...","mode":"ai"}\'');
  await request(`/api/lessons/${encodeURIComponent(input.lessonId)}/analyze`, { method: 'POST', body: {
    mode: input.mode || 'ai', autoPublish: input.autoPublish === true,
    ...(input.autoOutput ? { autoOutput: input.autoOutput } : {}),
  } });
  const lesson = await waitLesson(input.lessonId);
  return { lesson, ...(lesson.outputJobId ? { output: await waitOutput(lesson.outputJobId) } : {}) };
}

async function output(command, input) {
  if (command !== 'generate') throw new Error('Output 用法：run.mjs generate \'{"courseId":"...","documentIds":["..."],"action":"review","prompt":"..."}\'');
  const job = await request('/api/course-studio/jobs', { method: 'POST', body: {
    courseId: input.courseId, documentIds: input.documentIds, action: input.action || 'review', prompt: input.prompt || '复用 Wiki 生成系统复习资料，保留真实来源。',
  } });
  return waitOutput(job.id);
}

export async function runSkill(layer, args) {
  try {
    const [command, ...rest] = args;
    const input = payload(rest);
    const handlers = { raw, wiki, output };
    if (!handlers[layer]) throw new Error('未知本地 skill。');
    const result = await handlers[layer](command, input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    const failed = layer === 'raw' && result.lessons?.some(item => ['failed', 'cancelled'].includes(item.status) || item.outputError)
      || ['failed', 'cancelled'].includes(result.status) || ['failed', 'cancelled'].includes(result.output?.status);
    if (failed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
