import type { CloudSkill, LocalSkill, NotisSyncState } from "./types";
import { isNativeSkill } from './native-identity';
import { hasNativeFolderHistory } from './native-plan';

/**
 * One cloud row per local folder. Several active rows can carry the same skill name
 * (duplicates created by earlier pushes), and every one of them writes to the same
 * directory. Applying them all in
 * one pass replaced that directory several times per sync and left whichever row came
 * last on disk. The newest revision wins, deterministically.
 */
export function selectCloudSkillsToApply(skills: CloudSkill[]): CloudSkill[] {
  const winners = new Map<string, CloudSkill>();
  for (const skill of skills) {
    const current = winners.get(skill.name);
    if (!current || (skill.updated_at || "") >= (current.updated_at || "")) {
      winners.set(skill.name, skill);
    }
  }
  return [...winners.values()];
}

export function getPushCandidates(
  localSkills: LocalSkill[],
  syncState: NotisSyncState,
  cloudCuratedSkillNames: ReadonlySet<string> = new Set(),
  cloudSkillNames?: ReadonlySet<string>,
  cloudSkills: CloudSkill[] = [],
): LocalSkill[] {
  return localSkills.filter((skill) => {
    if (cloudCuratedSkillNames.has(skill.name)) {
      return false;
    }
    const previous = syncState.skills[skill.name]
      || (skill.cloudId ? Object.values(syncState.skills).find(row => row.cloudId === skill.cloudId) : undefined);
    const native = cloudSkills.find(row => isNativeSkill(row) && row.id === (skill.cloudId || previous?.cloudId));
    if (native || skill.nativeReference || previous?.nativeReference || previous?.nativeUnavailable) {
      return Boolean(native && skill.nativeReference && skill.nativeScope === native.native_scope
        && (previous ? previous.folderHash !== skill.folderHash : skill.nativeBaseFolderHash !== skill.folderHash));
    }
    if (!previous) {
      if (hasNativeFolderHistory(syncState, skill.name) || /^native-[a-f0-9-]{36}$/.test(skill.name)) return false;
      return true;
    }
    if (cloudSkillNames && !cloudSkillNames.has(skill.name)) {
      return false;
    }
    return previous.folderHash !== skill.folderHash;
  }).map(skill => {
    const previous = syncState.skills[skill.name]
      || Object.values(syncState.skills).find(row => row.cloudId === skill.cloudId);
    return { ...skill, ...(skill.cloudId || previous?.cloudId ? { cloudId: skill.cloudId || previous!.cloudId } : {}) };
  });
}
