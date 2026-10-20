import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { KeyboardEngineCore } from '../engine/core';
import { KeyboardEngine } from '../engine/KeyboardEngine';
import { Tabs } from '../blocks/Tabs';
import { CalendarView } from './CalendarView';
import { TimelineView } from '../timeline/TimelineView';

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

const CODES: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight', t: 'KeyT', j: 'KeyJ', k: 'KeyK' };

async function press(key: string) {
  await act(async () => {
    const init = { key, code: CODES[key] ?? key, bubbles: true, cancelable: true, composed: true };
    const target = doc.activeElement ?? doc.body;
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', init));
    target.dispatchEvent(new dom.window.KeyboardEvent('keyup', init));
  });
}

async function mount(node: React.ReactNode) {
  doc.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(doc.getElementById('root')!);
  await act(async () => { root.render(node); });
  return { unmount: async () => { await act(async () => { root.unmount(); }); } };
}

// Thursday 15 October 2026.
const TODAY = new Date(2026, 9, 15);

interface Item { id: string; title: string; date: string | null; end?: string }

const ITEMS: Item[] = [
  { id: 'a', title: 'Kickoff', date: '2026-10-02' },
  { id: 'b', title: 'Beta', date: '2026-10-15' },
  { id: 'c', title: 'Review', date: '2026-10-15' },
  { id: 'd', title: 'Launch', date: '2026-10-20' },
  { id: 'n', title: 'Planning', date: '2026-11-18' },
  { id: 'u', title: 'Someday', date: null },
];

const cursor = () => doc.querySelector('[data-cursor]')?.getAttribute('data-nav-id') ?? null;
const title = (selector: string) => doc.querySelector(selector)?.textContent ?? '';

test('calendar keys: T, the arrows, J/K, [ and ], Enter', async () => {
  const core = new KeyboardEngineCore({ platform: 'mac', strict: true });
  const opened: string[] = [];
  const view = await mount(
    <KeyboardEngine host="preview" locale="en" engine={core} document={doc}>
      <CalendarView items={ITEMS} getDate={(i) => i.date} today={TODAY} locale="en"
        onOpen={(i) => { opened.push(i.id); }} />
    </KeyboardEngine>,
  );
  assert.equal(title('.nui-cal-title'), 'October 2026');
  assert.equal(cursor(), null);

  await press('t');
  assert.equal(cursor(), 'b', 'T lands on the first item of today');
  assert.equal(doc.activeElement?.getAttribute('data-nav-id'), 'b', 'focus follows the cursor');

  await press('ArrowRight');
  assert.equal(cursor(), 'd', 'right jumps to the next day with items');
  await press('ArrowLeft');
  assert.equal(cursor(), 'b', 'left jumps back to the first item of that day');
  await press('ArrowLeft');
  assert.equal(cursor(), 'a');

  await press('j');
  assert.equal(cursor(), 'b');
  await press('ArrowDown');
  assert.equal(cursor(), 'c');
  await press('k');
  assert.equal(cursor(), 'b');

  await press('Enter');
  assert.deepEqual(opened, ['b']);

  await press(']');
  assert.equal(title('.nui-cal-title'), 'November 2026');
  assert.equal(cursor(), 'n', 'a step moves the cursor to the first item still shown');
  await press('[');
  await press('[');
  assert.equal(title('.nui-cal-title'), 'September 2026');

  await press('t');
  assert.equal(title('.nui-cal-title'), 'October 2026');
  assert.equal(cursor(), 'b');

  const today = doc.querySelector('.nui-cal-day[data-today]');
  assert.equal(today?.getAttribute('aria-label'), 'Thursday, October 15, 2026, Today');
  assert.equal(doc.querySelectorAll('.nui-cal-tray [data-nav-id]').length, 1, 'the undated item sits in the tray');
  await view.unmount();
});

test('inside Tabs, [ and ] switch tabs; they step the calendar only while focus is inside it', async () => {
  const core = new KeyboardEngineCore({ platform: 'mac', strict: true });
  function Page() {
    const [tab, setTab] = useState<'calendar' | 'list'>('calendar');
    return (
      <Tabs tabs={[{ value: 'calendar', label: 'Calendar' }, { value: 'list', label: 'List' }]} value={tab} onChange={setTab}>
        {tab === 'calendar'
          // No tray: with one, an empty month would hand the cursor to an undated item there (still inside).
          ? <CalendarView items={ITEMS} getDate={(i) => i.date} today={TODAY} locale="en" tray={false} />
          : <p id="list">List</p>}
      </Tabs>
    );
  }
  const view = await mount(<KeyboardEngine host="preview" locale="en" engine={core} document={doc}><Page /></KeyboardEngine>);
  // Focus on the page: the tabs own [ and ].
  await press(']');
  assert.ok(doc.getElementById('list'), '] shows the next tab');
  await press('[');
  assert.equal(title('.nui-cal-title'), 'October 2026', 'back on the calendar, its month unchanged');

  // Focus inside the calendar: [ and ] step its month and the tabs stay put.
  await press('t');
  assert.equal(doc.activeElement?.getAttribute('data-nav-id'), 'b', 'T works from the page and focuses today');
  await press(']');
  assert.equal(title('.nui-cal-title'), 'November 2026');
  assert.ok(!doc.getElementById('list'), 'the tabs did not switch');
  await press(']');
  assert.equal(title('.nui-cal-title'), 'December 2026', 'a month with no items');
  assert.ok(doc.activeElement === doc.querySelector('.nui-cal'), 'focus stays in the calendar when its item went away');
  await press(']');
  assert.equal(title('.nui-cal-title'), 'January 2027', 'so the next ] still steps the month');

  // A click on the calendar puts focus in it (the view takes focus); leaving it hands [ and ] back to the tabs.
  (doc.activeElement as HTMLElement).blur();
  await act(async () => { doc.querySelector<HTMLElement>('.nui-cal')!.focus(); });
  await press('[');
  assert.equal(title('.nui-cal-title'), 'December 2026');
  (doc.activeElement as HTMLElement).blur();
  await press('[');
  assert.ok(doc.getElementById('list'), 'focus on the page again: [ switches tabs');
  await view.unmount();
});

test('calendar speaks French', async () => {
  const core = new KeyboardEngineCore({ platform: 'mac', strict: true });
  const view = await mount(
    <KeyboardEngine host="preview" locale="fr" engine={core} document={doc}>
      <CalendarView items={ITEMS} getDate={(i) => i.date} today={TODAY} locale="fr" />
    </KeyboardEngine>,
  );
  assert.equal(title('.nui-cal-title'), 'Octobre 2026');
  assert.deepEqual([...doc.querySelectorAll('.nui-cal-wd')].slice(0, 3).map((el) => el.textContent), ['Lun', 'Mar', 'Mer']);
  assert.ok([...doc.querySelectorAll('.nui-cal-num')].some((el) => el.textContent === '1er oct.'));
  assert.equal(doc.querySelector('.nui-cal-day[data-today]')?.getAttribute('aria-label'), 'Jeudi 15 octobre 2026, Aujourd’hui');
  await view.unmount();
});

test('narrow month (C5): dots under the chip cap, a short "+N" link with the full words for screen readers', async () => {
  const proto = dom.window.HTMLElement.prototype;
  const before = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 390 });
  const busy: Item[] = ['p', 'q', 'r', 's'].map((id) => ({ id, title: id.toUpperCase(), date: '2026-10-21' }));
  const core = new KeyboardEngineCore({ platform: 'mac', strict: true });
  const view = await mount(
    <KeyboardEngine host="preview" locale="fr" engine={core} document={doc}>
      <CalendarView items={[...busy, { id: 'u', title: 'Someday', date: null }]} getDate={(i) => i.date} today={TODAY} locale="fr" />
    </KeyboardEngine>,
  );
  try {
    assert.ok(doc.querySelector('.nui-cal[data-narrow]'), 'the view is narrow');
    const cell = [...doc.querySelectorAll('.nui-cal-day')].find((el) => el.querySelector('[data-nav-id="p"]'))!;
    assert.equal(cell.querySelectorAll('[data-nav-id]').length, 2, 'two dots show, as two chips would');
    const more = cell.querySelector('.nui-cal-more')!;
    assert.equal(more.textContent, '+2');
    assert.equal(more.getAttribute('aria-label'), '+2 autres');
    await act(async () => { (more as HTMLElement).click(); });
    assert.equal(cell.querySelectorAll('[data-nav-id]').length, 4, 'the link opens every item of the day');
    assert.equal(cell.querySelector('.nui-cal-more')?.textContent, 'Moins');

    // C3/C4: the tray button keeps its word in a span (hidden in narrow by CSS) and the head spaces its words.
    const trayBtn = doc.querySelector('[data-cal-tray]')!;
    assert.equal(trayBtn.querySelector('.nui-cal-tray-word')?.textContent, 'Sans date');
    assert.equal(trayBtn.querySelector('.nui-cal-count')?.textContent, '1');
    const head = doc.querySelector('.nui-cal-tray-head')!;
    assert.deepEqual([...head.children].map((el) => el.textContent), ['Sans date', '1'], 'word and count are separate items, never "Sans date1"');
    assert.deepEqual([...doc.querySelectorAll('.nui-cal-wd')].map((el) => el.textContent), ['L', 'M', 'M', 'J', 'V', 'S', 'D']);
    await act(async () => { (trayBtn as HTMLElement).click(); });
    assert.equal(doc.querySelector('.nui-cal-tray'), null, 'the tray button hides the tray');
  } finally {
    await view.unmount();
    if (before) Object.defineProperty(proto, 'clientWidth', before);
    else delete (proto as { clientWidth?: number }).clientWidth;
  }
});

test('timeline keys: T, J/K, [ and ]', async () => {
  const core = new KeyboardEngineCore({ platform: 'mac', strict: true });
  const items = [
    { id: 'p1', title: 'Search', area: 'core', s: '2026-10-01', e: '2026-10-30' },
    { id: 'p2', title: 'Voice', area: 'core', s: '2026-10-20', e: '2026-11-10' },
    { id: 'p3', title: 'Invoices', area: 'billing', s: '2026-11-02', e: '2026-12-15' },
  ];
  const view = await mount(
    <KeyboardEngine host="preview" locale="en" engine={core} document={doc}>
      <TimelineView items={items} getStart={(i) => i.s} getEnd={(i) => i.e} today={TODAY} locale="en"
        lane={(i) => ({ id: i.area, label: i.area === 'core' ? 'Core' : 'Billing' })} />
    </KeyboardEngine>,
  );
  assert.equal(doc.querySelectorAll('.nui-tl-bar').length, 3);
  await press('t');
  assert.equal(cursor(), 'p1', 'T lands on the bar running today');
  await press('j');
  assert.equal(cursor(), 'p2');
  await press('j');
  assert.equal(cursor(), 'p3');
  await press(']');
  await press(']');
  await press(']');
  await press(']');
  assert.ok(!doc.querySelector('[data-nav-id="p1"]'), 'p1 left the window');
  await press('t');
  assert.equal(cursor(), 'p1');
  const label = doc.querySelector('[data-nav-id="p1"]')?.getAttribute('aria-label');
  assert.equal(label, 'Search, Oct 1 to Oct 30');
  await view.unmount();
});
