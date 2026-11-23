/**
 * A pane that shows a whole Space reads the comment threads it lists (`SpaceCommentsTransport.threads`), never every
 * comment of the Space, and a person sees what they saw before: the same cards in the same order under each choice of
 * the Filter, a link to one comment still opens its card (a Done one far down too), every open thread has its card
 * (what the run through the waiting comments walks and what the list that follows the page reads), and the totals,
 * pin numbers and the Copy changes number are the Space's. A host without that read answers as before.
 */

import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { NotisProvider } from '../../provider';
import type { NotisRuntime } from '../../runtime';
import { CommentPane, useComments, type CommentController, type UseCommentsOptions } from '.';
import type { SpaceCommentRow, SpaceCommentsTransport, SpaceCommentThreadsAnswer, SpaceCommentThreadsInput } from '../../space';
import { clearCommentDrafts } from './commentDrafts';
import { setWaitingCommentThreads } from './hostPanel';
import { resetReviewRunAnswered } from './reviewRun';
import { clearCommentRoutingCache } from './useCommentRouting';
import { commentRow, memoryCommentStore, type MemoryCommentStore } from '../../../design-system/runtime/memoryComments';

const doc = dom.window.document;
const PAGE_A = 'page-a';
const PAGE_B = 'page-b';

const minute = (n: number) => new Date(Date.parse('2026-10-01T08:00:00Z') + n * 60_000).toISOString();

/**
 * A Space of `threads` comment threads written a minute apart (t1 the oldest) on two pages and the Space home, each
 * with a reply: every fourth one open, every ninth deleted, the others Done. t8 (open) also holds a deleted reply.
 */
function spaceRows(threads: number, status = (n: number) => (n % 4 === 0 ? 'open' : n % 9 === 0 ? 'deleted' : 'archived')): SpaceCommentRow[] {
  const rows: SpaceCommentRow[] = [];
  for (let n = 1; n <= threads; n += 1) {
    const state = status(n) as SpaceCommentRow['status'];
    const page = n % 3 === 0 ? null : n % 3 === 1 ? PAGE_A : PAGE_B;
    rows.push(commentRow({ id: `t${n}`, page_key: page, body: state === 'deleted' ? '' : `Thread ${n}`, status: state, created_at: minute(n),
      change: state === 'open' ? 'created' : state === 'deleted' ? 'deleted' : 'resolved', deleted_at: state === 'deleted' ? minute(n) : null }));
    rows.push(commentRow({ id: `r${n}`, page_key: page, thread_root_id: `t${n}`, body: `Reply ${n}`, created_at: minute(n + 0.5),
      author: { user_id: 'user-claude', name: 'Claude', you: false } }));
  }
  if (threads >= 8) rows.push(commentRow({ id: 'gone8', page_key: PAGE_B, thread_root_id: 't8', body: '', status: 'deleted', created_at: minute(8.7) }));
  return rows;
}

interface Bounded { store: MemoryCommentStore; asked: SpaceCommentThreadsInput[]; runtime: NotisRuntime; hold(): { release(): void } }

/**
 * A host that reads by thread, as the Portal does, over an in-memory store: the open threads whole, Done threads in
 * pages of `page`, the named ones only, and what the server counts.
 */
function boundedHost(rows: readonly SpaceCommentRow[], options: { page?: number; changes?: number; params?: Record<string, string>;
  answer?: (input: SpaceCommentThreadsInput) => SpaceCommentThreadsAnswer | null | undefined } = {}): Bounded {
  const store = memoryCommentStore({ rows: rows.map(row => ({ ...row })) });
  const asked: SpaceCommentThreadsInput[] = [];
  const page = options.page ?? 50;
  let gate: Promise<void> | null = null;
  const threads = async (input: SpaceCommentThreadsInput): Promise<SpaceCommentThreadsAnswer | null> => {
    asked.push(JSON.parse(JSON.stringify(input)) as SpaceCommentThreadsInput);
    if (gate) await gate;
    const custom = options.answer?.(input);
    if (custom !== undefined) return custom;
    const all = store.rows;
    const roots = all.filter(row => !row.thread_root_id && row.status !== 'deleted');
    const newest = [...roots].sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    const open = newest.filter(row => row.status === 'open');
    const done = newest.filter(row => row.status === 'archived');
    let kept: SpaceCommentRow[];
    let moreDone = false;
    if (input.only) kept = roots.filter(row => input.only!.includes(row.id));
    else {
      // The pane asks for fifty more at a time; this host answers a page of `page` for each fifty.
      const pages = Math.ceil((input.done ?? 0) / 50) * page;
      kept = [...open, ...done.slice(0, pages)];
      moreDone = done.length > pages;
    }
    for (const id of input.include ?? []) {
      const named = all.find(row => row.id === id);
      const root = named ? roots.find(row => row.id === (named.thread_root_id ?? named.id)) : undefined;
      if (root && !kept.includes(root)) kept.push(root);
    }
    const ids = new Set(kept.map(row => row.id));
    // The server numbers a pin among every first comment of its page, deleted ones included.
    const numbers: Record<string, number> = {};
    for (const root of kept.filter(row => row.x != null)) {
      const before = all.filter(row => !row.thread_root_id && row.page_key === root.page_key && row.created_at <= root.created_at);
      numbers[root.id] = before.length;
    }
    return {
      comments: all.filter(row => ids.has(row.thread_root_id ?? row.id)).map(row => JSON.parse(JSON.stringify(row)) as SpaceCommentRow),
      revision: all.reduce((top, row) => Math.max(top, row.revision), 0),
      counts: input.only ? null : { open: open.length, done: done.length },
      numbers, changes: input.only ? null : options.changes ?? null, moreDone,
    };
  };
  const runtime = runtimeOf({ ...store.transport, threads }, options.params);
  return { store, asked, runtime, hold: () => {
    let release = () => {};
    gate = new Promise<void>((resolve) => { release = () => { gate = null; resolve(); }; });
    return { release };
  } };
}

let scopes = 0;
function runtimeOf(transport: SpaceCommentsTransport, params: Record<string, string> = {}): NotisRuntime {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: `threads-read-${scopes += 1}` },
    callAction: async (action: string) => { throw new Error(`No Space action may run for comments (${action}).`); },
    context: { params, locale: 'en', viewerName: 'Flo' },
    spaceComments: {
      ...transport,
      attach(source) {
        source.show(doc.getElementById('panel'));
        return () => source.show(null);
      },
    } as SpaceCommentsTransport,
  } as unknown as NotisRuntime;
}

/** The same Space behind a host that only lists whole pages (a Portal from before the bounded read). */
function wholeHost(rows: readonly SpaceCommentRow[], params: Record<string, string> = {}) {
  const store = memoryCommentStore({ rows: rows.map(row => ({ ...row })) });
  return { store, runtime: runtimeOf(store.transport, params) };
}

let root: Root | null = null;
let controller: CommentController | null = null;

/** How many cards the pane listed each time a thread was revealed (a link, a pin). */
const revealedWith: number[] = [];

function Harness(props: UseCommentsOptions) {
  controller = useComments(props);
  const reveal = controller.revealRequest;
  const listed = controller.visibleThreads.length;
  const seen = useRef(reveal);
  if (seen.current !== reveal) { seen.current = reveal; revealedWith.push(listed); }
  return <CommentPane controller={controller} />;
}

async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}

async function mount(node: ReactNode, runtime: NotisRuntime) {
  if (root) await act(async () => { root!.unmount(); });
  clearCommentDrafts();
  clearCommentRoutingCache();
  resetReviewRunAnswered();
  setWaitingCommentThreads(null);
  doc.body.innerHTML = '<div id="app"></div><div id="panel"></div>';
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

test.after(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  delete (dom.window as unknown as Record<string, unknown>).IntersectionObserver;
});

const cards = () => [...doc.querySelectorAll('.nui-comment-card')].map(card => card.getAttribute('data-thread'));
const headings = () => [...doc.querySelectorAll('.nui-comment-group-name')].map(node => node.textContent);
const entries = (thread: string) => [...doc.querySelectorAll(`[data-thread="${thread}"] .nui-comment-entry, [data-thread="${thread}"] .nui-comment-deleted`)].length;
const more = () => doc.querySelector('[data-part="loading-more"]');
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await settle();
}
async function pickFilter(filter: 'waiting' | 'open' | 'done' | 'all') {
  if (!doc.querySelector('.nui-comment-filter-item[data-filter]')) await click(doc.querySelector('.nui-comment-bar [data-part="filter-button"]')!);
  const item = doc.querySelector(`[role^="menuitem"] .nui-comment-filter-item[data-filter="${filter}"]`)?.closest('[role^="menuitem"]');
  assert.ok(item, `the filter menu offers ${filter}`);
  await click(item!);
  await settle(6);
}
/** The pane's list scrolls, as in the panel: it is taller than its box. Returns the box. */
function scrollingList(): HTMLElement {
  const box = doc.querySelector<HTMLElement>('[data-comment-scroll]')!;
  box.style.overflowY = 'auto';
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: 500 });
  Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 4000 });
  return box;
}
/** The reader moves the list with the wheel. */
async function wheel(box: HTMLElement) {
  await act(async () => { box.dispatchEvent(new dom.window.Event('wheel', { bubbles: true, composed: true })); });
  await settle(6);
}
/** What the pane shows now: its cards in order, under their page headings. */
const shown = () => ({ cards: cards(), headings: headings() });

/** A browser that says when the end of the list comes into view: the test holds it. */
function watchListEnd() {
  const seen: Array<{ fire(inView?: boolean): void; live: boolean }> = [];
  class Watch {
    private readonly entry: { fire(inView?: boolean): void; live: boolean };
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.entry = { fire: (inView = true) => callback([{ isIntersecting: inView }]), live: true };
      seen.push(this.entry);
    }
    observe() {}
    disconnect() { this.entry.live = false; }
  }
  (dom.window as unknown as Record<string, unknown>).IntersectionObserver = Watch;
  return {
    /** The list's end comes into view (or leaves it). */
    async reach(inView = true) {
      const live = seen.filter(item => item.live).at(-1);
      assert.ok(live, 'the end of the list is watched');
      await act(async () => { live!.fire(inView); });
      await settle(6);
    },
    stop() { delete (dom.window as unknown as Record<string, unknown>).IntersectionObserver; },
  };
}

test('the same cards in the same order under Open, Done and All, read by thread or as the whole Space', async () => {
  const rows = spaceRows(30);
  const whole = wholeHost(rows);
  await mount(<Harness />, whole.runtime);
  const before: Record<string, ReturnType<typeof shown>> = { open: shown() };
  for (const filter of ['done', 'all'] as const) { await pickFilter(filter); before[filter] = shown(); }
  await pickFilter('open');
  const replies = entries('t8');
  assert.ok(replies >= 3, 'a card shows its first comment, its reply and the line of a deleted reply');
  assert.equal(before.open.cards.length, 7, 'the seven open threads');
  assert.equal(before.all.cards.length, 27, 'every thread but the three deleted ones');
  assert.ok(before.open.headings.length > 1, 'grouped by page');

  const bounded = boundedHost(rows);
  await mount(<Harness />, bounded.runtime);
  assert.deepEqual(shown(), before.open, 'Open: the same cards, order and headings');
  assert.deepEqual(bounded.asked.at(-1), { done: 0, only: null, include: [] }, 'the open threads alone are asked for');
  assert.equal(entries('t8'), replies, 'a card still shows its replies, and the line of a deleted one');
  await pickFilter('done');
  assert.deepEqual(shown(), before.done, 'Done: the same');
  assert.equal(bounded.asked.at(-1)!.done, 50, 'the Done threads are asked for when the Filter shows them');
  await pickFilter('all');
  assert.deepEqual(shown(), before.all, 'All: the same');
  await pickFilter('open');
  assert.deepEqual(shown(), before.open);
  assert.equal(bounded.store.reads(), 0, 'the whole Space is never listed');
});

test('Done threads come a page at a time as the end of the list comes into view, and the list never says "No comments" meanwhile', async () => {
  const watch = watchListEnd();
  try {
    const rows = spaceRows(40, n => (n === 40 ? 'open' : 'archived'));
    const bounded = boundedHost(rows, { page: 15 });
    await mount(<Harness />, bounded.runtime);
    assert.deepEqual(cards(), ['t40']);
    assert.equal(more(), null, 'nothing more to read while the Filter shows open threads');
    const held = bounded.hold();
    await pickFilter('done');
    assert.ok(doc.querySelector('[data-part="loading"]'), 'the list says it is loading');
    assert.equal(doc.querySelector('.nui-comment-empty'), null, 'never "No resolved comments" while they are on their way');
    await act(async () => { held.release(); });
    await settle(6);
    const newest = (count: number) => Array.from({ length: count }, (_, index) => `t${39 - index}`).sort();
    assert.deepEqual([...cards()].sort(), newest(15), 'the first page: the fifteen newest Done threads');
    assert.ok(more(), 'the end of the list waits for the reader');
    const box = scrollingList();
    // The reader scrolls down to the end of the list.
    await wheel(box);
    await watch.reach();
    assert.deepEqual([...cards()].sort(), newest(30), 'the next page comes when the end is in view');
    assert.deepEqual(bounded.asked.map(input => input.done), [0, 50, 100]);
    // The new cards push the end out of view, and the reader scrolls down to it again.
    await watch.reach(false);
    await wheel(box);
    await watch.reach();
    assert.deepEqual([...cards()].sort(), newest(39), 'down to the oldest');
    assert.equal(more(), null, 'and nothing is left to read');
    assert.equal(bounded.store.reads(), 0);
  } finally {
    watch.stop();
  }
});

test('a link to one comment opens its card, also a Done one far down the list and a reply of it', async (t) => {
  const rows = spaceRows(80, n => (n >= 79 ? 'open' : 'archived'));
  // The end of the list is watched, as in a browser: the pages after the first wait for the reader.
  const watch = watchListEnd();
  t.after(() => watch.stop());
  // t2 is the second oldest of 78 Done threads: far past the first page.
  for (const link of ['t2', 'r2']) {
    const bounded = boundedHost(rows, { page: 10, params: { comment: link } });
    revealedWith.length = 0;
    await mount(<Harness />, bounded.runtime);
    await settle(6);
    assert.deepEqual(bounded.asked[0].include, [link], 'the linked comment\'s thread is asked for with the first read');
    assert.equal(controller!.threadKey, 't2', 'its thread is selected');
    assert.equal(controller!.statusFilter, 'done', 'and the Filter shows Done, where it is');
    assert.ok(cards().includes('t2'), 'its card is drawn');
    assert.equal(doc.querySelector('[data-thread="t2"]')?.hasAttribute('data-selected'), true);
    assert.equal(bounded.store.reads(), 0);
    // It is revealed once, when the Done threads listed around it are there: the card is scrolled to where it stays,
    // never to a place the first page of Done threads then pushes it from.
    assert.equal(controller!.revealRequest, 1);
    assert.equal(cards().length, 11, 'the first page of Done threads and the linked one');
    assert.deepEqual(revealedWith, [11], 'revealed with its neighbours listed');
  }
});

test('every open thread has its card, and "Waiting for you" lists every one that waits, however many there are', async () => {
  const rows = spaceRows(96, n => (n % 9 === 0 ? 'deleted' : n <= 80 ? 'open' : 'archived'));
  const open = rows.filter(row => !row.thread_root_id && row.status === 'open').map(row => row.id);
  const bounded = boundedHost(rows);
  await mount(<Harness />, bounded.runtime);
  // What the list that follows the page reads (the cards drawn) and what the run through the waiting comments walks
  // (the controller's threads): every open thread, the oldest too.
  assert.equal(cards().length, open.length);
  assert.deepEqual([...cards()].sort(), [...open].sort());
  assert.equal(controller!.threads.filter(thread => thread.root.status === 'Open').length, open.length);
  await act(async () => { setWaitingCommentThreads(['t1', 't40', 't80']); });
  await pickFilter('waiting');
  assert.deepEqual(cards(), ['t80', 't40', 't1'], 'the three that wait, the oldest thread of the Space among them');
  assert.equal(controller!.waitingCount, 3);
  await act(async () => { setWaitingCommentThreads(null); });
});

test('the totals, a pin\'s number and the Copy changes number are the Space\'s, not those of the threads read', async () => {
  const rows = spaceRows(30);
  // t28 (open, on page A) sits on a point: nine first comments were written before it on that page, seven of them
  // Done, which the pane never reads.
  const pin = rows.find(row => row.id === 't28')!;
  Object.assign(pin, { mode: 'point', x: 0.4, y: 0.6 });
  const whole = wholeHost(rows);
  await mount(<Harness />, whole.runtime);
  const pinOf = () => controller!.numberOf(controller!.threads.find(thread => thread.root.recordKey === 't28')!);
  const number = pinOf();
  const counts = { ...controller!.counts };
  assert.equal(number, 10);
  assert.deepEqual(counts, { open: 7, done: 20, all: 27 });

  const bounded = boundedHost(rows, { changes: 23 });
  await mount(<Harness />, bounded.runtime);
  assert.equal(controller!.comments.some(comment => comment.status === 'Resolved'), false, 'no Done thread was read');
  assert.deepEqual({ ...controller!.counts }, counts, 'the same totals');
  assert.equal(pinOf(), number, 'the same pin number');
  assert.match(doc.querySelector(`[data-thread="t28"]`)!.textContent ?? '', /Point 10/);
  assert.equal(controller!.changeCount, 23, 'the number of changes is the Space\'s');
  // Copy changes reads the whole Space once, when it is pressed: the digest reports what it always did.
  let copied = '';
  Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text; } } });
  await act(async () => { await controller!.copyChanges(null); });
  await settle();
  assert.equal(bounded.store.reads(), 1, 'one read of the whole Space, for the digest');
  assert.match(copied, /Thread 1\b/, 'a Done thread the pane never listed is in the digest');
  assert.equal(controller!.changeCount, 0, 'nothing is left to copy');
});

test('a pane given some threads reads those alone', async () => {
  const rows = spaceRows(30);
  const bounded = boundedHost(rows);
  await mount(<Harness only={['t4', 't7']} focusKey={null} />, bounded.runtime);
  assert.deepEqual(bounded.asked.at(-1), { done: 0, only: ['t4', 't7'], include: [] });
  assert.deepEqual(cards(), ['t4'], 'the open one shows under Open');
  assert.deepEqual([...new Set(controller!.comments.map(comment => comment.thread || comment.recordKey))].sort(), ['t4', 't7']);
  await pickFilter('all');
  assert.deepEqual(cards(), ['t7', 't4']);
  assert.equal(more(), null, 'there is no page to read: the threads are named');
  assert.equal(bounded.store.reads(), 0);
});

test('a host whose server cannot read by thread answers the whole Space, as before', async () => {
  const rows = spaceRows(30);
  const bounded = boundedHost(rows, { answer: () => null });
  await mount(<Harness />, bounded.runtime);
  assert.equal(cards().length, 7, 'the open threads show');
  assert.equal(bounded.asked.length, 1, 'the bounded read is tried once');
  assert.ok(bounded.store.reads() >= 1, 'then the whole Space is listed');
  await pickFilter('done');
  assert.equal(cards().length, 20, 'Done shows every Done thread at once');
  assert.equal(bounded.asked.length, 1, 'and the bounded read is not tried again');
  assert.equal(more(), null);
});

test('a page of a Space still reads its own comments whole', async () => {
  const rows = spaceRows(30);
  const bounded = boundedHost(rows);
  await mount(<Harness scope={{ id: PAGE_A, recordKey: PAGE_A, name: 'A', checkpoint: null }} />, bounded.runtime);
  assert.equal(bounded.asked.length, 0, 'a page is not read by thread');
  assert.equal(bounded.store.reads(), 1);
  assert.equal(cards().length, rows.filter(row => !row.thread_root_id && row.page_key === PAGE_A && row.status === 'open').length);
});

test('with comments off for the person the host gives no comment store: no pane is drawn and nothing is read', async () => {
  const rows = spaceRows(30);
  const bounded = boundedHost(rows, { params: { comment: 't2' } });
  // The host leaves `spaceComments` out of the runtime (the comments flag is off for the person, a Site, a link).
  const { spaceComments: _off, ...runtime } = bounded.runtime as unknown as Record<string, unknown>;
  await mount(<Harness />, runtime as unknown as NotisRuntime);
  await settle(6);
  assert.equal(bounded.asked.length, 0, 'no thread is read');
  assert.equal(bounded.store.reads(), 0, 'and the Space is not listed');
  assert.equal(doc.querySelector('.nui-comment-pane'), null, 'no pane');
  assert.equal(controller!.loading, false, 'and nothing is loading');
  assert.equal(controller!.threads.length, 0);
  assert.equal(controller!.hasMore, false);
});

test('the end of the list staying in view never reads page after page by itself: each page waits for the reader\'s hand', async () => {
  const watch = watchListEnd();
  try {
    const rows = spaceRows(80, n => (n >= 79 ? 'open' : 'archived'));
    // A link to the oldest Done thread: its card sits at the end of the list, beside the list's end, and stays there.
    const bounded = boundedHost(rows, { page: 10, params: { comment: 't1' } });
    await mount(<Harness />, bounded.runtime);
    await settle(6);
    const box = scrollingList();
    const pages = () => bounded.asked.map(input => input.done).filter((done, index, all) => all.indexOf(done) === index);
    assert.deepEqual(pages(), [0, 50], 'the first page of Done threads, with the linked one');
    await watch.reach();
    await watch.reach();
    assert.deepEqual(pages(), [0, 50], 'the end is in view and stays there: nothing more is read');
    assert.equal(cards().length, 11);
    // The reader moves the list: one more page, not all of them.
    await wheel(box);
    assert.deepEqual(pages(), [0, 50, 100]);
    assert.equal(cards().length, 21);
    await settle(6);
    assert.deepEqual(pages(), [0, 50, 100], 'and it waits again');
    // Typing in a reply at the end of the list is not moving it.
    await act(async () => { box.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true })); });
    await settle(6);
    assert.deepEqual(pages(), [0, 50, 100]);
    await act(async () => { box.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, composed: true })); });
    await settle(6);
    assert.deepEqual(pages(), [0, 50, 100, 150]);
  } finally {
    watch.stop();
  }
});

test('a list too short to scroll reads the next page by itself, until it can scroll', async () => {
  const watch = watchListEnd();
  try {
    const rows = spaceRows(40, n => (n === 40 ? 'open' : 'archived'));
    const bounded = boundedHost(rows, { page: 15 });
    await mount(<Harness />, bounded.runtime);
    await pickFilter('done');
    assert.equal(cards().length, 15);
    // Nothing scrolls the list (its first page fits): the end in view reads the next page with no hand on it.
    await watch.reach();
    assert.ok(cards().length > 15);
    assert.equal(bounded.store.reads(), 0);
  } finally {
    watch.stop();
  }
});
