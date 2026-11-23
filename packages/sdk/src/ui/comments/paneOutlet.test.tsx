// A pane the host draws outlives the Space view that owns its comments: when a newer version of the view takes the
// place of the one on screen, the pane's elements stay and what it shows is handed over. The fixture behaves like a
// real publish: the two versions are two mounted views on the same comment store, the new one prepared out of sight
// (it lists no source) before it takes the place.
import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { NotisProvider } from '../../provider';
import type { NotisRuntime } from '../../runtime';
import type { SpaceCommentSource, SpaceCommentsTransport } from '../../space';
import { CommentPane, useComments, type CommentController } from '.';
import { clearCommentDrafts, flushCommentDrafts, forgetCommentDraft, keepCommentDraftsIn, readCommentDraft, writeCommentDraft } from './commentDrafts';
import { handOverCommentState, inheritedCommentState, useCommentHandover } from './handover';
import { CommentPaneOutlet, PANE_OUTLET_WAIT_MS, registerPaneOutlet } from './paneOutlet';
import { clearCommentRoutingCache } from './useCommentRouting';
import { memoryCommentStore, type MemoryCommentStore } from '../../../design-system/runtime/memoryComments';

const doc = dom.window.document;
Object.defineProperty(globalThis, 'HTMLTextAreaElement', { configurable: true, writable: true, value: dom.window.HTMLTextAreaElement });

const ROWS = [
  { id: 'c1', body: 'First thread', created_at: '2026-06-15T08:00:00Z' },
  { id: 'c2', body: 'Second thread', created_at: '2026-06-15T08:01:00Z' },
  { id: 'c3', body: 'Third thread, archived', status: 'archived' as const, created_at: '2026-06-15T08:02:00Z' },
];

async function settle(times = 4) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}

/** One mounted version of a Space view: its own React root, runtime, view token and comment controller. */
interface View {
  root: Root;
  token: object;
  controller(): CommentController;
  /** The host lists this view's comments (it is the one on screen) or stops listing them. */
  setShown(shown: boolean): void;
  unmount(): Promise<void>;
}

async function mountView(store: MemoryCommentStore, panel: HTMLElement, { shown, revision }: { shown: boolean; revision: number }): Promise<View> {
  const token = {};
  const sources = new Set<SpaceCommentSource>();
  let listed = shown;
  const transport: SpaceCommentsTransport = {
    ...store.transport,
    viewToken: token,
    attach(source) {
      sources.add(source);
      if (listed) source.show(panel);
      return () => { sources.delete(source); source.show(null); };
    },
  };
  const runtime = {
    resource: { kind: 'space', id: 's1', revision },
    // What a real publish answers: the next revision under the same access scope.
    space: { id: 's1', revision, cacheScope: 'scope-s1' },
    callAction: async (action: string) => { throw new Error(`No Space action may run for comments (${action}).`); },
    context: { params: {}, locale: 'en', viewerName: 'Flo' },
    spaceComments: transport,
  } as unknown as NotisRuntime;
  let controller: CommentController | null = null;
  function Version() {
    controller = useComments();
    return <CommentPane controller={controller} />;
  }
  const container = doc.createElement('div');
  container.setAttribute('data-view-revision', String(revision));
  doc.getElementById('app')!.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Version /></NotisProvider>); });
  await settle();
  return {
    root, token,
    controller: () => controller!,
    setShown(next) { listed = next; for (const source of sources) source.show(next ? panel : null); },
    async unmount() { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

/** The host: it draws the panes handed the panel element, in its own React root. */
async function mountHost(): Promise<{ panel: HTMLElement; root: Root; unregister(): void }> {
  clearCommentDrafts();
  clearCommentRoutingCache();
  doc.body.innerHTML = '<div id="app"></div><div id="host"></div><div id="panel"></div>';
  const panel = doc.getElementById('panel')!;
  const unregister = registerPaneOutlet(panel);
  const root = createRoot(doc.getElementById('host')!);
  await act(async () => { root.render(<CommentPaneOutlet target={panel} />); });
  return { panel, root, unregister };
}

const cards = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>('.nui-comment-card[data-thread]')];
const marked = (element: Element | null, mark: string) => (element as unknown as { mark?: string } | null)?.mark === mark;

test('a pane drawn by the host keeps its elements, selection, filter and scroll when a newer version of the view takes the place', async () => {
  const host = await mountHost();
  const store = memoryCommentStore({ rows: ROWS });
  const old = await mountView(store, host.panel, { shown: true, revision: 1 });

  // The host draws it: the view's own tree holds no pane.
  assert.equal(cards(host.panel).length, 2, 'the open threads are listed in the host panel');
  assert.equal(doc.querySelector('[data-view-revision="1"] .nui-comment-pane'), null);

  // The reader shows every thread, selects one, and scrolls the list.
  await act(async () => { old.controller().setStatusFilter('all'); });
  await act(async () => { old.controller().selectThread(old.controller().threads.find(thread => thread.root.recordKey === 'c2')!); });
  await settle();
  assert.equal(cards(host.panel).length, 3);
  const pane = host.panel.querySelector('.nui-comment-pane')!;
  const list = host.panel.querySelector<HTMLElement>('[data-comment-scroll]')!;
  const card = cards(host.panel).find(item => item.dataset.thread === 'c2')!;
  list.scrollTop = 137;
  for (const element of [pane, list, card]) (element as unknown as { mark: string }).mark = 'kept';

  // The next version is prepared out of sight: it reads the comments, lists nothing, draws nothing.
  const next = await mountView(store, host.panel, { shown: false, revision: 2 });
  assert.equal(next.controller().loading, false);
  assert.equal(next.controller().threadKey, null, 'its own state is at its defaults until the swap');
  assert.ok(marked(host.panel.querySelector('.nui-comment-pane'), 'kept'), 'the pane on screen is untouched meanwhile');

  // The swap, as the host does it: the state is handed over, the old view goes, the new one is listed.
  await act(async () => { handOverCommentState(old.token, next.token); });
  await old.unmount();
  assert.ok(marked(host.panel.querySelector('.nui-comment-pane'), 'kept'), 'with no view listed for an instant, the pane stays drawn');
  assert.equal(cards(host.panel).length, 3);
  await act(async () => { next.setShown(true); });
  await settle();

  assert.ok(marked(host.panel.querySelector('.nui-comment-pane'), 'kept'), 'the pane element is the same node');
  assert.ok(marked(host.panel.querySelector('[data-comment-scroll]'), 'kept'), 'so is its scrolling list');
  assert.ok(marked(cards(host.panel).find(item => item.dataset.thread === 'c2') ?? null, 'kept'), 'and the selected card');
  assert.equal(host.panel.querySelectorAll('.nui-comment-pane').length, 1);
  assert.equal(host.panel.querySelector('.nui-comment-loading'), null, 'no loading rows in between');
  assert.equal(host.panel.querySelector<HTMLElement>('[data-comment-scroll]')!.scrollTop, 137, 'the list did not scroll');
  assert.equal(next.controller().threadKey, 'c2', 'the selected thread is handed over');
  assert.equal(next.controller().statusFilter, 'all', 'and the filter');
  assert.equal(cards(host.panel).length, 3);
  assert.ok(cards(host.panel).find(item => item.dataset.thread === 'c2')!.hasAttribute('data-selected'));

  // The pane now acts on the new view's comments.
  await act(async () => { cards(host.panel).find(item => item.dataset.thread === 'c1')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await settle();
  assert.equal(next.controller().threadKey, 'c1');

  await next.unmount();
  await act(async () => { host.root.unmount(); });
  host.unregister();
});

test('another page\'s pane takes the panel at once: nothing of the page before stays drawn', async () => {
  const host = await mountHost();
  const store = memoryCommentStore({ rows: ROWS });
  const first = await mountView(store, host.panel, { shown: true, revision: 1 });
  (host.panel.querySelector('.nui-comment-pane') as unknown as { mark: string }).mark = 'first';
  await first.unmount();
  // No handover: this is another view (another page), not a newer version of the same one.
  const other = await mountView(memoryCommentStore({ rows: [{ id: 'o1', body: 'On the other page' }] }), host.panel, { shown: true, revision: 1 });
  assert.equal(marked(host.panel.querySelector('.nui-comment-pane'), 'first'), false, 'a new pane, made for the other page');
  assert.deepEqual(cards(host.panel).map(item => item.dataset.thread), ['o1']);
  await other.unmount();
  await act(async () => { host.root.unmount(); });
  host.unregister();
});

test('the pane of the version before stays drawn while the new version still reads its comments, then gives way', async () => {
  const host = await mountHost();
  const store = memoryCommentStore({ rows: ROWS });
  const old = await mountView(store, host.panel, { shown: true, revision: 1 });
  (host.panel.querySelector('.nui-comment-pane') as unknown as { mark: string }).mark = 'kept';
  // The new version's first read of the comments is held: it is listed while it still loads.
  const held = store.hold('list');
  const next = await mountView(store, host.panel, { shown: false, revision: 2 });
  assert.equal(next.controller().loading, true);
  await act(async () => { handOverCommentState(old.token, next.token); });
  await old.unmount();
  await act(async () => { next.setShown(true); });
  await settle();
  assert.ok(marked(host.panel.querySelector('.nui-comment-pane'), 'kept'));
  assert.equal(host.panel.querySelector('.nui-comment-loading'), null, 'the cards of the version before show, not loading rows');
  assert.equal(cards(host.panel).length, 2);
  await act(async () => { held.release(); });
  await settle();
  assert.equal(next.controller().loading, false);
  assert.ok(marked(host.panel.querySelector('.nui-comment-pane'), 'kept'), 'the same pane, now on the new version\'s comments');
  assert.equal(cards(host.panel).length, 2);
  assert.ok(PANE_OUTLET_WAIT_MS >= 1000, 'a read that never answers gives way after a bounded wait');
  await next.unmount();
  await act(async () => { host.root.unmount(); });
  host.unregister();
});

test('a host that draws no panes gets the portal as before', async () => {
  clearCommentDrafts();
  doc.body.innerHTML = '<div id="app"></div><div id="panel"></div>';
  const panel = doc.getElementById('panel')!;
  const view = await mountView(memoryCommentStore({ rows: ROWS }), panel, { shown: true, revision: 1 });
  assert.equal(cards(panel).length, 2, 'the pane portals into the element it was handed');
  await view.unmount();
  assert.equal(panel.querySelector('.nui-comment-pane'), null, 'and leaves with its view');
});

test('handover: hooks of the new view take the state of the hook with the same id, also when they mount a moment later', async () => {
  doc.body.innerHTML = '<div id="app"></div>';
  const from = {}, to = {};
  const seen: Record<string, number> = {};
  function Counter({ group, id, start, name }: { group: object; id: string; start: number; name: string }) {
    const [value, setValue] = useState(() => inheritedCommentState<number>(group, id) ?? start);
    useCommentHandover<number>(group, id, () => value, setValue);
    useEffect(() => { seen[name] = value; });
    return null;
  }
  const root = createRoot(doc.getElementById('app')!);
  const render = (node: ReactNode) => act(async () => { root.render(node); });
  await render(<><Counter key="old-a" group={from} id="a" start={7} name="old-a" /><Counter key="old-b" group={from} id="b" start={9} name="old-b" />
    <Counter key="new-a" group={to} id="a" start={0} name="new-a" /></>);
  assert.deepEqual({ ...seen }, { 'old-a': 7, 'old-b': 9, 'new-a': 0 });
  await act(async () => { handOverCommentState(from, to); });
  assert.equal(seen['new-a'], 7, 'a mounted hook is given the state');
  await render(<><Counter key="new-a" group={to} id="a" start={0} name="new-a" /><Counter key="new-b" group={to} id="b" start={0} name="new-b" />
    <Counter key="new-c" group={to} id="c" start={3} name="new-c" /></>);
  assert.equal(seen['new-b'], 9, 'a hook that mounts after the swap starts with it');
  assert.equal(seen['new-c'], 3, 'a hook the old view never had keeps its own start');
  assert.equal(inheritedCommentState({}, 'a'), undefined, 'another view inherits nothing');
  await act(async () => { root.unmount(); });
});

test('drafts kept by the host survive a page load: text and place, never files; another person starts empty', () => {
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); },
    removeItem: (key: string) => { kept.delete(key); } };
  keepCommentDraftsIn(null);
  clearCommentDrafts();
  keepCommentDraftsIn(storage);
  writeCommentDraft('s1|comments|\u0000new', { text: 'Link the status page too', place: { field: 'body', quote: 'status page' } });
  writeCommentDraft('s1|comments|\u0000to', { place: { newThread: 'claude' } });
  writeCommentDraft('s1|comments|\u0000reply:c1', { text: 'A reply', hostFiles: [new dom.window.File(['x'], 'shot.png') as unknown as File] });
  flushCommentDrafts();
  assert.equal(kept.size, 1, 'one entry in the host storage');
  assert.ok(!/shot\.png/.test([...kept.values()][0]), 'a file is never stored');

  // A reload of the browser: an empty page, the same person's storage.
  keepCommentDraftsIn(null);
  assert.equal(readCommentDraft('s1|comments|\u0000new'), undefined);
  keepCommentDraftsIn(storage);
  assert.deepEqual(readCommentDraft('s1|comments|\u0000new'), { text: 'Link the status page too', place: { field: 'body', quote: 'status page' } });
  assert.deepEqual(readCommentDraft('s1|comments|\u0000to'), { place: { newThread: 'claude' } }, 'who the new comment goes to');
  assert.deepEqual(readCommentDraft('s1|comments|\u0000reply:c1'), { text: 'A reply' }, 'the reply comes back without its file');

  // A sent comment forgets its draft in the storage too.
  writeCommentDraft('s1|comments|\u0000new', { text: '', place: undefined });
  writeCommentDraft('s1|comments|\u0000to', { place: undefined });
  writeCommentDraft('s1|comments|\u0000reply:c1', { text: '' });
  flushCommentDrafts();
  assert.equal(kept.size, 0);

  // Another person signs in on this device: their own storage, none of the drafts before.
  writeCommentDraft('s1|comments|\u0000new', { text: 'Mine' });
  const other = new Map<string, string>();
  keepCommentDraftsIn({ getItem: key => other.get(key) ?? null, setItem: (key, value) => { other.set(key, value); }, removeItem: key => { other.delete(key); } });
  assert.equal(readCommentDraft('s1|comments|\u0000new'), undefined);
  keepCommentDraftsIn(null);
  clearCommentDrafts();
});

test('two tabs of one person share the kept drafts: a tab writes only what it changed, the other tab\'s draft stays', () => {
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); },
    removeItem: (key: string) => { kept.delete(key); } };
  const rows = () => new Map<string, { text?: string }>(JSON.parse([...kept.values()][0] ?? '[]'));
  const otherTab = (change: (rows: Map<string, { text?: string }>) => void) => {
    const next = rows(); change(next);
    kept.set([...kept.keys()][0], JSON.stringify([...next]));
  };
  keepCommentDraftsIn(null);
  clearCommentDrafts();
  keepCommentDraftsIn(storage);
  writeCommentDraft('s1|comments|\u0000reply:a', { text: 'From this tab' });
  flushCommentDrafts();
  // The other tab writes a reply of its own to the same place.
  otherTab(next => next.set('s1|comments|\u0000reply:b', { text: 'From the other tab' }));
  writeCommentDraft('s1|comments|\u0000reply:a', { text: 'From this tab, longer' });
  flushCommentDrafts();
  assert.deepEqual([...rows()].map(([key, row]) => [key.split('\u0000')[1], row.text]).sort(),
    [['reply:a', 'From this tab, longer'], ['reply:b', 'From the other tab']], 'the draft of the other tab is still there');
  // The other tab sends its reply and changes this tab's draft key not at all; this tab goes away with nothing changed.
  otherTab(next => next.delete('s1|comments|\u0000reply:b'));
  flushCommentDrafts();
  assert.deepEqual([...rows().keys()].map(key => key.split('\u0000')[1]), ['reply:a'], 'a sent draft is not written back');
  // This tab sends its own: only its key goes.
  otherTab(next => next.set('s1|comments|\u0000reply:c', { text: 'Another, from the other tab' }));
  forgetCommentDraft('s1|comments|\u0000reply:a');
  flushCommentDrafts();
  assert.deepEqual([...rows().keys()].map(key => key.split('\u0000')[1]), ['reply:c']);
  keepCommentDraftsIn(null);
  clearCommentDrafts();
});
