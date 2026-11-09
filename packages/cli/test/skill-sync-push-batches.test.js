import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchSyncSettings, pushChangedSkills, runSkillSync } from '../dist/skill-sync/index.js';
import { main as runSkillSyncWorker } from '../src/skill-sync-worker.js';

// The edge in front of api.notis.ai refused an ~8 MB sync-push body with an
// HTML 403 before it reached Notis. One body for every changed skill meant the
// refusal held back all of them, and the worker recorded only `sync_failed`.

function home(t) {
  const root = mkdtempSync(join(tmpdir(), 'nsp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function localSkill(root, name, extraBytes = 0) {
  const directoryPath = join(root, name);
  mkdirSync(directoryPath, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}`;
  writeFileSync(join(directoryPath, 'SKILL.md'), skillMd);
  // Random bytes do not compress, so the bundle stays as large as the file.
  if (extraBytes) writeFileSync(join(directoryPath, 'screenshot.png'), randomBytes(extraBytes));
  return { name, description: `${name} skill`, skillMd, folderHash: `${name}-hash`, directoryPath };
}

function stubFetch(t, answer) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    requests.push({ url: String(url), bytes: Buffer.byteLength(init?.body || ''), body });
    return answer(body);
  };
  t.after(() => { globalThis.fetch = original; });
  return requests;
}

const edgeBlocked = () => new Response('<html><body>Sorry, you have been blocked</body></html>', {
  status: 403, headers: { 'content-type': 'text/html; charset=UTF-8' },
});

test('a refused large skill does not hold back the other changed skills', async t => {
  const root = home(t);
  const skills = [localSkill(root, 'notes'), localSkill(root, 'deck', 3 * 1024 * 1024), localSkill(root, 'travel')];
  const requests = stubFetch(t, body => {
    if (body.skills.some(skill => skill.name === 'deck')) return edgeBlocked();
    return Response.json({ skills: body.skills.map(skill => ({ id: `id-${skill.name}`, name: skill.name })) });
  });

  const result = await pushChangedSkills('https://api.fixture.invalid', 'jwt', skills);

  assert.ok(requests.length >= 2, `one body per batch, got ${requests.length}`);
  for (const request of requests) {
    const names = request.body.skills.map(skill => skill.name);
    assert.ok(request.bytes <= 2 * 1024 * 1024 || names.length === 1, `${names} sent together in ${request.bytes} bytes`);
  }
  assert.deepEqual(result.skills.map(skill => skill.name).sort(), ['notes', 'travel']);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(
    { name: result.failed[0].name, status: result.failed[0].status, code: result.failed[0].code },
    { name: 'deck', status: 403, code: 'edge_blocked' },
  );
  assert.doesNotMatch(result.failed[0].error, /blocked<\/|<html/);
});

test('the background worker records the HTTP status and the edge block instead of sync_failed', async t => {
  const root = home(t);
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  stubFetch(t, edgeBlocked);

  await runSkillSyncWorker(['beta', 'https://api.fixture.invalid', 'owner'], {
    home: root,
    run: () => fetchSyncSettings('https://api.fixture.invalid', 'jwt'),
    fingerprint: () => null,
  });

  const status = JSON.parse(readFileSync(join(root, '.notis', 'skills', 'service', 'status.json'), 'utf8'));
  assert.equal(status.status, 'error');
  assert.equal(status.code, 'edge_blocked');
  assert.equal(status.http_status, 403);
  assert.doesNotMatch(JSON.stringify(status), /html|blocked</);
});

test('a local edit whose upload failed is pushed again on the next sync', async t => {
  const syncHome = home(t);
  const user = 'u';
  const jwt = `e30.${Buffer.from(JSON.stringify({ sub: user })).toString('base64url')}.signature`;
  const targets = { notis: true, claude_code: true, cursor: true, codex: true };
  const md = '---\nname: notes\ndescription: Notes skill\n---\n\n# Notes';
  const row = { id: '11111111-1111-4111-8111-111111111111', name: 'notes', description: 'Notes skill',
    source: 'personal', status: 'active', skill_md: md, agent_targets: targets, updated_at: '2026-11-01T00:00:00Z',
    bundle_files: [{ path: 'SKILL.md', content_b64: Buffer.from(md).toString('base64') }] };
  const pushed = [];
  let refuse = false;
  const deps = {
    fetchSyncSettings: async () => ({ user_id: user, sync_enabled: true, last_synced_at: null, sync_scope: 'f'.repeat(64) }),
    pullSkills: async () => ({ skills: [structuredClone(row)], sync_scope: 'f'.repeat(64), skill_sync_protocol: 2,
      sync_enabled: true, last_synced_at: '2026-11-01T00:00:00Z' }),
    pushChangedSkills: async (_url, _jwt, skills) => {
      pushed.push(skills.map(skill => skill.name));
      return refuse
        ? { skills: [], failed: skills.map(skill => ({ name: skill.name, error: 'Upload blocked', status: 403, code: 'edge_blocked' })) }
        : { skills: [] };
    },
  };
  const run = () => runSkillSync('https://fixture.invalid', jwt, deps, { syncHome });
  const folder = join(syncHome, '.notis', 'skills', 'users', user, 'skills', 'notes');

  await run();
  assert.equal(readFileSync(join(folder, 'SKILL.md'), 'utf8'), md);
  pushed.length = 0;

  writeFileSync(join(folder, 'SKILL.md'), md + '\n\nA local edit.');
  refuse = true;
  const refused = await run();
  assert.deepEqual(pushed, [['notes']]);
  assert.equal(refused.failedPushes[0].code, 'edge_blocked');
  assert.match(readFileSync(join(folder, 'SKILL.md'), 'utf8'), /A local edit/);

  refuse = false;
  await run();
  assert.deepEqual(pushed, [['notes'], ['notes']]);
});

test('a native Skill edit whose upload was refused is pushed again on the next sync', async t => {
  const syncHome = home(t);
  const user = 'u';
  const jwt = `e30.${Buffer.from(JSON.stringify({ sub: user })).toString('base64url')}.signature`;
  const targets = { notis: true, claude_code: true, cursor: true, codex: true };
  const id = '33333333-3333-4333-8333-333333333333';
  const name = 'native-' + id;
  const scope = 'e'.repeat(64);
  const md = '---\nname: night-shift\ndescription: Revision 1\n---\n\n# Night shift r1';
  const digest = '1'.repeat(64);
  const row = { id, name, display_name: 'night-shift', description: 'Revision 1', source: 'native', status: 'active',
    skill_md: md, native_scope: scope, agent_targets: targets, updated_at: '2026-11-01T00:00:00Z',
    native_settings_scope: 'member',
    native_settings: { revision: 0, enabled: true, updated_at: '2026-10-10T00:00:00Z', agent_targets: targets },
    native_reference: { kind: 'native_standalone_skill', skill_id: id, access_revision: 0, version: { revision: 1, digest } },
    skill_folder_hash: digest,
    bundle_files: [{ path: 'SKILL.md', content_b64: Buffer.from(md).toString('base64') },
      { path: 'references/notes.md', content_b64: Buffer.from('notes v1').toString('base64') }] };
  const pushed = [];
  let refuse = false;
  const deps = {
    fetchSyncSettings: async () => ({ user_id: user, sync_enabled: true, last_synced_at: null, sync_scope: scope }),
    pullSkills: async () => ({ skills: [structuredClone(row)], sync_scope: scope, skill_sync_protocol: 2,
      sync_enabled: true, last_synced_at: '2026-11-01T00:00:00Z' }),
    pushChangedSkills: async (_url, _jwt, skills) => {
      pushed.push(skills.map(skill => skill.name));
      return refuse
        ? { skills: [], failed: skills.map(skill => ({ name: skill.name, error: 'Upload blocked', status: 403, code: 'edge_blocked' })) }
        : { skills: [] };
    },
  };
  const run = () => runSkillSync('https://fixture.invalid', jwt, deps, { syncHome });
  const folder = join(syncHome, '.notis', 'skills', 'users', user, 'skills', name);

  await run();
  assert.equal(readFileSync(join(folder, 'references', 'notes.md'), 'utf8'), 'notes v1');
  assert.deepEqual(pushed, [], 'an unedited native folder is never offered upstream');

  writeFileSync(join(folder, 'references', 'notes.md'), 'notes with a local edit');
  refuse = true;
  const refused = await run();
  assert.deepEqual(pushed, [[name]]);
  assert.equal(refused.failedPushes[0].code, 'edge_blocked');
  assert.equal(readFileSync(join(folder, 'references', 'notes.md'), 'utf8'), 'notes with a local edit');

  refuse = false;
  await run();
  assert.deepEqual(pushed, [[name], [name]]);
});

test('a refused sign-in stops the upload instead of sending every other body', async t => {
  const root = home(t);
  const skills = [localSkill(root, 'notes', 1536 * 1024), localSkill(root, 'deck', 1536 * 1024)];
  const requests = stubFetch(t, () => new Response('{"error":"unauthorized"}', {
    status: 401, headers: { 'content-type': 'application/json' },
  }));

  await assert.rejects(pushChangedSkills('https://api.fixture.invalid', 'jwt', skills), error => error.status === 401);
  assert.equal(requests.length, 1);
});
