import type {
  AgentTargets,
  LocalSkill,
  NotisSyncState,
  SkillSyncFailure,
  SyncPullResponse,
  SyncSettings,
} from "./types";
import { normalizeAgentTargets } from "./types";
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
import { getPushCandidates } from "./sync-plan";
import { writeCloudSkillWithBundleFallback } from "./write-cloud-skill";

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
  pulled: number;
  downloaded: number;
  deleted: number;
  removed: number;
  lastSyncedAt: string | null;
  failedLinks?: SkillSyncFailure[];
}

export interface MaterializeCloudSkillsOptions {
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

function shouldWriteCloudSkill(
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

  if (cloudSkill.source === "curated") {
    return cloudHash ? cloudHash !== localSkill.folderHash : true;
  }

  const previous = previousState.skills[skillName];
  const localChangedSinceLastSync =
    !previous || previous.folderHash !== localSkill.folderHash;
  return (
    !localChangedSinceLastSync &&
    Boolean(cloudHash) &&
    cloudHash !== localSkill.folderHash
  );
}

function buildSyncState(
  pullResponse: SyncPullResponse,
  localSkills: LocalSkill[],
  lastSyncedAt: string | null,
  verifiedAgentLinks: Record<string, Partial<AgentTargets>> = {},
): NotisSyncState {
  const localSkillMap = toSkillMap(localSkills);
  const skills = Object.fromEntries(
    pullResponse.skills.map((skill) => {
      const localSkill = localSkillMap.get(skill.name);
      return [
        skill.name,
        {
          cloudId: skill.id,
          folderHash: localSkill?.folderHash || skill.skill_folder_hash || "",
          agentTargets: normalizeAgentTargets(skill.agent_targets),
          verifiedAgentLinks: skill.status === "active" ? verifiedAgentLinks[skill.name] ?? {} : {},
          cloudUpdatedAt: skill.updated_at,
          syncedAt: lastSyncedAt || new Date().toISOString(),
        },
      ];
    }),
  );

  return {
    version: 1,
    lastSyncedAt,
    skills,
  };
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

  return [...pullResponse.skills, ...localOnlySkills];
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
): Promise<number> {
  const localSkillMap = toSkillMap(localSkills);
  const warnSkillSync = (message: string, error: unknown): void => {
    console.warn(`[Notis] ${message}`, error);
  };

  let downloaded = 0;
  for (const cloudSkill of pullResponse.skills) {
    if (!shouldWriteCloudSkill(cloudSkill, localSkillMap, previousState)) {
      continue;
    }

    if (
      await writeCloudSkillWithBundleFallback(cloudSkill, {
        downloadSkillBundle: deps.downloadSkillBundle,
        writeCloudSkillToDisk: (skill, bundleBytes) =>
          deps.writeCloudSkillToDisk(skill, bundleBytes, syncPaths),
        onWarning: warnSkillSync,
      })
    ) {
      downloaded += 1;
    } else {
      failures.push({ name: cloudSkill.name, error: "Skill content could not be downloaded or written; sync will retry" });
    }
  }

  return downloaded;
}

function assertSkillsPullAuthorized(
  pullResponse: SyncPullResponse,
): void {
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

  const syncPaths = getSkillSyncPathsForUser(authUserId);
  const pullResponse = await deps.pullSkills(serverUrl, jwt);
  assertSkillsPullAuthorized(pullResponse);
  const previousState = await deps.readSyncState(syncPaths);

  const localSkills = await deps.scanLocalSkills(syncPaths);
  const failedDownloads: SkillSyncFailure[] = [];
  const downloaded = await writePulledSkillsToScopedMirror(
    pullResponse,
    localSkills,
    previousState,
    syncPaths,
    deps,
    failedDownloads,
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
      pullResponse.skills.filter((skill) => relinkSkillNames.has(skill.name)),
      syncPaths.skillsDir,
      { removeUndesired: false },
    );
    failures.push(...(relinked.failures ?? []).filter(
      (failure) => !failedDownloads.some((download) => download.name === failure.name),
    ));
    for (const name of relinkSkillNames) {
      verifiedLinks[name] = relinked.verifiedAgentLinks?.[name] ?? {};
    }
  }
  for (const failure of failedDownloads) delete verifiedLinks[failure.name];

  await deps.writeSyncState(
    buildSyncState(pullResponse, finalLocalSkills, lastSyncedAt, verifiedLinks),
    syncPaths,
  );

  return {
    pulled: pullResponse.skills.length,
    downloaded,
    deleted: 0,
    removed: 0,
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
): Promise<number> {
  // First sync (incl. legacy migration) has no reliable "we created this link" signal, so we
  // cannot tell a user deletion apart from a never-created link — skip detection entirely.
  if (isEmptySyncState(scopedState)) {
    return 0;
  }

  const deletions = await deps.detectDeletedAgentSymlinks(
    pullResponse.skills,
    previousState,
    skillsDir,
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
  Object.assign(pullResponse, fresh);
  let needsRefresh = false;
  let deactivated = 0;
  for (const [skillId, { skillName, agents }] of agentsBySkill) {
    const skill = pullResponse.skills.find((item) => item.id === skillId);
    const previous = previousState.skills[skillName];
    if (!skill?.updated_at || previous?.cloudUpdatedAt !== skill.updated_at) continue;
    const patch = Object.fromEntries([...agents].map((agent) => [agent, false]));
    try {
      const saved = await deps.updateAgentTargets(serverUrl, jwt, skillId, patch, skill.updated_at);
      if (saved.success !== true || !saved.updated_at?.trim()
        || saved.updated_at === skill.updated_at
        || !['notis', 'claude_code', 'cursor', 'codex'].every((agent) =>
          typeof saved.agent_targets?.[agent as keyof AgentTargets] === 'boolean')
        || ![...agents].every((agent) => saved.agent_targets[agent] === false)) {
        throw new Error('Assignment update did not return a verified saved revision');
      }
      skill.agent_targets = saved.agent_targets;
      skill.updated_at = saved.updated_at;
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
  const syncPaths = getSkillSyncPathsForUser(syncUserId);
  const foreignLinksRemoved = await deps.removeForeignAccountSymlinks(
    syncPaths.skillsDir,
  );
  if (options.honorSyncEnabled !== false && !syncSettings.sync_enabled) {
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

  const cloudCuratedSkillNames = new Set(
    pullResponse.skills
      .filter((skill) => skill.source === "curated")
      .map((skill) => skill.name),
  );
  const protectedSkillNames = new Set([...cloudCuratedSkillNames, ...BASE_SKILL_NAMES]);
  const scopedState = withoutBaseSkillState(await deps.readSyncState(syncPaths));
  const assignmentFailures: SkillSyncFailure[] = [];
  const deactivated = syncSettings.agent_targets_conditional_updates === true
    ? await deactivateDeletedAgentSkills(
        serverUrl, jwt, pullResponse, scopedState, scopedState, syncPaths.skillsDir, deps, assignmentFailures,
      )
    : 0;
  const authUserId = decodeJwtSubject(jwt);
  let previousAuthState: NotisSyncState | null = null;
  if (authUserId && authUserId !== syncUserId) {
    const previousAuthPaths = getSkillSyncPathsForUser(authUserId);
    previousAuthState = await deps.readSyncState(previousAuthPaths);
    await deps.gatherTopLevelLocalSkills(syncPaths, {
      sourceRoots: [{ label: "previous-auth-scope", root: previousAuthPaths.skillsDir }],
      protectedSkillNames,
    });
  }
  await deps.gatherTopLevelLocalSkills(syncPaths, {
    protectedSkillNames,
  });
  const localSkills = (await deps.scanLocalSkills(syncPaths))
    .filter((skill) => !BASE_SKILL_NAMES.has(skill.name));
  const previousState = withoutBaseSkillState(applyLegacyFirstRunState(
    localSkills,
    scopedState,
    isEmptySyncState(scopedState)
      ? (!previousAuthState || isEmptySyncState(previousAuthState)
          ? await deps.readLegacySyncState(syncPaths)
          : previousAuthState)
      : null,
  ));
  const gatheredSymlinkResult = await deps.syncSymlinks(
    buildLocalSymlinkCandidates(pullResponse, localSkills, previousState),
    syncPaths.skillsDir,
  );
  const pushCandidates = getPushCandidates(
    localSkills,
    previousState,
    cloudCuratedSkillNames,
    new Set(pullResponse.skills.map((skill) => skill.name)),
  );

  const failedPushes: SkillSyncFailure[] = [];
  if (pushCandidates.length > 0) {
    const pushResult = await deps.pushChangedSkills(serverUrl, jwt, pushCandidates);
    if (Array.isArray(pushResult?.failed) && pushResult.failed.length > 0) {
      failedPushes.push(...pushResult.failed);
      console.warn(
        `[skill-sync] ${pushResult.failed.length} skill(s) were rejected during push: ` +
          pushResult.failed.map((f) => `${f.name} (${f.error})`).join("; "),
      );
    }
    pullResponse = withoutBaseSkills(await deps.pullSkills(serverUrl, jwt));
    assertSkillsPullAuthorized(pullResponse);
  }

  // Delete phase: remove skills that were previously synced but are no longer in the cloud
  const cloudSkillNames = new Set(pullResponse.skills.map((s) => s.name));
  let deleted = 0;
  for (const skillName of Object.keys(previousState.skills)) {
    if (!cloudSkillNames.has(skillName)) {
      await deps.deleteLocalSkill(skillName, syncPaths);
      await deps.removeAllSymlinksForSkill(skillName, syncPaths.skillsDir);
      deleted += 1;
    }
  }

  const failedDownloads: SkillSyncFailure[] = [];
  const downloaded = await writePulledSkillsToScopedMirror(
    pullResponse,
    localSkills,
    previousState,
    syncPaths,
    deps,
    failedDownloads,
  );

  const finalLocalSkills = (await deps.scanLocalSkills(syncPaths))
    .filter((skill) => !BASE_SKILL_NAMES.has(skill.name));
  const symlinkResult = await deps.syncSymlinks(
    buildLocalSymlinkCandidates(pullResponse, finalLocalSkills, previousState),
    syncPaths.skillsDir,
  );
  const verifiedLinks = { ...(symlinkResult.verifiedAgentLinks ?? {}) };
  for (const failure of failedDownloads) delete verifiedLinks[failure.name];
  const lastSyncedAt = pullResponse.last_synced_at || new Date().toISOString();

  await deps.writeSyncState(
    buildSyncState(pullResponse, finalLocalSkills, lastSyncedAt, verifiedLinks),
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
