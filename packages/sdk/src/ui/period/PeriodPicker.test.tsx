import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { PeriodPicker } from './PeriodPicker';
import type { Period } from './periods';

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => {
    root!.render(
      <KeyboardEngine host="preview" locale="en" platform="mac" engine={new KeyboardEngineCore()} document={doc} strict>
        {node}
      </KeyboardEngine>,
    );
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

const toolkitCss = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');

/** The declarations of the rule written exactly as `selector {` at the start of a line. */
function cssRule(selector: string): string | null {
  const at = toolkitCss.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = toolkitCss.indexOf('{', at);
  return toolkitCss.slice(open + 1, toolkitCss.indexOf('}', open)).trim();
}

const LAST7: Period = { preset: 'last7', compare: 'prev' };

test('PeriodPicker without the custom preset offers presets only: no calendar, no Apply (follow-up B13)', async () => {
  const picked: Period[] = [];
  await mount(<PeriodPicker value={LAST7} onChange={(period) => picked.push(period)} presets={['last7', 'last30']} />);
  await click(doc.querySelector('[data-pp-open="range"]')!);
  const panel = doc.querySelector('.nui-pp-panel');
  assert.ok(panel, 'the range menu is open');
  assert.deepEqual([...panel.querySelectorAll('[data-pp-preset]')].map((el) => el.getAttribute('data-pp-preset')),
    ['last7', 'last30']);
  assert.ok(!panel.querySelector('.nui-pp-cal'), 'no calendar to pick days in');
  assert.ok(!panel.querySelector('.nui-pp-primary'), 'nothing to apply');
  assert.equal(panel.hasAttribute('data-one'), false);
  assert.match(cssRule('.nui-pp-panel > .nui-pp-presets:only-child') ?? '', /border-right: 0;/,
    'no divider beside a list that stands alone');
  await click(panel.querySelector('[data-pp-preset="last30"]')!);
  assert.deepEqual(picked, [{ preset: 'last30', compare: 'prev' }], 'a preset still applies at once');
});

test('PeriodPicker with the custom preset keeps its calendar (follow-up B13)', async () => {
  await mount(<PeriodPicker value={LAST7} onChange={() => undefined} presets={['last7', 'custom']} />);
  await click(doc.querySelector('[data-pp-open="range"]')!);
  const panel = doc.querySelector('.nui-pp-panel')!;
  assert.ok(panel.querySelector('.nui-pp-cal'), 'the calendar sits beside the presets');
  assert.ok(panel.querySelector('.nui-pp-primary'));
});

test('a PeriodPicker with Compare never widens a phone page: in a bar it wraps under the head and its triggers shrink', () => {
  assert.match(cssRule('.nui-section[data-kind="bar"]:has(> .nui-pp)') ?? '', /flex-wrap: wrap;/, 'the bar wraps');
  assert.match(cssRule('.nui-section[data-kind="bar"] > .nui-pp') ?? '', /flex-shrink: 1; min-width: 0;/,
    'the picker shrinks to the row, past the bar rule that keeps its other children whole');
  assert.match(toolkitCss, /\n\.nui-pp \{[^}]*min-width: 0; max-width: 100%;/, 'the picker never runs past its row');
  assert.match(cssRule('.nui-pp-trigger') ?? '', /min-width: 0; max-width: 100%;/);
  assert.match(cssRule('.nui-pp-dates') ?? '', /min-width: 0; overflow: hidden; text-overflow: ellipsis;/,
    'a long range ellipsizes inside its trigger');
  assert.match(cssRule('.nui-pp-dates') ?? '', /flex-shrink: 1000;/, 'the dates give way before the period name');
  assert.match(cssRule('.nui-pp-name') ?? '', /min-width: 0; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1;/,
    'a long period name still shrinks, so the trigger never outgrows a phone row');
});

test('a chart head moves its pickers under the title when both do not fit, instead of cutting the title', () => {
  assert.match(cssRule('.nui-section[data-kind="chart"] > .nui-section-head') ?? '', /flex-wrap: wrap;/);
});
