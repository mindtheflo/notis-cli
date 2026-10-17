import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectDesignViolationsForFile, collectProjectDesignViolations } from '../src/runtime/app-boundary-validator.js';
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

test('the scaffold ships the flat primitives and the loading contract', () => {
  const card = readFileSync(join(templateDir, 'components', 'ui', 'card.tsx'), 'utf-8');
  assert.match(card, /CardDepthContext/);
  assert.doesNotMatch(card, /shadow-sm|'border/);

  // `spaces init` writes this view under spaces/, which the design rules do not
  // cover yet, so lint it as app source to hold it to the same bar.
  assert.match(COLLECTION_VIEW, /ViewSkeleton/);
  assert.doesNotMatch(COLLECTION_VIEW, /variant="outline"/);
  assert.deepEqual(collectDesignViolationsForFile('app/view.tsx', COLLECTION_VIEW).filter((violation) => !violation.allowed), []);

  // The starter kit named by the scaffolded definition, the design rules and the
  // shipped design guide. The App home route is gone; views live under spaces/.
  for (const file of [
    'app/layout.tsx',
    'app/globals.css',
    'components/ui/button.tsx',
    'components/ui/badge.tsx',
    'components/ui/native-select.tsx',
    'components/page-heading.tsx',
    'lib/utils.ts',
  ]) {
    assert.ok(readFileSync(join(templateDir, file), 'utf-8').length > 0, `${file} is part of the scaffold`);
  }
  assert.equal(existsSync(join(templateDir, 'app', 'page.tsx')), false);

  const styles = readFileSync(join(cliRoot, 'dist', 'sdk', 'src', 'styles.css'), 'utf-8');
  for (const className of ['.list-row', '.list-row-selected', '.notis-app-split', '.notis-app-pane-list', '.notis-app-pane-detail']) {
    assert.ok(styles.includes(className), `${className} is defined in the SDK styles`);
  }
  const surface = styles.match(/\.notis-app-surface\s*\{([^}]*)\}/)?.[1];
  assert.ok(surface, 'the flat surface rule is present');
  // Plain CSS includes border-radius; rounding is not a visible border.
  assert.doesNotMatch(surface, /(?:^|;)\s*(?:border(?:-(?!radius\b)[a-z-]+)?|box-shadow)\s*:/);
});

test('the CLI theme source is one style block, not an executable harness', () => {
  const theme = readFileSync(join(templateDir, '.harness', 'index.html.tmpl'), 'utf-8');
  // Only the first style block is served (as /theme.css and the renderer's dist/theme.css).
  assert.equal((theme.match(/<style>/g) || []).length, 1);
  assert.doesNotMatch(theme, /<script|\{\{/);
});
