import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE_SKILL_NAMES = Object.freeze([
  'notis-apps',
  'notis-query',
  'notis-cli',
]);

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

function backupConflict(linkPath, backupRoot, targetLabel, skillName, now) {
  const backupPath = join(backupRoot, String(now), targetLabel, skillName);
  mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
  renameSync(linkPath, backupPath);
  return backupPath;
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
    replaceDirectory(source, join(paths.baseRoot, name));
    result.installed += 1;
  }

  for (const targetRoot of paths.targetRoots) {
    mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
    const targetLabel = relative(home, targetRoot).replaceAll('/', '_') || 'home';
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
