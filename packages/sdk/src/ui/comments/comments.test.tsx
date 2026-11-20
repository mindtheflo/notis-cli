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
  COMMENT_COLUMNS, CommentPane, CommentPins, applyCommentPatches, commentAnchorOfDraft, commentAttachmentFor, commentBodyParts,
  commentChangesSince, commentDigest, commentDraftOfAnchor, commentFromRow, commentRelativeTime, commentStatusOf, commentThreads,
  isCommentZone, storeStatusOf, useComments,
  type CommentAnchor, type CommentController, type CommentPaneProps, type CommentRecord,
  type UseCommentsOptions,
} from '.';
import * as ui from '..';
import {
  SpaceFileError, type SpaceCommentRow, type SpaceCommentsTransport, type SpaceCommentThreadRef, type SpaceCommentViewer,
} from '../../space';
import { clearCommentDrafts } from './commentDrafts';
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

test('Deprecated stand-in: COMMENT_COLUMNS keeps the retired table\'s names, and nothing reads them', () => {
  assert.deepEqual({ ...COMMENT_COLUMNS }, {
    body: 'Body', scope: 'Deck', anchor: 'Slide', thread: 'Thread', author: 'Author', x: 'X', y: 'Y', w: null, h: null,
    status: 'Status',
    needs: 'Needs', options: 'Options', answer: 'Answer', answeredAt: 'Answered at', change: 'Change',
    changedAt: 'Changed at', example: 'Example', attachments: 'Attachments', editedAt: 'Edited at', time: null,
    answerTo: 'Answer to',
  });
  assert.equal(ui.readCommentRow(ROWS[0]), null);
  assert.deepEqual(ui.commentAuthorCandidates(['Flo']), []);
  assert.equal(ui.isRefusedChoice(new Error('x')), false);
});

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
  const empty = commentDigest({ scope: null, comments: [], anchors: [], changes: [], nowIso: 'x' }, { heading: 'Review', table: 'Notes' });
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
    'COMMENT_FOCUS_PARAM', 'CommentThreadCard', 'NewCommentBox', 'CommentAvatar', 'COMMENT_COLUMNS']) {
    assert.ok(name in ui, `${name} is exported`);
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

function Harness(props: UseCommentsOptions & { pins?: boolean } & Pick<CommentPaneProps, 'order' | 'groupBy'>) {
  const { pins = true, order, groupBy, ...options } = props;
  controller = useComments(options);
  return (
    <div>
      {pins ? <div className="anchor" style={{ position: 'relative' }}><CommentPins controller={controller} /></div> : null}
      <CommentPane controller={controller} order={order} groupBy={groupBy} />
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

/** Opens the filter menu (unless it is open) and picks Open, Done or All. */
async function openFilterMenu() {
  if (!doc.querySelector('.nui-comment-filter-item')) await click(doc.querySelector('.nui-comment-filter')!);
}
async function pickFilter(filter: 'open' | 'done' | 'all') {
  await openFilterMenu();
  const item = doc.querySelector(`[role^="menuitem"] .nui-comment-filter-item[data-filter="${filter}"]`)?.closest('[role^="menuitem"]');
  assert.ok(item, `the filter menu offers ${filter}`);
  await click(item!);
}
const filterCounts = async () => {
  await openFilterMenu();
  const counts = Object.fromEntries([...doc.querySelectorAll('.nui-comment-filter-item')].map(el =>
    [el.getAttribute('data-filter'), Number(el.querySelector('.nui-comment-count')!.textContent)]));
  await key(doc.activeElement ?? doc.body, 'Escape');
  return counts;
};
const toastUndo = () => doc.querySelector('.nui-toast-btn') as HTMLButtonElement | null;
/** The writes of one kind. */
const writes = (calls: Call[], op: MemoryCommentOp) => calls.filter(call => call.op === op);
const scope = { id: 'deck-1', recordKey: PAGE, name: 'Q4 review', checkpoint: '2026-10-20T00:00:00.000Z' };
const base: UseCommentsOptions = { scope, anchors: ANCHORS, anchorKey: 'sk1' };

test('CommentPane: threads of this anchor, pins, replies and the asks', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  assert.deepEqual(cards(), ['c2', 'c1'], 'open threads of slide 1, the newest thread first');
  const pins = [...doc.querySelectorAll('.nui-comment-pin')];
  assert.deepEqual(pins.map(pin => pin.textContent), ['3', '4'],
    'numbered per page (the deck) by creation: c4 and c5, older, keep 1 and 2 though archived and deleted');
  assert.ok(pins[1]!.hasAttribute('data-agent'), 'a pin by someone else is marked');
  assert.equal(pins[0]!.getAttribute('aria-label'), 'Flo: Tighten the title');
  assert.equal(doc.querySelectorAll('.nui-comment-reply').length, 1);
  assert.ok(doc.querySelector('[data-thread="c2"] .nui-comment-new'), 'Claude comment after the checkpoint is new');
  assert.ok(!doc.querySelector('[data-thread="c1"] > header .nui-comment-new'), 'my own comment is never new');
  // The check ask answers through the store's answer.
  await click(button('Looks good')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'c2', answer: 'Looks good' } });
  assert.match(doc.querySelector('[data-thread="c2"] .nui-comment-answer')!.textContent!, /Looks good, sent to the agent/);
  assert.equal(doc.querySelector('[data-thread="c2"] > header .nui-comment-new'), null, 'an answered ask is no longer new');
  assert.equal(doc.querySelector('[data-thread="c2"] .nui-comment-ask-label')!.textContent,
    'Claude needs your check on the change', 'one sentence, the kind in lower case');
});

test('CommentPane: filters (this item, all; the Open, Done and All menu with counts) and an empty state', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.deepEqual(await filterCounts(), { open: 2, done: 0, all: 2 }, 'counts of this item');
  await click([...doc.querySelectorAll('.nui-seg button, [role="radio"]')].find(el => el.textContent?.startsWith('All'))!);
  assert.deepEqual(cards(), ['c3', 'c2', 'c1'], 'flat, the newest thread first (a new reply does not move c1)');
  assert.deepEqual(await filterCounts(), { open: 3, done: 1, all: 4 }, 'deleted threads are never counted');
  await pickFilter('done');
  assert.deepEqual(cards(), ['c4'], 'deleted threads never show');
  assert.match(doc.querySelector('.nui-comment-filter')!.textContent!, /Done/);
  await pickFilter('all');
  assert.deepEqual(cards(), ['c3', 'c2', 'c1', 'c4']);
  await mount(<Harness {...base} anchorKey="nothing" />, fakeRuntime(ROWS, []));
  assert.match(doc.querySelector('.nui-comment-empty')!.textContent!, /No comments here yet/);
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

  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Delete the comment thread: "]')!);
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
  await click(doc.querySelector('[data-comment="r1"] button[aria-label^="Delete "][aria-label*="reply: "]')!);
  assert.equal(doc.querySelector('dialog[open]'), null, 'no confirmation dialog');
  assert.deepEqual(calls.at(-1), { op: 'remove', input: { id: 'r1' } });
  assert.match(doc.querySelector('[data-thread="c1"] .nui-comment-deleted')!.textContent!, /Comment deleted/);
  await key(doc.body, 'z');
  assert.deepEqual(calls.at(-1), { op: 'restore', input: { id: 'r1' } }, 'Z brings the reply back');
  assert.equal(doc.querySelector('.nui-comment-deleted'), null);

  // The first comment: the whole thread goes with it, in one delete (the server keeps the replies for the Bin).
  calls.length = 0;
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Delete the comment thread: "]')!);
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
  assert.ok(doc.querySelector('[data-comment="m3"] button[aria-label^="Delete "][aria-label*="reply: "]'), 'your own reply');
  // The viewer's own reply reads "your reply" on both its buttons, never "Flo's reply" beside "Edit your reply".
  assert.ok(doc.querySelector('[data-comment="m3"] button[aria-label="Edit your reply: Mine again"]'));
  assert.ok(doc.querySelector('[data-comment="m3"] button[aria-label="Delete your reply: Mine again"]'));
  assert.equal(doc.querySelector('[data-comment="m2"] button[aria-label^="Delete "][aria-label*="reply: "]'), null, 'not someone else\'s');
  assert.equal(doc.querySelector('[data-thread="m1"] button[aria-label^="Delete the comment thread: "]'), null,
    'a thread with someone else\'s reply needs edit rights');
  assert.ok(doc.querySelector('[data-thread="o1"] button[aria-label^="Delete the comment thread: "]'), 'a thread all yours');
  assert.equal(doc.querySelector('[data-comment="m2"] button[aria-label^="Edit your reply: "]'), null, 'never edit someone else\'s');

  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: { viewer: { name: 'Flo', canEditSpace: true } } }));
  assert.ok(doc.querySelector('[data-comment="m2"] button[aria-label="Delete Claude’s reply: Agreed"]'), 'an editor deletes anyone\'s');
  assert.ok(doc.querySelector('[data-thread="m1"] button[aria-label^="Delete the comment thread: "]'));

  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: { viewer: undefined } }));
  assert.equal(doc.querySelectorAll('button[aria-label^="Delete"], button[aria-label^="Edit"]').length, 0, 'no viewer, no Delete or Edit');
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
  const edit = (key: string) => Boolean(doc.querySelector(`[data-thread="${key}"] button[aria-label^="Edit "]`));
  const del = (key: string) => Boolean(doc.querySelector(`[data-thread="${key}"] button[aria-label^="Delete the comment thread: "]`));
  assert.ok(edit('a1') && del('a1'), 'the store says you wrote it: Edit and Delete, whatever the old name');
  assert.equal(edit('a2'), false, 'the same name is not enough when the store says someone else wrote it');
  assert.equal(del('a2'), false);
});

test('Edit your own comment in place: it saves the text through the store and reads edited', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...base} />, runtime);
  assert.equal(doc.querySelector('[data-comment="r1"] button[aria-label^="Edit your reply: "]'), null, 'Claude\'s reply is not yours');
  await click(doc.querySelector('[data-thread="c1"] > header button[aria-label^="Edit your comment: "]')!);
  const field = doc.querySelector('[data-thread="c1"] .nui-comment-edit textarea') as HTMLTextAreaElement;
  assert.equal(field.value, 'Tighten the title');
  await type(field, 'Tighten the title, please');
  await key(field, 'Enter');
  assert.deepEqual(calls.at(-1), { op: 'edit', input: { id: 'c1', body: 'Tighten the title, please' } });
  assert.equal(doc.querySelector('[data-thread="c1"] .nui-comment-edit'), null);
  assert.match(doc.querySelector('[data-thread="c1"] .nui-comment-body')!.textContent!, /Tighten the title, please/);
  assert.equal(doc.querySelector('[data-thread="c1"] > header .nui-comment-edited')!.textContent, 'edited');
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'c1')!.body, 'Tighten the title, please');

  await click(doc.querySelector('[data-thread="c1"] > header button[aria-label^="Edit your comment: "]')!);
  const again = doc.querySelector('[data-thread="c1"] .nui-comment-edit textarea') as HTMLTextAreaElement;
  await type(again, 'Shorter title');
  await click(button('Save')!);
  assert.deepEqual(calls.at(-1), { op: 'edit', input: { id: 'c1', body: 'Shorter title' } }, 'Save sends it too');
});

test('Owning thread: the linked thread once at the top of the card (Thread), else Goes to the best match; Change picks another and links it; the title opens it', async () => {
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
  const line = () => doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!;
  assert.match(line().textContent!, /Thread Deck polish/);
  const card = doc.querySelector('[data-thread="c1"]')!;
  assert.ok(card.firstElementChild!.contains(line()), 'once, at the top of the card, above the first comment');
  assert.equal(card.querySelectorAll('[data-part="goes-to"]').length, 1, 'never repeated on the replies');
  assert.equal(card.querySelector('.nui-comment-compose-box [data-part="goes-to"]'), null, 'not under the reply box');
  assert.match(doc.querySelector('[data-thread="c2"] [data-part="goes-to"]')!.textContent!, /Goes to Q4 deck/,
    'no link yet: the best match');
  await click(line().querySelector('.nui-comment-goes-title')!);
  assert.deepEqual(opened, ['t-1']);
  await click(line().querySelector('button[aria-label="Change the thread this goes to"]')!);
  assert.deepEqual(picks, ['t-1']);
  assert.deepEqual(linked, [{ rootId: 'c1', pick: { threadId: 't-2', title: 'Chart work' }, primary: true }]);
  assert.match(line().textContent!, /Thread Chart work/);

  // A pick the host could not link says so instead of silently staying on the old thread.
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: { ...comments, link: async () => null } }));
  await click(line().querySelector('button[aria-label="Change the thread this goes to"]')!);
  assert.match(line().textContent!, /Thread Deck polish/);
  assert.match(doc.body.textContent!, /Could not save that change/);

  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.equal(doc.querySelector('[data-part="goes-to"]'), null, 'a host without links shows no Goes to line');
});

test('Unified comments: the thread\'s buttons end its Thread line and every reply has its own, always shown; flag off keeps them on hover', async () => {
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
  assert.equal(card.getAttribute('data-buttons'), 'shown');
  const threadLine = card.querySelector(':scope > .nui-comment-thread-line')!;
  assert.ok(threadLine.querySelector('[data-part="goes-to"]'), 'the Thread line');
  const bar = threadLine.querySelector(':scope > .nui-comment-actions')!;
  assert.ok(bar, 'the thread\'s buttons sit on the Thread line, after it');
  assert.equal(threadLine.lastElementChild, bar, 'at its right end');
  assert.deepEqual([...bar.querySelectorAll('button')].map(item => item.getAttribute('aria-label')!.split(':')[0]),
    ['Archive the comment thread', 'Copy the link to the comment thread', 'Edit your comment']);
  assert.equal(card.querySelector(':scope > header .nui-comment-actions'), null, 'no longer on the name line');
  // Every reply: Copy link; Edit and Delete only on your own (this viewer cannot edit the Space).
  const labels = (key: string) => [...card.querySelectorAll(`[data-comment="${key}"] .nui-comment-reply-head > .nui-comment-reply-actions button`)]
    .map(item => item.getAttribute('aria-label'));
  assert.deepEqual(labels('m2'), ['Copy the link to the reply: Agreed'], 'someone else\'s reply: Copy link only');
  assert.deepEqual(labels('m3'), ['Copy the link to the reply: Mine again', 'Edit your reply: Mine again', 'Delete your reply: Mine again']);
  // Always shown and quiet: the stylesheet puts them in the flow, seen, and greys their 22px buttons.
  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.nui-comment-card[data-buttons]:is('), css.indexOf('}', css.indexOf('.nui-comment-card[data-buttons]:is(')));
  assert.match(rule, /:is\(\.nui-comment-actions, \.nui-comment-reply-head > \.nui-comment-reply-actions\)/);
  assert.match(rule, /position: static/);
  assert.match(rule, /visibility: visible; opacity: 1; pointer-events: auto/);
  assert.match(css, /\.nui-comment-card\[data-buttons\] :is\(\.nui-comment-actions, \.nui-comment-reply-actions\) \.nui-comment-icon-btn \{\s*width: 22px; height: 22px;[^}]*opacity: \.55/);
  assert.match(css, /\.nui-comment-thread-line \.nui-comment-goes-change \{[^}]*max-width: 0; overflow: hidden;/,
    'Change takes no room on the Thread line until it is hovered or focused');
  assert.match(css, /\.nui-comment-thread-line:is\(:hover, :focus-within\) \.nui-comment-goes-change \{ max-width: 8em; padding: 0 2px; opacity: 1; \}/,
    'Change shows on hover or focus of the Thread line');

  // French: the reply's own Copy link reads in French too.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: linked, locale: 'fr' }), 'fr');
  assert.ok(doc.querySelector('[data-comment="m2"] button[aria-label="Copier le lien de la réponse : Agreed"]'));

  // Flag off (no links from the host): nightly's card, the buttons on the name line and no Copy link on replies.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: { viewer: linked.viewer } }));
  const off = doc.querySelector('[data-thread="m1"]')!;
  assert.equal(off.hasAttribute('data-buttons'), false);
  assert.equal(off.querySelector('.nui-comment-thread-line'), null);
  assert.ok(off.querySelector(':scope > header .nui-comment-actions'));
  assert.equal(off.querySelector('[data-comment="m2"] .nui-comment-reply-actions'), null, 'no buttons on someone else\'s reply');
  assert.equal(off.querySelector('button[aria-label^="Copy the link to the reply"]'), null);
});

test('An agent signs with its band name read out and its harness logo; the logo opens its runtime card on keyboard focus', async () => {
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
  const authors = ['Flo', 'Notis', 'fred-and-the-machine', 'john-trash'];
  await mount(<Harness {...base} authors={authors} />, fakeRuntime(rows, []));
  const reply = doc.querySelector('[data-comment="r1"]')!;
  assert.equal(reply.querySelector('.nui-comment-author')!.textContent, 'Fred And The Machine');
  assert.equal(reply.querySelector('.nui-comment-avatar')!.textContent, 'F');
  assert.equal(doc.querySelector('.nui-comment-agent'), null, 'no From line on a signature: the card names its thread once');
  const badge = reply.querySelector('[data-part="agent-runtime"]') as HTMLElement;
  assert.equal(badge.getAttribute('data-harness'), 'codex');
  assert.equal(badge.getAttribute('tabindex'), '0', 'keyboard reachable');
  assert.equal(badge.querySelector('svg')!.getAttribute('data-harness'), 'codex', 'the Codex logo, inline');
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
  assert.equal(tip.id, badge.getAttribute('aria-describedby'), 'the card describes the logo');
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
  assert.equal(doc.querySelector('[data-thread="c1"] > header [data-part="agent-runtime"]'), null, 'a person: no logo');

  // French: the Portal's words.
  await mount(<Harness {...base} authors={authors} />, fakeRuntime(rows, [], { locale: 'fr' }), 'fr');
  assert.equal(doc.querySelector('[data-comment="r1"] [data-part="agent-runtime"]')!.getAttribute('aria-label'),
    'Fred And The Machine · Codex · Intelligence : Élevé · Vitesse : Rapide · Modèle : gpt-5.5-codex');
});

test('An agent outside Notis holds its thread: Goes to names it outside Notis, the box replies to it, and the card says it has not read the reply yet (SPC-535, SPC-536, SPC-537)', async () => {
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
  const line = () => card().querySelector('[data-part="goes-to"]')!;
  assert.ok(line().hasAttribute('data-outside'));
  assert.equal(line().querySelector('svg')!.getAttribute('data-harness'), 'claude_code', 'its harness logo');
  assert.equal(line().textContent, 'Goes to Velvet Margin Echo·outside Notis Change');
  const box = card().querySelector('textarea')!;
  assert.equal(box.getAttribute('placeholder'), 'Reply to Velvet Margin Echo');
  assert.equal(card().querySelector('[data-part="outside-unread"]')!.textContent, 'Velvet Margin Echo has not read it yet');
  // The signature: its band name, its harness logo and, quiet, the thread it works in.
  const head = card().querySelector('header')!;
  assert.equal(head.querySelector('[data-part="agent-harness"]')!.getAttribute('aria-label'), 'Runs on Claude');
  assert.equal(head.querySelector('[data-part="agent-thread-name"]')!.textContent, 'PR #3851');

  // Read after the reply: no line. The agent wrote last: no line either.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: transport('2026-10-21T11:00:00.000Z') }));
  assert.equal(card().querySelector('[data-part="outside-unread"]'), null);
  await mount(<Harness {...base} />, fakeRuntime([rows[0]], [], { comments: transport(null) }));
  assert.equal(card().querySelector('[data-part="outside-unread"]'), null);
  assert.equal(card().querySelector('textarea')!.getAttribute('placeholder'), 'Reply to Velvet Margin Echo');

  // Change hands the thread to a Notis thread: the claim goes, the box says Reply again.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: transport(null) }));
  await click(line().querySelector('button[aria-label="Change the thread this goes to"]')!);
  assert.deepEqual(linked, [{ rootId: 'c1', pick: { threadId: 't-2', title: 'Chart work' }, primary: true }]);
  assert.match(line().textContent!, /Thread Chart work/);
  assert.equal(line().hasAttribute('data-outside'), false);
  assert.equal(card().querySelector('[data-part="outside-unread"]'), null);

  // French: tu, and a narrow no-break space before a colon.
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { comments: transport(null), locale: 'fr' }), 'fr');
  assert.equal(line().textContent, 'Va à Velvet Margin Echo·hors de Notis Changer');
  assert.equal(card().querySelector('textarea')!.getAttribute('placeholder'), 'Répondre à Velvet Margin Echo');
  assert.equal(card().querySelector('[data-part="outside-unread"]')!.textContent, 'Pas encore lu par Velvet Margin Echo');
  assert.equal(card().querySelector('[data-part="agent-harness"]')!.getAttribute('aria-label'), 'Tourne sur Claude');
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
    const trigger = slide.shadowRoot!.querySelector('.nui-comment-new-btn') as HTMLElement;
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
  await click(doc.querySelector('.nui-comment-new-btn')!);
  assert.deepEqual([...doc.querySelectorAll('[role^="menuitem"]')].map(el => el.textContent),
    ['On a point', 'On a box', 'On items', 'At this moment', 'On the whole page']);
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
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on 2 items');
  let field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Same fix on both');
  await key(field, 'Enter');
  assert.equal(calls.at(-1)!.op, 'insert');
  assert.equal(calls.at(-1)!.input.mode, 'items');
  assert.deepEqual(calls.at(-1)!.input.anchor_keys, ['sk1', 'sk2'], 'the items by record key');
  assert.equal(calls.at(-1)!.input.page_key, PAGE);

  await click(doc.querySelector('.nui-comment-toolbar [data-mode="time"]')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment at 1:24');
  field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Cut here');
  await key(field, 'Enter');
  assert.equal(calls.at(-1)!.input.mode, 'time');
  assert.equal(calls.at(-1)!.input.time_start, 84.5);

  await click(doc.querySelector('.nui-comment-toolbar [data-mode="page"]')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on the whole page');
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
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on 3 items', 'SPC-338 heading kept');
  assert.equal(doc.querySelector('.nui-comment-new-items')!.textContent, 'Book the room, Task 3, Write the brief');
  let field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Same owner for these');
  await key(field, 'Enter');
  assert.deepEqual(calls.at(-1)!.input.anchor_keys, ['tk2', 'tk3', 'tk1']);
  const sent = String(doc.querySelector('.nui-comment-card')!.getAttribute('data-thread'));
  assert.deepEqual(cards(), [sent], 'the new thread shows under This item at once');
  const meta = doc.querySelector(`[data-thread="${sent}"] .nui-comment-meta`)?.textContent
    ?? doc.querySelector(`[data-thread="${sent}"]`)!.textContent!;
  assert.match(meta, /Write the brief, Book the room, Task 3/, 'the thread names its items, in item order');
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
  assert.equal(doc.querySelector('.nui-comment-new-items')!.textContent,
    'Write the brief, Book the room, Send the invites to every speak… +1', 'three names, long ones cut, then +N');
  field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Later');
  await key(field, 'Enter');
  assert.equal(cards().length, 2, 'both threads show under All items');
});

test('Anchor words use the Space\'s own anchor label, in English and French; an old {n} override still reads (SPC-462)', async () => {
  const words = { anchorLabel: { en: 'Slide {n}', fr: 'Diapo {n}' } };
  await mount(<Harness {...base} words={words} />, fakeRuntime(ROWS, []));
  assert.ok(button('Comment on all of Slide 1'), 'the whole-item button names the slide');
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on Slide 1');
  await act(async () => { controller!.cancelPin(); });
  await click(button('Comment on all of Slide 1')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on all of Slide 1');

  await mount(<Harness {...base} words={words} />, fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  assert.ok(button('Commenter Diapo 1 en entier'));
  await click(button('Commenter Diapo 1 en entier')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'Nouveau commentaire sur Diapo 1 en entier');

  const old = { ...words, newCommentOn: { en: 'New note on slide {n}', fr: 'Nouvelle note sur la diapo {n}' } };
  await mount(<Harness {...base} words={old} />, fakeRuntime(ROWS, []));
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New note on slide 1', 'an override with {n} keeps working');
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
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on Item 1');
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
  const copy = doc.querySelector('.nui-comment-copy') as HTMLButtonElement;
  assert.equal(copy.querySelector('.nui-comment-count')!.textContent, '1');
  await click(copy);
  assert.equal(written.length, 1);
  assert.match(written[0]!, /^# Slide comments: Q4 review/);
  assert.equal(checkpoints.length, 1);
  assert.equal(copy.querySelector('.nui-comment-count')!.textContent, '0');
  assert.equal(copy.disabled, true);
  assert.match(doc.body.textContent!, /Copied 1 change/);
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
  const copy = () => doc.querySelector('[data-thread="c1"] button[aria-label^="Copy the link to the comment thread"]') as HTMLButtonElement;
  assert.ok(copy(), 'every card has Copy link, named after its comment');
  await click(copy());
  assert.deepEqual(asked, ['c1']);
  assert.deepEqual(written, ['https://app.notis.ai/spaces/s1?page=dk1&comment=c1']);
  assert.match(doc.querySelector('.nui-toast')!.textContent!, /Link copied/);

  // Without a host address: the page's own address with comment=<root key> in place of an earlier one.
  dom.window.history.replaceState(null, '', '/page?page=dk1&comment=old#top');
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  await click(copy());
  assert.equal(written.at(-1), 'http://localhost/page?page=dk1&comment=c1');
  dom.window.history.replaceState(null, '', '/page');

  // A refused clipboard says so; French words.
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
  });
  const execCommand = doc.execCommand;
  doc.execCommand = () => false;
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Copier le lien du fil de commentaires"]')!);
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
  const copy = () => doc.querySelector('[data-thread="c1"] button[aria-label^="Copy the link to the comment thread"]') as HTMLButtonElement;
  await click(copy());
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
    await click(copy());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.match(doc.querySelector('.nui-toast')!.textContent!, /could not be copied/i);
  } finally {
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = previous;
  }
});

test('French words through the SDK words mechanism, and a Space wording override', async () => {
  await mount(<Harness {...base} words={{ thisAnchor: { en: 'This slide', fr: 'Cette diapositive' } }} />,
    fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  const text = doc.body.textContent!;
  assert.match(text, /Commentaires/);
  assert.match(text, /Cette diapositive/);
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
  await click(button('Comment on all of Item 1')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on all of Item 1');
  assert.equal(doc.querySelector('.nui-comment-pin[data-draft]'), null);
  assert.equal(button('Comment on all of Item 1'), undefined, 'the button gives way to the new comment box');
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
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment');
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
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-choices button')].map(el => el.textContent), ['Neither'],
    'the row keeps only the options no picture names');
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
  assert.equal(doc.querySelector('.nui-comment-choices'), null, 'no empty row when every option has its picture');
  await click([...doc.querySelectorAll('.nui-comment-figure button.nui-btn')].find(el => el.textContent === 'A')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'p3', answer: 'A' } });
});

test('CommentPane: a check offers the labels its author gave, and Looks good or Undo without them', async () => {
  const calls: Call[] = [];
  const rows = [row('k1', { body: 'Keep the spacing fix?', author: 'Codex', slide: 'slide-1', needs: 'check',
    options: 'Approve exact change | Hold' })];
  await mount(<Harness {...base} />, fakeRuntime(rows, calls));
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-choices button')].map(el => el.textContent), ['Approve exact change', 'Hold']);
  await click(button('Hold')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'k1', answer: 'Hold' } });
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.deepEqual([...doc.querySelectorAll('[data-thread="c2"] .nui-comment-choices button')].map(el => el.textContent),
    ['Looks good', 'Undo']);
});

test('Replies show their pictures and links too, and French words', async () => {
  const rows = [
    row('q1', { body: 'Tighten it', slide: 'slide-1' }),
    row('q2', { body: 'New version: https://x.example/v2', author: 'Claude', slide: 'slide-1', thread: 'q1',
      files: [{ name: 'Après.png', url: AFTER }], createdAt: '2026-10-21T12:00:00.000Z' }),
  ];
  await mount(<Harness {...base} />, fakeRuntime(rows, [], { locale: 'fr' }), 'fr');
  const reply = doc.querySelector('.nui-comment-reply')!;
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

test('Drafts outlive the pane: a new comment with its picture, a reply and an answer come back after the page leaves', async () => {
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
  const answer = () => doc.querySelector('[data-ask="ask"] textarea') as HTMLTextAreaElement;
  await type(answer(), 'Half an answer');

  // Another Space opens: the whole page unmounts (its controller too), then comes back.
  await rerender(<div />, runtime);
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'the page is gone');
  await rerender(<Harness {...base} />, runtime);
  assert.equal((doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement).value, 'Half a new comment');
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on Item 1', 'its pin came back too');
  const chip = doc.querySelector('.nui-comment-new-box .nui-comment-file')!;
  assert.equal(chip.getAttribute('data-state'), 'ready', 'the uploaded picture is still attached');
  assert.equal(files.uploads.length, 1, 'and not uploaded again');
  assert.equal(reply().value, 'Half a reply');
  assert.equal(answer().value, 'Half an answer');

  // Sending forgets the draft; Cancel forgets the new comment.
  await click(doc.querySelector('[data-thread="c1"] .nui-comment-compose-box button[aria-label="Send"]')!);
  await settle();
  await click(button('Cancel')!);
  await rerender(<div />, runtime);
  await rerender(<Harness {...base} />, runtime);
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'a cancelled new comment stays gone');
  assert.equal(reply().value, '', 'a sent reply is not brought back');
  assert.equal(answer(), null, 'the reply answered the thread\'s open ask (answer_to): its own field is gone');
  assert.equal(writes(calls, 'reply')[0]!.input.answer_to, 'ask');
  await act(async () => { controller!.placePin('sk1', 0.2, 0.2); });
  assert.equal((doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement).value, '', 'a new comment starts empty');
  assert.equal(doc.querySelector('.nui-comment-new-box .nui-comment-file'), null);
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
  await mount(<Harness {...base} me="Flo" />, fakeRuntime(ROWS, calls, { comments: { viewer: undefined } }));
  assert.equal(controller!.canWrite, false);
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Hello');
  assert.equal(button('Send')!.disabled, true, 'Send stays off while the viewer is unknown');
  await key(field, 'Enter');
  assert.equal(writes(calls, 'insert').length, 0, 'nothing is sent as Flo');

  const named: Call[] = [];
  await mount(<Harness {...base} me="Flo" />, fakeRuntime(ROWS, named, { comments: { viewer: { name: 'Ana', canEditSpace: true } } }));
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

test('Goes to: a failed links read is tried again, and a late answer is kept after the host hands a new transport', async () => {
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
    const line = () => doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!.textContent!;
    assert.equal(line(), 'Goes to Finding where this goes', 'while the read is tried again, no destination is named');
    await act(async () => { await sleep(1700); });
    await settle();
    assert.equal(tries, 2, 'read again once');
    assert.match(line(), /Thread Deck polish/);
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
  assert.match(doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!.textContent!, /Thread Deck polish/);
});

test('Goes to: names nothing while it loads, and a page shown again names its threads at once (QA5)', async () => {
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
  const line = (key: string) => doc.querySelector(`[data-thread="${key}"] [data-part="goes-to"]`) as HTMLElement;
  for (const key of ['c1', 'c2']) {
    assert.ok(line(key).hasAttribute('data-loading'), `${key} loads`);
    assert.equal(line(key).getAttribute('aria-busy'), 'true');
    assert.equal(line(key).textContent, 'Goes to Finding where this goes', 'no guess: neither a new thread nor a best match');
    assert.equal(line(key).querySelector('.nui-comment-goes-change'), null, 'no Change while loading');
    assert.equal(line(key).querySelector('.nui-skel')!.getAttribute('aria-hidden'), 'true');
  }
  await act(async () => { answers[0]!({ c1: [{ threadId: 't-1', title: 'Deck polish' }] }); });
  await settle();
  assert.match(line('c1').textContent!, /^Thread Deck polish/, 'a linked thread names its link at once');
  assert.ok(line('c2').hasAttribute('data-loading'), 'no link: loading until the best match answers');
  await act(async () => { bests[0]!({ threadId: 't-best', title: 'Q4 deck' }); });
  await settle();
  assert.match(line('c2').textContent!, /^Goes to Q4 deck/);

  // Another page, then this one again: the session's last answers show at once while they are read again.
  await rerender(<span />, runtime);
  await rerender(<Harness {...base} />, runtime);
  assert.equal(answers.length, 2, 'read again');
  assert.match(line('c1').textContent!, /^Thread Deck polish/, 'the kept link, at once');
  assert.match(line('c2').textContent!, /^Goes to Q4 deck/, 'the kept best match, at once');
  await act(async () => { answers[1]!({ c1: [{ threadId: 't-2', title: 'Chart work' }] }); });
  await settle();
  assert.match(line('c1').textContent!, /^Thread Chart work/, 'the new answer wins');

  // Another viewer keeps nothing of Flo's.
  const host = (runtime as unknown as { spaceComments: SpaceCommentsTransport }).spaceComments;
  await rerender(<span />, runtime);
  await rerender(<Harness {...base} />,
    { ...runtime, spaceComments: { ...host, viewer: { name: 'Ana', canEditSpace: true } } } as NotisRuntime);
  assert.ok(line('c1').hasAttribute('data-loading'), 'another viewer reads their own');
});

test('Goes to: a failed best match names nothing and the To chip asks to choose, never "a new thread" (SPC-467)', async () => {
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
    const line = (key: string) => doc.querySelector(`[data-thread="${key}"] [data-part="goes-to"]`);
    assert.match(line('c1')!.textContent!, /^Thread Deck polish/, 'a linked thread still names its link');
    assert.equal(line('c2'), null, 'no link and no best match read: no line, never "a new thread"');
    assert.equal(controller!.routing.lost?.('c2'), true);
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
  assert.match(doc.querySelector('[data-thread="c2"] [data-part="goes-to"]')!.textContent!, /^Goes to Q4 deck/);
});

test('Goes to: a reply that wakes another person\'s agent names no line, and is not read again (SPC-467)', async () => {
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
  assert.equal(doc.querySelector('[data-thread="c1"] [data-part="goes-to"]'), null,
    'neither the viewer\'s own link nor the best match is named');
  assert.deepEqual(controller!.routing.linksOf('c1').map(link => link.threadId), ['t-1'], 'the link itself stays listed');
  assert.match(doc.querySelector('[data-thread="c2"] [data-part="goes-to"]')!.textContent!, /^Goes to Q4 deck/);
  const before = reads;
  for (let i = 0; i < 4; i += 1) await act(async () => { await sleep(1_000); });
  assert.equal(reads, before, 'a settled answer is not read again');
});

test('The pane in the host panel: no browser button borders, quiet replies, buttons only where used (SPC-451, mockup B)', () => {
  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} is styled`);
    return css.slice(at, css.indexOf('}', at));
  };
  // The panes draw in the host panel's shadow root, outside .nui-root: they need the same button reset.
  assert.match(css, /:where\([^)]*\.nui-comment-pane[^)]*\) button \{ font: inherit; color: inherit; background: none; border: 0;/);
  // Hidden buttons are hidden, not only transparent: nothing invisible is tapped, and they float, taking no room.
  assert.match(rule('.nui-comment-actions'), /visibility: hidden;/);
  assert.match(css, /\.nui-comment-actions, \.nui-comment-head > \.nui-comment-reply-actions, \.nui-comment-reply-head > \.nui-comment-reply-actions \{\s*position: absolute;/);
  assert.match(css, /@media \(hover: none\) \{\s*\.nui-comment-card:hover \.nui-comment-actions \{ visibility: hidden; opacity: 0; \}\s*\.nui-comment-card\[data-selected\] \.nui-comment-actions \{ visibility: visible; opacity: 1; \}/,
    'on touch only the selected card shows its buttons');
  // A card's reply field is one quiet line; the paperclip and Send show once it is used.
  assert.match(css, /\.nui-comment-card \.nui-comment-compose-box:not\(:focus-within\):not\(:hover\):not\(:has\(\.nui-comment-file\)\)\s+\.nui-comment-compose:has\(> \.nui-comment-input:placeholder-shown\) > \.nui-comment-icon-btn \{ display: none; \}/,
    'shown on hover too, so a click never lands on a button that hid as the focus moved (Safari)');
  assert.match(rule('.nui-comment-compose > .nui-comment-input, .nui-comment-compose > .nui-comment-input:hover'), /background: transparent;/,
    'the reply field holds its buttons: one surface');
  assert.match(rule('.nui-comment-input'), /background: hsl\(var\(--foreground\) \/ \.05\);/, 'an edit or new comment field keeps its fill');
  // A reply's own buttons are reachable from the keyboard: hidden, they are see-through and take no click but Tab
  // reaches them, and the focus shows them, for that reply only.
  assert.match(css, /\.nui-comment-reply-actions \{ display: inline-flex; gap: 2px; opacity: 0; pointer-events: none;/);
  assert.match(css, /\.nui-comment-reply:hover \.nui-comment-reply-actions, \.nui-comment-reply:focus-within \.nui-comment-reply-actions \{\s*opacity: 1; pointer-events: auto; \}/);
  assert.doesNotMatch(css, /\.nui-comment-card(?:(?!\.nui-comment-reply)[^{,])*\s\.nui-comment-reply-actions \{\s*(visibility: visible|opacity: 1)/,
    'nothing about the card (its focus, a sent answer) shows every reply\'s buttons at once (C2 recording)');
  assert.doesNotMatch(css, /\.nui-comment-card:is\(:focus-visible[^{]*\.nui-comment-reply-actions \{/,
    'keyboard focus in the card never shows every reply\'s buttons');
  // One toolbar at a time (SPC-488): a click or a selected card never shows the replies' buttons too, and the comment's
  // own buttons hide while a reply is hovered.
  const pointerCss = css.replace(/@media \(hover: none\) \{[^}]*\}[^}]*\}\s*\}/g, '');
  assert.doesNotMatch(pointerCss, /\.nui-comment-card(:focus-within|\[data-selected\]) \.nui-comment-reply-actions[^{]*\{\s*visibility: visible/,
    'outside touch screens');
  assert.match(css, /\.nui-comment-card:has\(\.nui-comment-reply:is\(:hover, :focus-within\)\) \.nui-comment-actions \{ visibility: hidden; opacity: 0; \}/);
  assert.doesNotMatch(rule('.nui-comment-goes'), /border-bottom/, 'the Goes to line has no rule under it');
  // A passage thread is one card: its field name and quote inside, never floating between cards.
  assert.match(rule('.nui-passage-thread:has(> .nui-passage-anchor)'), /background: hsl\(var\(--foreground\) \/ \.04\);/);
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
  const meta = (key: string) => doc.querySelector(`[data-thread="${key}"] .nui-comment-meta`)!.textContent!;
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
  const parts = [...card.children].map(el => el.matches('.nui-comment-quote-row') ? 'quote'
    : el.matches('[data-part="goes-to"]') ? 'goes-to' : el.matches('header') ? 'head' : null).filter(Boolean);
  assert.equal(parts[0], 'quote', `the quote first, then who wrote: ${parts.join(', ')}`);
  assert.ok(parts.indexOf('head') > 0);
});

test('Goes to: links that keep failing name nothing once given up, never "a new thread" (SPC-467)', async () => {
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
    assert.equal(doc.querySelector('[data-thread="c1"] [data-part="goes-to"]'), null);
    assert.equal(controller!.routing.lost?.('c1'), true);
  } finally {
    console.warn = warn;
  }
});

test('Goes to: the agent thread a reply wakes is named ahead of the links, but it is no link (SPC-467)', async () => {
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
  const line = (key: string) => doc.querySelector(`[data-thread="${key}"] [data-part="goes-to"]`)!;
  assert.match(line('c1').textContent!, /^Goes to Desk work/, 'the replying agent\'s thread, not the best match');
  assert.deepEqual(controller!.routing.linksOf('c1'), [], 'it is no link');
  assert.match(line('c2').textContent!, /^Goes to Agent work/, 'the first comment\'s agent wins over the link');
  assert.deepEqual(controller!.routing.linksOf('c2').map(ref => ref.threadId), ['t-1']);
  // Change on c1 links a thread: a link beats the agent that only replied.
  await click(line('c1').querySelector('.nui-comment-goes-change')!);
  await settle();
  assert.deepEqual(picks, [null], 'the picker marks no link as current');
  assert.match(line('c1').textContent!, /^Thread Chart work/);
  // Change on c2: the first comment's agent still takes replies.
  await click(line('c2').querySelector('.nui-comment-goes-change')!);
  await settle();
  assert.deepEqual(picks, [null, 't-1']);
  assert.match(line('c2').textContent!, /^Goes to Agent work/);
  assert.deepEqual(controller!.routing.linksOf('c2').map(ref => ref.threadId), ['t-2', 't-1']);
});

test('Goes to: a pending thread reads "a new <harness> thread" and opens nothing', async () => {
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => ({ c1: [{ threadId: null, title: '', harness: 'claude', status: 'pending' }] }),
    openThread: () => { throw new Error('nothing to open'); },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  const line = doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!;
  assert.match(line.textContent!, /Goes to a new Claude thread/);
  assert.ok(line.hasAttribute('data-pending'));
  assert.equal(line.querySelector('button.nui-comment-goes-title'), null);
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

test('A Space built for the Comments database still works: useComments({ database: \'comments\' }) reads and writes the store', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  const today = controller!.threads.map(thread => thread.root.recordKey);
  const old = { ...base, database: 'comments', list: 'comments', me: 'Flo', authors: ['Flo', 'Notis'], fallbackAuthor: 'Notis',
    columns: { scope: 'Deck', anchor: 'Slide' }, pageSize: 50 } as UseCommentsOptions;
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness {...old} />, runtime);
  assert.deepEqual(controller!.threads.map(thread => thread.root.recordKey), today, 'the same threads, from the store');
  assert.ok(storeOf(withHostPanel(runtime)).reads() > 0, 'read through the comment store');
  const c2 = controller!.threads.find(thread => thread.root.recordKey === 'c2')!.root;
  await act(async () => { controller!.actions.archive(c2); });
  await settle();
  assert.deepEqual(calls, [{ op: 'archive', input: { root_id: 'c2' } }], 'written to the store, never as a Space action');
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
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Delete the comment thread: "]')!);
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

test('On a touch screen a tapped reply shows its own buttons instead of the comment\'s (SPC-488)', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  const reply = () => doc.querySelector('[data-thread="c1"] .nui-comment-reply[data-comment="r1"]')!;
  await click(reply().querySelector('.nui-comment-reply-text')!);
  assert.equal(controller!.threadKey, 'c1', 'the tap selects the card');
  assert.ok(reply().hasAttribute('data-tapped'), 'and marks the reply tapped');
  await click(doc.querySelector('[data-thread="c1"] > .nui-comment-body')!);
  assert.ok(!reply().hasAttribute('data-tapped'), 'a tap on the comment itself gives its buttons back');
  const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
  assert.match(css, /\.nui-comment-card\[data-selected\] \.nui-comment-reply\[data-tapped\] \.nui-comment-reply-actions \{ opacity: 1; pointer-events: auto; \}/);
  assert.match(css, /\.nui-comment-card\[data-selected\]:has\(\.nui-comment-reply\[data-tapped\]\) \.nui-comment-actions \{ visibility: hidden; opacity: 0; \}/);
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

test('Scope chips count the threads of the status filter, and the scope reads All items', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.deepEqual(controller!.scopeCounts, { anchor: 2, all: 3 });
  assert.ok([...doc.querySelectorAll('button, [role="radio"]')].some(el => el.textContent?.startsWith('All items')));
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

test('An input ask is answered from its own field, and the answer goes back as one reply naming its ask', async () => {
  const calls: Call[] = [];
  const rows = [row('i1', { body: 'Which title do you want?', author: 'Claude', slide: 'slide-1', needs: 'input',
    createdAt: '2026-10-21T09:00:00.000Z' })];
  const runtime = fakeRuntime(rows, calls);
  await mount(<Harness {...base} />, runtime);
  const field = doc.querySelector('[data-thread="i1"] textarea[aria-label="Your answer"]') as HTMLTextAreaElement;
  assert.ok(field, 'the answer field shows in the card');
  await type(field, 'Shorter');
  await click(button('Send the answer')!);
  assert.deepEqual(calls.map(call => call.op), ['reply'], 'one write: the server records the ask\'s answer from answer_to');
  assert.equal(calls[0]!.input.root_id, 'i1');
  assert.equal(calls[0]!.input.answer_to, 'i1');
  assert.equal(calls[0]!.input.body, 'Shorter');
  assert.equal(storeOf(runtime).rows.find(item => item.id === 'i1')!.answer, 'Shorter');
  assert.equal(doc.querySelector('[data-thread="i1"] textarea[aria-label="Your answer"]'), null, 'the ask reads answered');
});

test('C1: the reply that shows an input answer always names its ask in answer_to; a plain reply names none', async () => {
  const calls: Call[] = [];
  const rows = [row('i1', { body: 'Which title do you want?', author: 'Claude', slide: 'slide-1', needs: 'input',
    createdAt: '2026-10-21T09:00:00.000Z' })];
  await mount(<Harness {...base} />, fakeRuntime(rows, calls));
  await type(doc.querySelector('[data-thread="i1"] textarea[aria-label="Your answer"]') as HTMLTextAreaElement, 'Shorter');
  await click(button('Send the answer')!);
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
  await type(doc.querySelector('[data-thread="i1"] textarea[aria-label="Your answer"]') as HTMLTextAreaElement, 'Shorter');
  await click(button('Send the answer')!);
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
  const dot = (key: string) => Boolean(doc.querySelector(`[data-comment="${key}"] .nui-comment-new`));
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  assert.ok(dot('t1a') && dot('t2a'), 'both agent replies start new');

  const later = [...rows,
    row('t1b', { body: 'Thanks', slide: 'slide-1', thread: 't1', createdAt: at(11) }),
    row('t1c', { body: 'One more thing', author: 'Claude', slide: 'slide-1', thread: 't1', createdAt: at(12) })];
  await mount(<Harness {...base} />, fakeRuntime(later, []));
  assert.equal(dot('t1a'), false, 'your later reply in the thread marks the agent reply seen');
  assert.ok(dot('t1c'), 'an agent reply after yours is still new');
  assert.ok(dot('t2a'), 'another thread keeps its dot');
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

test('French: the filter label keeps a narrow space before its colon, and conversation for manager threads', async () => {
  const comments: Partial<SpaceCommentsTransport> = {
    links: async () => ({ c1: [{ threadId: null, title: '', harness: 'claude', status: 'pending' }] }),
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { locale: 'fr', comments }), 'fr');
  assert.match(doc.querySelector('.nui-comment-filter')!.getAttribute('aria-label')!, / : .+, 2$/);
  assert.match(doc.body.textContent!, /Copier les changements depuis le dernier tour/);
  assert.match(doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!.textContent!, /une nouvelle conversation Claude/);
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

test('E and Shift+E are taken by the pane while focus is in it, even with no card focused', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  const filter = doc.querySelector('.nui-comment-filter') as HTMLElement;
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
  assert.equal(list!.nextElementSibling, toast, 'right under the list');
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
    const head = doc.querySelector('.nui-comment-new-box .nui-comment-new-head');
    assert.ok(head?.querySelector('.nui-comment-to'), 'the box has its To chip');
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
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Delete the comment thread: "]')!);
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

test('Goes to names the real thread once the wake starts it: a pending link and a sent reply read the links again', async () => {
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
    const line = () => doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!.textContent!;
    assert.deepEqual(asked.slice(0, 2).map(keys => keys.includes('c1')), [true, true]);
    assert.deepEqual(asked[1], ['c1'], 'the pending root alone is read again');
    assert.match(line(), /Thread Title pass/, 'the pending link is read again until it names the thread');
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
  const line = () => doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!;
  await click(line().querySelector('button[aria-label="Change the thread this goes to"]')!);
  assert.match(line().textContent!, /Goes to a new Codex thread/);
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
  const line = () => doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!;
  await click(line().querySelector('button[aria-label="Change the thread this goes to"]')!);
  assert.match(line().textContent!, /Thread Chart work/, 'the pick shows before the host answers');
  assert.ok(line().hasAttribute('data-saving'));
  assert.equal(line().getAttribute('aria-busy'), 'true');
  assert.equal((line().querySelector('button[aria-label="Change the thread this goes to"]') as HTMLButtonElement).disabled, true);
  await act(async () => { finish(null); });
  await settle();
  assert.match(line().textContent!, /Thread Deck polish/, 'a failed link goes back');
  assert.equal(line().hasAttribute('data-saving'), false);
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
  await click([...doc.querySelectorAll('[data-ask="q2"] button')].find(el => el.textContent === 'Green')!);
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'q2', answer: 'Green' } });
  const field = doc.querySelector('[data-ask="q3"] textarea') as HTMLTextAreaElement;
  await type(field, 'Revenue');
  await click(doc.querySelector('[data-ask="q3"] button[aria-label="Send the answer"]')!);
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
  assert.ok(button('Delete the comment thread: Tighten the title'));
  assert.ok(button('Edit your comment: Tighten the title'));
  assert.ok(button('Delete Claude’s reply: Done'));
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  assert.ok(button('Archiver le fil de commentaires : Tighten the title'));
  assert.ok(button('Supprimer la réponse de Claude : Done'));
  assert.ok(button('Modifier ton commentaire : Tighten the title'));
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
