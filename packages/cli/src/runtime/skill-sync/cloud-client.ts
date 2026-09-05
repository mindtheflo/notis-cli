import { createSkillBundleBase64 } from './local-scanner';
import type { AgentTargets, LocalSkill, SyncPullResponse, SyncPushResponse, SyncSettings } from './types';

type JsonBody = Record<string, unknown> | undefined;

async function requestJson<T>(
  url: string,
  jwt: string,
  options: { method?: string; body?: JsonBody } = {},
): Promise<T> {
  const response = await fetch(url, {
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
    body: {},
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
    bundle_base64: await createSkillBundleBase64(skill),
  })));

  return requestJson<SyncPushResponse>(`${serverUrl}/portal_skills/sync-push`, jwt, {
    body: {
      skills: payloadSkills,
    },
  });
}

export async function downloadSkillBundle(bundleUrl: string): Promise<Buffer> {
  const response = await fetch(bundleUrl);
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
): Promise<{ success: boolean; agent_targets: AgentTargets; updated_at?: string }> {
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
