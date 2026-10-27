import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../scripts/prepare-publish.js');

// The registry the planner reads, served from a preload instead of npmjs.org.
const registry = {
  'dist-tags': { latest: '0.2.23', beta: '0.2.0-beta.900.1' },
  versions: { '0.2.23': { version: '0.2.23' }, '0.2.0-beta.900.1': { version: '0.2.0-beta.900.1' } },
};
const preload = `data:text/javascript,${encodeURIComponent(`globalThis.fetch = async () => ({
  status: 200, ok: true, json: async () => (${JSON.stringify(registry)}) });`)}`;

function plan(env) {
  const dir = mkdtempSync(join(tmpdir(), 'notis-prepare-publish-'));
  try {
    const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@notis_ai/cli', version: '0.2.0' }));
    git('init', '-q');
    git('add', 'package.json');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    const { GITHUB_TOKEN: _t, GITHUB_REPOSITORY: _r, GITHUB_OUTPUT: _o, NPM_RELEASE_CHANNEL: _c,
      NOTIS_RELEASE_BRANCH: _b, NOTIS_RELEASE_SHA: _s, NOTIS_RESERVE_RELEASE: _v, NOTIS_HANDOFF_REHEARSAL: _h,
      ...base } = process.env;
    const result = spawnSync(process.execPath, ['--import', preload, script], {
      cwd: dir, encoding: 'utf8', env: { ...base, NOTIS_RELEASE_NUMBER: '1800000000000', ...env },
    });
    return {
      result,
      plan: result.status === 0 ? JSON.parse(readFileSync(join(dir, 'release-plan.json'), 'utf8')) : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the beta branch plans a -nightly. prerelease on the nightly tag', () => {
  const { result, plan: nightly } = plan({ NOTIS_RELEASE_BRANCH: 'beta' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(nightly.releaseChannel, 'nightly');
  assert.equal(nightly.publishTag, 'nightly');
  assert.equal(nightly.nextVersion, '0.2.0-nightly.1800000000000.1');
  assert.equal(nightly.intent.channel, 'nightly');
  assert.match(nightly.intentRef, /^refs\/tags\/notis-cli-intent\/nightly\//);
});

test('the production branch plans the next stable version on latest', () => {
  const { result, plan: stable } = plan({ NOTIS_RELEASE_BRANCH: 'production' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([stable.releaseChannel, stable.publishTag, stable.nextVersion], ['stable', 'latest', '0.2.24']);
  // A local run names the channel and defaults to stable.
  assert.equal(plan({}).plan.publishTag, 'latest');
  assert.equal(plan({ NPM_RELEASE_CHANNEL: 'nightly' }).plan.publishTag, 'nightly');
});

test('the renamed nightly and stable branches plan the same channels as beta and production', () => {
  assert.equal(plan({ NOTIS_RELEASE_BRANCH: 'nightly' }).plan.publishTag, 'nightly');
  assert.equal(plan({ NOTIS_RELEASE_BRANCH: 'stable' }).plan.publishTag, 'latest');
});

test('the retired beta channel and unknown branches never plan a release', () => {
  for (const env of [{ NPM_RELEASE_CHANNEL: 'beta' }, { NOTIS_RELEASE_BRANCH: 'latest' },
    { NOTIS_RELEASE_BRANCH: 'main' }]) {
    const { result } = plan(env);
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.match(result.stderr, /Unsupported (release )?channel/);
  }
});
