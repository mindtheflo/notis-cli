'use client';

import { useCallback, useRef } from 'react';
import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import { queryKey } from '../queryCache';
import { spaceQueryKey } from '../space';
import type { CloudComputerFacts, NotisRuntime } from '../runtime';

/** Cache key of the facts read; re-read once the viewer allows a Space to use the cloud computer. */
export const CLOUD_COMPUTER_FACTS_KEY = ['cloud-computer-facts'] as const;

/** Marks the facts stale in the host cache so every mounted `useCloudComputer()` reads them again. */
export function invalidateCloudComputerFacts(runtime: NotisRuntime | null): void {
  try {
    runtime?.queryClient?.invalidate(queryKey(spaceQueryKey(runtime, CLOUD_COMPUTER_FACTS_KEY)));
  } catch {
    // A host without a Space access context has no shared facts cache to refresh.
  }
}

export interface UseCloudComputerResult {
  /**
   * The facts, or null while the first read is in flight. `facts.available`
   * is false when this host cannot answer — render the app's own fallback.
   */
  facts: CloudComputerFacts | null;
  loading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** Re-read the facts. The platform caches them for a few minutes. */
  refresh: () => Promise<void>;
  /**
   * Space only (`cloudComputer: 'read'` or `'shell'`): ask the host to show its approval prompt.
   * Resolves true once the viewer allowed it (the facts are then read again), false when they did
   * not, and null on hosts without the prompt (Beta Apps, Sites, previews offline).
   */
  requestApproval: () => Promise<boolean | null>;
}

const UNAVAILABLE: CloudComputerFacts = {
  available: false,
  reason: 'unsupported_host',
  sandbox: null,
  cli_auth: {
    gh: { authenticated: null, account: null, checked_at: null, reason: 'unsupported_host' },
  },
};

/**
 * Read-only facts about the user's cloud computer.
 *
 * ```tsx
 * const { facts } = useCloudComputer();
 * const gh = facts?.available ? facts.cli_auth.gh : null;
 *
 * return gh?.authenticated
 *   ? <p>Signed in as {gh.account}</p>
 *   : <GithubConnect />;
 * ```
 *
 * Requires `capabilities.cloudComputer: 'read'` in `notis.config.ts` and the
 * user's approval at install time. In a Space, declare `cloudComputer: 'read'`
 * (or `'shell'`) in `defineSpace`; until the viewer allows it the facts answer
 * unavailable, so offer `requestApproval()`. It answers with state the platform already
 * holds: reading it never creates, resumes or commands a sandbox, and the GitHub
 * probe only runs when the sandbox is already awake. `authenticated: null`
 * therefore means *unknown*, not *signed out* — keep the app's own fallback for
 * that case and for hosts that answer `{ available: false }` (the dev harness,
 * the vite preview).
 */
export function useCloudComputer(): UseCloudComputerResult {
  const runtime = useNotisRuntime();
  const explicitRefresh = useRef(false);
  const query = useQuery<CloudComputerFacts>(CLOUD_COMPUTER_FACTS_KEY, async () => {
    const refresh = explicitRefresh.current;
    explicitRefresh.current = false;
    return runtime?.cloudComputerFacts ? runtime.cloudComputerFacts(refresh ? { refresh: true } : undefined) : UNAVAILABLE;
  }, { readOnly: true });
  const refresh = useCallback(async () => {
    explicitRefresh.current = true;
    await query.refetch();
  }, [query.refetch]);
  const transport = runtime?.spaceCloudComputer;
  const requestApproval = useCallback(async () => {
    if (!transport) return null;
    const status = await transport.requestApproval();
    if (status?.approved !== true) return false;
    invalidateCloudComputerFacts(runtime);
    await query.refetch();
    return true;
  }, [query.refetch, runtime, transport]);
  return { facts: query.data ?? (query.error ? UNAVAILABLE : null), loading: query.loading,
    isFetching: query.isFetching, error: query.error, refresh, requestApproval };
}
