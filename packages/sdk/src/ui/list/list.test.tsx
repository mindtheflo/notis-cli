import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { Pagination, Switch } from '../blocks/blocks';
import { Tabs, stepTab, type TabItem } from '../blocks/Tabs';
import { useShortcuts } from '../engine/hooks';
import { focusInside, keymapDef } from '../period/viewHelpers';
import { ActionError, w } from '../../words';
import { NotisProvider } from '../../provider';
import type { NotisRuntime } from '../../runtime';
import { ActionToast } from '../actions/ActionToast';
import { availableActions, resolveActions } from '../actions/useActions';
import { useToast, type ToastController } from '../actions/useToast';
import {
  LIST_DRAG_TYPE, LIST_READER_WORDS, ListReader, rankActions, successorOf, type ListReaderApi, type ListReaderProps, type OpenChangeReason, type OpenChangeVerdict,
  type ReaderCtx,
} from './ListReader';
import { Row, RowMore, STAR_WORDS, StarMark, StatusIcon, formatReaderAgo, formatRowAgo, formatRowTime, statusGroup } from './Row';
import { IDLE_ROW_STATE } from './rowState';
import { chooseFit } from './SelectionBar';
import { EMPTY_SELECTION, rangeBetween, selectionReducer } from './useSelection';

const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'http://localhost/space' });
class FakeResizeObserver {
  observe() {}
  disconnect() {}
}
const globals: Record<string, unknown> = {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot, Document: dom.window.Document, KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent, ResizeObserver: FakeResizeObserver, IS_REACT_ACT_ENVIRONMENT: true,
  Event: dom.window.Event, PopStateEvent: dom.window.PopStateEvent,
  requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
};
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const doc = dom.window.document;

function codeFor(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  return key;
}

async function press(key: string, extra: { shift?: boolean; meta?: boolean; repeat?: boolean; up?: boolean } = {}) {
  const init = {
    key, code: codeFor(key), shiftKey: !!extra.shift, metaKey: !!extra.meta, repeat: !!extra.repeat,
    bubbles: true, cancelable: true, composed: true,
  };
  const target = doc.activeElement ?? doc.body;
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', init));
    if (extra.up !== false) target.dispatchEvent(new dom.window.KeyboardEvent('keyup', init));
  });
}

async function click(element: Element, extra: { shift?: boolean; meta?: boolean } = {}) {
  const init = { bubbles: true, cancelable: true, button: 0, shiftKey: !!extra.shift, metaKey: !!extra.meta };
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('mousedown', init));
    element.dispatchEvent(new dom.window.MouseEvent('mouseup', init));
    element.dispatchEvent(new dom.window.MouseEvent('click', init));
  });
}

interface Ticket { id: string; title: string; done?: boolean }
const TICKETS: Ticket[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: `Ticket ${id.toUpperCase()}` }));

let root: Root | null = null;
let engine: KeyboardEngineCore;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="root"></div>';
  dom.window.localStorage.clear();
  // Outside a Space the open id lives in the page URL: start each test on a clean one.
  dom.window.history.replaceState(null, '', '/space');
  engine = new KeyboardEngineCore();
  root = createRoot(doc.getElementById('root')!);
  const render = async (next: ReactNode) => {
    await act(async () => {
      root!.render(<KeyboardEngine host="preview" locale="en" platform="mac" engine={engine} document={doc} strict>{next}</KeyboardEngine>);
    });
  };
  await render(node);
  return render;
}

function list(props: Partial<ListReaderProps<Ticket>> = {}) {
  return (
    <ListReader<Ticket>
      items={TICKETS}
      row={(ticket) => <Row title={ticket.title} />}
      reader={(ticket, ctx) => <article id="reader" data-mode={ctx.mode}>{ticket.title}</article>}
      {...props}
    />
  );
}

/** A reader that shows the item, then `extra` under it (controls that use the reader ctx). */
function readerWith(extra: (ticket: Ticket, ctx: ReaderCtx<Ticket>) => ReactNode): ListReaderProps<Ticket>['reader'] {
  return (ticket, ctx) => <><article id="reader" data-mode={ctx.mode}>{ticket.title}</article>{extra(ticket, ctx)}</>;
}

const q = (selector: string) => doc.querySelector<HTMLElement>(selector);
const cursorId = () => q('.nui-row[data-cursor]')?.getAttribute('data-nui-item') ?? null;
const selectedIds = () => [...doc.querySelectorAll('.nui-row[data-selected]')].map((row) => row.getAttribute('data-nui-item'));

// ---- pure ----

test('successorOf: the next remaining row, else the previous one, else none', () => {
  assert.equal(successorOf(['a', 'b', 'c'], ['a', 'c'], 'b'), 'c');
  assert.equal(successorOf(['a', 'b', 'c'], ['a'], 'b'), 'a');
  assert.equal(successorOf(['a', 'b', 'c'], ['a', 'b'], 'c'), 'b');
  assert.equal(successorOf(['a'], [], 'a'), null);
});

test('selection reducer: shift ranges grow and shrink from the anchor, select all, clear', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(rangeBetween(ids, 'd', 'b'), ['b', 'c', 'd']);
  let state = selectionReducer(EMPTY_SELECTION, { type: 'activate', id: 'b' });
  state = selectionReducer(state, { type: 'range', ids, cursor: 'b', id: 'd' });
  assert.deepEqual([...state.selected].sort(), ['b', 'c', 'd']);
  // Shift+J/K from the anchor: grows, then shrinks back.
  let step = selectionReducer(EMPTY_SELECTION, { type: 'navigate', id: 'b' });
  step = selectionReducer(step, { type: 'extendStep', ids, cursor: 'b', next: 'c' });
  step = selectionReducer(step, { type: 'extendStep', ids, cursor: 'c', next: 'd' });
  assert.deepEqual([...step.selected].sort(), ['b', 'c', 'd']);
  step = selectionReducer(step, { type: 'extendStep', ids, cursor: 'd', next: 'c' });
  assert.deepEqual([...step.selected].sort(), ['b', 'c']);
  // A range keeps what was selected outside it.
  let kept = selectionReducer(EMPTY_SELECTION, { type: 'toggle', id: 'e' });
  kept = selectionReducer(kept, { type: 'activate', id: 'a' });
  kept = selectionReducer(kept, { type: 'range', ids, cursor: 'a', id: 'b' });
  assert.deepEqual([...kept.selected].sort(), ['a', 'b', 'e']);
  const all = selectionReducer(kept, { type: 'selectAll', ids });
  assert.equal(all.selected.size, 5);
  assert.equal(selectionReducer(all, { type: 'clear' }).selected.size, 0);
  const pruned = selectionReducer(all, { type: 'prune', ids: ['a', 'b'] });
  assert.deepEqual([...pruned.selected].sort(), ['a', 'b']);
});

// ---- list keys ----

test('J/K: a fresh press wraps, a held key stops at the edge', async () => {
  await mount(list({ reader: undefined }));
  assert.equal(cursorId(), null);
  await press('j');
  assert.equal(cursorId(), 'a', 'J with no cursor lands on the first row');
  await press('k');
  assert.equal(cursorId(), 'd', 'a fresh K on the first row wraps to the last');
  await press('j');
  assert.equal(cursorId(), 'a', 'a fresh J on the last row wraps to the first');
  await press('j', { up: false });
  await press('j', { repeat: true, up: false });
  await press('j', { repeat: true, up: false });
  assert.equal(cursorId(), 'd');
  await press('j', { repeat: true, up: false });
  assert.equal(cursorId(), 'd', 'a held J stops on the last row');
  await press('j');
});

test('wrap={false}: J stops on the last row', async () => {
  await mount(list({ reader: undefined, wrap: false }));
  for (let i = 0; i < 6; i += 1) await press('j');
  assert.equal(cursorId(), 'd');
});

test('two lists on one page do not clash on J/K (one shortcut owner each)', async () => {
  await mount(
    <>
      <ListReader<Ticket> items={TICKETS} row={(t) => <Row title={t.title} />} listId="one" />
      <ListReader<Ticket> items={TICKETS} row={(t) => <Row title={t.title} />} listId="two" />
    </>,
  );
  assert.equal(doc.querySelectorAll('.nui-lr').length, 2);
});

// ---- row states ----

test('row states: cursor, open and selected land on the row element; a lone Row draws its own', async () => {
  await mount(list({ actions: ['complete'], handlers: { complete: () => {} } }));
  await press('j');
  await press('Enter');
  const first = q('[data-nui-item="a"]')!;
  assert.ok(first.hasAttribute('data-cursor'));
  assert.ok(first.hasAttribute('data-open'));
  assert.equal(first.getAttribute('aria-selected'), 'false');
  await press('x');
  assert.ok(first.hasAttribute('data-selected'));
  assert.equal(first.getAttribute('aria-selected'), 'true');
  assert.equal(q('[data-nui-item="a"] .nui-row-check')!.getAttribute('aria-checked'), 'true');
  assert.ok(q('.nui-lr')!.hasAttribute('data-has-selection'));

  if (root) await act(async () => { root!.unmount(); });
  root = null;
  doc.body.innerHTML = '<div id="lone"></div>';
  const lone = createRoot(doc.getElementById('lone')!);
  await act(async () => {
    lone.render(<Row title="Alone" state={{ ...IDLE_ROW_STATE, cursor: true, selected: true }} />);
  });
  const row = q('#lone .nui-row')!;
  assert.ok(row.hasAttribute('data-cursor'));
  assert.ok(row.hasAttribute('data-selected'));
  assert.ok(!row.hasAttribute('data-open'));
  await act(async () => { lone.unmount(); });
});

// ---- selection ----

test('selection keys: X toggles, Shift+J extends, Mod+A selects all, Esc clears', async () => {
  await mount(list({ actions: ['complete'], handlers: { complete: () => {} } }));
  await press('j');
  await press('x');
  assert.deepEqual(selectedIds(), ['a']);
  await press('j', { shift: true });
  await press('j', { shift: true });
  assert.deepEqual(selectedIds(), ['a', 'b', 'c']);
  await press('k', { shift: true });
  assert.deepEqual(selectedIds(), ['a', 'b']);
  await press('a', { meta: true });
  assert.deepEqual(selectedIds(), ['a', 'b', 'c', 'd']);
  assert.ok(q('.nui-selbar'), 'the bar shows while something is selected');
  assert.equal(q('.nui-sb-count')!.textContent, '4 selected');
  await press('Escape');
  assert.deepEqual(selectedIds(), []);
  assert.equal(q('.nui-selbar'), null);
});

test('clicks: Shift-click selects a range from the anchor, Mod-click toggles', async () => {
  await mount(list({ actions: ['complete'], handlers: { complete: () => {} } }));
  await click(q('[data-nui-item="b"]')!, { meta: true });
  assert.deepEqual(selectedIds(), ['b']);
  await click(q('[data-nui-item="d"]')!, { shift: true });
  assert.deepEqual(selectedIds(), ['b', 'c', 'd']);
  await click(q('[data-nui-item="c"]')!, { meta: true });
  assert.deepEqual(selectedIds(), ['b', 'd']);
});

test('not selectable without a bulk action: X does nothing and rows have no checkbox', async () => {
  await mount(list());
  await press('j');
  await press('x');
  assert.deepEqual(selectedIds(), []);
  assert.equal(q('.nui-row-check'), null);
});

// ---- selection bar actions ----

test('selection bar: E runs Complete on the selection, the toast counts, the cursor moves off removed rows', async () => {
  let items = [...TICKETS];
  const ran: string[][] = [];
  const props = () => list({
    items,
    actions: ['complete', 'archive'],
    handlers: {
      complete: (done: Ticket[]) => { ran.push(done.map((t) => t.id)); },
    },
  });
  const render = await mount(props());
  await press('j');
  await press('x');
  await press('j', { shift: true });
  assert.deepEqual(selectedIds(), ['a', 'b']);
  const buttons = [...doc.querySelectorAll('.nui-sb-btn')].map((b) => b.getAttribute('data-action'));
  assert.deepEqual(buttons, ['complete', 'clear'], 'archive has no handler, so it is hidden');
  await press('e');
  assert.deepEqual(ran, [['a', 'b']]);
  assert.equal(q('.nui-toast')!.textContent, '2 items completed.');
  assert.deepEqual(selectedIds(), [], 'an E action clears the selection');
  // The Space filters done items out: the cursor goes to the next remaining row.
  items = items.filter((t) => t.id !== 'a' && t.id !== 'b');
  await render(props());
  assert.equal(cursorId(), 'c');
});

test('selection bar: a click on an action runs it; with nothing selected E acts on the cursor row', async () => {
  const ran: string[][] = [];
  await mount(list({ actions: ['complete'], handlers: { complete: (done: Ticket[]) => { ran.push(done.map((t) => t.id)); } } }));
  await press('j');
  await press('j');
  await press('e');
  assert.deepEqual(ran, [['b']]);
  assert.equal(cursorId(), 'c', 'an E action on rows that stay moves on to the next row');
  await press('x');
  assert.deepEqual(selectedIds(), ['c'], `cursor ${cursorId()}`);
  await click(q('.nui-sb-btn[data-action="complete"]')!);
  assert.deepEqual(ran, [['b'], ['c']]);
  assert.equal(q('.nui-selbar'), null, 'an E action clears the selection, so the bar leaves');
  await press('x');
  await click(q('.nui-sb-btn[data-action="clear"]')!);
  assert.deepEqual(selectedIds(), []);
});

test('focus follows the cursor when an action moves on: E on rows that stay, a removed row, not out of the reader', async () => {
  let items = [...TICKETS];
  const focusedId = () => doc.activeElement?.getAttribute('data-nui-item') ?? null;
  const props = () => list({ items, actions: ['complete'], handlers: { complete: () => {} } });
  const render = await mount(props());
  await press('j');
  assert.equal(focusedId(), 'a');
  await press('e');
  assert.equal(cursorId(), 'b');
  assert.equal(focusedId(), 'b', 'the focus ring moves on with the cursor, not left on the done row');
  // The Space removes the cursor row (a delete): focus lands on the next row, not on the page body.
  items = items.filter((t) => t.id !== 'b');
  await render(props());
  assert.equal(cursorId(), 'c');
  assert.equal(focusedId(), 'c');
  // Focus inside the open reader stays there while E moves the reader on.
  await press('Enter');
  assert.equal(q('#reader')!.textContent, 'Ticket C');
  await act(async () => { q('.nui-lr-reader')!.focus(); });
  await press('e');
  assert.equal(q('#reader')!.textContent, 'Ticket D');
  assert.equal(cursorId(), 'd');
  assert.ok(doc.activeElement?.classList.contains('nui-lr-reader'), 'focus stays in the reader');
});

test('undo: an action that returns an UndoFn offers Undo, and Z undoes it', async () => {
  let undone = 0;
  await mount(list({ actions: ['complete'], handlers: { complete: () => () => { undone += 1; } } }));
  await press('j');
  await press('e');
  assert.ok(q('.nui-toast-btn'), 'Undo is offered');
  await press('z');
  assert.equal(undone, 1);
});

test('toast: a reason line says why items failed or adds a note; a thrown ActionError says why', async () => {
  let reply: unknown = undefined;
  let error: unknown = null;
  await mount(list({
    actions: ['star', { id: 'pin', label: 'Pin', key: 'p', toast: null, run: () => reply as void }],
    handlers: { star: () => { if (error) throw error; return reply as void; } },
    afterAction: 'keep',
  }));
  const words = () => q('.nui-toast-words')?.textContent ?? null;
  const reason = () => q('.nui-toast-reason')?.textContent ?? null;
  await press('j');
  // Every item failed: the failure words, and why.
  reply = { failed: [TICKETS[0]], reason: 'The ticket is locked.' };
  await press('s');
  assert.equal(words(), 'That did not work. Try again.');
  assert.equal(reason(), 'The ticket is locked.');
  assert.equal(q('.nui-toast')!.getAttribute('data-tone'), 'danger');
  // A note on a run that worked sits under its words.
  reply = { reason: w('Synced to the calendar.', 'Synchronis\u00e9 avec le calendrier.') };
  await press('s');
  assert.equal(words(), '1 item starred.');
  assert.equal(reason(), 'Synced to the calendar.');
  assert.equal(q('.nui-toast')!.getAttribute('data-tone'), null);
  // With the toast turned off, a reason shows alone.
  reply = { reason: 'Pinned for everyone.' };
  await press('p');
  assert.equal(words(), 'Pinned for everyone.');
  assert.equal(reason(), null);
  // A thrown ActionError says why; any other throw shows the failure words alone.
  error = new ActionError(w('Starred items are full.', 'Les favoris sont pleins.'));
  await press('s');
  assert.equal(words(), 'That did not work. Try again.');
  assert.equal(reason(), 'Starred items are full.');
  error = new Error('socket closed');
  await press('s');
  assert.equal(words(), 'That did not work. Try again.');
  assert.equal(reason(), null, 'a plain error keeps its message out of the toast');
});

test('toast: Undo stays on screen, busy, while it runs and Z does nothing then; a failed Undo says why; Dismiss hides it', async () => {
  let undoCalls = 0;
  let finish: () => void = () => {};
  let undoError: unknown = null;
  await mount(list({
    actions: ['complete'],
    handlers: {
      complete: () => () => {
        undoCalls += 1;
        if (undoError) return Promise.reject(undoError);
        return new Promise<void>((resolve) => { finish = resolve; });
      },
    },
  }));
  const button = () => q('.nui-toast-btn');
  const words = () => q('.nui-toast-words')?.textContent ?? null;
  await press('j');
  await press('e');
  assert.equal(words(), '1 item completed.');
  assert.ok(q('.nui-toast-x'), 'the list toast has a Dismiss button');
  assert.equal(q('.nui-toast-x')!.getAttribute('aria-label'), 'Dismiss');
  await click(button()!);
  assert.equal(undoCalls, 1);
  assert.equal(words(), '1 item completed.', 'the toast stays while the Undo runs');
  assert.equal(button()!.textContent, 'Undoing\u2026');
  assert.equal(button()!.getAttribute('aria-disabled'), 'true');
  assert.equal(button()!.getAttribute('aria-busy'), 'true');
  assert.equal(q('.nui-toast-x'), null, 'no Dismiss while the Undo runs');
  await press('z');
  await click(button()!);
  assert.equal(undoCalls, 1, 'neither Z nor a second click undoes twice');
  await act(async () => { finish(); });
  assert.equal(words(), 'Undone.');
  assert.equal(button(), null);
  // An Undo that fails says so, with an ActionError's reason.
  undoError = new ActionError(w('The ticket was deleted meanwhile.', 'Le ticket a \u00e9t\u00e9 supprim\u00e9 entre-temps.'));
  await press('e');
  await press('z');
  assert.equal(undoCalls, 2);
  assert.equal(words(), 'Could not undo that.');
  assert.equal(q('.nui-toast-reason')!.textContent, 'The ticket was deleted meanwhile.');
  assert.equal(q('.nui-toast')!.getAttribute('data-tone'), 'danger');
  await click(q('.nui-toast-x')!);
  assert.equal(q('.nui-toast'), null, 'Dismiss hides the toast');
});

test('useToast: a page toast with words, a reason, Undo and Dismiss, in French too', async () => {
  const page: { toaster?: ToastController } = {};
  let undone = 0;
  function Page() {
    const toaster = useToast();
    page.toaster = toaster;
    return <ActionToast toast={toaster.toast} onUndo={() => { void toaster.undo(); }} onDismiss={toaster.dismiss} />;
  }
  await mount(<Page />);
  assert.equal(q('.nui-toast'), null);
  await act(async () => {
    page.toaster!.notify(w('Saved.', 'Enregistr\u00e9.'), { reason: 'Shared with the team.', undo: () => { undone += 1; } });
  });
  assert.equal(q('.nui-toast-words')!.textContent, 'Saved.');
  assert.equal(q('.nui-toast-reason')!.textContent, 'Shared with the team.');
  await press('z');
  assert.equal(undone, 1);
  assert.equal(q('.nui-toast-words')!.textContent, 'Undone.');
  // A newer toast replaces the one on screen.
  await act(async () => { page.toaster!.notify('Could not reach the server.', { tone: 'danger' }); });
  assert.equal(q('.nui-toast-words')!.textContent, 'Could not reach the server.');
  assert.equal(q('.nui-toast')!.getAttribute('data-tone'), 'danger');
  assert.equal(q('.nui-toast-btn'), null, 'no Undo without an UndoFn');
  await click(q('.nui-toast-x')!);
  assert.equal(q('.nui-toast'), null);
  // In French: the words, Undoing and Dismiss.
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale="fr" platform="mac" engine={engine} document={doc} strict><Page /></KeyboardEngine>);
  });
  let finish: () => void = () => {};
  await act(async () => {
    page.toaster!.notify(w('Saved.', 'Enregistr\u00e9.'), { undo: () => new Promise<void>((resolve) => { finish = resolve; }) });
  });
  assert.equal(q('.nui-toast-words')!.textContent, 'Enregistr\u00e9.');
  assert.equal(q('.nui-toast-x')!.getAttribute('aria-label'), 'Fermer');
  await click(q('.nui-toast-btn')!);
  assert.equal(q('.nui-toast-btn')!.textContent, 'Annulation\u2026');
  await act(async () => { finish(); });
  assert.equal(q('.nui-toast-words')!.textContent, 'Annul\u00e9.');
});

// ---- reader ----

test('reader: Enter opens in side peek, J/K open the next item, Esc closes, then clears', async () => {
  const opened: Array<string | null> = [];
  await mount(list({ actions: ['complete'], handlers: { complete: () => {} }, onOpen: (t) => opened.push(t?.id ?? null) }));
  await press('j');
  await press('x');
  await press('Enter');
  assert.equal(q('#reader')!.textContent, 'Ticket A');
  assert.equal(q('#reader')!.getAttribute('data-mode'), 'side');
  await press('j');
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  await press('Escape');
  assert.equal(q('#reader'), null, 'Esc closes the reader first');
  assert.deepEqual(selectedIds(), ['a'], 'and keeps the selection');
  await press('Escape');
  assert.deepEqual(selectedIds(), []);
  assert.deepEqual(opened, ['a', 'b', null]);
});

test('reader: an open item that leaves the list hands over to the next one', async () => {
  let items = [...TICKETS];
  const render = await mount(list({ items }));
  await click(q('[data-nui-item="c"]')!);
  assert.equal(q('#reader')!.textContent, 'Ticket C');
  items = items.filter((t) => t.id !== 'c');
  await render(list({ items }));
  assert.equal(q('#reader')!.textContent, 'Ticket D');
  items = items.filter((t) => t.id !== 'd');
  await render(list({ items }));
  assert.equal(q('#reader')!.textContent, 'Ticket B', 'no next row: the previous one');
});

test('reader bar: Prev/Next wrap like J/K and Close closes', async () => {
  await mount(list());
  await click(q('[data-nui-item="a"]')!);
  const prev = () => q('.nui-lr-bar button[aria-label="Previous"]') as HTMLButtonElement;
  const next = () => q('.nui-lr-bar button[aria-label="Next"]') as HTMLButtonElement;
  assert.notEqual(prev().getAttribute('aria-disabled'), 'true', 'Prev on the first item wraps to the last');
  assert.notEqual(next().getAttribute('aria-disabled'), 'true');
  await click(prev());
  assert.equal(q('#reader')!.textContent, 'Ticket D');
  await click(next());
  assert.equal(q('#reader')!.textContent, 'Ticket A', 'Next on the last item wraps to the first');
  await click(next());
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  await click(q('.nui-lr-bar button[aria-label="Close"]')!);
  assert.equal(q('#reader'), null);
});

test('center peek: a modal dialog over an inert list, J/K still step, Esc closes', async () => {
  await mount(list({ openAs: ['center', 'side'] }));
  await press('j');
  await press('Enter');
  const dialog = q('.nui-lr-center [role="dialog"]')!;
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(q('.nui-lr-list')!.hasAttribute('inert'));
  assert.equal(doc.activeElement, dialog, 'focus moves into the dialog');
  await press('j');
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  await press('k');
  assert.equal(q('#reader')!.textContent, 'Ticket A');
  await press('Escape');
  assert.equal(q('#reader'), null);
  assert.ok(!q('.nui-lr-list')!.hasAttribute('inert'));
});

test('full page: the root says so and the reader has Back', async () => {
  await mount(list({ openAs: 'full' }));
  await press('j');
  await press('Enter');
  const rootEl = q('.nui-lr')!;
  assert.equal(rootEl.getAttribute('data-mode'), 'full');
  assert.ok(rootEl.hasAttribute('data-reader-open'));
  assert.equal(q('.nui-lr-back')!.textContent, 'Back');
  assert.equal(q('.nui-om-btn[aria-haspopup="menu"]'), null, 'one mode: no Open as menu');
  await click(q('.nui-lr-back')!);
  assert.equal(q('#reader'), null);
});

test('J/K step through items where the reader covers the list: full page and one pane', async () => {
  await mount(list({ openAs: 'full' }));
  await press('j');
  await press('Enter');
  assert.equal(q('#reader')!.textContent, 'Ticket A');
  await press('j');
  assert.equal(q('#reader')!.textContent, 'Ticket B', 'J opens the next item on the full page');
  await press('k');
  await press('k');
  assert.equal(q('#reader')!.textContent, 'Ticket D', 'a fresh K on the first item wraps to the last');
  await press('k', { repeat: true, up: false });
  assert.equal(q('#reader')!.textContent, 'Ticket C');
  // One pane (Panels below its minimum): the open item covers the list, which turns inert.
  const proto = dom.window.HTMLElement.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect');
  proto.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const width = this.classList.contains('nui-panels') ? 500 : 0;
    return { width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  try {
    await mount(list());
    await click(q('[data-nui-item="b"]')!);
    assert.equal(q('.nui-panels')!.getAttribute('data-mode'), 'stacked');
    assert.ok(q('.nui-panels-list')!.hasAttribute('inert'), 'the list is covered');
    assert.equal(q('#reader')!.textContent, 'Ticket B');
    await press('j');
    assert.equal(q('#reader')!.textContent, 'Ticket C', 'J opens the next item over the list');
    assert.equal(cursorId(), 'c');
    await press('k');
    assert.equal(q('#reader')!.textContent, 'Ticket B');
  } finally {
    if (own) Object.defineProperty(proto, 'getBoundingClientRect', own);
    else Reflect.deleteProperty(proto, 'getBoundingClientRect');
  }
});

test('toast: under the list while it shows, above the reader where the open item covers the list (full page, one pane)', async () => {
  const handlers = { complete: () => {} };
  const wrap = () => q('.nui-toast-wrap');
  // Beside the reader the toast stays under the list.
  await mount(list({ actions: ['complete'], handlers }));
  await press('j');
  await press('Enter');
  await press('e');
  assert.ok(wrap()!.parentElement === q('.nui-lr-list'), 'beside the reader the toast stays under the list');
  // Full page: the list is hidden, so the toast sits on the ListReader, after the reader.
  await mount(list({ openAs: 'full', actions: ['complete'], handlers }));
  await press('j');
  await press('Enter');
  await press('e');
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  assert.ok(wrap()!.parentElement === q('.nui-lr'), 'on the full page the toast leaves the hidden list');
  assert.ok(q('.nui-lr-body')!.compareDocumentPosition(wrap()!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await press('Escape');
  assert.ok(wrap()!.parentElement === q('.nui-lr-list'), 'back on the list it goes under the list again');
  // One pane: the open item covers the list, which turns inert; the toast stays reachable above it.
  const proto = dom.window.HTMLElement.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect');
  proto.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const width = this.classList.contains('nui-panels') ? 390 : 0;
    return { width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  try {
    await mount(list({ actions: ['complete'], handlers }));
    await click(q('[data-nui-item="a"]')!);
    assert.equal(q('.nui-panels')!.getAttribute('data-mode'), 'stacked');
    await press('e');
    assert.equal(q('#reader')!.textContent, 'Ticket B');
    assert.ok(wrap()!.parentElement === q('.nui-lr'), 'in one pane the toast sits above the reader');
    assert.ok(!wrap()!.closest('[inert], [aria-hidden="true"]'), 'not inside the covered list');
    assert.match(cssRule('.nui-toast-wrap') ?? '', /z-index: 8;/);
  } finally {
    if (own) Object.defineProperty(proto, 'getBoundingClientRect', own);
    else Reflect.deleteProperty(proto, 'getBoundingClientRect');
  }
});

test('reader bar: wrap={false} keeps Prev/Next at the edges', async () => {
  await mount(list({ wrap: false }));
  await click(q('[data-nui-item="a"]')!);
  const prev = q('.nui-lr-bar button[aria-label="Previous"]') as HTMLButtonElement;
  assert.equal(prev.getAttribute('aria-disabled'), 'true');
  assert.equal(prev.disabled, false, 'it stays focusable');
  prev.focus();
  await click(prev);
  assert.equal(q('#reader')!.textContent, 'Ticket A', 'a press at the edge does nothing');
  assert.equal(doc.activeElement, prev, 'and the focus stays on it');
});

test('center peek: J wraps from the last item to the first', async () => {
  await mount(list({ openAs: ['center', 'side'] }));
  await click(q('[data-nui-item="d"]')!);
  assert.equal(q('#reader')!.textContent, 'Ticket D');
  await press('j');
  assert.equal(q('#reader')!.textContent, 'Ticket A');
});

test('groups and empty state', async () => {
  await mount(list({ groupBy: (t) => (t.id < 'c' ? { id: 'one', label: 'First' } : { id: 'two', label: 'Second' }) }));
  assert.deepEqual([...doc.querySelectorAll('.nui-group-label')].map((h) => h.textContent), ['First', 'Second']);
  assert.deepEqual([...doc.querySelectorAll('.nui-group-count')].map((h) => h.textContent), ['2', '2'], 'counts');
  await mount(list({ groupCounts: false, groupBy: () => ({ id: 'one', label: 'First' }) }));
  assert.equal(q('.nui-group-count'), null);
  await mount(list({ items: [] }));
  assert.equal(q('.nui-empty-title')!.textContent, 'Nothing here yet');
});

test('selection bar step-down: full pill, then without keycaps, then icons only', () => {
  const widths = { '': 520, nokeys: 430, icons: 260 } as const;
  const measure = (fit: keyof typeof widths) => widths[fit];
  assert.equal(chooseFit(measure, 600), '');
  assert.equal(chooseFit(measure, 480), 'nokeys');
  assert.equal(chooseFit(measure, 300), 'icons');
  assert.equal(chooseFit(measure, 100), 'icons', 'icons only is the floor');
});

// ---- toolkit gaps (A4) ----

test('actions resolve live: a new label shows at once (locale change), string labels work', async () => {
  const render = await mount(list({ actions: [{ id: 'flag', label: 'Flag', run: () => {} }] }));
  await press('j');
  await press('x');
  assert.equal(q('.nui-sb-btn[data-action="flag"]')!.getAttribute('aria-label'), 'Flag');
  await render(list({ actions: [{ id: 'flag', label: { en: 'Signaler', fr: 'Signaler' }, run: () => {} }] }));
  assert.equal(q('.nui-sb-btn[data-action="flag"]')!.getAttribute('aria-label'), 'Signaler');
});

test('toast: toast undefined turns the default off; a run can cancel or report failed items', async () => {
  const runs: string[][] = [];
  let reply: unknown = undefined;
  await mount(list({
    actions: [{ id: 'complete', toast: undefined }, 'star'],
    handlers: {
      complete: (items: Ticket[]) => { runs.push(items.map((t) => t.id)); },
      star: (items: Ticket[]) => { runs.push(items.map((t) => t.id)); return reply as void; },
    },
  }));
  await press('j');
  await press('e');
  assert.deepEqual(runs, [['a']]);
  assert.equal(q('.nui-toast'), null, 'no toast after toast: undefined');
  // A cancelled run: no toast, the selection stays.
  await press('x');
  await press('j', { shift: true });
  reply = { cancelled: true };
  await press('s');
  assert.equal(q('.nui-toast'), null);
  assert.deepEqual(selectedIds(), ['b', 'c']);
  // Failed items stay selected, the rest leave the selection, the toast says how many.
  reply = { failed: [TICKETS[2]] };
  await press('s');
  assert.deepEqual(selectedIds(), ['c']);
  assert.equal(q('.nui-toast')!.textContent, '1 item could not be changed. It stays selected.');
  assert.equal(q('.nui-toast')!.getAttribute('data-tone'), 'danger');
});

test('afterAction: a bulk action clears the selection by default, keep leaves it', async () => {
  await mount(list({ actions: ['star'], handlers: { star: () => {} } }));
  await press('j');
  await press('x');
  await press('s');
  assert.deepEqual(selectedIds(), []);
  await mount(list({ actions: ['star'], handlers: { star: () => {} }, afterAction: 'keep' }));
  await press('j');
  await press('x');
  await press('s');
  assert.deepEqual(selectedIds(), ['a']);
});

test('icons: an action icon may be an element, drawn in the bar', async () => {
  await mount(list({ actions: [{ id: 'flag', label: 'Flag', icon: <svg data-flag-icon="" />, run: () => {} }] }));
  await press('j');
  await press('x');
  assert.ok(q('.nui-sb-btn[data-action="flag"] [data-flag-icon]'));
});

test('controlled selection: the owner holds the ids and can refuse a change', async () => {
  const changes: string[][] = [];
  let selected: string[] = ['b'];
  const props = () => list({ actions: ['star'], handlers: { star: () => {} }, selected,
    onSelectedChange: (ids) => { changes.push(ids); } });
  const render = await mount(props());
  assert.deepEqual(selectedIds(), ['b']);
  await press('j');
  await press('x');
  assert.deepEqual(changes.at(-1), ['a', 'b'], 'changes come in list order');
  assert.deepEqual(selectedIds(), ['b'], 'refused: the prop still says b');
  selected = ['a', 'b'];
  await render(props());
  assert.deepEqual(selectedIds(), ['a', 'b']);
});

test('drag: rows are draggable; a selected row carries the whole selection in list order', async () => {
  const dragged: string[][] = [];
  await mount(list({ actions: ['star'], handlers: { star: () => {} }, draggable: (t) => t.id !== 'd',
    onDragStart: (items) => { dragged.push(items.map((t) => t.id)); } }));
  assert.equal(q('[data-nui-item="a"]')!.getAttribute('draggable'), 'true');
  assert.equal(q('[data-nui-item="d"]')!.getAttribute('draggable'), null);
  const data = new Map<string, string>();
  const drag = async (id: string) => {
    const event = new dom.window.Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' } });
    await act(async () => { q(`[data-nui-item="${id}"]`)!.dispatchEvent(event); });
  };
  await drag('b');
  assert.deepEqual(dragged.at(-1), ['b']);
  await press('j');
  await press('j');
  await press('j');
  await press('x');
  await press('k');
  await press('k');
  await press('x');
  await drag('c');
  assert.deepEqual(dragged.at(-1), ['a', 'c']);
  assert.equal(data.get(LIST_DRAG_TYPE), JSON.stringify(['a', 'c']));
});

test('reader bar: its label per item; the reader body starts at the top for each item', async () => {
  await mount(list({ readerLabel: (t) => `#${t.id}` }));
  await click(q('[data-nui-item="a"]')!);
  assert.equal(q('[data-part="label"]')!.textContent, '#a');
  const body = q('.nui-lr-reader-body')!;
  let top = 120;
  Object.defineProperty(body, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
  await press('j');
  assert.equal(q('[data-part="label"]')!.textContent, '#b');
  assert.equal(top, 0);
});

test('reader ctx: ctx.run runs a list action on the open item with the list toast, Undo and the E move-on', async () => {
  const ran: string[][] = [];
  let undone = 0;
  const outcomes: string[] = [];
  await mount(list({
    actions: ['complete'],
    handlers: { complete: (done: Ticket[]) => { ran.push(done.map((t) => t.id)); return () => { undone += 1; }; } },
    reader: readerWith((_ticket, ctx) => (
      <>
        <button type="button" id="done" onClick={() => { void ctx.run('complete').then((o) => { outcomes.push(o.status); }); }}>
          {ctx.actions.map((action) => action.id).join(',')}
        </button>
        <button type="button" id="other" onClick={() => { void ctx.run('archive').then((o) => { outcomes.push(o.status); }); }}>
          Archive
        </button>
      </>
    )),
  }));
  await click(q('[data-nui-item="b"]')!);
  assert.equal(q('#done')!.textContent, 'complete', 'ctx.actions lists the actions that apply to the open item');
  await click(q('#done')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(ran, [['b']]);
  assert.deepEqual(outcomes, ['done']);
  assert.equal(q('.nui-toast-words')!.textContent, '1 item completed.');
  assert.ok(q('.nui-toast-btn'), 'Undo is offered');
  assert.equal(q('#reader')!.textContent, 'Ticket C', 'an E action moves the reader on, as its key does');
  assert.equal(cursorId(), 'c');
  await press('z');
  assert.equal(undone, 1);
  // An id the list does not have (archive has no handler) runs nothing.
  await click(q('#other')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(outcomes, ['done', 'cancelled']);
  assert.deepEqual(ran, [['b']]);
});

test('reader ctx: ctx.busy shows a running action and a second run while it runs says busy', async () => {
  let finish: () => void = () => {};
  let calls = 0;
  const outcomes: string[] = [];
  await mount(list({
    actions: ['star'],
    handlers: { star: () => { calls += 1; return new Promise<void>((r) => { finish = r; }); } },
    reader: readerWith((_ticket, ctx) => (
      <button type="button" id="star" aria-busy={ctx.busy.has('star') || undefined}
        onClick={() => { void ctx.run('star').then((o) => { outcomes.push(o.status); }); }}>Star</button>
    )),
  }));
  await click(q('[data-nui-item="a"]')!);
  await click(q('#star')!);
  assert.equal(q('#star')!.getAttribute('aria-busy'), 'true');
  await click(q('#star')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.equal(calls, 1);
  assert.deepEqual(outcomes, ['busy']);
  await act(async () => { finish(); await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(outcomes, ['busy', 'done']);
  assert.equal(q('#star')!.getAttribute('aria-busy'), null);
  assert.equal(q('.nui-toast-words')!.textContent, '1 item starred.');
});

test('reader bar: ctx.run on an action with options opens its picker at the bar button; a choice runs it, Escape cancels', async () => {
  const moved: Array<[string[], string]> = [];
  const outcomes: string[] = [];
  await mount(list({
    actions: [{ id: 'move', options: [{ value: 'inbox', label: 'Inbox' }, { value: 'later', label: 'Later' }],
      value: () => 'inbox' }],
    handlers: { move: (items: Ticket[], choice) => { moved.push([items.map((t) => t.id), choice!.value]); } },
    readerActions: (_ticket, ctx) => [
      { id: 'move', label: 'Move', icon: 'tray-arrow-up',
        run: () => ctx.run('move').then((o) => { outcomes.push(o.status); }) },
      { id: 'later', label: 'Later', icon: 'clock',
        run: () => ctx.run('move', { value: 'later', label: 'Later' }).then((o) => { outcomes.push(o.status); }) },
    ],
  }));
  const moveBtn = () => q('[data-part="actions"] [data-action="move"]')!;
  await click(q('[data-nui-item="b"]')!);
  await act(async () => { moveBtn().focus(); });
  await click(moveBtn());
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const menu = q('[role="menu"]')!;
  assert.equal(menu.getAttribute('aria-label'), 'Move to…');
  const items = [...menu.querySelectorAll('[data-nui-menu-item]')];
  assert.deepEqual(items.map((i) => i.textContent), ['Inbox', 'Later']);
  assert.equal(items[0]!.getAttribute('aria-checked'), 'true');
  assert.deepEqual(outcomes, [], 'the run waits for a choice');
  await click(items[1]!);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(moved, [[['b'], 'later']]);
  assert.deepEqual(outcomes, ['done']);
  assert.equal(q('[role="menu"]'), null);
  assert.equal(doc.activeElement, moveBtn(), 'focus goes back to the bar button');
  // Escape closes the picker unchosen: the run settles cancelled and the reader stays open.
  await click(moveBtn());
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  assert.ok(q('[role="menu"]'));
  await press('Escape');
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.equal(q('[role="menu"]'), null);
  assert.deepEqual(outcomes, ['done', 'cancelled']);
  assert.equal(q('#reader')!.textContent, 'Ticket B', 'Escape closed the picker, not the reader');
  assert.deepEqual(moved, [[['b'], 'later']]);
  // With an option the run happens at once, no picker.
  await click(q('[data-part="actions"] [data-action="later"]')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.equal(q('[role="menu"]'), null);
  assert.deepEqual(moved, [[['b'], 'later'], [['b'], 'later']]);
  assert.deepEqual(outcomes, ['done', 'cancelled', 'done']);
});

test('reader bar: More holds the open item actions (the half of a pair that fits) and runs one; ctx.actionsMenu is the same menu', async () => {
  interface Job { id: string; title: string; paused: boolean }
  const jobs: Job[] = [{ id: 'a', title: 'A', paused: false }, { id: 'b', title: 'B', paused: true }];
  const resumed: string[][] = [];
  const deleted: string[][] = [];
  const render = await mount(
    <ListReader<Job> items={jobs} row={(job) => <Row title={job.title} />}
      reader={(job) => <article id="reader">{job.title}</article>}
      actions={[{ id: 'pause', appliesTo: (j) => !j.paused }, { id: 'resume', appliesTo: (j) => j.paused }, 'delete']}
      handlers={{ pause: () => {}, resume: (items: Job[]) => { resumed.push(items.map((j) => j.id)); },
        delete: (items: Job[]) => { deleted.push(items.map((j) => j.id)); } }} />,
  );
  await click(q('[data-nui-item="b"]')!);
  const trigger = q('.nui-lr-bar [data-part="more"]')!;
  assert.equal(trigger.getAttribute('aria-label'), 'More');
  await click(trigger);
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const labels = () => [...doc.querySelectorAll('[role="menu"] [data-nui-menu-item] .nui-menu-label')].map((i) => i.textContent);
  assert.deepEqual(labels(), ['Resume', 'Delete']);
  assert.equal(q('[role="menu"]')!.getAttribute('aria-label'), 'Actions');
  await click([...doc.querySelectorAll('[role="menu"] [data-nui-menu-item]')][1]!);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(deleted, [['b']]);
  assert.equal(q('.nui-toast-words')!.textContent, '1 item deleted.');
  assert.equal(q('[role="menu"]'), null);
  // No action applies: no menu.
  await render(
    <ListReader<Job> items={jobs} row={(job) => <Row title={job.title} />}
      reader={(job, ctx) => <article id="reader">{job.title}{ctx.actionsMenu ?? <span id="no-actions" />}</article>}
      actions={[{ id: 'pause', appliesTo: (j) => !j.paused }]} handlers={{ pause: () => {} }} />,
  );
  assert.ok(q('#no-actions'));
  assert.equal(q('.nui-lr-bar [data-part="more"]'), null);
  assert.deepEqual(resumed, []);
});

test('reader bar: in the center dialog an action key acts on the open item through the bar More menu; row menus leave their keys to the list', async () => {
  const starred: string[][] = [];
  await mount(list({
    openAs: ['center', 'side'],
    actions: ['star'],
    handlers: { star: (items: Ticket[]) => { starred.push(items.map((ticket) => ticket.id)); } },
  }));
  const accelerators = () => engine.registry.all().filter((entry) => entry.def.id.startsWith('notis.menu-key:'));
  assert.ok(q('.nui-row-more'), 'rows draw their More menu');
  assert.equal(accelerators().length, 0, 'row menus register no keys');
  await press('j');
  await press('Enter');
  assert.ok(q('.nui-lr-center [role="dialog"]'), 'the center dialog is open');
  assert.equal(accelerators().length, 2, 'the reader menu: S at route and at modal scope');
  await press('j');
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  await press('s');
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(starred, [['b']], 'S starred the open item, the list keys rest under the dialog');
  assert.ok(q('.nui-lr-center [role="dialog"]'), 'the dialog stays open');
});

test('loading: skeleton rows first, Load more at the end, J on the last row loads more', async () => {
  await mount(list({ items: [], loading: true }));
  assert.equal(doc.querySelectorAll('.nui-row-skel').length, 6);
  assert.equal(q('.nui-lr-scroll')!.getAttribute('aria-busy'), 'true');
  let loads = 0;
  const render = await mount(list({ reader: undefined, hasMore: true, onLoadMore: () => { loads += 1; } }));
  await click(q('.nui-lr-more button')!);
  assert.equal(loads, 1);
  assert.equal(q('.nui-lr-more button')!.textContent, 'Load more');
  for (let i = 0; i < 4; i += 1) await press('j');
  assert.equal(cursorId(), 'd');
  await press('j');
  assert.equal(loads, 2, 'J on the last row loads more instead of wrapping');
  assert.equal(cursorId(), 'd');
  await render(list({ reader: undefined, hasMore: true, loadingMore: true, onLoadMore: () => { loads += 1; } }));
  assert.equal(q('.nui-lr-more button')!.textContent, 'Loading…');
  assert.ok((q('.nui-lr-more button') as HTMLButtonElement).disabled);
});

test('pending and disabled rows: shown, never selected or acted on; disabled ones do not open', async () => {
  const ran: string[][] = [];
  await mount(list({ actions: ['star'], handlers: { star: (items: Ticket[]) => { ran.push(items.map((t) => t.id)); } },
    isPending: (t) => t.id === 'b', isDisabled: (t) => t.id === 'c' }));
  assert.ok(q('[data-nui-item="b"]')!.hasAttribute('data-pending'));
  assert.equal(q('[data-nui-item="c"]')!.getAttribute('aria-disabled'), 'true');
  await press('j');
  await press('j');
  await press('x');
  assert.deepEqual(selectedIds(), [], 'a pending row is not selected');
  await press('a', { meta: true });
  assert.deepEqual(selectedIds(), ['a', 'd'], 'select all skips pending and disabled rows');
  await press('s');
  assert.deepEqual(ran, [['a', 'd']]);
  await click(q('[data-nui-item="c"]')!);
  assert.equal(q('#reader'), null, 'a disabled row does not open');
  await click(q('[data-nui-item="b"]')!);
  assert.equal(q('#reader')!.textContent, 'Ticket B', 'a pending row still opens');
});

test('with nothing selected, a key skips a pending cursor or open row and still acts on a free one', async () => {
  const ran: string[][] = [];
  await mount(list({ actions: ['star'], handlers: { star: (items: Ticket[]) => { ran.push(items.map((t) => t.id)); } },
    isPending: (t) => t.id === 'b' }));
  await press('j');
  await press('j');
  await press('s');
  assert.deepEqual(ran, [], 'the pending cursor row is not acted on');
  await click(q('[data-nui-item="b"]')!);
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  await press('s');
  assert.deepEqual(ran, [], 'the pending open row is not acted on');
  await click(q('[data-nui-item="a"]')!);
  await press('s');
  assert.deepEqual(ran, [['a']], 'a free row still is');
});

test('pending while a run lasts: its items leave the selection, the failed ones come back when it ends', async () => {
  // The page marks the items it works on as pending while the run lasts, as the Portal pages do.
  let release: () => void = () => {};
  let clearMarks: () => void = () => {};
  function Page({ afterAction, clearFirst = true }: { afterAction?: 'clear' | 'keep'; clearFirst?: boolean }) {
    const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
    clearMarks = () => setPending(new Set());
    return list({
      actions: ['star'], afterAction,
      isPending: (ticket) => pending.has(ticket.id),
      handlers: {
        star: async (items: Ticket[]) => {
          setPending(new Set(items.map((ticket) => ticket.id)));
          await new Promise<void>((resolve) => { release = resolve; });
          if (clearFirst) setPending(new Set());
          return { failed: items.filter((ticket) => ticket.id === 'b') };
        },
      },
    });
  }
  const selectAB = async () => { await press('j'); await press('x'); await press('j', { shift: true }); };
  await mount(<Page />);
  await selectAB();
  await press('s');
  assert.ok(q('[data-nui-item="a"]')!.hasAttribute('data-pending'));
  assert.deepEqual(selectedIds(), [], 'pending rows are out of the selection while the run lasts');
  await act(async () => { release(); });
  assert.deepEqual(selectedIds(), ['b']);
  assert.equal(q('.nui-toast')!.textContent, '1 item could not be changed. It stays selected.');
  // The page clears its marks only after the run ended: b is back at once and stays.
  await mount(<Page clearFirst={false} />);
  await selectAB();
  await press('s');
  await act(async () => { release(); });
  assert.deepEqual(selectedIds(), ['b']);
  await act(async () => { clearMarks(); });
  assert.deepEqual(selectedIds(), ['b']);
  // afterAction 'keep': the whole selection comes back.
  await mount(<Page afterAction="keep" />);
  await selectAB();
  await press('s');
  await act(async () => { release(); });
  assert.deepEqual(selectedIds(), ['a', 'b']);
});

test('toggle pairs: a mixed selection shows one half (pause or resume), run on the items it fits', async () => {
  interface Job { id: string; title: string; paused: boolean }
  const jobs: Job[] = [{ id: 'a', title: 'A', paused: false }, { id: 'b', title: 'B', paused: true }];
  const paused: string[][] = [];
  await mount(
    <ListReader<Job> items={jobs} row={(job) => <Row title={job.title} />}
      actions={[{ id: 'pause', appliesTo: (j) => !j.paused }, { id: 'resume', appliesTo: (j) => j.paused },
        { id: 'enable' }, { id: 'disable' }]}
      handlers={{ pause: (items: Job[]) => { paused.push(items.map((j) => j.id)); }, resume: () => {}, enable: () => {},
        disable: () => {} }} />,
  );
  await press('j');
  await press('x');
  await press('j', { shift: true });
  const buttons = [...doc.querySelectorAll('.nui-sb-btn')].map((b) => b.getAttribute('data-action'));
  assert.deepEqual(buttons, ['pause', 'enable', 'clear'], 'one button per pair');
  await click(q('.nui-sb-btn[data-action="pause"]')!);
  assert.deepEqual(paused, [['a']]);
  // Pure: all paused shows resume.
  const actions = resolveActions<Job>([{ id: 'pause', appliesTo: (j) => !j.paused, run: () => {} },
    { id: 'resume', appliesTo: (j) => j.paused, run: () => {} }]);
  assert.deepEqual(availableActions(actions, [jobs[1]!]).map((a) => a.id), ['resume']);
});

test('busy: a running action shows busy in the bar and ignores a second press', async () => {
  let finish: () => void = () => {};
  let calls = 0;
  await mount(list({ actions: ['star'], handlers: { star: () => { calls += 1; return new Promise<void>((r) => { finish = r; }); } },
    afterAction: 'keep' }));
  await press('j');
  await press('x');
  await press('s');
  const button = q('.nui-sb-btn[data-action="star"]') as HTMLButtonElement;
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.ok(button.disabled);
  await press('s');
  assert.equal(calls, 1);
  await act(async () => { finish(); });
  assert.equal((q('.nui-sb-btn[data-action="star"]') as HTMLButtonElement).disabled, false);
});

test('pickers: an action with options opens a menu at its bar button and passes the choice', async () => {
  const moved: Array<[string[], string]> = [];
  await mount(list({
    actions: [{ id: 'move', options: [{ value: 'inbox', label: 'Inbox' }, { value: 'later', label: 'Later' }],
      value: () => 'inbox' }],
    handlers: { move: (items: Ticket[], choice) => { moved.push([items.map((t) => t.id), choice!.value]); } },
  }));
  await press('j');
  await press('x');
  await press('m');
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const items = [...doc.querySelectorAll('[role="menu"] [data-nui-menu-item]')];
  assert.deepEqual(items.map((i) => i.textContent), ['Inbox', 'Later']);
  assert.equal(items[0]!.getAttribute('aria-checked'), 'true');
  await click(items[1]!);
  assert.deepEqual(moved, [[['a'], 'later']]);
  assert.equal(q('[role="menu"]'), null);
});

test('groups fold: a collapsible heading hides its rows from view and from J/K', async () => {
  await mount(list({ reader: undefined, collapsible: true,
    groupBy: (t) => (t.id < 'c' ? { id: 'one', label: 'First' } : { id: 'two', label: 'Second' }) }));
  const toggle = q('.nui-group-toggle')!;
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  await click(toggle);
  assert.equal(q('[data-nui-item="a"]'), null);
  await press('j');
  assert.equal(cursorId(), 'c');
});

test('open item in the page URL outside a Space: open pushes ?open=, popstate restores', async () => {
  await mount(list());
  await click(q('[data-nui-item="b"]')!);
  assert.equal(new URL(dom.window.location.href).searchParams.get('open'), 'b');
  await act(async () => {
    dom.window.history.replaceState(null, '', '/space?open=c');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.equal(q('#reader')!.textContent, 'Ticket C');
  await press('Escape');
  assert.equal(new URL(dom.window.location.href).searchParams.get('open'), null);
  dom.window.history.replaceState(null, '', '/space?open=d');
  await mount(list());
  // mount() resets the URL; set it after the reset to check a fresh mount reads it.
  dom.window.history.replaceState(null, '', '/space?open=d');
  await act(async () => { dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
  assert.equal(q('#reader')!.textContent, 'Ticket D');
  await mount(list({ openInUrl: false }));
  await click(q('[data-nui-item="a"]')!);
  assert.equal(new URL(dom.window.location.href).searchParams.get('open'), null, 'openInUrl={false}: local only');
});

test('open item in a Space URL: a write the host refuses puts the list back on the URL\'s item and says so (G-URL)', async () => {
  let params: Record<string, string> = {};
  let refuseNext = false;
  const calls: Array<Record<string, string>> = [];
  const runtime = runtimeWith({
    navigate: async (target: { [key: string]: unknown }) => {
      const next = target.params as Record<string, string>;
      calls.push(next);
      if (refuseNext) throw new Error('refused');
      params = next;
    },
  } as Partial<NotisRuntime>);
  const render = () => <NotisProvider runtime={{ ...runtime, context: { params, locale: 'en' } } as NotisRuntime}>
    {list()}</NotisProvider>;
  await mount(render());
  await click(q('[data-nui-item="b"]')!);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(params, { open: 'b' });
  await mount(render());
  assert.equal(q('#reader')!.textContent, 'Ticket B', 'the confirmed URL opens B');
  refuseNext = true;
  await click(q('[data-nui-item="c"]')!);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(calls.at(-1), { open: 'c' }, 'the list asked the host for C');
  assert.equal(q('#reader')!.textContent, 'Ticket B', 'refused: the reader goes back to the URL\'s item');
  assert.equal(q('.nui-toast-words')?.textContent, LIST_READER_WORDS.notMoved.en);
  refuseNext = false;
  await click(q('[data-nui-item="c"]')!);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(params, { open: 'c' }, 'a second try goes through');
});

test('onOpenChange returning false keeps the open item: click, J, Escape and Back leave reader, cursor and URL', async () => {
  let dirty = false;
  const asked: Array<string | null> = [];
  const opened: Array<string | null> = [];
  const url = () => new URL(dom.window.location.href).searchParams.get('open');
  await mount(list({
    onOpenChange: (id) => { asked.push(id); return !dirty; },
    onOpen: (ticket) => { opened.push(ticket?.id ?? null); },
  }));
  await click(q('[data-nui-item="b"]')!);
  assert.equal(url(), 'b');
  dirty = true;
  await click(q('[data-nui-item="c"]')!);
  assert.equal(asked.at(-1), 'c');
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  assert.equal(cursorId(), 'b', 'the cursor goes back to the kept item');
  assert.equal(url(), 'b');
  await press('j');
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  assert.equal(cursorId(), 'b');
  await press('Escape');
  assert.equal(asked.at(-1), null);
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  // Back: the URL already moved, so the list puts it back on the kept item.
  await act(async () => {
    dom.window.history.replaceState(null, '', '/space');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  assert.equal(url(), 'b');
  assert.deepEqual(opened, ['b'], 'onOpen runs only for opens that happened');
  dirty = false;
  await click(q('[data-nui-item="c"]')!);
  assert.equal(q('#reader')!.textContent, 'Ticket C');
  assert.equal(url(), 'c');
  await act(async () => {
    dom.window.history.replaceState(null, '', '/space');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.equal(asked.at(-1), null, 'Back reaches onOpenChange');
  assert.equal(q('#reader'), null);
});

test('onOpenChange says why: autoOpen is auto, a click or a key is user, Back is url', async () => {
  const asked: Array<[string | null, OpenChangeReason]> = [];
  await withPanelsWidth(1000, async () => { await mount(list({ autoOpen: true, onOpenChange: (id, reason) => { asked.push([id, reason]); } })); });
  assert.deepEqual(asked, [['a', 'auto']]);
  await click(q('[data-nui-item="b"]')!);
  await press('j');
  assert.deepEqual(asked.slice(1), [['b', 'user'], ['c', 'user']]);
  await act(async () => {
    dom.window.history.replaceState(null, '', '/space?open=a');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.deepEqual(asked.at(-1), ['a', 'url']);
  assert.equal(q('#reader')!.textContent, 'Ticket A');
});

test('apiRef: open an item at a section', async () => {
  const api: { current: ListReaderApi | null } = { current: null };
  const shown: Array<string | null> = [];
  await mount(list({ apiRef: api, reader: (t, ctx) => { shown.push(ctx.section); return <article id="reader"><h2 data-section="notes">Notes</h2>{t.title}</article>; } }));
  await act(async () => { api.current!.open('c', { section: 'notes' }); });
  assert.equal(q('#reader')!.textContent, 'NotesTicket C');
  assert.equal(shown.at(-1), 'notes');
  await press('j');
  assert.equal(shown.at(-1), null, 'another item opens at its top');
});

test('onOpenChange: a refusal says why in the list toast; apiRef open and close say whether they happened', async () => {
  const api: { current: ListReaderApi | null } = { current: null };
  let verdict: OpenChangeVerdict;
  let result: boolean | undefined;
  const words = () => q('.nui-toast-words')?.textContent ?? null;
  await mount(list({ apiRef: api, onOpenChange: () => verdict }));
  await click(q('[data-nui-item="b"]')!);
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  assert.equal(q('.nui-toast'), null, 'an open the page lets happen says nothing');
  verdict = false;
  await click(q('[data-nui-item="c"]')!);
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  assert.equal(words(), 'Save or cancel your changes first.');
  verdict = w('Finish the review first.', 'Termine la relecture d’abord.');
  await act(async () => { result = api.current!.open('d', { section: 'notes' }); });
  assert.equal(result, false);
  assert.equal(words(), 'Finish the review first.', 'the page\'s own words');
  verdict = 'Still saving.';
  await act(async () => { result = api.current!.close(); });
  assert.equal(result, false);
  assert.equal(words(), 'Still saving.');
  verdict = '  ';
  await press('Escape');
  assert.equal(words(), 'Save or cancel your changes first.', 'blank words fall back to the default');
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  verdict = undefined;
  await act(async () => { result = api.current!.open('b'); });
  assert.equal(result, true, 'the open item is open already');
  await act(async () => { result = api.current!.open('d'); });
  assert.equal(result, true);
  assert.equal(q('#reader')!.textContent, 'Ticket D');
  await act(async () => { api.current!.notify('Saved.', { reason: 'Two fields changed.' }); });
  assert.equal(words(), 'Saved.');
  assert.equal(q('.nui-toast-reason')!.textContent, 'Two fields changed.');
  verdict = true;
  await act(async () => { result = api.current!.close(); });
  assert.equal(result, true);
  assert.equal(q('#reader'), null);
  // In French: the default words.
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale="fr" platform="mac" engine={engine} document={doc} strict>
      {list({ apiRef: api, onOpenChange: () => verdict })}
    </KeyboardEngine>);
  });
  await click(q('[data-nui-item="a"]')!);
  verdict = false;
  await act(async () => { result = api.current!.close(); });
  assert.equal(result, false);
  assert.equal(words(), 'Enregistre ou annule tes modifications d’abord.');
});

test('reader: an open item the page keeps stays in the reader when it leaves the list, without a toast', async () => {
  let dirty = false;
  let items = [...TICKETS];
  const url = () => new URL(dom.window.location.href).searchParams.get('open');
  const props = () => ({ items, onOpenChange: () => !dirty });
  const render = await mount(list(props()));
  await click(q('[data-nui-item="c"]')!);
  dirty = true;
  items = items.filter((t) => t.id !== 'c');
  await render(list(props()));
  assert.equal(q('#reader')!.textContent, 'Ticket C', 'its unsaved edits stay on screen');
  assert.equal(q('.nui-toast'), null, 'a move the list makes on its own says nothing');
  assert.equal(url(), 'c');
  assert.equal(cursorId(), 'd', 'the cursor moves on');
  await press('j');
  assert.equal(q('#reader')!.textContent, 'Ticket C');
  assert.equal(q('.nui-toast-words')!.textContent, 'Save or cancel your changes first.');
  dirty = false;
  await press('Escape');
  assert.equal(q('#reader'), null);
  assert.equal(url(), null);
});

test('onOpen follows the item the reader shows: the URL on load once the item arrives, Back and Forward', async () => {
  const opened: Array<string | null> = [];
  const onOpen = (ticket: Ticket | null) => { opened.push(ticket?.id ?? null); };
  const render = await mount(<div />);
  // mount() resets the URL; set it after the reset so the list reads it as it mounts.
  dom.window.history.replaceState(null, '', '/space?open=b');
  await render(list({ items: [], loading: true, onOpen }));
  assert.deepEqual(opened, [], 'nothing yet while the first page loads');
  assert.equal(q('.nui-lr-reader'), null);
  await render(list({ onOpen }));
  assert.equal(q('#reader')!.textContent, 'Ticket B');
  assert.deepEqual(opened, ['b']);
  await act(async () => {
    dom.window.history.replaceState(null, '', '/space?open=c');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.equal(q('#reader')!.textContent, 'Ticket C');
  await act(async () => {
    dom.window.history.replaceState(null, '', '/space');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.equal(q('#reader'), null);
  assert.deepEqual(opened, ['b', 'c', null]);
});

test('reader: an open id the list does not hold says Item not found; Escape closes it and J opens the first item', async () => {
  const opened: Array<string | null> = [];
  const url = () => new URL(dom.window.location.href).searchParams.get('open');
  const props = { onOpen: (ticket: Ticket | null) => { opened.push(ticket?.id ?? null); } };
  let render = await mount(<div />);
  dom.window.history.replaceState(null, '', '/space?open=zz');
  await render(list(props));
  assert.equal(q('.nui-lr-reader .nui-empty-title')!.textContent, 'Item not found');
  assert.equal(q('.nui-lr-reader .nui-empty-body')!.textContent,
    'It may have been deleted, or a search or filter hides it.');
  assert.equal(q('.nui-lr')!.getAttribute('data-reader-open'), '');
  assert.deepEqual(opened, [], 'no item to announce');
  await press('Escape');
  assert.equal(q('.nui-lr-reader'), null);
  assert.equal(url(), null);
  await act(async () => {
    dom.window.history.replaceState(null, '', '/space?open=zz');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  });
  assert.equal(q('.nui-lr-reader .nui-empty-title')!.textContent, 'Item not found', 'Forward to it says so again');
  await press('j');
  assert.equal(q('#reader')!.textContent, 'Ticket A');
  assert.equal(url(), 'a');
  assert.deepEqual(opened, ['a']);
  // In French.
  render = await mount(<div />);
  dom.window.history.replaceState(null, '', '/space?open=zz');
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale="fr" platform="mac" engine={engine} document={doc} strict>
      {list()}
    </KeyboardEngine>);
  });
  assert.equal(q('.nui-lr-reader .nui-empty-title')!.textContent, 'Élément introuvable');
  // While more pages may hold the item, the reader waits instead.
  render = await mount(<div />);
  dom.window.history.replaceState(null, '', '/space?open=zz');
  await render(list({ hasMore: true, onLoadMore: () => {} }));
  assert.equal(q('.nui-lr-reader'), null);
  assert.equal(q('.nui-lr')!.getAttribute('data-reader-open'), null);
});

test('sizing: the list fills its parent; no measured height, no inline style', async () => {
  await mount(list());
  const lr = q('.nui-lr')!;
  assert.equal(lr.hasAttribute('data-fill'), false);
  assert.equal(lr.getAttribute('style'), null, 'the page gives the list its height');
  assert.equal(lr.getAttribute('data-look'), 'plain');
  await mount(list({ look: 'two-tone' }));
  assert.equal(q('.nui-lr')!.getAttribute('data-look'), 'two-tone');
});

test('tiles: arrow keys move across the grid; RowMore draws the row menu in a tile', async () => {
  await mount(list({ layout: 'tiles', reader: undefined, actions: ['star'], handlers: { star: () => {} },
    row: (t) => <div><span>{t.title}</span><RowMore /></div> }));
  // Two columns: a and b on the first line.
  const tops: Record<string, number> = { a: 0, b: 0, c: 100, d: 100 };
  for (const id of Object.keys(tops)) {
    q(`[data-nui-item="${id}"]`)!.getBoundingClientRect = () => ({ top: tops[id]! } as DOMRect);
  }
  const tileCursor = () => q('.nui-tile[data-cursor]')?.getAttribute('data-nui-item') ?? null;
  await press('j');
  const key = (k: string) => press(k);
  await key('ArrowRight');
  assert.equal(tileCursor(), 'b');
  await key('ArrowDown');
  assert.equal(tileCursor(), 'd');
  await key('ArrowLeft');
  assert.equal(tileCursor(), 'c');
  await key('ArrowUp');
  assert.equal(tileCursor(), 'a');
  assert.ok(q('[data-nui-item="a"] .nui-row-more'), 'RowMore draws the more button');
});

test('rows: date-only times read as the local day, Beta is in progress, decorative status icons', async () => {
  const now = new Date(2026, 0, 15, 9, 30);
  assert.equal(formatRowTime('2026-01-15', 'en', now), 'Today');
  assert.equal(formatRowTime('2026-01-15', 'fr', now), 'Aujourd’hui');
  assert.equal(formatRowTime('2026-01-14', 'en', now), 'Jan 14');
  assert.equal(formatRowTime(new Date(2026, 0, 15, 0, 0), 'en', now, { dateOnly: true }), 'Today');
  assert.equal(statusGroup('Beta'), 'active');
  await mount(<><StatusIcon status="done" decorative /><StatusIcon status="done" /></>);
  const icons = [...doc.querySelectorAll('.nui-st')];
  assert.equal(icons[0]!.getAttribute('aria-hidden'), 'true');
  assert.equal(icons[0]!.getAttribute('role'), null);
  assert.equal(icons[1]!.getAttribute('role'), 'img');
});

test('StarMark: a filled amber star labelled Starred (Favori), or decorative beside the word', async () => {
  await mount(<><StarMark /><StarMark decorative /></>);
  const stars = [...doc.querySelectorAll('.nui-star')];
  assert.equal(stars[0]!.getAttribute('role'), 'img');
  assert.equal(stars[0]!.getAttribute('aria-label'), 'Starred');
  assert.equal(stars[1]!.getAttribute('aria-hidden'), 'true');
  assert.equal(stars[0]!.querySelector('path')!.getAttribute('fill'), 'currentColor');
  assert.equal(STAR_WORDS.starred.fr, 'Favori');
  assert.match(toolkitCss, /\n\.nui-star \{[^}]*color: hsl\(32 95% 40%\)/);
  assert.match(toolkitCss, /\n\.dark \.nui-star \{ color: hsl\(38 92% 60%\); \}/);
});

test('Switch and Pagination blocks', async () => {
  const flips: boolean[] = [];
  const pages: number[] = [];
  await mount(<>
    <Switch checked={false} label="Enabled" onChange={(v) => flips.push(v)} />
    <Pagination page={2} total={45} pageSize={20} onChange={(p) => pages.push(p)} />
  </>);
  const sw = q('[role="switch"]')!;
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  await click(sw);
  assert.deepEqual(flips, [true]);
  assert.equal(q('.nui-pagination-label')!.textContent, '21 to 40 of 45');
  await click(q('button[aria-label="Next page"]')!);
  await click(q('button[aria-label="Previous page"]')!);
  assert.deepEqual(pages, [3, 1]);
});

// ---- footer ----

const toolkitCss = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');
/** The declarations of the toolkit rule written exactly for `selector`, or null. */
function cssRule(selector: string): string | null {
  const at = toolkitCss.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = toolkitCss.indexOf('{', at);
  return toolkitCss.slice(open + 1, toolkitCss.indexOf('}', open)).trim();
}
test('reader properties: the plain dl grid never reaches a field list, whose rows keep their own columns', () => {
  assert.equal(cssRule('.nui-lr-reader-inner dl'), null, 'no unscoped reader dl rule');
  assert.match(cssRule('.nui-lr-reader-inner dl:not(.nui-fields-list)') ?? '', /grid-template-columns: 8rem minmax\(0, 1fr\)/);
  assert.match(cssRule('.nui-lr-reader-inner dl:not(.nui-fields-list) > :is(dt, dd)') ?? '', /min-height: 36px/);
  assert.equal(cssRule('.nui-lr-reader-inner dt, .nui-lr-reader-inner dd'), null);
  // A pair grouped in a div is one row across both columns, never a single 8rem cell (the FR picker cut).
  assert.match(cssRule('.nui-lr-reader-inner dl:not(.nui-fields-list) > div') ?? '', /grid-column: 1 \/ -1; grid-template-columns: subgrid;/);
  assert.match(cssRule('.nui-lr-reader-inner dl:not(.nui-fields-list) > div > :is(dt, dd)') ?? '', /min-height: 36px/);
  // A long value (a URL) wraps inside its column: a flex cell's text never runs past the reader's edge.
  assert.match(cssRule('.nui-lr-reader-inner dl:not(.nui-fields-list) > :is(dt, dd)') ?? '', /overflow-wrap: anywhere/);
  assert.match(cssRule('.nui-lr-reader-inner dl:not(.nui-fields-list) > div > :is(dt, dd)') ?? '', /overflow-wrap: anywhere/);
});
test('row divider: a painted line, never a border, so an open or cursor row keeps a 1px ring on all four sides', () => {
  assert.match(cssRule('div.nui-row + div.nui-row') ?? '', /background-image: linear-gradient\(hsl\(var\(--border\) \/ \.5\)/);
  assert.doesNotMatch(cssRule('div.nui-row + div.nui-row') ?? '', /border(-top)?:/);
  // The line above and below an open or cursor row steps aside, so its ring is never doubled at the top or bottom.
  assert.match(cssRule('div.nui-row + div.nui-row[data-open], div.nui-row + div.nui-row[data-cursor],\ndiv.nui-row[data-open] + div.nui-row, div.nui-row[data-cursor] + div.nui-row') ?? '', /^background-image: none;$/);
  assert.doesNotMatch(cssRule('div.nui-row') ?? '', /border-top/);
});
test('table: the edge cells sit 24px in (the page head inset), a group head keeps its own padding', () => {
  assert.match(cssRule('.nui-table :is(th, td):first-child:not(.nui-group-head)') ?? '', /^padding-left: 24px;$/);
  assert.match(cssRule('.nui-table :is(th, td):last-child:not(.nui-group-head)') ?? '', /^padding-right: 24px;$/);
  assert.match(cssRule('tr.nui-row > td') ?? '', /padding: 0 12px;/, 'inner cells keep 12px');
});
const SPLIT_OPEN_FOOTER = '.nui-panels[data-mode="split"][data-reader-open] > .nui-panels-list .nui-lr-footer';

test('footer: under the list outside its scroll, clear of the floating button, still under the list beside a reader', async () => {
  await mount(list({ footer: <nav id="pager">Page 2 of 5</nav>, actions: ['complete'], handlers: { complete: () => {} } }));
  const pager = q('#pager')!;
  const footer = pager.parentElement!;
  assert.equal(footer.className, 'nui-lr-footer');
  assert.ok(footer.parentElement === q('.nui-lr-list'), 'the footer is part of the list');
  assert.ok(q('.nui-lr-list')!.hasAttribute('data-footer'));
  assert.ok(!pager.closest('[role="listbox"]'), 'outside the scroll');
  assert.ok(q('[role="listbox"]')!.compareDocumentPosition(footer) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(cssRule('.nui-lr-footer') ?? '', /padding-inline: 16px max\(12px, calc\(var\(--nui-fab-safe-end\) \+ 8px\)\)/,
    'the end of the row keeps clear of the floating Notis button');
  // The footer lifts the end of the list by its height, so the list keeps only the rest of the button's room.
  const scroll = q('[role="listbox"]')!;
  assert.ok(scroll.matches('.nui-lr-list[data-footer] .nui-lr-scroll'));
  assert.match(cssRule('.nui-lr-list[data-footer] .nui-lr-scroll') ?? '',
    /^padding-bottom: max\(0px, calc\(var\(--nui-fab-safe-bottom\) - 48px\)\); scroll-padding-bottom: max\(0px, calc\(var\(--nui-fab-safe-bottom\) - 48px\)\);$/);

  // A selection: its bar sits above the footer, and the end of the list clears the bar.
  await press('j');
  await press('x');
  assert.ok(q('.nui-selbar-slot')!.matches('.nui-lr-list[data-footer] > .nui-selbar-slot'));
  assert.equal(cssRule('.nui-lr-list[data-footer] > .nui-selbar-slot'), 'bottom: 48px;');
  assert.ok(scroll.matches('.nui-lr[data-bar] .nui-lr-list[data-footer] .nui-lr-scroll'));
  assert.match(cssRule('.nui-lr[data-bar] .nui-lr-list[data-footer] .nui-lr-scroll') ?? '', /^padding-bottom: max\(64px, calc\(var\(--nui-fab-safe-bottom\) - 48px\)\);/);
  await press('Escape');

  // Beside an open reader it stays under the list, and the reader's side takes the floating button.
  await click(q('[data-nui-item="a"]')!);
  assert.equal(q('.nui-panels')!.getAttribute('data-mode'), 'split');
  assert.ok(q('.nui-panels-list')!.contains(pager));
  assert.ok(!q('.nui-panels-reader')!.contains(pager));
  assert.ok(!q('.nui-panels-list')!.hasAttribute('inert'));
  assert.ok(footer.matches(SPLIT_OPEN_FOOTER));
  assert.equal(cssRule(SPLIT_OPEN_FOOTER), 'padding-inline-end: 12px;');
});

test('footer: in one pane the open reader covers it with the list', async () => {
  const proto = dom.window.HTMLElement.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect');
  proto.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const width = this.classList.contains('nui-panels') ? 390 : 0;
    return { width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  try {
    await mount(list({ footer: <nav id="pager">Page 2 of 5</nav> }));
    await click(q('[data-nui-item="a"]')!);
    assert.equal(q('.nui-panels')!.getAttribute('data-mode'), 'stacked');
    const covered = q('.nui-panels-list')!;
    assert.ok(covered.contains(q('#pager')));
    assert.ok(covered.hasAttribute('inert'), 'the reader covers the list and its footer');
    assert.ok(!q('.nui-lr-footer')!.matches(SPLIT_OPEN_FOOTER));
  } finally {
    if (own) Object.defineProperty(proto, 'getBoundingClientRect', own);
    else Reflect.deleteProperty(proto, 'getBoundingClientRect');
  }
});

test('rows: a warning or danger label leads the labels, so a narrow row keeps it when the meta truncates', async () => {
  await mount(
    <>
      <Row title="Pay the invoice" labels={['Billing', { label: 'Overdue', tone: 'danger' }]} />
      <Row title="Write the notes" labels={['Billing', { label: 'Ready', tone: 'success' }]} />
    </>,
  );
  const groups = [...doc.querySelectorAll('.nui-row-labels')];
  const words = (group: Element) => [...group.querySelectorAll('.nui-row-label')].map((label) => label.textContent);
  assert.deepEqual(words(groups[0]!), ['Overdue', ', Billing']);
  assert.equal(groups[0]!.querySelector('.nui-row-label')!.getAttribute('data-tone'), 'danger');
  assert.deepEqual(words(groups[1]!), ['Billing', ', Ready']);
  assert.match(cssRule('.nui-row-labels') ?? '', /text-overflow: ellipsis/);
  assert.match(cssRule('.nui-row-meta') ?? '', /text-overflow: ellipsis/, 'the meta line ends in an ellipsis (C14)');
});

test('rows: the labels shrink before the meta start, so a narrow row keeps who and when longest', async () => {
  await mount(<Row title="Fix the crumb" meta={<span>Ana · 2 days ago</span>} labels={['Billing', 'Portal']} />);
  const meta = q('.nui-row-meta')!;
  assert.deepEqual([...meta.children].map((child) => child.className), ['nui-row-meta-start', 'nui-row-dot', 'nui-row-labels']);
  const shrink = (selector: string) => Number(/flex: 0 (\d+) auto/.exec(cssRule(selector) ?? '')?.[1]);
  assert.equal(shrink('.nui-row-meta-start'), 1);
  assert.ok(shrink('.nui-row-labels') >= 100, 'the labels give way about a hundred times faster than the meta start');
});

test('footer: none, or a falsy one, draws nothing', async () => {
  await mount(list({ footer: null }));
  assert.ok(!q('.nui-lr-footer'));
  assert.ok(!q('.nui-lr-list')!.hasAttribute('data-footer'));
});

// ---- Tabs ----

const TAB_ITEMS: TabItem<'open' | 'later' | 'done'>[] = [
  { value: 'open', label: { en: 'Open', fr: 'Ouverts' }, count: 3 },
  { value: 'later', label: 'Later', disabled: true },
  { value: 'done', label: 'Done', count: 0 },
];

async function pressCode(key: string, code: string) {
  const init = { key, code, bubbles: true, cancelable: true, composed: true };
  const target = doc.activeElement ?? doc.body;
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', init));
    target.dispatchEvent(new dom.window.KeyboardEvent('keyup', init));
  });
}

function TabsHarness({ children, activation }: { children?: (value: string) => ReactNode; activation?: 'auto' | 'manual' }) {
  const [value, setValue] = useState<'open' | 'later' | 'done'>('open');
  return (
    <Tabs tabs={TAB_ITEMS} value={value} onChange={setValue} id="t" activation={activation}>
      <p id="panel-body">{value}</p>
      {children?.(value)}
    </Tabs>
  );
}

const activeTab = () => q('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab-value') ?? null;

test('Tabs: pure step skips disabled tabs and wraps round', () => {
  assert.equal(stepTab(TAB_ITEMS, 'open', 1), 'done');
  assert.equal(stepTab(TAB_ITEMS, 'done', 1), 'open');
  assert.equal(stepTab(TAB_ITEMS, 'open', -1), 'done');
  assert.equal(stepTab([{ value: 'a', label: 'A' }], 'a', 1), null);
});

test('Tabs: tablist roles, counts, [ and ] switch views, arrows Home End move between tabs', async () => {
  await mount(<TabsHarness />);
  const strip = q('[role="tablist"]')!;
  assert.equal(strip.getAttribute('aria-label'), 'Views');
  const tabs = [...doc.querySelectorAll<HTMLElement>('[role="tab"]')];
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [0, -1, -1], 'roving tabindex');
  assert.equal(tabs[0]!.querySelector('.nui-tab-count')!.textContent, '3');
  assert.equal(tabs[2]!.querySelector('.nui-tab-count')!.textContent, '0', 'a zero count still shows');
  assert.equal(tabs[1]!.hasAttribute('disabled'), true);
  const panel = q('[role="tabpanel"]')!;
  assert.equal(panel.getAttribute('aria-labelledby'), tabs[0]!.id);
  assert.equal(tabs[0]!.getAttribute('aria-controls'), panel.id);

  // [ and ] from the page, skipping the disabled tab and wrapping round.
  await pressCode(']', 'BracketRight');
  assert.equal(activeTab(), 'done');
  assert.equal(q('#panel-body')!.textContent, 'done');
  assert.equal(q('[role="tabpanel"]')!.getAttribute('aria-labelledby'), 't-tab-done');
  await pressCode(']', 'BracketRight');
  assert.equal(activeTab(), 'open');
  await pressCode('[', 'BracketLeft');
  assert.equal(activeTab(), 'done');
  assert.equal(doc.activeElement, doc.body, 'page keys leave focus where it was');

  // Arrows inside the strip move between tabs and show them (automatic activation).
  q('[data-tab-value="done"]')!.focus();
  await pressCode('ArrowLeft', 'ArrowLeft');
  assert.equal(activeTab(), 'open');
  assert.equal(doc.activeElement?.getAttribute('data-tab-value'), 'open', 'focus follows');
  await pressCode('End', 'End');
  assert.equal(activeTab(), 'done');
  await pressCode('Home', 'Home');
  assert.equal(activeTab(), 'open');
  // A page key while a tab has focus moves focus with the view.
  await pressCode(']', 'BracketRight');
  assert.equal(doc.activeElement?.getAttribute('data-tab-value'), 'done');

  // Click shows a tab; the view keys are registered for the ? sheet.
  await click(q('[data-tab-value="open"]')!);
  assert.equal(activeTab(), 'open');
  const ids = engine.registry.all().map((entry) => entry.def.id);
  assert.ok(ids.includes('view.prev') && ids.includes('view.next'));
});

test('Tabs: manual activation moves focus only; the tabs own [ and ], a period view takes them only while focused', async () => {
  await mount(<TabsHarness activation="manual" />);
  q('[data-tab-value="open"]')!.focus();
  await pressCode('ArrowRight', 'ArrowRight');
  assert.equal(activeTab(), 'open', 'manual: not shown yet');
  assert.equal(doc.activeElement?.getAttribute('data-tab-value'), 'done');
  await click(doc.activeElement!);
  assert.equal(activeTab(), 'done');

  // A period view (collection scope) inside the panel, gated like CalendarView: strict mode would throw on a
  // duplicate; it shadows the tab keys instead, and only while focus is inside it.
  const steps: number[] = [];
  function FakeCalendar() {
    const inside = () => focusInside(doc.getElementById('calendar'));
    useShortcuts([
      keymapDef('period.prev', { en: 'Previous', fr: 'Pr\u00e9c\u00e9dent' }, inside, () => { steps.push(-1); }),
      keymapDef('period.next', { en: 'Next', fr: 'Suivant' }, inside, () => { steps.push(1); }),
    ]);
    return <div id="calendar" tabIndex={-1} />;
  }
  await mount(<TabsHarness>{(value) => (value === 'open' ? <FakeCalendar /> : null)}</TabsHarness>);
  q('#calendar')!.focus();
  await pressCode(']', 'BracketRight');
  assert.deepEqual(steps, [1], 'focus inside: the calendar steps its period');
  assert.equal(activeTab(), 'open', 'the tabs stay put');
  q('#calendar')!.blur();
  await pressCode(']', 'BracketRight');
  assert.deepEqual(steps, [1], 'focus on the page: the calendar keeps still');
  assert.equal(activeTab(), 'done', 'and the tabs switch');
});

test('wrap={2} lets a long title take a second line; the default stays one line', async () => {
  await mount(<>
    <Row title="A memory long enough to wrap" wrap={2} />
    <Row title="One line" />
  </>);
  const titles = [...doc.querySelectorAll('.nui-row-title')];
  assert.equal(titles[0]!.getAttribute('data-lines'), '2');
  assert.equal(titles[1]!.hasAttribute('data-lines'), false);
  // @ts-expect-error titleLines is gone: wrap replaces it.
  void <Row title="x" titleLines={2} />;
});

// ---- realign: toolbar, reader bar, menus, tiles, search, crumb ----

/** A runtime outside a Space's URL (no navigate): the list keeps the open id in the page URL. */
function runtimeWith(extra: Partial<NotisRuntime>): NotisRuntime {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params: {}, locale: 'en' },
    callAction: async () => undefined,
    ...extra,
  } as unknown as NotisRuntime;
}

/** The reader bar's parts, in order. */
const barParts = () => [...q('.nui-lr-bar')!.querySelectorAll('[data-part]')].map((el) => el.getAttribute('data-part'));

/** Stubs the Panels width (split from 680, stacked below) while `run` lasts; other elements measure 0. */
async function withPanelsWidth(width: number, run: () => Promise<void>) {
  const proto = dom.window.HTMLElement.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect');
  proto.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const w = this.classList.contains('nui-panels') ? width : 0;
    return { width: w, height: 800, top: 0, left: 0, right: w, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  try {
    await run();
  } finally {
    if (own) Object.defineProperty(proto, 'getBoundingClientRect', own);
    else Reflect.deleteProperty(proto, 'getBoundingClientRect');
  }
}

const starOnly = { actions: ['star'] as const, handlers: { star: () => {} } };

test('props: toolbar, header, divided and fill are gone', () => {
  // @ts-expect-error toolbar is gone: title, tabs, create and viewMenu draw the toolbar.
  void list({ toolbar: <span /> });
  // @ts-expect-error header is gone: readerLabel and readerActions fill the reader bar.
  void list({ header: () => <span /> });
  // @ts-expect-error divided is gone: rows always draw their divider.
  void list({ divided: true });
  // @ts-expect-error fill is gone: the page gives the list its height.
  void list({ fill: true });
});

test('reader bar order: side split, center, full page and the one-pane slide (C1)', async () => {
  // Side beside the list: Close, Open as, Prev, Next, label, actions, More.
  await mount(list({ ...starOnly, openAs: ['side', 'center', 'full'] }));
  await click(q('[data-nui-item="a"]')!);
  assert.deepEqual(barParts(), ['close', 'mode', 'prev', 'next', 'label', 'actions', 'more']);
  // Center: the same, then Expand to the full page.
  await mount(list({ ...starOnly, openAs: ['center', 'side', 'full'] }));
  await click(q('[data-nui-item="a"]')!);
  assert.deepEqual(barParts(), ['close', 'mode', 'prev', 'next', 'label', 'actions', 'more', 'expand']);
  // Center without the full page: no Expand.
  await mount(list({ ...starOnly, openAs: ['center', 'side'] }));
  await click(q('[data-nui-item="a"]')!);
  assert.deepEqual(barParts(), ['close', 'mode', 'prev', 'next', 'label', 'actions', 'more']);
  // Full page: Back leads, no second Close.
  await mount(list({ ...starOnly, openAs: ['full', 'side'] }));
  await click(q('[data-nui-item="a"]')!);
  assert.deepEqual(barParts(), ['back', 'mode', 'prev', 'next', 'label', 'actions', 'more']);
  // One pane: the reader slides over the list, Back leads and Close ends the bar.
  await withPanelsWidth(390, async () => {
    await mount(list({ ...starOnly }));
    await click(q('[data-nui-item="a"]')!);
    assert.equal(q('.nui-panels')!.getAttribute('data-mode'), 'stacked');
    assert.deepEqual(barParts(), ['back', 'mode', 'prev', 'next', 'label', 'actions', 'more', 'close']);
  });
  assert.match(cssRule('.nui-lr-bar') ?? '', /height: 48px;/);
  assert.match(cssRule('.nui-lr-actions') ?? '', /gap: 4px;/, 'actions keep the 4px rhythm of the bar');
});

test('reader bar at 348: three actions show, the rest fold into More, and the parts fit beside Close', async () => {
  const ran: string[] = [];
  const six = ['one', 'two', 'three', 'four', 'five', 'six'].map((id) => ({
    id, label: id, icon: 'star', run: () => { ran.push(id); },
  }));
  await mount(list({ ...starOnly, openAs: ['center', 'side', 'full'], readerActions: () => six }));
  await click(q('[data-nui-item="a"]')!);
  const shown = [...q('[data-part="actions"]')!.querySelectorAll('[data-action]')].map((el) => el.getAttribute('data-action'));
  assert.deepEqual(shown, ['one', 'two', 'three']);
  await click(q('.nui-lr-bar [data-part="more"]')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const labels = [...doc.querySelectorAll('[role="menu"] [data-nui-menu-item] .nui-menu-label')].map((i) => i.textContent);
  assert.deepEqual(labels, ['four', 'five', 'six', 'Star'], 'the folded actions first, then the item actions');
  await click([...doc.querySelectorAll('[role="menu"] [data-nui-menu-item]')][1]!);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(ran, ['five']);
  // The widest bar beside a list (center: ten parts) at its CSS sizes: icon buttons 28, Open as 42, actions 32 icon-only
  // under 560, padding 8 each side, a 4px gap and the label at 0 width (no start margin, N2). It fits in 348 with room.
  const width = (part: string | null) => ({ close: 28, mode: 42, prev: 28, next: 28, label: 0, more: 28, expand: 28,
    actions: 3 * 32 + 2 * 2 } as Record<string, number>)[part ?? '']!;
  const parts = barParts();
  const sum = parts.reduce((total, part) => total + width(part), 0) + 16 + 4 * (parts.length - 1);
  assert.ok(sum <= 348, `the center bar needs ${sum}px`);
  assert.match(cssRule('.nui-lr-bar') ?? '', /overflow: hidden;/);
  assert.equal(cssRule('.nui-lr-bar > *'), 'flex-shrink: 0;', 'buttons never squeeze');
  assert.match(cssRule('.nui-lr-label') ?? '', /flex: 1 1 0; min-width: 0; margin-inline-start: 0;/,
    'the label gives way first and starts one bar gap after Next (deck)');
  assert.match(toolkitCss, /@container nui-lr-reader \(max-width: 360px\) \{ \.nui-lr-label \{ visibility: hidden; \} \}/,
    'a reader too narrow for a readable label keeps its place without a cut sliver (N1)');
  assert.match(toolkitCss, /@container nui-lr-reader \(max-width: 560px\) \{ \.nui-lr-act-label \{ display: none; \} \}/, 'under 560 the label goes, the key stays');
  assert.match(toolkitCss, /@container nui-lr-reader \(max-width: 430px\) \{ \.nui-lr-act > \.nui-kbd-group \{ display: none; \} \}/,
    'phone widths (390) drop the key hints before the label truncates; wider readers keep them');
});

test('reader bar: a keyed action shows its label and key, runs on its key, and a second press waits for the first', async () => {
  let release: () => void = () => {};
  let runs = 0;
  await mount(list({ readerActions: () => [
    { id: 'reply', label: 'Reply', icon: 'arrow-bend-up-left', key: 'r',
      run: () => { runs += 1; return new Promise<void>((resolve) => { release = resolve; }); } },
    { id: 'pin', label: 'Pin', icon: 'push-pin', run: () => {} },
  ] }));
  await click(q('[data-nui-item="a"]')!);
  const reply = q('[data-action="reply"]')!;
  assert.equal(reply.className, 'nui-lr-act');
  assert.equal(reply.querySelector('.nui-lr-act-label')!.textContent, 'Reply');
  assert.ok(reply.querySelector('.nui-kbd-group, kbd'), 'its key shows');
  assert.equal(q('[data-action="pin"]')!.className, 'nui-om-btn', 'an unkeyed action is an icon with a tooltip');
  await press('r');
  assert.equal(runs, 1);
  assert.equal(reply.getAttribute('aria-busy'), 'true');
  assert.equal((reply as HTMLButtonElement).disabled, false, 'a busy button stays enabled (focus stays put)');
  await click(reply);
  assert.equal(runs, 1, 'a second press waits for the first run');
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
  assert.equal(reply.hasAttribute('aria-busy'), false);
});

test('reader bar: a disabled action, or any action while the open item is pending, runs from neither click nor key', async () => {
  let runs = 0;
  let pending = false;
  const actions = () => [
    { id: 'reply', label: 'Reply', icon: 'arrow-bend-up-left', key: 'r', run: () => { runs += 1; } },
    { id: 'pin', label: 'Pin', icon: 'push-pin', disabled: true, run: () => { runs += 1; } },
  ];
  const props = () => ({ readerActions: actions, isPending: () => pending });
  await mount(list(props()));
  await click(q('[data-nui-item="a"]')!);
  const pin = q('[data-action="pin"]')!;
  assert.equal(pin.getAttribute('aria-disabled'), 'true');
  await click(pin);
  assert.equal(runs, 0, 'a disabled button does not run');
  assert.equal(q('[data-action="reply"]')!.hasAttribute('aria-disabled'), false);
  pending = true;
  await mount(list(props()));
  await click(q('[data-nui-item="a"]')!);
  const reply = q('[data-action="reply"]')!;
  assert.equal(reply.getAttribute('aria-disabled'), 'true', 'a pending open item disables every reader button');
  await click(reply);
  await press('r');
  assert.equal(runs, 0);
});

test('reader bar: with rows selected beside the reader the action keys yield to the selection and hide their hints; cleared, they work again', async () => {
  let runs = 0;
  await mount(list({ actions: ['complete'], handlers: { complete: () => {} }, readerActions: () => [
    { id: 'reply', label: 'Reply', icon: 'arrow-bend-up-left', key: 'r', run: () => { runs += 1; } },
  ] }));
  await click(q('[data-nui-item="a"]')!);
  const hint = () => q('[data-action="reply"] .nui-kbd-group');
  assert.ok(hint(), 'the button shows its key');
  await click(q('[data-nui-item="b"] .nui-row-check')!);
  assert.deepEqual(selectedIds(), ['b']);
  assert.equal(hint(), null, 'the button hides the key the selection bar answers');
  await press('r');
  assert.equal(runs, 0, 'the key belongs to the selection while rows are selected');
  await click(q('[data-nui-item="b"] .nui-row-check')!);
  assert.deepEqual(selectedIds(), []);
  assert.ok(hint(), 'cleared, the key shows again');
  assert.equal(q('#reader')!.textContent, 'Ticket A');
  await press('r');
  assert.equal(runs, 1);
});

test('crumb: the open item adds its leaf to the top bar title in every open mode, and closing removes it', async () => {
  const leaves: Array<{ label: string; onBack?: () => void } | null> = [];
  const runtime = runtimeWith({ setTopBarTitleLeaf: (leaf: { label: string; onBack?: () => void } | null) => { leaves.push(leaf); } });
  const last = () => { const leaf = leaves[leaves.length - 1] ?? null; return leaf ? { label: leaf.label } : null; };
  const modes: Array<ListReaderProps<Ticket>['openAs']> = [['side', 'center'], ['center', 'side'], ['full', 'side']];
  for (const openAs of modes) {
    await mount(<NotisProvider runtime={runtime}>{list({ openAs })}</NotisProvider>);
    await click(q('[data-nui-item="b"]')!);
    assert.deepEqual(last(), { label: 'Ticket B' }, `open as ${String(openAs)}`);
    await press('j');
    assert.deepEqual(last(), { label: 'Ticket C' }, 'the leaf follows the open item');
    await press('Escape');
    assert.equal(last(), null, 'closing removes the leaf');
  }
  await mount(<NotisProvider runtime={runtime}>{list({})}</NotisProvider>);
  await click(q('[data-nui-item="b"]')!);
  const open = leaves[leaves.length - 1]!;
  await act(async () => { open.onBack!(); });
  assert.equal(last(), null, 'the top bar view crumb closes the open item');
  await withPanelsWidth(390, async () => {
    await mount(<NotisProvider runtime={runtime}>{list({ crumbLabel: (t) => `PRO-00${'abcd'.indexOf(t.id) + 1}` })}</NotisProvider>);
    await click(q('[data-nui-item="b"]')!);
    assert.equal(q('.nui-panels')!.getAttribute('data-mode'), 'stacked');
    assert.deepEqual(last(), { label: 'PRO-002' }, 'crumbLabel names the leaf (one pane)');
  });
  await mount(<NotisProvider runtime={runtime}>{list({ crumbLabel: () => null })}</NotisProvider>);
  await click(q('[data-nui-item="a"]')!);
  assert.equal(last(), null, 'a null crumbLabel adds no leaf');
});

test('crumb: a second ListReader with nothing open never clears the first one\'s leaf (R2-01)', async () => {
  const leaves: Array<{ label: string; onBack?: () => void } | null> = [];
  const runtime = runtimeWith({ setTopBarTitleLeaf: (leaf: { label: string; onBack?: () => void } | null) => { leaves.push(leaf); } });
  const last = () => { const leaf = leaves[leaves.length - 1] ?? null; return leaf ? { label: leaf.label } : null; };
  const page = (both: boolean) => (
    <NotisProvider runtime={runtime}>{list({ openInUrl: false })}{both ? list({ openInUrl: false, listId: 'other' }) : null}</NotisProvider>);
  const render = await mount(page(false));
  await click(q('[data-nui-item="b"]')!);
  assert.deepEqual(last(), { label: 'Ticket B' });
  const sent = leaves.length;
  await render(page(true));
  assert.equal(leaves.length, sent, 'the second reader mounts with nothing open and writes nothing');
  const second = doc.querySelectorAll<HTMLElement>('[data-nui-item="c"]')[1]!;
  await click(second);
  assert.deepEqual(last(), { label: 'Ticket C' }, 'the newest open item names the leaf');
  await press('Escape');
  assert.deepEqual(last(), { label: 'Ticket B' }, 'closing it gives the leaf back to the first reader');
});

test('row menu: Open with Enter first, then E, status, the others in order, and danger last after a line (B3)', async () => {
  const noop = () => {};
  await mount(list({
    actions: ['delete', 'star', { id: 'move', options: [{ value: 'inbox', label: 'Inbox' }] }, 'complete', 'archive', 'progress'],
    handlers: { delete: noop, star: noop, move: noop, archive: noop, progress: noop, complete: noop },
  }));
  await click(q('[data-nui-item="a"] .nui-row-more')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const entries = [...q('[role="menu"]')!.querySelectorAll('[data-nui-menu-item], [role="separator"]')];
  const name = (el: Element) => (el.getAttribute('role') === 'separator' ? '---'
    : (el.querySelector('.nui-lr-sub-label > span:first-child') ?? el.querySelector('.nui-menu-label'))!.textContent);
  assert.deepEqual(entries.map(name), ['Open', 'Complete', 'Start progress', 'Star', 'Move to…', 'Archive', '---', 'Delete']);
  const keyed = (label: string) => !!entries.find((el) => name(el) === label)!.querySelector('.nui-menu-keys');
  assert.ok(keyed('Open'), 'Open shows Enter');
  assert.ok(keyed('Move to…'), 'the Move submenu shows M');
  assert.ok(!keyed('Start progress'));
  assert.equal(engine.registry.all().filter((entry) => entry.def.id.startsWith('notis.menu-key:')).length, 0,
    'a row menu registers no keys');
  // Open opens the item.
  await click(entries[0]!);
  assert.equal(q('#reader')!.textContent, 'Ticket A');
});

test('rankActions: the first E action, then status, then the rest in order, danger last', () => {
  const ranked = rankActions([
    { id: 'delete', tone: 'danger' }, { id: 'star', key: 's' }, { id: 'resume' }, { id: 'archive', key: 'e' },
    { id: 'complete', key: 'E' }, { id: 'pause' },
  ]);
  assert.deepEqual(ranked.map((a) => a.id), ['archive', 'resume', 'pause', 'star', 'complete', 'delete']);
});

test('rows: a pending row keeps an empty More slot so its trail lines up (C12); the trail reads star, time, avatar', async () => {
  const now = new Date(2026, 0, 15, 9, 30);
  await mount(list({
    ...starOnly,
    isPending: (t) => t.id === 'b',
    row: (t) => <Row title={t.title} time={new Date(2026, 0, 15, 9, 18)} now={now} owner={{ name: 'Ada Lovelace' }}
      trailing={<span className="star" />} />,
  }));
  const trail = (id: string) => [...q(`[data-nui-item="${id}"] .nui-row-trail`)!.children].map((el) => el.className);
  assert.deepEqual(trail('a'), ['star', 'nui-row-time', 'nui-avatar', 'nui-row-more']);
  assert.deepEqual(trail('b'), ['star', 'nui-row-time', 'nui-avatar', 'nui-row-more']);
  assert.equal(q('[data-nui-item="b"] .nui-row-more')!.getAttribute('aria-hidden'), 'true', 'the slot is empty');
  assert.equal(q('[data-nui-item="a"] .nui-row-time')!.textContent, '12m');
});

test('rows: a row with no action that applies keeps Open when it opens, else an empty More slot (R2-02)', async () => {
  const onlyA = { actions: [{ id: 'star', appliesTo: (t: Ticket) => t.id === 'a' }], handlers: { star: () => {} } };
  await mount(list(onlyA));
  await click(q('[data-nui-item="b"] .nui-row-more')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const labels = [...q('[role="menu"]')!.querySelectorAll('[data-nui-menu-item] .nui-menu-label')].map((el) => el.textContent);
  assert.deepEqual(labels, ['Open'], 'a row that opens a reader still offers Open');
  await mount(list({ ...onlyA, reader: undefined }));
  const slot = q('[data-nui-item="b"] .nui-row-more')!;
  assert.equal(slot.tagName, 'SPAN', 'nothing to offer: the slot stays, empty');
  assert.equal(slot.getAttribute('aria-hidden'), 'true');
  assert.equal(q('[data-nui-item="a"] .nui-row-more')!.tagName, 'BUTTON');
});

test('row times: compact in the row, long in the reader, both languages', () => {
  const now = new Date(2026, 0, 15, 9, 30);
  assert.equal(formatRowAgo(new Date(2026, 0, 15, 8, 45), 'en', now), '45m');
  assert.equal(formatRowAgo(new Date(2026, 0, 15, 7, 30), 'en', now), '2h');
  assert.equal(formatRowAgo(new Date(2026, 0, 11, 9, 30), 'en', now), '4d');
  assert.equal(formatRowAgo(new Date(2026, 0, 15, 8, 45), 'fr', now), '45 min');
  assert.equal(formatRowAgo(new Date(2026, 0, 11, 9, 30), 'fr', now), '4 j');
  assert.equal(formatRowAgo(new Date(2026, 0, 16), 'en', now), null, 'a time ahead has no ago');
  assert.equal(formatReaderAgo(new Date(2026, 0, 15, 8, 45), 'en', now), '45m ago');
  assert.equal(formatReaderAgo(new Date(2026, 0, 15, 8, 45), 'fr', now), 'il y a 45 min');
  assert.equal(formatRowTime(new Date(2025, 11, 1), 'en', now), 'Dec 1, 2025', 'over 30 days: the date');
});

test('tiles: renderTile draws the mark beside the head, body and the bottom line, then the row More; the manager variant', async () => {
  await mount(list({
    ...starOnly, layout: 'tiles', tileVariant: 'manager', reader: undefined,
    renderTile: (t) => (t.id === 'a'
      ? { mark: <i>M</i>, title: t.title, subtitle: 'Sub', body: 'Body', figure: '3', trailing: <span className="tr" /> }
      : { title: t.title }),
  }));
  const tile = q('[data-nui-item="a"]')!;
  assert.equal(tile.getAttribute('data-variant'), 'manager');
  assert.deepEqual([...tile.children].map((el) => el.className),
    ['nui-tile-top', 'nui-tile-body', 'nui-tile-bottom', 'nui-row-more']);
  assert.deepEqual([...tile.querySelector('.nui-tile-top')!.children].map((el) => el.className), ['nui-tile-mark', 'nui-tile-head'],
    'the mark sits beside the title and subtitle, as the deck draws a tile (148px)');
  assert.match(cssRule('.nui-tile-top') ?? '', /display: flex; align-items: center; gap: 12px;/);
  assert.deepEqual([...tile.querySelector('.nui-tile-head')!.children].map((el) => el.textContent), ['Ticket A', 'Sub']);
  assert.deepEqual([...tile.querySelector('.nui-tile-bottom')!.children].map((el) => el.className),
    ['nui-tile-figure', 'nui-tile-spacer', 'tr']);
  const bare = q('[data-nui-item="b"]')!;
  assert.deepEqual([...bare.children].map((el) => el.className), ['nui-tile-top', 'nui-row-more'], 'only the parts given');
  assert.deepEqual([...bare.querySelector('.nui-tile-top')!.children].map((el) => el.className), ['nui-tile-head']);
  assert.match(cssRule('.nui-tile[data-variant="manager"]') ?? '', /min-height: 152px;/);
  assert.match(cssRule('.nui-tile-figure') ?? '', /min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/,
    'a long figure ("Sans priorité") ends in an ellipsis on one line, never wraps (N3)');
});

test('search: the top bar search filters the list by title, or by `match`; J/K walk what is left', async () => {
  let binding: { onChange(value: string): void; placeholder?: string } | null = null;
  const values: string[] = [];
  const runtime = runtimeWith({
    registerTopBarSearch: (next: typeof binding) => { binding = next; },
    setTopBarSearchValue: (value: string) => { values.push(value); },
  } as Partial<NotisRuntime>);
  const ids = () => [...doc.querySelectorAll('.nui-row')].map((row) => row.getAttribute('data-nui-item'));
  await mount(<NotisProvider runtime={runtime}>{list({ search: { placeholder: 'Search tickets' } })}</NotisProvider>);
  assert.equal(binding!.placeholder, 'Search tickets');
  await act(async () => { binding!.onChange('ticket c'); });
  assert.deepEqual(ids(), ['c'], 'the title holds the query, any case');
  await act(async () => { binding!.onChange(''); });
  assert.deepEqual(ids(), ['a', 'b', 'c', 'd']);
  await mount(<NotisProvider runtime={runtime}>{list({ search: { match: (t, query) => 'bd'.includes(t.id) && query === 'x' } })}</NotisProvider>);
  await act(async () => { binding!.onChange('x'); });
  assert.deepEqual(ids(), ['b', 'd']);
  await press('j');
  await press('j');
  assert.equal(cursorId(), 'd');
  await press('j');
  assert.equal(cursorId(), 'b', 'J wraps within the matches');
  // A page that keeps the query itself filters its own items: the list shows them all.
  await mount(<NotisProvider runtime={runtime}>{list({ search: { value: 'zzz', onChange: () => {} } })}</NotisProvider>);
  assert.deepEqual(ids(), ['a', 'b', 'c', 'd']);
  assert.equal(values[values.length - 1], 'zzz', 'its value goes to the top bar');
  await act(async () => { root!.unmount(); root = null; });
  assert.equal(binding, null, 'unmounting lets the top bar go');
});

test('toolbar: one line, the title and count, then "+" (its key creates; C stays the host\'s) and the view menu with its actions', async () => {
  const created: number[] = [];
  const sorted: string[] = [];
  await mount(list({
    title: { text: w('Tickets', 'Tickets'), count: 4 },
    create: { label: w('New ticket', 'Nouveau ticket'), onCreate: () => { created.push(1); }, key: 'n' },
    viewMenu: {
      sort: [{ id: 'new', label: 'Newest', checked: true, onSelect: () => { sorted.push('new'); } },
        { id: 'old', label: 'Oldest', onSelect: () => { sorted.push('old'); } }],
      actions: [{ id: 'refresh', label: w('Refresh research', 'Actualiser la recherche'), icon: 'arrow-clockwise', onSelect: () => { sorted.push('refresh'); } }],
      description: w('All open tickets.', 'Tous les tickets ouverts.'),
    },
  }));
  const bar = q('.nui-lr-list > .nui-lr-toolbar')!;
  assert.deepEqual([...bar.children].map((el) => el.className), ['nui-lr-title', 'nui-lr-toolbar-spacer', 'nui-lr-tools']);
  assert.equal(q('.nui-lr-title-text')!.textContent, 'Tickets');
  assert.equal(q('.nui-lr-title-count')!.textContent, '4');
  assert.deepEqual([...bar.querySelectorAll('[data-part]')].map((el) => el.getAttribute('data-part')), ['create', 'view-menu']);
  assert.equal(q('[data-part="create"]')!.getAttribute('aria-label'), 'New ticket');
  await press('n');
  assert.deepEqual(created, [1], 'N creates from the list');
  await click(q('[data-part="create"]')!);
  assert.deepEqual(created, [1, 1]);
  await click(q('[data-part="view-menu"]')!);
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  assert.equal(q('[role="menu"]')!.getAttribute('aria-label'), 'View options');
  assert.equal(q('[role="menu"] .nui-lr-view-note')!.textContent, 'All open tickets.');
  const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((el) => el.textContent);
  assert.deepEqual(items, ['Sort', 'Refresh research'], 'view actions follow the choices');
  assert.ok(q('[role="menu"] [role="separator"]'), 'a separator sets the actions apart');
  await click([...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((el) => el.textContent === 'Refresh research')!);
  assert.deepEqual(sorted, ['refresh']);
  assert.match(cssRule('.nui-lr-toolbar') ?? '', /flex-wrap: nowrap;/);
  assert.match(cssRule('.nui-lr-toolbar') ?? '', /min-height: 44px;/);
  // Tabs: one TabRow line, the title leading the pills and the tools at its end.
  await mount(list({
    title: { text: 'Tickets' },
    tabs: { role: 'filter', items: [{ id: 'open', label: 'Open' }, { id: 'done', label: 'Done' }], value: 'open', onChange: () => {} },
    toolbarActions: <button type="button" id="refresh">Refresh</button>,
    create: { label: 'New ticket', onCreate: () => {} },
  }));
  assert.equal(q('.nui-lr-toolbar'), null);
  const row = q('.nui-lr-list > .nui-tabrow')!;
  assert.ok(row.querySelector('.nui-lr-title'), 'the title leads the pills');
  assert.ok(row.querySelector('[data-part="create"]'), '"+" ends the line');
  assert.deepEqual([...row.querySelector('.nui-lr-tools')!.children].map((el) => el.id || el.getAttribute('data-part')), ['refresh', 'create'], 'toolbar actions come before "+"');
  assert.equal(row.querySelectorAll('[role="radio"]').length, 2);
  assert.match(cssRule('.nui-tabrow') ?? '', /height: 44px;/);
});

test('infoLine: a line under the toolbar, above the rows', async () => {
  await mount(list({ title: { text: 'Skills' }, infoLine: <span id="info">Synced 2m ago</span> }));
  const listEl = q('.nui-lr-list')!;
  assert.deepEqual([...listEl.children].slice(0, 2).map((el) => el.className), ['nui-lr-toolbar', 'nui-lr-info']);
  assert.ok(q('.nui-lr-info #info'));
});

test('autoOpen: beside the list the first item opens; closed, the reader says how to pick one; one pane opens nothing', async () => {
  // One pane (a phone): the list shows and nothing opens, not even before the first measure.
  await withPanelsWidth(500, async () => { await mount(list({ autoOpen: true })); });
  assert.equal(q('.nui-panels')!.getAttribute('data-mode'), 'stacked');
  assert.equal(q('#reader'), null);
  await withPanelsWidth(1000, async () => { await mount(list({ autoOpen: true })); });
  assert.equal(q('#reader')!.textContent, 'Ticket A');
  await press('Escape');
  assert.equal(q('#reader'), null);
  const pick = q('.nui-lr-pick')!;
  assert.equal(pick.querySelector('p')!.textContent, 'Pick something from the list to read it.');
  assert.equal(pick.querySelectorAll('.nui-lr-pick-keys kbd, .nui-lr-pick-keys .nui-kbd-group').length > 0, true);
  // Where the reader would cover the list nothing opens on its own.
  await mount(list({ autoOpen: true, openAs: 'full' }));
  assert.equal(q('#reader'), null);
  assert.equal(q('.nui-lr-pick'), null);
});

// ---- drag to select (the Manager's marquee) ----

/** Rows stacked 40px apart from y=0, 300px wide; the scroll area runs on below them. */
function layOutRows() {
  doc.querySelectorAll<HTMLElement>('[data-nui-item]').forEach((row, index) => {
    row.getBoundingClientRect = () => ({
      left: 0, top: index * 40, right: 300, bottom: index * 40 + 40, width: 300, height: 40, x: 0, y: index * 40,
      toJSON: () => ({}),
    }) as DOMRect;
  });
}

/** Press at `from` on `target`, move to `to` (past the threshold), release; then the click the browser sends. */
async function marquee(target: Element, from: [number, number], to: [number, number], clickOn: Element = target) {
  const at = (x: number, y: number) => ({ bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('mousedown', at(...from))); });
  await act(async () => { doc.dispatchEvent(new dom.window.MouseEvent('mousemove', at(from[0] + 2, from[1] + 2))); });
  await act(async () => { doc.dispatchEvent(new dom.window.MouseEvent('mousemove', at(...to))); });
  const live = { selected: selectedIds(), overlay: !!q('.nui-marquee'), bar: !!q('.nui-selbar') };
  // The browser sends the click in the same task as the mouseup.
  await act(async () => {
    doc.dispatchEvent(new dom.window.MouseEvent('mouseup', at(...to)));
    clickOn.dispatchEvent(new dom.window.MouseEvent('click', at(...to)));
  });
  return live;
}

test('drag to select: a marquee from empty space selects the rows under it, live, and shows the selection bar', async () => {
  await mount(list({ actions: ['complete'], handlers: { complete: () => {} } }));
  layOutRows();
  const live = await marquee(q('.nui-lr-scroll')!, [320, 10], [100, 100], q('[data-nui-item="c"]')!);
  assert.deepEqual(live.selected, ['a', 'b', 'c'], 'rows under the rectangle are selected while dragging');
  assert.ok(live.overlay, 'the marquee shows while dragging');
  assert.ok(live.bar, 'the selection bar shows');
  assert.equal(q('.nui-marquee'), null, 'the marquee goes on release');
  assert.deepEqual(selectedIds(), ['a', 'b', 'c'], 'the click that ends the drag does not clear');
  assert.equal(q('#reader'), null, 'nor open the row it ends on');
  await click(q('[data-nui-item="d"]')!, { shift: true });
  assert.deepEqual(selectedIds(), ['a', 'b', 'c', 'd'], 'the last row under the marquee is the shift anchor');
});

test('drag to select: a press on a row or a control never starts a marquee', async () => {
  await mount(list({ selectable: true }));
  layOutRows();
  await marquee(q('[data-nui-item="a"]')!, [10, 10], [100, 150]);
  assert.deepEqual(selectedIds(), [], 'a drag from a row selects nothing');
  assert.equal(q('.nui-marquee'), null);
  await mount(list({ selectable: true, hasMore: true, onLoadMore: () => {} }));
  layOutRows();
  await marquee(q('.nui-lr-more button')!, [10, 170], [100, 10]);
  assert.deepEqual(selectedIds(), [], 'nor does a drag from a button in the list');
});

test('drag to select: a press on the leading strip of a row starts a marquee, its checkbox does not', async () => {
  await mount(list({ selectable: true }));
  layOutRows();
  const lead = q('[data-nui-item="a"] .nui-row-lead')!;
  assert.ok(lead, 'a selectable row has a leading strip');
  const live = await marquee(lead, [4, 10], [100, 100], q('[data-nui-item="c"]')!);
  assert.deepEqual(live.selected, ['a', 'b', 'c'], 'a full list still has a place to start a marquee');
  assert.ok(live.overlay);
  assert.equal(q('#reader'), null, 'the click that ends the drag opens nothing');
  await mount(list({ selectable: true }));
  layOutRows();
  await marquee(q('[data-nui-item="a"] .nui-row-check')!, [10, 10], [100, 100]);
  assert.equal(q('.nui-marquee'), null, 'the checkbox stays a checkbox');
});

test('drag to select: pending and disabled rows are skipped', async () => {
  await mount(list({ selectable: true, isPending: (t) => t.id === 'b', isDisabled: (t) => t.id === 'c' }));
  layOutRows();
  await marquee(q('.nui-lr-scroll')!, [320, 10], [100, 150]);
  assert.deepEqual(selectedIds(), ['a', 'd']);
});

test('drag to select: a plain click on empty space clears the selection', async () => {
  await mount(list({ selectable: true }));
  layOutRows();
  await click(q('[data-nui-item="a"]')!, { meta: true });
  await click(q('[data-nui-item="c"]')!, { meta: true });
  assert.deepEqual(selectedIds(), ['a', 'c']);
  await click(q('.nui-lr-scroll')!);
  assert.deepEqual(selectedIds(), []);
});

test('drag to select: off with dragSelect={false}, and on a list that cannot select several', async () => {
  await mount(list({ selectable: true, dragSelect: false }));
  layOutRows();
  await marquee(q('.nui-lr-scroll')!, [320, 10], [100, 150]);
  assert.deepEqual(selectedIds(), []);
  assert.equal(q('.nui-marquee'), null);
  await mount(list());
  layOutRows();
  const live = await marquee(q('.nui-lr-scroll')!, [320, 10], [100, 150]);
  assert.equal(live.overlay, false, 'no bulk action, no selection: no marquee');
});
