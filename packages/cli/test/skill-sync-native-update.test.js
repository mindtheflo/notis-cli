import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runSkillSync } from '../dist/skill-sync/index.js';

// A native Skill (here one reached through a Space, member settings) already on disk at
// an older revision whose state row has no applied-file record: state written before
// that record existed, or a row rebuilt while the Skill was briefly unavailable. Its
// identity marker still lists every file the last write applied, so a newer cloud
// revision must install instead of failing as "conflicts with a local file" forever.
const ID = '33333333-3333-4333-8333-333333333333';
const NAME = 'native-' + ID;
const SCOPE = 'e'.repeat(64);
const USER = 'u';
const JWT = `e30.${Buffer.from(JSON.stringify({ sub: USER })).toString('base64url')}.signature`;
const TARGETS = { notis: true, claude_code: true, cursor: true, codex: true };
const b64 = value => Buffer.from(value).toString('base64');
const md = revision => `---\nname: night-shift\ndescription: Revision ${revision}\n---\n\n# Night shift r${revision}`;

function memberRow(revision, files) {
  const digest = String(revision % 10).repeat(64);
  return { id: ID, name: NAME, display_name: 'night-shift', description: `Revision ${revision}`,
    source: 'native', status: 'active', skill_md: md(revision), native_scope: SCOPE, agent_targets: TARGETS,
    updated_at: `2026-11-0${revision}T00:00:00Z`, native_settings_scope: 'member',
    native_settings: { revision: 0, enabled: true, updated_at: '2026-10-10T00:00:00Z', agent_targets: TARGETS },
    native_reference: { kind: 'native_standalone_skill', skill_id: ID, access_revision: 0, version: { revision, digest } },
    skill_folder_hash: digest,
    bundle_files: [{ path: 'SKILL.md', content_b64: b64(md(revision)) },
      ...Object.entries(files).map(([path, content]) => ({ path, content_b64: b64(content) }))] };
}

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'nsu-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const userRoot = join(home, '.notis', 'skills', 'users', USER);
  const folder = join(userRoot, 'skills', NAME);
  let rows = [];
  const pushed = [];
  const deps = {
    fetchSyncSettings: async () => ({ user_id: USER, sync_enabled: true, last_synced_at: null, sync_scope: SCOPE }),
    pullSkills: async () => ({ skills: structuredClone(rows), sync_scope: SCOPE, skill_sync_protocol: 2,
      sync_enabled: true, last_synced_at: '2026-11-04T00:00:00Z' }),
    pushChangedSkills: async (_url, _jwt, skills) => {
      pushed.push(...skills.map(skill => skill.name));
      return { skills: [], failed: skills.map(skill => ({ name: skill.name, error: 'Unexpected push' })) };
    },
  };
  const run = () => runSkillSync('https://fixture.invalid', JWT, deps, { syncHome: home });
  const statePath = join(userRoot, '.notis-sync.json');
  const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));
  const linked = () => ['.claude', '.cursor', '.codex'].every(agent => {
    try { return lstatSync(join(home, agent, 'skills', NAME)).isSymbolicLink(); } catch { return false; }
  });
  return { folder, run, readState, statePath, linked, pushed, serve: value => { rows = value; } };
}

test('a native Skill with no applied-file record installs its newer revision from its identity marker', async t => {
  const f = fixture(t);
  f.serve([memberRow(1, { 'references/old.md': 'old reference', 'references/kept.md': 'kept v1' })]);
  assert.deepEqual((await f.run()).failedLinks, []);
  assert.ok(f.linked());
  assert.equal(f.pushed.length, 0);
  const state = f.readState();
  delete state.skills[NAME].appliedFiles;
  writeFileSync(f.statePath, JSON.stringify(state));

  f.serve([memberRow(2, { 'references/kept.md': 'kept v2' })]);
  const result = await f.run();
  assert.deepEqual(result.failedLinks, []);
  assert.equal(readFileSync(join(f.folder, 'SKILL.md'), 'utf8'), md(2));
  assert.equal(readFileSync(join(f.folder, 'references', 'kept.md'), 'utf8'), 'kept v2');
  assert.ok(!existsSync(join(f.folder, 'references', 'old.md')), 'a file the cloud dropped is removed');
  const row = f.readState().skills[NAME];
  assert.equal(row.nativeReference.version.revision, 2);
  assert.ok(!row.nativeUnavailable);
  assert.ok(f.linked(), 'the updated Skill stays linked for Claude, Cursor and Codex');
  assert.deepEqual(f.pushed, [], 'an unedited folder is never offered upstream');
});

test('an edited managed file still blocks the update when no applied-file record exists', async t => {
  const f = fixture(t);
  f.serve([memberRow(1, { 'references/kept.md': 'kept v1' })]);
  assert.deepEqual((await f.run()).failedLinks, []);
  const state = f.readState();
  delete state.skills[NAME].appliedFiles;
  writeFileSync(f.statePath, JSON.stringify(state));
  writeFileSync(join(f.folder, 'references', 'kept.md'), 'LOCAL edit');

  f.serve([memberRow(2, { 'references/kept.md': 'kept v2' })]);
  const result = await f.run();
  assert.ok(result.failedLinks.some(failure => failure.name === NAME));
  assert.equal(readFileSync(join(f.folder, 'references', 'kept.md'), 'utf8'), 'LOCAL edit');
  assert.equal(f.readState().skills[NAME].nativeReference.version.revision, 1);
});
