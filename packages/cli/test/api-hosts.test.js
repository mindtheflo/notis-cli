// One CLI list of the live Notis APIs (api-hosts.js): every caller derives its
// hosts from it and keeps the results it had when each kept its own copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIVE_API_HOSTS,
  LIVE_API_ORIGINS,
  channelApis,
  channelForApiHost,
  currentApiOrigin,
  isLiveApiOrigin,
  isOnRetiredApiHost,
  portalOriginForApiHost,
  renamedRetiredApiOrigin,
} from '../src/runtime/api-hosts.js';
import { channelFromApiBase } from '../src/runtime/channel.js';
import { DEFAULT_API_BASE, NIGHTLY_API_BASE, isLiveApiBase } from '../src/runtime/profiles.js';
import { portalOriginFor } from '../src/runtime/upsell.js';
import { CHANNEL_HOSTNAMES, CHANNEL_ORIGINS } from '../src/runtime/api-hosts.generated.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
// The public notis-cli mirror holds packages/cli without the generator or the server list.
const inMonorepo = existsSync(join(repoRoot, 'scripts/generate_channel_hosts.py'));

test('the generated API hosts are up to date with the server channel list', { skip: !inMonorepo && 'outside the monorepo' }, () => {
  // api-hosts.generated.js is written from server/lib/release_channels.py; a stale file fails with the command to regenerate it.
  let check = null;
  for (const python of ['python3', 'python']) {
    const run = spawnSync(python, ['scripts/generate_channel_hosts.py', '--check'], { cwd: repoRoot, encoding: 'utf8' });
    // 9009: the Windows Store alias that stands in for a missing python3.
    if (!run.error && run.status !== 9009) { check = run; break; }
  }
  assert.ok(check, 'python3 (or python) is needed to check the generated hosts');
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test('api-beta stays a retired nightly API after the server list drops it (CLI-037, CLI-038)', () => {
  const withoutBeta = {
    ...CHANNEL_HOSTNAMES,
    nightly: { ...CHANNEL_HOSTNAMES.nightly, api: ['api-nightly.notis.ai'] },
  };
  for (const hostnames of [CHANNEL_HOSTNAMES, withoutBeta]) {
    assert.deepEqual(channelApis(hostnames, CHANNEL_ORIGINS), {
      stable: { current: 'api.notis.ai', retired: [], portal: 'https://app.notis.ai' },
      nightly: { current: 'api-nightly.notis.ai', retired: ['api-beta.notis.ai'], portal: 'https://app-nightly.notis.ai' },
    });
  }
});

test('the live API list keeps every host, its channel and its Portal', () => {
  assert.deepEqual(LIVE_API_HOSTS, ['api.notis.ai', 'api-nightly.notis.ai', 'api-beta.notis.ai']);
  assert.deepEqual(LIVE_API_ORIGINS, ['https://api.notis.ai', 'https://api-nightly.notis.ai', 'https://api-beta.notis.ai']);
  const expected = {
    'api.notis.ai': ['stable', 'https://app.notis.ai'],
    'api-nightly.notis.ai': ['nightly', 'https://app-nightly.notis.ai'],
    'api-beta.notis.ai': ['nightly', 'https://app-nightly.notis.ai'],
  };
  for (const [host, [channel, portal]] of Object.entries(expected)) {
    assert.equal(channelForApiHost(host), channel, host);
    assert.equal(channelFromApiBase(`https://${host}`), channel, host);
    assert.equal(portalOriginForApiHost(host), portal, host);
    assert.equal(portalOriginFor(`https://${host}/tool`), portal, host);
    assert.equal(isLiveApiBase(`https://${host}`), true, host);
  }
  for (const host of ['beta.notis.ai', 'mcp-nightly.notis.ai', 'api.notis.ai.example.com', 'localhost']) {
    assert.equal(channelForApiHost(host), null, host);
    assert.equal(portalOriginForApiHost(host), null, host);
    assert.equal(isLiveApiBase(`https://${host}`), false, host);
  }
  assert.equal(DEFAULT_API_BASE, 'https://api.notis.ai');
  assert.equal(NIGHTLY_API_BASE, 'https://api-nightly.notis.ai');
  assert.equal(currentApiOrigin('nightly'), 'https://api-nightly.notis.ai');
});

test('only the bare retired origin is renamed to its current name', () => {
  assert.equal(renamedRetiredApiOrigin('https://api-beta.notis.ai'), 'https://api-nightly.notis.ai');
  assert.equal(renamedRetiredApiOrigin('https://api-beta.notis.ai/'), 'https://api-nightly.notis.ai');
  for (const value of [
    'https://api-nightly.notis.ai',
    'https://api.notis.ai',
    'http://api-beta.notis.ai',
    'https://api-beta.notis.ai:8443',
    'https://api-beta.notis.ai/cli',
    'https://api-beta.notis.ai/?x=1',
    'not a url',
    undefined,
  ]) {
    assert.equal(renamedRetiredApiOrigin(value), null, String(value));
  }
  assert.equal(isOnRetiredApiHost('https://api-beta.notis.ai/cli'), true);
  assert.equal(isOnRetiredApiHost('https://api-nightly.notis.ai/cli'), false);
  assert.equal(isOnRetiredApiHost('http://api-beta.notis.ai/cli'), false);
  assert.equal(isLiveApiOrigin('https://api-nightly.notis.ai/'), true);
  assert.equal(isLiveApiOrigin('https://api-nightly.notis.ai/cli'), false);
});
