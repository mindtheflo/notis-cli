import { dom } from './testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Notice } from './blocks/blocks';
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
