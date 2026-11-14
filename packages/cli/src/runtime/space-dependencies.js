/**
 * A Space workspace builds with its own packages (TypeScript, Vite, Tailwind, React, the SDK). A folder that
 * has never been installed (a copy, a fresh clone, a scaffold) gets them on its first `notis spaces build`:
 * `npm ci` from its lock file, `--prefer-offline` so every package this machine has already downloaded for
 * another Space comes from npm's shared cache instead of the network. A workspace that is already installed
 * is never touched.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { usageError } from './errors.js';
import { npmFailureReason } from './app-platform.js';

const INSTALL_TIMEOUT_MS = 10 * 60_000;
// --include=dev: a build needs the devDependencies (TypeScript, Vite, Tailwind) even under NODE_ENV=production or omit=dev.
const INSTALL_FLAGS = Object.freeze(['--include=dev', '--prefer-offline', '--no-audit', '--no-fund']);

/**
 * True when the package a build loads first resolves from this workspace, the way the build resolves it:
 * from its own node_modules or an ancestor's (an npm workspace member installed at the root).
 */
export function spaceDependenciesInstalled(projectDir) {
  const require = createRequire(join(projectDir, 'package.json'));
  try { require.resolve('typescript/package.json'); return true; } catch { return false; }
}

function runNpm(args, projectDir) {
  // A verbose npm config can print more than spawnSync's 1 MB default before it finishes.
  return spawnSync('npm', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    timeout: INSTALL_TIMEOUT_MS, shell: process.platform === 'win32' });
}

/**
 * Install this workspace's packages when it has none yet. Returns what it did, for the build answer:
 * `null` when nothing was needed, else `{ command, seconds }`.
 */
export function ensureSpaceDependencies(projectDir, { log = () => {}, run = runNpm } = {}) {
  if (!existsSync(join(projectDir, 'package.json')) || spaceDependenciesInstalled(projectDir)) return null;
  const locked = existsSync(join(projectDir, 'package-lock.json'));
  let args = [locked ? 'ci' : 'install', ...INSTALL_FLAGS];
  let command = `npm ${args.join(' ')}`;
  log(`This Space folder has no installed packages yet: running ${command} once (packages this machine already has come from npm's cache).`);
  const started = Date.now();
  let result = run(args, projectDir);
  if (locked && result.status !== 0 && !result.error && /in sync/i.test(`${result.stderr || ''}\n${result.stdout || ''}`)) {
    // package.json gained a package its lock file does not hold yet: npm install records it instead of refusing.
    args = ['install', ...INSTALL_FLAGS];
    command = `npm ${args.join(' ')}`;
    log(`package-lock.json does not match package.json yet: running ${command} instead.`);
    result = run(args, projectDir);
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  if (result.error || result.status !== 0) {
    const reason = result.error?.code === 'ETIMEDOUT' ? 'it did not finish within 10 minutes'
      : result.error?.code === 'ENOENT' ? 'npm is not installed on this machine'
        : npmFailureReason(`${result.stderr || ''}\n${result.stdout || ''}`) || `npm exited with code ${result.status}`;
    throw usageError(`Installing this Space's packages failed (${command}: ${reason}). Nothing was built. `
      + `Fix that, or run ${command} in ${projectDir} yourself, then build again.`);
  }
  if (!spaceDependenciesInstalled(projectDir)) {
    throw usageError(`${command} finished but TypeScript is still missing from this Space's packages. Add typescript to its devDependencies, then build again.`);
  }
  log(`Installed this Space's packages in ${seconds} s.`);
  return { command, seconds };
}
