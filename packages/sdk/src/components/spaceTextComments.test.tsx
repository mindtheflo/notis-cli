import { dom } from '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../ui/engine';
import { SdkPresentation } from '../presentation';
import type { NotisRuntime } from '../runtime';
import type { SpaceCommentAnchor, SpaceCommentRow, SpaceCommentsTransport } from '../space';
import { changedPassages } from '../ui/comments/textHighlights';
import { PASSAGE_COMMENT_EVENT } from '../ui/comments/passageModel';
import {
  canCommentOnPage, commentOnSelection, locateTextComments, openTextComments, pageTextOf, startTextComment, textCommentAnchor,
} from './SpaceTextComments';
import { commentRow, memoryCommentStore } from '../../design-system/runtime/memoryComments';

const doc = dom.window.document;

function rangeOver(node: Node, text: string, words: string): Range {
  const start = text.indexOf(words);
  assert.ok(start >= 0, `"${words}" is in the text`);
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + words.length);
  return range;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test('textCommentAnchor keeps the words with 40 characters around them, across nodes, skipping the bar and styles', () => {
  const host = doc.createElement('div');
  host.innerHTML = '<style>p { color: red }</style><p>Ship the <b>new comments</b> panel on Tuesday.</p>'
    + '<div data-notis-selection-ui>Cite Comment</div><p>Then the rest.</p>';
  doc.body.replaceChildren(host);
  assert.equal(pageTextOf(host).text, 'Ship the new comments panel on Tuesday.Then the rest.');
  const bold = host.querySelector('b')!.firstChild!;
  const tail = host.querySelector('p')!.lastChild!;
  const range = doc.createRange();
  range.setStart(bold, 4);
  range.setEnd(tail, ' panel'.length);
  assert.deepEqual(textCommentAnchor(host, range), {
    mode: 'text', quote: 'comments panel', prefix: 'Ship the new ', suffix: ' on Tuesday.Then the rest.',
  });
  const blank = doc.createRange();
  blank.setStart(tail, 0);
  blank.setEnd(tail, 1);
  assert.equal(textCommentAnchor(host, blank), null, 'white space alone is no comment');
});

const ROWS: SpaceCommentRow[] = [
  commentRow({ id: 't1', page_key: 'p1', mode: 'text', quote: 'new comments', prefix: 'Ship the ', suffix: ' panel' }),
  commentRow({ id: 't2', page_key: 'p1', mode: 'text', quote: 'words long gone', prefix: '', suffix: '' }),
  commentRow({ id: 't3', page_key: 'p1', mode: 'text', quote: 'Tuesday', status: 'archived' }),
  commentRow({ id: 't4', page_key: 'p1', mode: 'text', quote: 'Tuesday', field: 'bodyEn' }),
  commentRow({ id: 't5', page_key: 'p1', mode: 'text', quote: 'Tuesday', thread_root_id: 't1' }),
  commentRow({ id: 't6', page_key: 'p1', mode: 'point', x: 0.1, y: 0.2 }),
  commentRow({ id: 't7', page_key: 'p1', mode: 'text', quote: 'Tuesday', view: 'other-view' }),
];

test('openTextComments keeps open first comments in text mode, on no named field, of this view', () => {
  assert.deepEqual(openTextComments(ROWS, 'board').map(row => row.id), ['t1', 't2']);
  assert.deepEqual(openTextComments(ROWS, null).map(row => row.id), ['t1', 't2', 't7'], 'no view known: every view');
});

test('locateTextComments finds the words again in the page and names the ones that are gone', () => {
  const host = doc.createElement('div');
  host.innerHTML = '<p>Ship the new <i>comments</i> panel on Tuesday.</p>';
  doc.body.replaceChildren(host);
  const { found, missing } = locateTextComments(host, openTextComments(ROWS, null).filter(row => row.id !== 't7'));
  assert.equal(found.get('t1')!.toString(), 'new comments');
  assert.deepEqual(missing, ['t2']);
});

test('canCommentOnPage: page text and a Space\'s own rich text (one bar, SPC-487), never a text field with its own Comment', () => {
  const host = doc.createElement('div');
  host.innerHTML = '<p>Page words</p><div class="nui-passage-text-field"><span>Field words</span></div>'
    + '<div class="nui-passage-rich-text"><em>Rich words</em></div>';
  doc.body.replaceChildren(host);
  const over = (selector: string) => {
    const range = doc.createRange();
    range.selectNodeContents(host.querySelector(selector)!.firstChild!);
    return range;
  };
  assert.equal(canCommentOnPage(over('p')), true);
  assert.equal(canCommentOnPage(over('span')), false);
  assert.equal(canCommentOnPage(over('em')), true);
});

test('commentOnSelection: words in a Space\'s own rich text go to that text, never to the host\'s page comment (SPC-487)', () => {
  const host = doc.createElement('div');
  host.innerHTML = '<p>Page words</p><div class="nui-passage-rich-text"><em>Rich words</em></div>';
  doc.body.replaceChildren(host);
  const rich = host.querySelector('.nui-passage-rich-text')!;
  const handed: string[] = [];
  rich.addEventListener(PASSAGE_COMMENT_EVENT, event => {
    handed.push(String((event as CustomEvent<{ range: Range }>).detail.range));
    event.preventDefault();
  });
  const started: unknown[] = [];
  const runtime = { spaceComments: { startComment: (anchor: unknown) => { started.push(anchor); } } } as unknown as NotisRuntime;
  const range = doc.createRange();
  range.selectNodeContents(host.querySelector('em')!.firstChild!);
  assert.equal(commentOnSelection(runtime, host, range), true);
  assert.deepEqual(handed, ['Rich words']);
  assert.deepEqual(started, [], 'the host opens no page comment for it');
});

test('startTextComment hands the words to the host on the page it shows, only when the host takes comments', () => {
  const host = doc.createElement('p');
  host.textContent = 'Ship the new comments panel on Tuesday.';
  doc.body.replaceChildren(host);
  const range = rangeOver(host.firstChild!, host.textContent, 'new comments');
  const started: unknown[] = [];
  const store = memoryCommentStore({ page: { recordKey: 'p1', view: 'board' },
    extra: { startComment: anchor => { started.push(anchor); } } });
  assert.equal(startTextComment({ spaceComments: store.transport } as NotisRuntime, host, range), true);
  assert.deepEqual(started, [{ mode: 'text', quote: 'new comments', prefix: 'Ship the ', suffix: ' panel on Tuesday.',
    page_key: 'p1', view: 'board' }]);
  const { startComment: _start, ...withoutStart } = store.transport;
  assert.equal(startTextComment({ spaceComments: withoutStart } as NotisRuntime, host, range), false, 'a host with no composer');
  assert.equal(startTextComment({} as NotisRuntime, host, range), false, 'comments off');
  assert.equal(started.length, 1);
});

// ---------------------------------------------------------------------------
// Every Space page: Cite always, Comment only with the comment store
// ---------------------------------------------------------------------------

const PAGE_TEXT = 'Ship the new comments panel on Tuesday.';

let root: Root | null = null;
test.after(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
});

async function settle() {
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}

function spaceRuntime(spaceComments?: SpaceCommentsTransport): NotisRuntime {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: `text-comments-${Math.random()}` },
    context: { params: {}, locale: 'en' },
    addContext: async () => undefined,
    callAction: async (action: string) => { throw new Error(`No Space action may run here (${action}).`); },
    ...(spaceComments ? { spaceComments } : {}),
  } as unknown as NotisRuntime;
}

/** Mounts a Space page through the presentation every host uses; the page shows `PAGE_TEXT`. */
async function present(runtime: NotisRuntime, page: ReactNode = <p data-page>{PAGE_TEXT}</p>) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div><div id="mount"></div>';
  root = createRoot(doc.getElementById('app')!);
  const mount = doc.getElementById('mount')!;
  const Page = () => <>{page}</>;
  await act(async () => {
    root!.render(
      <KeyboardEngine host="preview" locale="en" platform="mac" engine={new KeyboardEngineCore()} document={doc} strict>
        <SdkPresentation mount={mount} runtime={runtime} component={Page} theme={{ mode: 'light', style: {} }}
          resetKey="page" fallback={() => null} onError={() => undefined} />
      </KeyboardEngine>,
    );
  });
  await settle();
}

/** Selects `words` of the page and lets the selection end (mouse up): the bar reads it. */
async function selectWords(words: string) {
  const text = doc.querySelector('[data-page]')!.firstChild!;
  const selection = dom.window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(rangeOver(text, PAGE_TEXT, words));
  await act(async () => { doc.querySelector('[data-page]')!.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true })); });
  await settle();
}

const barLabels = () => [...doc.querySelectorAll('[data-notis-selection-ui] button')].map(el => el.textContent?.trim());

/** Every Range on one line box, so the bar can place itself and a highlight can be hit in the test document. */
async function withRangeBoxes(body: () => Promise<void>) {
  const proto = dom.window.Range.prototype as unknown as { getClientRects?: () => unknown; getBoundingClientRect?: () => unknown };
  const before = { rects: proto.getClientRects, rect: proto.getBoundingClientRect };
  const box = { left: 50, right: 150, top: 100, bottom: 118, width: 100, height: 18, x: 50, y: 100, toJSON: () => ({}) };
  proto.getClientRects = () => [box];
  proto.getBoundingClientRect = () => box;
  try { await body(); } finally {
    proto.getClientRects = before.rects;
    proto.getBoundingClientRect = before.rect;
  }
}

test('The selection bar on a Space page: Cite always, Comment only while the host takes comments', async () => {
  await withRangeBoxes(async () => {
    await present(spaceRuntime());
    await selectWords('new comments');
    assert.deepEqual(barLabels(), ['Cite'], 'comments off (flag off, Site, link, older host): Cite alone');

    const started: Array<SpaceCommentAnchor & { page_key?: string | null }> = [];
    const store = memoryCommentStore({ page: { recordKey: 'p1', view: 'board' } });
    await present(spaceRuntime(store.transport));
    await selectWords('new comments');
    assert.deepEqual(barLabels(), ['Cite'], 'a host with a store but no composer (no startComment): Cite alone');

    const withComposer = memoryCommentStore({ page: { recordKey: 'p1', view: 'board' },
      extra: { startComment: anchor => { started.push(anchor); } } });
    await present(spaceRuntime(withComposer.transport));
    await selectWords('new comments');
    assert.deepEqual(barLabels(), ['Cite', 'Comment']);
    const comment = [...doc.querySelectorAll('[data-notis-selection-ui] button')].find(el => el.textContent?.trim() === 'Comment')!;
    await act(async () => { comment.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await settle();
    assert.deepEqual(started, [{ mode: 'text', quote: 'new comments', prefix: 'Ship the ', suffix: ' panel on Tuesday.',
      page_key: 'p1', view: 'board' }]);
    assert.deepEqual(barLabels(), [], 'the bar goes once Comment is pressed');
  });
});

test('Every Space page highlights its open text comments, reports the gone ones, and opens a thread on a click', async () => {
  await withRangeBoxes(async () => {
    const revealed: string[] = [];
    const reported: Array<{ page: string | null; ids: readonly string[] }> = [];
    const store = memoryCommentStore({ rows: ROWS, page: { recordKey: 'p1', view: 'board' }, extra: {
      revealComment: id => { revealed.push(id); },
      passagesChanged: input => { reported.push({ page: input.page, ids: [...input.ids] }); },
    } });
    await present(spaceRuntime(store.transport));
    assert.ok(doc.querySelector('style[data-notis-comment-highlights]'), 'the highlight style is drawn');
    assert.deepEqual(reported.at(-1), { page: 'p1', ids: ['t2'] }, 'the words of t2 are gone from the page');
    assert.deepEqual([...changedPassages()], ['t2'], 'its thread card reads Passage changed');
    assert.equal(store.rows.find(row => row.id === 't2')!.status, 'open', 'nothing closes it');
    dom.window.getSelection()!.removeAllRanges();
    await act(async () => {
      doc.querySelector('[data-page]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 60, clientY: 105 }));
    });
    assert.deepEqual(revealed, ['t1'], 'a click on the highlighted words opens their thread in the host panel');
  });
});

test('On the Space home the highlights read the Space\'s open threads, as its pane does, never every comment of the home', async () => {
  await withRangeBoxes(async () => {
    const reported: Array<{ page: string | null; ids: readonly string[] }> = [];
    const asked: unknown[] = [];
    const home = ROWS.map(row => ({ ...row, page_key: null }));
    const elsewhere = { ...ROWS[0]!, id: 'other-page', page_key: 'p9', quote: 'Tuesday' };
    const store = memoryCommentStore({ rows: [...home, elsewhere], page: { recordKey: null, view: 'board' }, extra: {
      passagesChanged: input => { reported.push({ page: input.page, ids: [...input.ids] }); },
    } });
    const open = () => store.rows.filter(row => (row.thread_root_id ? store.rows.find(root => root.id === row.thread_root_id)?.status : row.status) === 'open');
    const threads = async (input: unknown) => {
      asked.push(input);
      return { comments: open(), revision: 1, counts: null, numbers: {}, changes: null, moreDone: false };
    };
    await present(spaceRuntime({ ...store.transport, threads }));
    assert.deepEqual(asked, [{}], 'the open threads are asked for');
    assert.equal(store.reads(), 0, 'the home is not listed');
    assert.ok(doc.querySelector('style[data-notis-comment-highlights]'), 'the highlight style is drawn');
    assert.deepEqual(reported.at(-1), { page: null, ids: ['t2'] }, 'as on a page: the words of t2 are gone, and a comment of another page is not the home\'s');

    // A host whose server cannot read by thread answers null: the home is listed, as before.
    reported.length = 0;
    const older = memoryCommentStore({ rows: home, page: { recordKey: null, view: 'board' }, extra: {
      passagesChanged: input => { reported.push({ page: input.page, ids: [...input.ids] }); },
    } });
    await present(spaceRuntime({ ...older.transport, threads: async () => null }));
    assert.equal(older.reads(), 1);
    assert.deepEqual(reported.at(-1), { page: null, ids: ['t2'] });

    // A record page reads its own comments, as before.
    const paged = memoryCommentStore({ rows: ROWS, page: { recordKey: 'p1', view: 'board' } });
    asked.length = 0;
    await present(spaceRuntime({ ...paged.transport, threads }));
    assert.deepEqual(asked, []);
    assert.equal(paged.reads(), 1);
  });
});

test('Without the comment store a Space page draws no highlights and lists nothing', async () => {
  await present(spaceRuntime());
  assert.equal(doc.querySelector('style[data-notis-comment-highlights]'), null);
});

test('a Space page reads its text highlights once the page goes idle, never during the open (SPC-859)', async () => {
  const idle: Array<() => void> = [];
  const win = dom.window as unknown as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
  const saved = { request: win.requestIdleCallback, cancel: win.cancelIdleCallback };
  win.requestIdleCallback = (callback: () => void) => idle.push(callback);
  win.cancelIdleCallback = () => {};
  try {
    const store = memoryCommentStore({ rows: ROWS, page: { recordKey: 'p1', view: 'board' } });
    let reads = 0;
    const transport = { ...store.transport, list: (input: Parameters<typeof store.transport.list>[0]) => {
      reads += 1;
      return store.transport.list(input);
    } };
    await present(spaceRuntime(transport));
    assert.equal(reads, 0, 'the open does not read the highlights');
    assert.equal(idle.length, 1, 'the read waits for the page to go idle');
    await act(async () => { idle[0](); });
    await settle();
    assert.equal(reads, 1, 'once idle, the highlights read the page\'s comments');
  } finally {
    if (saved.request === undefined) delete win.requestIdleCallback; else win.requestIdleCallback = saved.request;
    if (saved.cancel === undefined) delete win.cancelIdleCallback; else win.cancelIdleCallback = saved.cancel;
  }
});
