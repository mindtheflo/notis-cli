/**
 * StatRow (toolkit spec 2.11, deck chart page alt b, PG2): the key figures above a chart, as a full-width strip of
 * four equal cells (two when the strip is 640px or narrower). Each cell, 24px in and 16px tall padding, shows its
 * label, the value with its change, and the previous value with what it is compared to. No card, gap or rule between
 * cells; a strip right after a bar Section takes a hairline above and below (the toolkit's blocks rules).
 */

import * as React from 'react';
import { pick, type Locale, type Words } from '../../words/types';
import { cx } from '../util';
import { CHART_WORDS, VS_WORDS } from '../period/dateWords';
import { formatDelta, formatValue, type Delta } from '../period/dateFormat';
import type { CompareId } from '../period/periods';
import { useDateLocale } from '../period/useDateLocale';

/** One figure of a StatRow or a ChartTable row. */
export interface StatMetric {
  /** Stable key. Default the label. */
  id?: string;
  label: Words | string;
  /** This period. A string is shown as written (no change computed). */
  value: number | string;
  /** The comparison period's value. */
  previous?: number | null;
  /** Default whole numbers (one decimal under 10) in the locale. */
  format?: (value: number, locale: Locale) => string;
  /** False when a rise is bad (costs, errors): the change turns red. Default true. */
  higherIsBetter?: boolean;
  /** Replaces the second line ("1,020 previous period"). */
  hint?: Words | string;
  /** Values over the period, for the ChartTable trend column. A null is a gap in the sparkline. */
  spark?: readonly (number | null)[];
  /**
   * Beside the label, in StatRow and ChartTable: what the figure means, usually an info button that opens a popover
   * or a tooltip (the Space's own). In a pressable ChartTable row a press on it does not pick the row.
   */
  about?: React.ReactNode;
}

export interface StatRowProps {
  metrics: readonly StatMetric[];
  /** What `previous` is: names it on the second line. Default `prev`; `none` hides previous values and changes. */
  compare?: CompareId;
  locale?: Locale;
  className?: string;
}

export interface MetricView {
  key: string;
  label: string;
  value: string;
  previous: string | null;
  delta: Delta | null;
  sub: string | null;
}

/** "vs previous period" without its "vs ": "previous period" / "période précédente". */
export function vsTail(compare: CompareId, locale: Locale): string {
  if (compare === 'none') return '';
  return pick(VS_WORDS[compare], locale).replace(/^vs\s+/, '');
}

/** The texts of one metric cell, computed once for StatRow and ChartTable. Pure. */
export function metricView(metric: StatMetric, compare: CompareId, locale: Locale): MetricView {
  const format = (v: number) => (metric.format ? metric.format(v, locale) : formatValue(v, locale));
  const label = pick(metric.label, locale);
  const value = typeof metric.value === 'number' ? format(metric.value) : metric.value;
  const showPrev = compare !== 'none' && metric.previous != null && Number.isFinite(metric.previous);
  const previous = showPrev ? format(metric.previous as number) : null;
  const delta = showPrev && typeof metric.value === 'number'
    ? formatDelta(metric.value, metric.previous, locale, metric.higherIsBetter ?? true)
    : null;
  const sub = metric.hint != null ? pick(metric.hint, locale) : previous ? `${previous} ${vsTail(compare, locale)}` : null;
  return { key: metric.id ?? label, label, value, previous, delta, sub };
}

/** True when a slot holds something to draw. */
export function hasSlot(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** The key figures strip: four equal cells per line (two at 640px or narrower), full width, no frame. */
export function StatRow({ metrics, compare = 'prev', locale: localeProp, className }: StatRowProps) {
  const locale = useDateLocale(localeProp);
  return (
    <div className={cx('nui-stats', className)} data-notis-ui="" role="list" aria-label={pick(CHART_WORDS.stats, locale)}>
      {metrics.map((metric) => {
        const v = metricView(metric, compare, locale);
        return (
          <div key={v.key} className="nui-stat" role="listitem">
            <div className="nui-stat-head">
              <span className="nui-stat-label">{v.label}</span>
              {hasSlot(metric.about) && <span className="nui-stat-about">{metric.about}</span>}
            </div>
            <div className="nui-stat-main">
              <span className="nui-stat-value">{v.value}</span>
              {v.delta && <span className="nui-stat-delta" data-tone={v.delta.tone}>{v.delta.text}</span>}
            </div>
            {v.sub && <div className="nui-stat-sub">{v.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}
StatRow.displayName = 'StatRow';
