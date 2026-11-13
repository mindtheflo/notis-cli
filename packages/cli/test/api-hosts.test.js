// One CLI list of the live Notis APIs (api-hosts.js): every caller derives its
// hosts from it and keeps the results it had when each kept its own copy.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIVE_API_HOSTS,
  LIVE_API_ORIGINS,
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
