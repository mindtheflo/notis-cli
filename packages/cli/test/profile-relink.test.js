import test from 'node:test';
import assert from 'node:assert/strict';

import { relinkSkillsInBackground } from '../src/command-specs/profile.js';

function fakeSpawn() {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const call = { command, args, options, unref: false };
    calls.push(call);
    return {
      on() {},
      unref() {
        call.unref = true;
      },
    };
  };
  return { calls, spawnImpl };
}

function signedIn(apiBase) {
  return { api_base: apiBase, oauth_access_token: 'access', oauth_refresh_token: 'refresh' };
}

function runtime(spawnImpl, env = {}) {
  return { env, argv: ['node', '/opt/notis/bin/notis.js'], execPath: '/usr/local/bin/node', spawnImpl };
}

test('profile use relinks the new default profile skills in a detached sync', () => {
  for (const apiBase of ['https://api.notis.ai', 'https://api-beta.notis.ai/']) {
    const { calls, spawnImpl } = fakeSpawn();
    assert.equal(relinkSkillsInBackground('beta', signedIn(apiBase), runtime(spawnImpl)), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, '/usr/local/bin/node');
    assert.deepEqual(calls[0].args, ['/opt/notis/bin/notis.js', 'skills', 'sync', '--json', '--profile', 'beta']);
    assert.equal(calls[0].options.detached, true);
    assert.equal(calls[0].options.stdio, 'ignore');
    assert.equal(calls[0].unref, true);
  }
});

test('profile use skips the relink off the hosted API, signed out, or under tests', () => {
  const { calls, spawnImpl } = fakeSpawn();
  const hosted = signedIn('https://api.notis.ai');
  assert.equal(relinkSkillsInBackground('local', signedIn('http://127.0.0.1:8000'), runtime(spawnImpl)), false);
  assert.equal(relinkSkillsInBackground('lookalike', signedIn('https://api.notis.ai.example.com'), runtime(spawnImpl)), false);
  assert.equal(relinkSkillsInBackground('default', { api_base: 'https://api.notis.ai' }, runtime(spawnImpl)), false);
  assert.equal(relinkSkillsInBackground('default', hosted, runtime(spawnImpl, { NODE_ENV: 'test' })), false);
  assert.equal(relinkSkillsInBackground('default', hosted, runtime(spawnImpl, { NODE_TEST_CONTEXT: 'child-v8' })), false);
  assert.equal(relinkSkillsInBackground('default', hosted, { ...runtime(spawnImpl), argv: ['node'] }), false);
  assert.equal(calls.length, 0);

  // A spawn that throws leaves the relink to the next automatic sync.
  assert.equal(relinkSkillsInBackground('default', hosted, runtime(() => {
    throw new Error('spawn EAGAIN');
  })), false);
});

test('the relink syncs the named profile with its own credential, endpoint and build', () => {
  const { calls, spawnImpl } = fakeSpawn();
  const env = {
    HOME: '/home/notis',
    PATH: '/usr/bin',
    NOTIS_CLI_CONFIG_FILE: '/home/notis/.notis/config.json',
    NOTIS_DELEGATED_CONTEXT: '1',
    NOTIS_JWT: 'hosted-shell-credential',
    NOTIS_API_BASE: 'http://127.0.0.1:8000',
    NOTIS_PROFILE: 'other',
    NOTIS_CLI_CHANNEL_SWITCHED: '1',
  };
  assert.equal(relinkSkillsInBackground('work', signedIn('https://api.notis.ai'), runtime(spawnImpl, env)), true);
  assert.deepEqual(calls[0].options.env, {
    HOME: '/home/notis',
    PATH: '/usr/bin',
    NOTIS_CLI_CONFIG_FILE: '/home/notis/.notis/config.json',
    NOTIS_DELEGATED_CONTEXT: '1',
  });
  // The switch's own environment is left as it was.
  assert.equal(env.NOTIS_JWT, 'hosted-shell-credential');
});
