import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  AUDIENCE_WINDOW_NAME, PRESENT_WORDS, audienceFeatures, clickHasOwnTarget, copyStylesInto, fillsScreen, hasSecondScreen,
  keyAction, pickAudienceScreen, useAudienceScreen, type AudienceOpenResult, type PresentAction, type ScreenArea,
  type UseAudienceScreenResult,
} from '.';
import * as ui from '..';

const doc = dom.window.document;
const win = dom.window as unknown as Window & typeof globalThis;

function setExtended(value: boolean | undefined) {
  Object.defineProperty(win.screen, 'isExtended', { configurable: true, get: () => value });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('the presenter is exported from @notis/sdk/ui', () => {
  assert.equal(ui.useAudienceScreen, useAudienceScreen);
  assert.equal(ui.PRESENT_WORDS, PRESENT_WORDS);
  assert.equal(AUDIENCE_WINDOW_NAME, 'notis-presenter-audience');
});

test('every presenter word has English and French', () => {
  for (const [key, words] of Object.entries(PRESENT_WORDS)) {
    assert.ok(words.en.trim(), key);
    assert.ok(words.fr.trim(), key);
    assert.notEqual(words.en, words.fr, key);
  }
});

test('a second screen needs an extended desktop', () => {
  setExtended(undefined);
  assert.equal(hasSecondScreen(win), false);
  setExtended(true);
  assert.equal(hasSecondScreen(win), true);
  assert.equal(hasSecondScreen(undefined), false);
});

test('the audience goes on another screen, external first, then the largest', () => {
  const laptop: ScreenArea = { availLeft: 0, availTop: 0, availWidth: 1512, availHeight: 945, isInternal: true };
  const tv: ScreenArea = { availLeft: 1512, availTop: 0, availWidth: 1920, availHeight: 1080, isInternal: false };
  const small: ScreenArea = { availLeft: -1280, availTop: 0, availWidth: 1280, availHeight: 720, isInternal: false };
  assert.equal(pickAudienceScreen([laptop, tv, small], laptop), tv);
  assert.equal(pickAudienceScreen([laptop, tv], { ...tv }), laptop);
  assert.equal(pickAudienceScreen([laptop], laptop), null);
  assert.equal(audienceFeatures(tv), 'popup,left=1512,top=0,width=1920,height=1080');
  assert.equal(audienceFeatures(null), 'popup,width=960,height=540');
});

test('keys map like a presented HtmlFrame and skip fields', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
    keyAction({ key: k, altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, target: doc.body, ...extra });
  assert.equal(key('ArrowRight'), 'next');
  assert.equal(key(' '), 'next');
  assert.equal(key('PageUp'), 'previous');
  assert.equal(key('Home'), 'first');
  assert.equal(key('End'), 'last');
  assert.equal(key('Escape'), 'stop');
  assert.equal(key('a'), null);
  assert.equal(key('ArrowRight', { metaKey: true }), null);
  assert.equal(key('ArrowRight', { defaultPrevented: true }), null);
  const input = doc.createElement('input');
  assert.equal(key('ArrowRight', { target: input }), null);
  const button = doc.createElement('button');
  assert.equal(key('Enter', { target: button }), null);
  assert.equal(key('ArrowRight', { target: button }), 'next');
  assert.equal(clickHasOwnTarget(button), true);
  assert.equal(clickHasOwnTarget(doc.body), false);
});

test('styles reach the audience window with resolved addresses', () => {
  const source = new JSDOM(
    '<!doctype html><html class="dark" style="color-scheme: dark"><head>'
      + '<link rel="stylesheet" href="/static/app.css" media="screen"><style>.a{color:red}</style></head><body></body></html>',
    { url: 'https://app.notis.ai/space/x' },
  ).window.document;
  const host = source.createElement('div');
  source.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>.b{color:blue}</style>';
  const target = new JSDOM('<!doctype html><html><head></head><body></body></html>').window.document;
  copyStylesInto(target, source, shadow);
  const link = target.head.querySelector('link')!;
  assert.equal(link.getAttribute('href'), 'https://app.notis.ai/static/app.css');
  assert.equal(link.getAttribute('media'), 'screen');
  const styles = Array.from(target.head.querySelectorAll('style'), (s) => s.textContent);
  assert.equal(styles.length, 2);
  assert.match(styles[0]!, /\.a\s*\{\s*color:\s*red/);
  assert.match(styles[1]!, /\.b\s*\{\s*color:\s*blue/);
  assert.equal(target.documentElement.className, 'dark');
  assert.equal(target.documentElement.getAttribute('style'), 'color-scheme: dark');
});

test('a window smaller than its screen does not fill it', () => {
  const popup = new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window;
  assert.equal(fillsScreen(popup), false);
});

test('a screen-sized browser window with a URL bar still needs page fullscreen', () => {
  const popup = new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window;
  Object.defineProperties(popup.screen, { width: { value: 1920 }, height: { value: 1080 } });
  Object.defineProperties(popup, {
    innerWidth: { value: 1920 }, innerHeight: { value: 1080 },
    outerWidth: { value: 1920 }, outerHeight: { value: 1160, configurable: true },
  });
  assert.equal(fillsScreen(popup), false, 'window dimensions alone must not hide the fullscreen button');
  Object.defineProperty(popup, 'outerHeight', { value: 1080 });
  assert.equal(fillsScreen(popup), true, 'the borderless desktop audience already has no browser chrome');
  Object.defineProperty(popup.document, 'fullscreenElement', { value: popup.document.documentElement });
  assert.equal(fillsScreen(popup), true);
});

test('an already loaded stylesheet survives an expired address, with its media and relative assets', () => {
  const source = new JSDOM('<!doctype html><head></head>', { url: 'https://app.notis.ai/deck' }).window.document;
  const link = source.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://storage.example/slides/app.css?expired=true';
  link.media = 'screen';
  const sheet = { href: link.href, cssRules: [{ cssText: '.slide { position: absolute; background: url("./paper.png"); }' }] };
  Object.defineProperty(link, 'sheet', { value: sheet });
  source.head.append(link);
  const target = new JSDOM('<!doctype html><head></head>').window.document;
  copyStylesInto(target, source);
  assert.equal(target.querySelector('link'), null, 'opening the audience must not download the expired address again');
  const copied = target.querySelector('style')!;
  assert.equal(copied.media, 'screen');
  assert.match(copied.textContent!, /position: absolute/);
  assert.match(copied.textContent!, /https:\/\/storage.example\/slides\/paper.png/);
});

test('styles inserted through the CSSOM reach the audience; disabled sheets stay disabled', () => {
  const source = new JSDOM('<!doctype html><head><style></style><style media="print">.print{display:none}</style></head>').window.document;
  source.querySelector('style')!.sheet!.insertRule('.slide { position: absolute; }');
  const disabled = source.createElement('link');
  disabled.rel = 'stylesheet';
  disabled.href = 'https://example.test/off.css';
  disabled.disabled = true;
  source.head.append(disabled);
  Object.defineProperty(source, 'adoptedStyleSheets', { value: [{ disabled: true, cssRules: [{ cssText: '.disabled { color: red; }' }] }] });
  const target = new JSDOM('<!doctype html><head></head>').window.document;
  copyStylesInto(target, source);
  assert.match(target.querySelector('style')!.textContent!, /position: absolute/);
  assert.equal(target.querySelector('style[media="print"]')?.textContent?.includes('.print'), true);
  assert.equal(target.querySelector('link'), null);
  assert.equal(target.head.textContent?.includes('.disabled'), false);
});

test('snapshot URLs preserve CSS strings, fragments, imports and escaped asset names', () => {
  const source = new JSDOM('<!doctype html><head></head>').window.document;
  const style = source.createElement('style');
  Object.defineProperty(style, 'sheet', { value: {
    href: 'https://cdn.example/deck/app.css',
    cssRules: [{ cssText: '@import "./fonts.css" screen; .slide { content: "url(./literal)"; filter: url(#dot); background: url("./paper\\20 texture.png"); }' }],
  } });
  source.head.append(style);
  const target = new JSDOM('<!doctype html><head></head>').window.document;
  copyStylesInto(target, source);
  const css = target.querySelector('style')!.textContent!;
  assert.match(css, /@import "https:\/\/cdn.example\/deck\/fonts.css" screen/);
  assert.match(css, /content: "url\(\.\/literal\)"/);
  assert.match(css, /filter: url\(#dot\)/);
  assert.match(css, /https:\/\/cdn.example\/deck\/paper%20texture.png/);
});

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

let root: Root | null = null;
let api: UseAudienceScreenResult | null = null;
const actions: PresentAction[] = [];
let closes = 0;

function Harness() {
  api = useAudienceScreen({ onAction: (action) => actions.push(action), onClose: () => { closes += 1; } });
  return (
    <div data-notis-app-root="" data-notis-theme="dark" style={{ color: 'hsl(var(--foreground))' }}>
      <span id="anchor">deck</span>
      {api.portal(<p id="slide">Slide 3</p>)}
    </div>
  );
}

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => { root!.render(<Harness />); });
}

async function unmount() {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
}

function stubOpen(result: Window | null) {
  const calls: Array<[string | URL | undefined, string | undefined, string | undefined]> = [];
  Object.defineProperty(win, 'open', {
    configurable: true,
    writable: true,
    value: (url?: string | URL, name?: string, features?: string) => {
      calls.push([url, name, features]);
      return result;
    },
  });
  return calls;
}

test('one screen: open answers one-screen and opens nothing', async () => {
  setExtended(false);
  const calls = stubOpen(null);
  await mount();
  assert.equal(api!.secondScreen, false);
  let result: AudienceOpenResult | null = null;
  await act(async () => { result = await api!.open(doc.getElementById('anchor')); });
  assert.equal(result, 'one-screen');
  assert.equal(calls.length, 0);
  assert.equal(api!.isOpen, false);
  await unmount();
});

test('a blocked window answers blocked', async () => {
  setExtended(true);
  const calls = stubOpen(null);
  await mount();
  assert.equal(api!.secondScreen, true);
  let result: AudienceOpenResult | null = null;
  await act(async () => { result = await api!.open(doc.getElementById('anchor')); });
  assert.equal(result, 'blocked');
  assert.equal(calls[0]?.[1], AUDIENCE_WINDOW_NAME);
  await unmount();
});

test('two screens: the audience view renders in its window and its keys and clicks drive the deck', async () => {
  setExtended(true);
  actions.length = 0;
  closes = 0;
  const popup = new JSDOM('<!doctype html><html><head><title>x</title></head><body>old</body></html>', { url: 'about:blank' })
    .window as unknown as Window & typeof globalThis;
  const calls = stubOpen(popup);
  await mount();
  let result: AudienceOpenResult | null = null;
  await act(async () => { result = await api!.open(doc.getElementById('anchor')); });
  assert.equal(result, 'opened');
  assert.equal(calls[0]?.[2], 'popup,width=960,height=540');
  assert.equal(api!.isOpen, true);

  const pdoc = popup.document;
  assert.equal(pdoc.title, 'Presentation');
  const container = pdoc.querySelector('[data-notis-audience-root]')!;
  assert.ok(container.hasAttribute('data-notis-app-root'));
  assert.equal(container.getAttribute('data-notis-theme'), 'dark');
  assert.ok(pdoc.querySelector('[data-notis-layer-root]'));
  assert.equal(container.querySelector('#slide')?.textContent, 'Slide 3');
  assert.equal(doc.querySelector('#slide'), null);
  // Not placed on a screen (no Window Management API): the hint asks to drag the window over.
  assert.equal(pdoc.querySelector('[data-notis-audience-fill]')?.textContent, PRESENT_WORDS.dragToScreen.en);

  const key = (k: string) => popup.dispatchEvent(new popup.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key('ArrowRight');
  key('ArrowLeft');
  key('Escape');
  container.querySelector('#slide')!.dispatchEvent(new popup.MouseEvent('click', { bubbles: true, button: 0 }));
  container.querySelector('#slide')!.dispatchEvent(new popup.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.deepEqual(actions, ['next', 'previous', 'stop', 'next', 'previous']);

  // Opening again focuses the same window.
  await act(async () => { result = await api!.open(doc.getElementById('anchor')); });
  assert.equal(result, 'opened');
  assert.equal(calls.length, 1);

  // The person closes the audience window.
  await act(async () => { popup.dispatchEvent(new popup.Event('pagehide')); });
  assert.equal(api!.isOpen, false);
  assert.equal(closes, 1);
  key('ArrowRight');
  assert.equal(actions.length, 5);
  await unmount();
});

test('audience fullscreen hides navigation UI and keeps the control available after rejection', async () => {
  setExtended(true);
  actions.length = 0;
  const popup = new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window & typeof globalThis;
  stubOpen(popup);
  const requests: FullscreenOptions[] = [];
  let reject = true;
  Object.defineProperty(popup.document.documentElement, 'requestFullscreen', { value: async (options: FullscreenOptions) => {
    requests.push(options);
    if (reject) throw new Error('User activation required');
    Object.defineProperty(popup.document, 'fullscreenElement', { configurable: true, value: popup.document.documentElement });
    popup.document.dispatchEvent(new popup.Event('fullscreenchange'));
  } });
  await mount();
  await act(async () => { await api!.open(); });
  await act(async () => { popup.document.querySelector<HTMLButtonElement>('[data-notis-audience-fill]')!.click(); });
  assert.deepEqual(requests, [{ navigationUI: 'hide' }]);
  assert.ok(popup.document.querySelector('[data-notis-audience-fill]'), 'a rejected request can be retried');
  assert.deepEqual(actions, [], 'entering fullscreen must not advance the slide');
  reject = false;
  await act(async () => { popup.document.querySelector<HTMLButtonElement>('[data-notis-audience-fill]')!.click(); });
  assert.equal(popup.document.querySelector('[data-notis-audience-fill]'), null);
  await act(async () => {
    Object.defineProperty(popup.document, 'fullscreenElement', { configurable: true, value: null });
    popup.document.dispatchEvent(new popup.Event('fullscreenchange'));
  });
  assert.ok(popup.document.querySelector('[data-notis-audience-fill]'), 'leaving fullscreen restores the control');
  await unmount();
});

test('the presenter and audience share slide updates in both directions and stop after closing', async () => {
  setExtended(true);
  const popup = new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window & typeof globalThis;
  stubOpen(popup);
  function Deck() {
    const [slide, setSlide] = useState(1);
    api = useAudienceScreen({ onAction: action => setSlide(current => current + (action === 'next' ? 1 : -1)) });
    return <><button onClick={() => setSlide(current => current + 1)}>Next</button>
      <span id="presenter-slide">{slide}</span>{api.portal(<p id="audience-slide">{slide}</p>)}</>;
  }
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => { root!.render(<Deck />); });
  await act(async () => { await api!.open(); });
  await act(async () => { doc.querySelector('button')!.click(); });
  assert.equal(popup.document.querySelector('#audience-slide')?.textContent, '2');
  await act(async () => { popup.dispatchEvent(new popup.KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  assert.equal(doc.querySelector('#presenter-slide')?.textContent, '3');
  assert.equal(popup.document.querySelector('#audience-slide')?.textContent, '3');
  await act(async () => { popup.dispatchEvent(new popup.Event('pagehide')); });
  await act(async () => { popup.dispatchEvent(new popup.KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  assert.equal(doc.querySelector('#presenter-slide')?.textContent, '3');
  assert.equal(api!.isOpen, false);
  await unmount();
});

test('with the Window Management API the window is placed on the other screen', async () => {
  setExtended(true);
  const laptop: ScreenArea = { availLeft: 0, availTop: 0, availWidth: 1512, availHeight: 945, isInternal: true };
  const tv: ScreenArea = { availLeft: 1512, availTop: 0, availWidth: 1920, availHeight: 1080, isInternal: false };
  Object.defineProperty(win, 'getScreenDetails', { configurable: true, value: async () => ({ screens: [laptop, tv], currentScreen: laptop }) });
  Object.defineProperty(win.navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } });
  const popup = new JSDOM('<!doctype html><html><body></body></html>', { url: 'about:blank' }).window as unknown as Window & typeof globalThis;
  const calls = stubOpen(popup);
  closes = 0;
  await mount();
  await act(async () => { await api!.open(doc.getElementById('anchor')); });
  assert.equal(calls[0]?.[2], 'popup,left=1512,top=0,width=1920,height=1080');
  assert.equal(popup.document.querySelector('[data-notis-audience-fill]')?.textContent, PRESENT_WORDS.fillScreen.en);
  // Leaving the Space closes the audience window.
  await unmount();
  assert.equal(closes, 1);
  delete (win as { getScreenDetails?: unknown }).getScreenDetails;
});

test('a press used up by the permission prompt answers press-again', async () => {
  setExtended(true);
  Object.defineProperty(win, 'getScreenDetails', { configurable: true, value: async () => ({ screens: [], currentScreen: null }) });
  Object.defineProperty(win.navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
  stubOpen(null);
  await mount();
  let result: AudienceOpenResult | null = null;
  await act(async () => { result = await api!.open(null); });
  assert.equal(result, 'press-again');
  await unmount();
  delete (win as { getScreenDetails?: unknown }).getScreenDetails;
});
