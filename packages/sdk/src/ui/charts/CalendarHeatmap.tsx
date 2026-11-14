/**
 * CalendarHeatmap: one small cell per day, coloured by its value, weeks as columns and the seven weekdays as rows,
 * month names on top and Mon, Wed, Fri on the left (a GitHub-style contribution grid). It fits its container: cells
 * shrink to 10px, then the grid scrolls sideways inside itself with the latest week in view.
 *
 * A grid (role="grid"): the arrows move a day (up and down) or a week (left and right), Home and End go to the first
 * and last day, and each cell says its value and day ("3 on Mon, Jun 15", with the year for a day of another year
 * than today's), the same words as its tooltip. With `onSelect` the cells are buttons. The days with data also go to a hidden
 * data table (RenderChartData) for view Markdown.
 */

import * as React from 'react';
import { startOfDay } from 'date-fns';
import { fillWords, pick, type Locale, type Words } from '../../words/types';
import type { Tone } from '../list/Row';
import { Tooltip } from '../overlay/Tooltip';
import { dateFormat, formatValue, weekdayNames } from '../period/dateFormat';
import { CHART_WORDS, HEATMAP_WORDS, PERIOD_WORDS } from '../period/dateWords';
import { fromIsoDay } from '../period/periods';
import { useDateLocale } from '../period/useDateLocale';
import { useCursorFocus } from '../period/viewHelpers';
import { cx, flag, useIsoLayoutEffect, useLatest } from '../util';
import { dayKey } from '../calendar/calendarMath';
import {
  bucketDays, heatmapAlpha, heatmapDayLabel, heatmapLevel, heatmapMonths, heatmapRange, heatmapScale, heatmapWeeks,
  type HeatmapDay,
} from './heatmapData';
import { RenderChartData } from './RenderChartData';

/** The day a cell stands for, given to `onSelect`. */
export type CalendarHeatmapDay = HeatmapDay;

export interface CalendarHeatmapProps {
  /** One row per dated value (or per entry with `valueKey={null}`). Rows on the same day add up. */
  data: readonly object[];
  /** Field with the row's day: a Date, an ISO day ("2026-06-15"), an ISO time or a timestamp. Default `date`. */
  dateKey?: string;
  /** Field with the row's number. Default `value`. Null counts the rows instead (each dated row is 1). */
  valueKey?: string | null;
  /** First day drawn. Default the first of the month eleven months before `to` (the "Last 12 months" period). */
  from?: Date | string | number;
  /** Last day drawn. Default today. Days after it are not drawn. */
  to?: Date | string | number;
  /** A fixed clock for "today". */
  today?: Date;
  /**
   * The colour of a sequential scale: the first chart colour by default, or a toolkit tone (`success` for a goal kept,
   * `warning`, `danger`, `info`). Ignored by a diverging scale.
   */
  tone?: Tone;
  /**
   * `sequential` (default): from no colour to full colour as values grow. `diverging`: good to bad data around a
   * `midpoint` (a mood, a balance), success colours above it and danger colours below (swapped with
   * `higherIsBetter={false}`).
   */
  scale?: 'sequential' | 'diverging';
  /** The diverging scale's neutral value. Default the middle of `domain`, else 0. */
  midpoint?: number;
  /** Diverging only: false when lower is better (above the midpoint draws in danger colours). Default true. */
  higherIsBetter?: boolean;
  /**
   * A fixed value scale `[min, max]` (a mood from 1 to 5) instead of one that fits the data. With it every value takes
   * a colour, the minimum included; without it a value at or below zero draws empty.
   */
  domain?: readonly [number, number];
  /** Colour steps, the empty one included. Default 5 (2 to 9). */
  levels?: number;
  /** The value in the cell names, tooltips and data table. Default whole numbers (one decimal under 10). */
  format?: (value: number, locale: Locale) => string;
  /** Makes the cells buttons: a press, Enter or Space gives that day. */
  onSelect?: (day: CalendarHeatmapDay) => void;
  /** Accessible name of the grid and title of its data table. Default "Activity by day". */
  title?: Words | string;
  /** The Less ... More colour key under the grid. Default true. */
  legend?: boolean;
  /** The first day of a week column, 0 Sunday to 6 Saturday. Default 1, Monday. */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  locale?: Locale;
  className?: string;
}

const TONES: readonly Tone[] = ['default', 'info', 'success', 'warning', 'danger'];
/** The weekdays named on the left, as Date.getDay(): Monday, Wednesday, Friday. */
const NAMED_WEEKDAYS = new Set([1, 3, 5]);

interface CellProps {
  day: HeatmapDay;
  /** The week column, from 1, for assistive tech (a short first or last week leaves placeholders out). */
  column: number;
  label: string;
  level: number;
  alpha: number;
  /** A diverging scale's value at its midpoint: drawn a step darker than a day with no data. */
  neutral: boolean;
  tabbable: boolean;
  selectable: boolean;
  onFocusDay: (key: string) => void;
  onPick: (key: string) => void;
}

/** One day. Without `onSelect` the grid cell itself takes focus; with it, a button inside the cell does. */
const HeatCell = React.memo(function HeatCell({ day, column, label, level, alpha, neutral, tabbable, selectable, onFocusDay, onPick }: CellProps) {
  const look = {
    className: 'nui-heat-cell',
    'data-nav-id': day.key,
    'data-level': level === 0 ? undefined : Math.abs(level),
    'data-side': level < 0 ? 'down' : undefined,
    'data-empty': flag(day.value === null),
    'data-neutral': flag(neutral),
    'aria-label': label,
    tabIndex: tabbable ? 0 : -1,
    onFocus: () => onFocusDay(day.key),
    style: level === 0 ? undefined : ({ '--nui-heat-a': alpha } as React.CSSProperties),
  };
  if (!selectable) {
    return <Tooltip label={label}><div role="gridcell" aria-colindex={column} {...look} /></Tooltip>;
  }
  return (
    <div role="gridcell" aria-colindex={column} className="nui-heat-slot">
      <Tooltip label={label}><button type="button" {...look} onClick={() => onPick(day.key)} /></Tooltip>
    </div>
  );
});

/** A GitHub-style grid of days coloured by value, with a tooltip and a spoken name per day and a hidden data table. */
export function CalendarHeatmap({
  data, dateKey: dateField = 'date', valueKey = 'value', from, to, today: todayProp, tone, scale: scaleKind = 'sequential',
  midpoint, higherIsBetter = true, domain, levels, format: formatProp, onSelect, title, legend = true, weekStartsOn = 1,
  locale: localeProp, className,
}: CalendarHeatmapProps) {
  const locale = useDateLocale(localeProp);
  const t = (words: Words | string) => pick(words, locale);
  const format = formatProp ?? formatValue;
  const today = startOfDay(todayProp ?? new Date());
  const range = heatmapRange(from, to, today);
  const fromKey = dayKey(range.from);
  const toKey = dayKey(range.to);

  const byDay = React.useMemo(() => bucketDays(data, dateField, valueKey), [data, dateField, valueKey]);
  const weeks = React.useMemo(
    () => heatmapWeeks({ from: fromIsoDay(fromKey)!, to: fromIsoDay(toKey)! }, byDay, weekStartsOn),
    [byDay, fromKey, toKey, weekStartsOn],
  );
  const days = React.useMemo(() => weeks.flatMap((w) => w.days.filter((d): d is HeatmapDay => d !== null)), [weeks]);
  const scale = heatmapScale(days.flatMap((d) => (d.value === null ? [] : [d.value])),
    { kind: scaleKind, levels, domain, midpoint });
  // A day of another year than today's says its year, as day headings do.
  const thisYear = today.getFullYear();
  const titleText = t(title ?? HEATMAP_WORDS.title);
  // Names and table rows are built once per data, language and format, not on every arrow key.
  const { labels, tableRows, byKey, lastWithData } = React.useMemo(() => {
    const dayText = (day: HeatmapDay) => heatmapDayLabel(day.date, locale, day.date.getFullYear() !== thisYear);
    const names = new Map<string, string>();
    const rows: string[][] = [];
    for (const day of days) {
      const d = dayText(day);
      names.set(day.key, day.value === null ? pick(fillWords(HEATMAP_WORDS.noData, { d }), locale)
        : pick(fillWords(HEATMAP_WORDS.day, { v: format(day.value, locale), d }), locale));
      if (day.value !== null) rows.push([d, format(day.value, locale)]);
    }
    let last: string | null = null;
    for (let i = days.length - 1; i >= 0 && last === null; i -= 1) if (days[i]!.value !== null) last = days[i]!.key;
    return { labels: names, tableRows: rows, byKey: new Map(days.map((d) => [d.key, d])), lastWithData: last };
  }, [days, locale, format, thisYear]);

  // ---- cursor: one cell in the tab order, the arrows move it ----
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const roving = cursor !== null && cursor >= fromKey && cursor <= toKey ? cursor : lastWithData ?? toKey;
  const focusCursor = useCursorFocus(rootRef, cursor);
  const latest = useLatest({ roving, cursor, fromKey, toKey, byKey, onSelect });

  const onFocusDay = React.useCallback((key: string) => setCursor(key), []);
  const onPick = React.useCallback((key: string) => {
    const { byKey, onSelect: select } = latest.current;
    const day = byKey.get(key);
    setCursor(key);
    if (day && select) select(day);
  }, [latest]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const steps: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const { roving: current, cursor: was, fromKey: first, toKey: last } = latest.current;
    let next: string | null = null;
    if (Object.prototype.hasOwnProperty.call(steps, event.key)) {
      const at = fromIsoDay(current);
      if (!at) return;
      const moved = dayKey(new Date(at.getFullYear(), at.getMonth(), at.getDate() + steps[event.key]!));
      next = moved >= first && moved <= last ? moved : current;
    } else if (event.key === 'Home') next = first;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    setCursor(next);
    focusCursor(next, was);
  };

  // The latest week in view when the grid is wider than its box (a phone), again when the box changes width (a
  // hidden tab shown, a pane narrowed, a phone turned).
  useIsoLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const toEnd = () => { if (el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth; };
    toEnd();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) { width = el.clientWidth; toEnd(); }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fromKey, toKey, weeks.length]);

  const weekdays = weekdayNames(locale, 'narrow');
  const monthFmt = dateFormat(locale, { month: 'short' });
  const months = heatmapMonths(weeks);
  const levelOf = (value: number | null) => heatmapLevel(value, scale);
  const swatches = scale.kind === 'diverging'
    ? Array.from({ length: scale.levels * 2 - 1 }, (_, i) => i - (scale.levels - 1))
    : Array.from({ length: scale.levels }, (_, i) => i);


  return (
    <div ref={rootRef} className={cx('nui-heat', className)} data-notis-ui="" data-scale={scale.kind}
      data-tone={scale.kind === 'sequential' && tone && tone !== 'default' && TONES.includes(tone) ? tone : undefined}
      data-flip={flag(scale.kind === 'diverging' && !higherIsBetter)}>
      <div ref={scrollRef} className="nui-heat-scroll">
        <div className="nui-heat-body" style={{ '--nui-heat-weeks': weeks.length } as React.CSSProperties}>
          <div className="nui-heat-months" aria-hidden="true">
            {months.map(({ column, month }) => (
              <span key={column} className="nui-heat-month" style={{ gridColumn: column + 2 }}>
                {monthFmt.format(month).replace(/\.$/, '')}
              </span>
            ))}
          </div>
          <div role="grid" className="nui-heat-grid" aria-label={titleText} aria-rowcount={7} aria-colcount={weeks.length}
            onKeyDown={onKeyDown}>
            {Array.from({ length: 7 }, (_, row) => {
              const weekday = (weekStartsOn + row) % 7;
              return (
                <div key={row} role="row" className="nui-heat-row">
                  <span className="nui-heat-wd" aria-hidden="true">
                    {NAMED_WEEKDAYS.has(weekday) ? weekdays[(weekday + 6) % 7] : ''}
                  </span>
                  {weeks.map((week, column) => {
                    const day = week.days[row];
                    if (!day) return <div key={dayKey(week.start) + row} className="nui-heat-cell" data-out="" aria-hidden="true" />;
                    const level = levelOf(day.value);
                    return (
                      <HeatCell key={day.key} day={day} column={column + 1} label={labels.get(day.key) ?? ''} level={level}
                        alpha={heatmapAlpha(level, scale.levels)}
                        neutral={scale.kind === 'diverging' && day.value !== null && level === 0}
                        tabbable={day.key === roving} selectable={!!onSelect} onFocusDay={onFocusDay} onPick={onPick} />
                    );
                  })}
                </div>
              );
            })}
          </div>
          {legend && (
            <div className="nui-heat-legend" aria-hidden="true">
              <span>{t(HEATMAP_WORDS.less)}</span>
              {swatches.map((level) => (
                <span key={level} className="nui-heat-cell nui-heat-swatch"
                  data-level={level === 0 ? undefined : Math.abs(level)} data-side={level < 0 ? 'down' : undefined}
                  data-neutral={flag(level === 0 && scale.kind === 'diverging')}
                  style={level === 0 ? undefined : ({ '--nui-heat-a': heatmapAlpha(level, scale.levels) } as React.CSSProperties)} />
              ))}
              <span>{t(HEATMAP_WORDS.more)}</span>
            </div>
          )}
        </div>
      </div>
      <RenderChartData title={titleText} columns={[t(CHART_WORDS.date), t(PERIOD_WORDS.value)]} rows={tableRows} />
    </div>
  );
}
CalendarHeatmap.displayName = 'CalendarHeatmap';
