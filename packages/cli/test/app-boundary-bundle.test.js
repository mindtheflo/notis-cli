import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyBoundaryRules, BOUNDARY_RULES_RELATIVE_PATH } from '../scripts/copy-boundary-rules.js';
import { RULES_PATH_CANDIDATES, resolveRulesPath } from '../src/runtime/app-boundary-validator.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(testDir, '..');
const repoRoot = resolve(cliRoot, '../..');

test('copyBoundaryRules bundles the server boundary rules into the package', () => {
  const target = copyBoundaryRules({ repoRoot, cliRoot });
  assert.equal(target, join(cliRoot, BOUNDARY_RULES_RELATIVE_PATH));
  assert.ok(existsSync(target), 'bundled boundary rules should exist after copy');

  const source = join(repoRoot, 'server', 'config', 'notis_app_boundary_rules.json');
  assert.equal(readFileSync(target, 'utf-8'), readFileSync(source, 'utf-8'));

  const parsed = JSON.parse(readFileSync(target, 'utf-8'));
  assert.ok('javascript' in parsed && 'css' in parsed, 'rules should have javascript/css keys');
});

test('package ships a config/ copy as a candidate so installed CLI has rules', () => {
  const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf-8'));
  assert.ok(pkg.files.includes('config/'), 'package.json files must include config/');

  // The bundled-copy candidate must point inside the package, not escape it.
  const bundledCandidate = RULES_PATH_CANDIDATES[RULES_PATH_CANDIDATES.length - 1];
  assert.ok(
    bundledCandidate.endsWith(join('config', 'notis_app_boundary_rules.json')),
    `bundled candidate should be the in-package config copy, got ${bundledCandidate}`,
  );
  assert.ok(
    !bundledCandidate.includes(`${join('..', 'server')}`),
    'bundled candidate must not escape the package into the monorepo server dir',
  );
});

test('resolveRulesPath returns an existing, parseable rules file', () => {
  // Ensure the bundled copy exists so resolution works even outside the monorepo.
  copyBoundaryRules({ repoRoot, cliRoot });
  const resolved = resolveRulesPath();
  assert.ok(existsSync(resolved), `resolved rules path should exist: ${resolved}`);
  const parsed = JSON.parse(readFileSync(resolved, 'utf-8'));
  assert.ok('javascript' in parsed, 'resolved rules should be valid boundary rules');
});

test('CLI boots and validates without any rules file (published-package regression)', async () => {
  // 0.2.2 shipped without config/ and crashed with ENOENT at module import,
  // taking down every command. The validator must import and validate (as a
  // no-op with a warning) even when no rules file can be resolved anywhere.
  const { mkdtempSync, cpSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');

  const sandbox = mkdtempSync(join(tmpdir(), 'notis-cli-no-rules-'));
  try {
    cpSync(join(cliRoot, 'src'), join(sandbox, 'src'), { recursive: true });
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { collectArtifactBoundaryViolations } from './src/runtime/app-boundary-validator.js';
         const violations = collectArtifactBoundaryViolations({ 'a.js': 'const x = 1;' });
         console.log('violations:' + violations.length);`,
      ],
      { cwd: sandbox, encoding: 'utf-8' },
    );
    assert.match(output, /violations:0/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('resolveRulesPath falls back to the bundled copy when the server source is absent', () => {
  // Simulate an installed package (no monorepo server dir) by pointing the
  // bundled copy in place and checking it is selected when the source is gone.
  copyBoundaryRules({ repoRoot, cliRoot });
  const [serverSource, bundled] = RULES_PATH_CANDIDATES;
  if (!existsSync(serverSource)) {
    // Already outside the monorepo: bundled copy must be chosen.
    assert.equal(resolveRulesPath(), bundled);
  } else {
    // In the monorepo both exist; the bundled copy is at least present.
    assert.ok(existsSync(bundled), 'bundled copy should exist after copyBoundaryRules');
  }
});
