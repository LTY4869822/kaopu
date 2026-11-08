import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRawStore } from '../server/raw-store.mjs';
import { createBackupArchive, inspectBackupArchive, stageBackupRestore, preparePendingRestore, commitPendingRestore } from '../server/backup.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shifen-backup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const rawStore = createRawStore({ dataDir: directory });
  const transcript = rawStore.put({ courseId: 'course-1', sourceId: 'lesson-1', artifactId: 'subtitle', data: '{"body":[{"content":"极限定义"}]}', kind: 'platform-subtitles' });
  const frameDirectory = path.join(directory, 'lesson-visual', 'lesson-1', 'evidence-1');
  fs.mkdirSync(frameDirectory, { recursive: true });
  const framePath = path.join(frameDirectory, 'frame-0001.jpg');
  fs.writeFileSync(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]));
  fs.writeFileSync(path.join(frameDirectory, 'manifest.json'), JSON.stringify({ id: 'evidence-1', lessonId: 'lesson-1' }));
  const frame = rawStore.registerFile({ courseId: 'course-1', sourceId: 'lesson-1', artifactId: 'frame-0001', path: framePath });
  const state = {
    courses: [{ id: 'course-1', name: '高等数学' }],
    documents: [{ id: 'document-1', courseId: 'course-1', rawRef: transcript.rawRef }],
    cards: [], questions: [], attempts: [], completedTasks: [],
  };
  const lessons = { version: 1, lessons: [{
    id: 'lesson-1', courseId: 'course-1', cues: [], rawRef: transcript.rawRef, rawRefs: [transcript.rawRef],
    visual: { id: 'evidence-1', frames: [{ id: 'frame-0001', rawRef: frame.rawRef }] },
  }] };
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(directory, 'lessons.json'), JSON.stringify(lessons));
  fs.writeFileSync(path.join(directory, 'bilibili-session.json'), JSON.stringify({ cookieHeader: 'SESSDATA=user-secret', uname: '账户 A', savedAt: 1 }));
  fs.mkdirSync(path.join(directory, 'knowledge', '高等数学', 'wiki'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'knowledge', 'log.md'), '# 工作流日志\n');
  fs.writeFileSync(path.join(directory, 'knowledge', '高等数学', 'wiki', '可再生.md'), 'mirror');
  return { directory, rawStore, transcript, frame, framePath, state };
}

test('full backup preserves immutable Raw, workflow log and workspace Bilibili session', async t => {
  const h = fixture(t);
  const archive = await createBackupArchive({ dataDir: h.directory });
  const inspected = await inspectBackupArchive(archive.bytes);
  const paths = inspected.files.map(file => file.path);
  assert.ok(paths.includes(h.transcript.rawRef));
  assert.ok(paths.includes(h.transcript.rawRef.replace('payload.bin', 'manifest.json')));
  assert.ok(paths.includes(h.frame.rawRef.replace(/[^/]+$/, 'manifest.json')));
  assert.ok(paths.includes('lesson-visual/lesson-1/evidence-1/frame-0001.jpg'));
  assert.ok(paths.includes('knowledge/log.md'));
  assert.ok(paths.includes('bilibili-session.json'));
  assert.ok(!paths.some(file => file.includes('可再生.md')));

  const restored = path.join(h.directory, 'restored');
  await stageBackupRestore({ dataDir: restored, archive: archive.bytes });
  // Windows may briefly lock a newly written payload.bin while scanning it.
  await delay(150);
  assert.equal(fs.existsSync(restored), false);
  assert.equal(preparePendingRestore(restored).applied, true);
  commitPendingRestore(restored);
  const restoredRaw = createRawStore({ dataDir: restored });
  assert.equal(restoredRaw.verify(h.transcript.rawRef).ok, true);
  assert.equal(restoredRaw.verify(h.frame.rawRef).ok, true);
  assert.equal(fs.readFileSync(path.join(restored, 'knowledge', 'log.md'), 'utf8'), '# 工作流日志\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(restored, 'bilibili-session.json'), 'utf8')).uname, '账户 A');
});

test('restore rejects Raw external path escape and tampered bytes', async t => {
  await t.test('external path escape', async t => {
    const h = fixture(t);
    const manifestPath = path.join(h.directory, h.frame.rawRef.replace(/[^/]+$/, 'manifest.json'));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.externalPath = '../outside.jpg';
    manifest.rawRef = manifest.rawRef.replace('payload.bin', 'external');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const archive = await createBackupArchive({ dataDir: h.directory });
    await assert.rejects(inspectBackupArchive(archive.bytes), /外部原件路径无效/);
  });
  await t.test('tampered archived JPEG', async t => {
    const h = fixture(t);
    fs.appendFileSync(path.join(h.directory, h.frame.rawRef), Buffer.from([1, 2, 3]));
    const archive = await createBackupArchive({ dataDir: h.directory });
    await assert.rejects(inspectBackupArchive(archive.bytes), /Raw 原件缺失或哈希不一致/);
  });
});

test('restore rejects unsafe Raw references and malformed Bilibili sessions', async t => {
  await t.test('unsafe reference', async t => {
    const h = fixture(t);
    h.state.documents[0].rawRef = '../state.json';
    fs.writeFileSync(path.join(h.directory, 'state.json'), JSON.stringify(h.state));
    const archive = await createBackupArchive({ dataDir: h.directory });
    await assert.rejects(inspectBackupArchive(archive.bytes), /Raw 引用路径无效/);
  });
  await t.test('invalid session', async t => {
    const h = fixture(t);
    fs.writeFileSync(path.join(h.directory, 'bilibili-session.json'), JSON.stringify({ cookieHeader: 'not-a-session', uname: '', savedAt: 1 }));
    const archive = await createBackupArchive({ dataDir: h.directory });
    await assert.rejects(inspectBackupArchive(archive.bytes), /B 站会话结构无效/);
  });
});
