import type { CSSProperties } from 'react';

/** Content-shaped placeholder. Never use it to replace a successful cached result. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={className} style={{ display: 'block', height: 16,
    // Apps may define --muted as HSL channels or a complete CSS color. A
    // neutral default remains visible with either token format and no theme.
    borderRadius: 6, background: 'rgba(128,128,128,.18)', ...style }} />;
}

export function ViewSkeleton({ variant = 'table', rows = 5 }: {
  variant?: 'table' | 'cards' | 'graph' | 'detail'; rows?: number;
}) {
  return <div role="status" aria-label="Loading content" aria-busy="true" data-notis-content-skeleton
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
