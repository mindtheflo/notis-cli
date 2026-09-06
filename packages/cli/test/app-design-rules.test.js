import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectDesignViolationsForFile,
  collectProjectDesignViolations,
  loadDesignRules,
  validateProjectDesign,
} from '../src/runtime/app-boundary-validator.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../..');
const rulesPath = join(repoRoot, 'server', 'config', 'notis_app_design_rules.json');

const RULE_FIXTURES = {
  'no-border-box': '<div className="rounded-xl border bg-background" />',
  'no-side-bar': '<li className="border-l-2 border-l-foreground" />',
  'no-dashed-box': '<div className="rounded-xl border-dashed" />',
  'no-divide': '<ul className="divide-y" />',
  'no-ring-box': '<div className="ring-1 ring-ring" />',
  'no-shadow': '<div className="rounded-xl shadow-md" />',
  'no-floating-shadow-without-popover': '<div className="rounded-xl bg-muted shadow-lg" />',
  'no-palette-hue': '<span className="text-emerald-700" />',
  'no-hex-color': "const color = '#8b5cf6';",
  'no-gradient': '<div className="bg-gradient-to-r from-primary" />',
  'no-backdrop-blur': '<header className="backdrop-blur" />',
  'no-eyebrow': '<p className="text-xs uppercase tracking-[0.18em]">Overview</p>',
  'no-tiny-text': '<p className="text-[11px]">meta</p>',
  'no-badge-outline': '<Badge variant="outline">Draft</Badge>',
  'no-raw-select': '<select value={value} />',
  'no-search-input': '<Input placeholder="Search skills" />',
  'no-font-serif': '<blockquote className="font-serif italic" />',
  'no-loading-placeholder': '<p className="text-sm">Loading…</p>',
};

test('design rules file parses and every rule has an id, pattern, and message', () => {
  const parsed = JSON.parse(readFileSync(rulesPath, 'utf-8'));
  assert.ok(Array.isArray(parsed.rules) && parsed.rules.length >= 15);
  for (const rule of parsed.rules) {
    assert.ok(rule.id && rule.pattern && rule.message, `rule ${JSON.stringify(rule)} is incomplete`);
    assert.doesNotThrow(() => new RegExp(rule.pattern, 'gm'));
  }
});

test('each design rule fires on its fixture and nothing else', () => {
  const config = loadDesignRules({ rulesPath });
  for (const [ruleId, snippet] of Object.entries(RULE_FIXTURES)) {
    const violations = collectDesignViolationsForFile('app/page.tsx', `${snippet}\n`, config);
    const ids = violations.map((violation) => violation.ruleId);
    assert.ok(ids.includes(ruleId), `${ruleId} should fire on ${snippet}, got ${ids.join(',') || 'nothing'}`);
  }
});

test('the split-layout rule fires only when a shell page also renders an aside', () => {
  const config = loadDesignRules({ rulesPath });
  const bad = '<main className="notis-app-shell">\n<aside />\n</main>\n';
  const good = '<main className="notis-app-split">\n<aside className="notis-app-pane-list" />\n</main>\n';
  assert.ok(collectDesignViolationsForFile('app/page.tsx', bad, config).some((v) => v.ruleId === 'no-app-shell-split'));
  assert.ok(!collectDesignViolationsForFile('app/page.tsx', good, config).some((v) => v.ruleId === 'no-app-shell-split'));
});

test('allowed patterns do not fire: hairlines, focus rings, popover shadows, tokens', () => {
  const config = loadDesignRules({ rulesPath });
  const clean = [
    '<section className="border-t border-border pt-4" />',
    '<aside className="lg:border-r lg:border-border bg-muted/40" />',
    '<button className="focus-visible:ring-2 focus-visible:ring-ring" />',
    '<div className="bg-popover shadow-lg rounded-lg" />',
    '<span className="text-primary bg-primary/10 text-destructive" />',
    '<p className="text-xs text-muted-foreground">Updated</p>',
    '<Badge variant="secondary">Live</Badge>',
    '<NativeSelect value={v} />',
    '<ViewSkeleton variant="table" rows={4} />',
    "useTopBarSearch({ placeholder: 'Search leads' })",
  ].join('\n');
  assert.deepEqual(collectDesignViolationsForFile('app/page.tsx', `${clean}\n`, config), []);
});

test('exempt form controls and files outside app/ and components/ are skipped', () => {
  const config = loadDesignRules({ rulesPath });
  const bordered = '<input className="border border-input" />\n';
  assert.deepEqual(collectDesignViolationsForFile('components/ui/input.tsx', bordered, config), []);
  assert.deepEqual(collectDesignViolationsForFile('lib/tasks.ts', "const c = 'bg-rose-500';\n", config), []);
  assert.deepEqual(collectDesignViolationsForFile('app/page.md', bordered, config), []);
  assert.ok(collectDesignViolationsForFile('components/task-row.tsx', bordered, config).length > 0);
});

test('an inline notis-design-allow directive with a reason downgrades the match to an allowed warning', () => {
  const config = loadDesignRules({ rulesPath });
  const source = [
    '// notis-design-allow: no-border-box priority checkbox needs a visible unchecked ring',
    '<span className="size-4 rounded-full border" />',
    '<div className="divide-y" /> {/* notis-design-allow: no-divide legacy table markup kept */}',
    '// notis-design-allow: no-shadow nope',
    '<div className="shadow-md" />',
  ].join('\n');
  const violations = collectDesignViolationsForFile('components/task-row.tsx', `${source}\n`, config);
  const byRule = Object.fromEntries(violations.map((violation) => [violation.ruleId, violation]));
  assert.equal(byRule['no-border-box'].allowed, true);
  assert.equal(byRule['no-border-box'].severity, 'warn');
  assert.equal(byRule['no-border-box'].reason, 'priority checkbox needs a visible unchecked ring');
  assert.equal(byRule['no-divide'].allowed, true);
  assert.equal(byRule['no-shadow'].allowed, false, 'a reason shorter than the minimum does not allow');
  assert.match(byRule['no-shadow'].message, /reason of at least/);
});

function createProject(files) {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-design-rules-'));
  for (const [relPath, content] of Object.entries(files)) {
    mkdirSync(dirname(join(projectDir, relPath)), { recursive: true });
    writeFileSync(join(projectDir, relPath), content);
  }
  return projectDir;
}

test('validateProjectDesign throws with file:line in enforce mode and only logs in dev mode', () => {
  const projectDir = createProject({
    'app/page.tsx': 'export default function Page() { return <div className="rounded-xl border">x</div>; }\n',
    'node_modules/dep/index.js': 'const border = "border";\n',
  });
  try {
    assert.throws(
      () => validateProjectDesign(projectDir, { enforce: true }),
      (error) => /app\/page\.tsx:1 \[no-border-box\]/.test(error.message) && /notis-design-allow/.test(error.message),
    );
    const logged = [];
    const violations = validateProjectDesign(projectDir, { enforce: false, log: (message) => logged.push(message) });
    assert.equal(violations.length, 1);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^\[design\] app\/page\.tsx:1/);
    assert.deepEqual(collectProjectDesignViolations(projectDir).map((v) => v.file), ['app/page.tsx']);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
