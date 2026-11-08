import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { checkLocalTranscriptionSupport, createLocalVideoFetcher, normalizeLocalVideoRequest } from '../server/local-video-source.mjs';

const lesson = { url: 'https://www.bilibili.com/video/BV1Eb411u7Fw/?p=999&tracking=discard', part: 20, title: '单侧导数', scope: '导数、极限' };
const result = () => ({ ok: true, body: [{ from: 0, to: 2, content: '单侧导数的定义。' }], warnings: ['自动转写需核对。'], provenance: { audio_duration_seconds: 3, processed_entire_selected_audio: true, has_visual_evidence: false, source_title: '真实课程 · 单侧导数' } });

function fakeRunner(handler) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 987654321, exitCode: null, kill: () => true });
    const call = { binary, args, options, child, input: null };
    calls.push(call);
    const chunks = [];
    child.stdin.on('data', chunk => chunks.push(chunk));
    child.stdin.once('end', () => {
      call.input = JSON.parse(Buffer.concat(chunks).toString());
      const close = (code = 0, value = result()) => {
        if (value !== null) child.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
        child.exitCode = code;
        child.emit('close', code);
      };
      handler({ child, call, close });
    });
    return child;
  };
  return { calls, spawnImpl };
}

test('local transcription is explicit opt-in and validates canonical single-part requests', () => {
  assert.equal(createLocalVideoFetcher({ enabled: false }), undefined);
  const normalized = normalizeLocalVideoRequest({ ...lesson, title: '--help\n导数' });
  assert.deepEqual(normalized, { bvid: 'BV1Eb411u7Fw', part: 20, title: '--help 导数', scope: '导数、极限' });
  for (const url of ['http://www.bilibili.com/video/BV1Eb411u7Fw/', 'https://bilibili.com.evil.test/video/BV1Eb411u7Fw/', 'https://127.0.0.1/video/BV1Eb411u7Fw/', 'https://name:secret@www.bilibili.com/video/BV1Eb411u7Fw/', 'https://www.bilibili.com:8443/video/BV1Eb411u7Fw/', 'https://www.bilibili.com/video/not-a-bvid/']) assert.throws(() => normalizeLocalVideoRequest({ ...lesson, url }));
  for (const part of [0, -1, 1.5, '2', 1001]) assert.throws(() => normalizeLocalVideoRequest({ ...lesson, part }));
  assert.throws(() => createLocalVideoFetcher({ enabled: true, maxDurationSeconds: 7201 }));
  assert.throws(() => createLocalVideoFetcher({ enabled: true, timeoutMs: 0 }));
  assert.throws(() => createLocalVideoFetcher({ enabled: true, model: 'bad\nmodel' }));
  assert.throws(() => createLocalVideoFetcher({ enabled: true, device: 'auto' }));
  assert.throws(() => createLocalVideoFetcher({ enabled: true, language: 'bad' }));
});

test('local adapter preserves original timed text, bounds context and cleans its private temporary directory', async () => {
  const runner = fakeRunner(({ close }) => close());
  const fetcher = createLocalVideoFetcher({ enabled: true, spawnImpl: runner.spawnImpl });
  assert.equal(fetcher.kind, 'local');
  const next = await fetcher({ ...lesson, title: '--not-a-cli-flag\n' + '导'.repeat(500), scope: '极'.repeat(5000) });
  assert.deepEqual(JSON.parse(next.text).body, result().body);
  assert.equal(next.format, 'json');
  assert.match(next.sourceName, /真实课程/);
  assert.match(next.sourceName, /自动语音转写/);
  assert.deepEqual(next.warnings, ['自动转写需核对。']);
  const call = runner.calls[0];
  assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  assert.equal(call.args.length, 1); assert.ok(call.args[0].endsWith('transcribe-course.py'));
  assert.equal(call.input.part, 20); assert.equal(call.input.bvid, 'BV1Eb411u7Fw');
  assert.equal(call.input.title.length, 300); assert.equal(call.input.scope.length, 4000);
  assert.equal(call.input.model, 'auto'); assert.equal(call.input.device, 'cpu'); assert.equal(call.input.language, 'zh');
  assert.equal(call.input.prefer_subtitles, true);
  assert.equal(call.options.env.HF_HUB_OFFLINE, '1');
  assert.equal(call.options.env.AI_API_KEY, undefined); assert.equal(call.options.env.BILINOTE_API_TOKEN, undefined);
  assert.equal(call.options.env.VISION_API_KEY, undefined);
  await assert.rejects(fs.stat(call.input.work_dir), { code: 'ENOENT' });
});

test('default two-hour budget imports a complete 65-minute selected part and cleans media', async () => {
  const value = result();
  value.provenance.audio_duration_seconds = 3941;
  value.body = [{ from: 0, to: 3941, content: '虚构 65 分钟完整讲次的测试原文。' }];
  const runner = fakeRunner(({ close }) => close(0, value));
  const next = await createLocalVideoFetcher({ enabled: true, spawnImpl: runner.spawnImpl })({ ...lesson, part: 3 });
  assert.equal(runner.calls[0].input.max_duration_seconds, 7200);
  assert.equal(runner.calls[0].input.part, 3);
  assert.equal(next.provenance.audio_duration_seconds, 3941);
  assert.deepEqual(JSON.parse(next.text).body, value.body);
  await assert.rejects(fs.stat(runner.calls[0].input.work_dir), { code: 'ENOENT' });
});

test('duration failures distinguish unavailable metadata from a configured limit without leaking worker details', async () => {
  const cases = [
    { code: 'DURATION_UNAVAILABLE', options: {}, expected: /无法确认.*有效时长/, absent: /超过|120 分钟/ },
    { code: 'DURATION_LIMIT', options: {}, expected: /当前单讲上限 120 分钟/, absent: /未返回有效|无法确认/ },
    { code: 'DURATION_LIMIT', options: { maxDurationSeconds: 3600 }, expected: /当前单讲上限 60 分钟/, absent: /120 分钟/ },
    { code: 'DURATION_LIMIT', options: { maxDurationSeconds: 3599 }, expected: /当前单讲上限 3599 秒/, absent: /120 分钟/ },
  ];
  for (const item of cases) {
    const runner = fakeRunner(({ child, close }) => {
      child.stderr.write('secret-local-path https://private.invalid/media?token=private');
      close(1, { ok: false, code: item.code, message: 'secret-local-path', duration: 'untrusted-worker-detail' });
    });
    const fetcher = createLocalVideoFetcher({ enabled: true, spawnImpl: runner.spawnImpl, ...item.options });
    await assert.rejects(fetcher({ ...lesson, part: 3 }), error => {
      assert.equal(error.status, 502);
      assert.match(error.message, item.expected);
      assert.doesNotMatch(error.message, item.absent);
      assert.doesNotMatch(error.message, /secret-local-path|private\.invalid|untrusted-worker-detail|token=private/);
      return true;
    });
    assert.equal(runner.calls.length, 1);
    assert.equal(runner.calls[0].input.part, 3);
    await assert.rejects(fs.stat(runner.calls[0].input.work_dir), { code: 'ENOENT' });
  }
});

test('actual platform subtitles bypass ASR claims and explicit cached model options stay data', async () => {
  const runner = fakeRunner(({ close }) => close(0, {
    ...result(), provenance: { audio_duration_seconds: 3, processed_entire_selected_audio: false, processed_entire_source: true, source_kind: 'platform-subtitles' },
  }));
  const fetcher = createLocalVideoFetcher({ enabled: true, spawnImpl: runner.spawnImpl, model: 'small', device: 'cpu', language: 'auto' });
  const next = await fetcher(lesson);
  assert.match(next.sourceName, /^平台字幕/);
  assert.doesNotMatch(next.sourceName, /语音转写/);
  assert.deepEqual(JSON.parse(next.text).body, result().body);
  assert.equal(runner.calls[0].input.model, 'small');
  assert.equal(runner.calls[0].input.language, 'auto');
  const incomplete = fakeRunner(({ close }) => close(0, { ...result(), provenance: { audio_duration_seconds: 3, source_kind: 'platform-subtitles', processed_entire_source: false } }));
  await assert.rejects(createLocalVideoFetcher({ enabled: true, spawnImpl: incomplete.spawnImpl })(lesson), /没有完整处理/);
});

test('failed, incomplete and oversized transcript results do not enter the source store or leak diagnostics', async () => {
  const cases = [
    { code: 1, value: { ok: false, code: 'MODEL_CACHE_MISSING', message: 'secret-local-path' }, pattern: /模型缓存/ },
    { code: 1, value: { ok: false, code: 'ACCESS_UNAVAILABLE' }, pattern: /无法匿名/ },
    { code: 0, value: 'not-json', pattern: /有效结果/ },
    { code: 0, value: { ...result(), provenance: { audio_duration_seconds: 3, processed_entire_selected_audio: false } }, pattern: /没有完整处理/ },
    { code: 0, value: { ...result(), body: [{ from: 1, to: 0, content: 'wrong time' }] }, pattern: /时间轴无效/ },
    { code: 0, value: { ...result(), body: [{ from: 0, to: 2, content: '字'.repeat(6001) }] }, pattern: /文字或时间轴无效/ },
  ];
  for (const item of cases) {
    const runner = fakeRunner(({ child, close }) => { child.stderr.write('secret-local-path'); close(item.code, item.value); });
    const fetcher = createLocalVideoFetcher({ enabled: true, spawnImpl: runner.spawnImpl });
    await assert.rejects(fetcher(lesson), error => { assert.match(error.message, item.pattern); assert.doesNotMatch(error.message, /secret-local-path/); return true; });
    await assert.rejects(fs.stat(runner.calls[0].input.work_dir), { code: 'ENOENT' });
  }
});

test('cancellation and timeout terminate the transcription subprocess and clean temporary media', async () => {
  for (const shouldAbort of [true, false]) {
    const controller = new AbortController();
    let killed = false;
    const runner = fakeRunner(() => { if (shouldAbort) setTimeout(() => controller.abort(new Error('test cancellation')), 5); });
    const fetcher = createLocalVideoFetcher({ enabled: true, spawnImpl: runner.spawnImpl, timeoutMs: shouldAbort ? 500 : 15, killImpl: async child => { killed = true; child.exitCode = 1; child.emit('close', 1); } });
    await assert.rejects(fetcher(lesson, { signal: controller.signal }), shouldAbort ? /test cancellation/ : /超时/);
    assert.equal(killed, true);
    await assert.rejects(fs.stat(runner.calls[0].input.work_dir), { code: 'ENOENT' });
  }
});

test('pre-aborted tasks never start Python and over-limit subprocess output is stopped', async () => {
  const controller = new AbortController(); controller.abort(new Error('already cancelled'));
  const unused = fakeRunner(({ close }) => close());
  await assert.rejects(createLocalVideoFetcher({ enabled: true, spawnImpl: unused.spawnImpl })(lesson, { signal: controller.signal }), /already cancelled/);
  assert.equal(unused.calls.length, 0);
  let killed = false;
  const runner = fakeRunner(({ child }) => child.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1)));
  await assert.rejects(createLocalVideoFetcher({ enabled: true, spawnImpl: runner.spawnImpl, killImpl: async child => { killed = true; child.exitCode = 1; child.emit('close', 1); } })(lesson), /返回内容过大/);
  assert.equal(killed, true);
  await assert.rejects(fs.stat(runner.calls[0].input.work_dir), { code: 'ENOENT' });
});

const supportResult = (overrides = {}) => ({
  ok: true,
  dependencies: { yt_dlp: true, faster_whisper: true, av: true, imageio_ffmpeg: true, huggingface_hub: true },
  model_cached: true,
  ...overrides,
});

test('local environment check uses the bounded offline self-check and reports readiness', async () => {
  const runner = fakeRunner(({ close }) => close(0, supportResult()));
  const checked = await checkLocalTranscriptionSupport({ enabled: true, spawnImpl: runner.spawnImpl });
  assert.equal(checked.ready, true);
  assert.deepEqual(checked.missingDependencies, []);
  assert.equal(checked.modelCached, true);
  assert.match(checked.message, /环境已就绪/);
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0].args.length, 2);
  assert.equal(runner.calls[0].args[1], '--check');
  assert.equal(runner.calls[0].options.shell, false);
  assert.equal(runner.calls[0].options.env.HF_HUB_OFFLINE, '1');
});

test('local environment check identifies exact missing prerequisites without claiming self-installation', async () => {
  const missingRunner = fakeRunner(({ close }) => close(0, supportResult({ dependencies: { ...supportResult().dependencies, yt_dlp: false, av: false } })));
  const missing = await checkLocalTranscriptionSupport({ enabled: true, spawnImpl: missingRunner.spawnImpl });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missingDependencies, ['yt-dlp', 'PyAV']);
  assert.match(missing.message, /本机缺少 yt-dlp、PyAV，需要管理员自行安装/);

  const modelRunner = fakeRunner(({ close }) => close(0, supportResult({ model_cached: false })));
  const model = await checkLocalTranscriptionSupport({ enabled: true, spawnImpl: modelRunner.spawnImpl });
  assert.equal(model.ready, false);
  assert.equal(model.modelCached, false);
  assert.match(model.message, /缺少已缓存的语音模型.*不会自动下载模型/);

  const disabledRunner = fakeRunner(({ close }) => close(0, supportResult()));
  const disabled = await checkLocalTranscriptionSupport({ enabled: false, spawnImpl: disabledRunner.spawnImpl });
  assert.equal(disabled.ready, false);
  assert.match(disabled.message, /尚未启用.*修改服务配置并重启/);
});

test('local environment check failures return an actionable diagnostic instead of worker details', async () => {
  const runner = fakeRunner(({ child, close }) => { child.stderr.write('secret-local-path'); close(0, 'not-json'); });
  const checked = await checkLocalTranscriptionSupport({ enabled: false, spawnImpl: runner.spawnImpl });
  assert.equal(checked.enabled, false);
  assert.equal(checked.ready, false);
  assert.deepEqual(checked.missingDependencies, []);
  assert.match(checked.message, /需要管理员检查 Python、转写依赖和语音模型缓存/);
  assert.doesNotMatch(checked.message, /secret-local-path/);
});
