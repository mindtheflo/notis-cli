import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyDesignRules, DESIGN_RULES_RELATIVE_PATH } from '../scripts/copy-boundary-rules.js';
import { DESIGN_RULES_PATH_CANDIDATES, resolveDesignRulesPath } from '../src/runtime/app-boundary-validator.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(testDir, '..');
const repoRoot = resolve(cliRoot, '../..');

test('copyDesignRules bundles the server design rules into the package', () => {
  const target = copyDesignRules({ repoRoot, cliRoot });
  assert.equal(target, join(cliRoot, DESIGN_RULES_RELATIVE_PATH));
  assert.ok(existsSync(target));
  const source = join(repoRoot, 'server', 'config', 'notis_app_design_rules.json');
  assert.equal(readFileSync(target, 'utf-8'), readFileSync(source, 'utf-8'));
  assert.ok(Array.isArray(JSON.parse(readFileSync(target, 'utf-8')).rules));
});

test('the bundled design rules candidate stays inside the package', () => {
  const bundledCandidate = DESIGN_RULES_PATH_CANDIDATES[DESIGN_RULES_PATH_CANDIDATES.length - 1];
  assert.ok(bundledCandidate.endsWith(join('config', 'notis_app_design_rules.json')));
  assert.ok(!bundledCandidate.includes(join('..', 'server')));
  copyDesignRules({ repoRoot, cliRoot });
  assert.ok(existsSync(resolveDesignRulesPath()));
});
