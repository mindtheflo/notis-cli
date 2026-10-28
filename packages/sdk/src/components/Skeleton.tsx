import { useRef, useState, type CSSProperties } from 'react';
import { useNotisRuntime } from '../provider';
import { isNotisSpaceSkeleton, pickSkeletonEntry, type NotisSkeletonEntry, type NotisSpaceSkeleton, type SkeletonBone } from '../skeleton';
import { useIsoLayoutEffect } from '../ui/util';
import { pick, type Locale, type Words } from '../words/types';

/** What a loading placeholder says to screen readers. */
export const SKELETON_WORDS = Object.freeze({
  loading: { en: 'Loading content', fr: 'Chargement du contenu' },
}) satisfies Readonly<Record<string, Words>>;

/** Content-shaped placeholder. Never use it to replace a successful cached result. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={className} style={{ display: 'block', height: 16,
    // Apps may define --muted as HSL channels or a complete CSS color. A
    // neutral default remains visible with either token format and no theme.
    borderRadius: 6, background: 'rgba(128,128,128,.18)', ...style }} />;
}

/** Fill colours of the captured bone types: 0 leaf, 1 filled container, (2 is an outline), 3 divider. */
const BONE_FILL = ['rgba(128,128,128,.18)', 'rgba(128,128,128,.06)', '', 'rgba(128,128,128,.16)'] as const;
const BONE_OUTLINE = 'inset 0 0 0 1px rgba(128,128,128,.14)';
/** Most copies of one repeat row, and most bone elements all repeat rows draw together. */
const MAX_ROW_COPIES = 200;
const MAX_ROW_ELEMENTS = 4000;
/** Under this own width the region draws its 390 px capture, else its 1440 px one. */
const NARROW_UNDER = 800;
/** Shortest pane a captured frame stretches, and the line tolerance of its edges, in px. */
const FRAME_MIN = 120;
const FRAME_EDGE = 2;
/** How far, in percent of the width, two panes side by side may overlap at their shared edge. */
const FRAME_SEAM = 1;

/** Skeletons already checked, so many regions on one page check a shared file once. */
const checked = new WeakMap<object, boolean>();
function validSkeleton(value: unknown): NotisSpaceSkeleton | null {
  if (typeof value !== 'object' || value === null) return null;
  let ok = checked.get(value);
  if (ok === undefined) { ok = isNotisSpaceSkeleton(value); checked.set(value, ok); }
  return ok ? value as NotisSpaceSkeleton : null;
}

function boneStyle([x, y, w, h, r, t]: SkeletonBone): CSSProperties {
  return { position: 'absolute', left: `${x}%`, width: `${w}%`, top: y, height: h, borderRadius: r, boxSizing: 'border-box',
    ...(t === 2 ? { boxShadow: BONE_OUTLINE } : { background: BONE_FILL[t] }) };
}

const isPane = ([, y, , h, , t]: SkeletonBone) => (t === 1 || t === 2) && y <= FRAME_EDGE && h >= FRAME_MIN;
const bottomOf = (bone: SkeletonBone) => bone[1] + bone[3];

/**
 * The bottom of the captured app frame, else null. A frame is panes that start at the region top and end on one line,
 * two or more side by side across the width (a list beside its detail) with nothing starting below them, or
 * square-cornered ones across the width ending at the bottom of the capture. They were measured at the capture's window height, so the drawing stretches them to
 * the visible pane instead.
 */
const frames = new WeakMap<NotisSkeletonEntry, number | null>();
function frameBottomOf(entry: NotisSkeletonEntry): number | null {
  if (!frames.has(entry)) frames.set(entry, findFrameBottom(entry));
  return frames.get(entry) ?? null;
}

function findFrameBottom({ height, bones, rows }: NotisSkeletonEntry): number | null {
  const panes = bones.filter(isPane);
  let frame: number | null = null;
  for (const bottom of new Set(panes.map(bottomOf))) {
    const line = panes.filter((pane) => Math.abs(bottomOf(pane) - bottom) <= FRAME_EDGE);
    const spans = line.map(([x, , w]) => [x, x + w] as const).sort((a, b) => a[0] - b[0]);
    // Side by side counts panes that start where the ones before them end; a card nested in a pane adds none.
    let covered = 0, reach = 0, sideBySide = 0;
    for (const [start, end] of spans) {
      if (start >= reach - FRAME_SEAM) sideBySide += 1;
      covered += Math.max(0, end - Math.max(start, reach));
      reach = Math.max(reach, end);
    }
    // One wide card alone (or with cards nested in it) is content, not a frame: across the width it takes panes side by
    // side. A row of tiles with the page going on below it is content too (a divider on the panes' own bottom edge is
    // not below them). At the bottom of the capture, square-cornered panes across the whole width are the app's own
    // (a phone shows one pane at a time); a rounded card there is still just the last content.
    const edge = Math.max(...line.map(bottomOf));
    const below = bones.some((bone) => bone[1] >= edge) || (rows ?? []).some((row) => row.y >= edge);
    const atCaptureBottom = Math.abs(bottom - height) <= FRAME_EDGE && covered >= 95 && line.every((pane) => pane[4] === 0);
    if ((sideBySide > 1 && covered >= 95 && !below) || atCaptureBottom) frame = Math.max(frame ?? 0, bottom);
  }
  return frame;
}

/** The nearest ancestor that scrolls vertically, else null. */
function scrollParentOf(node: HTMLElement): HTMLElement | null {
  const view = node.ownerDocument.defaultView;
  for (let parent = node.parentElement; parent && parent !== node.ownerDocument.body; parent = parent.parentElement) {
    const overflow = view?.getComputedStyle(parent).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && parent.clientHeight > 0) return parent;
  }
  return null;
}

/** The visible height from the box top to the bottom of its scroll parent (or the viewport), else the box's own height. */
function visibleHeightOf(node: HTMLElement, parent = scrollParentOf(node)): number {
  const top = node.getBoundingClientRect().top;
  if (parent) return parent.clientHeight - Math.max(0, top - parent.getBoundingClientRect().top);
  const viewport = node.ownerDocument.documentElement.clientHeight;
  if (viewport > 0) return viewport - Math.max(0, top);
  return node.clientHeight;
}

/** A whole view loading: a title bar and table, cards, graph or detail placeholders, named for screen readers in the Space's language. */
export function ViewSkeleton({ variant = 'table', rows = 5, label, locale, skeletonKey = 'main' }: {
  variant?: 'table' | 'cards' | 'graph' | 'detail'; rows?: number;
  /** What loads, said to screen readers ("Loading meetings"). Default "Loading content". */
  label?: Words | string;
  /** Default the Space's locale. */
  locale?: Locale;
  /**
   * The region this skeleton stands for. When the release carries bones measured for it at build time, they are drawn
   * instead of `variant`, which is only the fallback. Give each separately loading region its own key. Default "main".
   */
  skeletonKey?: string;
}) {
  const context = useNotisRuntime()?.context;
  const shown = locale ?? (context?.locale === 'fr' ? 'fr' : 'en');
  const captured = validSkeleton(context?.skeleton);
  const region = captured?.regions[skeletonKey] ?? null;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  const [paneHeight, setPaneHeight] = useState(0);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!region || !root) return;
    const parent = scrollParentOf(root);
    const measure = () => {
      if (root.clientWidth > 0) setBoxWidth(root.clientWidth);
      setPaneHeight(Math.max(0, Math.round(visibleHeightOf(root, parent))));
    };
    measure();
    // Scrolling changes how much of the pane a region lower on the page shows; read at most once a frame.
    const view = root.ownerDocument.defaultView;
    let frame = 0;
    const onScroll = () => {
      if (!view?.requestAnimationFrame) { measure(); return; }
      if (!frame) frame = view.requestAnimationFrame(() => { frame = 0; measure(); });
    };
    root.ownerDocument.addEventListener('scroll', onScroll, { capture: true, passive: true });
    view?.addEventListener('resize', onScroll);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(root);
    if (parent) observer?.observe(parent);
    return () => {
      root.ownerDocument.removeEventListener('scroll', onScroll, { capture: true });
      view?.removeEventListener('resize', onScroll);
      if (frame) view?.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [region]);

  const width = boxWidth ?? (typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1440);
  const entry = region ? pickSkeletonEntry(captured, skeletonKey, width < NARROW_UNDER ? '390' : '1440', shown) : null;
  const status = { role: 'status', 'aria-label': pick(label ?? SKELETON_WORDS.loading, shown), 'aria-busy': true,
    'data-notis-content-skeleton': '', 'data-notis-skeleton-key': skeletonKey } as const;

  if (entry) {
    const repeats = entry.rows ?? [];
    const budget = Math.floor(MAX_ROW_ELEMENTS / Math.max(1, repeats.reduce((sum, row) => sum + Math.max(1, row.bones.length), 0)));
    const copies = repeats.map((row) => Math.min(MAX_ROW_COPIES, Math.max(1, budget),
      Math.max(1, Math.ceil((paneHeight - row.y) / row.h))));
    // A captured frame fills the visible pane: its panes end at the pane bottom and what lay below is clipped.
    const frame = paneHeight > 0 ? frameBottomOf(entry) : null;
    const height = frame !== null ? Math.max(FRAME_MIN, paneHeight)
      : repeats.reduce((most, row, index) => Math.max(most, row.y + copies[index] * row.h), entry.height);
    const drawn = (bone: SkeletonBone): SkeletonBone => frame !== null && isPane(bone)
      && Math.abs(bottomOf(bone) - frame) <= FRAME_EDGE ? [bone[0], bone[1], bone[2], height - bone[1], bone[4], bone[5]] : bone;
    return <div ref={rootRef} {...status}
      style={{ position: 'relative', width: '100%', boxSizing: 'border-box', height, overflow: 'hidden' }}>
      {entry.bones.map((bone, index) => <span key={index} aria-hidden="true" data-notis-bone={bone[5]} style={boneStyle(drawn(bone))} />)}
      {repeats.map((row, rowIndex) => Array.from({ length: copies[rowIndex] }, (_, copy) =>
        <div key={`${rowIndex}:${copy}`} aria-hidden="true" data-notis-bone-row={rowIndex}
          style={{ position: 'absolute', left: 0, right: 0, top: row.y + copy * row.h, height: row.h }}>
          {row.bones.map((bone, index) => <span key={index} data-notis-bone={bone[5]} style={boneStyle(bone)} />)}
        </div>))}
    </div>;
  }

  return <div ref={rootRef} {...status}
    style={{ width: '100%', boxSizing: 'border-box', display: 'grid', gap: 16, padding: 24 }}>
    <Skeleton style={{ width: '32%', height: 28 }} />
    {variant === 'graph' ? <Skeleton style={{ height: 420 }} /> :
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: variant === 'cards' ? 'repeat(auto-fit,minmax(180px,1fr))' : '1fr' }}>
        {Array.from({ length: rows }, (_, index) => <Skeleton key={index}
          style={{ height: variant === 'cards' ? 112 : variant === 'detail' ? 20 : 44,
            width: variant === 'detail' && index === rows - 1 ? '65%' : '100%' }} />)}
      </div>}
  </div>;
}
