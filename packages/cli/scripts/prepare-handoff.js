import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_NAMES, createArtifactManifest } from './release-artifact.js';

// Keep the native branch's build/smoke implementation unchanged. Its npm-pack
// invocation is transparently retained before the native smoke deletes it, so
// the handoff contains the exact bytes that native smoke installed and booted.
const { GITHUB_TOKEN: _token, NODE_AUTH_TOKEN: _npmToken, NPM_TOKEN: _oldToken, ...env } = process.env;
const realNpm = execFileSync('which', ['npm'], { encoding: 'utf8', env }).trim();
const shim = mkdtempSync(join(tmpdir(), 'notis-cli-pack-capture-'));
mkdirSync('handoff', { recursive: true });
try {
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'retain-npm-pack.cjs'), join(shim, 'npm'));
  chmodSync(join(shim, 'npm'), 0o700);
  execFileSync(process.execPath, ['./scripts/smoke-package.js'], { stdio: 'inherit', env: { ...env,
    PATH: `${shim}:${env.PATH}`, NOTIS_REAL_NPM: realNpm, NOTIS_PACK_SOURCE_DIR: process.cwd(),
    NOTIS_RETAINED_TARBALL: resolve('handoff', ARTIFACT_NAMES.tarball) } });
} finally { rmSync(shim, { recursive: true, force: true }); }
const tarball = readFileSync(resolve('handoff', ARTIFACT_NAMES.tarball));
const planBytes = readFileSync('release-plan.json');
const manifest = createArtifactManifest({ tarball, planBytes, readOnly: env.NOTIS_HANDOFF_READ_ONLY === 'true',
  builder: { provider: 'depot', repository: env.GITHUB_REPOSITORY, workflow: '.depot/workflows/publish-cli-package.yml',
    orchestrationSha: env.NOTIS_ORCHESTRATION_SHA, runId: env.GITHUB_RUN_ID, jobId: env.GITHUB_JOB,
    event: env.GITHUB_EVENT_NAME, smoke: 'native-exact-tarball' } });
writeFileSync(resolve('handoff', ARTIFACT_NAMES.plan), planBytes);
writeFileSync(resolve('handoff', ARTIFACT_NAMES.manifest), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ phase: 'artifact_prepared', ...manifest }));
