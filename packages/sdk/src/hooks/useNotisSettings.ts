'use client';

import { useCallback } from 'react';
import { useNotisRuntime } from '../provider';
import { settledNavigation } from './useNotisNavigation';

/** A Settings place a Space may open. Only the Cloud Computer's repository secrets for now. */
export interface NotisSettingsTarget {
  page: 'cloud-computer';
  section: 'repository-secrets';
  /**
   * The repository the form is prefilled with: its short name (`naturalisation-switzerland`) or `owner/name`, whose
   * short name is kept. Repository secrets are keyed by the short name, in lower case.
   */
  repository?: string;
  /** Open the Add env file (`env_file`) or Add variable (`variable`) form. Without it the section is only shown. */
  add?: 'env_file' | 'variable';
}

export interface UseNotisSettingsResult {
  /** False on a Site, a link, a release preview, a page framed inside another, verify and the vite preview: offer your
   * own fallback there. */
  available: boolean;
  /**
   * Opens Settings on the target, above the Space. Resolves once the host has taken it; rejects on a host that cannot
   * open Settings, on a target it does not know, or when the view is no longer the one on screen. Values are never
   * prefilled: the person types or chooses them in Settings.
   */
  openSettings: (target: NotisSettingsTarget) => Promise<void>;
}

export type NotisSettingsNavigation = {
  kind: 'settings'; page: 'cloud-computer'; section: 'repository-secrets';
  repository?: string; add?: 'env_file' | 'variable';
};

/** The repository-secrets store's rule for a repository (server/lib/database_schema.py SECRET_REPOSITORY_SLUG). */
const REPOSITORY = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
/** A GitHub owner: letters, digits and dashes. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/** The short name a repository is kept under (`owner/name` keeps `name`, lower case), or null when it is not one. */
export function settingsRepositoryName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('/');
  if (parts.length > 2 || (parts.length === 2 && !OWNER.test(parts[0]))) return null;
  const name = parts[parts.length - 1].toLowerCase();
  return REPOSITORY.test(name) ? name : null;
}

const TARGET_KEYS = ['page', 'section', 'repository', 'add'];

/** The payload `openSettings` sends the host, or an Error naming what is wrong. Hosts check it again with this. */
export function settingsNavigation(target: unknown): NotisSettingsNavigation | Error {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return new Error('Name the Settings page to open.');
  const fields = target as Record<string, unknown>;
  if (Object.keys(fields).some(key => fields[key] !== undefined && !TARGET_KEYS.includes(key))) {
    return new Error('openSettings takes page, section, repository and add.');
  }
  if (fields.page !== 'cloud-computer' || fields.section !== 'repository-secrets') {
    return new Error("Spaces open Settings on { page: 'cloud-computer', section: 'repository-secrets' }.");
  }
  if (fields.add !== undefined && fields.add !== 'env_file' && fields.add !== 'variable') {
    return new Error("add is 'env_file' or 'variable'.");
  }
  let repository: string | undefined;
  if (fields.repository !== undefined) {
    const name = settingsRepositoryName(fields.repository);
    if (!name) return new Error('Name the repository by its short name or owner/name.');
    repository = name;
  }
  return { kind: 'settings', page: 'cloud-computer', section: 'repository-secrets',
    ...(repository ? { repository } : {}), ...(fields.add ? { add: fields.add as 'env_file' | 'variable' } : {}) };
}

/**
 * Opens the host's Settings from a Space view, such as the repository secrets form for one repository.
 *
 * ```tsx
 * const settings = useNotisSettings();
 * <button disabled={!settings.available}
 *   onClick={() => settings.openSettings({ page: 'cloud-computer', section: 'repository-secrets',
 *     repository: 'naturalisation-switzerland', add: 'env_file' })}>Add .env file</button>
 * ```
 *
 * The same place has a plain address a Space or an email can link to:
 * `/manage?settings=cloud&settings_section=repository-secrets&settings_repository=<name>&settings_add=env_file`.
 */
export function useNotisSettings(): UseNotisSettingsResult {
  const runtime = useNotisRuntime();
  const available = Boolean(runtime?.settingsAvailable && runtime.navigate);
  const openSettings = useCallback(async (target: NotisSettingsTarget) => {
    if (!runtime?.settingsAvailable || !runtime.navigate) {
      throw new Error('Settings open only from a Space page in Notis, signed in.');
    }
    const payload = settingsNavigation(target);
    if (payload instanceof Error) throw payload;
    await settledNavigation(() => runtime.navigate!(payload));
  }, [runtime]);
  return { available, openSettings };
}
