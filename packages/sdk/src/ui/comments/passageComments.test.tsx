import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { NotisProvider } from '../../provider';
import type { NotisRuntime } from '../../runtime';
import type { SpaceCommentRow, SpaceCommentsTransport } from '../../space';
import { w } from '../../words';
import {
  CommentableRichText, CommentableText, PassageCommentPane, commentFromRow, locatePassage, markdownReadableText,
  passageAt, passageOffset, usePassageComments, type PassageCommentController,
  type PassageField,
} from '.';
import {
  commentRow, memoryCommentStore, type MemoryCommentOp, type MemoryCommentStore,
} from '../../../design-system/runtime/memoryComments';
import { clearCommentDrafts, commentDraftKey, readCommentDraft, writeCommentDraft } from './commentDrafts';
import { clearCommentRoutingCache } from './useCommentRouting';
import { PASSAGE_COMMENT_EVENT } from './passageModel';

const doc = dom.window.document;
Object.defineProperty(globalThis, 'HTMLTextAreaElement', { configurable: true, writable: true, value: dom.window.HTMLTextAreaElement });
const dialog = dom.window.HTMLDialogElement?.prototype as (HTMLDialogElement & { showModal?: () => void }) | undefined;
if (dialog && typeof dialog.showModal !== 'function') {
  dialog.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dialog.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
}

// ---------------------------------------------------------------------------
// Anchoring
// ---------------------------------------------------------------------------

test('locatePassage: white space ignored, the surrounding words pick among repeats, gone words give null', () => {
  const text = 'Ship it today.\n\nShip it   tomorrow, after the review.';
  const second = locatePassage(text, { quote: 'Ship it', prefix: 'today.', suffix: 'tomorrow' });
  assert.equal(text.slice(second!.start, second!.end), 'Ship it');
  assert.ok(second!.start > 10, 'the second "Ship it", told apart by its suffix');
  const first = locatePassage(text, { quote: 'Ship it', prefix: '', suffix: 'today' });
  assert.equal(first!.start, 0);
  const across = locatePassage(text, { quote: 'it tomorrow,', prefix: '', suffix: '' });
  assert.equal(text.slice(across!.start, across!.end), 'it   tomorrow,');
  assert.equal(locatePassage(text, { quote: 'next week', prefix: '', suffix: '' }), null);
  assert.equal(locatePassage(text, { quote: '   ', prefix: '', suffix: '' }), null);
});

test('passageAt keeps 40 characters around the quote and refuses a blank selection', () => {
  const text = `${'a'.repeat(100)} the words ${'b'.repeat(100)}`;
  const start = text.indexOf('the words');
  const passage = passageAt(text, start, start + 'the words'.length)!;
  assert.equal(passage.quote, 'the words');
  assert.equal(passage.prefix.length, 40);
  assert.equal(passage.suffix.length, 40);
  assert.equal(passageAt(text, 100, 101), null);
  assert.equal(passageAt('one\n\n  two', 0, 10)!.quote, 'one two');
});

test('Markdown: a passage is found in the words a reader sees; edited away it is gone', () => {
  const source = '### The week\n\nRead the [short guide](https://example.com/guide) and **ship it**.\n';
  assert.equal(markdownReadableText('A [link](https://x.example) and ![alt](https://y.example/a.png)'), 'A link and alt');
  assert.notEqual(passageOffset(source, { quote: 'short guide and ship it', prefix: 'Read the', suffix: '' }, true), null);
  assert.equal(passageOffset(source, { quote: 'short guide and ship it', prefix: '', suffix: '' }, false), null,
    'in the raw source the link target sits between the words');
  assert.equal(passageOffset(source.replace('ship it', 'send it'), { quote: 'ship it', prefix: '', suffix: '' }, true), null);
  const early = passageOffset(source, { quote: 'The week', prefix: '', suffix: '' }, true)!;
  const late = passageOffset(source, { quote: 'ship it', prefix: '', suffix: '' }, true)!;
  assert.ok(early < late, 'offsets follow reading order');
});

const FIELDS: PassageField[] = [
  { key: 'subjectEn', label: w('Subject', 'Objet'), group: 'EN' },
  { key: 'bodyEn', label: w('Body', 'Corps'), group: 'EN', markdown: true },
  { key: 'subjectFr', label: w('Subject', 'Objet'), group: 'FR' },
  { key: 'bodyFr', label: w('Body', 'Corps'), group: 'FR', markdown: true },
];

test('A text comment names its field by key in the store', () => {
  const comment = commentFromRow(commentRow({ id: 'c1', page_key: 'ik1', mode: 'text', field: 'bodyFr', quote: 'quelques mots',
    prefix: 'avec ', suffix: '' }));
  assert.deepEqual(comment.passage, { field: 'bodyFr', quote: 'quelques mots', prefix: 'avec ', suffix: '' });
  assert.equal(commentFromRow(commentRow({ id: 'c2', mode: 'text', field: 'bodyFr', quote: '  ' })).passage, null,
    'no quote: not a passage');
  assert.equal(commentFromRow(commentRow({ id: 'c3', mode: 'page', quote: 'x' })).passage, null, 'only text mode has one');
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** The page the passage comments sit on (the record `ik1`). */
const PAGE = 'ik1';

function row(key: string, fields: { body: string; field: string; quote: string; prefix?: string; suffix?: string;
  status?: SpaceCommentRow['status']; thread?: string; page?: string; createdAt?: string }): SpaceCommentRow {
  const createdAt = fields.createdAt ?? '2026-11-01T10:00:00.000Z';
  return commentRow({
    id: key, page_key: fields.page ?? PAGE, thread_root_id: fields.thread ?? null, mode: 'text', field: fields.field,
    quote: fields.quote, prefix: fields.prefix ?? '', suffix: fields.suffix ?? '', body: fields.body,
    status: fields.status ?? 'open', created_at: createdAt, changed_at: createdAt,
  });
}

const ROWS = [
  row('c1', { body: 'Shorter?', field: 'bodyEn', quote: 'three new things' }),
  row('c2', { body: 'Typo', field: 'subjectEn', quote: 'Notis Hub' }),
  row('c3', { body: 'Old wording', field: 'bodyEn', quote: 'words that were removed' }),
  row('c4', { body: 'Plutôt ça', field: 'bodyFr', quote: 'trois nouveautés' }),
];

/** One write the pane sent to the comment store. */
interface Call { op: MemoryCommentOp; input: Record<string, unknown> }

const STORES = new WeakMap<object, MemoryCommentStore>();
const storeOf = (runtime: NotisRuntime) => STORES.get(runtime)!;
const writes = (calls: Call[], op: MemoryCommentOp) => calls.filter(call => call.op === op).map(call => call.input);

let cacheCounter = 0;
/** A Space runtime whose comments live in an in-memory store seeded with `rows`; every write lands in `calls`. */
function fakeRuntime(rows: readonly SpaceCommentRow[], calls: Call[],
  options: { params?: Record<string, string>; comments?: Partial<SpaceCommentsTransport>; upload?: boolean } = {}) {
  const viewer = options.comments && 'viewer' in options.comments ? options.comments.viewer ?? null : undefined;
  const store = memoryCommentStore({ rows: rows.map(item => ({ ...item })), calls, upload: options.upload === true, viewer });
  const runtime = {
    commentsExtra: options.comments,
    commentsStore: store,
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: `passages-${cacheCounter += 1}` },
    context: { params: options.params ?? {}, locale: 'en', viewerName: 'Flo' },
    // Comments never go through Space actions: any call here is a mistake.
    callAction: async (action: string) => { throw new Error(`No Space action may run for comments (${action}).`); },
  } as unknown as NotisRuntime;
  STORES.set(runtime, store);
  return runtime;
}

let root: Root | null = null;
let current: PassageCommentController | null = null;
let showGroup: ((group: string) => void) | null = null;

test.after(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
});

const VALUES = {
  subjectEn: 'Notis Hub is live', bodyEn: 'Hi there, this week brings **three new things**.', subjectFr: '', bodyFr: 'Trois nouveautés.',
};

function Harness({ rich, record }: { rich?: ReactNode; record?: { id: string; recordKey: string } }) {
  const [group, setGroup] = useState('EN');
  showGroup = setGroup;
  current = usePassageComments({
    fields: FIELDS, values: VALUES, group,
    scope: { id: record?.id ?? 'issue-1', recordKey: record?.recordKey ?? PAGE, name: '10.26', checkpoint: null },
  });
  return (
    <div>
      <CommentableText comments={current} field="subjectEn" value={VALUES.subjectEn}>
        <textarea aria-label="English subject" defaultValue={VALUES.subjectEn} />
      </CommentableText>
      {rich ? <CommentableRichText comments={current} field="bodyEn">{rich}</CommentableRichText> : null}
      <PassageCommentPane comments={current} order="reading" groups={{ EN: w('the English copy', 'la version anglaise'),
        FR: w('the French copy', 'la version française') }} onGroup={group => setGroup(group)} />
    </div>
  );
}

async function settle() {
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}

/** The host Comments panel the panes draw in (`runtime.spaceComments`), over the runtime's memory store. */
const PANELS = new WeakMap<object, NotisRuntime>();
function withHostPanel(runtime: NotisRuntime): NotisRuntime {
  if ('spaceComments' in runtime) return runtime;
  const known = PANELS.get(runtime);
  if (known) return known;
  const { commentsExtra: extra, commentsStore: store } = runtime as unknown as {
    commentsExtra?: Partial<SpaceCommentsTransport>; commentsStore: MemoryCommentStore };
  const panel = {
    ...runtime,
    spaceComments: {
      ...store.transport,
      attach(source) {
        source.show(doc.getElementById('panel'));
        return () => source.show(null);
      },
      ...extra,
    } as SpaceCommentsTransport,
  } as NotisRuntime;
  PANELS.set(runtime, panel);
  STORES.set(panel, store);
  return panel;
}

let engine = new KeyboardEngineCore();

async function mount(node: ReactNode, runtime: NotisRuntime) {
  if (root) await act(async () => { root!.unmount(); });
  clearCommentDrafts();
  clearCommentRoutingCache();
  doc.body.innerHTML = '<div id="app"></div><div id="panel"></div>';
  root = createRoot(doc.getElementById('app')!);
  engine = new KeyboardEngineCore();
  await rerender(node, runtime);
}

/** Renders again in the mounted root, with the same keyboard engine: a new runtime object keeps the page mounted. */
async function rerender(node: ReactNode, runtime: NotisRuntime) {
  await act(async () => {
    root!.render(
      <NotisProvider runtime={withHostPanel(runtime)}>
        <KeyboardEngine host="preview" locale="en" platform="mac" engine={engine} document={doc} strict>
          {node}
        </KeyboardEngine>
      </NotisProvider>,
    );
  });
  await settle();
}

async function fire(el: Element, event: Event) {
  await act(async () => { el.dispatchEvent(event); });
  await settle();
}

const button = (label: string) => [...doc.querySelectorAll('button')].find(el =>
  el.getAttribute('aria-label') === label || el.textContent?.trim() === label) as HTMLButtonElement | undefined;
/** Each card starts with the words it quotes (the card itself draws them, as every comments list). */
const quotes = () => [...doc.querySelectorAll('.nui-comment-card .nui-comment-top [data-part="quote"]')].map(el => el.textContent);

test('PassageCommentPane: quotes of the group on screen in reading order, Passage changed, and the other group', async () => {
  await mount(<Harness />, fakeRuntime(ROWS, []));
  assert.deepEqual(quotes(), ['Notis Hub', 'three new things', 'words that were removed'],
    'Subject before Body, the passage no longer in the text last');
  const changed = [...doc.querySelectorAll('.nui-comment-anchor')].filter(el => el.hasAttribute('data-changed'))
    .map(el => el.querySelector('[data-part="quote"]')?.textContent);
  assert.deepEqual(changed, ['words that were removed']);
  const gone = doc.querySelector('[data-thread="c3"]')!;
  assert.equal(gone.querySelector('[data-part="passage-changed"]')!.textContent, 'Passage changed');
  assert.match(gone.querySelector('[data-part="passage-changed"]')!.getAttribute('title')!, /The comment stays open/);
  assert.equal(gone.querySelector('[data-part="quote"]')!.textContent, 'words that were removed', 'the old quote stays');
  assert.equal(doc.querySelector('.nui-passage-thread, .nui-passage-anchor'), null, 'no quote button above the card: the card starts with it');
  assert.ok(gone.querySelector('button[aria-label^="Archive the comment thread: "]'), 'the thread stays open (Archive, not Unarchive)');
  assert.equal(current!.controller.counts.open, 4, 'nothing closed it');
  const other = button('1 on the French copy');
  assert.ok(other, 'the French thread is counted, as a link');
  await fire(other!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(quotes(), ['trois nouveautés']);
});

test('CommentableText: a selection offers Comment; the new comment saves its field, quote and surrounding words', async () => {
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls);
  await mount(<Harness />, runtime);
  const field = doc.querySelector('textarea[aria-label="English subject"]') as HTMLTextAreaElement;
  assert.ok(doc.querySelector('.nui-passage-text-field[data-state="open"]'), 'tinted while it holds an open thread');
  assert.ok(button('Open the comments on this field'));
  field.setSelectionRange(10, 17);
  await fire(field, new dom.window.MouseEvent('mouseup', { bubbles: true }));
  const comment = button('Comment on the selected text');
  assert.ok(comment, 'Comment shows for the selection');
  await fire(comment!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(current!.draft?.quote, 'is live');
  const box = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  assert.ok(box, 'the pane holds the new comment box');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(box, 'Say launched'); box.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await fire(box, new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual(calls.map(call => call.op), ['insert']);
  const { request_id: requestId, ...input } = calls[0]!.input;
  assert.equal(typeof requestId, 'string');
  assert.deepEqual(input, {
    page_key: PAGE, view: null, mode: 'text', anchor_keys: [], field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ',
    suffix: '', body: 'Say launched',
  });
  assert.equal(current!.draft, null);
  const created = storeOf(runtime).rows.at(-1)!;
  assert.equal(current!.controller.threadKey, created.id, 'the new thread is selected');
});

test('CommentableRichText: a selection in the text offers Comment until typed over; what it shows decides Text changed', async () => {
  await mount(<Harness rich={<div contentEditable suppressContentEditableWarning>Hi there, this week brings three new
    things.</div>} />, fakeRuntime(ROWS, []));
  const editable = doc.querySelector('.nui-passage-rich [contenteditable]')!;
  const textNode = editable.firstChild as Text;
  const start = textNode.data.indexOf('this week');
  const range = doc.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + 'this week'.length);
  const selection = dom.window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await fire(editable, new dom.window.MouseEvent('mouseup', { bubbles: true }));
  assert.ok(button('Comment on the selected text'));
  await fire(editable, new dom.window.Event('input', { bubbles: true }));
  assert.equal(button('Comment on the selected text'), undefined, 'typing over the selection drops Comment');
  await fire(editable, new dom.window.MouseEvent('mouseup', { bubbles: true }));
  const comment = button('Comment on the selected text');
  assert.ok(comment);
  await fire(comment!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(current!.draft, { field: 'bodyEn', quote: 'this week', prefix: 'Hi there, ', suffix: ' brings three new things.' });
  assert.equal(current!.isChanged('c1'), false, 'the rendered text holds the passage');
  assert.equal(current!.isChanged('c3'), true);
});

test('CommentableRichText: the Comment button goes with its selection, and comes back once a new one is read (MGR-386, SPC-470)', async () => {
  await mount(<Harness rich={<div>Hi there, this week brings three new things.</div>} />, fakeRuntime(ROWS, []));
  const text = doc.querySelector('.nui-passage-rich-text > div')!;
  const textNode = text.firstChild as Text;
  const selection = dom.window.getSelection()!;
  const select = (words: string) => {
    const start = textNode.data.indexOf(words);
    const range = doc.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + words.length);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const selectionChanged = () => fire(doc as unknown as Element, new dom.window.Event('selectionchange'));
  const label = 'Comment on the selected text';
  select('this week');
  await fire(text, new dom.window.MouseEvent('mouseup', { bubbles: true }));
  assert.ok(button(label));
  await selectionChanged();
  assert.ok(button(label), 'a late change event for the same selection keeps the button');
  // A click away (or Cite) clears the selection: the button goes at once, with no mouse up on the text.
  selection.removeAllRanges();
  await selectionChanged();
  assert.equal(button(label), undefined, 'a cleared selection drops Comment');
  assert.equal(doc.querySelector('.nui-passage-pick'), null);
  select('this week');
  await fire(text, new dom.window.MouseEvent('mouseup', { bubbles: true }));
  assert.ok(button(label));
  // Another selection (Shift+click further on) hides it until that one is read.
  select('three new things');
  await selectionChanged();
  assert.equal(button(label), undefined, 'a selection that changed drops the old button');
  await fire(text, new dom.window.MouseEvent('mouseup', { bubbles: true }));
  const comment = button(label);
  assert.ok(comment, 'the new selection offers Comment again');
  await fire(comment!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(current!.draft?.quote, 'three new things', 'Comment still quotes the words selected now');
  assert.equal(button(label), undefined);
});

test('On a touch screen the Comment button comes back once the selection handles stop moving (SPC-470)', async () => {
  const win = dom.window as unknown as { matchMedia?: (query: string) => unknown };
  const saved = win.matchMedia;
  // A coarse pointer: a moved handle gives selectionchange only, never a mouse or key up.
  win.matchMedia = (query: string) => ({ matches: query === '(pointer: coarse)', media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    await mount(<Harness rich={<div>Hi there, this week brings three new things.</div>} />, fakeRuntime(ROWS, []));
    const text = doc.querySelector('.nui-passage-rich-text > div')!;
    const textNode = text.firstChild as Text;
    const selection = dom.window.getSelection()!;
    const select = (words: string) => {
      const start = textNode.data.indexOf(words);
      const range = doc.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + words.length);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const selectionChanged = () => fire(doc as unknown as Element, new dom.window.Event('selectionchange'));
    const label = 'Comment on the selected text';
    select('this week');
    await fire(text, new dom.window.MouseEvent('mouseup', { bubbles: true }));
    assert.ok(button(label), 'the first selection offers Comment');
    // The handles move twice in quick succession: the button goes, and only the last stop is read.
    select('this week brings');
    await selectionChanged();
    assert.equal(button(label), undefined, 'a moving handle drops the old button');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    select('this week brings three');
    await selectionChanged();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    assert.equal(button(label), undefined, 'still moving: not read yet');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    const comment = button(label);
    assert.ok(comment, 'once the handles stop, Comment is back with no mouse up');
    await fire(comment!, new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(current!.draft?.quote, 'this week brings three', 'and it quotes the words selected after the move');
  } finally {
    win.matchMedia = saved;
  }
});

test('On a Space page whose selection bar takes comments, the bar shows Comment and the text draws no button of its own (SPC-487)', async () => {
  await mount(<div data-notis-bar-comments=""><Harness rich={<div>Hi there, this week brings three new things.</div>} /></div>,
    fakeRuntime(ROWS, []));
  const text = doc.querySelector('.nui-passage-rich-text > div')!;
  const textNode = text.firstChild as Text;
  const start = textNode.data.indexOf('this week');
  const range = doc.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + 'this week'.length);
  const selection = dom.window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await fire(text, new dom.window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(button('Comment on the selected text'), undefined, 'one bar: no second Comment button over it');
  assert.equal(doc.querySelector('.nui-passage-pick'), null);
  // The bar's Comment hands the words to the text, which opens its own new comment on them.
  const event = new dom.window.CustomEvent(PASSAGE_COMMENT_EVENT, { detail: { range }, cancelable: true });
  await act(async () => { doc.querySelector('.nui-passage-rich-text')!.dispatchEvent(event); });
  await settle();
  assert.equal(event.defaultPrevented, true, 'the text took it');
  assert.equal(current!.draft?.quote, 'this week');
  assert.equal(current!.draft?.field, 'bodyEn');
  // The new comment box reads like the one in Notes: its title, then the words as the quote chip (SPC-489).
  assert.match(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label')!, /^New comment on these words/);
  assert.equal(doc.querySelector('.nui-comment-new-box [data-pill="quote"]')!.textContent, 'this week');
});

test('Opening a thread from its quote selects it and shows its group', async () => {
  const opened: string[] = [];
  function Opener() {
    const [group, setGroup] = useState<string>('EN');
    current = usePassageComments({
      fields: FIELDS, values: VALUES, group,
      scope: { id: 'issue-1', recordKey: PAGE, name: '10.26', checkpoint: null },
      onOpen: (thread, passage, from) => {
        opened.push(`${thread.root.recordKey}:${from}`);
        const next = passage ? current!.field(passage.field)?.group : undefined;
        if (next) setGroup(next);
      },
    });
    return <PassageCommentPane comments={current} />;
  }
  await mount(<Opener />, fakeRuntime(ROWS, []));
  const anchor = [...doc.querySelectorAll('.nui-comment-card [data-part="quote"]')].find(el => el.textContent?.includes('three new things'))!;
  await fire(anchor, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(opened, ['c1:quote']);
  assert.equal(current!.controller.threadKey, 'c1');
  assert.equal(current!.flash?.key, 'c1');
  await act(async () => { current!.openKey('c4', 'link'); });
  await settle();
  assert.equal(current!.group, 'FR', 'the Space switched to the thread\'s language');
  assert.deepEqual(quotes(), ['trois nouveautés']);
  void showGroup;
});

test('PassageCommentPane: newest first by default, New comment on words or the whole page, archive with Undo', async () => {
  const rows = [
    row('n1', { body: 'Older', field: 'bodyEn', quote: 'three new things', createdAt: '2026-11-01T09:00:00.000Z' }),
    row('n2', { body: 'Newer', field: 'subjectEn', quote: 'Notis Hub', createdAt: '2026-11-02T09:00:00.000Z' }),
  ];
  const calls: Call[] = [];
  function Plain() {
    current = usePassageComments({ fields: FIELDS, values: VALUES, group: 'EN',
      scope: { id: 'issue-1', recordKey: PAGE, name: '10.26', checkpoint: null } });
    return <PassageCommentPane comments={current} />;
  }
  await mount(<Plain />, fakeRuntime(rows, calls));
  assert.deepEqual(quotes(), ['Notis Hub', 'three new things'], 'the newest thread first');
  assert.deepEqual(current!.controller.modes, ['text', 'page']);
  await fire(doc.querySelector('[data-part="new-comment-button"]')!, new dom.window.MouseEvent('click', { bubbles: true }));
  const items = [...doc.querySelectorAll('[role^="menuitem"]')];
  assert.deepEqual(items.map(el => el.textContent), ['On words', 'On the whole page']);
  await fire(items[0]!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.match(doc.querySelector('.nui-comment-hint')!.textContent!, /Select words to comment on them/);
  await act(async () => { current!.controller.startMode('page'); });
  await settle();
  const box = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  assert.equal(doc.querySelector('.nui-comment-new-box')!.getAttribute('aria-label'), 'New comment');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(box, 'Whole issue: too long'); box.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await fire(box, new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const insert = calls.at(-1)!;
  assert.equal(insert.op, 'insert');
  assert.equal(insert.input.page_key, PAGE);
  assert.equal(insert.input.mode, 'page');
  assert.equal(insert.input.quote, undefined, 'a comment on the whole page has no passage');

  await fire(doc.querySelector('[data-thread="n2"] button[aria-label^="Archive the comment thread: "]')!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls.at(-1), { op: 'archive', input: { root_id: 'n2' } });
  assert.deepEqual(quotes(), ['three new things']);
  await fire(doc.body, new dom.window.KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
  assert.deepEqual(calls.at(-1), { op: 'unarchive', input: { root_id: 'n2' } }, 'Z undoes');
  assert.deepEqual(quotes(), ['Notis Hub', 'three new things']);
});

test('PassageCommentBox: the To chip names the best match and the saved comment is linked to it', async () => {
  const linked: unknown[] = [];
  const comments: Partial<SpaceCommentsTransport> = {
    bestMatch: async () => ({ threadId: 't-best', title: 'Newsletter' }),
    link: async input => { linked.push(input); return null; },
  };
  const calls: Call[] = [];
  const runtime = fakeRuntime(ROWS, calls, { comments });
  await mount(<Harness />, runtime);
  await act(async () => { current!.startDraft({ field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' }); });
  await settle();
  assert.match(doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!.textContent!, /To Newsletter/);
  const box = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(box, 'Say launched'); box.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await fire(box, new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual(linked, [{ rootId: storeOf(runtime).rows.at(-1)!.id, pick: { threadId: 't-best', title: 'Newsletter' } }]);
});

test('PassageCommentBox: pictures and files attach by paste, drop or the paperclip and are saved with the comment (SPC-131)', async () => {
  const calls: Call[] = [];
  await mount(<Harness />, fakeRuntime(ROWS, calls, { upload: true }));
  await act(async () => { current!.startDraft({ field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' }); });
  await settle();
  const box = doc.querySelector('.nui-comment-new-box')!;
  const field = box.querySelector('textarea') as HTMLTextAreaElement;
  const send = () => box.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
  assert.ok(send().disabled, 'nothing to send yet');
  // Paste a picture in the text, drop a file on the box, pick one with the paperclip.
  const pasted = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(pasted, 'clipboardData', { value: {
    files: [new File([new Uint8Array([0x89, 0x50])], 'shot.png', { type: 'image/png' })], getData: () => '' } });
  await fire(field, pasted);
  for (const type of ['dragover', 'drop']) {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], dropEffect: 'none',
      files: [new File([new Uint8Array([0x25])], 'brief.pdf', { type: 'application/pdf' })] } });
    await fire(box, event);
  }
  assert.ok(button('Attach pictures or files'), 'the paperclip shows');
  const input = box.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' })], configurable: true });
  await fire(input, new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual([...box.querySelectorAll('.nui-comment-file-name')].map(el => el.textContent), ['shot.png', 'brief.pdf', 'notes.txt']);
  assert.equal(writes(calls, 'upload').length, 3);
  // Files alone are enough to send; they are saved with the comment and its passage.
  assert.equal(send().disabled, false);
  await fire(send(), new dom.window.MouseEvent('click', { bubbles: true }));
  const [insert] = writes(calls, 'insert') as Array<{ attachments: Array<{ name: string; path: string }>; quote: string }>;
  assert.deepEqual(insert!.attachments.map(file => [file.name, file.path]), [
    ['shot.png', 'comments/shot.png'], ['brief.pdf', 'comments/brief.pdf'], ['notes.txt', 'comments/notes.txt']]);
  assert.equal(insert!.quote, 'is live');
  assert.equal(doc.querySelector('.nui-comment-new-box'), null, 'the box closes once saved');
});

test('A link to one comment: the comment view param opens its thread and flashes its passage', async () => {
  await mount(<Harness />, fakeRuntime(ROWS, [], { params: { comment: 'c4' } }));
  assert.equal(current!.controller.threadKey, 'c4');
  assert.equal(current!.flash?.key, 'c4');
});

test('A link the host took away is forgotten: the same link again opens its thread again (Codex5)', async () => {
  const linked = withHostPanel(fakeRuntime(ROWS, [], { params: { comment: 'c4' } }));
  const withParams = (params: Record<string, string>) => ({ ...linked, context: { ...linked.context, params } }) as NotisRuntime;
  await mount(<Harness />, linked);
  assert.equal(current!.controller.threadKey, 'c4');
  await act(async () => { current!.openKey('c1', 'pane'); });
  await settle();
  assert.equal(current!.controller.threadKey, 'c1', 'the reader moved on');
  await rerender(<Harness />, withParams({}));
  assert.equal(current!.controller.threadKey, 'c1', 'the link going away moves nothing');
  await rerender(<Harness />, withParams({ comment: 'c4' }));
  assert.equal(current!.controller.threadKey, 'c4', 'the same link again opens it again');
});

// ---------------------------------------------------------------------------
// Fixes: draftPin, the viewer as author, a cancelled pick, the Comment button placement
// ---------------------------------------------------------------------------

async function typeIn(box: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(box, value); box.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
}

test('The passage controller shows the comment on the whole page as draftPin, for the host', async () => {
  await mount(<Harness />, fakeRuntime(ROWS, []));
  assert.equal(current!.draftPin, null);
  await act(async () => { current!.controller.startMode('page'); });
  await settle();
  assert.ok(current!.draftPin, 'the page comment shows on the passage controller');
  assert.equal(current!.draftPin, current!.controller.draftPin);
});

test('A passage comment waits for the viewer, is written as the viewer, and cancelling forgets its pick', async () => {
  const calls: Call[] = [];
  await mount(<Harness />, fakeRuntime(ROWS, calls, { comments: { viewer: undefined } }));
  await act(async () => { current!.startDraft({ field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' }); });
  await settle();
  const box = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await typeIn(box, 'Say launched');
  assert.equal(button('Send')!.disabled, true);
  await fire(box, new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(calls.length, 0, 'nothing is sent while the viewer is unknown');

  const named: Call[] = [];
  const comments: Partial<SpaceCommentsTransport> = {
    viewer: { name: 'Ana', canEditSpace: true },
    bestMatch: async () => null,
    pickThread: async () => ({ threadId: 't-9', title: 'Copy pass' }),
  };
  const runtime = fakeRuntime(ROWS, named, { comments });
  await mount(<Harness />, runtime);
  await act(async () => { current!.startDraft({ field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' }); });
  await settle();
  await fire(doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(current!.controller.routing.newPick);
  await act(async () => { current!.cancelDraft(); });
  assert.equal(current!.controller.routing.newPick, null, 'a cancelled comment forgets its pick');
  await act(async () => { current!.startDraft({ field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' }); });
  await settle();
  const next = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await typeIn(next, 'Say launched');
  await fire(next, new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const [insert] = writes(named, 'insert');
  assert.equal('author' in insert!, false, 'the server signs the comment, the pane names no author');
  assert.equal(storeOf(runtime).rows.at(-1)!.author.name, 'Ana');
});

test('Record A to B while mounted: each record keeps its own passage draft, never the other one\'s quote', async () => {
  await mount(<Harness />, fakeRuntime(ROWS, []));
  const scopeA = current!.controller.draftScope;
  assert.equal(scopeA, 's1|comments|issue-1|ik1');
  const keyA = commentDraftKey(scopeA, 'passage');
  const keyB = commentDraftKey('s1|comments|issue-2|ik2', 'passage');
  const onA = { field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' };
  const onB = { field: 'bodyEn', quote: 'this week', prefix: 'Hi there, ', suffix: ' brings' };
  // B has a comment left being written on its own passage.
  writeCommentDraft(keyB, { text: 'On B', place: onB });
  await act(async () => { current!.startDraft(onA); });
  await settle();
  await typeIn(doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement, 'On A');

  await rerender(<Harness record={{ id: 'issue-2', recordKey: 'ik2' }} />, fakeRuntime(ROWS, []));
  assert.equal(current!.controller.draftScope, 's1|comments|issue-2|ik2');
  assert.deepEqual(current!.draft, onB, 'B shows its own passage');
  // The box keeps its attached files with the draft too (none here).
  const textAndPlace = (key: string | null) => { const { files = [], ...rest } = readCommentDraft(key) ?? {}; return { ...rest, files: files.length }; };
  assert.deepEqual(textAndPlace(keyB), { text: 'On B', place: onB, files: 0 }, 'B keeps its text with its own quote');
  assert.deepEqual(textAndPlace(keyA), { text: 'On A', place: onA, files: 0 }, 'A keeps its draft');

  await rerender(<Harness />, fakeRuntime(ROWS, []));
  assert.deepEqual(current!.draft, onA, 'back on A, its passage comes back');

  // A record with nothing left being written shows no passage draft, and none is saved under its key.
  await rerender(<Harness record={{ id: 'issue-3', recordKey: 'ik3' }} />, fakeRuntime(ROWS, []));
  assert.equal(current!.draft, null);
  assert.equal(readCommentDraft(commentDraftKey('s1|comments|issue-3|ik3', 'passage')), undefined);
});

test('A thread picked with the To chip on record A never links record B\'s new comment', async () => {
  const linked: unknown[] = [];
  const comments: Partial<SpaceCommentsTransport> = {
    viewer: { name: 'Ana', canEditSpace: true },
    bestMatch: async () => ({ threadId: 't-best', title: 'Newsletter' }),
    pickThread: async () => ({ threadId: 't-9', title: 'Copy pass' }),
    link: async input => { linked.push(input); return null; },
  };
  const runtime = fakeRuntime(ROWS, [], { comments });
  await mount(<Harness />, runtime);
  await act(async () => { current!.startDraft({ field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' }); });
  await settle();
  await fire(doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(current!.controller.routing.newPick, { threadId: 't-9', title: 'Copy pass' });

  await rerender(<Harness record={{ id: 'issue-2', recordKey: 'ik2' }} />, runtime);
  assert.equal(current!.controller.routing.newPick, null, 'B has no pick of its own');
  await act(async () => { current!.startDraft({ field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' }); });
  await settle();
  assert.match(doc.querySelector('.nui-comment-new-box [data-part="to-chip"]')!.textContent!, /To Newsletter/);
  const box = doc.querySelector('.nui-comment-new-box textarea') as HTMLTextAreaElement;
  await typeIn(box, 'On B');
  await fire(box, new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual(linked, [{ rootId: storeOf(runtime).rows.at(-1)!.id, pick: { threadId: 't-best', title: 'Newsletter' } }],
    'B\'s comment goes to its best match, not A\'s pick');

  await rerender(<Harness />, runtime);
  assert.deepEqual(current!.controller.routing.newPick, { threadId: 't-9', title: 'Copy pass' }, 'A keeps its pick');
});

test('The Comment button never covers words: in the margin, after the selection, else above it (below only at the top)', async () => {
  const RangeProto = dom.window.Range.prototype as unknown as { getClientRects?: () => unknown };
  const before = RangeProto.getClientRects;
  const rect = (top: number) => ({ left: 50, right: 120, top, bottom: top + 18, width: 70, height: 18, x: 50, y: top });
  let top = 300;
  let lastRight = 40;
  RangeProto.getClientRects = () => [rect(top), { ...rect(top + 20), left: 0, right: lastRight, width: lastRight }];
  try {
    await mount(<Harness rich={<div contentEditable suppressContentEditableWarning>Hi there, this week brings three new
      things.</div>} />, fakeRuntime(ROWS, []));
    const wrap = doc.querySelector('.nui-passage-rich') as HTMLElement;
    let right = 400;
    wrap.getBoundingClientRect = () => ({ left: 0, top: 200, right, bottom: 600, width: right, height: 400, x: 0, y: 200,
      toJSON: () => ({}) }) as DOMRect;
    const editable = doc.querySelector('.nui-passage-rich [contenteditable]')!;
    const textNode = editable.firstChild as Text;
    const start = textNode.data.indexOf('this week');
    const range = doc.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 'this week'.length);
    const selection = dom.window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const pickAt = async () => {
      await fire(editable, new dom.window.MouseEvent('mouseup', { bubbles: true }));
      const pick = doc.querySelector('.nui-passage-pick') as HTMLElement;
      return { place: pick.getAttribute('data-place'), top: pick.style.top, left: pick.style.left };
    };
    // A wide screen: in the margin right of the text, level with the first selected line.
    assert.deepEqual(await pickAt(), { place: 'margin', top: '93px', left: '408px' });

    // No margin: just after the end of the selection, on its last line.
    right = dom.window.innerWidth - 20;
    assert.deepEqual(await pickAt(), { place: 'end', top: '113px', left: '48px' });

    // The last line is full: above the first selected line, never on the words.
    lastRight = right - 20;
    assert.deepEqual(await pickAt(), { place: 'above', top: '94px', left: '50px' });

    top = 10;
    assert.equal((await pickAt()).place, 'below', 'no room above at the top of the screen');
  } finally {
    RangeProto.getClientRects = before;
  }
});

test('At 390 px the Comment button never sits on the selected line: words after the selection send it above', async () => {
  // A phone column: 16 px gutters, 358 px of text, 8 px per character (44 to a line), 20 px lines of 18 px boxes.
  const ORIGIN = { left: 16, top: 200, width: 358 };
  const PER_LINE = 44;
  const charBox = (index: number) => {
    const line = Math.floor(index / PER_LINE);
    const left = ORIGIN.left + (index % PER_LINE) * 8;
    const top = ORIGIN.top + line * 20;
    return { left, right: left + 8, top, bottom: top + 18, width: 8, height: 18, x: left, y: top };
  };
  /** One box per line of the range, as a browser gives. */
  const lineBoxes = (start: number, end: number) => {
    const out: ReturnType<typeof charBox>[] = [];
    for (let at = start; at < end;) {
      const stop = Math.min(end, (Math.floor(at / PER_LINE) + 1) * PER_LINE);
      const a = charBox(at);
      const b = charBox(stop - 1);
      out.push({ ...a, right: b.right, width: b.right - a.left });
      at = stop;
    }
    return out;
  };
  const RangeProto = dom.window.Range.prototype as unknown as { getClientRects?: () => unknown; getBoundingClientRect?: () => unknown };
  const before = { rects: RangeProto.getClientRects, rect: RangeProto.getBoundingClientRect };
  const width = Object.getOwnPropertyDescriptor(dom.window, 'innerWidth');
  RangeProto.getClientRects = function (this: Range) { return lineBoxes(this.startOffset, this.endOffset); };
  RangeProto.getBoundingClientRect = function (this: Range) { return lineBoxes(this.startOffset, this.endOffset)[0]; };
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 390 });
  const TEXT = 'We launch the new comments panel on Tuesday. The panel lists every thread of the page, newest first.';
  try {
    await mount(<Harness rich={<div contentEditable suppressContentEditableWarning>{TEXT}</div>} />, fakeRuntime(ROWS, []));
    const wrap = doc.querySelector('.nui-passage-rich') as HTMLElement;
    wrap.getBoundingClientRect = () => ({ ...ORIGIN, right: ORIGIN.left + ORIGIN.width, bottom: 400, height: 200,
      x: ORIGIN.left, y: ORIGIN.top, toJSON: () => ({}) }) as DOMRect;
    const editable = doc.querySelector('.nui-passage-rich [contenteditable]')!;
    const textNode = editable.firstChild as Text;
    const select = async (words: string) => {
      const start = TEXT.indexOf(words);
      const range = doc.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + words.length);
      const selection = dom.window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      await fire(editable, new dom.window.MouseEvent('mouseup', { bubbles: true }));
      const pick = doc.querySelector('.nui-passage-pick') as HTMLElement;
      const place = pick.getAttribute('data-place')!;
      const top = parseFloat(pick.style.top) + ORIGIN.top - (place === 'above' ? 32 : 0);
      const left = parseFloat(pick.style.left) + ORIGIN.left;
      return { place, button: { top, bottom: top + 32, left, right: left + 120 }, start, end: start + words.length };
    };
    /** Every character box on the lines the selection is on. */
    const lineChars = (start: number, end: number) => {
      const lines = new Set([Math.floor(start / PER_LINE), Math.floor((end - 1) / PER_LINE)]);
      return [...TEXT].flatMap((char, index) => lines.has(Math.floor(index / PER_LINE)) && char.trim() ? [charBox(index)] : []);
    };
    const covers = (button: { top: number; bottom: number; left: number; right: number }, chars: ReturnType<typeof charBox>[]) =>
      chars.some(char => char.left < button.right && char.right > button.left && char.top < button.bottom && char.bottom > button.top);

    // "new comments" sits mid-line with room after it: the sentence goes on there, so the button goes above.
    const mid = await select('new comments');
    assert.equal(mid.place, 'above', 'not after the selection, over the next words');
    assert.equal(covers(mid.button, lineChars(mid.start, mid.end)), false, 'no word of the selected line is covered');
    assert.ok(mid.button.right <= 390 - 16, 'inside the column');

    // The last words of the text: nothing follows on their line, so the button sits just after them.
    const last = await select('newest first.');
    assert.equal(last.place, 'end');
    assert.equal(covers(last.button, lineChars(last.end - 1, last.end)), false, 'no word of the last selected line is covered');
    assert.ok(last.button.right <= 390 - 16, 'inside the column');
  } finally {
    RangeProto.getClientRects = before.rects;
    RangeProto.getBoundingClientRect = before.rect;
    if (width) Object.defineProperty(dom.window, 'innerWidth', width);
    else delete (dom.window as unknown as { innerWidth?: number }).innerWidth;
  }
});

// ---------------------------------------------------------------------------
// Fix round 2: scrolling, reveal, archived highlights, the draft highlight, agent questions
// ---------------------------------------------------------------------------

/** Runs `body` with every Range on one line box, so highlights draw in the test document. */
async function withRangeBoxes(body: () => Promise<void>) {
  const RangeProto = dom.window.Range.prototype as unknown as { getClientRects?: () => unknown };
  const before = RangeProto.getClientRects;
  RangeProto.getClientRects = () => [{ left: 50, right: 120, top: 300, bottom: 318, width: 70, height: 18, x: 50, y: 300 }];
  try { await body(); } finally { RangeProto.getClientRects = before; }
}

const RICH = <div contentEditable suppressContentEditableWarning>Hi there, this week brings three new things.</div>;

test('The passage pane scrolls its own list, with the toast under it', async () => {
  await mount(<Harness />, fakeRuntime(ROWS, []));
  const pane = doc.querySelector('#panel .nui-comment-pane')!;
  const list = pane.querySelector(':scope > [data-comment-scroll]')!;
  assert.ok(list.querySelector('[data-thread="c1"]'), 'the threads are in the scrolled list');
  await fire(doc.querySelector('[data-thread="c1"] button[aria-label^="Archive the comment thread: "]')!,
    new dom.window.MouseEvent('click', { bubbles: true }));
  const toast = pane.querySelector('.nui-toast-wrap')!;
  assert.equal(toast.parentElement, pane);
  assert.equal(toast.closest('[data-comment-scroll]'), null);
});

test('Text highlights: an archived thread keeps none unless Done or All shows, and the draft keeps its words lit', async () => {
  await withRangeBoxes(async () => {
    const rows = [...ROWS, row('c5', { body: 'Settled', field: 'bodyEn', quote: 'this week', status: 'archived' })];
    await mount(<Harness rich={RICH} />, fakeRuntime(rows, []));
    assert.ok(doc.querySelector('.nui-passage-mark[data-passage="c1"]'), 'an open thread is highlighted');
    assert.equal(doc.querySelector('.nui-passage-mark[data-passage="c5"]'), null, 'an archived one is not');
    await act(async () => { current!.controller.setStatusFilter('all'); });
    await settle();
    assert.ok(doc.querySelector('.nui-passage-mark[data-passage="c5"]'), 'All shows it again');
    await act(async () => { current!.controller.setStatusFilter('open'); });
    await act(async () => { current!.startDraft({ field: 'bodyEn', quote: 'Hi there', prefix: '', suffix: ', this week' }); });
    await settle();
    const draft = doc.querySelector('.nui-passage-mark[data-state="draft"]');
    assert.ok(draft, 'the words being commented stay highlighted while the box is open');
    assert.equal(draft!.hasAttribute('data-passage'), false, 'the draft is no thread to open');
    await act(async () => { current!.cancelDraft(); });
    await settle();
    assert.equal(doc.querySelector('.nui-passage-mark[data-state="draft"]'), null);
  });
  await mount(<Harness />, fakeRuntime(ROWS, []));
  await act(async () => { current!.startDraft({ field: 'subjectEn', quote: 'is live', prefix: 'Notis Hub ', suffix: '' }); });
  await settle();
  assert.ok(doc.querySelector('.nui-passage-text-field[data-state="selected"]'), 'a field with a draft stays marked');
});

test('revealRequest: a highlight or a field count on the page reveals, a quote in the pane does not', async () => {
  await withRangeBoxes(async () => {
    let source: { current(): { revealRequest?: number } } | null = null;
    const comments: Partial<SpaceCommentsTransport> = {
      attach(given) {
        source = given as never;
        given.show(doc.getElementById('panel'));
        return () => given.show(null);
      },
    };
    await mount(<Harness rich={RICH} />, fakeRuntime(ROWS, [], { comments }));
    assert.equal(current!.revealRequest, 0);
    await fire(button('Open the comments on this field')!, new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(current!.revealRequest, 1, 'the field count reveals');
    assert.equal(current!.controller.revealRequest, 1, 'the comment controller says the same');
    assert.equal(source!.current().revealRequest, 1, 'and the host source');
    const wrap = doc.querySelector('.nui-passage-rich') as HTMLElement;
    wrap.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0,
      toJSON: () => ({}) }) as DOMRect;
    await fire(wrap, new dom.window.MouseEvent('click', { bubbles: true, clientX: 60, clientY: 305 }));
    assert.equal(current!.controller.threadKey, 'c1');
    assert.equal(current!.revealRequest, 2, 'a highlight reveals');
    const quote = [...doc.querySelectorAll('.nui-comment-card [data-part="quote"]')].find(el => el.textContent?.includes('Notis Hub'))!;
    await fire(quote, new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(current!.controller.threadKey, 'c2');
    assert.equal(current!.revealRequest, 2, 'a quote in the pane does not');
  });
});

test('An agent question in a reply shows its answer controls in the passage pane', async () => {
  const calls: Call[] = [];
  const ask = { ...row('q1', { body: 'Which tone?', field: 'bodyEn', quote: 'three new things', thread: 'c1',
    createdAt: '2026-11-01T11:00:00.000Z' }), needs: 'choice' as const, options: ['Warm', 'Plain'],
  author: { user_id: 'user-flo', name: 'Flo', you: false }, agent: { name: 'Claude', thread_id: null, row_id: null } };
  await mount(<Harness />, fakeRuntime([...ROWS, ask], calls));
  const controls = doc.querySelector('[data-thread="c1"] [data-ask="q1"]');
  assert.ok(controls, 'the ask shows under the reply');
  await fire([...controls!.querySelectorAll('.nui-comment-option')].find(el => el.querySelector('.nui-comment-option-label')?.textContent === 'Plain')!,
    new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls.at(-1), { op: 'answer', input: { id: 'q1', answer: 'Plain' } });
});
