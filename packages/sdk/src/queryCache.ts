import { SdkQueryError } from './queryErrors';

/** In-memory read snapshots. The host owns the lifetime and authorization scope. */
export interface QuerySnapshot<T = unknown> {
  data: T | undefined;
  hasData: boolean;
  isFetching: boolean;
  error: Error | null;
  updatedAt: number;
  invalidation: number;
}

export interface QueryFetchOptions {
  staleTimeMs?: number;
  force?: boolean;
}

export interface NotisQueryClient {
  getSnapshot<T>(key: string): QuerySnapshot<T>;
  subscribe(key: string, listener: () => void): () => void;
  fetch<T>(key: string, read: () => Promise<T>, options?: QueryFetchOptions): Promise<T>;
  prefetch<T>(key: string, read: () => Promise<T>, options?: QueryFetchOptions): Promise<T>;
  invalidate(key?: string): void;
  clear(): void;
  /** Host-only: permanently retire a revoked security scope. */
  dispose?(): void;
  getRevision?(): number;
  /**
   * Hides records (by `record_key` / `recordKey`) from every cached read at once, so a delete
   * looks done before the server answers. `commit` keeps them hidden until each read that still
   * holds them is read again; `restore` shows them again (a failed or undone delete).
   */
  hideRecords?(recordKeys: readonly string[]): HiddenRecords;
}

export interface HiddenRecords {
  commit(recordKeys?: readonly string[]): void;
  restore(recordKeys?: readonly string[]): void;
}

function recordKeyOf(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const record = item as { record_key?: unknown; recordKey?: unknown };
  const key = record.record_key ?? record.recordKey;
  return typeof key === 'string' ? key : undefined;
}

/** Rows, documents or a bare list without the hidden records; the same reference when none are. */
function withoutRecords(data: unknown, hides: (key: string) => boolean, removed: string[]): unknown {
  const filter = (list: unknown[]) => {
    const kept = list.filter((item) => {
      const key = recordKeyOf(item);
      if (key === undefined || !hides(key)) return true;
      removed.push(key);
      return false;
    });
    return kept.length === list.length ? list : kept;
  };
  if (Array.isArray(data)) return filter(data);
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  let result = record;
  for (const field of ['rows', 'documents']) {
    const list = record[field];
    if (!Array.isArray(list)) continue;
    const kept = filter(list);
    if (kept !== list) result = { ...result, [field]: kept };
  }
  return result;
}

const EMPTY: QuerySnapshot = Object.freeze({
  data: undefined, hasData: false, isFetching: false, error: null, updatedAt: 0, invalidation: 0,
});

/** Stable keys distinguish filters, pagination, and resource identities. */
export function queryKey(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(queryKey).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${queryKey(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** One shared queue can bound descriptor and data speculation together. */
export function createPrefetchQueue(concurrency = 2) {
  let active = 0;
  const waiting: Array<() => void> = [];
  function drain() {
    while (active < concurrency && waiting.length) waiting.shift()!();
  }
  return <T>(read: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    waiting.push(() => {
      active += 1;
      Promise.resolve().then(read).then(resolve, reject).finally(() => { active -= 1; drain(); });
    });
    drain();
  });
}

type Entry = {
  /** What the reads returned; `snapshot` is the same without hidden records. */
  raw: QuerySnapshot;
  snapshot: QuerySnapshot;
  removed: string;
  /** When the read behind `raw.data` started, on the client's `seq` clock. */
  dataSeq: number;
  listeners: Set<() => void>;
  generation: number;
  pending?: Promise<unknown>;
  /** When the in-flight read started, including a first read with no raw snapshot yet. */
  pendingSeq?: number;
};

export function createQueryClient(options: {
  maxEntries?: number;
  now?: () => number;
  schedule?: ReturnType<typeof createPrefetchQueue>;
  /** Bounds idempotent reads only; never retries the underlying callback. */
  readTimeoutMs?: number;
} = {}): NotisQueryClient {
  const entries = new Map<string, Entry>();
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 100;
  const schedule = options.schedule ?? createPrefetchQueue(2);
  let epoch = 0;
  let disposed = false;
  let revision = 0;
  let seq = 0;
  // null while the delete runs; then the `seq` it committed at.
  const hidden = new Map<string, number | null>();

  function prune(keep?: string) {
    for (const [oldKey, old] of entries) {
      if (entries.size <= maxEntries) break;
      if (oldKey !== keep && !old.listeners.size && !old.pending) entries.delete(oldKey);
    }
  }
  function entry(key: string): Entry {
    let value = entries.get(key);
    if (!value) {
      value = { raw: EMPTY, snapshot: EMPTY, removed: '', dataSeq: 0, listeners: new Set(), generation: 0 };
      entries.set(key, value);
    }
    // Only operations, not getSnapshot during render, update the LRU.
    entries.delete(key);
    entries.set(key, value);
    prune(key);
    return value;
  }
  /** Recomputes the shown snapshot; without `rawChanged`, only when other records are hidden now. */
  function view(value: Entry, rawChanged: boolean): boolean {
    const removed: string[] = [];
    const data = hidden.size && value.raw.hasData ? withoutRecords(value.raw.data, (key) => {
      if (!hidden.has(key)) return false;
      const committed = hidden.get(key);
      return committed === null || committed === undefined || value.dataSeq < committed;
    }, removed) : value.raw.data;
    const signature = removed.sort().join('\u0000');
    if (!rawChanged && value.removed === signature) return false;
    value.removed = signature;
    value.snapshot = data === value.raw.data ? value.raw : { ...value.raw, data };
    return true;
  }
  function publish(value: Entry, raw: QuerySnapshot) {
    value.raw = raw;
    view(value, true);
    for (const listener of value.listeners) listener();
  }
  /** A committed delete stays hidden while an older read holds or could still return the record. */
  function sweep() {
    for (const [key, committed] of hidden) {
      if (committed === null) continue;
      let held = false;
      for (const value of entries.values()) {
        if (value.pending && value.pendingSeq !== undefined && value.pendingSeq < committed) { held = true; break; }
        if (value.dataSeq >= committed || !value.raw.hasData) continue;
        const found: string[] = [];
        withoutRecords(value.raw.data, (candidate) => candidate === key, found);
        if (found.length) { held = true; break; }
      }
      if (!held) hidden.delete(key);
    }
  }
  function refresh() {
    for (const value of entries.values()) {
      if (view(value, false)) for (const listener of value.listeners) listener();
    }
  }
  const client: NotisQueryClient = {
    getSnapshot<T>(key: string) { return (entries.get(key)?.snapshot ?? EMPTY) as QuerySnapshot<T>; },
    subscribe(key, listener) {
      const value = entry(key);
      value.listeners.add(listener);
      return () => { value.listeners.delete(listener); prune(); };
    },
    fetch<T>(key: string, read: () => Promise<T>, fetchOptions: QueryFetchOptions = {}) {
      if (disposed) return Promise.reject(new SdkQueryError('scopeUnavailable'));
      const value = entry(key);
      if (value.pending) return value.pending as Promise<T>;
      if (!fetchOptions.force && value.snapshot.hasData && value.snapshot.updatedAt > 0
        && now() - value.snapshot.updatedAt < (fetchOptions.staleTimeMs ?? 30_000)) {
        return Promise.resolve(value.snapshot.data as T);
      }
      const generation = ++value.generation;
      const requestEpoch = epoch;
      const startSeq = ++seq;
      const canCommit = () => epoch === requestEpoch && value.generation === generation && entries.get(key) === value;
      let timeout: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new SdkQueryError('timedOut')), options.readTimeoutMs ?? 30_000);
        // Node-based verification must not stay alive for a retired browser read.
        if (typeof timeout === 'object' && 'unref' in timeout) timeout.unref();
      });
      const request = Promise.race([Promise.resolve().then(read), deadline]).then((data) => {
        if (canCommit()) {
          value.dataSeq = startSeq;
          publish(value, { ...value.raw, data, hasData: true, isFetching: false, error: null, updatedAt: now() });
          if (hidden.size) sweep();
        }
        return data;
      }, (reason) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        if (canCommit()) publish(value, { ...value.raw, isFetching: false, error });
        throw error;
      }).finally(() => {
        clearTimeout(timeout);
        if (value.pending === request) { value.pending = undefined; value.pendingSeq = undefined; }
        if (hidden.size) sweep();
        prune();
      });
      value.pending = request;
      value.pendingSeq = startSeq;
      publish(value, { ...value.raw, isFetching: true, error: null });
      return request;
    },
    prefetch<T>(key: string, read: () => Promise<T>, fetchOptions?: QueryFetchOptions) {
      const requestEpoch = epoch;
      return schedule(() => {
        if (epoch !== requestEpoch) throw new SdkQueryError('scopeCleared');
        return client.fetch(key, read, fetchOptions);
      });
    },
    getRevision: () => revision,
    invalidate(key) {
      revision += 1;
      for (const [entryKey, value] of entries) {
        if (key !== undefined && entryKey !== key) continue;
        value.generation += 1;
        value.pending = undefined;
        value.pendingSeq = undefined;
        publish(value, { ...value.raw, updatedAt: 0, isFetching: false, invalidation: value.raw.invalidation + 1 });
      }
    },
    dispose() { disposed = true; client.clear(); },
    clear() {
      revision += 1;
      epoch += 1;
      for (const value of entries.values()) {
        value.generation += 1;
        value.pending = undefined;
        value.pendingSeq = undefined;
        value.dataSeq = 0;
        publish(value, { ...EMPTY, invalidation: value.raw.invalidation + 1 });
      }
      for (const [key, value] of entries) if (!value.listeners.size) entries.delete(key);
      sweep();
    },
    hideRecords(recordKeys) {
      const own = [...new Set(recordKeys.filter((key) => typeof key === 'string' && key))];
      for (const key of own) hidden.set(key, null);
      refresh();
      const pick = (keys?: readonly string[]) => (keys ? own.filter((key) => keys.includes(key)) : own);
      return {
        commit(keys) {
          const at = ++seq;
          for (const key of pick(keys)) if (hidden.get(key) === null) hidden.set(key, at);
          sweep();
          refresh();
        },
        restore(keys) {
          for (const key of pick(keys)) hidden.delete(key);
          refresh();
        },
      };
    },
  };
  return client;
}
