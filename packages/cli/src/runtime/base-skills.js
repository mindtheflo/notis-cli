import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE_SKILL_NAMES = Object.freeze([
  'notis-spaces',
  'notis-query',
  'notis-cli',
]);
// Earlier CLIs linked these names. Only links this installer created are retired.
export const RETIRED_BASE_SKILL_NAMES = Object.freeze(['notis-apps', 'notis-reports']);

/**
 * The npm package and Desktop build write this file into each skill folder
 * they ship: `stamp` is the commit time (Unix seconds) of the newest commit
 * that changed the skill. A source checkout has none.
 */
export const BASE_SKILL_STAMP_FILE = '.notis-base-skill.json';

const HERE = dirname(fileURLToPath(import.meta.url));

export function resolveBundledBaseSkillsRoot({ resourcesPath = process.resourcesPath } = {}) {
  const sourceCheckout = resolve(HERE, '../../../../server/skills');
  const packaged = resolve(HERE, '../../dist/base-skills');
  const desktopResource = resourcesPath ? join(resourcesPath, 'base-skills') : null;
  // Electron Packager copies each extraResource directory under its basename,
  // so the three skill folders sit directly in process.resourcesPath.
  const desktopPackagerRoot = resourcesPath || null;
  for (const candidate of [sourceCheckout, packaged, desktopResource, desktopPackagerRoot]) {
    if (
      candidate
      && BASE_SKILL_NAMES.every((name) => existsSync(join(candidate, name, 'SKILL.md')))
    ) {
      return candidate;
    }
  }
  return packaged;
}

export function getBaseSkillPaths({ home = homedir(), userId = null } = {}) {
  const notisRoot = join(home, '.notis', 'skills');
  const targetRoots = [
    join(home, '.agents', 'skills'),
    join(home, '.codex', 'skills'),
    join(home, '.cursor', 'skills'),
    join(home, '.claude', 'skills'),
  ];
  if (userId) {
    targetRoots.push(join(notisRoot, 'users', userId, 'skills'));
  }
  return {
    baseRoot: join(notisRoot, 'base'),
    backupRoot: join(notisRoot, 'backups'),
    targetRoots,
  };
}

function sameLinkTarget(linkPath, expectedTarget) {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return false;
    return resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(expectedTarget);
  } catch {
    return false;
  }
}

/** True only for a link into this installer's base copy of `name`. */
export function isBaseSkillLink(linkPath, name, { home = homedir() } = {}) {
  return sameLinkTarget(linkPath, join(getBaseSkillPaths({ home }).baseRoot, name));
}

function backupConflict(linkPath, backupRoot, targetLabel, skillName, now) {
  const backupPath = join(backupRoot, String(now), targetLabel, skillName);
  mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
  renameSync(linkPath, backupPath);
  return backupPath;
}

/** The version stamp of one skill folder, or null when it has none. */
export function readBaseSkillStamp(skillDir) {
  try {
    const { stamp } = JSON.parse(readFileSync(join(skillDir, BASE_SKILL_STAMP_FILE), 'utf8'));
    return Number.isSafeInteger(stamp) && stamp > 0 ? stamp : null;
  } catch {
    return null;
  }
}

function byName(left, right) {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

/** Digest of a skill folder's files, leaving out its version stamp. */
function contentDigest(root) {
  const hash = createHash('sha256');
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(byName)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(directory, entry.name);
      if (path === BASE_SKILL_STAMP_FILE) continue;
      if (entry.isDirectory()) {
        hash.update(`dir\0${path}\0`);
        walk(full, path);
      } else if (entry.isSymbolicLink()) {
        hash.update(`link\0${path}\0${readlinkSync(full)}\0`);
      } else {
        const bytes = readFileSync(full);
        hash.update(`file\0${path}\0${bytes.length}\0`);
        hash.update(bytes);
      }
    }
  };
  walk(root, '');
  return hash.digest('hex');
}

/**
 * Newest wins. Desktop and the CLI both run this with the copy they ship, so
 * a copy replaces the installed one only when it is newer, or when both are
 * the same version and the installed files changed since. A source checkout
 * has no stamp and replaces the installed copy whenever their files differ.
 */
function baseSkillAction(source, destination) {
  if (!existsSync(join(destination, 'SKILL.md'))) return 'install';
  const bundled = readBaseSkillStamp(source);
  const installed = readBaseSkillStamp(destination);
  if (bundled !== null && installed !== null && installed > bundled) return 'keep';
  if (bundled !== null && (installed === null || installed < bundled)) return 'install';
  return contentDigest(source) === contentDigest(destination) ? 'current' : 'install';
}

function replaceDirectory(source, destination) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const previous = `${destination}.previous-${process.pid}-${Date.now()}`;
  rmSync(temporary, { recursive: true, force: true });
  cpSync(source, temporary, { recursive: true });
  let movedPrevious = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, previous);
      movedPrevious = true;
    }
    renameSync(temporary, destination);
    if (movedPrevious) rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    if (movedPrevious && !existsSync(destination) && existsSync(previous)) {
      renameSync(previous, destination);
    }
    throw error;
  }
}

/**
 * Install the three CLI-owned system skills and expose them to every supported
 * local agent. This intentionally does not consult the account sync setting:
 * that setting controls only Electron's repeating account-skill refresh.
 */
export function reconcileBaseSkills({
  home = homedir(),
  userId = null,
  sourceRoot = resolveBundledBaseSkillsRoot(),
  now = Date.now(),
} = {}) {
  const paths = getBaseSkillPaths({ home, userId });
  const result = {
    installed: 0,
    kept: 0,
    linked: 0,
    unchanged: 0,
    backups: [],
    skills: [...BASE_SKILL_NAMES],
  };

  for (const name of BASE_SKILL_NAMES) {
    const source = join(sourceRoot, name);
    if (!existsSync(join(source, 'SKILL.md'))) {
      throw new Error(`Bundled base skill is missing: ${name}`);
    }
    const destination = join(paths.baseRoot, name);
    let action;
    try {
      action = baseSkillAction(source, destination);
    } catch {
      // An unreadable installed copy is repaired, as before stamps existed.
      action = 'install';
    }
    if (action === 'install') {
      replaceDirectory(source, destination);
      result.installed += 1;
    } else if (action === 'keep') {
      result.kept += 1;
    }
  }

  for (const targetRoot of paths.targetRoots) {
    mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
    const targetLabel = relative(home, targetRoot).replaceAll('/', '_') || 'home';
    // Retire only links this installer owns. A personal skill with an old
    // product name remains untouched; name alone is never deletion authority.
    for (const retired of RETIRED_BASE_SKILL_NAMES) {
      const oldLink = join(targetRoot, retired);
      if (sameLinkTarget(oldLink, join(paths.baseRoot, retired))) unlinkSync(oldLink);
    }
    for (const name of BASE_SKILL_NAMES) {
      const skillTarget = join(paths.baseRoot, name);
      const linkPath = join(targetRoot, name);
      if (sameLinkTarget(linkPath, skillTarget)) {
        result.unchanged += 1;
        continue;
      }
      if (existsSync(linkPath) || (() => {
        try { lstatSync(linkPath); return true; } catch { return false; }
      })()) {
        // sameLinkTarget already accepted links owned by this installer. Every
        // other path, including a user-created symlink, is a conflict whose
        // identity and target must remain recoverable.
        result.backups.push(backupConflict(linkPath, paths.backupRoot, targetLabel, name, now));
      }
      const relativeTarget = relative(targetRoot, skillTarget) || '.';
      symlinkSync(
        process.platform === 'win32' ? skillTarget : relativeTarget,
        linkPath,
        process.platform === 'win32' ? 'junction' : undefined,
      );
      result.linked += 1;
    }
  }

  // Keep the old managed bytes recoverable, outside every agent's skill scan.
  for (const retired of RETIRED_BASE_SKILL_NAMES) {
    const oldRoot = join(paths.baseRoot, retired);
    if (existsSync(oldRoot)) result.backups.push(backupConflict(oldRoot, paths.backupRoot, 'base', retired, now));
  }

  return result;
}

export function reconcileBaseSkillsBestEffort(options = {}) {
  try {
    return reconcileBaseSkills(options);
  } catch (error) {
    if (process.env.NOTIS_DEBUG_BASE_SKILLS === '1') {
      process.stderr.write(`[notis] Base skill reconciliation failed: ${error.message}\n`);
    }
    return null;
  }
}
