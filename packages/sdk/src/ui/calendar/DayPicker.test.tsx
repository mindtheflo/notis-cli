import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { DayPicker } from './DayPicker';

const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'http://localhost/' });
const globals: Record<string, unknown> = {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
};
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const doc = dom.window.document;

async function mount(node: React.ReactNode) {
  doc.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(doc.getElementById('root')!);
  await act(async () => { root.render(node); });
  return { unmount: async () => { await act(async () => { root.unmount(); }); } };
}

const heads = () => [...doc.querySelectorAll('.nui-dp-weekday')].map((el) => el.textContent);

test('day picker (B7): narrow weekday heads, Monday first, in English and French', async () => {
  let view = await mount(<DayPicker mode="single" month={new Date(2026, 9, 1)} locale="en" />);
  assert.deepEqual(heads(), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  assert.ok(doc.querySelector('.nui-dp-outside'), 'outside days show by default');
  await view.unmount();

  view = await mount(<DayPicker mode="single" month={new Date(2026, 9, 1)} locale="fr" />);
  assert.deepEqual(heads(), ['L', 'M', 'M', 'J', 'V', 'S', 'D']);
  await view.unmount();
});

test('day picker: a caller formatter wins over the narrow heads', async () => {
  const view = await mount(
    <DayPicker mode="single" month={new Date(2026, 9, 1)} locale="en" formatters={{ formatWeekdayName: () => 'x' }} />,
  );
  assert.deepEqual(heads(), ['x', 'x', 'x', 'x', 'x', 'x', 'x']);
  await view.unmount();
});
