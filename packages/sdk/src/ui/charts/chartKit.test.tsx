import { dom } from '../testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Bar, BarChart, Tooltip, XAxis, YAxis } from 'recharts';

import {
  Chart,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
  barLabel,
  barShape,
  type ChartTooltipContentProps,
} from './Chart';

// recharts measures its box: jsdom has no ResizeObserver, no layout and no SVGElement global.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: StubResizeObserver });
Object.defineProperty(globalThis, 'SVGElement', { configurable: true, writable: true, value: dom.window.SVGElement });
dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 200, width: 400, height: 200, toJSON() {} } as DOMRect;
};

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => { root!.render(node); });
  // recharts lays out after its first render.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

const labels = () => [...doc.querySelectorAll('.nui-chart-bar-label')].map((el) => el.textContent);
type LabelText = ReactElement<{ x: number; y: number; textAnchor: string; children: string }>;

test('ChartContainer: 16 / 9 unless an aspect or a height is given; style still wins (follow-up B13)', async () => {
  await mount(<ChartContainer config={{}} aspect={2}><BarChart data={[]} /></ChartContainer>);
  const box = () => doc.querySelector<HTMLElement>('.nui-chart-container')!;
  assert.match(box().style.aspectRatio, /^2( \/ 1)?$/);
  await mount(<ChartContainer config={{}} height={240}><BarChart data={[]} /></ChartContainer>);
  assert.equal(box().style.height, '240px');
  assert.equal(box().style.aspectRatio, 'auto', 'a fixed height drops the default ratio');
  await mount(<ChartContainer config={{}} aspect="auto" style={{ height: 120 }}><BarChart data={[]} /></ChartContainer>);
  assert.equal(box().style.aspectRatio, 'auto');
  assert.equal(box().style.height, '120px', 'the parent decides the height');
  await mount(<ChartContainer config={{}}><BarChart data={[]} /></ChartContainer>);
  assert.equal(box().getAttribute('style'), null, 'no prop, no inline style: the toolkit.css ratio applies');
});

test('ChartTooltip is recharts\' own Tooltip (follow-up B13)', () => {
  assert.equal(ChartTooltip, Tooltip);
});

test('ChartTooltipContent alone: numbers in the locale, an empty series reads "No data" (follow-up B13)', async () => {
  const payload = [
    { name: 'Signups', dataKey: 'signups', value: 1240, color: 'red', payload: { signups: 1240, churn: null } },
    { name: 'Churn', dataKey: 'churn', value: null, color: 'blue', payload: { signups: 1240, churn: null } },
  ] as unknown as ChartTooltipContentProps['payload'];
  await mount(<ChartTooltipContent active payload={payload} label="Oct 5" locale="fr" />);
  const values = () => [...doc.querySelectorAll('.nui-chart-tip-value')];
  assert.equal(doc.querySelector('.nui-chart-tip-label')?.textContent, 'Oct 5', 'drawn without a ChartContainer');
  assert.deepEqual([...doc.querySelectorAll('.nui-chart-tip-name')].map((el) => el.textContent), ['Signups', 'Churn']);
  assert.equal(values()[0]?.textContent, '1 240');
  assert.equal(values()[0]?.hasAttribute('data-empty'), false);
  assert.equal(values()[1]?.textContent, 'Aucune donnée');
  assert.equal(values()[1]?.hasAttribute('data-empty'), true);
  await mount(<ChartTooltipContent active payload={payload} label="Oct 5" locale="en" />);
  assert.deepEqual(values().map((el) => el.textContent), ['1,240', 'No data']);
  await mount(<ChartTooltipContent active payload={payload} locale="en" valueFormatter={(v) => `${v} users`} />);
  assert.deepEqual(values().map((el) => el.textContent), ['1240 users', 'No data'], 'a formatter never sees an empty value');
});

test('ChartLegend alone: config labels and colours, four key shapes, hidden entries left out (follow-up B13)', async () => {
  await mount(
    <ChartLegend
      config={{ a: { label: 'Alpha', color: 'red' }, b: { label: 'Beta', color: 'blue' } }}
      payload={[
        { dataKey: 'a' },
        { dataKey: 'b', shape: 'circle' },
        { dataKey: 'c', value: 'Gamma', color: 'green', shape: 'line' },
        { dataKey: 'd', value: 'Before', color: 'gray', payload: { strokeDasharray: '4 4' } },
        { dataKey: 'e', value: 'Pad', type: 'none' },
      ]}
    />,
  );
  const items = [...doc.querySelectorAll('.nui-chart-legend-item')];
  assert.deepEqual(items.map((el) => el.textContent), ['Alpha', 'Beta', 'Gamma', 'Before'], 'the label falls back to the value');
  const square = items[0]!.querySelector<HTMLElement>('.nui-chart-swatch')!;
  assert.equal(square.style.backgroundColor, 'red');
  assert.equal(square.hasAttribute('data-shape'), false);
  const circle = items[1]!.querySelector<HTMLElement>('.nui-chart-swatch')!;
  assert.equal(circle.getAttribute('data-shape'), 'circle');
  assert.equal(circle.style.backgroundColor, 'blue');
  const line = items[2]!.querySelector<HTMLElement>('.nui-chart-key')!;
  assert.equal(line.hasAttribute('data-dashed'), false);
  assert.equal(line.style.background, 'green');
  const dashed = items[3]!.querySelector<HTMLElement>('.nui-chart-key')!;
  assert.equal(dashed.hasAttribute('data-dashed'), true, 'a strokeDasharray series is drawn dashed');
  assert.equal(dashed.style.borderTopColor, 'gray');
  await mount(<ChartLegend payload={[{ dataKey: 'e', type: 'none' }]} />);
  assert.ok(!doc.querySelector('.nui-chart-legend'), 'nothing to show, no legend');
});

test('barLabel: after a horizontal bar, centred above a vertical one, nothing for an empty value (follow-up B13)', () => {
  const box = { x: 10, y: 50, width: 20, height: 30 };
  const right = barLabel({ viewBox: box, value: 7, position: 'right', formatter: (v) => `${v} ms` }) as LabelText;
  assert.equal(right.props.children, '7 ms');
  assert.equal(right.props.x, 35, 'the end of the bar plus the offset');
  assert.equal(right.props.y, 65);
  assert.equal(right.props.textAnchor, 'start');
  const top = barLabel({ viewBox: box, value: 7, position: 'top' }) as LabelText;
  assert.equal(top.props.x, 20, 'the middle of the bar');
  assert.equal(top.props.y, 45);
  assert.equal(top.props.textAnchor, 'middle');
  assert.equal(barLabel({ viewBox: box, value: undefined }), null);
  assert.equal(barLabel({ viewBox: box, value: 3, formatter: () => '' }), null);
});

test('barShape keeps a zero bar, so its label still draws; a missing value has none (follow-up B13)', async () => {
  const data = [{ name: 'A', v: 2 }, { name: 'B', v: 0 }, { name: 'C', v: null }, { name: 'D', v: 5 }];
  await mount(
    <BarChart width={400} height={200} data={data} layout="vertical">
      <XAxis type="number" hide />
      <YAxis type="category" dataKey="name" />
      <Bar dataKey="v" isAnimationActive={false} shape={barShape}
        label={{ content: barLabel, position: 'right', formatter: (v) => `${v}` }} />
    </BarChart>,
  );
  assert.deepEqual(labels(), ['2', '0', '5']);
});

test('Chart stacks horizontal bars with each row\'s total after it, zero rows included (follow-up B13)', async () => {
  const data = [{ label: 'A', a: 3, b: 2 }, { label: 'B', a: 0, b: 0 }, { label: 'C', a: 4, b: null }];
  await mount(
    <Chart kind="bar" horizontal stacked data={data} locale="en"
      series={[{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }]} />,
  );
  assert.deepEqual(labels(), ['5', '0', '4'], 'one total per row, on the last series');
  const plot = doc.querySelector<HTMLElement>('.nui-chart-plot')!;
  assert.equal(plot.style.height, `${3 * 32 + 8}px`, 'a row is 32px');
  assert.deepEqual([...doc.querySelectorAll('.recharts-yAxis-tick-labels text, .recharts-cartesian-axis-tick-value')]
    .map((el) => el.textContent).filter(Boolean).slice(0, 3), ['A', 'B', 'C'], 'the row labels sit before the bars');
});

test('Chart stacks vertical bars: the second series sits on the first (follow-up B13)', async () => {
  const data = [{ label: 'A', a: 3, b: 2 }, { label: 'B', a: 1, b: 4 }];
  await mount(
    <Chart kind="bar" stacked data={data} locale="en" series={[{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }]} />,
  );
  const rects = [...doc.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle')].map((el) => ({
    name: el.getAttribute('name'), x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')),
    bottom: Number(el.getAttribute('y')) + Number(el.getAttribute('height')),
  }));
  assert.equal(rects.length, 4);
  for (const alpha of rects.filter((r) => r.name === 'Alpha')) {
    const beta = rects.find((r) => r.name === 'Beta' && r.x === alpha.x)!;
    assert.ok(beta, 'both series share the column');
    assert.ok(Math.abs(beta.bottom - alpha.y) < 0.01, 'Beta starts where Alpha ends');
  }
});

test('Chart horizontal: category labels wrap to two lines in a measured axis, side-by-side series get taller rows, labelFormat sets the short value (G-CHART)', async () => {
  const data = [
    { label: 'People who asked for a weekly summary of their inbox', a: 1240, b: 310 },
    { label: 'Short', a: 0, b: 5 },
  ];
  await mount(
    <Chart kind="bar" horizontal data={data} locale="en" title="Asks"
      series={[{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }, { key: 'c', label: 'Gamma' }]}
      format={(v) => `${v} people`} labelFormat={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} />,
  );
  const ticks = [...doc.querySelectorAll('.recharts-yAxis-tick-labels text')];
  const lines = ticks.map((t) => [...t.querySelectorAll('tspan')].map((s) => s.textContent));
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.length, 2, 'a long label takes two lines');
  assert.ok(lines[0]!.every((l) => l!.length * 7 <= 196 - 16), 'each line fits the 196px cap');
  assert.ok(lines[0]![1]!.endsWith('…'), 'what still does not fit ends in an ellipsis');
  assert.deepEqual(lines[1], ['Short'], 'a short label stays on one line');
  assert.deepEqual(labels(), ['1.2k', '0', '310', '5'], 'the short value after each bar, zero bars included');
  const plot = doc.querySelector<HTMLElement>('.nui-chart-plot')!;
  assert.equal(plot.style.height, `${2 * (3 * 14 + 12) + 8}px`, 'three series side by side: 54px rows');
  assert.match(doc.querySelector('.nui-chart-plot table')?.textContent ?? '', /1240 people/, 'the table keeps the exact format');
});
