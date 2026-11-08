import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { PANELS_HOVER_DELAY_MS } from './panelMath';
import { Panels, usePanels, type PanelsProps } from './Panels';

/**
 * The one-pane switch: jsdom has no layout and no container queries, so the Panels width
 * comes from a fake ResizeObserver and `data-mode` (the JS mirror of the CSS rule) is what
 * the tests read.
 */
async function harness(props: Partial<PanelsProps> & { width?: number; storedWidth?: string; locale?: 'en' | 'fr'; focusVisible?: boolean } = {}) {
  const { width: initialWidth = 1000, storedWidth, locale = 'en', focusVisible = true, ...panelProps } = props;
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
  // jsdom does not track the input modality: the focused element matches :focus-visible (keyboard) or not (a click).
  const matches = dom.window.Element.prototype.matches;
  Object.defineProperty(dom.window.Element.prototype, 'matches', {
    configurable: true,
    value(this: Element, selector: string): boolean {
      if (selector === ':focus-visible') return focusVisible && dom.window.document.activeElement === this;
      return matches.call(this, selector);
    },
  });

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
    attr: (name: string) => q('.nui-panels')!.hasAttribute(name),
    handleNow: () => q('.nui-panels-handle')!.getAttribute('aria-valuenow'),
    pointer: async (node: Element, type: string, init: { clientX?: number; bubbles?: boolean } = {}) => {
      await act(async () => {
        node.dispatchEvent(new dom.window.PointerEvent(type, { pointerType: 'mouse', pointerId: 1, button: 0, bubbles: true, ...init }));
      });
    },
    rest: () => act(async () => { await new Promise((resolve) => setTimeout(resolve, PANELS_HOVER_DELAY_MS + 80)); }),
    focus: async (node: HTMLElement) => { await act(async () => { node.focus(); }); },
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

test('the default width only pushes: the reader never squeezes the list under 320px nor covers it', async () => {
  const h = await harness({ width: 1000, resizable: true, defaultReaderWidth: 900 });
  try {
    // 1000 - 320: the clamp holds what is on screen; the CSS clamp() does the same.
    assert.equal(h.q('#reader')!.getAttribute('data-seen-width'), '680');
    assert.equal(h.handleNow(), '680');
    assert.equal(h.attr('data-overlay'), false);
    assert.equal(h.attr('data-reader-chosen'), false);
  } finally { await h.cleanup(); }
});

test('a chosen width pushes the list to 320px, then slides over it and leaves an 80px strip', async () => {
  const h = await harness({ width: 1000, storageKey: 'notes', storedWidth: '900', resizable: true });
  try {
    assert.equal(h.readerVar(), '900px');
    // Past 1000 - 320 the reader covers the list; at most to 1000 - 80.
    assert.equal(h.q('#reader')!.getAttribute('data-seen-width'), '900');
    assert.equal(h.handleNow(), '900');
    assert.equal(h.q('.nui-panels-handle')!.getAttribute('aria-valuemax'), '920');
    assert.equal(h.attr('data-reader-chosen'), true);
    assert.equal(h.attr('data-overlay'), true);
    // The covered list stays usable: its strip shows and it is never inert beside the reader.
    assert.equal(h.q('.nui-panels-list')!.hasAttribute('inert'), false);
  } finally { await h.cleanup(); }

  const widest = await harness({ width: 1000, storageKey: 'notes', storedWidth: '2000', resizable: true });
  try {
    assert.equal(widest.handleNow(), '920');
  } finally { await widest.cleanup(); }

  // One pane below 680: nothing overlaps, the reader covers the list with Back as before.
  const narrow = await harness({ width: 600, storageKey: 'notes', storedWidth: '900', resizable: true });
  try {
    assert.equal(narrow.mode(), 'stacked');
    assert.equal(narrow.attr('data-overlay'), false);
  } finally { await narrow.cleanup(); }
});

test('dragging the edge past the list minimum slides the reader over the list, live, and keeps the width', async () => {
  const h = await harness({ width: 1000, storageKey: 'notes', resizable: true });
  try {
    const handle = h.q('.nui-panels-handle')!;
    assert.equal(h.handleNow(), '420');
    await h.pointer(handle, 'pointerdown', { clientX: 580 });
    assert.equal(h.attr('data-resizing'), true);
    // 260px left: still pushing (680 is the push limit).
    await h.pointer(handle, 'pointermove', { clientX: 320 });
    assert.equal(h.readerVar(), '680px');
    assert.equal(h.attr('data-overlay'), false);
    // Further left: the reader covers the list, live, without a commit.
    await h.pointer(handle, 'pointermove', { clientX: 100 });
    assert.equal(h.readerVar(), '900px');
    assert.equal(h.attr('data-overlay'), true);
    assert.equal(h.stored(), null);
    // Never past the 80px strip.
    await h.pointer(handle, 'pointermove', { clientX: -400 });
    assert.equal(h.readerVar(), '920px');
    await h.pointer(handle, 'pointermove', { clientX: 100 });
    await h.pointer(handle, 'pointerup', { clientX: 100 });
    assert.equal(h.attr('data-resizing'), false);
    assert.equal(h.stored(), '900');
    assert.equal(h.handleNow(), '900');
    assert.equal(h.readerVar(), '900px');
    assert.equal(h.attr('data-overlay'), true);
  } finally { await h.cleanup(); }
});

test('a 200ms rest on the covered list gives it 320px back until the pointer is on the reader again', async () => {
  const h = await harness({ width: 1000, storageKey: 'notes', storedWidth: '900', resizable: true });
  try {
    const list = h.q('.nui-panels-list')!;
    await h.pointer(list, 'pointerenter', { bubbles: false });
    await h.pointer(h.q('#list li')!, 'pointermove');
    // A pass is not a rest.
    assert.equal(h.attr('data-list-revealed'), false);
    await h.rest();
    assert.equal(h.attr('data-list-revealed'), true);
    assert.equal(h.q('#reader')!.getAttribute('data-seen-width'), '680');
    assert.equal(h.handleNow(), '680');
    // Standing aside, the reader no longer floats over the list (no shadow).
    assert.equal(h.attr('data-overlay'), false);
    // The choice is kept: only what shows steps aside.
    assert.equal(h.stored(), '900');
    assert.equal(h.readerVar(), '900px');

    // Leaving the list and touching the edge keep it revealed.
    await h.pointer(list, 'pointerleave', { bubbles: false });
    await h.pointer(h.q('.nui-panels-handle')!, 'pointerover');
    assert.equal(h.attr('data-list-revealed'), true);

    // Back on the reader: it covers the list again.
    await h.pointer(h.q('#reader')!, 'pointerover');
    assert.equal(h.attr('data-list-revealed'), false);
    assert.equal(h.handleNow(), '900');
    assert.equal(h.attr('data-overlay'), true);
  } finally { await h.cleanup(); }
});

test('crossing the covered list only cancels the pending rest; an uncovered list never moves', async () => {
  const h = await harness({ width: 1000, storageKey: 'notes', storedWidth: '900', resizable: true });
  try {
    const list = h.q('.nui-panels-list')!;
    await h.pointer(list, 'pointerenter', { bubbles: false });
    await h.pointer(list, 'pointerleave', { bubbles: false });
    await h.rest();
    assert.equal(h.attr('data-list-revealed'), false);
  } finally { await h.cleanup(); }

  const pushed = await harness({ width: 1000, storageKey: 'notes', storedWidth: '500', resizable: true });
  try {
    await pushed.pointer(pushed.q('.nui-panels-list')!, 'pointerenter', { bubbles: false });
    await pushed.rest();
    assert.equal(pushed.attr('data-list-revealed'), false);
    assert.equal(pushed.handleNow(), '500');
  } finally { await pushed.cleanup(); }
});

test('keyboard focus moving into the covered list reveals it; a click focus does not', async () => {
  const list = <ul id="list"><li><button id="row" type="button">Row</button></li></ul>;
  const h = await harness({ width: 1000, storageKey: 'notes', storedWidth: '900', resizable: true, list });
  try {
    await h.focus(h.q('#row')!);
    assert.equal(h.attr('data-list-revealed'), true);
    assert.equal(h.handleNow(), '680');
  } finally { await h.cleanup(); }

  const clicked = await harness({ width: 1000, storageKey: 'notes', storedWidth: '900', resizable: true, list, focusVisible: false });
  try {
    await clicked.focus(clicked.q('#row')!);
    assert.equal(clicked.attr('data-list-revealed'), false);
  } finally { await clicked.cleanup(); }
});

test('arrow keys step from the revealed width, and choosing a width covers the list again', async () => {
  const h = await harness({ width: 1000, storageKey: 'notes', storedWidth: '900', resizable: true });
  try {
    await h.pointer(h.q('.nui-panels-list')!, 'pointerenter', { bubbles: false });
    await h.rest();
    assert.equal(h.handleNow(), '680');
    await h.key(h.q('.nui-panels-handle')!, 'ArrowRight');
    assert.equal(h.stored(), '656');
    assert.equal(h.handleNow(), '656');
    assert.equal(h.attr('data-list-revealed'), false);
    assert.equal(h.attr('data-overlay'), false);
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
