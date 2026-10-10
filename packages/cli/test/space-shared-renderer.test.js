import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifySpaceRelease } from '../src/runtime/space-verification.js';
import { createSpaceFixtureBroker } from '../src/runtime/space-fixture-broker.js';
import * as renderer from '../../view-renderer/src/index.js';

const b = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
const record = '11111111-1111-4111-8111-111111111111';
function fixture(source = 'export function SpaceView(){return window.React.createElement("h1",null,"Shared verifier fixture")}') {
  return { manifest: { local_key: 'shared-renderer', name: 'Fixture', kind: 'presentation', actions: {}, resources: {},
    params: {}, shows: {}, bundle: { js: 'bundle/app.js' } },
    files: { 'bundle/app.js': b(source) }, sourceFiles: {}, capabilities: { actions: {}, bindings: {} } };
}
const loadRenderer = async () => ({ ...renderer, rendererDigest: createHash('sha256').update('shared-renderer-test').digest('hex') });

test('offline verifier really renders both widths with shared Chromium host and digests', async () => {
  const release = fixture();
  const result = await verifySpaceRelease(release, { capabilities: release.capabilities, loadRenderer });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.browser_count, 1); assert.equal(result.render_count, 2);
  assert.deepEqual(result.renders.map(value => value.width), [390, 1440]);
  assert.ok(result.renders.every(value => /^[a-f0-9]{64}$/.test(value.markdown_sha256) && value.screenshot_width === value.width));
});

test('shared readonly DocumentEditor and HtmlFrame consume only explicit synthetic records', async () => {
  const release = fixture(`export function SpaceView(){const R=window.React;const runtime=R.useContext(globalThis[Symbol.for('notis.sdk.runtime_context')]);return R.createElement('main',null,R.createElement(runtime.ui.DocumentEditor,{recordKey:'${record}'}),R.createElement(runtime.ui.HtmlFrame,{recordKey:'${record}'}))}`);
  release.manifest.resources = { notes: { kind: 'database', key: 'notes' } };
  release.manifest.params = { note: { type: 'record', database: 'notes', main: true } };
  release.fixturePath = 'fixtures.json';
  release.sourceFiles['fixtures.json'] = b({ actions: {}, context: { params: { note: record }, locale: 'fr' }, recordViews: [
    { operation: 'record', record_key: record, result: { record_key: record, writable: false, schema: { properties: {} }, document: {
      record_key: record, title: 'Fictional note', content_blocknote: [{ type: 'paragraph', content: 'Only fixture body' }], properties: {},
    } } },
    { operation: 'html', record_key: record, result: { record_key: record, html: '<h1>Fictional HTML page</h1>', title: 'Fixture' } },
  ] });
  const result = await verifySpaceRelease(release, { capabilities: { actions: {}, bindings: { notes: { kind: 'database' } } }, loadRenderer });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.deepEqual([...new Set(result.runtimeCalls.map(value => value.operation))].sort(), ['html', 'record']);
  assert.equal(result.runtimeCalls.length, 4);
});

test('body fixtures stay Markdown snapshots without BlockNote room initialization', async () => {
  const release = fixture(`export function SpaceView(){const R=window.React;const runtime=R.useContext(globalThis[Symbol.for('notis.sdk.runtime_context')]);const [value,setValue]=R.useState('Waiting');R.useEffect(()=>{runtime.documentBody({operation:'read',binding:'notes',readAction:'read',recordKey:'${record}'}).then(v=>setValue(v.content_markdown))},[]);return R.createElement('h1',null,value)}`);
  const inputs = { type: 'object', required: ['request'], properties: { request: { type: 'object' } } };
  release.manifest.resources = { notes: { kind: 'database', key: 'notes' } };
  release.manifest.actions = { read: { tool: 'LOCAL_NOTIS_DATABASE_QUERY', inputs, arguments: { database_id: { $asset: 'notes' }, request: { $input: 'request' } } } };
  release.fixturePath = 'fixtures.json';
  release.sourceFiles['fixtures.json'] = b({ actions: {}, documentBodies: [{
    request: { operation: 'read', binding: 'notes', readAction: 'read', recordKey: record },
    result: { record_key: record, title: 'Fixture', revision: 1, schema_revision: 1, content_markdown: 'Pure Markdown fixture' },
  }] });
  const result = await verifySpaceRelease(release, { capabilities: { actions: { read: { inputSchema: inputs, readOnly: true } }, bindings: {} }, loadRenderer });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.ok(result.runtimeCalls.every(value => value.operation === 'document_body'));
});

test('write-on-load fails offline verification even if source catches the denial', async () => {
  const release = fixture(`export function SpaceView(){const R=window.React;const runtime=R.useContext(globalThis[Symbol.for('notis.sdk.runtime_context')]);R.useEffect(()=>{runtime.callTool('FORBIDDEN',{}).catch(()=>{})},[]);return R.createElement('h1',null,'Caught write')}`);
  const result = await verifySpaceRelease(release, { capabilities: release.capabilities, loadRenderer });
  assert.equal(result.status, 'failed');
  assert.ok(result.renders.every(value => value.blocked_calls.some(call => call.code === 'render_read_only')));
});

test('fixture broker rejects undeclared reads, write actions and extra authority fields', async () => {
  const release = fixture(); const broker = createSpaceFixtureBroker({ release, capabilities: release.capabilities, width: 390 });
  for (const request of [{ operation: 'upload' }, { operation: 'asset', url: 'https://example.com' },
    { operation: 'record', record_key: record, actor: 'other' }, { operation: 'record', record_key: record }]) {
    await assert.rejects(broker.read(request));
  }
  await assert.rejects(broker.finish());
});

test('two rendering widths settle before the owned pool is closed after one failure', async () => {
  const release = fixture(), events = [];
  const result = await verifySpaceRelease(release, { capabilities: release.capabilities, loadRenderer: async () => ({
    rendererDigest: 'fixture', createBrowserPool: () => ({ close: async () => { events.push('close'); } }),
    renderView: async ({ width }) => { if (width === 390) throw new Error('fixture failure');
      await new Promise(resolve => setTimeout(resolve, 20)); events.push('second-settled');
      return { markdown: 'fixture', screenshot: { data_base64: 'Zml4dHVyZQ==', width, height: 900 } };
    },
  }) });
  assert.equal(result.status, 'failed'); assert.deepEqual(events, ['second-settled', 'close']);
});

test('verification launch budget is two owned browser pools, not one browser per width', async () => {
  const release = fixture(); let active = 0, maxActive = 0, renders = 0;
  const loadRenderer = async () => ({ rendererDigest: 'fixture', createBrowserPool: options => {
    assert.equal(options.concurrency, 2); active++; maxActive = Math.max(maxActive, active);
    return { close: async () => { active--; } };
  }, renderView: async ({ width }) => { renders++; await new Promise(resolve => setTimeout(resolve, 10));
    return { markdown: 'fixture', screenshot: { data_base64: 'Zml4dHVyZQ==', width, height: 900 } };
  } });
  const results = await Promise.all(Array.from({ length: 5 }, () => verifySpaceRelease(release, { capabilities: release.capabilities, loadRenderer })));
  assert.ok(results.every(value => value.status === 'passed'));
  assert.equal(maxActive, 2); assert.equal(active, 0); assert.equal(renders, 10);
});


test('hidden-chrome flex HtmlFrame captures its full content instead of a 900px flex crop', async () => {
  const release = fixture(`export function SpaceView(){const R=window.React;const runtime=R.useContext(globalThis[Symbol.for('notis.sdk.runtime_context')]);return R.createElement('main',{style:{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}},R.createElement(runtime.ui.HtmlFrame,{html:'<main style="height:1800px"><h1>Full HTML</h1><p style="padding-top:1600px">Frame tail proof</p></main>',className:'growing-frame'}))}`);
  release.manifest.bundle.css = 'bundle/app.css';
  release.files['bundle/app.css'] = b('.growing-frame{flex:1 1 0%;min-height:0}');
  const pool = renderer.createBrowserPool();
  try {
    const broker = createSpaceFixtureBroker({ release, capabilities: release.capabilities, width: 390 });
    const result = await renderer.renderView({ broker, pool, width: 390 });
    assert.ok(result.screenshot.height >= 1800, `Actual screenshot height ${result.screenshot.height}`);
    assert.match(result.markdown, /Frame tail proof/);
  } finally { await pool.close(); }
});
