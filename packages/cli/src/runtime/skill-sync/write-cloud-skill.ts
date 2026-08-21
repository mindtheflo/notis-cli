import type { CloudSkill } from './types';

interface WriteCloudSkillDependencies {
  downloadSkillBundle: (bundleUrl: string) => Promise<Buffer>;
  writeCloudSkillToDisk: (skill: CloudSkill, bundleBytes?: Buffer) => Promise<boolean>;
  onWarning?: (message: string, error: unknown) => void;
}

export async function writeCloudSkillWithBundleFallback(
  skill: CloudSkill,
  dependencies: WriteCloudSkillDependencies,
): Promise<boolean> {
  if (skill.skill_source_url) {
    try {
      const bundleBytes = await dependencies.downloadSkillBundle(skill.skill_source_url);
      const wroteBundleToDisk = await dependencies.writeCloudSkillToDisk(skill, bundleBytes);
      if (wroteBundleToDisk) {
        return true;
      }

      dependencies.onWarning?.(
        `Bundle sync for "${skill.name}" produced no local changes, falling back to SKILL.md payload.`,
        new Error('Bundle write returned false'),
      );
    } catch (error) {
      dependencies.onWarning?.(
        `Failed to apply bundle sync for "${skill.name}", falling back to SKILL.md payload.`,
        error,
      );
    }
  }

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
