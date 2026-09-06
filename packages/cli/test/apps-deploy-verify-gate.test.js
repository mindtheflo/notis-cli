import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  assertVerifiedArtifact,
  computeArtifactHash,
  readVerifyStamp,
  UNVERIFIED_DEPLOY_ENV,
  writeVerifyStamp,
} from '../src/runtime/app-platform.js';

const cliRoot = resolve(import.meta.dirname, '..');
const binPath = join(cliRoot, 'bin', 'notis.js');

function createBuiltProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-deploy-gate-'));
  mkdirSync(join(projectDir, '.notis', 'output', 'bundle'), { recursive: true });
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'export const app = 1;\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), '.a{}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), JSON.stringify({ version: 1, routes: [] }));
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'gate-app', notisAppVersion: '0.1.0' }));
  return projectDir;
}

const passing = (results = [{ route: 'home', status: 'passed', assertions: [] }]) => ({
  ok: true,
  mode: 'stub',
  summary: { total: 1, passed: 1, failed: 0, manual: 0 },
  results,
});

test('assertVerifiedArtifact blocks without a stamp, with a failed stamp, and with a stale hash', () => {
  const projectDir = createBuiltProject();
  try {
    assert.throws(() => assertVerifiedArtifact(projectDir, { env: {} }), /Deploy blocked: no "notis apps verify" result/);

    writeVerifyStamp(projectDir, { ...passing(), ok: false, summary: { total: 1, passed: 0, failed: 1, manual: 0 } });
    assert.throws(() => assertVerifiedArtifact(projectDir, { env: {} }), /last "notis apps verify" failed \(1 route\)/);

    writeVerifyStamp(projectDir, passing());
    assert.equal(assertVerifiedArtifact(projectDir, { env: {} }).gated, true);

    writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'export const app = 2;\n');
    assert.notEqual(readVerifyStamp(projectDir).artifact_hash, computeArtifactHash(projectDir));
    assert.throws(() => assertVerifiedArtifact(projectDir, { env: {} }), /artifact changed since the last passing/);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('the break-glass environment variable allows the deploy but reports why', () => {
  const projectDir = createBuiltProject();
  try {
    const gate = assertVerifiedArtifact(projectDir, { env: { [UNVERIFIED_DEPLOY_ENV]: '1' } });
    assert.equal(gate.gated, false);
    assert.match(gate.reason, /no "notis apps verify" result/);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('apps deploy refuses an unverified artifact before touching the network, including --direct', () => {
  const projectDir = createBuiltProject();
  try {
    for (const extra of [[], ['--direct']]) {
      const result = spawnSync(process.execPath, [
        binPath, 'apps', 'deploy', projectDir, '--app-id', 'app-123', '--skip-build', '--json', ...extra,
      ], {
        cwd: cliRoot,
        env: {
          ...process.env,
          HOME: mkdtempSync(join(tmpdir(), 'notis-cli-home-')),
          NODE_ENV: 'test',
          NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
          NOTIS_JWT: 'test-token',
          [UNVERIFIED_DEPLOY_ENV]: '',
        },
        encoding: 'utf-8',
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /Deploy blocked: no \\?"notis apps verify\\?" result/);
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
