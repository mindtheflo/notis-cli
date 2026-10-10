import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpaceFixtureBroker } from '../src/runtime/space-fixture-broker.js';
import { verifySpaceRelease } from '../src/runtime/space-verification.js';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const schema = { type: 'object', properties: {}, additionalProperties: false };
function release() {
  return { manifest: { kind: 'presentation', local_key: 'grants', name: 'Grants',
    actions: { read: { tool: 'LOCAL_MCP_READ', inputs: schema, arguments: {} },
      write: { tool: 'LOCAL_MCP_WRITE', inputs: schema, arguments: {} } },
    resources: {}, bundle: { js: 'bundle/app.js' } },
    files: { 'bundle/app.js': Buffer.from('export function SpaceView(){}').toString('base64') },
    fixturePath: 'fixtures.json', sourceFiles: { 'fixtures.json': encode({ actions: {
      read: [{ inputs: {}, result: { rows: [] } }], write: [{ inputs: {}, result: { changed: true } }],
    } }) } };
}
const capabilities = () => ({ actions: { read: { inputSchema: schema, readOnly: true } }, bindings: {} });

test('only explicit reuse_only accepts an exact unavailable declaration partition', async () => {
  const source = release(), before = structuredClone(source);
  assert.throws(() => createSpaceFixtureBroker({ release: source, capabilities: capabilities(), width: 390 }));
  for (const unavailableActions of [[], ['read'], ['write', 'write'], ['unknown'], ['read', 'write']]) {
    assert.throws(() => createSpaceFixtureBroker({ release: source, capabilities: capabilities(), width: 390,
      authorizationMode: 'reuse_only', unavailableActions }));
  }
  const broker = createSpaceFixtureBroker({ release: source, capabilities: capabilities(), width: 390,
    authorizationMode: 'reuse_only', unavailableActions: ['write'] });
  assert.deepEqual(Object.keys((await broker.snapshot()).descriptor.space.actions), ['read']);
  assert.deepEqual(source, before, 'Unavailable source/template/fixture bytes remain intact');
  assert.deepEqual(await broker.read({ operation: 'action', action_id: 'read', inputs: {}, request_id: 'read-1' }), { rows: [] });
  await assert.rejects(broker.read({ operation: 'action', action_id: 'write', inputs: {}, request_id: 'write-1' }));
  await assert.rejects(broker.finish(), 'A caught unavailable-action attempt still fails verification');
});

test('an unavailable declaration cannot reappear as a generic binding operation', () => {
  const caps = capabilities(); caps.bindings.rows = { kind: 'database', operations: { update: 'write' } };
  assert.throws(() => createSpaceFixtureBroker({ release: release(), capabilities: caps, width: 390,
    authorizationMode: 'reuse_only', unavailableActions: ['write'] }), /unavailable action/);
});

test('shared verifier passes explicit mode to both width brokers without granting the skipped write', async () => {
  const snapshots = [];
  const result = await verifySpaceRelease(release(), { capabilities: capabilities(), authorizationMode: 'reuse_only',
    unavailableActions: ['write'], loadRenderer: async () => ({ rendererDigest: 'offline',
      createBrowserPool: () => ({ close: async () => {} }),
      renderView: async ({ broker, width }) => {
        snapshots.push(await broker.snapshot());
        return { markdown: 'Read-only fixture', screenshot: { data_base64: 'cG5n', width, height: 100 } };
      } }) });
  assert.equal(result.status, 'passed'); assert.equal(snapshots.length, 2);
  assert.equal(result.authorization_mode, 'reuse_only'); assert.deepEqual(result.unavailable_actions, ['write']);
  assert.ok(snapshots.every(value => Object.keys(value.descriptor.space.actions).join() === 'read'));
});

test('unavailable native body read cannot bypass the descriptor mask through fixtures', async () => {
  const source = release(), record = '11111111-1111-4111-8111-111111111111';
  source.manifest.resources = { notes: { kind: 'database', key: 'notes' } };
  source.manifest.actions.read = { tool: 'LOCAL_NOTIS_DATABASE_QUERY',
    inputs: { type: 'object', properties: { request: { type: 'object' } }, required: ['request'] },
    arguments: { database_id: { $asset: 'notes' }, request: { $input: 'request' } } };
  source.sourceFiles['fixtures.json'] = encode({ actions: {}, documentBodies: [{
    request: { operation: 'read', binding: 'notes', readAction: 'read', recordKey: record },
    result: { record_key: record, title: null, revision: 1, schema_revision: 1, content_markdown: 'Fixture only' },
  }] });
  const broker = createSpaceFixtureBroker({ release: source, capabilities: { actions: {}, bindings: { notes: { kind: 'database' } } },
    width: 390, authorizationMode: 'reuse_only', unavailableActions: ['read', 'write'] });
  await assert.rejects(broker.read({ operation: 'document_body', record_key: record, binding: 'notes', read_action: 'read' }), /unavailable/);
});
