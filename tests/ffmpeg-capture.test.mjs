import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chooseFrames, resolveFfmpeg } from '../server/ffmpeg-capture.mjs';

test('frame selection keeps temporal endpoints within the configured budget', () => {
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    time: index * 4, changeScore: index === 17 ? 0.2 : 0.001, sharpnessScore: index % 7 === 0 ? 0 : 0.8,
    contentScore: index % 5 === 0 ? 0.2 : 0.01, visualHash: createHash('sha256').update(String(index)).digest('hex').slice(0, 16),
  }));
  const selected = chooseFrames(candidates, 8);
  assert.equal(selected.length, 8);
  assert.equal(selected[0], 0);
  assert.equal(selected.at(-1), 39);
  assert.ok(selected.some(index => index >= 17 && index <= 20), 'a settled frame near the largest board change is retained');
  assert.ok(chooseFrames(candidates.slice(0, 3), 8).length === 3);
});

test('bundled Windows ffmpeg unpacks with the pinned hash and runs locally', {
  skip: process.platform !== 'win32' || process.arch !== 'x64' || !fs.existsSync(new URL('../vendor/ffmpeg/win32-x64/ffmpeg.exe.gz', import.meta.url)),
}, async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shifen-ffmpeg-runtime-'));
  try {
    const binary = await resolveFfmpeg({ dataDir });
    const bytes = await fsp.readFile(binary);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00');
    assert.match(execFileSync(binary, ['-hide_banner', '-version'], { encoding: 'utf8' }), /ffmpeg version 6\.1\.1/);
    assert.equal(await resolveFfmpeg({ dataDir }), binary, 'the verified runtime is reused');
  } finally { await fsp.rm(dataDir, { recursive: true, force: true }); }
});
