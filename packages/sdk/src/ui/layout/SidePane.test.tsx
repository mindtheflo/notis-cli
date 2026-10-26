import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { SidePane, clampSidePaneWidth, type SidePaneProps } from './SidePane';

/**
 * jsdom has no layout and no container queries: the SidePane width comes from a fake
 * ResizeObserver and the drag edge's aria values are what the tests read.
 */
async function harness(props: Partial<SidePaneProps> & { width?: number; storedWidth?: string; locale?: 'en' | 'fr' } = {}) {
  const { width: initialWidth = 1200, storedWidth, locale = 'en', ...paneProps } = props;
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
  if (storedWidth !== undefined) dom.window.localStorage.setItem('notis:side-pane:mission', storedWidth);
  dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const w = this.classList.contains('nui-side-pane') ? width : 0;
    return { width: w, height: 600, top: 0, left: 0, right: w, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };

  const engine = new KeyboardEngineCore();
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(
    <KeyboardEngine host="preview" locale={locale} engine={engine} document={dom.window.document} strict>
      <SidePane pane={<p id="pane">Comments</p>} {...paneProps}><p id="page">Page</p></SidePane>
    </KeyboardEngine>,
  ));
  const q = <T extends Element = HTMLElement>(selector: string) => dom.window.document.querySelector(selector) as T | null;

  return {
    q,
    handle: () => q('.nui-side-pane-handle')!,
    paneVar: () => q('.nui-side-pane')!.style.getPropertyValue('--nui-side-pane-w'),
    stored: () => dom.window.localStorage.getItem('notis:side-pane:mission'),
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

test('the pane width stays between its bounds and never squeezes the page under its minimum', () => {
  assert.equal(clampSidePaneWidth(340, 1200), 340);
  assert.equal(clampSidePaneWidth(100, 1200), 280);
  assert.equal(clampSidePaneWidth(2000, 2000), 720);
  // 1000 - 520 leaves 480 for the pane.
  assert.equal(clampSidePaneWidth(700, 1000), 480);
  // A row too narrow for both still gives the pane its minimum.
  assert.equal(clampSidePaneWidth(700, 600), 280);
  assert.equal(clampSidePaneWidth(700, null), 700);
});

test('page and pane both render; the pane is named for screen readers', async () => {
  const h = await harness({ label: { en: 'the comments', fr: 'les commentaires' } });
  try {
    assert.ok(h.q('.nui-side-pane-main > #page'));
    assert.ok(h.q('.nui-side-pane-aside > #pane'));
    assert.equal(h.q('.nui-side-pane-aside')!.getAttribute('aria-label'), 'the comments');
    assert.equal(h.handle().getAttribute('aria-label'), 'Resize the comments');
    assert.equal(h.handle().getAttribute('aria-valuenow'), '340');
  } finally { await h.cleanup(); }
});

test('arrow keys step the pane 24px, store it, and double click restores the default', async () => {
  const h = await harness({ storageKey: 'mission' });
  try {
    const handle = h.handle();
    assert.equal((await h.key(handle, 'ArrowLeft')).defaultPrevented, true);
    assert.equal(handle.getAttribute('aria-valuenow'), '364');
    assert.equal(h.stored(), '364');
    assert.equal(h.paneVar(), '364px');
    for (let i = 0; i < 6; i += 1) await h.key(handle, 'ArrowRight');
    // Never under the pane minimum.
    assert.equal(handle.getAttribute('aria-valuenow'), '280');

    await h.doubleClick(handle);
    assert.equal(handle.getAttribute('aria-valuenow'), '340');
    assert.equal(h.stored(), null);
  } finally { await h.cleanup(); }
});

test('a stored width applies, clamped to the room the page leaves', async () => {
  const h = await harness({ storageKey: 'mission', storedWidth: '650', width: 1000 });
  try {
    assert.equal(h.paneVar(), '650px');
    assert.equal(h.handle().getAttribute('aria-valuenow'), '480');
    assert.equal(h.handle().getAttribute('aria-valuemax'), '480');
    await h.resize(1400);
    assert.equal(h.handle().getAttribute('aria-valuenow'), '650');
    assert.equal(h.handle().getAttribute('aria-valuemax'), '720');
  } finally { await h.cleanup(); }
});

test('custom minimums add their own container rule; the edge speaks French', async () => {
  const h = await harness({ mainMin: 600, paneMin: 300, locale: 'fr' });
  try {
    assert.match(h.q('.nui-side-pane > style')!.textContent ?? '', /\(min-width: 900px\)/);
    assert.equal(h.handle().getAttribute('aria-label'), 'Redimensionner le panneau latéral');
  } finally { await h.cleanup(); }
});
