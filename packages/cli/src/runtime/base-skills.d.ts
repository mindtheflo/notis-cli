export interface BaseSkillReconcileResult {
  installed: number;
  /** Skills left as installed because that copy is newer than this one. */
  kept: number;
  linked: number;
  unchanged: number;
  backups: string[];
  skills: string[];
}

export const BASE_SKILL_NAMES: readonly string[];

export const BASE_SKILL_STAMP_FILE: string;

export function readBaseSkillStamp(skillDir: string): number | null;

export function resolveBundledBaseSkillsRoot(options?: {
  resourcesPath?: string;
}): string;

export function reconcileBaseSkills(options?: {
  home?: string;
  userId?: string | null;
  sourceRoot?: string;
  now?: number;
}): BaseSkillReconcileResult;
