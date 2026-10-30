import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  CHANNEL_TAGS, WATCHED_PATHS, resolveMode, isWatched, publishedSource, readRegistryHistory, gitClient, decide,
  planPublication,
} = require('../scripts/release-trigger.cjs');

const MISSING = 'f'.repeat(40);

// A throwaway repository with one commit per kind of change. No remote: a
// commit it lacks cannot be fetched, as with a source origin no longer has.
function history() {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-trigger-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (files, message) => {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const c = {};
  c[1] = commit({ 'packages/cli/index.js': '1', 'server/app.py': '1', 'docs/readme.md': '1' }, 'base');
  c[2] = commit({ 'packages/cli/index.js': '2' }, 'cli change');
  c[3] = commit({ 'server/app.py': '2' }, 'server change');
  c[4] = commit({ 'docs/readme.md': '2' }, 'docs change');
  c[5] = commit({ 'packages/cli/index.js': '3' }, 'cli change after the release');
  return { dir, c, git: gitClient(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const tagged = (version, sourceSha) => ({ tag: 'nightly', version, sourceSha });

test('modes: manual runs preview, pushes merge, only the two callers publish after a release', () => {
  assert.equal(resolveMode({ eventName: 'workflow_dispatch', trigger: '' }), 'preview');
  assert.equal(resolveMode({ eventName: 'push' }), 'merge');
  assert.equal(resolveMode({ eventName: 'push', trigger: 'release' }), 'release');
  assert.equal(resolveMode({ eventName: 'workflow_call', trigger: 'release' }), 'release');
  assert.equal(resolveMode({ eventName: 'workflow_dispatch', trigger: 'catch-up' }), 'catch-up');
  assert.equal(resolveMode({ eventName: 'workflow_call', trigger: 'catch-up' }), 'catch-up');
  for (const run of [{ eventName: 'schedule' }, { eventName: 'pull_request' }, { eventName: 'workflow_dispatch', trigger: 'release' },
    { eventName: 'push', trigger: 'catch-up' }, { eventName: 'push', trigger: 'nightly' }, {}]) {
    assert.throws(() => resolveMode(run), /cannot run|does not run/);
  }
});

test('the watched paths are the CLI package inputs, matched by whole path segment', () => {
  for (const file of ['packages/cli/src/index.js', 'packages/sdk/index.js', 'packages/view-renderer/a.ts',
    'portal/src/lib/blockNote.ts', 'server/skills/notis-cli/SKILL.md', 'server/config/notis_app_boundary_rules.json',
    '.github/workflows/build-cli-package.yml']) assert.ok(isWatched(file), file);
  for (const file of ['packages/clix/a.js', 'portal/src/lib/blockNote.tsx', 'server/skills/notis-docs/SKILL.md',
    'server/app.py', '.github/workflows/temporal-release.yml']) assert.ok(!isWatched(file), file);
  assert.equal(new Set(WATCHED_PATHS).size, WATCHED_PATHS.length);
});

test('the beta branch compares with the nightly tag and production with latest, by recorded source commit', () => {
  const registry = { 'dist-tags': { beta: '1.1.0-beta.9', nightly: '1.1.0-nightly.3', latest: '1.0.0' }, versions: {
    '1.1.0-beta.9': { notisRelease: { sourceSha: 'c'.repeat(40), channel: 'beta' }, gitHead: 'c'.repeat(40) },
    '1.1.0-nightly.3': { notisRelease: { sourceSha: 'b'.repeat(40), channel: 'nightly' }, gitHead: 'b'.repeat(40) },
    '1.0.0': { gitHead: 'a'.repeat(40) } } };
  // Every branch -> tag decision comes from the one table in release-channels.cjs.
  assert.deepEqual(CHANNEL_TAGS, { beta: 'nightly', production: 'latest' });
  assert.deepEqual(publishedSource(registry, 'beta'), { tag: 'nightly', version: '1.1.0-nightly.3', sourceSha: 'b'.repeat(40) });
  assert.deepEqual(publishedSource(registry, 'production'), { tag: 'latest', version: '1.0.0', sourceSha: 'a'.repeat(40) });
  // The retired beta tag never counts as the nightly channel's publication.
  assert.deepEqual(publishedSource({ 'dist-tags': { beta: '1.1.0-beta.9' }, versions: registry.versions }, 'beta'),
    { tag: 'nightly', version: null, sourceSha: null });
  const unrecorded = { 'dist-tags': { latest: '0.2.2' }, versions: { '0.2.2': { gitHead: 'not-a-commit' } } };
  assert.deepEqual(publishedSource(unrecorded, 'production'), { tag: 'latest', version: '0.2.2', sourceSha: null });
  assert.throws(() => publishedSource(registry, 'dev'), /Unsupported channel/);
  assert.throws(() => publishedSource(registry, 'nightly'), /Unsupported channel/);
});

test('the registry read is the package history, with no credentials, and a missing package is empty', async () => {
  const calls = [];
  const registry = { 'dist-tags': { nightly: '1.0.0-nightly.1' }, versions: { '1.0.0-nightly.1': {} } };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { status: 200, ok: true, json: async () => registry };
  };
  assert.deepEqual(await readRegistryHistory({ fetcher }), registry);
  assert.equal(calls[0].url, 'https://registry.npmjs.org/%40notis_ai%2Fcli');
  assert.deepEqual(Object.keys(calls[0].options.headers), ['Accept']);
  const missing = async () => ({ status: 404, ok: false });
  assert.deepEqual(await readRegistryHistory({ fetcher: missing }), { versions: {}, 'dist-tags': {} });
  await assert.rejects(readRegistryHistory({ fetcher: async () => ({ status: 503, ok: false }) }), /unavailable/);
});

test('server files that are not live yet hold the CLI back for their own release', () => {
  const { c, git, cleanup } = history();
  try {
    const decision = decide({ channel: 'beta', head: c[3], liveSha: c[2], published: tagged(null, null), git });
    assert.equal(decision.publish, false);
    assert.match(decision.reason, /not live yet \(server\/app\.py\); their release publishes the CLI/);
  } finally { cleanup(); }
});

test('the CLI publishes when its tag ships nothing, no recorded source or a commit origin lost', () => {
  const { c, git, cleanup } = history();
  try {
    for (const [published, reason] of [[tagged(null, null), /nothing is published on nightly/],
      [tagged('1.0.0-nightly.1', null), /records no source commit/],
      [tagged('1.0.0-nightly.1', MISSING), /origin no longer has/]]) {
      const decision = decide({ channel: 'beta', head: c[4], liveSha: c[3], published, git });
      assert.equal(decision.publish, true);
      assert.match(decision.reason, reason);
    }
  } finally { cleanup(); }
});

test('the CLI is not republished for the same, an older or an unchanged source', () => {
  const { c, git, cleanup } = history();
  try {
    for (const [head, source, reason] of [[c[4], c[4], /already ships/], [c[2], c[4], /already contains/],
      [c[4], c[3], /no CLI or SDK file changed since nightly 1\.0\.0-nightly\.1/]]) {
      const decision = decide({ channel: 'beta', head, liveSha: head, published: tagged('1.0.0-nightly.1', source), git });
      assert.equal(decision.publish, false, reason.source);
      assert.match(decision.reason, reason);
    }
  } finally { cleanup(); }
});

test('a watched change since the published source publishes the branch head and names the files', () => {
  const { c, git, cleanup } = history();
  try {
    const decision = decide({ channel: 'production', head: c[4], liveSha: c[4],
      published: { tag: 'latest', version: '1.0.0', sourceSha: c[1] }, git });
    assert.equal(decision.publish, true);
    assert.deepEqual(decision.changed, ['packages/cli/index.js']);
    assert.match(decision.reason, /1 CLI or SDK file\(s\) changed since latest 1\.0\.0: packages\/cli\/index\.js/);
  } finally { cleanup(); }
});

test('a catch-up publishes only the CLI the live release contains, nothing newer', () => {
  const { c, git, cleanup } = history();
  try {
    const published = tagged('1.0.0-nightly.1', c[1]);
    const newer = decide({ channel: 'beta', head: c[5], liveSha: c[4], published, git, strict: true });
    assert.equal(newer.publish, false);
    assert.match(newer.reason, /changed CLI files after the live release .*packages\/cli\/index\.js/);
    // The automatic paths publish the same head: the server it talks to is live.
    assert.equal(decide({ channel: 'beta', head: c[5], liveSha: c[4], published, git }).publish, true);
    assert.equal(decide({ channel: 'beta', head: c[5], liveSha: c[5], published, git, strict: true }).publish, true);
  } finally { cleanup(); }
});

test('a live release off the branch, a missing commit or a malformed one stops the run', () => {
  const { c, git, cleanup } = history();
  try {
    const published = tagged(null, null);
    assert.throws(() => decide({ channel: 'beta', head: c[3], liveSha: c[5], published, git }), /is not on beta/);
    assert.throws(() => decide({ channel: 'beta', head: MISSING, liveSha: c[5], published, git }), /not on origin/);
    assert.throws(() => decide({ channel: 'beta', head: 'beta', liveSha: c[5], published, git }), /exact commits/);
    assert.throws(() => decide({ channel: 'beta', head: c[5], liveSha: '', published, git }), /exact commits/);
    assert.throws(() => decide({ channel: 'dev', head: c[5], liveSha: c[5], published, git }), /Unsupported channel/);
  } finally { cleanup(); }
});

function planner(c, git, overrides = {}) {
  const heads = { beta: c[5], production: c[4] };
  const reads = { heads: 0, history: 0 };
  const registry = { 'dist-tags': { nightly: '1.0.0-nightly.1', latest: '1.0.0' }, versions: {
    '1.0.0-nightly.1': { notisRelease: { sourceSha: c[1], channel: 'nightly' } },
    '1.0.0': { notisRelease: { sourceSha: c[4], channel: 'stable' } } } };
  return {
    reads,
    plan: options => planPublication({
      readHead: async channel => { reads.heads += 1; return heads[channel]; },
      readHistory: async () => { reads.history += 1; return registry; },
      git, ...overrides, ...options,
    }),
  };
}

test('a merge publishes once the server it talks to is live, and waits while a release deploys', async () => {
  const { c, git, cleanup } = history();
  try {
    const { plan, reads } = planner(c, git);
    const live = await plan({ mode: 'merge', ref: 'refs/heads/beta', liveState: 'live', liveSha: c[4], channel: '' });
    assert.deepEqual(live.row, { channel: 'beta', source_sha: c[5], publish_reason: live.reason });
    assert.match(live.reason, /changed since nightly 1\.0\.0-nightly\.1/);
    const pending = await plan({ mode: 'merge', ref: 'refs/heads/beta', liveState: 'live', liveSha: c[2] });
    assert.equal(pending.row, null);
    assert.match(pending.reason, /not live yet/);
    reads.heads = 0;
    reads.history = 0;
    const deploying = await plan({ mode: 'merge', ref: 'refs/heads/production', liveState: 'deploying' });
    assert.deepEqual([deploying.channel, deploying.row], ['production', null]);
    assert.match(deploying.reason, /deploying/);
    assert.deepEqual(reads, { heads: 0, history: 0 });
    for (const liveState of ['failed', '', undefined]) {
      await assert.rejects(plan({ mode: 'merge', ref: 'refs/heads/beta', liveState }), /live release of beta is unknown/);
    }
  } finally { cleanup(); }
});

test('a merge while releases are off only rehearses the branch head', async () => {
  const { c, git, cleanup } = history();
  try {
    const { plan, reads } = planner(c, git);
    const off = await plan({ mode: 'merge', ref: 'refs/heads/production', liveState: 'off' });
    assert.deepEqual(off.row, { channel: 'production', source_sha: c[4],
      publish_reason: 'production releases are off: rehearsal only' });
    assert.equal(reads.history, 0);
  } finally { cleanup(); }
});

test('a release publishes only its own channel after its own released commit', async () => {
  const { c, git, cleanup } = history();
  try {
    const { plan } = planner(c, git);
    const release = await plan({ mode: 'release', ref: 'refs/heads/beta', sha: c[4], channel: 'beta', sourceSha: c[4] });
    assert.deepEqual(release.row, { channel: 'beta', source_sha: c[5], publish_reason: release.reason });
    // Production's latest already ships its head.
    const production = await plan({ mode: 'release', ref: 'refs/heads/production', sha: c[4], channel: 'production',
      sourceSha: c[4] });
    assert.equal(production.row, null);
    assert.match(production.reason, /latest 1\.0\.0 already ships/);
    await assert.rejects(plan({ mode: 'release', ref: 'refs/heads/beta', sha: c[4], channel: 'production', sourceSha: c[4] }),
      /beta release cannot publish the production CLI/);
    await assert.rejects(plan({ mode: 'release', ref: 'refs/heads/beta', sha: c[4], channel: 'beta', sourceSha: c[3] }),
      /its own released commit/);
  } finally { cleanup(); }
});

test('a catch-up compares the live commit Render serves and never publishes newer CLI files', async () => {
  const { c, git, cleanup } = history();
  try {
    const { plan } = planner(c, git);
    const newer = await plan({ mode: 'catch-up', ref: 'refs/heads/beta', sha: c[5], channel: 'beta', sourceSha: c[4] });
    assert.equal(newer.row, null);
    assert.match(newer.reason, /a catch-up publishes only what that release contains/);
    const caught = await plan({ mode: 'catch-up', ref: 'refs/heads/production', sha: c[4], channel: 'beta', sourceSha: c[5] });
    assert.deepEqual(caught.row, { channel: 'beta', source_sha: c[5], publish_reason: caught.reason });
    await assert.rejects(plan({ mode: 'catch-up', ref: 'refs/heads/beta', channel: 'dev', sourceSha: c[5] }),
      /Unsupported channel/);
  } finally { cleanup(); }
});

test('the renamed branches plan the same release as their old names', async () => {
  const { c, git, cleanup } = history();
  try {
    const { plan } = planner(c, git);
    // A push or release on nightly/stable is the beta/production release key.
    const merge = await plan({ mode: 'merge', ref: 'refs/heads/nightly', liveState: 'live', liveSha: c[4], channel: '' });
    assert.deepEqual(merge.row, { channel: 'beta', source_sha: c[5], publish_reason: merge.reason });
    const release = await plan({ mode: 'release', ref: 'refs/heads/nightly', sha: c[4], channel: 'nightly', sourceSha: c[4] });
    assert.deepEqual(release.row, { channel: 'beta', source_sha: c[5], publish_reason: release.reason });
    const stable = await plan({ mode: 'release', ref: 'refs/heads/stable', sha: c[4], channel: 'stable', sourceSha: c[4] });
    assert.equal(stable.channel, 'production');
    // A release from the old name, called with the new name, is the same release.
    const mixed = await plan({ mode: 'release', ref: 'refs/heads/beta', sha: c[4], channel: 'nightly', sourceSha: c[4] });
    assert.equal(mixed.channel, 'beta');
    const caught = await plan({ mode: 'catch-up', ref: 'refs/heads/stable', sha: c[4], channel: 'nightly', sourceSha: c[5] });
    assert.equal(caught.channel, 'beta');
    await assert.rejects(plan({ mode: 'release', ref: 'refs/heads/nightly', sha: c[4], channel: 'stable', sourceSha: c[4] }),
      /beta release cannot publish the stable CLI/);
  } finally { cleanup(); }
});

test('publishing runs start only from beta or production, and previews are not planned here', async () => {
  const { c, git, cleanup } = history();
  try {
    const { plan } = planner(c, git);
    for (const mode of ['merge', 'release', 'catch-up']) {
      await assert.rejects(plan({ mode, ref: 'refs/heads/conductor/candidate', channel: 'beta', sourceSha: c[5],
        liveState: 'live', liveSha: c[5] }), /only from nightly or stable \(formerly beta or production\)/);
    }
    await assert.rejects(plan({ mode: 'preview', ref: 'refs/heads/beta', channel: 'beta' }), /does not plan preview/);
  } finally { cleanup(); }
});
