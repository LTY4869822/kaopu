import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Python frame downloader enforces selected-part duration without network or models', t => {
  const executable = process.env.LOCAL_TRANSCRIPTION_PYTHON || (process.platform === 'win32' ? 'py' : 'python');
  const result = spawnSync(executable, ['-I', fileURLToPath(new URL('./extract-lecture-frames.test.py', import.meta.url))], { windowsHide: true, shell: false, encoding: 'utf8', timeout: 15000 });
  if (result.error?.code === 'ENOENT') { t.skip('Optional Python video runtime is not installed'); return; }
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
