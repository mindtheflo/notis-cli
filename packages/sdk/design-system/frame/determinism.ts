/**
 * Determinism of a book frame (design review spec, section 3.5), on in every frame and required for shots.
 *
 * - Time: `Date` and `Date.now` read a fixed clock at 2026-06-15T09:30:00Z (`FIXED_NOW`).
 * - Randomness: `Math.random` is mulberry32 seeded with the sha256 of `specimenId/stateId`.
 * - Motion: one sheet stops animations, transitions and the caret, in the document and in each shadow root.
 * - Network: `fetch` and `XMLHttpRequest` reject, and any resource loaded off the page origin flags the frame
 *   "network". `shoot.mjs` also aborts such requests in the browser.
 * - Raster: in shot mode the frame repaints the whole page once before it reports ready (`repaintWholeFrame`).
 *
 * `installDeterminism()` runs when this module is evaluated in frame mode, before any specimen or fixture module,
 * so module level dates and random values are fixed too (the generated entry imports this module first).
 */
import { FIXED_NOW, nextFrame } from '../specimen';

export const NO_MOTION_CSS =
  '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';

/** Frame flags read by the shell and `shoot.mjs` (`body[data-ds-flags]`, space separated). */
export type FrameFlag = 'network' | 'error' | 'timeout';

const flags = new Set<FrameFlag>();
const flagListeners = new Set<(flag: FrameFlag, detail: string) => void>();

export function flagFrame(flag: FrameFlag, detail: string): void {
  flags.add(flag);
  if (typeof document !== 'undefined' && document.body) document.body.dataset.dsFlags = [...flags].join(' ');
  for (const listener of flagListeners) listener(flag, detail);
}

export function frameFlags(): FrameFlag[] {
  return [...flags];
}

export function onFrameFlag(listener: (flag: FrameFlag, detail: string) => void): () => void {
  flagListeners.add(listener);
  return () => flagListeners.delete(listener);
}

// SHA-256, synchronous, for the random seed (crypto.subtle is asynchronous and absent on plain HTTP origins).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The sha256 of a UTF-8 string as eight 32-bit words. */
export function sha256Words(text: string): Uint32Array {
  const bytes = new TextEncoder().encode(text);
  const length = ((bytes.length + 9 + 63) >> 6) << 6;
  const data = new Uint8Array(length);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(length - 4, bytes.length * 8);
  view.setUint32(length - 8, Math.floor((bytes.length * 8) / 2 ** 32));
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    hash[0] += a; hash[1] += b; hash[2] += c; hash[3] += d; hash[4] += e; hash[5] += f; hash[6] += g; hash[7] += h;
  }
  return hash;
}

/** mulberry32: a small seeded generator with the `Math.random` contract. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Makes `Date` and `Date.now` read `now` (also used by the render smoke test, through `runtime/fixedClock.ts`). */
export function installClock(now: number): void {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(now);
      else super(...(args as [string | number | Date]));
    }
    static now(): number {
      return now;
    }
  }
  Object.defineProperty(FixedDate, 'name', { value: 'Date' });
  (globalThis as { Date: DateConstructor }).Date = FixedDate as DateConstructor;
}

function blockNetwork(): void {
  const origin = location.origin;
  const blockedFetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    flagFrame('network', `fetch ${url}`);
    return Promise.reject(new TypeError(`The design book has no network: fetch(${url}) was blocked.`));
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: blockedFetch });
  const RealXhr = globalThis.XMLHttpRequest;
  if (RealXhr) {
    RealXhr.prototype.send = function send(this: XMLHttpRequest) {
      flagFrame('network', 'XMLHttpRequest');
      throw new DOMException('The design book has no network.', 'NetworkError');
    };
  }
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.name.startsWith(origin) && !entry.name.startsWith('data:') && !entry.name.startsWith('blob:')) {
            flagFrame('network', entry.name);
          }
        }
      }).observe({ type: 'resource', buffered: true });
    } catch {
      // No resource timing: shoot.mjs still aborts and flags off-origin requests.
    }
  }
}

/** Adds the no-motion sheet to a document or shadow root. */
export function stopMotion(root: Document | ShadowRoot): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(NO_MOTION_CSS);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = NO_MOTION_CSS;
    (root instanceof Document ? root.head : root).append(style);
  }
}

let installed = false;

/** Shot mode (`shot=1`, used by `shoot.mjs`): no scrollbar, so a tall state keeps the full cell width. */
export const SHOT_CSS = 'html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }';

/**
 * Shot mode: repaints the whole page once, then waits for the paint, so the shot comes from one full raster.
 *
 * Chromium rasters only the changed part of a tile after a late update (partial raster). An edge that this part cuts
 * through, like the round avatar of the first row of `list-reader/table`, gets anti-aliasing a little different from
 * a full raster (a few pixels one level apart), so the PNG depended on whether a raster ran before the update, which
 * it did only under load (`shoot.mjs` runs 4 shots at a time). A paint-only change of the whole page (opacity just
 * under 1 on the root element, then back) makes the last raster of every tile a full one.
 */
export async function repaintWholeFrame(): Promise<void> {
  const style = document.documentElement.style;
  const value = style.getPropertyValue('opacity');
  const priority = style.getPropertyPriority('opacity');
  style.setProperty('opacity', '0.999', 'important');
  await nextFrame();
  await nextFrame();
  if (value) style.setProperty('opacity', value, priority);
  else style.removeProperty('opacity');
  await nextFrame();
  await nextFrame();
}

/** Installs the fixed clock, the seeded random, the network block and the document no-motion sheet. Once. */
export function installDeterminism(specimenId: string, stateId: string, shot = false): void {
  if (installed) return;
  installed = true;
  installClock(FIXED_NOW);
  Math.random = mulberry32(sha256Words(`${specimenId}/${stateId}`)[0]);
  blockNetwork();
  stopMotion(document);
  if (shot) {
    const style = document.createElement('style');
    style.textContent = SHOT_CSS;
    document.head.append(style);
  }
}

/** The frame parameters of `index.html?frame=...`, or null outside frame mode. */
export interface FrameParams {
  specimen: string;
  state: string;
  theme: 'light' | 'dark';
  lang: 'en' | 'fr';
  width: number;
  shot: boolean;
}

export function frameParams(search: string = typeof location === 'undefined' ? '' : location.search): FrameParams | null {
  const query = new URLSearchParams(search);
  const specimen = query.get('frame');
  if (!specimen) return null;
  const width = Number(query.get('w'));
  return {
    specimen,
    state: query.get('state') ?? '',
    theme: query.get('theme') === 'dark' ? 'dark' : 'light',
    lang: query.get('lang') === 'fr' ? 'fr' : 'en',
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 1440,
    shot: query.get('shot') === '1',
  };
}

const params = frameParams();
if (params) installDeterminism(params.specimen, params.state, params.shot);
