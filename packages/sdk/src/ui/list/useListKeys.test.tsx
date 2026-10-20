import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { useListKeys } from './useListKeys';

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => {
    root!.render(
      <KeyboardEngine host="preview" locale="en" platform="mac" engine={new KeyboardEngineCore()} document={doc} strict>
        {node}
      </KeyboardEngine>,
    );
  });
}

/** A key as a browser sends it; an Enter nobody took presses a focused button, as a browser does. */
async function press(key: string) {
  const init = { key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, composed: true };
  const target = doc.activeElement ?? doc.body;
  let untaken = true;
  await act(async () => {
    untaken = target.dispatchEvent(new dom.window.KeyboardEvent('keydown', init));
    target.dispatchEvent(new dom.window.KeyboardEvent('keyup', init));
  });
  if (key === 'Enter' && untaken && target instanceof dom.window.HTMLButtonElement) {
    await act(async () => { (target as HTMLButtonElement).click(); });
  }
}

const IDS = ['a', 'b', 'c'];
let opened: string[] = [];
let filterPresses = 0;

function Rows() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const { getRowProps } = useListKeys({ ids: IDS, cursor, setCursor, onOpen: (id) => { opened.push(id); }, containerRef });
  return (
    <div ref={containerRef} role="listbox" aria-label="Tickets" data-notis-engine-list="">
      {IDS.map((id) => <div key={id} {...getRowProps(id)}>{`Ticket ${id}`}</div>)}
    </div>
  );
}

/** A filter above the list and an open item's reader beside it; `inPane` puts the filter and the list in one pane. */
function Page({ inPane = false }: { inPane?: boolean }) {
  const listArea = (
    <>
      <button type="button" id="filter" aria-pressed="false" onClick={() => { filterPresses += 1; }}>Open only</button>
      <Rows />
    </>
  );
  return (
    <>
      {inPane ? <div id="outer" tabIndex={-1} data-notis-escape-owned="">{listArea}</div> : listArea}
      <div id="reader" tabIndex={-1} data-notis-escape-owned="">
        <button type="button" id="edit">Edit</button>
      </div>
    </>
  );
}

const focused = () => doc.activeElement?.getAttribute('data-nui-item') ?? doc.activeElement?.id ?? null;
const cursorId = () => doc.querySelector('[data-cursor]')?.getAttribute('data-nui-item') ?? null;
const focus = (selector: string) => act(async () => { doc.querySelector<HTMLElement>(selector)!.focus(); });

test('J from a filter takes focus to the cursor row, so Enter opens the row, never the filter; the reader keeps its focus (follow-up E1)', async () => {
  opened = [];
  filterPresses = 0;
  await mount(<Page />);
  await focus('#filter');
  await press('j');
  assert.equal(cursorId(), 'a');
  assert.equal(focused(), 'a', 'focus leaves the filter for the cursor row');
  await press('Enter');
  assert.deepEqual(opened, ['a'], 'Enter opens the cursor row');
  assert.equal(filterPresses, 0, 'Enter does not press the filter');

  // Focus in the open item's reader stays there: only the cursor moves.
  await focus('#edit');
  await press('j');
  assert.equal(cursorId(), 'b');
  assert.equal(focused(), 'edit');

  // A list inside a pane (a list in a reader): its own filter is not another pane, so focus goes to the row.
  await mount(<Page inPane />);
  await focus('#filter');
  await press('j');
  assert.equal(focused(), 'a');
});
