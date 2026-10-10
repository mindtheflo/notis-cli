import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { refreshDatabaseStructures } from '../src/runtime/space-database-structures.js';

function fixture(definition) {
  const root = mkdtempSync(join(tmpdir(), 'notis-live-structure-'));
  mkdirSync(join(root, 'spaces'));
  writeFileSync(join(root, 'notis.config.ts'), `import {defineSpaces as spaces} from '@notis/sdk/config'; export default spaces({spaces:{notes:{definition:'spaces/notes.ts'}}});`);
  writeFileSync(join(root, 'spaces/notes.ts'), definition);
  return root;
}

test('pull updates only live schema/name, preserves helpers/rows/comments, and is repeatable', () => {
  const source = `import {defineSpace as space} from '@notis/sdk/config';
// shared export used by the view; do not regenerate the module
export const columns = ['Name'];
const resources = { notes: {kind:'database',create:{name:'Old',schema:{old:true},starterRows:[{title:'Keep'}]}} };
export default space({name:'Notes',entry:'./view.tsx',resources});
throw new Error('The source must not execute during pull');
`;
  const root = fixture(source);
  try {
    const structures = { notes: { name: 'Current', schema: { properties: { title: { kind: 'title' } } } } };
    assert.deepEqual(refreshDatabaseStructures(root, 'notes', structures), ['spaces/notes.ts']);
    const updated = readFileSync(join(root, 'spaces/notes.ts'), 'utf8');
    assert.ok(updated.includes("export const columns = ['Name'];"));
    assert.ok(updated.includes("starterRows:[{title:'Keep'}]"));
    assert.ok(updated.includes('// shared export'));
    assert.ok(updated.includes('name:"Current"'));
    assert.ok(!updated.includes('old:true'));
    refreshDatabaseStructures(root, 'notes', structures);
    assert.equal(readFileSync(join(root, 'spaces/notes.ts'), 'utf8'), updated);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('relative shared resource declarations and spreads retain every unrelated source byte', () => {
  const root = fixture(`import {defineSpace} from '@notis/sdk/config'; import {resources as base} from './shared';
const resources={...base};export default defineSpace({name:'Notes',resources});`);
  const shared = `const seed={name:'Seed',schema:{}};
export const resources={notes:{kind:'database',create:seed},calendar:{kind:'database',key:'calendar'}};
export const keep='unchanged';`;
  writeFileSync(join(root, 'spaces/shared.ts'), shared);
  try {
    const structures = { notes: { name: 'Live notes', schema: { properties: { Title: {} } } } };
    assert.deepEqual(refreshDatabaseStructures(root, 'notes', structures), ['spaces/shared.ts']);
    const first = readFileSync(join(root, 'spaces/shared.ts'), 'utf8');
    assert.ok(first.includes("calendar:{kind:'database',key:'calendar'}"));
    assert.ok(first.includes("export const keep='unchanged';"));
    refreshDatabaseStructures(root, 'notes', structures);
    assert.equal(readFileSync(join(root, 'spaces/shared.ts'), 'utf8'), first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ambiguous or unsupported declarations fail before changing any downloaded file', () => {
  const source = `export default buildUnknownDefinition();`;
  const root = fixture(source);
  try {
    assert.throws(() => refreshDatabaseStructures(root, 'notes', { notes: { name: 'Live', schema: {} } }), /statically addressable/);
    assert.equal(readFileSync(join(root, 'spaces/notes.ts'), 'utf8'), source);
    assert.deepEqual(refreshDatabaseStructures(root, 'notes', {}), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
