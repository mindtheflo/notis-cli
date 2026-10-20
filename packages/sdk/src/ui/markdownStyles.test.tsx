import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';

import { Markdown } from '../components/Markdown';

/*
 * A Space ships no CSS: the host adopts toolkit.css into its shadow root and nothing else
 * (packages/cli/scripts/build-space-sdk.js), while the Space's own Tailwind preflight resets lists,
 * paragraphs, headings and links. The `Markdown` value renderer's typography must therefore live in
 * toolkit.css, or every write-up in a ported Space reads as one unstyled run of text.
 */
const toolkitCss = readFileSync(new URL('./toolkit.css', import.meta.url), 'utf8');

const SAMPLE = [
  '# One', '## Two', '### Three', '',
  'A paragraph with [a link](https://example.com) and `code`.', '',
  'A second paragraph.', '',
  '- first', '- second', '  - nested', '',
  '1. one', '2. two', '',
  '- [ ] open task', '- [x] done task', '',
  '> A quote', '',
  '```', 'block', '```', '',
  '---', '',
  '| Name | Value |', '| --- | --- |', '| a | 1 |', '',
  '![A picture](https://example.com/a.png)',
].join('\n');

function render(markup: string) {
  const dom = new JSDOM(`<!doctype html><html><head><style>${toolkitCss}</style></head><body>${markup}</body></html>`);
  const sheet = dom.window.document.styleSheets[0]!;
  const rules = Array.from(sheet.cssRules).filter((rule): rule is CSSStyleRule => 'selectorText' in rule);
  /** The toolkit declaration for `property` that applies to `element`, from a rule scoped to `.notis-markdown`. */
  const declared = (element: Element, property: string): string | null => {
    let value: string | null = null;
    for (const rule of rules) {
      if (!rule.selectorText.includes('.notis-markdown') || !element.matches(rule.selectorText)) continue;
      const found = rule.style.getPropertyValue(property);
      if (found) value = found;
    }
    return value;
  };
  return { document: dom.window.document, rules, declared };
}

test('toolkit.css styles every element the Markdown renderer emits', () => {
  const { document, rules, declared } = render(renderToStaticMarkup(<Markdown value={SAMPLE} />));
  const root = document.querySelector('.notis-markdown');
  assert.ok(root, 'the renderer marks its root');
  assert.equal(declared(root, 'font-size'), '14px');
  assert.equal(declared(root, 'line-height'), '1.65');

  for (const tag of ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre', 'hr', 'table', 'th', 'td', 'img']) {
    const element = root.querySelector(tag);
    assert.ok(element, `the sample renders a ${tag}`);
    const styled = rules.filter((rule) => rule.selectorText.includes('.notis-markdown') && element.matches(rule.selectorText));
    assert.ok(styled.length, `toolkit.css styles a Markdown ${tag}`);
    // A class in the selector outranks the element-only resets of a Space's preflight (ul { list-style: none }).
    assert.ok(styled.every((rule) => !rule.selectorText.includes(':where(')), `${tag} keeps class specificity`);
  }

  assert.equal(declared(root.querySelector('ul')!, 'list-style-type'), 'disc');
  assert.equal(declared(root.querySelector('ol')!, 'list-style-type'), 'decimal');
  assert.ok(declared(root.querySelector('ul')!, 'padding-left'), 'lists keep their indent');
  assert.ok(declared(root.querySelector('p')!, 'margin'), 'paragraphs keep their spacing');
  assert.equal(declared(root.querySelector('h1')!, 'font-size'), '1.5em');
  assert.ok(declared(root.querySelector('a')!, 'text-decoration'), 'links stay underlined');
  assert.ok(declared(root.querySelector('ul.contains-task-list')!, 'list-style'), 'task lists drop their bullets');
});

test('a quote is a flat tinted block (C16); a table scrolls in its own box at phone widths (C17)', () => {
  const { document, declared } = render(renderToStaticMarkup(<Markdown value={SAMPLE} />));
  const quote = document.querySelector('.notis-markdown blockquote')!;
  assert.equal(declared(quote, 'border-left'), null, 'no edge on one side');
  assert.equal(declared(quote, 'border-left-width'), null);
  assert.match(declared(quote, 'background') ?? '', /--muted/, 'a tint carries the quote');
  assert.ok(declared(quote, 'border-radius'));
  const table = document.querySelector('.notis-markdown table')!;
  const box = table.parentElement!;
  assert.ok(box.matches('.notis-markdown-table'), 'every table sits in a scroll box');
  assert.equal(declared(box, 'overflow-x'), 'auto');
  assert.equal(declared(box, 'max-width'), '100%');
  assert.ok(declared(table.querySelector('td')!, 'min-width'), 'cells keep a floor, so a wide table scrolls instead of squeezing');
});

test('toolkit.css carries the small Markdown scale', () => {
  const { document, declared } = render(renderToStaticMarkup(<Markdown value="Short note." size="sm" />));
  const root = document.querySelector('.notis-markdown--sm');
  assert.ok(root, 'the small scale marks its root');
  assert.equal(declared(root, 'font-size'), '13px');
});
