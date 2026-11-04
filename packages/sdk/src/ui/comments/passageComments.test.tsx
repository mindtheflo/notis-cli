import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { NotisProvider } from '../../provider';
import type { NotisRuntime } from '../../runtime';
import { w } from '../../words';
import {
  CommentableRichText, CommentableText, PASSAGE_COLUMNS, PassageCommentPane, locatePassage, markdownReadableText,
  passageAt, passageOffset, passageProperties, readPassage, usePassageComments, type PassageCommentController,
  type PassageField,
} from '.';

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

const text = (value: string) => ({ type: 'rich_text', rich_text: [{ text: { content: value } }] });
const select = (value: string) => ({ type: 'select', select: { name: value } });

const FIELDS: PassageField[] = [
  { key: 'subjectEn', label: w('Subject', 'Objet'), group: 'EN', values: { Field: 'Subject', Language: 'EN' } },
  { key: 'bodyEn', label: w('Body', 'Corps'), group: 'EN', markdown: true, values: { Field: 'Body', Language: 'EN' } },
  { key: 'subjectFr', label: w('Subject', 'Objet'), group: 'FR', values: { Field: 'Subject', Language: 'FR' } },
  { key: 'bodyFr', label: w('Body', 'Corps'), group: 'FR', markdown: true, values: { Field: 'Body', Language: 'FR' } },
];

test('readPassage and passageProperties: a field named by several columns, and undeclared fields ignored', () => {
  const properties = passageProperties({ field: 'bodyFr', quote: 'quelques mots', prefix: 'avec ', suffix: '' }, FIELDS[3]!);
  assert.deepEqual(properties, { Field: 'Body', Language: 'FR', Quote: 'quelques mots', Prefix: 'avec ', Suffix: null });
  const row = { record_key: 'c1', properties: {
    Field: select('Body'), Language: select('FR'), Quote: text('quelques mots'), Prefix: text('avec '), Suffix: text(''),
  } };
  assert.deepEqual(readPassage(row, FIELDS), { field: 'bodyFr', quote: 'quelques mots', prefix: 'avec ', suffix: '' });
  assert.equal(readPassage({ properties: { Field: select('Footer'), Language: select('FR'), Quote: text('x') } }, FIELDS), null);
  assert.equal(readPassage({ properties: { Field: select('Body'), Language: select('FR') } }, FIELDS), null, 'no quote: not a passage');
  const simple: PassageField[] = [{ key: 'Body', label: w('Body', 'Corps') }];
  assert.deepEqual(passageProperties({ field: 'Body', quote: 'q', prefix: '', suffix: 's' }, simple[0]!),
    { [PASSAGE_COLUMNS.field]: 'Body', Quote: 'q', Prefix: null, Suffix: 's' });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function row(key: string, fields: { body: string; field: string; lang: string; quote: string; prefix?: string; suffix?: string;
  status?: string; thread?: string }): Record<string, unknown> {
  return {
    id: `id-${key}`, record_key: key, revision: 1, title: fields.body, created_at: '2026-11-01T10:00:00.000Z',
    properties: {
      Issue: { type: 'relation', relation: [{ id: 'issue-1' }] }, Author: select('Flo'), Status: select(fields.status ?? 'Open'),
      Needs: select('none'), Thread: text(fields.thread ?? ''), Field: select(fields.field), Language: select(fields.lang),
      Quote: text(fields.quote), Prefix: text(fields.prefix ?? ''), Suffix: text(fields.suffix ?? ''),
      Example: { type: 'checkbox', checkbox: false },
    },
  };
}

const ROWS = [
  row('c1', { body: 'Shorter?', field: 'Body', lang: 'EN', quote: 'three new things' }),
  row('c2', { body: 'Typo', field: 'Subject', lang: 'EN', quote: 'Notis Hub' }),
  row('c3', { body: 'Old wording', field: 'Body', lang: 'EN', quote: 'words that were removed' }),
  row('c4', { body: 'Plutôt ça', field: 'Body', lang: 'FR', quote: 'trois nouveautés' }),
];

interface Call { action: string; request: Record<string, unknown> }

let cacheCounter = 0;
function fakeRuntime(rows: Record<string, unknown>[], calls: Call[]) {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: {
      id: 's1', revision: 1, cacheScope: `passages-${cacheCounter += 1}`,
      actions: { 'comments.insert': { readOnly: false }, 'comments.update': { readOnly: false } },
      shows: { comments: { database: 'comments' } },
      bindings: { comments: { kind: 'database', operations: { insert: 'comments.insert', update: 'comments.update' } } },
    },
    context: { params: {}, locale: 'en' },
    shown: async () => ({ rows, schema_revision: 3 }),
    callAction: async (action: string, input: { request: Record<string, unknown> }) => {
      calls.push({ action, request: input.request });
      return { record_key: 'new-1', revision: 1 };
    },
    subscribeDatabase: () => () => {},
  } as unknown as NotisRuntime;
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

function Harness({ rich }: { rich?: ReactNode }) {
  const [group, setGroup] = useState('EN');
  showGroup = setGroup;
  current = usePassageComments({
    fields: FIELDS, values: VALUES, group,
    scope: { id: 'issue-1', recordKey: 'ik1', name: '10.26', checkpoint: null },
    columns: { scope: 'Issue', anchor: null },
    authors: ['Flo', 'Claude', 'Notis'],
  });
  return (
    <div>
      <CommentableText comments={current} field="subjectEn" value={VALUES.subjectEn}>
        <textarea aria-label="English subject" defaultValue={VALUES.subjectEn} />
      </CommentableText>
      {rich ? <CommentableRichText comments={current} field="bodyEn">{rich}</CommentableRichText> : null}
      <PassageCommentPane comments={current} groups={{ EN: w('the English copy', 'la version anglaise'),
        FR: w('the French copy', 'la version française') }} onGroup={group => setGroup(group)} />
    </div>
  );
}

async function settle() {
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}

async function mount(node: ReactNode, runtime: NotisRuntime) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => {
    root!.render(
      <NotisProvider runtime={runtime}>
        <KeyboardEngine host="preview" locale="en" platform="mac" engine={new KeyboardEngineCore()} document={doc} strict>
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
const quotes = () => [...doc.querySelectorAll('.nui-passage-anchor .nui-passage-quote')].map(el => el.textContent);

test('PassageCommentPane: quotes of the group on screen in reading order, Text changed, and the other group', async () => {
  await mount(<Harness />, fakeRuntime(ROWS, []));
  assert.deepEqual(quotes(), ['Notis Hub', 'three new things', 'words that were removed'],
    'Subject before Body, the passage no longer in the text last');
  const changed = [...doc.querySelectorAll('.nui-passage-anchor')].filter(el => el.hasAttribute('data-changed'))
    .map(el => el.querySelector('.nui-passage-quote')?.textContent);
  assert.deepEqual(changed, ['words that were removed']);
  assert.match(doc.body.textContent ?? '', /Text changed/);
  const other = button('1 on the French copy');
  assert.ok(other, 'the French thread is counted, as a link');
  await fire(other!, new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(quotes(), ['trois nouveautés']);
});

test('CommentableText: a selection offers Comment; the new comment saves its field, quote and surrounding words', async () => {
  const calls: Call[] = [];
  await mount(<Harness />, fakeRuntime(ROWS, calls));
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
  assert.equal(calls.length, 1);
  const input = calls[0]!.request as { properties: Record<string, unknown>; columns: Record<string, unknown> };
  assert.equal(calls[0]!.action, 'comments.insert');
  assert.equal(input.columns.title, 'Say launched');
  assert.deepEqual({ ...input.properties, 'Changed at': 'x' }, {
    Field: 'Subject', Language: 'EN', Quote: 'is live', Prefix: 'Notis Hub ', Suffix: null,
    Author: 'Flo', Status: 'Open', Needs: 'none', Example: false, Change: 'created', 'Changed at': 'x', Issue: ['issue-1'],
  });
  assert.equal(current!.draft, null);
  assert.equal(current!.controller.threadKey, 'new-1', 'the new thread is selected');
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

test('Opening a thread from its quote selects it and shows its group', async () => {
  const opened: string[] = [];
  function Opener() {
    const [group, setGroup] = useState<string>('EN');
    current = usePassageComments({
      fields: FIELDS, values: VALUES, group, columns: { scope: 'Issue', anchor: null },
      scope: { id: 'issue-1', recordKey: 'ik1', name: '10.26', checkpoint: null },
      onOpen: (thread, passage, from) => {
        opened.push(`${thread.root.recordKey}:${from}`);
        const next = passage ? current!.field(passage.field)?.group : undefined;
        if (next) setGroup(next);
      },
    });
    return <PassageCommentPane comments={current} />;
  }
  await mount(<Opener />, fakeRuntime(ROWS, []));
  const anchor = [...doc.querySelectorAll('.nui-passage-anchor')].find(el => el.textContent?.includes('three new things'))!;
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
