import assert from 'node:assert/strict';
import test from 'node:test';

import { axisWidth, TICK_INSET, valueMargin, wrapLabel } from './axisLabels';

const chars = (line: string) => line.length * 7;

test('wrapLabel: at most two lines, the rest cut with an ellipsis; a no-break space keeps its words together', () => {
  const fits = (l: string) => chars(l) <= 98;
  assert.deepEqual(wrapLabel('Weekly digest', fits), ['Weekly digest']);
  assert.deepEqual(wrapLabel('Weekly digest of every inbox today', fits), ['Weekly digest', 'of every inbo…']);
  assert.deepEqual(wrapLabel('60,0\u00a0% of people', (l) => chars(l) <= 42), ['60,0\u00a0%', 'of pe…'], 'the number and its sign stay together');
});

test('axisWidth: 112px at least, room for two lines, at most 196px and 40% of the chart', () => {
  assert.equal(axisWidth(['A'], 1000, chars), 112);
  assert.equal(axisWidth(['Monthly active members asking', 'x'], 1000, chars), chars('Monthly active') + TICK_INSET);
  assert.equal(axisWidth(['A very long label that never fits in the room it has'], 1000, chars), 196);
  assert.equal(axisWidth(['A very long label that never fits in the room it has'], 300, chars), 120);
  assert.equal(valueMargin([], chars), 24);
  assert.equal(valueMargin(['12,345'], chars), 42 + 5 + 4);
});
