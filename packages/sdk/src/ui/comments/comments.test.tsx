import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore, ShortcutScope } from '../engine';
import { NotisProvider } from '../../provider';
import { createQueryClient } from '../../queryCache';
import type { NotisRuntime } from '../../runtime';
import {
  CommentPane, CommentPins, applyCommentPatches, commentAnchorOfDraft, commentAttachmentFor, commentBodyParts,
  commentChangesSince, commentDigest, commentDraftOfAnchor, commentFromRow, commentRelativeTime, commentStatusOf, commentThreads,
  commentGroupSlot, isCommentZone, storeStatusOf, useComments,
  type CommentAnchor, type CommentController, type CommentPaneProps, type CommentRecord,
  type UseCommentsOptions,
} from '.';
import * as ui from '..';
import {
  SpaceFileError, type SpaceCommentRow, type SpaceCommentsTransport, type SpaceCommentThreadRef, type SpaceCommentViewer,
} from '../../space';
import { clearCommentDrafts } from './commentDrafts';
import { listHostComposers, registerHostComposerHost, setWaitingCommentCount, setWaitingCommentThreads } from './hostPanel';
import {
  REVIEW_RUN_TRAVEL_MS, cardThatTookThePlace, reviewRunCommands, reviewRunHost, reviewRunPane, resetReviewRunAnswered, setReviewRunHost,
  subscribeReviewRunEvents, type ReviewRunEvent,
} from './reviewRun';
import { clearCommentRoutingCache } from './useCommentRouting';
import { commentRow, memoryCommentStore, type MemoryCommentOp, type MemoryCommentStore } from '../../../design-system/runtime/memoryComments';

const doc = dom.window.document;
const proto = dom.window.HTMLDialogElement?.prototype as (HTMLDialogElement & { showModal?: () => void }) | undefined;
if (proto && typeof proto.showModal !== 'function') {
  proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
}
Object.defineProperty(globalThis, 'HTMLTextAreaElement', { configurable: true, writable: true, value: dom.window.HTMLTextAreaElement });

// ---------------------------------------------------------------------------
// Fixtures: rows as the Space's comment store returns them (portal_comments wire rows)
// ---------------------------------------------------------------------------

const ANCHORS: CommentAnchor[] = [
  { id: 'slide-1', recordKey: 'sk1', order: 1, title: 'Intro' },
  { id: 'slide-2', recordKey: 'sk2', order: 2, title: 'Plan' },
];

/** The page (deck) the fixture comments are on. */
const PAGE = 'dk1';

/** The pane's status words as the store's. */
const STORE_STATUS: Record<string, SpaceCommentRow['status']> = { Open: 'open', Resolved: 'archived', Deleted: 'deleted' };

function row(key: string, fields: {
  body: string; author?: string; slide?: string; thread?: string; x?: number; y?: number; w?: number; h?: number;
  status?: string; needs?: SpaceCommentRow['needs'];
  options?: string; answer?: string; change?: SpaceCommentRow['change']; changedAt?: string; createdAt?: string; revision?: number;
  files?: SpaceCommentRow['attachments']; page?: string | null; agent?: SpaceCommentRow['agent']; answerTo?: string;
  editedAt?: string; you?: boolean;
}): SpaceCommentRow {
  const author = fields.author ?? 'Flo';
  const status = STORE_STATUS[fields.status ?? 'Open'] ?? 'open';
  const createdAt = fields.createdAt ?? '2026-10-20T10:00:00.000Z';
  return commentRow({
    id: key, page_key: fields.page === undefined ? PAGE : fields.page, thread_root_id: fields.thread ?? null,
    mode: fields.w != null ? 'box' : fields.x != null ? 'point' : 'page', anchor_keys: fields.slide ? [fields.slide] : [],
    x: fields.x ?? null, y: fields.y ?? null, w: fields.w ?? null, h: fields.h ?? null,
    body: status === 'deleted' ? '' : fields.body, status, needs: fields.needs ?? 'none',
    options: (fields.options ?? '').split(/\s*\|\s*/).map(option => option.trim()).filter(Boolean),
    answer: fields.answer || null, answer_to: fields.answerTo ?? null,
    change: fields.change ?? null, changed_at: fields.changedAt ?? createdAt, created_at: createdAt,
    edited_at: fields.editedAt ?? null, deleted_at: status === 'deleted' ? createdAt : null,
    attachments: fields.files ?? [], revision: fields.revision ?? 1, agent: fields.agent ?? null,
    author: { user_id: author === 'Flo' ? 'user-flo' : `user-${author.toLowerCase()}`, name: author, you: fields.you ?? author === 'Flo' },
  });
}

const ROWS = [
  row('c1', { body: 'Tighten the title', slide: 'slide-1', x: 0.25, y: 0.5, change: 'created', changedAt: '2026-10-21T09:00:00.000Z',
    createdAt: '2026-10-21T09:00:00.000Z' }),
  row('c2', { body: 'I shortened it. Keep?', author: 'Claude', slide: 'slide-1', needs: 'check', x: 0.6, y: 0.2,
    createdAt: '2026-10-21T10:00:00.000Z' }),
  row('c3', { body: 'Which chart?', author: 'Claude', slide: 'slide-2', needs: 'choice', options: 'Bar | Line',
    createdAt: '2026-10-21T11:00:00.000Z' }),
  row('r1', { body: 'Done', author: 'Claude', slide: 'slide-1', thread: 'c1', createdAt: '2026-10-21T12:00:00.000Z' }),
  row('c4', { body: 'Old note', slide: 'slide-2', status: 'Resolved', change: 'resolved', changedAt: '2026-10-19T09:00:00.000Z' }),
  row('c5', { body: 'Gone', slide: 'slide-2', status: 'Deleted' }),
];

const comments = () => ROWS.map(item => commentFromRow(item));

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

test('commentFromRow reads a store row: page, anchors, place, options and the author the server names', () => {
  const [first, second, third] = comments();
  assert.equal(first!.body, 'Tighten the title');
  assert.equal(first!.recordKey, 'c1');
  assert.deepEqual(first!.scopeIds, [PAGE]);
  assert.deepEqual(first!.anchorIds, ['slide-1']);
  assert.equal(first!.x, 0.25);
  assert.equal(first!.mode, 'point');
  assert.equal(first!.change, 'created');
  assert.equal(first!.createdByYou, true);
  assert.equal(second!.needs, 'check');
  assert.equal(second!.author, 'Claude');
  assert.equal(second!.createdByYou, false);
  assert.deepEqual(third!.options, ['Bar', 'Line']);
  const unnamed = commentFromRow({ ...row('u', { body: 'Hi' }), author: { user_id: 'u-x', name: '', you: false } });
  assert.equal(unnamed.author, 'Notis', 'no name at all: Notis');
  const home = commentFromRow(row('h', { body: 'Hi', page: null }));
  assert.deepEqual(home.scopeIds, [], 'a comment on the Space home is on no page');
});

test('commentFromRow reads a time comment\'s range, and the items marker attribute is data-comment-anchor', () => {
  const ranged = commentFromRow({ ...row('t1', { body: 'Cut this part' }), mode: 'time', time_start: 30, time_end: 45 });
  assert.equal(ranged.time, 30);
  assert.equal(ranged.timeEnd, 45);
  const moment = commentFromRow({ ...row('t2', { body: 'Here' }), mode: 'time', time_start: 12.5 });
  assert.equal(moment.timeEnd, null, 'a moment has no end: it holds until the next time comment');
  assert.equal(ui.COMMENT_ANCHOR_ATTR, 'data-comment-anchor');
});

test('commentFromRow: a row an agent wrote shows the agent\'s stamped name, its thread and what it ran on', () => {
  const signed = commentFromRow(row('s1', { body: 'Done', agent: { name: 'fred-and-the-machine', thread_id: 'thread-1',
    runtime: { provider: 'codex', label: 'Codex', model: null, intelligence: 'high', effort: null, speed: null } } }));
  assert.equal(signed.author, 'fred-and-the-machine');
  assert.equal(signed.agent?.threadId, 'thread-1');
  assert.equal(signed.agent?.runtime?.provider, 'codex');
  assert.equal(ui.agentDisplayName(signed.author), 'Fred And The Machine');
  const person = commentFromRow(row('s3', { body: 'Hi', author: 'Mallory' }));
  assert.equal(person.author, 'Mallory', 'a person reads as the name the server set, never a fallback');
  assert.equal(person.agent, null);
});

test('Status: the store\'s open, archived and deleted read as Open, Resolved and Deleted, and back', () => {
  assert.equal(commentStatusOf('open'), 'Open');
  assert.equal(commentStatusOf('archived'), 'Resolved');
  assert.equal(commentStatusOf('deleted'), 'Deleted');
  assert.equal(commentStatusOf('something else'), 'Open');
  assert.equal(storeStatusOf('Open'), 'open');
  assert.equal(storeStatusOf('Resolved'), 'archived');
  assert.equal(storeStatusOf('Deleted'), 'deleted');
  const deleted = commentFromRow(row('d', { body: 'x', status: 'Deleted', files: [{ name: 'a.png', url: 'https://files.example/a.png' }] }));
  assert.equal(deleted.status, 'Deleted');
  assert.deepEqual(deleted.attachments, [], 'a deleted comment shows no files');
});

test('commentFromRow reads the ask a reply answers, an edit, and the text a comment quotes', () => {
  assert.equal(commentFromRow(row('a1', { body: 'Shorter', thread: 'i1', answerTo: 'i1' })).answerTo, 'i1');
  assert.equal(commentFromRow(row('a2', { body: 'Plain', thread: 'i1' })).answerTo, null);
  const edited = commentFromRow({ ...row('e1', { body: 'Fixed', editedAt: '2026-10-21T10:00:00.000Z' }), change: 'edited' });
  assert.equal(edited.change, 'created', 'an edit reads as the comment\'s own change, with its edit time');
  assert.equal(edited.editedAt, '2026-10-21T10:00:00.000Z');
  const text = commentFromRow({ ...row('t1', { body: 'Why?' }), mode: 'text', quote: 'the words', prefix: 'before ', suffix: ' after',
    field: 'body', view: 'issue' });
  assert.deepEqual(text.passage, { quote: 'the words', prefix: 'before ', suffix: ' after', field: 'body' });
  assert.equal(text.view, 'issue');
  assert.equal(commentFromRow({ ...row('t2', { body: 'Why?' }), mode: 'text', quote: '  ' }).passage, null);
});

test('Anchors: every comment mode reads to the store\'s place and back', () => {
  const words = { quote: 'the words', prefix: 'before ', suffix: ' after', field: null };
  const none = { w: null, h: null };
  const cases: Array<[NonNullable<Parameters<typeof commentAnchorOfDraft>[0]>, Record<string, unknown>]> = [
    [{ anchorKey: 'sk1', x: null, y: null, ...none, text: words }, { mode: 'text', quote: 'the words', prefix: 'before ', suffix: ' after' }],
    [{ anchorKey: 'sk1', x: 0.123456, y: 0.5, ...none }, { mode: 'point', anchor_keys: ['sk1'], x: 0.1235, y: 0.5 }],
    [{ anchorKey: 'sk1', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }, { mode: 'box', anchor_keys: ['sk1'], x: 0.1, y: 0.2, w: 0.3, h: 0.25 }],
    [{ anchorKey: null, x: null, y: null, ...none, items: ANCHORS }, { mode: 'items', anchor_keys: ['sk1', 'sk2'] }],
    [{ anchorKey: 'sk1', x: null, y: null, ...none, time: 12.5 }, { mode: 'time', time_start: 12.5 }],
    [{ anchorKey: 'sk1', x: null, y: null, ...none }, { mode: 'page', anchor_keys: ['sk1'] }],
    [{ anchorKey: null, x: null, y: null, ...none }, { mode: 'page', anchor_keys: [] }],
  ];
  for (const [pin, expected] of cases) {
    const anchor = commentAnchorOfDraft(pin);
    for (const [name, value] of Object.entries(expected)) {
      assert.deepEqual((anchor as unknown as Record<string, unknown>)[name], value, `${expected.mode}: ${name}`);
    }
    const back = commentDraftOfAnchor(anchor, ANCHORS);
    assert.ok(back, `${expected.mode}: a draft from the store place`);
  }
  const field = commentAnchorOfDraft({ anchorKey: null, x: null, y: null, w: null, h: null, text: { ...words, field: 'bodyEn' } });
  assert.equal(field.field, 'bodyEn', 'words in a named field keep the field');
});

test('commentThreads: anchor order, replies under their root, deleted replies kept for their line', () => {
  const threads = commentThreads(comments(), ANCHORS);
  assert.deepEqual(threads.map(thread => thread.root.recordKey), ['c1', 'c2', 'c4', 'c5', 'c3']);
  assert.equal(threads[0]!.root.recordKey, 'c1');
  assert.equal(threads[0]!.replies.length, 1);
  assert.equal(threads[0]!.anchor?.order, 1);
  assert.equal(threads.at(-1)!.anchor?.order, 2);
});

test('commentChangesSince keeps my comments and every status or answer change after the checkpoint', () => {
  const changes = commentChangesSince(comments(), '2026-10-20T00:00:00.000Z', 'Flo');
  assert.deepEqual(changes.map(change => change.recordKey), ['c1']);
  assert.equal(commentChangesSince(comments(), '2026-10-18T00:00:00.000Z', 'Flo').length, 2, 'the resolve counts too');
  assert.equal(commentChangesSince(comments(), null, 'Claude').length, 1, 'someone else\'s new comment is not my change, a status change is');
});

test('commentDigest: heading, reply instructions and one line per change', () => {
  const all = comments();
  const changes = commentChangesSince(all, '2026-10-18T00:00:00.000Z', 'Flo');
  const text = commentDigest({
    scope: { id: 'deck-1', recordKey: 'dk1', name: 'Q4 review', checkpoint: '2026-10-18T00:00:00.000Z' },
    comments: all, anchors: ANCHORS, changes, nowIso: '2026-10-22T00:00:00.000Z',
  });
  const lines = text.split('\n');
  assert.equal(lines[0], '# Slide comments: Q4 review');
  assert.match(lines[2]!, /operation reply, comment_id set to the thread id/);
  assert.match(text, /- Slide 1 "Intro", pin at x 0\.25, y 0\.50: Flo commented "Tighten the title"; status Open \(thread c1\)/);
  assert.match(text, /- Slide 2 "Plan", on the whole slide, no pin: Flo resolved Flo: "Old note"; status Resolved \(thread c4\)/);
  const empty = commentDigest({ scope: null, comments: [], anchors: [], changes: [], nowIso: 'x' }, { heading: 'Review' });
  assert.match(empty, /^# Review: Deck/);
  assert.match(empty, /- No changes\./);
});

test('Zones: a box is read as a zone, and the digest says where the zone is', () => {
  const zone = commentFromRow(row('z1', { body: 'This block', slide: 'slide-1', x: 0.1, y: 0.2, w: 0.3, h: 0.25, change: 'created',
    changedAt: '2026-10-21T09:00:00.000Z' }));
  assert.equal(zone.w, 0.3);
  assert.equal(isCommentZone(zone), true);
  assert.equal(isCommentZone(commentFromRow(ROWS[0]!)), false, 'a point is a pin');
  const text = commentDigest({ scope: null, comments: [zone], anchors: ANCHORS, changes: [zone], nowIso: 'x' });
  assert.match(text, /- Slide 1 "Intro", zone at x 0\.10, y 0\.20, 0\.30 wide by 0\.25 high: Flo commented "This block"/);
});

test('applyCommentPatches shows local fields until the server row reaches the patch revision', () => {
  const [first] = comments() as [CommentRecord];
  const patched = applyCommentPatches([first], { c1: { fields: { status: 'Resolved' }, revision: null } });
  assert.equal(patched[0]!.status, 'Resolved');
  const caught = applyCommentPatches([{ ...first, revision: 3 }], { c1: { fields: { status: 'Resolved' }, revision: 3 } });
  assert.equal(caught[0]!.status, 'Open', 'the server row wins once it carries the write');
});

test('commentRelativeTime speaks English and French', () => {
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  const en = commentRelativeTime('2026-10-22T11:55:00.000Z', 'en', now);
  const fr = commentRelativeTime('2026-10-22T11:55:00.000Z', 'fr', now);
  assert.ok(en.length > 0 && fr.length > 0);
  assert.notEqual(en, fr);
  assert.equal(commentRelativeTime(null, 'en', now), '');
});

test('@notis/sdk/ui exports the pane and its pieces', () => {
  for (const name of ['CommentPane', 'CommentPins', 'useComments', 'commentFromRow', 'commentAnchorOfDraft',
    'commentDigest', 'COMMENT_WORDS', 'CommentToolBar', 'useCommentRouting', 'useCommentFocusParam',
    'COMMENT_FOCUS_PARAM']) {
    assert.ok(name in ui, `${name} is exported`);
  }
  for (const name of ['CommentThreadCard', 'NewCommentBox', 'CommentAvatar', 'COMMENT_COLUMNS', 'readCommentRow',
    'commentAuthorCandidates', 'isRefusedChoice', 'PASSAGE_COLUMNS', 'readPassage', 'passageProperties']) {
    assert.ok(!(name in ui), `${name} is no longer exported`);
  }
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** One write the pane sent to the comment store. */
interface Call { op: MemoryCommentOp; input: Record<string, unknown> }

/** The memory store behind each fake runtime, to read its rows or make it fail. */
const STORES = new WeakMap<object, MemoryCommentStore>();
const storeOf = (runtime: NotisRuntime) => STORES.get(runtime)!;

let cacheCounter = 0;
/**
 * A Space runtime whose comments live in an in-memory store seeded with `rows`; every write the pane sends lands in
 * `calls`. The viewer is Flo with Space edit rights unless `viewerName` or `comments.viewer` says otherwise.
 */
function fakeRuntime(rows: readonly SpaceCommentRow[], calls: Call[],
  options: { fail?: boolean; locale?: 'en' | 'fr'; params?: Record<string, string>;
    comments?: Partial<SpaceCommentsTransport>; viewerName?: string | null; upload?: boolean } = {}) {
  const viewer: SpaceCommentViewer | null = options.viewerName === null ? null
    : { id: 'user-flo', name: options.viewerName ?? 'Flo', canEditSpace: true };
  const store = memoryCommentStore({ rows: rows.map(item => ({ ...item })), calls, failing: options.fail, viewer,
    upload: options.upload === true });
  const runtime = {
    commentsExtra: options.comments,
    commentsStore: store,
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: `comments-${cacheCounter += 1}` },
    // Comments never go through Space actions: any call here is a mistake.
    callAction: async (action: string) => { throw new Error(`No Space action may run for comments (${action}).`); },
    context: { params: options.params ?? {}, locale: options.locale ?? 'en',
      viewerName: options.viewerName === undefined ? 'Flo' : options.viewerName },
  } as unknown as NotisRuntime;
  STORES.set(runtime, store);
  return runtime;
}

let root: Root | null = null;
let controller: CommentController | null = null;

test.after(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
});

function Harness(props: UseCommentsOptions & { pins?: boolean } & Pick<CommentPaneProps, 'order' | 'groupBy' | 'groupHeadings'>) {
  const { pins = true, order, groupBy, groupHeadings, ...options } = props;
  controller = useComments(options);
  return (
    <div>
      {pins ? <div className="anchor" style={{ position: 'relative' }}><CommentPins controller={controller} /></div> : null}
      <CommentPane controller={controller} order={order} groupBy={groupBy} groupHeadings={groupHeadings} />
    </div>
  );
}

/**
 * The host Comments panel the panes draw in (`runtime.spaceComments`), unless the runtime says comments are off. The
 * viewer is Flo, with Space edit rights, unless the runtime's `commentsExtra` says otherwise.
 */
const PANELS = new WeakMap<object, NotisRuntime>();
function withHostPanel(runtime: NotisRuntime): NotisRuntime {
  if ('spaceComments' in runtime) return runtime;
  const known = PANELS.get(runtime);
  if (known) return known;
  const { commentsExtra: extra, commentsStore: store } = runtime as unknown as {
    commentsExtra?: Partial<SpaceCommentsTransport>; commentsStore?: MemoryCommentStore };
  const panel = {
    ...runtime,
    spaceComments: {
      ...(store ? store.transport : { list: async () => ({ comments: [], revision: 0 }), subscribe: () => () => {} }),
      attach(source) {
        source.show(doc.getElementById('panel'));
        return () => source.show(null);
      },
      ...extra,
    } as SpaceCommentsTransport,
  } as NotisRuntime;
  PANELS.set(runtime, panel);
  if (store) STORES.set(panel, store);
  return panel;
}

let engine = new KeyboardEngineCore();

async function mount(node: ReactNode, runtime: NotisRuntime, locale: 'en' | 'fr' = 'en') {
  if (root) await act(async () => { root!.unmount(); });
  clearCommentDrafts();
  clearCommentRoutingCache();
  doc.body.innerHTML = '<div id="app"></div><div id="panel"></div>';
  root = createRoot(doc.getElementById('app')!);
  engine = new KeyboardEngineCore();
  await rerender(node, runtime, locale);
}

/** Renders again in the mounted root, with the same keyboard engine: a new runtime object keeps the page mounted. */
async function rerender(node: ReactNode, runtime: NotisRuntime, locale: 'en' | 'fr' = 'en') {
  await act(async () => {
    root!.render(
      <NotisProvider runtime={withHostPanel(runtime)}>
        <KeyboardEngine host="preview" locale={locale} platform="mac" engine={engine} document={doc} strict>
          {node}
        </KeyboardEngine>
      </NotisProvider>,
    );
  });
  await settle();
}

async function settle() {
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}

async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  await settle();
}

async function key(el: Element, name: string, extra: { shift?: boolean } = {}) {
  await act(async () => {
    el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, shiftKey: !!extra.shift, bubbles: true, cancelable: true }));
    // Let go of the key, so the next press of it is not read as held down.
    el.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: name, shiftKey: !!extra.shift, bubbles: true }));
  });
  await settle();
}

async function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

const button = (label: string) => [...doc.querySelectorAll('button')].find(el =>
  el.getAttribute('aria-label') === label || el.textContent?.trim() === label) as HTMLButtonElement | undefined;
const cards = () => [...doc.querySelectorAll('.nui-comment-card')].map(card => card.getAttribute('data-thread'));
/** A question's option rows: their labels in order, and the row of one label. */
const optionLabels = (root: ParentNode = doc) => [...root.querySelectorAll('.nui-comment-options .nui-comment-option:not([data-other]) .nui-comment-option-label')]
  .map(el => el.textContent);
const option = (label: string, root: ParentNode = doc) => [...root.querySelectorAll('.nui-comment-option')]
  .find(el => el.querySelector('.nui-comment-option-label')?.textContent === label) as HTMLButtonElement | undefined;

/** A button of the pane's one header row: `new-comment-button`, `waiting-toggle` or `more-button`. */
const barButton = (part: string) => doc.querySelector(`.nui-comment-bar [data-part="${part}"]`) as HTMLButtonElement | null;
/** Opens the pane's "..." (unless it is open): Open, Done, All and the scope. */
async function openFilterMenu() {
  if (!doc.querySelector('.nui-comment-filter-item[data-filter]')) await click(barButton('more-button')!);
}
/** Picks This item or All items in the filter menu. */
async function pickScope(scope: 'anchor' | 'all' | 'page' | 'space') {
  await openFilterMenu();
  const item = doc.querySelector(`[role^="menuitem"] .nui-comment-filter-item[data-scope="${scope}"]`)?.closest('[role^="menuitem"]');
  assert.ok(item, `the filter menu offers the scope ${scope}`);
  await click(item!);
}
/** Opens the New comment menu and picks the entry with these words. */
async function pickNewComment(label: string) {
  await click(barButton('new-comment-button')!);
  const item = [...doc.querySelectorAll('[role^="menuitem"]')].find(el => el.textContent?.trim() === label);
  assert.ok(item, `the New comment menu offers "${label}"`);
  await click(item!);
}
/** Waiting for you is the row's toggle (turned on); Open, Done and All are in "...". */
async function pickFilter(filter: 'waiting' | 'open' | 'done' | 'all') {
  if (filter === 'waiting') {
    if (barButton('waiting-toggle')!.getAttribute('aria-pressed') !== 'true') await click(barButton('waiting-toggle')!);
    return;
  }
  await openFilterMenu();
  const item = doc.querySelector(`[role^="menuitem"] .nui-comment-filter-item[data-filter="${filter}"]`)?.closest('[role^="menuitem"]');
  assert.ok(item, `the filter menu offers ${filter}`);
  await click(item!);
}
/** Shuts an open menu. */
async function closeMenu() { await key(doc.activeElement ?? doc.body, 'Escape'); }
/** Opens a card's "..." and returns its entries by action: copy-link, change, edit, delete. */
async function threadMenu(threadKey: string): Promise<Record<string, HTMLElement>> {
  await click(doc.querySelector(`[data-thread="${threadKey}"] [data-part="thread-more"]`)!);
  return Object.fromEntries([...doc.querySelectorAll('[role="menu"] [data-thread-action]')].map(el =>
    [el.getAttribute('data-thread-action')!, el.closest('[role^="menuitem"]') as HTMLElement]));
}
/** Opens a reply's "..." and returns its entries by action: copy-link, edit, delete. */
async function replyMenu(commentKey: string): Promise<Record<string, HTMLElement>> {
  await click(doc.querySelector(`[data-comment="${commentKey}"] [data-part="reply-more"]`)!);
  return Object.fromEntries([...doc.querySelectorAll('[role="menu"] [data-reply-action]')].map(el =>
    [el.getAttribute('data-reply-action')!, el.closest('[role^="menuitem"]') as HTMLElement]));
}
/** What a card's "..." (or a reply's) offers, read and closed again. */
async function threadActions(threadKey: string): Promise<string[]> {
  const names = Object.keys(await threadMenu(threadKey));
  await closeMenu();
  return names;
}
async function replyActions(commentKey: string): Promise<string[]> {
  const names = Object.keys(await replyMenu(commentKey));
  await closeMenu();
  return names;
}
/** Picks one entry of a card's "..." (or of a reply's). */
async function threadAction(threadKey: string, action: string) {
  const entry = (await threadMenu(threadKey))[action];
  assert.ok(entry, `the thread's "..." offers ${action}`);
  await click(entry!);
}
async function replyAction(commentKey: string, action: string) {
  const entry = (await replyMenu(commentKey))[action];
  assert.ok(entry, `the reply's "..." offers ${action}`);
  await click(entry!);
}

/** The status and scope entries of "..." in order, each with the number it shows (null: none). */
const filterEntries = async () => {
  await openFilterMenu();
  const entries = [...doc.querySelectorAll('.nui-comment-filter-item:is([data-filter], [data-scope])')].map(el =>
    [el.getAttribute('data-filter') ?? `scope:${el.getAttribute('data-scope')}`, el.querySelector('.nui-comment-count')?.textContent ?? null]);
  await key(doc.activeElement ?? doc.body, 'Escape');
  return entries;
};
const toastUndo = () => doc.querySelector('.nui-toast-btn') as HTMLButtonElement | null;
/** Who a card's reply box names ("Reply to Claude", or plain "Reply" while nobody is known): where a reply goes. */
const replyTo = (key: string) => doc.querySelector(`[data-thread="${key}"] .nui-comment-reply-box textarea`)!.getAttribute('placeholder');
/** The thread a reply in this comment thread goes to, as the routing knows it (its title; null: none or not known). */
const goesToTitle = (key: string) => (controller!.routing.known?.(key) === false ? null : controller!.routing.goesTo(key)?.title ?? null);
/** The writes of one kind. */
const writes = (calls: Call[], op: MemoryCommentOp) => calls.filter(call => call.op === op);
const scope = { id: 'deck-1', recordKey: PAGE, name: 'Q4 review', checkpoint: '2026-10-20T00:00:00.000Z' };
const base: UseCommentsOptions = { scope, anchors: ANCHORS, anchorKey: 'sk1' };

test('CommentPane: threads of this anchor, pins, replies and the asks', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  assert.deepEqual(cards(), ['c2', 'c1'], 'open threads of slide 1, the newest thread first');
  const pins = [...doc.querySelectorAll('.nui-comment-pin')];
  assert.deepEqual(pins.map(pin => pin.getAttribute('data-pin')).sort(), ['c1', 'c2'],
    'each pin names its comment thread, so the list can follow the page to it');
  assert.deepEqual(pins.map(pin => pin.textContent), ['3', '4'],
    'numbered per page (the deck) by creation: c4 and c5, older, keep 1 and 2 though archived and deleted');
  assert.ok(pins[1]!.hasAttribute('data-agent'), 'a pin by someone else is marked');
  assert.equal(pins[0]!.getAttribute('aria-label'), 'Flo: Tighten the title');
  assert.equal(doc.querySelectorAll('.nui-comment-entry:not([data-root])').length, 1, 'one reply');
  const rootOf = (key: string) => controller!.threads.find(thread => thread.root.recordKey === key)!.root;
  assert.ok(controller!.isNew(rootOf('c2')), 'Claude comment after the checkpoint is new');
  assert.ok(!controller!.isNew(rootOf('c1')), 'my own comment is never new');
  assert.equal(doc.querySelector('.nui-comment-new'), null, 'a comment not read yet carries no mark on its card');
  // The comment above says who asks: the question adds no line of its own, only its option rows.
  const ask = doc.querySelector('[data-thread="c2"] .nui-comment-ask')!;
  assert.equal(doc.querySelector('.nui-comment-ask-label'), null);
  assert.doesNotMatch(ask.textContent!, /needs/);
  assert.deepEqual(optionLabels(ask), ['Looks good', 'Undo']);
  // The check ask answers through the store's answer.
  await click(option('Looks good')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'c2', answer: 'Looks good' } });
  assert.match(doc.querySelector('[data-thread="c2"] .nui-comment-answer')!.textContent!, /Looks good, sent to the agent/);
  assert.ok(!controller!.isNew(rootOf('c2')), 'an answered ask is no longer new');
});

test('CommentPane: one header row; Waiting for you is a toggle on it (the only number); "..." holds Open, Done, All and the scope; a chip says an unusual choice', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  // The one row: the host's switch (lead slot), New comment, the Waiting for you toggle, "...", then the host's close
  // button (trail slot). No funnel menu (Flo, 2026-11-25: a toggle that fits on the button line).
  const bar = doc.querySelector('.nui-comment-bar')!;
  assert.deepEqual([...bar.children].map(el => el.tagName === 'SLOT' ? `slot:${el.getAttribute('name')}` : el.getAttribute('data-part') ?? el.className),
    ['slot:lead', 'nui-comment-bar-gap', 'new-comment-button', 'waiting-toggle', 'more-button', 'slot:trail']);
  assert.equal(doc.querySelector('.nui-comment-chips'), null, 'no second row while the filter is the usual one');
  assert.equal(barButton('more-button')!.hasAttribute('data-active'), false);
  const toggle = barButton('waiting-toggle')!;
  assert.equal(toggle.getAttribute('aria-pressed'), 'false', 'off by default without a host setting');
  assert.equal(toggle.querySelector('.nui-comment-count')!.textContent, '1', 'the only number: what waits for you');
  assert.equal(toggle.getAttribute('aria-label'), 'Waiting for you, 1 waiting');
  assert.deepEqual(await filterEntries(),
    [['open', null], ['done', null], ['all', null], ['scope:page', null], ['scope:space', null],
      ['scope:anchor', null], ['scope:all', null]],
    'no totals in "..."');
  assert.equal(controller!.waitingCount, 1, 'the open question of slide 1');

  // Where: all items.
  await pickScope('all');
  assert.deepEqual(cards(), ['c3', 'c2', 'c1'], 'flat, the newest thread first (a new reply does not move c1)');
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-chip')].map(el => [el.getAttribute('data-chip'), el.textContent]), [['all-items', 'All items']],
    'one line says the filter is not the usual one');
  assert.ok(barButton('more-button')!.hasAttribute('data-active'));
  // Which: Done, All, Waiting for you.
  await pickFilter('done');
  assert.deepEqual(cards(), ['c4'], 'deleted threads never show');
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-chip')].map(el => el.textContent), ['Done', 'All items']);
  await pickFilter('all');
  assert.deepEqual(cards(), ['c3', 'c2', 'c1', 'c4']);
  await pickFilter('waiting');
  assert.deepEqual(cards(), ['c3', 'c2'], 'only what waits for you, on every item while All items is on');
  assert.equal(controller!.statusFilter, 'open');
  assert.equal(barButton('waiting-toggle')!.getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-chip')].map(el => el.getAttribute('data-chip')), ['all-items'],
    'the toggle says Waiting for you: no chip repeats it');
  // A second press on the toggle turns it off; a press on a chip removes that choice.
  await click(barButton('waiting-toggle')!);
  assert.equal(controller!.waitingFilter, false);
  assert.deepEqual(cards(), ['c3', 'c2', 'c1']);
  await click(doc.querySelector('.nui-comment-chip[data-chip="all-items"]')!);
  assert.equal(doc.querySelector('.nui-comment-chips'), null, 'the usual filter again: the second row goes');
  assert.deepEqual(cards(), ['c2', 'c1']);

  await mount(<Harness {...base} anchorKey="nothing" />, fakeRuntime(ROWS, []));
  assert.match(doc.querySelector('.nui-comment-empty')!.textContent!, /No comments here yet/);
});

test('The pane opens on Waiting for you when the host says so (the person\'s Focus mode setting), and the toggle turns it off', async () => {
  const comments: Partial<SpaceCommentsTransport> = { waitingFirst: true };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  assert.equal(controller!.waitingFilter, true);
  assert.equal(barButton('waiting-toggle')!.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(cards(), ['c2'], 'only what waits: the open question of slide 1');
  assert.equal(doc.querySelector('.nui-comment-chips'), null, 'the toggle says it: no second row');
  await click(barButton('waiting-toggle')!);
  assert.equal(controller!.waitingFilter, false);
  assert.deepEqual(cards(), ['c2', 'c1']);

  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: { waitingFirst: false } }));
  assert.equal(barButton('waiting-toggle')!.getAttribute('aria-pressed'), 'false', 'Focus mode off: every open thread');
});

test('Waiting for you lists what the host says waits (a mention, a question, a reply in your thread), and empties in its own words', async () => {
  setWaitingCommentThreads(['c1', 'c3']);
  try {
    await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
    assert.equal(controller!.waitingCount, 1, 'c1 on this item; c3 sits on another');
    assert.equal(barButton('waiting-toggle')!.querySelector('.nui-comment-count')!.textContent, '1');
    await pickFilter('waiting');
    assert.deepEqual(cards(), ['c1'], "the host's list wins over the pane's own guess (c2's open question)");
    await pickScope('all');
    assert.deepEqual(cards(), ['c3', 'c1']);
    await act(async () => { setWaitingCommentThreads([]); });
    await settle();
    assert.deepEqual(cards(), []);
    assert.match(doc.querySelector('.nui-comment-empty')!.textContent!, /Nothing waits for you here/);
    // A thread picked from the page that does not wait shows: the filter steps aside.
    await act(async () => { controller!.revealThread(controller!.threads.find(thread => thread.root.recordKey === 'c2')!); });
    await settle();
    assert.equal(controller!.waitingFilter, false);
    assert.ok(cards().includes('c2'));
  } finally {
    setWaitingCommentThreads(null);
  }
});

test('CommentPane: a reply sends on Enter, Shift+Enter keeps writing, and an archived thread stays archived', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} anchorKey="sk2" />, runtime);
  await pickFilter('done');
  const field = doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement;
  assert.equal(field.getAttribute('aria-label'), 'Reply');
  await type(field, 'Not quite');
  await key(field, 'Enter', { shift: true });
  assert.equal(calls.length, 0);
  await key(field, 'Enter');
  const [reply] = writes(calls, 'reply');
  assert.equal(reply!.input.root_id, 'c4');
  assert.equal(reply!.input.body, 'Not quite');
  assert.equal(typeof reply!.input.request_id, 'string', 'a request id makes a retried send land once');
  assert.equal(writes(calls, 'unarchive').length, 0,
    'a reply never reopens: the server brings a thread back only when a reply waits for someone (SPC-125)');
  const stored = storeOf(runtime).rows.find(item => item.thread_root_id === 'c4')!;
  assert.equal(stored.body, 'Not quite');
  assert.equal(stored.page_key, PAGE, 'the reply is on its thread\'s page');
});

test('CommentPane: Archive with Undo and Z, E and Shift+E, and a failed write rolls back', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  assert.deepEqual(calls.at(-1), { op: 'archive', input: { root_id: 'c1' } }, 'archive, shown as Done');
  assert.deepEqual(cards(), ['c2'], 'the archived thread leaves the open list');
  assert.match(doc.body.textContent!, /Comment thread archived/);
  assert.ok(toastUndo(), 'an Undo toast is offered');
  // Its accessible name is the word alone: the Z keycap is hidden from screen readers (aria-keyshortcuts says it).
  const named = (el: Element): string => [...el.childNodes].map(node => node.nodeType === 3 ? node.textContent
    : (node as Element).getAttribute('aria-hidden') === 'true' ? '' : named(node as Element)).join('');
  assert.equal(named(toastUndo()!), 'Undo');
  assert.equal(toastUndo()!.getAttribute('aria-keyshortcuts'), 'z');
  await key(doc.body, 'z');
  assert.deepEqual(calls.at(-1), { op: 'unarchive', input: { root_id: 'c1' } }, 'Z undoes the archive');
  assert.deepEqual(cards(), ['c2', 'c1']);

  // E archives the focused thread; Shift+E brings it back.
  const card = doc.querySelector('[data-thread="c2"]') as HTMLElement;
  card.focus();
  await key(card, 'e');
  assert.deepEqual(calls.at(-1), { op: 'archive', input: { root_id: 'c2' } });
  await pickFilter('done');
  const archived = doc.querySelector('[data-thread="c2"]') as HTMLElement;
  assert.match(archived.textContent!, /Done/, 'an archived thread reads Done');
  archived.focus();
  await key(archived, 'E', { shift: true });
  assert.deepEqual(calls.at(-1), { op: 'unarchive', input: { root_id: 'c2' } });
  const before = calls.length;
  // The keeper held focus in the pane when the card left the Done list; focus leaves the pane now.
  (doc.activeElement as HTMLElement | null)?.blur();
  await key(doc.body, 'e');
  assert.equal(calls.length, before, 'E does nothing while focus is outside the pane');

  const failing: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, failing, { fail: true }));
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  assert.deepEqual(cards(), ['c2', 'c1'], 'the thread comes back after the failed write');
  assert.match(doc.body.textContent!, /Could not save that change/);
});

test('Undo of an archive unarchives, Undo of a delete restores, each on the comment it changed only', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} />, runtime);
  await click(doc.querySelector('[data-thread="c2"] button[aria-label^="Archive the comment thread: "]')!);
  assert.deepEqual(calls.at(-1), { op: 'archive', input: { root_id: 'c2' } });
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'c2')!.status, 'archived');
  await click(toastUndo()!);
  assert.deepEqual(calls.at(-1), { op: 'unarchive', input: { root_id: 'c2' } }, 'Undo brings the thread back');
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'c2')!.status, 'open');

  await threadAction('c1', 'delete');
  assert.deepEqual(calls.at(-1), { op: 'remove', input: { id: 'c1' } }, 'one delete, on the first comment alone');
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'r1')!.status, 'open', 'its reply is left to the server');
  assert.deepEqual(cards(), ['c2'], 'the thread leaves the list');
  await click(toastUndo()!);
  assert.deepEqual(calls.at(-1), { op: 'restore', input: { id: 'c1' } }, 'Undo restores it');
  assert.deepEqual(cards(), ['c2', 'c1']);
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'c1')!.body, 'Tighten the title');
  assert.deepEqual(calls.map(call => call.op), ['archive', 'unarchive', 'remove', 'restore'], 'nothing else was written');
});

test('Delete at once with Undo: the first comment deletes the thread, a later one leaves a line', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  assert.equal(doc.querySelector('dialog'), null);
  // A reply: only that comment, with a "Comment deleted" line in its place.
  await replyAction('r1', 'delete');
  assert.equal(doc.querySelector('dialog[open]'), null, 'no confirmation dialog');
  assert.deepEqual(calls.at(-1), { op: 'remove', input: { id: 'r1' } });
  assert.match(doc.querySelector('[data-thread="c1"] .nui-comment-deleted')!.textContent!, /Comment deleted/);
  await key(doc.body, 'z');
  assert.deepEqual(calls.at(-1), { op: 'restore', input: { id: 'r1' } }, 'Z brings the reply back');
  assert.equal(doc.querySelector('.nui-comment-deleted'), null);

  // The first comment: the whole thread goes with it, in one delete (the server keeps the replies for the Bin).
  calls.length = 0;
  await threadAction('c1', 'delete');
  assert.deepEqual(calls, [{ op: 'remove', input: { id: 'c1' } }]);
  assert.deepEqual(cards(), ['c2']);
  assert.match(doc.body.textContent!, /Comment thread deleted/);
  await click(toastUndo()!);
  assert.deepEqual(cards(), ['c2', 'c1'], 'Undo brings the thread back');
  assert.deepEqual(calls.slice(1), [{ op: 'restore', input: { id: 'c1' } }]);
});

test('Delete rights: your own comments; a whole thread or someone else\'s needs Space edit rights; no viewer, no Delete', async () => {
  const rows = [
    row('m1', { body: 'Mine', slide: 'slide-1', createdAt: '2026-10-21T09:00:00.000Z' }),
    row('m2', { body: 'Agreed', author: 'Claude', slide: 'slide-1', thread: 'm1', createdAt: '2026-10-21T10:00:00.000Z' }),
    row('m3', { body: 'Mine again', slide: 'slide-1', thread: 'm1', createdAt: '2026-10-21T11:00:00.000Z' }),
    row('o1', { body: 'Alone', slide: 'slide-1', createdAt: '2026-10-21T08:00:00.000Z' }),
  ];
  const viewer = { name: 'Flo', canEditSpace: false };
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: { viewer } }));
  // Each reply keeps Copy link, Edit and Delete in one "..." of its own, named after the reply.
  assert.equal(doc.querySelector('[data-comment="m3"] [data-part="reply-more"]')!.getAttribute('aria-label'), 'More for the reply: Mine again');
  assert.deepEqual(await replyActions('m3'), ['copy-link', 'edit', 'delete'], 'your own reply');
  assert.deepEqual(await replyActions('m2'), ['copy-link'], 'not someone else\'s: no Edit, no Delete');
  assert.deepEqual(await threadActions('m1'), ['copy-link', 'edit'], 'a thread with someone else\'s reply needs edit rights to delete');
  assert.deepEqual(await threadActions('o1'), ['copy-link', 'edit', 'delete'], 'a thread all yours');

  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: { viewer: { name: 'Flo', canEditSpace: true } } }));
  assert.deepEqual(await replyActions('m2'), ['copy-link', 'delete'], 'an editor deletes anyone\'s, and edits only their own');
  assert.deepEqual(await threadActions('m1'), ['copy-link', 'edit', 'delete']);

  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: { viewer: undefined } }));
  assert.deepEqual(await threadActions('m1'), ['copy-link'], 'no viewer, no Delete or Edit');
  assert.deepEqual(await replyActions('m3'), ['copy-link']);
});

test('Your comments are told by the store (author.you), not the name: a renamed person keeps Edit and Delete', async () => {
  const at = (hour: number) => `2026-10-21T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const rows = [
    // Written as "Florian" before the rename; the store says the viewer wrote it.
    row('a1', { body: 'Before the rename', author: 'Florian', slide: 'slide-1', createdAt: at(8), you: true }),
    // Another person also named Flo: the name matches, the writer does not.
    row('a2', { body: 'Another Flo', slide: 'slide-1', createdAt: at(9), you: false }),
  ];
  const viewer = { name: 'Flo', canEditSpace: false, id: 'user-flo' };
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: { viewer } }));
  assert.deepEqual(await threadActions('a1'), ['copy-link', 'edit', 'delete'], 'the store says you wrote it: Edit and Delete, whatever the old name');
  assert.deepEqual(await threadActions('a2'), ['copy-link'], 'the same name is not enough when the store says someone else wrote it');
});

test('Edit your own comment in place: it saves the text through the store and reads edited', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} />, runtime);
  assert.ok(!(await replyActions('r1')).includes('edit'), 'Claude\'s reply is not yours');
  await threadAction('c1', 'edit');
  const field = doc.querySelector('[data-thread="c1"] .nui-comment-edit textarea') as HTMLTextAreaElement;
  assert.equal(field.value, 'Tighten the title');
  await type(field, 'Tighten the title, please');
  await key(field, 'Enter');
  assert.deepEqual(calls.at(-1), { op: 'edit', input: { id: 'c1', body: 'Tighten the title, please' } });
  assert.equal(doc.querySelector('[data-thread="c1"] .nui-comment-edit'), null);
  assert.match(doc.querySelector('[data-thread="c1"] .nui-comment-body')!.textContent!, /Tighten the title, please/);
  assert.equal(doc.querySelector('[data-comment="c1"] .nui-comment-sub .nui-comment-edited')!.textContent, 'edited', 'after its time, on the quieter line');
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'c1')!.body, 'Tighten the title, please');

  await threadAction('c1', 'edit');
  const again = doc.querySelector('[data-thread="c1"] .nui-comment-edit textarea') as HTMLTextAreaElement;
  await type(again, 'Shorter title');
  await click(button('Save')!);
  assert.deepEqual(calls.at(-1), { op: 'edit', input: { id: 'c1', body: 'Shorter title' } }, 'Save sends it too');
});

test('Where a reply goes is said once, by the reply box; "..." opens that thread and changes who it goes to', async () => {
  const linked: unknown[] = [];
  const opened: string[] = [];
  const picks: unknown[] = [];
  const comments: Partial<SpaceCommentsTransport> = {
    links: async ({ rootIds }) => Object.fromEntries(rootIds.filter(key => key === 'c1')
      .map(key => [key, [{ threadId: 't-1', title: 'Deck polish', harness: 'claude' }]])),
    bestMatch: async () => ({ threadId: 't-best', title: 'Q4 deck' }),
    pickThread: async input => { picks.push(input.current ?? null); return { threadId: 't-2', title: 'Chart work' }; },
    link: async input => { linked.push(input); return { threadId: 't-2', title: 'Chart work' }; },
    openThread: threadId => { opened.push(threadId); },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  const box = (key: string) => doc.querySelector(`[data-thread="${key}"] .nui-comment-reply-box textarea`)!;
  assert.equal(box('c1').getAttribute('placeholder'), 'Reply to Claude', 'the linked thread runs on Claude');
  assert.equal(box('c1').getAttribute('aria-label'), 'Reply to Claude');
  assert.equal(box('c2').getAttribute('placeholder'), 'Reply to Notis', 'no link yet: the best match, a Notis thread');
  const card = doc.querySelector('[data-thread="c1"]')!;
  assert.equal(card.querySelector('[data-part="goes-to"]'), null, 'no Thread or Goes to line on the card');
  assert.doesNotMatch(card.textContent!, /Deck polish|Goes to/, 'the thread is not named on the card');
  // "..." opens the thread a reply goes to, and changes it.
  assert.deepEqual(await threadActions('c1'), ['copy-link', 'open-thread', 'change', 'edit', 'delete']);
  assert.match((await threadMenu('c1'))['open-thread']!.textContent!, /Open Deck polish in the chat/);
  await closeMenu();
  await threadAction('c1', 'open-thread');
  assert.deepEqual(opened, ['t-1']);
  await threadAction('c1', 'change');
  assert.deepEqual(picks, ['t-1']);
  assert.deepEqual(linked, [{ rootId: 'c1', pick: { threadId: 't-2', title: 'Chart work' }, primary: true }]);
  assert.equal(box('c1').getAttribute('placeholder'), 'Reply to Notis', 'the pick shows at once');
  assert.match((await threadMenu('c1'))['open-thread']!.textContent!, /Open Chart work in the chat/);
  await closeMenu();

  // A pick the host could not link says so instead of silently staying on the old thread.
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: { ...comments, link: async () => null } }));
  await threadAction('c1', 'change');
  assert.equal(box('c1').getAttribute('placeholder'), 'Reply to Claude');
  assert.match(doc.body.textContent!, /Could not save that change/);

  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.equal(box('c1').getAttribute('placeholder'), 'Reply', 'a host without links names nobody');
  assert.deepEqual(await threadActions('c1'), ['copy-link', 'edit', 'delete'], 'and offers no thread to open or change');
});

test('The card: where it sits first with Done and "..." at its top right, two lines beside each avatar, the words on its full width', async () => {
  const rows = [
    row('m1', { body: 'Mine', slide: 'slide-1', createdAt: '2026-10-21T09:00:00.000Z' }),
    row('m2', { body: 'Agreed', author: 'Claude', slide: 'slide-1', thread: 'm1', createdAt: '2026-10-21T10:00:00.000Z' }),
    row('m3', { body: 'Mine again', slide: 'slide-1', thread: 'm1', createdAt: '2026-10-21T11:00:00.000Z' }),
  ];
  const linked: Partial<SpaceCommentsTransport> = {
    viewer: { name: 'Flo', canEditSpace: false, id: 'user-flo' },
    links: async ({ rootIds }) => Object.fromEntries(rootIds.map(key => [key, [{ threadId: 't-1', title: 'Deck polish' }]])),
    bestMatch: async () => null,
  };
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: linked }));
  const card = doc.querySelector('[data-thread="m1"]')!;
  assert.deepEqual([...card.children].map(el => el.className), ['nui-comment-top', 'nui-comment-entries', 'nui-comment-reply-box']);
  // The top row: where it sits, then the thread's two buttons.
  const top = card.querySelector(':scope > .nui-comment-top')!;
  assert.deepEqual([...top.children].map(el => el.className), ['nui-comment-anchor', 'nui-comment-actions']);
  assert.equal(top.querySelector('[data-part="place"]')!.textContent, 'Intro', 'a comment on a whole item: the item, by its title');
  assert.deepEqual([...top.querySelectorAll('.nui-comment-actions > button, .nui-comment-actions [data-part]')].map(item => item.getAttribute('data-part')),
    ['done', 'thread-more']);
  assert.equal(top.querySelector('[data-part="done"]')!.getAttribute('aria-label'), 'Archive the comment thread: Mine');
  assert.equal(top.querySelector('[data-part="thread-more"]')!.getAttribute('aria-label'), 'More for the comment thread: Mine');
  // Each comment: the avatar, then two lines (the name, then the time), then its "..." on a reply.
  const entry = (key: string) => card.querySelector(`[data-comment="${key}"]`)!;
  assert.deepEqual([...entry('m1').children].map(el => el.className), ['nui-comment-entry-head', 'nui-comment-entry-main']);
  assert.deepEqual([...entry('m1').querySelector('.nui-comment-entry-head')!.children].map(el => el.className.split(' ')[0]),
    ['nui-comment-avatar', 'nui-comment-who'], 'the first comment has no menu of its own: the thread\'s is at the top');
  assert.deepEqual([...entry('m2').querySelector('.nui-comment-entry-head')!.children].map(el => el.className.split(' ')[0]),
    ['nui-comment-avatar', 'nui-comment-who', 'nui-comment-entry-more']);
  assert.deepEqual([...entry('m2').querySelector('.nui-comment-who')!.children].map(el => el.className), ['nui-comment-name', 'nui-comment-sub']);
  assert.equal(entry('m2').querySelector('.nui-comment-name')!.textContent, 'Claude');
  assert.equal(entry('m2').querySelector('.nui-comment-entry-main .nui-comment-body')!.textContent, 'Agreed',
    'the words sit under the block, on the card\'s full width');
  // No mark on a comment not read yet: no dot, no bar.
  assert.equal(card.querySelector('.nui-comment-new, [data-unread]'), null);
  // Every reply: Copy link; Edit and Delete only on your own (this viewer cannot edit the Space).
  assert.deepEqual(await replyActions('m2'), ['copy-link'], 'someone else\'s reply: Copy link only');
  assert.deepEqual(await replyActions('m3'), ['copy-link', 'edit', 'delete']);
  // Quiet until the card is hovered, focused or selected; always there where nothing hovers (a phone).
  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  assert.match(css, /\.nui-comment-actions \{[^}]*opacity: 0;/);
  assert.match(css, /\.nui-comment-card:is\(:hover, \[data-selected\], :focus-visible, :focus-within\) \.nui-comment-actions,\n\.nui-comment-actions:has\(\[aria-expanded="true"\]\) \{ opacity: 1; \}/);
  assert.match(css, /\.nui-comment-entry-more \{[^}]*opacity: 0;/);
  assert.match(css, /@media \(hover: none\) \{\s*\.nui-comment-actions, \.nui-comment-entry-more \{ opacity: 1; \}/);

  // French: the menus read in French too.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: linked, locale: 'fr' }), 'fr');
  assert.equal(doc.querySelector('[data-comment="m2"] [data-part="reply-more"]')!.getAttribute('aria-label'), 'Plus pour la réponse\u202f: Agreed');
  assert.equal((await replyMenu('m2'))['copy-link']!.textContent, 'Copier le lien');
  await closeMenu();
});

test('An agent signs with its band name read out and its app\'s logo on its avatar; its name opens its runtime card on keyboard focus', async () => {
  const codex = { provider: 'codex', label: 'Codex', model: 'gpt-5.5-codex', intelligence: 'high', effort: null, speed: 'priority' };
  const notis = { provider: 'notis', label: null, model: 'claude-opus-5.5', intelligence: null, effort: null, speed: null };
  const rows = [
    row('c1', { body: 'Tighten the title', slide: 'slide-1', createdAt: '2026-10-21T09:00:00.000Z' }),
    { ...row('r1', { body: 'Shortened', author: 'fred-and-the-machine', slide: 'slide-1', thread: 'c1', createdAt: '2026-10-21T10:00:00.000Z' }),
      agent: { name: 'fred-and-the-machine', thread_id: 't-9', runtime: codex } },
    { ...row('c2', { body: 'Keep the chart?', author: 'Notis', slide: 'slide-1', createdAt: '2026-10-21T11:00:00.000Z' }),
      agent: { name: 'Notis', runtime: notis } },
    { ...row('c3', { body: 'No runtime recorded', author: 'john-trash', slide: 'slide-1', createdAt: '2026-10-21T12:00:00.000Z' }),
      agent: { name: 'john-trash' } },
  ];
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  const reply = doc.querySelector('[data-comment="r1"]')!;
  assert.equal(reply.querySelector('.nui-comment-author')!.textContent, 'Fred And The Machine');
  assert.equal(reply.querySelector('.nui-comment-avatar')!.textContent, 'F');
  assert.equal(doc.querySelector('.nui-comment-agent'), null, 'no From line on a signature: the card names its thread once');
  const badge = reply.querySelector('[data-part="agent-runtime"]') as HTMLElement;
  assert.ok(badge.classList.contains('nui-comment-author'), 'the name itself opens the card');
  assert.equal(badge.getAttribute('data-harness'), 'codex');
  assert.equal(badge.getAttribute('tabindex'), '0', 'keyboard reachable');
  assert.equal(reply.querySelector('.nui-comment-avatar-badge svg')!.getAttribute('data-harness'), 'codex', 'the Codex logo, on the avatar');
  assert.equal(badge.getAttribute('aria-label'),
    'Fred And The Machine · Codex · Intelligence: High · Speed: Fast · Model: gpt-5.5-codex');
  // A keyboard user tabs to it (the card shows at once on keyboard focus, not on a click's focus).
  const tabTo = async (el: HTMLElement) => {
    await act(async () => {
      doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      el.focus();
    });
  };
  await tabTo(badge);
  const tip = doc.querySelector('[role="tooltip"]')!;
  assert.equal(tip.id, badge.getAttribute('aria-describedby'), 'the card describes the name');
  assert.ok(tip.classList.contains('nui-tip-card'), 'the runtime card, not a one-line pill');
  assert.equal(tip.querySelector('.nui-runtime-card-name')!.textContent, 'Fred And The Machine');
  assert.deepEqual([...tip.querySelectorAll('.nui-runtime-glyphs svg')].map(svg => svg.getAttribute('data-harness') ?? svg.getAttribute('data-glyph')),
    ['codex', 'bars', 'speed']);
  assert.equal(tip.querySelector('[data-glyph="bars"]')!.getAttribute('data-level'), 'high');
  assert.equal(tip.querySelector('[data-glyph="speed"]')!.getAttribute('data-speed'), 'priority');
  assert.deepEqual([...tip.querySelectorAll('.nui-runtime-card-line')].map(line => line.textContent),
    ['Codex', 'Intelligence: High', 'Speed: Fast', 'Model: gpt-5.5-codex']);
  await act(async () => { badge.blur(); });
  assert.equal(doc.querySelector('.nui-tip-card'), null, 'gone on blur');

  // Notis names the provider it ran on (by its model) and says what was not recorded, like the timeline.
  const notisBadge = doc.querySelector('[data-thread="c2"] [data-part="agent-runtime"]') as HTMLElement;
  assert.equal(notisBadge.getAttribute('aria-label'),
    'Notis · Claude · Intelligence unavailable · Speed unavailable · Model: claude-opus-5.5');
  await tabTo(notisBadge);
  const notisTip = doc.querySelector('.nui-tip-card')!;
  const provider = notisTip.querySelector('[data-runtime-provider]')!;
  assert.equal(provider.getAttribute('data-runtime-provider'), 'claude');
  assert.equal(provider.querySelector('svg')!.getAttribute('data-harness'), 'claude_code', 'the Claude logo before Claude');
  assert.ok(notisTip.querySelector('[data-glyph="brain"]'), 'no level recorded: the brain');
  assert.equal(notisTip.querySelector('[data-glyph="speed"]')!.getAttribute('data-speed'), 'unknown');
  await act(async () => { notisBadge.blur(); });

  // No runtime recorded: the name alone, no logo and no card.
  const plain = doc.querySelector('[data-thread="c3"]')!;
  assert.equal(plain.querySelector('.nui-comment-author')!.textContent, 'John Trash');
  assert.equal(plain.querySelector('[data-part="agent-runtime"]'), null);
  assert.equal(plain.querySelector('.nui-comment-avatar-badge'), null);
  assert.equal(doc.querySelector('[data-comment="c1"] [data-part="agent-runtime"], [data-comment="c1"] .nui-comment-avatar-badge'), null, 'a person: no logo');

  // French: the Portal's words.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { locale: 'fr' }), 'fr');
  assert.equal(doc.querySelector('[data-comment="r1"] [data-part="agent-runtime"]')!.getAttribute('aria-label'),
    'Fred And The Machine · Codex · Intelligence : Élevé · Vitesse : Rapide · Modèle : gpt-5.5-codex');
});

test('An agent outside Notis holds its thread: the box replies to it, and your reply carries the chat bubble\'s check until it has read it (SPC-535, SPC-536, SPC-537)', async () => {
  const outside = { name: 'Velvet Margin Echo', thread_name: 'PR #3851', harness: 'claude_code', outside: true };
  const rows = [
    { ...row('c1', { body: 'Which slide?', author: 'Velvet Margin Echo', slide: 'slide-1', createdAt: '2026-10-21T09:00:00.000Z' }),
      agent: outside },
    row('r1', { body: 'Slide 3', slide: 'slide-1', thread: 'c1', createdAt: '2026-10-21T10:00:00.000Z' }),
  ];
  const claim = (readAt: string | null) => ({ threadId: null, title: 'Velvet Margin Echo', harness: 'claude_code',
    status: 'outside', subagent: 'Velvet Margin Echo', via: 'claimed' as const, outside: true,
    agentId: 'declared:7c1d', agentName: 'Velvet Margin Echo', threadName: 'PR #3851', readAt });
  const linked: unknown[] = [];
  const transport = (readAt: string | null): Partial<SpaceCommentsTransport> => ({
    links: async ({ rootIds }) => Object.fromEntries(rootIds.map(key => [key, [claim(readAt)]])),
    pickThread: async () => ({ threadId: 't-2', title: 'Chart work' }),
    link: async input => { linked.push(input); return { threadId: 't-2', title: 'Chart work' }; },
  });
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: transport(null) }));
  const card = () => doc.querySelector('[data-thread="c1"]')!;
  const mark = () => card().querySelector('[data-part="read-mark"]');
  assert.ok(card().hasAttribute('data-outside'));
  const box = card().querySelector('textarea')!;
  assert.equal(box.getAttribute('placeholder'), 'Reply to Velvet Margin Echo');
  // Your reply carries the mark after its time: one check while the agent has not read it.
  assert.equal(mark()!.closest('[data-comment]')!.getAttribute('data-comment'), 'r1', 'on your latest word');
  assert.ok(mark()!.closest('.nui-comment-sub'), 'after its time');
  assert.equal(mark()!.getAttribute('aria-label'), 'Velvet Margin Echo has not read it yet');
  assert.equal(mark()!.hasAttribute('data-read'), false);
  assert.equal(mark()!.querySelectorAll('path').length, 1, 'one check');
  assert.equal(card().querySelector('[data-part="outside-unread"]'), null, 'no "has not read it yet" line');
  // The signature: its band name with its app's logo on the avatar and, quiet, the thread it works in.
  const first = card().querySelector('[data-comment="c1"]')!;
  assert.equal(first.querySelector('.nui-comment-avatar-badge svg')!.getAttribute('data-harness'), 'claude_code');
  assert.equal(first.querySelector('[data-part="agent-harness"]')!.getAttribute('aria-label'), 'Velvet Margin Echo · Runs on Claude · outside Notis');
  assert.equal(first.querySelector('.nui-comment-sub [data-part="agent-thread-name"]')!.textContent, 'PR #3851');

  // Read after the reply: two checks. The agent wrote last and nobody answered: no mark.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: transport('2026-10-21T11:00:00.000Z') }));
  assert.ok(mark()!.hasAttribute('data-read'));
  assert.equal(mark()!.querySelectorAll('path').length, 2, 'two checks once read');
  assert.equal(mark()!.getAttribute('aria-label'), 'Read by Velvet Margin Echo');
  await mount(<Harness {...base} />, fakeRuntime([rows[0]], [], { comments: transport(null) }));
  assert.equal(mark(), null);
  assert.equal(card().querySelector('textarea')!.getAttribute('placeholder'), 'Reply to Velvet Margin Echo');

  // Change hands the thread to a Notis thread: the claim goes, the box says who gets the reply now.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: transport(null) }));
  assert.ok(!(await threadActions('c1')).includes('open-thread'), 'an agent outside Notis has no thread to open here');
  await threadAction('c1', 'change');
  assert.deepEqual(linked, [{ rootId: 'c1', pick: { threadId: 't-2', title: 'Chart work' }, primary: true }]);
  assert.equal(card().querySelector('textarea')!.getAttribute('placeholder'), 'Reply to Notis');
  assert.equal(card().hasAttribute('data-outside'), false);
  assert.equal(mark(), null);

  // French: tu, and a narrow no-break space before a colon.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: transport(null), locale: 'fr' }), 'fr');
  assert.equal(card().querySelector('textarea')!.getAttribute('placeholder'), 'Répondre à Velvet Margin Echo');
  assert.equal(mark()!.getAttribute('aria-label'), 'Pas encore lu par Velvet Margin Echo');
  assert.equal(card().querySelector('[data-part="agent-harness"]')!.getAttribute('aria-label'), 'Velvet Margin Echo · Tourne sur Claude · hors de Notis');
});

test('commentFromRow reads an agent outside Notis: its thread name, its harness and that it is outside', () => {
  const read = commentFromRow({ ...row('c9', { body: 'Hi', author: 'velvet-margin-echo' }),
    agent: { name: 'velvet-margin-echo', thread_name: ' PR #3851 ', harness: 'codex', outside: true } });
  assert.deepEqual(read.agent, { name: 'velvet-margin-echo', threadId: null, rowId: null, threadName: 'PR #3851',
    harness: 'codex', outside: true });
  const notis = commentFromRow({ ...row('c8', { body: 'Hi', author: 'Notis' }), agent: { name: 'Notis' } });
  assert.deepEqual(notis.agent, { name: 'Notis', threadId: null, rowId: null });
});

test('agentDisplayName reads a band name with spaces and capitals, and leaves any other name as it is', () => {
  assert.equal(ui.agentDisplayName('fred-and-the-machine'), 'Fred And The Machine');
  assert.equal(ui.agentDisplayName('the-4-tops'), 'The 4 Tops');
  assert.equal(ui.agentDisplayName('Fred And The Machine'), 'Fred And The Machine', 'idempotent: the server may send it read out');
  for (const name of ['Flo', 'Notis', 'claude', 'Jean-Pierre', 'a--b', '-lead', 'trail-', 'UPPER-case']) {
    assert.equal(ui.agentDisplayName(name), name, name);
  }
  const read = commentFromRow({ ...row('a1', { body: 'Hi', author: 'fred-and-the-machine' }),
    agent: { name: 'fred-and-the-machine', runtime: { provider: 'kimi', label: '', model: null, intelligence: 'low', speed: 'flex' } } });
  assert.deepEqual(read.agent!.runtime, { provider: 'kimi', label: null, model: null, intelligence: 'low', effort: null, speed: 'flex' });
  const none = commentFromRow({ ...row('a2', { body: 'Hi' }), agent: { name: 'x-y', runtime: { provider: '' } } });
  assert.equal('runtime' in none.agent!, false, 'an empty runtime reads as none');
});

test('New comment: a To chip names the best match, @ or the chip picks another, and the first save links it', async () => {
  const calls: Call[] = [];
  const linked: Array<Record<string, unknown>> = [];
  let pick: Record<string, unknown> = { threadId: 't-9', title: 'Copy pass' };
  const comments: Partial<SpaceCommentsTransport> = {
    bestMatch: async ({ recordKey }) => ({ threadId: 't-best', title: `Best for ${recordKey}` }),
    pickThread: async () => pick as never,
    link: async input => { linked.push(input as never); return null; },
  };
  const runtime = fakeRuntime(ROWS, calls, { comments });
  await mount(<Harness {...base} />, runtime);
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const chip = () => doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!;
  assert.match(chip().textContent!, /To Best for dk1/);
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, '@');
  await settle();
  assert.equal(field.value, '', 'the @ opens the picker instead of being written');
  assert.match(chip().textContent!, /To Copy pass/);
  pick = { newThread: 'codex' };
  await click(chip());
  assert.match(chip().textContent!, /To a new Codex thread/);
  await type(field, 'Bigger chart');
  await key(field, 'Enter');
  assert.equal(writes(calls, 'insert').length, 1);
  assert.deepEqual(linked, [{ rootId: storeOf(runtime).rows.at(-1)!.id, pick: { newThread: 'codex' } }],
    'the new comment\'s stored id is linked');

  // No pick: the best match.
  linked.length = 0;
  await act(async () => { controller!.placePin('sk1', 0.1, 0.1); });
  await settle();
  const next = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(next, 'Also this');
  await key(next, 'Enter');
  assert.deepEqual(linked.map(item => item.pick), [{ threadId: 't-best', title: 'Best for dk1' }]);

  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  assert.equal(doc.querySelector('[data-part="to-chip"]'), null, 'no best match, no chip');
});

test('Words that @mention only people: the To chip and the reply box say who it is for and that no agent wakes (SPC-1540)', async () => {
  const comments: Partial<SpaceCommentsTransport> = {
    viewer: { name: 'Flo', canEditSpace: true, id: 'user-flo', people: ['Florian Pariset', 'Ed'] },
    bestMatch: async () => ({ threadId: 't-best', title: 'Deck polish' }),
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const chip = () => doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!;
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Hi @florian what do you think? cc @ed');
  assert.equal(chip().textContent, 'To Florian and Ed · wakes no agent');
  assert.equal(chip().tagName, 'SPAN', 'nothing to pick: no agent wakes');
  // An @ of a harness, or of someone who is not one of the Space's people: where it goes today.
  await type(field, '@florian and @claude, propose another');
  assert.match(chip().textContent!, /To Deck polish/);
  await type(field, '@florian and @someone');
  assert.match(chip().textContent!, /To Deck polish/);
  await type(field, 'No mention');
  assert.match(chip().textContent!, /To Deck polish/);

  const reply = () => doc.querySelector('[data-thread="c1"] .nui-comment-compose-box textarea') as HTMLTextAreaElement;
  const note = () => doc.querySelector('[data-thread="c1"] [data-part="for-people"]');
  await type(reply(), '@Ed can you check?');
  assert.equal(note()?.textContent, 'For Ed · wakes no agent');
  await type(reply(), '@ed @codex can you check?');
  assert.equal(note(), null);

  // A Site reader is told no people: the chip never says it.
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: { ...comments, viewer: { name: 'Flo', canEditSpace: false } } }));
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  await type(doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement, '@florian what do you think?');
  assert.match(chip().textContent!, /To Deck polish/);
});

test('Where the host draws the comment boxes, words that @mention only people say under the box that no agent wakes (SPC-1540)', async () => {
  const comments: Partial<SpaceCommentsTransport> = {
    viewer: { name: 'Flo', canEditSpace: true, id: 'user-flo', people: ['Florian Pariset', 'Ed'] },
    bestMatch: async () => ({ threadId: 't-best', title: 'Deck polish' }),
  };
  const stopHost = registerHostComposerHost();
  const boxOf = (kind: 'new' | 'reply') => listHostComposers().find(item => item.props().kind === kind)!;
  try {
    // The pane in the panel's shadow root, as the Portal shows it: the host draws its boxes.
    await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: { ...runPanel, ...comments } }));
    await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
    await settle();
    const newNote = () => runRoot().querySelector('.nui-comment-new-box [data-part="for-people"]');
    assert.equal(newNote(), null, 'nothing before the words name anyone');
    await act(async () => { boxOf('new').props().onText('@florian what do you think?'); });
    await settle();
    assert.equal(newNote()?.textContent, 'For Florian · wakes no agent');
    assert.match(boxOf('new').props().to?.label ?? '', /Deck polish/, 'the host\'s To pill is left alone while typing');
    await act(async () => { boxOf('new').props().onText('@florian @claude what do you think?'); });
    await settle();
    assert.equal(newNote(), null, 'a harness named: it goes where it goes today');
  } finally {
    stopHost();
  }
});

test('The Space home (no scope) groups threads by page; a scoped pane lists them flat', async () => {
  const rows = [
    row('g1', { body: 'On deck one', createdAt: '2026-10-21T09:00:00.000Z' }),
    row('g2', { body: 'On deck two', createdAt: '2026-10-21T12:00:00.000Z', page: 'deck-2' }),
    row('g3', { body: 'Deck one again', createdAt: '2026-10-21T10:00:00.000Z' }),
  ];
  await mount(<Harness pins={false} scopeNames={{ 'deck-2': 'Launch deck' }} />, fakeRuntime(rows, []));
  assert.equal(controller!.wholeSpace, true);
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-group')].map(el => el.textContent), ['Launch deck', 'Page 1']);
  assert.deepEqual(cards(), ['g2', 'g3', 'g1'], 'newest first inside the groups, groups in order of their newest');

  await mount(<Harness pins={false} groupBy={false} order="oldest" />, fakeRuntime(rows, []));
  assert.equal(doc.querySelectorAll('.nui-comment-group').length, 0, 'groupBy false: flat');
  assert.deepEqual(cards(), ['g1', 'g3', 'g2']);

  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.equal(doc.querySelectorAll('.nui-comment-group').length, 0, 'a scoped pane is flat');
});

test('On a record page the Filter widens to the whole Space, grouped by page; a chip says so and puts the page back', async () => {
  const rows = [
    row('p1', { body: 'On this page', createdAt: '2026-10-21T09:00:00.000Z' }),
    row('p2', { body: 'On the launch deck', createdAt: '2026-10-21T12:00:00.000Z', page: 'deck-2' }),
  ];
  const calls: Call[] = [];
  await mount(<Harness pins={false} scope={scope} scopeNames={{ 'deck-2': 'Launch deck', [PAGE]: 'Q4 review' }} />, fakeRuntime(rows, calls));
  assert.equal(controller!.pageFilter, 'page', 'a record page lists its own comments first');
  assert.deepEqual(cards(), ['p1']);
  assert.equal(doc.querySelector('.nui-comment-chips'), null);
  await pickScope('space');
  assert.equal(controller!.pageFilter, 'space');
  assert.equal(controller!.wholeSpace, true);
  assert.deepEqual(cards(), ['p2', 'p1'], 'every page of the Space, newest first');
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-group')].map(el => el.textContent), ['Launch deck', 'Q4 review']);
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-chip')].map(el => [el.getAttribute('data-chip'), el.textContent]),
    [['whole-space', 'This Space']]);
  assert.ok(barButton('more-button')!.hasAttribute('data-active'));
  await click(doc.querySelector('.nui-comment-chip[data-chip="whole-space"]')!);
  assert.equal(controller!.pageFilter, 'page');
  assert.deepEqual(cards(), ['p1']);
  assert.equal(doc.querySelector('.nui-comment-chips'), null, 'the usual filter again');

  // The Space home already lists the whole Space: no page choice there.
  await mount(<Harness pins={false} />, fakeRuntime(rows, []));
  assert.equal(controller!.pageFilter, null);
  assert.deepEqual((await filterEntries()).map(entry => entry[0]), ['open', 'done', 'all']);

  // French words.
  await mount(<Harness pins={false} scope={scope} />, fakeRuntime(rows, [], { locale: 'fr' }), 'fr');
  await openFilterMenu();
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-filter-item[data-scope]')].map(el => el.textContent), ['Cette page', 'Ce Space']);
});

test('A part of a Space\'s comments: only the threads named are listed, counted and walked, each page under a heading with the host\'s slot', async () => {
  const rows = [
    row('g1', { body: 'On deck one', createdAt: '2026-10-21T09:00:00.000Z' }),
    row('g2', { body: 'On deck two', createdAt: '2026-10-21T12:00:00.000Z', page: 'deck-2' }),
    row('g3', { body: 'Deck one again', createdAt: '2026-10-21T10:00:00.000Z', needs: 'check', author: 'Claude' }),
    row('g4', { body: 'Done on deck one', status: 'Resolved', createdAt: '2026-10-21T08:00:00.000Z' }),
    row('g5', { body: 'Done, of another conversation', status: 'Resolved', createdAt: '2026-10-21T07:00:00.000Z' }),
  ];
  // A host that lists one conversation's comments names their first comments (`only`).
  await mount(<Harness pins={false} only={['g1', 'g4']} groupHeadings="always" scopeNames={{ [PAGE]: 'Q4 review' }} />, fakeRuntime(rows, []));
  assert.deepEqual(cards(), ['g1'], 'the other threads of the Space are not listed');
  assert.deepEqual(controller!.threads.map(thread => thread.root.recordKey).sort(), ['g1', 'g4']);
  assert.deepEqual({ ...controller!.counts }, { open: 1, done: 1, all: 2 }, 'nor counted');
  assert.equal(controller!.waitingCount, 0, 'the question of another thread does not wait here');
  // One page only, and still its heading: the host says which page each card is on, and adds its own action after it.
  const heading = doc.querySelector('.nui-comment-group')!;
  assert.equal(heading.querySelector('.nui-comment-group-name')!.textContent, 'Q4 review');
  assert.equal(heading.querySelector('slot')!.getAttribute('name'), commentGroupSlot(`page:${PAGE}`));
  assert.equal(commentGroupSlot('space'), 'group:space');
  await act(async () => { controller!.setStatusFilter('done'); });
  assert.deepEqual(cards(), ['g4'], 'Done lists the named thread only');
  // An empty list names nothing; with no `only` every thread is back, and one page alone has no heading.
  await mount(<Harness pins={false} only={[]} groupHeadings="always" />, fakeRuntime(rows, []));
  assert.deepEqual(cards(), []);
  await mount(<Harness pins={false} />, fakeRuntime(rows.filter(item => item.page_key === PAGE), []));
  assert.deepEqual(cards(), ['g3', 'g1']);
  assert.equal(doc.querySelectorAll('.nui-comment-group').length, 0, 'the usual pane: no heading over a single page');
});

test('Show on page: a card drawn away from its page offers it when the host can open the page, and passes the thread', async () => {
  const shown: string[] = [];
  const rows = [row('g1', { body: 'On deck one' })];
  await mount(<Harness pins={false} />, fakeRuntime(rows, [], { comments: { showOnPage: ({ rootId }) => { shown.push(rootId); } } }));
  await threadAction('g1', 'show-on-page');
  assert.deepEqual(shown, ['g1']);
  assert.equal(doc.querySelector('[role="menu"]'), null, 'the menu closed');
  // Beside the page itself the host gives no such call: a tap on the card already shows its place.
  await mount(<Harness pins={false} />, fakeRuntime(rows, []));
  assert.ok(!(await threadActions('g1')).includes('show-on-page'));
  // In French.
  await mount(<Harness pins={false} />, fakeRuntime(rows, [], { locale: 'fr', comments: { showOnPage: () => {} } }), 'fr');
  assert.equal((await threadMenu('g1'))['show-on-page']!.textContent, 'Voir sur la page');
  await closeMenu();
});

test('A link to one comment: the comment view param opens its thread and widens to every item', async () => {
  const picked: string[] = [];
  await mount(<Harness {...base} onSelectThread={thread => picked.push(thread.root.recordKey)} />,
    fakeRuntime(ROWS, [], { params: { comment: 'c3' } }));
  assert.deepEqual(picked, ['c3']);
  assert.equal(controller!.threadKey, 'c3');
  assert.equal(controller!.filter, 'all', 'c3 sits on another slide');
  assert.equal(doc.querySelector('[data-thread="c3"]')!.getAttribute('aria-current'), 'true');
  await mount(<Harness {...base} focusKey={null} />, fakeRuntime(ROWS, [], { params: { comment: 'c3' } }));
  assert.equal(controller!.threadKey, null, 'focusKey null turns the link off');
  // D4: without the host's comments (unified comments off) a Space's own `comment` param is its own: nothing opens.
  await mount(<Harness {...base} />, { ...fakeRuntime(ROWS, [], { params: { comment: 'c3' } }), spaceComments: undefined } as NotisRuntime);
  assert.equal(controller!.threadKey, null, 'no host, no link to one comment');
});

test('A link the host took away is forgotten: the same link again opens its thread again (Codex5)', async () => {
  const linked = withHostPanel(fakeRuntime(ROWS, [], { params: { comment: 'c3' } }));
  const withParams = (params: Record<string, string>) => ({ ...linked, context: { ...linked.context, params } }) as NotisRuntime;
  await mount(<Harness {...base} />, linked);
  assert.equal(controller!.threadKey, 'c3');
  await click(doc.querySelector('[data-thread="c2"]')!);
  assert.equal(controller!.threadKey, 'c2', 'the reader moved on');
  await rerender(<Harness {...base} />, withParams({}));
  assert.equal(controller!.threadKey, 'c2', 'the link going away moves nothing');
  await rerender(<Harness {...base} />, withParams({ comment: 'c3' }));
  assert.equal(controller!.threadKey, 'c3', 'the same link again opens it again');
});

test('Archiving the linked thread: the host clearing the link keeps the page, the list and the Undo (QA5)', async () => {
  const calls: Call[] = [];
  const linked = withHostPanel(fakeRuntime(ROWS, calls, { params: { comment: 'c1' } }));
  await mount(<Harness {...base} />, linked);
  assert.equal(controller!.threadKey, 'c1');
  const pane = doc.querySelector('.nui-comment-pane');
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  assert.deepEqual(calls.at(-1), { op: 'archive', input: { root_id: 'c1' } });
  assert.deepEqual(cards(), ['c2']);
  assert.ok(toastUndo(), 'an Undo toast is offered');
  // The Portal takes `comment` out of the address in place: the same page, its runtime with new params.
  await rerender(<Harness {...base} />, { ...linked, context: { ...linked.context, params: {} } } as NotisRuntime);
  assert.equal(doc.querySelector('.nui-comment-pane'), pane, 'the pane is the same, never drawn again from scratch');
  assert.deepEqual(cards(), ['c2'], 'the archived thread stays out of the list');
  assert.ok(toastUndo(), 'the Undo toast is still there');
  await click(toastUndo()!);
  assert.deepEqual(calls.at(-1), { op: 'unarchive', input: { root_id: 'c1' } }, 'and its Undo still works');
  assert.deepEqual(cards(), ['c2', 'c1']);
});

test('At 390 px the New comment menu opens right under its button inside the panel, in a panel that slides in', async () => {
  // The phone chat panel: full width, under the 63 px top bar, moved by Tailwind's `translate-x-0 scale-100` (the
  // individual translate and scale properties), which makes it the containing block of fixed menus. The pane draws in
  // the host panel's shadow root inside it, as in the Portal.
  const PANEL = { left: 0, top: 63, width: 390, height: 781 };
  const BUTTON = { left: 146, top: 141, width: 121, height: 26 };
  const MENU = { width: 190, height: 104 };
  const proto = dom.window.HTMLElement.prototype;
  const sizes = {
    width: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
    height: Object.getOwnPropertyDescriptor(proto, 'offsetHeight'),
    view: [Object.getOwnPropertyDescriptor(dom.window, 'innerWidth'), Object.getOwnPropertyDescriptor(dom.window, 'innerHeight')] as const,
  };
  Object.defineProperty(proto, 'offsetWidth', { configurable: true,
    get(this: HTMLElement) { return this.getAttribute('role') === 'menu' ? MENU.width : 0; } });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true,
    get(this: HTMLElement) { return this.getAttribute('role') === 'menu' ? MENU.height : 0; } });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 844 });
  try {
    const comments: Partial<SpaceCommentsTransport> = {
      attach(source) {
        const slide = doc.getElementById('slide') ?? doc.body.appendChild(Object.assign(doc.createElement('div'), { id: 'slide' }));
        slide.style.setProperty('translate', '0px');
        slide.style.setProperty('scale', '1');
        slide.getBoundingClientRect = () => box(PANEL.top, PANEL.height, PANEL.left, PANEL.width)();
        const shadow = slide.shadowRoot ?? slide.attachShadow({ mode: 'open' });
        const app = shadow.querySelector('[data-notis-app-root]') ?? shadow.appendChild(Object.assign(doc.createElement('div'),
          { className: 'host-panel' }));
        app.setAttribute('data-notis-app-root', '');
        source.show(app as HTMLElement);
        return () => source.show(null);
      },
    };
    await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
    const slide = doc.getElementById('slide')!;
    const trigger = slide.shadowRoot!.querySelector('[data-part="new-comment-button"]') as HTMLElement;
    assert.ok(trigger, 'the pane draws in the panel');
    trigger.getBoundingClientRect = () => box(BUTTON.top, BUTTON.height, BUTTON.left, BUTTON.width)();
    await click(trigger);
    const menu = slide.shadowRoot!.querySelector('[role="menu"]') as HTMLElement;
    assert.ok(menu, 'the menu opens inside the panel');
    // Fixed inside the panel: its screen box is the panel's corner plus its style.
    const top = PANEL.top + parseFloat(menu.style.top);
    const left = PANEL.left + parseFloat(menu.style.left);
    assert.equal(top, BUTTON.top + BUTTON.height + 4, 'right under its button, not 63 px lower');
    assert.equal(left + MENU.width, BUTTON.left + BUTTON.width, 'its right edge lines up with the button');
    assert.ok(left >= PANEL.left + 8 && left + MENU.width <= PANEL.left + PANEL.width - 8, 'inside the panel');
  } finally {
    for (const [name, descriptor] of [['offsetWidth', sizes.width], ['offsetHeight', sizes.height]] as const) {
      if (descriptor) Object.defineProperty(proto, name, descriptor); else delete (proto as unknown as Record<string, unknown>)[name];
    }
    const [width, height] = sizes.view;
    if (width) Object.defineProperty(dom.window, 'innerWidth', width);
    if (height) Object.defineProperty(dom.window, 'innerHeight', height);
    doc.getElementById('slide')?.remove();
  }
});

test('Comment modes: the New comment menu lists the modes, the tool bar toggles with C and Escape cancels', async () => {
  const calls: Call[] = [];
  let itemsAsked = 0;
  function ModesHarness() {
    controller = useComments({ ...base, onStartItems: () => { itemsAsked += 1; }, currentTime: () => 84.5 });
    return (
      <div>
        <ui.CommentToolBar controller={controller} />
        <CommentPane controller={controller} />
      </div>
    );
  }
  await mount(<ModesHarness />, fakeRuntime(ROWS, calls));
  assert.deepEqual(controller!.modes, ['point', 'box', 'items', 'time', 'page'], 'a box needs no column any more');
  await click(barButton('new-comment-button')!);
  assert.deepEqual([...doc.querySelectorAll('[role^="menuitem"]')].map(el => el.textContent),
    ['Comment on all of Item 1', 'On a point', 'On a box', 'On items', 'At this moment', 'On the whole page'],
    'the whole item first, then the modes');
  await key(doc.activeElement ?? doc.body, 'Escape');

  assert.equal(doc.querySelector('.nui-comment-toolbar'), null);
  await key(doc.body, 'c');
  const bar = doc.querySelector('.nui-comment-toolbar')!;
  assert.ok(bar, 'C shows the tool bar');
  assert.match(bar.textContent!, /Point at something to comment/);
  await click(bar.querySelector('[data-mode="point"]')!);
  assert.equal(controller!.commentMode, 'point');
  assert.equal(controller!.commenting, true);
  await key(doc.body, 'Escape');
  assert.equal(controller!.commentMode, null, 'Escape cancels the mode');
  assert.ok(doc.querySelector('.nui-comment-toolbar'), 'the bar stays until a second Escape');

  await click(doc.querySelector('.nui-comment-toolbar [data-mode="items"]')!);
  assert.equal(itemsAsked, 1);
  assert.match(doc.querySelector('.nui-comment-toolbar')!.textContent!, /Pick the items to comment on/);
  await act(async () => { controller!.startItems([ANCHORS[0]!, ANCHORS[1]!]); });
  await settle();
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment on 2 items');
  let field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Same fix on both');
  await key(field, 'Enter');
  assert.equal(calls.at(-1)!.op, 'insert');
  assert.equal(calls.at(-1)!.input.mode, 'items');
  assert.deepEqual(calls.at(-1)!.input.anchor_keys, ['sk1', 'sk2'], 'the items by record key');
  assert.equal(calls.at(-1)!.input.page_key, PAGE);

  await click(doc.querySelector('.nui-comment-toolbar [data-mode="time"]')!);
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment at 1:24');
  field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Cut here');
  await key(field, 'Enter');
  assert.equal(calls.at(-1)!.input.mode, 'time');
  assert.equal(calls.at(-1)!.input.time_start, 84.5);

  await click(doc.querySelector('.nui-comment-toolbar [data-mode="page"]')!);
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment on the whole page');
  field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Overall too long');
  await key(field, 'Enter');
  assert.equal(calls.at(-1)!.input.mode, 'page');
  assert.deepEqual(calls.at(-1)!.input.anchor_keys, [], 'no anchor');
  assert.equal(controller!.filter, 'all', 'a whole-page comment shows under All');

  await key(doc.body, 'c');
  assert.equal(doc.querySelector('.nui-comment-toolbar'), null, 'C hides it again');
});

test('A new comment changes the list filters only when they would hide it', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  // Already on every item and every status: a whole-page comment shows there, nothing changes.
  await act(async () => { controller!.setFilter('all'); controller!.setStatusFilter('all'); });
  await act(async () => { controller!.startMode('page'); });
  assert.equal(controller!.filter, 'all');
  assert.equal(controller!.statusFilter, 'all', 'All shows an open comment too');
  await act(async () => { controller!.cancelPin(); });
  // On this item, a comment on this item keeps "This item".
  await act(async () => { controller!.setFilter('anchor'); controller!.setStatusFilter('done'); });
  await act(async () => { controller!.placePin('sk1', 0.5, 0.5); });
  assert.equal(controller!.filter, 'anchor', 'a comment on the item shown keeps This item');
  assert.equal(controller!.statusFilter, 'open', 'Done would hide the new open comment');
  await act(async () => { controller!.cancelPin(); });
  // A whole-page comment has no item: "This item" would hide it, so the list widens.
  await act(async () => { controller!.startMode('page'); });
  assert.equal(controller!.filter, 'all');
});

test('An items comment shows right after sending, under each of its items, and names them (SPC-463)', async () => {
  const calls: Call[] = [];
  const tasks: CommentAnchor[] = [
    { id: 't1', recordKey: 'tk1', order: 1, title: 'Write the brief' },
    { id: 't2', recordKey: 'tk2', order: 2, title: 'Book the room' },
    { id: 't3', recordKey: 'tk3', order: 3, title: '' },
    { id: 't4', recordKey: 'tk4', order: 4, title: 'Send the invites to every speaker and their assistants' },
    { id: 't5', recordKey: 'tk5', order: 5, title: 'Print' },
  ];
  const words = { anchorLabel: { en: 'Task {n}', fr: 'Tâche {n}' } };
  const options: UseCommentsOptions = { scope, anchors: tasks, anchorKey: 'tk3', words, onStartItems: () => {} };
  await mount(<Harness {...options} />, fakeRuntime([], calls));
  assert.equal(controller!.filter, 'anchor');
  // Picked items that include the task shown keep This item; the draft names them, titles first, else the label.
  await act(async () => { controller!.startItems([tasks[1]!, tasks[2]!, tasks[0]!]); });
  await settle();
  assert.equal(controller!.filter, 'anchor', 'the task shown is one of the items: This item lists the comment');
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment on 3 items', 'SPC-338 heading kept');
  assert.equal(doc.querySelector('.nui-comment-new-box [data-pill="place"]')!.textContent, 'Book the room, Task 3, Write the brief');
  let field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Same owner for these');
  await key(field, 'Enter');
  assert.deepEqual(calls.at(-1)!.input.anchor_keys, ['tk2', 'tk3', 'tk1']);
  const sent = String(doc.querySelector('.nui-comment-card')!.getAttribute('data-thread'));
  assert.deepEqual(cards(), [sent], 'the new thread shows under This item at once');
  const meta = doc.querySelector(`[data-thread="${sent}"] [data-part="place"]`)!.textContent!;
  assert.match(meta, /Write the brief, Book the room, Task 3/, 'the card says where it sits first: its items, in item order');
  assert.doesNotMatch(meta, /3 items/);
  for (const key of ['tk1', 'tk2', 'tk3']) {
    assert.equal(controller!.threadsOn(key).length, 1, `listed under ${key}`);
  }
  assert.equal(controller!.threadsOn('tk4').length, 0);
  assert.equal(controller!.threadsOn(null).length, 0, 'not a comment on no item');

  // Items that leave out the task shown: This item would hide the comment, so the list widens to every item.
  await act(async () => { controller!.startItems([tasks[0]!, tasks[1]!, tasks[3]!, tasks[4]!]); });
  await settle();
  assert.equal(controller!.filter, 'all', 'the task shown is not one of the items');
  assert.equal(doc.querySelector('.nui-comment-new-box [data-pill="place"]')!.textContent,
    'Write the brief, Book the room, Send the invites to every speak… +1', 'three names, long ones cut, then +N');
  field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Later');
  await key(field, 'Enter');
  assert.equal(cards().length, 2, 'both threads show under All items');
});

test('Anchor words use the Space\'s own anchor label, in English and French; an old {n} override still reads (SPC-462)', async () => {
  const words = { anchorLabel: { en: 'Slide {n}', fr: 'Diapo {n}' } };
  await mount(<Harness {...base} words={words} />, fakeRuntime(ROWS, []));
  await click(barButton('new-comment-button')!);
  assert.equal(doc.querySelector('[role^="menuitem"]')!.textContent, 'Comment on all of Slide 1', 'the whole-item entry leads the New comment menu and names the slide');
  await key(doc.activeElement ?? doc.body, 'Escape');
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment on Slide 1');
  await act(async () => { controller!.cancelPin(); });
  await pickNewComment('Comment on all of Slide 1');
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment on all of Slide 1');

  await mount(<Harness {...base} words={words} />, fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  await pickNewComment('Commenter Diapo 1 en entier');
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'Nouveau commentaire sur Diapo 1 en entier');

  const old = { ...words, newCommentOn: { en: 'New note on slide {n}', fr: 'Nouvelle note sur la diapo {n}' } };
  await mount(<Harness {...base} words={old} />, fakeRuntime(ROWS, []));
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New note on slide 1', 'an override with {n} keeps working');
});

test('Add comment mode: Escape leaves it; a pin opens the new comment box, Escape drops it, Enter sends', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} />, runtime);
  await act(async () => { controller!.setCommenting(true); });
  assert.equal(controller!.commenting, true);
  await key(doc.body, 'Escape');
  assert.equal(controller!.commenting, false);

  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  assert.ok(field);
  assert.equal(doc.activeElement, field, 'the new comment box takes focus');
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment on Item 1');
  assert.ok(doc.querySelector('.nui-comment-pin[data-draft]'));
  await key(field, 'Escape');
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'Escape in an empty box drops it');

  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const next = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(next, 'Make it bigger');
  await key(next, 'Enter');
  const [insert] = writes(calls, 'insert');
  assert.equal(insert!.input.mode, 'point');
  assert.deepEqual(insert!.input.anchor_keys, ['sk1']);
  assert.equal(insert!.input.x, 0.4);
  assert.equal(insert!.input.y, 0.3);
  assert.equal(insert!.input.page_key, PAGE);
  assert.equal(insert!.input.body, 'Make it bigger');
  assert.equal(doc.querySelector('.nui-comment-new-box'), null);
  const stored = storeOf(runtime).rows.at(-1)!;
  assert.equal(stored.thread_root_id, null, 'a first comment');
  assert.equal(controller!.threadKey, stored.id, 'the new thread is selected');
});

test('Thread cards select with Enter, and a pin selects its thread', async () => {
  const picked: string[] = [];
  await mount(<Harness {...base} onSelectThread={thread => picked.push(thread.root.recordKey)} />, fakeRuntime(ROWS, []));
  const card = doc.querySelector('[data-thread="c2"]') as HTMLElement;
  assert.equal(card.tabIndex, 0);
  card.focus();
  await key(card, 'Enter');
  assert.equal(card.getAttribute('aria-current'), 'true');
  await click(doc.querySelectorAll('.nui-comment-pin')[0]!);
  assert.equal(doc.querySelector('[data-thread="c1"]')!.getAttribute('aria-current'), 'true');
  assert.deepEqual(picked, ['c2', 'c1']);
});

test('A thread picked in the pane brings its pin into view when the page is away from it, a pressed pin stays put', async () => {
  const proto = dom.window.HTMLElement.prototype as HTMLElement & { scrollIntoView?: (arg?: unknown) => void };
  const original = proto.scrollIntoView;
  const rect = proto.getBoundingClientRect;
  const scrolled: string[] = [];
  proto.scrollIntoView = function (this: HTMLElement) { scrolled.push(this.textContent ?? ''); };
  // Every pin sits below the window.
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains('nui-comment-pin')
      ? { top: 2000, bottom: 2020, left: 0, right: 20, width: 20, height: 20, x: 0, y: 2000, toJSON() {} } as DOMRect
      : rect.call(this);
  };
  try {
    await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
    const card = doc.querySelector('[data-thread="c2"]') as HTMLElement;
    card.focus();
    await key(card, 'Enter');
    assert.deepEqual(scrolled, ['4'], 'the picked card\'s pin is scrolled to');
    await click(doc.querySelectorAll('.nui-comment-pin')[0]!);
    assert.deepEqual(scrolled, ['4'], 'a pressed pin is already in view: the page does not move');
  } finally {
    proto.scrollIntoView = original;
    proto.getBoundingClientRect = rect;
  }
});

test('Copy changes: copies the digest, records the checkpoint and empties the count', async () => {
  const written: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async (text: string) => { written.push(text); } },
  });
  const checkpoints: string[] = [];
  await mount(<Harness {...base} onCheckpoint={async at => { checkpoints.push(at); }} />, fakeRuntime(ROWS, []));
  // Copy changes sits behind the header row's "..." menu, with the number of changes it would copy.
  const copyItem = async () => {
    await click(barButton('more-button')!);
    return doc.querySelector('[data-part="copy-changes"]')!.closest('[role^="menuitem"]') as HTMLButtonElement;
  };
  let copy = await copyItem();
  assert.match(copy.textContent!, /Copy changes since last turn/);
  assert.equal(copy.querySelector('.nui-comment-count')!.textContent, '1');
  await click(copy);
  assert.equal(written.length, 1);
  assert.match(written[0]!, /^# Slide comments: Q4 review/);
  assert.equal(checkpoints.length, 1);
  assert.match(doc.body.textContent!, /Copied 1 change/);
  copy = await copyItem();
  assert.equal(copy.querySelector('.nui-comment-count'), null, 'nothing left to copy: no number');
  assert.ok(copy.disabled || copy.getAttribute('aria-disabled') === 'true');
});

test('Copy link: a card copies the link that reveals its thread, from the host or the page address, with a toast', async () => {
  const written: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async (text: string) => { written.push(text); } },
  });
  const asked: string[] = [];
  const comments: Partial<SpaceCommentsTransport> = {
    commentLink: ({ rootId: rootKey }) => { asked.push(rootKey); return `https://app.notis.ai/spaces/s1?page=dk1&comment=${rootKey}`; },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  const copy = () => threadAction('c1', 'copy-link');
  assert.equal((await threadMenu('c1'))['copy-link']!.textContent, 'Copy link', 'every card has Copy link, behind its "..."');
  await closeMenu();
  await copy();
  assert.deepEqual(asked, ['c1']);
  assert.deepEqual(written, ['https://app.notis.ai/spaces/s1?page=dk1&comment=c1']);
  assert.match(doc.querySelector('.nui-toast')!.textContent!, /Link copied/);

  // Without a host address: the page's own address with comment=<root key> in place of an earlier one.
  dom.window.history.replaceState(null, '', '/page?page=dk1&comment=old#top');
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  await copy();
  assert.equal(written.at(-1), 'http://localhost/page?page=dk1&comment=c1');
  dom.window.history.replaceState(null, '', '/page');

  // A refused clipboard says so; French words.
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
  });
  const execCommand = doc.execCommand;
  doc.execCommand = () => false;
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  assert.equal((await threadMenu('c1'))['copy-link']!.textContent, 'Copier le lien');
  await closeMenu();
  await copy();
  assert.match(doc.querySelector('.nui-toast')!.textContent!, /Le lien n’a pas pu être copié/);
  doc.execCommand = execCommand;
  assert.equal(ui.commentWords().linkCopied.fr, 'Lien copié');
});

test('Copy link: a link the host works out later (the thread on its own page) is copied once known (D3)', async () => {
  const written: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async (text: string) => { written.push(text); } },
  });
  const asked: Array<{ rootId: string }> = [];
  let page: string | null = 'https://app.notis.ai/view-s1?page=dk1&comment=c1';
  const comments: Partial<SpaceCommentsTransport> = {
    commentLink: input => { asked.push(input); return Promise.resolve(page); },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  const copy = () => threadAction('c1', 'copy-link');
  await copy();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  // The host finds the thread's page from the comment itself.
  assert.deepEqual(asked, [{ rootId: 'c1' }]);
  assert.deepEqual(written, ['https://app.notis.ai/view-s1?page=dk1&comment=c1']);
  assert.match(doc.querySelector('.nui-toast')!.textContent!, /Link copied/);

  // Where the clipboard takes a ClipboardItem, the pending link goes in it at once (the click's permission holds).
  const items: Array<Promise<Blob>> = [];
  class Item { constructor(public parts: Record<string, Promise<Blob>>) { items.push(parts['text/plain']!); } }
  const previous = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
  (globalThis as { ClipboardItem?: unknown }).ClipboardItem = Item;
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: { write: async (list: Item[]) => { await list[0]!.parts['text/plain']; } },
  });
  try {
    assert.equal(await ui.writeCommentClipboard(Promise.resolve('https://app.notis.ai/l'), null), true);
    assert.equal(await (await items[0]!).text(), 'https://app.notis.ai/l');
    // No link from the host: nothing is copied and the toast says so.
    page = null;
    await copy();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.match(doc.querySelector('.nui-toast')!.textContent!, /could not be copied/i);
  } finally {
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = previous;
  }
});

test('French words through the SDK words mechanism, and a Space wording override', async () => {
  await mount(<Harness {...base} words={{ thisAnchor: { en: 'This slide', fr: 'Cette diapositive' } }} />,
    fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  assert.equal(doc.querySelector('.nui-comment-pane')!.getAttribute('aria-label'), 'Commentaires');
  assert.equal(barButton('waiting-toggle')!.getAttribute('aria-label'), 'En attente de toi, 1 en attente');
  await openFilterMenu();
  assert.match(doc.body.textContent!, /Cette diapositive/, 'the Space names its own scope in the filter');
  await key(doc.activeElement ?? doc.body, 'Escape');
  assert.ok(doc.querySelector('button[aria-label^="Archiver le fil de commentaires"]'));
  assert.ok(doc.querySelector('textarea[aria-label="Répondre"]'));
});

// ---------------------------------------------------------------------------
// Zones and comments on the whole item
// ---------------------------------------------------------------------------

async function pointer(el: Element, type: string, x: number, y: number) {
  const Ctor = (dom.window as unknown as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? dom.window.MouseEvent;
  await act(async () => {
    const event = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    el.dispatchEvent(event);
  });
}

/** Press at (x0, y0) on the 200 by 100 capture layer, move to (x1, y1) and release. */
async function drag(x0: number, y0: number, x1: number, y1: number) {
  const layer = doc.querySelector('.nui-comment-capture') as HTMLElement;
  assert.ok(layer, 'Add comment mode covers the anchor');
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0,
    toJSON: () => ({}) }) as DOMRect;
  layer.setPointerCapture = () => {};
  await pointer(layer, 'pointerdown', x0, y0);
  await pointer(layer, 'pointermove', x1, y1);
  await pointer(layer, 'pointerup', x1, y1);
  await settle();
}

test('Zones: a press and drag marks a zone in the selection blue, and sends a box', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  assert.equal(doc.querySelector('.nui-comment-capture'), null, 'nothing covers the anchor outside Add comment mode');
  await act(async () => { controller!.setCommenting(true); });
  await settle();
  assert.match(doc.querySelector('.nui-comment-hint')!.textContent!, /hold and drag to mark a zone/);
  await drag(150, 80, 50, 30);
  const draft = doc.querySelector('.nui-comment-zone[data-draft]') as HTMLElement;
  assert.ok(draft, 'the zone shows while the comment is written');
  assert.equal(draft.style.left, '25%');
  assert.equal(draft.style.top, '30%');
  assert.equal(draft.style.width, '50%');
  assert.equal(draft.style.height, '50%');
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'This whole block');
  await key(field, 'Enter');
  const [insert] = writes(calls, 'insert');
  assert.equal(insert!.input.mode, 'box');
  assert.deepEqual([insert!.input.x, insert!.input.y, insert!.input.w, insert!.input.h], [0.25, 0.3, 0.5, 0.5]);
});

test('Zones: a click or a tiny move drops a pin', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  await act(async () => { controller!.setCommenting(true); });
  await settle();
  await drag(100, 50, 102, 51);
  assert.deepEqual(controller!.draftPin, { anchorKey: 'sk1', x: 0.5, y: 0.5, w: null, h: null });
  assert.equal(doc.querySelector('.nui-comment-zone[data-draft]'), null);
});

test('Zones: a saved zone draws its rectangle beside its numbered pin', async () => {
  const rows = [row('z1', { body: 'This block', slide: 'slide-1', x: 0.1, y: 0.2, w: 0.3, h: 0.25 })];
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  const zone = doc.querySelector('.nui-comment-zone:not([data-draft])') as HTMLElement;
  assert.equal(zone.style.width, '30%');
  assert.equal(doc.querySelector('.nui-comment-pin')!.getAttribute('aria-label'), 'Flo, on a zone: This block');
});

test('Comment on the whole item: no pin, its own heading, and no X or Y', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  await pickNewComment('Comment on all of Item 1');
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment on all of Item 1');
  assert.equal(doc.querySelector('.nui-comment-pin[data-draft]'), null);
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Too many words on this slide');
  await key(field, 'Enter');
  const [insert] = writes(calls, 'insert');
  assert.equal(insert!.input.mode, 'page');
  assert.equal(insert!.input.x ?? null, null);
  assert.equal(insert!.input.y ?? null, null);
  assert.deepEqual(insert!.input.anchor_keys, ['sk1'], 'on the whole slide');
});

test('Comments on a whole record (no anchors): the pane starts one itself', async () => {
  const calls: Call[] = [];
  const project = { id: 'project-1', recordKey: 'pk1', name: 'Launch', checkpoint: null };
  await mount(<Harness scope={project} pins={false} />, fakeRuntime([], calls));
  await click(button('New comment')!);
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment');
  assert.equal(doc.querySelectorAll('.nui-comment-new-box').length, 1, 'the header button opens one new comment box');
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Cut the first hello');
  await key(field, 'Enter');
  const [insert] = writes(calls, 'insert');
  assert.equal(insert!.input.body, 'Cut the first hello');
  assert.equal(insert!.input.page_key, 'pk1', 'on the record\'s page');
  assert.equal(insert!.input.mode, 'page');
  assert.deepEqual(insert!.input.anchor_keys, []);
});

// The server signs every comment with the signed-in viewer: the pane sends no author, and shows the viewer's name on
// the comment while it is saved.
async function sendWholeComment(body: string) {
  await act(async () => { controller!.placePin(null, null, null); });
  await act(async () => { await controller!.sendNew(body); });
}

test('The server signs: no author is sent, the panel\'s viewer shows, never the context name', async () => {
  const calls: Call[] = [];
  const project = { id: 'project-1', recordKey: 'pk1', name: 'Launch', checkpoint: null };
  const runtime = fakeRuntime([], calls, { viewerName: 'Marie', comments: { viewer: { name: 'Ana', canEditSpace: true, id: 'u-ana' } } });
  await mount(<Harness scope={project} pins={false} />, runtime);
  assert.equal(controller!.me, 'Ana');
  await sendWholeComment('Hi');
  const [insert] = writes(calls, 'insert');
  assert.equal(insert!.input.body, 'Hi');
  assert.equal('author' in insert!.input, false, 'the pane names no author');
  assert.deepEqual(Object.keys(insert!.input).filter(name => /author|name/i.test(name)), []);
});

test('No viewer known yet: nothing is sent under any name', async () => {
  const calls: Call[] = [];
  const project = { id: 'project-1', recordKey: 'pk1', name: 'Launch', checkpoint: null };
  await mount(<Harness scope={project} pins={false} />, fakeRuntime([], calls, { viewerName: null }));
  await sendWholeComment('Hello');
  assert.deepEqual(calls, []);
});

test('A failed send is not retried under another name, and keeps nothing half saved', async () => {
  const calls: Call[] = [];
  const project = { id: 'project-1', recordKey: 'pk1', name: 'Launch', checkpoint: null };
  const runtime = fakeRuntime([], calls, { fail: true });
  await mount(<Harness scope={project} pins={false} />, runtime);
  await sendWholeComment('Hi');
  assert.equal(writes(calls, 'insert').length, 1);
  assert.deepEqual(storeOf(runtime).rows, []);
  assert.deepEqual(cards(), [], 'the draft card leaves once the send failed');
});

// ---------------------------------------------------------------------------
// Pictures, files and links shown with a comment
// ---------------------------------------------------------------------------

const BEFORE = 'https://files.example/native-record-files/v1/a/file.png';
const AFTER = 'https://files.example/native-record-files/v1/b/file.png';

test('Attachments: read from the store row, pictures told from files, unsafe links dropped', () => {
  const comment = commentFromRow(row('a1', { body: 'Keep it?', files: [
    { name: 'Before.png', url: BEFORE, type: 'image/png' },
    { name: 'After.png', url: AFTER },
    { name: 'Notes.pdf', url: 'https://files.example/notes.pdf', type: 'application/pdf' },
    { name: 'Bad', url: 'javascript:alert(1)' },
    { name: 'Also bad', url: '//evil.example/x.png' },
  ] }));
  assert.deepEqual(comment.attachments.map(item => [item.label, item.image]),
    [['Before', true], ['After', true], ['Notes', false]]);
  assert.equal(comment.attachments[1]!.url, AFTER);
  assert.deepEqual(commentFromRow(row('a2', { body: 'x' })).attachments, [], 'no files, none shown');
  assert.equal(commentAttachmentFor(' before ', comment.attachments)?.url, BEFORE, 'an option names its picture, any case');
  assert.equal(commentAttachmentFor('Notes', comment.attachments), undefined, 'only pictures answer an option');
  const inline = commentFromRow(row('a4', { body: 'x', files: [{ name: 'Chart', url: 'data:image/svg+xml;utf8,%3Csvg%2F%3E' },
    { name: 'Page', url: 'data:text/html,<script>1</script>' }] })).attachments;
  assert.deepEqual(inline.map(item => [item.label, item.image]), [['Chart', true]], 'an inline picture shows, other data does not');
});

test('commentBodyParts: links keep their brackets and lose the sentence punctuation', () => {
  const parts = commentBodyParts('See https://beta.notis.ai/notes/n-1/review?tab=list . Or (https://x.example/a_(b)), done.');
  assert.deepEqual(parts, [
    { text: 'See ' },
    { href: 'https://beta.notis.ai/notes/n-1/review?tab=list', label: 'beta.notis.ai/notes/n-1/review' },
    { text: ' . Or (' },
    { href: 'https://x.example/a_(b)', label: 'x.example/a_(b)' },
    { text: '), done.' },
  ]);
  const long = commentBodyParts('https://beta.notis.ai/notes/notes-bcbc4e63520d5c76b2868945a86f782b/beta-stabilization')[0] as { label: string };
  assert.equal(long.label.length, 48);
  assert.ok(long.label.endsWith('…'));
  assert.deepEqual(commentBodyParts('no links here'), [{ text: 'no links here' }]);
});

test('CommentPane: links open in a new tab, pictures open larger, files are links', async () => {
  const rows = [
    row('p1', { body: 'Pictures at https://beta.notis.ai/notes/n-1 .', author: 'Claude', slide: 'slide-1',
      files: [{ name: 'Before.png', url: BEFORE }, { name: 'Report.pdf', url: 'https://files.example/report.pdf' }] }),
  ];
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  const link = doc.querySelector('[data-thread="p1"] .nui-comment-link') as HTMLAnchorElement;
  assert.equal(link.getAttribute('href'), 'https://beta.notis.ai/notes/n-1');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.textContent, 'beta.notis.ai/notes/n-1');
  assert.equal(doc.querySelector('.nui-comment-pictures')!.getAttribute('data-count'), '1');
  assert.equal((doc.querySelector('.nui-comment-thumb img') as HTMLImageElement).getAttribute('src'), BEFORE);
  assert.equal(doc.querySelector('.nui-comment-caption')!.textContent, 'Before');
  assert.match(doc.querySelector('[data-thread="p1"] .nui-gallery-row')!.textContent!, /Report/, 'a file shows in the attachment row');
  assert.equal(doc.querySelectorAll('[data-thread="p1"] .nui-comment-figure').length, 1, 'only pictures sit in the grid');
  assert.equal(doc.querySelector('.nui-viewer'), null);
  await click(button('Open Before larger')!);
  const viewer = doc.querySelector('.nui-viewer') as HTMLElement;
  assert.ok(viewer, 'the picture opens in the image viewer');
  assert.equal(viewer.querySelector('img')!.getAttribute('src'), BEFORE);
  assert.equal(controller!.threadKey, null, 'opening a picture does not pick the thread');
  await click(viewer.querySelector('button[aria-label="Close"]')!);
  assert.equal(doc.querySelector('.nui-viewer'), null);
});

test('CommentPane: a choice is answered from under its picture or its larger view', async () => {
  const calls: Call[] = [];
  const rows = [row('p2', { body: 'Which layout?', author: 'Claude', slide: 'slide-1', needs: 'choice', options: 'A | B | Neither',
    files: [{ name: 'A.png', url: BEFORE }, { name: 'B.png', url: AFTER }] })];
  await mount(<Harness {...base} />, fakeRuntime(rows, calls));
  const figures = [...doc.querySelectorAll('.nui-comment-figure')];
  assert.deepEqual(figures.map(figure => figure.querySelector('button.nui-btn')?.textContent), ['A', 'B']);
  assert.deepEqual(optionLabels(), ['Neither'], 'the rows keep only the options no picture names');
  await click(button('Open B larger')!);
  assert.equal(doc.querySelector('.nui-viewer img')!.getAttribute('src'), AFTER);
  await click([...doc.querySelectorAll('.nui-viewer-bar button')].find(el => el.textContent === 'B')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'p2', answer: 'B' } });
  assert.equal(doc.querySelector('.nui-viewer'), null, 'answering closes the viewer');
  const chosen = doc.querySelector('.nui-comment-figure[data-chosen]')!;
  assert.equal(chosen.querySelector('img')!.getAttribute('src'), AFTER);
  assert.equal(doc.querySelectorAll('.nui-comment-figure button.nui-btn').length, 0, 'an answered ask offers no more buttons');
  assert.match(doc.querySelector('[data-thread="p2"] .nui-comment-answer')!.textContent!, /B, sent to the agent/);

  await mount(<Harness {...base} />, fakeRuntime([row('p3', { body: 'Pick', author: 'Claude', slide: 'slide-1', needs: 'choice',
    options: 'A | B', files: [{ name: 'A.png', url: BEFORE }, { name: 'B.png', url: AFTER }] })], calls));
  assert.equal(doc.querySelector('.nui-comment-options'), null, 'no rows when every option has its picture');
  await click([...doc.querySelectorAll('.nui-comment-figure button.nui-btn')].find(el => el.textContent === 'A')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'p3', answer: 'A' } });
});

test('A question with choices reads like a question in a conversation: one row per option, Recommended, a line under an option, Other', async () => {
  const calls: Call[] = [];
  const asked = (fields: Partial<SpaceCommentRow> = {}) => [{ ...row('q1', { body: 'The press kit lands the same week. Which date?', author: 'Claude',
    slide: 'slide-1', needs: 'choice', options: 'Keep the date | Move it | Cancel' }),
  recommended: 'Keep the date', option_details: { 'Keep the date': 'The kit ships a day early.', Elsewhere: 'not an option' }, ...fields }];
  await mount(<Harness {...base} />, fakeRuntime(asked(), calls));
  const card = () => doc.querySelector('[data-thread="q1"]') as HTMLElement;
  const rows = () => [...card().querySelectorAll('.nui-comment-option')];
  assert.deepEqual(rows().map(el => [el.querySelector('.nui-comment-option-key')!.textContent, el.querySelector('.nui-comment-option-label')!.textContent]),
    [['1', 'Keep the date'], ['2', 'Move it'], ['3', 'Cancel'], ['4', 'Other']], 'one row per option, numbered, then Other');
  assert.deepEqual(rows().map(el => el.querySelector('[data-part="recommended"]')?.textContent ?? null), ['Recommended', null, null, null],
    'the asker\'s pick carries the tag');
  assert.deepEqual(rows().map(el => el.querySelector('.nui-comment-option-detail')?.textContent ?? null),
    ['The kit ships a day early.', null, null, 'Write your own answer'], 'a line under an option when the asker gave one');
  assert.equal(card().querySelector('.nui-comment-ask-label'), null, 'no "Claude needs a choice" line: the comment above says who asks');
  // The Enter cap shows on the recommended row once the card is selected.
  const cap = () => card().querySelector('.nui-comment-option[data-recommended] .nui-comment-option-enter')!;
  assert.equal(cap().hasAttribute('data-shown'), false);
  card().focus();
  await settle();
  assert.equal(controller!.threadKey, 'q1');
  assert.ok(cap().hasAttribute('data-shown'));
  assert.equal(card().querySelector('.nui-comment-option[data-recommended]')!.getAttribute('aria-keyshortcuts'), 'Enter');
  // Enter picks the recommended option.
  await key(card(), 'Enter');
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'q1', answer: 'Keep the date' } });
  assert.match(card().querySelector('.nui-comment-answer')!.textContent!, /Keep the date, sent to the agent/);
  assert.equal(card().querySelector('.nui-comment-options'), null, 'an answered question offers no more rows');

  // A number picks by position; the number after the last option is Other, which gives the reply box the caret.
  calls.length = 0;
  await mount(<Harness {...base} />, fakeRuntime(asked(), calls));
  card().focus();
  await settle();
  await key(card(), '4');
  assert.equal(calls.length, 0, 'Other answers nothing');
  assert.equal(doc.activeElement, card().querySelector('.nui-comment-reply-box textarea'), 'it opens the reply box');
  card().focus();
  await key(card(), '5');
  assert.equal(calls.length, 0, 'a number past Other does nothing');
  await key(card(), '2');
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'q1', answer: 'Move it' } });

  // A press on Other opens the reply box too; a row answers on a press.
  calls.length = 0;
  await mount(<Harness {...base} />, fakeRuntime(asked(), calls));
  await click(card().querySelector('.nui-comment-option[data-other]')!);
  assert.equal(doc.activeElement, card().querySelector('.nui-comment-reply-box textarea'));
  await click(option('Cancel')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'q1', answer: 'Cancel' } });

  // No recommended option (or one that is not an option): no tag, and Enter only selects the card.
  calls.length = 0;
  await mount(<Harness {...base} />, fakeRuntime(asked({ recommended: 'Elsewhere', option_details: {} }), calls));
  assert.equal(card().querySelector('[data-part="recommended"]'), null);
  assert.equal(controller!.threads[0]!.root.recommended, null);
  card().focus();
  await key(card(), 'Enter');
  assert.equal(calls.length, 0);
  // A comment written before these fields existed reads as a plain list of rows.
  await mount(<Harness {...base} />, fakeRuntime([row('q1', { body: 'Which?', author: 'Claude', slide: 'slide-1', needs: 'choice', options: 'A | B' })], calls));
  assert.deepEqual(optionLabels(), ['A', 'B']);
  assert.equal(card().querySelector('[data-part="recommended"], .nui-comment-option:not([data-other]) .nui-comment-option-detail'), null);

  // French.
  await mount(<Harness {...base} />, fakeRuntime(asked(), calls, { locale: 'fr' }), 'fr');
  assert.equal(card().querySelector('[data-part="recommended"]')!.textContent, 'Recommandé');
  assert.equal(card().querySelector('.nui-comment-option[data-other] .nui-comment-option-label')!.textContent, 'Autre');
  assert.equal(card().querySelector('.nui-comment-option[data-other] .nui-comment-option-detail')!.textContent, 'Écris ta propre réponse');
});

test('CommentPane: a check offers the labels its author gave, and Looks good or Undo without them', async () => {
  const calls: Call[] = [];
  const rows = [row('k1', { body: 'Keep the spacing fix?', author: 'Codex', slide: 'slide-1', needs: 'check',
    options: 'Approve exact change | Hold' })];
  await mount(<Harness {...base} />, fakeRuntime(rows, calls));
  assert.deepEqual(optionLabels(), ['Approve exact change', 'Hold']);
  await click(option('Hold')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'k1', answer: 'Hold' } });
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.deepEqual(optionLabels(doc.querySelector('[data-thread="c2"]')!), ['Looks good', 'Undo']);
});

test('Replies show their pictures and links too, and French words', async () => {
  const rows = [
    row('q1', { body: 'Tighten it', slide: 'slide-1' }),
    row('q2', { body: 'New version: https://x.example/v2', author: 'Claude', slide: 'slide-1', thread: 'q1',
      files: [{ name: 'Après.png', url: AFTER }], createdAt: '2026-10-21T12:00:00.000Z' }),
  ];
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { locale: 'fr' }), 'fr');
  const reply = doc.querySelector('.nui-comment-entry:not([data-root])')!;
  assert.equal(reply.querySelector('.nui-comment-link')!.getAttribute('href'), 'https://x.example/v2');
  assert.equal(reply.querySelector('.nui-comment-attachments')!.getAttribute('aria-label'), 'Images et fichiers');
  assert.ok(button('Agrandir Après'));
});

// ---------------------------------------------------------------------------
// Attaching pictures and files
// ---------------------------------------------------------------------------

const SIGNED = 'https://db.example.supabase.co/storage/v1/object/sign/app-code/native-files/v1/x/y/file.png?token=t';
const STORED = 'https://db.example.supabase.co/storage/v1/object/authenticated/app-code/native-files/v1/x/y/file.png';

/** The host's comment file upload (`spaceComments.upload`), with every upload it was asked for. */
interface FakeFiles {
  uploads: Array<{ file: Blob; name?: string }>;
  upload: NonNullable<SpaceCommentsTransport['upload']>;
}

function fakeFiles(behaviour: { fail?: SpaceFileError; failOnce?: SpaceFileError; hold?: boolean } = {}): FakeFiles {
  const uploads: FakeFiles['uploads'] = [];
  return {
    uploads,
    async upload(input) {
      uploads.push(input);
      input.onProgress?.(0, input.file.size);
      if (behaviour.hold) await new Promise(() => {});
      if (behaviour.fail) throw behaviour.fail;
      if (behaviour.failOnce && uploads.length === 1) throw behaviour.failOnce;
      const name = input.name ?? 'file';
      const path = `comments/${name}`;
      return { path, name, url: STORED.replace('file.png', `file.${name.split('.').pop()}`), previewUrl: SIGNED,
        size: input.file.size, type: input.file.type };
    },
  };
}

/** The runtime with the host's comment upload (none: comments take text only). */
function withFiles(runtime: NotisRuntime, files: FakeFiles | undefined): NotisRuntime {
  const extra = (runtime as unknown as { commentsExtra?: Partial<SpaceCommentsTransport> }).commentsExtra;
  const next = { ...runtime, commentsExtra: { ...extra, ...(files ? { upload: files.upload, maxFileBytes: 8 * 1024 * 1024 } : {}) } } as NotisRuntime;
  STORES.set(next, storeOf(runtime));
  return next;
}

const picture = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' });
const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'brief.pdf', { type: 'application/pdf' });

async function paste(el: Element, files: File[], text = '') {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => text } });
  await act(async () => { el.dispatchEvent(event); });
  await settle();
  return event;
}

async function drop(el: Element, files: File[]) {
  for (const type of ['dragover', 'drop']) {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } });
    await act(async () => { el.dispatchEvent(event); });
  }
  await settle();
}

async function pick(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await settle();
}

async function openNewBox() {
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  return doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
}

test('Drafts outlive the pane: a new comment with its picture and a reply come back after the page leaves', async () => {
  const calls: Call[] = [];
  const files = fakeFiles();
  const rows = [...ROWS, row('ask', { body: 'Which label?', author: 'Claude', slide: 'slide-1', thread: 'c1', needs: 'input',
    createdAt: '2026-10-21T11:00:00.000Z' })];
  const runtime = withFiles(fakeRuntime(rows, calls), files);
  await mount(<Harness {...base} />, runtime);
  const field = await openNewBox();
  await type(field, 'Half a new comment');
  await paste(field, [picture()]);
  const reply = () => doc.querySelector('[data-thread="c1"] .nui-comment-compose-box textarea') as HTMLTextAreaElement;
  await type(reply(), 'Half a reply');

  // Another Space opens: the whole page unmounts (its controller too), then comes back.
  await rerender(<div />, runtime);
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'the page is gone');
  await rerender(<Harness {...base} />, runtime);
  assert.equal((doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement).value, 'Half a new comment');
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment on Item 1', 'its pin came back too');
  const chip = doc.querySelector('.nui-comment-new-box .nui-comment-file')!;
  assert.equal(chip.getAttribute('data-state'), 'ready', 'the uploaded picture is still attached');
  assert.equal(files.uploads.length, 1, 'and not uploaded again');
  assert.equal(reply().value, 'Half a reply');

  // Sending forgets the draft; dropping the new comment (the cross on its pill line, or Escape) forgets it.
  await click(doc.querySelector('[data-thread="c1"] .nui-comment-compose-box button[aria-label="Send"]')!);
  await settle();
  await click(doc.querySelector('.nui-comment-new-box [data-part="discard"]')!);
  await rerender(<div />, runtime);
  await rerender(<Harness {...base} />, runtime);
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'a cancelled new comment stays gone');
  assert.equal(reply().value, '', 'a sent reply is not brought back');
  assert.equal(writes(calls, 'reply')[0]!.input.answer_to, 'ask', 'the reply answered the thread\'s open ask');
  await act(async () => { controller!.placePin('sk1', 0.2, 0.2); });
  assert.equal((doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement).value, '', 'a new comment starts empty');
  assert.equal(doc.querySelector('.nui-comment-new-box .nui-comment-file'), null);
});

test('The host\'s comment box keeps its files: a reply\'s after the page leaves, a new comment\'s after a save that fails', async () => {
  const calls: Call[] = [];
  const files = fakeFiles();
  let refuse = true;
  const runtime = withFiles(fakeRuntime(ROWS, calls, { comments: runPanel }), files);
  const extra = (runtime as unknown as { commentsExtra: Partial<SpaceCommentsTransport> }).commentsExtra;
  const insert = storeOf(runtime).transport.insert;
  // The store takes a moment to answer, as a real one does: the new comment's box goes while it sends.
  extra.insert = async (input) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    if (refuse) throw new Error('offline');
    return insert(input);
  };
  const stopHost = registerHostComposerHost();
  // The host's composer of a box: the reply box of a card, or the new comment's.
  const boxOf = (kind: 'new' | 'reply', thread?: string) => listHostComposers().find(item => item.props().kind === kind
    && (!thread || runRoot().querySelector(`[data-thread="${thread}"] slot[name="${item.id}"]`)))!;
  try {
    await mount(<Harness {...base} />, runtime);
    const shot = picture();
    const notes = pdf();
    // The host says what its reply box holds, as the Portal's composer does each time a file is attached or removed.
    assert.deepEqual(boxOf('reply', 'c1').props().initialFiles, []);
    await act(async () => { boxOf('reply', 'c1').props().onText('Half a reply'); boxOf('reply', 'c1').props().onFiles([shot, notes]); });

    // Another page opens and this one comes back: the box is a new one, with the text and both files.
    await rerender(<div />, runtime);
    assert.equal(listHostComposers().length, 0, 'the page is gone, and its boxes with it');
    await rerender(<Harness {...base} />, runtime);
    assert.equal(boxOf('reply', 'c1').props().initialText, 'Half a reply');
    assert.deepEqual([...boxOf('reply', 'c1').props().initialFiles], [shot, notes], 'the files come back with the text');
    assert.deepEqual(boxOf('reply', 'c2').props().initialFiles, [], 'in their own box only');
    assert.equal(files.uploads.length, 0, 'nothing is uploaded before Send');

    // Sent: the files go up, and the draft is forgotten.
    let ok = false;
    await act(async () => { ok = await boxOf('reply', 'c1').props().send('Half a reply', [shot, notes]); });
    await settle();
    assert.equal(ok, true);
    assert.equal(files.uploads.length, 2);
    assert.equal(writes(calls, 'reply').length, 1);
    await rerender(<div />, runtime);
    await rerender(<Harness {...base} />, runtime);
    assert.deepEqual(boxOf('reply', 'c1').props().initialFiles, [], 'a sent reply brings no file back');
    assert.equal(boxOf('reply', 'c1').props().initialText, '');

    // A new comment whose save fails after its file was uploaded: the box comes back with the text and the file.
    await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
    await settle();
    await act(async () => { boxOf('new').props().onText('With a picture'); boxOf('new').props().onFiles([shot]); });
    const first = boxOf('new').id;
    let sending: Promise<boolean> = Promise.resolve(true);
    await act(async () => { sending = boxOf('new').props().send('With a picture', [shot]); });
    await settle();
    await act(async () => { ok = await sending; });
    await settle();
    assert.equal(ok, false, 'the save failed');
    assert.equal(files.uploads.length, 3, 'after the upload');
    assert.notEqual(boxOf('new').id, first, 'the box went while it sent and is back');
    assert.equal(boxOf('new').props().initialText, 'With a picture');
    assert.deepEqual([...boxOf('new').props().initialFiles], [shot], 'with its file');

    // The save works this time: nothing is kept for the next new comment.
    refuse = false;
    const held = boxOf('new').props();
    await act(async () => { sending = held.send('With a picture', [shot]); });
    await settle();
    // Sent: the host's composer empties its field, as the Portal's does.
    await act(async () => { ok = await sending; if (ok) held.onText(''); });
    await settle();
    assert.equal(ok, true);
    await act(async () => { controller!.placePin('sk1', 0.2, 0.2); });
    await settle();
    assert.equal(boxOf('new').props().initialText, '');
    assert.deepEqual(boxOf('new').props().initialFiles, [], 'a new comment starts with no file');
    // Dropped with a file in it: forgotten too.
    await act(async () => { boxOf('new').props().onFiles([notes]); });
    await act(async () => { boxOf('new').props().dismiss(); });
    await act(async () => { controller!.placePin('sk1', 0.2, 0.2); });
    await settle();
    assert.deepEqual(boxOf('new').props().initialFiles, []);
  } finally {
    stopHost();
  }
});

test('Drafts on two pages keep their own files when the mounted box moves from one page to the other', async () => {
  const files = fakeFiles();
  const runtime = withFiles(fakeRuntime(ROWS, []), files);
  const pageA = base;
  const pageB = { ...base, scope: { ...scope, id: 'deck-2', recordKey: 'dk2' } };
  const chipNames = () => [...doc.querySelectorAll('.nui-comment-new-box .nui-comment-file-name')].map(el => el.textContent);
  // Page B gets a new comment with its file, then page A gets one with its picture.
  await mount(<Harness {...pageB} />, runtime);
  await paste(await openNewBox(), [new File([new Uint8Array([1])], 'b-notes.pdf', { type: 'application/pdf' })]);
  assert.deepEqual(chipNames(), ['b-notes.pdf']);
  await rerender(<div />, runtime);
  await rerender(<Harness {...pageA} />, runtime);
  await paste(await openNewBox(), [new File([new Uint8Array([2])], 'a-shot.png', { type: 'image/png' })]);
  assert.deepEqual(chipNames(), ['a-shot.png']);

  // The same page component moves to B and back: the box stays mounted and each page shows its own files.
  await rerender(<Harness {...pageB} />, runtime);
  assert.deepEqual(chipNames(), ['b-notes.pdf'], 'page B shows its own file, not page A\'s');
  await rerender(<Harness {...pageA} />, runtime);
  assert.deepEqual(chipNames(), ['a-shot.png'], 'page A still has its picture');
  await rerender(<Harness {...pageB} />, runtime);
  assert.deepEqual(chipNames(), ['b-notes.pdf'], 'page B was never overwritten with page A\'s files');
  assert.equal(files.uploads.length, 2, 'nothing was uploaded again');
});

test('Attach: a pasted picture uploads at once, shows as a chip and is saved in Attachments with the comment', async () => {
  const calls: Call[] = [];
  const files = fakeFiles();
  await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, calls), files));
  assert.equal(controller!.attach, 'on', 'the host uploads comment files');
  const field = await openNewBox();
  const event = await paste(field, [picture()]);
  assert.equal(event.defaultPrevented, true, 'a pasted picture is not pasted as text');
  assert.equal(files.uploads.length, 1);
  assert.match(files.uploads[0]!.name!, /^pasted-.*\.png$/, 'a pasted "image.png" gets a dated name');
  const chip = doc.querySelector('.nui-comment-new-box .nui-comment-file')!;
  assert.equal(chip.getAttribute('data-state'), 'ready');
  assert.ok(chip.querySelector('img'), 'a picture chip shows its thumbnail');
  assert.ok(button(`Remove ${files.uploads[0]!.name}`), 'each chip has its remove control');
  await type(field, 'Like this');
  await key(field, 'Enter');
  const [insert] = writes(calls, 'insert');
  const name = files.uploads[0]!.name!;
  assert.deepEqual(insert!.input.attachments, [{ path: `comments/${name}`, name, type: 'image/png', size: 4, url: STORED }]);
  assert.equal(insert!.input.body, 'Like this');
  assert.equal(doc.querySelector('.nui-comment-new-box'), null);
});

test('Attach: a picture alone can be sent, and the sent draft shows it before the rows come back', async () => {
  const calls: Call[] = [];
  const files = fakeFiles();
  const runtime = withFiles(fakeRuntime(ROWS, calls), files);
  await mount(<Harness {...base} />, runtime);
  const field = await openNewBox();
  await paste(field, [picture()]);
  const held = storeOf(runtime).hold('insert');
  await click(button('Send')!);
  const [insert] = writes(calls, 'insert');
  assert.equal(insert!.input.body, '');
  assert.equal((insert!.input.attachments as unknown[]).length, 1);
  assert.equal(doc.querySelector('.nui-comment-thumb img')!.getAttribute('src'), SIGNED, 'the draft shows the signed preview');
  held.release();
  await settle();
  assert.equal(doc.querySelector('.nui-comment-thumb img')!.getAttribute('src'), STORED, 'then the stored comment');
});

test('Attach: files dropped on a reply and picked with the paperclip upload and go with the reply', async () => {
  const calls: Call[] = [];
  const files = fakeFiles();
  await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, calls), files));
  const box = doc.querySelector('[data-thread="c1"] .nui-comment-compose-box')!;
  await drop(box, [pdf()]);
  assert.equal(files.uploads.length, 1);
  assert.equal(files.uploads[0]!.name, 'brief.pdf');
  assert.equal(box.querySelector('.nui-comment-file img'), null, 'a file chip shows a file icon');
  assert.ok(box.querySelector('.nui-comment-file svg'));
  const input = box.querySelector('input[type="file"]') as HTMLInputElement;
  assert.ok(button('Attach pictures or files'));
  assert.equal(input.multiple, true);
  await pick(input, [picture()]);
  assert.equal(files.uploads.length, 2);
  assert.equal(box.querySelectorAll('.nui-comment-file').length, 2);
  await click(button(`Remove ${files.uploads[1]!.name}`)!);
  assert.equal(box.querySelectorAll('.nui-comment-file').length, 1);
  const field = box.querySelector('textarea') as HTMLTextAreaElement;
  await type(field, 'The brief');
  await key(field, 'Enter');
  const [reply] = writes(calls, 'reply');
  assert.deepEqual(reply!.input.attachments, [{ path: 'comments/brief.pdf', name: 'brief.pdf', type: 'application/pdf', size: 4,
    url: STORED.replace('file.png', 'file.pdf') }]);
  assert.equal(reply!.input.root_id, 'c1');
});

test('Attach: a failed upload keeps the text and the chip, says why in EN and FR, and holds Send until it is retried or removed', async () => {
  const calls: Call[] = [];
  const failing = fakeFiles({ fail: new SpaceFileError('too big', 'space_file_too_large', 413) });
  await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, calls), failing));
  const field = await openNewBox();
  await type(field, 'Keep me');
  await paste(field, [pdf()]);
  const chip = doc.querySelector('.nui-comment-file')!;
  assert.equal(chip.getAttribute('data-state'), 'failed');
  assert.match(doc.body.textContent!, /brief\.pdf is over 8 MB/);
  assert.equal(field.value, 'Keep me', 'the typed comment stays');
  assert.equal(button('Send')!.disabled, true, 'nothing is sent without the file the person attached');
  assert.equal(button('Try brief.pdf again'), undefined, 'the same file is still too large: no Try again');
  await click(button('Remove brief.pdf')!);
  assert.equal(button('Send')!.disabled, false);
  assert.equal(calls.length, 0);

  const lost = fakeFiles({ failOnce: new SpaceFileError('offline', 'space_file_offline') });
  await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, []), lost));
  const again = await openNewBox();
  await paste(again, [pdf()]);
  assert.equal(doc.querySelector('.nui-comment-file')!.getAttribute('data-state'), 'failed');
  await click(button('Try brief.pdf again')!);
  await settle();
  assert.equal(doc.querySelector('.nui-comment-file')!.getAttribute('data-state'), 'ready', 'a lost upload goes through on Try again');
  assert.equal(lost.uploads.length, 2);

  await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, [], { locale: 'fr' }), fakeFiles({
    fail: new SpaceFileError('nope', 'space_file_type_unsupported', 415) })), 'fr');
  const champ = await openNewBox();
  await paste(champ, [pdf()]);
  assert.match(doc.body.textContent!, /brief\.pdf ne peut pas être joint/);
});

test('Attach: a save that fails after the upload keeps the text and the files for another try', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, calls, { fail: true }), fakeFiles()));
  const field = await openNewBox();
  await type(field, 'Try me');
  await paste(field, [pdf()]);
  await key(field, 'Enter');
  assert.equal(writes(calls, 'insert').length, 1);
  assert.match(doc.body.textContent!, /Could not save that change/);
  const kept = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  assert.equal(kept.value, 'Try me');
  assert.equal(doc.querySelectorAll('.nui-comment-new-box .nui-comment-file[data-state="ready"]').length, 1);
});

test('Send empties the box at once: the text never shows twice while the store answers (SPC-037)', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} anchorKey="sk2" />, runtime);
  const insert = storeOf(runtime).hold('insert');
  const field = await openNewBox();
  await type(field, 'Bigger title');
  await key(field, 'Enter');
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'the box goes while the new comment is saved');
  await act(async () => { insert.release(); });
  await settle();
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'and stays gone once it is saved');
  assert.equal(storeOf(runtime).rows.filter(item => item.body === 'Bigger title').length, 1);

  await pickFilter('done');
  const reply = storeOf(runtime).hold('reply');
  const replyField = doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement;
  await type(replyField, 'Not quite');
  await key(replyField, 'Enter');
  assert.equal((doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement).value, '',
    'the reply box empties while the reply is saved');
  await act(async () => { reply.release(); });
  await settle();
  assert.equal((doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement).value, '');
});

test('A reply that fails to save comes back in its box', async () => {
  const runtime = fakeRuntime(ROWS, []);
  await mount(<Harness {...base} anchorKey="sk2" />, runtime);
  await pickFilter('done');
  storeOf(runtime).fail('reply');
  const field = doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement;
  await type(field, 'Not quite');
  await key(field, 'Enter');
  await settle();
  assert.equal((doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement).value, 'Not quite');
});

test('Attach: Send waits while a file uploads', async () => {
  await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, []), fakeFiles({ hold: true })));
  const field = await openNewBox();
  await type(field, 'Wait');
  await paste(field, [pdf()]);
  assert.equal(doc.querySelector('.nui-comment-file')!.getAttribute('data-state'), 'uploading');
  assert.match(doc.querySelector('.nui-comment-file [role="status"]')!.textContent!, /Uploading brief\.pdf, 0%/);
  assert.equal(button('Send')!.disabled, true);
});

test('Attach: text only without the host\'s upload (a Site, a preview or an older host)', async () => {
  await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, []), undefined));
  assert.equal(controller!.attach, 'off', 'nothing to upload with');
  assert.equal(button('Attach pictures or files'), undefined);
  const field = await openNewBox();
  const event = await paste(field, [picture()]);
  assert.equal(event.defaultPrevented, false, 'a text-only pane leaves the paste to the browser');
  assert.equal(button('Attach pictures or files'), undefined);

  const files = fakeFiles();
  await mount(<Harness {...base} />, withFiles(fakeRuntime([], []), files));
  assert.equal(controller!.attach, 'on', 'with the upload, an empty Space takes files too');
  assert.ok(button('Attach pictures or files') === undefined, 'no box is open yet');
  await openNewBox();
  assert.ok(button('Attach pictures or files'));
});

test('Attach: an expired picture address reads the comments again, at most twice a minute', async () => {
  const runtime = withFiles(fakeRuntime([row('e1', { body: 'Look', slide: 'slide-1', files: [{ name: 'a.png', url: SIGNED }] })], []), fakeFiles());
  await mount(<Harness {...base} />, runtime);
  const before = storeOf(runtime).reads();
  const img = doc.querySelector('.nui-comment-thumb img')!;
  await act(async () => { img.dispatchEvent(new dom.window.Event('error')); });
  await settle();
  await act(async () => { img.dispatchEvent(new dom.window.Event('error')); });
  await settle();
  assert.equal(storeOf(runtime).reads() - before, 1);
});

test('The pane draws in the host Comments panel, never inside the Space', async () => {
  await mount(<Harness {...base} pins={false} />, fakeRuntime(ROWS, []));
  const panel = doc.getElementById('panel')!;
  const app = doc.getElementById('app')!;
  assert.ok(panel.querySelector('.nui-comment-pane'), 'the threads sit in the host panel');
  assert.equal(app.querySelector('.nui-comment-pane') === null, true, 'nothing of the pane inside the Space');
});

test('Comments off for the viewer (no host panel): no pane, no pins, no Comment button', async () => {
  const off = { ...fakeRuntime(ROWS, []), spaceComments: undefined } as NotisRuntime;
  await mount(<Harness {...base} />, off);
  assert.equal(doc.querySelector('.nui-comment-pane'), null);
  assert.equal(doc.querySelector('.nui-comment-pin'), null);
  assert.equal(ui.useHostComments, ui.useHostComments, 'the hook is exported for Spaces that draw their own anchors');
});

// ---------------------------------------------------------------------------
// Fixes: author, routing, deletes, Undo, chips, hints, numbering, phone screens
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pinTexts = () => [...doc.querySelectorAll('.nui-comment-pin:not([data-draft])')].map(pin => pin.textContent);

test('Author is the signed-in viewer under the host: Send waits until the viewer is known, never a fallback name', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls, { comments: { viewer: undefined } }));
  assert.equal(controller!.canWrite, false);
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Hello');
  assert.equal(button('Send')!.disabled, true, 'Send stays off while the viewer is unknown');
  await key(field, 'Enter');
  assert.equal(writes(calls, 'insert').length, 0, 'nothing is sent as Flo');

  const named: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, named, { comments: { viewer: { name: 'Ana', canEditSpace: true } } }));
  assert.equal(controller!.canWrite, true);
  assert.equal(controller!.me, 'Ana');
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const next = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(next, 'Hello');
  await key(next, 'Enter');
  const [insert] = writes(named, 'insert');
  assert.ok(insert, 'sent once the viewer is known');
  assert.equal('author' in insert!.input, false, 'the server signs it with the viewer, never the me option');
});

test('Where a reply goes: a failed links read is tried again, and a late answer is kept after the host hands a new transport', async () => {
  let tries = 0;
  const flaky: Partial<SpaceCommentsTransport> = {
    links: async () => {
      tries += 1;
      if (tries === 1) throw new Error('down');
      return { c1: [{ threadId: 't-1', title: 'Deck polish' }] };
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: flaky }));
    assert.equal(replyTo('c1'), 'Reply', 'while the read is tried again, nobody is named');
    assert.equal(goesToTitle('c1'), null);
    await act(async () => { await sleep(1700); });
    await settle();
    assert.equal(tries, 2, 'read again once');
    assert.equal(goesToTitle('c1'), 'Deck polish');
    assert.equal(replyTo('c1'), 'Reply to Notis');
  } finally {
    console.warn = warn;
  }

  let answer: (value: Record<string, unknown>) => void = () => {};
  let asked = 0;
  const slow: Partial<SpaceCommentsTransport> = {
    links: () => { asked += 1; return new Promise(resolve => { answer = resolve as never; }); },
  };
  const runtime = withHostPanel(fakeRuntime(ROWS, [], { comments: slow }));
  await mount(<Harness {...base} />, runtime);
  // The viewer resolves: the host hands a new transport object while the read is in flight.
  const host = (runtime as unknown as { spaceComments: SpaceCommentsTransport }).spaceComments;
  await rerender(<Harness {...base} />, { ...runtime, spaceComments: { ...host, viewer: { name: 'Flo', canEditSpace: false } } } as NotisRuntime);
  await act(async () => { answer({ c1: [{ threadId: 't-1', title: 'Deck polish' }] }); });
  await settle();
  assert.equal(asked, 1, 'a new transport object reads nothing again');
  assert.equal(goesToTitle('c1'), 'Deck polish');
  assert.equal(replyTo('c1'), 'Reply to Notis');
});

test('Where a reply goes: nobody is named while it loads, and a page shown again knows its threads at once (QA5)', async () => {
  const answers: Array<(value: Record<string, SpaceCommentThreadRef[]>) => void> = [];
  const bests: Array<(value: SpaceCommentThreadRef | null) => void> = [];
  const comments: Partial<SpaceCommentsTransport> = {
    links: () => new Promise(resolve => { answers.push(resolve); }),
    bestMatch: () => new Promise(resolve => { bests.push(resolve); }),
    pickThread: async () => null,
    link: async () => null,
  };
  const runtime = withHostPanel(fakeRuntime(ROWS, [], { comments }));
  await mount(<Harness {...base} />, runtime);
  for (const key of ['c1', 'c2']) {
    assert.equal(controller!.routing.known?.(key), false, `${key} loads`);
    assert.equal(replyTo(key), 'Reply', 'no guess: neither a new thread nor a best match');
    assert.ok(!(await threadActions(key)).includes('change'), 'no Change while loading');
  }
  await act(async () => { answers[0]!({ c1: [{ threadId: 't-1', title: 'Deck polish' }] }); });
  await settle();
  assert.equal(goesToTitle('c1'), 'Deck polish', 'a linked thread names its link at once');
  assert.equal(replyTo('c1'), 'Reply to Notis');
  assert.equal(controller!.routing.known?.('c2'), false, 'no link: loading until the best match answers');
  assert.equal(replyTo('c2'), 'Reply');
  await act(async () => { bests[0]!({ threadId: 't-best', title: 'Q4 deck' }); });
  await settle();
  assert.equal(goesToTitle('c2'), 'Q4 deck');
  assert.equal(replyTo('c2'), 'Reply to Notis');

  // Another page, then this one again: the session's last answers show at once while they are read again.
  await rerender(<span />, runtime);
  await rerender(<Harness {...base} />, runtime);
  assert.equal(answers.length, 2, 'read again');
  assert.equal(goesToTitle('c1'), 'Deck polish', 'the kept link, at once');
  assert.equal(goesToTitle('c2'), 'Q4 deck', 'the kept best match, at once');
  await act(async () => { answers[1]!({ c1: [{ threadId: 't-2', title: 'Chart work' }] }); });
  await settle();
  assert.equal(goesToTitle('c1'), 'Chart work', 'the new answer wins');

  // Another viewer keeps nothing of Flo's.
  const host = (runtime as unknown as { spaceComments: SpaceCommentsTransport }).spaceComments;
  await rerender(<span />, runtime);
  await rerender(<Harness {...base} />,
    { ...runtime, spaceComments: { ...host, viewer: { name: 'Ana', canEditSpace: true } } } as NotisRuntime);
  assert.equal(controller!.routing.known?.('c1'), false, 'another viewer reads their own');
  assert.equal(replyTo('c1'), 'Reply');
});

test('Where a reply goes: a failed best match names nobody and the To chip asks to choose, never "a new thread" (SPC-467)', async () => {
  let fail = true;
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => ({ c1: [{ threadId: 't-1', title: 'Deck polish' }] }),
    bestMatch: async () => { if (fail) throw new Error('57014'); return { threadId: 't-best', title: 'Q4 deck' }; },
    pickThread: async () => null,
    link: async () => null,
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await mount(<Harness {...base} />, withHostPanel(fakeRuntime(ROWS, [], { comments })));
    await settle();
    assert.equal(goesToTitle('c1'), 'Deck polish', 'a linked thread still names its link');
    assert.equal(replyTo('c1'), 'Reply to Notis');
    assert.equal(replyTo('c2'), 'Reply', 'no link and no best match read: nobody is named, never "a new thread"');
    assert.equal(controller!.routing.lost?.('c2'), true);
    assert.ok(!(await threadActions('c2')).includes('change'));
    await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
    await settle();
    const chip = doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!;
    assert.match(chip.textContent!, /^Choose a thread$/, 'the chip offers the picker without naming a thread');
    await act(async () => { controller!.cancelPin(); });
  } finally {
    console.warn = warn;
  }
  // The page shown again: the best match answers this time and is named.
  fail = false;
  await mount(<Harness {...base} />, withHostPanel(fakeRuntime(ROWS, [], { comments })));
  await settle();
  assert.equal(goesToTitle('c2'), 'Q4 deck');
  assert.equal(replyTo('c2'), 'Reply to Notis');
});

test('Where a reply goes: a reply that wakes another person\'s agent names nobody, and is not read again (SPC-467)', async () => {
  let reads = 0;
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => {
      reads += 1;
      return { c1: [{ threadId: null, title: '', status: 'elsewhere', via: 'started' }, { threadId: 't-1', title: 'Deck polish' }] };
    },
    bestMatch: async () => ({ threadId: 't-best', title: 'Q4 deck' }),
  };
  await mount(<Harness {...base} />, withHostPanel(fakeRuntime(ROWS, [], { comments })));
  await settle();
  assert.equal(replyTo('c1'), 'Reply', 'neither the viewer\'s own link nor the best match is named');
  assert.deepEqual(await threadActions('c1'), ['copy-link', 'edit', 'delete'], 'no thread to open or change from this card');
  assert.deepEqual(controller!.routing.linksOf('c1').map(link => link.threadId), ['t-1'], 'the link itself stays listed');
  assert.equal(replyTo('c2'), 'Reply to Notis');
  assert.equal(goesToTitle('c2'), 'Q4 deck');
  const before = reads;
  for (let i = 0; i < 4; i += 1) await act(async () => { await sleep(1_000); });
  assert.equal(reads, before, 'a settled answer is not read again');
});

test('The pane in the host panel: no browser button borders, quiet buttons, one-line reply field (SPC-451)', () => {
  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} is styled`);
    return css.slice(at, css.indexOf('}', at));
  };
  // The panes draw in the host panel's shadow root, outside .nui-root: they need the same button reset.
  assert.match(css, /:where\([^)]*\.nui-comment-pane[^)]*\) button \{ font: inherit; color: inherit; background: none; border: 0;/);
  // A card's two buttons and each reply's "..." are quiet (see-through) until hovered, focused or selected: they keep
  // their room, so nothing moves when they show, and Tab still reaches them.
  assert.match(rule('.nui-comment-actions'), /opacity: 0;/);
  assert.doesNotMatch(rule('.nui-comment-actions'), /position: absolute|visibility: hidden/);
  assert.match(rule('.nui-comment-entry-more'), /opacity: 0;/);
  assert.match(css, /\.nui-comment-entry:is\(:hover, :focus-within\) \.nui-comment-entry-more, \.nui-comment-entry-more:has\(\[aria-expanded="true"\]\) \{ opacity: 1; \}/,
    'a reply shows its own "..." only, and keeps it while its menu is open');
  assert.match(css, /@media \(hover: none\) \{\s*\.nui-comment-actions, \.nui-comment-entry-more \{ opacity: 1; \}/, 'always there on a touch screen');
  // No mark on a comment not read yet, and no line naming a thread.
  assert.doesNotMatch(css, /\.nui-comment-new \{|\.nui-comment-goes|\.nui-comment-thread-line|\.nui-comment-unread/);
  // A card's reply field is one quiet line; the paperclip and Send show once it is used.
  assert.match(css, /\.nui-comment-reply-box \.nui-comment-compose-box:not\(:focus-within\):not\(:hover\):not\(:has\(\.nui-comment-file\)\)\s+\.nui-comment-compose:has\(> \.nui-comment-input:placeholder-shown\) > \.nui-comment-icon-btn \{ display: none; \}/,
    'shown on hover too, so a click never lands on a button that hid as the focus moved (Safari)');
  assert.match(rule('.nui-comment-compose > .nui-comment-input, .nui-comment-compose > .nui-comment-input:hover'), /background: transparent;/,
    'the reply field holds its buttons: one surface');
  assert.match(rule('.nui-comment-input'), /background: hsl\(var\(--foreground\) \/ \.05\);/, 'an edit field keeps its fill');
  // A question has no tinted box: its options are rows, the asker's pick tinted.
  assert.doesNotMatch(rule('.nui-comment-ask'), /background/);
  // The rows tint over the card with the text colour: the chat's accent is the card's own colour in both themes, so a
  // hovered row and the recommended one showed nothing.
  assert.match(rule('.nui-comment-option[data-recommended]'), /background: hsl\(var\(--foreground\) \/ \.05\);/);
  assert.match(rule('.nui-comment-option:enabled:is(:hover, :focus-visible)'), /background: hsl\(var\(--foreground\) \/ \.1\);/,
    'the row under the pointer shows');
  assert.doesNotMatch(css, /\.nui-comment-option[^{]*\{[^}]*--accent/, 'no accent tint on a card');
  // The selected card keeps a ring, so it still shows while the pointer tints another card.
  assert.match(rule('.nui-comment-card[data-selected]'), /box-shadow: inset 0 0 0 1px hsl\(var\(--nui-blue, 217 91% 60%\) \/ \.5\);/);
});

test('All items: a comment on one item names it by its title, like a comment on several, else the Space label (SPC-490)', async () => {
  const tasks: CommentAnchor[] = [
    { id: 't1', recordKey: 'tk1', order: 1, title: 'Record the product demo' },
    { id: 't2', recordKey: 'tk2', order: 2, title: '' },
  ];
  const words = { anchorLabel: { en: 'Task {n}', fr: 'Tâche {n}' } };
  await mount(<Harness scope={scope} anchors={tasks} anchorKey="tk1" words={words} />, fakeRuntime([
    row('i1', { body: 'Who records it?', slide: 'tk1', createdAt: '2026-10-21T09:00:00.000Z' }),
    row('i2', { body: 'Untitled one', slide: 'tk2', createdAt: '2026-10-21T10:00:00.000Z' }),
  ], []));
  await act(async () => { controller!.setFilter('all'); });
  await settle();
  const meta = (key: string) => doc.querySelector(`[data-thread="${key}"] [data-part="place"]`)!.textContent!;
  assert.match(meta('i1'), /Record the product demo/);
  assert.doesNotMatch(meta('i1'), /Task 1/);
  assert.match(meta('i2'), /Task 2/, 'an item with no title keeps the Space label');
});

test('A text comment card starts with its quote, like a passage thread, so every comments pane reads the same (SPC-489)', async () => {
  const text = commentRow({ ...row('t1', { body: 'Is this date confirmed?', page: PAGE }), mode: 'text', quote: 'second Monday',
    prefix: 'on the ', suffix: ' of March' });
  await mount(<Harness scope={scope} anchors={ANCHORS} />, fakeRuntime([text], []));
  const card = doc.querySelector('[data-thread="t1"]')!;
  assert.ok(card, 'the text comment is listed');
  const top = card.firstElementChild!;
  assert.equal(top.className, 'nui-comment-top');
  assert.equal(top.querySelector('[data-part="quote"]')!.textContent, 'second Monday', 'the quoted words first, then who wrote');
  assert.equal(top.nextElementSibling!.className, 'nui-comment-entries');
  // A comment that quotes nothing says where it sits instead: every card starts with its place.
  await mount(<Harness scope={scope} anchors={ANCHORS} />, fakeRuntime([row('w1', { body: 'Overall, good', page: PAGE })], []));
  assert.equal(doc.querySelector('[data-thread="w1"] .nui-comment-top [data-part="place"]')!.textContent, 'Whole page');
  await mount(<Harness scope={scope} anchors={ANCHORS} />, fakeRuntime([row('w1', { body: 'Overall, good', page: PAGE })], [], { locale: 'fr' }), 'fr');
  assert.equal(doc.querySelector('[data-thread="w1"] .nui-comment-top [data-part="place"]')!.textContent, 'Page entière');
});

test('Where a reply goes: links that keep failing name nobody once given up, never "a new thread" (SPC-467)', async () => {
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => { tries += 1; throw new Error('57014'); },
    bestMatch: async () => null,
  };
  let tries = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
    // Tried 4 times (1.5 s, 3 s and 6 s apart), then given up.
    for (let i = 0; i < 12; i += 1) await act(async () => { await sleep(1_000); });
    assert.equal(tries, 4);
    await settle();
    assert.equal(replyTo('c1'), 'Reply');
    assert.equal(controller!.routing.lost?.('c1'), true);
  } finally {
    console.warn = warn;
  }
});

test('Where a reply goes: the agent thread a reply wakes comes ahead of the links, but it is no link (SPC-467)', async () => {
  const linked: unknown[] = [];
  const picks: Array<string | null> = [];
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => ({
      c1: [{ threadId: 't-agent', title: 'Desk work', subagent: 'desk', via: 'replied' }],
      c2: [{ threadId: 't-start', title: 'Agent work', via: 'started' }, { threadId: 't-1', title: 'Deck polish' }],
    }),
    bestMatch: async () => ({ threadId: 't-best', title: 'Q4 deck' }),
    pickThread: async input => { picks.push(input.current ?? null); return { threadId: 't-2', title: 'Chart work' }; },
    link: async input => { linked.push(input); return { threadId: 't-2', title: 'Chart work' }; },
  };
  await mount(<Harness {...base} />, withHostPanel(fakeRuntime(ROWS, [], { comments })));
  await settle();
  assert.equal(goesToTitle('c1'), 'Desk work', 'the replying agent\'s thread, not the best match');
  assert.deepEqual(controller!.routing.linksOf('c1'), [], 'it is no link');
  assert.equal(goesToTitle('c2'), 'Agent work', 'the first comment\'s agent wins over the link');
  assert.deepEqual(controller!.routing.linksOf('c2').map(ref => ref.threadId), ['t-1']);
  // Change on c1 links a thread: a link beats the agent that only replied.
  await threadAction('c1', 'change');
  await settle();
  assert.deepEqual(picks, [null], 'the picker marks no link as current');
  assert.equal(goesToTitle('c1'), 'Chart work');
  // Change on c2: the first comment's agent still takes replies.
  await threadAction('c2', 'change');
  await settle();
  assert.deepEqual(picks, [null, 't-1']);
  assert.equal(goesToTitle('c2'), 'Agent work');
  assert.deepEqual(controller!.routing.linksOf('c2').map(ref => ref.threadId), ['t-2', 't-1']);
});

test('Where a reply goes: a pending thread names its harness and opens nothing', async () => {
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => ({ c1: [{ threadId: null, title: '', harness: 'claude', status: 'pending' }] }),
    openThread: () => { throw new Error('nothing to open'); },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  assert.equal(replyTo('c1'), 'Reply to Claude', 'the harness the new thread will run on');
  assert.ok(!(await threadActions('c1')).includes('open-thread'), 'no thread yet: nothing to open');
});

test('Older Spaces keep working: deleting, cancelDelete, confirmDelete and the resolved filter name', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  const legacy = controller as unknown as { deleting: unknown; cancelDelete(): void; confirmDelete(comment?: CommentRecord): void };
  assert.equal(legacy.deleting, null);
  legacy.cancelDelete();
  const reply = controller!.threads.find(thread => thread.root.recordKey === 'c1')!.replies[0]!;
  await act(async () => { legacy.confirmDelete(reply); });
  await settle();
  assert.deepEqual(calls.at(-1), { op: 'remove', input: { id: 'r1' } }, 'confirmDelete deletes at once');
  await act(async () => { controller!.setStatusFilter('resolved'); });
  assert.equal(controller!.statusFilter, 'done');
});

test('On a touch screen a delete\'s Undo toast stays 8 seconds, or until dismissed; desktop keeps 6 seconds', async () => {
  const win = dom.window as unknown as { matchMedia?: (query: string) => unknown };
  const before = win.matchMedia;
  const realTimeout = globalThis.setTimeout;
  const delays: number[] = [];
  const deleteAndRead = async (coarse: boolean) => {
    win.matchMedia = query => ({ matches: coarse && query === '(pointer: coarse)', media: query, addEventListener() {}, removeEventListener() {} });
    await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
    delays.length = 0;
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      delays.push(ms ?? 0);
      return realTimeout(fn, ms, ...rest);
    }) as typeof setTimeout;
    try {
      const root = controller!.threads.find(thread => thread.root.recordKey === 'c2')!.root;
      await act(async () => { controller!.actions.remove(root); });
    } finally {
      globalThis.setTimeout = realTimeout;
    }
    await settle();
    return [...delays];
  };
  try {
    assert.ok((await deleteAndRead(true)).includes(8000), 'touch: 8 seconds');
    assert.match(doc.querySelector('.nui-toast')!.textContent!, /Comment thread deleted/);
    await click(doc.querySelector('.nui-toast-x')!);
    assert.equal(doc.querySelector('.nui-toast'), null, 'Dismiss hides it at once');
    const desktop = await deleteAndRead(false);
    assert.ok(desktop.includes(6000) && !desktop.includes(8000), 'desktop: the usual 6 seconds');
  } finally {
    win.matchMedia = before;
  }
});

test('A delete the store refuses: the thread comes back, the pane says so, and nothing is restored', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} />, runtime);
  storeOf(runtime).fail('remove', 'comment_forbidden');
  await threadAction('c1', 'delete');
  await settle();
  assert.deepEqual(cards(), ['c2', 'c1'], 'the thread is back');
  assert.match(doc.body.textContent!, /Could not save that change/);
  assert.deepEqual(calls.map(call => call.op), ['remove'], 'one delete, nothing to restore');
});

test('Undo right after a write waits for it; Z still undoes after the card left', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} />, runtime);
  const held = storeOf(runtime).hold('archive');
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  await click(toastUndo()!);
  assert.deepEqual(calls.map(call => call.op), ['archive'], 'the Undo waits for the archive to be saved');
  await act(async () => { held.release(); });
  await settle();
  assert.deepEqual(calls.map(call => call.op), ['archive', 'unarchive'], 'then it is sent');
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'c1')!.status, 'open');

  const later: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, later));
  const first = doc.querySelector('[data-thread="c2"]') as HTMLElement;
  first.focus();
  await key(first, 'e');
  assert.equal(doc.activeElement?.getAttribute('data-thread'), 'c1', 'focus moves to the card now in its place');
  await key(doc.activeElement!, 'z');
  assert.deepEqual(later.at(-1), { op: 'unarchive', input: { root_id: 'c2' } }, 'Z undoes');
});

test('The To chip: "To a new thread" without a best match, clickable at any time; cancel forgets the pick; Esc puts @ back', async () => {
  let pick: Record<string, unknown> | null = { threadId: 't-9', title: 'Copy pass' };
  const comments: Partial<SpaceCommentsTransport> = {
    bestMatch: async () => null,
    pickThread: async () => pick as never,
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const chip = () => doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!;
  assert.match(chip().textContent!, /To a new thread/);
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Already writing');
  await click(chip());
  assert.match(chip().textContent!, /To Copy pass/, 'the chip picks even with text in the box');
  assert.equal(field.value, 'Already writing');
  await act(async () => { controller!.cancelPin(); });
  assert.equal(controller!.routing.newPick, null, 'cancelling the comment forgets its pick');

  pick = null;
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const next = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(next, '@');
  await settle();
  assert.equal(next.value, '@', 'a dismissed picker puts the @ back, for a mention');
});

test('An agent outside Notis picked from the Agents list writes its @ into the comment and links nothing (SPC-1546)', async () => {
  const linked: unknown[] = [];
  const comments: Partial<SpaceCommentsTransport> = {
    bestMatch: async () => ({ threadId: 't-best', title: 'Deck polish' }),
    pickThread: async () => ({ mention: 'fred-and-the-machine' }),
    link: async input => { linked.push(input); return null; },
  };
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls, { comments });
  await mount(<Harness {...base} />, runtime);
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const chip = () => doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!;
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, '@');
  await settle();
  assert.equal(field.value, '@fred-and-the-machine ', 'the @ typed in the empty box becomes the agent\'s @');
  assert.equal(controller!.routing.newPick, null, 'it is not kept as where the comment goes');
  assert.match(chip().textContent!, /To Deck polish/);
  await type(field, 'please check');
  await click(chip());
  await settle();
  assert.equal(field.value, '@fred-and-the-machine please check', 'picked again from the chip, the @ is not written twice');
  await key(field, 'Enter');
  assert.equal(writes(calls, 'insert').length, 1);
  assert.deepEqual(linked, [{ rootId: storeOf(runtime).rows.at(-1)!.id, pick: { threadId: 't-best', title: 'Deck polish' } }],
    'only the best match is linked, as for any comment; the @ reaches the agent outside Notis');
});

test('Tool bar and empty states: the idle hint follows the modes, Done is empty in its own words, names are unique', async () => {
  function ItemsOnly() {
    controller = useComments({ ...base, modes: ['items', 'page'], onStartItems: () => {} });
    return (
      <div>
        <ui.CommentToolBar controller={controller} />
        <CommentPane controller={controller} />
      </div>
    );
  }
  await mount(<ItemsOnly />, fakeRuntime(ROWS, []));
  await key(doc.body, 'c');
  const bar = doc.querySelector('.nui-comment-toolbar')!;
  assert.match(bar.textContent!, /Pick the items to comment on\./);
  assert.doesNotMatch(bar.textContent!, /Point at/);
  assert.ok(bar.querySelector('button[aria-label="Close comment tool bar"]'));
  assert.equal(doc.querySelectorAll('button[aria-label="Close comment tool bar"]').length, 1);
  await pickFilter('done');
  assert.match(doc.querySelector('.nui-comment-empty')!.textContent!, /No done comments\./);
});

test('A tap anywhere on a card selects it; each reply keeps its own "..." beside its name, so no tap is needed to reach it', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  const reply = () => doc.querySelector('[data-thread="c1"] .nui-comment-entry[data-comment="r1"]')!;
  await click(reply().querySelector('.nui-comment-body')!);
  assert.equal(controller!.threadKey, 'c1', 'a tap on a reply selects the card');
  assert.ok(reply().querySelector('.nui-comment-entry-head [data-part="reply-more"]'), 'its "..." sits on its name line');
  assert.equal(reply().hasAttribute('data-tapped'), false, 'no tapped state: the menu is always in reach on a touch screen');
});

test('Two comment tool bars on screen at once never clash: C toggles the one whose view shows (SPC-491)', async () => {
  let second: CommentController | null = null;
  function Page({ hidden }: { hidden: boolean }) {
    controller = useComments({ ...base, modes: ['point'] });
    return (
      <div>
        <ui.CommentToolBar controller={controller} />
        <CommentPane controller={controller} />
      </div>
    );
  }
  function Opened() {
    second = useComments({ ...base, modes: ['point'] });
    return <ui.CommentToolBar controller={second} />;
  }
  function Both({ shown }: { shown: boolean }) {
    return (
      <div>
        <ShortcutScope owner="space:first" available={!shown}><Page hidden={shown} /></ShortcutScope>
        <ShortcutScope owner="space:second" available={shown}><Opened /></ShortcutScope>
      </div>
    );
  }
  // The strict engine throws NotisKeyClash on a duplicate key: mounting both proves there is none.
  await mount(<Both shown />, fakeRuntime(ROWS, []));
  await key(doc.body, 'c');
  assert.equal(second!.toolBar, true, 'C shows the tool bar of the view on screen');
  assert.equal(controller!.toolBar, false, 'never the hidden one');
  await rerender(<Both shown={false} />, fakeRuntime(ROWS, []));
  await key(doc.body, 'c');
  assert.equal(controller!.toolBar, true, 'once the first view shows again, C is its own');
});

test('At 390 px the point tool bar sits above the card, which moves down to make room, and Esc cancels is hidden', async () => {
  // jsdom lays nothing out and reads no media query, so this reads the bar's markup, the room it tells its card, and
  // the stylesheet rules a 390 px screen applies: the bar sits outside the card, above its top edge, and the card moves
  // down by the bar's height (it never covers the card or its pins); the "Esc cancels" words go on narrow screens too.
  const rect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const box = rect.call(this);
    return this.classList.contains('nui-comment-toolbar')
      ? { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 37.5, width: 200, height: 37.5, toJSON: () => ({}) } as DOMRect : box;
  };
  function Point() {
    controller = useComments({ ...base, modes: ['point'] });
    return (
      <div>
        <div className="card" style={{ position: 'relative' }}>
          <CommentPins controller={controller} />
          <ui.CommentToolBar controller={controller} />
        </div>
        <CommentPane controller={controller} />
      </div>
    );
  }
  try {
    await mount(<Point />, fakeRuntime(ROWS, []));
    await key(doc.body, 'c');
    await act(async () => { controller!.startMode('point'); });
  } finally {
    dom.window.HTMLElement.prototype.getBoundingClientRect = rect;
  }
  const bar = doc.querySelector('.nui-comment-toolbar')!;
  const card = doc.querySelector('.card') as HTMLElement;
  assert.equal(bar.getAttribute('data-place'), 'overlay');
  assert.ok(bar.querySelector('.nui-comment-toolbar-hint .nui-comment-hint-cancel'), 'the hint carries its Esc words');
  assert.equal(card.style.getPropertyValue('--nui-comment-toolbar-room'), '46px', 'the card is told the bar height and its 8 px gap');
  await act(async () => { controller!.cancelMode(); controller!.setToolBar(false); });
  assert.equal(card.style.getPropertyValue('--nui-comment-toolbar-room'), '', 'the room goes with the bar');

  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  /** Every `@media <query>` block of the stylesheet, joined. */
  const block = (query: string) => {
    const blocks: string[] = [];
    for (let at = css.indexOf(`@media ${query} {`); at >= 0; at = css.indexOf(`@media ${query} {`, at + 1)) {
      let depth = 0;
      for (let index = css.indexOf('{', at); index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        else if (css[index] === '}' && --depth === 0) { blocks.push(css.slice(at, index + 1)); break; }
      }
    }
    assert.ok(blocks.length, `toolkit.css has an @media ${query} block`);
    return blocks.join('\n');
  };
  const phone = block('(max-width: 480px)');
  const overlay = /\.nui-comment-toolbar\[data-place="overlay"\] \{([^}]*)\}/.exec(phone)?.[1] ?? '';
  assert.match(overlay, /position: absolute;/, 'at 390 the bar leaves the card');
  assert.match(overlay, /top: auto; bottom: calc\(100% \+ 8px\); left: 0;/, 'and sits 8 px above its top edge, never over it');
  assert.match(overlay, /width: fit-content;/, 'and only as wide as its buttons');
  assert.match(phone, /:has\(> \.nui-comment-toolbar\[data-place="overlay"\]\) \{ margin-top: var\(--nui-comment-toolbar-room, 46px\); \}/,
    'the card moves down by the room the bar measured');
  assert.match(block('(hover: none), (max-width: 767px)'), /\.nui-comment-hint-cancel \{ display: none; \}/,
    'Esc cancels is hidden on narrow screens too, not only on touch ones');
  assert.match(phone, /\.nui-comment-toolbar\[data-place="overlay"\]\[data-lifted\] \{ position: fixed; bottom: auto; \}/,
    'the lifted bar is fixed where the script puts it');
  assert.match(phone, /:has\(> \.nui-comment-toolbar-slot\[data-place="overlay"\]\) \{ margin-top: var\(--nui-comment-toolbar-room, 46px\); \}/,
    'the card keeps its room for the lifted bar too');
});

test('At 390 px the overlay tool bar draws in the layer root, so a card that clips its overflow never hides it (SPC-464)', async () => {
  const win = dom.window as unknown as { matchMedia?: (query: string) => unknown };
  const before = win.matchMedia;
  win.matchMedia = query => ({ matches: query === '(max-width: 480px)', media: query, addEventListener() {}, removeEventListener() {} });
  const rect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const box = rect.call(this);
    if (this.classList.contains('nui-comment-toolbar')) {
      return { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 37.5, width: 200, height: 37.5, toJSON: () => ({}) } as DOMRect;
    }
    if (this.classList.contains('card')) {
      return { x: 16, y: 120, top: 120, left: 16, right: 374, bottom: 520, width: 358, height: 400, toJSON: () => ({}) } as DOMRect;
    }
    return box;
  };
  function Clipped() {
    controller = useComments({ ...base, modes: ['point'] });
    return (
      <div>
        <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
          <CommentPins controller={controller} />
          <ui.CommentToolBar controller={controller} />
        </div>
        <CommentPane controller={controller} />
      </div>
    );
  }
  try {
    await mount(<Clipped />, fakeRuntime(ROWS, []));
    await key(doc.body, 'c');
    await act(async () => { controller!.startMode('point'); });
    await settle();
    const card = doc.querySelector('.card') as HTMLElement;
    const bar = doc.querySelector('.nui-comment-toolbar') as HTMLElement;
    assert.ok(bar, 'the bar shows');
    assert.equal(card.contains(bar), false, 'the bar is not inside the card that clips');
    assert.equal(bar.parentElement, doc.body, 'it draws in the layer root (the page body outside a shadow root)');
    assert.ok(bar.hasAttribute('data-lifted'));
    assert.equal(bar.getAttribute('data-place'), 'overlay');
    assert.ok(card.querySelector(':scope > .nui-comment-toolbar-slot[data-place="overlay"]'), 'an empty slot keeps the card\'s room');
    assert.equal(card.style.getPropertyValue('--nui-comment-toolbar-room'), '46px', 'the card still moves down by the bar\'s room');
    assert.equal(bar.style.top, '74.5px', '8 px above the card\'s top edge');
    assert.equal(bar.style.left, '16px', 'from the card\'s left edge');
    assert.equal(bar.style.maxWidth, '358px', 'never wider than the card');
    assert.notEqual(bar.style.visibility, 'hidden', 'nothing covers the card: the bar shows');
    // A host sheet (the Comments panel on a phone) opens over the card: the bar hides instead of floating over it.
    const sheet = doc.createElement('aside');
    doc.body.appendChild(sheet);
    const docWithHit = doc as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
    const hadHit = Object.prototype.hasOwnProperty.call(docWithHit, 'elementFromPoint');
    let hit: Element = card;
    docWithHit.elementFromPoint = () => hit;
    try {
      hit = sheet;
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event('resize')); });
      assert.equal(bar.style.visibility, 'hidden', 'covered by the host sheet: hidden');
      assert.equal(bar.style.top, '74.5px', 'it keeps its place');
      hit = card.querySelector('.nui-comment-toolbar-slot') ?? card;
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event('resize')); });
      assert.notEqual(bar.style.visibility, 'hidden', 'the sheet closed: the bar shows again');
    } finally {
      if (hadHit) docWithHit.elementFromPoint = undefined; else delete docWithHit.elementFromPoint;
      sheet.remove();
    }
    // Its keys work as before: Escape cancels the mode, then closes the bar; C shows it again.
    await key(doc.body, 'Escape');
    assert.equal(controller!.commentMode, null);
    await key(doc.body, 'Escape');
    assert.equal(doc.querySelector('.nui-comment-toolbar'), null);
    assert.equal(card.querySelector('.nui-comment-toolbar-slot'), null, 'the slot goes with the bar');
    assert.equal(card.style.getPropertyValue('--nui-comment-toolbar-room'), '', 'and so does the room');
    await key(doc.body, 'c');
    assert.ok(doc.querySelector('.nui-comment-toolbar[data-lifted]'), 'C shows it again in the layer root');
  } finally {
    dom.window.HTMLElement.prototype.getBoundingClientRect = rect;
    win.matchMedia = before;
  }
});

test('On a touch screen a card\'s Done and "..." take a finger: 36px by 44px around the 24px button, the card no taller', () => {
  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  const button = /\n\.nui-comment-act \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(button, /width: 24px; height: 24px;/, 'the button itself stays 24px, so the card keeps its height');
  const touch = css.split('@media (hover: none) {').slice(1).map(part => part.slice(0, part.indexOf('\n}\n')))
    .find(part => part.includes('.nui-comment-act::before')) ?? '';
  const ring = /\.nui-comment-act::before \{([^}]*)\}/.exec(touch)?.[1] ?? '';
  assert.match(ring, /content: ""; position: absolute; inset: -10px -6px;/, 'a ring 10px above and below, 6px each side');
  // 24 + 2 x 10 = 44 tall, 24 + 2 x 6 = 36 wide: the size of the bar's buttons on a phone.
  assert.match(css, /\.nui-comment-bar-btn \{ width: 36px; height: 44px;/);
  assert.match(touch, /\.nui-comment-act \{ position: relative; \}/);
  const gap = Number(/\.nui-comment-actions \{ gap: (\d+)px; \}/.exec(touch)?.[1]);
  assert.ok(gap >= 12, 'two rings 6px wide each side never overlap: the buttons sit at least 12px apart');
  assert.match(touch, /\.nui-comment-actions, \.nui-comment-entry-more \{ opacity: 1; \}/, 'and they are always shown');
});

test('Scope chips count the threads of the status filter, and the scope reads All items', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.deepEqual(controller!.scopeCounts, { anchor: 2, all: 3 });
  await openFilterMenu();
  assert.equal(doc.querySelector('.nui-comment-filter-item[data-scope="all"]')!.textContent, 'All items');
  await key(doc.activeElement ?? doc.body, 'Escape');
  await pickFilter('done');
  assert.deepEqual(controller!.scopeCounts, { anchor: 0, all: 1 });
  await pickFilter('all');
  assert.deepEqual(controller!.scopeCounts, { anchor: 2, all: 4 });
});

test('Pins: numbers stay put per page, and an archived thread keeps no pin unless Done or All shows', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.deepEqual(pinTexts(), ['3', '4']);
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  assert.deepEqual(pinTexts(), ['4'], 'the archived thread leaves the page');
  await pickFilter('done');
  assert.deepEqual(pinTexts(), ['3', '4'], 'the Done filter shows it, with its number unchanged');
  assert.equal(controller!.numberOf(controller!.threads.find(thread => thread.root.recordKey === 'c3')!), 5,
    'the next page keeps counting on the same deck');
});

test('On a phone, starting a mode that points at the page asks the host to show the page', async () => {
  const win = dom.window as unknown as { matchMedia?: (query: string) => unknown };
  const before = win.matchMedia;
  let shown = 0;
  win.matchMedia = query => ({ matches: query === '(max-width: 767px)', media: query, addEventListener() {}, removeEventListener() {} });
  try {
    await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: { showPage: () => { shown += 1; } } }));
    await act(async () => { controller!.startMode('point'); });
    assert.equal(shown, 1);
    assert.equal(controller!.toolBar, true, 'the page tool bar shows the hint');
    await act(async () => { controller!.startMode('page'); });
    assert.equal(shown, 1, 'a comment on the whole page needs no pointing');
  } finally {
    win.matchMedia = before;
  }
});

/** Answers a card's waiting input ask the one way there is: its reply box, then Enter. */
async function replyInCard(threadKey: string, text: string) {
  const box = doc.querySelector(`[data-thread="${threadKey}"] .nui-comment-reply-box textarea`) as HTMLTextAreaElement;
  assert.ok(box, `the card ${threadKey} has its reply box`);
  await type(box, text);
  await key(box, 'Enter');
}

test('An input ask has no field of its own: the card\'s reply box answers it, as one reply naming its ask', async () => {
  const calls: Call[] = [];
  const rows = [row('i1', { body: 'Which title do you want?', author: 'Claude', slide: 'slide-1', needs: 'input',
    createdAt: '2026-10-21T09:00:00.000Z' })];
  const runtime = fakeRuntime(rows, calls);
  await mount(<Harness {...base} />, runtime);
  assert.equal(doc.querySelector('[data-thread="i1"] textarea[aria-label="Your answer"]'), null,
    'no answer field, no Attach or Paste text on the card (Flo, 2026-11-25: redundant with the normal text box)');
  assert.equal(doc.querySelectorAll('[data-thread="i1"] textarea').length, 1, 'one text box: the reply box');
  await replyInCard('i1', 'Shorter');
  assert.deepEqual(calls.map(call => call.op), ['reply'], 'one write: the server records the ask\'s answer from answer_to');
  assert.equal(calls[0]!.input.root_id, 'i1');
  assert.equal(calls[0]!.input.answer_to, 'i1');
  assert.equal(calls[0]!.input.body, 'Shorter');
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'i1')!.answer, 'Shorter');
  assert.ok(doc.querySelector('[data-thread="i1"] .nui-comment-answer'), 'the ask reads answered');
});

test('Other on a choice or a check, by its row or its number: the reply sent next is that question\'s answer in the person\'s words', async () => {
  for (const [needs, options, how] of [['choice', 'Serif | Sans', 'row'], ['check', '', 'number']] as const) {
    const calls: Call[] = [];
    const rows = [row('q1', { body: 'Which font?', author: 'Claude', slide: 'slide-1', needs, ...(options ? { options } : {}),
      createdAt: '2026-10-21T09:00:00.000Z' })];
    const runtime = fakeRuntime(rows, calls);
    await mount(<Harness {...base} />, runtime);
    const card = () => doc.querySelector('[data-thread="q1"]') as HTMLElement;
    if (how === 'row') await click(card().querySelector('.nui-comment-option[data-other]') as HTMLElement);
    else { card().focus(); await settle(); await key(card(), '3'); }
    assert.equal(calls.length, 0, `${needs}: Other alone answers nothing`);
    await replyInCard('q1', 'Didot, in small caps');
    assert.deepEqual(calls.map(call => call.op), ['reply'], `${needs}: one write, the reply`);
    assert.equal(calls[0]!.input.answer_to, 'q1', `${needs}: the reply names its question, so it stops waiting`);
    assert.equal(storeOf(runtime).rows.find(item => item.id === 'q1')!.answer, 'Didot, in small caps');
    assert.match(card().querySelector('.nui-comment-answer')!.textContent!, /Answered below/, `${needs}: the question reads answered`);
    assert.equal(card().querySelector('.nui-comment-options'), null, `${needs}: no more rows`);
  }
  // R after Other opens a plain reply: the Other picked earlier is dropped.
  const dropped: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime([row('q3', { body: 'Which font?', author: 'Claude', slide: 'slide-1',
    needs: 'choice', options: 'Serif | Sans' })], dropped));
  await click(doc.querySelector('[data-thread="q3"] .nui-comment-option[data-other]') as HTMLElement);
  await act(async () => { doc.querySelector('[data-thread="q3"]')!.dispatchEvent(new dom.window.CustomEvent("notis-comment-reply")); });
  await replyInCard('q3', 'A question first');
  assert.equal('answer_to' in writes(dropped, 'reply')[0]!.input, false, 'R after Other is a plain reply');
  // A plain reply on a choice never answers it.
  const plain: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime([row('q2', { body: 'Which font?', author: 'Claude', slide: 'slide-1',
    needs: 'choice', options: 'Serif | Sans' })], plain));
  await replyInCard('q2', 'Why these two?');
  assert.equal('answer_to' in writes(plain, 'reply')[0]!.input, false, 'a reply without Other is a reply');
});

test('C1: the reply that shows an input answer always names its ask in answer_to; a plain reply names none', async () => {
  const calls: Call[] = [];
  const rows = [row('i1', { body: 'Which title do you want?', author: 'Claude', slide: 'slide-1', needs: 'input',
    createdAt: '2026-10-21T09:00:00.000Z' })];
  await mount(<Harness {...base} />, fakeRuntime(rows, calls));
  await replyInCard('i1', 'Shorter');
  assert.equal(writes(calls, 'reply')[0]!.input.answer_to, 'i1', 'the server routes it to the asker and counts it as the answer');
  const plain: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime([row('p1', { body: 'Tighten', slide: 'slide-1' })], plain));
  const thread = controller!.threads.find(item => item.root.recordKey === 'p1')!;
  await act(async () => { await controller!.actions.reply(thread, 'Done'); });
  assert.equal('answer_to' in writes(plain, 'reply')[0]!.input, false);
});

test('C1: an input ask reads answered below from the reply naming it, whatever its words', async () => {
  const rows = [row('i1', { body: 'Which title?', author: 'Claude', slide: 'slide-1', needs: 'input', answer: 'Short',
    createdAt: '2026-10-21T09:00:00.000Z' }),
  row('a1', { body: 'Something longer than the answer', slide: 'slide-1', thread: 'i1', answerTo: 'i1',
    createdAt: '2026-10-21T10:00:00.000Z' })];
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  assert.equal(doc.querySelector('[data-thread="i1"] .nui-comment-answer')!.textContent, 'Answered below, sent to the agent');
});

test('C4: the pane shows it is loading until the first read settles, never No comments for a moment', async () => {
  const runtime = fakeRuntime([], []);
  const held = storeOf(runtime).hold('list');
  await mount(<Harness {...base} />, runtime);
  const loading = doc.querySelector('.nui-comment-loading[role="status"][aria-busy="true"]');
  assert.ok(loading, 'placeholders while the first read runs');
  assert.match(loading!.textContent!, /Loading comments/);
  assert.equal(doc.querySelector('.nui-comment-empty'), null, 'no empty state before the read settles');
  await act(async () => { held.release(); });
  await settle();
  assert.equal(doc.querySelector('.nui-comment-loading'), null);
  assert.match(doc.querySelector('.nui-comment-empty')!.textContent!, /No comments here yet/);
  // French as well.
  const french = fakeRuntime([], [], { locale: 'fr' });
  storeOf(french).hold('list');
  await mount(<Harness {...base} />, french, 'fr');
  assert.match(doc.querySelector('.nui-comment-loading')!.textContent!, /Chargement des commentaires/);
  assert.equal(doc.querySelector('.nui-comment-empty'), null);
});

test('C2: another member\'s comment in the pane is signed with their name, not Notis', async () => {
  const rows = [{ ...row('m1', { body: 'From Alexandre', author: 'Alexandre', slide: 'slide-1' }), created_by_you: false }];
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  const card = doc.querySelector('[data-thread="m1"]')!;
  assert.match(card.textContent!, /Alexandre/);
  assert.doesNotMatch(card.textContent!, /Notis/);
});

test('B4: an input answer shows on its ask at once, while the one reply naming it is saved', async () => {
  const calls: Call[] = [];
  const rows = [row('i1', { body: 'Which title do you want?', author: 'Claude', slide: 'slide-1', needs: 'input',
    createdAt: '2026-10-21T09:00:00.000Z' })];
  const runtime = fakeRuntime(rows, calls);
  await mount(<Harness {...base} />, runtime);
  const held = storeOf(runtime).hold('reply');
  await replyInCard('i1', 'Shorter');
  await settle();
  assert.deepEqual(calls.map(call => call.op), ['reply'], 'no separate answer write');
  assert.match(doc.querySelector('[data-thread="i1"] .nui-comment-answer')!.textContent!, /Shorter|Answered below/,
    'the ask reads answered while the reply is saved');
  await act(async () => { held.release(); });
  await settle();
  assert.deepEqual(calls.map(call => call.op), ['reply']);
});

test('A reply of yours marks the agent replies before it in that thread seen; a later one stays new', async () => {
  const at = (hour: number) => `2026-10-21T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const rows = [
    row('t1', { body: 'Tighten the title', slide: 'slide-1', createdAt: at(9) }),
    row('t1a', { body: 'Done, shorter now', author: 'Claude', slide: 'slide-1', thread: 't1', createdAt: at(10) }),
    row('t2', { body: 'Check the chart', slide: 'slide-1', createdAt: at(9) }),
    row('t2a', { body: 'Fixed the axis', author: 'Claude', slide: 'slide-1', thread: 't2', createdAt: at(10) }),
  ];
  // What counts as new since the last turn (Copy changes reads it); the card itself carries no mark for it.
  const dot = (key: string) => controller!.isNew(controller!.comments.find(comment => comment.recordKey === key)!);
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  assert.ok(dot('t1a') && dot('t2a'), 'both agent replies start new');

  const later = [...rows,
    row('t1b', { body: 'Thanks', slide: 'slide-1', thread: 't1', createdAt: at(11) }),
    row('t1c', { body: 'One more thing', author: 'Claude', slide: 'slide-1', thread: 't1', createdAt: at(12) })];
  await mount(<Harness {...base} />, fakeRuntime(later, []));
  assert.equal(dot('t1a'), false, 'your later reply in the thread marks the agent reply seen');
  assert.ok(dot('t1c'), 'an agent reply after yours is still new');
  assert.ok(dot('t2a'), 'another thread keeps its own');
  assert.equal(doc.querySelector('.nui-comment-new'), null, 'no dot and no bar on a card');
});

test('Consecutive deleted replies read as one Comment deleted line', async () => {
  const rows = [
    row('d1', { body: 'Root', slide: 'slide-1', createdAt: '2026-10-21T09:00:00.000Z' }),
    row('d2', { body: 'x', slide: 'slide-1', thread: 'd1', status: 'Deleted', createdAt: '2026-10-21T10:00:00.000Z' }),
    row('d3', { body: 'y', slide: 'slide-1', thread: 'd1', status: 'Deleted', createdAt: '2026-10-21T11:00:00.000Z' }),
    row('d4', { body: 'Kept', slide: 'slide-1', thread: 'd1', createdAt: '2026-10-21T12:00:00.000Z' }),
    row('d5', { body: 'z', slide: 'slide-1', thread: 'd1', status: 'Deleted', createdAt: '2026-10-21T13:00:00.000Z' }),
  ];
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  assert.equal(doc.querySelectorAll('[data-thread="d1"] .nui-comment-deleted').length, 2, 'd2 and d3 merge; d5 stands alone');
  assert.ok(doc.querySelector('[data-comment="d4"]'));
});

test('French: a chip label keeps a narrow space before its colon, and conversation for manager threads', async () => {
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => ({ c1: [{ threadId: null, title: '', harness: 'claude', status: 'pending' }] }),
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { locale: 'fr', comments }), 'fr');
  await pickFilter('done');
  assert.match(doc.querySelector('.nui-comment-chip[data-chip="done"]')!.getAttribute('aria-label')!, /filtre : Terminés$/);
  await pickFilter('open');
  await click(barButton('more-button')!);
  assert.match(doc.body.textContent!, /Copier les changements depuis le dernier tour/);
  await key(doc.activeElement ?? doc.body, 'Escape');
  assert.equal(replyTo('c1'), 'Répondre à Claude', 'a pending Claude thread: the reply box names who gets it');
});

test('The host hears of thread and draft changes, not of every pointer move', async () => {
  let notified = 0;
  const comments: Partial<SpaceCommentsTransport> = {
    attach(source) {
      source.show(doc.getElementById('panel'));
      const off = source.subscribe(() => { notified += 1; });
      return () => { off(); source.show(null); };
    },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  await act(async () => { controller!.setCommenting(true); });
  await settle();
  const layer = doc.querySelector('.nui-comment-capture') as HTMLElement;
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0,
    toJSON: () => ({}) }) as DOMRect;
  layer.setPointerCapture = () => {};
  await pointer(layer, 'pointerdown', 10, 10);
  const before = notified;
  for (let x = 20; x <= 120; x += 20) await pointer(layer, 'pointermove', x, 60);
  await settle();
  assert.equal(notified, before, 'dragging a zone tells the host nothing');
  await pointer(layer, 'pointerup', 120, 60);
  await settle();
  assert.ok(notified > before, 'the new comment does');
});

test('Z undoes a Done from the pane even when the host holds Z at the same scope (a conversation beside it)', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  // The Manager's own Undo: Z at the detail scope, with nothing of its own to undo here.
  let hostUndo = 0;
  const card = doc.querySelector('[data-thread="c1"]') as HTMLElement;
  card.focus();
  await key(card, 'e');
  assert.deepEqual(calls.at(-1), { op: 'archive', input: { root_id: 'c1' } });
  assert.ok(toastUndo(), 'an Undo toast is offered');
  // Registered after the pane's keys, as a host that renders again registers its own: the latest of a scope goes first.
  const off = engine.registry.register({ id: 'host.undo', keys: 'z', scope: 'detail', label: { en: 'Undo', fr: 'Annuler' }, run: () => { hostUndo += 1; } }, 'host');
  try {
    const pane = doc.querySelector('#panel .nui-comment-pane') as HTMLElement;
    const home = pane.getRootNode() as Document;
    assert.ok(home.activeElement && pane.contains(home.activeElement), 'the focus stayed in the pane when the card left');
    await key(home.activeElement!, 'z');
    assert.deepEqual(calls.at(-1), { op: 'unarchive', input: { root_id: 'c1' } }, 'Z is the toast\'s Undo');
    assert.equal(hostUndo, 0, 'the host\'s Z never ran');
    assert.deepEqual(cards(), ['c2', 'c1']);
    // With no Undo offered, or the focus outside the pane, Z is the host's again.
    await key(home.activeElement ?? doc.body, 'z');
    assert.equal(hostUndo, 1, 'nothing to undo here: the host takes Z');
  } finally {
    off?.();
  }
});

test('E and Shift+E are taken by the pane while focus is in it, even with no card focused', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  const filter = barButton('waiting-toggle') as HTMLElement;
  filter.focus();
  for (const shift of [false, true]) {
    const event = new dom.window.KeyboardEvent('keydown', { key: shift ? 'E' : 'e', shiftKey: shift, bubbles: true, cancelable: true });
    await act(async () => {
      filter.dispatchEvent(event);
      filter.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: shift ? 'E' : 'e', shiftKey: shift, bubbles: true }));
    });
    assert.equal(event.defaultPrevented, true, `${shift ? 'Shift+E' : 'E'} is consumed`);
  }
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Fix round 2: scrolling, reveal, Undo ordering, links batches and rereads, names
// ---------------------------------------------------------------------------

const box = (top: number, height: number, left = 0, width = 300) => () => ({ left, top, width, height, right: left + width,
  bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

test('The pane scrolls its own list: the toast sits under it, outside the scrolled content', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  const pane = doc.querySelector('#panel .nui-comment-pane')!;
  const list = pane.querySelector(':scope > [data-comment-scroll]');
  assert.ok(list, 'the list scrolls inside the pane');
  assert.ok(list!.querySelector('[data-thread="c1"]'), 'the thread cards are in it');
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  const toast = pane.querySelector('.nui-toast-wrap')!;
  assert.ok(toast, 'Undo shows');
  assert.equal(toast.parentElement, pane, 'the toast is a child of the pane itself');
  assert.equal(toast.closest('[data-comment-scroll]'), null, 'never inside the scrolled content');
  // Between the list and the toast: only the slot that shows the host's review run bar while no card is selected.
  const foot = list!.nextElementSibling!;
  assert.equal(`${foot.tagName}:${foot.getAttribute('name')}`, 'SLOT:run-bar');
  assert.ok(foot.nextElementSibling === toast, 'the toast right under the list and the foot');
});

/**
 * A scroller laid out like a browser would: `content` gives each card's top and height inside the list, the list's
 * screen top and height can change (the panel opening), and every rect follows scrollTop. `grow` resizes the list and
 * tells the ResizeObservers, as a panel growing from no height does.
 */
function scrollerModel(list: HTMLElement, content: Record<string, { top: number; height: number }>, total: number) {
  // `scale` is the panel's transform while it scales in (the phone panel grows from the launcher): rects shrink with it,
  // layout sizes (clientHeight, offsetHeight, scrollTop) do not.
  const state = { top: 100, height: 0, scale: 1, scrollTop: 0, writes: [] as number[] };
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => state.height });
  Object.defineProperty(list, 'offsetHeight', { configurable: true, get: () => state.height });
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => total });
  Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => state.scrollTop,
    set: (value: number) => { state.scrollTop = value; state.writes.push(value); } });
  list.scrollBy = (() => { throw new Error('scrolls by a delta from stale rects'); }) as HTMLElement['scrollBy'];
  list.getBoundingClientRect = () => box(state.top, state.height * state.scale)();
  const place = () => {
    for (const [key, at] of Object.entries(content)) {
      const card = list.querySelector(`[data-thread="${key}"]`) as HTMLElement | null;
      if (card) card.getBoundingClientRect = () => box(state.top + (at.top - state.scrollTop) * state.scale, at.height * state.scale)();
    }
  };
  place();
  /** Where a card shows inside the list's visible part: [top, bottom] relative to the list. */
  const shown = (key: string) => [content[key]!.top - state.scrollTop, content[key]!.top + content[key]!.height - state.scrollTop];
  return { state, place, shown };
}

/** Installs a ResizeObserver the test drives: `resize()` tells every observer. Returns the restore. */
function fakeResizeObserver() {
  const observers = new Set<{ callback: () => void }>();
  const before = (dom.window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  (dom.window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe() { observers.add(this); }
    unobserve() {}
    disconnect() { observers.delete(this); }
  };
  return {
    resize: async () => { await act(async () => { for (const item of [...observers]) item.callback(); }); },
    restore: () => { (dom.window as unknown as { ResizeObserver: unknown }).ResizeObserver = before; },
  };
}

test('A deep link scrolls its thread into view once the panel shows, and a pin on the page does too', async () => {
  const sizes = fakeResizeObserver();
  try {
    const many = [...ROWS, ...Array.from({ length: 8 }, (_, index) => row(`m${index}`, { body: `More ${index}`, slide: 'slide-2',
      createdAt: `2026-10-22T0${index}:00:00.000Z` }))];
    // One runtime object throughout: a new one would read the rows again (a host without a query cache).
    const runtime = withHostPanel(fakeRuntime(many, [], { params: { comment: 'c3' } }));
    await mount(<Harness {...base} />, runtime);
    const list = doc.querySelector('[data-comment-scroll]') as HTMLElement;
    const model = scrollerModel(list, { c1: { top: 50, height: 80 }, c3: { top: 600, height: 120 } }, 2000);
    assert.equal(controller!.threadKey, 'c3');
    assert.deepEqual(model.state.writes, [], 'a hidden panel (no height) waits');

    // First open: the panel grows from no height. Its first frame is 90 px high, lower on the screen, and still scaled
    // down to a third (rects measured then are a third of their layout size).
    model.state.height = 90;
    model.state.top = 300;
    model.state.scale = 0.3;
    await sizes.resize();
    await settle();
    // It keeps growing and scaling while the reveal runs, then settles at 400 px.
    for (const [height, top, scale] of [[200, 220, 0.6], [320, 140, 0.9], [400, 100, 1]] as const) {
      model.state.height = height;
      model.state.top = top;
      model.state.scale = scale;
      await sizes.resize();
    }
    await settle();
    const [cardTop, cardBottom] = model.shown('c3');
    assert.ok(cardTop >= 0 && cardBottom <= 400, `the card shows whole once the panel settled (${cardTop} to ${cardBottom})`);
    assert.equal(model.state.scrollTop, 592, 'measured in the list, not the page: the same answer whatever the panel did');

    // A pin on the page picks a card above the visible part: it scrolls up to it.
    await click(doc.querySelectorAll('.nui-comment-pin')[0]!);
    await settle();
    assert.equal(controller!.threadKey, 'c1');
    assert.equal(model.state.scrollTop, 42, 'c1 shows from 8 px under the top');

    // The person scrolls: a reveal still settling stops at once and never pulls the list back.
    await act(async () => { controller!.revealThread(controller!.threads.find(thread => thread.root.recordKey === 'c3')!); });
    const after = model.state.writes.length;
    list.dispatchEvent(new dom.window.Event('wheel'));
    model.state.scrollTop = 0;
    model.state.height = 380;
    await sizes.resize();
    await settle();
    assert.equal(model.state.writes.length, after, 'no scroll after the person took over');
  } finally {
    sizes.restore();
  }
});

test('A deep-link card that grows after the reveal settled is shown whole again, from its top once taller than the list', async () => {
  const sizes = fakeResizeObserver();
  try {
    const many = [...ROWS, ...Array.from({ length: 8 }, (_, index) => row(`m${index}`, { body: `More ${index}`, slide: 'slide-2',
      createdAt: `2026-10-22T0${index}:00:00.000Z` }))];
    const runtime = withHostPanel(fakeRuntime(many, [], { params: { comment: 'c3' } }));
    await mount(<Harness {...base} />, runtime);
    const list = doc.querySelector('[data-comment-scroll]') as HTMLElement;
    const c3 = { top: 600, height: 120 };
    const model = scrollerModel(list, { c3 }, 2000);
    model.state.height = 400;
    await sizes.resize();
    // Long enough for the frame by frame reveal to settle and end.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    assert.equal(model.state.scrollTop, 328, 'the card shows at the bottom of the list');

    // A picture in the card loads: the card grows past the bottom of the list.
    c3.height = 300;
    await sizes.resize();
    const [top, bottom] = model.shown('c3');
    assert.ok(top >= 0 && bottom <= 400, `the grown card shows whole again (${top} to ${bottom})`);

    // It grows taller than the list: it shows from its top.
    c3.height = 700;
    await sizes.resize();
    assert.equal(model.state.scrollTop, 592, 'a card taller than the list shows from 8 px under the top');

    // The person scrolls: the reveal ends and a later growth never pulls the list back.
    list.dispatchEvent(new dom.window.Event('wheel'));
    const writes = model.state.writes.length;
    c3.height = 900;
    await sizes.resize();
    assert.equal(model.state.writes.length, writes, 'no scroll after the person took over');
  } finally {
    sizes.restore();
  }
});

test('New comment while the list is scrolled down scrolls the list up to show the box and its To chip', async () => {
  const sizes = fakeResizeObserver();
  const proto = dom.window.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  try {
    await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: { bestMatch: async () => ({ threadId: 't-1', title: 'Deck polish' }) } }));
    const list = doc.querySelector('[data-comment-scroll]') as HTMLElement;
    const model = scrollerModel(list, {}, 2000);
    model.state.height = 400;
    model.state.scrollTop = 900;
    // The new box opens at the top of the list, under the scope chips (60 px into the list), 150 px high.
    proto.getBoundingClientRect = function (this: HTMLElement) {
      return this.classList.contains('nui-comment-new-box') ? box(model.state.top + 60 - model.state.scrollTop, 150)()
        : original.call(this);
    };
    await act(async () => { controller!.startMode('page'); });
    await settle();
    const head = doc.querySelector('.nui-comment-new-box [data-part="box-pills"]');
    assert.ok(head?.querySelector('.nui-comment-to'), 'the box has its To chip, first on its pill line');
    assert.equal(model.state.scrollTop, 52, 'the list scrolled up to the box, 8 px above it');
    assert.equal(doc.activeElement, doc.querySelector('.nui-comment-new-box textarea'), 'and its field has focus');
  } finally {
    proto.getBoundingClientRect = original;
    sizes.restore();
  }
});

test('revealRequest goes up when a comment is picked on the page, never from the panel, and reaches the host source', async () => {
  let source: { current(): { revealRequest?: number } } | null = null;
  const comments: Partial<SpaceCommentsTransport> = {
    attach(given) {
      source = given as never;
      given.show(doc.getElementById('panel'));
      return () => given.show(null);
    },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  assert.equal(controller!.revealRequest, 0, 'starts at 0');
  assert.equal(source!.current().revealRequest, 0);
  await click(doc.querySelectorAll('.nui-comment-pin')[0]!);
  assert.equal(controller!.revealRequest, 1, 'a pin on the page reveals');
  assert.equal(source!.current().revealRequest, 1, 'the host source carries it');
  await click(doc.querySelector('[data-thread="c2"]')!);
  assert.equal(controller!.threadKey, 'c2');
  assert.equal(controller!.revealRequest, 1, 'a card in the panel does not');
  const card = doc.querySelector('[data-thread="c1"]') as HTMLElement;
  card.focus();
  await key(card, 'Enter');
  assert.equal(controller!.revealRequest, 1, 'nor does the keyboard in the panel');
  await click(doc.querySelectorAll('.nui-comment-pin')[0]!);
  assert.equal(controller!.revealRequest, 2, 'each pick on the page counts, the same thread too');

  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { params: { comment: 'c3' } }));
  assert.equal(controller!.revealRequest, 1, 'a link to one comment reveals it');
});

test('Focus moving between thread cards moves the selected pin with it', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  const pinOf = (key: string) => doc.querySelector(`.nui-comment-pin[aria-label][data-selected]`)?.textContent ?? key;
  (doc.querySelector('[data-thread="c2"]') as HTMLElement).focus();
  await settle();
  assert.equal(controller!.threadKey, 'c2', 'a focused card is the selected thread');
  const first = pinOf('');
  (doc.querySelector('[data-thread="c1"]') as HTMLElement).focus();
  await settle();
  assert.equal(controller!.threadKey, 'c1');
  assert.notEqual(pinOf(''), first, 'the selected pin follows');
  assert.equal(controller!.revealRequest, 0, 'focus in the panel reveals nothing');
});

test('An Undo queued behind a write keeps its fields shown when that write comes back', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} />, runtime);
  const archive = storeOf(runtime).hold('archive');
  const unarchive = storeOf(runtime).hold('unarchive');
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  assert.equal(doc.querySelector('[data-thread="c1"]'), null, 'archived at once');
  await click(toastUndo()!);
  assert.ok(doc.querySelector('[data-thread="c1"]'), 'Undo shows it again at once');
  // The archive is saved and the list reads the row archived at its new revision, while the Undo still waits.
  await act(async () => { archive.release(); });
  await settle();
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'c1')!.status, 'archived');
  assert.deepEqual(calls.map(call => call.op), ['archive', 'unarchive'], 'the Undo is on its way');
  assert.ok(doc.querySelector('[data-thread="c1"]'), 'no flicker back to archived while the Undo is saved');
  await act(async () => { unarchive.release(); });
  await settle();
  assert.ok(doc.querySelector('[data-thread="c1"]'));
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'c1')!.status, 'open');
});

test('The resolved filter name is still accepted by the exported type and the controller', async () => {
  const name: ui.CommentStatusFilter = 'resolved';
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  await act(async () => { controller!.setStatusFilter(name); });
  assert.equal(controller!.statusFilter, 'done');
});

test('A late failed-delete notice never replaces a newer Undo', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} />, runtime);
  storeOf(runtime).fail('remove', 'comment_forbidden');
  const held = storeOf(runtime).hold('remove');
  await threadAction('c1', 'delete');
  const c2 = controller!.threads.find(thread => thread.root.recordKey === 'c2')!.root;
  await act(async () => { controller!.actions.archive(c2); });
  await settle();
  assert.match(doc.querySelector('.nui-toast')!.textContent!, /Comment thread archived/);
  await act(async () => { held.release(); });
  await settle();
  assert.match(doc.querySelector('.nui-toast')!.textContent!, /Comment thread archived/, 'the newer toast stays');
  assert.deepEqual(calls.map(call => call.op), ['remove', 'archive']);
});

test('Links are read at most 200 roots per request, and every answer is kept', async () => {
  const asked: number[] = [];
  const many = Array.from({ length: 450 }, (_, index) => row(`k${index}`, { body: `Note ${index}`, slide: 'slide-1',
    createdAt: '2026-10-21T09:00:00.000Z' }));
  const comments: Partial<SpaceCommentsTransport> = {
    links: async ({ rootIds }) => {
      asked.push(rootIds.length);
      return Object.fromEntries(rootIds.map(key => [key, [{ threadId: `t-${key}`, title: `Thread ${key}` }]]));
    },
  };
  await mount(<Harness {...base} />, fakeRuntime(many, [], { comments }));
  assert.deepEqual([...asked].sort((a, b) => b - a), [200, 200, 50]);
  assert.equal(controller!.routing.goesTo('k0')?.title, 'Thread k0');
  assert.equal(controller!.routing.goesTo('k449')?.title, 'Thread k449');
});

/** Runs `body` with the reread delays (5 s and more) cut to a few milliseconds. */
async function withFastRereads(body: () => Promise<void>) {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) =>
    real(fn, (ms ?? 0) >= 5000 ? 1 : ms, ...rest)) as typeof setTimeout;
  try { await body(); } finally { globalThis.setTimeout = real; }
}

test('Where a reply goes: the real thread once the wake starts it; a pending link and a sent reply read the links again', async () => {
  await withFastRereads(async () => {
    const asked: string[][] = [];
    const comments: Partial<SpaceCommentsTransport> = {
      links: async ({ rootIds }) => {
        asked.push([...rootIds]);
        // The first read finds the thread not started yet; the wake has started it by the next one.
        const started = asked.length > 1;
        return Object.fromEntries(rootIds.filter(key => key === 'c1').map(key => [key, [started
          ? { threadId: 't-7', title: 'Title pass', harness: 'claude' }
          : { threadId: null, title: '', harness: 'claude', status: 'pending' }]]));
      },
    };
    await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
    await settle();
    assert.deepEqual(asked.slice(0, 2).map(keys => keys.includes('c1')), [true, true]);
    assert.deepEqual(asked[1], ['c1'], 'the pending root alone is read again');
    assert.equal(goesToTitle('c1'), 'Title pass', 'the pending link is read again until it names the thread');
    assert.equal(replyTo('c1'), 'Reply to Claude');
    const reads = asked.length;
    await settle();
    assert.equal(asked.length, reads, 'a settled link is not read again');

    // A reply sent on a thread with no link yet reads its links again (the wake may start a thread for it).
    const calls: Call[] = [];
    asked.length = 0;
    await mount(<Harness {...base} />, fakeRuntime(ROWS, calls, { comments }));
    const c2 = controller!.threads.find(thread => thread.root.recordKey === 'c2')!;
    asked.length = 0;
    await act(async () => { await controller!.actions.reply(c2, 'Keep it'); });
    await settle();
    assert.ok(asked.some(keys => keys.length === 1 && keys[0] === 'c2'), 'the reply read c2 again');
  });
});

test('A root a links answer leaves out has no link any more: its cached links are cleared', async () => {
  await withFastRereads(async () => {
    let linked = true;
    const comments: Partial<SpaceCommentsTransport> = {
      links: async ({ rootIds }) => (linked
        ? Object.fromEntries(rootIds.filter(key => key === 'c1').map(key => [key, [{ threadId: 't-1', title: 'Deck polish' }]]))
        : {}),
    };
    await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
    await settle();
    assert.equal(controller!.routing.linksOf('c1')[0]?.threadId, 't-1');
    // The link went away elsewhere (unlinked in the chat): the next read leaves c1 out of its answer.
    linked = false;
    const c1 = controller!.threads.find(thread => thread.root.recordKey === 'c1')!;
    await act(async () => { await controller!.actions.reply(c1, 'Still there?'); });
    await settle();
    assert.deepEqual(controller!.routing.linksOf('c1'), [], 'the missing root reads as no link');
  });
});

test('Two pending new threads for different harnesses stay two links', async () => {
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => ({ c1: [{ threadId: null, title: '', harness: 'claude', status: 'pending' }] }),
    pickThread: async () => ({ newThread: 'codex' }),
    link: async () => ({ threadId: null, title: '', harness: 'codex', status: 'pending' }),
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  assert.equal(replyTo('c1'), 'Reply to Claude');
  await threadAction('c1', 'change');
  assert.equal(replyTo('c1'), 'Reply to Codex', 'the new Codex thread gets the reply');
  assert.deepEqual(controller!.routing.linksOf('c1').map(ref => ref.harness), ['codex', 'claude']);
});

test('A pick shows at once while it is saved, and goes back with a notice when it fails', async () => {
  let finish: (thread: null) => void = () => {};
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => ({ c1: [{ threadId: 't-1', title: 'Deck polish' }] }),
    pickThread: async () => ({ threadId: 't-2', title: 'Chart work' }),
    link: () => new Promise(resolve => { finish = resolve; }),
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  await threadAction('c1', 'change');
  assert.equal(goesToTitle('c1'), 'Chart work', 'the pick shows before the host answers');
  assert.equal(controller!.routing.saving?.('c1'), true);
  const change = (await threadMenu('c1')).change as HTMLButtonElement;
  assert.ok(change.disabled || change.getAttribute('aria-disabled') === 'true', 'no second change while it is saved');
  await closeMenu();
  await act(async () => { finish(null); });
  await settle();
  assert.equal(goesToTitle('c1'), 'Deck polish', 'a failed link goes back');
  assert.equal(controller!.routing.saving?.('c1'), false);
  assert.match(doc.body.textContent!, /Could not save that change/);
});

test('An agent question in a reply gets its answer controls, and the answer goes to that reply', async () => {
  const calls: Call[] = [];
  const rows = [
    row('q1', { body: 'Make the chart bigger', slide: 'slide-1', createdAt: '2026-10-21T09:00:00.000Z' }),
    row('q2', { body: 'Which colour?', author: 'Claude', slide: 'slide-1', thread: 'q1', needs: 'choice', options: 'Blue | Green',
      createdAt: '2026-10-21T10:00:00.000Z' }),
    row('q3', { body: 'What label?', author: 'Claude', slide: 'slide-1', thread: 'q1', needs: 'input',
      createdAt: '2026-10-21T11:00:00.000Z' }),
  ];
  await mount(<Harness {...base} />, fakeRuntime(rows, calls));
  assert.ok(doc.querySelector('[data-thread="q1"] [data-ask="q2"]'), 'the choice ask shows under its reply');
  await click(option('Green', doc.querySelector('[data-ask="q2"]')!)!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'q2', answer: 'Green' } });
  assert.equal(doc.querySelector('[data-ask="q3"] textarea'), null, 'the input ask has no field: the reply box answers it');
  await replyInCard('q1', 'Revenue');
  const [reply] = writes(calls, 'reply');
  assert.equal(reply!.input.answer_to, 'q3', 'the input ask answered is that reply');
  assert.equal(reply!.input.root_id, 'q1');
  assert.equal(reply!.input.body, 'Revenue');
  assert.deepEqual(calls.map(call => call.op), ['answer', 'reply'], 'the answer is posted once, as a reply');
  await settle();
  // The answer reads once: the reply carries the text, the ask says it was answered without repeating it.
  assert.equal(doc.querySelector('[data-ask="q3"] .nui-comment-answer')!.textContent, 'Answered below, sent to the agent');
  const bodies = [...doc.querySelectorAll('[data-thread="q1"] .nui-comment-body, [data-thread="q1"] .nui-comment-answer')]
    .map(el => el.textContent);
  assert.equal(bodies.filter(text => text?.includes('Revenue')).length, 1, 'Revenue shows once in the thread');
});

test('An edit keeps a Change of resolved, and Copy changes reports the edit from Edited at', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  const c4 = controller!.comments.find(comment => comment.recordKey === 'c4')!;
  await act(async () => { await controller!.actions.edit(c4, 'Old note, reworded'); });
  assert.deepEqual(calls.at(-1), { op: 'edit', input: { id: 'c4', body: 'Old note, reworded' } },
    'the text alone: the status stays resolved');

  const [, , , , archived] = comments();
  const edited = { ...archived!, body: 'Old note, reworded', editedAt: '2026-10-21T08:00:00.000Z' };
  assert.deepEqual(commentChangesSince([edited], scope.checkpoint).map(item => item.recordKey), ['c4'],
    'Edited at after the checkpoint is a change');
  const text = commentDigest({ scope, comments: [edited], anchors: ANCHORS, changes: [edited], nowIso: '2026-10-22T00:00:00.000Z' });
  assert.match(text, /Flo edited/);
});

test('Accessible names say whose comment and which thread, in English and French', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.ok(button('Archive the comment thread: Tighten the title'));
  assert.ok(button('More for the comment thread: Tighten the title'), 'the thread\'s "..." names the thread');
  assert.ok(button('More for the reply: Done'), 'a reply\'s "..." names the reply');
  const names = async (open: Promise<Record<string, HTMLElement>>) => {
    const read = Object.fromEntries(Object.entries(await open).map(([action, entry]) => [action, entry.textContent]));
    await closeMenu();
    return read;
  };
  assert.deepEqual(await names(threadMenu('c1')), { 'copy-link': 'Copy link', edit: 'Edit comment', delete: 'Delete the comment thread' });
  assert.deepEqual(await names(replyMenu('r1')), { 'copy-link': 'Copy link', delete: 'Delete this comment' });
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  assert.ok(button('Archiver le fil de commentaires\u202f: Tighten the title'));
  assert.ok(button('Plus pour le fil de commentaires\u202f: Tighten the title'));
  assert.ok(button('Plus pour la réponse\u202f: Done'));
  assert.deepEqual(await names(threadMenu('c1')), { 'copy-link': 'Copier le lien', edit: 'Modifier le commentaire', delete: 'Supprimer le fil de commentaires' });
});

test('A new transport object from the host keeps the pane where it is, with a reply being typed', async () => {
  let shows = 0;
  let hidden = 0;
  const plain = fakeRuntime(ROWS, []);
  const transport = (name: string): SpaceCommentsTransport => ({
    ...storeOf(plain).transport,
    viewer: { name, canEditSpace: true },
    attach(source) {
      // A host that lists the source on its next tick, and hides the pane when the source leaves.
      void Promise.resolve().then(() => { shows += 1; source.show(doc.getElementById('panel')); });
      return () => { hidden += 1; source.show(null); };
    },
  });
  // A real host keeps one query cache across its runtime objects.
  const cached = { ...plain, queryClient: createQueryClient() } as NotisRuntime;
  await mount(<Harness {...base} />, { ...cached, spaceComments: transport('Flo') } as NotisRuntime);
  const reply = () => doc.querySelector('[data-thread="c1"] .nui-comment-compose textarea') as HTMLTextAreaElement;
  const pane = doc.querySelector('#panel .nui-comment-pane');
  assert.ok(pane && reply(), 'the pane shows with its reply box');
  await type(reply(), 'Half a thought');
  await rerender(<Harness {...base} />, { ...cached, spaceComments: transport('Flo') } as NotisRuntime);
  assert.equal(hidden, 1, 'the old transport let go');
  assert.equal(shows, 2, 'the new one listed the source');
  assert.equal(doc.querySelector('#panel .nui-comment-pane'), pane, 'the same pane, never torn down');
  assert.equal(reply().value, 'Half a thought', 'the typed reply is kept');
});

// ---------------------------------------------------------------------------
// The review run: one comment after the other
// ---------------------------------------------------------------------------

/** The host panel as the Portal builds it: a shadow root whose mount the pane draws in. */
const runPanel: Partial<SpaceCommentsTransport> = {
  attach(source) {
    const host = doc.getElementById('panel')!;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const target = shadow.querySelector('[data-notis-comments-mount]')
      ?? shadow.appendChild(Object.assign(doc.createElement('div'), { className: 'mount' }));
    target.setAttribute('data-notis-comments-mount', '');
    source.show(target as HTMLElement);
    return () => source.show(null);
  },
};
const runRoot = () => doc.getElementById('panel')!.shadowRoot!;
const runCards = () => [...runRoot().querySelectorAll('.nui-comment-card')].map(card => card.getAttribute('data-thread'));

/**
 * Runs `body` with a review run going in the host panel: the host says which threads wait, whether the person's setting
 * moves on after an answer and whether another page follows. What the pane reports lands in `events`.
 */
async function withRun(options: { waiting: string[]; advance: boolean; hasNext?: boolean; rows?: readonly SpaceCommentRow[]; calls?: Call[];
  /** Writes the test answers itself (one that waits, one the server refuses), over the store's own. */
  transport?: (store: SpaceCommentsTransport) => Partial<SpaceCommentsTransport> },
  body: (events: ReviewRunEvent[]) => Promise<void>) {
  const events: ReviewRunEvent[] = [];
  const stop = subscribeReviewRunEvents(event => { events.push(event); });
  // The test DOM lays nothing out: the pane counts as on screen.
  const rects = dom.window.HTMLElement.prototype.getClientRects;
  dom.window.HTMLElement.prototype.getClientRects = function shownRects() { return [{}] as unknown as DOMRectList; };
  setWaitingCommentThreads(options.waiting);
  resetReviewRunAnswered();
  try {
    const runtime = fakeRuntime(options.rows ?? ROWS, options.calls ?? [], { comments: runPanel });
    if (options.transport) {
      (runtime as unknown as { commentsExtra: Partial<SpaceCommentsTransport> }).commentsExtra = { ...runPanel, ...options.transport(storeOf(runtime).transport) };
    }
    await mount(<Harness {...base} />, runtime);
    await act(async () => {
      setReviewRunHost({ active: true, startToken: reviewRunHost().startToken + 1, startKey: null, scopeCount: options.waiting.length,
        hasNext: options.hasNext === true, advance: options.advance });
    });
    await settle();
    await settle();
    await body(events);
  } finally {
    stop();
    await act(async () => { setReviewRunHost({ active: false, startKey: null, scopeCount: null, hasNext: false, advance: false, sheet: null }); });
    resetReviewRunAnswered();
    setWaitingCommentThreads(null);
    dom.window.HTMLElement.prototype.getClientRects = rects;
  }
}

test('Review run on a page where nothing waits: widening the list to the whole Space never selects a card of another page by itself', async () => {
  const rows = [
    row('h1', { body: 'Done here', status: 'Resolved', createdAt: '2026-10-21T08:00:00.000Z' }),
    row('o1', { body: 'Waits on the deck', createdAt: '2026-10-21T09:00:00.000Z', page: 'deck-2', needs: 'check', author: 'Claude' }),
  ];
  await withRun({ waiting: ['o1'], advance: false, hasNext: true, rows }, async (events) => {
    assert.equal(controller!.threadKey, null, 'nothing waits on this page: nothing selected');
    await act(async () => { controller!.setPageFilter('space'); });
    await settle();
    await settle();
    assert.equal(controller!.pageFilter, 'space');
    assert.ok(runCards().includes('o1'), 'the other page\'s waiting card is listed');
    assert.equal(controller!.threadKey, null, 'the person widened the list: the run does not cross to the other page');
    assert.equal(events.filter(event => event.type === 'selected').length, 0);
  });
});

test('Review run: it opens on what waits with the first card selected, and J, K and the bar step through the cards', async () => {
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: false, hasNext: true }, async (events) => {
    assert.equal(controller!.waitingFilter, true, 'the run turns "Waiting for you" on');
    assert.equal(controller!.filter, 'all', 'for every item of the page');
    assert.deepEqual(runCards(), ['c3', 'c2', 'c1']);
    assert.equal(controller!.threadKey, 'c3', 'the first card, never the second');
    assert.deepEqual(events.at(-1), { type: 'selected', key: 'c3', direction: 'next', by: 'start' });
    const { words: about, ...shown } = reviewRunPane()!;
    assert.deepEqual(shown, { waiting: true, keys: ['c3', 'c2', 'c1'], waitingKeys: ['c3', 'c2', 'c1'], selected: 'c3', drafting: false });
    assert.equal(about, runRoot().querySelector('.nui-comment-card[data-selected] :is([data-part="quote"], [data-part="place"])')!.textContent,
      'and what the selected card is about, for the one line of a phone\'s sheet');
    assert.equal(runRoot().querySelector('.nui-comment-pane')!.hasAttribute('data-run'), true);
    assert.equal(runRoot().querySelector('.nui-comment-chips, .nui-comment-chip'), null,
      'no chip repeats the pressed toggle: the run\'s count is on its bar');
    assert.equal(runRoot().querySelector('.nui-comment-bar [data-part="waiting-toggle"]')!.getAttribute('aria-pressed'), 'true');
    // The Waiting for you toggle shows the host's own number (what waits in the Space), the same as on its switch.
    await act(async () => { setWaitingCommentCount(7); });
    await settle();
    assert.equal(runRoot().querySelector('.nui-comment-bar [data-part="waiting-toggle"] .nui-comment-count')!.textContent, '7',
      'one meaning: the number on the switch, never the count of this page alone');
    await act(async () => { setWaitingCommentCount(null); });

    await key(doc.body, 'j');
    assert.equal(controller!.threadKey, 'c2', 'J: the next one, wherever the focus is');
    assert.deepEqual(events.at(-1), { type: 'selected', key: 'c2', direction: 'next', by: 'step' });
    await key(doc.body, 'k');
    assert.equal(controller!.threadKey, 'c3', 'K: the previous one');
    await act(async () => { reviewRunCommands()!.step(1); });
    await settle();
    await act(async () => { reviewRunCommands()!.step(1); });
    await settle();
    assert.equal(controller!.threadKey, 'c1', "the bar's arrows step the same way");
    events.length = 0;
    await key(doc.body, 'j');
    assert.deepEqual(events, [{ type: 'end', advance: false }], "past the page's last card the host crosses to the next page");
    assert.equal(controller!.threadKey, 'c1');

    await key(doc.body, 'Escape');
    assert.deepEqual(events.at(-1), { type: 'leave' }, 'Escape leaves the run');
    assert.equal(controller!.waitingFilter, true, 'the panel stays as it is');
  });
});

test('Review run: the bar sits at the top of the selected card, above its quoted words; the pane\'s foot keeps it while none is selected', async () => {
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: false, hasNext: true }, async () => {
    const barSlots = () => [...runRoot().querySelectorAll('slot[name="run-bar"]')];
    const inCard = () => runRoot().querySelector('.nui-comment-card > slot[name="run-bar"]');
    assert.equal(controller!.threadKey, 'c3');
    // The selected card starts with the slot: it comes before where the card sits (its quoted words or its place).
    const card = runRoot().querySelector('.nui-comment-card[data-thread="c3"]')!;
    assert.equal(inCard()?.parentElement, card, 'only the selected card holds it');
    assert.equal(card.firstElementChild, inCard(), 'at the top of the card');
    assert.equal(inCard()!.nextElementSibling?.className, 'nui-comment-top', 'above the quoted words');
    assert.equal(runRoot().querySelectorAll('.nui-comment-card > slot[name="run-bar"]').length, 1);
    // The first slot of the name in the tree takes the host's bar: the card's comes before the pane's foot.
    assert.equal(barSlots()[0], inCard());
    assert.equal(barSlots().at(-1)!.parentElement, runRoot().querySelector('.nui-comment-pane'), 'the foot keeps its slot');
    // It follows the selection.
    await key(doc.body, 'j');
    assert.equal(inCard()?.parentElement?.getAttribute('data-thread'), 'c2');
    // No card selected (a page's last one was marked Done, Escape on a card): only the foot's slot is left.
    await act(async () => { controller!.setThreadKey(null); });
    await settle();
    assert.equal(inCard(), null);
    assert.equal(barSlots().length, 1);
    assert.equal(barSlots()[0]!.parentElement, runRoot().querySelector('.nui-comment-pane'));
  });
  // In the card the host's bar takes the card's width with no line; at the foot the pane draws its line; while the
  // bar is not drawn (out of a run, a phone's keyboard open) neither place keeps a gap or a line.
  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  // (!important: the host page's own reset of margins and borders would otherwise win over a slot's rule.)
  assert.match(css, /\.nui-comment-card > slot\[name="run-bar"\]::slotted\(\*\) \{ margin: -6px -8px -4px !important; \}/);
  assert.match(css, /\.nui-comment-pane > slot\[name="run-bar"\]::slotted\(\*\) \{ flex: none; border-top: 1px solid hsl\(var\(--border\) \/ \.4\) !important; \}/);
  assert.match(css, /slot\[name="run-bar"\]::slotted\(:empty\) \{ display: none !important; \}/);
});

test('A phone\'s comments sheet: the host says its height, and at half the pane shows the selected card alone', async () => {
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: false }, async () => {
    const pane = () => runRoot().querySelector('.nui-comment-pane')!;
    assert.equal(pane().hasAttribute('data-sheet'), false, 'no sheet: a computer, or a phone with no page beside');
    await act(async () => { setReviewRunHost({ sheet: 'half' }); });
    await settle();
    assert.equal(pane().getAttribute('data-sheet'), 'half');
    assert.equal(pane().hasAttribute('data-sheet-card'), true, 'a card is selected: it is the sheet');
    assert.equal(pane().hasAttribute('data-sheet-drafting'), false);
    // Nothing selected: the pane says so, and the list (or what ends it) shows instead.
    await act(async () => { controller!.setThreadKey(null); });
    await settle();
    assert.equal(pane().hasAttribute('data-sheet-card'), false);
    await act(async () => { setReviewRunHost({ sheet: 'low' }); });
    await settle();
    assert.equal(pane().getAttribute('data-sheet'), 'low');
    await act(async () => { setReviewRunHost({ sheet: null }); });
    await settle();
    assert.equal(pane().hasAttribute('data-sheet'), false);
  });
  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  // Low: the host draws its one line. Half: only the selected card, flat, no header row, no Other row.
  assert.match(css, /\.nui-comment-pane\[data-sheet="low"\] \{ display: none; \}/);
  assert.match(css, /\.nui-comment-pane\[data-sheet="half"\] > :is\(\.nui-comment-bar, \.nui-comment-chips\),[\s\S]*?\.nui-comment-pane\[data-sheet="half"\]\[data-sheet-card\] \.nui-comment-card:not\(\[data-selected\]\),[\s\S]*?\{ display: none; \}/);
  assert.match(css, /\.nui-comment-pane\[data-sheet="half"\]\[data-sheet-card\] \.nui-comment-card \{ padding: 0; border-radius: 0; background: none; box-shadow: none; \}/,
    'the card at half is the sheet itself: no tint and no selection ring');
  assert.match(css, /\.nui-comment-pane\[data-sheet="half"\] \.nui-comment-option\[data-other\] \{ display: none; \}/);
  // While the reply is written: the quoted words and the box.
  assert.match(css, /:host\(\[data-writing\]\) \.nui-comment-pane\[data-sheet="half"\] :is\(\.nui-comment-entries, \.nui-comment-actions\) \{ display: none; \}/);
});

test('Review run: a page that holds the focus keeps its keys, and a closed or inert panel takes none', async () => {
  const calls: Call[] = [];
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: true, calls }, async (events) => {
    assert.equal(controller!.threadKey, 'c3');
    // A Space page with keys of its own (j, k, E and digits, as the Reviews Space has) holds the focus.
    const page = doc.body.appendChild(Object.assign(doc.createElement('div'), { tabIndex: 0 }));
    const heard: string[] = [];
    const onPageKey = (event: KeyboardEvent) => { if (!event.defaultPrevented) heard.push(event.key); };
    page.addEventListener('keydown', onPageKey as EventListener);
    try {
      page.focus();
      assert.equal(doc.activeElement, page);
      events.length = 0;
      for (const name of ['j', 'k', 'e', 'r', 'z', '1', '2', 'Enter', 'Escape']) await key(page, name);
      assert.deepEqual(heard, ['j', 'k', 'e', 'r', 'z', '1', '2', 'Enter', 'Escape'], 'the page hears every key, untouched');
      assert.deepEqual(calls.filter(call => ['answer', 'archive', 'reply'].includes(call.op)), [], 'nothing is answered or archived');
      assert.equal(controller!.threadKey, 'c3', 'the selection stays');
      assert.deepEqual(events, [], 'and the run reports nothing');

      // The focus back on the body (a card that left the list no longer holds it): the keys are the run's again.
      page.blur();
      assert.equal(doc.activeElement, doc.body);
      await key(doc.body, 'j');
      assert.equal(controller!.threadKey, 'c2');
      await key(doc.body, 'k');
      assert.equal(controller!.threadKey, 'c3');

      // The right panel closed (it keeps its width, inert), or showing Chat: the run goes on out of sight and takes no key.
      const panel = doc.getElementById('panel')!;
      panel.setAttribute('inert', '');
      // A browser takes the focus out of what turns inert; the test DOM does not.
      (runRoot().activeElement as HTMLElement | null)?.blur();
      assert.equal(doc.activeElement, doc.body);
      heard.length = 0;
      doc.body.addEventListener('keydown', onPageKey as EventListener);
      for (const name of ['e', '1', 'Enter', 'j', 'z']) await key(doc.body, name);
      doc.body.removeEventListener('keydown', onPageKey as EventListener);
      assert.deepEqual(heard, ['e', '1', 'Enter', 'j', 'z'], 'the page keeps them');
      assert.deepEqual(calls.filter(call => ['answer', 'archive', 'reply'].includes(call.op)), [], 'no write to a thread out of sight');
      assert.equal(controller!.threadKey, 'c3');
      panel.removeAttribute('inert');
      await key(doc.body, 'e');
      assert.equal(writes(calls, 'archive').length, 1, 'open again, E marks the selected one Done');
    } finally {
      doc.getElementById('panel')!.removeAttribute('inert');
      page.remove();
    }
  });
});

test('Review run: Enter held, or pressed again while a reply sends through the host\'s box, never answers the card', async () => {
  const calls: Call[] = [];
  const rows = ROWS.map(item => item.id === 'c3' ? { ...item, recommended: 'Bar' } : item);
  let saved: () => void = () => {};
  const stopHost = registerHostComposerHost();
  try {
    await withRun({ waiting: ['c3'], advance: false, calls, rows,
      // The reply is saved only once the test says so: the box stays "sending" meanwhile.
      transport: store => ({ reply: async input => { await new Promise<void>(resolve => { saved = resolve; }); return store.reply(input); } }),
    }, async () => {
      assert.equal(controller!.threadKey, 'c3');
      const request = listHostComposers().find(item => item.props().kind === 'reply'
        && runRoot().querySelector(`[data-thread="c3"] slot[name="${item.id}"]`));
      assert.ok(request, "the card's reply box is the host's composer");
      // The host's field as it is while a reply sends: switched off (`contenteditable="false"`).
      const field = request.box.appendChild(doc.createElement('div'));
      field.setAttribute('role', 'textbox');
      field.setAttribute('contenteditable', 'false');
      const held = (el: Element, name: string) => act(async () => {
        el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, repeat: true, bubbles: true, cancelable: true }));
      });

      let sent: Promise<boolean> = Promise.resolve(false);
      await act(async () => { sent = request.props().send('On it', []); });
      // Enter again while it sends: from the switched-off field, or from the page once the field lost the focus.
      await key(field, 'Enter');
      await key(doc.body, 'Enter');
      await key(doc.body, '1');
      await held(doc.body, 'Enter');
      assert.equal(writes(calls, 'answer').length, 0, 'no option is picked while the reply sends');
      await act(async () => { saved(); await sent; });
      await settle();
      assert.equal(writes(calls, 'reply').length, 1, 'the reply went, once');

      // Sent: the card stays (the setting is off) and its question still waits for a pick.
      await held(doc.body, 'Enter');
      await held(doc.body, '2');
      assert.equal(writes(calls, 'answer').length, 0, 'a key still held down from the send picks nothing');
      await key(field, 'Enter');
      assert.equal(writes(calls, 'answer').length, 0, 'a switched-off field is still a field');
      await key(doc.body, 'Enter');
      assert.deepEqual(writes(calls, 'answer').map(call => (call.input as { answer: string }).answer), ['Bar'],
        'a new press of Enter picks the recommended option');
    });
  } finally {
    stopHost();
  }
});

test('Review run: an answer the server refuses was never given: the card waits again and the numbers come back', async () => {
  const refuse = (): Partial<SpaceCommentsTransport> => ({ answer: async () => { throw new Error('conflict'); } });
  // Setting off: the answer would stay in view on its card.
  let calls: Call[] = [];
  await withRun({ waiting: ['c2', 'c3'], advance: false, calls, transport: refuse }, async (events) => {
    assert.equal(controller!.threadKey, 'c3');
    assert.equal(controller!.waitingCount, 2);
    events.length = 0;
    await key(doc.body, '1');
    await settle();
    assert.deepEqual(events.filter(event => event.type !== 'selected'), [{ type: 'answered', key: 'c3' }, { type: 'restored', key: 'c3' }],
      'the host hears the answer, then that it was taken back');
    assert.deepEqual(reviewRunPane()!.waitingKeys, ['c3', 'c2'], 'the card waits again');
    assert.equal(controller!.waitingCount, 2, 'and counts again');
    assert.equal(controller!.threads.find(thread => thread.root.recordKey === 'c3')!.root.answer, '', 'no answer shows on it');
    assert.ok(runRoot().querySelector('.nui-toast') ?? doc.querySelector('.nui-toast'), 'the failure is said');
  });
  // Setting on, the last card: the run had reached its end when the refusal came.
  calls = [];
  await withRun({ waiting: ['c3'], advance: true, calls, transport: refuse }, async (events) => {
    events.length = 0;
    await key(doc.body, '2');
    await settle();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    assert.deepEqual(events.map(event => event.type), ['end', 'answered', 'restored', 'selected']);
    assert.deepEqual(runCards(), ['c3'], 'the card is listed again, never "All caught up" on a refused answer');
    assert.deepEqual(reviewRunPane()!.waitingKeys, ['c3']);
    assert.equal(controller!.threadKey, 'c3', 'and selected again');
  });
});

test('Review run, setting off: an answer stays in view on its card and no longer counts; Done always moves on; Z undoes', async () => {
  const calls: Call[] = [];
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: false, calls }, async (events) => {
    assert.equal(controller!.threadKey, 'c3');
    await key(doc.body, '2');
    assert.deepEqual(writes(calls, 'answer').length, 1, 'the second option, by its position');
    assert.deepEqual(runCards(), ['c3', 'c2', 'c1'], 'the answered card stays listed');
    assert.equal(controller!.threadKey, 'c3', 'and selected: the answer stays in view');
    assert.deepEqual(reviewRunPane()!.waitingKeys, ['c2', 'c1'], 'it no longer waits');
    assert.ok(events.some(event => event.type === 'answered' && event.key === 'c3'));
    assert.equal(controller!.waitingCount, 2);

    await key(doc.body, 'j');
    assert.equal(controller!.threadKey, 'c2');
    await key(doc.body, 'k');
    assert.equal(controller!.threadKey, 'c3', 'back on the kept card');
    assert.equal(controller!.waitingFilter, true, 'the filter stays on');
    await key(doc.body, 'j');

    await key(doc.body, 'e');
    assert.equal(writes(calls, 'archive').length, 1, 'E marks it Done');
    assert.deepEqual(runCards(), ['c3', 'c1']);
    assert.equal(controller!.threadKey, 'c1', 'Done moves on whatever the setting says');

    await key(doc.body, 'z');
    assert.deepEqual(runCards(), ['c3', 'c2', 'c1'], 'Z brings it back');
    await settle();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    assert.equal(controller!.threadKey, 'c2', 'selected again');
    assert.ok(events.some(event => event.type === 'restored' && event.key === 'c2'));
  });
});

test('Review run: Z is the toast\'s Undo and nothing else: after an answer it changes nothing, and it never reports the wrong card', async () => {
  const calls: Call[] = [];
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: false, calls }, async (events) => {
    // An option picked has no undo: Z after it lists nothing again, counts nothing again and writes nothing.
    await key(doc.body, '1');
    assert.equal(writes(calls, 'answer').length, 1);
    assert.deepEqual(reviewRunPane()!.waitingKeys, ['c2', 'c1']);
    const before = calls.length;
    events.length = 0;
    let passed = false;
    const onPage = (event: KeyboardEvent) => { if (event.key === 'z' && !event.defaultPrevented) passed = true; };
    doc.body.addEventListener('keydown', onPage as EventListener);
    await key(doc.body, 'z');
    doc.body.removeEventListener('keydown', onPage as EventListener);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    assert.equal(passed, true, 'Z is not taken: there is nothing to undo');
    assert.equal(calls.length, before, 'no write');
    assert.deepEqual(events, [], 'nothing is reported restored');
    assert.deepEqual(reviewRunPane()!.waitingKeys, ['c2', 'c1'], 'the answered card does not wait again');
    assert.equal(controller!.waitingCount, 2);
  });

  // Done on one card, an answer on another, then Z: the Done is undone, and it is the Done's card that comes back.
  const again: Call[] = [];
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: false, calls: again }, async (events) => {
    await key(doc.body, 'j');
    assert.equal(controller!.threadKey, 'c2');
    await key(doc.body, 'e');
    assert.equal(writes(again, 'archive').length, 1, 'Done on c2');
    assert.equal(controller!.threadKey, 'c1');
    await key(doc.body, 'k');
    assert.equal(controller!.threadKey, 'c3');
    await key(doc.body, '2');
    assert.equal(writes(again, 'answer').length, 1, 'an answer on c3');
    events.length = 0;
    await key(doc.body, 'z');
    await settle();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    assert.equal(writes(again, 'unarchive').length, 1, 'Z undoes the Done');
    assert.deepEqual(events.filter(event => event.type === 'restored'), [{ type: 'restored', key: 'c2' }],
      'the card that came back is the one reported, never the answered one');
    assert.deepEqual(reviewRunPane()!.waitingKeys, ['c2', 'c1'], 'the answer on c3 stands');
    assert.equal(controller!.threadKey, 'c2', 'the card that came back is selected');
  });
});

test('Review run: turning the Waiting for you toggle off, or picking another filter, leaves the run', async () => {
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: false }, async (events) => {
    assert.equal(controller!.waitingFilter, true);
    events.length = 0;
    await click(runRoot().querySelector('.nui-comment-bar [data-part="waiting-toggle"]')!);
    assert.equal(controller!.waitingFilter, false, 'a press on the toggle shows all comments again');
    assert.deepEqual(events, [{ type: 'leave' }], 'and the host hears that the run is left');
  });
  await withRun({ waiting: ['c1', 'c2', 'c3'], advance: false }, async (events) => {
    events.length = 0;
    await act(async () => { controller!.setStatusFilter('all'); });
    assert.equal(controller!.waitingFilter, false);
    assert.deepEqual(events, [{ type: 'leave' }], 'another filter leaves it too');
    // Out of a run the filter goes on and off without a word to the host.
    await act(async () => { setReviewRunHost({ active: false }); });
    events.length = 0;
    await act(async () => { controller!.setWaitingFilter(true); });
    await act(async () => { reviewRunCommands()!.setWaiting(false); });
    assert.deepEqual(events, []);
  });
});

test('Review run, setting on: an answer and a sent reply move to the next card, and the last one hands over to the host', async () => {
  const calls: Call[] = [];
  await withRun({ waiting: ['c1', 'c3'], advance: true, calls }, async (events) => {
    assert.deepEqual(runCards(), ['c3', 'c1']);
    await key(doc.body, '1');
    assert.equal(writes(calls, 'answer').length, 1);
    assert.deepEqual(runCards(), ['c1'], 'the answered card leaves the list');
    assert.equal(controller!.threadKey, 'c1', 'the next one takes its place, selected');
    assert.deepEqual(events.filter(event => event.type === 'selected').at(-1), { type: 'selected', key: 'c1', direction: 'next', by: 'answer' });

    // R opens the reply box; a sent reply answers the card.
    await key(doc.body, 'r');
    const box = runRoot().querySelector('[data-thread="c1"] .nui-comment-reply-box textarea') as HTMLTextAreaElement;
    assert.ok(box, 'R opens the reply box of the selected card');
    await type(box, 'On it');
    await key(box, 'Enter');
    await settle();
    assert.equal(writes(calls, 'reply').length, 1);
    assert.deepEqual(runCards(), [], 'the last card left');
    assert.deepEqual(events.at(-2), { type: 'end', advance: true }, 'the host takes over: the next page, or the end');
    assert.equal(controller!.threadKey, null);
    assert.equal(runRoot().querySelector('.nui-comment-empty'), null, 'the host says how the run ends, the pane adds no empty state');
  });
});

test('Review run: a list that fills in after the start still starts on its first card', async () => {
  await withRun({ waiting: ['c1'], advance: false }, async () => {
    assert.deepEqual(runCards(), ['c1']);
    assert.equal(controller!.threadKey, 'c1');
    // The host's read of what waits lands a moment later and puts another card first.
    await act(async () => { setWaitingCommentThreads(['c1', 'c3']); });
    await settle();
    assert.deepEqual(runCards(), ['c3', 'c1']);
    assert.equal(controller!.threadKey, 'c3', 'the first card is selected, never the second');
    // Once the person moved, a later change leaves their card alone.
    await key(doc.body, 'j');
    assert.equal(controller!.threadKey, 'c1');
    await act(async () => { setWaitingCommentThreads(['c1', 'c2', 'c3']); });
    await settle();
    assert.equal(controller!.threadKey, 'c1');
  });
});

// ---------------------------------------------------------------------------
// Animations: the next card comes into place
// ---------------------------------------------------------------------------

test('the card that takes the place of one that left is found only when nothing else changed', () => {
  assert.equal(cardThatTookThePlace(['a', 'b', 'c'], ['a', 'c']), 'c', 'b left: c takes its place');
  assert.equal(cardThatTookThePlace(['a', 'b', 'c'], ['b', 'c']), 'b');
  assert.equal(cardThatTookThePlace(['a', 'b', 'c'], ['a', 'b']), null, 'the last card left: nothing takes its place');
  assert.equal(cardThatTookThePlace(['a', 'b'], ['a', 'b']), null);
  assert.equal(cardThatTookThePlace(['a', 'b'], ['a', 'b', 'c']), null, 'a new comment, or Undo: no move');
  assert.equal(cardThatTookThePlace(['a', 'b', 'c'], ['c', 'a']), null, 'another order: another list');
  assert.equal(cardThatTookThePlace(['a', 'b', 'c', 'd'], ['a', 'd']), null, 'a filter took several out');
});

test('After Done or Delete the next card comes into place; a filter change or Undo moves nothing', async () => {
  type Move = { key: string | null; frames: Keyframe[]; duration: number };
  const moves: Move[] = [];
  const proto = dom.window.HTMLElement.prototype as HTMLElement & { animate?: unknown };
  const before = proto.animate;
  proto.animate = function animate(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    if (this.classList.contains('nui-comment-card')) moves.push({ key: this.getAttribute('data-thread'), frames, duration: Number(options.duration) });
    return { cancel() {}, finished: Promise.resolve() } as unknown as Animation;
  } as never;
  try {
    const calls: Call[] = [];
    await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
    assert.deepEqual(cards(), ['c2', 'c1']);
    assert.deepEqual([...moves], [], 'a list that opens moves nothing');
    await click(doc.querySelector('[data-thread="c2"] [data-part="done"]')!);
    assert.deepEqual(cards(), ['c1']);
    assert.deepEqual(moves.map(move => move.key), ['c1'], 'the card that takes the place of the one marked Done');
    assert.equal(moves[0]!.duration, REVIEW_RUN_TRAVEL_MS, 'as long as the next conversation takes');
    assert.deepEqual(moves[0]!.frames, [{ transform: 'translateY(28px)', opacity: 0 }, { transform: 'none', opacity: 1 }], 'from below');
    // Undo brings the card back: nothing slides.
    moves.length = 0;
    await click(toastUndo()!);
    assert.deepEqual(cards(), ['c2', 'c1']);
    assert.deepEqual([...moves], []);
    // Another filter is another list.
    await pickScope('all');
    await pickFilter('all');
    assert.deepEqual([...moves], []);
    // Delete: the next card comes into place too.
    await pickFilter('open');
    assert.deepEqual(cards(), ['c3', 'c2', 'c1']);
    moves.length = 0;
    await threadAction('c1', 'delete');
    await settle();
    assert.deepEqual(cards(), ['c3', 'c2'], 'the last card left: nothing takes its place');
    assert.deepEqual([...moves], []);
    await threadAction('c2', 'delete');
    await settle();
    assert.deepEqual(cards(), ['c3']);
    assert.deepEqual([...moves], [], 'again the last one');
    await click(toastUndo()!);
    await settle();
    assert.deepEqual(cards(), ['c3', 'c2']);
    moves.length = 0;
    await click(doc.querySelector('[data-thread="c3"] [data-part="done"]')!);
    assert.deepEqual(moves.map(move => move.key), ['c2']);
  } finally {
    if (before) proto.animate = before as never; else Reflect.deleteProperty(proto, 'animate');
  }
});
