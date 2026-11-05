'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { CLOUD_COMPUTER_WORDS } from '../cloudComputerWords';
import { fillWords, pick, type Locale } from '../words';
import type { SpaceCloudComputerFrameCode, SpaceCloudComputerLeaseResult, SpaceCloudComputerMediaLink } from '../space';

export type CloudComputerServiceStatus = 'unavailable' | 'idle' | 'starting' | 'ready' | 'failed';

export interface UseCloudComputerServiceOptions {
  /**
   * How long a start may take before the hook says it failed, in seconds (default 90). While the machine says the
   * service process runs and is getting ready (`launching`), the wait starts over on each answer.
   */
  waitSeconds?: number;
}

export interface UseCloudComputerServiceResult {
  /** The declared service id, or null. */
  id: string | null;
  /**
   * `unavailable`: this host offers no services (Sites, links, verification harnesses, older hosts) or the Space does
   * not declare this one. `idle`: not asked yet. `starting`, `ready`, or `failed` (see `error`).
   */
  status: CloudComputerServiceStatus;
  /** The last lease answer. */
  lease: SpaceCloudComputerLeaseResult | null;
  /**
   * True while `starting` because the machine runs but is still restoring its files after a pause (it can take
   * minutes); `CloudComputerWaking` says so instead of the usual start words.
   */
  restoring: boolean;
  /** What went wrong while `failed`: the server's message when it gave one. */
  error: Error | null;
  /** The service address for `path` (`/` by default), or null until the gate serves it. */
  url(path?: string): string | null;
  /** `fetch` on the service with its pass. Throws while there is no gate yet. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * A link a media element (video, audio, img) can open without a header, seeking included: one file for ten minutes.
   * Null until the service is ready and the link is issued; the hook asks for it on first use, re-renders when it
   * arrives and swaps in a fresh link two minutes before the old one ends (keep the play position when `src` changes).
   */
  mediaUrl(path: string): string | null;
  /** The same links on demand, up to 50 paths at once. Throws while the service is not ready or the host predates them. */
  media(paths: string[]): Promise<SpaceCloudComputerMediaLink[]>;
  /**
   * A one-time code for a frame of the service (see `CloudComputerFrame`), landing on `path`. A root path (`/`) serves
   * the service from the gate root, so an app built for its own origin runs unchanged.
   */
  frameCode(path?: string): Promise<SpaceCloudComputerFrameCode>;
  /** Ask again at once and restart the bounded wait. */
  retry(): void;
  /**
   * True while `failed` because the viewer has not allowed this Space's current code on their Cloud Computer yet:
   * offer `allow()` instead of Try again (`CloudComputerWaking` does).
   */
  approvalRequired: boolean;
  /** Open the host's approval prompt; once the viewer allows it, the service starts at once. */
  allow(): Promise<void>;
  /** The cloud computer's price while it runs, when known. */
  price: SpaceCloudComputerLeaseResult['price'] | null;
  /** The bounded wait in seconds. */
  waitSeconds: number;
}

/** A media link is renewed this long before it ends. */
const MEDIA_RENEW_MS = 120_000;

/** A visible view renews its lease this often; the server holds a lease for 120 s. */
export const SERVICE_PULSE_MS = 30_000;
const DEFAULT_WAIT_SECONDS = 90;
/** While pulsing a ready service, this many failed pulses in a row turn it failed (one lost pulse is not an outage). */
const READY_PULSE_FAILURES = 3;

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function newHolder(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `holder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function clampRetrySeconds(value: number | null | undefined): number {
  const seconds = typeof value === 'number' && Number.isFinite(value) ? value : 2;
  return Math.min(10, Math.max(1, seconds));
}

/**
 * A service the Space declares in `cloudComputer.services`, kept running on the signed-in viewer's own cloud computer
 * while this page is on screen.
 *
 * ```tsx
 * const preview = useCloudComputerService('preview');
 * if (preview.status !== 'ready') return <CloudComputerWaking service={preview}>{null}</CloudComputerWaking>;
 * const answer = await preview.fetch('/api/items');
 * ```
 *
 * While the page is visible it renews the service's lease at once and every 30 s, which starts the service when needed;
 * hidden or unmounted, it stops and tells the host once, so the cloud computer stops about two minutes later. A start
 * that takes longer than `waitSeconds` without the machine saying the service is launching turns `failed`; `retry()` asks again. Hosts without services answer
 * `unavailable` and never ask anything.
 */
export function useCloudComputerService(id: string | null | undefined, options: UseCloudComputerServiceOptions = {}): UseCloudComputerServiceResult {
  const runtime = useNotisRuntime();
  const transport = runtime?.spaceCloudComputer;
  const space = runtime?.space;
  const locale: Locale = runtime?.context?.locale === 'fr' ? 'fr' : 'en';
  const waitSeconds = Math.max(1, options.waitSeconds ?? DEFAULT_WAIT_SECONDS);
  const serviceId = id || null;
  const declared = Boolean(serviceId && space?.cloudComputer === 'shell' && Array.isArray(space.cloudComputerServices)
    && space.cloudComputerServices.includes(serviceId));
  const lease = transport?.lease;
  const offered = Boolean(declared && lease && transport);

  const [holder] = useState(newHolder);
  const [state, setState] = useState<{ status: CloudComputerServiceStatus; lease: SpaceCloudComputerLeaseResult | null; error: Error | null }>(
    { status: 'idle', lease: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ locale, waitSeconds });
  latest.current = { locale, waitSeconds };

  useEffect(() => {
    if (!offered || !serviceId || !transport?.lease) return undefined;
    const call = (visible: boolean) => transport.lease!({ service: serviceId, visible, holder });
    let alive = true;
    let epoch = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let holding = false;
    let failures = 0;
    let status: CloudComputerServiceStatus = 'idle';
    let waitStarted: number | null = null;
    let restoring = false;

    const set = (next: { status: CloudComputerServiceStatus; lease?: SpaceCloudComputerLeaseResult | null; error?: Error | null }) => {
      status = next.status;
      if (!alive) return;
      setState((current) => ({ status: next.status, lease: next.lease === undefined ? current.lease : next.lease,
        error: next.error === undefined ? (next.status === 'failed' ? current.error : null) : next.error }));
    };
    const clearTimers = () => {
      if (timer) clearTimeout(timer);
      if (deadline) clearTimeout(deadline);
      timer = null; deadline = null;
    };
    const release = () => {
      if (!holding) return;
      holding = false;
      // Best effort: the lease ends at its own expiry anyway.
      void call(false).catch(() => undefined);
    };
    const fail = (error: Error, answer?: SpaceCloudComputerLeaseResult | null) => {
      epoch += 1;
      inFlight = false;
      clearTimers();
      waitStarted = null;
      set({ status: 'failed', error, ...(answer !== undefined ? { lease: answer } : {}) });
      release();
    };
    const armDeadline = () => {
      if (deadline || waitStarted === null) return;
      const left = waitStarted + latest.current.waitSeconds * 1000 - Date.now();
      const timeOut = () => {
        deadline = null;
        // A pulse still in flight is the server waking the machine (it can take over a minute): its answer decides,
        // and the wait runs out then unless the service is launching.
        if (inFlight) return;
        fail(new Error(pick(restoring ? CLOUD_COMPUTER_WORDS.restoringTimedOut
          : fillWords(CLOUD_COMPUTER_WORDS.timedOut, { seconds: latest.current.waitSeconds }), latest.current.locale)));
      };
      if (left <= 0) { timeOut(); return; }
      deadline = setTimeout(timeOut, left);
    };
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void pulse(); }, ms);
    };
    const pulse = async () => {
      if (!alive || inFlight || status === 'failed' || !documentVisible()) return;
      const mine = epoch;
      inFlight = true;
      holding = true;
      if (status === 'idle') {
        waitStarted ??= Date.now();
        set({ status: 'starting' });
        armDeadline();
      }
      let answer: SpaceCloudComputerLeaseResult;
      try {
        answer = await call(true);
      } catch (reason) {
        if (mine === epoch) inFlight = false;
        if (!alive || mine !== epoch) return;
        failures += 1;
        // A ready service survives a lost pulse or two: its lease outlives them.
        if (status === 'ready' && failures < READY_PULSE_FAILURES) { schedule(SERVICE_PULSE_MS); return; }
        fail(reason instanceof Error ? reason : new Error(pick(CLOUD_COMPUTER_WORDS.noAnswer, latest.current.locale)));
        return;
      }
      if (mine === epoch) inFlight = false;
      if (!alive || mine !== epoch) return;
      failures = 0;
      if (answer?.status === 'ready') {
        waitStarted = null;
        if (deadline) { clearTimeout(deadline); deadline = null; }
        set({ status: 'ready', lease: answer, error: null });
        schedule(SERVICE_PULSE_MS);
      } else if (answer?.status === 'failed') {
        fail(new Error(answer.message || pick(CLOUD_COMPUTER_WORDS.failedGeneric, latest.current.locale)), answer);
      } else if (answer?.status === 'starting') {
        restoring = answer.reason === 'restoring';
        if (answer.reason === 'launching') {
          // The service runs on the machine and is getting ready: each such answer starts the wait over, so only a
          // machine that stops answering (or the machine's own bound) ends it.
          waitStarted = Date.now();
          if (deadline) { clearTimeout(deadline); deadline = null; }
        }
        waitStarted ??= Date.now();
        set({ status: 'starting', lease: answer });
        armDeadline();
        if (status === 'starting') schedule(clampRetrySeconds(answer.retry_after_seconds) * 1000);
      } else {
        // `released` (another tab let it go): ask again on the next pulse.
        set({ status: 'idle', lease: answer ?? null });
        schedule(SERVICE_PULSE_MS);
      }
    };
    const onVisibility = () => {
      if (!alive) return;
      if (documentVisible()) {
        if (status === 'failed') return;
        // A start resumes with a fresh wait: the time hidden does not count.
        if (status === 'starting') waitStarted = Date.now();
        armDeadline();
        void pulse();
      } else {
        epoch += 1;
        inFlight = false;
        clearTimers();
        release();
      }
    };

    set({ status: 'idle', error: null });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    if (documentVisible()) void pulse();
    return () => {
      alive = false;
      epoch += 1;
      clearTimers();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [offered, serviceId, transport, holder, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'idle', lease: null, error: null });
    setAttempt((value) => value + 1);
  }, []);

  // A refused start may only need the viewer's approval: read it once per failure, never before a start.
  const [approvalRequired, setApprovalRequired] = useState(false);
  useEffect(() => {
    if (!offered || state.status !== 'failed' || !transport) { setApprovalRequired(false); return undefined; }
    let live = true;
    transport.status().then((status) => { if (live) setApprovalRequired(status?.approved === false); },
      () => { if (live) setApprovalRequired(false); });
    return () => { live = false; };
  }, [offered, state.status, state.error, transport]);
  const allow = useCallback(async () => {
    if (!transport) return;
    const next = await transport.requestApproval();
    if (next?.approved !== true) return;
    setApprovalRequired(false);
    retry();
  }, [transport, retry]);

  const currentLease = offered ? state.lease : null;
  const gate = currentLease?.gate_url ? currentLease.gate_url.replace(/\/+$/, '') : null;
  const pass = currentLease?.pass ?? null;
  const spaceId = space?.id ?? '';
  const url = useCallback((path = '/') => {
    if (!gate || !serviceId) return null;
    const rest = path.startsWith('/') ? path : `/${path}`;
    return `${gate}/s/${encodeURIComponent(spaceId)}/${encodeURIComponent(serviceId)}${rest}`;
  }, [gate, serviceId, spaceId]);
  const serviceFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const address = url(path);
    if (!address || !pass) throw new Error(pick(CLOUD_COMPUTER_WORDS.noGate, latest.current.locale));
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${pass}`);
    return globalThis.fetch(address, { ...init, headers });
  }, [url, pass]);
  const access = transport?.access;
  const ready = offered && state.status === 'ready' && Boolean(gate);
  const accessible = ready && Boolean(access) && Boolean(serviceId);
  const media = useCallback(async (paths: string[]): Promise<SpaceCloudComputerMediaLink[]> => {
    if (!accessible || !access || !serviceId) throw new Error(pick(CLOUD_COMPUTER_WORDS.noGate, latest.current.locale));
    if (!paths.length) return [];
    const answer = await access({ service: serviceId, media: paths });
    return answer.media ?? [];
  }, [accessible, access, serviceId]);
  const frameCode = useCallback(async (path?: string): Promise<SpaceCloudComputerFrameCode> => {
    if (!accessible || !access || !serviceId) throw new Error(pick(CLOUD_COMPUTER_WORDS.noGate, latest.current.locale));
    const answer = await access({ service: serviceId, frame: true, ...(path ? { path } : {}) });
    if (!answer.frame) throw new Error(pick(CLOUD_COMPUTER_WORDS.noGate, latest.current.locale));
    return answer.frame;
  }, [accessible, access, serviceId]);

  // Media links: issued per file on first use, batched, renewed before they end. A new gate starts a new cache.
  const [links, setLinks] = useState<{ gate: string | null; byPath: Record<string, SpaceCloudComputerMediaLink> }>(
    { gate: null, byPath: {} });
  const wanted = useRef<{ gate: string | null; paths: Set<string>; inFlight: Set<string>; failedAt: Map<string, number> }>(
    { gate: null, paths: new Set(), inFlight: new Set(), failedAt: new Map() });
  if (wanted.current.gate !== gate) wanted.current = { gate, paths: new Set(), inFlight: new Set(), failedAt: new Map() };
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const flushScheduled = useRef(false);
  const flushMedia = useCallback(() => {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    void Promise.resolve().then(async () => {
      flushScheduled.current = false;
      const batch = wanted.current;
      const paths = [...batch.paths].filter((path) => !batch.inFlight.has(path)).slice(0, 50);
      if (!paths.length) return;
      for (const path of paths) { batch.paths.delete(path); batch.inFlight.add(path); }
      try {
        const issued = await mediaRef.current(paths);
        if (wanted.current !== batch) return;
        setLinks((current) => {
          const byPath = current.gate === batch.gate ? { ...current.byPath } : {};
          for (const link of issued) byPath[link.path] = link;
          return { gate: batch.gate, byPath };
        });
      } catch {
        // Asked again on a later render, not in a loop.
        for (const path of paths) batch.failedAt.set(path, Date.now());
      } finally {
        for (const path of paths) batch.inFlight.delete(path);
      }
    });
  }, []);
  const known = links.gate === gate ? links.byPath : {};
  const mediaUrl = useCallback((path: string): string | null => {
    if (!accessible || typeof path !== 'string' || !path.startsWith('/')) return null;
    const link = known[path];
    const ends = link ? Date.parse(link.expires_at) : 0;
    const now = Date.now();
    const batch = wanted.current;
    const failed = batch.failedAt.get(path);
    const renew = !link || !Number.isFinite(ends) || ends - now <= MEDIA_RENEW_MS;
    if (renew && !batch.inFlight.has(path) && !(failed && now - failed < 5_000)) {
      batch.paths.add(path);
      flushMedia();
    }
    return link && ends > now ? link.url : null;
  }, [accessible, known, flushMedia]);
  // Re-render shortly before a link ends, so the view asks for its renewal while it still plays.
  const nextRenewal = useMemo(() => {
    const ends = Object.values(known).map((link) => Date.parse(link.expires_at)).filter(Number.isFinite);
    return ends.length ? Math.min(...ends) - MEDIA_RENEW_MS : null;
  }, [known]);
  const [, setRenewTick] = useState(0);
  useEffect(() => {
    if (nextRenewal === null) return undefined;
    const timer = setTimeout(() => setRenewTick((value) => value + 1), Math.max(1_000, nextRenewal - Date.now()));
    return () => clearTimeout(timer);
  }, [nextRenewal]);

  return useMemo(() => ({
    id: serviceId,
    status: offered ? state.status : 'unavailable',
    lease: currentLease,
    restoring: offered && state.status === 'starting' && currentLease?.status === 'starting' && currentLease.reason === 'restoring',
    error: offered && state.status === 'failed' ? state.error : null,
    url, fetch: serviceFetch, mediaUrl, media, frameCode, retry,
    approvalRequired: offered && state.status === 'failed' && approvalRequired, allow,
    price: currentLease?.price ?? null,
    waitSeconds,
  }), [serviceId, offered, state, currentLease, url, serviceFetch, mediaUrl, media, frameCode, retry, approvalRequired, allow,
    waitSeconds]);
}
