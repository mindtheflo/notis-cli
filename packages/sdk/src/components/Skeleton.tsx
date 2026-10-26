import { useRef, useState, type CSSProperties } from 'react';
import { useNotisRuntime } from '../provider';
import { isNotisSpaceSkeleton, pickSkeletonEntry, type NotisSpaceSkeleton, type SkeletonBone } from '../skeleton';
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
function visibleHeightOf(node: HTMLElement): number {
  const top = node.getBoundingClientRect().top;
  const parent = scrollParentOf(node);
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
    const measure = () => {
      if (root.clientWidth > 0) setBoxWidth(root.clientWidth);
      setPaneHeight(Math.max(0, Math.round(visibleHeightOf(root))));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const parent = scrollParentOf(root);
    if (parent) observer.observe(parent);
    return () => observer.disconnect();
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
    const height = repeats.reduce((most, row, index) => Math.max(most, row.y + copies[index] * row.h), entry.height);
    return <div ref={rootRef} {...status}
      style={{ position: 'relative', width: '100%', boxSizing: 'border-box', height, overflow: 'hidden' }}>
      {entry.bones.map((bone, index) => <span key={index} aria-hidden="true" data-notis-bone={bone[5]} style={boneStyle(bone)} />)}
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
