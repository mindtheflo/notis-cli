import { captureNativeSkillFiles, createSkillBundleBase64 } from './local-scanner';
import { createHash } from 'node:crypto';
import { checkedNativeReference } from './native-identity';
import type { AgentTargets, LocalSkill, NativeSkillReference, SkillSyncFailure, SyncPullResponse, SyncPushResponse, SyncSettings } from './types';

type JsonBody = Record<string, unknown> | undefined;

async function requestJson<T>(
  url: string,
  jwt: string,
  options: { method?: string; body?: JsonBody } = {},
): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new SkillSyncHttpError(
      `${options.method || 'POST'} ${url} → ${response.status}: ${text}`,
      response.status,
      response.headers.get('content-type'),
    );
  }

  return response.json() as Promise<T>;
}

/**
 * A non-2xx answer, classified so a status can be recorded without its body:
 * `edge_blocked` for an HTML 403 (the edge in front of the API refused the
 * request before it reached Notis), `http_<status>` otherwise.
 */
export class SkillSyncHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, contentType: string | null) {
    super(message);
    this.name = 'SkillSyncHttpError';
    this.status = status;
    this.code = status === 403 && /text\/html/i.test(contentType || '') ? 'edge_blocked' : `http_${status}`;
  }
}

export async function fetchSyncSettings(serverUrl: string, jwt: string): Promise<SyncSettings> {
  return requestJson<SyncSettings>(`${serverUrl}/portal_skills/sync-settings`, jwt, {
    body: {},
  });
}

export async function pullSkills(serverUrl: string, jwt: string): Promise<SyncPullResponse> {
  return requestJson<SyncPullResponse>(`${serverUrl}/portal_skills/sync-pull`, jwt, {
    body: { skill_sync_protocol: 2 },
  });
}

/** Largest sync-push body sent at once; a single larger skill goes alone. */
export const MAX_SYNC_PUSH_BODY_BYTES = 2 * 1024 * 1024;

async function skillPushPayload(skill: LocalSkill): Promise<Record<string, unknown>> {
  return {
    name: skill.name,
    description: skill.description,
    skill_md: skill.skillMd,
    source_url: skill.sourceUrl,
    folder_hash: skill.folderHash,
    ...(skill.nativeReference ? { bundle_files: await captureNativeSkillFiles(skill) }
      : { bundle_base64: await createSkillBundleBase64(skill) }),
    ...(skill.cloudId ? { cloud_id: skill.cloudId } : {}),
    ...(skill.nativeReference ? { native_reference: skill.nativeReference, display_name: skill.displayName,
      native_scope: skill.nativeScope } : {}),
  };
}

/** The request body around the skills array, counted in every batch's size. */
const SYNC_PUSH_ENVELOPE_BYTES = Buffer.byteLength(JSON.stringify({ skill_sync_protocol: 2, skills: [] }));

function pushBatches(payloads: Record<string, unknown>[], maxBodyBytes: number): Record<string, unknown>[][] {
  const batches: Record<string, unknown>[][] = [];
  let batch: Record<string, unknown>[] = [];
  let batchBytes = SYNC_PUSH_ENVELOPE_BYTES;
  for (const payload of payloads) {
    // +1 for the comma between array items.
    const bytes = Buffer.byteLength(JSON.stringify(payload)) + 1;
    if (batch.length > 0 && batchBytes + bytes > maxBodyBytes) {
      batches.push(batch);
      batch = [];
      batchBytes = SYNC_PUSH_ENVELOPE_BYTES;
    }
    batch.push(payload);
    batchBytes += bytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function pushFailure(name: string, error: unknown): SkillSyncFailure {
  if (error instanceof SkillSyncHttpError) {
    return {
      name,
      error: error.code === 'edge_blocked'
        ? `Upload blocked before reaching Notis (HTTP ${error.status}); sync will retry`
        : `Upload failed (HTTP ${error.status}); sync will retry`,
      status: error.status,
      code: error.code,
    };
  }
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'push_failed';
  return { name, error: 'Upload failed; sync will retry', code };
}

/**
 * Push changed skills in bodies of at most `maxBodyBytes` (one skill when it is
 * larger alone). A batch the server or the edge refuses fails only its own skills,
 * recorded with the HTTP status, and the other batches still push.
 */
export async function pushChangedSkills(
  serverUrl: string,
  jwt: string,
  changedSkills: LocalSkill[],
  options: { maxBodyBytes?: number } = {},
): Promise<SyncPushResponse> {
  const payloadSkills = await Promise.all(changedSkills.map(skillPushPayload));
  const saved: unknown[] = [];
  const failed: SkillSyncFailure[] = [];
  for (const batch of pushBatches(payloadSkills, options.maxBodyBytes ?? MAX_SYNC_PUSH_BODY_BYTES)) {
    try {
      const result = await requestJson<SyncPushResponse>(`${serverUrl}/portal_skills/sync-push`, jwt, {
        body: {
          skill_sync_protocol: 2,
          skills: batch,
        },
      });
      saved.push(...(result.skills || []));
      if (Array.isArray(result.failed)) failed.push(...result.failed);
    } catch (error) {
      // A rejected sign-in fails every batch alike: stop and let the sync report it.
      if (error instanceof SkillSyncHttpError && error.status === 401) throw error;
      for (const payload of batch) failed.push(pushFailure(String(payload.name), error));
    }
  }
  return { skills: saved, ...(failed.length ? { failed } : {}) };
}

export async function updateAgentTargets(
  serverUrl: string,
  jwt: string,
  skillId: string,
  targets: Partial<AgentTargets>,
  expectedUpdatedAt?: string,
  native?: { reference: NativeSkillReference; settingsRevision: number },
): Promise<{ success: boolean; agent_targets: AgentTargets; updated_at?: string }> {
  if (native) {
    checkedNativeReference(native.reference, skillId);
    if (!Number.isSafeInteger(native.settingsRevision) || native.settingsRevision < 0) throw new Error('Refresh native Skill settings before changing assignments.');
    const payload = { operation: 'update', target: { skill_id: skillId, access_revision: native.reference.access_revision },
      revision: native.settingsRevision, patch: { agent_targets: Object.fromEntries(Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))) } };
    const requestId = 'sync-settings-' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const saved = await requestJson<{ receipt_id: string; skill_id: string; target: { skill_id: string }; settings: { agent_targets: AgentTargets; updated_at: string };
      current?: { target: { skill_id: string }; settings: { agent_targets: AgentTargets; updated_at: string } } }>(`${serverUrl}/portal_skills/native-settings`, jwt,
      { body: { ...payload, request_id: requestId } });
    const current = saved.current || saved;
    if (saved.skill_id !== skillId || typeof saved.receipt_id !== 'string' || !saved.receipt_id
        || current.target?.skill_id !== skillId || !current.settings) throw new Error('Native assignment update was not confirmed.');
    return { success: true, agent_targets: current.settings.agent_targets, updated_at: current.settings.updated_at };
  }
  return requestJson<{ success: boolean; agent_targets: AgentTargets; updated_at?: string }>(`${serverUrl}/portal_skills/agent-targets`, jwt, {
    method: 'PATCH',
    body: {
      skill_id: skillId,
      agent_targets: targets,
      ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}),
    },
  });
}

// Install (enabled=true) or uninstall (enabled=false) the curated computer-use
// skill for the user, matching the desktop app's "Desktop Use" toggle.
export async function setComputerUseSkill(
  serverUrl: string,
  jwt: string,
  enabled: boolean,
): Promise<{ installed: boolean }> {
  return requestJson<{ installed: boolean }>(`${serverUrl}/portal_skills/desktop-use`, jwt, {
    body: { enabled, name: 'notis-desktop-use' },
  });
}
