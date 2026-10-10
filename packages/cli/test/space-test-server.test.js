import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createConnection } from 'node:net';
import test from 'node:test';
import { createSpaceFixtureEngine, spaceHarnessSnapshot, startSpaceTestServer } from '../src/runtime/space-test-server.js';
import { spaceVerificationEnvironment, verifySpaceRelease } from '../src/runtime/space-verification.js';

const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
const schema = { type: 'object', properties: { count: { type: 'integer', minimum: 1 } }, required: ['count'], additionalProperties: false };
function fixture(cases = [{ inputs: { count: 2 }, result: { rows: [{ title: 'Synthetic row' }] } }]) {
  return { fixturePath: 'cases.json', sourceFiles: { 'cases.json': encode({ actions: { read: cases } }) },
    manifest: { kind: 'presentation', local_key: 'fixture', name: 'Fixture', bundle: { js: 'bundle/app.js', css: 'bundle/app.css' },
      resources: { rows: { kind: 'database', key: 'rows' } },
      actions: { read: { tool: 'FIXTURE_READ', inputs: schema, arguments: { database: { $asset: 'rows' } } } } },
    files: { 'bundle/app.js': encode('export function SpaceView(){return "Synthetic fixture"}'), 'bundle/app.css': encode('h1{color:red}') } };
}
const capabilities = () => ({ actions: { read: { id: 'read', inputSchema: schema, readOnly: true } },
  bindings: { rows: { kind: 'database', database_id: 'must-not-enter-frame', operations: { query: 'read' } } } });

test('offline actions require exact explicit fixture inputs and enforce JSON schema without coercion', () => {
  const engine = createSpaceFixtureEngine(fixture());
  assert.deepEqual(engine.execute('read', { count: 2 }), { rows: [{ title: 'Synthetic row' }] });
  for (const inputs of [{ count: '2' }, { count: 0 }, { count: 2, extra: true }, {}, [], { count: 3 }]) {
    assert.throws(() => engine.execute('read', inputs), /inputs|fixture/);
  }
  assert.throws(() => engine.execute('unknown', { count: 2 }), /inputs/);
  const result = engine.execute('read', { count: 2 }); result.rows[0].title = 'Mutated';
  assert.equal(engine.execute('read', { count: 2 }).rows[0].title, 'Synthetic row');
});

test('ambiguous cases, undeclared actions, invalid schemas and missing frozen fixtures fail closed', () => {
  assert.throws(() => createSpaceFixtureEngine(fixture([{ inputs: { count: 2 }, result: 1 }, { inputs: { count: 2 }, result: 2 }])), /Ambiguous/);
  const missing = fixture(); delete missing.sourceFiles['cases.json'];
  assert.throws(() => createSpaceFixtureEngine(missing), /missing/);
  const unknown = fixture(); unknown.sourceFiles['cases.json'] = encode({ actions: { other: [{ inputs: {}, result: 1 }] } });
  assert.throws(() => createSpaceFixtureEngine(unknown), /known action/);
  const remote = fixture(); remote.manifest.actions.read.inputs = { $ref: 'https://fixture.invalid/inputs' };
  assert.throws(() => createSpaceFixtureEngine(remote), /Cannot validate/);
});

test('body verification uses exact synthetic reads with canonical action authority and never saves', () => {
  const release=fixture();
  release.manifest.actions.read={tool:'LOCAL_NOTIS_DATABASE_QUERY',
    inputs:{type:'object',properties:{request:{type:'object'}},required:['request'],additionalProperties:false},
    arguments:{database_id:{$asset:'rows'},request:{$input:'request'}}};
  const request={operation:'read',binding:'rows',readAction:'read',recordKey:'b530e631-2038-460d-bdf7-bc9ed0f12345'};
  const result={record_key:request.recordKey,title:'Fictional',revision:1,schema_revision:1,content_markdown:'Synthetic body'};
  const cases={actions:{},documentBodies:[{request,result}]};
  release.sourceFiles['cases.json']=encode(cases);
  const engine=createSpaceFixtureEngine(release);
  assert.deepEqual(engine.executeBody(request),result);
  const changed=engine.executeBody(request);changed.content_markdown='Changed';
  assert.equal(engine.executeBody(request).content_markdown,'Synthetic body');
  for(const input of [{...request,operation:'save'},{...request,actor:'forged'},{...request,binding:'other'},
    {...request,recordKey:'1530e631-2038-460d-bdf7-bc9ed0f12345'}]) assert.throws(()=>engine.executeBody(input));
  release.sourceFiles['cases.json']=encode({...cases,documentBodies:[...cases.documentBodies,...cases.documentBodies]});
  assert.throws(()=>createSpaceFixtureEngine(release),/Ambiguous/);
  release.sourceFiles['cases.json']=encode(cases);release.manifest.actions.read.arguments.request={body:[]};
  assert.throws(()=>createSpaceFixtureEngine(release),/canonical query/);
});

test('frame projection contains exact verified capabilities, no physical bindings or grant authority', () => {
  const release = fixture(), engine = createSpaceFixtureEngine(release);
  const snapshot = spaceHarnessSnapshot(release, capabilities(), engine);
  assert.equal(snapshot.descriptor.resource.kind, 'space');
  assert.equal(snapshot.descriptor.resource.id, 'verification:fixture');
  assert.deepEqual(snapshot.descriptor.space.bindings, { rows: { kind: 'database', operations: { query: 'read' } } });
  assert.deepEqual(snapshot.descriptor.space.actions.read, { id: 'read', inputSchema: schema, readOnly: true });
  assert.ok(!JSON.stringify(snapshot).includes('must-not-enter-frame'));
  assert.ok(!JSON.stringify(snapshot).includes('FIXTURE_READ'));
  const changed = capabilities(); changed.actions.read.inputSchema = { type: 'object' };
  assert.throws(() => spaceHarnessSnapshot(release, changed, engine), /descriptor changed/);
  const missing = capabilities(); delete missing.actions.read;
  assert.throws(() => spaceHarnessSnapshot(release, missing, engine), /authorizations/);
});

test('offline navigation descriptor retains declared aliases without physical destinations', () => {
  const release=fixture(), caps=capabilities(), engine=createSpaceFixtureEngine(release);
  release.manifest.navigation={history:{key:'history'}};
  assert.throws(()=>spaceHarnessSnapshot(release,caps,engine),/navigation declaration/);
  caps.navigation=['history'];
  assert.deepEqual(spaceHarnessSnapshot(release,caps,engine).descriptor.space.navigation,['history']);
});

test('server serves only frozen bytes and exact fixtures for a credentialless Shadow host', async t => {
  const release = fixture();
  const server = await startSpaceTestServer({ release, capabilities: capabilities() });
  t.after(() => server.close());
  release.files['bundle/app.js'] = encode('changed after capture');
  release.sourceFiles['cases.json'] = encode({ actions: {} });
  const snapshot = await (await fetch(`${server.url}/snapshot`)).json();
  assert.ok(snapshot.source.includes('Synthetic fixture'));
  assert.ok(!snapshot.source.includes('changed after capture'));
  const host = await fetch(server.url);
  assert.equal(host.status, 200);
  assert.match(host.headers.get('Content-Security-Policy'), /frame-src 'none'/);
  assert.match(host.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  assert.ok(!(await host.text()).includes('iframe'));
  for (const path of ['/host.js', '/theme.css']) {
    const response = await fetch(`${server.url}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  for (const path of ['/snapshot', '/host.js', '/theme.css', '/fixture']) {
    assert.equal((await fetch(`${server.url}${path}`, { headers: { Origin: 'null' } })).status, 403);
  }
  const read = await fetch(`${server.url}/fixture`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: server.url },
    body: JSON.stringify({ action_id: 'read', inputs: { count: 2 } }) });
  assert.deepEqual(await read.json(), { result: { rows: [{ title: 'Synthetic row' }] } });
  for (const path of ['/.env', '/portal_spaces/action', '/source/cases.json', '/bundle/app.js', '/frame', '/frame.js', '/frame.css']) {
    assert.equal((await fetch(`${server.url}${path}`)).status, 404);
  }
});

test('non-forwarding proxy rejects other hosts and localhost ports, tunnels and socket upgrades', async t => {
  const server = await startSpaceTestServer({ release: fixture(), capabilities: capabilities() });
  t.after(() => server.close());
  const fetchThroughGate = (path, headers = {}, method = 'GET') => new Promise((accept, reject) => {
    const req = request(server.url, { path, headers, method }, response => { response.resume(); accept(response.statusCode); });
    req.on('connect', (response, socket) => { socket.destroy(); accept(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(await fetchThroughGate('http://127.0.0.1:55031/portal_spaces/list'), 403);
  assert.equal(await fetchThroughGate('http://outside.invalid/'), 403);
  assert.equal(await fetchThroughGate('/', { Host: 'outside.invalid' }), 403);
  assert.equal(await fetchThroughGate('127.0.0.1:55031', {}, 'CONNECT'), 403);
  assert.equal(await fetchThroughGate('/', { Connection: 'Upgrade', Upgrade: 'websocket' }), 403);
  assert.equal(await fetchThroughGate(`${server.url}/snapshot`), 200);
});

test('denied proxy connections survive real peer TCP resets and keep serving fixtures', async t => {
  const server = await startSpaceTestServer({ release: fixture(), capabilities: capabilities() });
  t.after(() => server.close());
  const address = new URL(server.url);
  for (const method of ['CONNECT outside.invalid:443 HTTP/1.1', 'GET / HTTP/1.1']) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((accept, reject) => {
        const socket = createConnection({ host: address.hostname, port: Number(address.port) });
        socket.once('error', reject);
        socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Denied socket stayed open')); });
        socket.once('connect', () => socket.write(`${method}\r\nHost: ${address.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
        socket.once('data', chunk => {
          try { assert.match(chunk.toString(), /^HTTP\/1\.1 403 Forbidden/); }
          catch (error) { socket.destroy(); reject(error); return; }
          socket.resetAndDestroy();
        });
        socket.once('close', accept);
      });
      assert.equal((await fetch(`${server.url}/snapshot`)).status, 200);
    }
  }
});

test('browser worker environment drops credentials, inherited config, CDP, restore and provider transports', () => {
  const env = spaceVerificationEnvironment({ PATH: '/bin', HOME: '/fixture', NOTIS_JWT: 'secret', OPENAI_API_KEY: 'secret',
    NODE_OPTIONS: '--require credential-hook', HTTP_PROXY: 'credential-proxy', AGENT_BROWSER_PROFILE: 'Default',
    AGENT_BROWSER_AUTO_CONNECT: '1', AGENT_BROWSER_CONFIG: '/user-config', AGENT_BROWSER_NAMESPACE: 'shared',
    AGENT_BROWSER_INIT_SCRIPTS: '/capture.js', AGENT_BROWSER_RESTORE: 'user', AGENT_BROWSER_CDP: '9222' },
  { configPath: '/owned/empty-config', sessionName: 'owned' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/fixture', AGENT_BROWSER_CONFIG: '/owned/empty-config', AGENT_BROWSER_NO_WEBMCP: '1' });
});

test('container verification explicitly has no render result or browser requirement', async () => {
  const release = fixture(); release.manifest.kind = 'container'; release.files = {};
  const result = await verifySpaceRelease(release);
  assert.equal(result.status, 'not_applicable_container');
  assert.equal(result.mounted, undefined);
  assert.equal(result.renderer_digest, undefined);
});

test('viewer reads render only when verified and declared, from explicit synthetic fixtures', () => {
  const release = fixture();
  release.manifest.viewer_reads = ['databases'];
  const listed = { databases: [{ id: 'fictional', name: 'Fictional', links: [] }] };
  release.sourceFiles['cases.json'] = encode({ actions: { read: [{ inputs: { count: 2 }, result: { rows: [] } }] },
    viewerReads: { list_databases: [{ input: {}, result: listed }] } });
  const engine = createSpaceFixtureEngine(release);
  assert.deepEqual(engine.executeViewerRead('list_databases', {}), listed);
  assert.throws(() => engine.executeViewerRead('list_skills', {}), /does not declare/);
  assert.throws(() => engine.executeViewerRead('insert', {}), /does not declare/);
  assert.throws(() => engine.executeViewerRead('list_databases', { owner: 'x' }), /fixture/);
  assert.throws(() => spaceHarnessSnapshot(release, capabilities(), engine), /viewer reads changed/);
  const snapshot = spaceHarnessSnapshot(release, { ...capabilities(), viewerReads: ['databases'] }, engine);
  assert.deepEqual(snapshot.descriptor.space.viewerReads, ['databases']);
  const undeclared = fixture();
  undeclared.sourceFiles['cases.json'] = encode({ actions: { read: [{ inputs: { count: 2 }, result: 1 }] },
    viewerReads: { list_skills: [{ input: {}, result: { skills: [] } }] } });
  assert.throws(() => createSpaceFixtureEngine(undeclared), /only for reads this Space declares/);
  const plain = fixture();
  assert.equal(spaceHarnessSnapshot(plain, capabilities(), createSpaceFixtureEngine(plain)).descriptor.space.viewerReads, undefined);
  assert.throws(() => spaceHarnessSnapshot(plain, { ...capabilities(), viewerReads: ['skills'] }, createSpaceFixtureEngine(plain)), /viewer reads changed/);
});

test('V4 declared lists render from explicit shown fixtures; the descriptor carries params, list names and chrome', () => {
  const release = fixture();
  release.manifest.params = { status: { type: 'enum', values: ['inbox', 'done'], description: 'Only tasks in this status.' } };
  release.manifest.shows = { tasks: { database: 'rows', where: { field: { property: 'Status' }, op: 'equals', value: '{status}' } },
    drafts: { about: 'Drafts kept elsewhere.' } };
  release.manifest.chrome = 'hidden';
  const listed = { rows: [{ record_key: 'fictional' }], list: 'tasks' };
  release.sourceFiles['cases.json'] = encode({ actions: { read: [{ inputs: { count: 2 }, result: { rows: [] } }] },
    context: { params: { status: 'inbox' } }, shown: { tasks: [{ params: { status: 'inbox' }, result: listed }] } });
  const engine = createSpaceFixtureEngine(release);
  assert.deepEqual(engine.executeShown('tasks', { status: 'inbox' }), listed);
  assert.throws(() => engine.executeShown('tasks', { status: 'done' }), /fixture/);
  assert.throws(() => engine.executeShown('drafts', {}), /does not declare/);
  const snapshot = spaceHarnessSnapshot(release, capabilities(), engine);
  assert.deepEqual(snapshot.descriptor.space.shows, { tasks: { database: 'rows', params: ['status'] }, drafts: { about: 'Drafts kept elsewhere.' } });
  assert.equal(snapshot.descriptor.space.chrome, 'hidden');
  assert.deepEqual(snapshot.descriptor.context.params, { status: 'inbox' });
  const undeclared = fixture();
  undeclared.sourceFiles['cases.json'] = encode({ actions: { read: [{ inputs: { count: 2 }, result: 1 }] },
    shown: { tasks: [{ params: {}, result: { rows: [] } }] } });
  assert.throws(() => createSpaceFixtureEngine(undeclared), /only for lists this view declares/);
});
