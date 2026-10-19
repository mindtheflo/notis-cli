import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BASE_SKILL_NAMES, BASE_SKILL_STAMP_FILE } from '../src/runtime/base-skills.js';

/**
 * The version of one base skill: the commit time of the newest commit that
 * changed its folder. Merges count too, so a branch's stamp only moves forward
 * and a promotion that brings new skill text is newer than what it replaced.
 * A folder with uncommitted edits is stamped with the build time instead.
 */
export function baseSkillStamp({ repoRoot, name, now = Date.now() }) {
  const folder = `server/skills/${name}`;
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  let shallow;
  try {
    shallow = git('rev-parse', '--is-shallow-repository');
  } catch (error) {
    throw new Error(`Base skill stamps read the git history, so build from a git checkout: ${error.message}`);
  }
  if (shallow === 'true') {
    throw new Error('Base skill stamps read the whole git history; check out with fetch-depth: 0.');
  }
  if (git('status', '--porcelain', '--untracked-files=all', '--', folder)) {
    return { schema: 1, stamp: Math.floor(now / 1000), commit: null };
  }
  let newest = null;
  for (const line of git('log', '--full-history', '--format=%ct %H', '--', folder).split('\n')) {
    const [time, commit] = line.split(' ');
    const stamp = Number(time);
    if (Number.isSafeInteger(stamp) && commit && (!newest || stamp > newest.stamp)) {
      newest = { schema: 1, stamp, commit };
    }
  }
  if (!newest) throw new Error(`No commit has changed ${folder}`);
  return newest;
}

/** Copy the three base skills into targetRoot, each with its version stamp. */
export function stageBaseSkills({ repoRoot, targetRoot, now = Date.now() }) {
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });
  const stamps = {};
  for (const name of BASE_SKILL_NAMES) {
    const source = join(repoRoot, 'server', 'skills', name);
    if (!existsSync(join(source, 'SKILL.md'))) {
      throw new Error(`Base skill source not found at ${source}`);
    }
    stamps[name] = baseSkillStamp({ repoRoot, name, now });
    cpSync(source, join(targetRoot, name), { recursive: true });
    writeFileSync(join(targetRoot, name, BASE_SKILL_STAMP_FILE), `${JSON.stringify(stamps[name])}\n`);
  }
  return stamps;
}
