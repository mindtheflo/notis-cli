import type { CSSProperties } from 'react';
import { useNotisRuntime } from '../provider';
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

/** A whole view loading: a title bar and table, cards, graph or detail placeholders, named for screen readers in the Space's language. */
export function ViewSkeleton({ variant = 'table', rows = 5, label, locale }: {
  variant?: 'table' | 'cards' | 'graph' | 'detail'; rows?: number;
  /** What loads, said to screen readers ("Loading meetings"). Default "Loading content". */
  label?: Words | string;
  /** Default the Space's locale. */
  locale?: Locale;
}) {
  const runtimeLocale = useNotisRuntime()?.context?.locale;
  const shown = locale ?? (runtimeLocale === 'fr' ? 'fr' : 'en');
  return <div role="status" aria-label={pick(label ?? SKELETON_WORDS.loading, shown)} aria-busy="true" data-notis-content-skeleton
    style={{ width: '100%', display: 'grid', gap: 16, padding: 24 }}>
    <Skeleton style={{ width: '32%', height: 28 }} />
    {variant === 'graph' ? <Skeleton style={{ height: 420 }} /> :
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: variant === 'cards' ? 'repeat(auto-fit,minmax(180px,1fr))' : '1fr' }}>
        {Array.from({ length: rows }, (_, index) => <Skeleton key={index}
          style={{ height: variant === 'cards' ? 112 : variant === 'detail' ? 20 : 44,
            width: variant === 'detail' && index === rows - 1 ? '65%' : '100%' }} />)}
      </div>}
  </div>;
}
