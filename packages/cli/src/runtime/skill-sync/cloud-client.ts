import { captureNativeSkillFiles, createSkillBundleBase64 } from './local-scanner';
import { createHash } from 'node:crypto';
import { checkedNativeReference } from './native-identity';
import type { AgentTargets, LocalSkill, NativeSkillReference, SyncPullResponse, SyncPushResponse, SyncSettings } from './types';

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
    throw new Error(`${options.method || 'POST'} ${url} → ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
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

export async function pushChangedSkills(
  serverUrl: string,
  jwt: string,
  changedSkills: LocalSkill[],
): Promise<SyncPushResponse> {
  const payloadSkills = await Promise.all(changedSkills.map(async (skill) => ({
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
  })));

  return requestJson<SyncPushResponse>(`${serverUrl}/portal_skills/sync-push`, jwt, {
    body: {
      skill_sync_protocol: 2,
      skills: payloadSkills,
    },
  });
}

export async function downloadSkillBundle(bundleUrl: string): Promise<Buffer> {
  const response = await fetch(bundleUrl, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${bundleUrl} → ${response.status}: ${text}`);
  }

  return Buffer.from(await response.arrayBuffer());
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
