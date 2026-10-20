import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { Panels, usePanels, type PanelsProps } from './Panels';

/**
 * The one-pane switch: jsdom has no layout and no container queries, so the Panels width
 * comes from a fake ResizeObserver and `data-mode` (the JS mirror of the CSS rule) is what
 * the tests read.
 */
async function harness(props: Partial<PanelsProps> & { width?: number; storedWidth?: string; locale?: 'en' | 'fr' } = {}) {
  const { width: initialWidth = 1000, storedWidth, locale = 'en', ...panelProps } = props;
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/space' });
  let width = initialWidth;
  const observers: Array<() => void> = [];
  class FakeResizeObserver {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {}
    disconnect() {}
  }
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Element: dom.window.Element,
    KeyboardEvent: dom.window.KeyboardEvent, ResizeObserver: FakeResizeObserver, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  if (storedWidth !== undefined) dom.window.localStorage.setItem('notis:panels:notes', storedWidth);
  dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const w = this.classList.contains('nui-panels') ? width : 0;
    return { width: w, height: 600, top: 0, left: 0, right: w, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };

  const seen: Array<ReturnType<typeof usePanels>> = [];
  function Reader() {
    const state = usePanels();
    seen.push(state);
    return <article id="reader" data-seen-mode={state.mode} data-seen-width={state.readerWidth}>Item</article>;
  }
  let backs = 0;
  let current: Partial<PanelsProps> = { reader: <Reader />, ...panelProps };
  const engine = new KeyboardEngineCore();
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = async (next: Partial<PanelsProps> = {}) => {
    current = { ...current, ...next };
    await act(async () => root.render(
      <KeyboardEngine host="preview" locale={locale} engine={engine} document={dom.window.document} strict>
        <Panels list={<ul id="list"><li>Row</li></ul>} reader={null} {...current} />
      </KeyboardEngine>,
    ));
  };
  await render();
  const q = <T extends Element = HTMLElement>(selector: string) => dom.window.document.querySelector(selector) as T | null;

  return {
    seen,
    Reader,
    backs: () => backs,
    onBack: () => { backs += 1; },
    render,
    q,
    root: () => q('.nui-panels')!,
    mode: () => q('.nui-panels')!.getAttribute('data-mode'),
    readerVar: () => q('.nui-panels')!.style.getPropertyValue('--nui-panels-reader-w'),
    stored: () => dom.window.localStorage.getItem('notis:panels:notes'),
    resize: async (next: number) => {
      width = next;
      await act(async () => { for (const observer of observers) observer(); });
    },
    key: async (node: Element, key: string) => {
      const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      await act(async () => { node.dispatchEvent(event); });
      return event;
    },
    doubleClick: async (node: Element) => {
      await act(async () => { node.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true })); });
    },
    click: async (node: HTMLElement) => { await act(async () => { node.click(); }); },
    cleanup: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('list and reader sit side by side from 680px and switch to one pane below', async () => {
  const h = await harness({ width: 680 });
  try {
    assert.equal(h.mode(), 'split');
    assert.equal(h.q('.nui-panels-list')!.hasAttribute('inert'), false);
    await h.resize(679);
    assert.equal(h.mode(), 'stacked');
    // The open item covers the list: the list leaves the tab order and the accessibility tree.
    assert.equal(h.q('.nui-panels-list')!.hasAttribute('inert'), true);
    assert.equal(h.q('.nui-panels-list')!.getAttribute('aria-hidden'), 'true');
    await h.resize(900);
    assert.equal(h.mode(), 'split');
  } finally { await h.cleanup(); }
});

test('one pane with nothing open shows the list, live', async () => {
  const h = await harness({ width: 500, reader: null });
  try {
    assert.equal(h.mode(), 'stacked');
    assert.equal(h.q('.nui-panels-reader'), null);
    assert.equal(h.q('.nui-panels-list')!.hasAttribute('inert'), false);
    assert.equal(h.root().hasAttribute('data-reader-open'), false);
  } finally { await h.cleanup(); }
});

test('an unmeasured container (a hidden Space) keeps its last mode', async () => {
  const h = await harness({ width: 500 });
  try {
    assert.equal(h.mode(), 'stacked');
    await h.resize(0);
    assert.equal(h.mode(), 'stacked');
  } finally { await h.cleanup(); }
});

test('the mode settles at the first measure, and a frame later without a width; never split before a narrow measure', async () => {
  const h = await harness({ width: 500 });
  try {
    // The first committed state the reader saw was unsettled (split by default), then the measure settled it stacked.
    assert.deepEqual({ mode: h.seen[0]!.mode, settled: h.seen[0]!.settled }, { mode: 'split', settled: false });
    assert.equal(h.seen.some((state) => state.settled && state.mode === 'split'), false);
    assert.deepEqual({ mode: h.seen.at(-1)!.mode, settled: h.seen.at(-1)!.settled }, { mode: 'stacked', settled: true });
  } finally { await h.cleanup(); }
  const hidden = await harness({ width: 0 });
  try {
    assert.equal(hidden.seen.at(-1)!.settled, false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    assert.deepEqual({ mode: hidden.seen.at(-1)!.mode, settled: hidden.seen.at(-1)!.settled }, { mode: 'split', settled: true });
  } finally { await hidden.cleanup(); }
});

test('other minimums move the threshold and add their own container rule', async () => {
  const h = await harness({ width: 700, listMin: 360, readerMin: 400 });
  try {
    assert.equal(h.mode(), 'stacked');
    assert.equal(h.root().hasAttribute('data-custom-split'), true);
    const css = h.q('.nui-panels > style')!.textContent ?? '';
    assert.match(css, /@container nui-panels-\S+ \(min-width: 760px\)/);
    await h.resize(760);
    assert.equal(h.mode(), 'split');
  } finally { await h.cleanup(); }
});

test('the reader reads its Panels through usePanels; outside one it gets the defaults', async () => {
  const h = await harness({ width: 1000 });
  try {
    assert.equal(h.q('#reader')!.getAttribute('data-seen-mode'), 'split');
    assert.equal(h.q('#reader')!.getAttribute('data-seen-width'), '420');
    assert.equal(h.seen.at(-1)!.readerOpen, true);
    await h.resize(600);
    assert.equal(h.q('#reader')!.getAttribute('data-seen-mode'), 'stacked');
  } finally { await h.cleanup(); }

  const dom = new JSDOM('<div id="root"></div>');
  const saved = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let outside: ReturnType<typeof usePanels> | null = null;
  function Probe() { outside = usePanels(); return null; }
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(<Probe />));
    assert.deepEqual({ mode: outside!.mode, readerOpen: outside!.readerOpen, readerWidth: outside!.readerWidth, settled: outside!.settled }, { mode: 'split', readerOpen: false, readerWidth: 420, settled: true });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('Back is drawn only when Panels owns it, and goes back', async () => {
  const h = await harness({ width: 500 });
  try {
    assert.equal(h.q('.nui-panels-back'), null);
    await h.render({ onBack: h.onBack });
    const back = h.q<HTMLButtonElement>('.nui-panels-back')!;
    assert.equal(back.textContent, 'Back');
    await h.click(back);
    assert.equal(h.backs(), 1);
  } finally { await h.cleanup(); }
});

test('a stored width applies; the reader never squeezes the list under 320px', async () => {
  const h = await harness({ width: 1000, storageKey: 'notes', storedWidth: '900', resizable: true });
  try {
    assert.equal(h.readerVar(), '900px');
    // 1000 - 320: the clamp holds what is on screen; the CSS clamp() does the same.
    assert.equal(h.q('#reader')!.getAttribute('data-seen-width'), '680');
    assert.equal(h.q('.nui-panels-handle')!.getAttribute('aria-valuenow'), '680');
    assert.equal(h.q('.nui-panels-handle')!.getAttribute('aria-valuemax'), '680');
  } finally { await h.cleanup(); }
});

test('arrow keys step the reader 24px and double click restores the default', async () => {
  const h = await harness({ width: 1000, storageKey: 'notes', resizable: true });
  try {
    const handle = h.q('.nui-panels-handle')!;
    assert.equal(handle.getAttribute('aria-valuenow'), '420');
    assert.equal((await h.key(handle, 'ArrowLeft')).defaultPrevented, true);
    assert.equal(handle.getAttribute('aria-valuenow'), '444');
    assert.equal(h.stored(), '444');
    await h.key(handle, 'ArrowRight');
    await h.key(handle, 'ArrowRight');
    assert.equal(handle.getAttribute('aria-valuenow'), '396');
    // Never under the reader minimum.
    for (let i = 0; i < 5; i += 1) await h.key(handle, 'ArrowRight');
    assert.equal(handle.getAttribute('aria-valuenow'), '360');

    await h.doubleClick(handle);
    assert.equal(handle.getAttribute('aria-valuenow'), '420');
    assert.equal(h.stored(), null);
  } finally { await h.cleanup(); }
});

test('Esc goes back from the open item in either mode, once per press', async () => {
  for (const width of [500, 1000]) {
    const h = await harness({ width });
    try {
      await h.render({ onBack: h.onBack });
      const escape = await h.key(h.q('#reader')!, 'Escape');
      assert.equal(h.backs(), 1, `width ${width}`);
      assert.equal(escape.defaultPrevented, true);
      // Nothing open: Esc is not taken.
      await h.render({ reader: null });
      const idle = await h.key(h.q('#list')!, 'Escape');
      assert.equal(h.backs(), 1);
      assert.equal(idle.defaultPrevented, false);
    } finally { await h.cleanup(); }
  }
});

test('Back and the handle speak French with a French engine', async () => {
  const h = await harness({ width: 500, locale: 'fr', resizable: true });
  try {
    await h.render({ onBack: h.onBack });
    assert.equal(h.q('.nui-panels-back')!.textContent, 'Retour');
    assert.equal(h.q('.nui-panels-handle')!.getAttribute('aria-label'), 'Redimensionner l\u2019\u00e9l\u00e9ment ouvert');
  } finally { await h.cleanup(); }
});
