import type { CloudSkill, SkillWriteOutcome } from './types';

interface WriteCloudSkillDependencies {
  writeCloudSkillToDisk: (skill: CloudSkill) => Promise<SkillWriteOutcome | boolean>;
  onWarning?: (message: string, error: unknown) => void;
}

/**
 * Writes one pulled Skill from what the pull itself carries: its saved files
 * (`bundle_files`) or, without them, its SKILL.md. Nothing is downloaded;
 * `skill_source_url` only records where a Skill came from (SKL-059).
 */
export async function writeCloudSkill(
  skill: CloudSkill,
  dependencies: WriteCloudSkillDependencies,
): Promise<SkillWriteOutcome | boolean> {
  if (skill.bundle_hydration_failed) {
    dependencies.onWarning?.(
      `Skipping markdown fallback for synced skill "${skill.name}" because its stored bundle could not be hydrated by the server.`,
      new Error('Bundle hydration failed'),
    );
    return false;
  }

  try {
    return await dependencies.writeCloudSkillToDisk(skill);
  } catch (error) {
    dependencies.onWarning?.(
      `Failed to write synced skill "${skill.name}" to disk.`,
      error,
    );
    return false;
  }
}
