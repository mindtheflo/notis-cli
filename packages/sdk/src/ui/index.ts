/**
 * @notis/sdk/ui - the Notis toolkit.
 *
 * Host-provided: a Space bundle never contains this code. Its build
 * externalizes `@notis/sdk/ui` and the host shares its own instance as
 * `window.__NotisSDKUI` (see ../runtimeModules.ts). Toolkit modules append
 * their export lines below.
 */
export {};
export * from './layout';
export * from './engine';
export * from './keycap';
export * from './overlay';
export * from './list';
export * from './board';
export * from './actions';
export * from './open';
export * from './blocks';
export * from './gallery';
export { Icon, hasIcon, renderIcon } from './icons';
export { adoptToolkitStyles, getToolkitStyleSheet, getToolkitStyleText, registerToolkitStyles } from './styles';
// A3: dates and charts (toolkit spec 2.11). periods' own range type is exported as PeriodRange, so DateRange stays
// react-day-picker's (the type DayPicker's range mode selects).
export {
  COMPARES, DEFAULT_COMPARE, DEFAULT_PRESET, PRESETS, compareRange, customPeriod, dayCount, formatPeriodParam,
  fromIsoDay, isCompareId, isPresetId, normalizePeriod, parsePeriodParam, periodRanges, presetRange, samePeriod, toIsoDay,
} from './period/periods';
export type { CompareId, DateRange as PeriodRange, Period, PresetId } from './period/periods';
export {
  dayNumberLabel, formatDateRange, formatDayHeading, formatDelta, formatLongDay, formatMonthYear, formatNumber, formatShortDay,
  formatValue, intlLocale, weekdayNames,
} from './period/dateFormat';
export type { Delta, DeltaTone } from './period/dateFormat';
export {
  CALENDAR_WORDS, CHART_WORDS, COMPARE_WORDS, PERIOD_WORDS, PRESET_WORDS, TIMELINE_WORDS, VS_WORDS,
} from './period/dateWords';
export { usePeriod } from './period/usePeriod';
export type { UsePeriodOptions, UsePeriodResult } from './period/usePeriod';
export { PERIOD_PICKER_TWO_MONTHS_MIN, PeriodPicker } from './period/PeriodPicker';
export type { PeriodPickerProps } from './period/PeriodPicker';
export { DayPicker } from './calendar/DayPicker';
export type { DateRange, DayPickerProps, Matcher } from './calendar/DayPicker';
export { CALENDAR_NARROW_MAX, CALENDAR_TRAY_SIDE_MIN, CalendarView } from './calendar/CalendarView';
export type { CalendarItemVariant, CalendarViewProps } from './calendar/CalendarView';
export { CALENDAR_VIEWS } from './calendar/calendarMath';
export type { CalendarViewKind } from './calendar/calendarMath';
export { TIMELINE_ZOOMS, layoutTimeline, timelineWindow } from './timeline/timelineMath';
export type { TimelineLaneInfo, TimelineWindow, TimelineZoom } from './timeline/timelineMath';
export { TimelineView } from './timeline/TimelineView';
export type { TimelineViewProps } from './timeline/TimelineView';
export {
  Chart, ChartContainer, ChartLegend, ChartStyle, ChartTooltip, ChartTooltipContent, barLabel, barShape, seriesColor,
  useChart,
} from './charts/Chart';
export type {
  ChartConfig, ChartContainerProps, ChartKind, ChartLegendItem, ChartLegendProps, ChartProps, ChartSeries,
  ChartTooltipContentProps,
} from './charts/Chart';
export { buildBins, binUnit, periodSeries, sparkPaths, total } from './charts/chartData';
export type { Bin, BinUnit, DatedPoint, PeriodChartRow, PeriodSeriesInput } from './charts/chartData';
export { StatRow, metricView } from './charts/StatRow';
export type { StatMetric, StatRowProps } from './charts/StatRow';
export { ChartTable, Sparkline } from './charts/ChartTable';
export type { ChartTableProps, SparklineProps } from './charts/ChartTable';
export { RenderChartData } from './charts/RenderChartData';
export type { RenderChartDataProps } from './charts/RenderChartData';
// recharts primitives, shared so a Space draws with the host's one recharts. Tooltip is the overlay one; recharts'
// is ChartTooltip.
export {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart, Pie, PieChart,
  ReferenceDot, ReferenceLine, ResponsiveContainer, Scatter, XAxis, YAxis,
} from './charts/Chart';
// H-auto: editable fields (inline edit of facts, Save/Cancel, Cmd+Enter).
export * from './fields';
// E: comment pane, thread cards, pins and the Comments database controller.
export * from './comments';
// The second-screen presenter: slides full screen on the other screen, the presenter view stays here.
export * from './present';
