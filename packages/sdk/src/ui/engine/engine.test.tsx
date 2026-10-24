import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { defaultStrict, ESCAPE_PRIORITY, KeyboardEngineCore, SEQUENCE_TIMEOUT_MS } from './core';
import { HelpSheet } from './HelpSheet';
import { useEscapeBlocker, useEscapeLayer, useShortcut, useToolkitLocale } from './hooks';
import { KeyboardEngine, ShortcutScope } from './KeyboardEngine';
import { stepCursor } from './step';
import type { ShortcutDef } from './types';
import { Keycap } from '../keycap/Keycap';

const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'http://localhost/' });
const globals: Record<string, unknown> = {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  KeyboardEvent: dom.window.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true,
};
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const doc = dom.window.document;

interface Press {
  key: string;
  code?: string;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  repeat?: boolean;
  up?: boolean;
}

function codeFor(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return { '?': 'Slash', '/': 'Slash', '[': 'BracketLeft', ']': 'BracketRight' }[key] ?? key;
}

/** Fires keydown (and keyup unless `up: false`) on a target; returns the keydown event. */
function press(target: EventTarget, p: Press): KeyboardEvent {
  const init = {
    key: p.key, code: p.code ?? codeFor(p.key), shiftKey: !!p.shift, altKey: !!p.alt, metaKey: !!p.meta,
    ctrlKey: !!p.ctrl, repeat: !!p.repeat, bubbles: true, cancelable: true, composed: true,
  };
  const down = new dom.window.KeyboardEvent('keydown', init);
  target.dispatchEvent(down);
  if (p.up !== false) target.dispatchEvent(new dom.window.KeyboardEvent('keyup', init));
  return down as unknown as KeyboardEvent;
}

function setup(options: { strict?: boolean; platform?: 'mac' | 'other'; onClash?: (m: string) => void } = {}) {
  doc.body.innerHTML = '';
  const core = new KeyboardEngineCore({ platform: options.platform ?? 'mac', locale: 'en', strict: options.strict ?? true,
    onClash: options.onClash });
  const detach = core.attach(doc);
  return { core, detach };
}

const def = (id: string, keys: string | string[], scope: ShortcutDef['scope'], run: ShortcutDef['run'],
  extra: Partial<ShortcutDef> = {}): ShortcutDef => ({ id, keys, scope, label: { en: id, fr: id }, run, ...extra });

test('one listener: the highest scope answers, and returning false passes the key on', () => {
  const { core, detach } = setup();
  const calls: string[] = [];
  core.defineOwner('tickets');
  core.register(def('row.e', 'e', 'collection', () => { calls.push('row'); }), 'tickets');
  core.register(def('detail.e', 'e', 'detail', () => { calls.push('detail'); return false; }), 'tickets');
  const event = press(doc.body, { key: 'e' });
  assert.deepEqual(calls, ['detail', 'row']);
  assert.ok(event.defaultPrevented);
  // A second attach shares the listener; one detach keeps it.
  const again = core.attach(doc);
  again();
  press(doc.body, { key: 'e' });
  assert.equal(calls.length, 4);
  detach();
  press(doc.body, { key: 'e' });
  assert.equal(calls.length, 4, 'no listener after the last detach');
});

test('held keys: only repeat defs fire while held, even when the host drops event.repeat', () => {
  const { core, detach } = setup();
  const seen: Array<[string, boolean]> = [];
  core.register(def('list.next', 'j', 'collection', (e) => { seen.push(['next', e.repeat]); }, { repeat: true }));
  core.register(def('toggle', 'x', 'collection', () => { seen.push(['toggle', false]); }));
  press(doc.body, { key: 'j', up: false });
  press(doc.body, { key: 'j', up: false });
  press(doc.body, { key: 'j', repeat: true, up: false });
  press(doc.body, { key: 'x', up: false });
  press(doc.body, { key: 'x', up: false });
  assert.deepEqual(seen, [['next', false], ['next', true], ['next', true], ['toggle', false]]);
  doc.body.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'x', code: 'KeyX', bubbles: true }));
  press(doc.body, { key: 'x' });
  assert.equal(seen.length, 5);
  // Blur clears held keys (a key released in another window).
  press(doc.body, { key: 'x', up: false });
  dom.window.dispatchEvent(new dom.window.Event('blur'));
  press(doc.body, { key: 'x' });
  assert.equal(seen.filter(([name]) => name === 'toggle').length, 4);
  detach();
});

test('J/K wrap on a fresh press and stop at the edge while held', () => {
  const { core, detach } = setup();
  const ids = ['a', 'b', 'c'];
  let cursor = 'b';
  core.register(def('list.next', 'j', 'collection', (e) => { cursor = stepCursor(ids, cursor, 1, { repeat: e.repeat })!; },
    { repeat: true }));
  press(doc.body, { key: 'j', up: false });
  press(doc.body, { key: 'j', up: false, repeat: true });
  press(doc.body, { key: 'j', up: false, repeat: true });
  assert.equal(cursor, 'c', 'held: stops at the last item');
  doc.body.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'j', code: 'KeyJ', bubbles: true }));
  press(doc.body, { key: 'j' });
  assert.equal(cursor, 'a', 'fresh press: wraps');
  detach();
});

test('Option chords match the physical key, and AltGr symbols match the typed character', () => {
  const { core, detach } = setup();
  const calls: string[] = [];
  core.register(def('model', 'alt+p', 'app', () => { calls.push('model'); }));
  core.register(def('period.prev', '[', 'route', () => { calls.push('prev'); }));
  press(doc.body, { key: 'π', code: 'KeyP', alt: true });
  press(doc.body, { key: '[', code: 'Digit5', alt: true, shift: true });
  assert.deepEqual(calls, ['model', 'prev']);
  core.configure({ platform: 'other' });
  press(doc.body, { key: '[', code: 'Digit5', alt: true, ctrl: true });
  press(doc.body, { key: 'p', code: 'KeyP', alt: true });
  assert.deepEqual(calls, ['model', 'prev', 'prev', 'model']);
  detach();
});

test('sequences run within 1500 ms and a single key never waits', () => {
  const { core, detach } = setup();
  let now = 1000;
  core.now = () => now;
  const calls: string[] = [];
  core.register(def('go.inbox', 'g i', 'app', () => { calls.push('inbox'); }));
  core.register(def('list.open', 'o', 'collection', () => { calls.push('open'); }));
  press(doc.body, { key: 'g' });
  press(doc.body, { key: 'i' });
  press(doc.body, { key: 'g' });
  now += SEQUENCE_TIMEOUT_MS + 1;
  press(doc.body, { key: 'i' });
  press(doc.body, { key: 'o' });
  press(doc.body, { key: 'g' });
  press(doc.body, { key: 'o' });
  assert.deepEqual(calls, ['inbox', 'open', 'open']);
  detach();
});

test('typing rule: fields block, buttons and links do not, Enter on a button presses the button', () => {
  const { core, detach } = setup();
  doc.body.innerHTML = `<input id="field"><textarea id="area"></textarea><div id="ce" contenteditable="true"></div>
    <div role="combobox" id="combo" tabindex="0"></div><button id="btn">Go</button><a id="link" href="#x">x</a>
    <div data-notis-keys="off"><span id="off"></span></div><input type="checkbox" id="check">
    <div role="checkbox" id="rowcheck" tabindex="0"></div>`;
  const calls: string[] = [];
  core.register(def('list.next', 'j', 'collection', () => { calls.push('j'); }));
  core.register(def('list.open', 'enter', 'collection', () => { calls.push('enter'); }));
  core.register(def('send', 'mod+enter', 'detail', () => { calls.push('send'); }, { allowInFields: true }));
  const $ = (id: string) => doc.getElementById(id)!;
  for (const id of ['field', 'area', 'ce', 'combo', 'off']) press($(id), { key: 'j' });
  assert.equal(calls.length, 0);
  press($('btn'), { key: 'j' });
  press($('link'), { key: 'j' });
  press($('check'), { key: 'j' });
  press($('rowcheck'), { key: 'j' });
  assert.deepEqual(calls, ['j', 'j', 'j', 'j'], 'J keeps working after a click on a button, a checkbox or a row');
  press($('btn'), { key: 'Enter' });
  assert.deepEqual(calls, ['j', 'j', 'j', 'j'], 'Enter presses the button');
  press(doc.body, { key: 'Enter' });
  press($('field'), { key: 'Enter', meta: true });
  assert.deepEqual(calls, ['j', 'j', 'j', 'j', 'enter', 'send']);
  press($('btn'), { key: 'Enter', meta: true });
  assert.deepEqual(calls, ['j', 'j', 'j', 'j', 'enter', 'send', 'send'], 'Cmd+Enter on a button (a select trigger) still saves');
  detach();
});

test('an open dialog (Radix or aria-modal) limits keys to the modal scope', () => {
  const { core, detach } = setup();
  const calls: string[] = [];
  core.register(def('list.next', 'j', 'collection', () => { calls.push('list'); }));
  core.register(def('dialog.next', 'j', 'modal', () => { calls.push('modal'); return false; }));
  doc.body.innerHTML = '<div role="dialog" data-state="open" id="radix"><button id="in">x</button></div>';
  press(doc.getElementById('in')!, { key: 'j' });
  assert.deepEqual(calls, ['modal']);
  doc.body.innerHTML = '<div role="dialog" aria-modal="true" data-notis-nonmodal></div>';
  press(doc.body, { key: 'j' });
  assert.deepEqual(calls, ['modal', 'modal', 'list'], 'a non-modal popover does not isolate');
  doc.body.innerHTML = '<div role="dialog" aria-modal="true" hidden></div>';
  press(doc.body, { key: 'j' });
  assert.equal(calls.at(-1), 'list', 'a hidden dialog does not isolate');
  doc.body.innerHTML = '<div role="menu" data-state="open"><div role="menuitem" id="item" tabindex="0">a</div></div>';
  press(doc.getElementById('item')!, { key: 'j' });
  assert.equal(calls.at(-1), 'modal', 'inside an open menu only modal defs run');
  doc.body.innerHTML = '<div role="listbox" data-notis-engine-list=""><div role="option" id="opt" tabindex="0">a</div></div>';
  press(doc.getElementById('opt')!, { key: 'j' });
  assert.equal(calls.at(-1), 'list', 'an engine-driven listbox keeps list keys alive');
  detach();
});

test('availability: a hidden retained view goes silent at dispatch', () => {
  const { core, detach } = setup();
  const calls: string[] = [];
  core.defineOwner('view-a');
  core.defineOwner('view-b', { available: false });
  core.register(def('a.e', 'e', 'collection', () => { calls.push('a'); }), 'view-a');
  core.register(def('b.e', 'e', 'collection', () => { calls.push('b'); }), 'view-b');
  press(doc.body, { key: 'e' });
  core.setOwnerAvailable('view-a', false);
  core.setOwnerAvailable('view-b', true);
  press(doc.body, { key: 'e' });
  assert.deepEqual(calls, ['a', 'b']);
  detach();
});

test('Escape chain: priority order, latest first, blockers, held Escape, fields own Escape', () => {
  const { core, detach } = setup();
  const calls: string[] = [];
  let selection = true;
  const offRoute = core.addEscapeLayer('route', () => { calls.push('route'); return true; }, ESCAPE_PRIORITY.route);
  const offDetail = core.addEscapeLayer('detail', () => { calls.push('detail'); return true; }, ESCAPE_PRIORITY.detail);
  core.addEscapeLayer('selection', () => {
    if (!selection) return false;
    selection = false;
    calls.push('selection');
    return true;
  }, ESCAPE_PRIORITY.selection);
  assert.deepEqual(core.escapeLayerIds(), ['selection', 'detail', 'route']);
  press(doc.body, { key: 'Escape' });
  press(doc.body, { key: 'Escape' });
  assert.deepEqual(calls, ['selection', 'detail']);
  // A held Escape is consumed but never peels a layer.
  const held = press(doc.body, { key: 'Escape', repeat: true, up: false });
  assert.ok(held.defaultPrevented);
  assert.deepEqual(calls, ['selection', 'detail']);
  doc.body.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
  // The composer has text: the chain stops before the detail panel and route back.
  const unblock = core.addEscapeBlocker();
  const blocked = press(doc.body, { key: 'Escape' });
  assert.deepEqual(calls, ['selection', 'detail']);
  assert.ok(blocked.defaultPrevented);
  unblock();
  offDetail();
  press(doc.body, { key: 'Escape' });
  assert.deepEqual(calls, ['selection', 'detail', 'route']);
  doc.body.innerHTML = '<input id="field">';
  const inField = press(doc.getElementById('field')!, { key: 'Escape' });
  assert.equal(inField.defaultPrevented, false);
  assert.equal(calls.length, 3, 'a text field owns its Escape');
  offRoute();
  detach();
});

test('Escape layers see dialogs inside a Space shadow root and let them close themselves', () => {
  const { core, detach } = setup();
  const calls: string[] = [];
  core.addEscapeLayer('detail', () => { calls.push('detail'); return true; }, ESCAPE_PRIORITY.detail);
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div id="app"><button id="row">row</button></div>';
  const row = shadow.getElementById('row')!;
  // Focus is outside the Space (the top bar) while a Radix dialog is open inside its shadow root.
  const menu = doc.createElement('div');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('data-state', 'open');
  shadow.getElementById('app')!.appendChild(menu);
  const event = press(doc.body, { key: 'Escape' });
  assert.equal(calls.length, 0, 'the dialog in the shadow root owns this Escape');
  assert.equal(event.defaultPrevented, false);
  menu.setAttribute('data-state', 'closed');
  press(row, { key: 'Escape' });
  assert.deepEqual(calls, ['detail']);
  // Toolkit layers that run through the chain are not foreign.
  menu.setAttribute('data-state', 'open');
  menu.setAttribute('data-notis-escape-owned', '');
  press(row, { key: 'Escape' });
  assert.deepEqual(calls, ['detail', 'detail']);
  // A field inside the shadow root still owns its keys (composedPath target).
  shadow.getElementById('app')!.innerHTML = '<input id="q">';
  core.register(def('list.next', 'j', 'collection', () => { calls.push('j'); }));
  press(shadow.getElementById('q')!, { key: 'j' });
  assert.deepEqual(calls, ['detail', 'detail']);
  detach();
});

test('Escape on an open Select list inside a dialog closes only the list, not the reader under it', () => {
  const { core, detach } = setup();
  const calls: string[] = [];
  core.addEscapeLayer('detail', () => { calls.push('detail'); return true; }, ESCAPE_PRIORITY.detail);
  // A modal Radix Select hides everything else, the dialog included, from assistive tech.
  doc.body.innerHTML = '<div aria-hidden="true"><div role="dialog" data-state="open"></div></div>'
    + '<div><div role="listbox" data-state="open"><div role="option" id="opt" tabindex="0">a</div></div></div>';
  const event = press(doc.getElementById('opt')!, { key: 'Escape' });
  assert.deepEqual(calls, [], 'the open list owns this Escape');
  assert.equal(event.defaultPrevented, false);
  // A list that is always on the page (the rows) never takes Escape from the reader.
  doc.body.innerHTML = '<div role="listbox"><div role="option" id="row" tabindex="0">a</div></div>';
  press(doc.getElementById('row')!, { key: 'Escape' });
  assert.deepEqual(calls, ['detail']);
  detach();
});

test('production mode drops a clashing def and logs once; strict throws', () => {
  const logs: string[] = [];
  const { core, detach } = setup({ strict: false, onClash: (message) => logs.push(message) });
  core.defineOwner('tickets');
  core.register(def('a', 'e', 'collection', () => {}), 'tickets');
  assert.equal(core.register(def('b', 'e', 'collection', () => {}), 'tickets'), null);
  assert.equal(core.register(def('s', '?', 'route', () => {}), 'tickets'), null);
  assert.equal(logs.length, 2);
  core.configure({ strict: true });
  assert.throws(() => core.register(def('b', 'e', 'collection', () => {}), 'tickets'), /NotisKeyClash/);
  detach();
});

test('a production build is not strict, so a reserved key drops instead of blanking the view', () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(defaultStrict(), false);
    const logs: string[] = [];
    const core = new KeyboardEngineCore({ platform: 'mac', locale: 'en', onClash: (message) => logs.push(message) });
    core.defineOwner('catalogue');
    assert.equal(core.register(def('review.comment', 'c', 'route', () => {}), 'catalogue'), null);
    assert.equal(logs.length, 1);
    process.env.NODE_ENV = 'development';
    assert.equal(defaultStrict(), true);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

// ---- React ----

async function mount(node: React.ReactNode) {
  doc.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(doc.getElementById('root')!);
  await act(async () => { root.render(node); });
  return {
    root,
    rerender: async (next: React.ReactNode) => { await act(async () => { root.render(next); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

function Rows({ name }: { name: string }) {
  const [count, setCount] = useState(0);
  useShortcut({
    id: 'list.next', keys: ['j', 'arrowdown'], scope: 'collection', label: { en: 'Next item', fr: 'Élément suivant' },
    run: () => { setCount((n) => n + 1); },
  });
  return <p id={`count-${name}`}>{count}</p>;
}

function Detail() {
  const [closed, setClosed] = useState(0);
  useEscapeLayer('detail', () => { setClosed((n) => n + 1); return true; }, { priority: ESCAPE_PRIORITY.detail });
  useEscapeBlocker(false);
  const locale = useToolkitLocale();
  return <p id="detail" data-locale={locale}>{closed}</p>;
}

test('useShortcut under ShortcutScope: hidden retained views go silent, handlers stay fresh', async () => {
  const core = new KeyboardEngineCore({ platform: 'mac', strict: true });
  const tree = (visible: 'a' | 'b') => (
    <KeyboardEngine host="preview" locale="en" engine={core} document={doc}>
      <ShortcutScope owner="tickets" available>
        <ShortcutScope owner="tickets/a" available={visible === 'a'}><Rows name="a" /></ShortcutScope>
        <ShortcutScope owner="tickets/b" available={visible === 'b'}><Rows name="b" /></ShortcutScope>
        <Detail />
      </ShortcutScope>
    </KeyboardEngine>
  );
  const view = await mount(tree('a'));
  const text = (id: string) => doc.getElementById(id)!.textContent;
  await act(async () => { press(doc.body, { key: 'j' }); });
  await act(async () => { press(doc.body, { key: 'ArrowDown', code: 'ArrowDown' }); });
  assert.equal(text('count-a'), '2');
  assert.equal(text('count-b'), '0');
  await view.rerender(tree('b'));
  await act(async () => { press(doc.body, { key: 'j' }); });
  assert.equal(text('count-a'), '2');
  assert.equal(text('count-b'), '1');
  await act(async () => { press(doc.body, { key: 'Escape' }); });
  assert.equal(text('detail'), '1');
  assert.equal(core.registry.ownerKind('tickets/a'), 'space');
  await view.unmount();
  assert.equal(core.registry.all().filter((entry) => entry.def.id === 'list.next').length, 0);
  assert.equal(core.isAttached(doc), false);
});

test('the help sheet opens on ?, lists live shortcuts in English and French, and closes on ? or Escape', async () => {
  const core = new KeyboardEngineCore({ platform: 'mac', strict: true });
  const tree = (locale: 'en' | 'fr') => (
    <KeyboardEngine host="portal" locale={locale} engine={core} document={doc}>
      <ShortcutScope owner="tickets" available><Rows name="a" /></ShortcutScope>
      <HelpSheet />
    </KeyboardEngine>
  );
  const view = await mount(tree('en'));
  doc.getElementById('count-a')!.setAttribute('tabindex', '0');
  (doc.getElementById('count-a') as HTMLElement).focus();
  await act(async () => { press(doc.body, { key: '?', code: 'Slash', shift: true }); });
  const sheet = () => doc.querySelector('.nui-help');
  assert.ok(sheet(), 'open');
  assert.equal(doc.querySelector('.nui-help-title')!.textContent, 'Keyboard shortcuts');
  const groups = [...doc.querySelectorAll('.nui-help-group-title')].map((el) => el.textContent);
  assert.deepEqual(groups, ['This Space', 'Notis']);
  const row = doc.querySelector('[data-shortcut-id="list.next"]')!;
  assert.match(row.textContent!, /Next item/);
  assert.equal(row.querySelector('.nui-kbd-caps')!.textContent, 'Jor↓');
  assert.equal(row.querySelector('.nui-sr-only')!.textContent, 'J or Down arrow');
  assert.equal(row.querySelector('.nui-kbd-group')!.getAttribute('data-on'), 'discreet');
  assert.ok(doc.querySelector('[data-shortcut-id="host.help"]'), 'the ? key itself is listed under Notis');
  assert.equal(doc.activeElement, doc.querySelector('.nui-help-panel'), 'focus moves into the sheet');
  // The sheet is modal: J does nothing while it is open.
  await act(async () => { press(doc.body, { key: 'j' }); });
  assert.equal(doc.getElementById('count-a')!.textContent, '0');
  await act(async () => { press(doc.body, { key: '?', code: 'Slash', shift: true }); });
  assert.equal(sheet(), null, '? closes it');
  assert.equal(doc.activeElement, doc.getElementById('count-a'), 'focus returns');

  await view.rerender(tree('fr'));
  await act(async () => { core.openHelp(); });
  assert.equal(doc.querySelector('.nui-help-title')!.textContent, 'Raccourcis clavier');
  assert.deepEqual([...doc.querySelectorAll('.nui-help-group-title')].map((el) => el.textContent), ['Ce Space', 'Notis']);
  const frRow = doc.querySelector('[data-shortcut-id="list.next"]')!;
  assert.match(frRow.textContent!, /Élément suivant/);
  assert.equal(frRow.querySelector('.nui-kbd-caps')!.textContent, 'Jou↓');
  assert.match(frRow.querySelector('.nui-sr-only')!.textContent!, /^J ou /);
  assert.equal(doc.querySelector('.nui-help-panel button')!.getAttribute('aria-label'), 'Fermer');
  await act(async () => { press(doc.body, { key: 'Escape' }); });
  assert.equal(sheet(), null, 'Escape closes it');
  await view.unmount();
});

test('Keycap reads per platform and language, with a spoken label', async () => {
  const core = new KeyboardEngineCore({ strict: true });
  const caps = (platform: 'mac' | 'other', locale: 'en' | 'fr') => (
    <KeyboardEngine host="preview" locale={locale} platform={platform} engine={core} document={doc}>
      <Keycap keys="shift+e" />
      <Keycap keys="g i" on="chrome" />
    </KeyboardEngine>
  );
  const view = await mount(caps('mac', 'en'));
  const groups = () => [...doc.querySelectorAll('.nui-kbd-group')];
  assert.deepEqual(groups().map((g) => g.querySelector('.nui-kbd-caps')!.textContent), ['⇧E', 'GthenI']);
  assert.deepEqual(groups().map((g) => g.getAttribute('data-on')), ['surface', 'chrome']);
  assert.equal(groups()[0]!.querySelector('.nui-sr-only')!.textContent, 'Shift E');
  assert.equal(groups()[0]!.querySelector('.nui-kbd-caps')!.getAttribute('aria-hidden'), 'true');
  await view.rerender(caps('other', 'fr'));
  assert.deepEqual(groups().map((g) => g.querySelector('.nui-kbd-caps')!.textContent), ['Maj+E', 'GpuisI']);
  assert.equal(groups()[0]!.querySelector('.nui-sr-only')!.textContent, 'Maj E');
  await view.unmount();
});

test('useToolkitLocale falls back to the document language without a mounted engine', async () => {
  doc.documentElement.lang = 'fr-FR';
  const view = await mount(<Detail />);
  assert.equal(doc.getElementById('detail')!.getAttribute('data-locale'), 'fr');
  await view.unmount();
  doc.documentElement.lang = 'en';
});
