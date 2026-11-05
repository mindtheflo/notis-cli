'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import type { SpaceCloudComputerJobStatus } from '../space';

export interface UseCloudComputerJobOptions {
  /** How often a running job is read, in ms (default 2000, at least 500). */
  pollMs?: number;
  /** The most log characters kept, the newest ones (default 200000). */
  maxLogChars?: number;
}

export interface UseCloudComputerJobResult {
  /** The job's last known state, or null before the first read (and without a job id). */
  job: SpaceCloudComputerJobStatus | null;
  /** The output read so far (its newest `maxLogChars` characters). */
  log: string;
  /** True until the job ended and its whole output was read. */
  running: boolean;
  /** The last read that failed; reading goes on. */
  error: Error | null;
  /** False on hosts without jobs (Sites, links, verification harnesses, older hosts) or without `cloudComputer: 'shell'`. */
  available: boolean;
  /** Stop the job. */
  cancel(): Promise<SpaceCloudComputerJobStatus | null>;
  /** Read again now (and resume after repeated failures). */
  refresh(): void;
}

/** Log reads one poll makes at most while catching up with a job's output. */
const LOG_READS_PER_POLL = 8;
const LOG_CHUNK_BYTES = 65_536;
/** Failed reads in a row after which polling stops until `refresh()`. */
const MAX_FAILURES = 5;

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * Follow a background job started with `useCloudComputerShell().run(command, { detach: true })`: its state, and its
 * output appended as it arrives, until the job ends. Reading pauses while the page is hidden.
 *
 * ```tsx
 * const shell = useCloudComputerShell();
 * const [jobId, setJobId] = useState<string | null>(null);
 * const { job, log, running } = useCloudComputerJob(jobId);
 * // start: setJobId((await shell.run('npm run build', { detach: true, cwd: { space: '' } })).job_id ?? null);
 * ```
 */
export function useCloudComputerJob(jobId: string | null | undefined, options: UseCloudComputerJobOptions = {}): UseCloudComputerJobResult {
  const runtime = useNotisRuntime();
  const transport = runtime?.spaceCloudComputer;
  const available = Boolean(transport?.job && runtime?.space?.cloudComputer === 'shell');
  const pollMs = Math.max(500, options.pollMs ?? 2000);
  const maxLogChars = Math.max(1000, options.maxLogChars ?? 200_000);
  const [job, setJob] = useState<SpaceCloudComputerJobStatus | null>(null);
  const [log, setLog] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const offset = useRef(0);
  const following = useRef<string | null>(null);

  useEffect(() => {
    if (following.current !== (jobId || null)) {
      following.current = jobId || null;
      offset.current = 0;
      setJob(null); setLog(''); setError(null); setDone(false);
    }
    if (!jobId || !available || !transport?.job) return undefined;
    const read = transport.job.bind(transport);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let finished = false;
    let failures = 0;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void poll(); }, pollMs);
    };
    const poll = async () => {
      if (!alive || busy || finished || !documentVisible()) return;
      busy = true;
      try {
        const status = await read('job.status', { job_id: jobId });
        if (!alive) return;
        setJob(status);
        const ended = status.status !== 'running';
        let eof = false;
        for (let reads = 0; reads < LOG_READS_PER_POLL; reads += 1) {
          const chunk = await read('job.logs', { job_id: jobId, offset: offset.current, max_bytes: LOG_CHUNK_BYTES });
          if (!alive) return;
          const advanced = chunk.next_offset > offset.current;
          offset.current = Math.max(offset.current, chunk.next_offset);
          if (chunk.text) setLog((current) => (current + chunk.text).slice(-maxLogChars));
          eof = chunk.eof;
          // Keep reading only while a full chunk came back: the rest waits for the next poll.
          if (eof || !advanced || chunk.next_offset - chunk.offset < LOG_CHUNK_BYTES) break;
        }
        failures = 0;
        setError(null);
        if (ended && eof) { finished = true; setDone(true); return; }
        // An ended job whose output never reports its end is not read forever.
        if (ended && status.log_bytes <= offset.current) { finished = true; setDone(true); return; }
        schedule();
      } catch (reason) {
        if (!alive) return;
        failures += 1;
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        if (failures < MAX_FAILURES) schedule();
      } finally {
        busy = false;
      }
    };
    const onVisibility = () => {
      if (!alive) return;
      if (documentVisible()) void poll();
      else if (timer) { clearTimeout(timer); timer = null; }
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [jobId, available, transport, pollMs, maxLogChars, attempt]);

  const cancel = useCallback(async () => {
    if (!jobId || !available || !transport?.job) return null;
    const status = await transport.job('job.cancel', { job_id: jobId });
    setJob(status);
    setAttempt((value) => value + 1);
    return status;
  }, [jobId, available, transport]);
  const refresh = useCallback(() => { setDone(false); setAttempt((value) => value + 1); }, []);

  return { job, log, running: Boolean(jobId) && available && !done, error, available, cancel, refresh };
}
