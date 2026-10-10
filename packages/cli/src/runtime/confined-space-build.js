/**
 * Pinned first build of one Space for a confined local effect
 * (server/lib/confined_effects/space_build.py).
 *
 *   node confined-space-build.js <build-request.json>
 *
 * The backend starts this file from a hashed, read-only toolchain under the macOS
 * sandbox (no network). It reuses the canonical selected-source freeze, manifest,
 * V4 checks and build receipt (buildSpaceArtifact) and replaces only the build
 * runner: the canonical Vite command runs with this same node executable and a
 * rebuilt environment, never PATH npm, a package script or the caller's
 * environment. It never refreshes the SDK or installs anything.
 */
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSpaceArtifact } from './space-platform.js';

const CANONICAL_BUILD_SCRIPTS = new Set(['vite build', 'vite build --configLoader runner']);
const OUTPUT_LIMIT = 32 * 1024;

export function pinnedBuildEnvironment(environment = process.env) {
  return { PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'), HOME: environment.HOME || '',
    TMPDIR: environment.TMPDIR || '', LANG: 'C', LC_ALL: 'C', NODE_ENV: 'production' };
}

export function pinnedViteCommand(projectDir, executable = process.execPath) {
  const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
  const script = String(pkg.scripts?.build || '').trim();
  if (!CANONICAL_BUILD_SCRIPTS.has(script)) throw new Error('Only the canonical vite build script can run in a confined build.');
  const vite = realpathSync(join(projectDir, 'node_modules', 'vite', 'bin', 'vite.js'));
  return [executable, vite, 'build', '--configLoader', 'runner'];
}

/** buildArtifact runBuild seam: the canonical build, pinned, with bounded captured output. */
export function runPinnedVite({ projectDir }) {
  const [command, ...args] = pinnedViteCommand(projectDir);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: projectDir, env: pinnedBuildEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => { if (output.length < OUTPUT_LIMIT) output += chunk.toString().slice(0, OUTPUT_LIMIT - output.length); });
    }
    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`vite build failed (${signal || code})${output.trim() ? `:\n${output.trim()}` : ''}`));
    });
  });
}

export async function runConfinedBuild(request) {
  if (!request || typeof request.projectDir !== 'string' || typeof request.key !== 'string') {
    throw new Error('The build request names one workspace and one Space key.');
  }
  const result = await buildSpaceArtifact(request.projectDir, request.key, { stdio: 'pipe', refreshSdk: false, runBuild: runPinnedVite });
  // A summary only: the backend grades the saved build receipt bytes, not this line.
  const { local_key, kind, name, spec_version } = result.manifest || {};
  return { status: 'built', key: request.key, receipt_path: result.receiptPath, source_hash: result.sourceHash,
    manifest: { local_key, kind, name, spec_version } };
}

async function main(argv) {
  const request = JSON.parse(readFileSync(argv[2], 'utf8'));
  try {
    process.stdout.write(JSON.stringify(await runConfinedBuild(request)) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'failed', error: String(error?.message || error).slice(0, OUTPUT_LIMIT) }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main(process.argv);
