import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore, ShortcutScope, useShortcut } from '../engine';
import { FieldText } from '../fields';
import { Menu } from './Menu';
import { Popover } from './Popover';
import { LAYER_ROOT_ATTRIBUTE, findLayerRoot } from './layerRoot';

const doc = dom.window.document;

let root: Root | null = null;

/** Mounts `node` inside a shadow root, as a Space view is: host, shadow root, app root. */
async function mountInShadow(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="host"></div>';
  const shadow = doc.getElementById('host')!.attachShadow({ mode: 'open' });
  const app = doc.createElement('div');
  app.setAttribute('data-notis-app-root', '');
  shadow.appendChild(app);
  const mountPoint = doc.createElement('div');
  app.appendChild(mountPoint);
  root = createRoot(mountPoint);
  const engine = new KeyboardEngineCore();
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale="en" platform="mac" engine={engine} document={doc} strict>{node}</KeyboardEngine>);
  });
  return { shadow, app, engine };
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
  });
}

async function press(target: EventTarget, key: string) {
  const init = {
    key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, composed: true,
  };
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', init));
    target.dispatchEvent(new dom.window.KeyboardEvent('keyup', init));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

function PageKey({ onKey }: { onKey: () => void }) {
  useShortcut({ id: 'test.e', keys: 'e', scope: 'collection', label: { en: 'E', fr: 'E' }, run: () => { onKey(); } });
  return null;
}

test('findLayerRoot: the page body in the document, one shared layer root inside a shadow root', () => {
  doc.body.innerHTML = '<p id="plain"></p><div id="host"></div>';
  assert.equal(findLayerRoot(doc.getElementById('plain')), doc.body);
  const shadow = doc.getElementById('host')!.attachShadow({ mode: 'open' });
  const app = doc.createElement('div');
  app.setAttribute('data-notis-app-root', '');
  const inner = doc.createElement('span');
  app.appendChild(inner);
  shadow.appendChild(app);
  const layer = findLayerRoot(inner)!;
  assert.equal(layer.getRootNode(), shadow);
  assert.equal(layer.parentElement, app, 'inside the app root, so it inherits the theme');
  assert.ok(layer.hasAttribute(LAYER_ROOT_ATTRIBUTE));
  assert.ok(layer.classList.contains('nui-layer'));
  assert.equal(findLayerRoot(inner), layer, 'reused, not created twice');
});

test('a field menu stays in its native dialog top layer and outside menus keep their own root', async () => {
  const chosen: string[] = [];
  const { shadow } = await mountInShadow(<>
    <button id="outside">Outside</button>
    <dialog open id="details">
      <Menu label="Status" trigger={<button id="status">Inbox</button>}>
        <Menu.Item onSelect={() => chosen.push('Planned')}>Planned</Menu.Item>
      </Menu>
    </dialog>
  </>);
  const outsideLayer = findLayerRoot(shadow.getElementById('outside'));
  await click(shadow.getElementById('status')!);
  const menu = shadow.querySelector('[role="menu"]')!;
  assert.ok(shadow.getElementById('details')!.contains(menu), 'native showModal makes nodes outside the dialog inert');
  assert.notEqual(menu.parentElement, outsideLayer);
  await click(menu.querySelector('[role="menuitem"]')!);
  assert.deepEqual(chosen, ['Planned']);
  assert.equal(findLayerRoot(shadow.getElementById('outside')), outsideLayer);
});

test('Menu inside a shadow root: opens in the layer root, arrows move, Enter selects, Escape closes', async () => {
  const chosen: string[] = [];
  let pageKeys = 0;
  const { shadow } = await mountInShadow(
    <>
      <PageKey onKey={() => { pageKeys += 1; }} />
      <Menu label="Row actions" trigger={<button type="button" id="trigger">More</button>}>
        <Menu.Item onSelect={() => chosen.push('rename')}>Rename</Menu.Item>
        <Menu.Item onSelect={() => chosen.push('delete')} tone="danger">Delete</Menu.Item>
      </Menu>
    </>,
  );
  const trigger = shadow.getElementById('trigger')!;
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
  await press(doc.body, 'e');
  assert.equal(pageKeys, 1, 'page keys work before the menu opens');
  pageKeys = 0;
  await click(trigger);
  const menu = shadow.querySelector<HTMLElement>('[role="menu"]');
  assert.ok(menu, 'the menu renders inside the shadow root');
  assert.equal(doc.body.querySelector('[role="menu"]'), null, 'never in the page body');
  assert.ok(menu!.parentElement!.hasAttribute(LAYER_ROOT_ATTRIBUTE));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(menu!.getAttribute('aria-label'), 'Row actions');
  assert.notEqual(menu!.style.visibility, 'hidden', 'measured once its layer root exists, so it shows');

  // Page keys rest while the menu is open (a modal layer).
  await press(menu!, 'e');
  assert.equal(pageKeys, 0);

  const items = [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(items.map((item) => item.textContent?.trim()), ['Rename', 'Delete']);
  items[0]!.focus();
  await press(items[0]!, 'ArrowDown');
  assert.equal(shadow.activeElement, items[1]);
  await press(items[1]!, 'Enter');
  await click(items[1]!);
  assert.ok(chosen.includes('delete'));
  assert.equal(shadow.querySelector('[role="menu"]'), null, 'selecting closes the menu');

  await click(trigger);
  const reopened = shadow.querySelector<HTMLElement>('[role="menu"]')!;
  await press(reopened, 'Escape');
  assert.equal(shadow.querySelector('[role="menu"]'), null, 'Escape closes it');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  await press(doc.body, 'e');
  assert.equal(pageKeys, 1, 'page keys work again once it closed');
});

/** A real press on `element`: pointerdown and mousedown, then the click. */
async function pressPointer(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
    element.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
  });
  await click(element);
}

// On a first open the layer root arrives a render after `open`: the panel must still count as the menu's own.
function StatusMenu({ chosen }: { chosen: string[] }) {
  return (
    <Menu label="Status" trigger={<button type="button" id="status">Status</button>}>
      <Menu.Item checked onSelect={() => chosen.push('on')}>On</Menu.Item>
      <Menu.Item checked={false} onSelect={() => chosen.push('off')}>Off</Menu.Item>
    </Menu>
  );
}

test('Menu on its first open from the keyboard: the first item takes focus', async () => {
  const { shadow } = await mountInShadow(<StatusMenu chosen={[]} />);
  await press(shadow.getElementById('status')!, 'ArrowDown');
  const items = [...shadow.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
  assert.deepEqual(items.map((item) => item.textContent?.trim()), ['On', 'Off']);
  // Compared by text: a failed comparison of two DOM nodes makes node:test walk the whole document.
  assert.equal(shadow.activeElement?.textContent?.trim(), 'On');
});

test('Menu on its first open: pressing an item chooses it instead of dismissing the menu', async () => {
  const chosen: string[] = [];
  const { shadow } = await mountInShadow(<StatusMenu chosen={chosen} />);
  const trigger = shadow.getElementById('status')!;
  await pressPointer(trigger);
  const off = [...shadow.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((item) => item.textContent?.trim() === 'Off');
  assert.ok(off, 'the menu opened');
  await pressPointer(off!);
  assert.deepEqual(chosen, ['off'], 'a press inside the menu is not a press outside it');
  assert.ok(shadow.querySelector('[role="menu"]') === null, 'choosing closes the menu');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('Popover inside a shadow root: renders in the same layer root and closes on an outside click', async () => {
  const { shadow, app } = await mountInShadow(
    <>
      <p id="outside">Outside</p>
      <Popover label="Filters" trigger={<button type="button" id="open">Filters</button>}
        content={<label>Owner <input id="owner" /></label>} />
    </>,
  );
  await click(shadow.getElementById('open')!);
  const panel = shadow.getElementById('owner')?.closest<HTMLElement>(`[${LAYER_ROOT_ATTRIBUTE}] > *`);
  assert.ok(panel, 'the panel sits in the layer root');
  assert.equal(panel!.parentElement!.parentElement, app);
  assert.notEqual(panel!.style.visibility, 'hidden', 'measured once its layer root exists, so it shows');
  await act(async () => {
    shadow.getElementById('outside')!.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, composed: true }));
    shadow.getElementById('outside')!.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, composed: true }));
  });
  assert.equal(shadow.getElementById('owner'), null);
});

/** Lets the panel's open frame (its first focus) run. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

test('Popover: Escape in a field inside it closes it and focus goes back to the trigger; a field with its own open list keeps Escape', async () => {
  const { shadow } = await mountInShadow(
    <Popover label="Filters" trigger={<button type="button" id="open">Filters</button>}
      content={(
        <>
          <input id="combo" role="combobox" aria-expanded="true" aria-controls="combo-list" />
          <label>Owner <input id="owner" /></label>
        </>
      )} />,
  );
  await click(shadow.getElementById('open')!);
  await settle();
  const combo = shadow.getElementById('combo')!;
  combo.focus();
  await press(combo, 'Escape');
  assert.ok(shadow.getElementById('combo') !== null, 'a combobox with its list open keeps its Escape');
  const owner = shadow.getElementById('owner')!;
  owner.focus();
  await press(owner, 'Escape');
  assert.ok(shadow.getElementById('owner') === null, 'Escape in a plain field closes the popover');
  assert.equal(shadow.activeElement?.id, 'open', 'focus is back on the trigger');
  assert.equal(shadow.getElementById('open')!.getAttribute('aria-expanded'), 'false');
});

test('FieldText in a modal Popover: Escape closes the popover and focus goes back to the trigger, not the page body', async () => {
  let typed = '';
  const { shadow } = await mountInShadow(
    <Popover modal label="Rename" trigger={<button type="button" id="rename">Rename</button>}
      content={<FieldText label="Name" value="Weekly digest" onChange={(value) => { typed = value; }} />} />,
  );
  await click(shadow.getElementById('rename')!);
  await settle();
  const input = shadow.querySelector<HTMLInputElement>('.nui-popover input')!;
  assert.ok(input, 'the field renders in the popover');
  input.focus();
  await press(input, 'Escape');
  assert.ok(shadow.querySelector('.nui-popover') === null, 'Escape closed the popover');
  assert.equal(shadow.activeElement?.id, 'rename', 'focus is on the trigger');
  assert.ok(doc.activeElement !== doc.body, 'focus never falls to the page body');
  assert.equal(typed, '', 'the field value is untouched');
});

// ---- menu accelerators: item keys while the menu is closed ----

const ACCELERATOR = 'notis.menu-key:';
const acceleratorIds = (engine: KeyboardEngineCore) =>
  engine.registry.all().map((entry) => entry.def.id).filter((id) => id.startsWith(ACCELERATOR));

function PageShortcut({ id, keys, when, onKey }: { id: string; keys: string; when?: () => boolean; onKey: () => void }) {
  useShortcut({ id, keys, scope: 'route', when, label: { en: id, fr: id }, run: () => { onKey(); } });
  return null;
}

/** A menu with one keyed item; its trigger takes the menu's name as id. */
function KeyedMenu({ name, keys, onKey, accelerators, triggerDisabled }: {
  name: string; keys: string; onKey: () => void; accelerators?: boolean; triggerDisabled?: boolean;
}) {
  return (
    <Menu label={name} accelerators={accelerators}
      trigger={<button type="button" id={name} disabled={triggerDisabled}>{name}</button>}>
      <Menu.Item keys={keys} onSelect={() => { onKey(); }}>{name}</Menu.Item>
    </Menu>
  );
}

test('Menu accelerators: closed, an item key chooses the item with no event; disabled items and triggers stay silent; not in the help sheet', async () => {
  const chosen: string[] = [];
  const events: unknown[] = [];
  const { shadow, engine } = await mountInShadow(
    <>
      <Menu label="Ticket" trigger={<button type="button" id="trigger">More</button>}>
        <Menu.Item keys="r" onSelect={(event) => { chosen.push('rename'); events.push(event); }}>Rename</Menu.Item>
        <Menu.Item keys="x" disabled onSelect={() => { chosen.push('archive'); }}>Archive</Menu.Item>
      </Menu>
      <KeyedMenu name="locked" keys="o" triggerDisabled onKey={() => { chosen.push('locked'); }} />
    </>,
  );
  await press(doc.body, 'r');
  assert.deepEqual(chosen, ['rename'], 'the key chose the item with the menu closed');
  assert.equal(events[0], undefined, 'no event: a key chose it');
  await press(doc.body, 'x');
  await press(doc.body, 'o');
  assert.deepEqual(chosen, ['rename'], 'a disabled item and a disabled trigger stay silent');
  assert.equal(acceleratorIds(engine).length, 6, 'each key at route and at modal scope');
  assert.ok(!engine.registry.helpEntries().some((row) => row.id.startsWith(ACCELERATOR)), 'the menu shows them, the help sheet does not');

  // Open, the menu answers the key itself, once.
  await click(shadow.getElementById('trigger')!);
  const item = shadow.querySelector<HTMLElement>('[role="menuitem"]')!;
  item.focus();
  await press(item, 'r');
  assert.deepEqual(chosen, ['rename', 'rename'], 'chosen once while open');
  assert.ok(events[1] !== undefined, 'by its click');
  assert.equal(shadow.querySelector('[role="menu"]'), null, 'choosing closed the menu');
});

test('Menu accelerators come last: a page key on the same key, a sequence starting with it; a hidden trigger and accelerators={false} register or answer nothing', async () => {
  const chosen: string[] = [];
  const { engine } = await mountInShadow(
    <>
      <PageKey onKey={() => { chosen.push('page e'); }} />
      <PageShortcut id="test.r" keys="r" onKey={() => { chosen.push('page r'); }} />
      <PageShortcut id="test.n" keys="n" when={() => false} onKey={() => { chosen.push('page n'); }} />
      <PageShortcut id="test.gi" keys="g i" onKey={() => { chosen.push('page g i'); }} />
      <Menu label="Ticket" trigger={<button type="button" id="trigger">More</button>}>
        <Menu.Item keys="e" onSelect={() => { chosen.push('menu e'); }}>Complete</Menu.Item>
        <Menu.Item keys="r" onSelect={() => { chosen.push('menu r'); }}>Rename</Menu.Item>
        <Menu.Item keys="n" onSelect={() => { chosen.push('menu n'); }}>Note</Menu.Item>
        <Menu.Item keys="g" onSelect={() => { chosen.push('menu g'); }}>Go</Menu.Item>
      </Menu>
      <div hidden><KeyedMenu name="hidden" keys="h" onKey={() => { chosen.push('hidden'); }} /></div>
      <KeyedMenu name="row" keys="w" accelerators={false} onKey={() => { chosen.push('row'); }} />
    </>,
  );
  await press(doc.body, 'e');
  assert.deepEqual(chosen, ['page e'], 'a collection key on the same key goes first');
  await press(doc.body, 'r');
  assert.deepEqual(chosen.slice(1), ['page r'], 'so does a route key, even one the engine asks after the menu');
  await press(doc.body, 'n');
  assert.deepEqual(chosen.slice(2), ['menu n'], 'a page key whose when says no leaves the key to the menu');
  await press(doc.body, 'g');
  await press(doc.body, 'i');
  assert.deepEqual(chosen.slice(3), ['page g i'], 'a sequence starting with the key goes first');
  await press(doc.body, 'h');
  await press(doc.body, 'w');
  assert.deepEqual(chosen.slice(4), [], 'a hidden trigger and accelerators={false} leave their keys alone');
  assert.equal(acceleratorIds(engine).length, 10, 'four keys of the ticket menu and one of the hidden menu, none of the row menu');
});

test('Menu accelerators in a dialog: modal scope while the key comes from that dialog and no other menu is open; a page menu rests', async () => {
  const chosen: string[] = [];
  const { shadow } = await mountInShadow(
    <>
      <KeyedMenu name="page" keys="p" onKey={() => { chosen.push('page'); }} />
      <div role="dialog" aria-modal="true" id="editor">
        <button type="button" id="in-editor">Field</button>
        <KeyedMenu name="editor-menu" keys="r" onKey={() => { chosen.push('editor'); }} />
        <Menu label="Other" trigger={<button type="button" id="other">Other</button>}>
          <Menu.Item onSelect={() => {}}>Copy</Menu.Item>
        </Menu>
      </div>
      <div role="dialog" aria-modal="true" id="confirm">
        <button type="button" id="in-confirm">OK</button>
      </div>
    </>,
  );
  await press(doc.body, 'p');
  assert.deepEqual(chosen, [], 'the page menu rests while a dialog is open');
  await press(shadow.getElementById('in-editor')!, 'r');
  assert.deepEqual(chosen, ['editor'], 'a key from inside the dialog');
  await press(doc.body, 'r');
  assert.deepEqual(chosen, ['editor', 'editor'], 'a key with nothing focused');
  await press(shadow.getElementById('in-confirm')!, 'r');
  assert.deepEqual(chosen, ['editor', 'editor'], 'not a key from another dialog');
  await click(shadow.getElementById('other')!);
  assert.ok(shadow.querySelector('[role="menu"]'), 'the other menu is open');
  await press(doc.body, 'r');
  assert.deepEqual(chosen, ['editor', 'editor'], 'an open menu has the keys');
});

test('Menu accelerators in a Space: keys Notis keeps are left out without a clash; two menus on one key do not clash, the later one answers', async () => {
  const chosen: string[] = [];
  const { engine } = await mountInShadow(
    <ShortcutScope owner="space:tickets" available>
      <Menu label="One" trigger={<button type="button" id="one">One</button>}>
        <Menu.Item keys="c" onSelect={() => { chosen.push('one c'); }}>Copy</Menu.Item>
        <Menu.Item keys="r" onSelect={() => { chosen.push('one r'); }}>Rename</Menu.Item>
      </Menu>
      <KeyedMenu name="two" keys="r" onKey={() => { chosen.push('two r'); }} />
    </ShortcutScope>,
  );
  assert.equal(acceleratorIds(engine).length, 4, 'r of each menu, at route and modal scope; c is not registered');
  await press(doc.body, 'c');
  assert.deepEqual(chosen, [], 'c stays with Notis');
  await press(doc.body, 'r');
  assert.deepEqual(chosen, ['two r'], 'one answer: the menu mounted last');
});
