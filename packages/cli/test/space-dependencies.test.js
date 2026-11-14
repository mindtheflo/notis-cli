import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ensureSpaceDependencies, spaceDependenciesInstalled } from '../src/runtime/space-dependencies.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TYPESCRIPT = join(repo, 'packages/sdk/node_modules/typescript');

function workspace({ lock = true, installed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-deps-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'space-deps-fixture', private: true, devDependencies: { typescript: '*' } }));
  if (lock) writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'space-deps-fixture', lockfileVersion: 3, packages: {} }));
  if (installed) install(root);
  return root;
}

/** What a successful npm run leaves behind: this workspace's TypeScript. */
function install(root) {
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(TYPESCRIPT, join(root, 'node_modules/typescript'), 'dir');
}

function recorder(outcomes) {
  const calls = [];
  const run = (args, cwd) => {
    calls.push(args.join(' '));
    const outcome = outcomes.shift() || { status: 0 };
    if (outcome.status === 0 && !outcome.error && !outcome.leaveEmpty) install(cwd);
    return { stdout: '', stderr: '', ...outcome };
  };
  return { calls, run };
}

test('a Space folder that already has its packages is never reinstalled', () => {
  const root = workspace({ installed: true });
  try {
    const { calls, run } = recorder([]);
    assert.equal(spaceDependenciesInstalled(root), true);
    assert.equal(ensureSpaceDependencies(root, { run }), null);
    assert.deepEqual(calls, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the first build of a folder with no packages installs them once from its lock file, preferring npm\'s cache', () => {
  const root = workspace();
  try {
    const { calls, run } = recorder([{ status: 0 }]);
    const lines = [];
    assert.equal(spaceDependenciesInstalled(root), false);
    const installed = ensureSpaceDependencies(root, { run, log: line => lines.push(line) });
    assert.deepEqual(calls, ['ci --include=dev --prefer-offline --no-audit --no-fund']);
    assert.equal(installed.command, 'npm ci --include=dev --prefer-offline --no-audit --no-fund');
    assert.equal(typeof installed.seconds, 'number');
    assert.match(lines[0], /no installed packages yet: running npm ci --include=dev --prefer-offline --no-audit --no-fund once/);
    assert.match(lines.at(-1), /^Installed this Space's packages in /);
    assert.equal(spaceDependenciesInstalled(root), true);
    assert.equal(ensureSpaceDependencies(root, { run }), null, 'the next build installs nothing');
    assert.equal(calls.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a folder without a lock file, or whose lock is behind package.json, installs with npm install', () => {
  const unlocked = workspace({ lock: false });
  const behind = workspace();
  try {
    const first = recorder([{ status: 0 }]);
    assert.equal(ensureSpaceDependencies(unlocked, { run: first.run }).command, 'npm install --include=dev --prefer-offline --no-audit --no-fund');
    assert.deepEqual(first.calls, ['install --include=dev --prefer-offline --no-audit --no-fund']);

    const second = recorder([{ status: 1, stderr: 'npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.' },
      { status: 0 }]);
    const lines = [];
    assert.equal(ensureSpaceDependencies(behind, { run: second.run, log: line => lines.push(line) }).command,
      'npm install --include=dev --prefer-offline --no-audit --no-fund');
    assert.deepEqual(second.calls, ['ci --include=dev --prefer-offline --no-audit --no-fund', 'install --include=dev --prefer-offline --no-audit --no-fund']);
    assert.ok(lines.some(line => /does not match package.json yet: running npm install/.test(line)));
  } finally {
    rmSync(unlocked, { recursive: true, force: true });
    rmSync(behind, { recursive: true, force: true });
  }
});

test('a failed install names npm\'s reason, says nothing was built and what to run', () => {
  const failures = [
    [{ status: 1, stderr: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@notis%2fmissing' }, /404 Not Found/],
    [{ status: null, error: Object.assign(new Error('spawnSync npm ETIMEDOUT'), { code: 'ETIMEDOUT' }) }, /did not finish within 10 minutes/],
    [{ status: null, error: Object.assign(new Error('spawnSync npm ENOENT'), { code: 'ENOENT' }) }, /npm is not installed on this machine/],
  ];
  for (const [outcome, reason] of failures) {
    const root = workspace();
    try {
      const { run } = recorder([outcome]);
      assert.throws(() => ensureSpaceDependencies(root, { run }), error => {
        assert.equal(error.code, 'usage_error');
        assert.match(error.message, /^Installing this Space's packages failed \(npm ci --include=dev --prefer-offline --no-audit --no-fund: /);
        assert.match(error.message, reason);
        assert.match(error.message, /Nothing was built\. .*run npm ci --include=dev --prefer-offline --no-audit --no-fund in .* yourself, then build again\./);
        return true;
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('an install that leaves TypeScript out says what to add instead of failing later', () => {
  const root = workspace();
  try {
    const { run } = recorder([{ status: 0, leaveEmpty: true }]);
    assert.throws(() => ensureSpaceDependencies(root, { run }), /TypeScript is still missing.*Add typescript to its devDependencies/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a folder with no package.json is left to the build to explain', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-deps-'));
  try {
    const { calls, run } = recorder([]);
    assert.equal(ensureSpaceDependencies(root, { run }), null);
    assert.deepEqual(calls, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a Space folder inside an npm workspace installed at its root is already installed', () => {
  const root = workspace({ installed: true });
  try {
    const member = join(root, 'spaces-member');
    mkdirSync(member);
    writeFileSync(join(member, 'package.json'), JSON.stringify({ name: 'member', private: true }));
    const { calls, run } = recorder([]);
    assert.equal(spaceDependenciesInstalled(member), true);
    assert.equal(ensureSpaceDependencies(member, { run }), null);
    assert.deepEqual(calls, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
