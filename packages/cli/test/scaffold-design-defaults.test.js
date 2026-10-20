import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectDesignViolationsForFile, collectProjectDesignViolations, loadDesignRules } from '../src/runtime/app-boundary-validator.js';
import { COLLECTION_VIEW } from '../src/runtime/space-collection-scaffold.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(testDir, '..');
const templateDir = join(cliRoot, 'template');

// The scaffold is what every agent copies first. It must pass its own lint
// with zero hits so a fresh `notis spaces init` is already on the design bar.
test('the Space scaffold has zero design violations', () => {
  const violations = collectProjectDesignViolations(templateDir).filter((violation) => !violation.allowed);
  assert.deepEqual(violations, []);
});

test('the collection view is one ListReader with no heading, column or own search', () => {
  for (const expected of ['<ListReader', 'search={{', 'tabs={{', 'create={{', 'row={', 'readerLabel=', 'readerActions=', 'crumbLabel=']) {
    assert.ok(COLLECTION_VIEW.includes(expected), `${expected} is part of the collection view`);
  }
  // The host top bar owns the title and the search; the toolkit owns the reading measure.
  assert.doesNotMatch(COLLECTION_VIEW, /<h1|PageHeading|\bCard\b|mx-auto|max-w-|notis-app-shell|useTopBarSearch|type="search"/);
  assert.doesNotMatch(COLLECTION_VIEW, /\b(?:toolbar|header|fill)=|\bdivided\b|variant="outline"/);
  // Every navigation promise is awaited or voided.
  assert.doesNotMatch(COLLECTION_VIEW, /(?<!void |await )\b(?:toSpace|toNamedSpace|setParams)\(/);

  // `spaces init` writes the view under spaces/: it passes every Space rule, and the App rules too.
  const space = loadDesignRules({ profile: 'space' });
  assert.deepEqual(collectDesignViolationsForFile('spaces/collection/view.tsx', COLLECTION_VIEW, space).filter((violation) => !violation.allowed), []);
  assert.deepEqual(collectDesignViolationsForFile('app/view.tsx', COLLECTION_VIEW).filter((violation) => !violation.allowed), []);
});

test('the scaffold ships the starter kit without a heading block or a card', () => {
  // The starter kit named by the scaffolded definition and the design rules.
  // The App home route is gone; views live under spaces/.
  for (const file of [
    'app/layout.tsx',
    'app/globals.css',
    'components/ui/button.tsx',
    'components/ui/badge.tsx',
    'components/ui/native-select.tsx',
    'lib/utils.ts',
  ]) {
    assert.ok(readFileSync(join(templateDir, file), 'utf-8').length > 0, `${file} is part of the scaffold`);
  }
  for (const file of ['app/page.tsx', 'components/page-heading.tsx', 'components/ui/card.tsx']) {
    assert.equal(existsSync(join(templateDir, file)), false, `${file} is not part of the scaffold`);
  }
});

test('the CLI theme source is one style block, not an executable harness', () => {
  const theme = readFileSync(join(templateDir, '.harness', 'index.html.tmpl'), 'utf-8');
  // Only the first style block is served (as /theme.css and the renderer's dist/theme.css).
  assert.equal((theme.match(/<style>/g) || []).length, 1);
  assert.doesNotMatch(theme, /<script|\{\{/);
});
