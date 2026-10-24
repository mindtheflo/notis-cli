import { dom } from '../ui/testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Dialog, prefersNativeConfirm } from './Dialog';

const win = dom.window as unknown as Window & typeof globalThis;
const doc = win.document;
Object.defineProperty(globalThis, 'HTMLDialogElement', { configurable: true, writable: true, value: win.HTMLDialogElement });
Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, writable: true, value: win.HTMLButtonElement });

// jsdom has no top layer: opening only sets the attribute.
const dialogProto = win.HTMLDialogElement.prototype as HTMLDialogElement;
if (typeof dialogProto.showModal !== 'function') {
  const show = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  Object.assign(dialogProto, {
    show, showModal: show,
    close(this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new win.Event('close'));
    },
  });
}

/** A phone (coarse pointer, no hover) or a desktop browser. */
function device(touch: boolean) {
  win.matchMedia = ((query: string) => ({ matches: touch && query === '(hover: none) and (pointer: coarse)', media: query })) as unknown as typeof win.matchMedia;
}

/** The OS dialog: records what it was asked and answers after `delayMs` of blocking. */
function osConfirm(answer: boolean, delayMs = 40) {
  const asked: string[] = [];
  win.confirm = (message?: string) => {
    asked.push(String(message));
    const until = performance.now() + delayMs;
    while (performance.now() < until) { /* the user reads */ }
    return answer;
  };
  return asked;
}

let root: Root | null = null;
async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => { root!.render(node); });
}
const tick = (ms = 5) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

function DeleteConfirm({ log, withCancel = true }: { log: string[]; withCancel?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onClose={() => { log.push('close'); setOpen(false); }} role="alertdialog" nativeOnTouch
      title="Delete 2 presentations?" description={'Their slides go too.\nThis cannot be undone.'}>
      {withCancel ? <button type="button" data-dialog-cancel onClick={() => { log.push('cancel'); setOpen(false); }}>Cancel</button> : null}
      <button type="button" data-dialog-confirm onClick={() => log.push('delete')}>Delete</button>
    </Dialog>
  );
}

const card = () => doc.querySelector('dialog.notis-dialog') as HTMLDialogElement | null;

test('on a phone, nativeOnTouch asks the OS: OK runs the confirm button, the card stays hidden meanwhile', async () => {
  device(true);
  const asked = osConfirm(true);
  const log: string[] = [];
  await mount(<DeleteConfirm log={log} />);
  assert.ok(card()!.hasAttribute('data-native-confirm'), 'the card is hidden before the OS asks');
  await tick();
  assert.deepEqual(asked, ['Delete 2 presentations?\n\nTheir slides go too.\n\nThis cannot be undone.']);
  assert.deepEqual(log, ['delete']);
  assert.ok(card()!.hasAttribute('data-native-confirm'), 'the card stays hidden while the work runs');
});

test('on a phone, Cancel in the OS dialog runs the cancel button, else onClose', async () => {
  device(true);
  osConfirm(false);
  const log: string[] = [];
  await mount(<DeleteConfirm log={log} />);
  await tick();
  assert.deepEqual(log, ['cancel']);
  assert.equal(card()!.open, false, 'the dialog closed');

  const bare: string[] = [];
  await mount(<DeleteConfirm log={bare} withCancel={false} />);
  await tick();
  assert.deepEqual(bare, ['close']);
});

test('a browser with no OS dialog (an instant Cancel) shows the card instead', async () => {
  device(true);
  osConfirm(false, 0);
  const log: string[] = [];
  await mount(<DeleteConfirm log={log} />);
  await tick();
  assert.deepEqual(log, [], 'nothing ran');
  assert.ok(card()!.open, 'still open');
  assert.equal(card()!.hasAttribute('data-native-confirm'), false, 'the card shows');
});

test('desktop browsers and the Desktop app keep the card; without nativeOnTouch phones keep it too', async () => {
  device(false);
  const asked = osConfirm(true);
  await mount(<DeleteConfirm log={[]} />);
  await tick();
  assert.equal(card()!.hasAttribute('data-native-confirm'), false);
  assert.deepEqual(asked, []);

  device(true);
  (win as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI = { isElectron: true };
  assert.equal(prefersNativeConfirm(), false, 'the Desktop app keeps the card');
  delete (win as Window & { electronAPI?: unknown }).electronAPI;
  assert.equal(prefersNativeConfirm(), true);

  await mount(<Dialog open onClose={() => {}} title="Rename"><button type="button">Save</button></Dialog>);
  await tick();
  assert.equal(card()!.hasAttribute('data-native-confirm'), false);
  assert.deepEqual(asked, []);
});

test('the dialog card ships in toolkit.css, the stylesheet a Space adopts into its shadow root', () => {
  const toolkit = readFileSync(new URL('../ui/toolkit.css', import.meta.url), 'utf8');
  assert.match(toolkit, /dialog\.notis-dialog \{[^}]*background: hsl\(var\(--background\)\)/);
  assert.match(toolkit, /dialog\.notis-dialog::backdrop/);
  assert.match(toolkit, /dialog\.notis-dialog\[data-native-confirm\] \{[^}]*opacity: 0/);
  assert.match(toolkit, /\.notis-dialog-title \{/);
});
