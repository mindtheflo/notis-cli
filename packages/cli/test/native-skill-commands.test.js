import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';
import { skillsCommandSpecs } from '../src/command-specs/skills.js';

function context(name, options = {}, args = {}) {
  const spec = skillsCommandSpecs.find(item => item.command_path.join(' ') === name);
  assert.ok(spec);
  return { spec, options, args, globalOptions: {}, runtime: { credentialKind: 'env', profileName: 'native-skill-test',
    jwt: 'fictional-unit-credential', apiBase: 'https://fixture.invalid', timeoutMs: 1000, cliVersion: 'fixture' },
    output: { emitSuccess: value => value } };
}

test('create stamps only a standalone destination and retains files and stable identity through retry', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body) }); return new Response('{"standalone":true}');
  });
  const directory = mkdtempSync(join(tmpdir(), 'native-skill-create-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'skill.json');
  const payload = { name: 'Workflow', files: { 'SKILL.md': 'IyBXb3JrZmxvdw==', 'helper.bin': 'AP8=' } };
  writeFileSync(file, JSON.stringify(payload));
  const ctx = context('skills create', { requestId: 'create-once', dryRun: true }, { file });
  assert.equal((await ctx.spec.handler(ctx)).meta.mutating, false);
  ctx.options.dryRun = false;
  assert.equal((await ctx.spec.handler(ctx)).meta.mutating, true);
  await ctx.spec.handler(ctx);
  assert.deepEqual(calls[1], calls[2]);
  assert.ok(calls[0].url.endsWith('/portal_skills/native-create'));
  assert.deepEqual(calls[0].body, { ...payload, operation: 'create', destination: { kind: 'standalone' }, request_id: 'create-once', dry_run: true });
  for (const patch of [{ owner: 'foreign' }, { destination: { space_id: 'foreign' } }, { user_id: 'forged' }]) {
    writeFileSync(file, JSON.stringify({ ...payload, ...patch }));
    assert.throws(() => ctx.spec.handler(ctx));
  }
  writeFileSync(file, JSON.stringify(payload));
  ctx.options.requestId = undefined;
  assert.throws(() => ctx.spec.handler(ctx), /request-id/);
  assert.equal(calls.length, 3);
});

test('standalone Skill read uses only its direct identity and no Space protocol', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, headers: request.headers, body: JSON.parse(request.body) });
    return new Response('{"skill_id":"direct"}');
  });
  const ctx = context('skills read', { files: true }, { skillId: 'direct' });
  const result = await ctx.spec.handler(ctx);
  assert.equal(result.meta.mutating, false);
  assert.ok(calls[0].url.endsWith('/portal_skills/native-authoring'));
  assert.deepEqual(calls[0].body, { operation: 'read', target: { skill_id: 'direct' }, include_files: true });
  assert.equal(calls[0].headers['X-Notis-Spaces-Protocol'], undefined);
});

test('standalone edits preserve exact version and request across dry-run and commit', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    calls.push(JSON.parse(request.body)); return new Response('{"valid":true}');
  });
  const directory = mkdtempSync(join(tmpdir(), 'native-skill-edit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'edit.json');
  const payload = { target: { skill_id: 'direct', access_revision: 3 }, version: { revision: 5, digest: 'a'.repeat(64) },
    files: { 'SKILL.md': 'IyBDaGVja2Vk', 'helper.bin': 'AP8=' } };
  writeFileSync(file, JSON.stringify(payload));
  const ctx = context('skills update', { requestId: 'edit-once', dryRun: true }, { file });
  assert.equal((await ctx.spec.handler(ctx)).meta.mutating, false);
  ctx.options.dryRun = false;
  assert.equal((await ctx.spec.handler(ctx)).meta.mutating, true);
  assert.deepEqual(calls, [{ ...payload, operation: 'update', request_id: 'edit-once', dry_run: true },
    { ...payload, operation: 'update', request_id: 'edit-once', dry_run: false }]);
  writeFileSync(file, JSON.stringify({ ...payload, target: { space_id: 'foreign', binding_id: 'binding' } }));
  assert.throws(() => ctx.spec.handler(ctx));
  writeFileSync(file, JSON.stringify({ ...payload, user_id: 'forged' }));
  assert.throws(() => ctx.spec.handler(ctx));
  assert.equal(calls.length, 2);
});

test('personal settings keep their separate route and stable CAS request through dry-run', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body) }); return new Response('{"valid":true}');
  });
  const read = context('skills settings read', {}, { skillId: 'direct' });
  await read.spec.handler(read);
  assert.ok(calls[0].url.endsWith('/portal_skills/native-settings'));
  assert.deepEqual(calls[0].body, { operation: 'read', target: { skill_id: 'direct' } });
  const directory = mkdtempSync(join(tmpdir(), 'native-skill-settings-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'settings.json');
  const payload = { target: { skill_id: 'direct', access_revision: 3 }, revision: 2, patch: { enabled: false } };
  writeFileSync(file, JSON.stringify(payload));
  const ctx = context('skills settings update', { requestId: 'settings-once', dryRun: true }, { file });
  assert.equal((await ctx.spec.handler(ctx)).meta.mutating, false);
  ctx.options.dryRun = false; await ctx.spec.handler(ctx);
  assert.deepEqual(calls[1].body, { ...calls[2].body, dry_run: true });
  writeFileSync(file, JSON.stringify({ ...payload, skill_md: '# No content edits here' }));
  assert.throws(() => ctx.spec.handler(ctx));
});

test('native Skill reads and edits preserve exact target, version, and retry intent', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => { calls.push({ url, body: JSON.parse(request.body) }); return new Response('{"valid":true}'); });
  const read = context('skills read', { files: true, target: JSON.stringify({space_id:'space',binding_id:'binding'}) });
  assert.equal((await read.spec.handler(read)).meta.mutating, false);
  assert.deepEqual(calls[0].body, { operation: 'read', target: { space_id: 'space', binding_id: 'binding' }, include_files: true });
  const dir = mkdtempSync(join(tmpdir(), 'space-skill-edit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'edit.json');
  const payload = { target: { space_id: 'space', binding_id: 'binding', binding_revision: 2, expected_skill_id: 'original', space_revision: 3 },
    version: { revision: 4, digest: 'a'.repeat(64) }, skill_md: '# Local edit\nKeep helpers.' };
  writeFileSync(file, JSON.stringify(payload));
  const edit = context('skills update', { requestId: 'edit-once', dryRun: true }, { file });
  const result = await edit.spec.handler(edit);
  assert.equal(result.meta.mutating, false);
  assert.deepEqual(calls[1].body, { ...payload, operation: 'update', request_id: 'edit-once', dry_run: true });
  writeFileSync(file, JSON.stringify({ ...payload, user_id: 'forged' }));
  assert.throws(() => edit.spec.handler(edit));
  assert.equal(calls.length, 2);
});

test('native Skill creation keeps exact destination and files with stable dry-run and execute intent', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body), headers: request.headers });
    return new Response('{"skill_id":"new-native"}');
  });
  const dir = mkdtempSync(join(tmpdir(), 'space-skill-create-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'create.json');
  const payload = { destination: { space_id: 'exact-space', alias: 'workflow', revision: 0 },
    name: 'Fictional workflow', description: 'Fixture only', files: { 'SKILL.md': 'IyBGaXh0dXJl', binary: 'AP8B' } };
  writeFileSync(file, JSON.stringify(payload));
  const dry = context('skills create', { requestId: 'create-once', dryRun: true }, { file });
  assert.equal((await dry.spec.handler(dry)).meta.mutating, false);
  const commit = context('skills create', { requestId: 'create-once' }, { file });
  assert.equal((await commit.spec.handler(commit)).meta.mutating, true);
  assert.deepEqual(calls[0].body, { ...payload, operation: 'create', request_id: 'create-once', dry_run: true });
  assert.deepEqual(calls[1].body, { ...calls[0].body, dry_run: false });
  assert.equal(calls[0].headers['X-Notis-Spaces-Protocol'], '1');
  writeFileSync(file, JSON.stringify({ ...payload, user_id: 'forged' }));
  assert.throws(() => commit.spec.handler(commit));
  assert.equal(calls.length, 2);
});


test('removed Space Skill commands have no compatibility aliases', () => {
  assert.equal(spacesCommandSpecs.some(spec => spec.command_path[1] === 'skills'), false);
});

test('read target is unambiguous and Space requests preserve the protocol fence', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,request) => {calls.push({url,headers:request.headers,body:JSON.parse(request.body)});return new Response('{}');});
  const invalid=[context('skills read'),context('skills read',{target:'{}'}),context('skills read',{target:'{"skill_id":"another"}'},{skillId:'direct'})];
  for(const ctx of invalid) assert.throws(() => ctx.spec.handler(ctx));
  const read=context('skills read',{target:'{"space_id":"space","binding_id":"binding"}'});
  await read.spec.handler(read);
  assert.ok(calls[0].url.endsWith('/portal_skills/native-authoring'));
  assert.equal(calls[0].headers['X-Notis-Spaces-Protocol'],'1');
});

test('skills list sends only the inventory filters and renders one line per Skill with its links', async t => {
  const calls = [];
  const page = { skills: [
    { skill_id: 'shared', name: 'Research', kind: 'space', editable: true, links: [
      { space_id: 'seo', space_name: 'SEO', alias: 'research', available: true },
      { space_id: 'bob', space_name: 'Bob', alias: 'research-2', available: false }] },
    { skill_id: 'curated', name: 'From Notis', kind: 'curated', editable: false, read_only_reason: 'curated', links: [] },
  ], has_more: true, next: 'cursor-2' };
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, method: request.method, headers: request.headers, body: JSON.parse(request.body) });
    return new Response(JSON.stringify(page));
  });
  const plain = context('skills list');
  const result = await plain.spec.handler(plain);
  assert.deepEqual(calls[0], { ...calls[0], url: 'https://fixture.invalid/portal_skills/inventory', method: 'POST', body: {} });
  assert.equal(result.meta.mutating, false);
  const lines = result.humanSummary.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Research  shared  space  editable  links: SEO\/research, Bob\/research-2 \(unavailable\)$/);
  assert.match(lines[1], /^From Notis  curated  curated  read-only \(curated\)  links: none$/);
  assert.match(lines[2], /--after cursor-2/);
  const filtered = context('skills list', { space: 'parent', childSpaces: false, includeDisabled: true, after: 'cursor-1', limit: '20' });
  await filtered.spec.handler(filtered);
  assert.deepEqual(calls[1].body, { space_id: 'parent', include_child_spaces: false, include_disabled: true, after: 'cursor-1', limit: 20 });
  for (const options of [{ childSpaces: false }, { limit: '0' }, { limit: '101' }, { limit: '1.5' }, { limit: 'many' }]) {
    const invalid = context('skills list', options);
    await assert.rejects(invalid.spec.handler(invalid));
  }
  assert.equal(calls.length, 2);
});

test('skills links posts one resource-owned link change with a stable key through the Spaces protocol', async t => {
  const calls = [];
  const outcome = { kind: 'skill', resource_id: 'shared', added: [{ space_id: 'to', alias: 'research', binding_id: 'b2' }],
    removed: [{ space_id: 'from', alias: 'research', binding_id: 'b1' }], became_standalone: false, replayed: false,
    links: [{ space_id: 'to', space_name: 'To', alias: 'research', available: true }] };
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, headers: request.headers, body: JSON.parse(request.body) });
    return new Response(JSON.stringify(outcome));
  });
  const add = [{ space_id: 'to', space_revision: 3, alias: 'research' }], remove = [{ binding_id: 'b1', binding_revision: 2 }];
  const move = context('skills links', { add: JSON.stringify(add), remove: JSON.stringify(remove), requestId: 'move-1' }, { skillId: 'shared' });
  const result = await move.spec.handler(move);
  assert.equal(calls[0].url, 'https://fixture.invalid/portal_spaces/resource-links');
  assert.equal(calls[0].headers['X-Notis-Spaces-Protocol'], '1');
  assert.deepEqual(calls[0].body, { kind: 'skill', resource_id: 'shared', links: { add, remove }, request_id: 'move-1' });
  assert.equal(result.meta.mutating, true);
  assert.equal(result.humanSummary, 'added: to/research; removed: from/research. Listed in: To/research.');
  const viaGlobalKey = context('skills links', { add: JSON.stringify(add) }, { skillId: 'shared' });
  viaGlobalKey.globalOptions.idempotencyKey = 'link-once';
  await viaGlobalKey.spec.handler(viaGlobalKey);
  assert.deepEqual(calls[1].body, { kind: 'skill', resource_id: 'shared', links: { add }, request_id: 'link-once' });
  for (const options of [{ requestId: 'x' }, { add: '[]', requestId: 'x' }, { add: '{}', requestId: 'x' }, { add: 'not json', requestId: 'x' },
    { add: JSON.stringify([{ space_id: 'to' }]), requestId: 'x' }, { add: JSON.stringify([{ space_id: 'to', space_revision: 3, owner_id: 'me' }]), requestId: 'x' },
    { remove: JSON.stringify([{ binding_id: 'b1' }]), requestId: 'x' }, { add: JSON.stringify(add) }]) {
    const invalid = context('skills links', options, { skillId: 'shared' });
    await assert.rejects(invalid.spec.handler(invalid));
  }
  assert.equal(calls.length, 2);
});

test('one edit file carries a link change for a standalone or a Space target through the same writer', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, headers: request.headers, body: JSON.parse(request.body) }); return new Response('{"valid":true}');
  });
  const dir = mkdtempSync(join(tmpdir(), 'skill-edit-links-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'edit.json');
  const links = { add: [{ space_id: 'to', space_revision: 3 }], remove: [{ binding_id: 'b1', binding_revision: 2 }] };
  const targets = [{ skill_id: 'direct', access_revision: 3 },
    { space_id: 'space', binding_id: 'binding', binding_revision: 2, expected_skill_id: 'original', space_revision: 3 }];
  for (const target of targets) {
    const payload = { target, version: { revision: 5, digest: 'a'.repeat(64) }, skill_md: '# Moved edit', links };
    writeFileSync(file, JSON.stringify(payload));
    const ctx = context('skills update', { requestId: 'edit-links' }, { file });
    assert.equal((await ctx.spec.handler(ctx)).meta.mutating, true);
    assert.deepEqual(calls.at(-1).body, { ...payload, operation: 'update', request_id: 'edit-links', dry_run: false });
    assert.ok(calls.at(-1).url.endsWith('/portal_skills/native-authoring'));
    assert.equal(calls.at(-1).headers['X-Notis-Spaces-Protocol'], '1');
  }
  for (const bad of [{ links: [] }, { links: {} }, { links: { move: [] } }, { links: { add: [] }, owner: 'forged' }]) {
    writeFileSync(file, JSON.stringify({ target: targets[0], version: { revision: 5, digest: 'a'.repeat(64) }, skill_md: '# x', ...bad }));
    const ctx = context('skills update', { requestId: 'edit-links' }, { file });
    assert.throws(() => ctx.spec.handler(ctx));
  }
  assert.equal(calls.length, 2);
});
