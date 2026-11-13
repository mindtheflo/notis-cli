import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  adoptToolkitStyles, getToolkitStyleText, registerToolkitStyles, resetToolkitStylesForTests, toolkitCascadeFor,
} from './styles';

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
    if (styles.length) {
      // The toolkit sits in its layer, after the full Tailwind 4 order, so a Space's utilities override it.
      const text = styles[0]!.textContent ?? '';
      assert.match(text, /^@layer properties, theme, base, components, utilities;\n@layer components\.notis-sdk, components\.notis-toolkit;/);
      assert.match(text, /@layer components\.notis-toolkit \{\n\.nui-row\{color:green\}\n\}/);
      // A Tailwind 3 Space takes the plain rules instead, in the same element.
      assert.equal(adoptToolkitStyles(shadow, { cascade: 'unlayered' }), true);
      assert.equal(shadow.querySelectorAll('style').length, 1);
      assert.equal(shadow.querySelector('style')!.textContent, '.nui-row{color:green}');
    }
    assert.equal(getToolkitStyleText(), '.nui-row{color:green}', 'the registered text stays as registered');
  } finally {
    globals.document = saved.document;
    globals.Document = saved.Document;
    resetToolkitStylesForTests();
    dom.window.close();
  }
});

test('a Space built with Tailwind 3 gets the toolkit unlayered; Tailwind 4 and plain CSS get it layered', () => {
  assert.equal(toolkitCascadeFor(null), 'layered');
  assert.equal(toolkitCascadeFor('.card{padding:4px}'), 'layered');
  assert.equal(toolkitCascadeFor('/*! tailwindcss v4.3.3 | MIT License */@layer theme,base,components,utilities;.hidden{display:none}'), 'layered');
  assert.equal(toolkitCascadeFor('/*! tailwindcss v3.4.17 | MIT License */*,:before{--tw-ring-offset-width:0px}.hidden{display:none}'), 'unlayered');
  assert.equal(toolkitCascadeFor('*,:before{--tw-ring-offset-width:0px}button{background-color:transparent}.hidden{display:none}'), 'unlayered');
  // Tailwind 3 importing the SDK stylesheet, banner stripped: its order statement and sublayer are not Tailwind 4 layers.
  assert.equal(toolkitCascadeFor('*,:before{--tw-ring-offset-width:0px}@layer properties, theme, base, components, utilities;'
    + '@layer components.notis-sdk{.notis-shell{display:flex}}.hidden{display:none}'), 'unlayered');
  // Tailwind 4 without its banner (comments stripped) keeps its layer blocks.
  assert.equal(toolkitCascadeFor('@layer theme,base,components,utilities;@layer base{*{--tw-ring-offset-width:0px}}@layer utilities{.hidden{display:none}}'), 'layered');
});
