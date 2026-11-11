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
  'no-side-bar': '<li className="border-l-2 border-l-foreground" />',
  'no-palette-hue': '<span className="text-emerald-700" />',
  'no-hex-color': "const color = '#8b5cf6';",
  'no-tiny-text': '<p className="text-[11px]">meta</p>',
  'no-raw-select': '<select value={value} />',
  'no-search-input': '<Input placeholder="Search skills" />',
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

test('one-side edges fire in every profile: thick or coloured borders and one-side inset shadows', () => {
  const ids = (file, content, profile) => collectDesignViolationsForFile(file, `${content}\n`, loadDesignRules({ rulesPath, profile }))
    .map((violation) => violation.ruleId);
  const bad = [
    ['app/page.tsx', '<li className="border-b-2 border-foreground" />'],
    ['app/page.tsx', '<li className="border-l-[3px]" />'],
    ['app/page.tsx', '<li className="border-l border-l-primary" />'],
    ['app/page.tsx', '<li className="shadow-[inset_2px_0_0_hsl(var(--primary))]" />'],
    ['app/page.tsx', "<li style={{ boxShadow: 'inset 2px 0 0 hsl(var(--primary))' }} />"],
    ['app/page.tsx', "<li style={{ borderLeft: '3px solid hsl(var(--primary))' }} />"],
    ['app/globals.css', '.row[data-active] { box-shadow: inset 2px 0 0 hsl(var(--foreground)); }'],
    ['app/globals.css', '.row { border-left: 2px solid hsl(var(--primary)); }'],
    ['app/globals.css', '.row { border-inline-start-color: hsl(var(--primary)); }'],
    ['app/globals.css', '.row { border-bottom-width: 2px; }'],
  ];
  for (const profile of ['app', 'space']) {
    for (const [file, content] of bad) assert.ok(ids(file, content, profile).includes('no-side-bar'), `${profile}: ${content}`);
  }
  const clean = [
    ['app/page.tsx', '<li className="border-b border-border/50 lg:border-r" />'],
    ['app/page.tsx', '<li className="shadow-[inset_0_0_0_1px_hsl(var(--ring))] border-t-0" />'],
    ['app/globals.css', '.row[data-active] { box-shadow: inset 0 0 0 1px hsl(var(--ring)); }'],
    ['app/globals.css', '.head { box-shadow: inset 0 -1px 0 hsl(var(--border) / 0.8); }'],
    ['app/globals.css', '.row { border-bottom: 1px solid hsl(var(--border) / 0.5); border-top: 0; }'],
    ['app/globals.css', '.row { border-top-left-radius: 6px; border-left-width: 1px; }'],
  ];
  for (const [file, content] of clean) assert.ok(!ids(file, content, 'app').includes('no-side-bar'), content);
});

test('exempt form controls and files outside app/ and components/ are skipped', () => {
  const config = loadDesignRules({ rulesPath });
  const tinted = '<input className="bg-rose-500" />\n';
  assert.deepEqual(collectDesignViolationsForFile('components/ui/input.tsx', tinted, config), []);
  assert.deepEqual(collectDesignViolationsForFile('lib/tasks.ts', "const c = 'bg-rose-500';\n", config), []);
  assert.deepEqual(collectDesignViolationsForFile('app/page.md', tinted, config), []);
  assert.ok(collectDesignViolationsForFile('components/task-row.tsx', tinted, config).length > 0);
});

test('an inline notis-design-allow directive with a reason downgrades the match to an allowed warning', () => {
  const config = loadDesignRules({ rulesPath });
  const source = [
    '// notis-design-allow: no-palette-hue priority dot keeps the brand emerald',
    '<span className="size-4 rounded-full bg-emerald-500" />',
    '<p className="text-[11px]">{meta}</p> {/* notis-design-allow: no-tiny-text legacy table markup kept */}',
    '// notis-design-allow: no-hex-color nope',
    "const fill = '#ff0000';",
  ].join('\n');
  const violations = collectDesignViolationsForFile('components/task-row.tsx', `${source}\n`, config);
  const byRule = Object.fromEntries(violations.map((violation) => [violation.ruleId, violation]));
  assert.equal(byRule['no-palette-hue'].allowed, true);
  assert.equal(byRule['no-palette-hue'].severity, 'warn');
  assert.equal(byRule['no-palette-hue'].reason, 'priority dot keeps the brand emerald');
  assert.equal(byRule['no-tiny-text'].allowed, true);
  assert.equal(byRule['no-tiny-text'].severity, 'warn');
  assert.equal(byRule['no-hex-color'].allowed, false, 'a reason shorter than the minimum does not allow');
  assert.equal(byRule['no-hex-color'].severity, 'error');
  assert.match(byRule['no-hex-color'].message, /reason of at least/);
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
    'app/page.tsx': 'export default function Page() { return <div className="rounded-xl bg-emerald-50">x</div>; }\n',
    'node_modules/dep/index.js': 'const hue = "bg-emerald-50";\n',
  });
  try {
    assert.throws(
      () => validateProjectDesign(projectDir, { enforce: true }),
      (error) => /app\/page\.tsx:1 \[no-palette-hue\]/.test(error.message) && /notis-design-allow/.test(error.message),
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

test('a profile message replaces the message in that profile only', () => {
  const raw = JSON.parse(readFileSync(rulesPath, 'utf-8')).rules.find((rule) => rule.id === 'no-loading-placeholder');
  const space = loadDesignRules({ rulesPath, profile: 'space' }).rules.find((rule) => rule.id === 'no-loading-placeholder');
  const app = loadDesignRules({ rulesPath }).rules.find((rule) => rule.id === 'no-loading-placeholder');
  assert.equal(space.message, raw.profile_messages.space);
  assert.equal(app.message, raw.message);
  assert.match(space.message, /Skeleton from @notis\/sdk\/ui/);
  assert.doesNotMatch(space.message, /ViewSkeleton/);
  assert.match(app.message, /ViewSkeleton/);
  const found = collectDesignViolationsForFile('app/page.tsx', '<p className="text-sm">Loading…</p>\n', loadDesignRules({ rulesPath, profile: 'space' }))
    .find((violation) => violation.ruleId === 'no-loading-placeholder');
  assert.equal(found.message, raw.profile_messages.space);
});
