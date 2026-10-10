'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { invalidateCloudComputerFacts } from './useCloudComputer';
import type {
  SpaceCloudComputerLevel,
  SpaceCloudComputerRunResult,
  SpaceCloudComputerStatus,
  SpaceCloudComputerUploadInput,
  SpaceCloudComputerUploadResult,
} from '../space';

export interface UseCloudComputerShellResult {
  /**
   * The level this Space declares (`'read'` or `'shell'`) when this host offers the cloud computer,
   * else null (Sites, links, verification harnesses, older hosts): keep the page's own fallback.
   */
  level: SpaceCloudComputerLevel | null;
  /** True when `run` and `upload` are offered: the host offers the cloud computer and the Space declares `'shell'`. */
  available: boolean;
  /** The viewer's approval for this Space's current code (either level), or null while it is read. */
  status: SpaceCloudComputerStatus | null;
  approved: boolean;
  loading: boolean;
  /**
   * Run one non-interactive command on the viewer's own cloud computer. Same result as the shell tool.
   * Pass the same `requestId` when the page retries this run itself: a run is never repeated for one key.
   */
  run(command: string, options?: RunOptions): Promise<SpaceCloudComputerRunResult>;
  /** Write one file (at most 1 MiB) straight to the cloud computer; it never travels by URL or chat. */
  upload(file: SpaceCloudComputerUploadInput): Promise<SpaceCloudComputerUploadResult>;
  /**
   * Ask the host to show its approval prompt, for either declared level. Only the person's click in
   * that prompt approves; once allowed, every `useCloudComputer()` reads the facts again.
   */
  requestApproval(): Promise<SpaceCloudComputerStatus | null>;
  refresh(): Promise<void>;
}

type RunOptions = { cwd?: string; timeoutMs?: number; maxOutputLength?: number; requestId?: string };

const unavailable = async (): Promise<never> => {
  throw new Error('The cloud computer is not available in this Space.');
};

/**
 * The viewer's approval and, for `cloudComputer: 'shell'`, commands and file writes on the signed-in
 * viewer's own cloud computer, from a Space page.
 *
 * ```tsx
 * const shell = useCloudComputerShell();
 * if (!shell.level) return <AskNotisFallback />;
 * if (!shell.approved) return <Button onClick={() => shell.requestApproval()}>Allow</Button>;
 * const result = await shell.run(`bash ${SCRIPTS}/workspace.sh sync ${quote(repo)} ${quote(name)}`);
 * ```
 *
 * Requires `cloudComputer` in `defineSpace` and the viewer's approval, which the Portal asks for in
 * its own prompt and which covers only the exact code the viewer allowed: any new release asks again.
 */
export function useCloudComputerShell(): UseCloudComputerShellResult {
  const runtime = useNotisRuntime();
  const transport = runtime?.spaceCloudComputer;
  const declared = runtime?.space?.cloudComputer;
  const level: SpaceCloudComputerLevel | null = transport && (declared === 'read' || declared === 'shell') ? declared : null;
  const available = level === 'shell';
  const [status, setStatus] = useState<SpaceCloudComputerStatus | null>(null);
  const [loading, setLoading] = useState(Boolean(level));
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    if (!level || !transport) return;
    setLoading(true);
    try {
      const next = await transport.status();
      if (mounted.current) setStatus(next);
    } catch {
      if (mounted.current) setStatus(null);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [level, transport]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
  }, [refresh]);

  const run = useCallback(async (command: string, options: RunOptions = {}) => {
    if (!available || !transport) return unavailable();
    return transport.run({ command, ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.timeoutMs ? { timeout_ms: options.timeoutMs } : {}),
      ...(options.maxOutputLength ? { max_output_length: options.maxOutputLength } : {}),
      ...(options.requestId ? { request_id: options.requestId } : {}) });
  }, [available, transport]);

  const upload = useCallback(async (file: SpaceCloudComputerUploadInput) => {
    if (!available || !transport) return unavailable();
    return transport.upload(file);
  }, [available, transport]);

  const requestApproval = useCallback(async () => {
    if (!level || !transport) return null;
    const next = await transport.requestApproval();
    if (mounted.current) setStatus(next);
    // A facts read refused before the approval must not keep showing "unavailable".
    if (next?.approved === true) invalidateCloudComputerFacts(runtime);
    return next;
  }, [level, runtime, transport]);

  return { level, available, status, approved: status?.approved === true, loading: Boolean(level) && loading,
    run, upload, requestApproval, refresh };
}
