import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { NotisProvider } from '../../provider';
import type { NotisRuntime } from '../../runtime';
import { ListReader } from '../list/ListReader';
import { Row } from '../list/Row';
import {
  OPEN_MODE_CACHE_PREFIX, OpenModeStoreProvider, getOpenModeStore, localStorageOpenModeStore, readOpenModeCache,
  setOpenModeStore, userSettingsOpenModeStore, type OpenMode, type OpenModeStore,
} from './openModeStore';
import { normalizeAllowed, useOpenMode } from './useOpenMode';
import { useViewParams } from '../../hooks/useViewParams';
import { usePeriod } from '../period/usePeriod';

const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'http://localhost/space' });
class FakeResizeObserver {
  observe() {}
  disconnect() {}
}
const globals: Record<string, unknown> = {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot, Document: dom.window.Document, KeyboardEvent: dom.window.KeyboardEvent,
  requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  MouseEvent: dom.window.MouseEvent, StorageEvent: dom.window.StorageEvent, ResizeObserver: FakeResizeObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
};
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const doc = dom.window.document;

let root: Root | null = null;
async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="root"></div>';
  root = createRoot(doc.getElementById('root')!);
  const engine = new KeyboardEngineCore();
  const render = async (next: ReactNode) => {
    await act(async () => {
      root!.render(<KeyboardEngine host="preview" locale="en" platform="mac" engine={engine} document={doc} strict>{next}</KeyboardEngine>);
    });
  };
  await render(node);
  return render;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
}

function Probe({ storageKey, allowed }: { storageKey?: string; allowed?: OpenMode[] }) {
  const [mode, setMode] = useOpenMode({ storageKey, allowed });
  return (
    <div>
      <output id="mode">{mode}</output>
      <button type="button" id="center" onClick={() => setMode('center')}>center</button>
      <button type="button" id="full" onClick={() => setMode('full')}>full</button>
    </div>
  );
}

const mode = () => doc.getElementById('mode')!.textContent;

function memoryStore(initial: Record<string, OpenMode> = {}, delay = false) {
  const data = new Map(Object.entries(initial));
  const writes: Array<[string, OpenMode]> = [];
  const store: OpenModeStore = {
    read: (key) => (delay ? Promise.resolve(data.get(key) ?? null) : data.get(key) ?? null),
    write: (key, value) => { data.set(key, value); writes.push([key, value]); },
  };
  return { store, writes, data };
}

test('allowed modes: deduplicated, the first is the default, never empty', () => {
  assert.deepEqual(normalizeAllowed(undefined), ['side', 'center', 'full']);
  assert.deepEqual(normalizeAllowed('full'), ['full']);
  assert.deepEqual(normalizeAllowed(['center', 'center', 'side']), ['center', 'side']);
  assert.deepEqual(normalizeAllowed([]), ['side']);
});

test('default store: the choice survives a remount through localStorage', async () => {
  dom.window.localStorage.clear();
  await mount(<Probe storageKey="space-1:tickets" />);
  assert.equal(mode(), 'side');
  await click(doc.getElementById('center')!);
  assert.equal(mode(), 'center');
  assert.equal(dom.window.localStorage.getItem(`${OPEN_MODE_CACHE_PREFIX}space-1:tickets`), 'center');
  await mount(<Probe storageKey="space-1:tickets" />);
  assert.equal(mode(), 'center');
  await mount(<Probe storageKey="space-1:notes" />);
  assert.equal(mode(), 'side', 'keyed by Space and list');
});

test('a stored mode the list does not offer falls back to its default', async () => {
  dom.window.localStorage.clear();
  dom.window.localStorage.setItem(`${OPEN_MODE_CACHE_PREFIX}k`, 'full');
  await mount(<Probe storageKey="k" allowed={['center', 'side']} />);
  assert.equal(mode(), 'center');
});

test('no key (outside a Space): the mode holds for the visit and nothing persists', async () => {
  dom.window.localStorage.clear();
  await mount(<Probe />);
  await click(doc.getElementById('full')!);
  assert.equal(mode(), 'full');
  assert.equal(dom.window.localStorage.length, 0);
});

test('settings adapter: the remote answer replaces the cache, writes go to the store and the cache', async () => {
  dom.window.localStorage.clear();
  dom.window.localStorage.setItem(`${OPEN_MODE_CACHE_PREFIX}k`, 'side');
  const { store, writes } = memoryStore({ k: 'full' }, true);
  await mount(<OpenModeStoreProvider store={store}><Probe storageKey="k" /></OpenModeStoreProvider>);
  await act(async () => { await Promise.resolve(); });
  assert.equal(mode(), 'full', 'the settings answer wins over the cache');
  assert.equal(readOpenModeCache('k'), 'full', 'and refreshes it');
  await click(doc.getElementById('center')!);
  assert.deepEqual(writes, [['k', 'center']]);
  assert.equal(readOpenModeCache('k'), 'center');
});

test('setOpenModeStore installs the global store and returns the previous one', async () => {
  dom.window.localStorage.clear();
  const { store, writes } = memoryStore({ k: 'center' });
  const previous = setOpenModeStore(store);
  try {
    assert.equal(previous, localStorageOpenModeStore);
    assert.equal(getOpenModeStore(), store);
    await mount(<Probe storageKey="k" />);
    assert.equal(mode(), 'center');
    await click(doc.getElementById('full')!);
    assert.deepEqual(writes, [['k', 'full']]);
  } finally {
    setOpenModeStore(null);
  }
  assert.equal(getOpenModeStore(), localStorageOpenModeStore);
});

test('userSettingsOpenModeStore keeps modes under openMode:<key> and ignores junk', async () => {
  const saved = new Map<string, unknown>([['openMode:bad', 'sideways']]);
  const store = userSettingsOpenModeStore({ get: (key) => saved.get(key), set: (key, value) => { saved.set(key, value); } });
  await store.write('space:list', 'center');
  assert.equal(saved.get('openMode:space:list'), 'center');
  assert.equal(await store.read('space:list'), 'center');
  assert.equal(await store.read('bad'), null);
});

test('another tab changing the mode updates this one (storage event)', async () => {
  dom.window.localStorage.clear();
  await mount(<Probe storageKey="k" />);
  await act(async () => {
    dom.window.localStorage.setItem(`${OPEN_MODE_CACHE_PREFIX}k`, 'full');
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: `${OPEN_MODE_CACHE_PREFIX}k`, newValue: 'full' }));
  });
  assert.equal(mode(), 'full');
});

test('ListReader in a Space: the open id lives in the URL, the Open as menu switches and persists per list', async () => {
  dom.window.localStorage.clear();
  const items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const navigations: Array<Record<string, string>> = [];
  const steps: Array<{ kind: unknown; replace: boolean }> = [];
  let params: Record<string, string> = { tab: 'mine' };
  const runtime = (): NotisRuntime => ({
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params, locale: 'en' },
    callAction: async () => undefined,
    navigate: (target: { kind: string; params?: Record<string, string>; replace?: boolean }) => {
      params = { ...(target.params ?? {}) };
      navigations.push(params);
      steps.push({ kind: target.kind, replace: target.replace === true });
    },
  }) as unknown as NotisRuntime;
  const view = (rt: NotisRuntime) => (
    <NotisProvider runtime={rt}>
      <ListReader items={items} row={(t) => <Row title={t.title} />} reader={(t) => <article id="reader">{t.title}</article>}
        listId="tickets" />
    </NotisProvider>
  );
  const render = await mount(view(runtime()));
  await click(doc.querySelector('[data-nui-item="a"]')!);
  assert.deepEqual(navigations.at(-1), { tab: 'mine', open: 'a' }, 'opening writes ?open= and keeps the other params');
  assert.deepEqual(steps.at(-1), { kind: 'view-params', replace: false }, 'its own params, no destination; opening is a history step');
  await render(view(runtime()));
  assert.equal(doc.getElementById('reader')!.textContent, 'A');
  await click(doc.querySelector('[data-nui-item="b"]')!);
  assert.deepEqual(navigations.at(-1), { tab: 'mine', open: 'b' });
  assert.deepEqual(steps.at(-1), { kind: 'view-params', replace: true }, 'moving between items replaces the history entry');
  await render(view(runtime()));
  assert.equal(doc.getElementById('reader')!.textContent, 'B');

  const trigger = doc.querySelector<HTMLElement>('.nui-lr-bar .nui-om-btn[aria-haspopup="menu"]')!;
  assert.equal(trigger.getAttribute('aria-label'), 'Open as side peek');
  await click(trigger);
  const entries = [...doc.querySelectorAll<HTMLElement>('[role="menu"] button')];
  assert.deepEqual(entries.map((el) => el.textContent?.trim()), ['Side peek', 'Center peek', 'Full page']);
  await click(entries[1]!);
  assert.equal(doc.querySelector('.nui-lr')!.getAttribute('data-mode'), 'center');
  assert.ok(doc.querySelector('.nui-lr-center [role="dialog"] #reader'));
  assert.equal(readOpenModeCache('s1:tickets'), 'center', 'keyed by Space and list');

  await mount(view(runtime()));
  assert.equal(doc.querySelector('.nui-lr')!.getAttribute('data-mode'), 'center', 'the mode comes back on the next visit');
  await click(doc.querySelector('.nui-lr-scrim')!);
  assert.deepEqual(navigations.at(-1), { tab: 'mine' }, 'closing removes ?open=');
  assert.deepEqual(steps.at(-1), { kind: 'view-params', replace: false }, 'closing is a history step');
});

test('ListReader in a Space: Back away from an item the page keeps puts the URL back; its own writes are not asked about', async () => {
  dom.window.localStorage.clear();
  const items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const steps: Array<{ params: Record<string, string>; replace: boolean }> = [];
  const asked: Array<string | null> = [];
  let dirty = false;
  let params: Record<string, string> = { tab: 'mine' };
  const runtime = (): NotisRuntime => ({
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params, locale: 'en' },
    callAction: async () => undefined,
    navigate: (target: { params?: Record<string, string>; replace?: boolean }) => {
      params = { ...(target.params ?? {}) };
      steps.push({ params, replace: target.replace === true });
    },
  }) as unknown as NotisRuntime;
  const view = (rt: NotisRuntime) => (
    <NotisProvider runtime={rt}>
      <ListReader items={items} row={(t) => <Row title={t.title} />} reader={(t) => <article id="reader">{t.title}</article>}
        listId="kept" onOpenChange={(id) => { asked.push(id); return !dirty; }} />
    </NotisProvider>
  );
  const render = await mount(view(runtime()));
  await click(doc.querySelector('[data-nui-item="a"]')!);
  await render(view(runtime()));
  assert.equal(doc.getElementById('reader')!.textContent, 'A');
  assert.deepEqual(asked, ['a'], 'the list\'s own write coming back is not asked about again');
  dirty = true;
  // Back: the host drops ?open= from the Space URL.
  params = { tab: 'mine' };
  await render(view(runtime()));
  assert.equal(asked.at(-1), null, 'Back asks the page');
  assert.equal(doc.getElementById('reader')!.textContent, 'A', 'the page keeps its item');
  assert.deepEqual(steps.at(-1), { params: { tab: 'mine', open: 'a' }, replace: true },
    'the URL goes back to the item without a new history step');
  assert.equal(doc.querySelector('.nui-toast-words')!.textContent, 'Save or cancel your changes first.');
  const count = asked.length;
  await render(view(runtime()));
  assert.equal(asked.length, count, 'the write back is the list\'s own');
  assert.equal(doc.getElementById('reader')!.textContent, 'A');
  dirty = false;
  params = { tab: 'mine' };
  await render(view(runtime()));
  assert.equal(asked.at(-1), null);
  assert.equal(doc.getElementById('reader'), null, 'Back closes once the page lets it');
});

function ParamsProbe({ onApi }: { onApi: (api: ReturnType<typeof useViewParams>) => void }) {
  onApi(useViewParams());
  return null;
}

test('useViewParams().setParams changes the Space\'s own params: merged, null removes, replace on request, refused outside a Space', async () => {
  const sent: Array<Record<string, unknown>> = [];
  let fail = false;
  const space = (params: Record<string, string>): NotisRuntime => ({
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params, locale: 'en' },
    callAction: async () => undefined,
    navigate: (payload: Record<string, unknown>) => {
      if (fail) return Promise.reject(new Error('refused'));
      sent.push(payload);
      return undefined;
    },
  }) as unknown as NotisRuntime;
  let api!: ReturnType<typeof useViewParams>;
  const keep = (next: ReturnType<typeof useViewParams>) => { api = next; };
  const first = space({ tab: 'mine', q: 'x' });
  const render = await mount(<NotisProvider runtime={first}><ParamsProbe onApi={keep} /></NotisProvider>);
  await api.setParams({ status: 'done' });
  assert.deepEqual(sent.at(-1), { kind: 'view-params', params: { tab: 'mine', q: 'x', status: 'done' } },
    'no Space id, record or alias: the host keeps the open Space and record');
  // Before the host answers, a second change keeps the first (two changes in one tick).
  await Promise.all([api.setParams({ page: 2 }), api.setParams({ q: null }, { replace: true })]);
  assert.deepEqual(sent.at(-1), { kind: 'view-params', params: { tab: 'mine', status: 'done', page: '2' }, replace: true });
  // The host answered with other params (Back, or another view's change): those are the base now.
  await render(<NotisProvider runtime={space({ tab: 'other' })}><ParamsProbe onApi={keep} /></NotisProvider>);
  await api.setParams({ q: 'y', missing: undefined });
  assert.deepEqual(sent.at(-1), { kind: 'view-params', params: { tab: 'other', q: 'y' } });
  // A refused change is forgotten: the next one starts from the params the view shows.
  const last = space({ tab: 'last' });
  await render(<NotisProvider runtime={last}><ParamsProbe onApi={keep} /></NotisProvider>);
  fail = true;
  await assert.rejects(api.setParams({ q: 'lost' }), /refused/);
  fail = false;
  await api.setParams({ page: 3 });
  assert.deepEqual(sent.at(-1), { kind: 'view-params', params: { tab: 'last', page: '3' } });

  const count = sent.length;
  const app = { ...space({}), resource: { kind: 'app', id: 'a1' } } as unknown as NotisRuntime;
  await render(<NotisProvider runtime={app}><ParamsProbe onApi={keep} /></NotisProvider>);
  await assert.rejects(api.setParams({ q: 'x' }), /Open this Space in a current Notis host/);
  await render(<ParamsProbe onApi={keep} />);
  await assert.rejects(api.setParams({ q: 'x' }), /Open this Space in a current Notis host/);
  assert.equal(sent.length, count);
});

function PeriodProbe({ onPeriod }: { onPeriod: (period: ReturnType<typeof usePeriod>) => void }) {
  onPeriod(usePeriod());
  return null;
}

test('usePeriod in a Space writes its own period param and replaces the history entry', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const runtime = {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params: { tab: 'mine' }, locale: 'en' },
    callAction: async () => undefined,
    navigate: (payload: Record<string, unknown>) => { sent.push(payload); },
  } as unknown as NotisRuntime;
  let period!: ReturnType<typeof usePeriod>;
  await mount(<NotisProvider runtime={runtime}><PeriodProbe onPeriod={(next) => { period = next; }} /></NotisProvider>);
  await act(async () => { period.set({ preset: 'last7', compare: 'year' }); });
  assert.deepEqual(sent.at(-1), { kind: 'view-params', params: { tab: 'mine', period: 'last7~year' }, replace: true });
});
