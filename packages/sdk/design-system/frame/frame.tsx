/**
 * The frame bootstrap of the design system book (design review spec, section 3.5).
 *
 * `index.html?frame=<specimenId>&state=<stateId>&theme=light|dark&lang=en|fr&w=<px>[&shot=1]` renders one state
 * and nothing else, through the same `KeyboardEngine` and `SdkPresentation` path as a Space in the Portal: an open
 * shadow root on `#ds-frame` with the toolkit sheet adopted first, then the Space bundle stand-in (styles.css plus
 * Tailwind), inside `NotisProvider` with the fake runtime.
 *
 * The frame publishes its state on `<body>`: `data-ds-status` (`ready`, `error` or `timeout`), `data-ready="1"`
 * once settled, `data-ds-flags` (`network`, `error`, `timeout`) and `data-ds-error`. It also posts
 * `{ type: 'ds-frame', ... }` to its parent with the content height, so the shell sizes the iframe.
 */
import { type ErrorInfo, type ReactNode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SdkPresentation } from '../../src/presentation';
import { KeyboardEngine, adoptToolkitStyles, registerToolkitStyles } from '../../src/ui/index';
import { createFakeRuntime } from '../runtime/fakeRuntime';
import { nextFrame, renderContext, type Specimen, type SpecimenState } from '../specimen';
import { type FrameParams, flagFrame, frameFlags, frameParams, repaintWholeFrame, stopMotion } from './determinism';

/** One specimen module of the generated entry. */
export interface FrameSpecimenModule {
  file: string;
  module: { specimen?: Specimen };
}

/** The CSS texts `build.mjs` inlines as JSON in `#ds-css`. */
export interface FrameCss {
  toolkit: string;
  space: string;
}

export type FrameStatus = 'rendering' | 'ready' | 'error' | 'timeout';

export interface FrameMessage {
  type: 'ds-frame';
  specimen: string;
  state: string;
  status: FrameStatus;
  height: number;
  flags: string[];
  error: string | null;
}

export const READY_TIMEOUT_MS = 20_000;

const frameStyle = {
  error: {
    margin: 24,
    padding: 16,
    borderRadius: 8,
    background: 'hsl(var(--destructive) / 0.1)',
    color: 'hsl(var(--destructive))',
    font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'pre-wrap',
  },
} as const;

function readCss(): FrameCss {
  const element = document.getElementById('ds-css');
  if (!element?.textContent) return { toolkit: '', space: '' };
  return JSON.parse(element.textContent) as FrameCss;
}

function constructedSheet(text: string): CSSStyleSheet | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return sheet;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function FrameError({ title, message }: { title: string; message: string }) {
  return <div role="alert" data-ds-frame-error="" style={frameStyle.error}>{`${title}\n${message}`}</div>;
}

/** Calls `onMount` with the state root once it is in the DOM. */
function StateRoot({ state, children, onMount }: { state: SpecimenState; children: ReactNode; onMount: (root: HTMLElement) => void }) {
  useLayoutEffect(() => {
    const root = document.getElementById('ds-frame')?.shadowRoot?.querySelector<HTMLElement>('[data-ds-state-root]');
    if (root) onMount(root);
  }, [onMount]);
  return (
    <div
      data-ds-state-root=""
      style={{ padding: 24, boxSizing: 'border-box', minHeight: state.height ? state.height : undefined }}
    >
      {children}
    </div>
  );
}

class FrameController {
  status: FrameStatus = 'rendering';
  error: string | null = null;
  private committed = false;
  private stateRoot: HTMLElement | null = null;
  private settling = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly params: FrameParams, private readonly state: SpecimenState | null) {}

  start(): void {
    window.setTimeout(() => {
      if (this.status === 'rendering') {
        flagFrame('timeout', `not ready in ${READY_TIMEOUT_MS / 1000} s`);
        this.finish('timeout', `The state was not ready in ${READY_TIMEOUT_MS / 1000} s.`);
      }
    }, READY_TIMEOUT_MS);
    window.addEventListener('error', (event) => this.fail(event.error ?? event.message));
    window.addEventListener('unhandledrejection', (event) => this.fail(event.reason));
    this.post();
  }

  mounted = (root: HTMLElement): void => {
    if (this.stateRoot === root) return;
    this.stateRoot = root;
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.post());
      this.resizeObserver.observe(root);
    }
    this.maybeSettle();
  };

  committedChange = (hasContent: boolean): void => {
    if (!hasContent) return;
    this.committed = true;
    this.maybeSettle();
  };

  fail = (error: unknown, info?: ErrorInfo): void => {
    const where = info?.componentStack?.trim().split('\n')[0]?.trim();
    const message = where ? `${describe(error)} (${where})` : describe(error);
    flagFrame('error', message);
    this.finish('error', message);
  };

  private async maybeSettle(): Promise<void> {
    if (this.settling || !this.committed || !this.stateRoot || this.status !== 'rendering') return;
    this.settling = true;
    try {
      await document.fonts?.ready;
      await nextFrame();
      await nextFrame();
      if (this.state?.interact) {
        await this.state.interact(this.stateRoot);
        await nextFrame();
        await nextFrame();
      }
      // A shot comes from one full raster, whatever rastered before the state settled.
      if (this.params.shot) await repaintWholeFrame();
      this.finish('ready', null);
    } catch (error) {
      this.fail(error);
    }
  }

  finish(status: Exclude<FrameStatus, 'rendering'>, error: string | null): void {
    if (this.status !== 'rendering') return;
    this.status = status;
    this.error = error;
    const body = document.body;
    body.dataset.dsStatus = status;
    if (error) body.dataset.dsError = error;
    body.dataset.ready = '1';
    this.post();
  }

  height(): number {
    if (this.state?.height) return this.state.height;
    const root = this.stateRoot;
    if (root?.isConnected) return Math.ceil(root.getBoundingClientRect().bottom + window.scrollY);
    const host = document.getElementById('ds-frame');
    return Math.ceil(host?.getBoundingClientRect().height ?? 0) || 120;
  }

  post(): void {
    if (window.parent === window) return;
    const message: FrameMessage = {
      type: 'ds-frame',
      specimen: this.params.specimen,
      state: this.params.state,
      status: this.status,
      height: this.height(),
      flags: frameFlags(),
      error: this.error,
    };
    window.parent.postMessage(message, location.origin);
  }
}

/** Renders the state named by the URL. A no-op outside frame mode. */
export function startFrame(modules: readonly FrameSpecimenModule[], css: FrameCss = readCss()): void {
  const params = frameParams();
  if (!params) return;
  const html = document.documentElement;
  html.lang = params.lang;
  html.classList.toggle('dark', params.theme === 'dark');
  html.style.colorScheme = params.theme;
  document.title = `${params.specimen} / ${params.state}`;

  let host = document.getElementById('ds-frame');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ds-frame';
    document.body.append(host);
  }
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (css.toolkit) registerToolkitStyles(css.toolkit);
  adoptToolkitStyles(shadow);
  const space = constructedSheet(css.space);
  if (space) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, space];
  stopMotion(shadow);
  const mount = document.createElement('div');
  mount.setAttribute('data-notis-app-mount', 'true');
  shadow.append(mount);
  // The React root renders its own fallback in the light DOM of #ds-frame; the slot shows it.
  shadow.append(document.createElement('slot'));

  const entry = modules.find((item) => item.module.specimen?.id === params.specimen);
  const specimen = entry?.module.specimen ?? null;
  const state = specimen?.states.find((item) => item.id === params.state) ?? null;
  const controller = new FrameController(params, state);
  controller.start();
  const root = createRoot(host, {
    onUncaughtError: (error, info) => controller.fail(error, info),
    onRecoverableError: () => {},
  });

  if (!specimen || !state) {
    const message = !specimen
      ? `No specimen "${params.specimen}" in this book.`
      : `The specimen "${params.specimen}" has no state "${params.state}".`;
    root.render(<FrameError title="Not found" message={message} />);
    controller.fail(new Error(message));
    return;
  }

  const width = state.width ?? params.width;
  const theme = state.theme ?? params.theme;
  if (theme !== params.theme) {
    html.classList.toggle('dark', theme === 'dark');
    html.style.colorScheme = theme;
  }
  const context = renderContext(params.lang, theme, width);
  const runtime = createFakeRuntime({ lang: params.lang, theme });
  const StateComponent = () => <StateRoot state={state} onMount={controller.mounted}>{state.render(context)}</StateRoot>;

  root.render(
    <KeyboardEngine host="preview" locale={params.lang} platform="mac" strict>
      <SdkPresentation
        mount={mount}
        runtime={runtime}
        component={StateComponent}
        theme={{ mode: theme, style: {} }}
        resetKey={`${specimen.id}/${state.id}/${theme}/${params.lang}/${width}`}
        fallback={(error) => <FrameError title={`${specimen.name}: ${state.label}`} message={describe(error)} />}
        onError={controller.fail}
        onCommit={controller.committedChange}
      />
    </KeyboardEngine>,
  );
}
