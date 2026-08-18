'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import type { CloudComputerFacts } from '../runtime';

export interface UseCloudComputerResult {
  /**
   * The facts, or null while the first read is in flight. `facts.available`
   * is false when this host cannot answer — render the app's own fallback.
   */
  facts: CloudComputerFacts | null;
  loading: boolean;
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
  const [facts, setFacts] = useState<CloudComputerFacts | null>(null);
  // True from the first committed render: the initial read is already queued
  // in an effect, and `{ loading: false, facts: null }` would flash a
  // consumer's fallback branch before the answer arrives.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(async (options?: { refresh?: boolean }) => {
    if (!runtime?.cloudComputerFacts) {
      setFacts(UNAVAILABLE);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await runtime.cloudComputerFacts(options);
      if (mounted.current) setFacts(next);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (mounted.current) {
        setError(e);
        // A refused or failed read is the same product state as a host that
        // cannot answer: the app shows its fallback instead of an error.
        setFacts(UNAVAILABLE);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    void read();
  }, [read]);

  const refresh = useCallback(() => read({ refresh: true }), [read]);

  return { facts, loading, error, refresh };
}
