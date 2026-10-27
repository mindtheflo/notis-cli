import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { LIST_DRAG_TYPE } from '../list/ListReader';
import { boardStep } from '../list/useListKeys';
import { BoardView, type BoardViewProps } from './BoardView';
import { boardOrder, dropIndex, neighbourColumn, type BoardColumn } from './boardModel';
import { BOARD_WORDS } from './boardWords';
import { w } from '../../words';

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

async function press(key: string, extra: { shift?: boolean; meta?: boolean } = {}) {
  const init = { key, code: codeFor(key), shiftKey: !!extra.shift, metaKey: !!extra.meta, bubbles: true, cancelable: true, composed: true };
  const target = doc.activeElement ?? doc.body;
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', init));
    target.dispatchEvent(new dom.window.KeyboardEvent('keyup', init));
  });
}

async function click(element: Element) {
  const init = { bubbles: true, cancelable: true, button: 0 };
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('mousedown', init));
    element.dispatchEvent(new dom.window.MouseEvent('mouseup', init));
    element.dispatchEvent(new dom.window.MouseEvent('click', init));
  });
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

interface Deal { id: string; title: string; stage: string }
const COLUMNS: BoardColumn[] = [
  { id: 'lead', label: w('Lead', 'Piste') },
  { id: 'call', label: w('Call', 'Appel'), tone: 'info' },
  { id: 'won', label: w('Won', 'Gagné'), tone: 'success' },
];
const DEALS: Deal[] = [
  { id: 'a', title: 'Acme', stage: 'lead' },
  { id: 'b', title: 'Bolt', stage: 'lead' },
  { id: 'c', title: 'Cove', stage: 'call' },
];

let root: Root | null = null;

async function mount(node: () => ReactNode, locale: 'en' | 'fr' = 'en') {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="root"></div>';
  dom.window.localStorage.clear();
  dom.window.history.replaceState(null, '', '/space');
  const engine = new KeyboardEngineCore();
  root = createRoot(doc.getElementById('root')!);
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale={locale} platform="mac" engine={engine} document={doc} strict>{node()}</KeyboardEngine>);
  });
}

type Move = [string[], string, number | undefined];

/** A page that owns its deals and moves them on onMove, as a Space would (optimistically). */
function Page({ moves, props = {} }: { moves: Move[]; props?: Partial<BoardViewProps<Deal>> }) {
  const [deals, setDeals] = useState(DEALS);
  return (
    <BoardView<Deal>
      items={deals}
      columns={COLUMNS}
      getColumn={(deal) => deal.stage}
      renderTile={(deal) => ({ title: deal.title })}
      reader={(deal, ctx) => <article id="reader" data-mode={ctx.mode}>{deal.title}</article>}
      onMove={(ids, to, index) => {
        moves.push([ids, to, index]);
        setDeals((previous) => {
          const moved = previous.filter((deal) => ids.includes(deal.id)).map((deal) => ({ ...deal, stage: to }));
          const rest = previous.filter((deal) => !ids.includes(deal.id));
          if (index === undefined) return [...rest, ...moved];
          const lane = rest.filter((deal) => deal.stage === to);
          const before = lane[index];
          const at = before ? rest.indexOf(before) : rest.length;
          return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
        });
      }}
      {...props}
    />
  );
}

const q = (selector: string) => doc.querySelector<HTMLElement>(selector);
const cursorId = () => q('.nui-tile[data-cursor]')?.getAttribute('data-nui-item') ?? null;
const laneOf = (column: string) => [...doc.querySelectorAll(`.nui-board-col[data-column="${column}"] .nui-tile`)]
  .map((tile) => tile.getAttribute('data-nui-item'));

// ---- pure ----

test('board model: column order, the neighbour column and the drop index', () => {
  assert.deepEqual(boardOrder(DEALS.slice().reverse(), COLUMNS, (deal) => deal.stage).map((deal) => deal.id), ['b', 'a', 'c']);
  assert.deepEqual(boardOrder([...DEALS, { id: 'z', title: 'Gone', stage: 'lost' }], COLUMNS, (deal) => deal.stage)
    .map((deal) => deal.id), ['a', 'b', 'c'], 'an unknown column is not shown');
  assert.equal(neighbourColumn(COLUMNS, 'lead', 1), 'call');
  assert.equal(neighbourColumn(COLUMNS, 'call', 1), 'won', 'an empty column is still a neighbour');
  assert.equal(neighbourColumn(COLUMNS, 'lead', -1), null);
  assert.equal(neighbourColumn(COLUMNS, 'lost', 1), null);
  const tiles = [{ id: 'a', top: 0, height: 100 }, { id: 'b', top: 112, height: 100 }];
  assert.deepEqual(dropIndex(tiles, 10), { index: 0, before: 'a' });
  assert.deepEqual(dropIndex(tiles, 120), { index: 1, before: 'b' });
  assert.deepEqual(dropIndex(tiles, 400), { index: 2, before: null });
  assert.deepEqual(dropIndex([], 0), { index: 0, before: null });
});

test('boardStep: Up/Down stay in the column, Left/Right skip empty columns and keep the index', () => {
  const lanes = [['a', 'b'], [], ['c']];
  assert.equal(boardStep(lanes, 'a', 'down'), 'b');
  assert.equal(boardStep(lanes, 'b', 'down'), null, 'the bottom of a column holds');
  assert.equal(boardStep(lanes, 'a', 'up'), null);
  assert.equal(boardStep(lanes, 'b', 'right'), 'c', 'the empty column is skipped, the index clamps');
  assert.equal(boardStep(lanes, 'c', 'left'), 'a');
  assert.equal(boardStep(lanes, 'c', 'right'), null);
  assert.equal(boardStep(lanes, null, 'right'), 'a');
});

// ---- rendered ----

test('columns: one per stage with its label, count and tone dot; an empty column says so', async () => {
  await mount(() => <Page moves={[]} />);
  const columns = [...doc.querySelectorAll('.nui-board-col')];
  assert.deepEqual(columns.map((column) => column.getAttribute('data-column')), ['lead', 'call', 'won']);
  assert.deepEqual(columns.map((column) => column.getAttribute('aria-label')), ['Lead', 'Call', 'Won']);
  assert.ok(q('.nui-lr-scroll.nui-board'), 'the board is the list scroll');
  assert.deepEqual(laneOf('lead'), ['a', 'b']);
  assert.deepEqual(laneOf('call'), ['c']);
  assert.equal(q('.nui-board-col[data-column="lead"] .nui-board-dot'), null, 'no tone, no dot');
  assert.equal(q('.nui-board-col[data-column="call"] .nui-board-dot')!.getAttribute('data-tone'), 'info');
  assert.equal(q('.nui-board-col[data-column="won"] .nui-board-empty')!.textContent, 'No items');
  assert.equal(q('.nui-tile[data-nui-item="a"] .nui-tile-title')!.textContent, 'Acme');
  assert.equal(q('.nui-tile[data-nui-item="a"]')!.getAttribute('draggable'), 'true', 'tiles drag when the board moves');
  assert.equal(q('#reader'), null, 'nothing opens on its own');
});

test('select all: the board toolbar checkbox selects every tile in every column', async () => {
  await mount(() => <Page moves={[]} props={{ actions: ['archive'], handlers: { archive: () => {} } }} />);
  await click(q('[data-part="select-all"]')!);
  assert.equal(doc.querySelectorAll('.nui-tile[data-selected]').length, 3);
  assert.equal(q('[data-part="select-all"]')!.getAttribute('aria-checked'), 'true');
});

test('a board without onMove only reads: tiles do not drag and Shift+Right moves nothing', async () => {
  await mount(() => <Page moves={[]} props={{ onMove: undefined }} />);
  assert.equal(q('.nui-tile[data-nui-item="a"]')!.getAttribute('draggable'), null);
  await press('ArrowDown');
  await press('ArrowRight', { shift: true });
  assert.deepEqual(laneOf('lead'), ['a', 'b']);
});

test('keys: arrows move the cursor within and across columns; Enter opens, Esc closes', async () => {
  await mount(() => <Page moves={[]} />);
  await press('ArrowDown');
  assert.equal(cursorId(), 'a', 'the first key lands on the first tile');
  await press('ArrowDown');
  assert.equal(cursorId(), 'b');
  await press('ArrowDown');
  assert.equal(cursorId(), 'b', 'the bottom of a column holds');
  await press('ArrowRight');
  assert.equal(cursorId(), 'c', 'across to the same place or the last tile');
  await press('ArrowRight');
  assert.equal(cursorId(), 'c', 'the empty column is skipped; the edge holds');
  await press('ArrowLeft');
  assert.equal(cursorId(), 'a');
  await press('ArrowUp');
  assert.equal(cursorId(), 'a');
  await press('j');
  assert.equal(cursorId(), 'b', 'J moves to the next tile');
  await press('Enter');
  assert.equal(q('#reader')!.textContent, 'Bolt');
  assert.equal(q('.nui-tile[data-nui-item="b"]')!.hasAttribute('data-open'), true);
  await press('Escape');
  assert.equal(q('#reader'), null);
  await click(q('.nui-tile[data-nui-item="c"]')!);
  assert.equal(q('#reader')!.textContent, 'Cove', 'a click opens too');
});

test('keyboard move: Shift+Right and Shift+Left call onMove; the cursor stays on the moved tile', async () => {
  const moves: Move[] = [];
  await mount(() => <Page moves={moves} />);
  await press('ArrowDown');
  await press('ArrowDown');
  await press('ArrowRight', { shift: true });
  assert.deepEqual(moves, [[['b'], 'call', undefined]]);
  await settle();
  assert.deepEqual(laneOf('call'), ['c', 'b']);
  assert.equal(cursorId(), 'b', 'the cursor follows the tile');
  await press('ArrowRight', { shift: true });
  assert.deepEqual(moves.at(-1), [['b'], 'won', undefined], 'into an empty column');
  await settle();
  assert.deepEqual(laneOf('won'), ['b']);
  assert.equal(cursorId(), 'b');
  await press('ArrowRight', { shift: true });
  assert.equal(moves.length, 2, 'the last column holds');
  await press('ArrowLeft', { shift: true });
  assert.deepEqual(moves.at(-1), [['b'], 'call', undefined]);
});

test('keyboard move: a selection moves together in list order and stays selected', async () => {
  const moves: Move[] = [];
  await mount(() => <Page moves={moves} />);
  await press('ArrowDown');
  await press('x');
  await press('ArrowDown');
  await press('x');
  await press('ArrowRight', { shift: true });
  assert.deepEqual(moves, [[['a', 'b'], 'call', undefined]]);
  await settle();
  assert.deepEqual(laneOf('call'), ['c', 'a', 'b']);
  const selected = [...doc.querySelectorAll('.nui-tile[data-selected]')].map((tile) => tile.getAttribute('data-nui-item'));
  assert.deepEqual(selected, ['a', 'b']);
});

test('M: Move to opens a menu of the columns, with the current one checked; a pick calls onMove', async () => {
  const moves: Move[] = [];
  await mount(() => <Page moves={moves} />);
  await press('ArrowDown');
  await press('m');
  await settle();
  const items = [...doc.querySelectorAll('[role="menu"] [data-nui-menu-item]')];
  assert.deepEqual(items.map((item) => item.textContent), ['Lead', 'Call', 'Won']);
  assert.equal(items[0]!.getAttribute('aria-checked'), 'true');
  await click(items[2]!);
  assert.deepEqual(moves, [[['a'], 'won', undefined]]);
  await settle();
  assert.deepEqual(laneOf('won'), ['a']);
  assert.equal(cursorId(), 'a');
});

test('drag and drop: a drop line shows where the tile lands, and the drop calls onMove with the index', async () => {
  const moves: Move[] = [];
  await mount(() => <Page moves={moves} />);
  const tops: Record<string, number> = { a: 0, b: 112, c: 0 };
  for (const id of Object.keys(tops)) {
    q(`[data-nui-item="${id}"]`)!.getBoundingClientRect = () => ({ top: tops[id]!, height: 100 } as DOMRect);
  }
  const data = new Map<string, string>();
  const transfer = {
    setData: (key: string, value: string) => { data.set(key, value); },
    getData: (key: string) => data.get(key) ?? '',
    get types() { return [...data.keys()]; },
    effectAllowed: '', dropEffect: '',
  };
  const fire = async (type: string, target: Element, clientY = 0) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    Object.defineProperty(event, 'clientY', { value: clientY });
    await act(async () => { target.dispatchEvent(event); });
    return event;
  };
  await fire('dragstart', q('[data-nui-item="a"]')!);
  assert.equal(data.get(LIST_DRAG_TYPE), JSON.stringify(['a']));
  const body = q('.nui-board-col[data-column="call"] .nui-board-body')!;
  const over = await fire('dragover', body, 10);
  assert.equal(over.defaultPrevented, true, 'the column takes the drop');
  assert.equal(q('.nui-tile[data-nui-item="c"]')!.hasAttribute('data-drop-before'), true, 'the line shows above Cove');
  await fire('dragover', body, 400);
  assert.equal(q('[data-drop-before]'), null);
  assert.equal(body.getAttribute('data-drop'), 'end', 'past the last tile the line shows at the end');
  await fire('drop', body, 10);
  assert.deepEqual(moves, [[['a'], 'call', 0]]);
  await settle();
  assert.deepEqual(laneOf('call'), ['a', 'c']);
  assert.equal(q('[data-drop]'), null, 'the line goes after the drop');
  // A drop that leaves its column as it was does nothing.
  await fire('dragstart', q('[data-nui-item="b"]')!);
  await fire('drop', q('.nui-board-col[data-column="lead"] .nui-board-body')!, 400);
  assert.equal(moves.length, 1);
});

test('French: column labels, the empty column and the move shortcuts', async () => {
  await mount(() => <Page moves={[]} />, 'fr');
  const columns = [...doc.querySelectorAll('.nui-board-col')].map((column) => column.getAttribute('aria-label'));
  assert.deepEqual(columns, ['Piste', 'Appel', 'Gagné']);
  assert.equal(q('.nui-board-col[data-column="won"] .nui-board-empty')!.textContent, 'Aucun élément');
  assert.equal(BOARD_WORDS.moveRight.fr, 'Déplacer vers la colonne de droite');
  assert.equal(BOARD_WORDS.moveLeft.fr, 'Déplacer vers la colonne de gauche');
  assert.equal(BOARD_WORDS.moved.fr, 'Déplacé vers {column}.');
  await press('ArrowDown');
  await press('m');
  await settle();
  const items = [...doc.querySelectorAll('[role="menu"] [data-nui-menu-item]')].map((item) => item.textContent);
  assert.deepEqual(items, ['Piste', 'Appel', 'Gagné']);
});

test('the move toast names the column when onMove returns an Undo', async () => {
  let undone = false;
  await mount(() => <Page moves={[]} props={{ onMove: () => () => { undone = true; } }} />);
  await press('ArrowDown');
  await press('ArrowRight', { shift: true });
  await settle();
  assert.equal(q('.nui-toast-words')!.textContent, 'Moved to Call.');
  await click(q('.nui-toast-btn')!);
  await settle();
  assert.equal(undone, true);
});

test.after(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
});

test('menu and drag moves keep the selection selected, as Shift+Left/Right does', async () => {
  const moves: Move[] = [];
  await mount(() => <Page moves={moves} />);
  const selected = () => [...doc.querySelectorAll('.nui-tile[data-selected]')].map((tile) => tile.getAttribute('data-nui-item'));
  await press('ArrowDown');
  await press('x');
  await press('ArrowDown');
  await press('x');
  await press('m');
  await settle();
  await click([...doc.querySelectorAll('[role="menu"] [data-nui-menu-item]')][2]!);
  assert.deepEqual(moves, [[['a', 'b'], 'won', undefined]]);
  await settle();
  assert.deepEqual(laneOf('won'), ['a', 'b']);
  assert.deepEqual(selected(), ['a', 'b'], 'a menu move keeps the selection');
  const data = new Map<string, string>();
  const transfer = {
    setData: (key: string, value: string) => { data.set(key, value); },
    getData: (key: string) => data.get(key) ?? '',
    get types() { return [...data.keys()]; },
    effectAllowed: '', dropEffect: '',
  };
  const fire = async (type: string, target: Element) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    Object.defineProperty(event, 'clientY', { value: 400 });
    await act(async () => { target.dispatchEvent(event); });
  };
  await fire('dragstart', q('[data-nui-item="a"]')!);
  await fire('drop', q('.nui-board-col[data-column="call"] .nui-board-body')!);
  assert.deepEqual(moves[1]![0], ['a', 'b'], 'the drag carries the selection');
  await settle();
  assert.deepEqual(laneOf('call'), ['c', 'a', 'b']);
  assert.deepEqual(selected(), ['a', 'b'], 'a drop keeps the selection');
});

test('columns follow the page: a new label or tone after mount shows at once', async () => {
  let relabel: (() => void) | null = null;
  function Relabel() {
    const [columns, setColumns] = useState(COLUMNS);
    relabel = () => setColumns([{ id: 'lead', label: w('Prospect', 'Prospect'), tone: 'warning' }, ...COLUMNS.slice(1)]);
    return <Page moves={[]} props={{ columns }} />;
  }
  await mount(() => <Relabel />);
  assert.equal(q('.nui-board-col[data-column="lead"]')!.getAttribute('aria-label'), 'Lead');
  await act(async () => { relabel!(); });
  assert.equal(q('.nui-board-col[data-column="lead"]')!.getAttribute('aria-label'), 'Prospect');
  assert.equal(q('.nui-board-col[data-column="lead"] .nui-board-dot')!.getAttribute('data-tone'), 'warning');
  assert.deepEqual(laneOf('lead'), ['a', 'b']);
});

test('a tile whose stage matches no column is not shown on the board', async () => {
  await mount(() => <Page moves={[]} props={{ items: [...DEALS, { id: 'd', title: 'Dune', stage: 'archived' }] }} />);
  assert.deepEqual([...doc.querySelectorAll('.nui-tile')].map((tile) => tile.getAttribute('data-nui-item')), ['a', 'b', 'c']);
  assert.equal(q('[data-nui-item="d"]'), null);
});
