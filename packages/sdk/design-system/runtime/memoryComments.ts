/**
 * An in-memory comment store behind `SpaceCommentsTransport`, for the design book and the SDK tests: it answers
 * `list` from its rows, applies every write the way the server does (stamps author, dates, change and revision) and
 * tells subscribers after each one. Nothing reaches the network. `fail(op, code)` makes the next call of `op` reject
 * with an Error carrying that `code`, as the server does.
 */
import type {
  SpaceCommentFile, SpaceCommentInsert, SpaceCommentPage, SpaceCommentPageKey, SpaceCommentReply, SpaceCommentRow,
  SpaceCommentsTransport, SpaceCommentViewer,
} from '../../src';

export type MemoryCommentOp = 'list' | 'insert' | 'reply' | 'edit' | 'archive' | 'unarchive' | 'remove' | 'restore' | 'answer' | 'upload';

export interface MemoryCommentStore {
  transport: SpaceCommentsTransport;
  /** The rows as stored now. */
  rows: SpaceCommentRow[];
  /** Every write and upload, in order, with its input (reads are counted in `reads`). */
  calls: Array<{ op: MemoryCommentOp; input: Record<string, unknown> }>;
  /** How many times the comments were listed. */
  reads(): number;
  /** While true every write rejects (code `failed`). */
  setFailing(failing: boolean): void;
  /** The next call of `op` rejects with an Error whose `code` is `code`. */
  fail(op: MemoryCommentOp, code?: string): void;
  /** Holds every call of `op` until `release()` (to see a write in flight). */
  hold(op: MemoryCommentOp): { release(): void };
  /** Tells subscribers the comments changed (a write elsewhere). */
  emit(): void;
  /** How many subscribers listen now. */
  listeners(): number;
}

export interface MemoryCommentOptions {
  rows?: readonly Partial<SpaceCommentRow>[];
  /** The signed-in viewer. Default Flo, who can edit the Space; null: not known yet. */
  viewer?: SpaceCommentViewer | null;
  /** The page the host shows. Default: none (the Space home). */
  page?: SpaceCommentPage | null;
  /** Whether files can be attached (`upload`). Default true. */
  upload?: boolean;
  /** The first write's time; each write is a minute later. */
  startAt?: string;
  /** More transport parts (routing, startComment, revealComment...). */
  extra?: Partial<SpaceCommentsTransport>;
  /** Where to log the calls (default a new array). */
  calls?: MemoryCommentStore['calls'];
  /** Every write rejects (code `failed`). */
  failing?: boolean;
}

const SPACE_ID = 'space-design-book';

/** A full store row from a few fields: an open page comment by Flo unless said otherwise. */
export function commentRow(partial: Partial<SpaceCommentRow> & { id: string }): SpaceCommentRow {
  const created = partial.created_at ?? '2026-06-15T08:00:00Z';
  return {
    space_id: SPACE_ID, view: null, page_key: null, thread_root_id: null, mode: 'page', anchor_keys: [],
    x: null, y: null, w: null, h: null, time_start: null, time_end: null, field: null, quote: null, prefix: null, suffix: null,
    body: '', status: 'open', needs: 'none', options: [], answer: null, answered_at: null, answer_to: null,
    change: partial.thread_root_id ? 'replied' : 'created', attachments: [],
    author: { user_id: 'user-flo', name: 'Flo', you: true }, agent: null, example: false, revision: 1,
    created_at: created, changed_at: partial.changed_at ?? created, edited_at: null, deleted_at: null,
    ...partial,
  };
}

function storeError(code: string): Error {
  return Object.assign(new Error(`The comment store refused this (${code}).`), { code });
}

export function memoryCommentStore(options: MemoryCommentOptions = {}): MemoryCommentStore {
  const viewer: SpaceCommentViewer | null = options.viewer === undefined ? { id: 'user-flo', name: 'Flo', canEditSpace: true } : options.viewer;
  const rows: SpaceCommentRow[] = (options.rows ?? []).map((row, index) => commentRow({ id: `c${index + 1}`, ...row }));
  const calls: MemoryCommentStore['calls'] = options.calls ?? [];
  let reads = 0;
  let failing = options.failing === true;
  const failures = new Map<MemoryCommentOp, string>();
  const holds = new Map<MemoryCommentOp, Array<() => void>>();
  const held = new Set<MemoryCommentOp>();
  const listeners = new Set<() => void>();
  const deletedBodies = new Map<string, { body: string; status: SpaceCommentRow['status']; attachments: SpaceCommentRow['attachments'] }>();
  let clock = Date.parse(options.startAt ?? '2026-06-15T10:00:00Z');
  let ids = rows.length;
  const tick = () => { clock += 60_000; return new Date(clock).toISOString(); };
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const copy = (row: SpaceCommentRow): SpaceCommentRow => JSON.parse(JSON.stringify(row)) as SpaceCommentRow;

  async function run<T>(op: MemoryCommentOp, input: unknown, apply: () => T): Promise<T> {
    if (op === 'list') reads += 1;
    else calls.push({ op, input: input as Record<string, unknown> });
    if (held.has(op)) await new Promise<void>(resolve => { holds.set(op, [...(holds.get(op) ?? []), resolve]); });
    await Promise.resolve();
    const code = failures.get(op) ?? (failing && op !== 'list' ? 'failed' : undefined);
    if (code) { failures.delete(op); throw storeError(code); }
    const result = apply();
    if (op !== 'list' && op !== 'upload') queueMicrotask(emit);
    return result;
  }

  const find = (id: string) => {
    const row = rows.find(item => item.id === id);
    if (!row) throw storeError('comment_not_found');
    return row;
  };
  const touch = (row: SpaceCommentRow, change: SpaceCommentRow['change']) => {
    row.revision += 1;
    row.change = change;
    row.changed_at = tick();
    return copy(row);
  };
  const author = () => ({ user_id: viewer?.id ?? 'user-flo', name: viewer?.name ?? 'Flo', you: true });

  const transport: SpaceCommentsTransport = {
    attach: () => () => {},
    ...(viewer ? { viewer } : {}),
    page: options.page ?? null,
    list: input => run('list', input, () => {
      const page: SpaceCommentPageKey = input.page;
      const shown = page === 'all' ? rows : rows.filter(row => row.page_key === page);
      return { comments: shown.map(copy), revision: rows.reduce((top, row) => Math.max(top, row.revision), 0) };
    }),
    subscribe: (_input, listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    insert: (input: SpaceCommentInsert) => run('insert', input, () => {
      const at = tick();
      const { page_key, view, body, needs, options: choices, attachments, id, request_id: _request, ...anchor } = input;
      const row = commentRow({
        ...anchor, anchor_keys: [...(anchor.anchor_keys ?? [])],
        id: id ?? `n${ids += 1}`, page_key, view: view ?? null, body, needs: needs ?? 'none', options: [...(choices ?? [])],
        attachments: (attachments ?? []).map(file => ({ name: file.name, url: file.url, type: file.type, size: file.size, path: file.path })),
        author: author(), created_at: at, changed_at: at, change: 'created',
      });
      rows.push(row);
      return copy(row);
    }),
    reply: (input: SpaceCommentReply) => run('reply', input, () => {
      const root = find(input.root_id);
      const at = tick();
      const row = commentRow({
        id: input.id ?? `n${ids += 1}`, page_key: root.page_key, view: root.view, thread_root_id: root.id, mode: root.mode,
        anchor_keys: [...root.anchor_keys], body: input.body, answer_to: input.answer_to ?? null,
        attachments: (input.attachments ?? []).map(file => ({ name: file.name, url: file.url, type: file.type, size: file.size, path: file.path })),
        author: author(), created_at: at, changed_at: at, change: 'replied',
      });
      rows.push(row);
      if (input.answer_to) {
        const ask = rows.find(item => item.id === input.answer_to);
        if (ask) { ask.answer = input.body.slice(0, 500); ask.answered_at = at; ask.revision += 1; }
      }
      return copy(row);
    }),
    edit: input => run('edit', input, () => {
      const row = find(input.id);
      row.body = input.body;
      row.edited_at = tick();
      return touch(row, 'edited');
    }),
    archive: input => run('archive', input, () => { const row = find(input.root_id); row.status = 'archived'; return touch(row, 'resolved'); }),
    unarchive: input => run('unarchive', input, () => { const row = find(input.root_id); row.status = 'open'; return touch(row, 'reopened'); }),
    remove: input => run('remove', input, () => {
      const row = find(input.id);
      deletedBodies.set(row.id, { body: row.body, status: row.status, attachments: row.attachments });
      row.status = 'deleted';
      row.body = '';
      row.attachments = [];
      row.deleted_at = tick();
      return touch(row, 'deleted');
    }),
    restore: input => run('restore', input, () => {
      const row = find(input.id);
      const before = deletedBodies.get(row.id);
      row.status = before?.status === 'deleted' ? 'open' : before?.status ?? 'open';
      row.body = before?.body ?? row.body;
      row.attachments = before?.attachments ?? [];
      row.deleted_at = null;
      return touch(row, 'reopened');
    }),
    answer: input => run('answer', input, () => {
      const row = find(input.id);
      row.answer = input.answer;
      row.answered_at = tick();
      return touch(row, 'answered');
    }),
    ...(options.upload === false ? {} : {
      upload: (input: { file: Blob; name?: string }) => run('upload', input, (): SpaceCommentFile => {
        const name = input.name ?? 'file';
        return { path: `comments/${name}`, name, type: input.file.type || 'application/octet-stream', size: input.file.size, url: `https://files.invalid/${encodeURIComponent(name)}` };
      }),
      maxFileBytes: 8 * 1024 * 1024,
    }),
    ...options.extra,
  };

  return {
    transport,
    rows,
    calls,
    reads: () => reads,
    setFailing: value => { failing = value; },
    fail: (op, code = 'failed') => { failures.set(op, code); },
    hold: op => {
      held.add(op);
      return { release: () => { held.delete(op); for (const resolve of holds.get(op) ?? []) resolve(); holds.delete(op); } };
    },
    emit,
    listeners: () => listeners.size,
  };
}
