import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { baseSkillStamp, stageBaseSkills } from '../scripts/base-skill-stamps.js';
import {
  BASE_SKILL_NAMES,
  BASE_SKILL_STAMP_FILE,
  readBaseSkillStamp,
  reconcileBaseSkills,
} from '../src/runtime/base-skills.js';

const T1 = 1_760_000_000;

// Keep the developer's own git settings (signing, hooks, untracked-file
// display) out of these throwaway repositories.
const isolation = await mkdtemp(join(tmpdir(), 'notis-stamp-gitconfig-'));
writeFileSync(join(isolation, 'gitconfig'), '');
process.env.GIT_CONFIG_GLOBAL = join(isolation, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
test.after(() => rm(isolation, { recursive: true, force: true }));

function git(repo, args, time = T1) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Notis Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Notis Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_AUTHOR_DATE: `@${time} +0000`,
      GIT_COMMITTER_DATE: `@${time} +0000`,
    },
  }).trim();
}

function writeSkill(repo, name, body) {
  mkdirSync(join(repo, 'server', 'skills', name), { recursive: true });
  writeFileSync(join(repo, 'server', 'skills', name, 'SKILL.md'), body);
}

function commitAll(repo, message, time) {
  git(repo, ['add', '-A'], time);
  git(repo, ['commit', '-q', '-m', message], time);
  return git(repo, ['rev-parse', 'HEAD'], time);
}

async function repository(t) {
  const repo = await mkdtemp(join(tmpdir(), 'notis-stamp-repo-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  git(repo, ['init', '-q', '-b', 'main']);
  for (const name of BASE_SKILL_NAMES) writeSkill(repo, name, `# ${name}\nv1\n`);
  writeFileSync(join(repo, 'README.md'), 'repo\n');
  const first = commitAll(repo, 'Add the base skills', T1);
  return { repo, first };
}

test('stamps each base skill with the time of the newest commit that changed it', async (t) => {
  const { repo, first } = await repository(t);
  writeSkill(repo, 'notis-query', '# notis-query\nv2\n');
  const second = commitAll(repo, 'Change notis-query', T1 + 100);
  writeFileSync(join(repo, 'README.md'), 'unrelated\n');
  commitAll(repo, 'Unrelated change', T1 + 200);

  assert.deepEqual(baseSkillStamp({ repoRoot: repo, name: 'notis-apps' }), { schema: 1, stamp: T1, commit: first });
  assert.deepEqual(
    baseSkillStamp({ repoRoot: repo, name: 'notis-query' }),
    { schema: 1, stamp: T1 + 100, commit: second },
  );
});

test('a merge that brings new skill text counts as newer than the change it carries', async (t) => {
  const { repo } = await repository(t);
  git(repo, ['checkout', '-q', '-b', 'beta']);
  writeSkill(repo, 'notis-cli', '# notis-cli\nv2\n');
  const change = commitAll(repo, 'Change notis-cli on beta', T1 + 100);
  git(repo, ['checkout', '-q', 'main']);
  writeFileSync(join(repo, 'README.md'), 'hotfix\n');
  commitAll(repo, 'Hotfix on main', T1 + 200);
  git(repo, ['merge', '-q', '--no-ff', '-m', 'Promote beta', 'beta'], T1 + 300);
  const promotion = git(repo, ['rev-parse', 'HEAD']);

  // Plain `git log -1` follows the beta side and reports the older change.
  assert.equal(git(repo, ['log', '-1', '--format=%H', '--', 'server/skills/notis-cli']), change);
  assert.deepEqual(
    baseSkillStamp({ repoRoot: repo, name: 'notis-cli' }),
    { schema: 1, stamp: T1 + 300, commit: promotion },
  );
  assert.equal(baseSkillStamp({ repoRoot: repo, name: 'notis-apps' }).stamp, T1);
});

test('a skill folder with uncommitted edits is stamped with the build time', async (t) => {
  const { repo } = await repository(t);
  writeFileSync(join(repo, 'server', 'skills', 'notis-apps', 'draft.md'), 'not committed\n');
  writeSkill(repo, 'notis-cli', '# notis-cli\nedited\n');
  const now = (T1 + 5_000) * 1000 + 999;

  assert.deepEqual(baseSkillStamp({ repoRoot: repo, name: 'notis-apps', now }), { schema: 1, stamp: T1 + 5_000, commit: null });
  assert.deepEqual(baseSkillStamp({ repoRoot: repo, name: 'notis-cli', now }), { schema: 1, stamp: T1 + 5_000, commit: null });
  assert.equal(baseSkillStamp({ repoRoot: repo, name: 'notis-query', now }).stamp, T1);
});

test('refuses a shallow checkout, whose history would hide newer commits', async (t) => {
  const { repo } = await repository(t);
  writeSkill(repo, 'notis-query', '# notis-query\nv2\n');
  commitAll(repo, 'Change notis-query', T1 + 100);
  const shallow = `${repo}-shallow`;
  t.after(() => rm(shallow, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(repo).href, shallow]);

  assert.throws(() => baseSkillStamp({ repoRoot: shallow, name: 'notis-apps' }), /fetch-depth: 0/);
});

test('refuses a source folder without git history', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'notis-stamp-plain-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  writeSkill(folder, 'notis-apps', '# notis-apps\n');

  assert.throws(
    () => baseSkillStamp({ repoRoot: folder, name: 'notis-apps' }),
    /build from a git checkout/,
  );
});

test('stages the three base skills with their stamp files and clears old copies', async (t) => {
  const { repo, first } = await repository(t);
  mkdirSync(join(repo, 'server', 'skills', 'notis-cli', 'references'));
  writeFileSync(join(repo, 'server', 'skills', 'notis-cli', 'references', 'guide.md'), 'guide\n');
  const second = commitAll(repo, 'Add a notis-cli reference', T1 + 100);
  const target = join(repo, 'out', 'base-skills');
  mkdirSync(join(target, 'notis-retired'), { recursive: true });

  const stamps = stageBaseSkills({ repoRoot: repo, targetRoot: target });

  assert.deepEqual(Object.keys(stamps), [...BASE_SKILL_NAMES]);
  assert.equal(existsSync(join(target, 'notis-retired')), false);
  assert.equal(readFileSync(join(target, 'notis-cli', 'references', 'guide.md'), 'utf8'), 'guide\n');
  assert.deepEqual(
    JSON.parse(readFileSync(join(target, 'notis-cli', BASE_SKILL_STAMP_FILE), 'utf8')),
    { schema: 1, stamp: T1 + 100, commit: second },
  );
  assert.equal(readBaseSkillStamp(join(target, 'notis-apps')), T1);
  assert.equal(stamps['notis-apps'].commit, first);
});

test('an older build reconciled after a newer one keeps the newer skill', async (t) => {
  const { repo } = await repository(t);
  const older = join(repo, 'out', 'older');
  stageBaseSkills({ repoRoot: repo, targetRoot: older });
  writeSkill(repo, 'notis-query', '# notis-query\nv2\n');
  commitAll(repo, 'Change notis-query', T1 + 100);
  const newer = join(repo, 'out', 'newer');
  stageBaseSkills({ repoRoot: repo, targetRoot: newer });
  const home = join(repo, 'out', 'home');

  assert.equal(reconcileBaseSkills({ home, sourceRoot: newer, now: 1 }).installed, 3);
  const result = reconcileBaseSkills({ home, sourceRoot: older, now: 2 });

  assert.equal(result.installed, 0);
  assert.equal(result.kept, 1);
  assert.equal(
    readFileSync(join(home, '.notis', 'skills', 'base', 'notis-query', 'SKILL.md'), 'utf8'),
    '# notis-query\nv2\n',
  );
});
