'use client';

import { useMemo } from 'react';
import { useNotisNavigation } from '@notis/sdk';
import {
  ChartLineUpIcon,
  FlameIcon,
  LightningIcon,
  MoonStarsIcon,
  NotebookIcon,
  RocketLaunchIcon,
  SparkleIcon,
  SunHorizonIcon,
} from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DAY_MOOD_COLOR,
  ENERGY_COLOR,
  MOOD_SCALE,
  MORNING_MOOD_COLOR,
  MOTIVATION_COLOR,
  average,
  computeStreak,
  dayKey,
  eveningComplete,
  formatDay,
  moodStep,
  morningComplete,
  recentGratitudes,
  round1,
  topMoodWords,
  useJournalEntries,
  type JournalEntry,
} from '../journal-core';
import { EmptyState, LoadingState, SectionCard, StatTile } from '../journal-ui';

export default function StatsPage() {
  const { entries, loading, error } = useJournalEntries();
  const navigation = useNotisNavigation();

  const chrono = useMemo(() => [...entries].reverse(), [entries]); // oldest -> newest
  const recent = useMemo(() => chrono.slice(-21), [chrono]); // last ~3 weeks for trends

  const streak = useMemo(() => computeStreak(entries), [entries]);
  const totals = useMemo(
    () => ({
      morningMood: average(entries.map((e) => e.morningMood)),
      dayMood: average(entries.map((e) => e.dayMood)),
      energy: average(entries.map((e) => e.energy)),
      motivation: average(entries.map((e) => e.motivation)),
    }),
    [entries],
  );
  const lift = useMemo(() => moodLift(entries), [entries]);
  const consistency = useMemo(() => ritualConsistency(entries, 30), [entries]);
  const words = useMemo(() => topMoodWords(entries), [entries]);
  const gratitudes = useMemo(() => recentGratitudes(entries, 12), [entries]);

  if (loading && !entries.length) {
    return (
      <div data-store-screenshot="stats" className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
        <LoadingState label="Reading back through your days…" />
      </div>
    );
  }

  return (
    <div data-store-screenshot="stats" className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ChartLineUpIcon size={14} weight="bold" />
            5 Minutes Journal
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Stats</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What {entries.length} {entries.length === 1 ? 'day' : 'days'} of checking in with
            yourself add up to.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigation.toRoute('/')} className="gap-1.5">
          <NotebookIcon size={16} weight="bold" />
          Back to journal
        </Button>
      </header>

      {error ? (
        <p className="mt-6 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      {entries.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={ChartLineUpIcon}
            title="No patterns to show yet"
            description="After a few mornings and evenings with Notis, your moods, energy, and gratitude will start telling a story here."
            action={
              <Button onClick={() => navigation.toRoute('/')} className="gap-1.5">
                <NotebookIcon size={16} weight="bold" />
                Open journal
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Streak"
              value={streak}
              suffix={streak === 1 ? 'day' : 'days'}
              icon={FlameIcon}
              accent="#f59e0b"
            />
            <StatTile label="Days journaled" value={entries.length} icon={NotebookIcon} />
            <StatTile
              label="Waking mood"
              value={totals.morningMood ?? '—'}
              suffix={totals.morningMood != null ? '/ 7' : undefined}
              icon={SunHorizonIcon}
              accent={MORNING_MOOD_COLOR}
              hint={moodStep(totals.morningMood)?.label}
            />
            <StatTile
              label="Day mood"
              value={totals.dayMood ?? '—'}
              suffix={totals.dayMood != null ? '/ 7' : undefined}
              icon={MoonStarsIcon}
              accent={DAY_MOOD_COLOR}
              hint={moodStep(totals.dayMood)?.label}
            />
            <StatTile
              label="Energy"
              value={totals.energy ?? '—'}
              suffix={totals.energy != null ? '/ 10' : undefined}
              icon={LightningIcon}
              accent={ENERGY_COLOR}
            />
            <StatTile
              label="Motivation"
              value={totals.motivation ?? '—'}
              suffix={totals.motivation != null ? '/ 10' : undefined}
              icon={RocketLaunchIcon}
              accent={MOTIVATION_COLOR}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SectionCard
              title="Mood, morning to evening"
              description="How you woke up next to how the day ended, on the pleasant scale"
              icon={SunHorizonIcon}
              className="lg:col-span-2"
            >
              <MoodTrend entries={recent} />
              <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-foreground/70" />
                  Waking mood
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm border-[1.5px] border-foreground/70 bg-foreground/20" />
                  Whole-day mood
                </span>
                <span>Bars take the color of the mood itself.</span>
                {lift != null ? (
                  <span className="ml-auto">
                    {lift > 0
                      ? `Your days tend to end ${lift} above where they start.`
                      : lift < 0
                        ? `Your days tend to end ${Math.abs(lift)} below where they start.`
                        : 'Your days tend to end where they start.'}
                  </span>
                ) : (
                  <span className="ml-auto">Scale 1–7</span>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Energy & motivation"
              description="Morning levels day by day"
              icon={LightningIcon}
              className="lg:col-span-2"
            >
              <LevelTrend entries={recent} />
              <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                <LegendSwatch color={ENERGY_COLOR} label="Energy" />
                <LegendSwatch color={MOTIVATION_COLOR} label="Motivation" />
                <span className="ml-auto">Scale 1–10</span>
              </div>
            </SectionCard>

            <SectionCard
              title="How your days feel"
              description="Where the whole-day mood lands on the scale"
              icon={MoonStarsIcon}
            >
              <MoodDistribution entries={entries} pick={(e) => e.dayMood} />
            </SectionCard>

            <SectionCard
              title="How you wake up"
              description="Where the waking mood lands on the scale"
              icon={SunHorizonIcon}
            >
              <MoodDistribution entries={entries} pick={(e) => e.morningMood} />
            </SectionCard>

            <SectionCard
              title="The ritual"
              description="Check-ins completed over the last 30 days"
              icon={FlameIcon}
            >
              <div className="space-y-4 pt-1">
                <ConsistencyRow
                  icon={SunHorizonIcon}
                  label="Mornings"
                  fraction={consistency.morning}
                  color={MORNING_MOOD_COLOR}
                />
                <ConsistencyRow
                  icon={MoonStarsIcon}
                  label="Evenings"
                  fraction={consistency.evening}
                  color={DAY_MOOD_COLOR}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Words you reach for"
              description="The adjectives you use most for your moods"
              icon={ChartLineUpIcon}
            >
              {words.length ? (
                <div className="flex flex-wrap gap-2">
                  {words.map(({ word, count }) => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize"
                    >
                      {word}
                      <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <NoData label="No mood words yet" />
              )}
            </SectionCard>

            <SectionCard
              title="Gratitude wall"
              description="The latest things you said thank you for"
              icon={SparkleIcon}
              className="lg:col-span-2"
            >
              {gratitudes.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {gratitudes.map((item, index) => (
                    <div
                      key={`${item.text}-${index}`}
                      className="rounded-xl border border-border/70 bg-muted/30 px-3.5 py-3"
                    >
                      <p className="text-sm leading-snug">{item.text}</p>
                      <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {formatDay(item.date)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <NoData label="Your gratitudes will collect here" />
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function MoodTrend({ entries }: { entries: JournalEntry[] }) {
  if (!entries.length) return <NoData />;
  const summary = entries
    .map(
      (e) =>
        `${formatDay(e.date)}: waking ${e.morningMood ?? 'not logged'}, day ${e.dayMood ?? 'not logged'}`,
    )
    .join('; ');
  return (
    <div
      className="flex items-end gap-1.5 overflow-x-auto pb-1"
      style={{ height: 168 }}
      role="img"
      aria-label={`Waking and whole-day mood by day, on a 1 to 7 scale. ${summary}`}
    >
      {entries.map((entry) => (
        <div key={entry.id} className="flex min-w-[26px] flex-1 flex-col items-center gap-1.5">
          <div className="flex h-[128px] w-full items-end justify-center gap-1">
            <Bar
              fraction={(entry.morningMood ?? 0) / 7}
              color={moodStep(entry.morningMood)?.color ?? MORNING_MOOD_COLOR}
              title={`Waking ${entry.morningMood ?? '—'}`}
            />
            <Bar
              fraction={(entry.dayMood ?? 0) / 7}
              color={moodStep(entry.dayMood)?.color ?? DAY_MOOD_COLOR}
              title={`Day ${entry.dayMood ?? '—'}`}
              hollow
            />
          </div>
          <span className="text-[9px] text-muted-foreground">{shortDay(entry.date)}</span>
        </div>
      ))}
    </div>
  );
}

function LevelTrend({ entries }: { entries: JournalEntry[] }) {
  if (!entries.length) return <NoData />;
  const summary = entries
    .map(
      (e) =>
        `${formatDay(e.date)}: energy ${e.energy ?? 'not logged'}, motivation ${e.motivation ?? 'not logged'}`,
    )
    .join('; ');
  return (
    <div
      className="flex items-end gap-1.5 overflow-x-auto pb-1"
      style={{ height: 168 }}
      role="img"
      aria-label={`Energy and motivation by day. ${summary}`}
    >
      {entries.map((entry) => (
        <div key={entry.id} className="flex min-w-[26px] flex-1 flex-col items-center gap-1.5">
          <div className="flex h-[128px] w-full items-end justify-center gap-1">
            <Bar fraction={(entry.energy ?? 0) / 10} color={ENERGY_COLOR} title={`Energy ${entry.energy ?? '—'}`} />
            <Bar
              fraction={(entry.motivation ?? 0) / 10}
              color={MOTIVATION_COLOR}
              title={`Motivation ${entry.motivation ?? '—'}`}
            />
          </div>
          <span className="text-[9px] text-muted-foreground">{shortDay(entry.date)}</span>
        </div>
      ))}
    </div>
  );
}

function Bar({
  fraction,
  color,
  title,
  hollow,
}: {
  fraction: number;
  color: string;
  title: string;
  hollow?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="flex h-full w-2.5 items-end" title={title}>
      <div
        className="w-full rounded-t-sm transition-all"
        style={{
          height: `${Math.max(pct, fraction > 0 ? 4 : 0)}%`,
          backgroundColor: hollow ? `${color}55` : color,
          boxShadow: hollow ? `inset 0 0 0 1.5px ${color}` : undefined,
        }}
      />
    </div>
  );
}

function MoodDistribution({
  entries,
  pick,
}: {
  entries: JournalEntry[];
  pick: (entry: JournalEntry) => number | null;
}) {
  const counts = new Map<number, number>();
  let total = 0;
  for (const entry of entries) {
    const value = pick(entry);
    const step = moodStep(value);
    if (!step) continue;
    counts.set(step.value, (counts.get(step.value) ?? 0) + 1);
    total += 1;
  }
  if (!total) return <NoData />;
  const max = Math.max(1, ...counts.values());
  // Best mood first, mirroring how the scale reads left to right.
  const rows = [...MOOD_SCALE].reverse();
  return (
    <div className="space-y-2.5">
      {rows.map((step) => {
        const count = counts.get(step.value) ?? 0;
        const pct = Math.round((count / total) * 100);
        return (
          <div
            key={step.value}
            className="flex items-center gap-3"
            aria-label={`${step.label}: ${count} days, ${pct} percent`}
          >
            <span className="w-32 shrink-0 truncate text-xs font-medium">{step.label}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(count / max) * 100}%`, backgroundColor: step.color }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {count} · {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ConsistencyRow({
  icon: IconCmp,
  label,
  fraction,
  color,
}: {
  icon: typeof SunHorizonIcon;
  label: string;
  fraction: number;
  color: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <IconCmp size={14} weight="bold" style={{ color }} />
        {label}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function NoData({ label = 'Not enough data yet' }: { label?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-10 text-xs text-muted-foreground')}>
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Average change from waking mood to whole-day mood, when both were logged. */
function moodLift(entries: JournalEntry[]): number | null {
  const deltas = entries
    .filter((e) => e.morningMood != null && e.dayMood != null)
    .map((e) => (e.dayMood as number) - (e.morningMood as number));
  if (!deltas.length) return null;
  return round1(deltas.reduce((sum, d) => sum + d, 0) / deltas.length);
}

/** Fraction of the last `windowDays` days with complete morning / evening rituals. */
function ritualConsistency(
  entries: JournalEntry[],
  windowDays: number,
): { morning: number; evening: number } {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffKey = dayKey(cutoff.toISOString()) ?? '';
  const recent = entries.filter((e) => (dayKey(e.date) ?? '') >= cutoffKey);
  if (!recent.length) return { morning: 0, evening: 0 };
  return {
    morning: Math.min(1, recent.filter(morningComplete).length / windowDays),
    evening: Math.min(1, recent.filter(eveningComplete).length / windowDays),
  };
}

function shortDay(value: string | null): string {
  const key = dayKey(value);
  if (!key) return '';
  const [, m, d] = key.split('-');
  return `${Number(m)}/${Number(d)}`;
}
