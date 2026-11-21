import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifySpaceRelease } from '../src/runtime/space-verification.js';
import { createSpaceFixtureBroker } from '../src/runtime/space-fixture-broker.js';
import { createSpaceFixtureEngine } from '../src/runtime/space-test-server.js';
import * as renderer from '../../view-renderer/src/index.js';

// A Space author whose fixtures lack a page's HTML must learn which view, which read and record,
// which fixture field is missing, and what a valid entry looks like.
const b = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
const record = '22222222-2222-4222-8222-222222222222';
const capabilities = { actions: {}, bindings: { notes: { kind: 'database' } } };
const loadRenderer = async () => ({ ...renderer, rendererDigest: createHash('sha256').update('fixture-messages-test').digest('hex') });

function htmlRelease(fixtures, { fixturePath = 'fixtures.json' } = {}) {
  const source = `export function SpaceView(){const R=window.React;const runtime=R.useContext(globalThis[Symbol.for('notis.sdk.runtime_context')]);return R.createElement(runtime.ui.HtmlFrame,{recordKey:'${record}'})}`;
  return {
    manifest: { local_key: 'slide-page', name: 'Slide page', kind: 'presentation', actions: {},
      resources: { notes: { kind: 'database', key: 'notes' } },
      params: { note: { type: 'record', database: 'notes', main: true } }, shows: {}, bundle: { js: 'bundle/app.js' } },
    files: { 'bundle/app.js': b(source) }, fixturePath: fixturePath || null,
    sourceFiles: fixturePath ? { [fixturePath]: b(fixtures) } : {}, capabilities,
  };
}

test('a missing html record view names the view, the read, the record and a valid entry', () => {
  const engine = createSpaceFixtureEngine(htmlRelease({ actions: {}, context: { params: { note: record } }, recordViews: [] }));
  assert.throws(() => engine.executeRecordView('html', record), error => {
    assert.match(error.message, /View "slide-page" reads the stored HTML page of record 22222222-2222-4222-8222-222222222222/);
    assert.match(error.message, /no recordViews entry with operation "html"/);
    assert.match(error.message, /Add it to recordViews in fixtures\.json/);
    const example = JSON.parse(error.message.match(/for example (\{.*\})\.$/)[1]);
    assert.deepEqual(example, { operation: 'html', record_key: record, result: { record_key: record, html: '<h1>Fictional page</h1>' } });
    return true;
  });
});

test('every suggested record view example is itself a valid fixture', () => {
  for (const operation of ['record', 'html', 'report']) {
    let message = '';
    try { createSpaceFixtureEngine(htmlRelease({ actions: {}, recordViews: [] })).executeRecordView(operation, record); }
    catch (error) { message = error.message; }
    const example = JSON.parse(message.match(/for example (\{.*\})\.$/)[1]);
    const engine = createSpaceFixtureEngine(htmlRelease({ actions: {}, recordViews: [example] }));
    assert.deepEqual(engine.executeRecordView(operation, record), example.result, operation);
  }
});

test('a Space without a fixtures file is told to declare one', () => {
  const engine = createSpaceFixtureEngine(htmlRelease(null, { fixturePath: null }));
  assert.throws(() => engine.executeRecordView('html', record), /declares no verificationFixtures file/);
});

test('an html fixture without result.html, or with another record key, names the missing field', () => {
  assert.throws(() => createSpaceFixtureEngine(htmlRelease({ actions: {}, recordViews: [
    { operation: 'html', record_key: record, result: { record_key: record, content: '<h1>Wrong field</h1>' } },
  ] })), /View "slide-page" \(fixtures\.json\): the html recordViews fixture for record 2222.* is missing result\.html, the page HTML as a string\. Use \{"operation":"html"/);
  assert.throws(() => createSpaceFixtureEngine(htmlRelease({ actions: {}, recordViews: [
    { operation: 'html', record_key: record, result: { html: '<h1>Page</h1>' } },
  ] })), /needs result\.record_key set to that same record key/);
});

test('the broker keeps the failed read and its reason, and finish reports it', async () => {
  const release = htmlRelease({ actions: {}, context: { params: { note: record } }, recordViews: [] });
  const broker = createSpaceFixtureBroker({ release, capabilities, width: 390, outputs: ['markdown'] });
  await assert.rejects(broker.read({ operation: 'html', record_key: record }), /stored HTML page/);
  assert.equal(broker.calls.length, 1);
  assert.equal(broker.calls[0].ok, false);
  assert.equal(broker.calls[0].recordKey, record);
  assert.match(broker.calls[0].error, /View "slide-page" reads the stored HTML page/);
  await assert.rejects(broker.finish(), /A synthetic fixture read failed: View "slide-page" reads the stored HTML page/);
});

test('verify carries the specific fixture reason, not only the generic renderer line', async () => {
  const release = htmlRelease({ actions: {}, context: { params: { note: record } }, recordViews: [] });
  // A failed read leaves the frame waiting on it: verify stops soon after, never at its 45 s timeout.
  const started = Date.now();
  const result = await verifySpaceRelease(release, { capabilities, loadRenderer });
  assert.ok(Date.now() - started < 30_000, `verify stopped after ${Date.now() - started} ms`);
  assert.equal(result.status, 'failed', JSON.stringify(result));
  const fixtureErrors = result.errors.filter(value => value.phase === 'fixture');
  assert.equal(fixtureErrors.length, 1, JSON.stringify(result.errors));
  assert.equal(fixtureErrors[0].operation, 'html');
  assert.equal(fixtureErrors[0].record_key, record);
  assert.match(fixtureErrors[0].message, /View "slide-page" reads the stored HTML page of record .*"html":"<h1>Fictional page<\/h1>"/);
  assert.equal(result.errors.at(-1).phase, 'renderer');
});

// A view whose list read sends params no shown fixture holds must learn the list, the exact params and the cases it
// has; a param left at its declared default reads the {} case, as a view link leaves it out.
const tasksCapabilities = { actions: {}, bindings: { tasks: { kind: 'database' } } };
function shownRelease(fixtures, { read = { status: 'Done' } } = {}) {
  const source = `export function SpaceView(){const R=window.React;const runtime=R.useContext(globalThis[Symbol.for('notis.sdk.runtime_context')]);`
    + `const [rows,setRows]=R.useState(null);R.useEffect(()=>{runtime.shown('tasks',${JSON.stringify(read)}).then(value=>setRows(value.rows||[]))},[]);`
    + `return R.createElement('p',null,rows?'Tasks: '+rows.length:'Loading')}`;
  return {
    manifest: { local_key: 'board', name: 'Board', kind: 'presentation', actions: {},
      resources: { tasks: { kind: 'database', key: 'tasks' } },
      params: { status: { type: 'string', default: 'To do', description: 'Only tasks in this status.' } },
      shows: { tasks: { database: 'tasks', where: { field: { property: 'Status' }, op: 'equals', value: '{status}' } } },
      bundle: { js: 'bundle/app.js' } },
    files: { 'bundle/app.js': b(source) }, fixturePath: 'fixtures/board.json',
    sourceFiles: { 'fixtures/board.json': b(fixtures) }, capabilities: tasksCapabilities,
  };
}

test('a missing shown fixture names the view, the list, the exact params and the cases it has', () => {
  const engine = createSpaceFixtureEngine(shownRelease({ actions: {}, shown: { tasks: [{ params: {}, result: { rows: [] } }] } }));
  assert.throws(() => engine.executeShown('tasks', { status: 'Done', task: record }), error => {
    assert.match(error.message, /^View "board" \(fixtures\/board\.json\): list "tasks" was read with params \{"status":"Done","task":"22222222-2222-4222-8222-222222222222"\}/);
    assert.match(error.message, /\(it has \{\}\)/);
    assert.match(error.message, /Add an explicit synthetic shown fixture for tasks and these params: \{"params": \{"status":"Done","task":"2222.*"\}, "result": \{"rows": \[\]\}\} in shown\.tasks of fixtures\/board\.json\.$/);
    return true;
  });
});

test('a shown param at its declared default reads the {} case; any other value still needs its own case', () => {
  const rows = [{ record_key: record }];
  const engine = createSpaceFixtureEngine(shownRelease({ actions: {}, shown: { tasks: [{ params: {}, result: { rows } }] } }));
  assert.deepEqual(engine.executeShown('tasks', { status: 'To do' }).rows, rows);
  assert.throws(() => engine.executeShown('tasks', { status: 'Done' }), /list "tasks" was read with params \{"status":"Done"\}/);
  // An exact case still wins over the default-equivalent one.
  const exact = createSpaceFixtureEngine(shownRelease({ actions: {}, shown: { tasks: [{ params: {}, result: { rows: [] } },
    { params: { status: 'To do' }, result: { rows } }] } }));
  assert.deepEqual(exact.executeShown('tasks', { status: 'To do' }).rows, rows);
});

test('an action fixture miss prints the inputs it could not match', () => {
  const release = shownRelease({ actions: {} });
  release.manifest.actions = { read: { tool: 'FIXTURE_READ', arguments: { database: { $asset: 'tasks' } },
    inputs: { type: 'object', properties: { count: { type: 'integer', minimum: 1 } }, required: ['count'], additionalProperties: false } } };
  const engine = createSpaceFixtureEngine(release);
  assert.throws(() => engine.execute('read', { count: 2 }), /action read was read with inputs \{"count":2\}, which no actions fixture matches/);
});

test('verify reports a shown read no fixture matches as fixture_missing with its params, not an access change', async () => {
  const release = shownRelease({ actions: {}, shown: { tasks: [{ params: {}, result: { rows: [] } }] } });
  const result = await verifySpaceRelease(release, { capabilities: tasksCapabilities, loadRenderer });
  assert.equal(result.status, 'failed', JSON.stringify(result));
  const failedRenders = result.renders.filter(value => value.status === 'failed');
  assert.ok(failedRenders.length, JSON.stringify(result.renders));
  assert.deepEqual([...new Set(failedRenders.map(value => value.error))], ['fixture_missing']);
  const fixtureErrors = result.errors.filter(value => value.phase === 'fixture');
  assert.equal(fixtureErrors.length, 1, JSON.stringify(result.errors));
  assert.equal(fixtureErrors[0].operation, 'shown');
  assert.match(fixtureErrors[0].message, /list "tasks" was read with params \{"status":"Done"\}/);
});

test('verify passes when the only shown param sits at its declared default and the fixtures hold the {} case', async () => {
  const release = shownRelease({ actions: {}, shown: { tasks: [{ params: {}, result: { rows: [] } }] } }, { read: { status: 'To do' } });
  const result = await verifySpaceRelease(release, { capabilities: tasksCapabilities, loadRenderer });
  assert.equal(result.status, 'passed', JSON.stringify(result.errors));
});
