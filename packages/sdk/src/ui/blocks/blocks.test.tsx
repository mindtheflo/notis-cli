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
  assert.match(cssRule('.nui-table :is(th, td):first-child:not(.nui-group-head)') ?? '', /padding-left: 24px;/, 'a ListReader table insets 24px anywhere');
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
  assert.match(toolkitCss, /--nui-st-review: var\(--status-live, 142 71% 45%\);/, 'the active colour, from the one palette');
});
