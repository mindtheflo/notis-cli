import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';
import { appFilesDigest, spacePublicationIntent } from '../src/runtime/app-platform.js';
import { buildSpaceArtifact } from '../src/runtime/space-platform.js';

function context(path, options = {}, args = {}) {
  const spec = spacesCommandSpecs.find(value => value.command_path.join(' ') === path);
  assert.ok(spec);
  return { spec, options, args, globalOptions: {}, runtime: { credentialKind: 'env', profileName: 'spaces-unit-only',
    jwt: 'fixture-not-a-real-credential', apiBase: 'https://fixture.invalid', timeoutMs: 1000, cliVersion: 'fixture' },
    output: { emitSuccess: value => value } };
}

test('navigation binding is a source-revision edit, and null removes only the draft binding', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => { calls.push({ url, body: JSON.parse(request.body) }); return new Response('{"valid":true}'); });
  for (const target of ['{"space_id":"destination","document_id":"exact-record"}', 'null']) {
    const ctx = context('spaces navigation bind', { alias: 'history', target, revision: '2', dryRun: true }, { spaceId: 'source' });
    const result = await ctx.spec.handler(ctx);
    assert.deepEqual(calls.at(-1), { url: 'https://fixture.invalid/portal_spaces/navigation-binding',
      body: { space_id: 'source', alias: 'history', target: JSON.parse(target), revision: 2, dry_run: true } });
    assert.equal(result.meta.mutating, false);
  }
  assert.equal(calls.length, 2);
});

test('Space-side resource inclusion is gone without an alias; links belong to each resource', () => {
  const paths = spacesCommandSpecs.map(spec => spec.command_path.join(' '));
  assert.equal(paths.includes('spaces resources include'), false);
  assert.equal(spacesCommandSpecs.some(spec => spec.deprecated_alias_for === 'spaces resources include'), false);
  assert.equal(spacesCommandSpecs.some(spec => spec.backend_call?.path === '/portal_spaces/resource-include'), false);
  assert.ok(paths.includes('spaces resources name'));
});

test('pre-source resource names use exact bindings with dry-run write boundaries', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});return new Response('{"valid":true}');});
  const naming=context('spaces resources name',{alias:'weekly-report',revision:'4',dryRun:true},{spaceId:'destination',bindingId:'exact-binding'});
  const result=await naming.spec.handler(naming);
  assert.deepEqual(calls[0],{url:'https://fixture.invalid/portal_spaces/resource-name',body:{space_id:'destination',binding_id:'exact-binding',alias:'weekly-report',revision:4,dry_run:true}});
  assert.equal(result.meta.mutating,false);
  for(const patch of [{revision:'-1'},{alias:'../private'},{revision:undefined}]) {
    const bad=context('spaces resources name',{...naming.options,...patch},naming.args);
    assert.throws(()=>bad.spec.handler(bad));
  }
  assert.equal(calls.length,1);
});

test('named CLI action sends only declared inputs, exact revision/context and stable key through versioned transport', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, request });
    return new Response(JSON.stringify({ receipt_id: 'receipt', status: 'succeeded' }), { status: 200 });
  });
  const ctx = context('spaces action', { revision: '3', inputs: '{"text":"hello"}', requestId: 'stable-intent', record: 'record-1', dryRun: true },
    { spaceId: 'space-1', actionId: 'send' });
  const result = await ctx.spec.handler(ctx);
  assert.equal(calls[0].url, 'https://fixture.invalid/portal_spaces/action');
  assert.equal(calls[0].request.headers['X-Notis-Spaces-Protocol'], '1');
  assert.deepEqual(JSON.parse(calls[0].request.body), { space_id: 'space-1', action_id: 'send', revision: 3,
    inputs: { text: 'hello' }, request_id: 'stable-intent', document_id: 'record-1', dry_run: true });
  assert.equal(result.meta.mutating, false);
});

test('execution requires a retained intent key, a revision and object inputs before any request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not request'); });
  for (const options of [{ revision: '1' }, { revision: 'nan', requestId: 'x' }, { revision: '1', inputs: '[]', requestId: 'x' },
    { revision: '1', schemaRevision: '-1', requestId: 'x' }]) {
    const ctx = context('spaces action', options, { spaceId: 'space-1', actionId: 'run' });
    assert.throws(() => ctx.spec.handler(ctx));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('native writes carry schema revision separately from the declared template inputs', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (_url, value) => { request = JSON.parse(value.body); return new Response('{}'); });
  const ctx = context('spaces action', { revision: '4', schemaRevision: '7', inputs: '{"request":{"columns":{"title":"New"}}}', requestId: 'insert-1' },
    { spaceId: 'space-1', actionId: 'insert' });
  await ctx.spec.handler(ctx);
  assert.equal(request.revision, 4); assert.equal(request.schema_revision, 7);
  assert.deepEqual(request.inputs, { request: { columns: { title: 'New' } } });
});

test('Space and grant discovery stay on their scoped read routes', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, method: request.method });
    return new Response('{}', { status: 200 });
  });
  for (const name of ['spaces list', 'spaces get', 'spaces grants list']) {
    const ctx = context(name, { record: 'record-1' }, { spaceId: 'space-1' });
    await ctx.spec.handler(ctx);
  }
  assert.deepEqual(calls, [
    { url: 'https://fixture.invalid/portal_spaces/list', method: 'GET' },
    { url: 'https://fixture.invalid/portal_spaces/get?space_id=space-1&document_id=record-1', method: 'GET' },
    { url: 'https://fixture.invalid/portal_spaces/grants?space_id=space-1&document_id=record-1', method: 'GET' },
  ]);
});

async function sourceFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  mkdirSync(join(root, 'node_modules'));
  symlinkSync(join(repo, 'packages/sdk/node_modules/typescript'), join(root, 'node_modules/typescript'), 'dir');
  writeFileSync(join(root, 'package.json'), '{"name":"source-fixture","type":"module"}');
  writeFileSync(join(root, 'notis.config.ts'), "export default {spaces:{one:{definition:'one.ts'}}};");
  writeFileSync(join(root, 'one.ts'), "export default {name:'One'};");
  await buildSpaceArtifact(root, 'one', { stdio: 'pipe', refreshSdk: false });
  return root;
}

test('interrupted source deployment keeps the original verification CAS and exact bytes on retry', async t => {
  const root = await sourceFixture(t), calls = [];
  let lost = true;
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); calls.push({ url, body, headers: request.headers });
    if (url.endsWith('/source-verify')) return new Response(JSON.stringify({ valid: true, actor_id: 'fixture-user',
      space_id: body.space_id, revision: 0, bindings: {}, reuse_grants: body.reuse_grants,
      source_digest: appFilesDigest(body.source_files), artifact_digest: appFilesDigest(body.artifact_files) }));
    if (lost) return new Response('{"message":"reply lost"}', { status: 503 });
    return new Response('{"published_revision":1,"replayed":true}');
  });
  const ctx = context('spaces deploy', { space: 'one', spaceId: 'fixture-space', requestId: 'intent' }, { dir: root });
  await assert.rejects(ctx.spec.handler(ctx));
  lost = false;
  const result = await ctx.spec.handler(ctx);
  assert.equal(result.data.replayed, true);
  assert.equal(calls.filter(call => call.url.endsWith('/source-verify')).length, 1);
  for (const call of calls.filter(call => call.url.endsWith('/source-publish'))) {
    assert.equal(call.body.verification.revision, 0);
    assert.equal(call.body.request_id, 'intent');
    assert.equal(call.headers['X-Notis-Spaces-Protocol'], '1');
  }
  const before = calls.length;
  writeFileSync(join(root, 'one.ts'), "export default {name:'New intent'};");
  await buildSpaceArtifact(root, 'one', { stdio: 'pipe', refreshSdk: false });
  await assert.rejects(ctx.spec.handler(ctx), /different source/);
  assert.equal(calls.length, before);
});

test('source verification and deploy dry-run never upload or publish', async t => {
  const root = await sourceFixture(t), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); calls.push(url);
    return new Response(JSON.stringify({ valid: true, actor_id: 'fixture-user', space_id: body.space_id, revision: 0,
      bindings: {}, reuse_grants: {}, source_digest: appFilesDigest(body.source_files), artifact_digest: appFilesDigest(body.artifact_files) }));
  });
  for (const name of ['spaces verify', 'spaces deploy']) {
    const ctx = context(name, { space: 'one', spaceId: 'fixture-space', requestId: 'dry-intent', dryRun: true }, { dir: root });
    const result = await ctx.spec.handler(ctx);
    assert.equal(result.meta.mutating, false);
  }
  assert.ok(calls.every(url => url.endsWith('/source-verify')));
});

test('reuse-grants-only is carried by verify/preview/deploy and pinned on request-id replay', async t => {
  const root = await sourceFixture(t), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); calls.push({ url, body });
    if (url.endsWith('/source-verify')) return new Response(JSON.stringify({ ...verificationFor(body),
      authorization_mode: 'reuse_only', unavailable_actions: [] }));
    return new Response(JSON.stringify({ release_id: 'sealed', space_id: body.space_id, published_revision: 1,
      candidate_revision: 1, status: 'ready' }));
  });
  const options = { space: 'one', spaceId: 'fixture-space', requestId: 'reuse-intent', reuseGrantsOnly: true };
  for (const command of ['spaces verify', 'spaces preview', 'spaces deploy']) {
    await context(command, options, { dir: root }).spec.handler(context(command, options, { dir: root }));
  }
  assert.ok(calls.every(call => call.body.authorization_mode === 'reuse_only'));
  for (const call of calls.filter(call => !call.url.endsWith('/source-verify'))) {
    assert.equal(call.body.verification.authorization_mode, 'reuse_only');
    assert.equal(call.body.verification.revision, 0);
  }
  const before = calls.length;
  const changed = context('spaces deploy', { ...options, reuseGrantsOnly: false }, { dir: root });
  await assert.rejects(changed.spec.handler(changed), /different source or grant choices/);
  assert.equal(calls.length, before, 'A mode change cannot reverify or publish under the retained request ID');
});

test('publication intent is first-writer-wins and rejects symlinked private state', async t => {
  const root = await sourceFixture(t), identity = ['fixture', 'one', 'request'];
  const original = { revision: 0, source_digest: 'a' };
  assert.deepEqual(spacePublicationIntent(root, identity, original), original);
  assert.deepEqual(spacePublicationIntent(root, identity, { revision: 9 }), original);
  const other = mkdtempSync(join(tmpdir(), 'notis-unsafe-intent-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  symlinkSync(join(root, '.notis'), join(other, '.notis'), 'dir');
  assert.throws(() => spacePublicationIntent(other, identity, { changed: true }), /symlink|real directory|unsafe/i);
  assert.deepEqual(spacePublicationIntent(root, identity), original);
});

test('preview stages one checked source and a later deployment retains its original CAS', async t => {
  const root = await sourceFixture(t), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); calls.push({ url, body });
    if (url.endsWith('/source-verify')) return new Response(JSON.stringify({ valid: true, actor_id: 'fixture-user',
      space_id: body.space_id, revision: 0, bindings: {}, reuse_grants: {},
      source_digest: appFilesDigest(body.source_files), artifact_digest: appFilesDigest(body.artifact_files) }));
    return new Response(JSON.stringify(url.endsWith('/source-stage')
      ? { release_id: 'sealed', space_id: 'fixture-space', candidate_revision: 1, status: 'ready' }
      : { release_id: 'sealed', published_revision: 1 }));
  });
  const options = { space: 'one', spaceId: 'fixture-space', requestId: 'preview-intent' };
  const preview = context('spaces preview', options, { dir: root });
  const ready = await preview.spec.handler(preview);
  assert.equal(ready.data.status, 'ready');
  assert.equal(calls.filter(call => call.url.endsWith('/source-publish')).length, 0);
  const deploy = context('spaces deploy', options, { dir: root });
  await deploy.spec.handler(deploy);
  assert.equal(calls.filter(call => call.url.endsWith('/source-verify')).length, 1);
  assert.equal(calls.at(-1).body.verification.revision, 0);
  assert.equal(calls.at(-1).body.request_id, 'preview-intent');
});

test('promote and abandon choose an immutable release, not new bytes or replacement actor', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => { calls.push({ url, body: JSON.parse(request.body) }); return new Response('{}'); });
  for (const command of ['promote', 'abandon']) {
    const ctx = context(`spaces ${command}`, {}, { releaseId: 'sealed' });
    await ctx.spec.handler(ctx);
  }
  assert.deepEqual(calls, ['promote', 'abandon'].map(operation => ({
    url: `https://fixture.invalid/portal_spaces/source-${operation}`, body: { release_id: 'sealed' },
  })));
});

test('preview actions retain the candidate identity independently of their positive source revision', async t => {
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, request) => { body = JSON.parse(request.body); return new Response('{}'); });
  const ctx = context('spaces action', { revision: '3', previewRelease: 'candidate', requestId: 'preview-click', dryRun: true },
    { spaceId: 'space', actionId: 'read' });
  await ctx.spec.handler(ctx);
  assert.equal(body.preview_release_id, 'candidate'); assert.equal(body.revision, 3);
  assert.equal(body.request_id, 'preview-click'); assert.equal(body.dry_run, true);
});

// --- R5: a pulled Space deploys only what changed since the pull ---

import { readFileSync } from 'node:fs';
import { readSpaceLock, writeSpaceLock } from '../src/runtime/space-lock.js';

const b64 = (value) => Buffer.from(value).toString('base64');

function pulledFixture(root) {
  writeSpaceLock(root, { version: 1, space_id: 'fixture-space', api_base: 'https://fixture.invalid', source_revision: 1, pulled_at: 'now',
    links: [{ kind: 'skill', id: 'skill-guide', alias: 'guide', binding_id: 'b-guide', binding_revision: 1, available: true },
      { kind: 'database', id: 'db-rows', alias: 'rows', binding_id: 'b-rows', binding_revision: 2, available: true }],
    skills: { guide: { skill_id: 'skill-guide', binding_id: 'b-guide', binding_revision: 1, version: { revision: 3, digest: 'a'.repeat(64) }, folder_hash: 'pulled-hash' } } });
  mkdirSync(join(root, 'skills/guide'), { recursive: true }); writeFileSync(join(root, 'skills/guide/SKILL.md'), '# Guide\nEdited locally.');
  mkdirSync(join(root, 'skills/weekly-digest'), { recursive: true }); writeFileSync(join(root, 'skills/weekly-digest/SKILL.md'), '# Weekly digest');
  writeFileSync(join(root, 'resources.json'), JSON.stringify([{ kind: 'skill', id: 'skill-guide', alias: 'guide' },
    { kind: 'database', id: 'db-rows', alias: 'rows' }, { kind: 'automation', id: 'auto-1', alias: 'weekly' }]));
}

function applied() {
  return { skills: {
    guide: { operation: 'update', skill_id: 'skill-guide', version: { revision: 4, digest: 'b'.repeat(64) }, binding_id: 'b-guide', binding_revision: 1 },
    'weekly-digest': { operation: 'create', skill_id: 'skill-new', version: { revision: 1, digest: 'c'.repeat(64) }, binding_id: 'b-new', binding_revision: 1 } },
  links: [{ kind: 'automation', resource_id: 'auto-1', added: [{ alias: 'weekly', binding_id: 'b-weekly' }], removed: [] }],
  space_links: [
    { binding_id: 'b-guide', alias: 'guide', revision: 1, kind: 'skill', resource_id: 'skill-guide', available: true },
    { binding_id: 'b-rows', alias: 'rows', revision: 2, kind: 'database', resource_id: 'db-rows', available: true },
    { binding_id: 'b-weekly', alias: 'weekly', revision: 1, kind: 'automation', resource_id: 'auto-1', available: true },
    { binding_id: 'b-new', alias: 'weekly-digest', revision: 1, kind: 'skill', resource_id: 'skill-new', available: true },
    { binding_id: 'b-else', alias: 'elsewhere', revision: 1, kind: 'database', resource_id: 'db-else', available: true }] };
}

function verificationFor(body) {
  return { valid: true, actor_id: 'fixture-user', space_id: body.space_id, revision: 0, bindings: {}, reuse_grants: body.reuse_grants,
    source_digest: appFilesDigest(body.source_files), artifact_digest: appFilesDigest(body.artifact_files),
    ...(body.changes ? { changes_digest: 'd'.repeat(64), changes: { skills: { edited: ['guide'], created: ['weekly-digest'] }, links: { added: [], removed: [] } } } : {}) };
}

test('deploy sends only what changed since the pull, then records the applied versions and the server list', async t => {
  const root = await sourceFixture(t), calls = [];
  pulledFixture(root);
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); calls.push({ url, body });
    if (url.endsWith('/source-verify')) return new Response(JSON.stringify(verificationFor(body)));
    return new Response(JSON.stringify({ release_id: 'release', space_id: 'fixture-space', published_revision: 2, space_revision: 6, replayed: false,
      applied: applied(), reviews: [{ alias: 'guide', skill_id: 'skill-guide', operation: 'update', review_url: 'https://app.notis.ai/skill-reviews/guide' }] }));
  });
  const ctx = context('spaces deploy', { space: 'one', spaceId: 'fixture-space', requestId: 'pulled-intent' }, { dir: root });
  const result = await ctx.spec.handler(ctx);
  const verify = calls.find(call => call.url.endsWith('/source-verify')).body;
  assert.deepEqual(verify.changes, {
    skills: { edits: { guide: { skill_id: 'skill-guide', binding_id: 'b-guide', binding_revision: 1, version: { revision: 3, digest: 'a'.repeat(64) },
      files: { 'SKILL.md': b64('# Guide\nEdited locally.') } } }, creations: { 'weekly-digest': { files: { 'SKILL.md': b64('# Weekly digest') } } } },
    links: { add: [{ kind: 'automation', resource_id: 'auto-1', alias: 'weekly' }] } });
  const publish = calls.find(call => call.url.endsWith('/source-publish')).body;
  assert.deepEqual(publish.changes, verify.changes);
  assert.equal(publish.verification.changes_digest, 'd'.repeat(64));
  assert.equal('local_changes_fingerprint' in publish.verification, false, 'The local fingerprint never leaves the workspace');
  assert.match(result.humanSummary, /Published one as revision 2\. Skills updated: guide\. Skills created: weekly-digest\. Links added: weekly \(automation\)\. Review guide: https:\/\/app\.notis\.ai\/skill-reviews\/guide\./);
  const lock = readSpaceLock(root);
  assert.equal(lock.skills.guide.version.revision, 4);
  assert.equal(lock.skills.guide.folder_hash, appFilesDigest({ 'SKILL.md': b64('# Guide\nEdited locally.') }));
  assert.equal(lock.skills['weekly-digest'].skill_id, 'skill-new');
  assert.deepEqual(lock.links.map(link => link.alias), ['elsewhere', 'guide', 'rows', 'weekly', 'weekly-digest']);
  assert.equal(lock.source_revision, 2);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'resources.json'), 'utf8')).map(entry => entry.alias), ['elsewhere', 'guide', 'rows', 'weekly', 'weekly-digest']);
  // The next deploy of the untouched workspace carries no change.
  calls.length = 0;
  const again = context('spaces deploy', { space: 'one', spaceId: 'fixture-space', requestId: 'second-intent', dryRun: true }, { dir: root });
  await again.spec.handler(again);
  assert.equal('changes' in calls[0].body, false);
});

test('inconsistent pulled state and changed local changes on a retry are refused before any request', async t => {
  const root = await sourceFixture(t);
  pulledFixture(root);
  const fetch = t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body);
    if (url.endsWith('/source-verify')) return new Response(JSON.stringify(verificationFor(body)));
    return new Response('{"message":"reply lost"}', { status: 503 });
  });
  const ctx = context('spaces deploy', { space: 'one', spaceId: 'fixture-space', requestId: 'lost-intent' }, { dir: root });
  await assert.rejects(ctx.spec.handler(ctx));
  const before = fetch.mock.callCount();
  writeFileSync(join(root, 'skills/guide/SKILL.md'), '# Guide\nChanged again after the lost reply.');
  await assert.rejects(ctx.spec.handler(ctx), /different Skill folders or list entries/);
  assert.equal(fetch.mock.callCount(), before);
  rmSync(join(root, 'skills/guide'), { recursive: true });
  await assert.rejects(ctx.spec.handler(ctx), /different Skill folders or list entries/);
  assert.equal(fetch.mock.callCount(), before);
  const other = context('spaces deploy', { space: 'one', spaceId: 'another-space', requestId: 'x' }, { dir: root });
  await assert.rejects(other.spec.handler(other), /pulled from Space fixture-space/);
  assert.equal(fetch.mock.callCount(), before);
});

test('rv3-enfr D2: repeating a successful deploy in the pulled folder replays the same release and review link', async t => {
  const root = await sourceFixture(t), calls = [];
  pulledFixture(root);
  const review = 'https://app.notis.ai/skill-reviews/guide';
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); calls.push({ url, body });
    if (url.endsWith('/source-verify')) return new Response(JSON.stringify(verificationFor(body)));
    const replayed = calls.filter(call => call.url.endsWith('/source-publish')).length > 1;
    return new Response(JSON.stringify({ release_id: 'release-4290', space_id: 'fixture-space', published_revision: 2, space_revision: 6,
      replayed, applied: applied(), reviews: [{ alias: 'guide', skill_id: 'skill-guide', operation: 'update', review_url: review }] }));
  });
  const ctx = context('spaces deploy', { space: 'one', spaceId: 'fixture-space', requestId: 'repeat-intent' }, { dir: root });
  const first = await ctx.spec.handler(ctx);
  assert.equal(first.data.replayed, false);
  const lock = readSpaceLock(root), list = readFileSync(join(root, 'resources.json'), 'utf8');
  assert.equal(lock.source_revision, 2, 'The success rewrote the lock and the list');
  // The identical command in the same folder: no usage error, the same release and review link.
  const again = await ctx.spec.handler(ctx);
  assert.equal(again.data.replayed, true);
  assert.equal(again.data.release_id, 'release-4290');
  assert.deepEqual(again.data.reviews.map(entry => entry.review_url), [review]);
  assert.match(again.humanSummary, /Published one as revision 2 \(confirmed retry\)\..*Review guide: https:\/\/app\.notis\.ai\/skill-reviews\/guide\./);
  const publishes = calls.filter(call => call.url.endsWith('/source-publish')).map(call => call.body);
  assert.equal(publishes.length, 2);
  assert.equal(calls.filter(call => call.url.endsWith('/source-verify')).length, 1, 'The retained verification is reused');
  // The server receives the first request again: the same changes, verification and request ID.
  assert.deepEqual(publishes[1], publishes[0]);
  assert.equal('local_state' in publishes[1].verification, false, 'The pulled lock never leaves the workspace');
  const replayedLock = readSpaceLock(root);
  assert.deepEqual({ ...replayedLock, updated_at: null }, { ...lock, updated_at: null });
  assert.equal(readFileSync(join(root, 'resources.json'), 'utf8'), list);
  // An edit made after the success is a new intent, never a silent replay of the old one.
  const before = calls.length;
  writeFileSync(join(root, 'skills/guide/SKILL.md'), '# Guide\nEdited after the deploy.');
  await assert.rejects(ctx.spec.handler(ctx), /different Skill folders or list entries/);
  writeFileSync(join(root, 'skills/guide/SKILL.md'), '# Guide\nEdited locally.');
  writeFileSync(join(root, 'resources.json'), JSON.stringify(JSON.parse(list).filter(entry => entry.alias !== 'elsewhere')));
  await assert.rejects(ctx.spec.handler(ctx), /different Skill folders or list entries/);
  assert.equal(calls.length, before);
});

test('a workspace that was not pulled deploys without Skill or list changes and says why', async t => {
  const root = await sourceFixture(t), calls = [];
  mkdirSync(join(root, 'skills/guide'), { recursive: true }); writeFileSync(join(root, 'skills/guide/SKILL.md'), '# Guide');
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); calls.push(body);
    return new Response(JSON.stringify(verificationFor(body)));
  });
  const ctx = context('spaces verify', { space: 'one', spaceId: 'fixture-space' }, { dir: root });
  const result = await ctx.spec.handler(ctx);
  assert.equal('changes' in calls[0], false);
  assert.match(result.warnings[0], /notis spaces pull/);
});

test('promote with the pulled workspace records what went live in the lock and the list', async t => {
  const root = await sourceFixture(t);
  pulledFixture(root);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ release_id: 'sealed', space_id: 'fixture-space', published_revision: 3,
    space_revision: 7, replayed: false, applied: applied(), reviews: [] })));
  const ctx = context('spaces promote', {}, { releaseId: 'sealed', dir: root });
  const result = await ctx.spec.handler(ctx);
  assert.match(result.humanSummary, /Published revision 3\. Skills updated: guide/);
  assert.equal(readSpaceLock(root).skills.guide.version.revision, 4);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'resources.json'), 'utf8')).map(entry => entry.alias), ['elsewhere', 'guide', 'rows', 'weekly', 'weekly-digest']);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ release_id: 'sealed', space_id: 'other-space', published_revision: 1 })));
  await assert.rejects(ctx.spec.handler(ctx), /not from the promoted Space/);
});

test('viewer-read runs one read as the signed-in caller, with no request key, grant or link credential', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, request });
    return new Response(JSON.stringify({ databases: [] }), { status: 200 });
  });
  const ctx = context('spaces viewer-read', { revision: '3', input: '{"database_id":"db-1","request":{"page_size":5}}', record: 'record-1' },
    { spaceId: 'space-1', operation: 'query_database' });
  const result = await ctx.spec.handler(ctx);
  assert.equal(calls[0].url, 'https://fixture.invalid/portal_spaces/viewer-read');
  assert.deepEqual(JSON.parse(calls[0].request.body), { space_id: 'space-1', operation: 'query_database', revision: 3,
    input: { database_id: 'db-1', request: { page_size: 5 } }, document_id: 'record-1' });
  assert.equal(ctx.spec.mutates, false);
  assert.equal(result.meta.mutating, false);
  for (const options of [{ revision: 'nan' }, { revision: '3', input: '[]' }]) {
    const bad = context('spaces viewer-read', options, { spaceId: 'space-1', operation: 'list_databases' });
    assert.throws(() => bad.spec.handler(bad));
  }
  assert.equal(calls.length, 1);
});
