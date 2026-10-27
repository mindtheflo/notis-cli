import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useAnimatedOrder } from './useAnimatedOrder';

const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'http://localhost/space' });
for (const [key, value] of Object.entries({
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const doc = dom.window.document;

// Layout stand-in: rows stack 48px apart in DOM order; a row with data-col sits in a 300px-wide column.
let reduced = false;
Object.defineProperty(dom.window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
});
const Proto = dom.window.HTMLElement.prototype as unknown as {
  getBoundingClientRect(this: HTMLElement): DOMRect;
  animate(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation;
};
Proto.getBoundingClientRect = function rect(this: HTMLElement) {
  if (!this.hasAttribute('data-nui-item')) return { left: 0, top: 0, width: 600, height: 600 } as DOMRect;
  const column = Number(this.getAttribute('data-col') ?? 0);
  const siblings = [...this.parentElement!.children].filter((row) => (row.getAttribute('data-col') ?? '0') === String(column));
  return { left: column * 300, top: siblings.indexOf(this) * 48, width: 300, height: 48 } as DOMRect;
};
let calls: Array<{ id: string; frames: Keyframe[] }> = [];
let cancelled = 0;
Proto.animate = function animate(this: HTMLElement, frames: Keyframe[]) {
  calls.push({ id: this.getAttribute('data-nui-item')!, frames });
  return { cancel() { cancelled += 1; }, onfinish: null } as unknown as Animation;
};

function Rows({ rows, reset = 'list', content }: { rows: Array<[string, number?]>; reset?: string; content?: unknown }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useAnimatedOrder(ref, rows.map(([id, col]) => `${id}:${col ?? 0}`).join(','), reset, content ?? rows);
  return <div ref={ref}>{rows.map(([id, col]) => <div key={id} data-nui-item={id} data-col={col ?? 0} />)}</div>;
}

let root: Root | null = null;
async function render(node: React.ReactNode) {
  if (!root) {
    doc.body.innerHTML = '<div id="root"></div>';
    root = createRoot(doc.getElementById('root')!);
  }
  await act(async () => { root!.render(node); });
}
async function reset() {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  calls = [];
  cancelled = 0;
  reduced = false;
}
const moves = () => Object.fromEntries(calls.map((call) => [call.id, call.frames[0]!.transform ?? `opacity ${call.frames[0]!.opacity}`]));

test('the first rows never move; a re-sort slides each moved row from where it was', async () => {
  await reset();
  await render(<Rows rows={[]} />);
  await render(<Rows rows={[['a'], ['b'], ['c']]} />);
  assert.deepEqual(calls, []);
  await render(<Rows rows={[['c'], ['a'], ['b']]} />);
  assert.deepEqual(moves(), { c: 'translate(0px, 96px)', a: 'translate(0px, -48px)', b: 'translate(0px, -48px)' });
});

test('a new row fades in, and the rows under a leaving row slide up to close its gap', async () => {
  await reset();
  await render(<Rows rows={[['a'], ['b'], ['c']]} />);
  await render(<Rows rows={[['n'], ['a'], ['b'], ['c']]} />);
  assert.equal(moves().n, 'opacity 0');
  calls = [];
  await render(<Rows rows={[['n'], ['b'], ['c']]} />);
  assert.deepEqual(moves(), { b: 'translate(0px, 48px)', c: 'translate(0px, 48px)' });
});

test('a row that only changes its id in place (a new row getting its real key) does not fade in again', async () => {
  await reset();
  await render(<Rows rows={[['a'], ['b']]} />);
  await render(<Rows rows={[['pending:1'], ['a'], ['b']]} />);
  calls = [];
  await render(<Rows rows={[['n'], ['a'], ['b']]} />);
  assert.deepEqual(calls, []);
});

test('board tiles move on both axes', async () => {
  await reset();
  await render(<Rows rows={[['a', 0], ['b', 0], ['c', 1]]} />);
  await render(<Rows rows={[['b', 0], ['a', 1], ['c', 1]]} />);
  assert.deepEqual(moves(), { b: 'translate(0px, 48px)', a: 'translate(-300px, 0px)', c: 'translate(0px, -48px)' });
});

test('no motion with reduced motion, or when the layout itself changes', async () => {
  await reset();
  reduced = true;
  await render(<Rows rows={[['a'], ['b']]} />);
  await render(<Rows rows={[['b'], ['a']]} />);
  assert.deepEqual(calls, []);
  reduced = false;
  await render(<Rows rows={[['a'], ['b']]} reset="tiles" />);
  assert.deepEqual(calls, [], 'a new layout re-measures only');
  await render(<Rows rows={[['b'], ['a']]} reset="tiles" />);
  assert.equal(calls.length, 2, 'then moves animate again');
});

test('new content in the same order lets a running move finish', async () => {
  await reset();
  await render(<Rows rows={[['a'], ['b']]} content={1} />);
  await render(<Rows rows={[['b'], ['a']]} content={2} />);
  assert.equal(calls.length, 2);
  await render(<Rows rows={[['b'], ['a']]} content={3} />);
  assert.equal(cancelled, 0);
});
