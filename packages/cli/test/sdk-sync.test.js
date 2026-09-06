import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildArtifact, syncEmbeddedSdk } from '../src/runtime/app-platform.js';

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


for (const target of ['packages', 'packages/sdk', 'packages/sdk/src', 'packages/sdk/src/index.ts', 'packages/sdk/package.json']) {
  test(`SDK refresh rejects linked ${target} without changing outside bytes or retaining a build receipt`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'notis-sdk-link-'));
    try {
      const projectDir = join(root, 'app');
      const outside = join(root, 'outside');
      mkdirSync(join(projectDir, '.notis'), { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(projectDir, '.notis/build-receipt.json'), '{}');
      const segments = target.split('/');
      const leaf = segments.pop();
      const parent = join(projectDir, ...segments);
      mkdirSync(parent, { recursive: true });
      if (target.endsWith('.json') || target.endsWith('.ts')) {
        const victim = join(outside, 'victim');
        writeFileSync(victim, 'outside sentinel');
        symlinkSync(victim, join(parent, leaf));
      } else {
        writeFileSync(join(outside, 'package.json'), 'outside sentinel');
        symlinkSync(outside, join(parent, leaf), 'dir');
      }
      if (!target.endsWith('package.json') && target.startsWith('packages/sdk/src')) {
        writeFileSync(join(projectDir, 'packages/sdk/package.json'), '{"name":"@notis/sdk","version":"0.0.0"}');
      }
      await assert.rejects(buildArtifact(projectDir, { stdio: 'pipe' }), /unsafe target|unsafe package/);
      const victim = join(outside, target.endsWith('.json') || target.endsWith('.ts') ? 'victim' : 'package.json');
      assert.equal(readFileSync(victim, 'utf8'), 'outside sentinel');
      assert.equal(existsSync(join(projectDir, '.notis/build-receipt.json')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('SDK refresh replaces a hard-linked mirror without truncating the outside file', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-hardlink-'));
  try {
    const templateSdkDir = makeTemplate(root);
    const projectDir = join(root, 'app');
    mkdirSync(join(projectDir, 'packages/sdk/src'), { recursive: true });
    writeFileSync(join(projectDir, 'packages/sdk/package.json'), '{"name":"@notis/sdk","version":"0.0.0"}');
    const victim = join(root, 'outside');
    writeFileSync(victim, 'outside sentinel');
    linkSync(victim, join(projectDir, 'packages/sdk/src/index.ts'));
    syncEmbeddedSdk(projectDir, { templateSdkDir, log: () => {} });
    assert.equal(readFileSync(victim, 'utf8'), 'outside sentinel');
    assert.equal(readFileSync(join(projectDir, 'packages/sdk/src/index.ts'), 'utf8'), 'export const fresh = true;\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('SDK refresh rejects a parent-directory swap before any outside write', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-parent-race-'));
  const previousCwd = process.cwd();
  const originalChdir = process.chdir;
  try {
    const templateSdkDir = makeTemplate(root);
    const projectDir = join(root, 'app');
    const sdkDir = join(projectDir, 'packages/sdk');
    const outside = join(root, 'outside');
    mkdirSync(join(sdkDir, 'src'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(sdkDir, 'package.json'), '{"name":"@notis/sdk","version":"0.0.0"}');
    writeFileSync(join(outside, 'index.ts'), 'outside sentinel');
    let swapped = false;
    process.chdir = (target) => {
      if (target === 'src' && !swapped) {
        swapped = true;
        renameSync(join(sdkDir, 'src'), join(sdkDir, 'original-src'));
        symlinkSync(outside, join(sdkDir, 'src'), 'dir');
      }
      return originalChdir.call(process, target);
    };
    assert.throws(() => syncEmbeddedSdk(projectDir, { templateSdkDir, log: () => {} }), /target changed/);
    assert.equal(swapped, true);
    assert.equal(readFileSync(join(outside, 'index.ts'), 'utf8'), 'outside sentinel');
  } finally {
    process.chdir = originalChdir;
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
