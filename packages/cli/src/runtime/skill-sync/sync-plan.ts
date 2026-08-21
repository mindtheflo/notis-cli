import type { LocalSkill, NotisSyncState } from "./types";

export function getPushCandidates(
  localSkills: LocalSkill[],
  syncState: NotisSyncState,
  cloudCuratedSkillNames: ReadonlySet<string> = new Set(),
  cloudSkillNames?: ReadonlySet<string>,
): LocalSkill[] {
  return localSkills.filter((skill) => {
    if (cloudCuratedSkillNames.has(skill.name)) {
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
