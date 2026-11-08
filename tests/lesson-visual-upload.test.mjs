import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createCanvas } from '@napi-rs/canvas';
import { createLessonVision } from '../server/lesson-vision.mjs';
import { mountLessons } from '../server/lessons.mjs';

function screenshot(text) {
  const canvas = createCanvas(320, 180), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 320, 180);
  context.fillStyle = '#17233b'; context.font = '24px sans-serif'; context.fillText(text, 20, 90);
  return canvas.toBuffer('image/png');
}

test('manual screenshots become bounded JPEG evidence with explicit source times', async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shifen-visual-import-'));
  const source = path.join(dataDir, 'board.png');
  await fsp.writeFile(source, screenshot('f(x)=x^2'));
  const manager = createLessonVision({ dataDir });
  try {
    const evidence = await manager.importFrames({ id: 'lesson-import', courseId: 'course-a', part: 1, title: '手动板书' }, { files: [{ path: source }], times: [42] });
    assert.equal(evidence.status, 'captured');
    assert.equal(evidence.frames.length, 1);
    assert.equal(evidence.frames[0].time, 42);
    assert.equal(evidence.frames[0].width, 320);
    assert.equal((await fsp.readFile(evidence.frames[0].imagePath))[0], 0xff);
    assert.match(evidence.warnings.join('\n'), /用户上传/);
    await assert.rejects(manager.importFrames({ id: 'lesson-import', courseId: 'course-a', part: 1 }, { files: [{ path: source }], times: [7201] }), /截图时间点/);
  } finally { await fsp.rm(dataDir, { recursive: true, force: true }); }
});

test('visual upload route imports screenshots, serves their evidence and removes temporary files', async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shifen-visual-upload-'));
  const uploads = path.join(dataDir, 'uploads');
  await fsp.mkdir(uploads);
  const visualUpload = multer({ storage: multer.diskStorage({ destination: uploads }), limits: { fileSize: 256 * 1024 * 1024, files: 12, fields: 1 } });
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const state = { courses: [{ id: 'course-a', name: '高数' }], documents: [] };
  const visionService = createLessonVision({ dataDir });
  const manager = mountLessons(app, { dataDir, getState: () => state, saveState() {}, visionService, visualUpload });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/lessons`;
  try {
    const createdResponse = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: 'course-a', title: '上传板书', url: '', part: 1 }) });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    const form = new FormData();
    form.append('files', new Blob([screenshot('第一页')], { type: 'image/png' }), 'first.png');
    form.append('files', new Blob([screenshot('第二页')], { type: 'image/png' }), 'second.png');
    form.append('times', '12, 48');
    const accepted = await fetch(`${base}/${created.id}/visual-upload`, { method: 'POST', body: form });
    assert.equal(accepted.status, 202);
    let lesson;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      lesson = await (await fetch(`${base}/${created.id}`)).json();
      if (!['queued', 'analyzing'].includes(lesson.status)) break;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.equal(lesson.visual.frames.length, 2);
    assert.deepEqual(lesson.visual.frames.map(frame => frame.time), [12, 48]);
    assert.ok(lesson.visual.frames.every(frame => frame.rawRef && frame.sha256.length === 64));
    for (let attempt = 0; attempt < 50 && (await fsp.readdir(uploads)).length; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(await fsp.readdir(uploads), []);
    const frame = lesson.visual.frames[0];
    const image = await fetch(`http://127.0.0.1:${server.address().port}${frame.imageUrl}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');

    const rejectedForm = new FormData();
    rejectedForm.append('files', new Blob(['not an image']), 'note.txt');
    const rejected = await fetch(`${base}/${created.id}/visual-upload`, { method: 'POST', body: rejectedForm });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await fsp.readdir(uploads), []);
  } finally {
    manager.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
});
