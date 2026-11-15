import './testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ICON_NAMES, Icon, hasIcon, renderIcon } from './icons';

const repoFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');

test('the built-in set has the refresh icons and plus (follow-ups B12, B13)', () => {
  for (const name of ['arrow-clockwise', 'arrows-clockwise', 'plus']) {
    assert.ok(hasIcon(name), name);
    const markup = renderToStaticMarkup(<Icon name={name} />);
    assert.match(markup, /^<svg class="nui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path /, name);
    assert.equal(renderToStaticMarkup(<>{renderIcon(name)}</>), markup, 'an icon prop takes the name');
  }
  assert.equal(hasIcon('arrow-clockwise-bold'), false);
  assert.equal(renderToStaticMarkup(<Icon name="arrow-clockwise-bold" />), '', 'an unknown name renders nothing');
});

test('an unknown icon name warns once, naming it', () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  try {
    renderToStaticMarkup(<><Icon name="hard-drives-typo" /><Icon name="hard-drives-typo" /><Icon name="info" /></>);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1, 'once per name, and never for a known one');
  assert.match(warnings[0]!, /Unknown icon "hard-drives-typo"/);
});

test('the set draws open in a new place, send and filter (arrow-square-out, paper-plane-tilt, funnel-simple)', () => {
  for (const name of ['arrow-square-out', 'paper-plane-tilt', 'funnel-simple']) {
    assert.ok(hasIcon(name), name);
    assert.ok(ICON_NAMES.includes(name), name);
    const markup = renderToStaticMarkup(<Icon name={name} />);
    assert.match(markup, /^<svg class="nui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="/, name);
  }
});

test('the set draws the names agents reach for first (check-circle, chart-line-up, sparkle, rocket-launch, chats, kanban)', () => {
  for (const name of ['check-circle', 'chart-line-up', 'sparkle', 'rocket-launch', 'chats', 'kanban']) {
    assert.ok(hasIcon(name), name);
    assert.ok(ICON_NAMES.includes(name), name);
    const markup = renderToStaticMarkup(<Icon name={name} />);
    assert.match(markup, /^<svg class="nui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">/, name);
    assert.match(markup, /stroke="currentColor" stroke-width="1.5"/, `${name} is a 1.5 px line icon like the rest`);
  }
});

test('ICON_NAMES lists every name the set draws, and only those', () => {
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
  for (const name of ICON_NAMES) assert.notEqual(renderToStaticMarkup(<Icon name={name} />), '', name);
  assert.ok(Object.isFrozen(ICON_NAMES));
});

test('the build check and the skill reference list exactly the names the set draws', () => {
  const sorted = [...ICON_NAMES].sort();
  const rules = JSON.parse(repoFile('server/config/notis_app_design_rules.json'));
  assert.deepEqual(rules.icons.names, sorted, 'icons.names in server/config/notis_app_design_rules.json');
  const reference = repoFile('server/skills/notis-spaces/references/sdk.md');
  const listed = reference.slice(reference.indexOf('The names:'), reference.indexOf('For any other icon'));
  assert.ok(listed.length > 0, 'sdk.md has the icon list');
  assert.deepEqual([...listed.matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1]), sorted,
    'the icon list in server/skills/notis-spaces/references/sdk.md');
});
