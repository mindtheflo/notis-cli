#!/usr/bin/env node
// Pack the CLI exactly as it will be published, install the resulting tarball
// into a clean temp dir OUTSIDE the repo (no monorepo `server/` sibling -- the
// real end-user layout), and boot it. This is the last gate before `npm publish`
// and catches the failure modes that shipped 0.2.2 broken on npm `latest` for
// seven weeks:
//   - a runtime file missing from the tarball (config/ -> import-time ENOENT
//     boot crash on every command)
//   - a `--version` that no longer matches package.json (stale hardcoded string)
//   - anything that throws on a plain `notis --help` from a fresh install.
//
// Run locally with `npm run smoke`; run in CI before publishing.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf-8'));
const packageName = manifest.name;
const expectedVersion = manifest.version;

// npm flattens the scope for the tarball name: @notis_ai/cli -> notis_ai-cli.
const tarball = `${packageName.replace('@', '').replace('/', '-')}-${expectedVersion}.tgz`;
const tarballPath = join(cliRoot, tarball);

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', ...opts });
}

function fail(message) {
  process.stderr.write(`smoke-package: FAIL - ${message}\n`);
  process.exit(1);
}

// 1) Build, then pack with scripts disabled so the tarball is deterministic and
//    stdout stays clean (the build already ran). `npm pack` writes the tgz into
//    cliRoot.
run('npm', ['run', 'build'], { cwd: cliRoot, stdio: 'inherit' });
run('npm', ['pack', '--ignore-scripts', '--silent'], { cwd: cliRoot });
if (!existsSync(tarballPath)) {
  fail(`npm pack did not produce ${tarball}`);
}

const sandbox = mkdtempSync(join(tmpdir(), 'notis-cli-smoke-'));
try {
  // 2) Install the tarball in isolation (pulls commander etc. too).
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', tarballPath], { cwd: sandbox });
  const installedRoot = join(sandbox, 'node_modules', ...packageName.split('/'));

  // 3) Runtime files that MUST ship (their absence caused the 0.2.2 boot crash).
  for (const rel of ['bin/notis.js', 'config/notis_app_boundary_rules.json']) {
    if (!existsSync(join(installedRoot, rel))) {
      fail(`published package is missing ${rel} (add it to package.json "files")`);
    }
  }

  const binPath = join(installedRoot, 'bin', 'notis.js');

  // 4) `--version` must boot AND equal the manifest version (no hardcoded drift).
  const version = run(process.execPath, [binPath, '--version'], { cwd: sandbox }).trim();
  if (version !== expectedVersion) {
    fail(`--version printed "${version}" but package.json is "${expectedVersion}"`);
  }

  // 5) `--help` must boot without throwing. This imports the full command graph
  //    (incl. app-boundary-validator), so an import-time crash surfaces here.
  run(process.execPath, [binPath, '--help'], { cwd: sandbox });

  process.stdout.write(`smoke-package: OK - installed and booted ${packageName}@${version} from a fresh tarball\n`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(tarballPath, { force: true });
}
