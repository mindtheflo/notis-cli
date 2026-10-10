import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { refreshSpaceAuthoring } from '../src/runtime/space-database-structures.js';

function fixture(t, definition, extras = {}) {
  const root = mkdtempSync(join(tmpdir(), 'notis-copy-authoring-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = { 'notis.config.ts': `export default { spaces: { notes: { definition: './spaces/notes.ts' } } };`,
    'spaces/notes.ts': definition, 'untouched.txt': 'keep original bytes', ...extras };
  for (const [name, value] of Object.entries(files)) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), value); }
  return { root, source: () => readFileSync(join(root, 'spaces/notes.ts'), 'utf8') };
}
const overrides = { record_params: { note: { database: 'notes', main: false } },
  resource_keys: { notes: { kind: 'database', key: 'copied:notes-db' } } };

test('copied params and resource keys project locally and repeated pulls do not nest wrappers', t => {
  const { root, source } = fixture(t, `// keep comment\nexport const unrelated = 'retain';\nexport default {
    params: { note: {type:'record',database:'notes',main:true,description:'Open'} },
    resources: { notes: {kind:'database',key:'original:db'} }, name:'Unchanged'
  };`);
  assert.deepEqual(refreshSpaceAuthoring(root, 'notes', { authoringOverrides: overrides }), ['spaces/notes.ts']);
  const first = source(); assert.match(first, /main:false/); assert.match(first, /key:"copied:notes-db"/);
  assert.match(first, /keep comment/); assert.match(first, /name:'Unchanged'/);
  refreshSpaceAuthoring(root, 'notes', { authoringOverrides: overrides }); assert.equal(source(), first);
  assert.equal(readFileSync(join(root, 'untouched.txt'), 'utf8'), 'keep original bytes');
});

test('shared imported params are overridden only at selected definition and source helper is untouched', t => {
  const helper = `export const params={note:{type:'record',database:'notes',main:true}};`;
  const { root, source } = fixture(t, `import {params} from '../shared';\nexport default {params:params,resources:{notes:{kind:'database',key:'old'}}};`,
    {'shared.ts': helper});
  refreshSpaceAuthoring(root, 'notes', { authoringOverrides: overrides });
  assert.match(source(), /"note": \(\{ \.\.\./); assert.match(source(), /main: false/);
  assert.equal(readFileSync(join(root, 'shared.ts'), 'utf8'), helper);
  const first = source(); refreshSpaceAuthoring(root, 'notes', { authoringOverrides: overrides }); assert.equal(source(), first);
});

test('a copy that keeps an existing database projects create to a key without touching shared source', t => {
  const helper = `export const resources={notes:{kind:'database',create:{name:'Notes',schema:{properties:{}}}}};`;
  const { root, source } = fixture(t, `import {resources} from '../shared';\nexport default {
    params:{note:{type:'record',database:'notes',main:true}}, resources:resources, name:'Copied view'
  };`, { 'shared.ts': helper, 'spaces/sibling.ts': `import {resources} from '../shared'; export default {resources};` });
  const projection = { record_params: overrides.record_params, resource_keys: { notes: { kind: 'database', key: 'notes' } } };
  refreshSpaceAuthoring(root, 'notes', { authoringOverrides: projection });
  assert.match(source(), /"notes": \{"kind":"database","key":"notes"\}/);
  assert.match(source(), /main:false/);
  assert.equal(readFileSync(join(root, 'shared.ts'), 'utf8'), helper);
  assert.equal(readFileSync(join(root, 'spaces/sibling.ts'), 'utf8'), `import {resources} from '../shared'; export default {resources};`);
  const first = source(); refreshSpaceAuthoring(root, 'notes', { authoringOverrides: projection });
  assert.equal(source(), first, 'Repeated pulls converge without new wrappers or creation declarations');
});

test('create-to-key projection replaces the selected declaration, keeping unrelated resources and definitions', t => {
  const { root, source } = fixture(t, `export const helper='untouched'; export default {
    params:{note:{type:'record',database:'notes',main:true}},
    resources:{notes:{kind:'database',create:{name:'Notes',schema:{properties:{}}}},other:{kind:'skill',key:'helper'}}
  };`);
  refreshSpaceAuthoring(root, 'notes', { authoringOverrides: overrides });
  assert.match(source(), /notes:\{"kind":"database","key":"copied:notes-db"\}/);
  assert.doesNotMatch(source(), /create:/);
  assert.match(source(), /other:\{kind:'skill',key:'helper'\}/);
  assert.match(source(), /helper='untouched'/);
});

test('ambiguous or changed record mapping fails before writing any schema or authoring projection', t => {
  const {root,source}=fixture(t, `export default {params:{note:{type:'record',database:'wrong',main:true}},
    resources:{notes:{kind:'database',create:{name:'Old',schema:{properties:{}}}}}};`);
  const before=source();
  assert.throws(()=>refreshSpaceAuthoring(root,'notes',{databaseStructures:{notes:{name:'New',schema:{properties:{}}}},
    authoringOverrides:overrides}),/not statically addressable/);
  assert.equal(source(),before);
});

test('computed configs and foreign override fields fail closed without running authored code', t => {
  const {root,source}=fixture(t, `export default buildConfig();`);
  const before=source();assert.throws(()=>refreshSpaceAuthoring(root,'notes',{authoringOverrides:overrides}),/not statically addressable/);
  assert.equal(source(),before);
  assert.throws(()=>refreshSpaceAuthoring(root,'notes',{authoringOverrides:{actor:'foreign'}}),/not statically addressable/);
});
