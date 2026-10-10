import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { generateSpaceManifest } from '../src/runtime/space-platform.js';
const guide = new URL('../../../server/skills/notis-apps/references/views.md', import.meta.url);

test('the shipped complete Space declaration builds its manifest unchanged', () => {
  const snippets = [...readFileSync(guide, 'utf8').matchAll(/```ts\n([\s\S]*?)\n```/g)].map(match => match[1]);
  const example = snippets[0].replace(/^import .*;\n/m, '').replace('export default defineSpace(', 'defineSpace(');
  const definition = vm.runInNewContext(example, { defineSpace: value => value });
  const manifest = generateSpaceManifest({ definition, key: 'notes', entry: './view.tsx' });
  assert.equal(manifest.spec_version, 2); assert.equal(manifest.path, 'notes');
  assert.equal(manifest.params.note.main, true); assert.equal(manifest.shows.notes.open, 'note');
  assert.equal(manifest.memory.markdown, true); assert.equal(manifest.memory.attachments, true);
  assert.equal(manifest.actions.read.tool, 'LOCAL_NOTIS_DATABASE_QUERY');
  const created = vm.runInNewContext('({' + snippets[1] + '})');
  const creationManifest = generateSpaceManifest({ definition: { ...definition, resources: created.resources }, key: 'notes', entry: './view.tsx' });
  assert.equal(creationManifest.resources.notes.create.schema.title_property_id, 'title');
  assert.equal(creationManifest.params.note.database, 'notes');
});
