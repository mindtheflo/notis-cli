import type { CloudSkill, LocalSkill, NotisSyncState, SyncPullResponse } from './types';
import { checkedNativeReference, isNativeSkill, sameNativeReference } from './native-identity';

/** Folder names may change; existing managed cloud identity may not. */
export function bindNativeFolders(response: SyncPullResponse, locals: LocalSkill[], state: NotisSyncState): SyncPullResponse {
  const nativeIds = new Set(response.skills.filter(isNativeSkill).map(skill => skill.id));
  for (const entry of Object.values(state.skills)) if (entry.nativeReference || entry.nativeUnavailable) nativeIds.add(entry.cloudId);
  const byId = new Map<string, LocalSkill>();
  for (const local of locals) {
    const id = local.cloudId || state.skills[local.name]?.cloudId;
    if (!id || (!nativeIds.has(id) && !local.nativeReference)) continue;
    if (local.nativeReference) checkedNativeReference(local.nativeReference, id);
    if (byId.has(id)) throw new Error('Two local folders claim the same native Skill. Keep both copies and resolve the conflict.');
    byId.set(id, local);
  }
  const skills = response.skills.map(skill => isNativeSkill(skill) && byId.has(skill.id)
    ? { ...skill, name: byId.get(skill.id)!.name } : skill);
  for (const skill of skills.filter(isNativeSkill)) {
    if (skills.some(other => other.id !== skill.id && other.name === skill.name)) {
      throw new Error('A native Skill and another Skill share a local folder. Existing files were retained.');
    }
  }
  return { ...response, skills };
}

export function previousNativeState(state: NotisSyncState, skill: CloudSkill) {
  const named = state.skills[skill.name];
  return named?.cloudId === skill.id ? named : Object.values(state.skills).find(entry => entry.cloudId === skill.id);
}

export function nativeLocalReady(skill: CloudSkill, local?: LocalSkill): boolean {
  return Boolean(local?.nativeFilesCurrent && local.folderHash === local.nativeBaseFolderHash
    && local.cloudId === skill.id && local.nativeScope === skill.native_scope
    && sameNativeReference(local.nativeReference, skill.native_reference));
}

export function nativeLinkRows(response: SyncPullResponse, locals: LocalSkill[]): CloudSkill[] {
  return response.skills.map(skill => isNativeSkill(skill) && !nativeLocalReady(skill, locals.find(row => row.name === skill.name))
    ? { ...skill, status: 'disabled' } : skill);
}

export function retainMissingNativeState(previous: NotisSyncState, next: NotisSyncState): NotisSyncState {
  const present = new Set(Object.values(next.skills).map(row => row.cloudId));
  const retained = Object.fromEntries(Object.entries(previous.skills)
    .filter(([, row]) => (row.nativeReference || row.nativeUnavailable) && !present.has(row.cloudId))
    .map(([name, row]) => [name, { ...row, nativeUnavailable: true, verifiedAgentLinks: {} }]));
  const history = structuredClone(previous.nativeHistory || {});
  for (const [name, row] of [...Object.entries(previous.skills), ...Object.entries(next.skills)]) {
    if (!row.nativeReference && !row.nativeUnavailable) continue;
    const names = history[row.cloudId]?.names || [];
    history[row.cloudId] = { names: [...new Set([...names, name])] };
  }
  return { ...next, skills: { ...retained, ...next.skills },
    ...(Object.keys(history).length ? { nativeHistory: history } : {}) };
}

export function hasNativeFolderHistory(state: NotisSyncState, name: string): boolean {
  return Object.values(state.nativeHistory || {}).some(row => row.names.includes(name));
}
