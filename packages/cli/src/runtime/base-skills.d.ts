export interface BaseSkillReconcileResult {
  installed: number;
  linked: number;
  unchanged: number;
  backups: string[];
  skills: string[];
}

export const BASE_SKILL_NAMES: readonly string[];

export function resolveBundledBaseSkillsRoot(options?: {
  resourcesPath?: string;
}): string;

export function reconcileBaseSkills(options?: {
  home?: string;
  userId?: string | null;
  sourceRoot?: string;
  now?: number;
}): BaseSkillReconcileResult;
