import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { createQueryClient } from '../../queryCache';
import { NotisProvider } from '../../provider';
import type { NotisRuntime } from '../../runtime';
import {
  COMMENT_COLUMNS, CommentPane, CommentPins, applyCommentPatches, commentAttachmentFor, commentBodyParts, commentChangesSince,
  commentAuthorCandidates, commentDigest, commentRelativeTime, commentThreads, isCommentZone, isRefusedChoice, readCommentRow, useComments,
  type CommentAnchor, type CommentController, type CommentPaneProps, type CommentRecord,
  type UseCommentsOptions,
} from '.';
import * as ui from '..';
import {
  SpaceFileError, type SpaceCommentsTransport, type SpaceCommentThreadRef, type SpaceFileUploadInput,
  type SpaceFilesTransport,
} from '../../space';
import { clearCommentDrafts } from './commentDrafts';
import { clearCommentRoutingCache } from './useCommentRouting';

const doc = dom.window.document;
const proto = dom.window.HTMLDialogElement?.prototype as (HTMLDialogElement & { showModal?: () => void }) | undefined;
if (proto && typeof proto.showModal !== 'function') {
  proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
}
Object.defineProperty(globalThis, 'HTMLTextAreaElement', { configurable: true, writable: true, value: dom.window.HTMLTextAreaElement });

// ---------------------------------------------------------------------------
// Fixtures: rows shaped like the Slides Comments table (native typed envelopes)
// ---------------------------------------------------------------------------

const ANCHORS: CommentAnchor[] = [
  { id: 'slide-1', recordKey: 'sk1', order: 1, title: 'Intro' },
  { id: 'slide-2', recordKey: 'sk2', order: 2, title: 'Plan' },
];

function row(key: string, fields: {
  body: string; author?: string; slide?: string; thread?: string; x?: number; y?: number; w?: number; h?: number;
  status?: string; needs?: string;
  options?: string; answer?: string; change?: string; changedAt?: string; createdAt?: string; revision?: number;
  files?: unknown[];
}): Record<string, unknown> {
  const text = (value: string) => ({ type: 'rich_text', rich_text: [{ text: { content: value } }] });
  const select = (value: string) => ({ type: 'select', select: { name: value } });
  const properties: Record<string, unknown> = {
    Deck: { type: 'relation', relation: [{ id: 'deck-1' }] },
    Author: select(fields.author ?? 'Flo'),
    Status: select(fields.status ?? 'Open'),
    Needs: select(fields.needs ?? 'none'),
    Thread: text(fields.thread ?? ''),
    Options: text(fields.options ?? ''),
    Answer: text(fields.answer ?? ''),
    Example: { type: 'checkbox', checkbox: false },
  };
  if (fields.slide) properties.Slide = { type: 'relation', relation: [{ id: fields.slide }] };
  if (fields.x != null) properties.X = { type: 'number', number: fields.x };
  if (fields.y != null) properties.Y = { type: 'number', number: fields.y };
  if (fields.w != null) properties.W = { type: 'number', number: fields.w };
  if (fields.h != null) properties.H = { type: 'number', number: fields.h };
  if (fields.files) properties.Attachments = { type: 'files', files: fields.files };
  if (fields.change) properties.Change = select(fields.change);
  if (fields.changedAt) properties['Changed at'] = { type: 'date', date: { start: fields.changedAt } };
  return {
    id: `id-${key}`, record_key: key, revision: fields.revision ?? 1, title: fields.body,
    created_at: fields.createdAt ?? '2026-10-20T10:00:00.000Z', properties,
  };
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

const comments = () => ROWS.map(item => readCommentRow(item, { authors: ['Flo', 'Claude', 'Notis'] }));

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

test('Comments columns: the Slides Comments table, unchanged', () => {
  assert.deepEqual({ ...COMMENT_COLUMNS }, {
    body: 'Body', scope: 'Deck', anchor: 'Slide', thread: 'Thread', author: 'Author', x: 'X', y: 'Y', w: null, h: null,
    status: 'Status',
    needs: 'Needs', options: 'Options', answer: 'Answer', answeredAt: 'Answered at', change: 'Change',
    changedAt: 'Changed at', example: 'Example', attachments: 'Attachments', editedAt: 'Edited at', time: null,
    answerTo: 'Answer to',
  });
});

test('readCommentRow reads typed envelopes, options and an unknown author', () => {
  const [first, second, third] = comments();
  assert.equal(first!.body, 'Tighten the title');
  assert.deepEqual(first!.scopeIds, ['deck-1']);
  assert.deepEqual(first!.anchorIds, ['slide-1']);
  assert.equal(first!.x, 0.25);
  assert.equal(first!.change, 'created');
  assert.equal(second!.needs, 'check');
  assert.deepEqual(third!.options, ['Bar', 'Line']);
  const lines = readCommentRow(row('o', { body: 'Which?', author: 'Claude', needs: 'choice', options: 'Blue\n Green \r\n\n| Red |' }));
  assert.deepEqual(lines.options, ['Blue', 'Green', 'Red'], 'options split on new lines and bars, trimmed, empties dropped');
  const stranger = readCommentRow(row('z', { body: 'Hi', author: 'Mallory' }), { authors: ['Flo'], fallbackAuthor: 'Notis' });
  assert.equal(stranger.author, 'Notis');
});

test('readCommentRow: a row an agent wrote shows the agent, never the fallback, whatever the authors list holds', () => {
  const authors = { authors: ['Flo', 'Claude', 'Notis'], fallbackAuthor: 'Notis' };
  const signed = readCommentRow({ ...row('s1', { body: 'Done', author: 'fred-and-the-machine' }),
    agent: { name: 'fred-and-the-machine' } } as never, authors);
  assert.equal(signed.author, 'fred-and-the-machine');
  assert.equal(ui.agentDisplayName(signed.author), 'Fred And The Machine');
  const unsigned = readCommentRow({ ...row('s2', { body: 'Done', author: '' }), agent: { name: 'cadets-of-the-sky' } } as never, authors);
  assert.equal(unsigned.author, 'cadets-of-the-sky', 'no Author: the stamped agent name');
  const person = readCommentRow(row('s3', { body: 'Hi', author: 'Mallory' }), authors);
  assert.equal(person.author, 'Notis', 'a person outside the list still reads as the fallback');
});

test('C2: a Space member reads as their own name, never Notis, when the Space lists its authors', () => {
  const authors = { authors: ['Flo', 'Claude', 'Notis'], fallbackAuthor: 'Notis' };
  // The server says who created the row (created_by_you for the viewer, or created_by) and owns its Author.
  const member = readCommentRow({ ...row('m1', { body: 'Hi', author: 'Alexandre' }), created_by_you: false }, authors);
  assert.equal(member.author, 'Alexandre');
  const byId = readCommentRow({ ...row('m2', { body: 'Hi', author: 'Camille' }), created_by: 'u-camille' }, authors);
  assert.equal(byId.author, 'Camille');
  const unnamed = readCommentRow({ ...row('m3', { body: 'Hi', author: '' }), created_by_you: false }, authors);
  assert.equal(unnamed.author, 'Notis', 'no Author at all: the fallback');
  const legacy = readCommentRow(row('m4', { body: 'Hi', author: 'Mallory' }), authors);
  assert.equal(legacy.author, 'Notis', 'a row that names no creator keeps the authors list');
});

test('readCommentRow reads the ask a reply answers from Answer to', () => {
  const reply = row('a1', { body: 'Shorter', thread: 'i1' });
  (reply.properties as Record<string, unknown>)['Answer to'] = { type: 'rich_text', rich_text: [{ text: { content: 'i1' } }] };
  assert.equal(readCommentRow(reply).answerTo, 'i1');
  assert.equal(readCommentRow(row('a2', { body: 'Plain', thread: 'i1' })).answerTo, null);
  assert.equal(readCommentRow(reply, { columns: { answerTo: null } }).answerTo, null, 'no column: nothing read');
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
  assert.match(lines[2]!, /with the same Deck and Slide and Thread set to the thread record/);
  assert.match(text, /- Slide 1 "Intro", pin at x 0\.25, y 0\.50: Flo commented "Tighten the title"; status Open \(thread c1\)/);
  assert.match(text, /- Slide 2 "Plan", on the whole slide, no pin: Flo resolved Flo: "Old note"; status Resolved \(thread c4\)/);
  const empty = commentDigest({ scope: null, comments: [], anchors: [], changes: [], nowIso: 'x' }, { heading: 'Review', table: 'Notes' });
  assert.match(empty, /^# Review: Deck/);
  assert.match(empty, /- No changes\./);
});

test('Zones: read only through zone columns, and the digest says where the zone is', () => {
  const zoned = row('z1', { body: 'This block', slide: 'slide-1', x: 0.1, y: 0.2, w: 0.3, h: 0.25, change: 'created',
    changedAt: '2026-10-21T09:00:00.000Z' });
  const plain = readCommentRow(zoned);
  assert.equal(plain.w, null, 'without zone columns a comment is a pin');
  assert.equal(isCommentZone(plain), false);
  const zone = readCommentRow(zoned, { columns: { ...COMMENT_COLUMNS, w: 'W', h: 'H' } });
  assert.equal(zone.w, 0.3);
  assert.equal(isCommentZone(zone), true);
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
  for (const name of ['CommentPane', 'CommentPins', 'CommentThreadCard', 'NewCommentBox', 'CommentAvatar', 'useComments',
    'commentDigest', 'COMMENT_COLUMNS', 'COMMENT_WORDS', 'CommentToolBar', 'useCommentRouting', 'useCommentFocusParam',
    'COMMENT_FOCUS_PARAM']) {
    assert.ok(name in ui, `${name} is exported`);
  }
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface Call { action: string; request: Record<string, unknown> }

let cacheCounter = 0;
function fakeRuntime(rows: Record<string, unknown>[], calls: Call[],
  options: { fail?: boolean; locale?: 'en' | 'fr'; propertyNames?: string[]; params?: Record<string, string>;
    comments?: Partial<SpaceCommentsTransport>; viewerName?: string | null;
    /** Authors the Author choice list refuses, as the database does for a missing option. */
    refusedAuthors?: string[] } = {}) {
  let next = 100;
  return {
    commentsExtra: options.comments,
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: {
      id: 's1', revision: 1, cacheScope: `comments-${cacheCounter += 1}`,
      actions: { 'comments.insert': { readOnly: false }, 'comments.update': { readOnly: false } },
      shows: { comments: { database: 'comments' } },
      bindings: { comments: { kind: 'database', operations: { insert: 'comments.insert', update: 'comments.update' } } },
    },
    context: { params: options.params ?? {}, locale: options.locale ?? 'en',
      viewerName: options.viewerName === undefined ? 'Flo' : options.viewerName },
    shown: async () => ({ rows, schema_revision: 7, ...(options.propertyNames ? { property_names: options.propertyNames } : {}) }),
    callAction: async (action: string, input: { request: Record<string, unknown> }) => {
      calls.push({ action, request: input.request });
      if (options.fail) throw new Error('nope');
      const author = (input.request.properties as Record<string, unknown> | undefined)?.Author;
      if (typeof author === 'string' && options.refusedAuthors?.includes(author)) {
        throw new Error('This choice is missing or ambiguous. Use an existing option ID.');
      }
      return { record_key: `new-${next += 1}`, revision: 2 };
    },
    subscribeDatabase: () => () => {},
  } as unknown as NotisRuntime;
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
function withHostPanel(runtime: NotisRuntime): NotisRuntime {
  if ('spaceComments' in runtime) return runtime;
  const extra = (runtime as unknown as { commentsExtra?: Partial<SpaceCommentsTransport> }).commentsExtra;
  return {
    ...runtime,
    spaceComments: {
      viewer: { name: 'Flo', canEditSpace: true },
      attach(source) {
        source.show(doc.getElementById('panel'));
        return () => source.show(null);
      },
      ...extra,
    },
  } as NotisRuntime;
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
const status = (call: Call | undefined) => (call?.request.properties as Record<string, unknown> | undefined)?.Status;
const scope = { id: 'deck-1', recordKey: 'dk1', name: 'Q4 review', checkpoint: '2026-10-20T00:00:00.000Z' };
const base: UseCommentsOptions = { scope, anchors: ANCHORS, anchorKey: 'sk1', authors: ['Flo', 'Claude', 'Notis'] };

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
  // The check ask answers through an update.
  await click(button('Looks good')!);
  assert.equal(calls.at(-1)!.action, 'comments.update');
  assert.equal(calls.at(-1)!.request.record_key, 'c2');
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Answer, 'Looks good');
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
  await mount(<Harness {...base} anchorKey="sk2" />, fakeRuntime(ROWS, calls));
  await pickFilter('done');
  const field = doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement;
  assert.equal(field.getAttribute('aria-label'), 'Reply');
  await type(field, 'Not quite');
  await key(field, 'Enter', { shift: true });
  assert.equal(calls.length, 0);
  await key(field, 'Enter');
  const insert = calls.find(call => call.action === 'comments.insert')!;
  assert.deepEqual(insert.request.columns, { title: 'Not quite' });
  const props = insert.request.properties as Record<string, unknown>;
  assert.equal(props.Thread, 'c4');
  assert.deepEqual(props.Deck, ['deck-1']);
  assert.deepEqual(props.Slide, ['slide-2']);
  assert.equal(props.Change, 'replied');
  assert.equal(calls.find(call => call.action === 'comments.update'), undefined,
    'a reply never reopens: the server brings a thread back only when a reply waits for someone (SPC-125)');
});

test('A Comments database without the optional columns still takes replies, answers and status changes', async () => {
  // The list answer names its columns: Needs, Options, Answered at, Change, Changed at and Example are missing.
  const propertyNames = ['Body', 'Deck', 'Slide', 'Thread', 'Author', 'X', 'Y', 'Status', 'Answer'];
  const calls: Call[] = [];
  await mount(<Harness {...base} anchorKey="sk2" />, fakeRuntime(ROWS, calls, { propertyNames }));
  await pickFilter('done');
  const field = doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement;
  await type(field, 'Again please');
  await key(field, 'Enter');
  const insert = calls.find(call => call.action === 'comments.insert')!;
  assert.deepEqual(Object.keys(insert.request.properties as object).sort(), ['Author', 'Deck', 'Slide', 'Status', 'Thread']);
  await click(doc.querySelector('[data-thread="c4"] button[aria-label^="Unarchive the comment thread: "]')!);
  const reopen = calls.find(call => call.action === 'comments.update')!;
  assert.deepEqual(reopen.request.properties, { Status: 'Open' }, 'Change and Changed at are left out');
  assert.equal(reopen.request.expected_revision, 1);
  assert.doesNotMatch(doc.body.textContent!, /Could not save that change/);

  // Without a Thread column a reply is refused instead of being saved as a new thread.
  const noThread: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, noThread, { propertyNames: propertyNames.filter(name => name !== 'Thread') }));
  const reply = doc.querySelector('[data-thread="c1"] textarea') as HTMLTextAreaElement;
  await type(reply, 'Hello');
  await key(reply, 'Enter');
  assert.equal(noThread.filter(call => call.action === 'comments.insert').length, 0);
  assert.match(doc.body.textContent!, /Could not save that change/);

  // An older host that names no columns: every column is sent, as before.
  const older: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, older));
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  assert.deepEqual(Object.keys(older.at(-1)!.request.properties as object).sort(), ['Change', 'Changed at', 'Status']);
});

test('CommentPane: Archive with Undo and Z, E and Shift+E, and a failed write rolls back', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  assert.equal(status(calls.at(-1)), 'Resolved', 'archive writes Resolved, shown as Done');
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Change, 'resolved');
  assert.deepEqual(cards(), ['c2'], 'the archived thread leaves the open list');
  assert.match(doc.body.textContent!, /Comment thread archived/);
  assert.ok(toastUndo(), 'an Undo toast is offered');
  // Its accessible name is the word alone: the Z keycap is hidden from screen readers (aria-keyshortcuts says it).
  const named = (el: Element): string => [...el.childNodes].map(node => node.nodeType === 3 ? node.textContent
    : (node as Element).getAttribute('aria-hidden') === 'true' ? '' : named(node as Element)).join('');
  assert.equal(named(toastUndo()!), 'Undo');
  assert.equal(toastUndo()!.getAttribute('aria-keyshortcuts'), 'z');
  await key(doc.body, 'z');
  assert.equal(status(calls.at(-1)), 'Open', 'Z undoes the archive');
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Change, 'created', 'Change goes back as it was');
  assert.deepEqual(cards(), ['c2', 'c1']);

  // E archives the focused thread; Shift+E brings it back.
  const card = doc.querySelector('[data-thread="c2"]') as HTMLElement;
  card.focus();
  await key(card, 'e');
  assert.equal(calls.at(-1)!.request.record_key, 'c2');
  assert.equal(status(calls.at(-1)), 'Resolved');
  await pickFilter('done');
  const archived = doc.querySelector('[data-thread="c2"]') as HTMLElement;
  assert.match(archived.textContent!, /Done/, 'an archived thread reads Done');
  archived.focus();
  await key(archived, 'E', { shift: true });
  assert.equal(status(calls.at(-1)), 'Open');
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

test('Undo of an archive or a delete writes an empty Change and Changed at back as empty', async () => {
  const calls: Call[] = [];
  // c2 was never changed: its Change and Changed at are empty.
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  const props = (call: Call | undefined) => call!.request.properties as Record<string, unknown>;
  await click(doc.querySelector('[data-thread="c2"] button[aria-label^="Archive the comment thread: "]')!);
  assert.equal(props(calls.at(-1)).Change, 'resolved');
  await click(toastUndo()!);
  assert.equal(status(calls.at(-1)), 'Open', 'Undo reopens the thread');
  assert.ok('Change' in props(calls.at(-1)), 'Undo writes Change, not leaves "resolved" behind');
  assert.equal(props(calls.at(-1)).Change, null);
  assert.equal(props(calls.at(-1))['Changed at'], null, 'and the archive time goes too');

  await click(doc.querySelector('[data-thread="c2"] button[aria-label^="Delete the comment thread: "]')!);
  assert.equal(props(calls.at(-1)).Change, 'deleted');
  await click(toastUndo()!);
  assert.equal(status(calls.at(-1)), 'Open', 'Undo brings the thread back');
  assert.equal(props(calls.at(-1)).Change, null, 'Undo of a delete writes the empty Change back');
  assert.equal(props(calls.at(-1))['Changed at'], null);
});

test('Delete at once with Undo: the first comment deletes the thread, a later one leaves a line', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  assert.equal(doc.querySelector('dialog'), null);
  // A reply: only that comment, with a "Comment deleted" line in its place.
  await click(doc.querySelector('[data-comment="r1"] button[aria-label^="Delete "][aria-label*="reply: "]')!);
  assert.equal(doc.querySelector('dialog[open]'), null, 'no confirmation dialog');
  assert.equal(calls.at(-1)!.request.record_key, 'r1');
  assert.equal(status(calls.at(-1)), 'Deleted');
  assert.match(doc.querySelector('[data-thread="c1"] .nui-comment-deleted')!.textContent!, /Comment deleted/);
  await key(doc.body, 'z');
  assert.equal(status(calls.at(-1)), 'Open', 'Z brings the reply back');
  assert.equal(doc.querySelector('.nui-comment-deleted'), null);

  // The first comment: the whole thread, every reply too.
  calls.length = 0;
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Delete the comment thread: "]')!);
  assert.deepEqual(calls.map(call => [call.request.record_key, status(call)]).sort(), [['c1', 'Deleted'], ['r1', 'Deleted']]);
  assert.deepEqual(cards(), ['c2']);
  assert.match(doc.body.textContent!, /Comment thread deleted/);
  await click(toastUndo()!);
  assert.deepEqual(cards(), ['c2', 'c1'], 'Undo brings the thread back');
  assert.deepEqual(calls.slice(2).map(call => status(call)), ['Open', 'Open']);
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

test('Your comments are told by who created them, not the Author name: a renamed person keeps Edit and Delete', async () => {
  const at = (hour: number) => `2026-10-21T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const rows = [
    // Written as "Florian" before the rename; the server says the viewer created it.
    { ...row('a1', { body: 'Before the rename', author: 'Florian', slide: 'slide-1', createdAt: at(8) }), created_by_you: true },
    // Another person also named Flo: the name matches, the creator does not.
    { ...row('a2', { body: 'Another Flo', slide: 'slide-1', createdAt: at(9) }), created_by_you: false },
    // Creator ids against the viewer's id.
    { ...row('b1', { body: 'Mine by id', author: 'Florian', slide: 'slide-1', createdAt: at(10) }), created_by: 'u-flo' },
    { ...row('b2', { body: 'Theirs by id', slide: 'slide-1', createdAt: at(11) }), created_by: 'u-other' },
    // No creator on the row: the Author name still decides.
    row('c1', { body: 'Older host', slide: 'slide-1', createdAt: at(12) }),
  ];
  const viewer = { name: 'Flo', canEditSpace: false, id: 'u-flo' };
  await mount(<Harness {...base} authors={['Flo', 'Florian', 'Claude', 'Notis']} />, fakeRuntime(rows, [], { comments: { viewer } }));
  const edit = (key: string) => Boolean(doc.querySelector(`[data-thread="${key}"] button[aria-label^="Edit "]`));
  const del = (key: string) => Boolean(doc.querySelector(`[data-thread="${key}"] button[aria-label^="Delete the comment thread: "]`));
  assert.ok(edit('a1') && del('a1'), 'the server says you created it: Edit and Delete, whatever the old Author name');
  assert.equal(edit('a2'), false, 'the same name is not enough when the server says someone else created it');
  assert.equal(del('a2'), false);
  assert.ok(edit('b1') && del('b1'), 'your creator id');
  assert.equal(edit('b2'), false, 'another creator id, even under your name');
  assert.ok(edit('c1'), 'a row without its creator falls back to the Author name');
});

test('Edit your own comment in place: it saves the text, writes Edited at when the table has it, and reads edited', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  assert.equal(doc.querySelector('[data-comment="r1"] button[aria-label^="Edit your reply: "]'), null, 'Claude\'s reply is not yours');
  await click(doc.querySelector('[data-thread="c1"] > header button[aria-label^="Edit your comment: "]')!);
  const field = doc.querySelector('[data-thread="c1"] .nui-comment-edit textarea') as HTMLTextAreaElement;
  assert.equal(field.value, 'Tighten the title');
  await type(field, 'Tighten the title, please');
  await key(field, 'Enter');
  const update = calls.at(-1)!;
  assert.equal(update.request.record_key, 'c1');
  assert.deepEqual(update.request.columns, { title: 'Tighten the title, please' });
  const props = update.request.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(props).sort(), ['Change', 'Changed at'],
    'no Edited at column in these rows: the text, and Change and Changed at so Copy changes carries the edit');
  assert.equal(props.Change, 'created', 'a root keeps its change kind');
  assert.ok(Date.parse(String(props['Changed at'])) > Date.parse('2026-10-22T00:00:00.000Z'));
  assert.equal(doc.querySelector('[data-thread="c1"] .nui-comment-edit'), null);
  assert.match(doc.querySelector('[data-thread="c1"] .nui-comment-body')!.textContent!, /Tighten the title, please/);
  assert.equal(doc.querySelector('[data-thread="c1"] > header .nui-comment-edited')!.textContent, 'edited');

  const named: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, named, {
    propertyNames: ['Body', 'Deck', 'Slide', 'Thread', 'Author', 'X', 'Y', 'Status', 'Edited at'],
  }));
  await click(doc.querySelector('[data-thread="c1"] > header button[aria-label^="Edit your comment: "]')!);
  const again = doc.querySelector('[data-thread="c1"] .nui-comment-edit textarea') as HTMLTextAreaElement;
  await type(again, 'Shorter title');
  await click(button('Save')!);
  assert.deepEqual(Object.keys(named.at(-1)!.request.properties as object), ['Edited at']);
});

test('Owning thread: the linked thread once at the top of the card (Thread), else Goes to the best match; Change picks another and links it; the title opens it', async () => {
  const linked: unknown[] = [];
  const opened: string[] = [];
  const picks: unknown[] = [];
  const comments: Partial<SpaceCommentsTransport> = {
    links: async ({ rootKeys }) => Object.fromEntries(rootKeys.filter(key => key === 'c1')
      .map(key => [key, [{ threadId: 't-1', title: 'Deck polish', harness: 'claude' }]])),
    bestMatch: async () => ({ threadId: 't-best', title: 'Q4 deck' }),
    pickThread: async input => { picks.push(input.current); return { threadId: 't-2', title: 'Chart work' }; },
    link: async input => { linked.push(input); return { threadId: 't-2', title: 'Chart work' }; },
    openThread: threadId => { opened.push(threadId); },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  const line = () => doc.querySelector('[data-thread="c1"] [data-part="goes-to"]')!;
  assert.match(line().textContent!, /Thread Deck polish/);
  const card = doc.querySelector('[data-thread="c1"]')!;
  assert.equal(card.firstElementChild, line(), 'once, at the top of the card, above the first comment');
  assert.equal(card.querySelectorAll('[data-part="goes-to"]').length, 1, 'never repeated on the replies');
  assert.equal(card.querySelector('.nui-comment-compose-box [data-part="goes-to"]'), null, 'not under the reply box');
  assert.match(doc.querySelector('[data-thread="c2"] [data-part="goes-to"]')!.textContent!, /Goes to Q4 deck/,
    'no link yet: the best match');
  await click(line().querySelector('.nui-comment-goes-title')!);
  assert.deepEqual(opened, ['t-1']);
  await click(line().querySelector('button[aria-label="Change the thread this goes to"]')!);
  assert.deepEqual(picks, ['t-1']);
  assert.deepEqual(linked, [{ database: 'comments', rootKey: 'c1', pick: { threadId: 't-2', title: 'Chart work' }, primary: true }]);
  assert.match(line().textContent!, /Thread Chart work/);

  // A pick the host could not link says so instead of silently staying on the old thread.
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments: { ...comments, link: async () => null } }));
  await click(line().querySelector('button[aria-label="Change the thread this goes to"]')!);
  assert.match(line().textContent!, /Thread Deck polish/);
  assert.match(doc.body.textContent!, /Could not save that change/);

  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  assert.equal(doc.querySelector('[data-part="goes-to"]'), null, 'a host without links shows no Goes to line');
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

test('agentDisplayName reads a band name with spaces and capitals, and leaves any other name as it is', () => {
  assert.equal(ui.agentDisplayName('fred-and-the-machine'), 'Fred And The Machine');
  assert.equal(ui.agentDisplayName('the-4-tops'), 'The 4 Tops');
  assert.equal(ui.agentDisplayName('Fred And The Machine'), 'Fred And The Machine', 'idempotent: the server may send it read out');
  for (const name of ['Flo', 'Notis', 'claude', 'Jean-Pierre', 'a--b', '-lead', 'trail-', 'UPPER-case']) {
    assert.equal(ui.agentDisplayName(name), name, name);
  }
  const read = readCommentRow({ ...row('a1', { body: 'Hi', author: 'fred-and-the-machine' }),
    agent: { name: 'fred-and-the-machine', runtime: { provider: 'kimi', label: '', model: null, intelligence: 'low', speed: 'flex' } } } as never);
  assert.deepEqual(read.agent!.runtime, { provider: 'kimi', label: null, model: null, intelligence: 'low', effort: null, speed: 'flex' });
  const none = readCommentRow({ ...row('a2', { body: 'Hi' }), agent: { name: 'x-y', runtime: { provider: '' } } } as never);
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
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls, { comments }));
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
  assert.equal(calls.filter(call => call.action === 'comments.insert').length, 1);
  assert.deepEqual(linked, [{ database: 'comments', rootKey: 'new-101', pick: { newThread: 'codex' } }]);

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
  const project = (id: string) => ({ Deck: { type: 'relation', relation: [{ id }] } });
  const rows = [
    { ...row('g1', { body: 'On deck one', createdAt: '2026-10-21T09:00:00.000Z' }) },
    { ...row('g2', { body: 'On deck two', createdAt: '2026-10-21T12:00:00.000Z' }) },
    { ...row('g3', { body: 'Deck one again', createdAt: '2026-10-21T10:00:00.000Z' }) },
  ];
  (rows[1]!.properties as Record<string, unknown>).Deck = project('deck-2').Deck;
  await mount(<Harness authors={['Flo']} pins={false} scopeNames={{ 'deck-2': 'Launch deck' }} />, fakeRuntime(rows, []));
  assert.equal(controller!.wholeSpace, true);
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-group')].map(el => el.textContent), ['Launch deck', 'Page 1']);
  assert.deepEqual(cards(), ['g2', 'g3', 'g1'], 'newest first inside the groups, groups in order of their newest');

  await mount(<Harness authors={['Flo']} pins={false} groupBy={false} order="oldest" />, fakeRuntime(rows, []));
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
  assert.equal(status(calls.at(-1)), 'Resolved');
  assert.deepEqual(cards(), ['c2']);
  assert.ok(toastUndo(), 'an Undo toast is offered');
  // The Portal takes `comment` out of the address in place: the same page, its runtime with new params.
  await rerender(<Harness {...base} />, { ...linked, context: { ...linked.context, params: {} } } as NotisRuntime);
  assert.equal(doc.querySelector('.nui-comment-pane'), pane, 'the pane is the same, never drawn again from scratch');
  assert.deepEqual(cards(), ['c2'], 'the archived thread stays out of the list');
  assert.ok(toastUndo(), 'the Undo toast is still there');
  await click(toastUndo()!);
  assert.equal(status(calls.at(-1)), 'Open', 'and its Undo still works');
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
    controller = useComments({ ...base, onStartItems: () => { itemsAsked += 1; }, currentTime: () => 84.5,
      columns: { time: 'Time' } });
    return (
      <div>
        <ui.CommentToolBar controller={controller} />
        <CommentPane controller={controller} />
      </div>
    );
  }
  await mount(<ModesHarness />, fakeRuntime(ROWS, calls, {
    propertyNames: ['Body', 'Deck', 'Slide', 'Thread', 'Author', 'X', 'Y', 'Status', 'Time'],
  }));
  assert.deepEqual(controller!.modes, ['point', 'items', 'time', 'page']);
  await click(doc.querySelector('.nui-comment-new-btn')!);
  assert.deepEqual([...doc.querySelectorAll('[role^="menuitem"]')].map(el => el.textContent),
    ['On a point', 'On items', 'At this moment', 'On the whole page']);
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
  assert.deepEqual((calls.at(-1)!.request.properties as Record<string, unknown>).Slide, ['slide-1', 'slide-2']);

  await click(doc.querySelector('.nui-comment-toolbar [data-mode="time"]')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment at 1:24');
  field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Cut here');
  await key(field, 'Enter');
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Time, 84.5);

  await click(doc.querySelector('.nui-comment-toolbar [data-mode="page"]')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on the whole page');
  field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Overall too long');
  await key(field, 'Enter');
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Slide, undefined, 'no anchor');
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

test('Add comment mode: Escape leaves it; a pin opens the new comment box, Escape drops it, Enter sends', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  await act(async () => { controller!.setCommenting(true); });
  assert.equal(controller!.commenting, true);
  await key(doc.body, 'Escape');
  assert.equal(controller!.commenting, false);

  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  assert.ok(field);
  assert.equal(doc.activeElement, field, 'the new comment box takes focus');
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on item 1');
  assert.ok(doc.querySelector('.nui-comment-pin[data-draft]'));
  await key(field, 'Escape');
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'Escape in an empty box drops it');

  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const next = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(next, 'Make it bigger');
  await key(next, 'Enter');
  const insert = calls.find(call => call.action === 'comments.insert')!;
  const props = insert.request.properties as Record<string, unknown>;
  assert.equal(props.X, 0.4);
  assert.equal(props.Y, 0.3);
  assert.equal(props.Change, 'created');
  assert.equal(props.Thread, undefined, 'a root has no Thread');
  assert.equal(doc.querySelector('.nui-comment-new-box'), null);
  assert.equal(controller!.threadKey, 'new-101', 'the new thread is selected');
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
    commentLink: ({ rootKey }) => { asked.push(rootKey); return `https://app.notis.ai/spaces/s1?page=dk1&comment=${rootKey}`; },
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
  const asked: Array<{ rootKey: string; database?: string }> = [];
  let page: string | null = 'https://app.notis.ai/view-s1?page=dk1&comment=c1';
  const comments: Partial<SpaceCommentsTransport> = {
    commentLink: input => { asked.push(input); return Promise.resolve(page); },
  };
  await mount(<Harness {...base} />, fakeRuntime(ROWS, [], { comments }));
  const copy = () => doc.querySelector('[data-thread="c1"] button[aria-label^="Copy the link to the comment thread"]') as HTMLButtonElement;
  await click(copy());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  // The host is told which comments database the thread is in, so it can name the thread's page.
  assert.deepEqual(asked, [{ rootKey: 'c1', database: 'comments' }]);
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

const zoneColumns = { w: 'W', h: 'H' };

test('Zones: a press and drag marks a zone in the selection blue, and sends W and H', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} columns={zoneColumns} />, fakeRuntime(ROWS, calls));
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
  const props = calls.find(call => call.action === 'comments.insert')!.request.properties as Record<string, unknown>;
  assert.deepEqual([props.X, props.Y, props.W, props.H], [0.25, 0.3, 0.5, 0.5]);
});

test('Zones: a click or a tiny move drops a pin, and a table without zone columns always gets a pin', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} columns={zoneColumns} />, fakeRuntime(ROWS, calls));
  await act(async () => { controller!.setCommenting(true); });
  await settle();
  await drag(100, 50, 102, 51);
  assert.deepEqual(controller!.draftPin, { anchorKey: 'sk1', x: 0.5, y: 0.5, w: null, h: null });
  assert.equal(doc.querySelector('.nui-comment-zone[data-draft]'), null);

  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  await act(async () => { controller!.setCommenting(true); });
  await settle();
  assert.match(doc.querySelector('.nui-comment-hint')!.textContent!, /Click where the comment goes/);
  await drag(40, 20, 160, 90);
  assert.deepEqual(controller!.draftPin, { anchorKey: 'sk1', x: 0.2, y: 0.2, w: null, h: null }, 'the pin goes where the press started');
});

test('Zones: a saved zone draws its rectangle beside its numbered pin', async () => {
  const rows = [row('z1', { body: 'This block', slide: 'slide-1', x: 0.1, y: 0.2, w: 0.3, h: 0.25 })];
  await mount(<Harness {...base} columns={zoneColumns} />, fakeRuntime(rows, []));
  const zone = doc.querySelector('.nui-comment-zone:not([data-draft])') as HTMLElement;
  assert.equal(zone.style.width, '30%');
  assert.equal(doc.querySelector('.nui-comment-pin')!.getAttribute('aria-label'), 'Flo, on a zone: This block');
});

test('Comment on the whole item: no pin, its own heading, and no X or Y', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  await click(button('Comment on all of item 1')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on all of item 1');
  assert.equal(doc.querySelector('.nui-comment-pin[data-draft]'), null);
  assert.equal(button('Comment on all of item 1'), undefined, 'the button gives way to the new comment box');
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Too many words on this slide');
  await key(field, 'Enter');
  const props = calls.find(call => call.action === 'comments.insert')!.request.properties as Record<string, unknown>;
  assert.equal(props.X, undefined);
  assert.equal(props.Y, undefined);
  assert.deepEqual(props.Slide, ['slide-1']);
});

test('Comments on a whole record (no anchors): the pane starts one itself', async () => {
  const calls: Call[] = [];
  const project = { id: 'project-1', recordKey: 'pk1', name: 'Launch', checkpoint: null };
  await mount(<Harness scope={project} columns={{ scope: 'Project', anchor: null }} pins={false} />,
    fakeRuntime([], calls));
  await click(button('New comment')!);
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment');
  assert.equal(doc.querySelectorAll('.nui-comment-new-box').length, 1, 'the header button opens one new comment box');
  const field = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(field, 'Cut the first hello');
  await key(field, 'Enter');
  const request = calls.find(call => call.action === 'comments.insert')!.request;
  assert.deepEqual(request.columns, { title: 'Cut the first hello' });
  const props = request.properties as Record<string, unknown>;
  assert.deepEqual(props.Project, ['project-1']);
  assert.equal(props.Slide, undefined);
});

// Without the host Comments panel (a host that predates it) the controller signs with the viewer's first name from the
// host context, then "Person", then no author (SPC-267). Under the panel the panel's viewer signs (tested below).
async function newWholeComment(runtime: NotisRuntime, body: string) {
  const project = { id: 'project-1', recordKey: 'pk1', name: 'Launch', checkpoint: null };
  await mount(<Harness scope={project} columns={{ scope: 'Project', anchor: null }} pins={false} />,
    { ...runtime, spaceComments: undefined } as NotisRuntime);
  await sendWholeComment(body);
}
async function sendWholeComment(body: string) {
  await act(async () => { controller!.placePin(null, null, null); });
  await act(async () => { await controller!.sendNew(body); });
}
const authorsSent = (calls: Call[]) => calls.filter(call => call.action === 'comments.insert')
  .map(call => (call.request.properties as Record<string, unknown>).Author ?? null);

test('Comments are signed with the viewer\'s first name, never someone else\'s', async () => {
  const calls: Call[] = [];
  await newWholeComment(fakeRuntime([], calls, { viewerName: 'Marie' }), 'Looks good');
  assert.deepEqual(authorsSent(calls), ['Marie']);
  assert.equal(controller!.me, 'Marie');
});

test('An Author choice list without the viewer\'s name signs the comment Person, then remembers it', async () => {
  const calls: Call[] = [];
  await newWholeComment(fakeRuntime([], calls, { viewerName: 'Marie', refusedAuthors: ['Marie'] }), 'First');
  assert.deepEqual(authorsSent(calls), ['Marie', 'Person']);
  assert.equal(controller!.me, 'Person');
  await sendWholeComment('Second');
  assert.deepEqual(authorsSent(calls), ['Marie', 'Person', 'Person'], 'the next comment goes straight to the accepted author');
});

test('Under the host Comments panel the panel\'s viewer signs, never the context name or Person', async () => {
  const calls: Call[] = [];
  const project = { id: 'project-1', recordKey: 'pk1', name: 'Launch', checkpoint: null };
  await mount(<Harness scope={project} columns={{ scope: 'Project', anchor: null }} pins={false} />,
    fakeRuntime([], calls, { viewerName: 'Marie', comments: { viewer: { name: 'Ana', canEditSpace: true } } }));
  await sendWholeComment('Hi');
  assert.deepEqual(authorsSent(calls), ['Ana']);
  assert.equal(controller!.me, 'Ana');
});

test('Without Person in the choice list the comment is saved with no author, and a visitor is never Flo', async () => {
  const calls: Call[] = [];
  await newWholeComment(fakeRuntime([], calls, { viewerName: 'Marie', refusedAuthors: ['Marie', 'Person'] }), 'Hi');
  assert.deepEqual(authorsSent(calls), ['Marie', 'Person', null]);
  const visitor: Call[] = [];
  await newWholeComment(fakeRuntime([], visitor, { viewerName: null }), 'Hello');
  assert.deepEqual(authorsSent(visitor), ['Person']);
});

test('Another failure is not taken for a refused name: no retry under another author', async () => {
  const calls: Call[] = [];
  await newWholeComment(fakeRuntime([], calls, { viewerName: 'Marie', fail: true }), 'Hi');
  assert.deepEqual(authorsSent(calls), ['Marie']);
});

test('commentAuthorCandidates: a fixed name alone, else the viewer then Person within the known authors', () => {
  assert.deepEqual(commentAuthorCandidates('Ada', 'Marie'), ['Ada']);
  assert.deepEqual(commentAuthorCandidates(undefined, 'Marie'), ['Marie', 'Person']);
  assert.deepEqual(commentAuthorCandidates(undefined, 'Marie', ['Flo', 'Person']), ['Person']);
  assert.deepEqual(commentAuthorCandidates(undefined, null, ['Flo']), []);
  assert.equal(isRefusedChoice(new Error('This choice is missing or ambiguous. Use an existing option ID.')), true);
  assert.equal(isRefusedChoice(new Error('Network down')), false);
});

// ---------------------------------------------------------------------------
// Pictures, files and links shown with a comment
// ---------------------------------------------------------------------------

const BEFORE = 'https://files.example/native-record-files/v1/a/file.png';
const AFTER = 'https://files.example/native-record-files/v1/b/file.png';

test('Attachments: read from the files column, pictures told from files, unsafe links dropped', () => {
  const comment = readCommentRow(row('a1', { body: 'Keep it?', files: [
    { name: 'Before.png', url: BEFORE },
    { name: 'After.png', file: { url: AFTER } },
    { name: 'Notes.pdf', external: { url: 'https://files.example/notes.pdf' } },
    'https://files.example/raw/shot.webp',
    { name: 'Bad', url: 'javascript:alert(1)' },
    { name: 'Also bad', url: '//evil.example/x.png' },
  ] }));
  assert.deepEqual(comment.attachments.map(item => [item.label, item.image]),
    [['Before', true], ['After', true], ['Notes', false], ['shot', true]]);
  assert.equal(comment.attachments[1]!.url, AFTER);
  assert.deepEqual(readCommentRow(row('a2', { body: 'x' })).attachments, [], 'a table without the column shows none');
  assert.deepEqual(readCommentRow(row('a3', { body: 'x', files: [{ name: 'A.png', url: BEFORE }] }),
    { columns: { attachments: null } }).attachments, []);
  assert.equal(commentAttachmentFor(' before ', comment.attachments)?.url, BEFORE, 'an option names its picture, any case');
  assert.equal(commentAttachmentFor('Notes', comment.attachments), undefined, 'only pictures answer an option');
  const inline = readCommentRow(row('a4', { body: 'x', files: [{ name: 'Chart', url: 'data:image/svg+xml;utf8,%3Csvg%2F%3E' },
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
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Answer, 'B');
  assert.equal(doc.querySelector('.nui-viewer'), null, 'answering closes the viewer');
  const chosen = doc.querySelector('.nui-comment-figure[data-chosen]')!;
  assert.equal(chosen.querySelector('img')!.getAttribute('src'), AFTER);
  assert.equal(doc.querySelectorAll('.nui-comment-figure button.nui-btn').length, 0, 'an answered ask offers no more buttons');
  assert.match(doc.querySelector('[data-thread="p2"] .nui-comment-answer')!.textContent!, /B, sent to the agent/);

  await mount(<Harness {...base} />, fakeRuntime([row('p3', { body: 'Pick', author: 'Claude', slide: 'slide-1', needs: 'choice',
    options: 'A | B', files: [{ name: 'A.png', url: BEFORE }, { name: 'B.png', url: AFTER }] })], calls));
  assert.equal(doc.querySelector('.nui-comment-choices'), null, 'no empty row when every option has its picture');
  await click([...doc.querySelectorAll('.nui-comment-figure button.nui-btn')].find(el => el.textContent === 'A')!);
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Answer, 'A');
});

test('CommentPane: a check offers the labels its author gave, and Looks good or Undo without them', async () => {
  const calls: Call[] = [];
  const rows = [row('k1', { body: 'Keep the spacing fix?', author: 'Codex', slide: 'slide-1', needs: 'check',
    options: 'Approve exact change | Hold' })];
  await mount(<Harness {...base} authors={undefined} />, fakeRuntime(rows, calls));
  assert.deepEqual([...doc.querySelectorAll('.nui-comment-choices button')].map(el => el.textContent), ['Approve exact change', 'Hold']);
  await click(button('Hold')!);
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Answer, 'Hold');
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

interface FakeFiles extends SpaceFilesTransport { uploads: SpaceFileUploadInput[]; checks: string[][] }

function fakeFiles(behaviour: { fail?: SpaceFileError; failOnce?: SpaceFileError; checkFail?: SpaceFileError; hold?: boolean } = {}): FakeFiles {
  const uploads: SpaceFileUploadInput[] = [];
  const checks: string[][] = [];
  return {
    uploads, checks,
    async check(database, column) {
      checks.push([database, column]);
      if (behaviour.checkFail) throw behaviour.checkFail;
      return { available: true, maxBytes: 8 * 1024 * 1024, extensions: ['png', 'pdf'] };
    },
    async upload(input) {
      uploads.push(input);
      input.onProgress?.(0, input.file.size);
      if (behaviour.hold) await new Promise(() => {});
      if (behaviour.fail) throw behaviour.fail;
      if (behaviour.failOnce && uploads.length === 1) throw behaviour.failOnce;
      const name = input.name ?? 'file';
      return { file: { name, url: STORED.replace('file.png', `file.${name.split('.').pop()}`) }, previewUrl: SIGNED,
        sizeBytes: input.file.size, contentType: input.file.type, sha256: 'a'.repeat(64), requestId: 'r' };
    },
  };
}

/** Rows of a Comments table that has the Attachments files column. */
const FILE_ROWS = ROWS.map(item => ({ ...item, properties: { ...(item.properties as object), Attachments: { type: 'files', files: [] } } }));

function withFiles(runtime: NotisRuntime, files: SpaceFilesTransport | undefined): NotisRuntime {
  return { ...runtime, spaceFiles: files } as NotisRuntime;
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
  const rows = [...FILE_ROWS, row('ask', { body: 'Which label?', author: 'Claude', slide: 'slide-1', thread: 'c1', needs: 'input',
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
  assert.equal(doc.querySelector('.nui-comment-new-title')!.textContent, 'New comment on item 1', 'its pin came back too');
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
  assert.equal(answer().value, 'Half an answer');
  await act(async () => { controller!.placePin('sk1', 0.2, 0.2); });
  assert.equal((doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement).value, '', 'a new comment starts empty');
  assert.equal(doc.querySelector('.nui-comment-new-box .nui-comment-file'), null);
});

test('Drafts on two pages keep their own files when the mounted box moves from one page to the other', async () => {
  const files = fakeFiles();
  const runtime = withFiles(fakeRuntime(FILE_ROWS, []), files);
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
  await mount(<Harness {...base} />, withFiles(fakeRuntime(FILE_ROWS, calls), files));
  assert.equal(controller!.attach, 'on', 'the rows show the column: no check request');
  assert.equal(files.checks.length, 0);
  const field = await openNewBox();
  const event = await paste(field, [picture()]);
  assert.equal(event.defaultPrevented, true, 'a pasted picture is not pasted as text');
  assert.equal(files.uploads.length, 1);
  assert.equal(files.uploads[0]!.database, 'comments');
  assert.equal(files.uploads[0]!.column, 'Attachments');
  assert.match(files.uploads[0]!.name!, /^pasted-.*\.png$/, 'a pasted "image.png" gets a dated name');
  const chip = doc.querySelector('.nui-comment-new-box .nui-comment-file')!;
  assert.equal(chip.getAttribute('data-state'), 'ready');
  assert.ok(chip.querySelector('img'), 'a picture chip shows its thumbnail');
  assert.ok(button(`Remove ${files.uploads[0]!.name}`), 'each chip has its remove control');
  await type(field, 'Like this');
  await key(field, 'Enter');
  const insert = calls.find(call => call.action === 'comments.insert')!;
  const props = insert.request.properties as Record<string, unknown>;
  assert.deepEqual(props.Attachments, [{ name: files.uploads[0]!.name, url: STORED }]);
  assert.deepEqual(insert.request.columns, { title: 'Like this' });
  assert.equal(doc.querySelector('.nui-comment-new-box'), null);
});

test('Attach: a picture alone can be sent, and the sent draft shows it before the rows come back', async () => {
  const calls: Call[] = [];
  const files = fakeFiles();
  const runtime = withFiles(fakeRuntime(FILE_ROWS, calls), files);
  await mount(<Harness {...base} />, runtime);
  const field = await openNewBox();
  await paste(field, [picture()]);
  await click(button('Send')!);
  const insert = calls.find(call => call.action === 'comments.insert')!;
  assert.deepEqual(insert.request.columns, { title: '' });
  assert.equal(doc.querySelector('.nui-comment-thumb img')!.getAttribute('src'), SIGNED, 'the draft shows the signed preview');
});

test('Attach: files dropped on a reply and picked with the paperclip upload and go with the reply', async () => {
  const calls: Call[] = [];
  const files = fakeFiles();
  await mount(<Harness {...base} />, withFiles(fakeRuntime(FILE_ROWS, calls), files));
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
  const insert = calls.find(call => call.action === 'comments.insert')!;
  assert.deepEqual((insert.request.properties as Record<string, unknown>).Attachments,
    [{ name: 'brief.pdf', url: STORED.replace('file.png', 'file.pdf') }]);
  assert.equal((insert.request.properties as Record<string, unknown>).Thread, 'c1');
});

test('Attach: a failed upload keeps the text and the chip, says why in EN and FR, and holds Send until it is retried or removed', async () => {
  const calls: Call[] = [];
  const failing = fakeFiles({ fail: new SpaceFileError('too big', 'space_file_too_large', 413) });
  await mount(<Harness {...base} />, withFiles(fakeRuntime(FILE_ROWS, calls), failing));
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
  await mount(<Harness {...base} />, withFiles(fakeRuntime(FILE_ROWS, []), lost));
  const again = await openNewBox();
  await paste(again, [pdf()]);
  assert.equal(doc.querySelector('.nui-comment-file')!.getAttribute('data-state'), 'failed');
  await click(button('Try brief.pdf again')!);
  await settle();
  assert.equal(doc.querySelector('.nui-comment-file')!.getAttribute('data-state'), 'ready', 'a lost upload goes through on Try again');
  assert.equal(lost.uploads.length, 2);

  await mount(<Harness {...base} />, withFiles(fakeRuntime(FILE_ROWS, [], { locale: 'fr' }), fakeFiles({
    fail: new SpaceFileError('nope', 'space_file_type_unsupported', 415) })), 'fr');
  const champ = await openNewBox();
  await paste(champ, [pdf()]);
  assert.match(doc.body.textContent!, /brief\.pdf ne peut pas être joint/);
});

test('Attach: a save that fails after the upload keeps the text and the files for another try', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, withFiles(fakeRuntime(FILE_ROWS, calls, { fail: true }), fakeFiles()));
  const field = await openNewBox();
  await type(field, 'Try me');
  await paste(field, [pdf()]);
  await key(field, 'Enter');
  assert.ok(calls.find(call => call.action === 'comments.insert'));
  assert.match(doc.body.textContent!, /Could not save that change/);
  const kept = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  assert.equal(kept.value, 'Try me');
  assert.equal(doc.querySelectorAll('.nui-comment-new-box .nui-comment-file[data-state="ready"]').length, 1);
});

test('Attach: Send waits while a file uploads', async () => {
  await mount(<Harness {...base} />, withFiles(fakeRuntime(FILE_ROWS, []), fakeFiles({ hold: true })));
  const field = await openNewBox();
  await type(field, 'Wait');
  await paste(field, [pdf()]);
  assert.equal(doc.querySelector('.nui-comment-file')!.getAttribute('data-state'), 'uploading');
  assert.match(doc.querySelector('.nui-comment-file [role="status"]')!.textContent!, /Uploading brief\.pdf, 0%/);
  assert.equal(button('Send')!.disabled, true);
});

test('Attach: text only without the Attachments column, without a host transport, and after a refused check', async () => {
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const files = fakeFiles();
    await mount(<Harness {...base} />, withFiles(fakeRuntime(ROWS, []), files));
    assert.equal(controller!.attach, 'off', 'the rows show no Attachments column');
    assert.equal(button('Attach pictures or files'), undefined);
    assert.ok(warnings.some(args => /no files column named "Attachments"/.test(String(args[0]))), 'the developer is told');
    const field = await openNewBox();
    const event = await paste(field, [picture()]);
    assert.equal(event.defaultPrevented, false, 'a text-only pane leaves the paste to the browser');
    assert.equal(files.uploads.length, 0);

    await mount(<Harness {...base} />, withFiles(fakeRuntime(FILE_ROWS, []), undefined));
    assert.equal(controller!.attach, 'off', 'a Site, a preview or an older host uploads nothing');
    assert.equal(button('Attach pictures or files'), undefined);

    const refused = fakeFiles({ checkFail: new SpaceFileError('no column', 'space_file_column_missing', 409) });
    await mount(<Harness {...base} />, withFiles(fakeRuntime([], []), refused));
    assert.deepEqual(refused.checks, [['comments', 'Attachments']], 'an empty table asks the host once');
    assert.equal(controller!.attach, 'off');

    const empty = fakeFiles();
    await mount(<Harness {...base} />, withFiles(fakeRuntime([], []), empty));
    assert.equal(controller!.attach, 'on');
    assert.ok(button('Attach pictures or files') === undefined, 'no box is open yet');
    await openNewBox();
    assert.ok(button('Attach pictures or files'));
  } finally {
    console.warn = warn;
  }
});

test('Attach: an expired picture address reads the comments again, at most twice a minute', async () => {
  let reads = 0;
  const runtime = withFiles(fakeRuntime([row('e1', { body: 'Look', slide: 'slide-1', files: [{ name: 'a.png', url: SIGNED }] })], []), fakeFiles());
  const shown = runtime.shown!.bind(runtime);
  (runtime as { shown: typeof shown }).shown = async (...args: Parameters<typeof shown>) => { reads += 1; return shown(...args); };
  await mount(<Harness {...base} />, runtime);
  const before = reads;
  const img = doc.querySelector('.nui-comment-thumb img')!;
  await act(async () => { img.dispatchEvent(new dom.window.Event('error')); });
  await settle();
  await act(async () => { img.dispatchEvent(new dom.window.Event('error')); });
  await settle();
  assert.equal(reads - before, 1);
});

test('The pane draws in the host Comments panel, and a SidePane given it shows its page alone', async () => {
  function InSidePane(props: UseCommentsOptions) {
    controller = useComments(props);
    return <ui.SidePane pane={<CommentPane controller={controller} />}><p className="page">Slide</p></ui.SidePane>;
  }
  await mount(<InSidePane {...base} />, fakeRuntime(ROWS, []));
  const panel = doc.getElementById('panel')!;
  const app = doc.getElementById('app')!;
  assert.ok(panel.querySelector('.nui-comment-pane'), 'the threads sit in the host panel');
  assert.equal(app.querySelector('.nui-comment-pane'), null, 'nothing of the pane inside the Space');
  assert.equal(app.querySelector('.nui-side-pane-aside'), null, 'no empty column beside the page');
  assert.ok(app.querySelector('.nui-side-pane-main .page'));
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
const props = (call: Call | undefined) => (call?.request.properties ?? {}) as Record<string, unknown>;
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
  assert.equal(calls.filter(call => call.action === 'comments.insert').length, 0, 'nothing is sent as Flo');

  const named: Call[] = [];
  await mount(<Harness {...base} me="Flo" />, fakeRuntime(ROWS, named, { comments: { viewer: { name: 'Ana', canEditSpace: true } } }));
  assert.equal(controller!.canWrite, true);
  assert.equal(controller!.me, 'Ana');
  await act(async () => { controller!.placePin('sk1', 0.4, 0.3); });
  await settle();
  const next = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await type(next, 'Hello');
  await key(next, 'Enter');
  assert.equal(props(named.find(call => call.action === 'comments.insert')).Author, 'Ana', 'the viewer, not the me option');
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
  assert.equal(calls.at(-1)!.request.record_key, 'r1');
  assert.equal(status(calls.at(-1)), 'Deleted', 'confirmDelete deletes at once');
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

test('Deleting a thread where one row fails: one outcome, and Undo still brings back what was deleted', async () => {
  const calls: Call[] = [];
  const plain = fakeRuntime(ROWS, calls);
  const runtime = {
    ...plain,
    callAction: async (action: string, input: { request: Record<string, unknown> }) => {
      if (input.request.record_key === 'r1' && status({ action, request: input.request }) === 'Deleted') {
        calls.push({ action, request: input.request });
        throw new Error('nope');
      }
      return (plain.callAction as (a: string, i: unknown) => Promise<unknown>)(action, input);
    },
  } as unknown as NotisRuntime;
  await mount(<Harness {...base} />, runtime);
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Delete the comment thread: "]')!);
  assert.match(doc.body.textContent!, /Some comments could not be deleted/);
  assert.ok(toastUndo(), 'Undo stays for the rows that were deleted');
  const before = calls.length;
  await click(toastUndo()!);
  assert.deepEqual(calls.slice(before).map(call => [call.request.record_key, status(call)]), [['c1', 'Open']],
    'only the deleted root comes back');
});

test('Undo right after a write waits for it and sends its revision; Z still undoes after the card left', async () => {
  const calls: Call[] = [];
  const plain = fakeRuntime(ROWS, calls);
  const waiting: Array<() => void> = [];
  let hold = true;
  const runtime = {
    ...plain,
    callAction: async (action: string, input: unknown) => {
      if (hold) await new Promise<void>(resolve => waiting.push(resolve));
      return (plain.callAction as (a: string, i: unknown) => Promise<unknown>)(action, input);
    },
  } as unknown as NotisRuntime;
  await mount(<Harness {...base} />, runtime);
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  await click(toastUndo()!);
  assert.equal(waiting.length, 1, 'the Undo waits for the archive to be saved');
  hold = false;
  await act(async () => { waiting.shift()!(); });
  await settle();
  assert.deepEqual(calls.map(call => [status(call), call.request.expected_revision]), [['Resolved', 1], ['Open', 2]],
    'the Undo sends the revision the archive returned');

  const later: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, later));
  const first = doc.querySelector('[data-thread="c2"]') as HTMLElement;
  first.focus();
  await key(first, 'e');
  assert.equal(doc.activeElement?.getAttribute('data-thread'), 'c1', 'focus moves to the card now in its place');
  await key(doc.activeElement!, 'z');
  assert.equal(later.at(-1)!.request.record_key, 'c2');
  assert.equal(status(later.at(-1)), 'Open', 'Z undoes');
  assert.equal(later.at(-1)!.request.expected_revision, 2);
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

test('An input ask is answered from its own field, and the answer goes back as a reply', async () => {
  const calls: Call[] = [];
  const rows = [row('i1', { body: 'Which title do you want?', author: 'Claude', slide: 'slide-1', needs: 'input',
    createdAt: '2026-10-21T09:00:00.000Z' })];
  await mount(<Harness {...base} />, fakeRuntime(rows, calls));
  const field = doc.querySelector('[data-thread="i1"] textarea[aria-label="Your answer"]') as HTMLTextAreaElement;
  assert.ok(field, 'the answer field shows in the card');
  await type(field, 'Shorter');
  await click(button('Send the answer')!);
  const insert = calls.find(call => call.action === 'comments.insert')!;
  assert.equal(props(insert).Thread, 'i1');
  assert.equal(props(calls.find(call => call.action === 'comments.update')).Answer, 'Shorter');
});

test('C1: the reply that shows an input answer always names its ask in Answer to; the server adds a missing column', async () => {
  const rows = [row('i1', { body: 'Which title do you want?', author: 'Claude', slide: 'slide-1', needs: 'input',
    createdAt: '2026-10-21T09:00:00.000Z' })];
  const names = ['Body', 'Deck', 'Slide', 'Thread', 'Author', 'Status', 'Needs', 'Options', 'Answer', 'Answered at',
    'Change', 'Changed at', 'Example'];
  const answer = async (propertyNames: string[] | undefined, columns?: Record<string, string>) => {
    const calls: Call[] = [];
    await mount(<Harness {...base} {...(columns ? { columns } : {})} />,
      fakeRuntime(rows, calls, propertyNames ? { propertyNames } : {}));
    await type(doc.querySelector('[data-thread="i1"] textarea[aria-label="Your answer"]') as HTMLTextAreaElement, 'Shorter');
    await click(button('Send the answer')!);
    return props(calls.find(call => call.action === 'comments.insert'));
  };
  const named = await answer([...names, 'Answer to']);
  assert.equal(named['Answer to'], 'i1', 'the server routes it to the asker and counts it as the answer, not a reply');
  assert.equal(named.Thread, 'i1');
  assert.equal((await answer(names))['Answer to'], 'i1', 'a table without the column yet: sent, the server adds it');
  assert.equal((await answer(undefined))['Answer to'], 'i1', 'columns not known: sent too');
  const renamed = await answer(names, { answerTo: 'Réponse à' });
  assert.equal('Réponse à' in renamed || 'Answer to' in renamed, false, 'a renamed column is sent only once it exists');
  assert.equal((await answer([...names, 'Réponse à'], { answerTo: 'Réponse à' }))['Réponse à'], 'i1');
  // A plain reply (no ask open) names nothing.
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime([row('p1', { body: 'Tighten', slide: 'slide-1' })], calls,
    { propertyNames: [...names, 'Answer to'] }));
  const thread = controller!.threads.find(item => item.root.recordKey === 'p1')!;
  await act(async () => { await controller!.actions.reply(thread, 'Done'); });
  assert.equal('Answer to' in props(calls.find(call => call.action === 'comments.insert')), false);
});

test('C1: an input ask reads answered below from the reply naming it, whatever its words', async () => {
  const reply = row('a1', { body: 'Something longer than the answer', slide: 'slide-1', thread: 'i1',
    createdAt: '2026-10-21T10:00:00.000Z' });
  (reply.properties as Record<string, unknown>)['Answer to'] = { type: 'rich_text', rich_text: [{ text: { content: 'i1' } }] };
  const rows = [row('i1', { body: 'Which title?', author: 'Claude', slide: 'slide-1', needs: 'input', answer: 'Short',
    createdAt: '2026-10-21T09:00:00.000Z' }), reply];
  await mount(<Harness {...base} />, fakeRuntime(rows, []));
  assert.equal(doc.querySelector('[data-thread="i1"] .nui-comment-answer')!.textContent, 'Answered below, sent to the agent');
});

test('C4: the pane shows it is loading until the first read settles, never No comments for a moment', async () => {
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const runtime = fakeRuntime([], []) as unknown as { shown: () => Promise<unknown> };
  const read = runtime.shown;
  runtime.shown = async () => { await held; return read(); };
  await mount(<Harness {...base} />, runtime as unknown as NotisRuntime);
  const loading = doc.querySelector('.nui-comment-loading[role="status"][aria-busy="true"]');
  assert.ok(loading, 'placeholders while the first read runs');
  assert.match(loading!.textContent!, /Loading comments/);
  assert.equal(doc.querySelector('.nui-comment-empty'), null, 'no empty state before the read settles');
  await act(async () => { release(); });
  await settle();
  assert.equal(doc.querySelector('.nui-comment-loading'), null);
  assert.match(doc.querySelector('.nui-comment-empty')!.textContent!, /No comments here yet/);
  // A page still opening in a new tab (its list not readable yet) is loading too, in French as well.
  const opening = fakeRuntime([], [], { locale: 'fr' }) as unknown as { space: { shows: Record<string, unknown> } };
  opening.space.shows = {};
  await mount(<Harness {...base} />, opening as unknown as NotisRuntime, 'fr');
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

test('B4: an input answer is saved before the reply that shows it, so the server sends that reply to the asker only', async () => {
  const calls: Call[] = [];
  const rows = [row('i1', { body: 'Which title do you want?', author: 'Claude', slide: 'slide-1', needs: 'input',
    createdAt: '2026-10-21T09:00:00.000Z' })];
  const runtime = fakeRuntime(rows, calls) as unknown as { callAction(action: string, input: unknown): Promise<unknown> };
  const plain = runtime.callAction;
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  runtime.callAction = async (action, input) => {
    const answer = await plain(action, input);
    if (action === 'comments.update') await held;
    return answer;
  };
  await mount(<Harness {...base} />, runtime as unknown as NotisRuntime);
  await type(doc.querySelector('[data-thread="i1"] textarea[aria-label="Your answer"]') as HTMLTextAreaElement, 'Shorter');
  await click(button('Send the answer')!);
  await settle();
  assert.deepEqual(calls.map(call => call.action), ['comments.update'], 'the reply waits for the Answer to be saved');
  await act(async () => { release(); });
  await settle();
  assert.deepEqual(calls.map(call => call.action), ['comments.update', 'comments.insert'], 'then one reply is posted');
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
  await mount(<Harness {...base} columns={zoneColumns} />, fakeRuntime(ROWS, [], { comments }));
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
  let rows = ROWS;
  const plain = fakeRuntime([], calls);
  const waiting: Array<() => void> = [];
  const runtime = {
    ...plain,
    shown: async () => ({ rows, schema_revision: 7 }),
    callAction: async (action: string, input: { request: Record<string, unknown> }) => {
      await new Promise<void>(resolve => waiting.push(resolve));
      return (plain.callAction as (a: string, i: unknown) => Promise<unknown>)(action, input);
    },
  } as unknown as NotisRuntime;
  await mount(<Harness {...base} />, runtime);
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!);
  assert.equal(doc.querySelector('[data-thread="c1"]'), null, 'archived at once');
  await click(toastUndo()!);
  assert.ok(doc.querySelector('[data-thread="c1"]'), 'Undo shows it again at once');
  // The archive is saved and the list reads the row archived at its new revision, while the Undo still waits.
  rows = ROWS.map(item => item.record_key === 'c1'
    ? row('c1', { body: 'Tighten the title', slide: 'slide-1', x: 0.25, y: 0.5, status: 'Resolved', revision: 2,
      createdAt: '2026-10-21T09:00:00.000Z' }) : item);
  await act(async () => { waiting.shift()!(); });
  await settle();
  assert.equal(waiting.length, 1, 'the Undo is on its way');
  assert.ok(doc.querySelector('[data-thread="c1"]'), 'no flicker back to archived while the Undo is saved');
  await act(async () => { waiting.shift()!(); });
  await settle();
  assert.deepEqual(calls.map(call => status(call)), ['Resolved', 'Open']);
});

test('The resolved filter name is still accepted by the exported type and the controller', async () => {
  const name: ui.CommentStatusFilter = 'resolved';
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  await act(async () => { controller!.setStatusFilter(name); });
  assert.equal(controller!.statusFilter, 'done');
});

test('A late partial-delete notice never replaces a newer Undo', async () => {
  const calls: Call[] = [];
  const plain = fakeRuntime(ROWS, calls);
  let failReply: () => void = () => {};
  const runtime = {
    ...plain,
    callAction: async (action: string, input: { request: Record<string, unknown> }) => {
      if (input.request.record_key === 'r1') {
        await new Promise<void>(resolve => { failReply = resolve; });
        throw new Error('nope');
      }
      return (plain.callAction as (a: string, i: unknown) => Promise<unknown>)(action, input);
    },
  } as unknown as NotisRuntime;
  await mount(<Harness {...base} />, runtime);
  await click(doc.querySelector('[data-thread="c1"] button[aria-label^="Delete the comment thread: "]')!);
  const c2 = controller!.threads.find(thread => thread.root.recordKey === 'c2')!.root;
  await act(async () => { controller!.actions.archive(c2); });
  await settle();
  assert.match(doc.querySelector('.nui-toast')!.textContent!, /Comment thread archived/);
  await act(async () => { failReply(); });
  await settle();
  assert.match(doc.querySelector('.nui-toast')!.textContent!, /Comment thread archived/, 'the newer toast stays');
  assert.doesNotMatch(doc.body.textContent!, /Some comments could not be deleted/);
});

test('Links are read at most 200 roots per request, and every answer is kept', async () => {
  const asked: number[] = [];
  const many = Array.from({ length: 450 }, (_, index) => row(`k${index}`, { body: `Note ${index}`, slide: 'slide-1',
    createdAt: '2026-10-21T09:00:00.000Z' }));
  const comments: Partial<SpaceCommentsTransport> = {
    links: async ({ rootKeys }) => {
      asked.push(rootKeys.length);
      return Object.fromEntries(rootKeys.map(key => [key, [{ threadId: `t-${key}`, title: `Thread ${key}` }]]));
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
      links: async ({ rootKeys }) => {
        asked.push([...rootKeys]);
        // The first read finds the thread not started yet; the wake has started it by the next one.
        const started = asked.length > 1;
        return Object.fromEntries(rootKeys.filter(key => key === 'c1').map(key => [key, [started
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
      links: async ({ rootKeys }) => (linked
        ? Object.fromEntries(rootKeys.filter(key => key === 'c1').map(key => [key, [{ threadId: 't-1', title: 'Deck polish' }]]))
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
  const answered = calls.find(call => call.action === 'comments.update')!;
  assert.equal(answered.request.record_key, 'q2');
  assert.equal(props(answered).Answer, 'Green');
  const field = doc.querySelector('[data-ask="q3"] textarea') as HTMLTextAreaElement;
  await type(field, 'Revenue');
  await click(doc.querySelector('[data-ask="q3"] button[aria-label="Send the answer"]')!);
  const update = calls.filter(call => call.action === 'comments.update').at(-1)!;
  assert.equal(update.request.record_key, 'q3', 'the input ask answered is that reply');
  assert.equal(props(update).Answer, 'Revenue');
  assert.equal(calls.filter(call => call.action === 'comments.insert').length, 1, 'the answer is posted once, as a reply');
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
  const write = calls.at(-1)!;
  assert.equal(write.request.record_key, 'c4');
  assert.deepEqual(props(write), {}, 'no Change written over resolved');
  assert.equal((write.request.columns as Record<string, unknown>).title, 'Old note, reworded');

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
  const transport = (name: string): SpaceCommentsTransport => ({
    viewer: { name, canEditSpace: true },
    attach(source) {
      // A host that lists the source on its next tick, and hides the pane when the source leaves.
      void Promise.resolve().then(() => { shows += 1; source.show(doc.getElementById('panel')); });
      return () => { hidden += 1; source.show(null); };
    },
  });
  const plain = fakeRuntime(ROWS, []);
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
