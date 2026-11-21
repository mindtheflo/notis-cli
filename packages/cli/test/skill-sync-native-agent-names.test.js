import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { runSkillSync } from '../dist/skill-sync/index.js';

// A native Skill lives in a `native-<id>` mirror folder, but Claude Code, Cursor and
// Codex find it under its readable name: the agent links carry the SKILL.md `name`.
const ID = '44444444-4444-4444-8444-444444444444';
const FOLDER = 'native-' + ID;
const READABLE = 'product-design';
const SCOPE = 'f'.repeat(64);
const USER = 'u';
const JWT = `e30.${Buffer.from(JSON.stringify({ sub: USER })).toString('base64url')}.signature`;
const TARGETS = { notis: true, claude_code: true, cursor: true, codex: true };
const AGENTS = ['.claude', '.cursor', '.codex'];
const md = `---\nname: ${READABLE}\ndescription: Decide a feature in a spec Space\n---\n\n# Product design`;

function nativeRow(agentTargets, settingsRevision) {
  return { id: ID, name: FOLDER, display_name: READABLE, description: 'Decide a feature in a spec Space',
    source: 'native', status: 'active', skill_md: md, native_scope: SCOPE, agent_targets: agentTargets,
    updated_at: '2026-11-01T00:00:00Z',
    native_settings: { revision: settingsRevision, enabled: true, updated_at: '2026-11-01T00:00:00Z', agent_targets: agentTargets },
    native_reference: { kind: 'native_standalone_skill', skill_id: ID, access_revision: 0, version: { revision: 1, digest: '1'.repeat(64) } },
    skill_folder_hash: '1'.repeat(64),
    bundle_files: [{ path: 'SKILL.md', content_b64: Buffer.from(md).toString('base64') }] };
}

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'nsan-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const userRoot = join(home, '.notis', 'skills', 'users', USER);
  const mirror = join(userRoot, 'skills', FOLDER);
  let targets = { ...TARGETS };
  let settingsRevision = 0;
  const assignmentPatches = [];
  const deps = {
    fetchSyncSettings: async () => ({ user_id: USER, sync_enabled: true, last_synced_at: null, sync_scope: SCOPE,
      agent_targets_conditional_updates: true }),
    pullSkills: async () => ({ skills: [nativeRow(targets, settingsRevision)], sync_scope: SCOPE, skill_sync_protocol: 2,
      sync_enabled: true, last_synced_at: '2026-11-04T00:00:00Z' }),
    pushChangedSkills: async (_url, _jwt, skills) => ({ skills: [],
      failed: skills.map(skill => ({ name: skill.name, error: 'Unexpected push' })) }),
    updateAgentTargets: async (_url, _jwt, _id, patch) => {
      assignmentPatches.push(patch);
      targets = { ...targets, ...patch };
      settingsRevision += 1;
      return { success: true, agent_targets: { ...targets }, updated_at: `2026-11-05T00:00:0${settingsRevision}Z` };
    },
  };
  const statePath = join(userRoot, '.notis-sync.json');
  const agentLink = (agent, name) => join(home, agent, 'skills', name);
  const isLink = path => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };
  return {
    home, mirror, assignmentPatches, agentLink, isLink,
    run: () => runSkillSync('https://fixture.invalid', JWT, deps, { syncHome: home }),
    readState: () => JSON.parse(readFileSync(statePath, 'utf8')),
    writeState: state => writeFileSync(statePath, JSON.stringify(state)),
  };
}

test('a native Skill is linked for each agent under its readable name, and the mirror keeps native-<id>', async t => {
  const f = fixture(t);
  assert.deepEqual((await f.run()).failedLinks, []);
  assert.ok(existsSync(join(f.mirror, '.notis-native-skill.json')), 'the mirror folder and its identity are unchanged');
  assert.deepEqual(readdirSync(dirname(f.mirror)).filter(name => !name.startsWith('.')), [FOLDER],
    'the readable links are never gathered back into the mirror');
  for (const agent of AGENTS) {
    assert.ok(f.isLink(f.agentLink(agent, READABLE)), `${agent} lists the Skill as ${READABLE}`);
    assert.ok(!existsSync(f.agentLink(agent, FOLDER)), `${agent} does not list it twice`);
    assert.equal(readFileSync(join(f.agentLink(agent, READABLE), 'SKILL.md'), 'utf8'), md);
  }
  assert.deepEqual(f.readState().skills[FOLDER].verifiedAgentLinks,
    { claude_code: READABLE, cursor: READABLE, codex: READABLE });
});

test('links an older sync made under native-<id> move to the readable name without deactivating the Skill', async t => {
  const f = fixture(t);
  await f.run();
  // Rewind to what an older client left: links named after the folder, verified as `true`.
  const state = f.readState();
  state.skills[FOLDER].verifiedAgentLinks = { claude_code: true, cursor: true, codex: true };
  f.writeState(state);
  for (const agent of AGENTS) {
    unlinkSync(f.agentLink(agent, READABLE));
    symlinkSync(relative(join(f.home, agent, 'skills'), f.mirror), f.agentLink(agent, FOLDER));
  }

  const result = await f.run();
  assert.equal(result.deactivated, 0, 'moving the link is not a user deletion');
  assert.deepEqual(f.assignmentPatches, []);
  for (const agent of AGENTS) {
    assert.ok(f.isLink(f.agentLink(agent, READABLE)));
    assert.ok(!f.isLink(f.agentLink(agent, FOLDER)), 'the old native-<id> link is removed');
  }
  assert.deepEqual(f.readState().skills[FOLDER].verifiedAgentLinks,
    { claude_code: READABLE, cursor: READABLE, codex: READABLE });
});

test('deleting the readable link removes the Skill from that agent only', async t => {
  const f = fixture(t);
  await f.run();
  unlinkSync(f.agentLink('.claude', READABLE));

  const result = await f.run();
  assert.equal(result.deactivated, 1);
  assert.deepEqual(f.assignmentPatches, [{ claude_code: false }]);
  assert.ok(!existsSync(f.agentLink('.claude', READABLE)), 'the deletion sticks');
  assert.ok(!existsSync(f.agentLink('.claude', FOLDER)), 'and is not recreated under the folder name');
  assert.ok(f.isLink(f.agentLink('.cursor', READABLE)));
  assert.ok(f.isLink(f.agentLink('.codex', READABLE)));
});
