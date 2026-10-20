/**
 * Test DOM for toolkit tests that focus or type into fields. Imported first, so react-dom sees a browser when it loads
 * and listens to `input` events (it decides that once, at import; else it falls back to an old polyfill that throws).
 */
import { JSDOM } from 'jsdom';

export const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'http://localhost/page' });
const globals: Record<string, unknown> = {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element,
  Node: dom.window.Node, ShadowRoot: dom.window.ShadowRoot, Document: dom.window.Document,
  KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent, Event: dom.window.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
};
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
