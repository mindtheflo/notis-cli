/**
 * Chart fixtures: Notis product metrics dated relative to the book's fixed clock (2026-06-15, a Monday, 11:30 in
 * Paris). Every value comes from the fixed literals below; nothing is random. Today is still filling, so its day
 * (and its hour) holds only the share of the day that has passed.
 */
import { FIXED_NOW, type SpecimenCopy, type SpecimenLang } from '../../specimen';
import {
  compareRange,
  formatNumber,
  periodSeries,
  presetRange,
  type CompareId,
  type DatedPoint,
  type PeriodChartRow,
  type PeriodRange,
  type PresetId,
  type StatMetric,
  total,
} from '../../../src/ui/index';

export const NOW = new Date(FIXED_NOW);

/** Weekday factors, Sunday first: weekends dip, the way Notis traffic does. */
const WEEKDAY = [0.6, 1.06, 1.12, 1.1, 1.04, 0.95, 0.64];
/** A fixed wobble so the series does not read as a ruler. */
const WOBBLE = [1, 0.95, 1.04, 0.98, 1.06, 0.97, 1.02, 0.94, 1.05, 1.01, 0.96, 1.03, 0.99];
/** Messages per hour on a weekday, midnight first. */
const HOURS = [120, 70, 40, 30, 35, 80, 260, 610, 980, 1240, 1310, 1280, 1190, 1250, 1300, 1270, 1180, 1050, 900, 780,
  640, 520, 380, 220];

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const TODAY = startOfLocalDay(NOW);
/** The share of today that has passed at the fixed clock. */
const TODAY_FILLED = (NOW.getHours() * 60 + NOW.getMinutes()) / (24 * 60);

/** One point a day for `days` days up to today, rising from `from` to `to` a day. */
function daily(days: number, from: number, to: number): DatedPoint[] {
  const out: DatedPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addLocalDays(TODAY, i - days + 1);
    const level = from + ((to - from) * i) / (days - 1);
    let value = level * WEEKDAY[day.getDay()]! * WOBBLE[i % WOBBLE.length]!;
    if (i === days - 1) value *= TODAY_FILLED;
    out.push({ date: isoDay(day), value: Math.round(value) });
  }
  return out;
}

/** Sign-ups a day, over the last 460 days (enough for a year-ago comparison of 90 days). */
export const SIGNUPS = daily(460, 52, 168);
/** Messages a day, by channel. */
export const WEB_MESSAGES = daily(460, 3900, 6300);
export const WHATSAPP_MESSAGES = daily(460, 2100, 4200);
export const SLACK_MESSAGES = daily(460, 700, 1250);
export const ALL_MESSAGES = [...WEB_MESSAGES, ...WHATSAPP_MESSAGES, ...SLACK_MESSAGES];

/** Messages an hour: today until now (the current hour still filling), and yesterday, a Sunday. */
export const HOURLY_MESSAGES: DatedPoint[] = (() => {
  const out: DatedPoint[] = [];
  const yesterday = addLocalDays(TODAY, -1);
  HOURS.forEach((value, hour) => {
    out.push({ date: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), hour, 30), value: Math.round(value * 0.62) });
    if (hour < NOW.getHours()) out.push({ date: new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), hour, 30), value });
    if (hour === NOW.getHours()) {
      out.push({ date: new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), hour, 10), value: Math.round(value * NOW.getMinutes() / 60) });
    }
  });
  return out;
})();

export function rangeOf(preset: PresetId): PeriodRange {
  return presetRange(preset, NOW);
}

/** Rows for `<Chart>` from dated points, with the comparison `compare` names. */
export function seriesRows(points: readonly DatedPoint[], lang: SpecimenLang, preset: PresetId = 'last30',
  compare: CompareId = 'prev', mode: 'sum' | 'avg' = 'sum'): PeriodChartRow[] {
  const range = rangeOf(preset);
  return periodSeries({ points, range, compareRange: compareRange(range, compare), locale: lang, mode });
}

export type ChannelRow = PeriodChartRow & { web: number; whatsapp: number; slack: number };

/** Messages by channel, one row per bin: `web`, `whatsapp` and `slack`, plus `value` (their sum). */
export function channelRows(lang: SpecimenLang, preset: PresetId = 'last30'): ChannelRow[] {
  const range = rangeOf(preset);
  const of = (points: readonly DatedPoint[]) => periodSeries({ points, range, locale: lang });
  const web = of(WEB_MESSAGES);
  const whatsapp = of(WHATSAPP_MESSAGES);
  const slack = of(SLACK_MESSAGES);
  return web.map((row, i) => ({
    ...row,
    web: row.value,
    whatsapp: whatsapp[i]!.value,
    slack: slack[i]!.value,
    value: row.value + whatsapp[i]!.value + slack[i]!.value,
  }));
}

/** The last `days` days of messages by channel (14 by default), for charts composed by hand. */
export function recentChannelRows(lang: SpecimenLang, days = 14): ChannelRow[] {
  return channelRows(lang, 'last30').slice(-days);
}

/** Share of messages by channel over the last 30 days, for a pie. */
export function channelShare(lang: SpecimenLang): Array<{ key: 'web' | 'whatsapp' | 'slack'; value: number }> {
  const rows = channelRows(lang, 'last30');
  const sum = (key: 'web' | 'whatsapp' | 'slack') => rows.reduce((total, row) => total + row[key], 0);
  return (['web', 'whatsapp', 'slack'] as const).map((key) => ({ key, value: sum(key) }));
}

/**
 * The share by channel for a workspace that has not connected Slack yet: its Slack value is 0, so a bar chart of it
 * shows a zero bar (and its label) next to two real ones.
 */
export function channelShareNoSlack(lang: SpecimenLang): Array<{ key: 'web' | 'whatsapp' | 'slack'; value: number }> {
  return channelShare(lang).map((row) => (row.key === 'slack' ? { ...row, value: 0 } : row));
}

export const CHANNEL_LABELS: Record<'web' | 'whatsapp' | 'slack', SpecimenCopy> = {
  web: { en: 'Web app', fr: 'App web' },
  whatsapp: { en: 'WhatsApp', fr: 'WhatsApp' },
  slack: { en: 'Slack', fr: 'Slack' },
};

/** Long series names: the French runs over 30 percent longer. */
export const LONG_LABELS = {
  fast: { en: 'Answered within a minute', fr: 'Réponses envoyées en moins d’une minute' },
  followUp: { en: 'Needed a follow-up', fr: 'Ont demandé une question de relance' },
} satisfies Record<string, SpecimenCopy>;

export type AnswerRow = PeriodChartRow & { fast: number; followUp: number };

/** Messages of the last 30 days split by how they were answered (series with long names). */
export function answerRows(lang: SpecimenLang): AnswerRow[] {
  return channelRows(lang, 'last30').map(({ web: _w, whatsapp: _a, slack: _s, ...row }) => ({
    ...row,
    fast: Math.round(row.value * 0.71),
    followUp: Math.round(row.value * 0.29),
  }));
}

/** The last 30 days with nothing recorded: every bin, and its comparison, at zero. */
export function zeroRows(lang: SpecimenLang): PeriodChartRow[] {
  const range = rangeOf('last30');
  return periodSeries({ points: [], range, compareRange: compareRange(range, 'prev'), locale: lang });
}

/** "14.2k" / "14,2k": one decimal when there is one, as the deck's metric list writes thousands. */
export function thousands(value: number, lang: SpecimenLang): string {
  return `${formatNumber(value, lang, { maximumFractionDigits: 1 })}k`;
}

export interface WeeklyMetric {
  key: string;
  label: SpecimenCopy;
  /** What the figure counts, for an about tooltip. */
  definition: SpecimenCopy;
  /** Twelve weeks, oldest first; the last one is the week that ended yesterday (8 to 14 June). */
  series: readonly number[];
  /** The figure is in thousands. */
  inThousands?: boolean;
}

/** The six product metrics of the deck's chart page (layouts r5, composition b), week by week. */
export const WEEKLY_METRICS: readonly WeeklyMetric[] = [
  {
    key: 'signups',
    label: { en: 'Signups', fr: 'Inscriptions' },
    definition: { en: 'New accounts created in the week.', fr: 'Comptes créés dans la semaine.' },
    series: [612, 655, 640, 702, 731, 780, 812, 798, 870, 941, 1012, 1131],
  },
  {
    key: 'active',
    label: { en: 'Weekly active users', fr: 'Utilisateurs actifs' },
    definition: {
      en: 'People who sent Notis at least one message in the week.',
      fr: 'Personnes qui ont envoyé au moins un message à Notis dans la semaine.',
    },
    series: [3210, 3302, 3350, 3420, 3510, 3488, 3605, 3712, 3790, 3866, 3990, 4122],
  },
  {
    key: 'messages',
    label: { en: 'Messages', fr: 'Messages' },
    definition: { en: 'Messages sent to Notis, in thousands.', fr: 'Messages envoyés à Notis, en milliers.' },
    series: [48, 51, 50, 55, 58, 57, 61, 66, 64, 70, 74, 79],
    inThousands: true,
  },
  {
    key: 'voice',
    label: { en: 'Voice minutes', fr: 'Minutes de voix' },
    definition: { en: 'Minutes of voice calls, in thousands.', fr: 'Minutes d’appels vocaux, en milliers.' },
    series: [9.1, 9.4, 10.2, 9.8, 10.9, 11.6, 11.2, 12.4, 12.9, 12.1, 13.5, 14.2],
    inThousands: true,
  },
  {
    key: 'spaces',
    label: { en: 'Spaces created', fr: 'Spaces créés' },
    definition: { en: 'New Spaces built by users.', fr: 'Nouveaux Spaces créés par les utilisateurs.' },
    series: [41, 38, 52, 49, 61, 58, 70, 66, 81, 77, 92, 104],
  },
  {
    key: 'paid',
    label: { en: 'Paid conversions', fr: 'Passages payants' },
    definition: { en: 'Trials that turned into a paid plan.', fr: 'Essais devenus une offre payante.' },
    series: [36, 41, 39, 44, 47, 45, 52, 49, 55, 58, 54, 63],
  },
];

/** A weekly metric as a StatMetric: this week, the week before and the twelve weeks as its trend. */
export function weeklyStat(metric: WeeklyMetric, overrides: Partial<StatMetric> = {}): StatMetric {
  const s = metric.series;
  return {
    id: metric.key,
    label: metric.label,
    value: s[s.length - 1]!,
    previous: s[s.length - 2]!,
    spark: s,
    ...(metric.inThousands ? { format: thousands } : {}),
    ...overrides,
  };
}

/** The same metrics a year earlier, for a year-on-year comparison (the year before grew slower). */
export const YEAR_AGO: Record<string, number> = { signups: 402, active: 1880, messages: 31, voice: 4.6, spaces: 12, paid: 21 };

/** Figures where a rise is bad: the change turns red when they go up. */
export function costStats(): StatMetric[] {
  return [
    {
      id: 'failed-runs',
      label: { en: 'Failed automation runs', fr: 'Automatisations en échec' },
      value: 12,
      previous: 20,
      higherIsBetter: false,
    },
    {
      id: 'model-cost',
      label: { en: 'Model cost', fr: 'Coût des modèles' },
      value: 412.5,
      previous: 380,
      higherIsBetter: false,
      format: (v, l) => formatNumber(v, l, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
    },
    {
      id: 'reply-time',
      label: { en: 'Median reply time', fr: 'Temps de réponse médian' },
      value: 2.4,
      previous: 2.9,
      higherIsBetter: false,
      format: (v, l) => formatNumber(v, l, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }),
    },
  ];
}

/** Long labels (French over 30 percent longer), a zero previous value and an unchanged figure. */
export function edgeStats(): StatMetric[] {
  return [
    {
      id: 'handled',
      label: { en: 'Interactions handled without an incident', fr: 'Interactions traitées sans le moindre incident signalé' },
      value: 1480,
      previous: 1200,
    },
    {
      id: 'shared',
      label: { en: 'Spaces shared with a team', fr: 'Spaces partagés avec une équipe entière' },
      value: 6,
      previous: 0,
    },
    {
      id: 'teams',
      label: { en: 'Paying teams', fr: 'Équipes payantes' },
      value: 214,
      previous: 214,
    },
  ];
}

// ---- The twelve weeks, as chart rows ----

/** The Monday twelve weeks back: the first of the twelve complete weeks before today (23 March 2026). */
const WEEKS_FROM = addLocalDays(TODAY, -84);

/** A weekly metric over its twelve complete weeks, one bar per week (Monday to Sunday), not live. */
export function weeklyRows(metric: WeeklyMetric, lang: SpecimenLang): PeriodChartRow[] {
  const points = metric.series.map((value, i) => ({ date: isoDay(addLocalDays(WEEKS_FROM, i * 7)), value }));
  const range = presetRange('custom', NOW, { from: isoDay(WEEKS_FROM), to: isoDay(addLocalDays(TODAY, -1)) });
  return periodSeries({ points, range, locale: lang });
}

// ---- The same metrics day by day, the deck's period model (period-r6) ----

/** Figures that are a level (averaged over a period), not a count (added up). */
const LEVEL = new Set(['active']);

/** The deck's fixed noise: a hash of the text to [0, 1). */
function noise(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * One day's value `offset` days from today: the metric's twelve-week growth, quieter weekends, a little noise.
 * Before the twelve weeks it grows slower, from the figure a year earlier (`YEAR_AGO`), so a comparison with last
 * year reads as the stat row's year-ago figure and not as a line flat at the bottom of the chart.
 */
function dayValue(metric: WeeklyMetric, offset: number): number {
  const s = metric.series;
  const first = s[0]!;
  const last = s[s.length - 1]!;
  const rate = Math.log(last / first) / 77;
  const yearAgo = YEAR_AGO[metric.key] ?? first;
  const slower = Math.log(first / yearAgo) / (364 - 77);
  const level = LEVEL.has(metric.key);
  const scale = level ? 1 : 1 / 7;
  const base = offset >= -77
    ? last * scale * Math.exp(rate * offset)
    : first * scale * Math.exp(slower * (offset + 77));
  const weekday = addLocalDays(TODAY, offset).getDay();
  const weekend = weekday === 0 || weekday === 6;
  const week = level ? (weekend ? 0.96 : 1.01) : (weekend ? 0.72 : 1.1);
  const spread = level ? 0.04 : 0.16;
  return base * week * (1 - spread / 2 + noise(`${metric.key}${offset}`) * spread);
}

const DAYS = new Map<string, DatedPoint[]>();

/** The metric day by day over the last 460 days, today included. */
export function metricDays(metric: WeeklyMetric): DatedPoint[] {
  let days = DAYS.get(metric.key);
  if (!days) {
    days = [];
    for (let offset = -459; offset <= 0; offset += 1) {
      days.push({ date: isoDay(addLocalDays(TODAY, offset)), value: dayValue(metric, offset) });
    }
    DAYS.set(metric.key, days);
  }
  return days;
}

function modeOf(metric: WeeklyMetric): 'sum' | 'avg' {
  return LEVEL.has(metric.key) ? 'avg' : 'sum';
}

/** Thousands as the deck's period figures write them: one decimal under 10 ("8.4k"), whole above ("340k"). */
export function periodThousands(value: number, lang: SpecimenLang): string {
  return `${formatNumber(value, lang, { maximumFractionDigits: value < 10 ? 1 : 0 })}k`;
}

/** The format of a metric's figures over a period. */
export function periodFormat(metric: WeeklyMetric): StatMetric['format'] {
  return metric.inThousands ? periodThousands : undefined;
}

/** A metric over a period: its total (or average), the comparison's, and the bins as its trend. */
export function periodStat(metric: WeeklyMetric, lang: SpecimenLang, range: PeriodRange,
  compare: CompareId = 'prev', overrides: Partial<StatMetric> = {}): StatMetric {
  const points = metricDays(metric);
  const before = compareRange(range, compare);
  const format = periodFormat(metric);
  return {
    id: metric.key,
    label: metric.label,
    value: total(points, range, modeOf(metric)),
    previous: before ? total(points, before, modeOf(metric)) : null,
    spark: periodSeries({ points, range, locale: lang, mode: modeOf(metric) }).map((row) => row.value),
    ...(format ? { format } : {}),
    ...overrides,
  };
}

/** Chart rows of a metric over a period, with its comparison. */
export function periodRows(metric: WeeklyMetric, lang: SpecimenLang, range: PeriodRange,
  compare: CompareId = 'prev'): PeriodChartRow[] {
  return periodSeries({
    points: metricDays(metric),
    range,
    compareRange: compareRange(range, compare),
    locale: lang,
    mode: modeOf(metric),
  });
}

/** The metric of a key (the first one when the key is unknown). */
export function metricOf(key: string | undefined): WeeklyMetric {
  return WEEKLY_METRICS.find((metric) => metric.key === key) ?? WEEKLY_METRICS[0]!;
}

/** What people asked for most this month, by channel: long category names for horizontal bars. */
const ASK_ROWS: ReadonlyArray<{ label: SpecimenCopy; web: number; whatsapp: number; slack: number }> = [
  { label: { en: 'A weekly summary of everything that landed in the inbox', fr: 'Un résumé hebdomadaire de tout ce qui est arrivé dans la boîte de réception' }, web: 1240, whatsapp: 2310, slack: 412 },
  { label: { en: 'Reminders before meetings', fr: 'Des rappels avant les réunions' }, web: 860, whatsapp: 1975, slack: 233 },
  { label: { en: 'Notes', fr: 'Notes' }, web: 410, whatsapp: 96, slack: 0 },
  { label: { en: 'Drafting replies to customers', fr: 'Rédiger les réponses aux clients' }, web: 1530, whatsapp: 388, slack: 1104 },
];

/** ASK_ROWS in `lang`, one row per category. */
export function askRows(lang: SpecimenLang): Array<{ key: string; label: string; web: number; whatsapp: number; slack: number }> {
  return ASK_ROWS.map((row, i) => ({ key: `ask-${i}`, label: row.label[lang], web: row.web, whatsapp: row.whatsapp, slack: row.slack }));
}
