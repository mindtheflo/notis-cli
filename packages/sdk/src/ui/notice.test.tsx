import { dom } from './testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Button, Notice } from './blocks/blocks';
import { KeyboardEngine, KeyboardEngineCore } from './engine';

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => {
    root!.render(
      <KeyboardEngine host="preview" locale="en" platform="mac" engine={new KeyboardEngineCore()} document={doc} strict>
        {node}
      </KeyboardEngine>,
    );
  });
}

const roleOf = (text: string) =>
  [...doc.querySelectorAll('.nui-notice')].find((notice) => notice.textContent?.startsWith(text))?.getAttribute('role');

test('Notice: a danger notice is a status, read once the reader is idle; only an urgent notice is an alert (follow-up B14)', async () => {
  await mount(
    <>
      <Notice tone="danger" onRetry={() => {}}>Could not load the list.</Notice>
      <Notice tone="warning">Some sources are late.</Notice>
      <Notice>Drafts stay for 30 days.</Notice>
      <Notice tone="danger" urgent>Your session ended. Sign in again.</Notice>
      <Notice tone="warning" urgent>The upload stops in one minute.</Notice>
    </>,
  );
  assert.equal(roleOf('Could not load'), 'status', 'danger alone is not urgent');
  assert.equal(doc.querySelector('.nui-notice[data-tone="danger"]')?.getAttribute('data-tone'), 'danger', 'it keeps the danger look');
  assert.equal(roleOf('Some sources'), 'status');
  assert.equal(roleOf('Drafts stay'), 'status');
  assert.equal(roleOf('Your session ended'), 'alert');
  assert.equal(roleOf('The upload stops'), 'alert', 'any tone may be urgent');
  assert.equal(doc.querySelectorAll('[role="alert"]').length, 2);
});

const toolkitCss = readFileSync(new URL('./toolkit.css', import.meta.url), 'utf8');

/** The declarations of the rule written exactly as `selector {` at the start of a line. */
function cssRule(selector: string): string {
  const at = toolkitCss.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `toolkit.css has a ${selector} rule`);
  const open = toolkitCss.indexOf('{', at);
  return toolkitCss.slice(open + 1, toolkitCss.indexOf('}', open)).trim();
}

test('Notice: on a narrow notice the buttons wrap onto their own line under the text; wide, they stay on the right', async () => {
  await mount(
    <>
      <Notice tone="danger" onRetry={() => {}} action={<Button size="sm">Reconnect Slack</Button>}>Slack signed you out.</Notice>
      <Notice tone="warning" action={<Button size="sm">Enable</Button>}>This automation is paused.</Notice>
      <Notice>Drafts stay for 30 days.</Notice>
    </>,
  );
  const [both, one, none] = [...doc.querySelectorAll('.nui-notice')];
  const parts = (notice: Element | undefined) => [...(notice?.children ?? [])].map((child) => child.className);
  assert.deepEqual(parts(both), ['nui-notice-text', 'nui-notice-actions'], 'the text, then one box of buttons');
  assert.deepEqual([...both!.querySelectorAll('.nui-notice-actions > button')].map((b) => b.textContent),
    ['Reconnect Slack', 'Try again'], 'the action and Try again move together');
  assert.deepEqual(parts(one), ['nui-notice-text', 'nui-notice-actions']);
  assert.deepEqual(parts(none), ['nui-notice-text'], 'no empty button box without a button');

  const notice = cssRule('.nui-notice');
  assert.match(notice, /display: flex; flex-wrap: wrap;/, 'the notice wraps on its own width, not the viewport');
  assert.match(cssRule('.nui-notice-text'), /flex: 1 1 320px; min-width: 0;/,
    'the text keeps 320px beside the buttons, so a narrower notice drops them under it and a wide one keeps one line');
  assert.match(cssRule('.nui-notice-actions'), /display: flex; flex-wrap: wrap;/);
  assert.doesNotMatch(toolkitCss, /@media[^{]*\{[^@]*\.nui-notice/, 'no viewport rule decides the notice layout');
});
