/**
 * Review mode of the design system book (design review spec, sections 3.4, 6.5 and 7), loaded by
 * `index.html?review=1`. The review page (`design_review.html`, which holds the book in an iframe) drives it
 * with window messages; every message is checked for the same origin and for coming from `window.parent`.
 *
 * Page to book:
 * - `{type: 'ds-review', base, changed_only, statuses, shots, removed?, rows}`: the statuses and rows of
 *   `design_review.py` (`compute_statuses`), `base` as `{url: '/base/index.html', label}` or null, and the shot
 *   URLs as `shots["<specimen>/<state>"]["<theme>-<lang>-<width>"] = {head, base}` (`/shots/<name>.png` or null).
 *   `removed` (the base manifest's specimens that are gone, with their states) is optional: without it the book
 *   reads `manifest.json` next to `base.url`. Sending the same data again changes nothing.
 * - `{type: 'ds-comment-mode', on}`: enter or leave comment mode.
 * - `{type: 'ds-pins', threads: [{id, anchor, status}], showResolved, active?}`: the pins, numbered by their index
 *   in `threads` plus one. It also clears the pending pin of a comment being written.
 * - `{type: 'ds-goto', specimen, state?, theme?, lang?, width?, thread?, open?}`: sets the given toggles ("Show as
 *   made"), scrolls to the state or specimen and marks the thread's pin active. With `open`, the book answers
 *   `ds-pin-open` for that thread once its pin has stopped moving, so the page opens the thread beside it (with
 *   `point: null` when the thread has no pin to show: an orphaned or hidden thread).
 *
 * Book to page:
 * - `{type: 'ds-ready'}` once listening; `{type: 'ds-toggles', theme, lang, width}` on every toggle change;
 * - `{type: 'ds-comment-mode', on}` when Shift+M or Esc changed the mode in the book or a frame;
 * - `{type: 'ds-anchor', anchor, point}` for a click in comment mode (anchor of section 7.2);
 * - `{type: 'ds-pin-open', id, point}` when a pin is clicked, the point being the pin's right edge at half its height
 *   (the review deck opens a note there);
 * - `{type: 'ds-pin-moved', ids}` whenever the set of threads whose anchor path no longer resolves changes, so the
 *   page marks them "moved" in the comments list and the thread box.
 * A `point` is in CSS pixels of the book's viewport; the page adds the iframe's own offset.
 *
 * Row keys follow `rowKey` in `manifest.ts`: an api row of the server is `rowKey('api', row)`, a token row
 * `rowKey('token', {source: row.set, chain, name})` and a word row `rowKey('word', {entry, table: row.name, key})`.
 */
import { cellKey, rowKey, type BookLang, type BookManifest, type BookSpecimen, type BookState, type BookTheme, type RowKind } from './manifest';
import type { Book, FrameReport, Toggles } from './shell';

export type SpecimenStatus = 'new' | 'removed' | 'changed' | 'same' | 'code' | 'unchanged' | 'failed' | 'timeout';
export type StateStatus = 'new' | 'removed' | 'changed' | 'failed' | 'timeout';
export type RowStatus = 'added' | 'removed' | 'changed';

export interface ReviewStatus {
  status: SpecimenStatus;
  label: string;
  name?: string | null;
  group?: string | null;
  states?: Record<string, StateStatus>;
}

/**
 * The specimen statuses the changes-only view hides, because nothing differs on screen: unchanged ones, and code
 * changes whose shots match the base pixel for pixel. `code` stays, as its shots are not taken yet.
 */
export const LOOKS_UNCHANGED: ReadonlySet<SpecimenStatus> = new Set<SpecimenStatus>(['unchanged', 'same']);

/** The states of a shown specimen that the changes-only view hides: those whose shots match the base. */
export function quietStates(entry: ReviewStatus | undefined, stateIds: string[]): string[] {
  if (!entry || entry.status === 'new' || entry.status === 'code' || !entry.states) return [];
  if (Object.keys(entry.states).length === 0) return [];
  return stateIds.filter((id) => !entry.states?.[id]);
}

export interface ShotUrls {
  head: string | null;
  base: string | null;
}

export type ReviewRow = Record<string, unknown> & { status: RowStatus; old?: Record<string, unknown> };

export interface RemovedSpecimen {
  id: string;
  name: string;
  group?: string;
  states: Array<{ id: string; label?: string; width?: number | null; height?: number | null; theme?: BookTheme | null }>;
}

export interface ReviewData {
  base: { url: string; label?: string } | null;
  changed_only?: boolean;
  statuses?: Record<string, ReviewStatus>;
  shots?: Record<string, Record<string, ShotUrls>>;
  removed?: RemovedSpecimen[];
  rows?: { api?: ReviewRow[]; tokens?: ReviewRow[]; words?: ReviewRow[] };
}

export interface CommentAnchor {
  specimen: string;
  state: string;
  root: 'state' | 'shadow' | 'document';
  path: string;
  x: number;
  y: number;
  label: string;
  theme: BookTheme;
  lang: BookLang;
  width: number;
}

export interface PinThread {
  id: string;
  anchor: CommentAnchor;
  status: 'open' | 'resolved';
}

export interface Point {
  x: number;
  y: number;
}

export type PageMessage =
  | ({ type: 'ds-review' } & ReviewData)
  | { type: 'ds-comment-mode'; on: boolean }
  | { type: 'ds-pins'; threads: PinThread[]; showResolved?: boolean; active?: string | null }
  | { type: 'ds-goto'; specimen: string; state?: string; theme?: BookTheme; lang?: BookLang; width?: number; thread?: string; open?: boolean };

export type BookMessage =
  | { type: 'ds-ready' }
  | { type: 'ds-toggles'; theme: BookTheme; lang: BookLang; width: number }
  | { type: 'ds-comment-mode'; on: boolean }
  | { type: 'ds-anchor'; anchor: CommentAnchor; point: Point }
  | { type: 'ds-pin-open'; id: string; point: Point | null }
  | { type: 'ds-pin-moved'; ids: string[] };

type Mode = 'after' | 'before' | 'difference';

const FRAME_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick'] as const;
const CROSSHAIR_CSS = '*, *::before, *::after { cursor: crosshair !important; }';
const CELLS_TEXT = 'Light EN 1440, Dark EN 1440, Light FR 390 and Dark FR 768';
const HOOKED = '__dsReviewHooked';
/** The pin's height in CSS pixels (book.css, `.ds-pin`). */
const PIN_SIZE = 24;

// Helpers shared with tests -----------------------------------------------------------------------------------

/**
 * `tag "text"` (aria-label or text, 40 characters then "..."), otherwise `.firstClass`, otherwise the tag. The text
 * is the rendered text when the element is laid out, so blocks and flex items stay apart and hidden copies drop out.
 */
export function anchorLabel(element: Element): string {
  const tag = element.localName;
  const rendered = element.isConnected ? (element as HTMLElement).innerText : undefined;
  const text = (element.getAttribute('aria-label') || (typeof rendered === 'string' && rendered.trim() ? rendered : element.textContent) || '')
    .replace(/\s+/g, ' ').trim();
  if (text) return `${tag} "${text.length > 40 ? `${text.slice(0, 40)}...` : text}"`;
  const first = element.classList[0];
  return first ? `.${first}` : tag;
}

/** The ` > tag:nth-of-type(n)` steps from `ancestor` down to `target`, or null when `target` is not below it. */
export function pathSteps(ancestor: Node, target: Element): string[] | null {
  const steps: string[] = [];
  let node: Element = target;
  while (node !== ancestor) {
    const parent = node.parentNode as (ParentNode & Node) | null;
    if (!parent) return null;
    const same = Array.from(parent.children).filter((child) => child.localName === node.localName);
    steps.unshift(`${node.localName}:nth-of-type(${same.indexOf(node) + 1})`);
    if (parent === ancestor) break;
    if (parent.nodeType !== 1) return null;
    node = parent as unknown as Element;
  }
  return steps;
}

function frameShadow(doc: Document): ShadowRoot | null {
  return doc.getElementById('ds-frame')?.shadowRoot ?? null;
}

/** The element an anchor path names in a frame document, or null when it no longer resolves. */
export function resolveAnchor(doc: Document, root: CommentAnchor['root'], path: string): Element | null {
  const [head, ...steps] = path.split(' > ');
  if (head !== root) return null;
  const shadow = frameShadow(doc);
  let node: Node | null = root === 'state' ? shadow?.querySelector('[data-ds-state-root]') ?? null : root === 'shadow' ? shadow : doc;
  for (const step of steps) {
    const match = /^([a-z][a-z0-9-]*):nth-of-type\((\d+)\)$/i.exec(step);
    if (!match || !node) return null;
    const tag = match[1].toLowerCase();
    const children: Element[] = Array.from((node as ParentNode).children ?? []).filter((child) => child.localName === tag);
    node = children[Number(match[2]) - 1] ?? null;
  }
  if (!node) return null;
  if (node.nodeType === 1) return node as Element;
  if (node.nodeType === 11) return (node as ShadowRoot).host ?? null;
  if (node.nodeType === 9) return (node as Document).documentElement;
  return null;
}

function round3(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** The anchor of a click in a frame document (section 7.2), without the toggles. */
export function frameAnchor(doc: Document, event: MouseEvent): Omit<CommentAnchor, 'specimen' | 'state' | 'theme' | 'lang' | 'width'> | null {
  const first = event.composedPath()[0] as Node | undefined;
  let hit: Element | null = null;
  if (first?.nodeType === 1) hit = first as Element;
  else if (first?.nodeType === 3) hit = first.parentElement;
  if (!hit) {
    hit = doc.elementFromPoint(event.clientX, event.clientY);
    if (hit?.shadowRoot) hit = hit.shadowRoot.elementFromPoint(event.clientX, event.clientY) ?? hit;
  }
  if (!hit) return null;
  const shadow = frameShadow(doc);
  const stateRoot = shadow?.querySelector('[data-ds-state-root]') ?? null;
  let root: CommentAnchor['root'] = 'document';
  let steps: string[] | null = null;
  for (let guard = 0; guard < 20 && hit; guard += 1) {
    if (stateRoot && (stateRoot === hit || stateRoot.contains(hit))) {
      root = 'state';
      steps = pathSteps(stateRoot, hit);
    } else if (shadow && hit.getRootNode() === shadow) {
      root = 'shadow';
      steps = pathSteps(shadow, hit);
    } else {
      root = 'document';
      steps = pathSteps(doc, hit);
    }
    if (steps) break;
    const owner = hit.getRootNode() as ShadowRoot;
    hit = owner.nodeType === 11 ? owner.host : null;
  }
  if (!hit || !steps) return null;
  const rect = hit.getBoundingClientRect();
  const x = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
  return { root, path: [root, ...steps].join(' > '), x: round3(x), y: round3(y), label: anchorLabel(hit) };
}

/**
 * Paints the difference of two RGBA buffers of the same size into `out`: changed pixels in `change`, the others
 * as `head` dimmed toward `background`. Returns the number of changed pixels.
 */
export function paintDifference(
  head: Uint8ClampedArray,
  base: Uint8ClampedArray,
  out: Uint8ClampedArray,
  change: readonly [number, number, number],
  background: readonly [number, number, number],
  dim = 0.7,
): number {
  let changed = 0;
  for (let i = 0; i < out.length; i += 4) {
    const differs = head[i] !== base[i] || head[i + 1] !== base[i + 1] || head[i + 2] !== base[i + 2] || head[i + 3] !== base[i + 3];
    if (differs) {
      changed += 1;
      out[i] = change[0];
      out[i + 1] = change[1];
      out[i + 2] = change[2];
    } else {
      const alpha = head[i + 3] / 255;
      for (let c = 0; c < 3; c += 1) {
        const value = head[i + c] * alpha + background[c] * (1 - alpha);
        out[i + c] = Math.round(value * (1 - dim) + background[c] * dim);
      }
    }
    out[i + 3] = 255;
  }
  return changed;
}

export interface ChangeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Groups the pixels that differ between two RGBA buffers of the same size into boxes, so a reviewer sees each
 * changed part on its own: changed pixels closer than `gap` px share a box, and boxes that touch are merged.
 */
export function changeBoxes(head: Uint8ClampedArray, base: Uint8ClampedArray, width: number, height: number, gap = 24): ChangeBox[] {
  const cell = 8;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hit = new Uint8Array(columns * rows);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (head[i] !== base[i] || head[i + 1] !== base[i + 1] || head[i + 2] !== base[i + 2] || head[i + 3] !== base[i + 3]) {
        hit[Math.floor(y / cell) * columns + Math.floor(x / cell)] = 1;
      }
    }
  }
  const reach = Math.max(1, Math.ceil(gap / cell));
  const seen = new Uint8Array(columns * rows);
  let boxes: ChangeBox[] = [];
  for (let start = 0; start < hit.length; start += 1) {
    if (!hit[start] || seen[start]) continue;
    seen[start] = 1;
    const queue = [start];
    let left = columns, top = rows, right = 0, bottom = 0;
    while (queue.length) {
      const index = queue.pop() as number;
      const cx = index % columns;
      const cy = Math.floor(index / columns);
      left = Math.min(left, cx);
      top = Math.min(top, cy);
      right = Math.max(right, cx);
      bottom = Math.max(bottom, cy);
      for (let ny = Math.max(0, cy - reach); ny <= Math.min(rows - 1, cy + reach); ny += 1) {
        for (let nx = Math.max(0, cx - reach); nx <= Math.min(columns - 1, cx + reach); nx += 1) {
          const next = ny * columns + nx;
          if (hit[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    const x = left * cell;
    const y = top * cell;
    boxes.push({ x, y, width: Math.min(width, (right + 1) * cell) - x, height: Math.min(height, (bottom + 1) * cell) - y });
  }
  // Two boxes whose outlines would overlap read as one change.
  for (let merged = true; merged;) {
    merged = false;
    const next: ChangeBox[] = [];
    for (const box of boxes) {
      const other = next.find((item) => box.x < item.x + item.width + gap && item.x < box.x + box.width + gap
        && box.y < item.y + item.height + gap && item.y < box.y + box.height + gap);
      if (!other) {
        next.push({ ...box });
        continue;
      }
      const right = Math.max(other.x + other.width, box.x + box.width);
      const bottom = Math.max(other.y + other.height, box.y + box.height);
      other.x = Math.min(other.x, box.x);
      other.y = Math.min(other.y, box.y);
      other.width = right - other.x;
      other.height = bottom - other.y;
      merged = true;
    }
    boxes = next;
  }
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

// The review layer ---------------------------------------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';
let shadeCount = 0;

/** A layer that dims its stage except where `layoutShade` cuts holes, one per circled change. */
function shadeLayer(): SVGSVGElement {
  shadeCount += 1;
  const id = `ds-shade-${shadeCount}`;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ds-shade');
  const mask = document.createElementNS(SVG, 'mask');
  mask.id = id;
  const rect = document.createElementNS(SVG, 'rect');
  rect.setAttribute('class', 'ds-shade-fill');
  rect.setAttribute('mask', `url(#${id})`);
  svg.append(mask, rect);
  return svg;
}

function layoutShade(svg: SVGSVGElement, width: number, height: number, holes: Array<{ x: number; y: number; width: number; height: number }>): void {
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const mask = svg.querySelector('mask');
  const fill = svg.querySelector('.ds-shade-fill');
  if (!mask || !fill) return;
  const rect = (x: number, y: number, w: number, h: number, color: string, radius = 0) => {
    const item = document.createElementNS(SVG, 'rect');
    for (const [name, value] of Object.entries({ x, y, width: w, height: h, fill: color, rx: radius })) item.setAttribute(name, String(value));
    return item;
  };
  mask.replaceChildren(rect(0, 0, width, height, 'white'), ...holes.map((hole) => rect(hole.x, hole.y, hole.width, hole.height, 'black', 12)));
  for (const [name, value] of Object.entries({ x: 0, y: 0, width, height })) fill.setAttribute(name, String(value));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

/** The RGB a CSS colour expression resolves to in this document. */
function rgbOf(expression: string): [number, number, number] {
  const probe = el('span');
  probe.style.color = expression;
  probe.style.display = 'none';
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const parts = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`The shot ${url} did not load.`));
    image.src = url;
  });
}

function pixels(image: HTMLImageElement, width: number, height: number): Uint8ClampedArray {
  const canvas = el('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas.');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

function oldText(kind: RowKind, row: ReviewRow): string {
  const old = row.old ?? {};
  if (kind === 'token') return `Before: ${String(old.value ?? '')}`;
  if (kind === 'word') return `Before: EN "${String(old.en ?? '')}", FR "${String(old.fr ?? '')}"`;
  const where = old.file ? `${String(old.file)}${old.line ? `:${String(old.line)}` : ''}` : 'source not found';
  return `Declaration changed. Before: ${String(old.kind ?? '')} at ${where}`;
}

function rowKeyOf(kind: RowKind, row: ReviewRow): string {
  const text = (key: string) => String(row[key] ?? '');
  if (kind === 'api') return rowKey('api', { entry: text('entry'), name: text('name') });
  if (kind === 'token') return rowKey('token', { source: text('set') === 'toolkit' ? 'toolkit' : 'portal', chain: text('chain'), name: text('name') });
  return rowKey('word', { entry: text('entry'), table: text('name'), key: text('key') });
}

function rowTitle(kind: RowKind, row: ReviewRow): string {
  const text = (key: string) => String(row[key] ?? '');
  if (kind === 'api') return `${text('name')} from ${text('entry')}`;
  if (kind === 'token') return `${text('name')} (${text('set') || 'portal'}, ${text('chain')})`;
  return `${text('name')}.${text('key')} (${text('entry')})`;
}

const ROW_STATUS_LABEL: Record<RowStatus, string> = { added: 'Added', removed: 'Removed', changed: 'Changed' };
const STATE_STATUS_LABEL: Record<StateStatus, string> = {
  new: 'New state',
  removed: 'Removed state',
  changed: 'Changed',
  failed: 'Render failed',
  timeout: 'Timeout',
};

interface ModeControl {
  specimen: string;
  state: string;
  mode: Mode;
  buttons: Record<Mode, HTMLButtonElement>;
  before: HTMLIFrameElement | null;
  height: number | null;
  token: number;
}

interface Marks {
  specimen: string;
  state: string;
  stage: HTMLElement;
  layer: HTMLElement;
  label: HTMLElement;
  shade: SVGSVGElement | null;
  boxes: ChangeBox[];
  width: number;
  token: number;
}

interface RemovedFrame {
  specimen: string;
  state: RemovedSpecimen['states'][number];
  stage: HTMLElement;
  viewport: HTMLElement;
  iframe: HTMLIFrameElement;
  height: number;
}

class Review {
  private data: ReviewData = { base: null };
  private signature = '';
  private cleanups: Array<() => void> = [];
  private readonly specimens = new Map<string, BookSpecimen>();
  private readonly modes = new Map<string, ModeControl>();
  private readonly marks = new Map<string, Marks>();
  private readonly boxCache = new Map<string, Promise<{ boxes: ChangeBox[]; width: number }>>();
  private removedFrames: RemovedFrame[] = [];
  private baseManifest: { url: string; specimens: RemovedSpecimen[] } | null = null;
  private commentOn = false;
  private threads: PinThread[] = [];
  private showResolved = false;
  private active: string | null = null;
  private pending: { anchor: CommentAnchor } | null = null;
  private readonly pins = new Map<string, HTMLButtonElement>();
  private readonly pinCache = new Map<string, { point: Point; moved: boolean }>();
  private pinsScheduled = false;
  private movedSent = '';
  private opening = 0;
  private readonly hooked = new Set<Window>();
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly book: Book) {
    for (const specimen of book.manifest.specimens) this.specimens.set(specimen.id, specimen);
    this.resizeObserver = new ResizeObserver(() => {
      this.layoutRemoved();
      this.layoutMarks();
      this.schedulePins();
    });
  }

  start(): void {
    window.addEventListener('message', (event) => this.message(event));
    document.addEventListener('keydown', (event) => this.key(event), true);
    window.addEventListener('resize', () => this.schedulePins());
    this.book.onToggles((toggles) => this.togglesChanged(toggles));
    this.book.onFrame((report, iframe) => this.frameReport(report, iframe));
    this.book.setPlaceholder((specimen, state, toggles) => this.placeholder(specimen, state, toggles));
    this.post({ type: 'ds-ready' });
  }

  private post(message: BookMessage): void {
    if (window.parent === window) return;
    window.parent.postMessage(message, location.origin);
  }

  private message(event: MessageEvent): void {
    if (event.origin !== location.origin) return;
    const data = event.data as { type?: string } | null;
    if (!data || typeof data.type !== 'string') return;
    // Frame reports come from book iframes: the shell handles live frames; this layer handles Before and Removed.
    if (data.type === 'ds-frame') {
      this.overrideReport(event.source, data as FrameReport);
      return;
    }
    if (window.parent === window || event.source !== window.parent) return;
    const message = data as PageMessage;
    if (message.type === 'ds-review') this.apply(message);
    else if (message.type === 'ds-comment-mode') this.setCommentMode(Boolean(message.on), false);
    else if (message.type === 'ds-pins') this.setPins(message);
    else if (message.type === 'ds-goto') this.goto(message);
  }

  // Statuses, rows and modes --------------------------------------------------------------------------------

  private apply(message: ReviewData & { type?: string }): void {
    const { type: _type, ...data } = message;
    const signature = JSON.stringify(data);
    if (signature === this.signature) return;
    this.signature = signature;
    this.data = data;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.decorateSpecimens();
    this.decorateRows();
    this.applyFilter();
    void this.renderRemoved();
    this.book.setPlaceholder((specimen, state, toggles) => this.placeholder(specimen, state, toggles));
    this.schedulePins();
  }

  private statuses(): Record<string, ReviewStatus> {
    return this.data.statuses ?? {};
  }

  private onCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  private ring(element: HTMLElement, failed: boolean): void {
    element.classList.add('ds-ring');
    if (failed) element.dataset.dsRing = 'failed';
    this.onCleanup(() => {
      element.classList.remove('ds-ring');
      delete element.dataset.dsRing;
    });
  }

  private badge(parent: Element, status: string, label: string, before: Node | null = null): HTMLElement {
    const badge = el('span', 'ds-badge', label);
    badge.dataset.status = status;
    parent.insertBefore(badge, before);
    this.onCleanup(() => badge.remove());
    return badge;
  }

  private decorateSpecimens(): void {
    const statuses = this.statuses();
    const keep = new Set<string>();
    for (const specimen of this.book.manifest.specimens) {
      const entry = statuses[specimen.id];
      if (!entry || entry.status === 'unchanged' || entry.status === 'removed') continue;
      const failed = entry.status === 'failed' || entry.status === 'timeout';
      for (const slot of document.querySelectorAll(`[data-ds-badge="${CSS.escape(specimen.id)}"]`)) {
        this.badge(slot, entry.status, entry.label);
      }
      const article = this.book.specimenElement(specimen.id);
      // A specimen whose shots match the base pixel for pixel has nothing to look at: it keeps its badge only.
      if (article && entry.status !== 'same') this.ring(article, failed);
      const states = entry.states ?? {};
      // A new specimen has no per state statuses (nothing to compare with), yet every one of its states is new:
      // each gets the ring and the "New state" badge, unless its own status (a failed shot) says otherwise.
      const isNew = entry.status === 'new';
      for (const state of specimen.states) {
        const status = states[state.id] ?? (isNew ? 'new' : undefined);
        if (!status || status === 'removed') continue;
        const holder = this.book.stateElement(specimen.id, state.id);
        if (!holder) continue;
        this.ring(holder, status === 'failed' || status === 'timeout');
        const head = holder.querySelector('.ds-state-head');
        if (head) this.badge(head, status, STATE_STATUS_LABEL[status] ?? status, head.querySelector('.ds-state-actions'));
        if (status === 'changed' && this.data.base) {
          this.modeControl(specimen.id, state.id, holder);
          this.markChanges(specimen.id, state.id, holder);
          keep.add(`${specimen.id}/${state.id}`);
        }
      }
      const gone = Object.entries(states).filter(([, status]) => status === 'removed').map(([id]) => id);
      if (article && gone.length > 0) {
        const note = el('p', 'ds-review-note', `Removed since the base: ${gone.join(', ')}.`);
        article.querySelector('.ds-specimen-head')?.after(note);
        this.onCleanup(() => note.remove());
      }
    }
    for (const [key, control] of this.modes) {
      if (keep.has(key)) continue;
      this.setMode(control, 'after');
      this.modes.delete(key);
    }
  }

  private modeControl(specimen: string, state: string, holder: HTMLElement): void {
    const key = `${specimen}/${state}`;
    const actions = holder.querySelector('.ds-state-actions');
    if (!actions) return;
    const group = el('span', 'ds-toggle-group ds-mode');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Compare with the base');
    const existing = this.modes.get(key);
    const control: ModeControl = existing ?? {
      specimen,
      state,
      mode: 'after',
      buttons: {} as Record<Mode, HTMLButtonElement>,
      before: null,
      height: null,
      token: 0,
    };
    for (const [mode, text] of [['after', 'After'], ['before', 'Before'], ['difference', 'Difference']] as const) {
      const button = el('button', 'ds-toggle', text);
      button.type = 'button';
      button.addEventListener('click', () => this.setMode(control, mode));
      control.buttons[mode] = button;
      group.append(button);
    }
    actions.prepend(group);
    this.modes.set(key, control);
    this.onCleanup(() => group.remove());
    this.updateModeButtons(control);
    if (control.mode !== 'after') this.setMode(control, control.mode, true);
  }

  /** Circles each part of a changed state that looks different from the base, over whichever view is shown. */
  private markChanges(specimen: string, state: string, holder: HTMLElement): void {
    const stage = holder.querySelector<HTMLElement>('.ds-stage');
    const head = holder.querySelector('.ds-state-head');
    if (!stage || !head) return;
    const key = `${specimen}/${state}`;
    const layer = el('div', 'ds-marks');
    layer.setAttribute('aria-hidden', 'true');
    const label = el('span', 'ds-marks-label');
    stage.append(layer);
    head.querySelector('.ds-state-actions')?.before(label);
    const marks: Marks = { specimen, state, stage, layer, label, shade: null, boxes: [], width: 0, token: 0 };
    this.marks.set(key, marks);
    this.resizeObserver.observe(stage);
    this.onCleanup(() => {
      layer.remove();
      label.remove();
      this.resizeObserver.unobserve(stage);
      if (this.marks.get(key) === marks) this.marks.delete(key);
    });
    this.updateMarks(marks);
  }

  private updateMarks(marks: Marks): void {
    marks.token += 1;
    const token = marks.token;
    marks.boxes = [];
    marks.shade = null;
    marks.layer.replaceChildren();
    const shot = this.shot(marks.specimen, marks.state);
    if (!shot?.head || !shot.base) {
      marks.label.textContent = `Changes are circled at ${CELLS_TEXT}`;
      return;
    }
    marks.label.textContent = 'Finding the changes';
    const cacheKey = `${shot.head}|${shot.base}`;
    let found = this.boxCache.get(cacheKey);
    if (!found) {
      found = this.findBoxes(shot.head, shot.base);
      this.boxCache.set(cacheKey, found);
    }
    found.then((result) => {
      if (marks.token !== token) return;
      marks.boxes = result.boxes;
      marks.width = result.width;
      const count = result.boxes.length;
      marks.label.textContent = count === 0 ? 'No visible change at this setting' : count === 1 ? '1 change circled' : `${count} changes circled`;
      // Everything outside the circles is dimmed, so the eye lands on what changed.
      if (count > 0) {
        marks.shade = shadeLayer();
        marks.layer.append(marks.shade);
      }
      result.boxes.forEach((_, index) => {
        const mark = el('div', 'ds-mark');
        mark.append(el('span', 'ds-mark-number', String(index + 1)));
        marks.layer.append(mark);
      });
      this.layoutMarks();
    }, () => {
      if (marks.token === token) marks.label.textContent = 'The shots did not load';
    });
  }

  private async findBoxes(headUrl: string, baseUrl: string): Promise<{ boxes: ChangeBox[]; width: number }> {
    const [head, base] = await Promise.all([loadImage(headUrl), loadImage(baseUrl)]);
    const width = Math.max(head.naturalWidth, base.naturalWidth);
    const height = Math.max(head.naturalHeight, base.naturalHeight);
    return { boxes: changeBoxes(pixels(head, width, height), pixels(base, width, height), width, height), width };
  }

  /** Places the circles in screen pixels, so their outline keeps one width whatever the stage scale. */
  private layoutMarks(): void {
    for (const marks of this.marks.values()) {
      if (!marks.width) continue;
      const scale = this.book.stageScale(marks.specimen, marks.state);
      const pad = 6;
      const holes: Array<{ x: number; y: number; width: number; height: number }> = [];
      Array.from(marks.layer.querySelectorAll<HTMLElement>(':scope > .ds-mark')).forEach((mark, index) => {
        const box = marks.boxes[index];
        if (!box) return;
        // The stage clips its content, so a circle at an edge is pulled inside it rather than cut.
        const room = { width: marks.stage.clientWidth, height: marks.stage.clientHeight };
        const width = Math.min(room.width - 2, Math.max(28, box.width * scale + pad * 2));
        const height = Math.min(room.height - 2, Math.max(28, box.height * scale + pad * 2));
        const left = box.x * scale + (box.width * scale) / 2 - width / 2;
        const top = box.y * scale + (box.height * scale) / 2 - height / 2;
        const x = Math.max(1, Math.min(room.width - width - 1, left));
        const y = Math.max(1, Math.min(room.height - height - 1, top));
        Object.assign(mark.style, {
          left: `${x}px`,
          top: `${y}px`,
          width: `${width}px`,
          height: `${height}px`,
        });
        // The number sits on the circle's top edge, so it never hides the changed part; on its bottom edge when the top would be cut,
        // and inside the top corner when the circle fills the stage and both edges would be cut.
        mark.dataset.side = y >= 10 ? 'top' : room.height - (y + height) >= 10 ? 'bottom' : 'inside';
        holes.push({ x, y, width, height });
      });
      if (marks.shade) layoutShade(marks.shade, marks.stage.clientWidth, marks.stage.clientHeight, holes);
    }
  }

  private toggleFor(specimen: string, state: string, toggles: Toggles = this.book.toggles()): Toggles {
    const bookState = this.specimens.get(specimen)?.states.find((item) => item.id === state);
    if (!bookState) return toggles;
    const effective = this.book.effective(bookState, toggles);
    return { theme: effective.theme, lang: effective.lang, width: effective.width };
  }

  private shot(specimen: string, state: string, toggles: Toggles = this.book.toggles()): ShotUrls | null {
    return this.data.shots?.[`${specimen}/${state}`]?.[cellKey(this.toggleFor(specimen, state, toggles))] ?? null;
  }

  private updateModeButtons(control: ModeControl): void {
    const shot = this.shot(control.specimen, control.state);
    const canDiff = Boolean(shot?.head && shot?.base);
    const difference = control.buttons.difference;
    difference.disabled = !canDiff;
    difference.title = canDiff ? 'Changed pixels over a dimmed After' : `Difference is shown at ${CELLS_TEXT}, once the shots are taken`;
    for (const [mode, button] of Object.entries(control.buttons)) button.setAttribute('aria-pressed', String(mode === control.mode));
  }

  private setMode(control: ModeControl, mode: Mode, force = false): void {
    if (control.mode === mode && !force) return;
    control.token += 1;
    const base = this.data.base;
    if (mode === 'before' && base) {
      const iframe = control.before ?? el('iframe', 'ds-frame');
      iframe.title = `Before: ${control.specimen} / ${control.state}`;
      Object.assign(iframe.style, { width: '100%', height: '100%' });
      const src = this.book.frameUrl(control.specimen, control.state, this.toggleFor(control.specimen, control.state), base.url);
      if (iframe.getAttribute('src') !== src) iframe.src = src;
      control.before = iframe;
      control.mode = 'before';
      this.book.setOverride(control.specimen, control.state, iframe, control.height ?? undefined);
    } else if (mode === 'difference' && base) {
      const shot = this.shot(control.specimen, control.state);
      if (!shot?.head || !shot.base) {
        this.setMode(control, 'after');
        return;
      }
      control.mode = 'difference';
      const token = control.token;
      void this.difference(shot.head, shot.base).then((result) => {
        if (control.token !== token || control.mode !== 'difference') return;
        this.book.setOverride(control.specimen, control.state, result.canvas, result.height);
        control.buttons.difference.title = `${result.changed} changed pixels`;
      }, (error: unknown) => {
        if (control.token !== token) return;
        const failure = el('div', 'ds-placeholder', error instanceof Error ? error.message : String(error));
        this.book.setOverride(control.specimen, control.state, failure, 120);
      });
    } else {
      control.mode = 'after';
      control.before = null;
      this.book.setOverride(control.specimen, control.state, null);
    }
    this.updateModeButtons(control);
    this.schedulePins();
  }

  private async difference(headUrl: string, baseUrl: string): Promise<{ canvas: HTMLCanvasElement; height: number; changed: number }> {
    const [head, base] = await Promise.all([loadImage(headUrl), loadImage(baseUrl)]);
    const width = Math.max(head.naturalWidth, base.naturalWidth);
    const height = Math.max(head.naturalHeight, base.naturalHeight);
    const canvas = el('canvas', 'ds-shot');
    canvas.width = width;
    canvas.height = height;
    Object.assign(canvas.style, { width: '100%', height: '100%' });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas.');
    const out = context.createImageData(width, height);
    const changed = paintDifference(pixels(head, width, height), pixels(base, width, height), out.data,
      rgbOf('hsl(var(--ds-change))'), rgbOf('hsl(var(--background))'));
    context.putImageData(out, 0, 0);
    return { canvas, height, changed };
  }

  private overrideReport(source: MessageEventSource | null, report: FrameReport): void {
    if (!source || report.type !== 'ds-frame') return;
    for (const control of this.modes.values()) {
      if (control.before?.contentWindow !== source || control.mode !== 'before') continue;
      if (report.height > 0 && report.height !== control.height) {
        control.height = report.height;
        this.book.setOverride(control.specimen, control.state, control.before, report.height);
        this.schedulePins();
      }
      return;
    }
    for (const frame of this.removedFrames) {
      if (frame.iframe.contentWindow !== source) continue;
      if (!frame.state.height && report.height > 0 && report.height !== frame.height) {
        frame.height = report.height;
        this.layoutRemoved();
      }
      return;
    }
  }

  private placeholder(specimen: string, state: string, toggles: Toggles): HTMLElement | null {
    const url = this.shot(specimen, state, toggles)?.head;
    if (!url) return null;
    const image = el('img', 'ds-shot');
    image.alt = '';
    image.src = url;
    Object.assign(image.style, { objectFit: 'contain', objectPosition: 'left top' });
    return image;
  }

  private decorateRows(): void {
    const rows = this.data.rows ?? {};
    const kinds: Array<[RowKind, ReviewRow[] | undefined]> = [['api', rows.api], ['token', rows.tokens], ['word', rows.words]];
    for (const [kind, list] of kinds) {
      for (const row of list ?? []) {
        if (row.status === 'removed') continue;
        for (const element of this.book.rows(kind, rowKeyOf(kind, row))) {
          if (element.dataset.dsRowStatus) continue;
          element.dataset.dsRowStatus = row.status;
          this.ring(element, false);
          const first = element.firstElementChild;
          let cell = first;
          if (first && !first.classList.contains('ds-row-key')) {
            cell = el('span', 'ds-row-key');
            first.replaceWith(cell);
            cell.append(first);
          }
          if (cell) this.badge(cell, row.status, ROW_STATUS_LABEL[row.status]);
          let note: HTMLElement | null = null;
          if (row.status === 'changed' && row.old) {
            note = el('span', 'ds-old', oldText(kind, row));
            element.append(note);
          }
          this.onCleanup(() => {
            delete element.dataset.dsRowStatus;
            note?.remove();
          });
        }
      }
    }
  }

  private filter(element: Element): void {
    element.setAttribute('data-ds-filtered', '');
    this.onCleanup(() => element.removeAttribute('data-ds-filtered'));
  }

  private applyFilter(): void {
    const statuses = this.statuses();
    if (!this.data.changed_only || Object.keys(statuses).length === 0) return;
    const { manifest } = this.book;
    let anyShown = false;
    for (const group of manifest.groups) {
      const specimens = manifest.specimens.filter((specimen) => specimen.group === group.key);
      let shown = 0;
      for (const specimen of specimens) {
        const entry = statuses[specimen.id];
        if (!LOOKS_UNCHANGED.has(entry?.status ?? 'unchanged')) {
          shown += 1;
          const quiet = quietStates(entry, specimen.states.map((state) => state.id));
          for (const state of quiet) {
            const holder = this.book.stateElement(specimen.id, state);
            if (holder) this.filter(holder);
          }
          continue;
        }
        const article = this.book.specimenElement(specimen.id);
        if (article) this.filter(article);
        const item = this.book.indexItem(specimen.id);
        if (item) this.filter(item);
      }
      const section = document.getElementById(`group-${group.key}`);
      if (section) for (const missing of section.querySelectorAll('.ds-missing')) this.filter(missing);
      // A group where nothing looks different goes entirely, its heading and its index entry included.
      if (shown === 0) this.filterSection(`group-${group.key}`, this.book.indexItem(`group-${group.key}`)?.parentElement ?? null);
      else anyShown = true;
    }
    if (this.filterRows('tokens', '.ds-token-row')) anyShown = true;
    if (this.filterRows('words', '.ds-words-row')) anyShown = true;
    // An export of the toolkit is code, not something to look at: the changes-only view leaves it out.
    this.filterSection('api');
    if (!anyShown) {
      const overview = document.getElementById('overview');
      const note = el('p', 'ds-filtered-empty', 'Nothing looks different since the base.');
      overview?.append(note);
      this.onCleanup(() => note.remove());
    }
  }

  /** Hides a whole section of the book and its index entry. */
  private filterSection(id: string, indexEntry: Element | null = this.book.indexItem(id)): void {
    for (const element of [document.getElementById(id), indexEntry]) if (element) this.filter(element);
  }

  /**
   * Hides the unchanged rows of a section, and each block (a heading and its rows, or a words table) left empty; the
   * whole section when nothing in it changed. Returns whether anything is left to see.
   */
  private filterRows(sectionId: string, rowSelector: string): boolean {
    const section = document.getElementById(sectionId);
    if (!section) return false;
    const blocks: Element[][] = [];
    let current: Element[] = [];
    for (const child of Array.from(section.children)) {
      if (child.localName === 'h2') continue;
      if (child.localName === 'h3' || child.classList.contains('ds-words')) {
        if (current.length) blocks.push(current);
        current = [child];
        if (child.classList.contains('ds-words')) {
          blocks.push(current);
          current = [];
        }
      } else {
        current.push(child);
      }
    }
    if (current.length) blocks.push(current);
    let any = false;
    for (const block of blocks) {
      const rows = block.flatMap((element) => element.matches(rowSelector) ? [element] : Array.from(element.querySelectorAll(rowSelector)));
      const data = rows.filter((row) => !row.classList.contains('ds-row-head'));
      if (data.length === 0 && !block.some((element) => element.localName === 'h3')) continue;
      const changed = data.filter((row) => (row as HTMLElement).dataset.dsRowStatus);
      for (const row of data) if (!(row as HTMLElement).dataset.dsRowStatus) this.filter(row);
      if (changed.length === 0) for (const element of block) this.filter(element);
      else any = true;
    }
    if (!any) this.filterSection(sectionId);
    return any;
  }

  // Removed ---------------------------------------------------------------------------------------------------

  private async removedSpecimens(): Promise<RemovedSpecimen[]> {
    const statuses = this.statuses();
    const ids = Object.entries(statuses).filter(([, entry]) => entry.status === 'removed').map(([id]) => id);
    if (ids.length === 0) return [];
    let known = this.data.removed ?? null;
    const base = this.data.base;
    if (!known && base) {
      const url = new URL('manifest.json', new URL(base.url, location.href)).href;
      if (this.baseManifest?.url !== url) {
        try {
          const response = await fetch(url);
          const manifest = await response.json() as BookManifest;
          this.baseManifest = { url, specimens: manifest.specimens };
        } catch {
          this.baseManifest = { url, specimens: [] };
        }
      }
      known = this.baseManifest.specimens;
    }
    return ids.map((id) => known?.find((item) => item.id === id) ?? {
      id,
      name: statuses[id].name ?? id,
      group: statuses[id].group ?? undefined,
      states: Object.keys(statuses[id].states ?? {}).map((state) => ({ id: state })),
    });
  }

  private async renderRemoved(): Promise<void> {
    const signature = this.signature;
    const specimens = await this.removedSpecimens();
    if (signature !== this.signature) return;
    const section = this.book.removedSection;
    const rows = this.data.rows ?? {};
    const removedRows: Array<[RowKind, string, ReviewRow[]]> = [
      ['api', 'Exports', (rows.api ?? []).filter((row) => row.status === 'removed')],
      ['token', 'Tokens', (rows.tokens ?? []).filter((row) => row.status === 'removed')],
      ['word', 'Words', (rows.words ?? []).filter((row) => row.status === 'removed')],
    ];
    this.removedFrames = [];
    const indexLink = document.getElementById('ds-index-removed');
    const anything = specimens.length > 0 || removedRows.some(([, , list]) => list.length > 0);
    section.hidden = !anything;
    if (indexLink) indexLink.hidden = !anything;
    section.replaceChildren();
    if (!anything) return;
    section.append(el('h2', '', 'Removed'),
      el('p', 'ds-muted', `In the base book${this.data.base?.label ? ` (${this.data.base.label})` : ''} and not here, shown as the base renders them.`));
    for (const specimen of specimens) {
      const article = el('article', 'ds-specimen');
      article.id = `removed-${specimen.id}`;
      const head = el('header', 'ds-specimen-head');
      head.append(el('h3', '', specimen.name));
      const badge = el('span', 'ds-badge', 'Removed');
      badge.dataset.status = 'removed';
      head.append(badge);
      article.append(head);
      for (const state of specimen.states) {
        const holder = el('div', 'ds-state');
        const stateHead = el('div', 'ds-state-head');
        stateHead.append(el('span', 'ds-state-label', state.label ?? state.id));
        const viewport = el('div', 'ds-viewport');
        const stage = el('div', 'ds-stage');
        stage.append(viewport);
        holder.append(stateHead, stage);
        article.append(holder);
        const iframe = el('iframe', 'ds-frame');
        iframe.title = `Removed: ${specimen.name}, ${state.label ?? state.id}`;
        iframe.loading = 'lazy';
        viewport.append(iframe);
        const frame: RemovedFrame = { specimen: specimen.id, state, stage, viewport, iframe, height: state.height ?? 160 };
        this.removedFrames.push(frame);
        this.resizeObserver.observe(stage);
      }
      section.append(article);
    }
    for (const [, title, list] of removedRows) {
      if (list.length === 0) continue;
      section.append(el('h3', '', `${title} (${list.length})`));
      const kind = removedRows.find(([, name]) => name === title)?.[0] ?? 'api';
      for (const row of list) {
        const line = el('div', 'ds-row');
        line.append(el('code', 'ds-code', rowTitle(kind, row)));
        const badgeRow = el('span', 'ds-badge', 'Removed');
        badgeRow.dataset.status = 'removed';
        line.append(badgeRow);
        section.append(line);
      }
    }
    this.updateRemovedFrames();
  }

  private removedToggles(state: RemovedSpecimen['states'][number]): Toggles {
    const toggles = this.book.toggles();
    return { theme: state.theme ?? toggles.theme, lang: toggles.lang, width: state.width ?? toggles.width };
  }

  private updateRemovedFrames(): void {
    const base = this.data.base;
    if (!base) return;
    for (const frame of this.removedFrames) {
      const src = this.book.frameUrl(frame.specimen, frame.state.id, this.removedToggles(frame.state), base.url);
      if (frame.iframe.getAttribute('src') !== src) frame.iframe.src = src;
    }
    this.layoutRemoved();
  }

  private layoutRemoved(): void {
    for (const frame of this.removedFrames) {
      const width = this.removedToggles(frame.state).width;
      const scale = Math.min(1, (frame.stage.clientWidth || width) / width);
      frame.viewport.style.width = `${width}px`;
      frame.viewport.style.height = `${frame.height}px`;
      frame.viewport.style.transform = scale === 1 ? '' : `scale(${scale})`;
      frame.stage.style.height = `${Math.ceil(frame.height * scale)}px`;
      frame.iframe.style.width = `${width}px`;
      frame.iframe.style.height = `${frame.height}px`;
    }
  }

  private togglesChanged(toggles: Toggles): void {
    for (const control of this.modes.values()) {
      if (control.mode === 'before') this.setMode(control, 'before', true);
      else if (control.mode === 'difference') this.setMode(control, 'difference', true);
      else this.updateModeButtons(control);
    }
    for (const marks of this.marks.values()) this.updateMarks(marks);
    this.updateRemovedFrames();
    this.post({ type: 'ds-toggles', theme: toggles.theme, lang: toggles.lang, width: toggles.width });
    this.schedulePins();
  }

  // Comments ------------------------------------------------------------------------------------------------

  private key(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const editable = Boolean(target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.localName ?? '')));
    if (event.key === 'Escape' && this.commentOn) {
      event.preventDefault();
      this.setCommentMode(false, true);
    } else if (!editable && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.code === 'KeyM') {
      event.preventDefault();
      this.setCommentMode(!this.commentOn, true);
    }
  }

  private setCommentMode(on: boolean, notify: boolean): void {
    if (!on) this.pending = null;
    if (this.commentOn !== on) {
      this.commentOn = on;
      document.body.toggleAttribute('data-ds-comment', on);
      for (const win of this.hooked) this.frameCursor(win);
    }
    if (notify) this.post({ type: 'ds-comment-mode', on });
    this.schedulePins();
  }

  private frameReport(report: FrameReport, iframe: HTMLIFrameElement): void {
    const win = iframe.contentWindow;
    if (win) this.hook(win, report.specimen, report.state);
    this.schedulePins();
  }

  /** Installs the comment capture in a frame window, once per document. */
  private hook(win: Window, specimen: string, state: string): void {
    const marked = win as unknown as Record<string, unknown>;
    let doc: Document;
    try {
      doc = win.document;
      if (marked[HOOKED]) return;
      marked[HOOKED] = true;
    } catch {
      return;
    }
    for (const stale of this.hooked) if (stale.closed) this.hooked.delete(stale);
    this.hooked.add(win);
    const overlay = doc.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483647',
      borderRadius: '3px',
      boxShadow: '0 0 0 2px hsl(217 91% 60%)',
      display: 'none',
    });
    const capture = (event: Event) => {
      if (!this.commentOn) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'click') this.anchorClick(win, doc, event as MouseEvent, specimen, state);
    };
    for (const type of FRAME_EVENTS) win.addEventListener(type, capture, true);
    win.addEventListener('pointermove', (event) => {
      if (!this.commentOn) {
        overlay.style.display = 'none';
        return;
      }
      const first = event.composedPath()[0] as Node | undefined;
      const target = first?.nodeType === 1 ? first as Element : first?.parentElement ?? null;
      if (!target) return;
      if (!overlay.isConnected) doc.body.append(overlay);
      const rect = target.getBoundingClientRect();
      Object.assign(overlay.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }, true);
    win.addEventListener('pointerleave', () => { overlay.style.display = 'none'; }, true);
    doc.addEventListener('mouseleave', () => { overlay.style.display = 'none'; });
    win.addEventListener('keydown', (event) => this.key(event), true);
    this.frameCursor(win);
  }

  private frameCursor(win: Window): void {
    try {
      const marked = win as unknown as { __dsCursor?: CSSStyleSheet };
      const doc = win.document;
      if (!marked.__dsCursor) {
        const Sheet = (win as unknown as { CSSStyleSheet: typeof CSSStyleSheet }).CSSStyleSheet;
        const sheet = new Sheet();
        marked.__dsCursor = sheet;
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
        const shadow = frameShadow(doc);
        if (shadow) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      }
      marked.__dsCursor.replaceSync(this.commentOn ? CROSSHAIR_CSS : '');
    } catch {
      // A frame document that is gone or not ready: the next report hooks it again.
    }
  }

  private anchorClick(win: Window, doc: Document, event: MouseEvent, specimen: string, state: string): void {
    const found = frameAnchor(doc, event);
    if (!found) return;
    const toggles = this.toggleFor(specimen, state);
    const anchor: CommentAnchor = { specimen, state, ...found, theme: toggles.theme, lang: toggles.lang, width: toggles.width };
    const iframe = this.book.liveFrame(specimen, state);
    const rect = iframe?.getBoundingClientRect();
    const scale = this.book.stageScale(specimen, state);
    const point = rect ? { x: rect.left + event.clientX * scale, y: rect.top + event.clientY * scale } : { x: 0, y: 0 };
    this.pending = { anchor };
    this.post({ type: 'ds-anchor', anchor, point });
    this.schedulePins();
    void win;
  }

  private setPins(message: { threads: PinThread[]; showResolved?: boolean; active?: string | null }): void {
    this.threads = Array.isArray(message.threads) ? message.threads.filter((thread) => thread?.anchor) : [];
    this.showResolved = Boolean(message.showResolved);
    if (message.active !== undefined) this.active = message.active;
    this.pending = null;
    this.schedulePins();
  }

  private goto(message: { specimen: string; state?: string; theme?: BookTheme; lang?: BookLang; width?: number; thread?: string; open?: boolean }): void {
    const next: Partial<Toggles> = {};
    if (message.theme === 'light' || message.theme === 'dark') next.theme = message.theme;
    if (message.lang === 'en' || message.lang === 'fr') next.lang = message.lang;
    if (typeof message.width === 'number' && [390, 768, 1440].includes(message.width)) next.width = message.width;
    this.book.setToggles(next);
    const article = this.book.specimenElement(message.specimen);
    if (article?.hasAttribute('data-ds-filtered')) article.removeAttribute('data-ds-filtered');
    const target = message.state && this.book.stateElement(message.specimen, message.state)
      ? `state-${message.specimen}-${message.state}`
      : `specimen-${message.specimen}`;
    this.book.scrollTo(target);
    if (message.thread) this.active = message.thread;
    this.schedulePins();
    if (message.thread && message.open) this.openWhenStill(message.thread);
  }

  /** The pin's right edge at half its height, where the review deck opens a note. */
  private pinPoint(pin: HTMLElement): Point {
    const rect = pin.getBoundingClientRect();
    return { x: rect.right, y: rect.top + rect.height / 2 };
  }

  /**
   * After a jump from the comments list: waits until the thread's pin has held its place for a quarter second (the
   * book keeps the target in view while frames around it load and grow), then asks the page to open the thread there.
   * Three seconds without a pin answer `point: null`, as does a thread that has no pin to show.
   */
  private openWhenStill(id: string): void {
    const token = ++this.opening;
    const started = performance.now();
    let last: Point | null = null;
    let stillSince = started;
    const thread = this.threads.find((item) => item.id === id);
    const answer = (point: Point | null) => {
      if (token !== this.opening) return;
      this.opening += 1;
      this.post({ type: 'ds-pin-open', id, point });
    };
    if (!thread || (thread.status === 'resolved' && !this.showResolved) || !this.book.stateElement(thread.anchor.specimen, thread.anchor.state)) {
      answer(null);
      return;
    }
    const tick = () => {
      if (token !== this.opening) return;
      const now = performance.now();
      this.layoutPins();
      const pin = this.pins.get(id);
      const point = pin?.isConnected && pin.getClientRects().length > 0 ? this.pinPoint(pin) : null;
      if (point) {
        if (!last || Math.abs(point.x - last.x) > 1 || Math.abs(point.y - last.y) > 1) {
          last = point;
          stillSince = now;
        } else if (now - stillSince >= 250) {
          answer(point);
          return;
        }
      }
      if (now - started > 3000) {
        answer(point);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private schedulePins(): void {
    if (this.pinsScheduled) return;
    this.pinsScheduled = true;
    requestAnimationFrame(() => {
      this.pinsScheduled = false;
      this.layoutPins();
    });
  }

  private pinPosition(id: string, anchor: CommentAnchor, stage: HTMLElement): { point: Point; moved: boolean } {
    const iframe = this.book.liveFrame(anchor.specimen, anchor.state);
    const scale = this.book.stageScale(anchor.specimen, anchor.state);
    const cacheKey = `${id}|${cellKey(this.toggleFor(anchor.specimen, anchor.state))}`;
    let doc: Document | null = null;
    try {
      doc = iframe && stage.contains(iframe) ? iframe.contentDocument : null;
    } catch {
      doc = null;
    }
    if (doc?.body?.dataset.dsStatus) {
      const target = resolveAnchor(doc, anchor.root, anchor.path);
      if (target) {
        const rect = target.getBoundingClientRect();
        const point = {
          x: (rect.left + anchor.x * rect.width) * scale - stage.scrollLeft,
          y: (rect.top + anchor.y * rect.height) * scale,
        };
        const placed = { point, moved: false };
        this.pinCache.set(cacheKey, placed);
        return placed;
      }
      // The pin points with its bottom-left corner: 24px down from the state root's top left corner keeps the whole
      // bubble inside that corner.
      const root = frameShadow(doc)?.querySelector('[data-ds-state-root]')?.getBoundingClientRect();
      const placed = { point: { x: (root?.left ?? 0) * scale - stage.scrollLeft, y: (root?.top ?? 0) * scale + PIN_SIZE }, moved: true };
      this.pinCache.set(cacheKey, placed);
      return placed;
    }
    // A frame that is not live (only twelve are): the last place measured at these toggles, else the stage corner.
    return this.pinCache.get(cacheKey) ?? { point: { x: 0, y: PIN_SIZE }, moved: false };
  }

  private layoutPins(): void {
    const seen = new Set<string>();
    const moved: string[] = [];
    const place = (id: string, number: string, anchor: CommentAnchor, flags: { resolved?: boolean; pending?: boolean }) => {
      const holder = this.book.stateElement(anchor.specimen, anchor.state);
      if (!holder || holder.closest('[data-ds-filtered]')) return;
      const stage = holder.querySelector<HTMLElement>('.ds-stage');
      if (!stage) return;
      const { point, moved: isMoved } = this.pinPosition(id, anchor, stage);
      let pin = this.pins.get(id);
      if (!pin) {
        pin = el('button', 'ds-pin');
        pin.type = 'button';
        const button = pin;
        pin.addEventListener('click', (event) => {
          event.stopPropagation();
          if (id === 'pending') return;
          this.opening += 1;
          this.active = id;
          this.post({ type: 'ds-pin-open', id, point: this.pinPoint(button) });
          this.schedulePins();
        });
        this.pins.set(id, pin);
      }
      if (pin.parentElement !== holder) holder.append(pin);
      pin.textContent = number;
      pin.setAttribute('aria-label', `Comment ${number}: ${anchor.label}`);
      pin.style.left = `${stage.offsetLeft + point.x}px`;
      pin.style.top = `${stage.offsetTop + point.y}px`;
      pin.toggleAttribute('data-resolved', Boolean(flags.resolved));
      pin.toggleAttribute('data-pending', Boolean(flags.pending));
      pin.toggleAttribute('data-moved', isMoved);
      pin.toggleAttribute('data-active', id === this.active);
      if (isMoved && id !== 'pending') moved.push(id);
      seen.add(id);
    };
    this.threads.forEach((thread, index) => {
      if (thread.status === 'resolved' && !this.showResolved) return;
      place(thread.id, String(index + 1), thread.anchor, { resolved: thread.status === 'resolved' });
    });
    if (this.pending) place('pending', String(this.threads.length + 1), this.pending.anchor, { pending: true });
    for (const [id, pin] of this.pins) {
      if (seen.has(id)) continue;
      pin.remove();
      this.pins.delete(id);
    }
    const signature = moved.sort().join(' ');
    if (signature !== this.movedSent) {
      this.movedSent = signature;
      this.post({ type: 'ds-pin-moved', ids: moved });
    }
  }
}

/** Starts review mode on a rendered book. */
export function startReview(book: Book): void {
  const review = new Review(book);
  review.start();
  (window as unknown as { __dsReview?: unknown }).__dsReview = review;
}
