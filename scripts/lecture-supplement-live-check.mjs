import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createLessonVision } from '../server/lesson-vision.mjs';
import { createModelService } from '../server/model-service.mjs';

// Explicit live verification: a short range of an already imported public BV
// lecture, in an isolated directory. Only the configured vision service is used.
// Credentials and user source text never appear in the report or console.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'data'), output = path.join(root, 'test-results/lecture-study');
const hash = value => createHash('sha256').update(value).digest('hex');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'shifen-range-live-'));
const report = { startedAt: new Date().toISOString() };
try {
  const before = await fs.readFile(path.join(data, 'lessons.json'));
  const saved = JSON.parse(before), original = saved.lessons.find(item => item.visual?.frames?.length && item.url?.startsWith('https://www.bilibili.com/video/'));
  assert.ok(original, 'an existing public lecture is available');
  assert.match(original.id, /^[a-zA-Z0-9_-]{1,100}$/); assert.match(original.visual.id, /^[a-zA-Z0-9_-]{1,100}$/);
  const source = path.join(data, 'lesson-visual', original.id, original.visual.id);
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  const model = createModelService({ dataDir: data }); assert.ok(model.visionProvider.configured, 'a verified vision model is configured');
  const id = 'isolated-range-check', target = path.join(scratch, 'lesson-visual', id, manifest.id);
  await fs.mkdir(target, { recursive: true });
  for (const frame of manifest.frames) {
    assert.match(frame.id, /^frame-\d{4}$/);
    const bytes = await fs.readFile(path.join(source, `${frame.id}.jpg`)); assert.equal(hash(bytes), frame.sha256);
    await fs.writeFile(path.join(target, `${frame.id}.jpg`), bytes);
  }
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify({ ...manifest, lessonId: id }));
  const lesson = { ...original, id, visual: { ...original.visual, lessonId: id } };
  const vision = createLessonVision({ dataDir: scratch, provider: () => model.visionProvider });
  const start = Math.min(165, Math.max(0, Math.floor(manifest.coverage.durationSeconds) - 13));
  console.log(JSON.stringify({ stage: 'capturing', seconds: 12, existingFrames: manifest.frames.length }));
  const added = await vision.supplement(lesson, { range: { start, end: start + 12 } });
  const oldIds = new Set(manifest.frames.map(frame => frame.id)), newIds = added.frames.filter(frame => !oldIds.has(frame.id)).map(frame => frame.id);
  console.log(JSON.stringify({ stage: 'recognizing', newFrames: newIds.length }));
  const read = await vision.read(added, { frameIds: newIds });
  assert.equal(read.frames.length, manifest.frames.length + newIds.length);
  for (const frame of manifest.frames) assert.equal(read.frames.find(item => item.id === frame.id)?.sha256, frame.sha256);
  const recognizedNew = read.observations.filter(item => newIds.includes(item.frameId));
  assert.equal(recognizedNew.length, newIds.length, 'all added frames complete a real vision request');
  assert.equal(hash(await fs.readFile(path.join(data, 'lessons.json'))), hash(before), 'existing course record is untouched');
  report.passed = true; report.source = 'existing-public-bilibili-lecture'; report.range = { start, end: start + 12 };
  report.previousFrames = manifest.frames.length; report.addedFrames = newIds.length; report.recognizedNew = recognizedNew.length;
  report.totalFrames = read.frames.length; report.recognizedTotal = read.observations.length; report.userCourseUnchanged = true;
  report.newFramesWithText = recognizedNew.filter(item => item.visibleText || item.latex.length).length;
  report.limits = '仅验证指定片段的补采、真实模型识别与原记录保留；未评估全课覆盖或数学正确率。';
} catch (cause) { report.passed = false; report.error = cause.status ? cause.message : 'Live range verification did not complete; original course data was not modified.'; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'live-supplement-report.json'), JSON.stringify(report, null, 2));
  if (path.dirname(path.resolve(scratch)) === path.resolve(os.tmpdir()) && path.basename(scratch).startsWith('shifen-range-live-')) await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 });
  console.log(JSON.stringify(report));
}
