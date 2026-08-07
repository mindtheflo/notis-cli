'use client';

/**
 * Shared data layer + domain model for Journal.
 *
 * The journal is capture-less by design: entries are created and completed by
 * the Notis morning and evening automations, and the app only reads
 * `journal_entries`. Everything both routes need lives here — the mood scale,
 * the entry adapter over SDK-normalized documents, completeness helpers, and
 * formatting utilities.
 */

import { useMemo } from 'react';
import { useDocuments, type DocumentRecord } from '@notis/sdk';

export const JOURNAL_DATABASE_SLUG = 'journal_entries';

// Canonical property names as defined on the journal_entries schema.
export const PROP = {
  title: 'Name',
  date: 'Date',
  morningMood: 'Morning Mood',
  morningMoodWord: 'Morning Mood Word',
  morningFeeling: 'Morning Feeling',
  energy: 'Energy',
  motivation: 'Motivation',
  gratitude1: 'Gratitude 1',
  gratitude2: 'Gratitude 2',
  gratitude3: 'Gratitude 3',
  intention: 'Intention',
  affirmation: 'Affirmation',
  dayMood: 'Day Mood',
  dayMoodWord: 'Day Mood Word',
  highlight: 'Highlight',
  lesson: 'Lesson',
} as const;

export interface JournalEntry {
  id: string;
  title: string;
  date: string | null; // YYYY-MM-DD for the day this entry is for
  /** Waking mood on the 1–7 pleasant scale. */
  morningMood: number | null;
  morningMoodWord: string | null;
  morningFeeling: string | null;
  energy: number | null; // 1–10
  motivation: number | null; // 1–10
  gratitudes: [string | null, string | null, string | null];
  intention: string | null;
  affirmation: string | null;
  /** Whole-day mood on the 1–7 pleasant scale, filled in the evening. */
  dayMood: number | null;
  dayMoodWord: string | null;
  highlight: string | null;
  lesson: string | null;
  /** Markdown body — the optional free-form entry dictated to Notis. */
  freeEntry: string | null;
  createdAt: string | null;
  lastEditedTime: string | null;
}

// ---------------------------------------------------------------------------
// The pleasant–unpleasant mood scale (Apple-watch style, 1..7)
// ---------------------------------------------------------------------------

export interface MoodStep {
  value: number; // 1..7
  label: string;
  color: string; // accent used for dots / bars
  soft: string; // translucent background
}

export const MOOD_SCALE: MoodStep[] = [
  { value: 1, label: 'Very unpleasant', color: '#8b5cf6', soft: 'rgba(139,92,246,0.15)' },
  { value: 2, label: 'Unpleasant', color: '#6366f1', soft: 'rgba(99,102,241,0.15)' },
  { value: 3, label: 'Slightly unpleasant', color: '#3b82f6', soft: 'rgba(59,130,246,0.15)' },
  { value: 4, label: 'Neutral', color: '#0ea5e9', soft: 'rgba(14,165,233,0.15)' },
  { value: 5, label: 'Slightly pleasant', color: '#14b8a6', soft: 'rgba(20,184,166,0.15)' },
  { value: 6, label: 'Pleasant', color: '#10b981', soft: 'rgba(16,185,129,0.15)' },
  { value: 7, label: 'Very pleasant', color: '#f59e0b', soft: 'rgba(245,158,11,0.17)' },
];

export function moodStep(value: number | null | undefined): MoodStep | null {
  if (value == null) return null;
  const rounded = Math.round(value);
  return MOOD_SCALE.find((step) => step.value === rounded) ?? null;
}

export const ENERGY_COLOR = '#f59e0b';
export const MOTIVATION_COLOR = '#3b82f6';
export const MORNING_MOOD_COLOR = '#f59e0b';
export const DAY_MOOD_COLOR = '#6366f1';

// ---------------------------------------------------------------------------
// Entry adapter over SDK-normalized documents
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function entryFromDocument(document: DocumentRecord): JournalEntry {
  const props = document.properties;
  return {
    id: document.id,
    title: str(props[PROP.title]) ?? str(document.title) ?? 'Untitled entry',
    date: str(props[PROP.date]),
    morningMood: num(props[PROP.morningMood]),
    morningMoodWord: str(props[PROP.morningMoodWord]),
    morningFeeling: str(props[PROP.morningFeeling]),
    energy: num(props[PROP.energy]),
    motivation: num(props[PROP.motivation]),
    gratitudes: [
      str(props[PROP.gratitude1]),
      str(props[PROP.gratitude2]),
      str(props[PROP.gratitude3]),
    ],
    intention: str(props[PROP.intention]),
    affirmation: str(props[PROP.affirmation]),
    dayMood: num(props[PROP.dayMood]),
    dayMoodWord: str(props[PROP.dayMoodWord]),
    highlight: str(props[PROP.highlight]),
    lesson: str(props[PROP.lesson]),
    freeEntry: document.contentMarkdown ?? document.plainText ?? null,
    createdAt: document.createdAt ?? null,
    lastEditedTime: document.lastEditedTime ?? null,
  };
}

/** Newest first, using the entry Date then falling back to creation time. */
export function sortEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => {
    const av = a.date ?? a.createdAt ?? '';
    const bv = b.date ?? b.createdAt ?? '';
    return av < bv ? 1 : av > bv ? -1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Completeness — what the automations still need to ask for
// ---------------------------------------------------------------------------

export function gratitudeCount(entry: JournalEntry): number {
  return entry.gratitudes.filter(Boolean).length;
}

/** True when any of the morning ritual fields has been captured. */
export function morningStarted(entry: JournalEntry): boolean {
  return (
    entry.morningMood != null ||
    entry.morningMoodWord != null ||
    entry.morningFeeling != null ||
    entry.energy != null ||
    entry.motivation != null ||
    gratitudeCount(entry) > 0 ||
    entry.intention != null ||
    entry.affirmation != null
  );
}

export function morningComplete(entry: JournalEntry): boolean {
  return (
    entry.morningMood != null &&
    entry.morningMoodWord != null &&
    entry.energy != null &&
    entry.motivation != null &&
    gratitudeCount(entry) === 3 &&
    entry.intention != null &&
    entry.affirmation != null
  );
}

export function eveningStarted(entry: JournalEntry): boolean {
  return (
    entry.dayMood != null ||
    entry.dayMoodWord != null ||
    entry.highlight != null ||
    entry.lesson != null
  );
}

export function eveningComplete(entry: JournalEntry): boolean {
  return (
    entry.dayMood != null &&
    entry.dayMoodWord != null &&
    entry.highlight != null &&
    entry.lesson != null
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD in local time, for grouping and comparisons. */
export function dayKey(value: string | null): string | null {
  const d = toDate(value);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return dayKey(new Date().toISOString()) ?? '';
}

export function formatDay(value: string | null, opts: { weekday?: boolean } = {}): string {
  const d = toDate(value);
  if (!d) return 'No date';
  return d.toLocaleDateString(undefined, {
    weekday: opts.weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

/** "Wednesday, July 16" — the headline identity of a day spread. */
export function formatDayLong(value: string | null): string {
  const d = toDate(value);
  if (!d) return 'No date';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function relativeDay(value: string | null): string | null {
  const key = dayKey(value);
  if (!key) return null;
  const today = todayKey();
  if (key === today) return 'Today';
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (key === yesterday) return 'Yesterday';
  return null;
}

/** Short weekday + day-of-month pieces for the timeline rail. */
export function railDate(value: string | null): { weekday: string; day: string } {
  const d = toDate(value);
  if (!d) return { weekday: '—', day: '·' };
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    day: String(d.getDate()),
  };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return round1(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

/** Compute a current daily-journaling streak (consecutive days up to today). */
export function computeStreak(entries: JournalEntry[]): number {
  const keys = new Set(entries.map((e) => dayKey(e.date)).filter(Boolean) as string[]);
  if (!keys.size) return 0;
  let streak = 0;
  const cursor = new Date();
  // Allow the streak to "start" yesterday if today has no entry yet.
  if (!keys.has(dayKey(cursor.toISOString()) ?? '')) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (keys.has(dayKey(cursor.toISOString()) ?? '')) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** "July 2026" style label for timeline month grouping. */
export function monthLabel(value: string | null): string {
  const key = dayKey(value);
  if (!key) return 'Undated';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Most frequent mood adjectives across entries (morning + day words),
 * lower-cased, best first.
 */
export function topMoodWords(
  entries: JournalEntry[],
  limit = 12,
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const word of [entry.morningMoodWord, entry.dayMoodWord]) {
      if (!word) continue;
      const key = word.trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

/** Recent gratitudes, newest first, flattened from the three slots. */
export function recentGratitudes(
  entries: JournalEntry[],
  limit = 12,
): Array<{ text: string; date: string | null }> {
  const items: Array<{ text: string; date: string | null }> = [];
  for (const entry of entries) {
    for (const text of entry.gratitudes) {
      if (text) items.push({ text, date: entry.date });
    }
    if (items.length >= limit) break;
  }
  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useJournalEntries() {
  const { documents, loading, error, refetch } = useDocuments(JOURNAL_DATABASE_SLUG, {
    // A one-year window keeps the embedded app fast while preserving enough
    // history for useful trends. Older entries remain available in Notis.
    pageSize: 365,
    fetchAll: false,
  });

  const entries = useMemo(
    () => sortEntries(documents.map(entryFromDocument)),
    [documents],
  );

  return { entries, loading, error: error?.message ?? null, refresh: refetch };
}
