'use client';

/** Shared presentational building blocks for Journal. */

import type { ReactNode } from 'react';
import { CircleNotchIcon, type Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MOOD_SCALE, moodStep } from './journal-core';

/**
 * The signature mood control: seven dots from very unpleasant to very
 * pleasant, with the recorded step enlarged and colored, plus the adjective
 * the user gave. Read-only — the automations do the asking.
 */
export function MoodScale({
  value,
  word,
  size = 'md',
}: {
  value: number | null;
  word?: string | null;
  size?: 'sm' | 'md';
}) {
  const active = moodStep(value);
  const dot = size === 'sm' ? 7 : 9;
  const activeDot = size === 'sm' ? 13 : 18;
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5" role="img" aria-label={active ? `${active.label} (${active.value} of 7)` : 'No mood recorded'}>
        {MOOD_SCALE.map((step) => {
          const isActive = active?.value === step.value;
          return (
            <span
              key={step.value}
              className="rounded-full transition-all"
              title={step.label}
              style={{
                width: isActive ? activeDot : dot,
                height: isActive ? activeDot : dot,
                backgroundColor: isActive ? step.color : 'transparent',
                boxShadow: isActive
                  ? `0 0 0 3px ${step.soft}`
                  : `inset 0 0 0 1.5px ${step.color}55`,
              }}
            />
          );
        })}
      </div>
      {active ? (
        <span className={cn('font-medium leading-tight', size === 'sm' ? 'text-xs' : 'text-sm')}>
          {word ? <span className="capitalize">{word}</span> : active.label}
          {word ? (
            <span className="ml-1.5 font-normal text-muted-foreground">{active.label.toLowerCase()}</span>
          ) : null}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Not recorded</span>
      )}
    </div>
  );
}

/** Small colored dot for the timeline rail. Hollow when missing. */
export function MoodDot({ value, size = 8 }: { value: number | null; size?: number }) {
  const step = moodStep(value);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: step?.color ?? 'transparent',
        boxShadow: step ? undefined : 'inset 0 0 0 1px hsl(var(--muted-foreground) / 0.4)',
      }}
    />
  );
}

/** Compact mood pill: colored dot + adjective (or scale label). */
export function MoodPill({ value, word }: { value: number | null; word?: string | null }) {
  const step = moodStep(value);
  if (!step) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
      style={{ backgroundColor: step.soft, color: step.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: step.color }} />
      {word ?? step.label}
    </span>
  );
}

/** 1..10 level rendered as a labelled row of ten ticks. */
export function LevelTicks({
  label,
  value,
  color,
  icon: IconCmp,
}: {
  label: string;
  value: number | null;
  color: string;
  icon: Icon;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-28 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <IconCmp size={14} weight="bold" style={{ color }} />
        {label}
      </span>
      <div className="flex flex-1 items-center gap-1" role="img" aria-label={`${label}: ${value ?? 'not recorded'} out of 10`}>
        {Array.from({ length: 10 }, (_, i) => {
          const filled = value != null && i < value;
          return (
            <span
              key={i}
              className="h-3.5 flex-1 rounded-sm transition-all"
              style={{
                maxWidth: 18,
                backgroundColor: filled ? color : 'hsl(var(--muted))',
                opacity: filled ? 0.4 + 0.6 * ((i + 1) / 10) : 1,
              }}
            />
          );
        })}
      </div>
      <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums">
        {value ?? '—'}
      </span>
    </div>
  );
}

/** Section wrapper for the morning / evening halves of a day spread. */
export function RitualSection({
  icon: IconCmp,
  title,
  accent,
  aside,
  children,
}: {
  icon: Icon;
  title: string;
  accent: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ backgroundColor: `${accent}1f`, color: accent }}
          >
            <IconCmp size={15} weight="fill" />
          </span>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {title}
          </h2>
        </div>
        {aside}
      </header>
      <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

/** A prompt of the ritual with its answer, or a gentle "not captured" hint. */
export function PromptBlock({
  prompt,
  children,
  missingHint,
}: {
  prompt: string;
  children?: ReactNode;
  missingHint?: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {prompt}
      </p>
      {children ? (
        <div className="mt-1.5 text-sm leading-relaxed">{children}</div>
      ) : (
        <p className="mt-1.5 text-sm italic text-muted-foreground/70">
          {missingHint ?? 'Not captured.'}
        </p>
      )}
    </div>
  );
}

/** Status chip for morning / evening capture state on rail rows and headers. */
export function RitualChip({
  icon: IconCmp,
  label,
  state,
  accent,
}: {
  icon: Icon;
  label: string;
  state: 'complete' | 'partial' | 'missing';
  accent: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        state === 'missing'
          ? 'border-dashed border-border text-muted-foreground'
          : 'border-transparent',
      )}
      style={
        state === 'missing'
          ? undefined
          : { backgroundColor: `${accent}1a`, color: accent }
      }
    >
      <IconCmp size={12} weight={state === 'missing' ? 'regular' : 'fill'} />
      {label}
      {state === 'partial' ? <span className="opacity-70">· partial</span> : null}
    </span>
  );
}

export function StatTile({
  label,
  value,
  suffix,
  hint,
  icon: IconCmp,
  accent,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  hint?: string;
  icon?: Icon;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {IconCmp ? (
          <IconCmp size={15} weight="bold" style={{ color: accent ?? 'hsl(var(--muted-foreground))' }} />
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  icon: IconCmp,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: Icon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start gap-2.5">
          {IconCmp ? (
            <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <IconCmp size={16} weight="bold" />
            </span>
          ) : null}
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <CircleNotchIcon size={16} className="animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon: IconCmp,
  title,
  description,
  action,
}: {
  icon: Icon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <IconCmp size={20} weight="bold" />
      </span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
