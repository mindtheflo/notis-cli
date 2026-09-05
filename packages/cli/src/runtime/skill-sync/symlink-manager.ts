import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  AGENTS_DIR,
  LEGACY_AGENTS_SKILLS_DIR,
  NOTIS_SKILL_SYNC_ROOT,
  safeName,
} from './local-scanner';
import { normalizeAgentTargets, type AgentTargets, type SkillSyncFailure, type CloudSkill, type NotisSyncState } from './types';

const HOME_DIR = os.homedir();

const EXTERNAL_AGENT_SKILL_DIRS = {
  claude_code: path.join(HOME_DIR, '.claude', 'skills'),
  cursor: path.join(HOME_DIR, '.cursor', 'skills'),
  codex: path.join(HOME_DIR, '.codex', 'skills'),
} as const;

type ExternalAgent = keyof typeof EXTERNAL_AGENT_SKILL_DIRS;

const EXTERNAL_AGENTS = Object.keys(EXTERNAL_AGENT_SKILL_DIRS) as ExternalAgent[];

const AGENT_FAILURE_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  legacy: 'legacy ~/.agents/skills',
};

/** Failures are shown next to skill names in the Portal and CLI; never leak raw agent ids. */
function agentFailureLabel(agent: string): string {
  return AGENT_FAILURE_LABELS[agent] ?? agent;
}

function agentFolderFailureName(agent: string): string {
  return `${agentFailureLabel(agent)} skills folder`;
}

export interface DeletedAgentSymlink {
  skillId: string;
  skillName: string;
  agent: ExternalAgent;
}

type AgentSkillDirs = {
  notis: string;
} & typeof EXTERNAL_AGENT_SKILL_DIRS;

export interface SymlinkSyncOptions {
  agentSkillDirs?: Partial<AgentSkillDirs>;
  legacyGlobalSkillsDir?: string;
  removeUndesired?: boolean;
}

export interface RemoveSkillSymlinkOptions extends SymlinkSyncOptions {
  ownership?: 'any-managed' | 'exact-skill-dir';
}

export interface SymlinkSyncResult {
  linked: number;
  removed: number;
  skipped: number;
  verifiedAgentLinks?: Record<string, Partial<AgentTargets>>;
  failures?: SkillSyncFailure[];
}

/** Remove only links into another account's managed mirror. This is safe even
 * when automatic sync is disabled: it never changes either account mirror and
 * preserves links owned by the currently authenticated account. */
export async function removeForeignAccountSymlinks(
  skillsDir: string,
  options: SymlinkSyncOptions = {},
): Promise<number> {
  const agentSkillDirs = { ...defaultAgentSkillDirs(skillsDir), ...options.agentSkillDirs };
  const currentRoot = path.resolve(skillsDir);
  const foreignCapableRoots = [
    path.join(path.resolve(NOTIS_SKILL_SYNC_ROOT), 'users'),
    path.join(path.resolve(AGENTS_DIR), 'notis', 'users'),
    path.dirname(path.dirname(currentRoot)),
  ];
  let removed = 0;
  const legacyGlobalSkillsDir = options.legacyGlobalSkillsDir || LEGACY_AGENTS_SKILLS_DIR;
  for (const agentDir of new Set([...Object.values(agentSkillDirs), legacyGlobalSkillsDir])) {
    let entries;
    try {
      entries = await fs.readdir(agentDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const entryPath = path.join(agentDir, entry.name);
      try {
        const target = await fs.readlink(entryPath);
        const resolvedTarget = path.resolve(path.dirname(entryPath), target);
        const belongsToAnyAccount = foreignCapableRoots.some((root) => (
          resolvedTarget.startsWith(`${root}${path.sep}`)
        ));
        const belongsToCurrentAccount = resolvedTarget === currentRoot
          || resolvedTarget.startsWith(`${currentRoot}${path.sep}`);
        if (belongsToAnyAccount && !belongsToCurrentAccount) {
          await fs.unlink(entryPath);
          removed += 1;
        }
      } catch (error) {
        // A disappearing link is already safe. Permission and I/O failures
        // must fail closed: otherwise a previous account's link can remain
        // exposed while the repeating sync reports success.
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      }
    }
  }
  return removed;
}

function managedSkillRoots(
  skillsDir: string,
  legacyGlobalSkillsDir: string = LEGACY_AGENTS_SKILLS_DIR,
): string[] {
  const resolvedSkillsDir = path.resolve(skillsDir);
  const scopedUsersRoot = path.dirname(path.dirname(resolvedSkillsDir));
  const roots = [
    resolvedSkillsDir,
    path.resolve(legacyGlobalSkillsDir),
    path.join(path.resolve(NOTIS_SKILL_SYNC_ROOT), 'users'),
    path.join(path.resolve(AGENTS_DIR), 'notis', 'users'),
  ];
  if (path.basename(scopedUsersRoot) === 'users') {
    roots.push(scopedUsersRoot);
  }
  return roots;
}

async function isManagedSymlink(linkPath: string, managedRoots: string[]): Promise<boolean> {
  try {
    const stats = await fs.lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      return false;
    }

    const target = await fs.readlink(linkPath);
    const resolvedTarget = path.resolve(path.dirname(linkPath), target);
    return managedRoots.some((root) => (
      resolvedTarget === root || resolvedTarget.startsWith(`${root}${path.sep}`)
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureCorrectSymlink(linkPath: string, targetPath: string): Promise<'linked' | 'skipped' | 'blocked'> {
  try {
    const stats = await fs.lstat(linkPath);
    if (stats.isSymbolicLink()) {
      const currentTarget = await fs.readlink(linkPath);
      const resolvedTarget = path.resolve(path.dirname(linkPath), currentTarget);
      if (resolvedTarget === targetPath) {
        return 'skipped';
      }
      await fs.unlink(linkPath);
    } else {
      return 'blocked';
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }

  const relativePath = path.relative(path.dirname(linkPath), targetPath);
  await fs.symlink(relativePath, linkPath);
  return 'linked';
}

function defaultAgentSkillDirs(skillsDir: string): AgentSkillDirs {
  return {
    notis: skillsDir,
    ...EXTERNAL_AGENT_SKILL_DIRS,
  };
}

async function removeUndesiredManagedSymlinks(
  agentDir: string,
  desiredSkills: Set<string>,
  managedRoots: string[],
  failures: SkillSyncFailure[],
  agent: string,
): Promise<number> {
  let removed = 0;
  try {
    await fs.mkdir(agentDir, { recursive: true });
    const existingEntries = await fs.readdir(agentDir, { withFileTypes: true });
    for (const entry of existingEntries) {
      const entryPath = path.join(agentDir, entry.name);
      try {
        if (!desiredSkills.has(entry.name) && await isManagedSymlink(entryPath, managedRoots)) {
          await fs.unlink(entryPath);
          removed += 1;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          failures.push({ name: entry.name, error: `${agentFailureLabel(agent)}: could not remove skill link (${(error as Error).message})` });
        }
      }
    }
  } catch (error) {
    failures.push({ name: agentFolderFailureName(agent), error: `Could not read agent skills directory (${(error as Error).message})` });
  }
  return removed;
}

export async function removeAllSymlinksForSkill(
  skillName: string,
  skillsDir: string = LEGACY_AGENTS_SKILLS_DIR,
  options: RemoveSkillSymlinkOptions = {},
): Promise<number> {
  let removed = 0;
  const agentSkillDirs = { ...defaultAgentSkillDirs(skillsDir), ...options.agentSkillDirs };
  const legacyGlobalSkillsDir = options.legacyGlobalSkillsDir || LEGACY_AGENTS_SKILLS_DIR;
  const managedRoots = managedSkillRoots(skillsDir, legacyGlobalSkillsDir);
  const agentDirs = new Set([...Object.values(agentSkillDirs), legacyGlobalSkillsDir]);
  const expectedTarget = path.resolve(skillsDir, safeName(skillName, skillsDir));
  for (const agentDir of agentDirs) {
    const linkPath = path.join(agentDir, safeName(skillName, agentDir));
    const owned = options.ownership === 'exact-skill-dir'
      ? await isManagedSymlink(linkPath, [expectedTarget])
      : await isManagedSymlink(linkPath, managedRoots);
    if (owned) {
      await fs.unlink(linkPath);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Detect per-agent skill symlinks that we created on a prior sync but that the user has since
 * deleted locally (e.g. `rm ~/.claude/skills/<skill>`). The caller turns each result into a
 * per-agent deactivation so the deletion sticks instead of being recreated on the next pass.
 *
 * A pair is flagged only when the skill is cloud-active for that agent, the previous sync state
 * recorded it active for that agent (so we know we created the link), and the link is now truly
 * absent (lstat ENOENT). Stale/wrong-target links and real files blocking the path are NOT
 * deletions — those are repaired/skipped by syncSymlinks as before. Only external agents are
 * considered; `notis` has no symlink (its dir is the source skills folder).
 */
export async function detectDeletedAgentSymlinks(
  cloudSkills: CloudSkill[],
  previousState: NotisSyncState,
  skillsDir: string = LEGACY_AGENTS_SKILLS_DIR,
  options: SymlinkSyncOptions = {},
): Promise<DeletedAgentSymlink[]> {
  const agentSkillDirs = { ...defaultAgentSkillDirs(skillsDir), ...options.agentSkillDirs };
  const deletions: DeletedAgentSymlink[] = [];

  for (const agent of EXTERNAL_AGENTS) {
    const agentDir = agentSkillDirs[agent];
    if (path.resolve(agentDir) === path.resolve(skillsDir)) {
      continue;
    }

    // A missing (or non-directory) agent skills directory is NOT a per-skill deletion: removing
    // ~/.claude/skills wholesale would otherwise make every entry's link path ENOENT and
    // deactivate every skill for that agent. syncSymlinks recreates the directory and its links,
    // so only absent entries INSIDE an existing agent directory count as explicit user deletions.
    try {
      const dirStat = await fs.stat(agentDir);
      if (!dirStat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    for (const skill of cloudSkills) {
      if (skill.status !== 'active') {
        continue;
      }
      if (!skill.id || skill.id.startsWith('local-')) {
        continue;
      }
      const previous = previousState.skills[skill.name];
      if (!previous || previous.cloudId !== skill.id
        || previous.verifiedAgentLinks?.[agent] !== true
        || !skill.updated_at || previous.cloudUpdatedAt !== skill.updated_at) {
        continue;
      }

      const cloudTargets = normalizeAgentTargets(skill.agent_targets);
      const previousTargets = normalizeAgentTargets(previous.agentTargets);
      if (!cloudTargets[agent] || !previousTargets[agent]) {
        continue;
      }

      let safeSkillName: string;
      try {
        safeSkillName = safeName(skill.name, skillsDir);
      } catch {
        continue;
      }

      const linkPath = path.join(agentDir, safeName(safeSkillName, agentDir));
      try {
        await fs.lstat(linkPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
          deletions.push({ skillId: skill.id, skillName: skill.name, agent });
        }
      }
    }
  }

  return deletions;
}

export async function syncSymlinks(
  skills: CloudSkill[],
  skillsDir: string = LEGACY_AGENTS_SKILLS_DIR,
  options: SymlinkSyncOptions = {},
): Promise<SymlinkSyncResult> {
  await fs.mkdir(skillsDir, { recursive: true });

  const result: Required<SymlinkSyncResult> = {
    linked: 0,
    removed: 0,
    skipped: 0,
    verifiedAgentLinks: {},
    failures: [],
  };
  const agentSkillDirs = { ...defaultAgentSkillDirs(skillsDir), ...options.agentSkillDirs };
  const legacyGlobalSkillsDir = options.legacyGlobalSkillsDir || LEGACY_AGENTS_SKILLS_DIR;
  const managedRoots = managedSkillRoots(skillsDir, legacyGlobalSkillsDir);

  const desiredByAgent = {
    notis: new Set<string>(),
    claude_code: new Set<string>(),
    cursor: new Set<string>(),
    codex: new Set<string>(),
  };

  for (const skill of skills) {
    if (skill.status !== 'active') {
      continue;
    }

    const safeSkillName = safeName(skill.name, skillsDir);
    const targets = normalizeAgentTargets(skill.agent_targets);
    if (targets.notis) {
      desiredByAgent.notis.add(safeSkillName);
    }
    if (targets.claude_code) {
      desiredByAgent.claude_code.add(safeSkillName);
    }
    if (targets.cursor) {
      desiredByAgent.cursor.add(safeSkillName);
    }
    if (targets.codex) {
      desiredByAgent.codex.add(safeSkillName);
    }
  }

  for (const [agent, agentDir] of Object.entries(agentSkillDirs) as Array<[keyof AgentSkillDirs, string]>) {
    if (path.resolve(agentDir) === path.resolve(skillsDir)) {
      result.skipped += desiredByAgent[agent].size;
      continue;
    }

    try {
      await fs.mkdir(agentDir, { recursive: true });
    } catch (error) {
      result.failures.push({ name: agentFolderFailureName(agent), error: `Could not create agent skills directory (${(error as Error).message})` });
      continue;
    }

    const desiredSkills = desiredByAgent[agent];
    if (options.removeUndesired !== false) {
      result.removed += await removeUndesiredManagedSymlinks(agentDir, desiredSkills, managedRoots, result.failures, agent);
    }

    for (const skillName of desiredSkills) {
      const targetPath = path.join(skillsDir, skillName);
      const linkPath = path.join(agentDir, safeName(skillName, agentDir));
      try {
        if (!(await fs.stat(path.join(targetPath, "SKILL.md"))).isFile()) throw new Error("Missing SKILL.md");
      } catch {
        result.skipped += 1;
        result.failures.push({ name: skillName, error: `${agentFailureLabel(agent)}: SKILL.md is missing or unreadable` });
        continue;
      }
      let syncOutcome;
      try {
        syncOutcome = await ensureCorrectSymlink(linkPath, targetPath);
      } catch (error) {
        result.skipped += 1;
        result.failures.push({ name: skillName, error: `${agentFailureLabel(agent)}: could not create skill link (${(error as Error).message})` });
        continue;
      }
      if (syncOutcome === 'linked') {
        result.linked += 1;
      } else if (syncOutcome === 'blocked') {
        console.warn(
          `[skill-sync] Could not link "${skillName}" for ${agent}: non-symlink entry blocks ${linkPath}`,
        );
        result.skipped += 1;
        result.failures.push({ name: skillName, error: `${agentFailureLabel(agent)}: an existing file or folder blocks the skill link` });
      } else {
        result.skipped += 1;
      }
      if (syncOutcome !== "blocked") {
        result.verifiedAgentLinks[skillName] = { ...result.verifiedAgentLinks[skillName], [agent]: true };
      }
    }
  }

  if (
    options.removeUndesired !== false
    && !Object.values(agentSkillDirs).some(
      (agentDir) => path.resolve(agentDir) === path.resolve(legacyGlobalSkillsDir),
    )
  ) {
    result.removed += await removeUndesiredManagedSymlinks(
      legacyGlobalSkillsDir,
      new Set(),
      managedRoots,
      result.failures,
      'legacy',
    );
  }

  return result;
}
