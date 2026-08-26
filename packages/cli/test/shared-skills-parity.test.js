// Base skills have one editable source under server/skills. The CLI build copies
// that source into dist/base-skills for the npm tarball; packages/cli/skills may
// contain generated CLI reference docs, but never another editable SKILL.md.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BASE_SKILL_NAMES } from '../src/runtime/base-skills.js';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '../..');

test('every bundled base SKILL.md is copied verbatim from server/skills', () => {
  for (const name of BASE_SKILL_NAMES) {
    const source = readFileSync(join(repoRoot, 'server', 'skills', name, 'SKILL.md'), 'utf-8');
    const bundled = readFileSync(join(cliRoot, 'dist', 'base-skills', name, 'SKILL.md'), 'utf-8');
    assert.equal(
      bundled,
      source,
      `${name}/SKILL.md drifted. Edit server/skills/${name}/SKILL.md and run \`npm run build\`.`,
    );
  }
});

test('base skills have no editable package-side SKILL.md duplicates', () => {
  for (const name of BASE_SKILL_NAMES) {
    assert.equal(
      existsSync(join(cliRoot, 'skills', name, 'SKILL.md')),
      false,
      `${name} gained a package-side SKILL.md; edit server/skills/${name}/SKILL.md instead`,
    );
    assert.ok(existsSync(join(repoRoot, 'server', 'skills', name, 'SKILL.md')));
  }
});
