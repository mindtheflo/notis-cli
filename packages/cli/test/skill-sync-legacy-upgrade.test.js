import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runSkillSync } from '../dist/skill-sync/index.js';

// The shipped engine (`notis skills sync` and the launchd worker) upgrading a
// pre-Spaces personal Skill folder in place once the cloud serves it as native.
const ID = '22222222-2222-4222-8222-222222222222';
const SCOPE = 'd'.repeat(64);
const USER = 'u';
const JWT = `e30.${Buffer.from(JSON.stringify({ sub: USER })).toString('base64url')}.signature`;
const TARGETS = { notis: true, claude_code: true, cursor: true, codex: true };
const LEGACY_MD = '---\nname: grilling\ndescription: Legacy personal skill\n---\n\n# Grilling';
const NATIVE_MD = '---\nname: grilling\ndescription: Native personal skill\n---\n\n# Grilling';
const b64 = value => Buffer.from(value).toString('base64');

function legacyRow() {
  return { id: ID, name: 'grilling', description: 'Legacy personal skill', source: 'personal', status: 'active',
    skill_md: LEGACY_MD, agent_targets: TARGETS, updated_at: '2026-10-09T00:00:00Z',
    bundle_files: [{ path: 'SKILL.md', content_b64: b64(LEGACY_MD) }] };
}

function nativeRow(revision = 1) {
  const digest = String(revision).repeat(64);
  return { id: ID, name: 'native-' + ID, display_name: 'Grilling', description: 'Native personal skill',
    source: 'native', status: 'active', skill_md: NATIVE_MD, native_scope: SCOPE, agent_targets: TARGETS,
    native_settings: { revision: 0, enabled: true, updated_at: '2026-10-10T00:00:00Z', agent_targets: TARGETS },
    native_reference: { kind: 'native_standalone_skill', skill_id: ID, access_revision: 0, version: { revision, digest } },
    skill_folder_hash: digest, bundle_files: [{ path: 'SKILL.md', content_b64: b64(NATIVE_MD) }] };
}

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'nsl-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const userRoot = join(home, '.notis', 'skills', 'users', USER);
  const folder = join(userRoot, 'skills', 'grilling');
  let rows = [legacyRow()];
  const pushed = [];
  const deps = {
    fetchSyncSettings: async () => ({ user_id: USER, sync_enabled: true, last_synced_at: null, sync_scope: SCOPE }),
    pullSkills: async () => ({ skills: structuredClone(rows), sync_scope: SCOPE, skill_sync_protocol: 2,
      sync_enabled: true, last_synced_at: '2026-10-10T00:00:00Z' }),
    pushChangedSkills: async (_url, _jwt, skills) => {
      pushed.push(skills.map(skill => skill.name));
      return { skills: [], failed: skills.map(skill => ({ name: skill.name, error: 'Unconfigured fixture writer' })) };
    },
  };
  const run = (overrides = {}) => runSkillSync('https://fixture.invalid', JWT, { ...deps, ...overrides }, { syncHome: home });
  const readState = () => JSON.parse(readFileSync(join(userRoot, '.notis-sync.json'), 'utf8'));
  const linked = () => ['.claude', '.cursor', '.codex'].every(agent => {
    try { return lstatSync(join(home, agent, 'skills', 'grilling')).isSymbolicLink(); } catch { return false; }
  });
  /** Synced while the Skill was still legacy, then stripped of appliedFiles like state written before that existed. */
  const legacySync = async () => {
    mkdirSync(join(folder, 'runs'), { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), LEGACY_MD);
    writeFileSync(join(folder, 'runs', 'ledger.md'), 'LOCAL run ledger');
    assert.deepEqual((await run()).failedLinks, []);
    const state = readState();
    assert.equal(state.skills.grilling.nativeReference, undefined);
    delete state.skills.grilling.appliedFiles;
    writeFileSync(join(userRoot, '.notis-sync.json'), JSON.stringify(state));
    assert.ok(linked());
    pushed.length = 0; // the first sync offered the pre-existing folder upstream; only later pushes matter
  };
  return { folder, run, readState, linked, legacySync, pushed, serve: value => { rows = value; } };
}

test('an unchanged legacy folder with a differing SKILL.md upgrades to native and keeps local-only files', async t => {
  const f = fixture(t);
  await f.legacySync();
  f.serve([nativeRow()]);
  const result = await f.run();
  assert.deepEqual(result.failedLinks, []);
  assert.equal(readFileSync(join(f.folder, 'SKILL.md'), 'utf8'), NATIVE_MD);
  assert.equal(readFileSync(join(f.folder, 'runs', 'ledger.md'), 'utf8'), 'LOCAL run ledger');
  assert.ok(existsSync(join(f.folder, '.notis-native-skill.json')));
  assert.equal(f.readState().skills.grilling.nativeReference.version.revision, 1);
  assert.ok(f.linked(), 'the upgraded Skill keeps its Claude, Cursor and Codex links');
  assert.deepEqual(f.pushed, []);
});

test('a failed legacy upgrade keeps the legacy folder linked and retries on the next sync', async t => {
  const f = fixture(t);
  await f.legacySync();
  f.serve([nativeRow()]);
  const failed = await f.run({ writeCloudSkillToDisk: async () => { throw new Error('Simulated write failure'); } });
  assert.ok(failed.failedLinks.some(failure => failure.name === 'grilling'));
  assert.equal(readFileSync(join(f.folder, 'SKILL.md'), 'utf8'), LEGACY_MD);
  assert.ok(f.linked(), 'a Skill whose upgrade failed stays usable');
  assert.ok(!f.readState().skills.grilling.nativeUnavailable);
  assert.deepEqual((await f.run()).failedLinks, []);
  assert.equal(readFileSync(join(f.folder, 'SKILL.md'), 'utf8'), NATIVE_MD);
  assert.equal(readFileSync(join(f.folder, 'runs', 'ledger.md'), 'utf8'), 'LOCAL run ledger');
});

test('a genuinely edited native folder still keeps its edits against a conflicting cloud revision', async t => {
  const f = fixture(t);
  await f.legacySync();
  f.serve([nativeRow()]);
  assert.deepEqual((await f.run()).failedLinks, []);
  writeFileSync(join(f.folder, 'SKILL.md'), '# Local native edit');
  f.serve([nativeRow(2)]);
  const result = await f.run();
  assert.ok(result.failedLinks.some(failure => failure.name === 'grilling'));
  assert.equal(readFileSync(join(f.folder, 'SKILL.md'), 'utf8'), '# Local native edit');
  assert.equal(f.readState().skills.grilling.nativeReference.version.revision, 1);
});
