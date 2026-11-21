import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  AGENTS_DIR,
  LEGACY_AGENTS_SKILLS_DIR,
  NOTIS_SKILL_SYNC_ROOT,
  safeName,
} from './local-scanner';
import { isNativeSkill, nativeFrontmatterName } from './native-identity';
import {
  normalizeAgentTargets,
  type SkillSyncFailure,
  type CloudSkill,
  type NotisSyncState,
  type VerifiedAgentLinks,
} from './types';

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
  /** Per skill folder: `true` when an agent's link carries the folder name, or the
   * link name when a native skill is linked under its readable name. */
  verifiedAgentLinks?: Record<string, VerifiedAgentLinks>;
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

/** The skills the Notis CLI and Desktop install themselves (base-skills.js); a native skill never takes their link name. */
const BASE_SKILL_LINK_NAMES: ReadonlySet<string> = new Set(['notis-spaces', 'notis-query', 'notis-cli']);
const NATIVE_FOLDER_NAME = /^native-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** The Agent Skills name rule Claude Code, Cursor and Codex share: lowercase words joined by hyphens. */
const READABLE_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function isUnderManagedRoot(resolvedTarget: string, managedRoots: string[]): boolean {
  return managedRoots.some((root) => (
    resolvedTarget === root || resolvedTarget.startsWith(`${root}${path.sep}`)
  ));
}

async function isManagedSymlink(linkPath: string, managedRoots: string[]): Promise<boolean> {
  try {
    const stats = await fs.lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      return false;
    }

    const target = await fs.readlink(linkPath);
    const resolvedTarget = path.resolve(path.dirname(linkPath), target);
    return isUnderManagedRoot(resolvedTarget, managedRoots);
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
  movedTargets: ReadonlySet<string> = new Set(),
): Promise<number> {
  let removed = 0;
  try {
    await fs.mkdir(agentDir, { recursive: true });
    const existingEntries = await fs.readdir(agentDir, { withFileTypes: true });
    for (const entry of existingEntries) {
      const entryPath = path.join(agentDir, entry.name);
      try {
        if (!desiredSkills.has(entry.name) && await isManagedSymlink(entryPath, managedRoots)
            && !(movedTargets.size > 0 && movedTargets.has(path.resolve(agentDir, await fs.readlink(entryPath))))) {
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
    const linkName = safeName(skillName, agentDir);
    const linkPath = path.join(agentDir, linkName);
    const owned = options.ownership === 'exact-skill-dir'
      ? await isManagedSymlink(linkPath, [expectedTarget])
      : await isManagedSymlink(linkPath, managedRoots)
        && !(await linksToOtherSkillFolder(linkPath, expectedTarget, skillsDir));
    if (owned) {
      await fs.unlink(linkPath);
      removed += 1;
    }
    // A native skill's agent link carries its readable name, not its folder name:
    // remove every link in the agent folder that points at this exact skill folder.
    // A folder that cannot be listed keeps only that extra link; it never stops the
    // removal in the other folders or the sync that called it.
    if (path.resolve(agentDir) !== path.resolve(skillsDir)) {
      try {
        removed += await removeLinksToTarget(agentDir, expectedTarget, new Set([linkName]));
      } catch (error) {
        console.warn(`[skill-sync] Could not list ${agentDir} to remove the links to "${skillName}": ${(error as Error).message}`);
      }
    }
  }
  return removed;
}

/**
 * Whether `linkPath` points at another existing skill folder of this mirror: a
 * native skill's readable link (whatever folder it is bound to) can carry the
 * name of a removed legacy skill, and removing that skill must leave the native
 * skill's link alone. The sync never links a legacy folder under another name.
 */
async function linksToOtherSkillFolder(linkPath: string, expectedTarget: string, skillsDir: string): Promise<boolean> {
  try {
    const resolved = path.resolve(path.dirname(linkPath), await fs.readlink(linkPath));
    if (resolved === expectedTarget || path.dirname(resolved) !== path.resolve(skillsDir)) return false;
    return (await fs.stat(resolved)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Whether any symlink in `agentDir` resolves exactly to `targetPath`. A folder
 * that cannot be read answers true: an unknown state is never a deletion.
 */
async function hasLinkToTarget(agentDir: string, targetPath: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(agentDir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    try {
      if (path.resolve(agentDir, await fs.readlink(path.join(agentDir, entry.name))) === targetPath) return true;
    } catch {
      // A link that vanished is not a link to this skill.
    }
  }
  return false;
}

/** The names of the symlinks in `agentDir` that resolve to each of `targets`. */
async function linkNamesByTarget(agentDir: string, targets: ReadonlySet<string>): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  let entries;
  try {
    entries = await fs.readdir(agentDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return names;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    try {
      const resolved = path.resolve(agentDir, await fs.readlink(path.join(agentDir, entry.name)));
      if (targets.has(resolved)) names.set(resolved, [...(names.get(resolved) ?? []), entry.name]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }
  return names;
}

/** Unlink each named entry of `agentDir` that is still a symlink to `targetPath`. */
async function unlinkIfTarget(agentDir: string, names: readonly string[], targetPath: string): Promise<number> {
  let removed = 0;
  for (const name of names) {
    const entryPath = path.join(agentDir, name);
    try {
      if ((await fs.lstat(entryPath)).isSymbolicLink()
          && path.resolve(agentDir, await fs.readlink(entryPath)) === targetPath) {
        await fs.unlink(entryPath);
        removed += 1;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

/**
 * Remove the symlinks in `agentDir` that resolve exactly to `targetPath`, except
 * `keepNames`, compared case-insensitively: on macOS a differently cased entry is
 * the kept link itself.
 */
async function removeLinksToTarget(
  agentDir: string,
  targetPath: string,
  keepNames: ReadonlySet<string>,
): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(agentDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    throw error;
  }
  const keep = new Set([...keepNames].map((name) => name.toLowerCase()));
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isSymbolicLink() || keep.has(entry.name.toLowerCase())) continue;
    const entryPath = path.join(agentDir, entry.name);
    try {
      const resolved = path.resolve(agentDir, await fs.readlink(entryPath));
      if (resolved !== targetPath) continue;
      await fs.unlink(entryPath);
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

/**
 * The readable name a native skill is linked under in the external agent folders,
 * or null when it keeps its `native-<id>` folder name. The on-disk SKILL.md
 * frontmatter `name` wins because it is what the agents show; the pulled
 * instructions and the display name are fallbacks for a folder not written yet.
 */
export async function readableNativeLinkName(
  skill: CloudSkill,
  folderName: string,
  skillsDir: string,
): Promise<string | null> {
  if (!isNativeSkill(skill)) return null;
  let markdown = '';
  try {
    markdown = await fs.readFile(path.join(skillsDir, folderName, 'SKILL.md'), 'utf8');
  } catch {
    // Unreadable instructions are reported by the link pass itself.
  }
  const name = [nativeFrontmatterName(markdown), nativeFrontmatterName(skill.skill_md || ''), skill.display_name || '']
    .map((value) => value.trim())
    .find(Boolean);
  // The name rule already rules out separators, dots and spaces.
  if (!name || name === folderName || name.length > 64 || !READABLE_SKILL_NAME.test(name)
      || NATIVE_FOLDER_NAME.test(name) || BASE_SKILL_LINK_NAMES.has(name)) {
    return null;
  }
  return name;
}

/**
 * Whether a native skill may take `linkName` in an agent folder: the path is free,
 * already links to this skill, or (when the pass owns the whole folder) holds a
 * managed link the pass would replace anyway. A real file or folder, or a link the
 * sync does not manage, keeps the skill on its folder name.
 */
async function readableLinkAvailable(
  linkPath: string,
  targetPath: string,
  managedRoots: string[],
  ownsWholeFolder: boolean,
): Promise<boolean> {
  let stats;
  try {
    stats = await fs.lstat(linkPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
  }
  if (!stats.isSymbolicLink()) return false;
  try {
    const resolved = path.resolve(path.dirname(linkPath), await fs.readlink(linkPath));
    if (resolved === path.resolve(targetPath)) return true;
    return ownsWholeFolder && isUnderManagedRoot(resolved, managedRoots);
  } catch {
    return false;
  }
}

interface AgentLinkCandidate {
  folderName: string;
  readableName: string | null;
}

/**
 * Choose each skill's link name in one external agent folder. Legacy skills keep
 * their folder name. A native skill takes its readable name unless that name is
 * another desired link name in this folder (a legacy skill, or a second native
 * skill with the same name: both then keep `native-<id>`), or an entry the sync
 * does not manage blocks it. Names compare case-insensitively for macOS folders.
 */
async function planAgentLinkNames(
  candidates: AgentLinkCandidate[],
  agentDir: string,
  skillsDir: string,
  managedRoots: string[],
  ownsWholeFolder: boolean,
): Promise<Map<string, string>> {
  // A skill that falls back to its folder name (a legacy skill, or a native skill
  // whose readable name is unusable) keeps it: a readable name equal to such a
  // folder name is reserved, until no fallback and readable name collide.
  const reserved = new Set(
    candidates.filter((candidate) => !candidate.readableName).map((candidate) => candidate.folderName.toLowerCase()),
  );
  const readableCounts = new Map<string, number>();
  for (const { readableName } of candidates) {
    if (!readableName) continue;
    const key = readableName.toLowerCase();
    readableCounts.set(key, (readableCounts.get(key) ?? 0) + 1);
  }
  const available = new Map<string, boolean>();
  for (;;) {
    const plan = new Map<string, string>();
    const owners = new Map<string, number>();
    for (const { folderName, readableName } of candidates) {
      let linkName = folderName;
      if (readableName) {
        const key = readableName.toLowerCase();
        if (!reserved.has(key) && readableCounts.get(key) === 1) {
          if (!available.has(folderName)) {
            available.set(folderName, await readableLinkAvailable(
              path.join(agentDir, readableName), path.join(skillsDir, folderName), managedRoots, ownsWholeFolder,
            ));
          }
          if (available.get(folderName)) linkName = readableName;
        }
      }
      plan.set(linkName, folderName);
      owners.set(linkName.toLowerCase(), (owners.get(linkName.toLowerCase()) ?? 0) + 1);
    }
    // Only a readable name can newly collide; two folder names that differ only in
    // case are distinct entries on a case-sensitive disk and stay as they are.
    const collisions = [...owners].filter(([name, count]) => count > 1 && !reserved.has(name)).map(([name]) => name);
    if (collisions.length === 0) return plan;
    for (const name of collisions) reserved.add(name);
  }
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
      // The link is looked up under the name the previous sync verified it with:
      // `true` is the folder name, a string is a native skill's readable link name.
      // Evidence recorded under the old `native-<id>` name therefore still finds that
      // link during the move to the readable name, and is never read as a deletion.
      const verified = previous?.verifiedAgentLinks?.[agent];
      if (!previous || previous.cloudId !== skill.id || !verified
        || !skill.updated_at || previous.cloudUpdatedAt !== skill.updated_at) {
        continue;
      }

      const cloudTargets = normalizeAgentTargets(skill.agent_targets);
      const previousTargets = normalizeAgentTargets(previous.agentTargets);
      if (!cloudTargets[agent] || !previousTargets[agent]) {
        continue;
      }

      let linkName: string;
      let folderName: string;
      try {
        folderName = safeName(skill.name, skillsDir);
        linkName = safeName(typeof verified === 'string' ? verified : folderName, agentDir);
      } catch {
        continue;
      }

      const linkPath = path.join(agentDir, linkName);
      try {
        await fs.lstat(linkPath);
      } catch (error) {
        // A move between the folder name and the readable name that stopped
        // half-way leaves the skill linked under its other name: not a deletion.
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT'
            && !(await hasLinkToTarget(agentDir, path.resolve(skillsDir, folderName)))) {
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

  const ownsWholeFolder = options.removeUndesired !== false;
  // Per agent: skill folder name -> the row it came from (the first active row wins).
  const desiredByAgent: Record<keyof AgentSkillDirs, Map<string, CloudSkill>> = {
    notis: new Map(),
    claude_code: new Map(),
    cursor: new Map(),
    codex: new Map(),
  };

  for (const skill of skills) {
    if (skill.status !== 'active') {
      continue;
    }

    const safeSkillName = safeName(skill.name, skillsDir);
    const targets = normalizeAgentTargets(skill.agent_targets);
    for (const agent of Object.keys(desiredByAgent) as Array<keyof AgentSkillDirs>) {
      if (targets[agent] && !desiredByAgent[agent].has(safeSkillName)) {
        desiredByAgent[agent].set(safeSkillName, skill);
      }
    }
  }

  const readableNames = new Map<string, string | null>();
  for (const [folderName, skill] of [
    ...desiredByAgent.claude_code, ...desiredByAgent.cursor, ...desiredByAgent.codex,
  ]) {
    if (!readableNames.has(folderName)) {
      readableNames.set(folderName, await readableNativeLinkName(skill, folderName, skillsDir));
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

    // Only Claude Code, Cursor and Codex read a native skill under its readable
    // name; the Notis folder is the mirror itself and keeps `native-<id>`.
    const external = (EXTERNAL_AGENTS as readonly string[]).includes(agent);
    const linkPlan = await planAgentLinkNames(
      [...desiredByAgent[agent].keys()].map((folderName) => ({
        folderName,
        readableName: external ? readableNames.get(folderName) ?? null : null,
      })),
      agentDir,
      skillsDir,
      managedRoots,
      ownsWholeFolder,
    );

    // A native skill's old link stays until its new link exists (removed below), so
    // a pass that stops half-way leaves it linked and never reads as a deletion.
    const movedTargets = new Set(external
      ? [...linkPlan.values()].filter((name) => isNativeSkill(desiredByAgent[agent].get(name)!))
        .map((name) => path.resolve(skillsDir, name))
      : []);
    if (ownsWholeFolder) {
      result.removed += await removeUndesiredManagedSymlinks(
        agentDir, new Set(linkPlan.keys()), managedRoots, result.failures, agent, movedTargets,
      );
    }
    // One read of the folder: the link names each moving native skill has now.
    let namesByTarget = new Map<string, string[]>();
    if (movedTargets.size > 0) {
      try {
        namesByTarget = await linkNamesByTarget(agentDir, movedTargets);
      } catch (error) {
        result.failures.push({ name: agentFolderFailureName(agent), error: `Could not read agent skills directory (${(error as Error).message})` });
      }
    }

    for (const [linkName, skillName] of linkPlan) {
      const targetPath = path.join(skillsDir, skillName);
      const linkPath = path.join(agentDir, safeName(linkName, agentDir));
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
        result.verifiedAgentLinks[skillName] = {
          ...result.verifiedAgentLinks[skillName],
          [agent]: linkName === skillName ? true : linkName,
        };
        // Once the link exists, remove this native skill's link under its other
        // name (old `native-<id>` or readable); a relink pass leaves the rest alone.
        const otherNames = (namesByTarget.get(path.resolve(targetPath)) ?? [])
          .filter((name) => name.toLowerCase() !== linkName.toLowerCase());
        if (otherNames.length > 0) {
          try {
            result.removed += await unlinkIfTarget(agentDir, otherNames, path.resolve(targetPath));
          } catch (error) {
            result.failures.push({ name: skillName, error: `${agentFailureLabel(agent)}: could not remove skill link (${(error as Error).message})` });
          }
        }
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
