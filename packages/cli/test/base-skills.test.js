import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  BASE_SKILL_NAMES,
  BASE_SKILL_STAMP_FILE,
  getBaseSkillPaths,
  readBaseSkillStamp,
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

test('base skill materialization preserves task references byte-for-byte', async (t) => {
  const { root, home, sourceRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const text = '# Query reference\n\nPreserve pagination and schema rules.\n';
  mkdirSync(join(sourceRoot, 'notis-query', 'references'));
  writeFileSync(join(sourceRoot, 'notis-query', 'references', 'query.md'), text);
  reconcileBaseSkills({ home, sourceRoot, userId: 'user-123', now: 1 });
  const paths = getBaseSkillPaths({ home, userId: 'user-123' });
  for (const target of paths.targetRoots) {
    assert.equal(readFileSync(join(target, 'notis-query', 'references', 'query.md'), 'utf8'), text);
  }
});

// Newest wins: Desktop and the CLI each reconcile with the copy they ship.
function stampAll(sourceRoot, stamp, body) {
  for (const name of BASE_SKILL_NAMES) {
    if (body) writeFileSync(join(sourceRoot, name, 'SKILL.md'), body);
    writeFileSync(
      join(sourceRoot, name, BASE_SKILL_STAMP_FILE),
      `${JSON.stringify({ schema: 1, stamp, commit: `commit-${stamp}` })}\n`,
    );
  }
}

function copySource(root, label, stamp, body) {
  const sourceRoot = join(root, label);
  for (const name of BASE_SKILL_NAMES) mkdirSync(join(sourceRoot, name), { recursive: true });
  stampAll(sourceRoot, stamp, body);
  return sourceRoot;
}

const installedSkill = (home, name) => join(home, '.notis', 'skills', 'base', name);

test('keeps an installed base skill that is newer than the shipped copy', async (t) => {
  const { root, home } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = copySource(root, 'cli', 200, 'v2 from the CLI\n');
  const desktop = copySource(root, 'desktop', 100, 'v1 from Desktop\n');

  assert.equal(reconcileBaseSkills({ home, sourceRoot: cli, now: 1 }).installed, 3);
  const older = reconcileBaseSkills({ home, sourceRoot: desktop, now: 2 });
  assert.equal(older.installed, 0);
  assert.equal(older.kept, 3);
  for (const name of BASE_SKILL_NAMES) {
    assert.equal(readFileSync(join(installedSkill(home, name), 'SKILL.md'), 'utf8'), 'v2 from the CLI\n');
    assert.equal(readBaseSkillStamp(installedSkill(home, name)), 200);
  }

  const updatedDesktop = copySource(root, 'desktop-next', 300, 'v3 from Desktop\n');
  const newer = reconcileBaseSkills({ home, sourceRoot: updatedDesktop, now: 3 });
  assert.equal(newer.installed, 3);
  assert.equal(newer.kept, 0);
  assert.equal(readFileSync(join(installedSkill(home, 'notis-cli'), 'SKILL.md'), 'utf8'), 'v3 from Desktop\n');
  assert.equal(readBaseSkillStamp(installedSkill(home, 'notis-cli')), 300);
});

test('replaces an installed base skill that has no version stamp', async (t) => {
  const { root, home, sourceRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  reconcileBaseSkills({ home, sourceRoot, now: 1 });
  assert.equal(readBaseSkillStamp(installedSkill(home, 'notis-apps')), null);

  stampAll(sourceRoot, 100);
  const stamped = reconcileBaseSkills({ home, sourceRoot, now: 2 });
  assert.equal(stamped.installed, 3);
  assert.equal(readBaseSkillStamp(installedSkill(home, 'notis-apps')), 100);

  const again = reconcileBaseSkills({ home, sourceRoot, now: 3 });
  assert.equal(again.installed, 0);
  assert.equal(again.kept, 0);
});

test('leaves an identical installed copy of the same version in place', async (t) => {
  const { root, home, sourceRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  stampAll(sourceRoot, 100);
  reconcileBaseSkills({ home, sourceRoot, now: 1 });
  const before = statSync(installedSkill(home, 'notis-query')).ino;

  const result = reconcileBaseSkills({ home, sourceRoot, now: 2 });
  assert.equal(result.installed, 0);
  assert.equal(result.kept, 0);
  assert.equal(statSync(installedSkill(home, 'notis-query')).ino, before);
});

test('repairs edits to an installed copy of the same version', async (t) => {
  const { root, home, sourceRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  stampAll(sourceRoot, 100);
  reconcileBaseSkills({ home, sourceRoot, now: 1 });
  writeFileSync(join(installedSkill(home, 'notis-query'), 'SKILL.md'), 'edited by hand\n');
  writeFileSync(join(installedSkill(home, 'notis-cli'), 'extra.md'), 'left behind\n');

  const result = reconcileBaseSkills({ home, sourceRoot, now: 2 });
  assert.equal(result.installed, 2);
  assert.match(readFileSync(join(installedSkill(home, 'notis-query'), 'SKILL.md'), 'utf8'), /v1/);
  assert.equal(existsSync(join(installedSkill(home, 'notis-cli'), 'extra.md')), false);
});

test('a source checkout without stamps writes only when the files differ', async (t) => {
  const { root, home, sourceRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const shipped = copySource(root, 'shipped', 500, '---\nname: shipped\n---\nv5\n');
  reconcileBaseSkills({ home, sourceRoot: shipped, now: 1 });

  const fromCheckout = reconcileBaseSkills({ home, sourceRoot, now: 2 });
  assert.equal(fromCheckout.installed, 3);
  assert.equal(readBaseSkillStamp(installedSkill(home, 'notis-apps')), null);

  const unchanged = reconcileBaseSkills({ home, sourceRoot, now: 3 });
  assert.equal(unchanged.installed, 0);
});

test('reads only whole positive version stamps', async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'stamp');
  mkdirSync(folder);
  assert.equal(readBaseSkillStamp(folder), null);
  for (const [raw, expected] of [
    ['{"schema":1,"stamp":1760000000,"commit":"abc"}', 1760000000],
    ['{"stamp":"1760000000"}', null],
    ['{"stamp":-5}', null],
    ['{"stamp":1.5}', null],
    ['not json', null],
  ]) {
    writeFileSync(join(folder, BASE_SKILL_STAMP_FILE), raw);
    assert.equal(readBaseSkillStamp(folder), expected, raw);
  }
});
