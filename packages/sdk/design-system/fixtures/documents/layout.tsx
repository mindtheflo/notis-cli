/**
 * Small layout pieces shared by the documents specimens: a caption above an example and the code that produced
 * it. Flat (spacing only, no rules or borders). Inline styles only: fixtures are not scanned by Tailwind.
 */
import type { ReactNode } from 'react';

const mono = '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace';

/** A line of code, muted. */
export function Code({ children }: { children: ReactNode }) {
  return <code style={{ font: mono, color: 'hsl(var(--muted-foreground))', overflowWrap: 'anywhere' }}>{children}</code>;
}

/** One example: what it is (code or words) above the rendered component. */
export function Example({ caption, children, width }: { caption: ReactNode; children: ReactNode; width?: number }) {
  return (
    <section style={{ display: 'grid', gap: 8, alignContent: 'start', minWidth: 0, maxWidth: width }}>
      <div style={{ font: mono, color: 'hsl(var(--muted-foreground))', overflowWrap: 'anywhere' }}>{caption}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  );
}

/** Examples one under the other. */
export function Stack({ children, gap = 32 }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: 'grid', gap, alignContent: 'start', minWidth: 0 }}>{children}</div>;
}

/** Examples side by side, stacking when a column would be narrower than `min`. */
export function Columns({ children, min = 300, gap = 24 }: { children: ReactNode; min?: number; gap?: number }) {
  return <div style={{ display: 'grid', gap, gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, alignItems: 'start', minWidth: 0 }}>{children}</div>;
}

/**
 * A full ring on all four sides, to show where an element sits when it draws nothing (an empty Markdown value, a
 * fallback without styles). Not a decorative border: it marks the component's box for the reviewer.
 */
export function Outline({ children }: { children: ReactNode }) {
  return (
    <div data-ds-outline="" style={{ outline: '1px solid hsl(var(--ring) / 0.7)', outlineOffset: 4, borderRadius: 4, minHeight: 8 }}>
      {children}
    </div>
  );
}

/** A live readout of what the component reported (callbacks), so the reviewer sees them fire. */
export function Readout({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'hsl(var(--muted-foreground))' }}>
      <span>{label}</span>{' '}
      <span data-ds-readout="" style={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}>{children}</span>
    </p>
  );
}
