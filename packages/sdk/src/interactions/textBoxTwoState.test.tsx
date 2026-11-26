import { dom } from '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { TEXT_BOX_FOLD_DELAY_MS, TEXT_BOX_STATE_MS, textBoxOpen, useTextBoxTwoState } from './textBoxTwoState';

const doc = dom.window.document;
let wide = false;
Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: (query: string) => ({
  matches: query.includes('1024px') ? wide : false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) });

const later = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });

test('a text box is open with the focus or while busy; a draft keeps a computer\'s box open and folds on a phone', () => {
  const rest = { focused: false, busy: false, hasDraft: false };
  assert.equal(textBoxOpen({ ...rest, wide: false }), false);
  assert.equal(textBoxOpen({ ...rest, focused: true, wide: false }), true, 'the keyboard up');
  assert.equal(textBoxOpen({ ...rest, hasDraft: true, wide: false }), false, 'a phone: a draft at rest is one line');
  assert.equal(textBoxOpen({ ...rest, hasDraft: true, wide: true }), true, 'a computer keeps what was typed in view');
  assert.equal(textBoxOpen({ ...rest, busy: true, wide: false }), true);
  // Every box waits and moves alike.
  assert.equal(TEXT_BOX_FOLD_DELAY_MS, 160);
  assert.equal(TEXT_BOX_STATE_MS, 200);
});

test('a field inside a comment pane (a shadow root) opens with the focus, stays open on its own buttons and folds after the focus left', async () => {
  wide = false;
  const host = doc.body.appendChild(doc.createElement('div'));
  const shadow = host.attachShadow({ mode: 'open' });
  const mount = shadow.appendChild(doc.createElement('div'));
  const outside = doc.body.appendChild(doc.createElement('button'));
  function Field({ hasDraft = false, hold = false, phoneOnly = true, send = 1 }: { hasDraft?: boolean; hold?: boolean; phoneOnly?: boolean; send?: number }) {
    const box = useTextBoxTwoState<HTMLDivElement>({ enabled: true, phoneOnly, hasDraft, hold, looksAgain: true,
      surfaceOf: holder => holder.querySelector<HTMLElement>('.pill') });
    return <div id="frame" {...box.bind}><div className="pill"><textarea id="field" /><button id="send" key={send} type="button">Send</button></div></div>;
  }
  const root = createRoot(mount);
  const state = () => shadow.getElementById('frame')!.getAttribute('data-composer-state');
  try {
    await act(async () => { root.render(<Field />); });
    assert.equal(state(), 'rest');
    await act(async () => { (shadow.getElementById('field') as HTMLElement).focus(); });
    assert.equal(state(), 'open', 'the focus is in the field: the page only sees the pane, the box sees its field');
    // A press on the box's own button moves the focus inside the box: no fold.
    await act(async () => { (shadow.getElementById('send') as HTMLElement).focus(); });
    await later(TEXT_BOX_FOLD_DELAY_MS + 40);
    assert.equal(state(), 'open');
    // The focus leaves the pane: one line again, a moment later.
    await act(async () => { outside.focus(); });
    assert.equal(state(), 'open', 'not before the delay');
    await later(TEXT_BOX_FOLD_DELAY_MS + 40);
    assert.equal(state(), 'rest');
    // A phone folds a draft to one line; held (being sent) the box stays as it was.
    await act(async () => { root.render(<Field hasDraft />); });
    assert.equal(state(), 'rest');
    await act(async () => { root.render(<Field hasDraft hold />); });
    await act(async () => { (shadow.getElementById('field') as HTMLElement).focus(); });
    assert.equal(state(), 'rest', 'held while it sends');
    await act(async () => { root.render(<Field hasDraft />); });
    assert.equal(state(), 'open');
    // The focus can go without a blur: the pressed Send button is taken away (or switched off) once the reply is
    // sent. The box looks again when the send ends and what it held changed, and folds.
    await act(async () => { (shadow.getElementById('send') as HTMLElement).focus(); });
    let blurs = 0;
    shadow.getElementById('frame')!.addEventListener('focusout', () => { blurs += 1; });
    await act(async () => { root.render(<Field hasDraft hold send={1} />); });
    await act(async () => { root.render(<Field hold send={2} />); });
    assert.equal(blurs, 0, 'the page said nothing');
    assert.notEqual(shadow.activeElement, shadow.getElementById('send'), 'and the focus is gone');
    assert.equal(state(), 'open', 'held while it sends');
    await act(async () => { root.render(<Field send={2} />); });
    await later(TEXT_BOX_FOLD_DELAY_MS + 40);
    assert.equal(state(), 'rest', 'sent: one line again, though no blur came');
    await act(async () => { root.unmount(); });
    // A computer: a phone-only box has one state and no attribute.
    wide = true;
    const computer = createRoot(mount);
    await act(async () => { computer.render(<Field hasDraft />); });
    assert.equal(state(), null);
    await act(async () => { (shadow.getElementById('field') as HTMLElement).focus(); });
    assert.equal(state(), null);
    await act(async () => { computer.unmount(); });
  } finally {
    wide = false;
    host.remove();
    outside.remove();
  }
});

test('the comment pane\'s own one-line fields take the two states on a phone, drawn from the attribute', () => {
  const pane = readFileSync(new URL('../ui/comments/CommentPane.tsx', import.meta.url), 'utf8');
  assert.match(pane, /useTextBoxTwoState<HTMLDivElement>\(\{ enabled: true, phoneOnly: true, hasDraft, hold, looksAgain: true, surfaceOf: composeOf \}\)/);
  assert.match(pane, /<OwnTextBox className="nui-comment-compose-box"/, 'a reply where the host draws no box');
  assert.doesNotMatch(pane, /nui-comment-ask-answer/, 'a question has no field of its own: the reply box answers it');
  assert.match(pane, /data-swipe-dismiss="" \{\.\.\.box\.bind\}/, 'a swipe down puts the keyboard away there too');
  const css = readFileSync(new URL('../ui/toolkit.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('/* Phone sizing (docs/portal-design-system.md, "Phone sizing")'));
  const block = phone.slice(phone.indexOf('@media (max-width: 1023px) {'), phone.indexOf('/* == section: calendar heatmap'));
  // At rest: 7px around a 36px line (50px), one line of text.
  assert.match(block, /\[data-composer-state\] > \.nui-comment-compose \{[^}]*padding: 7px 6px;[^}]*border-radius: 25px;/);
  // The height's move is given in the frame's whole measure: without border-box the padding would be added on top,
  // and the field would overshoot by 14px then snap.
  assert.match(block, /\[data-composer-state\] > \.nui-comment-compose \{ box-sizing: border-box;/);
  assert.match(block, /\[data-composer-state\] > \.nui-comment-compose > \.nui-comment-input:hover \{ min-height: 36px;/);
  assert.match(block, /\[data-composer-state="rest"\] > \.nui-comment-compose > \.nui-comment-input \{ height: 36px; max-height: 36px; overflow: hidden;\s+white-space: nowrap; \}/);
  // Open: the text takes the line, the buttons the next one, Send at its end.
  assert.match(block, /\[data-composer-state="open"\] > \.nui-comment-compose \{ flex-wrap: wrap; \}/);
  assert.match(block, /\[data-composer-state="open"\] > \.nui-comment-compose > \.nui-comment-input:hover \{ flex: 1 0 100%;/);
  assert.match(block, /\[data-composer-state="open"\] > \.nui-comment-compose > \.nui-comment-icon-btn:last-child \{ margin-inline-start: auto; \}/);
  assert.match(block, /\[data-composer-state\] > \.nui-comment-compose > \.nui-comment-icon-btn \{ width: 36px; min-width: 36px; height: 36px; \}/);
  // Nothing of it outside the phone block: a computer's fields are as before.
  assert.equal(css.split('[data-composer-state').length - 1, block.split('[data-composer-state').length - 1);
});
