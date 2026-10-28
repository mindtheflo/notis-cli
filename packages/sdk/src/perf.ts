/**
 * Always-on timing of the moments a person waits for in a Space, from their key press or click to the first frame
 * that shows real content (no skeleton). Each finished wait is one `performance.measure` entry:
 *
 * - `notis:space-open`: another Space (or record context) shows.
 * - `notis:view-switch`: another view of the same Space shows.
 * - `notis:record-open`: an item of a list opens in its reader, or a DocumentPage opens another record.
 * - `notis:query-change`: a read whose key changed (a filter, a search, a server tab) shows its new answer.
 *
 * Read them with `performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('notis:'))`.
 * The cost is a timestamp per key press or click and, while a wait is open, one animation frame (and a mutation
 * observer when a skeleton still shows). One copy serves the host and every Space bundle (kept on `globalThis`).
 */

export type WaitName = 'notis:space-open' | 'notis:view-switch' | 'notis:record-open' | 'notis:query-change';

/** A key press or click older than this did not cause the wait: it starts when it is noticed. */
export const INTENT_WINDOW_MS = 3_000;
/** A wait whose content never shows within this is dropped, not measured. */
export const WAIT_TIMEOUT_MS = 10_000;
/** What a loading placeholder carries: the SDK skeletons and the list's skeleton rows. */
export const SKELETON_SELECTOR = '[data-notis-skeleton], [data-notis-content-skeleton], .nui-skel';

interface Pending {
  start: number;
  /** Parts still loading (one per read of a query change); the wait ends when none is left. */
  parts: Set<unknown>;
  ended: boolean;
  stop?: () => void;
}
interface PerfState {
  intent: number | null;
  watching: boolean;
  pending: Map<WaitName, Pending>;
}

const STATE = Symbol.for('notis.perf');
function state(): PerfState {
  const holder = globalThis as unknown as Record<symbol, PerfState | undefined>;
  return (holder[STATE] ??= { intent: null, watching: false, pending: new Map() });
}

function clock(): Performance | null {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance : null;
}

/** Notes a key press or click now (the host's listeners call it; tests may too). */
export function noteIntent(at?: number): void {
  const perf = clock();
  if (perf) state().intent = at ?? perf.now();
}

/** Listens for key presses and clicks on `target` (capture, passive), once per target. Returns a stop function. */
export function watchUserIntent(target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null =
  typeof window === 'undefined' ? null : window): () => void {
  const current = state();
  if (!target || current.watching) return () => {};
  current.watching = true;
  const note = (event: Event) => {
    // A modifier pressed alone is not the intent: the key it modifies is.
    if (event instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    noteIntent(typeof event.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : undefined);
  };
  const options = { capture: true, passive: true } as const;
  target.addEventListener('keydown', note, options);
  target.addEventListener('pointerdown', note, options);
  return () => {
    target.removeEventListener('keydown', note, options);
    target.removeEventListener('pointerdown', note, options);
    current.watching = false;
  };
}

/**
 * Starts `name` at the last key press or click (when recent), else now. `part` names one thing the wait needs (a
 * read): the wait ends once every part began for it ended. A newer key press or click starts a new wait.
 */
export function beginWait(name: WaitName, part: unknown = name): void {
  const perf = clock();
  if (!perf) return;
  const now = perf.now();
  const current = state();
  const intent = current.intent !== null && now - current.intent < INTENT_WINDOW_MS ? current.intent : null;
  const open = current.pending.get(name);
  // A wait no paint ended for this long is stale: it never joins a new one.
  if (open && !open.ended && now - open.start < WAIT_TIMEOUT_MS && (intent === null || intent <= open.start)) {
    open.parts.add(part);
    return;
  }
  open?.stop?.();
  current.pending.set(name, { start: intent ?? now, parts: new Set([part]), ended: false });
}

/** Drops `name` unmeasured (the move it timed did not happen). */
export function cancelWait(name: WaitName): void {
  const current = state();
  const open = current.pending.get(name);
  if (!open) return;
  open.stop?.();
  open.ended = true;
  current.pending.delete(name);
}

/** Whether `name` waits now. */
export function isWaiting(name: WaitName): boolean {
  const open = state().pending.get(name);
  return !!open && !open.ended;
}

function finish(name: WaitName, open: Pending, detail?: Record<string, unknown>) {
  const perf = clock();
  const current = state();
  if (!perf || open.ended || current.pending.get(name) !== open) return;
  open.ended = true;
  open.stop?.();
  current.pending.delete(name);
  try {
    perf.measure(name, { start: open.start, end: perf.now(), ...(detail ? { detail } : {}) });
  } catch {
    // An old engine without measure options: the wait goes unmeasured.
  }
}

function nextFrame(run: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const frame = requestAnimationFrame(() => run());
    return () => cancelAnimationFrame(frame);
  }
  const timer = setTimeout(run, 0);
  return () => clearTimeout(timer);
}

/**
 * `part` of `name` has painted: once every part has, the wait is measured on the next animation frame (the frame
 * that shows what was just committed). Does nothing when `name` does not wait.
 */
export function endWait(name: WaitName, part: unknown = name, detail?: Record<string, unknown>): void {
  const open = state().pending.get(name);
  if (!open || open.ended) return;
  open.parts.delete(part);
  if (open.parts.size) return;
  open.stop?.();
  open.stop = nextFrame(() => finish(name, open, detail));
}

/**
 * Ends `name` on the first frame where `root` shows no skeleton: at once when it already shows content, else when a
 * change takes the last skeleton out (dropped after `WAIT_TIMEOUT_MS`). Does nothing when `name` does not wait.
 */
export function endWaitWhenContent(name: WaitName, root: ParentNode | null | undefined, detail?: Record<string, unknown>): void {
  const open = state().pending.get(name);
  if (!open || open.ended || !root) return;
  open.parts.clear();
  open.stop?.();
  const shows = () => !root.querySelector(SKELETON_SELECTOR);
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelFrame: (() => void) | null = null;
  const stop = () => {
    observer?.disconnect(); observer = null;
    if (timer) clearTimeout(timer); timer = null;
    cancelFrame?.(); cancelFrame = null;
  };
  open.stop = stop;
  cancelFrame = nextFrame(() => {
    cancelFrame = null;
    if (shows()) { finish(name, open, detail); return; }
    if (typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(() => {
      if (!shows() || cancelFrame) return;
      cancelFrame = nextFrame(() => { cancelFrame = null; if (shows()) finish(name, open, detail); });
    });
    observer.observe(root as Node, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-notis-skeleton'] });
    timer = setTimeout(() => {
      stop();
      const current = state();
      if (current.pending.get(name) === open) { open.ended = true; current.pending.delete(name); }
    }, WAIT_TIMEOUT_MS);
  });
}

/** Forgets every open wait (tests). */
export function resetWaits(): void {
  const current = state();
  for (const open of current.pending.values()) open.stop?.();
  current.pending.clear();
  current.intent = null;
}
