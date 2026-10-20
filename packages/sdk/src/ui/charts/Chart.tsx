/**
 * Charts (toolkit spec 2.11).
 *
 * The recharts wrapper the Portal used (`portal/src/components/ui/chart.tsx`: ChartContainer, ChartTooltip,
 * ChartTooltipContent, ChartLegend, ChartStyle), moved here and styled by `nui-chart-*` rules in toolkit.css instead
 * of Tailwind. The recharts primitives are re-exported so a host and a Space draw with the toolkit's one recharts
 * instance (two copies do not share their chart context).
 *
 * `Chart` is the ready piece: one period series as a line, bars or an area, the comparison as a dashed line, a
 * legend, tooltips in the toolkit locale, and its numbers in a hidden table for Markdown (RenderChartData). Bars and
 * areas can stack, and bars can run horizontally with their value after each bar.
 */

import * as React from 'react';
import {
  Area,
  Bar,
  BarStack,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Rectangle,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type LabelProps,
  type RenderableText,
  type TooltipContentProps,
  type XAxisTickContentProps,
} from 'recharts';
import { fillWords, pick, type Locale, type Words } from '../../words/types';
import { cx } from '../util';
import { COMPARE_WORDS, CHART_WORDS, PERIOD_WORDS } from '../period/dateWords';
import { formatNumber, formatValue } from '../period/dateFormat';
import type { CompareId } from '../period/periods';
import { useDateLocale } from '../period/useDateLocale';
import { useElementWidth } from '../period/viewHelpers';
import { axisWidth, textWidth, TICK_INSET, valueMargin, wrapLabel } from './axisLabels';
import { chartMax, edgeAnchor, endsToday, showAxisLabel } from './chartData';
import { RenderChartData } from './RenderChartData';

export {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ---- the moved wrapper ----

const THEMES = { light: '', dark: '.dark' } as const;

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  );
};

interface ChartContextValue {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextValue | null>(null);

export function useChart(): ChartContextValue {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error('useChart must be used within a <ChartContainer />');
  return context;
}

const NO_CONFIG: ChartConfig = {};

/** The nearest ChartContainer's config, or none: the tooltip box and the legend also draw outside a container. */
function useChartConfig(): ChartConfig {
  return React.useContext(ChartContext)?.config ?? NO_CONFIG;
}

export type ChartContainerProps = React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof ResponsiveContainer>['children'];
  /**
   * Width over height of the box. Default 16 / 9; `'auto'` drops the ratio, so the box takes the height its parent,
   * `height` or `style` gives it.
   */
  aspect?: number | 'auto';
  /** A fixed height (px, or any CSS length). It drops the default ratio unless `aspect` is also given. */
  height?: number | string;
};

/** Sizes a recharts chart to its box and defines `--color-<key>` for each configured series. */
export const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ id, className, children, config, aspect, height, style, ...props }, ref) => {
    const uniqueId = React.useId();
    const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`;
    const box: React.CSSProperties = {
      ...(height != null ? { height, aspectRatio: 'auto' } : {}),
      ...(aspect != null ? { aspectRatio: aspect === 'auto' ? 'auto' : String(aspect) } : {}),
      ...style,
    };
    return (
      <ChartContext.Provider value={{ config }}>
        <div data-chart={chartId} data-notis-ui="" ref={ref} className={cx('nui-chart-container', className)}
          style={Object.keys(box).length ? box : undefined} {...props}>
          <ChartStyle id={chartId} config={config} />
          <ResponsiveContainer>{children}</ResponsiveContainer>
        </div>
      </ChartContext.Provider>
    );
  },
);
ChartContainer.displayName = 'Chart';

export function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, item]) => item.theme || item.color);
  if (!colorConfig.length) return null;
  const css = Object.entries(THEMES)
    .map(([theme, prefix]) => {
      const lines = colorConfig
        .map(([key, item]) => {
          const color = item.theme?.[theme as keyof typeof item.theme] || item.color;
          return color ? `  --color-${key}: ${color};` : null;
        })
        .filter(Boolean)
        .join('\n');
      return `${prefix} [data-chart=${id}] {\n${lines}\n}\n`;
    })
    .join('');
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

/**
 * recharts' own Tooltip (the same component, not a wrapper): pass `content`, such as a ChartTooltipContent or your
 * own box. recharts drops series without a value at the point; `filterNull={false}` keeps them, and
 * ChartTooltipContent shows them as "No data".
 */
export const ChartTooltip = Tooltip;

type TooltipItem = NonNullable<TooltipContentProps['payload']>[number];

export type ChartTooltipContentProps = Partial<TooltipContentProps> & {
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: 'line' | 'dot' | 'dashed';
  nameKey?: string;
  labelKey?: string;
  labelClassName?: string;
  color?: string;
  /** Formats each value. Default: a number in the locale ("1,240" / "1 240"), a string as written. */
  valueFormatter?: (value: number | string, item: TooltipItem) => React.ReactNode;
  /** Language of the default number format and of "No data". Default the toolkit locale. */
  locale?: Locale;
};

function payloadConfig(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const inner = 'payload' in payload && typeof (payload as { payload?: unknown }).payload === 'object'
    ? (payload as { payload?: Record<string, unknown> }).payload ?? undefined
    : undefined;
  if (key in config || (inner && key in inner)) return config[key];
  return config[key];
}

function itemValue(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value) && (typeof value[0] === 'number' || typeof value[0] === 'string')) return value[0];
  return null;
}

/**
 * The tooltip box: a label line, then one row per series with its indicator, name and value. A series without a
 * value at the point shows "No data" (it reaches the box when the Tooltip has `filterNull={false}`). Works inside a
 * ChartContainer (names and colours from its config) or alone.
 */
export const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  (
    {
      active,
      payload,
      className,
      indicator = 'dot',
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey,
      valueFormatter,
      locale,
    },
    ref,
  ) => {
    const config = useChartConfig();
    const loc = useDateLocale(locale);
    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) return null;
      const [item] = payload;
      const key = `${labelKey || item?.dataKey || item?.name || 'value'}`;
      const itemConfig = payloadConfig(config, item, key);
      const value = !labelKey && typeof label === 'string'
        ? config[label as keyof typeof config]?.label || label
        : itemConfig?.label;
      const text = labelFormatter ? labelFormatter(label, payload) : value;
      return text == null || text === '' ? null : <div className={cx('nui-chart-tip-label', labelClassName)}>{text}</div>;
    }, [label, labelFormatter, payload, hideLabel, labelKey, labelClassName, config]);

    if (!active || !payload?.length) return null;
    return (
      <div ref={ref} className={cx('nui-chart-tip', className)} data-notis-ui="">
        {tooltipLabel}
        <div className="nui-chart-tip-rows">
          {payload.map((item, index) => {
            const key = `${nameKey || item.name || item.dataKey || 'value'}`;
            const itemConfig = payloadConfig(config, item, key);
            const indicatorColor = color || (item.payload as { fill?: string } | undefined)?.fill || item.color;
            const value = itemValue(item.value);
            if (formatter && item.value != null && item.name) {
              return (
                <div key={String(item.dataKey ?? index)} className="nui-chart-tip-row">
                  {formatter(item.value, item.name, item, index, payload)}
                </div>
              );
            }
            const Icon = itemConfig?.icon;
            return (
              <div key={String(item.dataKey ?? index)} className="nui-chart-tip-row">
                {Icon ? <Icon /> : !hideIndicator && (
                  <span
                    className="nui-chart-tip-ind"
                    data-indicator={indicator}
                    style={{ '--nui-chart-ind': indicatorColor } as React.CSSProperties}
                    aria-hidden="true"
                  />
                )}
                <span className="nui-chart-tip-name">{itemConfig?.label || item.name}</span>
                {value != null ? (
                  <span className="nui-chart-tip-value">
                    {valueFormatter ? valueFormatter(value, item) : typeof value === 'number' ? formatNumber(value, loc) : value}
                  </span>
                ) : (
                  <span className="nui-chart-tip-value" data-empty="">{pick(CHART_WORDS.noValue, loc)}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
ChartTooltipContent.displayName = 'ChartTooltipContent';

/**
 * One legend entry: an item of recharts' legend payload, or your own for a legend drawn outside a chart (a hand-made
 * chart, a Scatter, a key shared by several charts).
 */
export interface ChartLegendItem {
  /** The series key: its label and colour come from the config. */
  dataKey?: unknown;
  /** The label when the config has none for the key (recharts puts the series name here). */
  value?: React.ReactNode;
  /** Any CSS colour. Default the config colour, else `var(--color-<key>)` (defined inside a ChartContainer only). */
  color?: string;
  /** How the key is drawn. Default a square, or a dashed line for a dashed series. */
  shape?: 'square' | 'circle' | 'line' | 'dashed';
  /** A dashed series, such as a comparison: drawn as a dashed line. */
  dashed?: boolean;
  /** recharts' legend type: `none` (a series with `legendType="none"`) leaves the entry out. */
  type?: string;
  /** recharts' series props: a `strokeDasharray` draws the key dashed. */
  payload?: unknown;
}

export type ChartLegendProps = React.ComponentProps<'div'> & {
  hideIcon?: boolean;
  /** The entries: recharts' Legend `payload`, or ChartLegendItem objects of your own. */
  payload?: readonly unknown[];
  verticalAlign?: 'top' | 'bottom';
  nameKey?: string;
  /** Labels, colours and icons by key. Default the ChartContainer's config; give it for a legend outside one. */
  config?: ChartConfig;
};

function legendShape(item: ChartLegendItem): NonNullable<ChartLegendItem['shape']> {
  if (item.shape) return item.shape;
  const dash = typeof item.payload === 'object' && item.payload !== null
    ? (item.payload as { strokeDasharray?: unknown }).strokeDasharray
    : undefined;
  return item.dashed || (dash != null && dash !== '' && dash !== 0 && dash !== '0') ? 'dashed' : 'square';
}

/**
 * The legend: a key (square, circle, line or dashed line) and a label per series. Inside a ChartContainer, as a
 * recharts `<Legend content>`, or alone with `config` and ChartLegendItem entries.
 */
export const ChartLegend = React.forwardRef<HTMLDivElement, ChartLegendProps>(
  ({ className, hideIcon = false, payload, nameKey, verticalAlign: _align, config: configProp, ...props }, ref) => {
    const contextConfig = useChartConfig();
    const config = configProp ?? contextConfig;
    const items = (payload ?? []).filter((item): item is ChartLegendItem =>
      typeof item === 'object' && item !== null && (item as ChartLegendItem).type !== 'none');
    if (!items.length) return null;
    return (
      <div ref={ref} className={cx('nui-chart-legend', className)} {...props}>
        {items.map((item, index) => {
          const dataKey = typeof item.dataKey === 'string' || typeof item.dataKey === 'number' ? String(item.dataKey) : '';
          const key = `${nameKey || dataKey || 'value'}`;
          const itemConfig = payloadConfig(config, item, key);
          const Icon = itemConfig?.icon;
          const colour = item.color ?? itemConfig?.color ?? (dataKey ? `var(--color-${dataKey})` : undefined);
          const shape = legendShape(item);
          const label = itemConfig?.label ?? item.value;
          return (
            <span key={dataKey || (typeof item.value === 'string' ? item.value : index)} className="nui-chart-legend-item">
              {Icon && !hideIcon ? <Icon /> : shape === 'line' ? (
                <span className="nui-chart-key" style={{ background: colour }} aria-hidden="true" />
              ) : shape === 'dashed' ? (
                <span className="nui-chart-key" data-dashed="" style={{ borderTopColor: colour }} aria-hidden="true" />
              ) : (
                <span className="nui-chart-swatch" data-shape={shape === 'circle' ? 'circle' : undefined}
                  style={{ backgroundColor: colour }} aria-hidden="true" />
              )}
              {label}
            </span>
          );
        })}
      </div>
    );
  },
);
ChartLegend.displayName = 'ChartLegend';

/**
 * A bar shape that keeps zero-size bars, so their labels still draw (recharts drops a zero bar, and its label, unless
 * the Bar has a shape of its own). Draws the bar as recharts does. `<Bar shape={barShape} label={...} />`.
 */
export function barShape(props: BarShapeProps): React.ReactElement {
  return <Rectangle {...props} />;
}

/**
 * A bar's value label, zero bars included: after the end of a horizontal bar, or above a vertical one with
 * `position: 'top'`. Pair it with `shape={barShape}` (zero bars keep their place) and give `formatter` for the
 * number text. Made for values of 0 and up.
 * `<Bar shape={barShape} label={{ content: barLabel, position: 'right', formatter: (v) => format(v) }} />`
 */
export function barLabel(props: LabelProps): React.ReactElement | null {
  const { viewBox, value, offset = 5, position, formatter, className } = props;
  const box = viewBox as { x?: number; y?: number; width?: number; height?: number } | undefined;
  if (!box || value == null || value === '') return null;
  const text = formatter ? formatter(value) : value;
  if (text == null || text === '' || text === false) return null;
  const { x = 0, y = 0, width = 0, height = 0 } = box;
  const top = position === 'top';
  return (
    <text
      className={cx('nui-chart-bar-label', className)}
      x={top ? x + width / 2 : Math.max(x, x + width) + offset}
      y={top ? Math.min(y, y + height) - offset : y + height / 2}
      textAnchor={top ? 'middle' : 'start'}
      dominantBaseline={top ? 'auto' : 'central'}
    >
      {String(text)}
    </text>
  );
}

// ---- the Chart piece ----

export type ChartKind = 'line' | 'bar' | 'area';

export interface ChartSeries {
  /** Field of each row holding the value. */
  key: string;
  label: Words | string;
  /** Any CSS colour. Default the chart tokens in order (`--chart-1`, `--chart-2`...). */
  color?: string;
}

export interface ChartProps {
  kind: ChartKind;
  /** One row per point, such as `periodSeries()` rows. */
  data: readonly object[];
  /** The series drawn. Default `{ key: 'value', label: 'This period' }`. */
  series?: ChartSeries | readonly ChartSeries[];
  /**
   * The comparison, drawn as a dashed line. A CompareId reads the `compare` field and names it ("Previous period");
   * a series names its own field. Omitted or `none`: no comparison.
   */
  compare?: CompareId | ChartSeries | false | null;
  /** Unique field per row for the x axis. Default `key` when rows have it, else `label`. */
  xKey?: string;
  /** Field with the short axis label. Default `label`. */
  labelKey?: string;
  /** Field with the full point name in tooltips and the data table. Default `range`, else the axis label. */
  nameKey?: string;
  /** Accessible name of the chart and title of its data table. */
  title?: Words | string;
  /**
   * Height in px. Default 140 for bars and 200 for a line or an area (deck PG3), or one row per point for horizontal
   * bars (32px, or 14px a series plus 12 when several series sit side by side). A chart that switches kind passes one
   * height, so the switch never moves the page.
   */
  height?: number;
  /** Bars or areas stack, and the value axis fits each point's total. Lines ignore it. */
  stacked?: boolean;
  /**
   * Bars run left to right, one row per point: its label before the bar on at most two lines, its value after (the
   * total when stacked). Only for `kind="bar"`; draws no comparison.
   */
  horizontal?: boolean;
  /** Value text in tooltips and the data table. Default whole numbers (one decimal under 10). */
  format?: (value: number, locale: Locale) => string;
  /** The short value after each horizontal bar (or stack), such as "1.2k" beside an exact tooltip. Default `format`. */
  labelFormat?: (value: number, locale: Locale) => string;
  /**
   * The last point is still filling (the range ends today): its bar is drawn full colour, the others lighter until
   * hovered (deck period-r6). Default: true when the last row's `to` is today.
   */
  live?: boolean;
  locale?: Locale;
  className?: string;
}

const SERIES_COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))',
  'hsl(var(--chart-5))'];
const COMPARE_COLOR = 'hsl(var(--muted-foreground) / .7)';
/** The plot margin. The value axis is hidden, so a line's first and last points sit `left` and `right` in. */
const PLOT_MARGIN = { top: 8, right: 4, bottom: 0, left: 4 };
/** Horizontal bars: the height of a row, and per series side by side. */
const ROW_HEIGHT = 32;
const SERIES_ROW = 14;
/** Default plot heights (deck PG3): vertical bars, then a line or an area. */
const BAR_HEIGHT = 140;
const PLOT_HEIGHT = 200;

/**
 * The font the plot's text is set in (`sans-serif` before the first read), and a count that steps once web fonts arrive
 * so labels measured in the fallback font are measured again.
 */
function useFontFamily(ref: React.RefObject<HTMLElement | null>, active: boolean): { family: string; fonts: number } {
  const [font, setFont] = React.useState({ family: 'sans-serif', fonts: 0 });
  React.useEffect(() => {
    const node = ref.current;
    if (!active || !node || typeof getComputedStyle === 'undefined') return undefined;
    let live = true;
    const read = (arrived: boolean) => {
      if (!live) return;
      const family = getComputedStyle(node).fontFamily || 'sans-serif';
      setFont((f) => (!arrived && f.family === family ? f : { family, fonts: f.fonts + (arrived ? 1 : 0) }));
    };
    read(false);
    void document.fonts?.ready.then(() => read(true));
    return () => { live = false; };
  }, [ref, active]);
  return font;
}

function field(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asSeriesList(series: ChartProps['series']): ChartSeries[] {
  if (!series) return [{ key: 'value', label: PERIOD_WORDS.thisPeriod }];
  return Array.isArray(series) ? [...series] : [series as ChartSeries];
}

function asCompare(compare: ChartProps['compare']): ChartSeries | null {
  if (!compare || compare === 'none') return null;
  if (typeof compare === 'string') return { key: 'compare', label: COMPARE_WORDS[compare] };
  return compare;
}

/** The colour series `i` is drawn with. */
export function seriesColor(series: ChartSeries, index: number): string {
  return series.color ?? SERIES_COLORS[index % SERIES_COLORS.length]!;
}

/** A stacked point's total: its series values of 0 and up added (a missing value counts 0). */
function rowTotal(row: object, series: readonly ChartSeries[]): number {
  return series.reduce((sum, s) => sum + Math.max(0, numberOf(field(row, s.key)) ?? 0), 0);
}

/** The hidden table of a chart: one row per point, the point name then each series value. */
export function chartTableRows(
  data: readonly object[],
  series: readonly ChartSeries[],
  compare: ChartSeries | null,
  nameOf: (row: object) => string,
  format: (value: number) => string,
): Array<Array<string | null>> {
  return data.map((row) => {
    const values = series.map((s) => {
      const v = numberOf(field(row, s.key));
      return v == null ? null : format(v);
    });
    if (compare) {
      const v = numberOf(field(row, compare.key));
      values.push(v == null ? null : format(v));
    }
    return [nameOf(row), ...values];
  });
}

/** A period chart (bars, a line or an area) with an optional dashed comparison; 140px bars or a 200px plot by default. */
export function Chart({
  kind,
  data,
  series: seriesProp,
  compare: compareProp,
  xKey: xKeyProp,
  labelKey = 'label',
  nameKey: nameKeyProp,
  title,
  height: heightProp,
  stacked = false,
  horizontal: horizontalProp = false,
  format: formatProp,
  labelFormat: labelFormatProp,
  live: liveProp,
  locale: localeProp,
  className,
}: ChartProps) {
  const locale = useDateLocale(localeProp);
  const horizontal = horizontalProp && kind === 'bar';
  const stack = stacked && kind !== 'line';
  const series = React.useMemo(() => asSeriesList(seriesProp), [seriesProp]);
  const compare = React.useMemo(() => (horizontal ? null : asCompare(compareProp)), [compareProp, horizontal]);
  const [hover, setHover] = React.useState<number | null>(null);
  const plotRef = React.useRef<HTMLDivElement>(null);
  const plotWidth = useElementWidth(plotRef);

  const first = data[0];
  const xKey = xKeyProp ?? (first && field(first, 'key') != null ? 'key' : labelKey);
  const nameKey = nameKeyProp ?? (first && field(first, 'range') != null ? 'range' : labelKey);
  const format = React.useCallback((v: number) => (formatProp ? formatProp(v, locale) : formatValue(v, locale)),
    [formatProp, locale]);
  const nameOf = React.useCallback((row: object) => String(field(row, nameKey) ?? field(row, labelKey) ?? ''),
    [nameKey, labelKey]);
  const labelOf = React.useMemo(() => {
    const map = new Map<unknown, string>();
    for (const row of data) map.set(field(row, xKey), String(field(row, labelKey) ?? field(row, xKey) ?? ''));
    return map;
  }, [data, xKey, labelKey]);

  const last = data[data.length - 1];
  const lastTo = last ? field(last, 'to') : undefined;
  const live = liveProp ?? (lastTo instanceof Date ? endsToday({ from: lastTo, to: lastTo }) : false);

  const max = React.useMemo(() => {
    const values: Array<number | null> = [];
    for (const row of data) {
      if (stack) values.push(rowTotal(row, series));
      else for (const s of series) values.push(numberOf(field(row, s.key)));
      if (compare) values.push(numberOf(field(row, compare.key)));
    }
    // Horizontal bars keep their value labels in the right margin, so the longest bar takes the whole width.
    return horizontal ? values.reduce<number>((top, v) => (v != null && v > top ? v : top), 1) : chartMax(values);
  }, [data, series, compare, stack, horizontal]);
  const shortValue = React.useCallback(
    (v: number) => (labelFormatProp ? labelFormatProp(v, locale) : format(v)), [labelFormatProp, locale, format]);
  // Horizontal bars measure their labels in the plot's font: the categories before the bars on two lines, and the
  // longest value label after a full-width bar.
  const { family, fonts } = useFontFamily(plotRef, horizontal);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `fonts` steps when web fonts arrive: measure again.
  const measure = React.useCallback((line: string) => textWidth(line, family), [family, fonts]);
  const axis = React.useMemo(
    () => (horizontal ? axisWidth([...labelOf.values()], plotWidth, measure) : 0), [horizontal, labelOf, plotWidth, measure]);
  const labelRoom = React.useMemo(() => {
    const labels: string[] = [];
    if (horizontal) {
      for (const row of data) {
        const values = stack ? [rowTotal(row, series)] : series.map((s) => numberOf(field(row, s.key)));
        for (const v of values) if (v != null) labels.push(shortValue(v));
      }
    }
    return valueMargin(labels, measure);
  }, [horizontal, data, stack, series, shortValue, measure]);
  const labelText = React.useCallback((v: RenderableText) => (typeof v === 'number' ? shortValue(v) : v), [shortValue]);
  const axisLabel = React.useCallback((value: unknown) => labelOf.get(value) ?? String(value ?? ''), [labelOf]);
  const categoryTick = React.useCallback((props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => {
    const lines = wrapLabel(axisLabel(props.payload?.value), (line) => measure(line) <= axis - TICK_INSET);
    return (
      <text x={props.x} y={props.y} textAnchor="end" dominantBaseline="central" className="recharts-cartesian-axis-tick-value">
        {lines.map((line, i) => (
          <tspan key={i} x={props.x} dy={i === 0 ? (lines.length > 1 ? '-0.6em' : 0) : '1.2em'}>{line}</tspan>
        ))}
      </text>
    );
  }, [axisLabel, measure, axis]);
  // Several series side by side in a horizontal row: a 12px bar each, 2px apart, the row 6px from the next.
  const sideBySide = horizontal && !stack && series.length > 1;
  const row = sideBySide ? Math.max(ROW_HEIGHT, series.length * SERIES_ROW + 12) : ROW_HEIGHT;
  const height = heightProp ?? (horizontal ? data.length * row + 8 : kind === 'bar' ? BAR_HEIGHT : PLOT_HEIGHT);

  // A line or an area runs edge to edge: its labels thin out with the room between points, and the edge ones anchor
  // inward. Bars keep one centred label per labelled bar.
  const spacing = kind !== 'bar' && data.length > 1
    ? (plotWidth - PLOT_MARGIN.left - PLOT_MARGIN.right) / (data.length - 1)
    : undefined;
  const ticks = React.useMemo(
    () => data.map((row, i) => (showAxisLabel(i, data.length, spacing) ? field(row, xKey) : undefined)).filter((v) => v !== undefined),
    [data, xKey, spacing],
  );
  const edgeTick = React.useCallback((props: XAxisTickContentProps) => {
    const value = props.payload?.value;
    const right = typeof props.width === 'number' ? PLOT_MARGIN.left + props.width : plotWidth - PLOT_MARGIN.right;
    return (
      <Text {...props} textAnchor={edgeAnchor(Number(props.x), PLOT_MARGIN.left, right)}>
        {props.tickFormatter ? props.tickFormatter(value, props.index) : String(value ?? '')}
      </Text>
    );
  }, [plotWidth]);

  const config = React.useMemo<ChartConfig>(() => {
    const out: ChartConfig = {};
    series.forEach((s, i) => { out[s.key] = { label: pick(s.label, locale), color: seriesColor(s, i) }; });
    if (compare) out[compare.key] = { label: pick(compare.label, locale), color: compare.color ?? COMPARE_COLOR };
    return out;
  }, [series, compare, locale]);

  const titleText = title ? pick(title, locale) : pick(series[0]!.label, locale);
  const columns = [pick(CHART_WORDS.date, locale), ...series.map((s) => pick(s.label, locale)),
    ...(compare ? [pick(compare.label, locale)] : [])];
  const rows = chartTableRows(data, series, compare, nameOf, format);
  const showLegend = !!compare || series.length > 1;
  const single = series.length === 1;

  const onMove = (state: { activeTooltipIndex?: number | string | null } | undefined) => {
    const raw = state?.activeTooltipIndex;
    const index = raw == null ? null : Number(raw);
    setHover(index == null || Number.isNaN(index) ? null : index);
  };

  // Horizontal bars carry their value after the bar (the stack total on the last series), zero bars included.
  const bars = kind === 'bar' ? series.map((s, i) => (
    <Bar key={s.key} dataKey={s.key} name={pick(s.label, locale)} fill={`var(--color-${s.key})`} maxBarSize={sideBySide ? 12 : 28}
      radius={stack ? undefined : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} isAnimationActive={false}
      {...(horizontal ? { shape: barShape } : {})}
      {...(horizontal && (!stack || i === series.length - 1)
        ? { label: { content: barLabel, position: 'right' as const, formatter: labelText } }
        : {})}>
      {single && !horizontal && data.map((row, index) => {
        const full = hover === index || (live && index === data.length - 1);
        return <Cell key={String(field(row, xKey) ?? index)} fillOpacity={full ? 1 : 0.55} />;
      })}
    </Bar>
  )) : null;

  return (
    <div className={cx('nui-chart', className)} data-notis-ui="" data-kind={kind}>
      <div ref={plotRef} className="nui-chart-plot" role="img" aria-label={titleText} style={{ height }}>
        <ChartContainer config={config} className="nui-chart-box">
          <ComposedChart
            data={data as object[]}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={horizontal ? { top: 4, right: labelRoom + PLOT_MARGIN.right, bottom: 4, left: 0 } : PLOT_MARGIN}
            barCategoryGap={sideBySide ? 6 : '38%'}
            barGap={sideBySide ? 2 : 4}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            accessibilityLayer={false}
          >
            {!horizontal && <CartesianGrid vertical={false} stroke="hsl(var(--foreground) / .07)" />}
            {horizontal && <XAxis type="number" hide domain={[0, max]} />}
            {horizontal && (
              <YAxis type="category" dataKey={xKey} width={axis} interval={0} tickLine={false} axisLine={false}
                tickMargin={8} tick={categoryTick} />
            )}
            {!horizontal && <YAxis hide domain={[0, max]} ticks={[0.25, 0.5, 0.75, 1].map((f) => f * max)} />}
            {!horizontal && (
              <XAxis
                dataKey={xKey}
                ticks={ticks as Array<string | number>}
                interval={0}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={0}
                tickFormatter={axisLabel}
                {...(kind === 'bar' ? {} : { tick: edgeTick })}
              />
            )}
            <Tooltip
              cursor={kind === 'bar' ? false : { stroke: 'hsl(var(--border))' }}
              isAnimationActive={false}
              filterNull={false}
              content={(props) => (
                <ChartTooltipContent
                  {...(props as Partial<TooltipContentProps>)}
                  labelFormatter={(_label, payload) => {
                    const row = payload?.[0]?.payload as object | undefined;
                    return row ? nameOf(row) : '';
                  }}
                  indicator={compare ? 'line' : 'dot'}
                  valueFormatter={(v) => (typeof v === 'number' ? format(v) : v)}
                  locale={locale}
                />
              )}
            />
            {bars && stack && <BarStack radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}>{bars}</BarStack>}
            {bars && !stack && bars}
            {kind !== 'bar' && series.map((s) => {
              const colour = `var(--color-${s.key})`;
              if (kind === 'area') {
                return (
                  <Area key={s.key} dataKey={s.key} name={pick(s.label, locale)} type="linear" stroke={colour}
                    strokeWidth={2} fill={colour} fillOpacity={0.12} dot={false} activeDot={{ r: 3 }}
                    isAnimationActive={false} {...(stack ? { stackId: 'stack' } : {})} />
                );
              }
              return (
                <Line key={s.key} dataKey={s.key} name={pick(s.label, locale)} type="linear" stroke={colour}
                  strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
              );
            })}
            {compare && (
              <Line dataKey={compare.key} name={pick(compare.label, locale)} type="linear"
                stroke={`var(--color-${compare.key})`} strokeWidth={1.5} strokeDasharray="4 4" dot={false}
                activeDot={false} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ChartContainer>
        <RenderChartData title={titleText} columns={columns} rows={rows} />
      </div>
      {showLegend && (
        <div className="nui-chart-legend" data-placement="below">
          {series.map((s, i) => (
            <span key={s.key} className="nui-chart-legend-item">
              <span className="nui-chart-key" style={{ background: seriesColor(s, i) }} aria-hidden="true" />
              {pick(s.label, locale)}
            </span>
          ))}
          {compare && (
            <span className="nui-chart-legend-item">
              <span className="nui-chart-key" data-dashed="" aria-hidden="true" />
              {pick(compare.label, locale)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
Chart.displayName = 'Chart';

/** "1,240 on Jan 5" / "1 240 le 5 janv.", for a Space's own tooltips and summaries. */
export function chartPointText(value: string, name: string, locale: Locale, previous?: string | null): string {
  return previous
    ? pick(fillWords(CHART_WORDS.tipCompare, { v: value, d: name, c: previous }), locale)
    : pick(fillWords(CHART_WORDS.tip, { v: value, d: name }), locale);
}
