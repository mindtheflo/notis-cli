import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type {
  AgentTargets,
  LocalSkill,
  NotisSyncState,
  SkillSyncFailure,
  SyncPullResponse,
  SyncSettings,
  SyncedSkill,
} from "./types";
import { normalizeAgentTargets } from "./types";
import { assertNativePull, checkedNativeReference, isNativeSkill, nativeState } from './native-identity';
import { bindNativeFolders, hasNativeFolderHistory, nativeLinkRows, nativeLocalReady, previousNativeState, retainMissingNativeState } from './native-plan';
import {
  downloadSkillBundle,
  fetchSyncSettings,
  pullSkills,
  pushChangedSkills,
  updateAgentTargets,
} from "./cloud-client";
import {
  deleteLocalSkill,
  gatherTopLevelLocalSkills,
  getSkillSyncPathsForUser,
  readLegacySyncState,
  readSyncState,
  scanLocalSkills,
  writeCloudSkillToDisk,
  writeSyncState,
} from "./local-scanner";
import {
  detectDeletedAgentSymlinks,
  removeForeignAccountSymlinks,
  removeAllSymlinksForSkill,
  syncSymlinks,
  type DeletedAgentSymlink,
} from "./symlink-manager";
import { getPushCandidates, selectCloudSkillsToApply } from "./sync-plan";
import { writeCloudSkillWithBundleFallback } from "./write-cloud-skill";
export { fetchSyncSettings } from './cloud-client';

export interface RunSkillSyncResult {
  syncEnabled: boolean;
  pushed: number;
  pulled: number;
  downloaded: number;
  deleted: number;
  /** Skills deactivated for a specific agent because the user deleted that agent's local
   * symlink (e.g. `rm ~/.claude/skills/<skill>`); the deletion is honored instead of recreated. */
  deactivated: number;
  linked: number;
  removed: number;
  skipped: number;
  lastSyncedAt: string | null;
  /** Skills the server rejected (e.g. an invalid SKILL.md description). The rest of
   * the batch still syncs; these are surfaced so the user knows what to fix. */
  failedPushes: SkillSyncFailure[];
  failedLinks?: SkillSyncFailure[];
}

export interface RunSkillSyncOptions {
  /** Electron's scheduled invocation honors the account preference. A manual
   * CLI sync always runs, even when automatic Desktop refresh is disabled. */
  honorSyncEnabled?: boolean;
  /** All account paths, scanner roots and agent links use this explicit home. */
  syncHome?: string;
}

const BASE_SKILL_NAMES = new Set(['notis-apps', 'notis-query', 'notis-cli']);

function withoutBaseSkills(pullResponse: SyncPullResponse): SyncPullResponse {
  return {
    ...pullResponse,
    skills: pullResponse.skills.filter((skill) => !BASE_SKILL_NAMES.has(skill.name)),
  };
}

function withoutBaseSkillState(state: NotisSyncState): NotisSyncState {
  return {
    ...state,
    skills: Object.fromEntries(
      Object.entries(state.skills).filter(([name]) => !BASE_SKILL_NAMES.has(name)),
    ),
  };
}

export interface MaterializeCloudSkillsResult {
  /** Cloud skills verified present in the final scoped disk scan. */
  materializedSkillNames: string[];
  pulled: number;
  downloaded: number;
  deleted: number;
  removed: number;
  lastSyncedAt: string | null;
  failedLinks?: SkillSyncFailure[];
}

export interface MaterializeCloudSkillsOptions {
  /** Server-verified Notis identity, when Desktop's auth subject differs. */
  canonicalUserId?: string;
  /** Previously authenticated settings must agree with the pull before I/O. */
  syncSettings?: SyncSettings;
  /** Re-link only these cloud skills without removing or adopting other links. */
  relinkSkillNames?: readonly string[];
}

interface RunSkillSyncDependencies {
  fetchSyncSettings: typeof fetchSyncSettings;
  pullSkills: typeof pullSkills;
  pushChangedSkills: typeof pushChangedSkills;
  downloadSkillBundle: typeof downloadSkillBundle;
  gatherTopLevelLocalSkills: typeof gatherTopLevelLocalSkills;
  readLegacySyncState: typeof readLegacySyncState;
  readSyncState: typeof readSyncState;
  scanLocalSkills: typeof scanLocalSkills;
  deleteLocalSkill: typeof deleteLocalSkill;
  writeCloudSkillToDisk: typeof writeCloudSkillToDisk;
  writeSyncState: typeof writeSyncState;
  removeAllSymlinksForSkill: typeof removeAllSymlinksForSkill;
  syncSymlinks: typeof syncSymlinks;
  detectDeletedAgentSymlinks: typeof detectDeletedAgentSymlinks;
  removeForeignAccountSymlinks: typeof removeForeignAccountSymlinks;
  updateAgentTargets: typeof updateAgentTargets;
}

const DEFAULT_RUN_SKILL_SYNC_DEPS: RunSkillSyncDependencies = {
  fetchSyncSettings,
  pullSkills,
  pushChangedSkills,
  downloadSkillBundle,
  gatherTopLevelLocalSkills,
  readLegacySyncState,
  readSyncState,
  scanLocalSkills,
  deleteLocalSkill,
  writeCloudSkillToDisk,
  writeSyncState,
  removeAllSymlinksForSkill,
  syncSymlinks,
  detectDeletedAgentSymlinks,
  removeForeignAccountSymlinks,
  updateAgentTargets,
};

export function isolatedLinkOptions(paths: ReturnType<typeof getSkillSyncPathsForUser>) {
  if (!paths.isolatedNamespace && !paths.homeDir) return undefined;
  const root = paths.isolatedNamespace
    ? join(paths.syncRoot, 'environments', paths.isolatedNamespace, 'agents') : paths.homeDir!;
  return { agentSkillDirs: { notis: paths.skillsDir, claude_code: join(root, '.claude', 'skills'),
    cursor: join(root, '.cursor', 'skills'), codex: join(root, '.codex', 'skills') },
    legacyGlobalSkillsDir: join(root, '.agents', 'skills') };
}

function assertSyncEnvironment(pull: SyncPullResponse, settings: SyncSettings): void {
  if ((pull.sync_namespace || null) !== (settings.sync_namespace || null)
      || (settings.sync_scope !== undefined && pull.sync_scope !== settings.sync_scope)) {
    throw new Error('Skill sync environment changed. Existing mirrors were retained.');
  }
}
function toSkillMap(skills: LocalSkill[]): Map<string, LocalSkill> {
  return new Map(skills.map((skill) => [skill.name, skill]));
}

function decodeJwtSubject(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const decoded = JSON.parse(
      Buffer.from(parts[1], "base64url").toString(),
    ) as { sub?: unknown };
    return typeof decoded.sub === "string" && decoded.sub.trim()
      ? decoded.sub.trim()
      : null;
  } catch {
    return null;
  }
}

function cloudContentHash(skill: SyncPullResponse['skills'][number]): string {
  return createHash('sha256').update(JSON.stringify({
    md: skill.skill_md,
    hash: skill.skill_folder_hash,
    source: skill.skill_source_url,
    files: skill.bundle_files?.slice().sort((a, b) => a.path.localeCompare(b.path)),
    hydrationFailed: skill.bundle_hydration_failed === true,
  })).digest('hex');
}

export function shouldWriteCloudSkill(
  cloudSkill: SyncPullResponse["skills"][number],
  localSkills: Map<string, LocalSkill>,
  previousState: NotisSyncState,
): boolean {
  const skillName = cloudSkill.name;
  const cloudHash = cloudSkill.skill_folder_hash || "";
  const localSkill = localSkills.get(skillName);
  if (!localSkill) {
    return true;
  }

  if (isNativeSkill(cloudSkill)) {
    if (localSkill.nativeScope && localSkill.nativeScope !== cloudSkill.native_scope) return false;
    if (nativeLocalReady(cloudSkill, localSkill)) return false;
    const nativePrevious = previousNativeState(previousState, cloudSkill);
    return (localSkill.nativeFilesCurrent === true && localSkill.folderHash === localSkill.nativeBaseFolderHash)
      || (!localSkill.nativeReference && nativePrevious?.cloudId === cloudSkill.id
          && nativePrevious.folderHash === localSkill.folderHash);
  }

  const previous = previousState.skills[skillName];
  if (previous?.folderHash === localSkill.folderHash
    && previous.cloudContentHash === cloudContentHash(cloudSkill)) return false;

  // Without a stored content baseline (skills served through a signed source URL keep
  // none, because that URL changes on every pull) the only other signal is
  // `skill_folder_hash`, which the server does NOT always compute the way the local
  // folder hash is computed. A bundle-entry hash can never equal the hash of the
  // extracted directory, and comparing the two replaced the folder on every sync
  // tick, deleting whatever a running skill had written inside it. Compare cloud against cloud instead: rewrite when the cloud
  // revision we last applied has actually moved.
  if (previous
    && previous.cloudContentHash === undefined
    && previous.cloudId === cloudSkill.id
    && previous.appliedCloudFolderHash !== undefined
    && previous.appliedCloudFolderHash === cloudHash
    && previous.cloudUpdatedAt === cloudSkill.updated_at
    && previous.folderHash === localSkill.folderHash) {
    return false;
  }

  if (cloudSkill.source === "curated") {
    return cloudHash ? cloudHash !== localSkill.folderHash : true;
  }

  const localChangedSinceLastSync =
    !previous || previous.folderHash !== localSkill.folderHash;
  return (
    !localChangedSinceLastSync &&
    ((Boolean(cloudHash) && cloudHash !== localSkill.folderHash)
      || Boolean(previous?.cloudContentHash && previous.cloudContentHash !== cloudContentHash(cloudSkill)))
  );
}

type AppliedCloudRevisions = Record<string, string | undefined>;

/**
 * The cloud revision each folder's last successful write applied: this run's revision
 * for the skills we just wrote, the previously recorded one otherwise. A failed write
 * records nothing, so the next sync retries it.
 */
function collectAppliedCloudRevisions(
  pullResponse: SyncPullResponse,
  previousState: NotisSyncState,
  writtenSkillNames: ReadonlySet<string>,
): AppliedCloudRevisions {
  const applied: AppliedCloudRevisions = {};
  for (const skill of selectCloudSkillsToApply(pullResponse.skills)) {
    applied[skill.name] = writtenSkillNames.has(skill.name)
      ? skill.skill_folder_hash || ""
      : previousState.skills[skill.name]?.appliedCloudFolderHash;
  }
  return applied;
}

/**
 * The files each folder's last successful write put on disk: this run's list for the
 * skills we just wrote, the previously recorded one otherwise. Missing means "no
 * record", which keeps local files rather than deleting what cannot be attributed.
 */
function collectAppliedFiles(
  pullResponse: SyncPullResponse,
  previousState: NotisSyncState,
  appliedFilesByName: Record<string, string[]>,
): Record<string, string[] | undefined> {
  const applied: Record<string, string[] | undefined> = {};
  for (const skill of selectCloudSkillsToApply(pullResponse.skills)) {
    applied[skill.name] = appliedFilesByName[skill.name]
      ?? previousState.skills[skill.name]?.appliedFiles;
  }
  return applied;
}

function buildSyncState(
  pullResponse: SyncPullResponse,
  localSkills: LocalSkill[],
  lastSyncedAt: string | null,
  verifiedAgentLinks: Record<string, Partial<AgentTargets>> = {},
  failedContentNames: ReadonlySet<string> = new Set(),
  appliedRevisions: AppliedCloudRevisions = {},
  appliedFiles: Record<string, string[] | undefined> = {},
  previousState: NotisSyncState = { version: 1, lastSyncedAt: null, skills: {} },
): NotisSyncState {
  const localSkillMap = toSkillMap(localSkills);
  // The same row selection the writer used, so the state describes the revision that
  // is actually on disk rather than whichever duplicate row the server listed last.
  const skills = Object.fromEntries<SyncedSkill>(
    selectCloudSkillsToApply(pullResponse.skills).map((skill): [string, SyncedSkill] => {
      const localSkill = localSkillMap.get(skill.name);
      const appliedCloudFolderHash = appliedRevisions[skill.name];
      const appliedFileList = appliedFiles[skill.name];
      if (isNativeSkill(skill) && !nativeLocalReady(skill, localSkill)) {
        const previous = previousNativeState(previousState, skill);
        return [skill.name, { ...(previous || {
          cloudId: skill.id, folderHash: localSkill?.nativeBaseFolderHash || '',
          agentTargets: normalizeAgentTargets(skill.agent_targets), syncedAt: lastSyncedAt || new Date().toISOString(),
          ...(localSkill?.nativeReference ? { nativeReference: localSkill.nativeReference, nativeScope: localSkill.nativeScope } : {}),
        }), nativeUnavailable: true, verifiedAgentLinks: {} }];
      }
      return [
        skill.name,
        {
          cloudId: skill.id,
          ...nativeState(skill),
          folderHash: localSkill?.folderHash || skill.skill_folder_hash || "",
          agentTargets: normalizeAgentTargets(skill.agent_targets),
          verifiedAgentLinks: skill.status === "active" ? verifiedAgentLinks[skill.name] ?? {} : {},
          cloudUpdatedAt: skill.updated_at,
          ...(!failedContentNames.has(skill.name) && !skill.skill_source_url
            ? { cloudContentHash: cloudContentHash(skill) } : {}),
          ...(appliedCloudFolderHash !== undefined ? { appliedCloudFolderHash } : {}),
          ...(appliedFileList !== undefined ? { appliedFiles: appliedFileList } : {}),
          syncedAt: lastSyncedAt || new Date().toISOString(),
        },
      ];
    }),
  );

  for (const local of localSkills) {
    if (!local.nativeReference || Object.values(skills).some(row => row.cloudId === local.cloudId)) continue;
    skills[local.name] = { cloudId: local.cloudId!, nativeReference: local.nativeReference,
      nativeScope: local.nativeScope, nativeUnavailable: true, verifiedAgentLinks: {},
      folderHash: local.nativeBaseFolderHash || '', agentTargets: normalizeAgentTargets(),
      syncedAt: lastSyncedAt || new Date().toISOString() };
  }
  return retainMissingNativeState(previousState, {
    version: 1,
    lastSyncedAt,
    skills,
  });
}

function buildLocalSymlinkCandidates(
  pullResponse: SyncPullResponse,
  localSkills: LocalSkill[],
  previousState: NotisSyncState,
): SyncPullResponse["skills"] {
  const cloudSkillNames = new Set(
    pullResponse.skills.map((skill) => skill.name),
  );
  const localOnlySkills = localSkills
    .filter((skill) => !cloudSkillNames.has(skill.name))
    .filter(skill => !skill.nativeReference && !previousState.skills[skill.name]?.nativeReference
      && !previousState.skills[skill.name]?.nativeUnavailable
      && !hasNativeFolderHistory(previousState, skill.name)
      && !/^native-[a-f0-9-]{36}$/.test(skill.name))
    .map((skill) => {
      const previous = previousState.skills[skill.name];
      return {
        id: previous?.cloudId || `local-${skill.name}`,
        name: skill.name,
        description: skill.description || null,
        skill_md: skill.skillMd,
        agent_targets: previous?.agentTargets,
        skill_folder_hash: skill.folderHash,
        source: "local",
        status: "active",
      };
    });

  return [...nativeLinkRows(pullResponse, localSkills), ...localOnlySkills];
}

function isEmptySyncState(state: NotisSyncState): boolean {
  return state.lastSyncedAt === null && Object.keys(state.skills).length === 0;
}

function applyLegacyFirstRunState(
  localSkills: LocalSkill[],
  scopedState: NotisSyncState,
  legacyState: NotisSyncState | null,
): NotisSyncState {
  if (!isEmptySyncState(scopedState) || !legacyState) {
    return scopedState;
  }

  const migratedSkills = Object.fromEntries(
    localSkills.flatMap((skill) => {
      const previous = legacyState.skills[skill.name];
      if (!previous || previous.folderHash !== skill.folderHash) {
        return [];
      }
      return [[skill.name, previous]];
    }),
  );

  if (Object.keys(migratedSkills).length === 0) {
    return scopedState;
  }

  return {
    version: 1,
    lastSyncedAt: legacyState.lastSyncedAt,
    skills: migratedSkills,
  };
}

async function writePulledSkillsToScopedMirror(
  pullResponse: SyncPullResponse,
  localSkills: LocalSkill[],
  previousState: NotisSyncState,
  syncPaths: ReturnType<typeof getSkillSyncPathsForUser>,
  deps: Pick<
    RunSkillSyncDependencies,
    "downloadSkillBundle" | "writeCloudSkillToDisk"
  >,
  failures: SkillSyncFailure[] = [],
  writtenSkillNames: Set<string> = new Set(),
  appliedFilesByName: Record<string, string[]> = {},
  acknowledgedNative: ReadonlyMap<string, string> = new Map(),
): Promise<number> {
  const localSkillMap = toSkillMap(localSkills);
  const warnSkillSync = (message: string, error: unknown): void => {
    console.warn(`[Notis] ${message}`, error);
  };

  let downloaded = 0;
  for (const cloudSkill of selectCloudSkillsToApply(pullResponse.skills)) {
    const local = localSkillMap.get(cloudSkill.name);
    const acknowledged = isNativeSkill(cloudSkill) && local && acknowledgedNative.get(cloudSkill.id) === local.folderHash;
    if (!acknowledged && !shouldWriteCloudSkill(cloudSkill, localSkillMap, previousState)) {
      if (isNativeSkill(cloudSkill) && !nativeLocalReady(cloudSkill, local)) {
        failures.push({ name: cloudSkill.name, error: 'Local native Skill changes were retained; resolve the version or identity conflict before using them.' });
      }
      continue;
    }

    const outcome = await writeCloudSkillWithBundleFallback(cloudSkill, {
      downloadSkillBundle: deps.downloadSkillBundle,
      writeCloudSkillToDisk: (skill, bundleBytes) =>
        deps.writeCloudSkillToDisk(skill, bundleBytes, syncPaths, {
          // What the last write put there. Everything else in the folder was
          // produced locally and survives this one.
          previouslyApplied: previousNativeState(previousState, skill)?.appliedFiles,
          ...(isNativeSkill(skill) && local ? { expectedFolderHash: local.folderHash } : {}),
        }),
      onWarning: warnSkillSync,
    });
    if (outcome) {
      downloaded += 1;
      writtenSkillNames.add(cloudSkill.name);
      if (typeof outcome === "object" && Array.isArray(outcome.appliedFiles)) {
        appliedFilesByName[cloudSkill.name] = outcome.appliedFiles;
      }
    } else {
      failures.push({ name: cloudSkill.name, error: "Skill content could not be downloaded or written; sync will retry" });
    }
  }

  return downloaded;
}

function assertSkillsPullAuthorized(
  pullResponse: SyncPullResponse,
): void {
  if (!Array.isArray(pullResponse.skills)) throw new Error('Skill inventory is unavailable; existing files were retained.');
  assertNativePull(pullResponse);
  if (
    pullResponse.entitlement_access?.code === "entitlement_upgrade_required"
    && pullResponse.entitlement_access.entitlement === "skills"
  ) {
    // Current servers return HTTP 403, so cloud-client rejects before producing
    // a SyncPullResponse. Keep this guard for an older server's successful
    // empty-denial envelope, but fail closed: it is never authorization to
    // delete a user's managed local mirror.
    throw new Error(
      "Skill sync access was denied; preserving existing local skills.",
    );
  }
}

export async function materializeCloudSkillsForLocalShell(
  serverUrl: string,
  jwt: string,
  dependencies: Partial<Pick<
    RunSkillSyncDependencies,
    | "downloadSkillBundle"
    | "deleteLocalSkill"
    | "pullSkills"
    | "readSyncState"
    | "removeAllSymlinksForSkill"
    | "scanLocalSkills"
    | "syncSymlinks"
    | "writeCloudSkillToDisk"
    | "writeSyncState"
  >> = {},
  options: MaterializeCloudSkillsOptions = {},
): Promise<MaterializeCloudSkillsResult> {
  const deps = {
    ...DEFAULT_RUN_SKILL_SYNC_DEPS,
    ...dependencies,
  };
  const authUserId = decodeJwtSubject(jwt);
  if (!authUserId) {
    throw new Error(
      "Cannot materialize skills without a valid authenticated desktop session.",
    );
  }

  let pullResponse = await deps.pullSkills(serverUrl, jwt);
  assertSkillsPullAuthorized(pullResponse);
  if (options.syncSettings) assertSyncEnvironment(pullResponse, options.syncSettings);
  const syncPaths = getSkillSyncPathsForUser(options.canonicalUserId?.trim() || authUserId, undefined, pullResponse.sync_namespace);
  const previousState = await deps.readSyncState(syncPaths);

  const localSkills = await deps.scanLocalSkills(syncPaths);
  pullResponse = bindNativeFolders(pullResponse, localSkills, previousState);
  const failedDownloads: SkillSyncFailure[] = [];
  const writtenSkillNames = new Set<string>();
  const appliedFilesByName: Record<string, string[]> = {};
  const downloaded = await writePulledSkillsToScopedMirror(
    pullResponse,
    localSkills,
    previousState,
    syncPaths,
    deps,
    failedDownloads,
    writtenSkillNames,
    appliedFilesByName,
  );
  const finalLocalSkills = await deps.scanLocalSkills(syncPaths);
  const lastSyncedAt = pullResponse.last_synced_at || new Date().toISOString();

  const relinkSkillNames = new Set(options.relinkSkillNames || []);
  const failures = [...failedDownloads];
  const verifiedLinks: Record<string, Partial<AgentTargets>> = {};
  for (const skill of pullResponse.skills) {
    const previous = previousState.skills[skill.name];
    if (skill.updated_at && previous?.cloudId === skill.id && previous.cloudUpdatedAt === skill.updated_at) {
      verifiedLinks[skill.name] = { ...previous.verifiedAgentLinks };
    }
  }
  if (relinkSkillNames.size > 0) {
    const relinked = await deps.syncSymlinks(
      nativeLinkRows(pullResponse, finalLocalSkills).filter((skill) => relinkSkillNames.has(skill.name)),
      syncPaths.skillsDir,
      { ...isolatedLinkOptions(syncPaths), removeUndesired: false },
    );
    failures.push(...(relinked.failures ?? []).filter(
      (failure) => !failedDownloads.some((download) => download.name === failure.name),
    ));
    for (const name of relinkSkillNames) {
      verifiedLinks[name] = relinked.verifiedAgentLinks?.[name] ?? {};
    }
  }
  for (const failure of failedDownloads) delete verifiedLinks[failure.name];

  const materializedState = buildSyncState(
    pullResponse, finalLocalSkills, lastSyncedAt, verifiedLinks,
    new Set(failedDownloads.map(item => item.name)),
    collectAppliedCloudRevisions(pullResponse, previousState, writtenSkillNames),
    collectAppliedFiles(pullResponse, previousState, appliedFilesByName),
    previousState,
  );
  // Pull-only refresh is not an upload acknowledgement. Keep content baselines
  // unless we actually wrote cloud content, and retain cloud-missing entries so
  // the next two-way sync can delete them instead of uploading them as new.
  for (const [name, entry] of Object.entries(materializedState.skills)) {
    if (writtenSkillNames.has(name)) continue;
    const previous = previousState.skills[name];
    if (previous) {
      entry.folderHash = previous.folderHash;
      entry.cloudContentHash = previous.cloudContentHash;
    } else {
      delete materializedState.skills[name];
    }
  }
  materializedState.skills = { ...previousState.skills, ...materializedState.skills };
  let removed = 0;
  for (const [name, previous] of Object.entries(previousState.skills)) {
    if (!previous.nativeReference && !previous.nativeUnavailable) continue;
    const current = pullResponse.skills.find(skill => skill.id === previous.cloudId);
    if (!current || !nativeLocalReady(current, finalLocalSkills.find(local => local.name === current.name))) {
      removed += await deps.removeAllSymlinksForSkill(name, syncPaths.skillsDir, isolatedLinkOptions(syncPaths));
    }
  }
  await deps.writeSyncState(materializedState, syncPaths);

  return {
    materializedSkillNames: pullResponse.skills
      .filter((skill) => finalLocalSkills.some((local) => local.name === skill.name)
        && (!isNativeSkill(skill) || (skill.status === 'active' && skill.agent_targets?.notis !== false
          && nativeLocalReady(skill, finalLocalSkills.find(local => local.name === skill.name))))
        && !failedDownloads.some((failure) => failure.name === skill.name))
      .map((skill) => skill.name),
    pulled: pullResponse.skills.length,
    downloaded,
    deleted: 0,
    removed,
    lastSyncedAt,
    ...(failures.length ? { failedLinks: failures } : {}),
  };
}

/**
 * When the user deletes a skill's symlink for a single agent (e.g. `rm ~/.claude/skills/<skill>`),
 * honor that as "remove this skill from that agent" by deactivating it in the portal, instead of
 * recreating the symlink on the next sync. The cloud `agent_targets` are mutated in place so the
 * subsequent symlink reconciliation treats the link as undesired. Returns the number of
 * (skill, agent) pairs deactivated.
 */
async function deactivateDeletedAgentSkills(
  serverUrl: string,
  jwt: string,
  pullResponse: SyncPullResponse,
  previousState: NotisSyncState,
  scopedState: NotisSyncState,
  skillsDir: string,
  deps: Pick<
    RunSkillSyncDependencies,
    "detectDeletedAgentSymlinks" | "updateAgentTargets" | "pullSkills"
  >,
  failures: SkillSyncFailure[],
  linkOptions?: ReturnType<typeof isolatedLinkOptions>,
): Promise<number> {
  // First sync (incl. legacy migration) has no reliable "we created this link" signal, so we
  // cannot tell a user deletion apart from a never-created link — skip detection entirely.
  if (isEmptySyncState(scopedState)) {
    return 0;
  }

  const deletions = await deps.detectDeletedAgentSymlinks(
    pullResponse.skills.map(skill => {
      const previous = isNativeSkill(skill) ? Object.entries(previousState.skills).find(([, row]) => row.cloudId === skill.id) : undefined;
      return previous ? { ...skill, name: previous[0] } : skill;
    }),
    previousState,
    skillsDir,
    linkOptions,
  );
  if (deletions.length === 0) {
    return 0;
  }

  const agentsBySkill = new Map<string, { skillName: string; agents: Set<DeletedAgentSymlink["agent"]> }>();
  for (const deletion of deletions) {
    const entry = agentsBySkill.get(deletion.skillId) ?? {
      skillName: deletion.skillName,
      agents: new Set<DeletedAgentSymlink["agent"]>(),
    };
    entry.agents.add(deletion.agent);
    agentsBySkill.set(deletion.skillId, entry);
  }

  const fresh = withoutBaseSkills(await deps.pullSkills(serverUrl, jwt));
  assertSkillsPullAuthorized(fresh);
  assertSyncEnvironment(fresh, pullResponse);
  Object.assign(pullResponse, fresh);
  let needsRefresh = false;
  let deactivated = 0;
  for (const [skillId, { skillName, agents }] of agentsBySkill) {
    const skill = pullResponse.skills.find((item) => item.id === skillId);
    const previous = previousState.skills[skillName];
    if (!skill) continue;
    const native = isNativeSkill(skill);
    if (native) {
      if (!skill.native_settings || previous?.nativeSettingsRevision !== skill.native_settings.revision) continue;
    } else if (!skill.updated_at || previous?.cloudUpdatedAt !== skill.updated_at) continue;
    const patch = Object.fromEntries([...agents].map((agent) => [agent, false]));
    try {
      const saved = await deps.updateAgentTargets(serverUrl, jwt, skillId, patch,
        native ? undefined : skill.updated_at, native ? { reference: skill.native_reference!, settingsRevision: skill.native_settings!.revision } : undefined);
      if (saved.success !== true || !saved.updated_at?.trim()
        || (!native && saved.updated_at === skill.updated_at)
        || !['notis', 'claude_code', 'cursor', 'codex'].every((agent) =>
          typeof saved.agent_targets?.[agent as keyof AgentTargets] === 'boolean')
        || ![...agents].every((agent) => saved.agent_targets[agent] === false)) {
        throw new Error('Assignment update did not return a verified saved revision');
      }
      skill.agent_targets = saved.agent_targets;
      skill.updated_at = saved.updated_at;
      if (native) needsRefresh = true;
      deactivated += agents.size;
    } catch (error) {
      needsRefresh = true;
      failures.push({ name: skillName, error: 'Could not save the local agent removal; refreshed saved assignments' });
      console.warn(`[skill-sync] Assignment changed or could not be saved for "${skillName}"; refreshing before reconciliation.`, error);
    }
  }
  if (needsRefresh) {
    const refreshed = withoutBaseSkills(await deps.pullSkills(serverUrl, jwt));
    assertSkillsPullAuthorized(refreshed);
    assertSyncEnvironment(refreshed, pullResponse);
    Object.assign(pullResponse, refreshed);
  }
  return deactivated;
}

export async function runSkillSync(
  serverUrl: string,
  jwt: string,
  dependencies: Partial<RunSkillSyncDependencies> = {},
  options: RunSkillSyncOptions = {},
): Promise<RunSkillSyncResult> {
  const deps = {
    ...DEFAULT_RUN_SKILL_SYNC_DEPS,
    ...dependencies,
  };
  const syncSettings: SyncSettings = await deps.fetchSyncSettings(
    serverUrl,
    jwt,
  );
  // Supabase Desktop sessions use the auth-user id as JWT `sub`, while CLI
  // OAuth credentials use the canonical Notis `users.user_id`. Trust the
  // authenticated server response so both transports share one local mirror.
  // The token fallback keeps the CLI compatible with an older server during
  // rollout, where sync-settings did not yet return user_id.
  const syncUserId = syncSettings.user_id?.trim() || decodeJwtSubject(jwt);
  if (!syncUserId) {
    throw new Error(
      "Cannot sync skills without a server-verified account identity.",
    );
  }
  const syncPaths = getSkillSyncPathsForUser(syncUserId, undefined, syncSettings.sync_namespace, options.syncHome);
  if (options.honorSyncEnabled !== false && !syncSettings.sync_enabled) {
    // Disabled sync intentionally performs no pull. Only the authenticated
    // settings scope may remove foreign links; account mirrors stay untouched.
    const foreignLinksRemoved = await deps.removeForeignAccountSymlinks(
      syncPaths.skillsDir, isolatedLinkOptions(syncPaths),
    );
    return {
      syncEnabled: false,
      pushed: 0,
      pulled: 0,
      downloaded: 0,
      deleted: 0,
      deactivated: 0,
      linked: 0,
      removed: foreignLinksRemoved,
      skipped: 0,
      lastSyncedAt: syncSettings.last_synced_at,
      failedPushes: [],
    };
  }

  let pullResponse = withoutBaseSkills(await deps.pullSkills(serverUrl, jwt));
  assertSkillsPullAuthorized(pullResponse);
  assertSyncEnvironment(pullResponse, syncSettings);
  const foreignLinksRemoved = await deps.removeForeignAccountSymlinks(
    syncPaths.skillsDir, isolatedLinkOptions(syncPaths),
  );

  const cloudCuratedSkillNames = new Set(
    pullResponse.skills
      .filter((skill) => skill.source === "curated")
      .map((skill) => skill.name),
  );
  const protectedSkillNames = new Set([...cloudCuratedSkillNames, ...BASE_SKILL_NAMES]);
  const scopedState = withoutBaseSkillState(await deps.readSyncState(syncPaths));
  const assignmentFailures: SkillSyncFailure[] = [];
  const deactivated = !syncPaths.isolatedNamespace && syncSettings.agent_targets_conditional_updates === true
    ? await deactivateDeletedAgentSkills(
        serverUrl, jwt, pullResponse, scopedState, scopedState, syncPaths.skillsDir, deps, assignmentFailures, isolatedLinkOptions(syncPaths),
      )
    : 0;
  assertSyncEnvironment(pullResponse, syncSettings);
  const authUserId = decodeJwtSubject(jwt);
  let previousAuthState: NotisSyncState | null = null;
  if (!syncPaths.isolatedNamespace && authUserId && authUserId !== syncUserId) {
    const previousAuthPaths = getSkillSyncPathsForUser(authUserId, undefined, undefined, options.syncHome);
    previousAuthState = await deps.readSyncState(previousAuthPaths);
    await deps.gatherTopLevelLocalSkills(syncPaths, {
      sourceRoots: [{ label: "previous-auth-scope", root: previousAuthPaths.skillsDir }],
      protectedSkillNames,
    });
  }
  if (!syncPaths.isolatedNamespace) {
    await deps.gatherTopLevelLocalSkills(syncPaths, { protectedSkillNames });
  }
  const localSkills = (await deps.scanLocalSkills(syncPaths))
    .filter((skill) => !BASE_SKILL_NAMES.has(skill.name));
  const previousState = withoutBaseSkillState(applyLegacyFirstRunState(
    localSkills,
    scopedState,
    !syncPaths.isolatedNamespace && isEmptySyncState(scopedState)
      ? (!previousAuthState || isEmptySyncState(previousAuthState)
          ? await deps.readLegacySyncState(syncPaths)
          : previousAuthState)
      : null,
  ));
  pullResponse = bindNativeFolders(pullResponse, localSkills, previousState);
  const gatheredSymlinkResult = await deps.syncSymlinks(
    buildLocalSymlinkCandidates(pullResponse, localSkills, previousState),
    syncPaths.skillsDir,
    isolatedLinkOptions(syncPaths),
  );
  const pushCandidates = getPushCandidates(
    localSkills,
    previousState,
    cloudCuratedSkillNames,
    new Set(pullResponse.skills.map((skill) => skill.name)),
    pullResponse.skills,
  );

  const failedPushes: SkillSyncFailure[] = [];
  const acknowledgedNative = new Map<string, string>();
  let writeLocalSkills = localSkills;
  if (pushCandidates.length > 0) {
    const pushResult = await deps.pushChangedSkills(serverUrl, jwt, pushCandidates);
    for (const result of pushResult.skills || []) {
      const saved = result as { id?: string; native_reference?: unknown };
      const candidate = pushCandidates.find(local => local.nativeReference && local.cloudId === saved.id);
      if (candidate && saved.native_reference) {
        checkedNativeReference(saved.native_reference, candidate.cloudId);
        acknowledgedNative.set(candidate.cloudId!, candidate.folderHash);
      }
    }
    if (Array.isArray(pushResult?.failed) && pushResult.failed.length > 0) {
      failedPushes.push(...pushResult.failed);
      console.warn(
        `[skill-sync] ${pushResult.failed.length} skill(s) were rejected during push: ` +
          pushResult.failed.map((f) => `${f.name} (${f.error})`).join("; "),
      );
    }
    pullResponse = withoutBaseSkills(await deps.pullSkills(serverUrl, jwt));
    assertSkillsPullAuthorized(pullResponse);
    assertSyncEnvironment(pullResponse, syncSettings);
    writeLocalSkills = (await deps.scanLocalSkills(syncPaths)).filter(skill => !BASE_SKILL_NAMES.has(skill.name));
    pullResponse = bindNativeFolders(pullResponse, writeLocalSkills, previousState);
  }

  // Delete phase: remove skills that were previously synced but are no longer in the cloud
  const cloudSkillNames = new Set(pullResponse.skills.map((s) => s.name));
  let deleted = 0;
  for (const skillName of Object.keys(previousState.skills)) {
    if (!cloudSkillNames.has(skillName)) {
      const previous = previousState.skills[skillName];
      if (previous.nativeReference || previous.nativeUnavailable
          || pullResponse.skills.some(skill => isNativeSkill(skill) && skill.id === previous.cloudId)) {
        await deps.removeAllSymlinksForSkill(skillName, syncPaths.skillsDir, isolatedLinkOptions(syncPaths));
        continue;
      }
      await deps.deleteLocalSkill(skillName, syncPaths);
      await deps.removeAllSymlinksForSkill(skillName, syncPaths.skillsDir, isolatedLinkOptions(syncPaths));
      deleted += 1;
    }
  }

  const failedDownloads: SkillSyncFailure[] = [];
  const writtenSkillNames = new Set<string>();
  const appliedFilesByName: Record<string, string[]> = {};
  const downloaded = await writePulledSkillsToScopedMirror(
    pullResponse,
    writeLocalSkills,
    previousState,
    syncPaths,
    deps,
    failedDownloads,
    writtenSkillNames,
    appliedFilesByName,
    acknowledgedNative,
  );

  const finalLocalSkills = (await deps.scanLocalSkills(syncPaths))
    .filter((skill) => !BASE_SKILL_NAMES.has(skill.name));
  const symlinkResult = await deps.syncSymlinks(
    buildLocalSymlinkCandidates(pullResponse, finalLocalSkills, previousState),
    syncPaths.skillsDir,
    isolatedLinkOptions(syncPaths),
  );
  const verifiedLinks = { ...(symlinkResult.verifiedAgentLinks ?? {}) };
  for (const failure of failedDownloads) delete verifiedLinks[failure.name];
  const lastSyncedAt = pullResponse.last_synced_at || new Date().toISOString();

  await deps.writeSyncState(
    buildSyncState(
      pullResponse,
      finalLocalSkills,
      lastSyncedAt,
      verifiedLinks,
      new Set(failedDownloads.map(item => item.name)),
      collectAppliedCloudRevisions(pullResponse, previousState, writtenSkillNames),
      collectAppliedFiles(pullResponse, previousState, appliedFilesByName),
      previousState,
    ),
    syncPaths,
  );

  return {
    syncEnabled: true,
    pushed: pushCandidates.length,
    pulled: pullResponse.skills.length,
    downloaded,
    deleted,
    deactivated,
    linked: gatheredSymlinkResult.linked + symlinkResult.linked,
    removed: foreignLinksRemoved + gatheredSymlinkResult.removed + symlinkResult.removed,
    skipped: symlinkResult.skipped,
    failedLinks: [...assignmentFailures, ...failedDownloads, ...(symlinkResult.failures ?? []).filter(
      (failure) => !failedDownloads.some((download) => download.name === failure.name),
    )],
    lastSyncedAt,
    failedPushes,
  };
}
