import type { BaseSkillReconcileResult } from './base-skills.js';

export interface ReconcileAllSkillsResult {
  baseSkills: string[];
  baseInstalled: number;
  baseLinked: number;
  baseBackups: string[];
}

export interface SkillSyncLockOptions {
  home?: string;
  timeoutMs?: number;
  staleMs?: number;
  pollMs?: number;
  now?: () => number;
}

export function withSkillSyncLock<T>(
  callback: () => Promise<T> | T,
  options?: SkillSyncLockOptions,
): Promise<T>;

export function reconcileAllSkills<T extends object>(options: {
  serverUrl: string;
  jwt: string;
  honorSyncEnabled: boolean;
  userId?: string | null;
  home?: string;
  runAccountSync: (
    serverUrl: string,
    jwt: string,
    dependencies: Record<string, never>,
    options: { honorSyncEnabled: boolean },
  ) => Promise<T>;
  reconcileBase?: (options: { userId?: string | null; home?: string }) => BaseSkillReconcileResult;
  lockOptions?: Omit<SkillSyncLockOptions, 'home'>;
}): Promise<T & ReconcileAllSkillsResult>;
