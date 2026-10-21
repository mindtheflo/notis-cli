import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { labelValue } from '../../words/types';
import { formatLongDay } from '../period/dateFormat';
import {
  EditableFields, FieldDisclosure, FieldList, FieldLongText, FieldMultiSelect, FieldRow, FieldSelect, FieldText,
  toggleFieldValue, type FieldOption,
} from './fields';
import { FIELD_WORDS } from './fieldWords';
import { changedFieldKeys, useFieldDraft } from './useFieldDraft';

const doc = dom.window.document;
let root: Root | null = null;

/** The field rules live in toolkit.css (every host loads it), not in a <style> the fields draw. */
const toolkitCss = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');

/** The declarations of the first rule written for exactly `selector` in toolkit.css. */
function cssRule(selector: string): string | null {
  const at = toolkitCss.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = toolkitCss.indexOf('{', at);
  return toolkitCss.slice(open + 1, toolkitCss.indexOf('}', open)).trim();
}

async function mount(node: ReactNode, locale: 'en' | 'fr' = 'en') {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  const engine = new KeyboardEngineCore();
  await act(async () => {
    root!.render(<KeyboardEngine host="preview" locale={locale} platform="mac" engine={engine} document={doc} strict>{node}</KeyboardEngine>);
  });
}

async function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const options = { key, code: key, bubbles: true, cancelable: true, composed: true, ...init };
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', options));
    target.dispatchEvent(new dom.window.KeyboardEvent('keyup', options));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...doc.querySelectorAll('button')].find((button) => button.textContent?.includes(name)) as HTMLButtonElement | undefined;
}

/** A one-field form on `useFieldDraft`, reporting saves and cancels. */
function NameForm({ onSave, onCancel }: { onSave: (name: string) => void; onCancel?: () => void }) {
  const [saved, setSaved] = useState({ name: 'Weekly digest' });
  const form = useFieldDraft(saved);
  return (
    <EditableFields
      dirty={form.dirty}
      saveDisabled={!form.draft.name.trim()}
      onSave={() => { onSave(form.draft.name); setSaved({ name: form.draft.name }); }}
      onCancel={() => { form.reset(); onCancel?.(); }}
    >
      <FieldRow label="Name" changed={form.changed('name')}>
        <FieldText label="Name" value={form.draft.name} onChange={(value) => form.set('name', value)} />
      </FieldRow>
    </EditableFields>
  );
}

test('toggleFieldValue keeps the options order and can keep one value', () => {
  const order = ['notis', 'codex', 'claude'] as const;
  assert.deepEqual(toggleFieldValue(['claude'], 'notis', order), ['notis', 'claude']);
  assert.deepEqual(toggleFieldValue(['notis', 'claude'], 'notis', order), ['claude']);
  assert.equal(toggleFieldValue(['claude'], 'claude', order, true), null);
  assert.deepEqual(toggleFieldValue(['claude'], 'claude', order, false), []);
});

test('changedFieldKeys compares by content', () => {
  assert.deepEqual(changedFieldKeys({ a: 1, list: ['x'] }, { a: 1, list: ['x'] }), []);
  assert.deepEqual(changedFieldKeys({ a: 1, list: ['x'] }, { a: 2, list: ['x', 'y'] }), ['a', 'list']);
  assert.deepEqual(changedFieldKeys({ a: null as string | null }, { a: undefined as unknown as string | null }), []);
});

test('Save and Cancel appear only once something changed, with a changed mark on the row', async () => {
  await mount(<NameForm onSave={() => undefined} />);
  assert.equal(buttonNamed('Save'), undefined);
  // D4: the rows are styled by toolkit.css rules the form's own classes match, not by a <style> the fields draw.
  assert.equal(doc.querySelectorAll('#app style').length, 0);
  assert.ok(doc.querySelector('.nui-fields > dl.nui-fields-list > .nui-field-row'), 'the form renders the classes toolkit.css styles');
  assert.match(cssRule('.nui-field-row') ?? '', /display: grid;/, 'toolkit.css lays the row out');
  const input = doc.querySelector('input')!;
  await type(input, 'Daily digest');
  assert.ok(buttonNamed('Save'));
  assert.ok(buttonNamed('Cancel'));
  assert.ok(doc.querySelector('.nui-field-row[data-changed] .nui-field-dot'));
  await type(input, 'Weekly digest');
  assert.equal(buttonNamed('Save'), undefined, 'typing the saved value back is not a change');
});

test('Cmd+Enter saves from inside the field; Save is disabled while a required value is empty', async () => {
  const saves: string[] = [];
  await mount(<NameForm onSave={(name) => saves.push(name)} />);
  const input = doc.querySelector('input')!;
  await type(input, '');
  assert.equal(buttonNamed('Save')!.disabled, true);
  await press(input, 'Enter', { metaKey: true });
  assert.deepEqual(saves, [], 'a disabled Save does not run from the key');
  await type(input, 'Daily digest');
  input.focus();
  await press(input, 'Enter', { metaKey: true });
  assert.deepEqual(saves, ['Daily digest']);
  assert.equal(buttonNamed('Save'), undefined, 'saved: nothing left to save');
});

test('Escape leaves a field first, then cancels the edits', async () => {
  let cancels = 0;
  await mount(<NameForm onSave={() => undefined} onCancel={() => { cancels += 1; }} />);
  const input = doc.querySelector('input')!;
  await type(input, 'Daily digest');
  input.focus();
  await press(input, 'Escape');
  assert.equal(cancels, 0, 'the field owns its Escape');
  assert.notEqual(doc.activeElement, input, 'Escape left the field');
  await press(doc.body, 'Escape');
  assert.equal(cancels, 1);
  assert.equal(doc.querySelector('input')!.value, 'Weekly digest', 'Cancel restores the saved value');
  assert.equal(buttonNamed('Save'), undefined);
});

test('Escape in a field inside a reader pane keeps focus in the pane, not the page body', async () => {
  await mount(
    <div id="pane" className="nui-lr-reader" tabIndex={-1} data-notis-escape-owned="">
      <NameForm onSave={() => undefined} />
    </div>,
  );
  const input = doc.querySelector('input')!;
  input.focus();
  await press(input, 'Escape');
  assert.equal(doc.activeElement?.id, 'pane', 'focus moved to the pane that holds the field');
});

test('the Cancel button restores the saved values and the bar speaks French', async () => {
  await mount(<NameForm onSave={() => undefined} />, 'fr');
  const input = doc.querySelector('input')!;
  await type(input, 'Résumé du jour');
  assert.ok(buttonNamed(FIELD_WORDS.save.fr));
  assert.ok(doc.body.textContent?.includes(FIELD_WORDS.unsaved.fr));
  await act(async () => { buttonNamed(FIELD_WORDS.cancel.fr)!.click(); });
  assert.equal(doc.querySelector('input')!.value, 'Weekly digest');
});

/** A form whose save the test settles by hand. */
let settleSave: { resolve: () => void; reject: (reason: Error) => void } | null = null;
function SlowForm() {
  const [saved, setSaved] = useState({ name: 'Weekly digest' });
  const form = useFieldDraft(saved);
  return (
    <EditableFields
      dirty={form.dirty}
      onSave={() => new Promise<void>((resolve, reject) => {
        settleSave = { resolve: () => { setSaved({ name: form.draft.name }); resolve(); }, reject };
      })}
      onCancel={form.reset}
    >
      <FieldRow label="Name" changed={form.changed('name')}>
        <FieldText label="Name" value={form.draft.name} onChange={(value) => form.set('name', value)} />
      </FieldRow>
    </EditableFields>
  );
}

test('a failed save keeps the draft and says so in a status line, not an alert; Save works again', async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args[0]); };
  try {
    await mount(<SlowForm />);
    await type(inputNamed('Name')!, 'Daily digest');
    const status = doc.querySelector('.nui-fields-bar [role="status"]');
    assert.ok(status, 'the status line is in the bar before anything fails');
    assert.equal(status!.textContent, '');
    await act(async () => { buttonNamed('Save')!.click(); });
    assert.ok(buttonNamed('Saving'), 'Save says Saving while the save runs');
    assert.equal(buttonNamed('Saving')!.disabled, true);
    await act(async () => { buttonNamed('Saving')!.click(); });
    await act(async () => { settleSave!.reject(new Error('offline')); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    assert.equal(inputNamed('Name')!.value, 'Daily digest', 'the draft survives the failure');
    assert.equal(doc.querySelector('.nui-fields-bar [role="status"]')!.textContent, FIELD_WORDS.saveFailed.en);
    assert.equal(doc.querySelector('[role="alert"]'), null, 'a failed save is not an alert');
    assert.deepEqual(logged, [], 'the status line carries the failure; nothing reaches the console (C1)');
    assert.equal(buttonNamed('Save')!.disabled, false, 'Save can run again');
    await act(async () => { buttonNamed('Save')!.click(); });
    assert.equal(doc.querySelector('.nui-fields-bar [role="status"]')!.textContent, '', 'a new try clears the failure');
    await act(async () => { settleSave!.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    assert.equal(buttonNamed('Save'), undefined, 'saved: nothing left to save');
    assert.equal(inputNamed('Name')!.value, 'Daily digest');
  } finally {
    console.error = original;
  }
});

test('a save error from the caller shows as a status line too', async () => {
  await mount(
    <EditableFields dirty onSave={() => undefined} onCancel={() => undefined} error="Name is taken">
      <FieldRow label="Name"><FieldText label="Name" value="Daily" onChange={() => undefined} /></FieldRow>
    </EditableFields>,
    'fr',
  );
  assert.equal(doc.querySelector('.nui-fields-bar [role="status"]')!.textContent, 'Name is taken');
  assert.equal(doc.querySelector('[role="alert"]'), null);
});

test('the save bar keeps Save clear of the floating Notis button only while it sits in the button corner', async () => {
  // The Portal sets these vars while its floating button shows (toolkit.css); the window here is 1024 x 768.
  const hostVars = doc.createElement('style');
  hostVars.textContent = ':root { --notis-fab-safe-end: 72px; --notis-fab-safe-bottom: 72px; }';
  doc.head.appendChild(hostVars);
  let box = { left: 400, top: 700, right: 1024, bottom: 752 };
  const proto = dom.window.HTMLElement.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect');
  Object.defineProperty(proto, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const rect = this.classList.contains('nui-fields-bar') ? box : { left: 0, top: 0, right: 0, bottom: 0 };
      const { left, top, right, bottom } = rect;
      return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => rect };
    },
  });
  const settle = async (event: 'scroll' | 'resize') => {
    await act(async () => {
      if (event === 'scroll') doc.querySelector('.nui-fields')!.dispatchEvent(new dom.window.Event('scroll'));
      else dom.window.dispatchEvent(new dom.window.Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  };
  const bar = () => doc.querySelector('.nui-fields-bar')!;
  try {
    await mount(<NameForm onSave={() => undefined} />);
    await type(doc.querySelector('input')!, 'Daily digest');
    assert.equal(bar().hasAttribute('data-fab'), true, 'stuck at the bottom right: Save keeps clear of the button');
    box = { left: 400, top: 300, right: 1024, bottom: 352 };
    await settle('scroll');
    assert.equal(bar().hasAttribute('data-fab'), false, 'the form ends mid-page: Save stays at the end');
    box = { left: 400, top: 700, right: 1024, bottom: 752 };
    await settle('scroll');
    assert.equal(bar().hasAttribute('data-fab'), true, 'scrolled back into the corner');
    box = { left: 200, top: 700, right: 800, bottom: 752 };
    await settle('resize');
    assert.equal(bar().hasAttribute('data-fab'), false, 'a centered reader ends away from the button');
    hostVars.remove();
    box = { left: 400, top: 700, right: 1024, bottom: 752 };
    await settle('resize');
    assert.equal(bar().hasAttribute('data-fab'), false, 'no floating button: nothing to keep clear of');
  } finally {
    if (own) Object.defineProperty(proto, 'getBoundingClientRect', own);
    else Reflect.deleteProperty(proto, 'getBoundingClientRect');
    hostVars.remove();
  }
  const barRule = toolkitCss.match(/\n\.nui-fields-bar \{[^}]*\}/)?.[0] ?? '';
  assert.ok(barRule && !barRule.includes('padding-inline-end'), 'the bar itself keeps no end padding');
  assert.match(toolkitCss, /\n\.nui-fields-bar\[data-fab\] \{ padding-inline-end: var\(--nui-fab-safe-end, var\(--notis-fab-safe-end, 0px\)\); \}/);
});

/** A form over a record the test replaces from outside (a refresh), one text field per key. */
let refresh: (next: Record<string, string>) => void = () => undefined;
function RecordForm({ initial }: { initial: Record<string, string> }) {
  const [saved, setSaved] = useState(initial);
  refresh = setSaved;
  const form = useFieldDraft(saved);
  return (
    <EditableFields dirty={form.dirty} onSave={() => undefined} onCancel={form.reset}>
      {Object.keys(form.draft).map((key) => (
        <FieldRow key={key} label={key} changed={form.changed(key)}>
          <FieldText label={key} value={form.draft[key] ?? ''} onChange={(value) => form.set(key, value)} />
        </FieldRow>
      ))}
    </EditableFields>
  );
}

function inputNamed(name: string): HTMLInputElement | null {
  return doc.querySelector(`input[aria-label="${name}"]`);
}

test('a refresh replaces a draft without edits, and shows no unsaved changes', async () => {
  await mount(<RecordForm initial={{ name: 'Weekly digest', note: 'Short preview' }} />);
  await act(async () => { refresh({ name: 'Weekly digest', note: 'The whole note, loaded later' }); });
  assert.equal(inputNamed('note')!.value, 'The whole note, loaded later');
  assert.equal(buttonNamed('Save'), undefined, 'nothing was edited');
  assert.equal(doc.querySelector('.nui-field-row[data-changed]'), null);
});

test('a refresh keeps the edited fields and updates the others', async () => {
  await mount(<RecordForm initial={{ name: 'Weekly digest', note: 'Old note' }} />);
  await type(inputNamed('name')!, 'Daily digest');
  await act(async () => { refresh({ name: 'Weekly digest', note: 'New note' }); });
  assert.equal(inputNamed('name')!.value, 'Daily digest', 'the edit survives the refresh');
  assert.equal(inputNamed('note')!.value, 'New note', 'an untouched field takes the new value');
  assert.ok(buttonNamed('Save'));
  assert.equal(doc.querySelectorAll('.nui-field-row[data-changed]').length, 1, 'only the edited field is a change');
  await act(async () => { buttonNamed('Cancel')!.click(); });
  assert.equal(inputNamed('name')!.value, 'Weekly digest', 'Cancel goes back to the new saved record');
  assert.equal(inputNamed('note')!.value, 'New note');
});

test('an entry the saved record no longer has leaves the draft, edited or not', async () => {
  await mount(<RecordForm initial={{ first: 'work', second: 'personal', third: 'shared' }} />);
  await type(inputNamed('third')!, 'team');
  await act(async () => { refresh({ first: 'work' }); });
  assert.equal(inputNamed('second'), null);
  assert.equal(inputNamed('third'), null);
  assert.equal(buttonNamed('Save'), undefined, 'the removed entry takes its edit with it');
});

test('a saved record rebuilt with the same content on every render keeps the edits', async () => {
  function InlineForm() {
    const form = useFieldDraft({ name: 'Weekly digest' });
    return (
      <EditableFields dirty={form.dirty} onSave={() => undefined} onCancel={form.reset}>
        <FieldRow label="Name" changed={form.changed('name')}>
          <FieldText label="Name" value={form.draft.name} onChange={(value) => form.set('name', value)} />
        </FieldRow>
      </EditableFields>
    );
  }
  await mount(<InlineForm />);
  await type(inputNamed('Name')!, 'Daily digest');
  assert.equal(inputNamed('Name')!.value, 'Daily digest');
  assert.ok(buttonNamed('Save'));
});

test('French accessible names put a narrow no-break space before the colon', async () => {
  await mount(
    <EditableFields dirty={false} onSave={() => undefined} onCancel={() => undefined}>
      <FieldRow label="Statut">
        <FieldSelect label="Statut" value="done" options={[{ value: 'done', label: 'Termin\u00e9' }]} onChange={() => undefined} />
      </FieldRow>
      <FieldRow label={'\u00c9tiquettes'}>
        <FieldMultiSelect label={'\u00c9tiquettes'} values={['work']} options={[{ value: 'work', label: 'Travail' }]} onChange={() => undefined} />
      </FieldRow>
      <FieldRow label={'\u00c9ch\u00e9ance'}>
        <FieldDisclosure label={'\u00c9ch\u00e9ance'} summary="18 octobre">-</FieldDisclosure>
      </FieldRow>
    </EditableFields>,
    'fr',
  );
  const names = [...doc.querySelectorAll('button.nui-field-trigger')].map((button) => button.getAttribute('aria-label'));
  assert.deepEqual(names, [
    'Statut\u202f: Termin\u00e9', '\u00c9tiquettes\u202f: Travail', '\u00c9ch\u00e9ance\u202f: 18 octobre',
  ]);
  assert.equal(labelValue('Status', 'Done', 'en'), 'Status: Done');
});

// ---- rows outside a form, hints and errors (follow-up B12) ----

test('FieldList lays rows out as in a form, without Save and Cancel; the field rules live in toolkit.css', async () => {
  await mount(
    <FieldList label="Details">
      <FieldRow label="Owner"><FieldText label="Owner" value="Flo" onChange={() => undefined} /></FieldRow>
    </FieldList>,
  );
  const list = doc.querySelector('.nui-fields')!;
  assert.equal(list.getAttribute('role'), 'group');
  assert.equal(list.getAttribute('aria-label'), 'Details');
  const rows = list.querySelector('dl.nui-fields-list')!;
  assert.equal(rows.parentElement, list, 'the rows sit in the same description list as in a form');
  assert.equal(rows.querySelector('.nui-field-row > dt.nui-field-label')!.textContent, 'Owner');
  assert.equal(doc.querySelector('.nui-fields-bar'), null, 'no save bar');
  assert.equal(doc.querySelectorAll('#app style').length, 0);
  assert.match(cssRule('.nui-fields-list') ?? '', /flex-direction: column;/, 'toolkit.css stacks the rows (D4)');
  await mount(<FieldList><FieldRow label="Owner">Flo</FieldRow></FieldList>);
  const unnamed = doc.querySelector('.nui-fields')!;
  assert.equal(unnamed.hasAttribute('role'), false, 'without a name it is no group: a heading next to it names the rows');
  assert.equal(unnamed.hasAttribute('aria-label'), false);
  assert.match(cssRule('.nui-fields') ?? '', /container: nui-fields \/ inline-size/, 'the rows read the width of their own list');
  assert.match(toolkitCss,
    /@container nui-fields \(min-width: 340px\) \{\s*\.nui-field-row:not\(\[data-stacked\]\) \{ grid-template-columns: 9\.5rem/);
});

test("a filled FieldList (a visitor's form) puts labels above boxed fields and keeps a reading width", async () => {
  await mount(
    <FieldList filled>
      <FieldRow label="Email"><FieldText label="Email" value="" placeholder="ada@example.com" onChange={() => undefined} /></FieldRow>
    </FieldList>,
  );
  assert.ok(doc.querySelector('.nui-fields[data-filled]'), 'the list marks itself filled');
  await mount(<FieldList><FieldRow label="Owner">Flo</FieldRow></FieldList>);
  assert.equal(doc.querySelector('.nui-fields')!.hasAttribute('data-filled'), false, 'a sheet stays unmarked');
  assert.match(cssRule('.nui-fields[data-filled]') ?? '', /max-width: 36rem;/, 'a wide page keeps a reading width');
  // One column at every width: this selector outranks the 340px container rule that puts labels beside values.
  assert.match(cssRule('.nui-fields[data-filled] .nui-field-row') ?? '', /grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(cssRule('.nui-fields[data-filled] :is(.nui-field-input, .nui-field-textarea, .nui-field-trigger)') ?? '',
    /background: hsl\(var\(--foreground\) \/ \.05\);/, 'an empty field shows its box at rest');
});

test('a long text field is one line tall for one line and grows with its text', async () => {
  await mount(
    <FieldList>
      <FieldRow label="Note" stacked><FieldLongText label="Note" value="One line" onChange={() => undefined} /></FieldRow>
    </FieldList>,
  );
  assert.equal(doc.querySelector('textarea')!.getAttribute('rows'), '4', 'four lines where the browser cannot fit the box to its text');
  const rule = cssRule('.nui-field-textarea') ?? '';
  assert.match(rule, /min-height: 36px/, 'one 24px line and its padding');
  assert.match(rule, /field-sizing: content/);
  assert.doesNotMatch(rule, /96px/);
});

test('a disclosure summary (a long day) wraps in a narrow reader instead of being cut; a select keeps one line (follow-up B11)', async () => {
  const due = formatLongDay(new Date(2026, 8, 30), 'en');
  await mount(
    <FieldList>
      <FieldRow label="Due"><FieldDisclosure label="Due" summary={due}>-</FieldDisclosure></FieldRow>
      <FieldRow label="Status">
        <FieldSelect label="Status" value="todo" options={[{ value: 'todo', label: 'To do' }]} onChange={() => undefined} />
      </FieldRow>
    </FieldList>,
  );
  const [disclosure, select] = [...doc.querySelectorAll('button.nui-field-trigger')];
  assert.equal(disclosure!.querySelector('.nui-field-text')!.textContent, 'Wednesday, September 30, 2026', 'the whole day, as words');
  assert.equal(disclosure!.hasAttribute('data-wrap'), true);
  assert.equal(select!.hasAttribute('data-wrap'), false, 'an option name stays on one line');
  const text = cssRule('.nui-field-trigger[data-wrap] > .nui-field-text') ?? '';
  assert.match(text, /white-space: normal;/, 'it wraps');
  assert.match(text, /overflow-wrap: anywhere;/, 'a long word (a link) breaks rather than overflows');
  assert.match(cssRule('.nui-field-trigger[data-wrap]') ?? '', /align-items: flex-start;/, 'the caret stays beside the first line');
  assert.match(cssRule('.nui-field-trigger > .nui-field-text') ?? '', /white-space: nowrap;/, 'the other triggers still cut');
});

test('a row hint describes the control in it; an invalid row marks its text control and reads its hint as the error', async () => {
  const noop = () => undefined;
  const one = [{ value: 'a', label: 'A' }];
  await mount(
    <FieldList>
      <FieldRow label="Name" hint="Shown in the list"><FieldText label="Name" value="" onChange={noop} /></FieldRow>
      <FieldRow label="Note" hint="Keep it under 200 characters" invalid>
        <FieldLongText label="Note" value="x" onChange={noop} />
      </FieldRow>
      <FieldRow label="Status" hint="Applies at once" invalid>
        <FieldSelect label="Status" value={null} options={one} onChange={noop} />
      </FieldRow>
      <FieldRow label="Tags" hint="One or more"><FieldMultiSelect label="Tags" values={[]} options={one} onChange={noop} /></FieldRow>
      <FieldRow label="Due" hint="Any day"><FieldDisclosure label="Due" summary="Today">-</FieldDisclosure></FieldRow>
      <FieldRow label="Plain"><FieldText label="Plain" value="" onChange={noop} /></FieldRow>
      <FieldRow label="Own" hint="Row hint" invalid>
        <FieldText label="Own" value="" onChange={noop} invalid={false} describedBy="own-help" />
      </FieldRow>
    </FieldList>,
  );
  const rowOf = (el: Element) => el.closest('.nui-field-row')!;
  const hintIdOf = (el: Element) => rowOf(el).querySelector('.nui-field-hint')!.id;
  const name = inputNamed('Name')!;
  assert.ok(hintIdOf(name));
  assert.equal(name.getAttribute('aria-describedby'), hintIdOf(name));
  assert.equal(doc.getElementById(name.getAttribute('aria-describedby')!)!.textContent, 'Shown in the list');
  assert.equal(name.hasAttribute('aria-invalid'), false);
  const note = doc.querySelector('textarea')!;
  assert.equal(note.getAttribute('aria-invalid'), 'true');
  assert.equal(note.getAttribute('aria-describedby'), hintIdOf(note), 'the hint says what is wrong');
  assert.ok(rowOf(note).hasAttribute('data-invalid'));
  const triggers = [...doc.querySelectorAll('button.nui-field-trigger')];
  assert.equal(triggers.length, 3, 'select, multi-select and disclosure');
  for (const trigger of triggers) {
    assert.equal(trigger.getAttribute('aria-describedby'), hintIdOf(trigger), trigger.getAttribute('aria-label') ?? '');
    assert.equal(trigger.hasAttribute('aria-invalid'), false, 'no aria-invalid on a button');
  }
  const plain = inputNamed('Plain')!;
  assert.equal(plain.hasAttribute('aria-describedby'), false, 'no hint: nothing describes the field');
  assert.equal(plain.hasAttribute('aria-invalid'), false);
  const own = inputNamed('Own')!;
  assert.equal(own.getAttribute('aria-describedby'), 'own-help', 'the field\'s own props win over its row');
  assert.equal(own.hasAttribute('aria-invalid'), false);
  assert.match(cssRule('.nui-field-row[data-invalid] > .nui-field-value > .nui-field-hint') ?? '', /color: hsl\(var\(--destructive\)\)/);
  assert.match(cssRule('.nui-field-input[aria-invalid="true"], .nui-field-textarea[aria-invalid="true"]') ?? '',
    /background: hsl\(var\(--destructive\) \/ \.06\)/);
});

// ---- multi-select search and add (follow-up B12) ----

const TAGS: FieldOption<string>[] = [
  { value: 'work', label: 'Work' },
  { value: 'summer', label: 'Été' },
  { value: 'personal', label: 'Personal' },
  { value: 'archived', label: 'Archived', disabled: true },
];

/** The values each change gave. */
let pickedTags: string[][] = [];

/** A searchable tag picker over state; `onAdd` returns the new value, which the picker adds to its options. */
function TagPicker({ onAdd }: { onAdd?: (text: string) => Promise<string> }) {
  const [options, setOptions] = useState<FieldOption<string>[]>(TAGS);
  const [values, setValues] = useState<string[]>(['work']);
  return (
    <FieldList>
      <FieldRow label="Tags">
        <FieldMultiSelect
          label="Tags"
          values={values}
          options={options}
          searchable
          onChange={(next) => { pickedTags.push(next); setValues(next); }}
          onAdd={onAdd ? async (text) => {
            const value = await onAdd(text);
            setOptions((current) => [...current, { value, label: text }]);
            return value;
          } : undefined}
        />
      </FieldRow>
    </FieldList>
  );
}

async function openSearch(): Promise<HTMLInputElement> {
  await act(async () => { doc.querySelector<HTMLButtonElement>('button.nui-field-trigger')!.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  return doc.querySelector<HTMLInputElement>('.nui-popover input.nui-field-search')!;
}

const activeOption = (search: HTMLInputElement) =>
  doc.getElementById(search.getAttribute('aria-activedescendant') ?? '')?.textContent ?? null;
const shownOptions = () => [...doc.querySelectorAll('.nui-field-option')].map((option) => option.textContent);
const searchStatus = () => doc.querySelector('.nui-field-search-status')!.textContent;

test('a searchable multi-select filters as you type (case and accents ignored) and Enter toggles the active option', async () => {
  pickedTags = [];
  await mount(<TagPicker />);
  const trigger = doc.querySelector<HTMLButtonElement>('button.nui-field-trigger')!;
  const search = await openSearch();
  assert.ok(search, 'the search box opens in a popover');
  assert.equal(doc.activeElement, search, 'focus is in the search box');
  assert.equal(search.getAttribute('role'), 'combobox');
  assert.equal(search.getAttribute('aria-label'), 'Search');
  assert.equal(search.getAttribute('aria-expanded'), 'true');
  const listbox = doc.getElementById(search.getAttribute('aria-controls')!)!;
  assert.equal(listbox.getAttribute('role'), 'listbox');
  assert.equal(listbox.getAttribute('aria-multiselectable'), 'true');
  assert.deepEqual([...listbox.querySelectorAll('[role="option"]')].map((option) => option.getAttribute('aria-selected')),
    ['true', 'false', 'false', 'false']);
  assert.equal(activeOption(search), 'Work', 'the first option is active');
  await press(search, 'ArrowUp');
  assert.equal(activeOption(search), 'Personal', 'Up wraps to the last option, past the disabled one');
  await press(search, 'ArrowDown');
  assert.equal(activeOption(search), 'Work', 'Down wraps back to the first, past the disabled one');
  await type(search, 'ETE');
  assert.deepEqual(shownOptions(), ['Été']);
  await press(search, 'Enter');
  assert.deepEqual(pickedTags, [['work', 'summer']], 'Enter toggles the active option, in the options order');
  assert.equal(search.value, '', 'choosing clears the search');
  assert.equal(shownOptions().length, TAGS.length);
  assert.equal(activeOption(search), 'Été', 'the chosen option stays active, so several can be toggled in a row');
  assert.equal(doc.getElementById(search.getAttribute('aria-activedescendant')!)!.getAttribute('aria-selected'), 'true');
  await press(search, 'Enter');
  assert.deepEqual(pickedTags.at(-1), ['work'], 'Enter again toggles it off');
  await type(search, 'zzz');
  assert.equal(search.getAttribute('aria-expanded'), 'false');
  assert.equal(search.hasAttribute('aria-activedescendant'), false);
  assert.equal(doc.querySelector('.nui-field-options'), null);
  assert.equal(searchStatus(), 'No match');
  await press(search, 'Escape');
  assert.equal(doc.querySelector('.nui-popover'), null, 'Escape closes the search');
  assert.equal(doc.activeElement, trigger, 'focus is back on the trigger');
});

test('Escape closes the search while options show too', async () => {
  await mount(<TagPicker />);
  const trigger = doc.querySelector<HTMLButtonElement>('button.nui-field-trigger')!;
  const search = await openSearch();
  await type(search, 'wo');
  assert.equal(search.getAttribute('aria-expanded'), 'true');
  await press(search, 'Escape');
  assert.equal(doc.querySelector('.nui-popover'), null);
  assert.equal(doc.activeElement, trigger);
});

test('with onAdd, the typed text becomes a new option, selected and active', async () => {
  pickedTags = [];
  const asked: string[] = [];
  await mount(<TagPicker onAdd={async (text) => { asked.push(text); return text.toLowerCase(); }} />);
  const trigger = doc.querySelector<HTMLButtonElement>('button.nui-field-trigger')!;
  const search = await openSearch();
  await type(search, 'work');
  assert.deepEqual(shownOptions(), ['Work'], 'an option is named exactly that: nothing to add');
  await type(search, 'ete');
  assert.deepEqual(shownOptions(), ['Été'], 'the same name without accents is no new option either');
  await type(search, 'Travel');
  assert.deepEqual(shownOptions(), ['Add "Travel"']);
  assert.equal(activeOption(search), 'Add "Travel"');
  await press(search, 'Enter');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  assert.deepEqual(asked, ['Travel']);
  assert.deepEqual(pickedTags, [['work', 'travel']], 'the new option is selected');
  assert.equal(search.value, '');
  assert.equal(activeOption(search), 'Travel', 'the new option is active');
  assert.equal(doc.getElementById(search.getAttribute('aria-activedescendant')!)!.getAttribute('aria-selected'), 'true');
  assert.equal(trigger.getAttribute('aria-label'), 'Tags: Work, Travel');
});

test('an add that fails keeps the typed text and says so in the status line', async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args[0]); };
  try {
    pickedTags = [];
    await mount(<TagPicker onAdd={async () => { throw new Error('offline'); }} />);
    const search = await openSearch();
    await type(search, 'Travel');
    await press(search, 'Enter');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    assert.equal(search.value, 'Travel', 'the typed text stays for another try');
    assert.equal(searchStatus(), 'Could not add "Travel". Try again.');
    assert.equal(doc.querySelector('.nui-field-search-status')!.getAttribute('role'), 'status');
    assert.equal(doc.querySelector('[role="alert"]'), null);
    assert.deepEqual(pickedTags, []);
    assert.deepEqual(logged, [], 'the search status carries the failure; nothing reaches the console (C1)');
    await type(search, 'Travels');
    assert.equal(searchStatus(), '', 'typing clears the failure');
  } finally {
    console.error = original;
  }
});

test('the multi-select search speaks French', async () => {
  await mount(<TagPicker onAdd={async (text) => text.toLowerCase()} />, 'fr');
  const search = await openSearch();
  assert.equal(search.getAttribute('aria-label'), 'Rechercher');
  assert.equal(search.getAttribute('placeholder'), 'Rechercher');
  await type(search, 'Voyage');
  assert.equal(activeOption(search), 'Ajouter "Voyage"');
  await mount(<TagPicker />, 'fr');
  await type(await openSearch(), 'zzz');
  assert.equal(searchStatus(), 'Aucun résultat');
});

test('every field word has English and French', () => {
  for (const [key, words] of Object.entries(FIELD_WORDS)) {
    assert.ok(words.en && words.fr, key);
  }
});
