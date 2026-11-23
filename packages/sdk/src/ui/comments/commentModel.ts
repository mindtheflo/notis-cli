/**
 * Comment threads of a Space (pure; no React). Comments live in the Space's one comment store, read and written
 * through the host (`runtime.spaceComments`, contract: `SpaceCommentRow`). `commentFromRow` reads a store row as the
 * `CommentRecord` the pane renders:
 *
 * | Store field       | CommentRecord      | Meaning                                                             |
 * | ----------------- | ------------------ | ------------------------------------------------------------------- |
 * | id                | id, recordKey      | The comment.                                                        |
 * | page_key          | scopeIds           | The page (record) it belongs to; empty on the Space home.           |
 * | anchor_keys       | anchorIds          | The records it is on (a slide, a section; several for items).       |
 * | thread_root_id    | thread             | Empty on a thread's first comment; the root's id on a reply.        |
 * | status            | status             | open, archived, deleted read as Open, Resolved (shown Done), Deleted. |
 * | x, y, w, h        | x, y, w, h         | A pin (x, y) or a zone (w, h too), 0 to 1 of the anchor.            |
 * | time_start        | time               | Seconds into a recording (time mode).                               |
 * | field, quote, ... | passage            | The words a text comment sits on.                                   |
 *
 * `Resolved` is shown as Done (archived, SPC-124); `Deleted` keeps the row: a deleted first comment hides its whole
 * thread, a deleted later one reads "Comment deleted" in place (SPC-127).
 */

import type { SpaceCommentRow, SpaceCommentStatus } from '../../space';

export type CommentNeeds = 'none' | 'check' | 'choice' | 'input';
export type CommentStatus = 'Open' | 'Resolved' | 'Deleted';
export type CommentChange = 'created' | 'replied' | 'answered' | 'resolved' | 'reopened' | 'deleted';

/**
 * What a new comment points at (SPC-118): words of the text, a point or a box on an anchor, some items (records or
 * rows), a moment of a recording, or the whole page (no anchor).
 */
export type CommentMode = 'text' | 'point' | 'box' | 'items' | 'time' | 'page';

/** The words a text comment sits on; `field` names the field of the page they are in, when one does. */
export interface CommentPassage { quote: string; prefix: string; suffix: string; field?: string | null }

export interface CommentRecord {
  id: string; recordKey: string; revision: number; body: string; scopeIds: string[]; anchorIds: string[];
  thread: string; author: string; x: number | null; y: number | null; w: number | null; h: number | null; status: CommentStatus; needs: CommentNeeds;
  options: string[]; answer: string; answeredAt: string | null; change: CommentChange | null; changedAt: string | null;
  example: boolean; createdAt: string | null; attachments: CommentAttachment[];
  /** A choice question's option its asker recommends: one of `options`, null when it names none. */
  recommended?: string | null;
  /** A choice question's line under an option, by option; an option without one is absent. */
  optionDetails?: Readonly<Record<string, string>>;
  /** When the author edited the text, from the Edited at column (null: never, or the table has no such column). */
  editedAt?: string | null;
  /** Seconds into a recording, for a comment in time mode. */
  time?: number | null;
  /** On a reply that answers an ask, the ask's record key, from the Answer to column (null: none). */
  answerTo?: string | null;
  /**
   * The agent that wrote this comment, from the server's write record (never the Author column): its name and,
   * for the person whose agent it is, the thread it works in. Absent on comments a person wrote.
   */
  agent?: CommentAgent | null;
  /**
   * Who created the row, from the server and never from the Author text (a renamed person keeps their comments):
   * `createdByYou` is the server's answer for the signed-in viewer (`created_by_you`), `createdBy` the creator's user
   * id (`created_by`), compared with the viewer's `id`. Null when the row does not say: the Author name decides then.
   */
  createdByYou?: boolean | null;
  createdBy?: string | null;
  /** What the comment points at (its mode in the store). */
  mode?: CommentMode;
  /** The words a text comment sits on; null for other modes. */
  passage?: CommentPassage | null;
  /** The view slug it was written on. */
  view?: string | null;
}

/**
 * What an agent ran on, as the server recorded it (`agent.runtime`): the harness (`provider`: notis, codex,
 * claude_code, kimi, grok, opencode_go, muse, cursor_agent, kiro or antigravity), its name (`label`), the model, the
 * intelligence level or reasoning effort and the speed. Each part is null when it was not recorded.
 */
export interface CommentAgentRuntime {
  provider: string | null; label: string | null; model: string | null;
  intelligence: string | null; effort: string | null; speed: string | null;
}

/**
 * An agent author, as the server stamped it. `threadId` is only given to the agent's owner; `runtime` (when the
 * server recorded it) is what it ran on, for the logo and the hover card beside its name.
 */
export interface CommentAgent {
  name: string; threadId: string | null; rowId: string | null; runtime?: CommentAgentRuntime | null;
  /** An agent outside Notis (declared on a Notis CLI call): the thread it said it works in ("PR #3851"). */
  threadName?: string | null;
  /** An agent outside Notis: the harness that runs it (claude_code, codex, cursor_agent...), for its logo. */
  harness?: string | null;
  /** True for an agent outside Notis (SPC-535): a thread it holds wakes nobody in Notis. */
  outside?: boolean;
}

/** An agent name read out like a band: a band name ("fred-and-the-machine") reads "Fred And The Machine". */
const BAND_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/**
 * How an author or agent name shows: a band name (lowercase words and digits joined by hyphens, the name agents
 * declare) with its hyphens as spaces and each word capitalised; any other name as it is, so it is safe to call twice.
 */
export function agentDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!BAND_NAME.test(trimmed)) return name;
  return trimmed.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function runtimeOf(value: unknown): CommentAgentRuntime | null {
  const runtime = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!runtime) return null;
  const text = (key: string) => typeof runtime[key] === 'string' && (runtime[key] as string).trim() ? (runtime[key] as string).trim() : null;
  const read: CommentAgentRuntime = {
    provider: text('provider'), label: text('label'), model: text('model'),
    intelligence: text('intelligence'), effort: text('effort'), speed: text('speed'),
  };
  return Object.values(read).some(Boolean) ? read : null;
}

function agentOf(value: unknown): CommentAgent | null {
  const agent = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!agent || typeof agent.name !== 'string' || !agent.name.trim()) return null;
  const runtime = runtimeOf(agent.runtime);
  const label = (key: string) => typeof agent[key] === 'string' && (agent[key] as string).trim() ? (agent[key] as string).trim() : null;
  const threadName = label('thread_name');
  const harness = label('harness');
  return { name: agent.name.trim(), threadId: typeof agent.thread_id === 'string' && agent.thread_id ? agent.thread_id : null,
    rowId: typeof agent.row_id === 'string' && agent.row_id ? agent.row_id : null, ...(runtime ? { runtime } : {}),
    ...(threadName ? { threadName } : {}), ...(harness ? { harness } : {}), ...(agent.outside === true ? { outside: true } : {}) };
}

/**
 * A picture or file shown with a comment. `label` is the name without its extension: a choice option with the same
 * label is answered from under that picture ("Before.png" and "After.png" with Options "Before | After").
 */
export interface CommentAttachment { name: string; label: string; url: string; image: boolean }

/** The record a thread sits on (a slide, a section). `order` numbers it in the digest and the card meta. */
export interface CommentAnchor { id: string; recordKey: string; order: number; title: string }
/** The record the comments belong to (a deck, a page). `checkpoint` is the last time changes were copied. */
export interface CommentScope { id: string; recordKey: string; name: string; checkpoint: string | null }
export interface CommentThread { root: CommentRecord; replies: CommentRecord[]; anchor: CommentAnchor | undefined }

// ---------------------------------------------------------------------------
// Reading store rows
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Loose : null;
}

function str(value: unknown): string { return typeof value === 'string' ? value : ''; }

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const INLINE_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml)[;,]/;

/** An http(s) link without credentials, or a site path: anything else (script URLs, `//host`) opens nothing. */
export function safeCommentUrl(value: string): string | null {
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f\\\s]/.test(url)) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try { return new URL(url, 'https://notis.invalid').pathname; } catch { return url; }
}

/** A files value (`{ name, url }` items, `{ name, file: { url } }`, `{ name, external: { url } }` or URLs) as the pictures and files a comment shows. */
export function commentAttachmentList(value: unknown): CommentAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<CommentAttachment>(item => {
    const entry = asObject(item);
    const raw = typeof item === 'string' ? item
      : str(entry?.url) || str(asObject(entry?.file)?.url) || str(asObject(entry?.external)?.url);
    // A small inline picture (a fixture, a generated chart) is shown; any other data URL is not.
    const inline = INLINE_IMAGE.test(raw);
    const url = inline ? raw : safeCommentUrl(raw);
    if (!url) return [];
    const last = pathOf(url).split('/').pop() || '';
    let decoded = last;
    try { decoded = decodeURIComponent(last); } catch { /* keep the raw segment */ }
    const fileName = str(entry?.name).trim() || (inline ? 'image' : decoded) || url;
    return [{
      name: fileName, label: fileName.replace(/\.[a-z0-9]{1,8}$/i, '').trim() || fileName, url,
      image: inline || IMAGE_FILE.test(fileName) || IMAGE_FILE.test(pathOf(url)),
    }];
  });
}

/** The picture a choice option names (same label, any case), when there is one. */
export function commentAttachmentFor(option: string, attachments: readonly CommentAttachment[]): CommentAttachment | undefined {
  const wanted = option.trim().toLocaleLowerCase();
  return wanted ? attachments.find(item => item.image && item.label.toLocaleLowerCase() === wanted) : undefined;
}

/** A comment's text in pieces: plain text, and http(s) links with a short label (host and path). */
export type CommentBodyPart = { text: string } | { href: string; label: string };

const LINK = /https?:\/\/[^\s<>"]+/g;
const LINK_LABEL_MAX = 48;

export function commentBodyParts(body: string): CommentBodyPart[] {
  const parts: CommentBodyPart[] = [];
  let last = 0;
  for (const match of body.matchAll(LINK)) {
    let raw = match[0];
    // A sentence's punctuation after a link is not part of it; a closing bracket is, when the link opened one.
    while (/[.,;:!?'"\])}]$/.test(raw)) {
      const end = raw.at(-1)!;
      const open = end === ')' ? '(' : end === ']' ? '[' : end === '}' ? '{' : null;
      if (open && raw.split(open).length > raw.split(end).length - 1) break;
      raw = raw.slice(0, -1);
    }
    const start = match.index ?? 0;
    const href = safeCommentUrl(raw);
    if (!href) continue;
    if (start > last) parts.push({ text: body.slice(last, start) });
    const url = new URL(href);
    const full = `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
    parts.push({ href, label: full.length > LINK_LABEL_MAX ? `${full.slice(0, LINK_LABEL_MAX - 1)}…` : full });
    last = start + raw.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

const NEEDS: CommentNeeds[] = ['none', 'check', 'choice', 'input'];
const CHANGES: CommentChange[] = ['created', 'replied', 'answered', 'resolved', 'reopened', 'deleted'];
const MODES: CommentMode[] = ['text', 'point', 'box', 'items', 'time', 'page'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? value as T : fallback;
}

/** The store's status as the pane names it: open, archived, deleted read as Open, Resolved (shown Done), Deleted. */
export function commentStatusOf(status: SpaceCommentStatus | string | null | undefined): CommentStatus {
  return status === 'archived' ? 'Resolved' : status === 'deleted' ? 'Deleted' : 'Open';
}

/** The pane's status as the store names it. */
export function storeStatusOf(status: CommentStatus): SpaceCommentStatus {
  return status === 'Resolved' ? 'archived' : status === 'Deleted' ? 'deleted' : 'open';
}

/** The lines under a choice question's options, from the store's `option_details`: only for options the comment has. */
function commentOptionDetails(value: unknown, options: readonly string[]): Record<string, string> {
  const lines: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return lines;
  for (const option of options) {
    const line = (value as Record<string, unknown>)[option];
    if (typeof line === 'string' && line.trim()) lines[option] = line.trim();
  }
  return lines;
}

/**
 * One store row (`SpaceCommentRow`) as the comment the pane renders. An agent's comment reads as the agent (its stamped
 * name); a person's as the name the server set for them. A store `change` of `edited` reads as the comment's own
 * change (created or replied) with `editedAt`, so Copy changes reports it as an edit.
 */
export function commentFromRow(input: SpaceCommentRow | Readonly<Record<string, unknown>>): CommentRecord {
  const row = input as Loose;
  const id = str(row.id);
  const thread = str(row.thread_root_id).trim();
  const authorOf = asObject(row.author);
  const agent = agentOf(row.agent);
  const editedAt = str(row.edited_at) || null;
  const change: CommentChange | null = row.change === 'edited' ? (thread ? 'replied' : 'created')
    : (CHANGES as readonly unknown[]).includes(row.change) ? row.change as CommentChange : null;
  const mode = oneOf(row.mode, MODES, 'page');
  const quote = str(row.quote);
  const pageKey = str(row.page_key);
  const anchorKeys = Array.isArray(row.anchor_keys) ? row.anchor_keys.filter((key): key is string => typeof key === 'string' && Boolean(key)) : [];
  const status = commentStatusOf(str(row.status));
  const options = Array.isArray(row.options) ? row.options.filter((item): item is string => typeof item === 'string')
    .map(option => option.trim()).filter(Boolean) : [];
  return {
    id, recordKey: id, revision: typeof row.revision === 'number' ? row.revision : 1,
    body: str(row.body),
    scopeIds: pageKey ? [pageKey] : [], anchorIds: anchorKeys, thread,
    author: agent ? (agent.name || str(authorOf?.name)) : str(authorOf?.name).trim() || 'Notis',
    x: num(row.x), y: num(row.y), w: num(row.w), h: num(row.h), status,
    needs: oneOf(row.needs, NEEDS, 'none'),
    options, recommended: options.includes(str(row.recommended).trim()) ? str(row.recommended).trim() : null,
    optionDetails: commentOptionDetails(row.option_details, options),
    answer: str(row.answer), answeredAt: str(row.answered_at) || null,
    change, changedAt: str(row.changed_at) || null,
    example: row.example === true, createdAt: str(row.created_at) || null,
    attachments: status === 'Deleted' ? [] : commentAttachmentList(row.attachments),
    editedAt, time: num(row.time_start), answerTo: str(row.answer_to).trim() || null,
    agent,
    createdByYou: typeof authorOf?.you === 'boolean' ? authorOf.you : null,
    createdBy: str(authorOf?.user_id) || null,
    mode,
    passage: mode === 'text' && quote.trim()
      ? { quote, prefix: str(row.prefix), suffix: str(row.suffix), field: str(row.field) || null } : null,
    view: str(row.view) || null,
  };
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

/** Every anchor the comment is on, in anchor order (an items comment is on several). */
export function commentAnchorsOf(comment: CommentRecord, anchors: readonly CommentAnchor[]): CommentAnchor[] {
  return anchors.filter(anchor => comment.anchorIds.includes(anchor.id) || comment.anchorIds.includes(anchor.recordKey));
}

/**
 * True when a comment on `anchorIds` shows under the anchor `key`: an items comment shows under each of its items
 * (SPC-463). A null key is the comments on no anchor.
 */
export function isCommentOnAnchor(anchorIds: readonly string[], key: string | null | undefined,
  anchors: readonly CommentAnchor[]): boolean {
  const on = anchors.filter(anchor => anchorIds.includes(anchor.id) || anchorIds.includes(anchor.recordKey));
  return key == null ? !on.length : on.some(anchor => anchor.recordKey === key);
}

/**
 * Threads in anchor order, then by creation. Deleted replies stay in place (the card reads "Comment deleted" there so
 * the replies around it still read); deleted roots stay too (filter them to hide the whole thread).
 */
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
    replies: [...(byRoot.get(root.recordKey) ?? [])].sort((a, b) => created(a) - created(b)),
    anchor: commentAnchorOf(root, anchors),
  })).sort((a, b) => (a.anchor?.order ?? 999) - (b.anchor?.order ?? 999) || created(a.root) - created(b.root));
}

/** The time of a thread's latest comment that is not deleted (its root's time when every reply is gone). */
export function commentThreadActivity(thread: CommentThread): number {
  let latest = commentTimeOf(thread.root.createdAt) || 0;
  for (const reply of thread.replies) {
    if (reply.status === 'Deleted') continue;
    latest = Math.max(latest, commentTimeOf(reply.createdAt) || 0);
  }
  return latest;
}

/**
 * How a comment pane orders its threads (SPC-116): 'newest' (default) puts the newest thread first, by when its first
 * comment was written, so a reply never makes the list jump; 'oldest' the reverse, 'anchor' keeps anchor order then
 * creation (a deck read slide by slide), or the Space's own comparator (`commentThreadActivity` sorts by the latest
 * comment).
 */
export type CommentOrder = 'newest' | 'oldest' | 'anchor' | ((a: CommentThread, b: CommentThread) => number);

/** The threads in `order`. Stable: threads the order cannot tell apart keep their anchor order. */
export function orderCommentThreads(threads: readonly CommentThread[], order: CommentOrder = 'newest'): CommentThread[] {
  if (order === 'anchor') return [...threads];
  if (typeof order === 'function') return [...threads].sort(order);
  const sign = order === 'oldest' ? 1 : -1;
  const created = (thread: CommentThread) => commentTimeOf(thread.root.createdAt) || 0;
  return [...threads].sort((a, b) => sign * (created(a) - created(b)));
}

/**
 * A thread's replies as the card shows them: each reply, and one "Comment deleted" line for each run of deleted
 * replies in a row (SPC-127).
 */
export function commentReplyRuns(replies: readonly CommentRecord[]):
  Array<{ deleted: false; reply: CommentRecord } | { deleted: true; replies: CommentRecord[] }> {
  const runs: Array<{ deleted: false; reply: CommentRecord } | { deleted: true; replies: CommentRecord[] }> = [];
  for (const reply of replies) {
    const previous = runs.at(-1);
    if (reply.status !== 'Deleted') runs.push({ deleted: false, reply });
    else if (previous?.deleted) previous.replies.push(reply);
    else runs.push({ deleted: true, replies: [reply] });
  }
  return runs;
}

/** A heading the pane groups threads under: threads with the same key sit together, under `label`. */
export interface CommentGroup { key: string; label: string }

/** Threads under their group headings, groups in the order their first thread comes. Null: the thread sits ungrouped. */
export function groupCommentThreads(threads: readonly CommentThread[],
  groupBy: (thread: CommentThread) => CommentGroup | null): Array<{ group: CommentGroup | null; threads: CommentThread[] }> {
  const groups: Array<{ group: CommentGroup | null; threads: CommentThread[] }> = [];
  const byKey = new Map<string, { group: CommentGroup | null; threads: CommentThread[] }>();
  for (const thread of threads) {
    const group = groupBy(thread);
    const key = group ? `g:${group.key}` : 'none';
    let entry = byKey.get(key);
    if (!entry) {
      entry = { group, threads: [] };
      byKey.set(key, entry);
      groups.push(entry);
    }
    entry.threads.push(thread);
  }
  return groups;
}

/** A moment in a recording: "0:24", "12:05", "1:02:03". */
export function formatCommentTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** When the comment changed after `marker` (its Change, or `me`'s edit from Edited at), or NaN when it did not. */
function changedAfter(comment: CommentRecord, marker: number, me: string): number {
  let at = Number.NaN;
  if (comment.change) {
    const changed = commentTimeOf(comment.changedAt);
    const counts = comment.change === 'created' || comment.change === 'replied' ? comment.author === me : true;
    if (counts && Number.isFinite(changed) && changed > marker) at = changed;
  }
  // An edit is read from Edited at, so it never has to overwrite a Change that says resolved or answered.
  if (comment.author === me && comment.status !== 'Deleted') {
    const editedAt = commentTimeOf(comment.editedAt);
    if (Number.isFinite(editedAt) && editedAt > marker && !(editedAt <= at)) at = editedAt;
  }
  return at;
}

/** Changes after the checkpoint: `me`'s comments, replies and edits, and every answer or status change. */
export function commentChangesSince(comments: readonly CommentRecord[], checkpoint: string | null | undefined, me = 'Flo'): CommentRecord[] {
  const marker = commentTimeOf(checkpoint) || 0;
  return comments.map(comment => ({ comment, at: changedAfter(comment, marker, me) }))
    .filter(item => Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at)
    .map(item => item.comment);
}

export interface CommentDigestOptions {
  /** First line, before the scope name. Default "Slide comments". */
  heading?: string;
  /** What the scope is called ("Deck"): the fallback name and "Deck record". */
  scopeNoun?: string;
  /** What an anchor is called ("Slide"): "Slide 3" and "Unknown slide". */
  anchorNoun?: string;
  /** The reader whose answers and status changes the digest reports. Default "Flo". */
  me?: string;
}

/** True when the comment marks a zone (a pin with a width and a height), not a point. */
export function isCommentZone(comment: Pick<CommentRecord, 'x' | 'y' | 'w' | 'h'> | null | undefined): boolean {
  return Boolean(comment && comment.x != null && comment.y != null && comment.w != null && comment.h != null
    && comment.w > 0 && comment.h > 0);
}

function pinText(comment: CommentRecord | undefined, anchorNoun: string): string {
  if (comment?.passage) return `on the words ${quote(comment.passage.quote)}`;
  if (comment?.time != null) return `at ${formatCommentTime(comment.time)}`;
  if (!comment || comment.x == null || comment.y == null) return `on the whole ${anchorNoun.toLowerCase()}, no pin`;
  const at = `x ${comment.x.toFixed(2)}, y ${comment.y.toFixed(2)}`;
  return isCommentZone(comment) ? `zone at ${at}, ${comment.w!.toFixed(2)} wide by ${comment.h!.toFixed(2)} high` : `pin at ${at}`;
}

function quote(value: string): string {
  return `"${value.replace(/\s+/g, ' ').trim()}"`;
}

/** True when the comment's last change is an edit of its text (its Changed at is when it was edited). */
function edited(comment: CommentRecord): boolean {
  return Boolean(comment.editedAt && comment.changedAt && commentTimeOf(comment.editedAt) === commentTimeOf(comment.changedAt));
}

/**
 * The compact digest pasted into an agent's chat: every change since the scope's checkpoint, with where it is, what
 * changed and the thread state. Always English: it is read by agents, not shown to people. `since` (default the scope's
 * checkpoint) tells an edit from Edited at: a comment written before it and edited after reads "edited".
 */
export function commentDigest(input: {
  scope: CommentScope | null; comments: readonly CommentRecord[]; anchors: readonly CommentAnchor[];
  changes: readonly CommentRecord[]; nowIso: string; since?: string | null;
}, options: CommentDigestOptions = {}): string {
  const { scope, comments, anchors, changes, nowIso } = input;
  const since = commentTimeOf(input.since === undefined ? scope?.checkpoint ?? null : input.since) || 0;
  const after = (iso: string | null | undefined) => { const at = commentTimeOf(iso); return Number.isFinite(at) && at > since; };
  // Edited since the checkpoint and written before it: the digest says "edited" instead of "commented".
  const editedSince = (comment: CommentRecord) => edited(comment)
    || (after(comment.editedAt) && !after(comment.createdAt));
  const heading = options.heading ?? 'Slide comments';
  const scopeNoun = options.scopeNoun ?? 'Deck';
  const anchorNoun = options.anchorNoun ?? 'Slide';
  const me = options.me ?? 'Flo';
  const byKey = new Map(comments.map(comment => [comment.recordKey, comment]));
  const lines = [
    `# ${heading}: ${scope?.name ?? scopeNoun}`,
    `Changes since ${scope?.checkpoint ?? 'the start'} (copied ${nowIso}). ${scopeNoun} record ${scope?.recordKey ?? ''}.`,
    'Reply with LOCAL_NOTIS_SPACE_COMMENT_THREADS (operation reply, comment_id set to the thread id).',
    '',
  ];
  for (const comment of changes) {
    const root = comment.thread ? byKey.get(comment.thread) : comment;
    const anchor = commentAnchorOf(comment, anchors) ?? (root ? commentAnchorOf(root, anchors) : undefined);
    const where = anchor ? `${anchorNoun} ${anchor.order} ${quote(anchor.title)}` : `Unknown ${anchorNoun.toLowerCase()}`;
    const thread = root?.recordKey ?? comment.thread ?? comment.recordKey;
    const to = root && comment.thread ? ` to ${root.author}: ${quote(root.body)}` : comment.thread ? ' to a thread' : '';
    const editLine = `${comment.author} edited their ${comment.thread ? 'reply' : 'comment'} to ${quote(comment.body)}${to}`;
    // In the list for an edit only (its Change is older than the checkpoint, or says resolved or answered).
    const onlyEdit = comment.status !== 'Deleted' && after(comment.editedAt) && (!comment.change || !after(comment.changedAt));
    let what: string;
    if (onlyEdit) what = editLine;
    else switch (comment.change) {
      case 'created': what = editedSince(comment) ? editLine : `${comment.author} commented ${quote(comment.body)}`; break;
      case 'replied': what = editedSince(comment) ? editLine : `${comment.author} replied ${quote(comment.body)}${to || ' to a thread'}`; break;
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
export async function writeCommentClipboard(text: string | Promise<string | null>, host: HTMLElement | null): Promise<boolean> {
  if (typeof text !== 'string') {
    // A text the host still works out (a link naming the comment's page): a ClipboardItem holding the promise keeps the
    // click's permission to write while it resolves (Safari drops it after a wait); else it is copied once known.
    const Item = typeof ClipboardItem === 'undefined' ? null : ClipboardItem;
    if (Item && typeof navigator !== 'undefined' && navigator.clipboard?.write) {
      try {
        const blob = text.then((value) => {
          if (!value) throw new Error('no text');
          return new Blob([value], { type: 'text/plain' });
        });
        await navigator.clipboard.write([new Item({ 'text/plain': blob })]);
        return true;
      } catch { /* copied as plain text below */ }
    }
    const value = await text.catch(() => null);
    return value ? writeCommentClipboard(value, host) : false;
  }
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
