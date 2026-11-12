import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { StatusIcon, statusGroup } from '../list/Row';
import * as uiExports from '../index';
import { Badge, Button, Section, SegmentedControl, ToggleGroup } from './blocks';
import { DataTable, autoFit, dataTableHideCss, type DataTableColumn } from './DataTable';
import { InfoTip } from './InfoTip';
import { Meter } from './Meter';
import * as blockExports from './index';

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode, locale: 'en' | 'fr' = 'en') {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  const engine = new KeyboardEngineCore();
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale={locale} platform="mac" engine={engine} document={doc} strict>{node}</KeyboardEngine>);
  });
}

async function click(target: Element) {
  await act(async () => { (target as HTMLElement).click(); });
}

const toolkitCss = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');

/** The declarations of the rule written exactly as `selector {` at the start of a line. */
function cssRule(selector: string): string | null {
  const at = toolkitCss.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = toolkitCss.indexOf('{', at);
  return toolkitCss.slice(open + 1, toolkitCss.indexOf('}', open)).trim();
}

/** The alpha of a rule's `background: hsl(... / a)`, 0 for transparent. */
function fillAlpha(selector: string): number {
  const fill = cssRule(selector)?.match(/background: ([^;]+);/)?.[1];
  assert.ok(fill, `${selector} sets a background`);
  if (fill === 'transparent') return 0;
  return Number(fill.match(/\/ ?([.\d]+)\)$/)?.[1] ?? 1);
}

test('Button: secondary and link variants; pressed makes a toggle; neither a ghost hover nor an off toggle hover looks on', async () => {
  await mount(
    <>
      <Button variant="secondary">Export</Button>
      <Button variant="link">{{ en: 'Open the report', fr: 'Ouvrir le rapport' }}</Button>
      <Button variant="ghost" pressed={false}>Pro</Button>
      <Button pressed>Ultra</Button>
      <Button>Plain</Button>
    </>,
    'fr',
  );
  const [secondary, link, off, on, plain] = [...doc.querySelectorAll('button')];
  assert.equal(secondary.dataset.variant, 'secondary');
  assert.equal(link.dataset.variant, 'link');
  assert.equal(link.textContent, 'Ouvrir le rapport');
  assert.equal(off.getAttribute('aria-pressed'), 'false');
  assert.equal(on.getAttribute('aria-pressed'), 'true');
  assert.equal(plain.hasAttribute('aria-pressed'), false, 'a plain button is no toggle');

  assert.match(cssRule('.nui-btn[data-variant="secondary"]') ?? '', /background: hsl\(var\(--secondary\)\);/);
  assert.match(cssRule('.nui-btn[data-variant="link"]') ?? '', /color: hsl\(var\(--primary\)\);/);
  assert.match(cssRule('.nui-btn[data-variant="link"]:hover:not(:disabled)') ?? '', /text-decoration: underline;/);
  const onFill = fillAlpha('.nui-btn[aria-pressed="true"]');
  assert.equal(fillAlpha('.nui-btn[aria-pressed]'), 0, 'an off toggle is quiet whatever its variant');
  assert.ok(fillAlpha('.nui-btn[aria-pressed]:hover:not(:disabled)') < onFill, 'an off toggle under the pointer stays lighter than on');
  assert.ok(fillAlpha('.nui-btn[data-variant="ghost"]:hover:not(:disabled)') < onFill, 'a ghost hover is not the on tint');
  assert.ok(fillAlpha('.nui-btn[aria-pressed="true"]:hover:not(:disabled)') > onFill, 'an on toggle under the pointer stays on');
  // The toggle look comes after the variants, so it wins over them at the same specificity.
  assert.ok(toolkitCss.indexOf('\n.nui-btn[aria-pressed] {') > toolkitCss.indexOf('\n.nui-btn[data-variant="link"] {'));
});

test('ToggleGroup: a named group of pressed buttons, any number on; a press gives the next set in option order', async () => {
  const seen: string[][] = [];
  function Tiers() {
    const [value, setValue] = useState<string[]>(['ultra']);
    return (
      <ToggleGroup
        label={{ en: 'Tiers', fr: 'Offres' }}
        value={value}
        onChange={(next) => { seen.push(next); setValue(next); }}
        options={[
          { value: 'free', label: { en: 'Free', fr: 'Gratuit' }, count: 3 },
          { value: 'pro', label: 'Pro', icon: <span className="swatch" /> },
          { value: 'ultra', label: 'Ultra' },
          { value: 'team', label: 'Team', disabled: true },
        ]}
      />
    );
  }
  await mount(<Tiers />, 'fr');
  const group = doc.querySelector('.nui-toggles')!;
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'Offres');
  const buttons = [...group.querySelectorAll('button')];
  assert.deepEqual(buttons.map((button) => button.getAttribute('aria-pressed')), ['false', 'false', 'true', 'false']);
  assert.equal(buttons[0].textContent, 'Gratuit3');
  assert.equal(buttons[0].querySelector('.nui-btn-count')?.textContent, '3');
  assert.ok(buttons[1].querySelector('.swatch'), 'an option icon may be any node, a colour swatch for a series');
  assert.equal(buttons[0].dataset.size, 'sm');
  assert.equal(buttons[3].disabled, true);

  await click(buttons[0]);
  assert.deepEqual(seen.at(-1), ['free', 'ultra'], 'turning one on keeps option order');
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  await click(buttons[2]);
  assert.deepEqual(seen.at(-1), ['free']);
  await click(buttons[0]);
  assert.deepEqual(seen.at(-1), [], 'the caller decides what an empty set means');
  assert.deepEqual(buttons.map((button) => button.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false']);
});

test('Section: a flat full-width section per kind; its head is an h2 data label with what is given, or nothing', async () => {
  await mount(
    <>
      <Section
        kind="chart"
        title={{ en: 'Requests per day', fr: 'Requêtes par jour' }}
        meta={{ en: 'Last 14 days', fr: '14 derniers jours' }}
        tabs={<SegmentedControl value="bars" onChange={() => {}} options={[{ value: 'bars', label: 'Bars' }, { value: 'line', label: 'Line' }]} />}
      >
        <div className="bars" />
      </Section>
      <Section title="Incidents" count={0} actions={<Button>New</Button>}>rows</Section>
      <Section kind="form">fields</Section>
      <Section kind="stats" meta={<a href="#source">PostHog</a>}>strip</Section>
    </>,
    'fr',
  );
  const [chart, data, form, stats] = [...doc.querySelectorAll('section.nui-section')] as HTMLElement[];
  assert.deepEqual([chart, data, form, stats].map((section) => section.dataset.kind), ['chart', 'data', 'form', 'stats'], 'data is the default kind');
  const parts = (section: Element) => [...section.querySelector('.nui-section-head')!.children].map((child) => child.className);
  assert.deepEqual(parts(chart), ['nui-section-title', 'nui-section-meta', 'nui-section-tabs']);
  assert.equal(chart.querySelector('.nui-section-title')?.tagName, 'H2', 'a data label under the page, never a page title');
  assert.equal(chart.querySelector('.nui-section-title')?.textContent, 'Requêtes par jour');
  assert.equal(chart.querySelector('.nui-section-meta')?.textContent, '14 derniers jours');
  assert.ok(chart.querySelector('.nui-section-head + .bars'), 'the content follows the head');
  assert.deepEqual(parts(data), ['nui-section-title', 'nui-section-count', 'nui-section-actions']);
  assert.equal(data.querySelector('.nui-section-count')?.textContent, '0', 'a count of 0 still shows');
  assert.equal(data.querySelector('.nui-section-actions button')?.textContent, 'New');
  assert.equal(form.querySelector('.nui-section-head'), null, 'nothing to show, no head');
  assert.equal(form.textContent, 'fields');
  assert.equal(stats.querySelector('.nui-section-meta a')?.getAttribute('href'), '#source', 'meta may be any content');
  assert.equal(doc.querySelector('h1'), null, 'the page title lives in the top bar');

  // No box on any kind: no background, ring, radius, shadow, frame or edge on one side (C23). A full-width hairline
  // above and below a strip (border-block) is no box.
  const sectionRules = [...toolkitCss.matchAll(/\n([^\n{}]*\.nui-section[^\n{}]*) \{([^}]*)\}/g)];
  assert.ok(sectionRules.length >= 10, 'the section rules are found');
  for (const [, selector, body] of sectionRules) {
    assert.doesNotMatch(body, /background|box-shadow|border-radius|outline|border(-(left|right|top|bottom|inline))?: (?!0;)/, selector);
  }
  assert.match(cssRule('.nui-section[data-kind="bar"]') ?? '', /padding: 12px 24px 0;/);
  assert.match(cssRule('.nui-section[data-kind="chart"]') ?? '', /padding: 32px 24px 0;/);
  assert.match(cssRule('.nui-section[data-kind="data"]') ?? '', /padding-top: 40px;/);
  assert.match(cssRule('.nui-section[data-kind="data"] > .nui-section-head') ?? '', /padding: 0 24px 12px;/);
  assert.match(cssRule('.nui-section[data-kind="data"] .nui-ctable :is(th, td):first-child') ?? '', /padding-left: 24px;/);
  assert.match(cssRule('.nui-table > * > :where(tr) > :is(th, td):first-child:not(.nui-group-head)') ?? '', /padding-left: 24px;/, 'a ListReader table insets 24px anywhere');
  const formRule = cssRule('.nui-section[data-kind="form"]') ?? '';
  assert.match(formRule, /padding: 24px 24px 0;/);
  assert.doesNotMatch(formRule, /max-width|auto/, 'a form is left-aligned at 24px; each field caps its own width (C12)');
  assert.match(cssRule('.nui-section-title') ?? '', /font-size: 14px; line-height: 20px; font-weight: 500;/);

  // A TabRow in a section slot takes the room left and folds into More (it never keeps flex-shrink 0 there); a bar's
  // slot scrolls sideways what cannot fold; a narrow chart section wraps its head.
  assert.match(cssRule(':is(.nui-section-tabs, .nui-section[data-kind="bar"]) > .nui-tabrow') ?? '', /flex: 1 1 auto;/);
  assert.match(cssRule(':is(.nui-section-tabs, .nui-section[data-kind="bar"]) > .nui-tabrow > .nui-tabrow-end') ?? '', /margin-left: 0;/);
  const barSlot = cssRule('.nui-section[data-kind="bar"] .nui-section-tabs') ?? '';
  assert.match(barSlot, /flex: 1 1 auto;/);
  assert.match(barSlot, /overflow-x: auto;/);
  assert.match(cssRule('.nui-section[data-kind="bar"] .nui-section-tabs > :not(.nui-tabrow)') ?? '', /flex-shrink: 0;/);
  // A bar that scrolls fades its end edge until scrolled to the end, so a cut control never reads as clipped text.
  assert.match(toolkitCss, /@keyframes nui-bar-end-fade \{ 0%, 96% \{ mask-image: linear-gradient\(to right, #000 calc\(100% - 28px\), transparent\); \} 100% \{ mask-image: none; \} \}/);
  assert.match(toolkitCss, /animation: nui-bar-end-fade linear both; animation-timeline: scroll\(self inline\);/);
  assert.match(cssRule('.nui-section-tabs > .nui-tabrow[data-fold="least"]') ?? '', /min-width: max-content;/);
  assert.match(cssRule('.nui-section[data-kind="chart"]') ?? '', /container: nui-section \/ inline-size;/);
  assert.match(toolkitCss, /@container nui-section \(max-width: 560px\) \{[^@]*\.nui-section-head \{ flex-wrap: wrap; \}[^@]*\.nui-section-tabs \{ flex-basis: 100%; margin-left: 0; \}/);
});

test('blocks: PageHeading and Card are gone from the toolkit, its exports and its CSS; Section and TabRow replace them', () => {
  for (const name of ['PageHeading', 'Card', 'PageHeadingProps', 'CardProps']) {
    assert.equal(name in blockExports, false, `blocks: ${name}`);
    assert.equal(name in uiExports, false, `@notis/sdk/ui: ${name}`);
  }
  assert.equal(typeof uiExports.Section, 'function');
  assert.equal(typeof uiExports.TabRow, 'function');
  assert.doesNotMatch(toolkitCss, /\.nui-(heading|card)\b/, 'no heading or card rules are left');
});

test('SegmentedControl: pills with no track, the chosen one tinted like a tab', async () => {
  const seen: string[] = [];
  await mount(
    <SegmentedControl
      label={{ en: 'Chart type', fr: 'Type de graphique' }}
      value="line"
      onChange={(next) => seen.push(next)}
      options={[
        { value: 'bars', label: { en: 'Bars', fr: 'Barres' } },
        { value: 'line', label: { en: 'Line', fr: 'Ligne' } },
        { value: 'area', label: { en: 'Area', fr: 'Aire' }, count: 0 },
      ]}
    />,
    'fr',
  );
  const group = doc.querySelector('.nui-seg')!;
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'Type de graphique');
  const buttons = [...group.querySelectorAll('button')];
  assert.deepEqual(buttons.map((button) => button.textContent), ['Barres', 'Ligne', 'Aire0']);
  assert.deepEqual(buttons.map((button) => button.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  await click(buttons[1]);
  assert.deepEqual(seen, [], 'the chosen option does not call back');
  await click(buttons[0]);
  assert.deepEqual(seen, ['bars']);

  assert.doesNotMatch(cssRule('.nui-seg') ?? '', /background|border|box-shadow/, 'no track behind the pills');
  const pill = cssRule('.nui-pill, .nui-tab, .nui-seg > button') ?? '';
  assert.match(pill, /height: 28px; padding: 0 8px; border: 0; border-radius: 6px;/);
  assert.match(pill, /font-size: 13px;/);
  assert.match(cssRule('.nui-pill[data-on], .nui-tab[aria-selected="true"], .nui-seg > button[aria-pressed="true"]') ?? '',
    /background: hsl\(var\(--foreground\) \/ \.07\);.*font-weight: 500;/);
});

test('Badge takes words; StatusIcon knows a service that is up or down, with its own words', async () => {
  assert.deepEqual(['Up', 'operational', 'online'].map(statusGroup), ['up', 'up', 'up']);
  assert.deepEqual(['Down', 'offline', 'outage', 'unreachable'].map(statusGroup), ['down', 'down', 'down', 'down']);
  await mount(
    <>
      <Badge icon={<StatusIcon status="up" decorative />}>{{ en: 'Up', fr: 'Disponible' }}</Badge>
      <StatusIcon status="up" />
      <StatusIcon status="Down" />
      <StatusIcon status="outage" label={{ en: 'Partial outage', fr: 'Panne partielle' }} />
    </>,
    'fr',
  );
  const badge = doc.querySelector('.nui-badge')!;
  assert.equal(badge.textContent, 'Disponible', 'words in a badge are shown in the toolkit locale');
  assert.equal(badge.querySelector('.nui-st')?.getAttribute('data-st'), 'up');
  const icons = [...doc.querySelectorAll('.nui-st[role="img"]')];
  assert.deepEqual(icons.map((icon) => icon.getAttribute('aria-label')), ['Disponible', 'Indisponible', 'Panne partielle']);
  assert.deepEqual(icons.map((icon) => icon.getAttribute('data-st')), ['up', 'down', 'down']);
  assert.ok(icons.every((icon) => icon.querySelector('svg circle')), 'each draws its icon');
  assert.match(cssRule('.nui-st[data-st="up"]') ?? '', /--nui-st-up, var\(--muted-foreground\)/, 'up is calm, like done work');
  assert.match(cssRule('.nui-st[data-st="down"]') ?? '', /--nui-st-down, var\(--destructive\)/);
});

test('StatusIcon: ready for review is its own group, a fuller circle in the active colour, with its own words', async () => {
  assert.deepEqual(
    ['Ready for review', 'In review', 'in-review', 'needs_review', 'Review', 'Awaiting review'].map(statusGroup),
    ['review', 'review', 'review', 'review', 'review', 'review'],
  );
  assert.deepEqual(['Pending', 'Blocked', 'In progress'].map(statusGroup), ['waiting', 'waiting', 'active'], 'the others keep their groups');
  await mount(<><StatusIcon status="Ready for review" /><StatusIcon status="in_review" decorative /></>, 'fr');
  const [icon, decorative] = [...doc.querySelectorAll('.nui-st')];
  assert.equal(icon.getAttribute('data-st'), 'review');
  assert.equal(icon.getAttribute('aria-label'), '\u00c0 relire');
  assert.equal(decorative.getAttribute('aria-hidden'), 'true');
  // Three quarters filled: a circle outline and a filled wedge, fuller than the half circle of active work.
  assert.ok(icon.querySelector('svg circle') && icon.querySelector('svg path[fill="currentColor"]'));
  await mount(<StatusIcon status="review" />, 'en');
  assert.equal(doc.querySelector('.nui-st')?.getAttribute('aria-label'), 'Ready for review');
  assert.match(cssRule('.nui-st[data-st="review"]') ?? '', /--nui-st-review, var\(--muted-foreground\)/);
  assert.match(toolkitCss, /--nui-st-review: var\(--status-live, var\(--nui-st-live, 142 71% 33%\)\);/, 'the active colour, from the one palette');
});

test('DataTable: the last columns that do not fit hide first, never the primary, until the overflow fits', () => {
  // Thread (primary) 140, Machine 128, Turn 176, Stack 128, Workspace 0 (already hidden by hideBelow).
  const widths = [140, 128, 176, 128, 0];
  assert.deepEqual(autoFit(0, widths, 0).hidden, [], 'nothing overflows, nothing hides');
  assert.deepEqual(autoFit(100, widths, 0).hidden, [3], 'the last shown column goes first');
  assert.deepEqual(autoFit(200, widths, 0).hidden, [2, 3], 'then the one before it');
  assert.deepEqual(autoFit(9999, widths, 0).hidden, [1, 2, 3], 'the primary always stays');
  assert.deepEqual(autoFit(50, [128, 300], 1).hidden, [0], 'a primary last column stays; the one before it goes');
  // The new last column takes the 24px inset in place of its 12px padding: 125 freed is short of 120 + 12.
  assert.deepEqual(autoFit(120, [200, 300, 125], 1), { hidden: [0, 2], first: 1, last: 1 },
    'the inset the new edge column gains counts against the room freed');
  assert.deepEqual(autoFit(110, [200, 300, 125], 1), { hidden: [2], first: 0, last: 1 }, '125 covers 110 + 12');
  assert.deepEqual(autoFit(10, [200, 300, 120, 20], 1, [false, false, true, false]), { hidden: [3], first: 0, last: 2 },
    'a fixed-width column keeps its padding inside its width, so becoming the edge costs nothing');
  // A column a hideBelow rule hides measures 0: the edge insets go to the columns really shown.
  assert.deepEqual(autoFit(100, [200, 300, 0, 120], 1), { hidden: [3], first: 0, last: 1 },
    'the hidden region column (2) never takes the right inset');
  assert.deepEqual(autoFit(150, [160, 300, 90, 0], 1), { hidden: [0, 2], first: 1, last: 1 },
    'when the first column hides, the next one shown takes the left inset');
  assert.deepEqual(autoFit(0, [200, 300], 1), { hidden: [], first: -1, last: -1 }, 'nothing to hide');
});

test('InfoTip: an info button named after what it explains opens its text on press, in English and French', async () => {
  await mount(<InfoTip label={{ en: 'Dev stacks', fr: 'Stacks de dev' }}>Counted on machines that are on.</InfoTip>);
  const button = doc.querySelector<HTMLButtonElement>('button.nui-infotip')!;
  assert.equal(button.getAttribute('aria-label'), 'About Dev stacks');
  assert.ok(button.querySelector('svg.nui-icon'), 'the built-in info icon');
  assert.equal(doc.querySelector('.nui-infotip-body'), null, 'closed until pressed: a tap works where a tooltip never shows');
  await click(button);
  assert.equal(doc.querySelector('.nui-infotip-body')?.textContent, 'Counted on machines that are on.');
  assert.equal(doc.querySelector('[role="dialog"]')?.getAttribute('aria-label'), 'About Dev stacks');
  await mount(<InfoTip label="Cost $& fees">Text.</InfoTip>);
  assert.equal(doc.querySelector('button.nui-infotip')!.getAttribute('aria-label'), 'About Cost $& fees', 'a $ pattern stays as written');
  await mount(<InfoTip>Plain.</InfoTip>, 'fr');
  assert.equal(doc.querySelector('button.nui-infotip')!.getAttribute('aria-label'), 'Plus d’informations');
  assert.ok(uiExports.InfoTip, 'exported from @notis/sdk/ui');
});

test('Meter: role meter named by its label, value text read aloud, a neutral fill until the limit, then destructive', async () => {
  await mount(
    <>
      <Meter label={{ en: 'Memory', fr: 'Mémoire' }} value={8.2} max={36} limit={30} limitLabel="Alert at 30" hint="3 threads" />
      <Meter label="Disk" value={455} max={500} valueText="455 / 500 GiB" limit={400} />
      <Meter label="CPU" value={140} max={100} valueText={<b>busy</b>} limit={150} />
    </>,
    'fr',
  );
  const [memory, disk, cpu] = [...doc.querySelectorAll('[role="meter"]')] as HTMLElement[];
  assert.equal(memory.getAttribute('aria-label'), 'Mémoire');
  assert.equal(memory.getAttribute('aria-valuemin'), '0');
  assert.equal(memory.getAttribute('aria-valuemax'), '36');
  assert.equal(memory.getAttribute('aria-valuenow'), '8.2');
  assert.equal(memory.getAttribute('aria-valuetext'), '8,2 / 36', 'the default figure in the toolkit locale');
  assert.equal(memory.querySelector('.nui-meter-value')?.textContent, '8,2 / 36');
  assert.equal(memory.hasAttribute('data-over'), false);
  assert.equal((memory.querySelector('.nui-meter-fill') as HTMLElement).style.width, `${(8.2 / 36) * 100}%`);
  assert.equal((memory.querySelector('.nui-meter-limit') as HTMLElement).style.left, `${(30 / 36) * 100}%`);
  assert.equal(memory.querySelector('.nui-meter-hint')?.textContent, '3 threads');
  assert.equal(memory.querySelector('.nui-meter-limit-label')?.textContent, 'Alert at 30');

  assert.equal(disk.hasAttribute('data-over'), true, 'at or over the limit');
  assert.equal(disk.getAttribute('aria-valuetext'), '455 / 500 GiB');
  assert.equal(disk.querySelector('.nui-meter-foot'), null, 'no hint and no limit label, no foot line');

  assert.equal(cpu.getAttribute('aria-valuenow'), '100', 'held at max for assistive tech');
  assert.equal(cpu.hasAttribute('aria-valuetext'), false, 'content that is not text is not read as the value');
  assert.equal((cpu.querySelector('.nui-meter-fill') as HTMLElement).style.width, '100%');
  assert.equal(cpu.querySelector('.nui-meter-limit'), null, 'a limit past max draws no tick');
  assert.equal(cpu.hasAttribute('data-over'), false, 'under its limit, even past max');

  // Flat: a 6px rounded track, a neutral fill, destructive only as a fill, never coloured text or a border.
  assert.match(cssRule('.nui-meter-track') ?? '', /height: 6px; border-radius: 9999px; background: hsl\(var\(--foreground\) \/ \.08\);/);
  assert.match(cssRule('.nui-meter-fill') ?? '', /background: hsl\(var\(--foreground\) \/ \.55\);/);
  assert.match(cssRule('.nui-meter[data-over] .nui-meter-fill') ?? '', /background: hsl\(var\(--nui-tone-danger, var\(--destructive\)\)\);/);
  assert.doesNotMatch(toolkitCss, /\.nui-meter[^{]*\{[^}]*(border:|border-left|color: hsl\(var\(--(nui-tone-danger|destructive))/, 'no border, no coloured text');
});

test('Meter: the default figure is rounded like StatRow, and a limit at or under 0 is no limit', async () => {
  await mount(
    <>
      <Meter label="Memory" value={8.23456} max={36} />
      <Meter label="Quota" value={0} max={10} limit={0} />
    </>,
  );
  const [memory, quota] = [...doc.querySelectorAll('[role="meter"]')] as HTMLElement[];
  assert.equal(memory.querySelector('.nui-meter-value')?.textContent, '8.2 / 36');
  assert.equal(quota.hasAttribute('data-over'), false, 'nothing is over a limit of 0');
  assert.equal(quota.querySelector('.nui-meter-limit'), null, 'and no tick is drawn');
});

interface Box { id: string; name: string; region: string; ram: string; state: 'up' | 'down' }

const BOXES: Box[] = [
  { id: 'b1', name: 'build-1', region: 'fra-1', ram: '8.2 / 36', state: 'up' },
  { id: 'b2', name: 'build-2', region: 'fra-1', ram: '31.4 / 36', state: 'up' },
  { id: 'm1', name: 'mac-mini', region: 'local', ram: '0 / 24', state: 'down' },
];

const BOX_COLUMNS: DataTableColumn<Box>[] = [
  { id: 'region', label: 'Region', mono: true, hideBelow: 560, cell: (box) => box.region },
  { id: 'name', label: { en: 'Name', fr: 'Nom' }, primary: true, cell: (box) => box.name },
  { id: 'ram', label: 'Memory', align: 'end', width: 120, hideBelow: 420, cell: (box) => box.ram },
];

test('DataTable: groups with counts, a press target covering each row, columns that hide under their width', async () => {
  const pressed: string[] = [];
  await mount(
    <DataTable columns={BOX_COLUMNS} rowKey={(box) => box.id} label="Machines"
      groups={[
        { key: 'up', label: { en: 'Online', fr: 'En ligne' }, rows: BOXES.filter((box) => box.state === 'up') },
        { key: 'gone', label: 'Retired', rows: [] },
        { key: 'down', label: 'Asleep', rows: BOXES.filter((box) => box.state === 'down') },
      ]}
      onRowPress={(box) => pressed.push(box.id)} rowLabel={(box) => `Open ${box.name}`} />,
    'fr',
  );
  const table = doc.querySelector('table.nui-dtable')!;
  assert.equal(table.getAttribute('aria-label'), 'Machines');
  assert.deepEqual([...table.querySelectorAll('thead th')].map((th) => th.textContent), ['Region', 'Nom', 'Memory']);
  const bodies = [...table.querySelectorAll('tbody')];
  assert.equal(bodies.length, 2, 'a group with no rows is left out');
  const heading = bodies[0].querySelector('tr.nui-dtable-group > th')!;
  assert.equal(heading.getAttribute('scope'), 'colgroup');
  assert.equal(heading.getAttribute('colspan'), '3');
  assert.equal(heading.querySelector('.nui-dtable-group-label')?.textContent, 'En ligne');
  assert.equal(heading.querySelector('.nui-dtable-group-count')?.textContent, '2');

  const rows = [...table.querySelectorAll('tbody tr[data-pressable]')];
  assert.equal(rows.length, 3);
  // The primary cell is the row header and holds the one press target, whatever its column position.
  const primary = rows[0].querySelector('th[scope="row"]')!;
  assert.equal(primary.getAttribute('data-ci'), '1');
  assert.equal(primary.hasAttribute('data-primary'), true);
  const pick = primary.querySelector('button.nui-dtable-pick')!;
  assert.equal(pick.getAttribute('aria-label'), 'Open build-1');
  assert.equal(pick.textContent, 'build-1');
  await click(pick);
  await click(rows[2].querySelector('td')!);
  assert.deepEqual(pressed, ['b1', 'm1'], 'the button and the rest of the row both press, once each');

  const region = rows[0].querySelector('td[data-ci="0"]') as HTMLElement;
  assert.equal(region.getAttribute('data-hide-below'), '560');
  assert.equal(region.hasAttribute('data-mono'), true);
  const ram = rows[0].querySelector('td[data-ci="2"]') as HTMLElement;
  assert.equal(ram.getAttribute('data-align'), 'end');
  assert.equal(ram.style.width, '120px');
  assert.equal(ram.style.maxWidth, '120px');

  // Its own container rules: under 560 the region goes and the name takes the left inset; under 420 the memory goes
  // too and the name takes the right inset as well.
  const css = doc.querySelector('.nui-dtable-wrap > style')?.textContent ?? '';
  const id = table.getAttribute('data-dtable');
  assert.ok(id);
  assert.equal(css, dataTableHideCss(id!, [560, undefined, 420], 1));
  assert.match(css, /max-width: 559\.98px\) \{[^\n]*\[data-ci="1"\] \{ min-width: calc\(var\(--nui-dtable-primary-min, 120px\) \+ 36px\); \}/,
    'the name, now the first column shown, keeps its minWidth inside the wider inset');
  assert.match(css, new RegExp(`@container nui-dtable \\(max-width: 559\\.98px\\) \\{ \\.nui-dtable\\[data-dtable="${id}"\\] > \\* > :where\\(tr\\) > \\[data-hide-below="560"\\] \\{ display: none; \\} [^}]*\\[data-ci="1"\\] \\{ padding-left: 24px; \\} [^}]*\\[data-ci="2"\\] \\{ padding-right: 24px; \\} [^\\n]*\\}$`, 'm'));
  assert.match(css, /max-width: 419\.98px\) \{ [^\n]*\[data-hide-below="420"\] \{ display: none; \}[^\n]*\[data-ci="1"\] \{ padding-left: 24px; \}[^\n]*\[data-ci="1"\] \{ padding-right: 24px; \}/);
  assert.equal(css.indexOf('559.98') < css.indexOf('419.98'), true, 'narrower bands come later, so their rules win');
});

test('DataTable: a table inside a cell gets no sticky header and never counts as a DataTable column', async () => {
  // Only the DataTable's own header row takes the sticky muted header: the header cells of a table a cell holds (a small
  // breakdown) never stick, and they are never measured as columns when the DataTable fits its width.
  const header = cssRule('.nui-dtable > thead > tr > th') ?? '';
  assert.match(header, /position: sticky; top: 0; z-index: 2; height: 36px;/);
  assert.equal(cssRule('.nui-dtable thead th'), null, 'no descendant selector reaches a nested table');
  assert.doesNotMatch(toolkitCss, /\.nui-dtable thead\b/, 'no other rule styles every thead inside the table');

  const columns: DataTableColumn<Box>[] = [
    { id: 'name', label: 'Name', primary: true, cell: (box) => box.name },
    { id: 'ram', label: 'Memory', cell: (box) => box.ram },
    { id: 'split', label: 'Split', cell: (box) => (
      <table className="nested"><thead><tr><th>Used</th><th>Free</th></tr></thead><tbody><tr><td>{box.ram}</td><td>-</td></tr></tbody></table>
    ) },
  ];
  // 100 px of overflow: the DataTable's last column (200 px) is the one to hide. Counting the nested header cells as
  // columns 3 and 4 hid an index no column has, so the table kept overflowing.
  const proto = dom.window.HTMLElement.prototype;
  const saved = (['offsetWidth', 'clientWidth', 'scrollWidth'] as const).map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get(this: HTMLElement) {
    return this.tagName === 'TH' ? (this.closest('table.nested') ? 500 : 200) : 0;
  } });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('nui-dtable-wrap') ? 500 : 0; } });
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('nui-dtable') ? 600 : 0; } });
  try {
    await mount(<DataTable columns={columns} rows={BOXES.slice(0, 1)} rowKey={(box) => box.id} />);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, key, descriptor); else delete (proto as unknown as Record<string, unknown>)[key];
    }
  }
  const css = doc.querySelector('.nui-dtable-wrap > style')?.textContent ?? '';
  assert.match(css, /\[data-ci="2"\] \{ display: none; \}/, 'the last DataTable column hides');
  assert.doesNotMatch(css, /\[data-ci="[34]"\]/, 'no nested header cell is taken for a column');
});

/** A selector's specificity (ids, classes, types): :where() adds nothing, :is() and :not() add their heaviest argument. */
function specificity(selector: string): number[] {
  const total = [0, 0, 0];
  const add = (value: number[]) => value.forEach((n, k) => { total[k]! += n; });
  let i = 0;
  while (i < selector.length) {
    const rest = selector.slice(i);
    const fn = /^:(where|is|not)\(/.exec(rest);
    if (fn) {
      let depth = 1;
      let j = i + fn[0].length;
      for (; depth; j += 1) {
        if (j >= selector.length) throw new Error(`unbalanced selector: ${selector}`);
        if (selector[j] === '(') depth += 1; else if (selector[j] === ')') depth -= 1;
      }
      if (fn[1] !== 'where') add(selectorList(selector.slice(i + fn[0].length, j - 1)).map(specificity).sort(compareSpecificity).at(-1)!);
      i = j;
      continue;
    }
    const token = /^(#[\w-]+|\.[\w-]+|\[[^\]]*\]|::[\w-]+|:[\w-]+|[a-z][\w-]*|\*|[\s>+~]+)/i.exec(rest)?.[0];
    if (!token) throw new Error(`unreadable selector: ${rest}`);
    if (token[0] === '#') total[0]! += 1;
    else if (token[0] === '.' || token[0] === '[' || (token[0] === ':' && token[1] !== ':')) total[1]! += 1;
    else if (/^[a-z]|^::/i.test(token)) total[2]! += 1;
    i += token.length;
  }
  return total;
}
const compareSpecificity = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

/** The toolkit's top-level style rules (prelude and body), comments dropped; rules inside an @-block apply only sometimes. */
function topLevelRules(): Array<[string, string]> {
  const css = toolkitCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Array<[string, string]> = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let close = open + 1;
    for (; depth && close < css.length; close += 1) { if (css[close] === '{') depth += 1; else if (css[close] === '}') depth -= 1; }
    const prelude = css.slice(i, open).trim();
    if (!prelude.startsWith('@')) rules.push([prelude.replace(/\s+/g, ' '), css.slice(open + 1, close - 1)]);
    i = close;
  }
  return rules;
}

/** The value the toolkit's own rules give one property of an element: the heaviest matching rule, the later one on a tie. */
function cascaded(element: Element, property: string): string | undefined {
  let best: { weight: number[]; value: string } | undefined;
  for (const [prelude, body] of topLevelRules()) {
    const declarations = new Map([...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map((d) => [d[1]!, d[2]!.trim()]));
    let value = declarations.get(property);
    if (value === undefined && /^padding-(left|right|top|bottom)$/.test(property) && declarations.has('padding')) {
      // The shorthand's side, for the plain one to four values the table rules use.
      const parts = declarations.get('padding')!.split(/\s+/);
      const side = { top: 0, right: 1, bottom: 2, left: 3 }[property.slice(8) as 'top']!;
      value = parts.length > 4 ? declarations.get('padding') : parts[[[0, 0, 0, 0], [0, 1, 0, 1], [0, 1, 2, 1], [0, 1, 2, 3]][parts.length - 1]![side]!];
    }
    if (value === undefined) continue;
    for (const selector of selectorList(prelude)) {
      if (/::|:hover/.test(selector) || !element.matches(selector)) continue;
      const weight = specificity(selector);
      if (!best || compareSpecificity(weight, best.weight) >= 0) best = { weight, value };
    }
  }
  return best?.value;
}

test('DataTable and list table rules keep their weight: an empty cell has no inset and a Space rule like .nui-dtable td still wins', async () => {
  assert.deepEqual(specificity('.nui-dtable > tbody > :where(.x) > td:first-child'), [0, 2, 2], 'the helper reads :where as nothing');
  await mount(<DataTable columns={BOX_COLUMNS} rows={[]} rowKey={(box) => box.id} />);
  const empty = doc.querySelector('tr.nui-dtable-empty > td')!;
  assert.equal(cascaded(empty, 'padding-left'), '0', 'the empty state spans the table edge to edge');
  assert.equal(cascaded(empty, 'padding-right'), '0');
  assert.equal(cascaded(empty, 'height'), 'auto');
  // Every rule that styles a DataTable or list table cell weighs what its unscoped form did, so a Space that restyles
  // cells with a plain descendant rule keeps winning after an SDK update.
  const weights = new Map([
    ['.nui-dtable > * > :where(tr) > :is(th, td)', [0, 1, 1]],
    ['.nui-dtable > * > :where(tr) > :is(th, td):first-child', [0, 2, 1]],
    ['.nui-dtable > * > :where(tr) > [data-primary]', [0, 2, 0]],
    ['.nui-dtable > * > :where(tr) > [data-align="end"]', [0, 2, 0]],
    ['.nui-dtable > tbody > :where(tr) > [data-mono]', [0, 2, 1]],
    [':where(.nui-dtable > tbody) > .nui-dtable-group > th', [0, 1, 1]],
    ['.nui-dtable > :where(tbody) > .nui-dtable-empty > td', [0, 2, 1]],
    ['.nui-dtable > :where(tbody) > tr[data-pressable]:hover > *', [0, 3, 1]],
    ['.nui-table > * > :where(tr) > th', [0, 1, 1]],
    ['.nui-table > * > :where(tr) > :is(th, td):first-child:not(.nui-group-head)', [0, 3, 1]],
  ]);
  for (const [selector, weight] of weights) {
    assert.ok(cssRule(selector) !== null, `${selector} is a toolkit rule`);
    assert.deepEqual(specificity(selector), weight, selector);
  }
  const ownCell = doc.querySelector('.nui-dtable > thead > tr > th')!;
  assert.equal(cascaded(ownCell, 'height'), '36px', 'the header keeps its 36px over the 40px cells');
});

/** Each selector of a selector list, split at top-level commas only (an `:is(a, b)` stays whole). */
function selectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '(') depth += 1;
    else if (list[i] === ')') depth -= 1;
    else if (list[i] === ',' && depth === 0) { parts.push(list.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}

test('DataTable: a table inside a cell is untouched by every DataTable rule, its hide rules included', async () => {
  // A cell can hold a table of its own (a small breakdown), even one whose cells carry the same attributes. Every
  // DataTable rule reaches only the DataTable's own rows and cells: the 40px truncating cells, the 24px edge insets,
  // the primary, end and mono columns, the pressable rows and the rules that hide columns as the table narrows.
  const nested = (
    <table className="nested">
      <thead><tr><th data-ci="0" data-primary="" data-hide-below="560">Used</th><th data-ci="2" data-align="end">Free</th></tr></thead>
      <tbody>
        <tr data-pressable=""><td data-ci="1" data-mono="">1</td><td data-ci="2" data-hide-below="420">2</td></tr>
        <tr className="nui-dtable-group"><th>Group</th></tr>
        <tr className="nui-dtable-empty"><td>None</td></tr>
      </tbody>
    </table>
  );
  const columns: DataTableColumn<Box>[] = [
    { id: 'name', label: 'Name', primary: true, cell: (box) => box.name },
    { id: 'region', label: 'Region', mono: true, hideBelow: 560, cell: (box) => box.region },
    { id: 'split', label: 'Split', align: 'end', hideBelow: 420, cell: () => nested },
  ];
  // 100 px of overflow, so the fit hides the last column too: its rule must not hide the nested cells of that index.
  const proto = dom.window.HTMLElement.prototype;
  const saved = (['offsetWidth', 'clientWidth', 'scrollWidth'] as const).map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get(this: HTMLElement) {
    return this.tagName === 'TH' && !this.closest('table.nested') ? 200 : 0;
  } });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('nui-dtable-wrap') ? 500 : 0; } });
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('nui-dtable') ? 600 : 0; } });
  try {
    await mount(<DataTable columns={columns} rows={BOXES.slice(0, 1)} rowKey={(box) => box.id} onRowPress={() => undefined} />);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, key, descriptor); else delete (proto as unknown as Record<string, unknown>)[key];
    }
  }
  const generated = doc.querySelector('.nui-dtable-wrap > style')?.textContent ?? '';
  assert.match(generated, /\[data-ci="2"\] \{ display: none; \}/, 'the fit hides the last column');
  const own = [...toolkitCss.matchAll(/\n([^\n{}@]*\.nui-dtable[^\n{}]*) \{/g)].map((match) => match[1]!);
  const hiding = [...generated.matchAll(/(\.nui-dtable\[data-dtable="[^"]+"\][^{}]*?) \{/g)].map((match) => match[1]!);
  assert.ok(own.length >= 15 && hiding.length >= 6, `the DataTable rules are found (${own.length}, ${hiding.length})`);
  const selectors = [...own, ...hiding].flatMap(selectorList)
    .map((selector) => selector.replace(/::after$/, '').replace(/:hover/g, '').replace(/:not\(\[data-measuring\]\)/, ''));
  for (const selector of selectors) {
    const reached = [...doc.querySelectorAll(selector)].filter((node) => node.closest('table.nested'));
    assert.deepEqual(reached.map((node) => node.outerHTML.slice(0, 60)), [], selector);
  }
  // The DataTable's own cells still take them.
  const outer = (selector: string) => [...doc.querySelectorAll(selector)].filter((node) => !node.closest('table.nested')).length;
  assert.ok(outer(selectors.find((selector) => selector.endsWith(':first-child') && !selector.includes('primary'))!) >= 2, 'edge insets');
  for (const selector of selectors.filter((value) => value.includes('[data-ci="2"]'))) {
    assert.ok(outer(selector) >= 2, `${selector} still reaches the DataTable column`);
  }
});

test('DataTable: a control in a cell of a pressable row opens itself, not the row', async () => {
  const pressed: string[] = [];
  const opened: string[] = [];
  const columns: DataTableColumn<Box>[] = [
    { id: 'name', label: 'Name', primary: true, cell: (box) => box.name },
    { id: 'logs', label: 'Logs', cell: (box) => <button type="button" className="logs" onClick={() => opened.push(box.id)}>Logs</button> },
  ];
  await mount(<DataTable columns={columns} rows={BOXES.slice(0, 1)} rowKey={(box) => box.id} onRowPress={(box) => pressed.push(box.id)} />);
  await act(async () => { (doc.querySelector('button.logs') as HTMLElement).click(); });
  assert.deepEqual(opened, ['b1']);
  assert.deepEqual(pressed, [], 'the row press does not fire');
  await act(async () => { (doc.querySelector('tbody td') as HTMLElement).click(); });
  assert.deepEqual(pressed, ['b1'], 'the rest of the row still opens it');
  assert.match(cssRule('.nui-dtable > :where(tbody) > tr[data-pressable] > * :is(a, button, input, select, textarea, label, summary, [role="button"], [tabindex]:not([tabindex="-1"]), [aria-haspopup]):not(.nui-dtable-pick)') ?? '',
    /position: relative; z-index: 1;/, 'cell controls sit over the row press layer');
});

test('DataTable: plain rows are not pressable, the primary never hides, no rows shows the empty content', async () => {
  await mount(
    <DataTable columns={[{ ...BOX_COLUMNS[1]!, hideBelow: 900 }, BOX_COLUMNS[2]!]} rows={BOXES} rowKey={(box) => box.id} />,
  );
  assert.equal(doc.querySelector('tr[data-pressable]'), null);
  assert.equal(doc.querySelector('.nui-dtable-pick'), null);
  assert.equal(doc.querySelector('tbody th[scope="row"]')?.textContent, 'build-1');
  assert.equal(doc.querySelector('tbody th[scope="row"]')?.hasAttribute('data-hide-below'), false, 'the primary column never hides');
  assert.equal(doc.querySelector('tr.nui-dtable-group'), null, 'no groups, no heading rows');

  await mount(<DataTable columns={BOX_COLUMNS} rows={[]} rowKey={(box) => box.id} empty={<p className="none">No machines</p>} />);
  const cell = doc.querySelector('tr.nui-dtable-empty > td')!;
  assert.equal(cell.getAttribute('colspan'), '3');
  assert.equal(cell.querySelector('.none')?.textContent, 'No machines');
  await mount(<DataTable columns={BOX_COLUMNS} rows={[]} rowKey={(box) => box.id} />, 'fr');
  assert.equal(doc.querySelector('.nui-dtable-empty .nui-empty-title')?.textContent, 'Rien ici pour l’instant');

  // The ChartTable look: 40px rows, a sticky 36px muted header, 24px edge cells, cells that truncate.
  const cells = cssRule('.nui-dtable > * > :where(tr) > :is(th, td)') ?? '';
  assert.match(cells, /height: 40px;/);
  assert.match(cells, /white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
  assert.match(cssRule('.nui-dtable > thead > tr > th') ?? '', /position: sticky; top: 0; z-index: 2; height: 36px;/, 'above the cell controls of pressable rows (z-index 1)');
  assert.match(cssRule('.nui-dtable > * > :where(tr) > :is(th, td):first-child') ?? '', /padding-left: 24px;/);
  assert.match(cssRule('.nui-dtable > * > :where(tr) > [data-primary]') ?? '',
    /width: 100%; max-width: 0; min-width: calc\(var\(--nui-dtable-primary-min, 120px\) \+ 24px\);/,
    'the primary column keeps 120px by default, on the cell since max-width: 0 ignores its content');
  assert.match(cssRule('.nui-dtable-wrap') ?? '', /overflow-x: clip; container: nui-dtable \/ inline-size;/);
  assert.match(cssRule('.nui-dtable > * > :where(tr) > [data-primary]:is(:first-child, :last-child)') ?? '',
    /min-width: calc\(var\(--nui-dtable-primary-min, 120px\) \+ 36px\);/, 'at an edge the 24px inset is added back');
  await mount(<DataTable columns={[{ ...BOX_COLUMNS[0]!, primary: true, minWidth: 160 }, ...BOX_COLUMNS.slice(1)]} rows={[]}
    rowKey={(box) => box.id} />);
  assert.equal(doc.querySelector<HTMLElement>('.nui-dtable')!.style.getPropertyValue('--nui-dtable-primary-min'), '160px');
  assert.equal(typeof uiExports.DataTable, 'function');
  assert.equal(typeof uiExports.Meter, 'function');
  assert.equal(typeof uiExports.formatDuration, 'function');
});
