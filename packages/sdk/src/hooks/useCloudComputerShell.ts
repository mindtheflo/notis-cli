'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { invalidateCloudComputerFacts } from './useCloudComputer';
import type {
  SpaceCloudComputerFileUpload,
  SpaceCloudComputerFileUploadResult,
  SpaceCloudComputerImportInput,
  SpaceCloudComputerImportResult,
  SpaceCloudComputerUploadProgress,
  SpaceCloudComputerJobLogs,
  SpaceCloudComputerJobStatus,
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
  /** A background job started with `run(command, { detach: true })`: its state and exit code. */
  jobStatus(jobId: string): Promise<SpaceCloudComputerJobStatus>;
  /** Up to `maxBytes` (default 65536, at most 200000) of the job's output from byte `offset` (default 0). */
  jobLogs(jobId: string, options?: { offset?: number; maxBytes?: number }): Promise<SpaceCloudComputerJobLogs>;
  /** Stop a background job; answers its state once stopped. */
  cancelJob(jobId: string): Promise<SpaceCloudComputerJobStatus>;
  /**
   * Write one file straight to the cloud computer; it never travels by URL or chat. With `{ path, content }`: text
   * or base64, at most 1 MiB, at a machine path. With `{ file, dest: { space: 'files/clip.mp4' } }`: a `File` or
   * `Blob` of any size into the Space folder; above 1 MiB its parts go from the browser to the machine directly,
   * `uploadProgress` follows it, and the machine checks its sha256 before it replaces the file.
   */
  upload(file: SpaceCloudComputerUploadInput): Promise<SpaceCloudComputerUploadResult>;
  upload(file: SpaceCloudComputerFileUpload): Promise<SpaceCloudComputerFileUploadResult>;
  /** The `{ file }` upload in progress (the latest one when several run), else null. */
  uploadProgress: SpaceCloudComputerUploadProgress | null;
  /** Have the cloud computer download a public URL itself into the Space folder; a rerun resumes a cut download. */
  importUrl(url: string, dest: { space: string }, options?: { sha256?: string; overwrite?: boolean; requestId?: string }):
    Promise<SpaceCloudComputerImportResult>;
  /**
   * Ask the host to show its approval prompt, for either declared level. Only the person's click in
   * that prompt approves; once allowed, every `useCloudComputer()` reads the facts again.
   */
  requestApproval(): Promise<SpaceCloudComputerStatus | null>;
  refresh(): Promise<void>;
}

/**
 * `cwd`: a machine path, or `{ space: 'rel' }` inside the Space folder (`{ space: '' }` is its root); without it a run
 * starts in /vercel/sandbox. `detach`: start a background job and answer at once with `job_id` (follow it with
 * `useCloudComputerJob`); `timeoutMs` then bounds the job, up to 6 hours.
 */
type RunOptions = { cwd?: string | { space: string }; detach?: boolean; timeoutMs?: number; maxOutputLength?: number; requestId?: string };

const unavailable = async (): Promise<never> => {
  throw new Error('The Cloud Computer is not available in this Space.');
};

const INLINE_FILE_BYTES = 1024 * 1024;

function isFileUpload(input: SpaceCloudComputerUploadInput | SpaceCloudComputerFileUpload): input is SpaceCloudComputerFileUpload {
  return Boolean(input) && typeof input === 'object' && 'file' in input;
}

async function base64Of(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

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
  const [uploadProgress, setUploadProgress] = useState<SpaceCloudComputerUploadProgress | null>(null);
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
    return transport.run({ command, ...(options.cwd !== undefined && options.cwd !== '' ? { cwd: options.cwd } : {}),
      ...(options.detach ? { detach: true } : {}),
      ...(options.timeoutMs ? { timeout_ms: options.timeoutMs } : {}),
      ...(options.maxOutputLength ? { max_output_length: options.maxOutputLength } : {}),
      ...(options.requestId ? { request_id: options.requestId } : {}) });
  }, [available, transport]);

  const jobStatus = useCallback(async (jobId: string) => {
    if (!available || !transport?.job) return unavailable();
    return transport.job('job.status', { job_id: jobId });
  }, [available, transport]);
  const jobLogs = useCallback(async (jobId: string, options: { offset?: number; maxBytes?: number } = {}) => {
    if (!available || !transport?.job) return unavailable();
    return transport.job('job.logs', { job_id: jobId, ...(options.offset ? { offset: options.offset } : {}),
      ...(options.maxBytes ? { max_bytes: options.maxBytes } : {}) });
  }, [available, transport]);
  const cancelJob = useCallback(async (jobId: string) => {
    if (!available || !transport?.job) return unavailable();
    return transport.job('job.cancel', { job_id: jobId });
  }, [available, transport]);

  const upload = useCallback(async (input: SpaceCloudComputerUploadInput | SpaceCloudComputerFileUpload) => {
    if (!available || !transport) return unavailable();
    if (!isFileUpload(input)) return transport.upload(input);
    if (!(input.file instanceof Blob) || typeof input.dest?.space !== 'string') {
      throw new Error("Pass { file: File | Blob, dest: { space: 'files/name' } }.");
    }
    const onProgress = (progress: SpaceCloudComputerUploadProgress) => {
      if (mounted.current) setUploadProgress(progress.phase === 'done' ? null : progress);
      input.onProgress?.(progress);
    };
    try {
      if (transport.sendFile) return await transport.sendFile({ ...input, onProgress });
      // An older host: a small file still goes inline into the Space folder.
      if (input.file.size > INLINE_FILE_BYTES || !transport.folder) {
        throw new Error('This host sends files of at most 1 MiB. Update Notis to send bigger ones.');
      }
      const folder = await transport.folder();
      const path = `${folder.path}/${input.dest.space}`;
      const written = await transport.upload({ path, content: await base64Of(input.file), content_encoding: 'base64' });
      if (written.status && written.status !== 'success') throw new Error(written.message || 'The file could not be written.');
      return { status: 'success' as const, path: written.path || path, size: written.size ?? input.file.size, sha256: '' };
    } finally {
      if (mounted.current) setUploadProgress(current => (current?.path === input.dest.space ? null : current));
    }
  }, [available, transport]) as UseCloudComputerShellResult['upload'];

  const importUrl = useCallback(async (url: string, dest: { space: string },
    options: { sha256?: string; overwrite?: boolean; requestId?: string } = {}) => {
    if (!available || !transport?.importUrl) return unavailable();
    const input: SpaceCloudComputerImportInput = { url, dest, ...(options.sha256 ? { sha256: options.sha256 } : {}),
      ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
      ...(options.requestId ? { request_id: options.requestId } : {}) };
    return transport.importUrl(input);
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
    run, jobStatus, jobLogs, cancelJob, upload, uploadProgress, importUrl, requestApproval, refresh };
}
