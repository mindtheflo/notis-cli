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
const nativeScript = readFileSync(join(root, 'packages/cli/scripts/smoke-package.js'));

const verifierFiles = ['release-artifact.js', 'release-intent.js', 'release-channels.cjs'];

// Build a package source like the one the builder checks out, with its own verifier.
function prepareSource(nativeScript, { verifier = source => source } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'notis-handoff-adapter-'));
  const bundle = validBundle(true);
  const pkg = { ...bundle.packageManifest, type: 'module', files: ['bin', 'config'],
    scripts: { build: 'node -e "process.exit(0)"' } };
  for (const sub of ['scripts', 'bin', 'config', 'tmp']) mkdirSync(join(dir, sub));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  // Match a cloud temp root inside a CommonJS project; the smoke must still
  // create its own install boundary below this ancestor.
  writeFileSync(join(dir, 'tmp/package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
  writeFileSync(join(dir, 'release-plan.json'), bundle.planBytes);
  writeFileSync(join(dir, 'scripts/smoke-package.js'), nativeScript);
  for (const file of verifierFiles) {
    const source = readFileSync(join(root, 'packages/cli/scripts', file), 'utf8');
    writeFileSync(join(dir, 'scripts', file), file === 'release-artifact.js' ? verifier(source) : source);
  }
  writeFileSync(join(dir, 'config/notis_app_boundary_rules.json'), '{}');
  writeFileSync(join(dir, 'bin/check-runtime.js'), '');
  writeFileSync(join(dir, 'bin/notis.js'), `if(process.env.GITHUB_TOKEN || process.env.NODE_AUTH_TOKEN)throw Error('Credential leak'); console.log(process.argv.includes('--version') ? '${pkg.version}' : 'fixture help');`);
  const result = spawnSync(process.execPath, [join(root, 'packages/cli/scripts/prepare-handoff.js')], { cwd: dir,
    encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: 'must-not-enter-native-smoke', NODE_AUTH_TOKEN: 'must-not-enter-native-smoke',
      NOTIS_HANDOFF_READ_ONLY: 'true', GITHUB_REPOSITORY: 'mindtheflo/notis', NOTIS_ORCHESTRATION_SHA: 'b'.repeat(40),
      GITHUB_RUN_ID: 'fixture-run', GITHUB_JOB: 'fixture', GITHUB_EVENT_NAME: 'api',
      // Reproduce a configured temp root inside an existing npm project.
      TMPDIR: join(dir, 'tmp'), TEMP: join(dir, 'tmp'), TMP: join(dir, 'tmp'),
      NPM_CONFIG_REGISTRY: 'http://127.0.0.1:1', NPM_CONFIG_CACHE: join(dir, 'npm-cache') } });
  return { dir, pkg, result };
}

test('native-branch: retains the exact native-smoked tgz without rebuilding/repacking', { timeout: 30_000 }, () => {
  const { dir, pkg, result } = prepareSource(nativeScript);
  try {
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'package.json'))), pkg,
      'the temporary install must not change its ancestor project');
    const manifest = JSON.parse(readFileSync(join(dir, 'handoff/handoff-manifest.json')));
    const tarball = readFileSync(join(dir, 'handoff/notis-cli.tgz'));
    verifyArtifact({ manifest, tarball, planBytes: readFileSync(join(dir, 'handoff/release-plan.json')) });
    assert.match(result.stdout, /smoke-package: OK/);
    assert.equal(manifest.builder.smoke, 'native-exact-tarball');
    assert.equal(manifest.builder.event, 'api');
    assert.throws(() => readFileSync(join(dir, `notis_ai-cli-${pkg.version}.tgz`)), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native-branch: refuses a source whose own verifier accepts only Depot provenance', { timeout: 30_000 }, () => {
  const depotOnly = source => {
    assert.match(source, /builder\?\.provider !== 'boat'/);
    return source.replace("builder?.provider !== 'boat'", "builder?.provider !== 'depot'");
  };
  const { dir, result } = prepareSource(nativeScript, { verifier: depotOnly });
  try {
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /own release verifier rejects the boat-built handoff/);
    assert.match(result.stderr, /Invalid CI build provenance/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
