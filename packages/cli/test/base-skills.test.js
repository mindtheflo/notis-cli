import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  BASE_SKILL_NAMES,
  getBaseSkillPaths,
  reconcileBaseSkills,
} from '../src/runtime/base-skills.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'notis-base-skills-'));
  const home = join(root, 'home');
  const sourceRoot = join(root, 'source');
  for (const name of BASE_SKILL_NAMES) {
    mkdirSync(join(sourceRoot, name), { recursive: true });
    writeFileSync(join(sourceRoot, name, 'SKILL.md'), `---\nname: ${name}\n---\nv1\n`);
  }
  return { root, home, sourceRoot };
}

test('reconciles all three base skills into every agent and user mirror', async (t) => {
  const { root, home, sourceRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = reconcileBaseSkills({ home, sourceRoot, userId: 'user-123', now: 1 });
  assert.deepEqual(result.skills, ['notis-apps', 'notis-query', 'notis-cli']);
  assert.equal(result.installed, 3);
  assert.equal(result.linked, 15);

  const paths = getBaseSkillPaths({ home, userId: 'user-123' });
  for (const name of BASE_SKILL_NAMES) {
    assert.match(readFileSync(join(paths.baseRoot, name, 'SKILL.md'), 'utf8'), /v1/);
    for (const targetRoot of paths.targetRoots) {
      assert.equal(
        resolve(targetRoot, readlinkSync(join(targetRoot, name))),
        join(paths.baseRoot, name),
      );
    }
  }
});

test('updates managed contents and preserves a conflicting real skill as a backup', async (t) => {
  const { root, home, sourceRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const conflict = join(home, '.codex', 'skills', 'notis-query');
  mkdirSync(conflict, { recursive: true });
  writeFileSync(join(conflict, 'mine.txt'), 'keep me');

  const first = reconcileBaseSkills({ home, sourceRoot, now: 7 });
  assert.equal(first.backups.length, 1);
  assert.equal(readFileSync(join(first.backups[0], 'mine.txt'), 'utf8'), 'keep me');

  writeFileSync(join(sourceRoot, 'notis-query', 'SKILL.md'), 'v2\n');
  const second = reconcileBaseSkills({ home, sourceRoot, now: 8 });
  assert.equal(readFileSync(join(home, '.notis', 'skills', 'base', 'notis-query', 'SKILL.md'), 'utf8'), 'v2\n');
  assert.equal(second.unchanged, 12);
});

test('preserves a conflicting user-owned symlink as a backup', async (t) => {
  const { root, home, sourceRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const personalSkill = join(root, 'personal-notis-cli');
  mkdirSync(personalSkill, { recursive: true });
  writeFileSync(join(personalSkill, 'SKILL.md'), '# Personal CLI\n');
  const conflict = join(home, '.codex', 'skills', 'notis-cli');
  mkdirSync(join(home, '.codex', 'skills'), { recursive: true });
  symlinkSync(personalSkill, conflict);

  const result = reconcileBaseSkills({ home, sourceRoot, now: 9 });

  const backup = result.backups.find((candidate) => candidate.endsWith('.codex_skills/notis-cli'));
  assert.ok(backup);
  assert.equal(resolve(join(backup, '..'), readlinkSync(backup)), personalSkill);
  assert.equal(
    resolve(join(conflict, '..'), readlinkSync(conflict)),
    join(home, '.notis', 'skills', 'base', 'notis-cli'),
  );
});
