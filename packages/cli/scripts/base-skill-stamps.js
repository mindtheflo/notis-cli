import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BASE_SKILL_NAMES, BASE_SKILL_STAMP_FILE } from '../src/runtime/base-skills.js';

/**
 * Names a JSON file of precomputed stamps, `{ "schema": 1, "stamps": { name: stamp } }`.
 * Only the ship gate sets it, for the boat test fork it builds on: that checkout
 * has no .git, so the gate computes each stamp from its own history by the rule
 * below. Release workflows never set it.
 */
export const BASE_SKILL_STAMPS_FILE_ENV = 'NOTIS_BASE_SKILL_STAMPS_FILE';

function isStamp(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && value.schema === 1
    && Number.isSafeInteger(value.stamp) && value.stamp > 0
    && (value.commit === null || (typeof value.commit === 'string' && /^[0-9a-f]{40,64}$/.test(value.commit)));
}

function stampFromFile(file, name) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${BASE_SKILL_STAMPS_FILE_ENV} names ${file}, which is not readable JSON: ${error.message}`);
  }
  if (!data || data.schema !== 1 || !data.stamps || typeof data.stamps !== 'object' || Array.isArray(data.stamps)) {
    throw new Error(`${BASE_SKILL_STAMPS_FILE_ENV} file ${file} is not { "schema": 1, "stamps": { ... } }`);
  }
  const stamp = Object.hasOwn(data.stamps, name) ? data.stamps[name] : undefined;
  if (stamp === undefined) throw new Error(`${BASE_SKILL_STAMPS_FILE_ENV} file ${file} has no stamp for ${name}`);
  if (!isStamp(stamp)) {
    throw new Error(`${BASE_SKILL_STAMPS_FILE_ENV} file ${file} has an invalid stamp for ${name}: ${JSON.stringify(stamp)}`);
  }
  return { schema: 1, stamp: stamp.stamp, commit: stamp.commit };
}

/**
 * The version of one base skill: the commit time of the newest commit that
 * changed its folder. Merges count too, so a branch's stamp only moves forward
 * and a promotion that brings new skill text is newer than what it replaced.
 * A folder with uncommitted edits is stamped with the build time instead.
 * With NOTIS_BASE_SKILL_STAMPS_FILE set, the stamp comes from that file.
 */
export function baseSkillStamp({ repoRoot, name, now = Date.now(), env = process.env }) {
  if (env[BASE_SKILL_STAMPS_FILE_ENV]) return stampFromFile(env[BASE_SKILL_STAMPS_FILE_ENV], name);
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
export function stageBaseSkills({ repoRoot, targetRoot, now = Date.now(), env = process.env }) {
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });
  const stamps = {};
  for (const name of BASE_SKILL_NAMES) {
    const source = join(repoRoot, 'server', 'skills', name);
    if (!existsSync(join(source, 'SKILL.md'))) {
      throw new Error(`Base skill source not found at ${source}`);
    }
    stamps[name] = baseSkillStamp({ repoRoot, name, now, env });
    cpSync(source, join(targetRoot, name), { recursive: true });
    writeFileSync(join(targetRoot, name, BASE_SKILL_STAMP_FILE), `${JSON.stringify(stamps[name])}\n`);
  }
  return stamps;
}
