import type { CloudSkill, LocalSkill, NotisSyncState } from "./types";

/**
 * One cloud row per local folder. Several active rows can carry the same skill name
 * (an app's source skill plus its installed clone, or duplicates created by earlier
 * pushes), and every one of them writes to the same directory. Applying them all in
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
  cloudAppOwnedSkillNames: ReadonlySet<string> = new Set(),
): LocalSkill[] {
  return localSkills.filter((skill) => {
    if (cloudCuratedSkillNames.has(skill.name)) {
      return false;
    }
    // App-owned content belongs to the installed app's release, not to this account.
    // Pushing it created a second row with the same name on every local difference,
    // and each new row then fought over the same folder.
    if (cloudAppOwnedSkillNames.has(skill.name)) {
      return false;
    }
    const previous = syncState.skills[skill.name];
    if (!previous) {
      return true;
    }
    if (cloudSkillNames && !cloudSkillNames.has(skill.name)) {
      return false;
    }
    return previous.folderHash !== skill.folderHash;
  });
}
