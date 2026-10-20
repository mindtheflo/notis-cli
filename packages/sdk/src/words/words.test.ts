import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ActionError,
  DEFAULT_KEYMAP,
  HELP_WORDS,
  HOST_RESERVED_KEYS,
  KEY_JOIN_WORDS,
  SHELL_WORDS,
  STANDARD_ACTIONS,
  STANDARD_ACTION_IDS,
  actionErrorReason,
  actionKeyClashes,
  actionToast,
  canonicalKey,
  checkClashes,
  clashErrors,
  formatKey,
  formatKeySpoken,
  isHostReserved,
  matchKey,
  parseKeySpec,
  pick,
  selectedCount,
  type KeyEventLike,
  type Words,
} from './index';

const EM_DASH = /\u2014/;
const EMOJI = /\p{Extended_Pictographic}/u;

function assertWords(words: Words, where: string): void {
  assert.equal(typeof words.en, 'string', `${where}: en`);
  assert.equal(typeof words.fr, 'string', `${where}: fr`);
  assert.ok(words.en.trim().length > 0, `${where}: en is empty`);
  assert.ok(words.fr.trim().length > 0, `${where}: fr is empty`);
  for (const text of [words.en, words.fr]) {
    assert.doesNotMatch(text, EM_DASH, `${where}: em dash`);
    assert.doesNotMatch(text, EMOJI, `${where}: emoji`);
  }
}

test('the catalogue has the 17 standard actions, each in English and French', () => {
  assert.equal(STANDARD_ACTION_IDS.length, 17);
  assert.deepEqual(Object.keys(STANDARD_ACTIONS).sort(), [...STANDARD_ACTION_IDS].sort());
  for (const id of STANDARD_ACTION_IDS) {
    const action = STANDARD_ACTIONS[id];
    assert.equal(action.id, id);
    assertWords(action.label, `${id}.label`);
    assert.ok(action.icon, `${id}: icon`);
    if (action.key !== null) assert.doesNotThrow(() => parseKeySpec(action.key!), `${id}: key parses`);
    if (action.toast) {
      assertWords(action.toast.one, `${id}.toast.one`);
      assertWords(action.toast.other, `${id}.toast.other`);
      for (const n of [1, 3]) {
        const toast = actionToast(id, n)!;
        assertWords(toast, `${id} toast n=${n}`);
        assert.doesNotMatch(toast.en, /\{n\}/, `${id}: {n} filled`);
        assert.doesNotMatch(toast.fr, /\{n\}/, `${id}: {n} filled (fr)`);
      }
      if (action.toast.other.en.includes('{n}')) assert.match(actionToast(id, 3)!.en, /3/);
      if (action.toast.other.fr.includes('{n}')) assert.match(actionToast(id, 3)!.fr, /3/);
    }
  }
});

test('no two standard actions share a key except toggle pairs', () => {
  const clashes = actionKeyClashes([...STANDARD_ACTION_IDS]);
  for (const clash of clashes) {
    const kinds = clash.ids.map((id) => STANDARD_ACTIONS[id as keyof typeof STANDARD_ACTIONS]);
    assert.ok(kinds.every(Boolean));
  }
  assert.deepEqual(actionKeyClashes(['star', 'unstar']), []);
});

test('shell, help and keymap words exist in English and French', () => {
  for (const [id, words] of Object.entries(SHELL_WORDS)) assertWords(words as Words, `shell.${id}`);
  for (const [id, words] of Object.entries(HELP_WORDS)) assertWords(words, `help.${id}`);
  for (const [id, words] of Object.entries(KEY_JOIN_WORDS)) assertWords(words, `join.${id}`);
  for (const [id, entry] of Object.entries(DEFAULT_KEYMAP)) {
    assert.equal(entry.id, id);
    assertWords(entry.label, `keymap.${id}`);
    for (const spec of entry.keys) assert.doesNotThrow(() => parseKeySpec(spec), `${id}: ${spec}`);
  }
  assert.equal(HELP_WORDS.title.en, 'Keyboard shortcuts');
  assert.equal(HELP_WORDS.title.fr, 'Raccourcis clavier');
  assert.equal(HELP_WORDS.groupSpace.fr, 'Ce Space');
  assert.equal(pick(selectedCount(1), 'en'), '1 selected');
  assert.match(pick(selectedCount(4), 'fr'), /4/);
});

test('every host key in the default keymap is host-reserved or Manager only, and Space entries are not', () => {
  for (const entry of Object.values(DEFAULT_KEYMAP)) {
    if (entry.host) {
      assert.equal(entry.scope, 'app', entry.id);
      continue;
    }
    for (const spec of entry.keys) assert.equal(isHostReserved(spec), false, `${entry.id} ${spec}`);
  }
  for (const spec of HOST_RESERVED_KEYS) assert.ok(isHostReserved(spec), spec);
  assert.ok(isHostReserved('escape x'), 'a sequence starting with a reserved key');
  assert.ok(isHostReserved('ctrl+k'), 'ctrl+k is mod+k off a Mac');
});

test('formatKey reads like the deck on Mac and elsewhere, in both languages', () => {
  assert.equal(formatKey('shift+e', { platform: 'mac', locale: 'en' }), '⇧E');
  assert.equal(formatKey('mod+a', { platform: 'mac', locale: 'en' }), '⌘A');
  assert.equal(formatKey('ctrl+alt+shift+mod+k', { platform: 'mac', locale: 'en' }), '⌃⌥⇧⌘K');
  assert.equal(formatKey('mod+a', { platform: 'other', locale: 'en' }), 'Ctrl+A');
  assert.equal(formatKey('shift+e', { platform: 'other', locale: 'en' }), 'Shift+E');
  assert.equal(formatKey('shift+e', { platform: 'other', locale: 'fr' }), 'Maj+E');
  assert.equal(formatKey('g i', { platform: 'mac', locale: 'en' }), 'G then I');
  assert.equal(formatKey('g i', { platform: 'mac', locale: 'fr' }), 'G puis I');
  assert.equal(formatKey(['j', 'arrowdown'], { platform: 'mac', locale: 'en' }), 'J or ↓');
  assert.equal(formatKey(['j', 'arrowdown'], { platform: 'mac', locale: 'fr' }), 'J ou ↓');
  assert.equal(formatKey('escape', { platform: 'other', locale: 'fr' }), 'Échap');
  assert.equal(formatKey('enter', { platform: 'other', locale: 'fr' }), 'Entrée');
  assert.equal(formatKey('?', { platform: 'mac', locale: 'en' }), '?');
});

test('formatKeySpoken spells glyphs out for screen readers', () => {
  assert.equal(formatKeySpoken('mod+a', { platform: 'mac', locale: 'en' }), 'Command A');
  assert.equal(formatKeySpoken('mod+a', { platform: 'other', locale: 'fr' }), 'Contrôle A');
  assert.equal(formatKeySpoken('alt+p', { platform: 'mac', locale: 'en' }), 'Option P');
  assert.equal(formatKeySpoken('shift+e', { platform: 'mac', locale: 'fr' }), 'Maj E');
  assert.equal(formatKeySpoken(['k', 'arrowup'], { platform: 'mac', locale: 'fr' }), 'K ou Flèche haut');
  assert.equal(formatKeySpoken('g i', { platform: 'other', locale: 'en' }), 'G then I');
});

const ev = (event: KeyEventLike): KeyEventLike => event;

test('letters match on event.key, with Shift exact', () => {
  assert.ok(matchKey(ev({ key: 'j', code: 'KeyJ' }), 'j', 'mac'));
  assert.ok(!matchKey(ev({ key: 'J', code: 'KeyJ', shiftKey: true }), 'j', 'mac'));
  assert.ok(matchKey(ev({ key: 'E', code: 'KeyE', shiftKey: true }), 'shift+e', 'mac'));
  assert.ok(!matchKey(ev({ key: 'j', code: 'KeyJ', metaKey: true }), 'j', 'mac'));
  // AZERTY: 'a' sits on KeyQ, the letter wins.
  assert.ok(matchKey(ev({ key: 'a', code: 'KeyQ' }), 'a', 'mac'));
  assert.ok(!matchKey(ev({ key: 'a', code: 'KeyQ' }), 'q', 'mac'));
  // AZERTY comma on KeyM is not M.
  assert.ok(!matchKey(ev({ key: ',', code: 'KeyM' }), 'm', 'mac'));
  // Cyrillic: falls back to the physical key.
  assert.ok(matchKey(ev({ key: 'о', code: 'KeyJ' }), 'j', 'mac'));
});

test('mod is Cmd on Mac and Ctrl elsewhere', () => {
  assert.ok(matchKey(ev({ key: 'a', code: 'KeyA', metaKey: true }), 'mod+a', 'mac'));
  assert.ok(!matchKey(ev({ key: 'a', code: 'KeyA', ctrlKey: true }), 'mod+a', 'mac'));
  assert.ok(matchKey(ev({ key: 'a', code: 'KeyA', ctrlKey: true }), 'mod+a', 'other'));
  assert.ok(matchKey(ev({ key: 'a', code: 'KeyA', ctrlKey: true }), 'ctrl+a', 'other'));
  assert.equal(canonicalKey('ctrl+a', 'other'), canonicalKey('mod+a', 'other'));
});

test('Option chords match the physical key on a Mac', () => {
  // Option+P types π on a US Mac.
  assert.ok(matchKey(ev({ key: 'π', code: 'KeyP', altKey: true }), 'alt+p', 'mac'));
  assert.ok(!matchKey(ev({ key: 'π', code: 'KeyO', altKey: true }), 'alt+p', 'mac'));
  // Option+Shift+S types Í.
  assert.ok(matchKey(ev({ key: 'Í', code: 'KeyS', altKey: true, shiftKey: true }), 'alt+shift+s', 'mac'));
  assert.ok(!matchKey(ev({ key: 'Í', code: 'KeyS', altKey: true, shiftKey: true }), 'alt+s', 'mac'));
  assert.ok(matchKey(ev({ key: '¡', code: 'Digit1', altKey: true }), 'alt+1', 'mac'));
  assert.ok(!matchKey(ev({ key: 'p', code: 'KeyP' }), 'alt+p', 'mac'));
});

test('symbols match the typed character whatever it took to type it', () => {
  // '?' is Shift+/ on US, Shift+, on AZERTY.
  assert.ok(matchKey(ev({ key: '?', code: 'Slash', shiftKey: true }), '?', 'mac'));
  assert.ok(matchKey(ev({ key: '?', code: 'KeyM', shiftKey: true }), '?', 'other'));
  // '[' with Option on a French Mac, with AltGr (Ctrl+Alt) on French Windows: still '[', not an Alt chord.
  assert.ok(matchKey(ev({ key: '[', code: 'Digit5', altKey: true, shiftKey: true }), '[', 'mac'));
  assert.ok(matchKey(ev({ key: '[', code: 'Digit5', altKey: true, ctrlKey: true }), '[', 'other'));
  assert.ok(!matchKey(ev({ key: '[', code: 'BracketLeft', ctrlKey: true }), '[', 'other'));
  assert.ok(!matchKey(ev({ key: '[', code: 'BracketLeft', metaKey: true }), '[', 'mac'));
  assert.ok(matchKey(ev({ key: '#', code: 'Digit3', shiftKey: true }), '#', 'mac'));
  // Digits ignore Shift (AZERTY types digits with Shift).
  assert.ok(matchKey(ev({ key: '1', code: 'Digit1', shiftKey: true }), '1', 'other'));
});

test('named keys and the + key parse', () => {
  assert.deepEqual(parseKeySpec('esc')[0]!.key, 'escape');
  assert.deepEqual(parseKeySpec('mod++')[0], { key: '+', mod: true, ctrl: false, alt: false, shift: false });
  assert.equal(parseKeySpec('g i').length, 2);
  assert.throws(() => parseKeySpec('hyper+x'), /unknown modifier/);
  assert.throws(() => parseKeySpec('f99x'), /unknown key/);
});

test('checkClashes: reserved, app scope, duplicate, shadowed, prefix, invalid', () => {
  const byKind = (defs: Parameters<typeof checkClashes>[0]) => checkClashes(defs).map((clash) => clash.kind);
  assert.deepEqual(byKind([{ id: 's.search', keys: '/', scope: 'route', owner: 'tickets' }]), ['reserved']);
  assert.deepEqual(byKind([{ id: 's.cmd', keys: 'ctrl+k', scope: 'route', owner: 'tickets' }]), ['reserved']);
  assert.deepEqual(byKind([{ id: 'host.search', keys: '/', scope: 'app' }]), []);
  assert.deepEqual(byKind([{ id: 's.x', keys: 'x', scope: 'app', owner: 'tickets' }]), ['app-scope']);
  assert.deepEqual(byKind([
    { id: 'a', keys: 'e', scope: 'collection', owner: 'tickets' },
    { id: 'b', keys: ['shift+e'], scope: 'collection', owner: 'tickets' },
  ]), []);
  // 'E' is the e key (letters are case-free in specs; Shift is spelled out).
  assert.equal(canonicalKey('E'), 'e');
  const dup = clashErrors([
    { id: 'a', keys: 'e', scope: 'collection', owner: 'tickets' },
    { id: 'b', keys: ['x', 'e'], scope: 'collection', owner: 'tickets' },
  ]);
  assert.equal(dup.length, 1);
  assert.equal(dup[0]!.kind, 'duplicate');
  assert.deepEqual(dup[0]!.ids, ['a', 'b']);
  assert.match(dup[0]!.message, /^NotisKeyClash: "a" and "b"/);
  // Different owners or an unavailable def: no clash.
  assert.deepEqual(clashErrors([
    { id: 'a', keys: 'e', scope: 'collection', owner: 'tickets' },
    { id: 'b', keys: 'e', scope: 'collection', owner: 'notes' },
  ]), []);
  assert.deepEqual(clashErrors([
    { id: 'a', keys: 'e', scope: 'collection', owner: 'tickets', available: false },
    { id: 'b', keys: 'e', scope: 'collection', owner: 'tickets' },
  ]), []);
  assert.deepEqual(byKind([
    { id: 'row', keys: 'e', scope: 'collection', owner: 'tickets' },
    { id: 'detail', keys: 'e', scope: 'detail', owner: 'tickets' },
  ]), ['shadowed']);
  assert.deepEqual(byKind([
    { id: 'go', keys: 'g', scope: 'route', owner: 'tickets' },
    { id: 'go.inbox', keys: 'g i', scope: 'route', owner: 'tickets' },
  ]), ['prefix']);
  assert.deepEqual(byKind([{ id: 'bad', keys: 'hyper+x', scope: 'route', owner: 'tickets' }]), ['invalid']);
  // ctrl+a and mod+a are the same key off a Mac.
  assert.equal(clashErrors([
    { id: 'a', keys: 'mod+a', scope: 'route' },
    { id: 'b', keys: 'ctrl+a', scope: 'route' },
  ]).length, 1);
});

test('the default keymap and standard actions do not clash with each other', () => {
  const keymap = Object.values(DEFAULT_KEYMAP)
    .filter((entry) => !entry.host)
    .map((entry) => ({ id: entry.id, keys: [...entry.keys], scope: entry.scope, owner: 'tickets' }));
  const actions = STANDARD_ACTION_IDS
    .filter((id) => STANDARD_ACTIONS[id].key && !STANDARD_ACTIONS[id].managerOnly)
    .map((id) => ({ id, keys: STANDARD_ACTIONS[id].key!, scope: 'collection' as const, owner: 'tickets' }));
  const errors = clashErrors([...keymap, ...actions])
    .filter((clash) => !clash.ids.every((id) => STANDARD_ACTION_IDS.includes(id as never)));
  assert.deepEqual(errors.map((clash) => clash.message), []);
});

test('action refs: toast undefined, null or false turns the default off; toggles pair pause/resume and enable/disable', async () => {
  const { resolveActionRef, toWords } = await import('./actions');
  assert.equal(resolveActionRef({ id: 'complete', toast: undefined }).toast, null);
  assert.equal(resolveActionRef({ id: 'complete', toast: null }).toast, null);
  assert.equal(resolveActionRef({ id: 'complete', toast: false }).toast, null);
  assert.equal(typeof resolveActionRef('complete').toast, 'function');
  assert.equal(typeof resolveActionRef({ id: 'complete' }).toast, 'function', 'no toast key keeps the default');
  assert.equal(STANDARD_ACTIONS.pause.toggle, 'resume');
  assert.equal(STANDARD_ACTIONS.resume.toggle, 'pause');
  assert.equal(STANDARD_ACTIONS.enable.toggle, 'disable');
  assert.equal(STANDARD_ACTIONS.disable.toggle, 'enable');
  // One key on both halves of a pair is no clash, custom pairs included.
  assert.deepEqual(actionKeyClashes([{ id: 'pause', key: 'p' }, { id: 'resume', key: 'p' }]), []);
  assert.deepEqual(actionKeyClashes([{ id: 'on', key: 'o', toggle: 'off' }, { id: 'off', key: 'o', toggle: 'on' }]), []);
  assert.equal(actionKeyClashes([{ id: 'pin', key: 'p' }, { id: 'pause', key: 'p' }]).length, 1);
  assert.deepEqual(toWords('Pause'), { en: 'Pause', fr: 'Pause' });
});

test('ActionError carries the reason a toast shows; actionErrorReason reads the shape, so a Space copy counts', () => {
  const reason = { en: 'The ticket is locked.', fr: 'Le ticket est verrouill\u00e9.' };
  const error = new ActionError(reason, { cause: 'locked' });
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'ActionError');
  assert.equal(error.message, 'The ticket is locked.');
  assert.equal((error as { cause?: unknown }).cause, 'locked');
  assert.deepEqual(actionErrorReason(error), reason);
  assert.equal(actionErrorReason(new ActionError('Plain words.')), 'Plain words.');
  // A Space bundles its own copy of the words: an error of that shape still counts.
  const copy = Object.assign(new Error('x'), { name: 'ActionError', code: 'notis_action_error', reason });
  assert.deepEqual(actionErrorReason(copy), reason);
  assert.equal(actionErrorReason(new Error('socket closed')), null);
  assert.equal(actionErrorReason(Object.assign(new Error('x'), { name: 'ActionError', reason })), null, 'needs the code');
  assert.equal(actionErrorReason('ActionError'), null);
  assert.equal(actionErrorReason(null), null);
});

test('unarchive reads Move to triage, never a Space\u2019s name; a Space names its own first stop', async () => {
  const { resolveActionRef } = await import('./actions');
  assert.deepEqual(STANDARD_ACTIONS.unarchive.label, { en: 'Move to triage', fr: 'D\u00e9placer vers le tri' });
  assert.deepEqual(resolveActionRef('unarchive').label, STANDARD_ACTIONS.unarchive.label);
  const inbox = { en: 'Move to Inbox', fr: 'Remettre dans la bo\u00eete' };
  const own = resolveActionRef({ id: 'unarchive', label: inbox });
  assert.deepEqual(own.label, inbox);
  assert.equal(own.key, 'shift+e', 'the rest of the catalogue entry stays');
  assert.equal(own.icon, 'tray-arrow-up');
  assert.equal(typeof own.toast, 'function');
});
