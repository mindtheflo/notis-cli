/**
 * The completeness test of the design system book (design review spec, section 5).
 *
 * 1. The inventory: every JS export path of packages/sdk/package.json is inventoried (the entries listed as having
 *    no component really export none), every component value of `@notis/sdk`, `@notis/sdk/ui` and
 *    `@notis/sdk/interactions` has exactly one specimen, every specimen file is well formed and imports only the
 *    public entries, and the recharts map matches recharts.
 * 2. Render smoke: every state of every specimen renders once under jsdom, light and English, through the same
 *    `KeyboardEngine` and `SdkPresentation` path as a book frame (so inside `NotisProvider` with the fake
 *    runtime), with `fetch` stubbed to throw, then runs its `interact` steps. A thrown error, a React error or a
 *    state that renders nothing fails with the specimen and state; a component a specimen covers that none of its
 *    states rendered fails too (a React DevTools hook, `runtime/devtoolsHook.ts`, records what each state committed).
 *
 * Filter to one group while its specimens land (cwd packages/sdk):
 *   node --import ./design-system/tsx.mjs --test --test-name-pattern "specimens/blocks/" design-system/completeness.test.tsx
 */
import { dom } from '../src/ui/testDom';
// Before anything loads react-dom: the reconciler reads the DevTools hook once, when it loads.
import { devtoolsHookInstalled, startRecording, stopRecording, type RenderRecord } from './runtime/devtoolsHook';
// The fixed clock of a book frame, before the toolkit and the specimens load.
import './runtime/fixedClock';
import assert from 'node:assert/strict';
import { format } from 'node:util';
import test from 'node:test';
import { act, type ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import { SdkPresentation } from '../src/presentation';
import { KeyboardEngine, KeyboardEngineCore } from '../src/ui/index';
import { COMPONENT_ENTRIES, NO_COMPONENT_ENTRIES, entryListProblems, packageEntries, readApi } from './api.mjs';
import { checkInventory, loadEntries, loadSpecimens, sourceGroupFromApi } from './inventory';
import { createFakeRuntime } from './runtime/fakeRuntime';
import { renderContext, type Specimen, type SpecimenState } from './specimen';

const win = dom.window as unknown as Window & typeof globalThis;
const doc = dom.window.document;

/** Browser APIs a book frame has and jsdom does not. Inert here: the smoke test proves a state renders, not its layout. */
class InertObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
const browserOnly: Record<string, unknown> = {
  ResizeObserver: InertObserver,
  IntersectionObserver: InertObserver,
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  matchMedia: (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }),
  SVGElement: win.SVGElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement,
  HTMLSelectElement: win.HTMLSelectElement,
  HTMLButtonElement: win.HTMLButtonElement,
  FocusEvent: win.FocusEvent,
  PointerEvent: win.PointerEvent ?? win.MouseEvent,
  InputEvent: win.InputEvent,
  CustomEvent: win.CustomEvent,
  DOMRect: win.DOMRect,
  getSelection: win.getSelection.bind(win),
  NodeFilter: win.NodeFilter,
  HTMLDialogElement: win.HTMLDialogElement,
};
for (const [key, value] of Object.entries(browserOnly)) {
  if (value === undefined || key in globalThis) continue;
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
for (const [key, value] of Object.entries({ ResizeObserver: InertObserver, IntersectionObserver: InertObserver, matchMedia: browserOnly.matchMedia })) {
  if (!(key in win)) Object.defineProperty(win, key, { configurable: true, writable: true, value });
}
if (!win.HTMLElement.prototype.scrollIntoView) win.HTMLElement.prototype.scrollIntoView = () => {};

/** jsdom has the dialog element without its methods: open and close it the way a browser does, minus the top layer. */
const dialogProto = win.HTMLDialogElement.prototype as HTMLDialogElement;
if (typeof dialogProto.showModal !== 'function') {
  const show = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  Object.assign(dialogProto, {
    show,
    showModal: show,
    close(this: HTMLDialogElement, returnValue?: string) {
      if (!this.hasAttribute('open')) return;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.removeAttribute('open');
      this.dispatchEvent(new win.Event('close'));
    },
  });
}

/** jsdom has neither DataTransfer nor ClipboardEvent: a clipboard the page can write to and read back. */
class TestDataTransfer {
  private readonly data = new Map<string, string>();
  dropEffect = 'none';
  effectAllowed = 'all';
  readonly files: File[] = [];
  readonly items: unknown[] = [];
  get types(): string[] { return [...this.data.keys()]; }
  getData(type: string): string { return this.data.get(type) ?? ''; }
  setData(type: string, value: string): void { this.data.set(type, String(value)); }
  clearData(type?: string): void { if (type) this.data.delete(type); else this.data.clear(); }
  setDragImage(): void {}
}
class TestClipboardEvent extends win.Event {
  readonly clipboardData: TestDataTransfer | null;
  constructor(type: string, init: EventInit & { clipboardData?: TestDataTransfer | null } = {}) {
    super(type, init);
    this.clipboardData = init.clipboardData ?? null;
  }
}
for (const [key, value] of Object.entries({ DataTransfer: TestDataTransfer, ClipboardEvent: TestClipboardEvent })) {
  if (!(key in globalThis)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  if (!(key in win)) Object.defineProperty(win, key, { configurable: true, writable: true, value });
}

/**
 * jsdom matches `:focus-visible` only on the document's own active element, never inside a shadow root. A book
 * frame focuses by script before any pointer press, which a browser shows as keyboard focus, so a focused element
 * counts as focus-visible here.
 */
const plainMatches = win.Element.prototype.matches;
win.Element.prototype.matches = function matches(this: Element, selector: string) {
  if (selector.trim() === ':focus-visible') return plainMatches.call(this, ':focus');
  return plainMatches.call(this, selector);
} as typeof plainMatches;

/**
 * jsdom has no layout, so recharts' ResponsiveContainer measures 0 x 0 and draws nothing (no plot, legend or tooltip
 * to render or point at). Give its container and the drawn wrapper a book-like size; every other box stays 0 x 0.
 */
const CHART_BOX = { width: 800, height: 320 };
const plainRect = win.Element.prototype.getBoundingClientRect;
win.Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
  if (this.classList.contains('recharts-responsive-container') || this.classList.contains('recharts-wrapper')) {
    return new win.DOMRect(0, 0, CHART_BOX.width, CHART_BOX.height);
  }
  return plainRect.call(this);
};

/** A book frame has no network; neither does the smoke test. */
const blockedFetch = (input: unknown) => {
  throw new Error(`fetch(${String(input)}) is not allowed in the design book: use fixtures and the fake runtime.`);
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: blockedFetch });
Object.defineProperty(win, 'fetch', { configurable: true, writable: true, value: blockedFetch });

const report = await checkInventory({ sourceGroup: await sourceGroupFromApi(), words: false });
const { specimens } = await loadSpecimens();
const entryModules = await loadEntries();

test('entries: every JS export path of package.json is inventoried, and the no-component entries have none', () => {
  const pkg = packageEntries();
  assert.deepEqual(entryListProblems(pkg).map((problem) => problem.message), []);
  const listed = new Set<string>([...COMPONENT_ENTRIES, ...NO_COMPONENT_ENTRIES]);
  const classified = new Set(report.exports.map((item) => item.entry));
  for (const entry of pkg) {
    assert.ok(listed.has(entry.name), `${entry.name} (${entry.file}) is in neither list of design-system/api.mjs`);
    assert.ok(classified.has(entry.name), `${entry.name} (${entry.file}) was not loaded and classified by the inventory`);
  }
  const runtimeComponents = report.exports
    .filter((item) => (NO_COMPONENT_ENTRIES as readonly string[]).includes(item.entry) && (item.kind === 'component' || item.kind === 'third_party'))
    .map((item) => `${item.entry} ${item.name} (${item.kind})`);
  assert.deepEqual(runtimeComponents, [], 'an entry listed in NO_COMPONENT_ENTRIES exports a component value');
  const declaredComponents = readApi()
    .filter((row) => (NO_COMPONENT_ENTRIES as readonly string[]).includes(row.entry) && row.kind === 'component')
    .map((row) => `${row.entry} ${row.name} (${row.file}:${row.line})`);
  assert.deepEqual(declaredComponents, [], 'an entry listed in NO_COMPONENT_ENTRIES declares a component');
});

test('inventory: specimen files, covers and the recharts map are valid', () => {
  const problems = report.problems.filter((problem) => problem.code !== 'uncovered');
  assert.equal(problems.length, 0, `\n${problems.map((problem) => problem.message).join('\n')}`);
});

test('inventory: every component value has a specimen', () => {
  const problems = report.problems.filter((problem) => problem.code === 'uncovered');
  assert.equal(problems.length, 0, `\n${problems.length} component values have no specimen yet:\n${problems.map((problem) => problem.message).join('\n')}`);
});

function describeError(error: unknown, info?: ErrorInfo): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const where = info?.componentStack?.trim().split('\n')[0]?.trim();
  return where ? `${message} (${where})` : message;
}

/** Waits for promise jobs and the timers of a first query (the fake runtime answers from memory). */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * States whose `interact` steps need what jsdom does not have. They still render here; their steps run only in the
 * book's browser frames. Keyed by specimen id, with the reason.
 */
const JSDOM_SKIPS_INTERACT: Readonly<Record<string, string>> = {
  'notis-comment-boundary': 'its steps select text inside the frame shadow root, and jsdom cannot select text inside a shadow root',
  'notis-selection-boundary': 'its steps select text inside the frame shadow root, and jsdom cannot select text inside a shadow root',
};

/**
 * Failures a fixture causes on purpose (a server that refuses a save or a new label): the toolkit reports a failed
 * save with console.error, as it should, so those lines are not errors of the state. Matched on the fixture words.
 */
const DELIBERATE_FAILURE = /The fixture server refused/;

/** Runs `steps` with React scheduling as in a browser (not an act environment), as testing-library's waitFor does. */
async function outsideAct<T>(steps: () => Promise<T>): Promise<T> {
  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = scope.IS_REACT_ACT_ENVIRONMENT;
  scope.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await steps();
  } finally {
    scope.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

interface StateResult {
  errors: string[];
  /** Every component type and element type the state committed below its state root. */
  types: Set<unknown>;
}

/** Renders one state like a light, English, 1440 px book frame, runs its `interact`, and returns every error it raised. */
async function renderState(specimen: Specimen, state: SpecimenState): Promise<StateResult> {
  const errors: string[] = [];
  doc.documentElement.lang = 'en';
  doc.documentElement.className = '';
  doc.body.innerHTML = '';
  const frame = doc.createElement('div');
  frame.id = 'ds-frame';
  doc.body.append(frame);
  const shadowMount = doc.createElement('div');
  frame.attachShadow({ mode: 'open' }).append(shadowMount);
  const app = doc.createElement('div');
  doc.body.append(app);

  const engine = new KeyboardEngineCore();
  const runtime = createFakeRuntime({ lang: 'en', theme: 'light' });
  const context = renderContext('en', 'light', state.width ?? 1440);
  const StateComponent = () => <div data-ds-state-root="">{state.render(context)}</div>;
  let committed = false;

  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const line = format(...args);
    if (DELIBERATE_FAILURE.test(line)) return;
    errors.push(`console.error: ${line.split('\n')[0]}`);
  };
  const root = createRoot(app, {
    onUncaughtError: (error, info) => { errors.push(`uncaught: ${describeError(error, info)}`); },
    onCaughtError: (error, info) => { errors.push(`caught: ${describeError(error, info)}`); },
    onRecoverableError: (error, info) => { errors.push(`recoverable: ${describeError(error, info)}`); },
  });
  let record: RenderRecord = { types: new Set(), hostNodes: 0, stateRoots: 0 };
  startRecording();
  try {
    await act(async () => {
      root.render(
        <KeyboardEngine host="preview" locale="en" platform="mac" engine={engine} document={doc} strict>
          <SdkPresentation
            mount={shadowMount}
            runtime={runtime}
            component={StateComponent}
            theme={{ mode: 'light', style: {} }}
            resetKey={`${specimen.id}/${state.id}/light/en/${context.width}`}
            fallback={() => null}
            onError={(error, info) => { errors.push(`boundary: ${describeError(error, info)}`); }}
            onCommit={() => { committed = true; }}
          />
        </KeyboardEngine>,
      );
    });
    await act(settle);
    const stateRoot = shadowMount.querySelector<HTMLElement>('[data-ds-state-root]');
    if (!stateRoot && errors.length === 0) errors.push('the state root did not render');
    if (!committed && errors.length === 0) errors.push('the presentation never committed');
    if (stateRoot && state.interact && errors.length === 0 && !JSDOM_SKIPS_INTERACT[specimen.id]) {
      // As a book frame does (frame/frame.tsx): the steps get the state root, then the state settles. Outside act,
      // as in a browser: inside an act scope React holds every update until the scope ends, so a step that waits
      // for a menu to open would wait forever.
      try {
        await outsideAct(() => state.interact!(stateRoot));
      } catch (error) {
        errors.push(`interact: ${describeError(error)}`);
      }
      await act(settle);
    }
    record = stopRecording();
    if (stateRoot && errors.length === 0 && !stateRoot.hasChildNodes() && record.hostNodes === 0) {
      errors.push('the state rendered nothing: its state root is empty and it portals nothing');
    }
  } catch (error) {
    errors.push(`thrown: ${describeError(error)}`);
  } finally {
    stopRecording();
    try {
      await act(async () => { root.unmount(); });
    } catch (error) {
      errors.push(`unmount: ${describeError(error)}`);
    }
    console.error = originalError;
    const queryClient = runtime.queryClient;
    if (queryClient && typeof queryClient.dispose === 'function') queryClient.dispose();
    doc.body.innerHTML = '';
  }
  return { errors, types: record.types };
}

test('render smoke: the React DevTools hook records commits', () => {
  assert.ok(devtoolsHookInstalled(), 'runtime/devtoolsHook.ts must load before react-dom so React reports commits to it');
});

for (const { file, specimen } of specimens) {
  test(`render smoke: ${file}`, async (t) => {
    const skipped = JSDOM_SKIPS_INTERACT[specimen.id];
    if (skipped && specimen.states.some((state) => state.interact)) t.diagnostic(`interact steps not run under jsdom: ${skipped}`);
    const rendered = new Set<unknown>();
    for (const state of specimen.states ?? []) {
      await t.test(`${specimen.id}/${state.id}`, async () => {
        const { errors, types } = await renderState(specimen, state);
        for (const type of types) rendered.add(type);
        assert.equal(errors.length, 0, `\n${file} state "${state.id}" (${state.label}) raised:\n${errors.join('\n')}`);
      });
    }
    await t.test(`${specimen.id}: every covered component renders in a state`, () => {
      const entry = entryModules[specimen.from] ?? {};
      const missing = (specimen.covers ?? []).filter((name) => Object.hasOwn(entry, name) && !rendered.has(entry[name]));
      assert.deepEqual(missing, [], `${file} covers ${missing.join(', ')}, which none of its states rendered: show it in at least one state.`);
    });
  });
}
