import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { contentCapturePlan, MEASURE_SCREENSHOT_CONTENT_SCRIPT, safeViewportHeight } from '../src/runtime/screenshot-framing.js';

function element(width, height, children = [], { tagName = 'DIV', text = '', hidden = false } = {}) {
  return {
    tagName, children, hidden, attributes: {},
    childNodes: [...children, ...(text ? [{ nodeType: 3, textContent: text }] : [])],
    getBoundingClientRect: () => ({ width, height }),
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function measure(root, width = 1280) {
  return runInNewContext(MEASURE_SCREENSHOT_CONTENT_SCRIPT, {
    document: { getElementById: () => root, documentElement: { clientWidth: width } },
    getComputedStyle: (el) => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible' }),
  });
}

test('centred narrow content fills its frame without changing app layout', () => {
  const content = element(768, 486, [element(720, 80), element(720, 360)]);
  const result = measure(element(1280, 550, [element(1280, 550, [content])]));
  assert.equal(result.width, 768);
  assert.equal(result.height, 486);
  assert.equal(content.attributes['data-notis-screenshot-content'], '');
});

test('full-width split views retain both panes', () => {
  const root = element(1280, 900, [element(1280, 900, [element(320, 900), element(928, 900)])]);
  assert.equal(measure(root), null);
});

test('a separate header prevents cropping to a narrower body', () => {
  assert.equal(measure(element(1280, 900, [element(1280, 80), element(768, 720)])), null);
});

test('direct text remains inside the captured container', () => {
  assert.equal(measure(element(1280, 900, [element(768, 600)], { text: 'App heading' })), null);
});

test('hidden siblings do not prevent measuring the visible app', () => {
  const content = element(768, 486, [element(700, 70), element(700, 350)]);
  assert.equal(measure(element(1280, 900, [element(100, 100, [], { hidden: true }), content])).width, 768);
});

test('tiny controls are not enlarged into an app screenshot', () => {
  assert.equal(measure(element(1280, 900, [element(240, 48, [], { tagName: 'BUTTON' })])), null);
});

test('a long narrow page uses a readable desktop viewport, not a miniature full page', () => {
  const plan = contentCapturePlan({ width: 768, height: 1282 }, { width: 2152, height: 1345 }, 2000, 1250);
  assert.equal(plan.focus, false);
  assert.equal(plan.width, 800);
  assert.equal(plan.height, 500);
  assert.equal(plan.width * plan.scale, 2000);
});

test('bounded short content is captured at sufficient resolution without reflow', () => {
  const plan = contentCapturePlan({ width: 768, height: 486 }, { width: 1152, height: 720 }, 2000, 1250);
  assert.equal(plan.focus, true);
  assert.equal(plan.width, 1152);
  assert.equal(plan.height, 720);
  assert.equal(plan.scale * 768, 2000);
});

test('long-page framing stops before a partially visible heading or control', () => {
  assert.equal(safeViewportHeight([{ top: 498, bottom: 522 }, { top: 450, bottom: 470 }], 500), 490);
});

test('fully visible content and tall containers do not shrink the viewport', () => {
  assert.equal(safeViewportHeight([{ top: 450, bottom: 480 }, { top: 0, bottom: 1282 }], 500), 500);
});
