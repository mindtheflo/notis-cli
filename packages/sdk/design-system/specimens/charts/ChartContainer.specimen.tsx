import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ChartContainer,
  ChartLegend,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  barLabel,
  barShape,
  formatNumber,
  type ChartConfig,
} from '../../../src/ui/index';
import {
  CHANNEL_LABELS,
  channelShare,
  channelShareNoSlack,
  recentChannelRows,
  type ChannelRow,
} from '../../fixtures/charts/metrics';
import { Pad } from '../../fixtures/charts/parts';
import { hoverPlot } from '../../fixtures/charts/interact';

type Channel = 'web' | 'whatsapp' | 'slack';
const CHANNELS: readonly Channel[] = ['web', 'whatsapp', 'slack'];

const COPY = {
  target: { en: 'Target', fr: 'Objectif' },
  web: { en: 'Web app (signed-in browser sessions)', fr: 'App web (sessions de navigateur connectées)' },
  whatsapp: { en: 'WhatsApp (personal and business numbers)', fr: 'WhatsApp (numéros personnels et professionnels)' },
  slack: { en: 'Slack (workspaces with Notis installed)', fr: 'Slack (espaces de travail où Notis est installé)' },
  colorKey: { en: 'color key', fr: 'clé color' },
  themeKey: { en: 'theme key (light and dark)', fr: 'clé theme (clair et sombre)' },
  noData: { en: 'No messages in this period', fr: 'Aucun message sur cette période' },
} as const;

/** One colour per channel, from the chart tokens; Slack has its own light and dark colours. */
function channelConfig(lang: SpecimenLang, long = false): ChartConfig {
  return {
    web: { label: long ? COPY.web[lang] : CHANNEL_LABELS.web[lang], color: 'hsl(var(--chart-1))' },
    whatsapp: { label: long ? COPY.whatsapp[lang] : CHANNEL_LABELS.whatsapp[lang], color: 'hsl(var(--chart-2))' },
    slack: {
      label: long ? COPY.slack[lang] : CHANNEL_LABELS.slack[lang],
      theme: { light: 'hsl(262 60% 52%)', dark: 'hsl(262 80% 74%)' },
    },
  };
}

const number = (lang: SpecimenLang) => (value: number | string) =>
  typeof value === 'number' ? formatNumber(value, lang) : value;
/** A bar label's text: the number in the page language. */
const labelNumber = (lang: SpecimenLang) => (value: unknown) =>
  typeof value === 'number' ? formatNumber(value, lang) : value == null ? '' : String(value);
const compact = (lang: SpecimenLang) => (value: number) =>
  formatNumber(value, lang, { notation: 'compact', maximumFractionDigits: 1 });
/** The day's full name ("Tuesday, June 2") from the row under the pointer. */
const rowRange = (_label: unknown, payload: ReadonlyArray<{ payload?: unknown }> | undefined) =>
  String((payload?.[0]?.payload as ChannelRow | undefined)?.range ?? '');

/** A legend the toolkit draws, fed recharts' payload. */
function legend() {
  return (props: { payload?: readonly unknown[] }) => <ChartLegend payload={props.payload ? [...props.payload] : []} />;
}

/** A pie's legend: recharts keys each slice by its name, so the slice name becomes the config key. */
function pieLegend() {
  return (props: { payload?: ReadonlyArray<{ value?: string }> }) => (
    <ChartLegend payload={(props.payload ?? []).map((item) => ({ ...item, dataKey: item.value }))} />
  );
}

function Box({ height, children, className }: { height: number; children: React.ReactNode; className?: string }) {
  return <div className={className} style={{ height }}>{children}</div>;
}

const FILL = { aspectRatio: 'auto', height: '100%', width: '100%' } as const;

/** Bars, a line and an area in one chart, a target line, the toolkit tooltip and legend (the full kit). */
function Composed({ lang, height = 300 }: { lang: SpecimenLang; height?: number }) {
  const rows = recentChannelRows(lang);
  return (
    <Box height={height}>
      <ChartContainer config={channelConfig(lang)} style={FILL}>
        <ComposedChart data={rows} margin={{ top: 8, right: 56, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact(lang)} />
          <ChartTooltip isAnimationActive={false}
            content={<ChartTooltipContent labelFormatter={rowRange} valueFormatter={number(lang)} />} />
          <Legend content={legend()} />
          <Bar dataKey="web" fill="var(--color-web)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          <Area dataKey="slack" type="linear" stroke="var(--color-slack)" fill="var(--color-slack)" fillOpacity={0.14}
            strokeWidth={2} isAnimationActive={false} />
          <Line dataKey="whatsapp" type="linear" stroke="var(--color-whatsapp)" strokeWidth={2} dot={false}
            isAnimationActive={false} />
          <ReferenceLine y={4000} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3"
            label={{ value: COPY.target[lang], position: 'right', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
        </ComposedChart>
      </ChartContainer>
    </Box>
  );
}

function Lines({ lang }: { lang: SpecimenLang }) {
  return (
    <Box height={260}>
      <ChartContainer config={channelConfig(lang)} style={FILL}>
        <LineChart data={recentChannelRows(lang)} margin={{ top: 8, right: 12, bottom: 0, left: 12 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <ChartTooltip isAnimationActive={false}
            content={<ChartTooltipContent indicator="line" labelFormatter={rowRange} valueFormatter={number(lang)} />} />
          <Legend content={legend()} />
          {CHANNELS.map((key) => (
            <Line key={key} dataKey={key} type="monotone" stroke={`var(--color-${key})`} strokeWidth={2} dot={false}
              isAnimationActive={false} />
          ))}
        </LineChart>
      </ChartContainer>
    </Box>
  );
}

function StackedAreas({ lang }: { lang: SpecimenLang }) {
  return (
    <Box height={260}>
      <ChartContainer config={channelConfig(lang)} style={FILL}>
        <AreaChart data={recentChannelRows(lang)} margin={{ top: 8, right: 12, bottom: 0, left: 12 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <ChartTooltip isAnimationActive={false}
            content={<ChartTooltipContent indicator="dot" labelFormatter={rowRange} valueFormatter={number(lang)} />} />
          <Legend content={legend()} />
          {CHANNELS.map((key) => (
            <Area key={key} dataKey={key} stackId="all" type="monotone" stroke={`var(--color-${key})`}
              fill={`var(--color-${key})`} fillOpacity={0.35} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ChartContainer>
    </Box>
  );
}

/** One bar per channel, each its own colour through Cell. */
function ShareBars({ lang }: { lang: SpecimenLang }) {
  const data = channelShare(lang).map((row) => ({ ...row, name: CHANNEL_LABELS[row.key][lang] }));
  return (
    <Box height={240}>
      <ChartContainer config={channelConfig(lang)} style={FILL}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }} accessibilityLayer={false}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={88} />
          <ChartTooltip isAnimationActive={false} cursor={false}
            content={<ChartTooltipContent hideLabel nameKey="key" valueFormatter={number(lang)} />} />
          <Bar dataKey="value" radius={4} barSize={28} isAnimationActive={false}>
            {data.map((row) => <Cell key={row.key} fill={`var(--color-${row.key})`} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
    </Box>
  );
}

/**
 * Horizontal bars with their value after each bar, through the toolkit's barShape and barLabel: Slack is 0, and its
 * bar keeps its row and its 0 (recharts alone drops a zero bar and its label).
 */
function LabelledBars({ lang }: { lang: SpecimenLang }) {
  const data = channelShareNoSlack(lang).map((row) => ({ ...row, name: CHANNEL_LABELS[row.key][lang] }));
  return (
    <Box height={240}>
      <ChartContainer config={channelConfig(lang)} style={FILL}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 8 }} accessibilityLayer={false}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={88} />
          <Bar dataKey="value" radius={4} barSize={28} isAnimationActive={false} shape={barShape}
            label={{ content: barLabel, position: 'right', formatter: labelNumber(lang) }}>
            {data.map((row) => <Cell key={row.key} fill={`var(--color-${row.key})`} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
    </Box>
  );
}

function Share({ lang }: { lang: SpecimenLang }) {
  const data = channelShare(lang);
  return (
    <Box height={280}>
      <ChartContainer config={channelConfig(lang)} style={FILL}>
        <PieChart accessibilityLayer={false}>
          <ChartTooltip isAnimationActive={false} content={<ChartTooltipContent hideLabel valueFormatter={number(lang)} />} />
          <Pie data={data} dataKey="value" nameKey="key" innerRadius="52%" outerRadius="82%" paddingAngle={2}
            isAnimationActive={false}>
            {data.map((row) => <Cell key={row.key} fill={`var(--color-${row.key})`} />)}
          </Pie>
          <Legend content={pieLegend()} />
        </PieChart>
      </ChartContainer>
    </Box>
  );
}

/** A tooltip held open on the ninth day, to compare its indicator and options. */
function HeldTip({ lang, title, ...options }: {
  lang: SpecimenLang;
  title: string;
  indicator?: 'dot' | 'line' | 'dashed';
  hideLabel?: boolean;
  hideIndicator?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      <Box height={190}>
        <ChartContainer config={channelConfig(lang)} style={FILL}>
          <LineChart data={recentChannelRows(lang, 10)} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}
            accessibilityLayer={false}>
            <XAxis dataKey="label" hide />
            <ChartTooltip active defaultIndex={2} isAnimationActive={false}
              content={<ChartTooltipContent {...options} labelFormatter={rowRange} valueFormatter={number(lang)} />} />
            {CHANNELS.map((key) => (
              <Line key={key} dataKey={key} type="monotone" stroke={`var(--color-${key})`} strokeWidth={2} dot={false}
                isAnimationActive={false} />
            ))}
          </LineChart>
        </ChartContainer>
      </Box>
    </div>
  );
}

function Swatch({ name, note }: { name: Channel; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-block h-8 w-8 rounded-md" style={{ background: `var(--color-${name})` }} />
      <span className="grid text-sm">
        <span className="font-medium">--color-{name}</span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

/** Small marks for a legend that uses config icons. */
const DotIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="var(--color-web)" /></svg>;
const RingIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke="var(--color-whatsapp)" strokeWidth="2" /></svg>;
const SquareIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="2" fill="var(--color-slack)" /></svg>;

export const specimen = defineSpecimen({
  id: 'chart-container',
  name: 'ChartContainer',
  group: 'charts',
  from: '@notis/sdk/ui',
  covers: ['ChartContainer', 'ChartLegend', 'ChartStyle', 'ChartTooltipContent'],
  summary: 'The kit for a chart composed by hand from the recharts pieces: series colours, the tooltip box and the legend.',
  states: [
    {
      id: 'composed',
      label: 'Bars, a line, an area and a target line in one chart, with the toolkit legend',
      render: ({ lang }) => <Pad><Composed lang={lang} /></Pad>,
    },
    {
      id: 'composed-hover',
      label: 'Hover: the toolkit tooltip names the day and each channel',
      height: 380,
      render: ({ lang }) => <Pad><Composed lang={lang} /></Pad>,
      interact: (root) => hoverPlot(root, { at: 0.55 }),
    },
    {
      id: 'lines',
      label: 'A line chart, one line per channel',
      render: ({ lang }) => <Pad><Lines lang={lang} /></Pad>,
    },
    {
      id: 'stacked-areas',
      label: 'Stacked areas',
      render: ({ lang }) => <Pad><StackedAreas lang={lang} /></Pad>,
    },
    {
      id: 'bar-cells',
      label: 'Horizontal bars, each coloured by its own Cell',
      render: ({ lang }) => <Pad><ShareBars lang={lang} /></Pad>,
    },
    {
      id: 'bar-labels-zero',
      label: 'Value after each bar (barShape and barLabel): a zero bar keeps its row and its 0',
      render: ({ lang }) => <Pad><LabelledBars lang={lang} /></Pad>,
    },
    {
      id: 'pie',
      label: 'A donut of the share by channel with the toolkit legend',
      render: ({ lang }) => <Pad><Share lang={lang} /></Pad>,
    },
    {
      id: 'tooltip-options',
      label: 'Tooltip box held open: dot, line and dashed indicators, no label, no indicator',
      height: 520,
      render: ({ lang }) => (
        <Pad className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <HeldTip lang={lang} title="indicator dot" indicator="dot" />
          <HeldTip lang={lang} title="indicator line" indicator="line" />
          <HeldTip lang={lang} title="indicator dashed" indicator="dashed" />
          <HeldTip lang={lang} title="hideLabel" hideLabel />
          <HeldTip lang={lang} title="hideIndicator" hideIndicator />
        </Pad>
      ),
    },
    {
      id: 'chart-style',
      label: 'ChartStyle alone: the colour variables it defines for a [data-chart] box',
      render: ({ lang }) => (
        <Pad>
          <ChartStyle id="book-channels" config={channelConfig(lang)} />
          <div data-chart="book-channels" className="grid gap-4">
            <Swatch name="web" note={COPY.colorKey[lang]} />
            <Swatch name="whatsapp" note={COPY.colorKey[lang]} />
            <Swatch name="slack" note={COPY.themeKey[lang]} />
          </div>
        </Pad>
      ),
    },
    {
      id: 'legend-long',
      label: 'Legend with long names and config icons: it wraps',
      render: ({ lang }) => {
        const config = channelConfig(lang, true);
        config.web!.icon = DotIcon;
        config.whatsapp!.icon = RingIcon;
        config.slack!.icon = SquareIcon;
        return (
          <Pad>
            <Box height={240}>
              <ChartContainer config={config} style={FILL}>
                <BarChart data={recentChannelRows(lang, 7)} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                  accessibilityLayer={false}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <Legend content={legend()} />
                  {CHANNELS.map((key) => (
                    <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ChartContainer>
            </Box>
          </Pad>
        );
      },
    },
    {
      id: 'empty',
      label: 'Empty: no rows, the grid and the legend have nothing to draw',
      render: ({ lang }) => (
        <Pad className="grid gap-2">
          <Box height={200}>
            <ChartContainer config={channelConfig(lang)} style={FILL}>
              <LineChart data={[]} margin={{ top: 8, right: 12, bottom: 0, left: 12 }} accessibilityLayer={false}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <Legend content={legend()} />
                <Line dataKey="web" stroke="var(--color-web)" isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
          </Box>
          <span className="text-center text-sm text-muted-foreground">{COPY.noData[lang]}</span>
        </Pad>
      ),
    },
    {
      id: 'default-ratio',
      label: 'No height given: the box keeps its 16:9 ratio',
      render: ({ lang }) => (
        <Pad className="max-w-[40rem]">
          <ChartContainer config={channelConfig(lang)}>
            <BarChart data={recentChannelRows(lang, 7)} accessibilityLayer={false}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <Bar dataKey="web" fill="var(--color-web)" radius={4} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </Pad>
      ),
    },
    {
      id: 'responsive-only',
      label: 'ResponsiveContainer alone, without the kit: plain token colours, no legend or tooltip box',
      render: ({ lang }) => (
        <Pad>
          <Box height={160}>
            <ResponsiveContainer>
              <LineChart data={recentChannelRows(lang)} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
                accessibilityLayer={false}>
                <Line dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Pad>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390)',
      width: 390,
      render: ({ lang }) => <Pad><Composed lang={lang} height={260} /></Pad>,
    },
  ],
});
