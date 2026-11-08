import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, normalizePath } from 'vite';

test('Vite denies runtime data through direct, raw and filesystem URLs without exposing sentinels', async () => {
  // The server root and every requested file are temporary; never inspect real data/.
  // Vite correctly refuses Windows 8.3 paths; use the expanded temp directory.
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(tempRoot, 'shifen-vite-security-'));
  const marker = 'PRIVATE_SENTINEL_FOR_SECURITY_TEST';
  const customDir = path.join(temporary, 'private-records');
  const previousDataDir = process.env.DATA_DIR;
  let server;
  try {
    fs.mkdirSync(path.join(temporary, 'data'));
    fs.mkdirSync(customDir);
    fs.writeFileSync(path.join(temporary, 'data', 'auth.json'), JSON.stringify({ marker }));
    fs.writeFileSync(path.join(customDir, 'state.json'), JSON.stringify({ marker }));
    fs.writeFileSync(path.join(temporary, '.env.local'), `PRIVATE_SENTINEL=${marker}`);
    fs.writeFileSync(path.join(temporary, 'safe.txt'), 'public-fixture');
    process.env.DATA_DIR = customDir;
    server = await createServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      root: temporary,
      envDir: temporary,
      publicDir: false,
      cacheDir: path.join(temporary, '.vite'),
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [temporary] } },
    });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const denied = [
      '/data/auth.json', '/data/auth.json?raw', '/private-records/state.json',
      `/@fs/${normalizePath(path.join(temporary, 'data', 'auth.json'))}`,
      `/@fs/${normalizePath(path.join(customDir, 'state.json'))}?raw`,
      '/.env.local',
    ];
    for (const url of denied) {
      const response = await fetch(base + encodeURI(url));
      const body = await response.text();
      assert.ok(!body.includes(marker), `Sensitive marker leaked: ${url}`);
      // Vite 7.3 rejects denied /@fs/ URLs as missing; both statuses must hide the file.
      const expected = url.startsWith('/@fs/') ? [403, 404] : [403];
      assert.ok(expected.includes(response.status), `${url}: ${response.status}`);
    }
    const publicResponse = await fetch(`${base}/safe.txt`);
    assert.equal(publicResponse.status, 200);
    assert.equal(await publicResponse.text(), 'public-fixture');
  } finally {
    if (server) await server.close();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    assert.ok(path.resolve(temporary).startsWith(path.resolve(tempRoot) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
