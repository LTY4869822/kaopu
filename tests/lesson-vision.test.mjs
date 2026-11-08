import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createLessonVision, validateVisionLesson, validateVisualObservation, visualCoverage } from '../server/lesson-vision.mjs';
import { createRawStore } from '../server/raw-store.mjs';

const lesson = { id: 'test-lecture', url: 'https://www.bilibili.com/video/BV1Eb411u7Fw/?p=8&tracking=remove', part: 20, title: '单侧导数' };
const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const imageHash = createHash('sha256').update(image).digest('hex');
const provider = { baseUrl: 'https://vision.example.test/v1', apiKey: 'not-a-real-key', model: 'test-vision' };

function runner(handler) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 987654321, exitCode: null, kill: () => true });
    const call = { binary, args, options, child }; calls.push(call);
    const input = [];
    child.stdin.on('data', chunk => input.push(chunk));
    child.stdin.on('end', async () => {
      call.input = JSON.parse(Buffer.concat(input).toString());
      const close = (value, code = 0) => { child.stdout.end(JSON.stringify(value)); child.exitCode = code; child.emit('close', code); };
      await handler(call, close);
    });
    return child;
  };
  return { calls, spawnImpl };
}

async function goodCapture(call, close) {
  const frames = [0, 50, 99.9].map((time, index) => ({ id: `frame-${String(index + 1).padStart(4, '0')}`, time, width: 1280, height: 720, reason: index ? 'change' : 'first', changeScore: .1, sha256: imageHash }));
  for (const frame of frames) {
    frame.fileName = `${frame.id}.jpg`;
    await fs.writeFile(path.join(call.input.output_dir, frame.fileName), image);
  }
  close({ ok: true, durationSeconds: 100, candidateCount: 13, frames });
}

const modelReply = (value = {}) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ visibleText: '可导的充要条件', latex: ["f'_-(x_0)=f'_+(x_0)"], description: '黑板上的定义', uncertainties: ['右侧符号模糊'], inferences: ['这可能是课堂总结'], ...value }) } }] }), { headers: { 'Content-Type': 'application/json' } });

test('range supplement preserves old image IDs, hashes and cached observations; only new frames call vision', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner((call, close) => goodCapture(call, value => close({ ...value, frames: call.input.capture_range ? value.frames.map((frame, i) => ({ ...frame, time: [20, 25, 29.9][i] })) : value.frames })));
  let calls = 0;
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider, spawnImpl: worker.spawnImpl, fetchImpl: async () => { calls++; return modelReply(); } });
  try {
    const original = await manager.read(await manager.capture(lesson));
    const oldManifest = await fs.readFile(path.join(path.dirname(original.frames[0].imagePath), 'manifest.json'), 'utf8');
    const next = await manager.supplement({ ...lesson, visual: original }, { range: { start: 20, end: 30 } });
    assert.equal(next.frames.length, 6); assert.equal(next.observations.length, 3); assert.equal(next.coverage.complete, false);
    assert.deepEqual(next.observations, original.observations);
    assert.deepEqual(worker.calls[1].input.capture_range, { start: 20, end: 30 });
    assert.equal(worker.calls[1].input.max_frames, 12); assert.equal(worker.calls[1].input.sample_interval_seconds, 2);
    for (const old of original.frames) {
      const current = next.frames.find(frame => frame.id === old.id);
      assert.equal(current.sha256, old.sha256); assert.equal(current.time, old.time);
      assert.deepEqual(await fs.readFile(current.imagePath), await fs.readFile(old.imagePath));
    }
    const completed = await manager.read(next);
    assert.equal(completed.observations.length, 6); assert.equal(calls, 6, 'old frames are not billed a second time');
    assert.equal(await fs.readFile(path.join(path.dirname(original.frames[0].imagePath), 'manifest.json'), 'utf8'), oldManifest);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('invalid or failed supplements never destroy the existing evidence', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner((call, close) => goodCapture(call, value => close({ ...value, frames: call.input.capture_range ? value.frames.map((frame, i) => ({ ...frame, time: [20, 25, 29.9][i] })) : value.frames })));
  const manager = createLessonVision({ dataDir, captureBackend: 'python', spawnImpl: worker.spawnImpl });
  try {
    const original = await manager.capture(lesson), source = { ...lesson, visual: original };
    for (const range of [{ start: 0, end: 121 }, { start: -1, end: 10 }, { start: 3, end: 3.1 }, { start: true, end: 10 }]) await assert.rejects(manager.supplement(source, { range }), /补采范围/);
    assert.equal(worker.calls.length, 1);
    await fs.writeFile(original.frames[0].imagePath, 'tampered');
    await assert.rejects(manager.supplement(source, { range: { start: 20, end: 30 } }), /已有原图已变化/);
    assert.deepEqual(await fs.readdir(path.dirname(path.dirname(original.frames[0].imagePath))), [original.id]);
    assert.equal(await fs.readFile(original.frames[0].imagePath, 'utf8'), 'tampered');
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('visual sources are fixed single BV parts and sampling coverage never claims completeness', () => {
  assert.equal(validateVisionLesson(lesson).url, 'https://www.bilibili.com/video/BV1Eb411u7Fw/?p=20');
  for (const url of ['https://bilibili.com.evil.test/video/BV1Eb411u7Fw/', 'http://www.bilibili.com/video/BV1Eb411u7Fw/', 'https://key:secret@www.bilibili.com/video/BV1Eb411u7Fw/']) assert.throws(() => validateVisionLesson({ ...lesson, url }));
  for (const id of ['../private', '', 'a/b']) assert.throws(() => validateVisionLesson({ ...lesson, id }));
  const coverage = visualCoverage(100, [{ time: 0 }, { time: 50 }, { time: 99.9 }], 13, 3);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.recognizedFrameCount, 3);
  assert.equal(coverage.maxGapSeconds, 50);
  assert.deepEqual(coverage.unobservedIntervals[0], { start: 0, end: 50 });
  const observation = validateVisualObservation({ visibleText: '原课文字', latex: [], frameId: 'forged', time: 999, inferences: ['推测'] }, { id: 'frame-0001', time: 10 });
  assert.equal(observation.frameId, 'frame-0001'); assert.equal(observation.time, 10);
  assert.deepEqual(observation.inferences, ['推测']);
});

test('an explicitly uploaded replacement video supersedes the previous Raw archive', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const oldPath = path.join(dataDir, 'old.mp4'), newPath = path.join(dataDir, 'new.mp4');
  await fs.writeFile(oldPath, 'old-video'); await fs.writeFile(newPath, 'new-video');
  const worker = runner(goodCapture);
  const manager = createLessonVision({ dataDir, captureBackend: 'python', spawnImpl: worker.spawnImpl });
  try {
    const rawStore = createRawStore({ dataDir });
    const oldRef = rawStore.putFile({ courseId: 'course-a', sourceId: 'test-lecture', path: oldPath, kind: 'lecture-video' }).rawRef;
    const evidence = await manager.capture({ ...lesson, courseId: 'course-a', mediaRawRef: oldRef }, { videoPath: newPath });
    assert.equal(worker.calls[0].input.video_path, newPath);
    assert.notEqual(evidence.sourceVideoRawRef, oldRef);
    const reused = await manager.capture({ ...lesson, courseId: 'course-a', mediaRawRef: evidence.sourceVideoRawRef });
    const archived = rawStore.read(evidence.sourceVideoRawRef);
    assert.equal(worker.calls[1].input.video_path, archived.path);
    assert.equal(reused.sourceVideoRawRef, evidence.sourceVideoRawRef);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('capture persists hashed images with real timestamps, without sending to a model', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture);
  let requests = 0;
  const manager = createLessonVision({ dataDir, captureBackend: 'python', spawnImpl: worker.spawnImpl, fetchImpl: () => { requests++; } });
  try {
    const evidence = await manager.analyze(lesson);
    assert.equal(evidence.status, 'captured'); assert.equal(evidence.frames.length, 3); assert.equal(requests, 0);
    assert.equal(worker.calls[0].options.shell, false); assert.equal(worker.calls[0].options.windowsHide, true);
    assert.equal(worker.calls[0].options.env.AI_API_KEY, undefined);
    assert.equal(worker.calls[0].input.bvid, 'BV1Eb411u7Fw'); assert.equal(worker.calls[0].input.part, 20);
    assert.equal(evidence.coverage.recognizedFrameCount, 0); assert.equal(evidence.coverage.complete, false);
    assert.equal(manager.assetPath(lesson.id, evidence.id, 'frame-0001'), evidence.frames[0].imagePath);
    assert.throws(() => manager.assetPath(lesson.id, evidence.id, '../private'));
    assert.equal((await fs.stat(evidence.frames[0].imagePath)).size, image.length);
    await assert.rejects(manager.read(evidence), /视觉模型/);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('capture defaults to two hours and preserves a 65-minute selected part without model calls', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner((call, close) => goodCapture(call, value => close({
    ...value, durationSeconds: 3941,
    frames: value.frames.map((frame, index) => ({ ...frame, time: [0, 1970.5, 3940.9][index] })),
  })));
  let modelCalls = 0;
  const manager = createLessonVision({ dataDir, captureBackend: 'python', spawnImpl: worker.spawnImpl, fetchImpl: () => { modelCalls++; throw new Error('must not call a real model'); } });
  try {
    const evidence = await manager.capture({ ...lesson, part: 3 });
    assert.equal(worker.calls[0].input.max_duration_seconds, 7200);
    assert.equal(worker.calls[0].input.part, 3);
    assert.equal(evidence.coverage.durationSeconds, 3941);
    assert.equal(evidence.source.part, 3);
    assert.match(evidence.source.url, /\?p=3$/);
    assert.equal(evidence.coverage.complete, false);
    assert.equal(modelCalls, 0);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('capture duration errors state the configured limit, distinguish missing metadata and clean private output', async () => {
  const cases = [
    { code: 'DURATION_UNAVAILABLE', options: {}, expected: /无法确认.*有效时长/, absent: /超过|120 分钟/ },
    { code: 'DURATION_LIMIT', options: {}, expected: /当前单讲上限 120 分钟/, absent: /无法确认/ },
    { code: 'DURATION_LIMIT', options: { maxDurationSeconds: 3600 }, expected: /当前单讲上限 60 分钟/, absent: /120 分钟/ },
    { code: 'DURATION_LIMIT', options: { maxDurationSeconds: 3599 }, expected: /当前单讲上限 3599 秒/, absent: /120 分钟/ },
  ];
  for (const item of cases) {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
    const worker = runner((call, close) => {
      call.child.stderr.write('secret-local-path https://private.invalid/media?token=private');
      close({ ok: false, code: item.code, message: 'secret-local-path', duration: 'untrusted-worker-detail' }, 1);
    });
    const manager = createLessonVision({ dataDir, captureBackend: 'python', spawnImpl: worker.spawnImpl, ...item.options });
    try {
      await assert.rejects(manager.capture({ ...lesson, part: 3 }), error => {
        assert.equal(error.status, 502);
        assert.match(error.message, item.expected);
        assert.doesNotMatch(error.message, item.absent);
        assert.doesNotMatch(error.message, /secret-local-path|private\.invalid|untrusted-worker-detail|token=private/);
        return true;
      });
      assert.equal(worker.calls.length, 1);
      assert.equal(worker.calls[0].input.part, 3);
      await assert.rejects(fs.stat(worker.calls[0].input.output_dir), { code: 'ENOENT' });
      assert.ok((await fs.stat(dataDir)).isDirectory());
    } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
  }
});

test('vision reads trusted saved frames inline, preserves uncertainty and prevents forged citations', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture), requests = [];
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider: () => provider, spawnImpl: worker.spawnImpl, fetchImpl: async (url, init) => { requests.push({ url: String(url), init, payload: JSON.parse(init.body) }); return modelReply({ frameId: 'forged', time: 999 }); } });
  try {
    const evidence = await manager.capture(lesson);
    const next = await manager.read({ ...evidence, frames: [{ imagePath: '/some/private/file' }] });
    assert.equal(next.id, evidence.id); assert.equal(next.status, 'completed'); assert.equal(next.observations.length, 3);
    assert.equal(next.observations[1].time, 50); assert.equal(next.observations[1].frameId, 'frame-0002');
    assert.deepEqual(next.observations[1].latex, ["f'_-(x_0)=f'_+(x_0)"]);
    assert.deepEqual(next.observations[1].inferences, ['这可能是课堂总结']);
    assert.equal(next.coverage.complete, false);
    for (const request of requests) {
      assert.equal(request.url, 'https://vision.example.test/v1/chat/completions');
      assert.equal(request.init.redirect, 'error');
      const block = request.payload.messages[1].content[1];
      assert.equal(block.type, 'image_url'); assert.equal(block.image_url.url, `data:image/jpeg;base64,${image.toString('base64')}`);
      assert.equal(request.payload.thinking, undefined, 'provider-specific fields do not reach unrelated services');
      assert.match(request.payload.messages[0].content, /不根据口播猜图/);
    }
    const repeated = await manager.read(next);
    assert.equal(repeated.observations.length, 3); assert.equal(requests.length, 3, 'successful frames reuse their evidence/model-bound result');
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('selected-frame recognition leaves the rest explicitly unrecognized and resumes without redownloading', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture); let calls = 0;
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider: { ...provider, baseUrl: 'https://api.deepseek.com' }, spawnImpl: worker.spawnImpl, fetchImpl: async (_url, init) => { calls++; assert.deepEqual(JSON.parse(init.body).thinking, { type: 'disabled' }); return modelReply(); } });
  try {
    const evidence = await manager.capture(lesson);
    const partial = await manager.read(evidence, { frameIds: ['frame-0002'] });
    assert.equal(partial.status, 'partial'); assert.equal(partial.observations.length, 1); assert.equal(calls, 1);
    assert.equal(partial.coverage.recognizedFrameCount, 1); assert.equal(partial.coverage.sampledFrameCount, 3);
    const complete = await manager.read(partial);
    assert.equal(complete.status, 'completed'); assert.equal(complete.observations.length, 3); assert.equal(calls, 3);
    assert.equal(worker.calls.length, 1);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('bad or failed model frames remain explicitly partial and image tampering is not sent upstream', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture); let calls = 0;
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider, spawnImpl: worker.spawnImpl, fetchImpl: async () => { calls++; return calls === 1 ? modelReply() : new Response('secret upstream content', { status: 403 }); } });
  try {
    const evidence = await manager.capture(lesson);
    const next = await manager.read(evidence);
    assert.equal(next.status, 'partial'); assert.equal(next.failures.length, 2); assert.equal(next.observations.length, 1);
    assert.equal(JSON.stringify(next).includes('secret upstream content'), false);
    for (const frame of evidence.frames) await fs.writeFile(frame.imagePath, Buffer.from('tampered'));
    const tampered = await manager.read(evidence);
    assert.equal(tampered.status, 'failed'); assert.equal(calls, 3);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('capture cancellation terminates its own worker and removes only the generated evidence directory', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const controller = new AbortController(); let output, kills = 0;
  const worker = runner(async call => { output = call.input.output_dir; controller.abort(new Error('Stopped')); });
  const manager = createLessonVision({ dataDir, captureBackend: 'python', spawnImpl: worker.spawnImpl, killImpl: async child => { kills++; child.exitCode = 1; child.emit('close', 1); } });
  try {
    await assert.rejects(manager.capture(lesson, { signal: controller.signal }), /Stopped/);
    assert.equal(kills, 1); await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    assert.ok((await fs.stat(dataDir)).isDirectory());
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('vision recognition has bounded parallelism and ordered checkpoint progress after each batch', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture); let active = 0, peak = 0;
  const progress = [];
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider, spawnImpl: worker.spawnImpl, fetchImpl: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 12));
    active--; return modelReply();
  } });
  try {
    for (const concurrency of [0, 5, 1.5]) assert.throws(() => createLessonVision({ dataDir, captureBackend: 'python', concurrency }));
    const evidence = await manager.capture(lesson);
    const next = await manager.read(evidence, { onProgress: async checkpoint => {
      const saved = JSON.parse(await fs.readFile(path.join(path.dirname(checkpoint.frames[0].imagePath), 'manifest.json'), 'utf8'));
      assert.equal(saved.observations.length, checkpoint.observations.length, 'checkpoint is durable before its callback');
      progress.push(checkpoint.coverage.recognizedFrameCount);
    } });
    assert.equal(peak, 2); assert.deepEqual(progress, [2, 3]);
    assert.deepEqual(next.observations.map(item => item.frameId), ['frame-0001', 'frame-0002', 'frame-0003']);
    await assert.rejects(manager.read(evidence, { frameIds: ['frame-9999'] }), /现有的关键帧/);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('cancel after checkpoint retains successful frames and resume only recognizes remaining frames', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture), controller = new AbortController(); let calls = 0;
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider, spawnImpl: worker.spawnImpl, fetchImpl: async () => { calls++; return modelReply(); } });
  try {
    const evidence = await manager.capture(lesson);
    await assert.rejects(manager.read(evidence, { signal: controller.signal, onProgress: async partial => {
      assert.equal(partial.observations.length, 2); controller.abort(new Error('cancelled after checkpoint'));
    } }), /cancelled after checkpoint/);
    const saved = JSON.parse(await fs.readFile(path.join(path.dirname(evidence.frames[0].imagePath), 'manifest.json'), 'utf8'));
    assert.equal(saved.status, 'partial'); assert.equal(saved.coverage.recognizedFrameCount, 2); assert.equal(calls, 2);
    const next = await manager.read(evidence);
    assert.equal(next.status, 'completed'); assert.equal(calls, 3); assert.equal(worker.calls.length, 1);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('cancellation within an in-flight batch still checkpoints already completed frame results', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture), controller = new AbortController(); const times = []; let resumed = false;
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider, spawnImpl: worker.spawnImpl, fetchImpl: async (_url, init) => {
    const time = Number(JSON.parse(init.body).messages[1].content[0].text.match(/观测时刻为([\d.]+)秒/)[1]);
    times.push(time);
    if (!resumed && time === 0) { setTimeout(() => controller.abort(new Error('cancel mid-batch')), 20); return modelReply(); }
    if (!resumed) return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    return modelReply();
  } });
  try {
    const evidence = await manager.capture(lesson);
    await assert.rejects(manager.read(evidence, { signal: controller.signal }), /cancel mid-batch/);
    const saved = JSON.parse(await fs.readFile(path.join(path.dirname(evidence.frames[0].imagePath), 'manifest.json'), 'utf8'));
    assert.deepEqual(saved.observations.map(item => item.frameId), ['frame-0001']);
    resumed = true;
    const next = await manager.read(evidence);
    assert.equal(next.observations.length, 3); assert.equal(times.filter(time => time === 0).length, 1);
    assert.equal(times.length, 4, 'only the aborted and unstarted frames are retried');
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('a read snapshots non-enumerable provider getters so settings changes do not mix model caches', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture), requests = []; let settings = { ...provider };
  const view = Object.defineProperties({}, Object.fromEntries(['baseUrl', 'model', 'apiKey'].map(name => [name, { get: () => settings[name] }])));
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider: view, spawnImpl: worker.spawnImpl, fetchImpl: async (url, init) => {
    requests.push({ url: String(url), auth: init.headers.Authorization, model: JSON.parse(init.body).model });
    settings = { baseUrl: 'https://another.example.test/v1', model: 'different', apiKey: 'different-test-key' };
    return modelReply();
  } });
  try {
    const evidence = await manager.capture(lesson); await manager.read(evidence);
    for (const request of requests) {
      assert.equal(request.url, `${provider.baseUrl}/chat/completions`); assert.equal(request.auth, `Bearer ${provider.apiKey}`); assert.equal(request.model, provider.model);
    }
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('an interrupted first retry batch retains all later cached successes and never charges to reread them', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-vision-test-'));
  const worker = runner(goodCapture), controller = new AbortController(); const times = []; let interrupt = false;
  const manager = createLessonVision({ dataDir, captureBackend: 'python', provider, spawnImpl: worker.spawnImpl, fetchImpl: async (_url, init) => {
    const time = Number(JSON.parse(init.body).messages[1].content[0].text.match(/观测时刻为([\d.]+)秒/)[1]);
    times.push(time);
    if (interrupt) {
      setTimeout(() => controller.abort(new Error('interrupt first retry batch')), 15);
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    }
    return modelReply();
  } });
  try {
    const evidence = await manager.capture(lesson);
    await manager.read(evidence, { frameIds: ['frame-0002', 'frame-0003'] });
    assert.deepEqual(times, [50, 99.9]);
    interrupt = true;
    await assert.rejects(manager.read(evidence, { signal: controller.signal }), /interrupt first retry batch/);
    const saved = JSON.parse(await fs.readFile(path.join(path.dirname(evidence.frames[0].imagePath), 'manifest.json'), 'utf8'));
    assert.deepEqual(saved.observations.map(item => item.frameId), ['frame-0002', 'frame-0003']);
    assert.equal(saved.coverage.recognizedFrameCount, 2, 'progress does not drop to only the visited cache prefix');
    interrupt = false;
    const completed = await manager.read(evidence);
    assert.equal(completed.coverage.recognizedFrameCount, 3);
    assert.equal(times.filter(time => time === 50).length, 1); assert.equal(times.filter(time => time === 99.9).length, 1);
    assert.equal(times.filter(time => time === 0).length, 2);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});
