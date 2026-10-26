import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { NotisProvider } from '../../provider';
import type { NotisRuntime } from '../../runtime';
import {
  COMMENT_COLUMNS, CommentPane, CommentPins, applyCommentPatches, commentAttachmentFor, commentBodyParts, commentChangesSince,
  commentDigest, commentRelativeTime, commentThreads, isCommentZone, readCommentRow, useComments, type CommentAnchor, type CommentController, type CommentRecord,
  type UseCommentsOptions,
} from '.';
import * as ui from '..';

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
    changedAt: 'Changed at', example: 'Example', attachments: 'Attachments',
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
  const stranger = readCommentRow(row('z', { body: 'Hi', author: 'Mallory' }), { authors: ['Flo'], fallbackAuthor: 'Notis' });
  assert.equal(stranger.author, 'Notis');
});

test('commentThreads: anchor order, replies under their root, deleted replies left out', () => {
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
    'commentDigest', 'COMMENT_COLUMNS', 'COMMENT_WORDS']) {
    assert.ok(name in ui, `${name} is exported`);
  }
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface Call { action: string; request: Record<string, unknown> }

let cacheCounter = 0;
function fakeRuntime(rows: Record<string, unknown>[], calls: Call[], options: { fail?: boolean; locale?: 'en' | 'fr' } = {}) {
  let next = 100;
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: {
      id: 's1', revision: 1, cacheScope: `comments-${cacheCounter += 1}`,
      actions: { 'comments.insert': { readOnly: false }, 'comments.update': { readOnly: false } },
      shows: { comments: { database: 'comments' } },
      bindings: { comments: { kind: 'database', operations: { insert: 'comments.insert', update: 'comments.update' } } },
    },
    context: { params: {}, locale: options.locale ?? 'en' },
    shown: async () => ({ rows, schema_revision: 7 }),
    callAction: async (action: string, input: { request: Record<string, unknown> }) => {
      calls.push({ action, request: input.request });
      if (options.fail) throw new Error('nope');
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

function Harness(props: UseCommentsOptions & { pins?: boolean }) {
  const { pins = true, ...options } = props;
  controller = useComments(options);
  return (
    <div>
      {pins ? <div className="anchor" style={{ position: 'relative' }}><CommentPins controller={controller} /></div> : null}
      <CommentPane controller={controller} />
    </div>
  );
}

async function mount(node: ReactNode, runtime: NotisRuntime, locale: 'en' | 'fr' = 'en') {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => {
    root!.render(
      <NotisProvider runtime={runtime}>
        <KeyboardEngine host="preview" locale={locale} platform="mac" engine={new KeyboardEngineCore()} document={doc} strict>
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
const scope = { id: 'deck-1', recordKey: 'dk1', name: 'Q4 review', checkpoint: '2026-10-20T00:00:00.000Z' };
const base: UseCommentsOptions = { scope, anchors: ANCHORS, anchorKey: 'sk1', authors: ['Flo', 'Claude', 'Notis'] };

test('CommentPane: threads of this anchor, pins, replies and the asks', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  assert.deepEqual(cards(), ['c1', 'c2'], 'open threads of slide 1');
  const pins = [...doc.querySelectorAll('.nui-comment-pin')];
  assert.deepEqual(pins.map(pin => pin.textContent), ['1', '2']);
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
});

test('CommentPane: filters (this item, all, open, resolved) and an empty state', async () => {
  await mount(<Harness {...base} />, fakeRuntime(ROWS, []));
  await click([...doc.querySelectorAll('.nui-seg button, [role="radio"]')].find(el => el.textContent?.startsWith('All'))!);
  assert.deepEqual(cards(), ['c1', 'c2', 'c3']);
  await click([...doc.querySelectorAll('.nui-seg button, [role="radio"]')].find(el => el.textContent?.startsWith('Resolved'))!);
  assert.deepEqual(cards(), ['c4'], 'deleted threads never show');
  await mount(<Harness {...base} anchorKey="nothing" />, fakeRuntime(ROWS, []));
  assert.match(doc.querySelector('.nui-comment-empty')!.textContent!, /No comments here yet/);
});

test('CommentPane: a reply sends on Enter, Shift+Enter keeps writing, and a reply reopens a resolved thread', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} anchorKey="sk2" />, fakeRuntime(ROWS, calls));
  await click([...doc.querySelectorAll('.nui-seg button, [role="radio"]')].find(el => el.textContent?.startsWith('Resolved'))!);
  const field = doc.querySelector('[data-thread="c4"] textarea') as HTMLTextAreaElement;
  assert.equal(field.getAttribute('aria-label'), 'Reply to reopen');
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
  const reopen = calls.find(call => call.action === 'comments.update')!;
  assert.equal((reopen.request.properties as Record<string, unknown>).Status, 'Open');
  assert.equal(reopen.request.expected_revision, 1);
});

test('CommentPane: Resolve, Delete with its confirmation, and a failed write rolls back', async () => {
  const calls: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, calls));
  await click(doc.querySelector('[data-thread="c1"] button[aria-label="Resolve"]')!);
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Status, 'Resolved');
  assert.deepEqual(cards(), ['c2'], 'the resolved thread leaves the open list');
  await click(doc.querySelector('[data-thread="c2"] button[aria-label="Delete"]')!);
  assert.equal(doc.querySelector('dialog')!.getAttribute('role'), 'alertdialog');
  await click(doc.querySelector('[data-dialog-confirm]')!);
  assert.equal((calls.at(-1)!.request.properties as Record<string, unknown>).Status, 'Deleted');
  assert.deepEqual(cards(), []);

  const failing: Call[] = [];
  await mount(<Harness {...base} />, fakeRuntime(ROWS, failing, { fail: true }));
  await click(doc.querySelector('[data-thread="c1"] button[aria-label="Resolve"]')!);
  assert.deepEqual(cards(), ['c1', 'c2'], 'the thread comes back after the failed write');
  assert.match(doc.body.textContent!, /Could not save that change/);
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

test('French words through the SDK words mechanism, and a Space wording override', async () => {
  await mount(<Harness {...base} words={{ thisAnchor: { en: 'This slide', fr: 'Cette diapositive' } }} />,
    fakeRuntime(ROWS, [], { locale: 'fr' }), 'fr');
  const text = doc.body.textContent!;
  assert.match(text, /Commentaires/);
  assert.match(text, /Cette diapositive/);
  assert.ok(doc.querySelector('button[aria-label="Résoudre"]'));
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
