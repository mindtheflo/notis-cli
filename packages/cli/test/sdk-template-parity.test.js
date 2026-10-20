import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { legacySdkFiles } from '../scripts/build-legacy-sdk.js';
import { collectProjectBoundaryViolations, collectProjectDesignViolations } from '../src/runtime/app-boundary-validator.js';
import { lockRecordsManifest } from '../src/runtime/app-platform.js';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '../..');
const canonicalSdkRoot = join(repoRoot, 'packages', 'sdk');
const templateSdkRoot = join(cliRoot, 'dist', 'sdk');
const canonicalSdkAvailable = existsSync(canonicalSdkRoot);
const monorepoOnly = canonicalSdkAvailable
  ? false
  : 'canonical SDK is not included in the standalone notis-cli mirror';

function listFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = join(current, entry.name);
      return entry.isDirectory() ? listFiles(root, absolute) : [relative(root, absolute)];
    })
    .sort();
}

test('the app scaffold ships the canonical SDK source legacy apps use, without the Spaces toolkit', { skip: monorepoOnly }, () => {
  const expected = legacySdkFiles(canonicalSdkRoot).files.map(file => file.slice('src/'.length));
  const templateFiles = listFiles(join(templateSdkRoot, 'src'));
  assert.deepEqual(templateFiles, expected, 'SDK source files drifted; rebuild the CLI artifact from packages/sdk/src.');
  for (const file of templateFiles) {
    assert.equal(
      readFileSync(join(templateSdkRoot, 'src', file), 'utf8'),
      readFileSync(join(canonicalSdkRoot, 'src', file), 'utf8'),
      `SDK scaffold copy drifted at ${file}.`,
    );
  }
  for (const file of ['ui/toolkit.css', 'ui/index.ts', 'words/index.ts']) {
    assert.ok(!templateFiles.includes(file), `Legacy apps never vendor the Spaces toolkit (${file}).`);
  }
  assert.ok(!templateFiles.some(file => /\.test\.tsx?$/.test(file)), 'Legacy apps never vendor SDK tests.');
});

test('the app scaffold SDK package exports only the legacy entries and their dependencies', { skip: monorepoOnly }, () => {
  const template = JSON.parse(readFileSync(join(templateSdkRoot, 'package.json'), 'utf8'));
  const canonical = JSON.parse(readFileSync(join(canonicalSdkRoot, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(template.exports).sort(), ['.', './config', './interactions', './styles.css', './ui', './vite']);
  assert.equal(template.exports['./ui'], './src/ui.ts');
  for (const [subpath, target] of Object.entries(template.exports)) {
    assert.ok(existsSync(join(templateSdkRoot, target)), `${subpath} points at a shipped file`);
    if (subpath !== './ui') assert.deepEqual(target, canonical.exports[subpath]);
  }
  assert.equal(template.version, canonical.version);
  assert.deepEqual(template.peerDependencies, canonical.peerDependencies);
  for (const [name, range] of Object.entries(template.dependencies)) assert.equal(range, canonical.dependencies[name]);
  assert.deepEqual(Object.keys(template.dependencies).sort(), [...legacySdkFiles(canonicalSdkRoot).packages]
    .filter(name => Object.hasOwn(canonical.dependencies, name)).sort());
});

test('the vendored legacy SDK passes the unchanged app boundary and design validators', { skip: monorepoOnly }, (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-legacy-sdk-'));
  t.after(() => rmSync(projectDir, { recursive: true, force: true }));
  for (const file of listFiles(templateSdkRoot)) {
    mkdirSync(dirname(join(projectDir, 'packages/sdk', file)), { recursive: true });
    writeFileSync(join(projectDir, 'packages/sdk', file), readFileSync(join(templateSdkRoot, file)));
  }
  assert.deepEqual(collectProjectBoundaryViolations(projectDir), []);
  assert.deepEqual(collectProjectDesignViolations(projectDir), []);
});

test('the scaffold lockfile installs both SDK copies, and a new Space never rewrites it', { skip: existsSync(join(cliRoot, 'dist', 'space-sdk', 'package.json')) ? false : 'build the CLI first' }, () => {
  const lock = JSON.parse(readFileSync(join(cliRoot, 'template', 'package-lock.json'), 'utf8'));
  const space = JSON.parse(readFileSync(join(cliRoot, 'dist', 'space-sdk', 'package.json'), 'utf8'));
  // `spaces init` mirrors the Space SDK; a matching record means its sync never runs npm.
  assert.ok(lockRecordsManifest(lock.packages['packages/sdk'], space),
    'template/package-lock.json must record dist/space-sdk/package.json as packages/sdk. Regenerate it with '
    + '`npm install --package-lock-only` over a packages/sdk manifest holding both copies\' dependencies, then record the Space SDK fields.');
  // `apps init` shares the lock with the legacy copy, so `npm ci` needs every package either copy declares.
  const legacy = JSON.parse(readFileSync(join(templateSdkRoot, 'package.json'), 'utf8'));
  for (const [name, range] of Object.entries({ ...space.dependencies, ...legacy.dependencies, ...legacy.devDependencies })) {
    const entry = lock.packages[`packages/sdk/node_modules/${name}`] || lock.packages[`node_modules/${name}`];
    assert.ok(entry, `${name} is missing from the scaffold lock`);
    if (range.startsWith('^')) assert.equal(entry.version.split('.')[0], range.slice(1).split('.')[0], `${name}@${range}`);
  }
});
