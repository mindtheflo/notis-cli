import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectProjectDesignViolations } from '../src/runtime/app-boundary-validator.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(testDir, '..');
const templateDir = join(cliRoot, 'template');

// The scaffold is what every agent copies first. It must pass its own lint
// with zero hits so a fresh `notis apps init` is already on the design bar.
test('the app scaffold has zero design violations', () => {
  const violations = collectProjectDesignViolations(templateDir).filter((violation) => !violation.allowed);
  assert.deepEqual(violations, []);
});

test('the scaffold ships the flat primitives and the loading contract', () => {
  const card = readFileSync(join(templateDir, 'components', 'ui', 'card.tsx'), 'utf-8');
  assert.match(card, /CardDepthContext/);
  assert.doesNotMatch(card, /shadow-sm|'border/);

  const page = readFileSync(join(templateDir, 'app', 'page.tsx'), 'utf-8');
  assert.match(page, /ViewSkeleton/);
  assert.match(page, /hasData/);
  assert.match(page, /PageHeading/);
  assert.match(page, /list-row/);
  assert.doesNotMatch(page, /variant="outline"/);

  for (const file of ['components/ui/native-select.tsx', 'components/page-heading.tsx']) {
    assert.ok(readFileSync(join(templateDir, file), 'utf-8').length > 0, `${file} is part of the scaffold`);
  }

  const styles = readFileSync(join(templateDir, 'packages', 'sdk', 'src', 'styles.css'), 'utf-8');
  for (const className of ['.list-row', '.list-row-selected', '.notis-app-split', '.notis-app-pane-list', '.notis-app-pane-detail']) {
    assert.ok(styles.includes(className), `${className} is defined in the SDK styles`);
  }
  const surface = styles.match(/\.notis-app-surface\s*\{([^}]*)\}/)?.[1];
  assert.ok(surface, 'the flat surface rule is present');
  // Plain CSS includes border-radius; rounding is not a visible border.
  assert.doesNotMatch(surface, /(?:^|;)\s*(?:border(?:-(?!radius\b)[a-z-]+)?|box-shadow)\s*:/);
});
