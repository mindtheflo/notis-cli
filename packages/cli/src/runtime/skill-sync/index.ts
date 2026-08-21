import type {
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
  const downloaded = await writePulledSkillsToScopedMirror(
    pullResponse,
    localSkills,
    previousState,
    syncPaths,
    deps,
  );
  const finalLocalSkills = await deps.scanLocalSkills(syncPaths);
  const lastSyncedAt = pullResponse.last_synced_at || new Date().toISOString();

  const relinkSkillNames = new Set(options.relinkSkillNames || []);
  if (relinkSkillNames.size > 0) {
    await deps.syncSymlinks(
      pullResponse.skills.filter((skill) => relinkSkillNames.has(skill.name)),
      syncPaths.skillsDir,
      { removeUndesired: false },
    );
  }

  await deps.writeSyncState(
    buildSyncState(pullResponse, finalLocalSkills, lastSyncedAt),
    syncPaths,
  );

  return {
    pulled: pullResponse.skills.length,
    downloaded,
    deleted: 0,
    removed: 0,
    lastSyncedAt,
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

  // The agent-targets endpoint replaces the whole agent_targets column, so re-read the freshest
  // values right before writing and merge onto them, only flipping the deleted agent. This avoids
  // clobbering a concurrent portal/other-desktop change to a DIFFERENT agent with the stale
  // snapshot from the top-of-sync pull. (A narrow read-modify-write window remains; the endpoint
  // has no partial update.)
  const latestSkillsById = new Map(pullResponse.skills.map((skill) => [skill.id, skill]));
  let fresh: SyncPullResponse | null = null;
  try {
    fresh = await deps.pullSkills(serverUrl, jwt);
  } catch (error) {
    console.warn(
      "[skill-sync] Could not re-pull latest agent targets before deactivation; " +
        "using the top-of-sync snapshot.",
      error,
    );
  }
  if (fresh) {
    // A transport failure may fall back to the already-authorized snapshot, but
    // an explicit legacy denial must abort before any server or local mutation.
    assertSkillsPullAuthorized(fresh);
    for (const skill of fresh.skills) {
      latestSkillsById.set(skill.id, skill);
    }
  }

  // Group deletions by skill so multiple deleted agents for the SAME skill are flipped in one
  // PATCH. Otherwise each PATCH, rebuilt from the same snapshot, would overwrite the previous one
  // (deleting both claude_code and cursor for one skill would otherwise leave only the last off).
  const agentsBySkill = new Map<string, { skillName: string; agents: Set<DeletedAgentSymlink["agent"]> }>();
  for (const deletion of deletions) {
    const entry = agentsBySkill.get(deletion.skillId) ?? {
      skillName: deletion.skillName,
      agents: new Set<DeletedAgentSymlink["agent"]>(),
    };
    entry.agents.add(deletion.agent);
    agentsBySkill.set(deletion.skillId, entry);
  }

  const inMemoryById = new Map(pullResponse.skills.map((skill) => [skill.id, skill]));
  let deactivated = 0;
  for (const [skillId, { skillName, agents }] of agentsBySkill) {
    const latest = latestSkillsById.get(skillId);
    if (!latest) {
      continue;
    }
    const nextTargets = { ...normalizeAgentTargets(latest.agent_targets) };
    for (const agent of agents) {
      nextTargets[agent] = false;
    }
    try {
      await deps.updateAgentTargets(serverUrl, jwt, skillId, nextTargets);
      // Mutate the in-memory pull response so the symlink passes below see the link as undesired.
      const inMemory = inMemoryById.get(skillId);
      if (inMemory) {
        inMemory.agent_targets = nextTargets;
      }
      deactivated += agents.size;
    } catch (error) {
      console.warn(
        `[skill-sync] Failed to deactivate "${skillName}" for ${[...agents].join(", ")} ` +
          `after local symlink deletion:`,
        error,
      );
    }
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
  const scopedState = withoutBaseSkillState(await deps.readSyncState(syncPaths));
  const previousState = withoutBaseSkillState(applyLegacyFirstRunState(
    localSkills,
    scopedState,
    isEmptySyncState(scopedState)
      ? (!previousAuthState || isEmptySyncState(previousAuthState)
          ? await deps.readLegacySyncState(syncPaths)
          : previousAuthState)
      : null,
  ));
  // Honor locally-deleted per-agent symlinks as deactivations before reconciling, otherwise the
  // first syncSymlinks pass would recreate the link the user just deleted.
  const deactivated = await deactivateDeletedAgentSkills(
    serverUrl,
    jwt,
    pullResponse,
    previousState,
    scopedState,
    syncPaths.skillsDir,
    deps,
  );
  await deps.syncSymlinks(
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

  const downloaded = await writePulledSkillsToScopedMirror(
    pullResponse,
    localSkills,
    previousState,
    syncPaths,
    deps,
  );

  const finalLocalSkills = (await deps.scanLocalSkills(syncPaths))
    .filter((skill) => !BASE_SKILL_NAMES.has(skill.name));
  const symlinkResult = await deps.syncSymlinks(
    buildLocalSymlinkCandidates(pullResponse, finalLocalSkills, previousState),
    syncPaths.skillsDir,
  );
  const lastSyncedAt = pullResponse.last_synced_at || new Date().toISOString();

  await deps.writeSyncState(
    buildSyncState(pullResponse, finalLocalSkills, lastSyncedAt),
    syncPaths,
  );

  return {
    syncEnabled: true,
    pushed: pushCandidates.length,
    pulled: pullResponse.skills.length,
    downloaded,
    deleted,
    deactivated,
    linked: symlinkResult.linked,
    removed: foreignLinksRemoved + symlinkResult.removed,
    skipped: symlinkResult.skipped,
    lastSyncedAt,
    failedPushes,
  };
}
