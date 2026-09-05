import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startAppDevBuild, stopAppDevBuild } from '../src/runtime/app-dev-build.js';

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(50);
  }
  assert.fail('Process lifecycle condition did not complete within 10 seconds');
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

for (const abrupt of [false, true]) {
  test(`watcher descendants stop after ${abrupt ? 'owner SIGKILL' : 'normal close'}`, {
    skip: process.platform === 'win32',
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notis-build-lifetime-'));
    const marker = join(dir, 'pids.json');
    const fixture = join(dir, 'watcher.cjs');
    const ready = join(dir, 'ready');
    const leafCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`;
    writeFileSync(fixture, `
      const { spawn } = require('node:child_process');
      const leaf = spawn(process.execPath, ['-e', ${JSON.stringify(leafCode)}], { stdio: 'ignore' });
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify([process.pid, leaf.pid]));
      setInterval(() => {}, 1000);
    `);
    let owner;
    let pids = [];
    try {
      if (abrupt) {
        const moduleUrl = new URL('../src/runtime/app-dev-build.js', import.meta.url).href;
        owner = spawn(process.execPath, ['--input-type=module', '-e',
          `import { startAppDevBuild } from ${JSON.stringify(moduleUrl)}; await startAppDevBuild(${JSON.stringify(dir)}, process.execPath, [${JSON.stringify(fixture)}]);`],
        { stdio: 'ignore' });
      } else {
        owner = await startAppDevBuild(dir, process.execPath, [fixture]);
      }
      await until(() => {
        try { pids = JSON.parse(readFileSync(marker, 'utf8')); return pids.length === 2 && existsSync(ready); } catch { return false; }
      });
      assert.ok(pids.every(alive));
      if (!abrupt) assert.equal(owner.pid, pids[0], 'expose the actual build group leader for recovery');
      if (abrupt) owner.kill('SIGKILL');
      else await stopAppDevBuild(owner);
      await until(() => pids.every((pid) => !alive(pid)));
    } finally {
      if (owner && owner.exitCode === null && owner.signalCode === null) owner.kill('SIGTERM');
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a missing build executable rejects startup', async () => {
  await assert.rejects(startAppDevBuild(tmpdir(), '/notis-missing-build-executable', []), /before startup/);
});
