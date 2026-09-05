export interface AgentTargets {
  notis: boolean;
  claude_code: boolean;
  cursor: boolean;
  codex: boolean;
}

export interface SyncedSkill {
  cloudId: string;
  folderHash: string;
  agentTargets: AgentTargets;
  /** Actual readable managed links, never inferred from desired targets. */
  verifiedAgentLinks?: Partial<AgentTargets>;
  cloudUpdatedAt?: string;
  syncedAt: string;
}

export interface NotisSyncState {
  version: 1;
  lastSyncedAt: string | null;
  skills: Record<string, SyncedSkill>;
}

export interface LocalSkill {
  name: string;
  skillMd: string;
  description: string;
  folderHash: string;
  directoryPath: string;
  sourceUrl?: string;
  bundleFiles?: BundleFile[];
}

export interface BundleFile {
  path: string;
  content_b64: string;
}

export interface CloudSkill {
  updated_at?: string;
  id: string;
  name: string;
  description: string | null;
  skill_md: string | null;
  agent_targets?: Partial<AgentTargets> | null;
  skill_folder_hash?: string | null;
  skill_source_url?: string | null;
  bundle_files?: BundleFile[] | null;
  bundle_hydration_failed?: boolean | null;
  source: string;
  status: string;
}

export interface SyncSettings {
  agent_targets_conditional_updates?: boolean;
  /** Server-verified canonical Notis account id used to scope local mirrors. */
  user_id?: string;
  sync_enabled: boolean;
  last_synced_at: string | null;
}

export interface EntitlementAccessDetail {
  status: "error";
  code: "entitlement_upgrade_required";
  upgrade_required: true;
  entitlement: string;
  required_plan: string;
  upgrade_url: string;
  message: string;
  next_action: Record<string, unknown>;
}

export interface SyncPullResponse {
  skills: CloudSkill[];
  sync_enabled: boolean;
  last_synced_at: string | null;
  /** Legacy servers could return a successful empty denial. Current servers
   * return HTTP 403; either form must preserve existing local state. */
  entitlement_access?: EntitlementAccessDetail;
}

/** A skill the server could not sync, with a user-facing reason (e.g. an invalid
 * SKILL.md description rejected by OpenAI). One bad skill no longer fails the batch. */
export interface SkillSyncFailure {
  name: string;
  error: string;
}

export interface SyncPushResponse {
  skills: unknown[];
  failed?: SkillSyncFailure[];
}

export const DEFAULT_AGENT_TARGETS: AgentTargets = {
  notis: true,
  claude_code: true,
  cursor: true,
  codex: true,
};

export function normalizeAgentTargets(targets?: Partial<AgentTargets> | null): AgentTargets {
  return {
    notis: Boolean(targets?.notis ?? DEFAULT_AGENT_TARGETS.notis),
    claude_code: Boolean(targets?.claude_code ?? DEFAULT_AGENT_TARGETS.claude_code),
    cursor: Boolean(targets?.cursor ?? DEFAULT_AGENT_TARGETS.cursor),
    codex: Boolean(targets?.codex ?? DEFAULT_AGENT_TARGETS.codex),
  };
}
