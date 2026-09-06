import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { syncEmbeddedSdk } from '../src/runtime/app-platform.js';

function makeTemplate(root) {
  const dir = join(root, 'template-sdk');
  mkdirSync(join(dir, 'src', 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@notis/sdk', version: '9.9.9' }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}\n');
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const fresh = true;\n');
  writeFileSync(join(dir, 'src', 'hooks', 'useQuery.ts'), 'export const useQuery = () => null;\n');
  return dir;
}

test('syncEmbeddedSdk overwrites a stale embedded SDK and reports the update once', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-sync-'));
  try {
    const templateSdkDir = makeTemplate(root);
    const projectDir = join(root, 'app');
    mkdirSync(join(projectDir, 'packages', 'sdk', 'src'), { recursive: true });
    writeFileSync(join(projectDir, 'packages', 'sdk', 'package.json'), JSON.stringify({ name: '@notis/sdk', version: '0.1.0' }));
    writeFileSync(join(projectDir, 'packages', 'sdk', 'src', 'index.ts'), 'export const fresh = false;\n');
    writeFileSync(join(projectDir, 'packages', 'sdk', 'src', 'local-only.ts'), 'export const keep = true;\n');

    const logged = [];
    const first = syncEmbeddedSdk(projectDir, { templateSdkDir, log: (message) => logged.push(message) });
    assert.equal(first.updated, true);
    assert.deepEqual(first.changed.sort(), ['package.json', 'src/hooks/useQuery.ts', 'src/index.ts', 'tsconfig.json']);
    assert.deepEqual(first.foreign, ['src/local-only.ts']);
    assert.match(logged[0], /Updated embedded @notis\/sdk to 9\.9\.9/);
    assert.ok(logged.some((message) => /local-only\.ts is not part of the @notis\/sdk template/.test(message)));
    assert.equal(readFileSync(join(projectDir, 'packages', 'sdk', 'src', 'index.ts'), 'utf-8'), 'export const fresh = true;\n');
    assert.equal(readFileSync(join(projectDir, 'packages', 'sdk', 'src', 'local-only.ts'), 'utf-8'), 'export const keep = true;\n');

    const second = syncEmbeddedSdk(projectDir, { templateSdkDir, log: () => {} });
    assert.equal(second.updated, false);
    assert.deepEqual(second.changed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('syncEmbeddedSdk is a no-op for projects without an embedded SDK', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-sync-'));
  try {
    const templateSdkDir = makeTemplate(root);
    const projectDir = join(root, 'plain');
    mkdirSync(projectDir, { recursive: true });
    assert.deepEqual(syncEmbeddedSdk(projectDir, { templateSdkDir, log: () => {} }), { updated: false, reason: 'no-embedded-sdk' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
