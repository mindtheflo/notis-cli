import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appFilesDigest,
  buildArtifact,
  collectArtifactFiles,
  collectSourceFiles,
  prepareAppRelease,
} from '../src/runtime/app-platform.js';

function createBuiltProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-deploy-gate-'));
  // A built project is a source folder: its index marks the root (source-root guard).
  writeFileSync(join(projectDir, 'notis.config.ts'), 'export default {};\n');
  mkdirSync(join(projectDir, '.notis', 'output', 'bundle'), { recursive: true });
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'export const app = 1;\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), '.a{}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), JSON.stringify({ version: 1, routes: [] }));
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'gate-app' }));
  return projectDir;
}

// The workspace guard refuses before any entry file or manifest is written.
const refusedBeforePrepare = { prepare: () => assert.fail('prepare ran after a refused workspace') };

function writeReceipt(projectDir) {
  writeFileSync(join(projectDir, '.notis', 'build-receipt.json'), JSON.stringify({
    source_hash: appFilesDigest(collectSourceFiles(projectDir)),
    artifact_hash: appFilesDigest(collectArtifactFiles(projectDir)),
  }));
}

test('build and release reject a linked .notis parent without deleting or staging outside', async () => {
  const projectDir = createBuiltProject();
  const outside = mkdtempSync(join(tmpdir(), 'notis-release-outside-'));
  try {
    writeFileSync(join(outside, 'build-receipt.json'), 'outside sentinel');
    rmSync(join(projectDir, '.notis'), { recursive: true });
    symlinkSync(outside, join(projectDir, '.notis'), 'dir');
    await assert.rejects(buildArtifact(projectDir, refusedBeforePrepare), /unsafe target/);
    assert.throws(() => prepareAppRelease(projectDir), /unsafe target/);
    assert.equal(readFileSync(join(outside, 'build-receipt.json'), 'utf8'), 'outside sentinel');
    assert.deepEqual(readdirSync(outside), ['build-receipt.json']);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('release rejects a linked receipt and creates no frozen directory', () => {
  const projectDir = createBuiltProject();
  const outside = mkdtempSync(join(tmpdir(), 'notis-receipt-outside-'));
  try {
    writeReceipt(projectDir);
    const receipt = join(projectDir, '.notis', 'build-receipt.json');
    renameSync(receipt, join(outside, 'receipt'));
    symlinkSync(join(outside, 'receipt'), receipt);
    assert.throws(() => prepareAppRelease(projectDir), /Unsafe build receipt/);
    assert.deepEqual(readdirSync(join(projectDir, '.notis')).sort(), ['build-receipt.json', 'output']);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('frozen staging uses captured bytes and closes idempotently', () => {
  const projectDir = createBuiltProject();
  try {
    writeReceipt(projectDir);
    const release = prepareAppRelease(projectDir);
    writeFileSync(join(projectDir, 'package.json'), '{}');
    assert.notEqual(readFileSync(join(release.projectDir, 'package.json'), 'utf8'), '{}');
    release.close();
    release.close();
    assert.equal(existsSync(release.projectDir), false);
  } finally { rmSync(projectDir, { recursive: true, force: true }); }
});

test('release cleanup rejects a replaced .notis parent without removing outside or retained staging', () => {
  const projectDir = createBuiltProject();
  const outside = mkdtempSync(join(tmpdir(), 'notis-close-outside-'));
  try {
    writeReceipt(projectDir);
    const release = prepareAppRelease(projectDir);
    const frozenName = release.projectDir.split('/').at(-1);
    mkdirSync(join(outside, frozenName));
    writeFileSync(join(outside, frozenName, 'keep'), 'outside sentinel');
    renameSync(join(projectDir, '.notis'), join(projectDir, '.notis-retained'));
    symlinkSync(outside, join(projectDir, '.notis'), 'dir');
    assert.throws(() => release.close(), /unsafe target/);
    assert.equal(readFileSync(join(outside, frozenName, 'keep'), 'utf8'), 'outside sentinel');
    assert.ok(existsSync(join(projectDir, '.notis-retained', frozenName)));
    assert.ok(!process.listeners('exit').includes(release.close));
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('build pins .notis identity across a parent swap before chdir', async () => {
  const projectDir = createBuiltProject();
  const outside = mkdtempSync(join(tmpdir(), 'notis-pin-outside-'));
  const originalChdir = process.chdir;
  let swapped = false;
  try {
    writeFileSync(join(outside, 'build-receipt.json'), 'outside sentinel');
    process.chdir = function (path) {
      if (path === '.notis' && !swapped) {
        swapped = true;
        renameSync(join(projectDir, '.notis'), join(projectDir, '.notis-retained'));
        symlinkSync(outside, join(projectDir, '.notis'), 'dir');
      }
      return originalChdir.call(process, path);
    };
    await assert.rejects(buildArtifact(projectDir, refusedBeforePrepare), /target changed/);
    assert.equal(swapped, true);
    assert.equal(readFileSync(join(outside, 'build-receipt.json'), 'utf8'), 'outside sentinel');
  } finally {
    process.chdir = originalChdir;
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
