/**
 * ChartTable (toolkit spec 2.11, deck chart page alt b): the metrics of a chart page as a table under the chart.
 * Columns: Metric, Trend (a sparkline, 140), Value (112), then Previous (112) and Change (96) with a comparison. Trend
 * and Previous hide when the table is 760px or narrower. The deck table rules: 40px rows, a sticky 36px header, the
 * Metric cell 24px in and the last cell 24px from the right edge. A real table, so view Markdown reads it as one.
 */

import * as React from 'react';
import { pick, type Locale, type Words } from '../../words/types';
import { cx } from '../util';
import { CHART_WORDS, PERIOD_WORDS } from '../period/dateWords';
import type { CompareId } from '../period/periods';
import { useDateLocale } from '../period/useDateLocale';
import { sparkPaths } from './chartData';
import { hasSlot, metricView, type StatMetric } from './StatRow';

export interface SparklineProps {
  /** One value per point. A null (or NaN) is a gap: the line breaks there instead of dropping to zero. */
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  className?: string;
}

/** A small area plus line (72 by 24 by default), drawn in `--chart-1`. Decorative: hidden from assistive tech. */
export function Sparkline({ values, width = 72, height = 24, className }: SparklineProps) {
  const { line, area } = sparkPaths(values, width, height);
  return (
    <svg className={cx('nui-spark', className)} viewBox={`0 0 ${width} ${height}`} width={width} height={height}
      aria-hidden="true" focusable="false" preserveAspectRatio="none">
      {area && <path className="nui-spark-fill" d={area} />}
      {line && <path className="nui-spark-line" d={line} />}
    </svg>
  );
}

export interface ChartTableProps {
  metrics: readonly StatMetric[];
  /** Default `prev`; `none` drops the Previous and Change columns. */
  compare?: CompareId;
  /** Accessible name. Default "Key figures". */
  title?: Words | string;
  /** The highlighted metric (the one the chart above draws). */
  activeId?: string;
  /** Makes rows pressable: picks the metric the chart draws. */
  onSelect?: (metric: StatMetric) => void;
  locale?: Locale;
  className?: string;
}

/** The metrics of a chart page as a table: 40px rows, a sticky header, Trend and Previous hidden at 760px or less. */
export function ChartTable({ metrics, compare = 'prev', title, activeId, onSelect, locale: localeProp, className }:
  ChartTableProps) {
  const locale = useDateLocale(localeProp);
  const withCompare = compare !== 'none';
  const t = (words: Words | string) => pick(words, locale);
  return (
    <div className={cx('nui-ctable-wrap', className)} data-notis-ui="">
      <table className="nui-ctable" aria-label={t(title ?? CHART_WORDS.stats)} data-compare={withCompare ? '' : undefined}>
        <thead>
          <tr>
            <th scope="col" className="nui-ctable-metric">{t(CHART_WORDS.metric)}</th>
            <th scope="col" className="nui-ctable-trend">{t(CHART_WORDS.trend)}</th>
            <th scope="col" className="nui-ctable-num">{t(PERIOD_WORDS.value)}</th>
            {withCompare && <th scope="col" className="nui-ctable-num nui-ctable-prev">{t(PERIOD_WORDS.previous)}</th>}
            {withCompare && <th scope="col" className="nui-ctable-num nui-ctable-change">{t(CHART_WORDS.change)}</th>}
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => {
            const v = metricView(metric, compare, locale);
            const id = metric.id ?? v.key;
            return (
              <tr
                key={v.key}
                data-active={activeId != null && activeId === id ? '' : undefined}
                data-pressable={onSelect ? '' : undefined}
                onClick={onSelect ? () => onSelect(metric) : undefined}
              >
                <th scope="row" className="nui-ctable-metric">
                  {onSelect ? (
                    <button type="button" className="nui-ctable-pick" aria-pressed={activeId === id}
                      onClick={(e) => { e.stopPropagation(); onSelect(metric); }}>{v.label}</button>
                  ) : v.label}
                  {hasSlot(metric.about) && (
                    // Above the row's pick area; a press here is the about's own, never a pick of the row.
                    <span className="nui-ctable-about" onClick={(e) => e.stopPropagation()}>{metric.about}</span>
                  )}
                </th>
                <td className="nui-ctable-trend">{metric.spark?.length ? <Sparkline values={metric.spark} /> : null}</td>
                <td className="nui-ctable-num">{v.value}</td>
                {withCompare && <td className="nui-ctable-num nui-ctable-prev">{v.previous ?? ''}</td>}
                {withCompare && (
                  <td className="nui-ctable-num nui-ctable-change" data-tone={v.delta?.tone}>{v.delta?.text ?? ''}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
ChartTable.displayName = 'ChartTable';
