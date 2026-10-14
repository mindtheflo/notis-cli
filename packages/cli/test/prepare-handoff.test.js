import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArtifact } from '../scripts/release-artifact.js';
import { validBundle } from '../test-support/release-artifact-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Exercise this checkout's native script; the adapter never substitutes beta behavior.
const nativeScripts = [['native-branch', readFileSync(join(root, 'packages/cli/scripts/smoke-package.js'))]];

for (const [name, nativeScript] of nativeScripts) {
  test(`${name}: retains the exact native-smoked tgz without rebuilding/repacking`, { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'notis-handoff-adapter-'));
    try {
      const bundle = validBundle(true);
      const pkg = { ...bundle.packageManifest, type: 'module', files: ['bin', 'config'],
        scripts: { build: 'node -e "process.exit(0)"' } };
      for (const sub of ['scripts', 'bin', 'config']) mkdirSync(join(dir, sub));
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
      writeFileSync(join(dir, 'release-plan.json'), bundle.planBytes);
      writeFileSync(join(dir, 'scripts/smoke-package.js'), nativeScript);
      writeFileSync(join(dir, 'config/notis_app_boundary_rules.json'), '{}');
      writeFileSync(join(dir, 'bin/check-runtime.js'), '');
      writeFileSync(join(dir, 'bin/notis.js'), `if(process.env.GITHUB_TOKEN || process.env.NODE_AUTH_TOKEN)throw Error('Credential leak'); console.log(process.argv.includes('--version') ? '${pkg.version}' : 'fixture help');`);
      const result = spawnSync(process.execPath, [join(root, 'packages/cli/scripts/prepare-handoff.js')], { cwd: dir,
        encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: 'must-not-enter-native-smoke', NODE_AUTH_TOKEN: 'must-not-enter-native-smoke',
          NOTIS_HANDOFF_READ_ONLY: 'true', GITHUB_REPOSITORY: 'mindtheflo/notis', NOTIS_ORCHESTRATION_SHA: 'b'.repeat(40),
          GITHUB_RUN_ID: 'fixture-run', GITHUB_JOB: 'fixture', GITHUB_EVENT_NAME: 'api',
          NPM_CONFIG_REGISTRY: 'http://127.0.0.1:1', NPM_CONFIG_CACHE: join(dir, 'npm-cache') } });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const manifest = JSON.parse(readFileSync(join(dir, 'handoff/handoff-manifest.json')));
      const tarball = readFileSync(join(dir, 'handoff/notis-cli.tgz'));
      verifyArtifact({ manifest, tarball, planBytes: readFileSync(join(dir, 'handoff/release-plan.json')) });
      assert.match(result.stdout, /smoke-package: OK/);
      assert.equal(manifest.builder.smoke, 'native-exact-tarball');
      assert.equal(manifest.builder.event, 'api');
      assert.throws(() => readFileSync(join(dir, `notis_ai-cli-${pkg.version}.tgz`)), /ENOENT/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
