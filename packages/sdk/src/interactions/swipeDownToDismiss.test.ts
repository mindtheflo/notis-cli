import { dom } from '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';

import { SWIPE_DISMISS_ATTRIBUTE, SWIPE_DISMISS_DISTANCE, installSwipeDownToDismiss } from './swipeDownToDismiss';

const doc = dom.window.document;
Object.defineProperty(globalThis, 'HTMLTextAreaElement', { configurable: true, writable: true, value: dom.window.HTMLTextAreaElement });

type Touchish = { identifier: number; clientX: number; clientY: number };

function touch(target: EventTarget, type: string, points: Touchish[]): Event {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'touches', { value: points });
  target.dispatchEvent(event);
  return event;
}

/** A focused textarea in a marked area, whose text is scrolled `scrollTop` pixels down. */
function setup(scrollTop = 0) {
  doc.body.innerHTML = '';
  const area = doc.createElement('div');
  area.setAttribute(SWIPE_DISMISS_ATTRIBUTE, '');
  const field = doc.createElement('textarea');
  area.append(field);
  doc.body.append(area);
  let top = scrollTop;
  Object.defineProperty(field, 'scrollTop', { get: () => top, set: (v: number) => { top = v; } });
  field.focus();
  return { area, field, scrollTo: (v: number) => { top = v; } };
}

test('a swipe down in a focused composer whose text is at its top closes the keyboard', () => {
  const undo = installSwipeDownToDismiss(doc);
  const { field } = setup();
  touch(field, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 100 }]);
  const first = touch(field, 'touchmove', [{ identifier: 1, clientX: 100, clientY: 112 }]);
  assert.equal(first.defaultPrevented, true, 'nothing behind the field scrolls once the text is at its top');
  assert.equal(doc.activeElement, field);
  touch(field, 'touchmove', [{ identifier: 1, clientX: 101, clientY: 112 + SWIPE_DISMISS_DISTANCE }]);
  assert.notEqual(doc.activeElement, field, 'the field lost the focus, so the keyboard closes');
  undo();
});

test('the swipe scrolls the text first and only then closes the keyboard', () => {
  const undo = installSwipeDownToDismiss(doc);
  const { field, scrollTo } = setup(80);
  touch(field, 'touchstart', [{ identifier: 1, clientX: 50, clientY: 100 }]);
  const scrolling = touch(field, 'touchmove', [{ identifier: 1, clientX: 50, clientY: 160 }]);
  assert.equal(scrolling.defaultPrevented, false, 'the browser scrolls the text');
  assert.equal(doc.activeElement, field);
  scrollTo(0);
  touch(field, 'touchmove', [{ identifier: 1, clientX: 50, clientY: 170 }]);
  assert.equal(doc.activeElement, field, 'the distance counts from where the text reached its top');
  touch(field, 'touchmove', [{ identifier: 1, clientX: 50, clientY: 170 + SWIPE_DISMISS_DISTANCE }]);
  assert.notEqual(doc.activeElement, field);
  undo();
});

test('a swipe up, a sideways swipe or a touch outside a marked area keeps the keyboard', () => {
  const undo = installSwipeDownToDismiss(doc);
  const { field } = setup();
  touch(field, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 200 }]);
  touch(field, 'touchmove', [{ identifier: 1, clientX: 100, clientY: 100 }]);
  assert.equal(doc.activeElement, field, 'up');

  touch(field, 'touchstart', [{ identifier: 2, clientX: 100, clientY: 100 }]);
  touch(field, 'touchmove', [{ identifier: 2, clientX: 160, clientY: 110 }]);
  touch(field, 'touchmove', [{ identifier: 2, clientX: 220, clientY: 160 }]);
  assert.equal(doc.activeElement, field, 'sideways');

  const outside = doc.createElement('div');
  doc.body.append(outside);
  touch(outside, 'touchstart', [{ identifier: 3, clientX: 100, clientY: 100 }]);
  const moved = touch(outside, 'touchmove', [{ identifier: 3, clientX: 100, clientY: 200 }]);
  assert.equal(moved.defaultPrevented, false);
  assert.equal(doc.activeElement, field, 'outside');
  undo();
});

test('the listener stays while any caller needs it and goes with the last one', () => {
  const a = installSwipeDownToDismiss(doc);
  const b = installSwipeDownToDismiss(doc);
  a();
  a();
  let { field } = setup();
  touch(field, 'touchstart', [{ identifier: 1, clientX: 0, clientY: 0 }]);
  touch(field, 'touchmove', [{ identifier: 1, clientX: 0, clientY: 10 }]);
  touch(field, 'touchmove', [{ identifier: 1, clientX: 0, clientY: 10 + SWIPE_DISMISS_DISTANCE }]);
  assert.notEqual(doc.activeElement, field);
  b();
  ({ field } = setup());
  touch(field, 'touchstart', [{ identifier: 1, clientX: 0, clientY: 0 }]);
  touch(field, 'touchmove', [{ identifier: 1, clientX: 0, clientY: 10 }]);
  touch(field, 'touchmove', [{ identifier: 1, clientX: 0, clientY: 10 + SWIPE_DISMISS_DISTANCE }]);
  assert.equal(doc.activeElement, field, 'no listener left');
});
