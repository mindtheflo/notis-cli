'use client';

import { useCallback, useRef } from 'react';
import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import type { CloudComputerFacts } from '../runtime';

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
 * user's approval at install time. It answers with state the platform already
 * holds: reading it never creates, resumes or commands a sandbox, and the GitHub
 * probe only runs when the sandbox is already awake. `authenticated: null`
 * therefore means *unknown*, not *signed out* — keep the app's own fallback for
 * that case and for hosts that answer `{ available: false }` (the dev harness,
 * the vite preview).
 */
export function useCloudComputer(): UseCloudComputerResult {
  const runtime = useNotisRuntime();
  const explicitRefresh = useRef(false);
  const query = useQuery<CloudComputerFacts>(['cloud-computer-facts'], async () => {
    const refresh = explicitRefresh.current;
    explicitRefresh.current = false;
    return runtime?.cloudComputerFacts ? runtime.cloudComputerFacts(refresh ? { refresh: true } : undefined) : UNAVAILABLE;
  }, { readOnly: true });
  const refresh = useCallback(async () => {
    explicitRefresh.current = true;
    await query.refetch();
  }, [query.refetch]);
  return { facts: query.data ?? (query.error ? UNAVAILABLE : null), loading: query.loading,
    isFetching: query.isFetching, error: query.error, refresh };
}
