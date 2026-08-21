import { createHash } from "crypto";
import { execFile } from "child_process";
import type { Dirent } from "fs";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

import type { CloudSkill, LocalSkill, NotisSyncState } from "./types";

const HOME_DIR = os.homedir();
const execFileAsync = promisify(execFile);

export const AGENTS_DIR = path.join(HOME_DIR, ".agents");
export const LEGACY_AGENTS_SKILLS_DIR = path.join(AGENTS_DIR, "skills");
export const NOTIS_SKILL_SYNC_ROOT = path.join(HOME_DIR, ".notis", "skills");
export const LEGACY_NOTIS_SYNC_STATE_PATH = path.join(
  AGENTS_DIR,
  ".notis-sync.json",
);
export const AGENTS_SKILLS_DIR = LEGACY_AGENTS_SKILLS_DIR;
export const NOTIS_SYNC_STATE_PATH = LEGACY_NOTIS_SYNC_STATE_PATH;
const SKILL_LOCK_PATH = path.join(AGENTS_DIR, ".skill-lock.json");

const DEFAULT_SYNC_STATE: NotisSyncState = {
  version: 1,
  lastSyncedAt: null,
  skills: {},
};
const EXCLUDED_TOP_LEVEL_ROOT_NAMES = new Set([
  "backup",
  "backups",
  "builtin",
  "builtins",
  "cache",
  "caches",
  "marketplace",
  "marketplaces",
  "plugin",
  "plugins",
  "temp",
  "tmp",
  "worktree",
  "worktrees",
]);

export interface SkillSyncPaths {
  agentsDir: string;
  syncRoot: string;
  legacySkillsDir: string;
  legacyScopedSkillsDir: string;
  legacyScopedSyncStatePath: string;
  skillsDir: string;
  syncStatePath: string;
  skillLockPath: string;
  gatherMetadataPath: string;
}

const DEFAULT_SYNC_PATHS: SkillSyncPaths = {
  agentsDir: AGENTS_DIR,
  syncRoot: NOTIS_SKILL_SYNC_ROOT,
  legacySkillsDir: LEGACY_AGENTS_SKILLS_DIR,
  legacyScopedSkillsDir: LEGACY_AGENTS_SKILLS_DIR,
  legacyScopedSyncStatePath: LEGACY_NOTIS_SYNC_STATE_PATH,
  skillsDir: LEGACY_AGENTS_SKILLS_DIR,
  syncStatePath: LEGACY_NOTIS_SYNC_STATE_PATH,
  skillLockPath: SKILL_LOCK_PATH,
  gatherMetadataPath: path.join(NOTIS_SKILL_SYNC_ROOT, "skill-gather-metadata.json"),
};

function getDefaultSyncRootForAgentsDir(resolvedAgentsDir: string): string {
  if (resolvedAgentsDir === path.resolve(AGENTS_DIR)) {
    return NOTIS_SKILL_SYNC_ROOT;
  }
  return path.join(resolvedAgentsDir, ".notis", "skills");
}

function isResolvedChildPath(baseDir: string, candidatePath: string): boolean {
  return candidatePath.startsWith(`${baseDir}${path.sep}`);
}

function sanitizePathSegment(value: string): string {
  const raw = value.trim();
  const sanitized = raw
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!sanitized) {
    throw new Error("Invalid sync user id");
  }
  if (sanitized === raw) {
    return sanitized;
  }
  return `${sanitized}-${createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
}

export function getSkillSyncPathsForUser(
  authUserId: string,
  agentsDir: string = AGENTS_DIR,
): SkillSyncPaths {
  const safeUserId = sanitizePathSegment(authUserId);
  const resolvedAgentsDir = path.resolve(agentsDir);
  const syncRoot = getDefaultSyncRootForAgentsDir(resolvedAgentsDir);
  const userRoot = path.join(syncRoot, "users", safeUserId);
  const legacyUserRoot = path.join(resolvedAgentsDir, "notis", "users", safeUserId);

  return {
    agentsDir: resolvedAgentsDir,
    syncRoot,
    legacySkillsDir: path.join(resolvedAgentsDir, "skills"),
    legacyScopedSkillsDir: path.join(legacyUserRoot, "skills"),
    legacyScopedSyncStatePath: path.join(legacyUserRoot, ".notis-sync.json"),
    skillsDir: path.join(userRoot, "skills"),
    syncStatePath: path.join(userRoot, ".notis-sync.json"),
    skillLockPath: path.join(resolvedAgentsDir, ".skill-lock.json"),
    gatherMetadataPath: path.join(userRoot, ".notis-gathered-skills.json"),
  };
}

function assertRelativeBundlePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (
    !normalized ||
    normalized.startsWith("../") ||
    `/${normalized}/`.includes("/../")
  ) {
    throw new Error(`Invalid bundle file path: ${relativePath}`);
  }
  return normalized;
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "").trim();
}

function parseFrontMatter(skillMd: string): { description: string } {
  const match = skillMd.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) {
    return { description: "" };
  }

  let description = "";
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const descriptionMatch = trimmed.match(/^description\s*:\s*(.+)$/i);
    if (descriptionMatch) {
      description = stripWrappingQuotes(descriptionMatch[1]);
      break;
    }
  }

  return { description };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function listFilesRecursive(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === ".DS_Store") {
        return [];
      }

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath);
      }

      if (entry.isFile()) {
        return [fullPath];
      }

      return [];
    }),
  );

  return nested.flat().sort();
}

async function computeFolderHash(dirPath: string): Promise<string> {
  const hash = createHash("sha256");
  const filePaths = await listFilesRecursive(dirPath);

  for (const filePath of filePaths) {
    const relativePath = path.relative(dirPath, filePath);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await fs.readFile(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

function resolveSkillBundleFilePath(
  skillDir: string,
  relativePath: string,
): string {
  const normalizedPath = assertRelativeBundlePath(relativePath);
  const resolvedSkillDir = path.resolve(skillDir);
  const candidatePath = path.resolve(resolvedSkillDir, normalizedPath);
  if (
    candidatePath === resolvedSkillDir ||
    !isResolvedChildPath(resolvedSkillDir, candidatePath)
  ) {
    throw new Error(
      `Bundle file resolves outside the expected directory: ${relativePath}`,
    );
  }
  return candidatePath;
}

async function readSkillMdIfValid(skillDir: string): Promise<boolean> {
  try {
    await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function moveDirectory(
  sourceDir: string,
  destinationDir: string,
): Promise<void> {
  await fs.mkdir(path.dirname(destinationDir), { recursive: true });
  try {
    await fs.rename(sourceDir, destinationDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await fs.cp(sourceDir, destinationDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
}

async function createDirectorySymlink(
  targetDir: string,
  linkPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(path.relative(path.dirname(linkPath), targetDir), linkPath, "dir");
}

function backupRootFor(paths: SkillSyncPaths, timestamp: string): string {
  return path.join(paths.syncRoot, "skill-dedupe-backups", timestamp);
}

function relativeBackupPath(label: string, skillName: string): string {
  return path.join(
    label.replace(/[^A-Za-z0-9_.-]+/g, "_"),
    safeName(skillName),
  );
}

function isExcludedTopLevelSkillEntry(entryName: string): boolean {
  return (
    entryName.startsWith(".") ||
    isTransientSkillDirectoryName(entryName) ||
    EXCLUDED_TOP_LEVEL_ROOT_NAMES.has(entryName.toLowerCase())
  );
}

function isTransientSkillDirectoryName(entryName: string): boolean {
  return /\.(?:backup|staging)-/.test(entryName);
}

interface TopLevelSkillSource {
  label: string;
  root: string;
  priority: number;
}

interface TopLevelSkillCandidate {
  name: string;
  root: string;
  label: string;
  path: string;
  resolvedPath: string;
  priority: number;
  isScoped: boolean;
  isSymlink: boolean;
}

export interface GatherTopLevelLocalSkillsOptions {
  sourceRoots?: Array<{ label: string; root: string }>;
  protectedSkillNames?: ReadonlySet<string>;
  timestamp?: string;
}

export interface GatherTopLevelLocalSkillsResult {
  gathered: number;
  backedUp: number;
  skipped: number;
  metadataPath: string;
}

function defaultTopLevelSkillSources(
  paths: SkillSyncPaths,
): TopLevelSkillSource[] {
  const sources: TopLevelSkillSource[] = [];
  if (path.resolve(paths.legacyScopedSkillsDir) !== path.resolve(paths.skillsDir)) {
    sources.push({
      label: "notis-legacy-scoped",
      root: paths.legacyScopedSkillsDir,
      priority: 1,
    });
  }

  sources.push(
    { label: "agents", root: paths.legacySkillsDir, priority: 2 },
    {
      label: "codex",
      root: path.join(HOME_DIR, ".codex", "skills"),
      priority: 3,
    },
    {
      label: "cursor",
      root: path.join(HOME_DIR, ".cursor", "skills"),
      priority: 4,
    },
    {
      label: "claude",
      root: path.join(HOME_DIR, ".claude", "skills"),
      priority: 5,
    },
  );

  return sources;
}

function isManagedTopLevelSymlinkTarget(
  resolvedPath: string,
  paths: SkillSyncPaths,
): boolean {
  const managedRoots = [
    path.resolve(paths.skillsDir),
    path.resolve(paths.legacySkillsDir),
    path.resolve(paths.legacyScopedSkillsDir),
    path.join(path.resolve(paths.syncRoot), "base"),
    path.join(path.resolve(paths.syncRoot), "users"),
    path.join(path.resolve(paths.agentsDir), "notis", "users"),
  ];
  return managedRoots.some(
    (root) =>
      resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`),
  );
}

async function listTopLevelSkillCandidates(
  paths: SkillSyncPaths,
  options: GatherTopLevelLocalSkillsOptions,
): Promise<TopLevelSkillCandidate[]> {
  const sourceRoots = options.sourceRoots
    ? options.sourceRoots.map((source, index) => ({
        ...source,
        priority: index + 1,
      }))
    : defaultTopLevelSkillSources(paths);
  const candidates: TopLevelSkillCandidate[] = [];

  try {
    const scopedEntries = await fs.readdir(paths.skillsDir, {
      withFileTypes: true,
    });
    for (const entry of scopedEntries) {
      if (
        (!entry.isDirectory() && !entry.isSymbolicLink()) ||
        entry.name.startsWith(".") ||
        isTransientSkillDirectoryName(entry.name)
      ) {
        continue;
      }
      const skillDir = path.join(paths.skillsDir, entry.name);
      let resolvedPath = path.resolve(skillDir);
      if (entry.isSymbolicLink()) {
        try {
          resolvedPath = path.resolve(path.dirname(skillDir), await fs.readlink(skillDir));
        } catch {
          continue;
        }
      }
      if (await readSkillMdIfValid(skillDir)) {
        candidates.push({
          name: safeName(entry.name, paths.skillsDir),
          root: paths.skillsDir,
          label: "notis-managed",
          path: skillDir,
          resolvedPath,
          priority: 0,
          isScoped: true,
          isSymlink: entry.isSymbolicLink(),
        });
      }
    }
  } catch {
    // Missing scoped mirror is expected before the first sync.
  }

  for (const source of sourceRoots) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(source.root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (
        isExcludedTopLevelSkillEntry(entry.name) ||
        (!entry.isDirectory() && !entry.isSymbolicLink())
      ) {
        continue;
      }

      const candidatePath = path.join(source.root, entry.name);
      let resolvedPath: string;
      try {
        resolvedPath = entry.isSymbolicLink()
          ? path.resolve(
              path.dirname(candidatePath),
              await fs.readlink(candidatePath),
            )
          : path.resolve(candidatePath);
      } catch {
        continue;
      }

      if (
        entry.isSymbolicLink() &&
        isManagedTopLevelSymlinkTarget(resolvedPath, paths)
      ) {
        continue;
      }

      if (!(await readSkillMdIfValid(resolvedPath))) {
        continue;
      }

      candidates.push({
        name: safeName(entry.name, paths.skillsDir),
        root: source.root,
        label: source.label,
        path: candidatePath,
        resolvedPath,
        priority: source.priority,
        isScoped: false,
        isSymlink: entry.isSymbolicLink(),
      });
    }
  }

  return candidates.sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
  );
}

export async function gatherTopLevelLocalSkills(
  paths: SkillSyncPaths,
  options: GatherTopLevelLocalSkillsOptions = {},
): Promise<GatherTopLevelLocalSkillsResult> {
  await ensureCanonicalSkillsDir(paths);

  const protectedSkillNames = options.protectedSkillNames || new Set<string>();
  const timestamp =
    options.timestamp || new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = backupRootFor(paths, timestamp);
  const candidates = await listTopLevelSkillCandidates(paths, options);
  const byName = new Map<string, TopLevelSkillCandidate[]>();

  for (const candidate of candidates) {
    const existing = byName.get(candidate.name) || [];
    existing.push(candidate);
    byName.set(candidate.name, existing);
  }

  let gathered = 0;
  let backedUp = 0;
  let skipped = 0;
  const metadata: {
    version: 1;
    gatheredAt: string;
    skills: Record<
      string,
      {
        canonicalPath: string | null;
        skippedSources: string[];
        protectedFromLocalGather?: boolean;
      }
    >;
  } = {
    version: 1,
    gatheredAt: new Date().toISOString(),
    skills: {},
  };

  for (const [skillName, skillCandidates] of byName) {
    const protectedFromLocalGather = protectedSkillNames.has(skillName);
    const canonical = protectedFromLocalGather
      ? skillCandidates.find((candidate) => candidate.isScoped) || null
      : skillCandidates[0];
    const destinationName = safeName(skillName, paths.skillsDir);
    const destinationDir = path.join(paths.skillsDir, destinationName);
    const skippedSources: string[] = [];

    if (!canonical) {
      for (const candidate of skillCandidates) {
        if (candidate.isSymlink) {
          skipped += 1;
          skippedSources.push(candidate.path);
          continue;
        }
        const backupDir = path.join(
          backupRoot,
          relativeBackupPath(candidate.label, skillName),
        );
        try {
          await moveDirectory(candidate.path, backupDir);
          backedUp += 1;
          skippedSources.push(candidate.path);
        } catch {
          skipped += 1;
        }
      }
      metadata.skills[skillName] = {
        canonicalPath: null,
        skippedSources,
        protectedFromLocalGather: true,
      };
      continue;
    }

    if (!canonical.isScoped && !(await pathExists(destinationDir))) {
      try {
        if (canonical.isSymlink) {
          await createDirectorySymlink(canonical.resolvedPath, destinationDir);
        } else {
          await moveDirectory(canonical.path, destinationDir);
        }
        gathered += 1;
      } catch {
        skipped += 1;
      }
    }

    for (const candidate of skillCandidates) {
      if (candidate === canonical || candidate.isScoped) {
        continue;
      }
      if (candidate.isSymlink) {
        skippedSources.push(candidate.path);
        continue;
      }
      const backupDir = path.join(
        backupRoot,
        relativeBackupPath(candidate.label, skillName),
      );
      try {
        await moveDirectory(candidate.path, backupDir);
        backedUp += 1;
        skippedSources.push(candidate.path);
      } catch {
        skipped += 1;
      }
    }

    metadata.skills[skillName] = {
      canonicalPath: (await pathExists(destinationDir))
        ? destinationDir
        : canonical.path,
      skippedSources,
      ...(protectedFromLocalGather ? { protectedFromLocalGather: true } : {}),
    };
  }

  await fs.mkdir(path.dirname(paths.gatherMetadataPath), { recursive: true });
  await fs.writeFile(
    paths.gatherMetadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );

  return {
    gathered,
    backedUp,
    skipped,
    metadataPath: paths.gatherMetadataPath,
  };
}

async function readSkillLock(
  paths: SkillSyncPaths = DEFAULT_SYNC_PATHS,
): Promise<Record<string, string>> {
  type SkillLock = {
    skills?: Record<string, { sourceUrl?: string }>;
  };

  const lockData = await readJsonFile<SkillLock>(paths.skillLockPath);
  const sourceUrls: Record<string, string> = {};

  for (const [skillName, entry] of Object.entries(lockData?.skills || {})) {
    if (typeof entry?.sourceUrl === "string" && entry.sourceUrl.trim()) {
      sourceUrls[skillName] = entry.sourceUrl.trim();
    }
  }

  return sourceUrls;
}

export async function ensureCanonicalSkillsDir(
  paths: SkillSyncPaths = DEFAULT_SYNC_PATHS,
): Promise<void> {
  await fs.mkdir(paths.skillsDir, { recursive: true });
}

export async function initializeScopedSkillsFromLegacy(
  paths: SkillSyncPaths,
): Promise<number> {
  const usingLegacyPath =
    path.resolve(paths.skillsDir) === path.resolve(paths.legacySkillsDir);
  if (usingLegacyPath || (await pathExists(paths.syncStatePath))) {
    await ensureCanonicalSkillsDir(paths);
    return 0;
  }

  await ensureCanonicalSkillsDir(paths);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(paths.legacySkillsDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let copied = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const legacySkillDir = path.join(paths.legacySkillsDir, entry.name);
    const targetSkillName = safeName(entry.name, paths.skillsDir);
    const scopedSkillDir = path.join(paths.skillsDir, targetSkillName);
    try {
      await fs.readFile(path.join(legacySkillDir, "SKILL.md"), "utf8");
      if (await pathExists(scopedSkillDir)) {
        continue;
      }
      await fs.cp(legacySkillDir, scopedSkillDir, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      copied += 1;
    } catch {
      // Ignore invalid legacy skill folders and existing scoped copies.
    }
  }

  return copied;
}

export async function scanLocalSkills(
  paths: SkillSyncPaths = DEFAULT_SYNC_PATHS,
): Promise<LocalSkill[]> {
  await ensureCanonicalSkillsDir(paths);

  const sourceUrls = await readSkillLock(paths);
  const entries = await fs.readdir(paths.skillsDir, { withFileTypes: true });
  const skills: Array<LocalSkill | null> = await Promise.all(
    entries.map(async (entry) => {
      if (
        (!entry.isDirectory() && !entry.isSymbolicLink()) ||
        isTransientSkillDirectoryName(entry.name)
      ) {
        return null;
      }

      const skillDir = path.join(paths.skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, "SKILL.md");

      try {
        const skillMd = await fs.readFile(skillMdPath, "utf8");
        const { description } = parseFrontMatter(skillMd);
        const folderHash = await computeFolderHash(skillDir);
        const skill: LocalSkill = {
          name: entry.name,
          skillMd,
          description,
          folderHash,
          directoryPath: skillDir,
        };
        if (sourceUrls[entry.name]) {
          skill.sourceUrl = sourceUrls[entry.name];
        }
        return skill;
      } catch {
        return null;
      }
    }),
  );

  return skills
    .filter((skill): skill is LocalSkill => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSyncState(
  state: NotisSyncState | null,
): NotisSyncState | null {
  if (!state || state.version !== 1 || typeof state.skills !== "object") {
    return null;
  }
  const normalizeStoredAgentTargets = (
    targets: Partial<NotisSyncState["skills"][string]["agentTargets"]> | null | undefined,
  ): NotisSyncState["skills"][string]["agentTargets"] => ({
    notis: Boolean(targets?.notis ?? true),
    claude_code: Boolean(targets?.claude_code ?? true),
    cursor: Boolean(targets?.cursor ?? true),
    codex: Boolean(targets?.codex ?? true),
  });

  return {
    version: 1,
    lastSyncedAt:
      typeof state.lastSyncedAt === "string" ? state.lastSyncedAt : null,
    skills: Object.fromEntries(
      Object.entries(state.skills || {}).map(([skillName, skillState]) => [
        skillName,
        {
          ...skillState,
          agentTargets: normalizeStoredAgentTargets(skillState.agentTargets),
        },
      ]),
    ),
  };
}

export async function readSyncState(
  paths: SkillSyncPaths = DEFAULT_SYNC_PATHS,
): Promise<NotisSyncState> {
  const scopedState = normalizeSyncState(
    await readJsonFile<NotisSyncState>(paths.syncStatePath),
  );
  if (scopedState) {
    return scopedState;
  }

  return DEFAULT_SYNC_STATE;
}

export async function readLegacySyncState(
  paths: SkillSyncPaths = DEFAULT_SYNC_PATHS,
): Promise<NotisSyncState | null> {
  const legacyStatePaths = [
    paths.legacyScopedSyncStatePath,
    path.resolve(paths.syncStatePath) === path.resolve(LEGACY_NOTIS_SYNC_STATE_PATH)
      ? paths.syncStatePath
      : path.join(paths.agentsDir, ".notis-sync.json"),
  ];

  for (const legacyStatePath of legacyStatePaths) {
    const state = normalizeSyncState(
      await readJsonFile<NotisSyncState>(legacyStatePath),
    );
    if (state) {
      return state;
    }
  }

  return null;
}

export async function writeSyncState(
  state: NotisSyncState,
  paths: SkillSyncPaths = DEFAULT_SYNC_PATHS,
): Promise<void> {
  await fs.mkdir(path.dirname(paths.syncStatePath), { recursive: true });
  await fs.writeFile(
    paths.syncStatePath,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

export function safeName(
  name: string,
  baseDir: string = AGENTS_SKILLS_DIR,
): string {
  const sanitizedName = name
    .trim()
    .replace(/[\\/]+/g, "")
    .replace(/\.\./g, "");
  if (!sanitizedName) {
    throw new Error("Invalid skill name");
  }

  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedPath = path.resolve(resolvedBaseDir, sanitizedName);
  if (!isResolvedChildPath(resolvedBaseDir, resolvedPath)) {
    throw new Error("Skill name resolves outside the expected directory");
  }

  return sanitizedName;
}

export async function deleteLocalSkill(
  skillName: string,
  paths: SkillSyncPaths = DEFAULT_SYNC_PATHS,
): Promise<boolean> {
  const skillDir = path.join(
    paths.skillsDir,
    safeName(skillName, paths.skillsDir),
  );
  try {
    await fs.rm(skillDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function createZipFromDirectory(directoryPath: string): Promise<string> {
  const zipPath = path.join(
    os.tmpdir(),
    `notis-skill-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`,
  );
  const parentDir = path.dirname(directoryPath);
  const directoryName = path.basename(directoryPath);

  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${directoryPath.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ]);
    return zipPath;
  }

  await execFileAsync("zip", ["-qry", zipPath, directoryName], {
    cwd: parentDir,
  });
  return zipPath;
}

async function extractZipToDirectory(
  zipPath: string,
  destinationDir: string,
): Promise<void> {
  const extractRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "notis-skill-extract-"),
  );

  try {
    if (process.platform === "win32") {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`,
      ]);
    } else {
      await execFileAsync("unzip", ["-qq", zipPath, "-d", extractRoot]);
    }

    const extractedEntries = await fs.readdir(extractRoot, {
      withFileTypes: true,
    });
    const extractedDirectory = extractedEntries.find((entry) =>
      entry.isDirectory(),
    );
    const sourceDir = extractedDirectory
      ? path.join(extractRoot, extractedDirectory.name)
      : extractRoot;

    await fs.rm(destinationDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destinationDir), { recursive: true });
    await fs.cp(sourceDir, destinationDir, { recursive: true });
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true });
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function replaceSkillDirectoryAtomically(
  skillDir: string,
  populateDir: (stagingDir: string) => Promise<void>,
): Promise<void> {
  const parentDir = path.dirname(skillDir);
  const skillName = path.basename(skillDir);
  await fs.mkdir(parentDir, { recursive: true });

  const stagingDir = await fs.mkdtemp(
    path.join(parentDir, `${skillName}.staging-`),
  );
  const backupDir = path.join(
    parentDir,
    `${skillName}.backup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  let movedExisting = false;
  let promotedStaging = false;
  let cleanupError: Error | null = null;

  try {
    await populateDir(stagingDir);

    if (await pathExists(skillDir)) {
      await fs.rename(skillDir, backupDir);
      movedExisting = true;
    }

    await fs.rename(stagingDir, skillDir);
    promotedStaging = true;
  } catch (error) {
    if (movedExisting && !promotedStaging && (await pathExists(backupDir))) {
      await fs.rename(backupDir, skillDir);
    }
    throw error;
  } finally {
    if (!promotedStaging && (await pathExists(stagingDir))) {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
    if ((promotedStaging || !movedExisting) && (await pathExists(backupDir))) {
      try {
        await fs.rm(backupDir, { recursive: true, force: true });
      } catch (error) {
        if (!cleanupError) {
          cleanupError =
            error instanceof Error ? error : new Error(String(error));
        }
      }
    }
    if (cleanupError) {
      console.warn(
        `[Notis] Failed to clean up temporary skill directory backup for "${skillDir}"`,
        cleanupError,
      );
    }
  }
}

function bundleFilesIncludeSkillMd(
  bundleFiles: Array<{ path: string }>,
): boolean {
  return bundleFiles.some((bundleFile) => {
    const basename = path.basename(bundleFile.path).toLowerCase();
    return basename === "skill.md" || basename === "skills.md";
  });
}

export async function createSkillBundleBase64(
  skill: LocalSkill,
): Promise<string> {
  const zipPath = await createZipFromDirectory(skill.directoryPath);
  try {
    const zipBytes = await fs.readFile(zipPath);
    return zipBytes.toString("base64");
  } finally {
    await fs.rm(zipPath, { force: true });
  }
}

export async function writeCloudSkillToDisk(
  skill: CloudSkill,
  bundleBytes?: Buffer,
  paths: SkillSyncPaths = DEFAULT_SYNC_PATHS,
): Promise<boolean> {
  const skillDir = path.join(
    paths.skillsDir,
    safeName(skill.name, paths.skillsDir),
  );

  if (bundleBytes?.length) {
    const bundlePath = path.join(
      os.tmpdir(),
      `notis-skill-download-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`,
    );
    try {
      await fs.writeFile(bundlePath, bundleBytes);
      await extractZipToDirectory(bundlePath, skillDir);
      return true;
    } finally {
      await fs.rm(bundlePath, { force: true });
    }
  }

  if (
    !skill.skill_md &&
    (!skill.bundle_files || skill.bundle_files.length === 0)
  ) {
    return false;
  }

  if (skill.bundle_files && skill.bundle_files.length > 0) {
    if (!bundleFilesIncludeSkillMd(skill.bundle_files)) {
      throw new Error(
        `Synced bundle for "${skill.name}" is missing SKILL.md or SKILLS.md`,
      );
    }
    await replaceSkillDirectoryAtomically(skillDir, async (stagingDir) => {
      for (const bundleFile of skill.bundle_files || []) {
        const filePath = resolveSkillBundleFilePath(
          stagingDir,
          bundleFile.path,
        );
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(
          filePath,
          Buffer.from(bundleFile.content_b64, "base64"),
        );
      }
    });
    return true;
  }

  await replaceSkillDirectoryAtomically(skillDir, async (stagingDir) => {
    await fs.writeFile(
      path.join(stagingDir, "SKILL.md"),
      skill.skill_md ?? "",
      "utf8",
    );
  });
  return true;
}
