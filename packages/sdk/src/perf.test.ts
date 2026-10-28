import './ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';

import { beginWait, cancelWait, endWait, endWaitWhenContent, isWaiting, noteIntent, resetWaits } from './perf';

const frame = () => new Promise((resolve) => setTimeout(resolve, 5));
const measures = (name: string) => performance.getEntriesByName(name, 'measure');

test('a wait is measured from the last key press, on the frame after its content painted', async () => {
  resetWaits();
  performance.clearMeasures();
  const pressed = performance.now() - 40;
  noteIntent(pressed);
  beginWait('notis:record-open');
  assert.equal(isWaiting('notis:record-open'), true);
  endWait('notis:record-open');
  assert.equal(measures('notis:record-open').length, 0, 'measured only on the next frame');
  await frame();
  const [entry] = measures('notis:record-open');
  assert.ok(entry, 'the wait is measured');
  assert.equal(entry.startTime, pressed, 'it starts at the key press');
  assert.ok(entry.duration >= 40);
  assert.equal(isWaiting('notis:record-open'), false);
});

test('a wait with several parts ends once every part painted; a cancelled wait is never measured', async () => {
  resetWaits();
  performance.clearMeasures();
  const a = {}, b = {};
  beginWait('notis:query-change', a);
  beginWait('notis:query-change', b);
  endWait('notis:query-change', a);
  await frame();
  assert.equal(measures('notis:query-change').length, 0, 'one read still loads');
  endWait('notis:query-change', b);
  await frame();
  assert.equal(measures('notis:query-change').length, 1);

  beginWait('notis:view-switch');
  cancelWait('notis:view-switch');
  endWait('notis:view-switch');
  await frame();
  assert.equal(measures('notis:view-switch').length, 0);
});

test('a newer key press starts a new wait instead of joining the open one', async () => {
  resetWaits();
  performance.clearMeasures();
  noteIntent(performance.now() - 20);
  beginWait('notis:space-open', 'frame');
  const second = performance.now();
  noteIntent(second);
  beginWait('notis:space-open', 'frame');
  endWait('notis:space-open', 'frame');
  await frame();
  const entries = measures('notis:space-open');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].startTime, second);
});

test('endWaitWhenContent waits while a skeleton shows', async () => {
  resetWaits();
  performance.clearMeasures();
  const root = document.createElement('div');
  root.innerHTML = '<div data-notis-skeleton></div>';
  document.body.append(root);
  beginWait('notis:view-switch');
  endWaitWhenContent('notis:view-switch', root);
  await frame();
  assert.equal(measures('notis:view-switch').length, 0, 'a skeleton still shows');
  resetWaits();
  root.innerHTML = '<p>Rows</p>';
  beginWait('notis:view-switch');
  endWaitWhenContent('notis:view-switch', root);
  await frame();
  assert.equal(measures('notis:view-switch').length, 1, 'real content ends it');
  root.remove();
});
