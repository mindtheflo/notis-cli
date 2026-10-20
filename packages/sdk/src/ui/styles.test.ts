import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { adoptToolkitStyles, getToolkitStyleText, registerToolkitStyles, resetToolkitStylesForTests } from './styles';

test('nothing is adopted before the host registers, even when the page CSS holds toolkit rules', () => {
  const dom = new JSDOM('<!doctype html><html><head><style>.portal{color:red}.nui-row{color:blue}</style></head><body><div id="host"></div></body></html>');
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { document: globals.document, Document: globals.Document };
  globals.document = dom.window.document;
  globals.Document = dom.window.Document;
  resetToolkitStylesForTests();
  try {
    const shadow = dom.window.document.getElementById('host')!.attachShadow({ mode: 'open' });
    assert.equal(getToolkitStyleText(), null, 'the merged page sheet is never taken for the toolkit');
    assert.equal(adoptToolkitStyles(shadow), false);
    assert.equal(shadow.querySelectorAll('style').length, 0);

    registerToolkitStyles('.nui-row{color:green}');
    assert.equal(adoptToolkitStyles(shadow), true);
    assert.equal(adoptToolkitStyles(shadow), true);
    const styles = shadow.querySelectorAll('style');
    const adopted = (shadow as unknown as { adoptedStyleSheets?: unknown[] }).adoptedStyleSheets ?? [];
    assert.equal(styles.length + adopted.length, 1, 'adopted once');
    if (styles.length) assert.equal(styles[0]!.textContent, '.nui-row{color:green}');
  } finally {
    globals.document = saved.document;
    globals.Document = saved.Document;
    resetToolkitStylesForTests();
    dom.window.close();
  }
});
