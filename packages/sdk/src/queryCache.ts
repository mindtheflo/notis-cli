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
  /** What rows the read holds, so a write to that database shows in it at once (see `optimistic`). */
  rows?: RowsDescriptor;
}

/** The rows a read holds: its database binding and where the rows sit in its answer. */
export interface RowsDescriptor {
  binding: string;
  /** The answer field holding the rows ('documents', 'rows'), or '' when the answer is the list itself. */
  at: string;
  /** 'native': rows as the native query returns them; 'document': normalized `DocumentRecord`s. */
  shape: 'native' | 'document';
  /** The query whose filter and sorts the rows follow, when the page sends it (never a Space's private filter). */
  query?: unknown;
  /** A Space `shows` list name: its filter stays on the server, so a new row shows there only when asked. */
  list?: string;
}

/** One read a change applies to: its descriptor and cache key. */
export interface RowsRead extends RowsDescriptor { key: string }

type Row = Record<string, unknown>;

/**
 * How one write changes the rows of one database binding, read by read. `project` returns the row as that read
 * should show it, or `undefined` to leave the read alone; `keeps` says whether the read still holds it (else it
 * leaves, and a later write to it can bring it back). `insert` asks for the row in reads that do not hold it yet
 * (given `undefined`), placed where `position` puts it, else at the top. `related` gives every row the reads of the
 * database returned, to learn property types and options from. `exact` says the row shows the whole write, so it
 * can take the revision the write made.
 */
export interface RowChange {
  binding: string;
  /** The row's key; a temporary one for a row being created, replaced on `commit`. */
  recordKey: string;
  insert?: boolean;
  project(row: Row | undefined, read: RowsRead, related: () => readonly Row[]): Row | undefined;
  keeps?(row: Row, read: RowsRead, related: () => readonly Row[]): boolean;
  exact?(row: Row): boolean;
  /** Where the row goes among `rows` (without it): a sorted place, or -1 to keep its place. */
  position?(rows: readonly Row[], row: Row, read: RowsRead, related: () => readonly Row[]): number;
}

/**
 * The native rows behind a read whose rows are reshaped (`useNativeDocuments` flattens them), kept on its answer
 * under this symbol (never serialized) so writes learn property types and options from them.
 */
export const NATIVE_ROWS = Symbol.for('notis.nativeRows');

/** Marks a row shown ahead of the server while its write runs (a symbol: never sent, never serialized). */
export const OPTIMISTIC_ROW = Symbol.for('notis.optimisticRow');
export interface OptimisticRowState {
  /** When the write started (ms, the client's clock). */
  since: number;
  /** A row being created: its key is temporary, so it cannot be opened or changed yet. */
  creating: boolean;
}
/** The saving state of a row the cache shows ahead of the server, or null once confirmed. */
export function optimisticRowState(row: unknown): OptimisticRowState | null {
  return row && typeof row === 'object' ? ((row as Record<symbol, unknown>)[OPTIMISTIC_ROW] as OptimisticRowState | undefined) ?? null : null;
}

/** A write shown before the server answers. */
export interface OptimisticWrite {
  /**
   * It succeeded: the change stays shown until every read that could still hold older rows reads again. A new row's
   * temporary key becomes `recordKey` (and its id `id`); the rows take the `revision` the write made.
   */
  commit(confirmed?: { recordKey?: string; id?: string; revision?: number }): void;
  /** It failed: only this write's change goes away. */
  rollback(): void;
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
  /** Shows a write in every cached read of its database at once, layered over the server's rows (see `RowChange`). */
  optimistic?(changes: readonly RowChange[]): OptimisticWrite;
}

export interface HiddenRecords {
  commit(recordKeys?: readonly string[]): void;
  restore(recordKeys?: readonly string[]): void;
}

export function recordKeyOf(item: unknown): string | undefined {
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

/** The rows at `at` in `data`, or null when the answer has none there. */
function rowsAt(data: unknown, at: string): Row[] | null {
  const list = at ? (data && typeof data === 'object' ? (data as Row)[at] : undefined) : data;
  return Array.isArray(list) ? list as Row[] : null;
}

function withRowsAt(data: unknown, at: string, rows: Row[]): unknown {
  return at ? { ...(data as Row), [at]: rows } : rows;
}

/**
 * The rows after `changes`, or the same array when none applies; `saving` marks the rows of a running write. `left`
 * holds the rows earlier writes took out of this read, so a later write that brings one back finds it.
 */
function changedRows(rows: Row[], changes: readonly RowChange[], read: RowsRead, related: () => readonly Row[],
  saving: OptimisticRowState | null, left: Map<string, Row>): Row[] {
  let out = rows;
  for (const change of changes) {
    if (change.binding !== read.binding) continue;
    const index = out.findIndex((row) => recordKeyOf(row) === change.recordKey);
    const current = index === -1 ? left.get(change.recordKey) : out[index];
    if (current === undefined && !change.insert) continue;
    let next = change.project(current, read, related);
    if (next === undefined) continue;
    if (out === rows) out = rows.slice();
    if (index !== -1) out.splice(index, 1);
    left.delete(change.recordKey);
    if (change.keeps && !change.keeps(next, read, related)) { left.set(change.recordKey, next); continue; }
    if (next === current) next = { ...next };
    if (saving) {
      Object.defineProperty(next, OPTIMISTIC_ROW, { value: { ...saving, creating: saving.creating && !!change.insert },
        enumerable: false, configurable: true });
    } else if (OPTIMISTIC_ROW in next) {
      next = { ...next };
    }
    let at = change.position ? change.position(out, next, read, related) : -1;
    if (at < 0) at = index === -1 ? 0 : index;
    out.splice(Math.min(at, out.length), 0, next);
  }
  return out;
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
  key: string;
  rows?: RowsDescriptor;
  /** The optimistic writes last applied, so a refresh only republishes reads they change. */
  applied: string;
  /** A read answered while a new row of its database was being saved: shown once that write settles. */
  deferred?: { data: unknown; seq: number; updatedAt: number };
};

type Write = { id: number; changes: RowChange[]; bindings: Set<string>; committed: number | null; since: number;
  /** When it was sent, on the client's `seq` clock. */
  sent: number;
  /** The revision the confirmed write made, when the server said. */
  revision?: number };

/** Whether `rows` (a read's own answer) already hold a confirmed write: its new row, or its edit's revision. */
function holds(rows: readonly Row[], write: Write, binding: string): boolean {
  return write.changes.every((change) => {
    if (change.binding !== binding) return true;
    const row = rows.find((candidate) => recordKeyOf(candidate) === change.recordKey);
    if (change.insert) return !!row;
    if (!row) return true;
    return write.revision !== undefined && typeof row.revision === 'number' && row.revision >= write.revision;
  });
}

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
  // Writes shown before the server answers, oldest first.
  let writes: Write[] = [];
  let writeIds = 0;

  function prune(keep?: string) {
    for (const [oldKey, old] of entries) {
      if (entries.size <= maxEntries) break;
      if (oldKey !== keep && !old.listeners.size && !old.pending) entries.delete(oldKey);
    }
  }
  function entry(key: string): Entry {
    let value = entries.get(key);
    if (!value) {
      value = { raw: EMPTY, snapshot: EMPTY, removed: '', dataSeq: 0, listeners: new Set(), generation: 0, applied: '', key };
      entries.set(key, value);
    }
    // Only operations, not getSnapshot during render, update the LRU.
    entries.delete(key);
    entries.set(key, value);
    prune(key);
    return value;
  }
  /** The writes a read still needs layered over its rows: pending ones, and committed ones it read before. */
  function writesFor(value: Entry): Write[] {
    const rows = value.rows;
    if (!rows || !writes.length || !value.raw.hasData) return [];
    return writes.filter((write) => write.bindings.has(rows.binding)
      && (write.committed === null || (value.dataSeq < write.committed && !holdsWrite(value, write))));
  }
  /** A read that started before the write was confirmed may still have answered with it (the host reads again first). */
  function holdsWrite(value: Entry, write: Write): boolean {
    const list = value.rows && value.raw.hasData ? rowsAt(value.raw.data, value.rows.at) : null;
    return !!list && holds(list, write, value.rows!.binding);
  }
  /** Recomputes the shown snapshot; without `rawChanged`, only when the hidden records or the writes changed for it. */
  function view(value: Entry, rawChanged: boolean): boolean {
    const layered = writesFor(value);
    const applied = layered.map((write) => `${write.id}:${write.committed ?? ''}`).join(',');
    let data = value.raw.data;
    if (layered.length && value.rows) {
      const read = { ...value.rows, key: value.key };
      const list = rowsAt(data, read.at);
      if (list) {
        let next = list;
        const related = () => relatedRows(read.binding);
        const left = new Map<string, Row>();
        for (const write of layered) {
          next = changedRows(next, write.changes, read, related,
            write.committed === null ? { since: write.since, creating: true } : null, left);
        }
        if (next !== list) data = withRowsAt(data, read.at, next);
      }
    }
    // Hidden records are taken out after the writes, so a new row deleted before the reads hold it leaves too.
    const removed: string[] = [];
    if (hidden.size && value.raw.hasData) {
      data = withoutRecords(data, (key) => {
        if (!hidden.has(key)) return false;
        const committed = hidden.get(key);
        return committed === null || committed === undefined || value.dataSeq < committed;
      }, removed);
    }
    const signature = removed.sort().join('\u0000');
    if (!rawChanged && value.removed === signature && value.applied === applied) return false;
    value.removed = signature;
    value.applied = applied;
    value.snapshot = data === value.raw.data ? value.raw : { ...value.raw, data };
    return true;
  }
  // Every row the reads of a database returned, for changes to learn its property types and options from.
  const related = new Map<string, Row[]>();
  function relatedRows(binding: string): Row[] {
    let rows = related.get(binding);
    if (!rows) {
      rows = [];
      for (const value of entries.values()) {
        if (value.rows?.binding !== binding || !value.raw.hasData) continue;
        const native = (value.raw.data as Record<symbol, unknown> | null)?.[NATIVE_ROWS];
        rows.push(...(Array.isArray(native) ? native as Row[] : rowsAt(value.raw.data, value.rows.at) ?? []));
      }
      related.set(binding, rows);
    }
    return rows;
  }
  function publish(value: Entry, raw: QuerySnapshot) {
    if (raw.data !== value.raw.data) related.clear();
    value.raw = raw;
    view(value, true);
    for (const listener of value.listeners) listener();
  }
  /** A committed delete stays hidden while an older read holds or could still return the record. */
  function sweep() {
    for (const [key, committed] of hidden) {
      if (committed === null) continue;
      let held = writes.some((write) => write.changes.some((change) => change.insert && change.recordKey === key));
      for (const value of entries.values()) {
        if (value.pending && value.pendingSeq !== undefined && value.pendingSeq < committed) { held = true; break; }
        if (value.dataSeq >= committed || !value.raw.hasData) continue;
        const found: string[] = [];
        withoutRecords(value.raw.data, (candidate) => candidate === key, found);
        if (found.length) { held = true; break; }
      }
      if (!held) hidden.delete(key);
    }
    const before = writes.length;
    writes = writes.filter((write) => {
      if (write.committed === null) return true;
      for (const value of entries.values()) {
        if (!value.rows || !write.bindings.has(value.rows.binding)) continue;
        if (value.pending && value.pendingSeq !== undefined && value.pendingSeq < write.committed) return true;
        if (value.raw.hasData && value.dataSeq < write.committed && !holdsWrite(value, write)) return true;
      }
      return false;
    });
    if (writes.length !== before) refresh();
  }
  /**
   * A read that started after a new row was sent may already hold it under its real key, which only the receipt
   * names: until then the shown row keeps its temporary key, and that read would list the row twice.
   */
  function savingInsert(value: Entry, startSeq: number): boolean {
    const binding = value.rows?.binding;
    return !!binding && value.raw.hasData && writes.some((write) => write.committed === null && write.sent < startSeq
      && write.changes.some((change) => change.insert && change.binding === binding));
  }
  /** Shows the reads held back by `savingInsert` once no new row they could hold is still being saved. */
  function release() {
    for (const value of entries.values()) {
      const deferred = value.deferred;
      if (!deferred || savingInsert(value, deferred.seq)) continue;
      value.deferred = undefined;
      value.dataSeq = deferred.seq;
      publish(value, { ...value.raw, data: deferred.data, hasData: true, updatedAt: deferred.updatedAt });
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
      if (fetchOptions.rows) value.rows = fetchOptions.rows;
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
        if (canCommit() && savingInsert(value, startSeq)) {
          value.deferred = { data, seq: startSeq, updatedAt: now() };
          publish(value, { ...value.raw, isFetching: false, error: null });
        } else if (canCommit()) {
          value.deferred = undefined;
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
        if (value.deferred) value.deferred.updatedAt = 0;
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
        value.deferred = undefined;
        publish(value, { ...EMPTY, invalidation: value.raw.invalidation + 1 });
      }
      writes = [];
      for (const [key, value] of entries) if (!value.listeners.size) entries.delete(key);
      sweep();
    },
    optimistic(changes) {
      const write: Write = { id: ++writeIds, changes: [...changes], bindings: new Set(changes.map((change) => change.binding)),
        committed: null, since: now(), sent: ++seq };
      if (disposed || !write.changes.length) return { commit() {}, rollback() {} };
      writes.push(write);
      const startEpoch = epoch;
      refresh();
      let settled = false;
      return {
        commit(confirmed) {
          if (settled || epoch !== startEpoch) return;
          settled = true;
          const { recordKey, revision } = confirmed ?? {};
          write.changes = write.changes.map((change) => {
            const project = change.project;
            if (change.insert && recordKey) {
              return { ...change, recordKey, project: (row, read, rows) => {
                // Once the server's rows hold it, the new row is theirs.
                if (row) return undefined;
                const next = project(undefined, read, rows);
                if (!next) return next;
                const renamed: Row = { ...next, id: confirmed?.id ?? recordKey };
                for (const field of ['recordKey', 'record_key'] as const) if (field in next) renamed[field] = recordKey;
                if (revision !== undefined) renamed.revision = revision;
                return renamed;
              } };
            }
            // The next edit of a changed row must name the revision this write made.
            if (change.insert || revision === undefined) return change;
            return { ...change, project: (row, read, rows) => {
              const next = project(row, read, rows);
              // A row that could not show every written value keeps its revision: it is not the saved row yet.
              return next && (change.exact?.(next) ?? true) ? { ...next, revision } : next;
            } };
          });
          // Reads that started after this hold the write themselves; older ones keep it layered until their rows do.
          write.revision = revision;
          write.committed = ++seq;
          release();
          refresh();
          sweep();
        },
        rollback() {
          if (settled) return;
          settled = true;
          writes = writes.filter((candidate) => candidate !== write);
          release();
          refresh();
        },
      };
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
