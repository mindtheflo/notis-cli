import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { TABROW_WORDS, TabRow, tabPanelProps, type TabRowItem, type TabRowProps } from './Tabs';

const doc = dom.window.document;
let root: Root | null = null;
let engine: KeyboardEngineCore;

async function mount(node: ReactNode, locale: 'en' | 'fr' = 'en') {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  engine = new KeyboardEngineCore();
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale={locale} platform="mac" engine={engine} document={doc} strict>{node}</KeyboardEngine>);
  });
}

async function click(target: Element) {
  await act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
  });
}

const CODES: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight' };

/** A key press on the focused element (the page when nothing has focus). Returns whether it was prevented. */
async function press(key: string): Promise<boolean> {
  const init = { key, code: CODES[key] ?? key, bubbles: true, cancelable: true, composed: true };
  const target = doc.activeElement ?? doc.body;
  let prevented = false;
  await act(async () => {
    const down = new dom.window.KeyboardEvent('keydown', init);
    target.dispatchEvent(down);
    prevented = down.defaultPrevented;
    target.dispatchEvent(new dom.window.KeyboardEvent('keyup', init));
  });
  return prevented;
}

const q = <E extends Element = HTMLElement>(selector: string) => doc.querySelector<E & Element>(selector);
const pills = () => [...doc.querySelectorAll<HTMLElement>('.nui-tabrow-strip > .nui-pill')];
const pillIds = () => pills().map((pill) => pill.dataset.itemId);
const focused = () => (doc.activeElement as HTMLElement | null)?.dataset.itemId ?? null;

type Id = 'inbox' | 'later' | 'waiting' | 'done' | 'spam';
const ITEMS: TabRowItem<Id>[] = [
  { id: 'inbox', label: { en: 'Inbox', fr: 'Boîte de réception' }, count: 3 },
  { id: 'later', label: 'Later', disabled: true },
  { id: 'waiting', label: 'Waiting', count: 12 },
  { id: 'done', label: { en: 'Done', fr: 'Terminé' }, count: 0, icon: 'check' },
  { id: 'spam', label: 'Spam' },
];

function Harness({ start = 'inbox', seen, ...props }: Omit<TabRowProps<Id>, 'value' | 'onChange' | 'items'>
  & { start?: Id; seen?: Id[]; items?: readonly TabRowItem<Id>[] }) {
  const [value, setValue] = useState<Id>(start);
  return (
    <>
      <TabRow items={ITEMS} {...props} value={value} onChange={(next) => { seen?.push(next); setValue(next); }} />
      {props.id !== undefined && <div {...tabPanelProps(props.id, value)}>{value}</div>}
    </>
  );
}

test('TabRow role tabs: a tablist of pills with counts; with an id each pill controls its panel', async () => {
  await mount(<Harness role="tabs" id="mail" />, 'fr');
  const strip = q('.nui-tabrow-strip')!;
  assert.equal(strip.getAttribute('role'), 'tablist');
  assert.equal(strip.getAttribute('aria-orientation'), 'horizontal');
  assert.equal(strip.getAttribute('aria-label'), 'Vues', 'named "Views" by default');
  const [inbox, later, waiting, done] = pills();
  assert.deepEqual(pills().map((pill) => pill.getAttribute('role')), ['tab', 'tab', 'tab', 'tab', 'tab']);
  assert.deepEqual(pills().map((pill) => pill.getAttribute('aria-selected')), ['true', 'false', 'false', 'false', 'false']);
  assert.deepEqual(pills().map((pill) => pill.tabIndex), [0, -1, -1, -1, -1], 'roving tab stop');
  assert.equal(inbox!.querySelector('.nui-pill-label')?.textContent, 'Boîte de réception');
  assert.equal(inbox!.querySelector('.nui-pill-count')?.textContent, '3');
  assert.equal(done!.querySelector('.nui-pill-count')?.textContent, '0', 'a count of 0 still shows');
  assert.equal(waiting!.querySelector('.nui-pill-count')?.textContent, '12');
  assert.ok(done!.querySelector('svg.nui-icon'), 'an icon name draws its icon');
  assert.equal((later as HTMLButtonElement).disabled, true);
  assert.ok(inbox!.hasAttribute('data-on') && !waiting!.hasAttribute('data-on'), 'the active pill is marked for its tint');
  const panel = q('[role="tabpanel"]')!;
  assert.equal(inbox!.getAttribute('aria-controls'), panel.id);
  assert.equal(panel.getAttribute('aria-labelledby'), inbox!.id);

  await click(waiting!);
  assert.equal(q('[role="tabpanel"]')!.textContent, 'waiting');
  assert.equal(q('[role="tabpanel"]')!.getAttribute('aria-labelledby'), waiting!.id);
  assert.deepEqual(pills().map((pill) => pill.tabIndex), [-1, -1, 0, -1, -1]);

  // Without an id the pills control nothing the row knows of.
  await mount(<Harness role="tabs" />);
  assert.equal(q('.nui-tabrow-strip')!.getAttribute('aria-label'), 'Views');
  assert.ok(pills().every((pill) => !pill.hasAttribute('aria-controls')));
});

test('TabRow role filter: a radio group; all four arrows, Home and End choose and focus, skipping a disabled pill', async () => {
  const seen: Id[] = [];
  await mount(<Harness role="filter" seen={seen} />, 'fr');
  const strip = q('.nui-tabrow-strip')!;
  assert.equal(strip.getAttribute('role'), 'radiogroup');
  assert.equal(strip.hasAttribute('aria-orientation'), false);
  assert.equal(strip.getAttribute('aria-label'), TABROW_WORDS.filters.fr);
  assert.deepEqual(pills().map((pill) => pill.getAttribute('role')), ['radio', 'radio', 'radio', 'radio', 'radio']);
  assert.deepEqual(pills().map((pill) => pill.getAttribute('aria-checked')), ['true', 'false', 'false', 'false', 'false']);
  assert.ok(pills().every((pill) => !pill.id && !pill.hasAttribute('aria-selected') && !pill.hasAttribute('aria-controls')));

  pills()[0]!.focus();
  assert.equal(await press('ArrowRight'), true);
  assert.deepEqual([seen.at(-1), focused()], ['waiting', 'waiting'], 'the disabled pill is skipped');
  await press('ArrowDown');
  assert.deepEqual([seen.at(-1), focused()], ['done', 'done']);
  await press('ArrowUp');
  assert.deepEqual([seen.at(-1), focused()], ['waiting', 'waiting']);
  await press('End');
  assert.deepEqual([seen.at(-1), focused()], ['spam', 'spam']);
  await press('ArrowRight');
  assert.deepEqual([seen.at(-1), focused()], ['inbox', 'inbox'], 'the arrows wrap round');
  await press('ArrowLeft');
  await press('Home');
  assert.deepEqual([seen.at(-1), focused()], ['inbox', 'inbox']);
  assert.equal(q('.nui-pill[aria-checked="true"]')?.dataset.itemId, 'inbox');

  // A tab list leaves the up and down arrows to the page.
  await mount(<Harness role="tabs" seen={seen} />);
  pills()[0]!.focus();
  const before = seen.length;
  assert.equal(await press('ArrowDown'), false);
  assert.equal(seen.length, before);
});

test('TabRow overflow: maxVisible moves the rest into a More menu; the active pill always shows in the strip', async () => {
  const seen: Id[] = [];
  await mount(<Harness role="tabs" maxVisible={3} seen={seen} />);
  assert.deepEqual(pillIds(), ['inbox', 'later', 'waiting']);
  const more = q('.nui-tabrow > .nui-tabrow-more')!;
  assert.equal(more.textContent, 'More');
  assert.equal(more.closest('[role="tablist"]'), null, 'the More pill sits outside the tab list, in the tab order');
  assert.equal(more.getAttribute('aria-haspopup'), 'menu');

  await click(more);
  const menu = q('[role="menu"]')!;
  assert.equal(menu.getAttribute('aria-label'), 'Show more');
  const entries = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(entries.map((entry) => entry.querySelector('.nui-menu-label')?.textContent ?? entry.textContent),
    ['Done0', 'Spam']);
  assert.equal(entries[0]!.querySelector('.nui-tabrow-menu-count')?.textContent, '0');

  // A pill chosen from the menu takes the last place in the strip and the focus.
  await click(entries[1]!);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(seen, ['spam']);
  assert.equal(q('[role="menu"]'), null, 'choosing closes the menu');
  assert.deepEqual(pillIds(), ['inbox', 'later', 'spam']);
  assert.equal(q('.nui-pill[aria-selected="true"]')?.dataset.itemId, 'spam');
  assert.equal(focused(), 'spam');

  // Opening on a pill past the cut shows it in the last place.
  await mount(<Harness role="filter" maxVisible={2} start="done" />, 'fr');
  assert.deepEqual(pillIds(), ['inbox', 'done']);
  assert.equal(q('.nui-tabrow-more')!.textContent, TABROW_WORDS.more.fr);
  await click(q('.nui-tabrow-more')!);
  assert.equal(q('[role="menu"]')!.getAttribute('aria-label'), 'Afficher plus');
  assert.deepEqual([...doc.querySelectorAll('[role="menuitem"]')].map((entry) => entry.hasAttribute('disabled')
    || entry.getAttribute('aria-disabled') === 'true'), [true, false, false], 'a disabled item stays disabled in the menu');

  // Folded to one pill and More, the row says so (a section's tabs slot then keeps that width and scrolls).
  assert.equal(q('.nui-tabrow')!.dataset.fold, undefined, 'two pills shown: not the least fold');
  await mount(<Harness role="filter" maxVisible={1} start="done" />);
  assert.deepEqual(pillIds(), ['done']);
  assert.equal(q('.nui-tabrow')!.dataset.fold, 'least');

  // Room for every pill: no menu.
  await mount(<Harness role="tabs" maxVisible={5} />);
  assert.equal(pills().length, 5);
  assert.equal(q('.nui-tabrow-more'), null);
  assert.equal(q('.nui-tabrow')!.dataset.fold, undefined);
});

test('TabRow keys: [ and ] step through every item when asked, a hidden one included; lead first, end pinned last', async () => {
  const seen: Id[] = [];
  await mount(
    <Harness role="tabs" keys maxVisible={3} seen={seen} inset="page"
      lead={<span id="lead">Mail</span>} end={<button type="button" id="create">+</button>} />,
  );
  const row = q('.nui-tabrow')!;
  assert.equal(row.dataset.inset, 'page');
  assert.equal(row.firstElementChild?.id, 'lead');
  assert.deepEqual([...row.children].map((child) => child.className || child.id),
    ['lead', 'nui-tabrow-tabs', 'nui-pill nui-tabrow-more', 'nui-tabrow-end']);
  assert.equal(row.lastElementChild?.querySelector('#create')?.textContent, '+');

  await press(']');
  assert.deepEqual(seen, ['waiting'], 'the disabled pill is skipped');
  await press(']');
  assert.deepEqual(seen, ['waiting', 'done']);
  assert.deepEqual(pillIds(), ['inbox', 'later', 'done'], 'a hidden item comes into the strip once active');
  assert.equal(doc.activeElement, doc.body, 'page keys leave focus where it was');
  await press('[');
  assert.deepEqual(seen, ['waiting', 'done', 'waiting']);
  const ids = engine.registry.all().map((entry) => entry.def.id);
  assert.ok(ids.includes('view.prev') && ids.includes('view.next'), 'listed in the ? sheet');

  // Off by default: a second row on the page would clash with the first.
  await mount(<Harness role="filter" seen={seen} />);
  assert.equal(q('.nui-tabrow')!.hasAttribute('data-inset'), false);
  const count = seen.length;
  await press(']');
  assert.equal(seen.length, count);
  assert.ok(!engine.registry.all().some((entry) => entry.def.id === 'view.next'));
});

test('TabRow fold: the pills the row has no room for go into More, the active one kept; a wider row takes them back', async () => {
  // 80px pills and a 72px More pill in a row of `room` px (no padding or gaps in jsdom).
  let room = 300;
  const proto = dom.window.HTMLElement.prototype;
  const saved = ['offsetWidth', 'clientWidth'].map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);
  Object.defineProperty(proto, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.dataset.itemId !== undefined ? 80 : this.classList.contains('nui-tabrow-more') ? 72 : 0; },
  });
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true, get(this: HTMLElement) { return this.classList.contains('nui-tabrow') ? room : 0; },
  });
  try {
    const seen: Id[] = [];
    await mount(<Harness role="filter" start="spam" seen={seen} />, 'fr');
    // 300 - 72 leaves room for two pills: the first one, then the active one in the last place.
    assert.deepEqual(pillIds(), ['inbox', 'spam']);
    assert.equal(q('.nui-tabrow-more')!.textContent, TABROW_WORDS.more.fr);
    await click(q('.nui-tabrow-more')!);
    assert.deepEqual([...doc.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((entry) =>
      entry.querySelector('.nui-menu-label')?.textContent ?? entry.textContent), ['Later', 'Waiting12', 'Terminé0']);

    // Picked from More, a pill takes the last place.
    await click([...doc.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!);
    assert.deepEqual(seen, ['waiting']);
    assert.deepEqual(pillIds(), ['inbox', 'waiting']);

    // Room for all five: no More. maxVisible still caps a wide row.
    room = 400;
    await click(pills()[0]!);
    assert.deepEqual(pillIds(), ['inbox', 'later', 'waiting', 'done', 'spam']);
    assert.equal(q('.nui-tabrow-more'), null);
    await mount(<Harness role="tabs" maxVisible={3} />);
    assert.deepEqual(pillIds(), ['inbox', 'later', 'waiting']);
    assert.equal(q('.nui-tabrow-strip > .nui-tabrow-step'), null, 'no carets and no paging');
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
  }
});

test('TabRow fold: an active pill with no room even beside More stays in the strip, shrunk; a wider row takes pills back', async () => {
  // 80px pills and a 72px More pill. Below 152px the active pill, alone in the strip, is squeezed: its label is cut and
  // it draws 40px wide.
  let room = 120;
  const proto = dom.window.HTMLElement.prototype;
  const names = ['offsetWidth', 'clientWidth', 'scrollWidth'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);
  const squeezed = (pill: HTMLElement | null) => !!pill && pill.parentElement?.children.length === 1 && room < 152;
  Object.defineProperty(proto, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.itemId !== undefined) return squeezed(this) ? 40 : 80;
      return this.classList.contains('nui-tabrow-more') ? 72 : 0;
    },
  });
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains('nui-tabrow')) return room;
      return this.classList.contains('nui-pill-label') ? (squeezed(this.parentElement) ? 20 : 60) : 0;
    },
  });
  Object.defineProperty(proto, 'scrollWidth', {
    configurable: true, get(this: HTMLElement) { return this.classList.contains('nui-pill-label') ? 60 : 0; },
  });
  try {
    await mount(<Harness role="filter" start="spam" />);
    assert.deepEqual(pillIds(), ['spam'], 'the active pill stays in the strip, never only in More');
    assert.ok(q('.nui-tabrow-more'));
    assert.equal(q('.nui-tabrow')!.dataset.fold, 'least');

    // A row with room for two pills (not three) shows exactly two once the squeezed pill is drawn whole again.
    room = 280;
    await act(async () => {
      root!.render(<KeyboardEngine host="preview" locale="en" platform="mac" engine={engine} document={doc} strict>
        <Harness role="filter" start="spam" label="Mail" />
      </KeyboardEngine>);
    });
    assert.deepEqual(pillIds(), ['inbox', 'spam']);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
  }
});

test('TabRow fold: a squeezed long active pill beside a hidden pill narrower than More settles (180/200/40/60 px)', async () => {
  // A 180px row, a 200px active pill, a 40px other pill and a 60px More pill. Alone beside More the active pill is
  // squeezed to 120px with its label cut; the row must keep its whole 200px width and stay folded.
  const room = 180;
  const proto = dom.window.HTMLElement.prototype;
  const names = ['offsetWidth', 'clientWidth', 'scrollWidth'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);
  const squeezed = (pill: HTMLElement | null) => !!pill && pill.dataset.itemId === 'long'
    && pill.parentElement?.children.length === 1;
  Object.defineProperty(proto, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.itemId === 'long') return squeezed(this) ? 120 : 200;
      if (this.dataset.itemId === 'short') return 40;
      return this.classList.contains('nui-tabrow-more') ? 60 : 0;
    },
  });
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains('nui-tabrow')) return room;
      if (!this.classList.contains('nui-pill-label')) return 0;
      if (this.parentElement?.dataset.itemId === 'long') return squeezed(this.parentElement) ? 100 : 180;
      return 24;
    },
  });
  Object.defineProperty(proto, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains('nui-pill-label')) return 0;
      return this.parentElement?.dataset.itemId === 'long' ? 180 : 24;
    },
  });
  type TwoId = 'long' | 'short';
  const items: TabRowItem<TwoId>[] = [{ id: 'long', label: 'A very long active filter' }, { id: 'short', label: 'B' }];
  function Two() {
    const [value, setValue] = useState<TwoId>('long');
    return <TabRow role="filter" items={items} value={value} onChange={setValue} />;
  }
  try {
    await mount(<Two />);
    assert.deepEqual(pillIds(), ['long'], 'the active pill stays, squeezed, with the other one in More');
    assert.ok(q('.nui-tabrow-more'));
    assert.equal(q('.nui-tabrow')!.dataset.fold, 'least');
    // Settled: another frame changes nothing (an unsettled row unfolds and folds until React gives up).
    const strip = q('.nui-tabrow-strip')!;
    let changes = 0;
    const observer = new dom.window.MutationObserver((records) => { changes += records.length; });
    observer.observe(q('.nui-tabrow')!, { childList: true, subtree: true });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    observer.disconnect();
    assert.equal(changes, 0, 'no pill comes or goes once folded');
    assert.equal(strip.isConnected, true);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
  }
});

const toolkitCss = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');

/** The declarations of the rule written exactly as `selector {` at the start of a line (indented in a media block). */
function cssRule(selector: string): string | null {
  const at = toolkitCss.search(new RegExp(`\\n *${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`));
  if (at < 0) return null;
  const open = toolkitCss.indexOf('{', at);
  return toolkitCss.slice(open + 1, toolkitCss.indexOf('}', open)).trim();
}

test('TabRow CSS: a 44px row that never wraps, 28px tinted pills with no line or edge, page inset 20 (12 on a phone)', () => {
  const row = cssRule('.nui-tabrow') ?? '';
  assert.match(row, /height: 44px;/);
  assert.match(row, /white-space: nowrap;/);
  assert.match(row, /padding: 0 8px 0 6px;/);
  assert.match(row, /border-bottom: 1px solid hsl\(var\(--border\) \/ \.5\);/);
  assert.doesNotMatch(row, /flex-wrap: wrap/);
  assert.match(cssRule('.nui-tabrow[data-inset="page"]') ?? '', /padding: 0 20px;/);
  const phone = toolkitCss.slice(toolkitCss.indexOf('.nui-tabrow[data-inset="page"] { padding: 0 20px; }'));
  assert.match(phone, /@media \(max-width: 639px\) \{\n {2}\.nui-tabrow \{ padding: 0 8px; \}\n {2}\.nui-tabrow\[data-inset="page"\] \{ padding: 0 12px; \}/);
  assert.match(cssRule('.nui-tabrow-strip') ?? '', /overflow: hidden;/, 'a long strip folds into More, it never scrolls');
  assert.match(cssRule('.nui-tabrow-strip > .nui-pill[data-on]:only-child') ?? '', /flex-shrink: 1; min-width: 0;/,
    'the active pill alone beside More shrinks instead of being cut off');
  assert.match(cssRule('.nui-tabrow-strip > .nui-pill[data-on]:only-child > .nui-pill-label') ?? '',
    /min-width: 0; overflow: hidden; text-overflow: ellipsis;/);
  assert.match(cssRule('.nui-tabrow-end') ?? '', /margin-left: auto;/);

  const pill = cssRule('.nui-pill, .nui-tab, .nui-seg > button') ?? '';
  assert.match(pill, /height: 28px; padding: 0 8px; border: 0; border-radius: 6px;/);
  assert.match(cssRule('.nui-pill-count, .nui-tab-count, .nui-seg-count') ?? '', /font-size: 12px;.*font-variant-numeric: tabular-nums;/);
  assert.doesNotMatch(toolkitCss, /\.nui-(pill|tab|tabrow)[^{\n]*::(after|before)/, 'no underline drawn under the active pill');
  for (const [, selector, body] of toolkitCss.matchAll(/\n *([^\n{}]*\.nui-(?:pill|tab\b|tabrow)[^\n{}]*) \{([^}]*)\}/g)) {
    assert.doesNotMatch(body, /border-(left|right|top)|box-shadow: inset (?!0 0 0 1px)/, `no edge on one side: ${selector}`);
  }
  assert.doesNotMatch(toolkitCss, /nui-tabrow-step|mask-image: var\(--nui-tabrow/, 'no carets or fades');
});
