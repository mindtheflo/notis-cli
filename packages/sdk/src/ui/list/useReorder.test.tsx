import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { ActionError } from '../../words';
import { ListReader, type ListReaderProps } from './ListReader';
import { Row } from './Row';
import { REORDER_DRAG_TYPE, REORDER_WORDS, dropIndex, useReorder, type ReorderChange } from './useReorder';

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

interface Ticket { id: string; title: string }
const TICKETS: Ticket[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: `Ticket ${id.toUpperCase()}` }));

let root: Root | null = null;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="root"></div>';
  dom.window.localStorage.clear();
  dom.window.history.replaceState(null, '', '/space');
  const engine = new KeyboardEngineCore();
  root = createRoot(doc.getElementById('root')!);
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale="en" platform="mac" engine={engine} document={doc} strict>{node}</KeyboardEngine>);
  });
}

const q = (selector: string) => doc.querySelector<HTMLElement>(selector);
const row = (id: string) => q(`[data-nui-item="${id}"]`)!;
const order = () => Array.from(doc.querySelectorAll('[data-nui-item]'), (element) => element.getAttribute('data-nui-item'));
const live = () => q('[role="status"][aria-live="polite"]')?.textContent?.replace(/ /g, '') ?? null;

async function focus(element: HTMLElement) {
  await act(async () => { element.focus(); });
}

async function altKey(key: string, target: Element | null = doc.activeElement) {
  await act(async () => {
    target!.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key, code: key, altKey: true, bubbles: true, cancelable: true, composed: true,
    }));
  });
}

class TestDataTransfer {
  data = new Map<string, string>();
  effectAllowed = 'uninitialized';
  dropEffect = 'none';
  get types() { return Array.from(this.data.keys()); }
  setData(type: string, value: string) { this.data.set(type, value); }
  getData(type: string) { return this.data.get(type) ?? ''; }
}

/** Gives every row a 40px tall box stacked from the top, so "before" and "after" follow the pointer. */
function layoutRows(height = 40) {
  doc.querySelectorAll<HTMLElement>('[data-nui-item]').forEach((element, index) => {
    element.getBoundingClientRect = () => ({
      top: index * height, bottom: (index + 1) * height, left: 0, right: 300, width: 300, height,
      x: 0, y: index * height, toJSON: () => ({}),
    }) as DOMRect;
  });
}

async function drag(type: string, target: Element, transfer: TestDataTransfer, clientY = 0) {
  await act(async () => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    target.dispatchEvent(event);
  });
}

function list(props: Partial<ListReaderProps<Ticket>> = {}) {
  return (
    <ListReader<Ticket>
      items={TICKETS}
      row={(ticket) => <Row title={ticket.title} />}
      reader={(ticket) => <article id="reader">{ticket.title}</article>}
      {...props}
    />
  );
}

/** A page that keeps its own order: `onReorder` saves the new ids into its state (or fails). */
function Page({ save, extra }: {
  save?: (change: ReorderChange<Ticket>) => void | Promise<unknown>;
  extra?: Partial<ListReaderProps<Ticket>>;
}) {
  const [items, setItems] = useState(TICKETS);
  return list({
    items,
    reorder: {
      onReorder: (change) => {
        const result = save?.(change);
        if (result) return result;
        setItems(change.ids.map((id) => TICKETS.find((ticket) => ticket.id === id)!));
        return undefined;
      },
    },
    ...extra,
  });
}

test('dropIndex: the index an item lands at, before or after another', () => {
  assert.equal(dropIndex(0, 2, 'after'), 2);
  assert.equal(dropIndex(0, 2, 'before'), 1);
  assert.equal(dropIndex(3, 0, 'before'), 0);
  assert.equal(dropIndex(3, 1, 'after'), 2);
  assert.equal(dropIndex(1, 1, 'after'), 1, 'its own place');
  assert.equal(dropIndex(1, 2, 'before'), 1, 'just after itself');
});

test('reorder is off unless the list asks for it: rows render as before', async () => {
  await mount(list());
  const first = row('a');
  assert.equal(first.getAttribute('draggable'), null);
  assert.equal(first.getAttribute('data-reorder'), null);
  assert.equal(first.getAttribute('aria-describedby'), null);
  assert.equal(q('.nui-reorder-live'), null, 'no live region');
  await focus(first);
  await altKey('ArrowDown');
  assert.deepEqual(order(), ['a', 'b', 'c', 'd']);
});

test('Alt and an arrow key move the focused row, say where it went and keep focus on it', async () => {
  const changes: ReorderChange<Ticket>[] = [];
  await mount(<Page save={(change) => { changes.push(change); }} />);
  const first = row('a');
  assert.equal(first.getAttribute('draggable'), 'true');
  const hint = doc.getElementById(first.getAttribute('aria-describedby')!);
  assert.equal(hint?.textContent, REORDER_WORDS.hint.en);

  await focus(first);
  await altKey('ArrowDown');
  assert.deepEqual(order(), ['b', 'a', 'c', 'd'], 'shown at once (the page saved nothing)');
  assert.equal(changes.length, 1);
  assert.deepEqual({ ...changes[0], item: changes[0]!.item.id }, { item: 'a', id: 'a', from: 0, to: 1, ids: ['b', 'a', 'c', 'd'] });
  assert.equal(live(), 'Moved to position 2 of 4.');
  assert.equal(doc.activeElement, row('a'), 'focus stays on the moved row');

  await altKey('End');
  assert.deepEqual(order(), ['b', 'c', 'd', 'a']);
  assert.equal(live(), 'Moved to position 4 of 4.');
  await altKey('ArrowDown');
  assert.equal(changes.length, 2, 'past the end does nothing');
  await altKey('Home');
  assert.deepEqual(order(), ['a', 'b', 'c', 'd']);
  assert.equal(changes.at(-1)!.to, 0);
  assert.equal(doc.activeElement, row('a'));
});

test('a page that saves the order into its own state shows that order', async () => {
  await mount(<Page />);
  await focus(row('c'));
  await altKey('ArrowUp');
  assert.deepEqual(order(), ['a', 'c', 'b', 'd']);
  await altKey('ArrowUp');
  assert.deepEqual(order(), ['c', 'a', 'b', 'd']);
  // Plain arrows still move the cursor, never the row.
  await act(async () => {
    doc.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  assert.deepEqual(order(), ['c', 'a', 'b', 'd']);
});

test('pointer drag: the row under the pointer shows where it lands, a drop moves it', async () => {
  const changes: ReorderChange<Ticket>[] = [];
  await mount(<Page save={(change) => { changes.push(change); }} />);
  layoutRows();
  const transfer = new TestDataTransfer();
  await drag('dragstart', row('a'), transfer);
  assert.equal(transfer.getData(REORDER_DRAG_TYPE), 'a');
  assert.equal(transfer.effectAllowed, 'move');
  assert.equal(row('a').getAttribute('data-dragging'), '');

  await drag('dragover', row('c'), transfer, 110); // the lower half of the third row (80 to 120)
  assert.equal(row('c').getAttribute('data-drop'), 'after');
  assert.equal(transfer.dropEffect, 'move');
  await drag('dragover', row('c'), transfer, 90); // its upper half
  assert.equal(row('c').getAttribute('data-drop'), 'before');
  await drag('dragover', row('b'), transfer, 45); // just after itself: no line
  assert.equal(q('[data-drop]'), null);

  await drag('dragover', row('c'), transfer, 110);
  await drag('drop', row('c'), transfer, 110);
  await drag('dragend', row('a'), transfer);
  assert.deepEqual(order(), ['b', 'c', 'a', 'd']);
  assert.deepEqual(changes.map((change) => [change.id, change.from, change.to]), [['a', 0, 2]]);
  assert.equal(q('[data-drop]'), null, 'the line goes with the drop');
  assert.equal(q('[data-dragging]'), null);
});

test('a drag from elsewhere is not a reorder', async () => {
  const changes: ReorderChange<Ticket>[] = [];
  await mount(<Page save={(change) => { changes.push(change); }} />);
  layoutRows();
  const transfer = new TestDataTransfer();
  await drag('dragover', row('c'), transfer, 110);
  await drag('drop', row('c'), transfer, 110);
  assert.equal(q('[data-drop]'), null);
  assert.equal(changes.length, 0);
});

test('a rejected save puts the old order back and the toast says why', async () => {
  let fail!: (error: unknown) => void;
  await mount(<Page save={() => new Promise((_resolve, reject) => { fail = reject; })} />);
  await focus(row('a'));
  await altKey('ArrowDown');
  assert.deepEqual(order(), ['b', 'a', 'c', 'd'], 'optimistic while it saves');
  await act(async () => { fail(new ActionError('The deck is locked.')); });
  assert.deepEqual(order(), ['a', 'b', 'c', 'd']);
  const toast = q('.nui-toast')!;
  assert.equal(toast.getAttribute('data-tone'), 'danger');
  assert.equal(q('.nui-toast-words')!.textContent, REORDER_WORDS.failed.en);
  assert.equal(q('.nui-toast-reason')!.textContent, 'The deck is locked.');
});

test('a save that resolves keeps the new order until the page changes its own', async () => {
  let done!: () => void;
  await mount(<Page save={() => new Promise<void>((resolve) => { done = resolve; })} />);
  await focus(row('d'));
  await altKey('ArrowUp');
  await act(async () => { done(); });
  assert.deepEqual(order(), ['a', 'b', 'd', 'c'], 'the page kept no order of its own: the new one stays');
});

test('pending and disabled rows do not move, canReorder picks the rows that do, groupBy turns reorder off', async () => {
  await mount(<Page extra={{ isPending: (ticket) => ticket.id === 'b', isDisabled: (ticket) => ticket.id === 'c' }} />);
  assert.equal(row('a').getAttribute('draggable'), 'true');
  assert.equal(row('b').getAttribute('draggable'), null);
  assert.equal(row('c').getAttribute('draggable'), null);
  assert.equal(row('b').getAttribute('data-reorder'), '', 'still a place to drop');

  await mount(list({ reorder: { onReorder: () => undefined, canReorder: (ticket) => ticket.id !== 'd' } }));
  assert.equal(row('d').getAttribute('draggable'), null);
  assert.equal(row('a').getAttribute('draggable'), 'true');

  await mount(list({ reorder: { onReorder: () => undefined },
    groupBy: (ticket) => (ticket.id < 'c' ? { id: 'one', label: 'First' } : { id: 'two', label: 'Second' }) }));
  assert.equal(row('a').getAttribute('draggable'), null);
  assert.equal(row('a').getAttribute('data-reorder'), null);
});

test('a drag-out list keeps its drag data when rows also reorder', async () => {
  let dragged: string[] = [];
  await mount(list({
    draggable: true, onDragStart: (items) => { dragged = items.map((item) => item.id); },
    reorder: { onReorder: () => undefined },
  }));
  const transfer = new TestDataTransfer();
  await drag('dragstart', row('b'), transfer);
  assert.deepEqual(dragged, ['b']);
  assert.equal(transfer.getData(REORDER_DRAG_TYPE), 'b');
  assert.equal(transfer.effectAllowed, 'copyMove', 'the drag-out keeps its effect');
});

test('tiles move with all four arrows', async () => {
  await mount(<Page extra={{ layout: 'tiles', renderTile: (ticket) => ({ title: ticket.title }) }} />);
  await focus(row('a'));
  await altKey('ArrowRight');
  assert.deepEqual(order(), ['b', 'a', 'c', 'd']);
  await altKey('ArrowLeft');
  assert.deepEqual(order(), ['a', 'b', 'c', 'd']);
});

/** A horizontal rail outside ListReader (a slide strip). */
function Rail({ onReorder }: { onReorder: (change: ReorderChange<Ticket>) => void }) {
  const [items, setItems] = useState(TICKETS);
  const reorder = useReorder({
    items, getId: (ticket) => ticket.id, orientation: 'horizontal',
    onReorder: (change) => {
      onReorder(change);
      setItems(change.ids.map((id) => TICKETS.find((ticket) => ticket.id === id)!));
    },
  });
  return (
    <nav>
      {reorder.items.map((ticket) => (
        <button key={ticket.id} type="button" data-nui-item={ticket.id} {...reorder.getItemProps(ticket.id)}>{ticket.title}</button>
      ))}
      {reorder.announcer}
    </nav>
  );
}

test('useReorder on its own: a horizontal rail moves with Left and Right only', async () => {
  const changes: ReorderChange<Ticket>[] = [];
  await mount(<Rail onReorder={(change) => changes.push(change)} />);
  await focus(row('b'));
  await altKey('ArrowDown');
  assert.deepEqual(order(), ['a', 'b', 'c', 'd'], 'Up and Down do not move a horizontal item');
  await altKey('ArrowRight');
  assert.deepEqual(order(), ['a', 'c', 'b', 'd']);
  assert.equal(doc.activeElement, row('b'));
  assert.equal(live(), 'Moved to position 3 of 4.');
  assert.equal(changes.length, 1);
});
