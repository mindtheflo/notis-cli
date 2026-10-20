import assert from 'node:assert/strict';
import test from 'node:test';

import { NotisKeyClash, ShortcutRegistry } from './registry';
import { stepCursor } from './step';
import type { ShortcutDef } from './types';

const def = (id: string, keys: string | string[], scope: ShortcutDef['scope'], extra: Partial<ShortcutDef> = {}):
  ShortcutDef => ({ id, keys, scope, label: { en: id, fr: `${id} (fr)` }, run: () => {}, ...extra });

test('higher scopes are asked first, the latest registration first within a scope', () => {
  const registry = new ShortcutRegistry({ strict: true });
  registry.defineOwner('tickets');
  registry.defineOwner('notes');
  registry.register(def('row.e', 'e', 'collection'), 'tickets');
  registry.register(def('detail.e', 'e', 'detail'), 'tickets');
  registry.register(def('route.e', 'e', 'route'), 'tickets');
  registry.register(def('other.e', 'e', 'collection'), 'notes');
  registry.register(def('modal.e', 'e', 'modal'), 'tickets');
  assert.deepEqual(registry.active().map((entry) => entry.def.id),
    ['modal.e', 'detail.e', 'other.e', 'row.e', 'route.e']);
  assert.deepEqual(registry.active({ modalOnly: true }).map((entry) => entry.def.id), ['modal.e']);
});

test('boost lifts a def inside its scope (the selection bar uses 25), capped below the next scope', () => {
  const registry = new ShortcutRegistry({ strict: true });
  registry.defineOwner('tickets');
  registry.defineOwner('bar');
  registry.register(def('row.e', 'e', 'collection'), 'tickets');
  registry.register(def('bar.e', 'e', 'collection', { boost: 25 }), 'bar');
  registry.register(def('row.x', 'x', 'collection'), 'tickets');
  assert.equal(registry.active()[0]!.def.id, 'bar.e');
  registry.register(def('huge', 'h', 'collection', { boost: 500 }), 'tickets');
  const huge = registry.active().find((entry) => entry.def.id === 'huge')!;
  assert.equal(huge.rank, 200 + 99);
});

test('a duplicate in the same scope and owner throws NotisKeyClash in strict mode, naming both ids', () => {
  const registry = new ShortcutRegistry({ strict: true });
  registry.defineOwner('tickets');
  registry.register(def('triage', 'e', 'collection'), 'tickets');
  assert.throws(() => registry.register(def('archive', ['shift+e', 'e'], 'collection'), 'tickets'), (error: unknown) => {
    assert.ok(error instanceof NotisKeyClash);
    assert.equal(error.clash.kind, 'duplicate');
    assert.match(error.message, /"triage" and "archive"/);
    return true;
  });
  // Same key in another scope, or another owner, is legal.
  assert.ok(registry.register(def('detail.e', 'e', 'detail'), 'tickets'));
  registry.defineOwner('notes');
  assert.ok(registry.register(def('notes.e', 'e', 'collection'), 'notes'));
});

test('production drops the later def and logs once', () => {
  const logs: string[] = [];
  const registry = new ShortcutRegistry({ strict: false, onClash: (message) => logs.push(message) });
  registry.defineOwner('tickets');
  registry.register(def('first', 'e', 'collection'), 'tickets');
  assert.equal(registry.register(def('second', 'e', 'collection'), 'tickets'), null);
  assert.equal(registry.register(def('second', 'e', 'collection'), 'tickets'), null);
  assert.equal(logs.length, 1);
  assert.deepEqual(registry.active().map((entry) => entry.def.id), ['first']);
});

test('Spaces cannot take host keys or the app scope; the host can', () => {
  const registry = new ShortcutRegistry({ strict: true });
  registry.defineOwner('tickets');
  for (const keys of ['/', '?', 'c', 'shift+c', 'mod+k', 'ctrl+k', 'alt+p', 'escape', 'shift+tab']) {
    assert.throws(() => registry.register(def(`s.${keys}`, keys, 'route'), 'tickets'), /Notis keeps for itself/, keys);
  }
  assert.throws(() => registry.register(def('s.app', 'x', 'app'), 'tickets'), /app scope/);
  assert.ok(registry.register(def('host.search', '/', 'app')));
  assert.throws(() => registry.register(def('s.bad', 'hyper+q', 'route'), 'tickets'), /Invalid key spec/);
});

test('an unavailable owner (hidden retained view) goes silent, and so do its children', () => {
  const registry = new ShortcutRegistry({ strict: true });
  registry.defineOwner('tickets');
  registry.defineOwner('tickets/view-a', { parent: 'tickets' });
  registry.defineOwner('tickets/view-b', { parent: 'tickets', available: false });
  registry.register(def('a.next', 'j', 'collection'), 'tickets/view-a');
  registry.register(def('b.next', 'j', 'collection'), 'tickets/view-b');
  assert.deepEqual(registry.active().map((entry) => entry.def.id), ['a.next']);
  assert.deepEqual(registry.helpEntries().map((row) => row.id), ['a.next']);
  registry.setOwnerAvailable('tickets/view-a', false);
  registry.setOwnerAvailable('tickets/view-b', true);
  assert.deepEqual(registry.active().map((entry) => entry.def.id), ['b.next']);
  registry.setOwnerAvailable('tickets', false);
  assert.deepEqual(registry.active(), []);
  assert.equal(registry.ownerKind('tickets/view-b'), 'space');
});

test('a hidden view registering the same key as its visible twin never clashes', () => {
  const registry = new ShortcutRegistry({ strict: true });
  registry.defineOwner('view', { available: false });
  registry.register(def('one', 'e', 'collection'), 'view');
  assert.ok(registry.register(def('two', 'e', 'collection'), 'view'));
});

test('the help sheet lists available, visible defs, Space group first, latest per id, in both languages', () => {
  const registry = new ShortcutRegistry({ strict: true });
  registry.register(def('host.search', '/', 'app'));
  registry.defineOwner('tickets');
  registry.register(def('list.next', ['j', 'arrowdown'], 'collection'), 'tickets');
  registry.register(def('secret', 'q', 'collection', { hidden: true }), 'tickets');
  registry.register(def('gated', 'w', 'collection', { when: () => false }), 'tickets');
  registry.register(def('modal.only', 'y', 'modal'), 'tickets');
  const entries = registry.helpEntries();
  assert.deepEqual(entries.map((row) => [row.id, row.group]), [['list.next', 'space'], ['host.search', 'notis']]);
  assert.deepEqual(entries[0]!.keys, ['j', 'arrowdown']);
  assert.deepEqual(registry.helpText('fr').map((row) => row.label), ['list.next (fr)', 'host.search (fr)']);
});

test('owners are ref counted and notify listeners', () => {
  const registry = new ShortcutRegistry({ strict: true });
  let calls = 0;
  registry.subscribe(() => { calls += 1; });
  const releaseA = registry.defineOwner('tickets');
  const releaseB = registry.defineOwner('tickets', { available: false });
  assert.equal(registry.isOwnerAvailable('tickets'), false);
  releaseA();
  assert.equal(registry.isOwnerAvailable('tickets'), false);
  releaseB();
  assert.equal(registry.isOwnerAvailable('tickets'), true, 'unknown owners count as available');
  assert.ok(calls >= 4);
});

test('stepCursor wraps on a fresh press only', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(stepCursor(ids, 'c', 1), 'a');
  assert.equal(stepCursor(ids, 'a', -1), 'c');
  assert.equal(stepCursor(ids, 'c', 1, { repeat: true }), 'c');
  assert.equal(stepCursor(ids, 'a', -1, { repeat: true }), 'a');
  assert.equal(stepCursor(ids, 'c', 1, { wrap: false }), 'c');
  assert.equal(stepCursor(ids, 'b', 1, { repeat: true }), 'c');
  assert.equal(stepCursor(ids, null, 1), 'a');
  assert.equal(stepCursor(ids, 'gone', -1), 'c');
  assert.equal(stepCursor([], 'a', 1), null);
});
