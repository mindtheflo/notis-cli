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
  snapshot: QuerySnapshot;
  listeners: Set<() => void>;
  generation: number;
  pending?: Promise<unknown>;
};

export function createQueryClient(options: {
  maxEntries?: number;
  now?: () => number;
  schedule?: ReturnType<typeof createPrefetchQueue>;
} = {}): NotisQueryClient {
  const entries = new Map<string, Entry>();
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 100;
  const schedule = options.schedule ?? createPrefetchQueue(2);
  let epoch = 0;
  let disposed = false;
  let revision = 0;

  function prune(keep?: string) {
    for (const [oldKey, old] of entries) {
      if (entries.size <= maxEntries) break;
      if (oldKey !== keep && !old.listeners.size && !old.pending) entries.delete(oldKey);
    }
  }
  function entry(key: string): Entry {
    let value = entries.get(key);
    if (!value) {
      value = { snapshot: EMPTY, listeners: new Set(), generation: 0 };
      entries.set(key, value);
    }
    // Only operations, not getSnapshot during render, update the LRU.
    entries.delete(key);
    entries.set(key, value);
    prune(key);
    return value;
  }
  function publish(value: Entry, snapshot: QuerySnapshot) {
    value.snapshot = snapshot;
    for (const listener of value.listeners) listener();
  }
  const client: NotisQueryClient = {
    getSnapshot<T>(key: string) { return (entries.get(key)?.snapshot ?? EMPTY) as QuerySnapshot<T>; },
    subscribe(key, listener) {
      const value = entry(key);
      value.listeners.add(listener);
      return () => { value.listeners.delete(listener); prune(); };
    },
    fetch<T>(key: string, read: () => Promise<T>, fetchOptions: QueryFetchOptions = {}) {
      if (disposed) return Promise.reject(new Error('App query scope is no longer available.'));
      const value = entry(key);
      if (value.pending) return value.pending as Promise<T>;
      if (!fetchOptions.force && value.snapshot.hasData && value.snapshot.updatedAt > 0
        && now() - value.snapshot.updatedAt < (fetchOptions.staleTimeMs ?? 30_000)) {
        return Promise.resolve(value.snapshot.data as T);
      }
      const generation = ++value.generation;
      const requestEpoch = epoch;
      const canCommit = () => epoch === requestEpoch && value.generation === generation && entries.get(key) === value;
      const request = Promise.resolve().then(read).then((data) => {
        if (canCommit()) publish(value, { ...value.snapshot, data, hasData: true, isFetching: false, error: null, updatedAt: now() });
        return data;
      }, (reason) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        if (canCommit()) publish(value, { ...value.snapshot, isFetching: false, error });
        throw error;
      }).finally(() => { if (value.pending === request) value.pending = undefined; prune(); });
      value.pending = request;
      publish(value, { ...value.snapshot, isFetching: true, error: null });
      return request;
    },
    prefetch<T>(key: string, read: () => Promise<T>, fetchOptions?: QueryFetchOptions) {
      const requestEpoch = epoch;
      return schedule(() => {
        if (epoch !== requestEpoch) throw new Error('App query scope was cleared.');
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
        publish(value, { ...value.snapshot, updatedAt: 0, isFetching: false, invalidation: value.snapshot.invalidation + 1 });
      }
    },
    dispose() { disposed = true; client.clear(); },
    clear() {
      revision += 1;
      epoch += 1;
      for (const value of entries.values()) {
        value.generation += 1;
        value.pending = undefined;
        publish(value, { ...EMPTY, invalidation: value.snapshot.invalidation + 1 });
      }
      for (const [key, value] of entries) if (!value.listeners.size) entries.delete(key);
    },
  };
  return client;
}
