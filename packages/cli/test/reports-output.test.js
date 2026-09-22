import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateManifest } from '../src/runtime/app-platform.js';
import { reportsCommandSpecs } from '../src/command-specs/reports.js';

test('report build profile contains only independently executable view resources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notis-report-'));
  try {
    mkdirSync(join(dir, 'app'));
    writeFileSync(join(dir, 'app/page.tsx'), 'export default function Home() { return null; }');
    const config = { kind: 'report', name: 'Weekly', tools: ['LOCAL_NOTIS_LIST_REMINDERS'], routes: [{ path: '/', slug: 'home', name: 'Home', default: true }] };
    const manifest = generateManifest(config, dir);
    assert.equal(manifest.kind, 'report');
    assert.equal(manifest.routes.length, 1);
    assert.deepEqual(manifest.tools, config.tools);
    for (const key of ['app', 'listing', 'databases', 'skills', 'onboarding']) assert.equal(key in manifest, false);
    for (const extra of [{ databases: ['items'] }, { skills: [{ key: 'x' }] }, { capabilities: { cloudComputer: 'shell' } }, { routes: [...config.routes, { path: '/two', slug: 'two' }] }]) {
      assert.throws(() => generateManifest({ ...config, ...extra }, dir));
    }
    const id = 'b9399ef4-5074-4a1a-9ad0-3b919610d705';
    assert.deepEqual(generateManifest({ ...config, databaseAccess: [{ id, access: 'read' }] }, dir).database_access, [{ id, access: 'read' }]);
    assert.throws(() => generateManifest({ ...config, databaseAccess: [{ id: 'guess', access: 'write' }] }, dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('report authoring commands have no installation, database destination or Store options', () => {
  assert.deepEqual(reportsCommandSpecs.map(s => s.command_path[1]), ['init', 'build', 'verify', 'preview', 'save']);
  const flags = reportsCommandSpecs.flatMap(s => s.args_schema.options.map(o => o.flags));
  for (const removed of ['--attach', '--database-id <id>', '--properties-file <file>', '--listing', '--from <slug>']) assert.equal(flags.includes(removed), false);
  assert.ok(flags.includes('--expected-revision <revision>'));
});

async function reportHarnessFixture(resource, response = { ok: true }) {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const template = readFileSync(new URL('../template/.harness/index.html.tmpl', import.meta.url), 'utf8');
  const source = template.slice(template.indexOf('    function record('), template.indexOf("    try {\n      setStatus('loading react');"));
  const requests = [];
  const calls = [];
  const descriptor = { resource, app: { id: 'presentation-only' }, route: { slug: 'home' } };
  const runtimes = runInNewContext(`${source}\n({stub: stubRuntime(), live: liveRuntime()})`, {
    descriptor, fixtures: {}, lookupToolFixture: () => undefined, structuredClone,
    apiBase: 'https://test.invalid', jwt: 'test-token', setTimeout,
    window: { __harness: { runtimeCalls: calls } },
    fetch: async (url, init) => { requests.push({ url, ...init }); return new Response(JSON.stringify(response), { status: 200 }); },
  });
  return { ...runtimes, requests, calls, descriptor };
}

test('actual report harness exposes its resource and blocks generic API requests in both modes', async () => {
  const resource = { kind: 'report', id: 'report-document', revision: 2 };
  const fixture = await reportHarnessFixture(resource);
  for (const runtime of [fixture.stub, fixture.live]) {
    assert.equal(runtime.resource, resource);
    await assert.rejects(() => runtime.request('/portal_views/runtime_query', {
      method: 'POST', headers: { 'X-Notis-Report-Action': 'confirmed' }, body: { name: 'WRITE' },
    }), /declared tools/);
  }
  assert.equal(fixture.requests.length, 0);
  assert.deepEqual(fixture.calls.map(call => call.ok), [false, false]);
  await fixture.live.callTool('READ', {});
  const body = JSON.parse(fixture.requests[0].body);
  assert.equal(body.document_id, resource.id);
  assert.equal(body.revision, 2);
  assert.equal('app_id' in body, false);
  assert.equal('X-Notis-Report-Action' in fixture.requests[0].headers, false);
  // Preserve the existing app harness; this restriction belongs to report identity.
  const app = await reportHarnessFixture(undefined);
  await app.live.request('/fixture', { method: 'GET' });
  assert.equal(app.requests.length, 1);
});

test('actual live report harness records structured failures as failed, not successful data', async () => {
  for (const payload of [{ status: 'failed' }, { status: 'failure' }, { ok: false }, { success: false }, { successful: false }]) {
    const fixture = await reportHarnessFixture({ kind: 'report', id: 'doc', revision: 1 }, payload);
    await assert.rejects(() => fixture.live.callTool('READ', {}), /failed/);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].ok, false);
  }
});
