import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Only server-owned, current-lecture JPEG evidence may leave the asset store. */
export async function readLessonFrame(dataDir, lesson, frameId) {
  const safe = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const frame = lesson?.visual?.frames?.find(item => item.id === frameId);
  if (!frame || !safe(lesson.id) || !safe(lesson.visual.id) || !/^frame-\d{4}$/.test(frameId)) throw new Error('课程图片不可用。');
  const root = path.resolve(dataDir, 'lesson-visual');
  const target = path.join(root, lesson.id, lesson.visual.id, `${frameId}.jpg`);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 4 || stat.size > 4 * 1024 * 1024) throw new Error('课程图片不可用。');
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  const relative = path.relative(realRoot, realTarget);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('课程图片不可用。');
  const bytes = await fs.readFile(target);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || (frame.sha256 && createHash('sha256').update(bytes).digest('hex') !== frame.sha256)) throw new Error('课程图片与来源记录不一致。');
  return { bytes, mime: 'image/jpeg', frame };
}
