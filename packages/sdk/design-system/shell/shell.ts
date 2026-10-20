/**
 * The design system book's own UI (design review spec, section 3.2): plain TypeScript and DOM, no SDK import, so a
 * broken component never breaks navigation.
 *
 * Left: an index of groups and specimens with a search box. Main column: Overview, one section per group, Tokens,
 * Words, API index and (review mode) Removed. The toggles (Light / Dark, EN / FR, 390 / 768 / 1440) live in the URL
 * hash. Every state renders in its own same-origin iframe (`index.html?frame=...`), mounted lazily and at most
 * `MAX_LIVE_FRAMES` at a time, sized to the state's width and scaled down to the column.
 */
import { BOOK_WIDTHS, ENTRY_ORDER, rowKey, type RowKind, type BookComponent, type BookLang, type BookManifest, type BookSpecimen, type BookState, type BookTheme, type BookToken } from './manifest';
import { startReview } from './review';

export const MAX_LIVE_FRAMES = 12;
const DEFAULT_FRAME_HEIGHT = 160;
// The file of a Portal token from a manifest older than per-token files.
const PORTAL_TOKENS_FILE = 'portal/src/app/globals.css';

export interface Toggles {
  theme: BookTheme;
  lang: BookLang;
  width: number;
}

/** What a state actually renders with: a fixed width or theme wins over the toggle. */
export interface Effective extends Toggles {
  fixedWidth: boolean;
  fixedTheme: boolean;
}

/** The message a frame posts to the book (see `frame/frame.tsx`). */
export interface FrameReport {
  type: 'ds-frame';
  specimen: string;
  state: string;
  status: 'rendering' | 'ready' | 'error' | 'timeout';
  height: number;
  flags: string[];
  error: string | null;
}

/** The hooks the review layer (`review.ts`) drives the book with. */
export interface Book {
  manifest: BookManifest;
  main: HTMLElement;
  removedSection: HTMLElement;
  toggles(): Toggles;
  setToggles(next: Partial<Toggles>): void;
  onToggles(listener: (toggles: Toggles) => void): void;
  effective(state: BookState, toggles?: Toggles): Effective;
  frameUrl(specimen: string, state: string, toggles: Toggles, base?: string): string;
  specimenElement(id: string): HTMLElement | null;
  stateElement(specimen: string, state: string): HTMLElement | null;
  indexItem(id: string): HTMLElement | null;
  liveFrame(specimen: string, state: string): HTMLIFrameElement | null;
  onFrame(listener: (report: FrameReport, iframe: HTMLIFrameElement) => void): void;
  /** Scrolls to a section or specimen id and keeps it in the hash. */
  scrollTo(id: string): void;
  /** Replaces what a state shows while its frame is not live (review mode shows the latest shot). */
  setPlaceholder(render: ((specimen: string, state: string, toggles: Toggles) => HTMLElement | null) | null): void;
  /** Re-mounts every live frame, for example after the review layer changed a state's mode. */
  refreshFrames(): void;
  /**
   * Shows `element` in a state's stage instead of its frame (review mode: Before and Difference), sized
   * `height` CSS pixels at the state's width and scaled like the frame. `null` gives the stage back to its frame.
   */
  setOverride(specimen: string, state: string, element: HTMLElement | null, height?: number): void;
  /** The rows of the Tokens, Words and API sections by key (see `rowKey`). */
  rows(kind: RowKind, key: string): HTMLElement[];
  /** The scale a state's stage shows its frame at (1 at full size). */
  stageScale(specimen: string, state: string): number;
}

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'text') element.textContent = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value as EventListener);
    else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'for') element.setAttribute(key, String(value));
    else (element as unknown as Record<string, unknown>)[key] = value;
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) element.append(child);
  return element;
}

function code(text: string, className = 'ds-code'): HTMLElement {
  return h('code', { class: className, text });
}

/** `1 key`, `2 keys`. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function where(file: string | null | undefined, line: number | null | undefined): string {
  if (!file) return 'source not found';
  return line ? `${file}:${line}` : file;
}

function readManifest(): BookManifest {
  const element = document.getElementById('ds-manifest');
  if (!element?.textContent) throw new Error('The book has no manifest (#ds-manifest).');
  return JSON.parse(element.textContent) as BookManifest;
}

function parseHash(): Toggles & { at: string | null } {
  const params = new URLSearchParams(location.hash.slice(1));
  const width = Number(params.get('w'));
  return {
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    lang: params.get('lang') === 'fr' ? 'fr' : 'en',
    width: (BOOK_WIDTHS as readonly number[]).includes(width) ? width : viewportWidth(),
    at: params.get('at'),
  };
}

/** The book width nearest this window, the default when the hash names none: 390 on a phone, 768 on a tablet, else 1440. */
function viewportWidth(): number {
  const viewport = window.innerWidth;
  if (viewport < 768) return 390;
  return viewport < 1024 ? 768 : 1440;
}

function writeHash(toggles: Toggles, at: string | null): void {
  const params = new URLSearchParams({ theme: toggles.theme, lang: toggles.lang, w: String(toggles.width) });
  if (at) params.set('at', at);
  history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
}

const HSL_TRIPLET = /^-?\d+(\.\d+)?(deg)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%(\s*\/\s*[\d.]+%?)?$/;

/** The CSS colour a token value paints, or null when it is not a colour. HSL triplets are painted as hsl(value). */
export function swatchColor(value: string): string | null {
  const trimmed = value.trim();
  if (HSL_TRIPLET.test(trimmed)) return `hsl(${trimmed})`;
  if (/var\(/.test(trimmed)) return null;
  if (/^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix)\()/i.test(trimmed)) {
    return typeof CSS !== 'undefined' && CSS.supports('color', trimmed) ? trimmed : null;
  }
  return null;
}

function swatch(value: string): HTMLElement | null {
  const color = swatchColor(value);
  return color ? h('span', { class: 'ds-swatch', 'aria-hidden': 'true', style: { background: color } }) : null;
}

function importLine(names: string[], entry: string): string {
  return `import { ${names.join(', ')} } from '${entry}';`;
}

class BookShell implements Book {
  readonly manifest: BookManifest;
  readonly main: HTMLElement;
  readonly removedSection: HTMLElement;
  private current: Toggles;
  private at: string | null;
  private readonly toggleListeners = new Set<(toggles: Toggles) => void>();
  private readonly frameListeners = new Set<(report: FrameReport, iframe: HTMLIFrameElement) => void>();
  private readonly stages = new Map<string, Stage>();
  private readonly stageByElement = new WeakMap<Element, Stage>();
  private readonly rowIndex = new Map<string, HTMLElement[]>();
  private readonly live: Stage[] = [];
  private readonly observer: IntersectionObserver;
  private readonly resizeObserver: ResizeObserver;
  private placeholder: ((specimen: string, state: string, toggles: Toggles) => HTMLElement | null) | null = null;
  private readonly toggleButtons: Array<{ key: keyof Toggles; value: string | number; button: HTMLButtonElement }> = [];
  private readonly specimensById = new Map<string, BookSpecimen>();
  private readonly searchable: Array<{ text: string; elements: HTMLElement[]; group: string }> = [];
  private readonly groupElements = new Map<string, HTMLElement[]>();
  private indexButton: HTMLButtonElement | null = null;
  private indexOpen = false;
  private stopHolding: (() => void) | null = null;

  constructor(manifest: BookManifest) {
    this.manifest = manifest;
    const hash = parseHash();
    this.current = { theme: hash.theme, lang: hash.lang, width: hash.width };
    this.at = hash.at;
    for (const specimen of manifest.specimens) this.specimensById.set(specimen.id, specimen);
    this.observer = new IntersectionObserver((entries) => this.intersections(entries), { rootMargin: '400px 0px' });
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) this.stageByElement.get(entry.target)?.layout();
    });
    this.main = h('main', { class: 'ds-main', id: 'ds-main' });
    this.removedSection = h('section', { class: 'ds-section', id: 'removed', hidden: true });
    window.addEventListener('message', (event) => this.message(event));
  }

  toggles(): Toggles {
    return { ...this.current };
  }

  setToggles(next: Partial<Toggles>): void {
    const merged = { ...this.current, ...next };
    if (merged.theme === this.current.theme && merged.lang === this.current.lang && merged.width === this.current.width) return;
    this.current = merged;
    writeHash(this.current, this.at);
    this.applyTheme();
    for (const { key, value, button } of this.toggleButtons) button.setAttribute('aria-pressed', String(this.current[key] === value));
    for (const stage of this.stages.values()) stage.togglesChanged();
    for (const listener of this.toggleListeners) listener(this.toggles());
  }

  onToggles(listener: (toggles: Toggles) => void): void {
    this.toggleListeners.add(listener);
  }

  effective(state: BookState, toggles: Toggles = this.current): Effective {
    return {
      theme: state.theme ?? toggles.theme,
      lang: toggles.lang,
      width: state.width ?? toggles.width,
      fixedTheme: Boolean(state.theme),
      fixedWidth: Boolean(state.width),
    };
  }

  frameUrl(specimen: string, state: string, toggles: Toggles, base = location.pathname): string {
    const params = new URLSearchParams({ frame: specimen, state, theme: toggles.theme, lang: toggles.lang, w: String(toggles.width) });
    return `${base}?${params}`;
  }

  specimenElement(id: string): HTMLElement | null {
    return document.getElementById(`specimen-${id}`);
  }

  stateElement(specimen: string, state: string): HTMLElement | null {
    return this.stages.get(`${specimen}/${state}`)?.element ?? null;
  }

  indexItem(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-ds-index="${CSS.escape(id)}"]`);
  }

  liveFrame(specimen: string, state: string): HTMLIFrameElement | null {
    return this.stages.get(`${specimen}/${state}`)?.iframe ?? null;
  }

  onFrame(listener: (report: FrameReport, iframe: HTMLIFrameElement) => void): void {
    this.frameListeners.add(listener);
  }

  scrollTo(id: string): void {
    const target = document.getElementById(id);
    if (!target) return;
    this.at = id;
    writeHash(this.current, this.at);
    this.hold(target);
  }

  /**
   * Scrolls to a target and keeps it there while the frames around it load, measure their content and grow, until the
   * page has held its height for a second and a half, ten seconds pass, or the reader scrolls on their own.
   */
  private hold(target: HTMLElement): void {
    this.stopHolding?.();
    target.scrollIntoView({ block: 'start' });
    let top = target.getBoundingClientRect().top;
    let pageHeight = document.documentElement.scrollHeight;
    let stillSince = performance.now();
    const startedAt = stillSince;
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(type, stop);
      if (this.stopHolding === stop) this.stopHolding = null;
    };
    const tick = () => {
      const now = performance.now();
      if (!target.isConnected || now - startedAt > 10000 || now - stillSince > 1500) return stop();
      const height = document.documentElement.scrollHeight;
      if (height !== pageHeight) {
        pageHeight = height;
        stillSince = now;
      }
      if (Math.abs(target.getBoundingClientRect().top - top) > 1) {
        target.scrollIntoView({ block: 'start' });
        top = target.getBoundingClientRect().top;
        stillSince = now;
      }
      frame = requestAnimationFrame(tick);
    };
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(type, stop, { passive: true });
    this.stopHolding = stop;
    frame = requestAnimationFrame(tick);
  }

  setPlaceholder(render: ((specimen: string, state: string, toggles: Toggles) => HTMLElement | null) | null): void {
    this.placeholder = render;
    for (const stage of this.stages.values()) if (!stage.iframe) stage.showPlaceholder();
  }

  refreshFrames(): void {
    for (const stage of this.stages.values()) stage.togglesChanged();
  }

  setOverride(specimen: string, state: string, element: HTMLElement | null, height?: number): void {
    const stage = this.stages.get(`${specimen}/${state}`);
    if (!stage) return;
    if (element && stage.iframe) this.release(stage);
    stage.setOverride(element, height);
    if (!element) this.fill();
  }

  stageScale(specimen: string, state: string): number {
    return this.stages.get(`${specimen}/${state}`)?.scale() ?? 1;
  }

  rows(kind: RowKind, key: string): HTMLElement[] {
    return this.rowIndex.get(`${kind}|${key}`) ?? [];
  }

  private register(kind: RowKind, key: string, element: HTMLElement): void {
    const id = `${kind}|${key}`;
    const list = this.rowIndex.get(id);
    if (list) list.push(element);
    else this.rowIndex.set(id, [element]);
  }

  placeholderFor(specimen: string, state: string): HTMLElement | null {
    return this.placeholder ? this.placeholder(specimen, state, this.current) : null;
  }

  /** Mounts a stage's frame, evicting a live frame that is out of view when the budget is spent. */
  requestLive(stage: Stage): void {
    if (stage.iframe || stage.overridden) return;
    if (this.live.length >= MAX_LIVE_FRAMES) {
      const evict = this.live.find((item) => !item.visible);
      if (!evict) return;
      this.release(evict);
    }
    this.live.push(stage);
    stage.mount();
  }

  release(stage: Stage): void {
    const index = this.live.indexOf(stage);
    if (index >= 0) this.live.splice(index, 1);
    stage.unmount();
  }

  /** Gives free or out-of-view frames to the visible states still waiting for one, in page order. */
  private fill(): void {
    for (const stage of this.stages.values()) {
      if (stage.visible && !stage.iframe && !stage.overridden) this.requestLive(stage);
    }
  }

  private intersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const stage = this.stageByElement.get(entry.target);
      if (stage) stage.visible = entry.isIntersecting;
    }
    this.fill();
  }

  private message(event: MessageEvent): void {
    if (event.origin !== location.origin) return;
    const report = event.data as FrameReport | undefined;
    if (!report || report.type !== 'ds-frame') return;
    const stage = this.stages.get(`${report.specimen}/${report.state}`);
    if (!stage?.iframe || event.source !== stage.iframe.contentWindow) return;
    stage.report(report);
    for (const listener of this.frameListeners) listener(report, stage.iframe);
  }

  private applyTheme(): void {
    document.documentElement.classList.toggle('dark', this.current.theme === 'dark');
    document.documentElement.style.colorScheme = this.current.theme;
  }

  render(): void {
    this.applyTheme();
    document.title = 'Notis design system';
    const index = this.renderIndex();
    const bar = this.renderBar();
    // The bar wraps to two or three lines on narrow widths; book.css offsets every scroll target by its real height so
    // a section, specimen or state (and its ring) never lands under it.
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--ds-bar-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    }).observe(bar);
    this.main.append(bar, this.renderOverview());
    for (const group of this.manifest.groups) this.main.append(this.renderGroup(group));
    this.main.append(this.renderTokens(), this.renderWords(), this.renderApi(), this.removedSection);
    document.body.replaceChildren(h('div', { class: 'ds-app' }, index, this.main));
    for (const stage of this.stages.values()) {
      this.stageByElement.set(stage.stage, stage);
      this.observer.observe(stage.stage);
      this.resizeObserver.observe(stage.stage);
    }
    if (this.at) {
      requestAnimationFrame(() => {
        const target = document.getElementById(this.at ?? '');
        if (target) this.hold(target);
      });
    }
    writeHash(this.current, this.at);
    window.addEventListener('hashchange', () => this.hashChanged());
  }

  /** A pasted or hand-edited hash: either the full form (`theme=...&lang=...&w=...&at=...`) or a bare element id. */
  private hashChanged(): void {
    const raw = location.hash.slice(1);
    if (raw && !raw.includes('=')) {
      this.scrollTo(decodeURIComponent(raw));
      return;
    }
    const hash = parseHash();
    this.setToggles({ theme: hash.theme, lang: hash.lang, width: hash.width });
    if (hash.at && hash.at !== this.at) this.scrollTo(hash.at);
    else writeHash(this.current, this.at);
  }

  private renderBar(): HTMLElement {
    const group = (label: string, key: keyof Toggles, options: Array<{ value: string | number; text: string }>) => {
      const buttons = options.map(({ value, text }) => {
        const button = h('button', {
          type: 'button',
          class: 'ds-toggle',
          text,
          'aria-pressed': String(this.current[key] === value),
          onclick: () => this.setToggles({ [key]: value } as Partial<Toggles>),
        });
        this.toggleButtons.push({ key, value, button });
        return button;
      });
      return h('div', { class: 'ds-toggle-group', role: 'group', 'aria-label': label }, ...buttons);
    };
    // Below 760 px the index is a full screen panel behind this button (book.css hides the button when wider).
    const indexButton = h('button', {
      type: 'button',
      class: 'ds-toggle ds-index-open',
      text: 'Index',
      'aria-controls': 'ds-index',
      'aria-expanded': 'false',
      onclick: () => this.setIndexOpen(true),
    });
    this.indexButton = indexButton;
    return h('header', { class: 'ds-bar' },
      h('div', { class: 'ds-bar-title' }, indexButton, h('strong', { text: 'Notis design system' }),
        h('span', { class: 'ds-muted', text: `Built ${this.manifest.built} UTC` })),
      h('div', { class: 'ds-bar-toggles' },
        group('Theme', 'theme', [{ value: 'light', text: 'Light' }, { value: 'dark', text: 'Dark' }]),
        group('Language', 'lang', [{ value: 'en', text: 'EN' }, { value: 'fr', text: 'FR' }]),
        group('Width', 'width', BOOK_WIDTHS.map((width) => ({ value: width, text: String(width) })))));
  }

  private renderIndex(): HTMLElement {
    const nav = h('nav', { class: 'ds-index-list', 'aria-label': 'Book index' });
    const link = (id: string, text: string, className: string, indexId = id) => h('a', {
      href: `#${id}`,
      class: className,
      text,
      'data-ds-index': indexId,
      onclick: (event: Event) => {
        event.preventDefault();
        this.setIndexOpen(false);
        this.scrollTo(id);
      },
    });
    nav.append(link('overview', 'Overview', 'ds-index-section'));
    for (const group of this.manifest.groups) {
      const items = this.manifest.specimens.filter((specimen) => specimen.group === group.key);
      const groupLink = link(`group-${group.key}`, group.title, 'ds-index-section', `group-${group.key}`);
      const list = h('div', { class: 'ds-index-group' }, groupLink);
      for (const specimen of items) {
        const item = link(`specimen-${specimen.id}`, specimen.name, 'ds-index-item', specimen.id);
        item.append(h('span', { class: 'ds-index-badge', 'data-ds-badge': specimen.id }));
        list.append(item);
        this.searchable.push({ text: this.searchText(specimen), elements: [item], group: group.key });
      }
      this.groupElements.set(group.key, [list]);
      nav.append(list);
    }
    nav.append(link('tokens', 'Tokens', 'ds-index-section'), link('words', 'Words', 'ds-index-section'),
      link('api', 'API index', 'ds-index-section'));
    const removedLink = link('removed', 'Removed', 'ds-index-section');
    removedLink.hidden = true;
    removedLink.id = 'ds-index-removed';
    nav.append(removedLink);
    const search = h('input', {
      type: 'search',
      class: 'ds-search',
      placeholder: 'Search components',
      'aria-label': 'Search components',
      oninput: (event: Event) => this.search((event.target as HTMLInputElement).value),
    });
    const close = h('button', {
      type: 'button',
      class: 'ds-toggle ds-index-close',
      text: 'Close',
      'aria-controls': 'ds-index',
      onclick: () => this.setIndexOpen(false),
    });
    const aside = h('aside', { class: 'ds-index', id: 'ds-index', 'aria-label': 'Index' },
      h('div', { class: 'ds-index-top' }, search, close), nav);
    aside.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.indexOpen) {
        this.setIndexOpen(false);
        this.indexButton?.focus();
      }
    });
    return aside;
  }

  /** Opens or closes the index panel of the narrow layout (a no-op look wise when the index is a column). */
  private setIndexOpen(open: boolean): void {
    if (this.indexOpen === open) return;
    this.indexOpen = open;
    document.querySelector('.ds-app')?.toggleAttribute('data-ds-index-open', open);
    this.indexButton?.setAttribute('aria-expanded', String(open));
    if (open) document.querySelector<HTMLInputElement>('.ds-search')?.focus();
  }

  private searchText(specimen: BookSpecimen): string {
    const aliases = this.manifest.aliases.filter((alias) => specimen.covers.includes(alias.of) || specimen.covers.includes(alias.name));
    return [specimen.name, specimen.id, specimen.summary, ...specimen.covers, ...aliases.map((alias) => alias.name)].join(' ').toLowerCase();
  }

  private search(query: string): void {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const shownGroups = new Set<string>();
    for (const item of this.searchable) {
      const shown = words.every((word) => item.text.includes(word));
      for (const element of item.elements) element.hidden = !shown;
      if (shown) shownGroups.add(item.group);
    }
    for (const [group, elements] of this.groupElements) {
      for (const element of elements) element.hidden = words.length > 0 && !shownGroups.has(group);
    }
  }

  private renderOverview(): HTMLElement {
    const { manifest } = this;
    const values = new Set(manifest.components.map((component) => component.of));
    const states = manifest.specimens.reduce((sum, specimen) => sum + specimen.states.length, 0);
    const uncovered = manifest.components.filter((component) => !component.specimen);
    const counts = h('div', { class: 'ds-counts' },
      ...[
        [manifest.components.length, 'component names'],
        [values.size, 'component values'],
        [manifest.specimens.length, 'specimens'],
        [states, 'states'],
        [manifest.api.filter((item) => !this.isComponentExport(item.name, item.entry)).length, 'other exports'],
      ].map(([count, label]) => h('div', { class: 'ds-count' }, h('strong', { text: String(count) }), h('span', { text: String(label) }))));
    const imports = h('div', { class: 'ds-imports' });
    for (const entry of ENTRY_ORDER) {
      const components = manifest.components.filter((component) => component.entries.includes(entry)).map((component) => component.name);
      const others = manifest.api.filter((item) => item.entry === entry && !this.isComponentExport(item.name, entry));
      const shown = components.length > 0 ? components.slice(0, 3) : others.slice(0, 3).map((item) => item.name);
      const rest = components.length + others.length - shown.length;
      imports.append(h('div', { class: 'ds-import' },
        code(importLine(rest > 0 ? [...shown, '...'] : shown, entry)),
        h('span', { class: 'ds-muted', text: `${count(components.length, 'component')}, ${count(others.length, 'other export')}` })));
    }
    const section = h('section', { class: 'ds-section', id: 'overview' },
      h('h1', { text: 'Notis design system' }),
      h('p', { class: 'ds-muted', text: `Every component of @notis/sdk, @notis/sdk/ui and @notis/sdk/interactions, live, in light and dark, English and French, at 390, 768 and 1440 px.${manifest.scope_digest ? ` Scope ${manifest.scope_digest.slice(0, 12)}.` : ''}` }),
      counts, imports);
    if (!manifest.inventory.ok) {
      section.append(h('div', { class: 'ds-problems', role: 'status' },
        h('strong', { text: `The inventory is incomplete: ${manifest.inventory.problems.length} problems${uncovered.length ? `, ${uncovered.length} components without a specimen` : ''}.` }),
        h('ul', {}, ...manifest.inventory.problems.slice(0, 200).map((problem) => h('li', { text: problem.message })))));
    }
    return section;
  }

  private isComponentExport(name: string, entry: string): boolean {
    return this.manifest.components.some((component) => component.name === name && component.entries.includes(entry as BookComponent['entries'][number]))
      || this.manifest.third_party.some((item) => item.name === name && item.entry === entry);
  }

  private renderGroup(group: { key: string; title: string }): HTMLElement {
    const specimens = this.manifest.specimens.filter((specimen) => specimen.group === group.key);
    const section = h('section', { class: 'ds-section ds-group', id: `group-${group.key}`, 'data-ds-group': group.key },
      h('h2', { text: group.title }),
      h('p', { class: 'ds-muted', text: count(specimens.length, 'specimen') }));
    for (const specimen of specimens) {
      const article = this.renderSpecimen(specimen);
      section.append(article);
      const searchItem = this.searchable.find((item) => item.elements[0]?.getAttribute('data-ds-index') === specimen.id);
      searchItem?.elements.push(article);
    }
    const missing = this.manifest.components.filter((component) => !component.specimen && component.group === group.key && component.name === component.of);
    if (missing.length > 0) {
      section.append(h('div', { class: 'ds-missing' },
        h('strong', { text: `No specimen yet (${missing.length})` }),
        h('ul', {}, ...missing.map((component) => h('li', {}, code(component.name), ' ', h('span', { class: 'ds-muted', text: where(component.file, component.line) }))))));
    }
    this.groupElements.get(group.key)?.push(section);
    return section;
  }

  private renderSpecimen(specimen: BookSpecimen): HTMLElement {
    const aliasesOf = (name: string) => this.manifest.aliases.filter((alias) => alias.of === name && !specimen.covers.includes(alias.name));
    const covers = h('p', { class: 'ds-covers' }, 'Covers ',
      ...specimen.covers.flatMap((name, index) => {
        const aliases = aliasesOf(name);
        const parts: Child[] = [index > 0 ? ', ' : null, code(name)];
        if (aliases.length > 0) parts.push(` (also exported as ${aliases.map((alias) => `${alias.name} from ${alias.entry}`).join(', ')})`);
        return parts;
      }));
    const sources = h('ul', { class: 'ds-sources' },
      ...specimen.sources.map((source) => h('li', {}, code(source.name), ' ', h('span', { class: 'ds-muted', text: where(source.file, source.line) }))),
      h('li', {}, h('span', { class: 'ds-muted', text: `Specimen ${specimen.file}` })));
    const article = h('article', { class: 'ds-specimen', id: `specimen-${specimen.id}`, 'data-ds-specimen': specimen.id },
      h('header', { class: 'ds-specimen-head' },
        h('h3', { text: specimen.name }),
        h('span', { class: 'ds-badge-slot', 'data-ds-badge': specimen.id })),
      code(importLine(specimen.covers, specimen.from), 'ds-code ds-import-line'),
      covers,
      h('p', { text: specimen.summary }),
      sources);
    for (const state of specimen.states) {
      const stage = new Stage(this, specimen, state);
      this.stages.set(`${specimen.id}/${state.id}`, stage);
      article.append(stage.element);
    }
    return article;
  }

  private renderTokens(): HTMLElement {
    const { portal, toolkit } = this.manifest.tokens;
    const isRoot = (token: BookToken) => /(^|> )(:root)$/.test(token.chain);
    const isDark = (token: BookToken) => /(^|> )(\.dark)$/.test(token.chain);
    const names: string[] = [];
    const light = new Map<string, BookToken>();
    const dark = new Map<string, BookToken>();
    for (const token of portal) {
      if (isRoot(token)) light.set(token.name, token);
      else if (isDark(token)) dark.set(token.name, token);
      else continue;
      if (!names.includes(token.name)) names.push(token.name);
    }
    const fileOf = (token: BookToken) => token.file ?? PORTAL_TOKENS_FILE;
    const themeFiles = [...new Set([...light.values(), ...dark.values()].map(fileOf))];
    // One file: the paragraph names it and each value shows its line; more: each value shows its file too.
    const valueCell = (token: BookToken | undefined) => token
      ? h('div', { class: 'ds-token-value' }, swatch(token.value), code(token.value),
        h('span', { class: 'ds-muted', text: themeFiles.length > 1 ? where(fileOf(token), token.line) : `:${token.line}` }))
      : h('div', { class: 'ds-token-value ds-muted', text: 'not set' });
    const themeRows = names.map((name) => {
      const row = h('div', { class: 'ds-row ds-token-row', 'data-ds-token': `portal:${name}` },
        code(name), valueCell(light.get(name)), valueCell(dark.get(name)));
      for (const token of [light.get(name), dark.get(name)]) {
        if (token) this.register('token', rowKey('token', { source: 'portal', chain: token.chain, name }), row);
      }
      return row;
    });
    const themeTokens = portal.filter((token) => token.chain.startsWith('@theme'));
    const themeBlockRows = themeTokens.map((token) => {
      const row = h('div', { class: 'ds-row ds-token-row', 'data-ds-token': `theme:${token.name}` },
        code(token.name), h('div', { class: 'ds-token-value' }, swatch(token.value), code(token.value)),
        h('span', { class: 'ds-muted', text: `${token.chain === '@theme' ? '' : `${token.chain}, `}${where(fileOf(token), token.line)}` }));
      this.register('token', rowKey('token', { source: 'portal', chain: token.chain, name: token.name }), row);
      return row;
    });
    const toolkitRows = toolkit.map((token) => {
      const row = h('div', { class: 'ds-row ds-token-row', 'data-ds-token': `toolkit:${token.chain}:${token.name}` },
        code(token.name), h('div', { class: 'ds-token-value' }, swatch(token.value), code(token.value)),
        h('span', { class: 'ds-muted', text: `${token.chain}, ${where(token.file ?? null, token.line)}` }));
      this.register('token', rowKey('token', { source: 'toolkit', chain: token.chain, name: token.name }), row);
      return row;
    });
    return h('section', { class: 'ds-section', id: 'tokens' },
      h('h2', { text: 'Tokens' }),
      h('h3', { text: 'Portal theme' }),
      h('p', { class: 'ds-muted', text: `${themeFiles.join(', ') || PORTAL_TOKENS_FILE}, :root and .dark inside @layer base. Line numbers follow each value.` }),
      h('div', { class: 'ds-row ds-token-row ds-row-head' }, h('span', { text: 'Token' }), h('span', { text: 'Light' }), h('span', { text: 'Dark' })),
      ...themeRows,
      h('h3', { text: '@theme' }),
      ...themeBlockRows,
      h('h3', { text: 'Toolkit properties' }),
      h('p', { class: 'ds-muted', text: 'The --nui-* properties of packages/sdk/src/ui/toolkit.css.' }),
      ...toolkitRows);
  }

  private renderWords(): HTMLElement {
    const tables = this.manifest.words.map((table) => {
      const missing = table.rows.filter((row) => !row.raw && !row.fr.trim()).length;
      return h('div', { class: 'ds-words', id: `words-${table.name}`, 'data-ds-words': `${table.entry}:${table.name}` },
        h('h3', {}, code(table.name), ' ', h('span', { class: 'ds-muted', text: `${table.entry}, ${count(table.rows.length, 'key')}${missing ? `, ${missing} missing FR` : ''}` })),
        h('div', { class: 'ds-row ds-words-row ds-row-head' }, h('span', { text: 'Key' }), h('span', { text: 'EN' }), h('span', { text: 'FR' })),
        ...table.rows.map((row) => {
          const element = h('div', { class: 'ds-row ds-words-row', 'data-ds-word': `${table.name}:${row.key}` },
            code(row.key),
            row.raw ? code(row.en) : h('span', { text: row.en }),
            row.raw ? h('span', { class: 'ds-muted', text: 'not an EN and FR pair' })
              : row.fr.trim() ? h('span', { text: row.fr }) : h('span', { class: 'ds-flag', text: 'missing FR' }));
          this.register('word', rowKey('word', { entry: table.entry, table: table.name, key: row.key }), element);
          return element;
        }));
    });
    return h('section', { class: 'ds-section', id: 'words' },
      h('h2', { text: 'Words' }),
      h('p', { class: 'ds-muted', text: `Every exported *_WORDS table of the four entries (${this.manifest.words.length} tables).` }),
      ...tables);
  }

  private renderApi(): HTMLElement {
    const kinds: Array<{ kind: string; title: string }> = [
      { kind: 'hook', title: 'Hooks' },
      { kind: 'helper', title: 'Helpers' },
      { kind: 'class', title: 'Classes' },
      { kind: 'constant', title: 'Constants' },
      { kind: 'type', title: 'Types' },
    ];
    const rows = this.manifest.api.filter((item) => !this.isComponentExport(item.name, item.entry));
    const section = h('section', { class: 'ds-section', id: 'api' },
      h('h2', { text: 'API index' }),
      h('p', { class: 'ds-muted', text: 'Every export that is not a component, by kind, with its entry, declaration and first doc line.' }));
    for (const { kind, title } of kinds) {
      const items = rows.filter((item) => item.kind === kind).sort((a, b) => a.name.localeCompare(b.name) || a.entry.localeCompare(b.entry));
      if (items.length === 0) continue;
      section.append(h('h3', { id: `api-${kind}`, text: `${title} (${items.length})` }),
        ...items.map((item) => {
          const row = h('div', { class: 'ds-row ds-api-row', 'data-ds-api': `${item.entry}:${item.name}` },
            code(item.name),
            h('span', { class: 'ds-muted', text: item.entry }),
            h('span', { class: 'ds-muted', text: where(item.file, item.line) }),
            h('span', { text: item.doc }));
          this.register('api', rowKey('api', item), row);
          return row;
        }));
    }
    // A row of any other kind (a component the inventory does not list) would otherwise vanish from the book.
    const unclassified = rows.filter((item) => !kinds.some(({ kind }) => kind === item.kind))
      .sort((a, b) => a.name.localeCompare(b.name) || a.entry.localeCompare(b.entry));
    if (unclassified.length > 0) {
      section.append(h('h3', { id: 'api-unclassified', text: `Unclassified (${unclassified.length})` }),
        h('p', { class: 'ds-muted', text: 'Declared like components, but neither a component with a specimen nor a recharts re-export. Each one is an inventory problem.' }),
        ...unclassified.map((item) => {
          const row = h('div', { class: 'ds-row ds-api-row', 'data-ds-api': `${item.entry}:${item.name}` },
            code(item.name),
            h('span', { class: 'ds-muted', text: item.entry }),
            h('span', { class: 'ds-muted', text: where(item.file, item.line) }),
            h('span', { class: 'ds-flag', text: `${String(item.kind)}, unclassified` }));
          this.register('api', rowKey('api', item), row);
          return row;
        }));
    }
    const thirdParty = this.manifest.third_party;
    if (thirdParty.length > 0) {
      section.append(h('h3', { id: 'api-third-party', text: `Third party, from recharts (${thirdParty.length})` }),
        h('p', { class: 'ds-muted', text: 'Re-exported unchanged and shown live in the charts specimens.' }),
        ...thirdParty.map((item) => {
          const row = h('div', { class: 'ds-row ds-api-row', 'data-ds-api': `${item.entry}:${item.name}` },
            code(item.name), h('span', { class: 'ds-muted', text: item.entry }),
            h('span', { class: 'ds-muted', text: `recharts ${item.as}` }), h('span', { text: 'third party, from recharts' }));
          this.register('api', rowKey('api', item), row);
          return row;
        }));
    }
    return section;
  }
}

/** One state of a specimen: its label line, its 1:1 control and its lazily mounted frame. */
class Stage {
  readonly element: HTMLElement;
  readonly stage: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly labelNote: HTMLElement;
  private readonly status: HTMLElement;
  iframe: HTMLIFrameElement | null = null;
  visible = false;
  private override: { element: HTMLElement; height: number | null } | null = null;
  private actual = false;
  private height: number;
  private src = '';

  constructor(private readonly book: BookShell, readonly specimen: BookSpecimen, readonly state: BookState) {
    this.height = state.height ?? DEFAULT_FRAME_HEIGHT;
    this.labelNote = h('span', { class: 'ds-muted' });
    this.status = h('span', { class: 'ds-frame-status', role: 'status' });
    const actual = h('button', {
      type: 'button',
      class: 'ds-toggle ds-actual',
      text: '1:1',
      title: 'Show this state at full size',
      'aria-pressed': 'false',
      onclick: () => {
        this.actual = !this.actual;
        actual.setAttribute('aria-pressed', String(this.actual));
        this.element.toggleAttribute('data-ds-actual', this.actual);
        this.layout();
      },
    });
    const open = h('a', { class: 'ds-link', text: 'Open', target: '_blank', rel: 'noopener', title: 'Open this state alone' });
    this.viewport = h('div', { class: 'ds-viewport' });
    this.stage = h('div', { class: 'ds-stage' }, this.viewport);
    this.element = h('div', { class: 'ds-state', id: `state-${specimen.id}-${state.id}`, 'data-ds-state': state.id, 'data-ds-specimen-state': `${specimen.id}/${state.id}` },
      h('div', { class: 'ds-state-head' },
        h('span', { class: 'ds-state-label', text: state.label }), this.labelNote, this.status,
        h('span', { class: 'ds-state-actions' }, open, actual)),
      this.stage);
    this.updateLabel();
    open.addEventListener('click', () => { open.href = this.url(); });
    open.href = this.url();
    this.showPlaceholder();
  }

  url(): string {
    return this.book.frameUrl(this.specimen.id, this.state.id, this.effective());
  }

  effective(): Effective {
    return this.book.effective(this.state);
  }

  private updateLabel(): void {
    const notes: string[] = [];
    if (this.state.width) notes.push(`fixed width ${this.state.width} px, the width toggle does not apply`);
    if (this.state.theme) notes.push(`always ${this.state.theme}, the theme toggle does not apply`);
    if (this.state.interact) notes.push('opened by a scripted step');
    this.labelNote.textContent = notes.join('; ');
  }

  get overridden(): boolean {
    return this.override !== null;
  }

  setOverride(element: HTMLElement | null, height?: number): void {
    if (!element) {
      this.override = null;
      this.showPlaceholder();
      return;
    }
    const same = this.override?.element === element;
    this.override = { element, height: height ?? null };
    if (!same) this.viewport.replaceChildren(element);
    this.layout();
  }

  mount(): void {
    if (this.iframe || this.override) return;
    this.src = this.url();
    const iframe = h('iframe', {
      class: 'ds-frame',
      title: `${this.specimen.name}: ${this.state.label}`,
      loading: 'eager',
      src: this.src,
    });
    this.iframe = iframe;
    this.status.textContent = '';
    this.viewport.replaceChildren(iframe);
    this.layout();
  }

  unmount(): void {
    this.iframe = null;
    this.showPlaceholder();
  }

  showPlaceholder(): void {
    if (this.iframe) return;
    if (this.override) {
      if (this.viewport.firstElementChild !== this.override.element) this.viewport.replaceChildren(this.override.element);
      this.layout();
      return;
    }
    const custom = this.book.placeholderFor(this.specimen.id, this.state.id);
    this.viewport.replaceChildren(custom ?? h('div', { class: 'ds-placeholder', text: 'Renders when in view' }));
    this.layout();
  }

  togglesChanged(): void {
    const next = this.url();
    const open = this.element.querySelector<HTMLAnchorElement>('.ds-link');
    if (open) open.href = next;
    if (this.iframe) {
      if (next !== this.src) {
        this.src = next;
        this.iframe.src = next;
        this.status.textContent = '';
      }
    } else {
      this.showPlaceholder();
    }
    this.layout();
  }

  report(report: FrameReport): void {
    if (!this.state.height && report.height > 0 && Math.abs(report.height - this.height) > 1) {
      this.height = report.height;
      this.layout();
    }
    const flags = report.flags.filter((flag) => flag !== 'error' && flag !== 'timeout');
    if (report.status === 'error') this.status.textContent = `Render failed: ${report.error ?? 'unknown error'}`;
    else if (report.status === 'timeout') this.status.textContent = 'Timeout: not ready in 20 s';
    else this.status.textContent = flags.includes('network') ? 'Network request blocked' : '';
    this.element.dataset.dsFrameStatus = report.status;
  }

  /** The scale the stage shows its content at. */
  scale(): number {
    const width = this.effective().width;
    return this.actual ? 1 : Math.min(1, (this.stage.clientWidth || width) / width);
  }

  layout(): void {
    const width = this.effective().width;
    const height = this.override?.height ?? this.height;
    const scale = this.scale();
    const content = this.viewport.firstElementChild as HTMLElement | null;
    this.viewport.style.width = `${width}px`;
    this.viewport.style.height = `${height}px`;
    this.viewport.style.transform = scale === 1 ? '' : `scale(${scale})`;
    this.stage.style.height = `${Math.ceil(height * scale)}px`;
    this.stage.classList.toggle('ds-stage-actual', this.actual);
    if (content && !this.override) {
      content.style.width = `${width}px`;
      content.style.height = `${height}px`;
    }
  }
}

/** Starts the book outside frame mode. */
export function startShell(): Book | null {
  if (new URLSearchParams(location.search).has('frame')) return null;
  let manifest: BookManifest;
  try {
    manifest = readManifest();
  } catch (error) {
    document.body.textContent = error instanceof Error ? error.message : String(error);
    return null;
  }
  const book = new BookShell(manifest);
  book.render();
  (window as unknown as { __dsBook?: Book }).__dsBook = book;
  if (new URLSearchParams(location.search).get('review') === '1') startReview(book);
  return book;
}

startShell();
