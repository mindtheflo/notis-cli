/**
 * Where comment threads go (SPC-113, SPC-114, SPC-117): the manager threads each comment thread is linked to, the
 * best-match thread a new comment goes to, and the host @ thread picker. Everything comes from the host Comments
 * transport (`runtime.spaceComments`); a host without `links` shows no Goes to line, one without `bestMatch` no To chip.
 *
 * Links are read once per root and kept, at most `LINK_BATCH` roots per request: a root counts as read only once its
 * answer came back, an answer that arrives after the screen moved on is still kept, and a failed read is tried again. A
 * new transport object from the host (its viewer resolving) reads nothing again. A root is read again after a reply is
 * sent and while its first link is a pending new thread (5 s, 15 s and 45 s later), until it names a real thread.
 *
 * A pick (Change, or the To chip of a new comment) shows at once, marked saving, and goes back with the error notice
 * when the link fails.
 *
 * Until a root's links came back (and, with none, the page's best match), its Goes to line names nothing: `known` is
 * false, never a guess that turns into another thread a moment later. The last links of each root and the best match
 * of each page are kept for the session, per viewer and Space, so a page shown again names its threads at once while
 * they are read again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotisRuntime } from '../../provider';
import type { SpaceCommentThreadPick, SpaceCommentThreadRef } from '../../space';

export interface CommentRouting {
  /** True when the host links comment threads to threads: each card shows its Goes to line. */
  links: boolean;
  /** The threads a comment thread is linked to; the first is where a reply goes. */
  linksOf(rootKey: string): readonly SpaceCommentThreadRef[];
  /** Where a reply on this thread goes: its first link, else the best match (no link yet), else null (a new thread). */
  goesTo(rootKey: string): SpaceCommentThreadRef | null;
  /** The best-match thread for a new comment on this page (THR-024); null: none, or the host has no best match. */
  bestMatch: SpaceCommentThreadRef | null;
  /** True when the host answers best matches: the new comment box shows its To chip. */
  hasBestMatch: boolean;
  /** The thread the next new comment goes to, when picked with the chip or @; null: the best match. */
  newPick: SpaceCommentThreadPick | null;
  /** True when the host has the @ thread picker. */
  canPick: boolean;
  /** True when the host can link a comment thread to a thread: the Goes to line shows Change. */
  canLink: boolean;
  /** Opens the picker for the next new comment, under `anchor`. Resolves with the pick, or null when dismissed. */
  pickForNew(anchor: HTMLElement): Promise<SpaceCommentThreadPick | null>;
  clearPick(): void;
  /** Change: opens the picker for a thread's replies and links the pick as where they go. */
  change(rootKey: string, anchor: HTMLElement): Promise<void>;
  /** Links a new comment thread, once its first comment is saved, to the pick or the best match. */
  linkNew(rootKey: string): Promise<void>;
  /** True while a pick for this thread is being linked: its Goes to line already names it. */
  saving(rootKey: string): boolean;
  /** Reads where this thread goes again, 5 s, 15 s and 45 s from now, until it names a real thread (after a reply). */
  reread(rootKey: string): void;
  /**
   * False while where this thread goes is still being read (its links, or with none the page's best match): the Goes
   * to line shows a neutral loading state instead of a destination. Absent: always known.
   */
  known?(rootKey: string): boolean;
  /** Opens a manager thread in the chat; undefined on hosts without it. */
  open?: (threadId: string) => void;
}

const NONE: readonly SpaceCommentThreadRef[] = Object.freeze([]);
/** Tries of a failed links read, the second one after this many milliseconds, then twice as long each time. */
const RETRIES = 3;
const RETRY_MS = 1500;
/** The most roots one links request asks for: more are split into several requests. */
export const LINK_BATCH = 200;
/** When a root is read again after a reply, or while its first link is a pending new thread. */
const REREAD_MS = [5000, 15000, 45000] as const;

/** The most roots and pages the session keeps the last answer of; the oldest go first. */
const SESSION_MAX = 2000;
/** Last known links by session root id, and best matches by session page id, for this browser session. */
const sessionLinks = new Map<string, readonly SpaceCommentThreadRef[]>();
const sessionBest = new Map<string, SpaceCommentThreadRef | null>();

function sessionPut<T>(cache: Map<string, T>, id: string, value: T) {
  cache.delete(id);
  cache.set(id, value);
  if (cache.size > SESSION_MAX) cache.delete(cache.keys().next().value as string);
}

/** Forgets every kept answer (tests). */
export function clearCommentRoutingCache() {
  sessionLinks.clear();
  sessionBest.clear();
}

/** A thread a pick names: a new thread pick is a pending ref of its harness until the first wake starts it. */
function refOfPick(pick: SpaceCommentThreadPick): SpaceCommentThreadRef {
  return 'newThread' in pick ? { threadId: null, title: '', harness: pick.newThread, status: 'pending' } : pick;
}

/** The same thread: by id, and for pending new threads (no id yet) by harness. */
function sameThread(a: SpaceCommentThreadRef, b: SpaceCommentThreadRef): boolean {
  if (a.threadId != null || b.threadId != null) return a.threadId === b.threadId;
  return (a.harness ?? null) === (b.harness ?? null);
}

/** A first link that names a started thread: nothing more to read again. */
function settled(refs: readonly SpaceCommentThreadRef[] | undefined): boolean {
  const first = refs?.[0];
  return Boolean(first && first.threadId && first.status !== 'pending');
}

/** The links a successful answer gives `rootKey`: none when it leaves the root out. */
function refsOf(answer: object, rootKey: string): SpaceCommentThreadRef[] {
  const refs = (answer as Record<string, unknown>)[rootKey];
  return Array.isArray(refs) ? refs as SpaceCommentThreadRef[] : [];
}

/** The key a root's links are kept under: the same record key in another database is another thread. */
function linkId(database: string, rootKey: string): string {
  return `${database}\u0000${rootKey}`;
}

export function useCommentRouting(input: {
  database: string;
  /** Root record keys of the threads on screen (drafts left out): their links are read in one batch. */
  rootKeys: readonly string[];
  /** The record the page shows, for the best match. */
  recordKey: string | null;
  /**
   * The page's draft scope (`useComments` draftScope): a pick for the next new comment is kept per page, like the
   * comment's text, so a pick made on one record never links another record's comment.
   */
  draftScope?: string | null;
  /** Opens a thread when the host Comments transport has no `openThread` (the side chat transport). */
  fallbackOpen?: (threadId: string) => void;
  /** Called when a thread someone picked could not be linked, so they hear it instead of a silent "a new thread". */
  onLinkFailed?: () => void;
}): CommentRouting {
  const { database, rootKeys, recordKey, fallbackOpen } = input;
  const pickKey = input.draftScope ?? '';
  const onLinkFailed = useRef(input.onLinkFailed);
  onLinkFailed.current = input.onLinkFailed;
  const runtime = useNotisRuntime();
  const transport = runtime?.spaceComments;
  // Kept answers belong to one viewer in one Space; without a viewer nothing is kept.
  const viewer = transport?.viewer;
  const spaceId = runtime?.space?.id ?? runtime?.resource?.id ?? null;
  const session = spaceId && viewer ? JSON.stringify([viewer.id ?? viewer.name, spaceId]) : null;
  const sessionId = useCallback((id: string) => session ? `${session}\u0001${id}` : null, [session]);
  /** A root's links: as read on this screen, else as last known in the session; undefined when never read. */
  const knownLinks = useCallback((id: string, current: Record<string, SpaceCommentThreadRef[]>) => {
    if (id in current) return current[id];
    const kept = sessionId(id);
    return kept ? sessionLinks.get(kept) : undefined;
  }, [sessionId]);
  // The host may hand a new transport object (its viewer resolving): reads follow what it can do, not its identity.
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const canRead = Boolean(transport?.links);
  const hasBestMatch = Boolean(transport?.bestMatch);
  const [links, setLinks] = useState<Record<string, SpaceCommentThreadRef[]>>({});
  /** The best match answered for a page (`for`: its record key). */
  const [best, setBest] = useState<{ for: string | null; thread: SpaceCommentThreadRef | null } | null>(null);
  /** The pick for the next new comment of each page (`pickKey`). */
  const [picks, setPicks] = useState<Readonly<Record<string, SpaceCommentThreadPick>>>({});
  const newPick = picks[pickKey] ?? null;
  const setNewPick = useCallback((pick: SpaceCommentThreadPick | null, key: string) => setPicks(current => {
    if (pick) return { ...current, [key]: pick };
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  }), []);
  /** Roots whose links came back, and roots being read. */
  const read = useRef(new Set<string>());
  const reading = useRef(new Set<string>());
  /** A local link newer than a read in flight wins over its answer. */
  const writes = useRef({ seq: 0, at: new Map<string, number>() });
  const failures = useRef(0);
  const [retry, setRetry] = useState(0);
  /** Picks being linked, by link id. */
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Roots read again later: the timer of the next read (null once done), and which read it is. */
  const rereads = useRef(new Map<string, { timer: ReturnType<typeof setTimeout> | null; step: number }>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timers = rereads.current;
    return () => {
      mounted.current = false;
      for (const entry of timers.values()) if (entry.timer) clearTimeout(entry.timer);
      timers.clear();
    };
  }, []);
  const linksRef = useRef(links);
  linksRef.current = links;

  /**
   * Keeps a links answer for these roots, unless a local link was made after the read started. A root the successful
   * answer leaves out has no link (any more): it is kept with none, so an unlinked thread stops naming one and a root
   * never linked counts as read.
   */
  const keep = useCallback((keys: readonly string[], answer: unknown, startedAt: number) => {
    if (!mounted.current || !answer || typeof answer !== 'object') return;
    setLinks(current => {
      let next: Record<string, SpaceCommentThreadRef[]> | null = null;
      for (const key of keys) {
        const id = linkId(database, key);
        if ((writes.current.at.get(id) ?? 0) > startedAt) continue;
        const refs = refsOf(answer, key);
        if (!refs.length && current[id] && !current[id].length) continue;
        next ??= { ...current };
        next[id] = refs;
      }
      return next ?? current;
    });
  }, [database]);

  // One batch per change of the threads on screen, for the roots not read yet, split in requests of LINK_BATCH roots.
  const keysKey = [...rootKeys].sort().join('|');
  useEffect(() => {
    const host = transportRef.current;
    if (!canRead || !host?.links) return;
    const missing = keysKey ? keysKey.split('|').filter(key => {
      const id = linkId(database, key);
      return !read.current.has(id) && !reading.current.has(id);
    }) : [];
    for (let start = 0; start < missing.length; start += LINK_BATCH) {
      const chunk = missing.slice(start, start + LINK_BATCH);
      const ids = chunk.map(key => linkId(database, key));
      for (const id of ids) reading.current.add(id);
      const startedAt = writes.current.seq;
      host.links({ database, rootKeys: chunk }).then(answer => {
        for (const id of ids) { reading.current.delete(id); read.current.add(id); }
        failures.current = 0;
        keep(chunk, answer, startedAt);
      }, (error: unknown) => {
        for (const id of ids) reading.current.delete(id);
        console.warn('[comments] links failed', error);
        failures.current += 1;
        if (failures.current > RETRIES) {
          // Given up: these roots show their last known links, else none, rather than loading for ever.
          if (mounted.current) setLinks(current => {
            const next = { ...current };
            for (const id of ids) if (!(id in next)) next[id] = [...(knownLinks(id, current) ?? [])];
            return next;
          });
          return;
        }
        setTimeout(() => { if (mounted.current) setRetry(count => count + 1); }, RETRY_MS * 2 ** (failures.current - 1));
      });
    }
  }, [canRead, database, keysKey, retry, keep, knownLinks]);

  // What this screen read is the session's last known answer.
  useEffect(() => {
    for (const [id, refs] of Object.entries(links)) {
      const kept = sessionId(id);
      if (kept && sessionLinks.get(kept) !== refs) sessionPut(sessionLinks, kept, refs);
    }
  }, [links, sessionId]);

  /** Reads one root's links again after `REREAD_MS[step]`, then again until its first link names a started thread. */
  const rereadAt = useCallback(function rereadAt(rootKey: string, step: number) {
    const id = linkId(database, rootKey);
    const before = rereads.current.get(id);
    if (before?.timer) clearTimeout(before.timer);
    if (step >= REREAD_MS.length) { rereads.current.set(id, { timer: null, step }); return; }
    const timer = setTimeout(() => {
      const host = transportRef.current;
      if (!mounted.current || !host?.links) { rereads.current.set(id, { timer: null, step }); return; }
      const startedAt = writes.current.seq;
      const next = () => { if (mounted.current) rereadAt(rootKey, step + 1); };
      host.links({ database, rootKeys: [rootKey] }).then(answer => {
        keep([rootKey], answer, startedAt);
        const now = answer && typeof answer === 'object' && (writes.current.at.get(id) ?? 0) <= startedAt
          ? refsOf(answer, rootKey) : linksRef.current[id];
        if (settled(now)) rereads.current.set(id, { timer: null, step: REREAD_MS.length });
        else next();
      }, (error: unknown) => { console.warn('[comments] links failed', error); next(); });
    }, REREAD_MS[step]);
    rereads.current.set(id, { timer, step });
  }, [database, keep]);

  const reread = useCallback((rootKey: string) => {
    if (!transportRef.current?.links) return;
    rereadAt(rootKey, 0);
  }, [rereadAt]);

  // A pending new thread on screen is read again until the first wake names the thread it started (once per root).
  useEffect(() => {
    if (!canRead) return;
    const prefix = `${database}\u0000`;
    for (const [id, refs] of Object.entries(links)) {
      if (!id.startsWith(prefix) || savingIds.has(id) || rereads.current.has(id)) continue;
      const first = refs[0];
      if (first && !settled(refs)) rereadAt(id.slice(prefix.length), 0);
    }
  }, [canRead, links, database, savingIds, rereadAt]);

  const bestId = sessionId(`best\u0000${recordKey ?? ''}`);
  useEffect(() => {
    const host = transportRef.current;
    if (!hasBestMatch || !host?.bestMatch) return undefined;
    let alive = true;
    host.bestMatch({ recordKey }).then(thread => {
      if (!alive) return;
      setBest({ for: recordKey, thread: thread ?? null });
      if (bestId) sessionPut(sessionBest, bestId, thread ?? null);
    }, (error: unknown) => {
      if (alive) setBest({ for: recordKey, thread: null });
      console.warn('[comments] best match failed', error);
    });
    return () => { alive = false; };
  }, [hasBestMatch, recordKey, bestId]);
  // Only this page's best match: another page's would name a thread this one does not go to.
  const answered = best !== null && best.for === recordKey;
  const bestKnown = !hasBestMatch || answered || Boolean(bestId && sessionBest.has(bestId));
  const bestMatch = !hasBestMatch ? null : answered ? best.thread : (bestId && sessionBest.get(bestId)) || null;

  const linksOf = useCallback((rootKey: string) => knownLinks(linkId(database, rootKey), links) ?? NONE,
    [links, database, knownLinks]);
  const goesTo = useCallback((rootKey: string) => (knownLinks(linkId(database, rootKey), links) ?? NONE)[0] ?? bestMatch,
    [links, database, bestMatch, knownLinks]);
  const known = useCallback((rootKey: string) => {
    const refs = knownLinks(linkId(database, rootKey), links);
    return Boolean(refs && (refs.length || bestKnown));
  }, [links, database, bestKnown, knownLinks]);

  const pickId = (pick: SpaceCommentThreadPick | null) => pick && 'threadId' in pick ? pick.threadId : null;

  const pickForNew = useCallback(async (anchor: HTMLElement) => {
    const host = transportRef.current;
    if (!host?.pickThread) return null;
    try {
      const pick = await host.pickThread({ anchor, current: pickId(newPick) ?? bestMatch?.threadId ?? null });
      if (pick) setNewPick(pick, pickKey);
      return pick ?? null;
    } catch (error) {
      console.warn('[comments] thread picker failed', error);
      return null;
    }
  }, [newPick, bestMatch, pickKey, setNewPick]);

  /** Puts `thread` first in a root's links and returns the write's number (a later read never overwrites it). */
  const remember = useCallback((rootKey: string, thread: SpaceCommentThreadRef) => {
    const id = linkId(database, rootKey);
    writes.current.seq += 1;
    writes.current.at.set(id, writes.current.seq);
    read.current.add(id);
    setLinks(current => ({
      ...current,
      [id]: [thread, ...(knownLinks(id, current) ?? NONE).filter(item => !sameThread(item, thread))],
    }));
    return writes.current.seq;
  }, [database, knownLinks]);

  const markSaving = useCallback((id: string, on: boolean) => setSavingIds(current => {
    if (current.has(id) === on) return current;
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);

  /**
   * Shows the pick at once (saving), links it, then keeps the thread the host answers. A failure puts the links back
   * as they were (unless a newer link came since) and, when `loud`, says so.
   */
  const linkShown = useCallback(async (rootKey: string, pick: SpaceCommentThreadPick, primary: boolean, loud: boolean) => {
    const host = transportRef.current;
    if (!host?.link) return;
    const id = linkId(database, rootKey);
    const before = knownLinks(id, linksRef.current);
    const mine = remember(rootKey, refOfPick(pick));
    markSaving(id, true);
    const undo = () => {
      if (writes.current.at.get(id) !== mine) return;
      setLinks(current => {
        const next = { ...current };
        next[id] = [...(before ?? [])];
        return next;
      });
    };
    try {
      const thread = await host.link({ database, rootKey, pick, ...(primary ? { primary: true } : {}) });
      if (thread) {
        if (writes.current.at.get(id) === mine) remember(rootKey, thread);
      } else {
        undo();
        if (loud) onLinkFailed.current?.();
      }
    } catch (error) {
      console.warn('[comments] link failed', error);
      undo();
      if (loud) onLinkFailed.current?.();
    } finally {
      if (mounted.current) markSaving(id, false);
    }
  }, [database, remember, markSaving, knownLinks]);

  const change = useCallback(async (rootKey: string, anchor: HTMLElement) => {
    const host = transportRef.current;
    if (!host?.pickThread || !host.link) return;
    let pick: SpaceCommentThreadPick | null;
    try {
      pick = await host.pickThread({ anchor,
        current: (knownLinks(linkId(database, rootKey), linksRef.current) ?? NONE)[0]?.threadId ?? null });
    } catch (error) {
      console.warn('[comments] thread picker failed', error);
      onLinkFailed.current?.();
      return;
    }
    if (!pick) return;
    await linkShown(rootKey, pick, true, true);
  }, [database, linkShown, knownLinks]);

  const linkNew = useCallback(async (rootKey: string) => {
    const pick = newPick ?? bestMatch;
    setNewPick(null, pickKey);
    if (!pick || !transportRef.current?.link) return;
    // Only a pick someone made says it failed; the best match failing quietly leaves "a new thread".
    await linkShown(rootKey, pick, false, Boolean(newPick));
  }, [newPick, bestMatch, linkShown, pickKey, setNewPick]);

  const saving = useCallback((rootKey: string) => savingIds.has(linkId(database, rootKey)), [savingIds, database]);

  const clearPick = useCallback(() => setNewPick(null, pickKey), [pickKey, setNewPick]);
  const hostOpens = Boolean(transport?.openThread);
  const open = useMemo(() => hostOpens ? (threadId: string) => transportRef.current?.openThread?.(threadId) : fallbackOpen,
    [hostOpens, fallbackOpen]);
  const canPick = Boolean(transport?.pickThread);
  const canLink = Boolean(transport?.pickThread && transport?.link);

  return useMemo(() => ({
    links: canRead, linksOf, goesTo, bestMatch, hasBestMatch, newPick,
    canPick, canLink, pickForNew, clearPick, change, linkNew, saving, reread, known, open,
  }), [canRead, linksOf, goesTo, bestMatch, hasBestMatch, newPick, canPick, canLink, pickForNew, clearPick, change, linkNew,
    saving, reread, known, open]);
}
