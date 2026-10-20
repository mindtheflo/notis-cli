import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ChartTable } from './ChartTable';
import { StatRow, type StatMetric } from './StatRow';

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => { root!.render(node); });
}

async function click(target: Element) {
  await act(async () => { (target as HTMLElement).click(); });
}

const toolkitCss = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');

/** The declarations of the rule written exactly as `selector {` at the start of a line. */
function cssRule(selector: string): string | null {
  const at = toolkitCss.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = toolkitCss.indexOf('{', at);
  return toolkitCss.slice(open + 1, toolkitCss.indexOf('}', open)).trim();
}

const METRICS: StatMetric[] = [
  {
    id: 'interactions',
    label: { en: 'Interactions handled without an incident', fr: 'Interactions traitées sans incident' },
    value: 1480,
    previous: 1200,
    about: <button type="button" className="info">i</button>,
  },
  { id: 'errors', label: 'Errors', value: 12, previous: 20, higherIsBetter: false },
];

test('StatRow: bare figures with wrapping labels; an about sits beside its label', async () => {
  await mount(<StatRow metrics={METRICS} locale="fr" />);
  const cells = [...doc.querySelectorAll('.nui-stat')];
  assert.equal(cells.length, 2);
  const head = cells[0].querySelector('.nui-stat-head')!;
  assert.equal(head.querySelector('.nui-stat-label')?.textContent, 'Interactions traitées sans incident');
  assert.equal(head.querySelector('.nui-stat-about .info')?.textContent, 'i', 'the about is drawn next to the label');
  assert.equal(head.querySelector('.nui-stat-label')?.hasAttribute('title'), false, 'a wrapped label needs no tooltip');
  assert.equal(cells[1].querySelector('.nui-stat-about'), null, 'no about, no slot');
  assert.equal(cells[1].querySelector('.nui-stat-value')?.textContent, '12');

  const stats = cssRule('.nui-stats') ?? '';
  // PG2: the deck strip. Four columns (two under 640), cells px 24 py 16, no card, gap or ring.
  assert.doesNotMatch(stats, /(^|; )(border[a-z-]*|gap|box-shadow|background):/, 'no frame: the strip has no card, gap or ring');
  const cell = cssRule('.nui-stat') ?? '';
  assert.match(cell, /flex: 0 0 25%;/);
  assert.match(cell, /padding: 16px 24px;/, 'each cell carries the 24px page inset');
  assert.doesNotMatch(cell, /(^|; )(border[a-z-]*|box-shadow|background):/);
  const label = cssRule('.nui-stat-label') ?? '';
  assert.doesNotMatch(label, /nowrap|ellipsis/, 'a long label wraps instead of being cut');
  assert.match(label, /overflow-wrap: anywhere;/);
  assert.match(cssRule('.nui-stat-about') ?? '', /margin-block: -6px;/, 'an icon button does not make the label line taller');
});

test('ChartTable: an about beside the metric label is above the pick area and never picks the row', async () => {
  const picked: string[] = [];
  await mount(<ChartTable metrics={METRICS} onSelect={(metric) => picked.push(metric.id ?? '')} locale="en" />);
  const rows = [...doc.querySelectorAll('tbody tr')];
  const about = rows[0].querySelector('.nui-ctable-about .info')!;
  assert.ok(about, 'the about is drawn in the metric cell');
  await click(about);
  assert.deepEqual(picked, [], 'a press on the about is its own');
  await click(rows[0].querySelector('.nui-ctable-pick')!);
  assert.deepEqual(picked, ['interactions']);
  assert.equal(rows[1].querySelector('.nui-ctable-about'), null);
  assert.match(cssRule('.nui-ctable-about') ?? '', /position: relative; z-index: 1;/, 'above the pick button that covers the row');
});
