import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectDesignViolationsForFile,
  collectSourceDesignViolations,
  loadDesignRules,
  validateProjectDesign,
  validateSourceDesign,
} from '../src/runtime/app-boundary-validator.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const rulesPath = resolve(testDir, '../../../server/config/notis_app_design_rules.json');
const rules = JSON.parse(readFileSync(rulesPath, 'utf-8'));
// Shared with server/tests/test_space_design_check.py so both validators stay in step.
const { cases, clean } = JSON.parse(readFileSync(join(testDir, 'fixtures/space-design-cases.json'), 'utf-8'));
const space = loadDesignRules({ rulesPath, profile: 'space' });
const app = loadDesignRules({ rulesPath, profile: 'app' });
const ruleIds = (file, content, config = space) => new Set(collectDesignViolationsForFile(file, content, config).map((v) => v.ruleId));

test('every Space rule has a shared case', () => {
  const spaceRules = rules.rules.filter((rule) => rule.profiles?.includes('space')).map((rule) => rule.id).sort();
  assert.deepEqual([...new Set(cases.map((item) => item.rule))].sort(), spaceRules);
});

for (const item of cases) {
  test(`${item.rule} fires on its bad case only (${item.file})`, () => {
    assert.ok(ruleIds(item.file, item.bad).has(item.rule), item.bad);
    assert.ok(!ruleIds(item.file, item.good).has(item.rule), item.good);
  });
  test(`${item.rule} stays out of the app profile (${item.file})`, () => {
    assert.ok(!ruleIds(item.file, item.bad, app).has(item.rule));
  });
}

for (const item of clean) {
  test(`${item.name} passes the Space profile with no finding (${item.file})`, () => {
    assert.deepEqual(collectDesignViolationsForFile(item.file, item.source, space).map((v) => v.ruleId), []);
  });
}

test('the Space profile scans spaces and lib but not tests, fixtures or the vendored SDK', () => {
  const bad = 'export const x = () => <main className="h-screen" />;';
  assert.ok(ruleIds('spaces/meetings/view.tsx', bad).has('space-no-viewport-height'));
  assert.ok(ruleIds('lib/view.tsx', bad).has('space-no-viewport-height'));
  for (const file of ['spaces/meetings/fixtures/view.tsx', 'app/page.test.tsx', 'packages/sdk/src/view.tsx']) {
    assert.equal(ruleIds(file, bad).size, 0, file);
  }
});

test('toolkit rules warn until their piece is listed live, then refuse', () => {
  const toolkit = cases.filter((item) => item.toolkit);
  for (const item of toolkit) {
    const found = collectDesignViolationsForFile(item.file, item.bad, space).find((v) => v.ruleId === item.rule);
    assert.equal(found.severity, 'warn', item.rule);
  }
  const dir = mkdtempSync(join(tmpdir(), 'space-design-'));
  try {
    const livePath = join(dir, 'rules.json');
    writeFileSync(livePath, JSON.stringify({ ...rules, toolkit_live_pieces: ['SelectionBar'] }));
    const live = loadDesignRules({ rulesPath: livePath, profile: 'space' });
    const severity = Object.fromEntries(live.rules.map((rule) => [rule.id, rule.severity]));
    assert.equal(severity['toolkit-selection-bar'], 'error');
    assert.equal(severity['toolkit-keycap'], 'warn');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('validateSourceDesign refuses base64 release files with each file and line', () => {
  const files = { 'app/page.tsx': Buffer.from('export default () => <main className="h-screen" />;').toString('base64') };
  assert.throws(() => validateSourceDesign(files, { encoding: 'base64' }),
    /Space violates the Notis Spaces design bar \(1 issue\)[\s\S]*app\/page\.tsx:1 \[space-no-viewport-height\]/);
  const clean = { 'app/page.tsx': Buffer.from('export default () => <main className="h-full">{copy.title}</main>;').toString('base64') };
  assert.doesNotThrow(() => validateSourceDesign(clean, { encoding: 'base64' }));
  assert.equal(collectSourceDesignViolations(clean, space, { encoding: 'base64' }).length, 0);
});

test('toolkit warnings print but never block a Space build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'space-design-'));
  try {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app/page.tsx'), 'export default () => <MultiSelectActionBar count={count} />;\n');
    const lines = [];
    validateProjectDesign(dir, { profile: 'space', log: (line) => lines.push(line) });
    assert.ok(lines.some((line) => line.includes('[toolkit-selection-bar] warn')));
    writeFileSync(join(dir, 'app/page.tsx'), "window.addEventListener('keydown', onKey);\n");
    assert.throws(() => validateProjectDesign(dir, { profile: 'space' }), /space-no-global-key-listener/);
    assert.doesNotThrow(() => validateProjectDesign(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Space messages point at the toolkit; app messages stay as they were', () => {
  const rule = (config, id) => config.rules.find((item) => item.id === id);
  const raw = Object.fromEntries(rules.rules.map((item) => [item.id, item]));
  assert.equal(rule(app, 'no-search-input').message, raw['no-search-input'].message);
  assert.equal(rule(space, 'no-search-input').message, raw['no-search-input'].profile_messages.space);
  assert.match(rule(space, 'no-search-input').message, /search prop from @notis\/sdk\/ui/);
  assert.doesNotMatch(rule(space, 'no-search-input').message, /useTopBarSearch/);
  assert.ok(rule(app, 'no-app-shell-split'));
  assert.equal(rule(space, 'no-app-shell-split'), undefined);
  for (const item of space.rules.filter((entry) => entry.id.startsWith('toolkit-'))) {
    assert.match(item.message, /@notis\/sdk\/ui/, item.id);
  }
  const shell = 'export default () => <div className="notis-app-shell"><aside /></div>;';
  assert.ok(ruleIds('app/page.tsx', shell, app).has('no-app-shell-split'));
  assert.ok(!ruleIds('app/page.tsx', shell).has('no-app-shell-split'));
});

test('comments never trigger a rule, and line numbers stay put', () => {
  const css = '/* Never h-screen or 100vh,\n   and no #ff0000 either. */\n.pane { height: 100vh; }\n';
  const found = collectDesignViolationsForFile('app/globals.css', css, space);
  assert.deepEqual(found.map((v) => [v.ruleId, v.line]), [['space-no-viewport-height', 3]]);
  const tsx = 'const link = "https://notis.ai/docs"; // h-screen\nexport const A = () => <div className="h-full" />; /* border */\n';
  assert.deepEqual(collectDesignViolationsForFile('app/page.tsx', tsx, app).map((v) => v.ruleId), []);
  assert.deepEqual(collectDesignViolationsForFile('app/page.tsx', tsx, space).map((v) => v.ruleId), []);
});

test('a profile_severity override warns in that profile only and never blocks there', () => {
  const rule = (config, id) => config.rules.find((item) => item.id === id);
  for (const id of ['space-no-viewport-height', 'space-no-global-key-listener', 'no-hex-color', 'no-side-bar', 'no-page-heading', 'space-no-english-literal']) {
    assert.equal(rule(space, id).severity, 'error', id);
  }
  const dir = mkdtempSync(join(tmpdir(), 'space-design-'));
  try {
    const path = join(dir, 'rules.json');
    writeFileSync(path, JSON.stringify({
      ...rules,
      rules: rules.rules.map((item) => (item.id === 'no-hex-color' ? { ...item, profile_severity: { space: 'warn' } } : item)),
    }));
    const warnSpace = loadDesignRules({ rulesPath: path, profile: 'space' });
    const warnApp = loadDesignRules({ rulesPath: path, profile: 'app' });
    assert.equal(rule(warnSpace, 'no-hex-color').severity, 'warn');
    assert.equal(rule(warnApp, 'no-hex-color').severity, 'error');
    assert.equal(rule(warnSpace, 'no-side-bar').severity, 'error', 'the override touches only its own rule');
    const source = "const fill = '#ff0000';\n";
    const [inSpace] = collectDesignViolationsForFile('app/chart.tsx', source, warnSpace);
    const [inApp] = collectDesignViolationsForFile('app/chart.tsx', source, warnApp);
    assert.deepEqual([inSpace.ruleId, inSpace.severity, inSpace.allowed], ['no-hex-color', 'warn', false]);
    assert.deepEqual([inApp.ruleId, inApp.severity, inApp.allowed], ['no-hex-color', 'error', false]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the retired style rules no longer fire: borders, shadows, gradients, serif and a centred column pass both profiles', () => {
  const styled = 'export default () => <div className="mx-auto max-w-2xl border shadow-md bg-gradient-to-b font-serif">{t.x}</div>;\n';
  const encoded = { 'app/page.tsx': Buffer.from(styled).toString('base64') };
  for (const profile of ['space', 'app']) {
    assert.deepEqual(validateSourceDesign(encoded, { encoding: 'base64', profile }), [], profile);
  }
  const dir = mkdtempSync(join(tmpdir(), 'space-style-'));
  try {
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app/page.tsx'), styled);
    const lines = [];
    assert.deepEqual(validateProjectDesign(dir, { profile: 'space', log: (line) => lines.push(line) }), []);
    assert.deepEqual(validateProjectDesign(dir), []);
    assert.deepEqual(lines, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
