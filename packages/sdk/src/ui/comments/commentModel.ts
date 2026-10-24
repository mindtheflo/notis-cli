/**
 * Comment threads on a Space database (pure; no React). The table shape is the Notis Slides Comments table:
 *
 * | Column      | Type                 | Meaning                                                               |
 * | ----------- | -------------------- | --------------------------------------------------------------------- |
 * | Body        | title                | The comment text.                                                     |
 * | Deck        | relation             | The scope the comment belongs to (a deck, a page, a review).          |
 * | Slide       | relation             | The anchor record it is on (a slide, a section). Empty: on the scope. |
 * | Thread      | text                 | Empty on a thread's first comment; the root's record key on a reply.  |
 * | Author      | select               | Who wrote it (Flo, Claude, Notis, or any name).                       |
 * | X, Y        | number               | The pin, 0 to 1 across and down the anchor. Empty: on the whole anchor. |
 * | W, H        | number               | A zone from the pin, 0 to 1 of the anchor's width and height. Empty: a point. |
 * | Status      | select               | Open, Resolved or Deleted (a delete keeps the row for the digest).    |
 * | Needs       | select               | none, check, choice or input: what the author asks of the reader.     |
 * | Options     | text                 | The choices of a choice ask, separated by `|`.                       |
 * | Answer      | text                 | The reader's answer to the ask.                                       |
 * | Answered at | date                 | When the answer was given.                                            |
 * | Change      | select               | The last change made here: created, replied, answered, resolved, reopened, deleted. |
 * | Changed at  | date                 | When that change was made; the digest lists changes after the checkpoint. |
 * | Example     | checkbox             | A sample comment shown with an Example badge.                         |
 *
 * Every column name can be renamed with `CommentColumns`; the defaults are the Slides names, so a Space that copies
 * the Slides table needs no mapping and no migration. Zones are opt-in: a table that adds W and H number columns
 * passes `{ w: 'W', h: 'H' }`. Without them (`w` and `h` null, the default) a drag on the anchor places a pin where it
 * started, and nothing writes a column the table does not have.
 */

export type CommentRow = Record<string, unknown>;
export type CommentNeeds = 'none' | 'check' | 'choice' | 'input';
export type CommentStatus = 'Open' | 'Resolved' | 'Deleted';
export type CommentChange = 'created' | 'replied' | 'answered' | 'resolved' | 'reopened' | 'deleted';

/** Column names of the Comments table. `scope` or `anchor` set to null: the table has no such column. */
export interface CommentColumns {
  body: string;
  scope: string | null;
  anchor: string | null;
  thread: string;
  author: string;
  x: string;
  y: string;
  /** The zone's width and height. Null: the table has no zone columns, and comments are points only. */
  w: string | null;
  h: string | null;
  status: string;
  needs: string;
  options: string;
  answer: string;
  answeredAt: string;
  change: string;
  changedAt: string;
  example: string;
}

export const COMMENT_COLUMNS: Readonly<CommentColumns> = Object.freeze({
  body: 'Body', scope: 'Deck', anchor: 'Slide', thread: 'Thread', author: 'Author', x: 'X', y: 'Y', w: null, h: null,
  status: 'Status',
  needs: 'Needs', options: 'Options', answer: 'Answer', answeredAt: 'Answered at', change: 'Change',
  changedAt: 'Changed at', example: 'Example',
});

export function commentColumns(columns?: Partial<CommentColumns>): CommentColumns {
  return { ...COMMENT_COLUMNS, ...(columns ?? {}) };
}

export interface CommentRecord {
  id: string; recordKey: string; revision: number; body: string; scopeIds: string[]; anchorIds: string[];
  thread: string; author: string; x: number | null; y: number | null; w: number | null; h: number | null; status: CommentStatus; needs: CommentNeeds;
  options: string[]; answer: string; answeredAt: string | null; change: CommentChange | null; changedAt: string | null;
  example: boolean; createdAt: string | null;
}

/** The record a thread sits on (a slide, a section). `order` numbers it in the digest and the card meta. */
export interface CommentAnchor { id: string; recordKey: string; order: number; title: string }
/** The record the comments belong to (a deck, a page). `checkpoint` is the last time changes were copied. */
export interface CommentScope { id: string; recordKey: string; name: string; checkpoint: string | null }
export interface CommentThread { root: CommentRecord; replies: CommentRecord[]; anchor: CommentAnchor | undefined }

// ---------------------------------------------------------------------------
// Reading rows (native typed envelopes, or plain values from fixtures and older hosts)
// ---------------------------------------------------------------------------

function asObject(value: unknown): CommentRow | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as CommentRow : null;
}

function richText(parts: unknown[]): string {
  return parts.map(part => {
    const item = asObject(part);
    if (!item) return typeof part === 'string' ? part : '';
    const text = asObject(item.text);
    if (text && typeof text.content === 'string') return text.content;
    return typeof item.plain_text === 'string' ? item.plain_text : '';
  }).join('');
}

function envelope(value: unknown): unknown {
  const item = asObject(value);
  if (!item || typeof item.type !== 'string') return value;
  return item[item.type];
}

function property(row: CommentRow, name: string | null): unknown {
  if (!name) return undefined;
  const properties = asObject(row.properties);
  return envelope(properties ? properties[name] : undefined);
}

function textOf(row: CommentRow, name: string | null): string {
  const value = property(row, name);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return richText(value);
  const item = asObject(value);
  if (item && typeof item.name === 'string') return item.name;
  if (item && typeof item.start === 'string') return item.start;
  return '';
}

function numberOf(row: CommentRow, name: string | null): number | null {
  const value = property(row, name);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function dateOf(row: CommentRow, name: string): string | null {
  const value = property(row, name);
  if (typeof value === 'string') return value || null;
  const item = asObject(value);
  return item && typeof item.start === 'string' ? item.start : null;
}

function relationOf(row: CommentRow, name: string | null): string[] {
  const value = property(row, name);
  if (!Array.isArray(value)) return typeof value === 'string' && value ? [value] : [];
  return value.map(item => typeof item === 'string' ? item : String(asObject(item)?.id ?? '')).filter(Boolean);
}

function str(value: unknown): string { return typeof value === 'string' ? value : ''; }

const NEEDS: CommentNeeds[] = ['none', 'check', 'choice', 'input'];
const STATUSES: CommentStatus[] = ['Open', 'Resolved', 'Deleted'];
const CHANGES: CommentChange[] = ['created', 'replied', 'answered', 'resolved', 'reopened', 'deleted'];

function oneOf<T extends string>(value: string, allowed: T[], fallback: T): T {
  return (allowed as string[]).includes(value) ? value as T : fallback;
}

/** One Comments row as a comment. An author outside `authors` (when given) reads as `fallbackAuthor`. */
export function readCommentRow(row: CommentRow, options: {
  columns?: Partial<CommentColumns>; authors?: readonly string[]; fallbackAuthor?: string;
} = {}): CommentRecord {
  const c = commentColumns(options.columns);
  const change = textOf(row, c.change);
  const author = textOf(row, c.author);
  const fallbackAuthor = options.fallbackAuthor ?? 'Notis';
  const value = property(row, c.example);
  return {
    id: str(row.id), recordKey: str(row.record_key), revision: typeof row.revision === 'number' ? row.revision : 1,
    body: str(row.title) || textOf(row, c.body), scopeIds: relationOf(row, c.scope), anchorIds: relationOf(row, c.anchor),
    thread: textOf(row, c.thread).trim(),
    author: options.authors ? (options.authors.includes(author) ? author : fallbackAuthor) : (author || fallbackAuthor),
    x: numberOf(row, c.x), y: numberOf(row, c.y), w: numberOf(row, c.w), h: numberOf(row, c.h), status: oneOf(textOf(row, c.status), STATUSES, 'Open'),
    needs: oneOf(textOf(row, c.needs), NEEDS, 'none'),
    options: textOf(row, c.options).split('|').map(option => option.trim()).filter(Boolean),
    answer: textOf(row, c.answer), answeredAt: dateOf(row, c.answeredAt),
    change: CHANGES.includes(change as CommentChange) ? change as CommentChange : null, changedAt: dateOf(row, c.changedAt),
    example: value === true || value === 'true', createdAt: str(row.created_at) || null,
  };
}

/** The rows of a list answer (`{ rows }`), skipping anything that is not an object. */
export function commentRowsOf(value: unknown): CommentRow[] {
  const rows = asObject(value)?.rows;
  return Array.isArray(rows) ? rows.filter((row): row is CommentRow => Boolean(asObject(row))) : [];
}

/** Time in ms; a date without an offset is read as UTC so ordering stays stable. */
export function commentTimeOf(value: string | null | undefined): number {
  if (!value) return NaN;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) || !value.includes('T') ? value : `${value}Z`;
  return Date.parse(iso);
}

/** True when the comment belongs to `scope` (by id or record key). No scope: every comment belongs. */
export function inCommentScope(comment: CommentRecord, scope: Pick<CommentScope, 'id' | 'recordKey'> | null | undefined): boolean {
  if (!scope) return true;
  return comment.scopeIds.includes(scope.id) || comment.scopeIds.includes(scope.recordKey);
}

export function commentAnchorOf(comment: CommentRecord, anchors: readonly CommentAnchor[]): CommentAnchor | undefined {
  return anchors.find(anchor => comment.anchorIds.includes(anchor.id) || comment.anchorIds.includes(anchor.recordKey));
}

/** Threads in anchor order, then by creation; deleted replies are left out. Deleted roots stay (filter them to hide). */
export function commentThreads(comments: readonly CommentRecord[], anchors: readonly CommentAnchor[]): CommentThread[] {
  const roots = comments.filter(comment => !comment.thread);
  const byRoot = new Map<string, CommentRecord[]>();
  for (const comment of comments) {
    if (!comment.thread) continue;
    byRoot.set(comment.thread, [...(byRoot.get(comment.thread) ?? []), comment]);
  }
  const created = (comment: CommentRecord) => commentTimeOf(comment.createdAt) || 0;
  return roots.map(root => ({
    root,
    replies: (byRoot.get(root.recordKey) ?? []).filter(reply => reply.status !== 'Deleted').sort((a, b) => created(a) - created(b)),
    anchor: commentAnchorOf(root, anchors),
  })).sort((a, b) => (a.anchor?.order ?? 999) - (b.anchor?.order ?? 999) || created(a.root) - created(b.root));
}

/** Changes after the checkpoint: `me`'s comments and replies, and every answer or status change. */
export function commentChangesSince(comments: readonly CommentRecord[], checkpoint: string | null | undefined, me = 'Flo'): CommentRecord[] {
  const marker = commentTimeOf(checkpoint) || 0;
  return comments.filter(comment => {
    if (!comment.change) return false;
    const at = commentTimeOf(comment.changedAt);
    if (!Number.isFinite(at) || at <= marker) return false;
    if (comment.change === 'created' || comment.change === 'replied') return comment.author === me;
    return true;
  }).sort((a, b) => commentTimeOf(a.changedAt) - commentTimeOf(b.changedAt));
}

export interface CommentDigestOptions {
  /** First line, before the scope name. Default "Slide comments". */
  heading?: string;
  /** What the scope is called ("Deck"): the fallback name and "Deck record". */
  scopeNoun?: string;
  /** What an anchor is called ("Slide"): "Slide 3" and "Unknown slide". */
  anchorNoun?: string;
  /** The table agents insert replies into. Default "Comments". */
  table?: string;
  /** The reader whose answers and status changes the digest reports. Default "Flo". */
  me?: string;
  columns?: Partial<CommentColumns>;
}

/** True when the comment marks a zone (a pin with a width and a height), not a point. */
export function isCommentZone(comment: Pick<CommentRecord, 'x' | 'y' | 'w' | 'h'> | null | undefined): boolean {
  return Boolean(comment && comment.x != null && comment.y != null && comment.w != null && comment.h != null
    && comment.w > 0 && comment.h > 0);
}

function pinText(comment: CommentRecord | undefined, anchorNoun: string): string {
  if (!comment || comment.x == null || comment.y == null) return `on the whole ${anchorNoun.toLowerCase()}, no pin`;
  const at = `x ${comment.x.toFixed(2)}, y ${comment.y.toFixed(2)}`;
  return isCommentZone(comment) ? `zone at ${at}, ${comment.w!.toFixed(2)} wide by ${comment.h!.toFixed(2)} high` : `pin at ${at}`;
}

function quote(value: string): string {
  return `"${value.replace(/\s+/g, ' ').trim()}"`;
}

/**
 * The compact digest pasted into an agent's chat: every change since the scope's checkpoint, with where it is, what
 * changed and the thread state. Always English: it is read by agents, not shown to people.
 */
export function commentDigest(input: {
  scope: CommentScope | null; comments: readonly CommentRecord[]; anchors: readonly CommentAnchor[];
  changes: readonly CommentRecord[]; nowIso: string;
}, options: CommentDigestOptions = {}): string {
  const { scope, comments, anchors, changes, nowIso } = input;
  const heading = options.heading ?? 'Slide comments';
  const scopeNoun = options.scopeNoun ?? 'Deck';
  const anchorNoun = options.anchorNoun ?? 'Slide';
  const me = options.me ?? 'Flo';
  const c = commentColumns(options.columns);
  const byKey = new Map(comments.map(comment => [comment.recordKey, comment]));
  const same = [c.scope, c.anchor].filter(Boolean).join(' and ');
  const lines = [
    `# ${heading}: ${scope?.name ?? scopeNoun}`,
    `Changes since ${scope?.checkpoint ?? 'the start'} (copied ${nowIso}). ${scopeNoun} record ${scope?.recordKey ?? ''}.`,
    `Reply by inserting a ${options.table ?? 'Comments'} row with ${same ? `the same ${same} and ` : ''}${c.thread} set to the thread record.`,
    '',
  ];
  for (const comment of changes) {
    const root = comment.thread ? byKey.get(comment.thread) : comment;
    const anchor = commentAnchorOf(comment, anchors) ?? (root ? commentAnchorOf(root, anchors) : undefined);
    const where = anchor ? `${anchorNoun} ${anchor.order} ${quote(anchor.title)}` : `Unknown ${anchorNoun.toLowerCase()}`;
    const thread = root?.recordKey ?? comment.thread ?? comment.recordKey;
    let what: string;
    switch (comment.change) {
      case 'created': what = `${comment.author} commented ${quote(comment.body)}`; break;
      case 'replied': what = `${comment.author} replied ${quote(comment.body)} to ${root ? `${root.author}: ${quote(root.body)}` : 'a thread'}`; break;
      case 'answered': what = `${me} answered ${comment.author}'s ${comment.needs} ${quote(comment.body)}: ${quote(comment.answer)}`; break;
      case 'resolved': what = `${me} resolved ${comment.author}: ${quote(comment.body)}`; break;
      case 'reopened': what = `${me} reopened ${comment.author}: ${quote(comment.body)}`; break;
      case 'deleted': what = `${me} deleted ${comment.author}: ${quote(comment.body)}`; break;
      default: what = quote(comment.body);
    }
    const state = root ? `status ${root.status}${root.answer ? `, answer ${quote(root.answer)}` : ''}` : '';
    lines.push(`- ${where}, ${pinText(root, anchorNoun)}: ${what}${state ? `; ${state}` : ''} (thread ${thread})`);
  }
  if (!changes.length) lines.push('- No changes.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Optimistic state
// ---------------------------------------------------------------------------

/** Local fields shown until the server row reaches `revision` (null while the write is in flight). */
export interface CommentPatch { fields: Partial<CommentRecord>; revision: number | null }

export function applyCommentPatches(comments: readonly CommentRecord[], patches: Readonly<Record<string, CommentPatch>>): CommentRecord[] {
  return comments.map(comment => {
    const patch = patches[comment.recordKey];
    if (!patch || (patch.revision != null && comment.revision >= patch.revision)) return comment;
    return { ...comment, ...patch.fields, revision: Math.max(comment.revision, patch.revision ?? 0) };
  });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The two answers of a check ask, stored in English and shown in the reader's language. */
export const COMMENT_CHECK_ANSWERS = ['Looks good', 'Undo'] as const;

/** Text files an input ask accepts as an attachment. */
export const COMMENT_TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|ya?ml|html?|xml|srt|vtt)$/i;

/** An answer to an input ask is kept to 500 characters. */
export function clipCommentAnswer(body: string): string {
  return body.length > 500 ? `${body.slice(0, 497)}...` : body;
}

export function newCommentId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** "2 min ago", "il y a 3 h": short relative time in the reader's language. */
export function commentRelativeTime(iso: string | null, locale: string, now: number): string {
  const at = commentTimeOf(iso);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const abs = Math.abs(seconds);
  if (abs < 45) return format.format(0, 'second');
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86400), 'day');
}

/** Clipboard API first; the selection copy runs inside `host` (the Space's own element), never on the page body. */
export async function writeCommentClipboard(text: string, host: HTMLElement | null): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the selection copy */ }
  if (!host) return false;
  try {
    const doc = host.ownerDocument;
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'absolute';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    host.appendChild(area);
    area.select();
    const ok = doc.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Bring an element into view inside its nearest scrolling box only; the page around the Space never moves. */
export function scrollCommentIntoView(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView;
  if (!view) return;
  let box = element.parentElement;
  while (box && box.tagName !== 'BODY') {
    const style = view.getComputedStyle(box);
    if (/(auto|scroll)/.test(style.overflowY) && box.scrollHeight > box.clientHeight + 1) break;
    box = box.parentElement;
  }
  if (!box || box.tagName === 'BODY') return;
  const outer = box.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  const delta = at.top < outer.top ? at.top - outer.top - 8 : at.bottom > outer.bottom ? at.bottom - outer.bottom + 8 : 0;
  if (delta && typeof box.scrollBy === 'function') box.scrollBy({ top: delta, behavior: 'smooth' });
}
