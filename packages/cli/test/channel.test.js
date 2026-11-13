import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isSkillsSyncInvocation,
  channelProfileForArgs,
  executeChannelSwitch,
  readChannelRelevantFlags,
} from '../src/cli.js';
import {
  channelFromProfile,
  channelFromVersion,
  cliCommandForChannel,
  isDevManagedProfile,
  isInstalledPackage,
  packageTagForChannel,
  resolveChannelSwitch,
} from '../src/runtime/channel.js';
import { listProfiles, resolveRuntimeProfile } from '../src/runtime/profiles.js';

test('CLI launch defers base refresh only to the already-locked skills sync command', () => {
  assert.equal(isSkillsSyncInvocation(['--json', 'skills', 'sync']), true);
  assert.equal(isSkillsSyncInvocation(['skills', 'list']), false);
  assert.equal(isSkillsSyncInvocation(['tools', 'search', 'skills sync']), false);
});

const INSTALLED = '/Users/x/.npm/_npx/abc/node_modules/@notis_ai/cli/src/runtime';
const CHECKOUT = '/Users/x/code/notis/packages/cli/src/runtime';

test('the running build names its own channel from the published version', () => {
  assert.equal(channelFromVersion('0.2.10'), 'stable');
  assert.equal(channelFromVersion('0.2.0-nightly.129.1'), 'nightly');
  // Builds published before the rename still know they are not stable.
  assert.equal(channelFromVersion('0.2.0-beta.129.1'), 'nightly');
  assert.equal(packageTagForChannel('nightly'), 'nightly');
  assert.equal(packageTagForChannel('stable'), 'latest');
  assert.equal(packageTagForChannel(undefined), 'latest');
  // The retired beta tag is never chosen again.
  assert.equal(packageTagForChannel('beta'), 'latest');
  assert.equal(cliCommandForChannel('nightly'), 'npx --package @notis_ai/cli@nightly -- notis');
});

test('the installer\'s launcher replaces the npx command, but only a launcher that exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notis launcher-'));
  const launcher = join(dir, 'notis');
  writeFileSync(launcher, '#!/bin/sh\n');
  // A path with a space is quoted so the printed command still runs.
  assert.equal(cliCommandForChannel('nightly', { NOTIS_CLI_LAUNCHER: launcher }), `'${launcher}'`);
  assert.equal(cliCommandForChannel('stable', { NOTIS_CLI_LAUNCHER: join(dir, 'missing') }),
    'npx --package @notis_ai/cli@latest -- notis');
  assert.equal(cliCommandForChannel('stable', { NOTIS_CLI_LAUNCHER: 'notis' }), 'npx --package @notis_ai/cli@latest -- notis');
});

test('a profile resolves its channel from the pin, then the endpoint', () => {
  assert.equal(channelFromProfile({ release_channel: 'nightly' }), 'nightly');
  assert.equal(channelFromProfile({ release_channel: 'stable', api_base: 'https://api-beta.notis.ai' }), 'stable');
  // Profiles written by older CLIs and Notis Desktop read as the new channels.
  assert.equal(channelFromProfile({ channel: 'beta' }), 'nightly');
  assert.equal(channelFromProfile({ beta: true }), 'nightly');
  assert.equal(channelFromProfile({ beta: false }), 'stable');
  // Desktop sets `beta` from the API it just authorized, after any pin.
  assert.equal(channelFromProfile({ release_channel: 'nightly', beta: false }), 'stable');
  assert.equal(channelFromProfile({ channel: 'beta', beta: false }), 'stable');
  // Profiles authorized before channels existed still resolve, so upgrading
  // does not require every machine to sign in again.
  assert.equal(channelFromProfile({ oauth_api_base: 'https://api-beta.notis.ai' }), 'nightly');
  assert.equal(channelFromProfile({ api_base: 'https://api-nightly.notis.ai' }), 'nightly');
  assert.equal(channelFromProfile({ api_base: 'https://api.notis.ai' }), 'stable');
  assert.equal(channelFromProfile({}), null);
  assert.equal(channelFromProfile({ api_base: 'not a url' }), null);
  assert.equal(channelFromProfile({ release_channel: 'canary' }), null);
});

test('a nightly profile hands its invocation to the nightly build', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.10',
    profile: { release_channel: 'nightly' },
    moduleDirectory: INSTALLED,
    env: {},
  });
  assert.equal(decision.switch, true);
  assert.equal(decision.targetChannel, 'nightly');
  assert.equal(decision.command, 'npx');
  assert.deepEqual(decision.args, [
    '--yes',
    '--package',
    '@notis_ai/cli@nightly',
    '--',
    'notis',
  ]);
});

test('a stable profile running a nightly or old beta build switches back', () => {
  for (const runningVersion of ['0.2.0-nightly.129.1', '0.2.0-beta.129.1']) {
    const decision = resolveChannelSwitch({
      runningVersion,
      profile: { release_channel: 'stable' },
      moduleDirectory: INSTALLED,
      env: {},
    });
    assert.equal(decision.switch, true);
    assert.deepEqual(decision.args.slice(0, 3), ['--yes', '--package', '@notis_ai/cli@latest']);
  }
});

test('the Windows handoff uses the npm command shim', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.10',
    profile: { release_channel: 'nightly' },
    moduleDirectory: INSTALLED,
    env: {},
    platform: 'win32',
  });
  assert.equal(decision.command, 'npx.cmd');
});

test('nothing switches when the channel already matches or is unknown', () => {
  for (const profile of [{ release_channel: 'stable' }, {}, { api_base: 'http://localhost:4311' }]) {
    const decision = resolveChannelSwitch({
      runningVersion: '0.2.10',
      profile,
      moduleDirectory: INSTALLED,
      env: {},
    });
    assert.equal(decision.switch, false);
  }
  assert.equal(resolveChannelSwitch({
    runningVersion: '0.2.0-nightly.1.1',
    profile: { channel: 'beta' },
    moduleDirectory: INSTALLED,
    env: {},
  }).reason, 'channel_matches');
});

test('the switch never runs twice, and can be turned off', () => {
  const nightly = { runningVersion: '0.2.10', profile: { release_channel: 'nightly' }, moduleDirectory: INSTALLED };
  assert.equal(
    resolveChannelSwitch({ ...nightly, env: { NOTIS_CLI_CHANNEL_SWITCHED: '2' } }).reason,
    'already_switched',
  );
  // A pre-nightly build handed over on its own reading of the profile (`1`),
  // for example into the retired beta tag; this build corrects it once.
  assert.equal(
    resolveChannelSwitch({ ...nightly, env: { NOTIS_CLI_CHANNEL_SWITCHED: '1' } }).reason,
    'channel_mismatch',
  );
  assert.equal(
    resolveChannelSwitch({ ...nightly, env: { NOTIS_CLI_AUTO_CHANNEL: '0' } }).reason,
    'disabled',
  );
});

test('the handoff marks its child so the child never switches again', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.10',
    profile: { release_channel: 'nightly' },
    moduleDirectory: INSTALLED,
    env: {},
  });
  const envs = [];
  executeChannelSwitch(decision, ['whoami'], { NOTIS_CLI_CHANNEL_SWITCHED: '1' }, {
    spawn: (_command, _args, options) => {
      envs.push(options.env.NOTIS_CLI_CHANNEL_SWITCHED);
      return { status: 0, signal: null, error: null };
    },
  });
  assert.deepEqual(envs, ['2', '2']);
});

test('a dev.sh profile and a source checkout are never re-executed', () => {
  assert.equal(isDevManagedProfile({ api_base: 'http://localhost:4311' }), true);
  assert.equal(isDevManagedProfile({ dev_access_token: 'x' }), true);
  assert.equal(isDevManagedProfile({ api_base: 'https://api.notis.ai' }), false);
  assert.equal(isInstalledPackage(INSTALLED), true);
  assert.equal(isInstalledPackage(CHECKOUT), false);

  assert.equal(
    resolveChannelSwitch({
      runningVersion: '0.2.10',
      // Nightly pin, loopback endpoint: `./dev.sh` owns this profile and its CLI.
      profile: { release_channel: 'nightly', api_base: 'http://localhost:4311' },
      moduleDirectory: INSTALLED,
      env: {},
    }).reason,
    'dev_managed_profile',
  );
  assert.equal(
    resolveChannelSwitch({
      runningVersion: '0.2.10',
      profile: { release_channel: 'nightly' },
      moduleDirectory: CHECKOUT,
      env: {},
    }).reason,
    'source_checkout',
  );
});

test('the pre-parse reads only the flags that decide the build', () => {
  assert.deepEqual(
    readChannelRelevantFlags(['tools', 'exec', '--profile', 'work', '--json']),
    { profile: 'work' },
  );
  assert.deepEqual(
    readChannelRelevantFlags(['--api-base=https://api-beta.notis.ai', 'whoami']),
    { apiBase: 'https://api-beta.notis.ai' },
  );
  assert.deepEqual(readChannelRelevantFlags(['whoami']), {});
});

test('an explicit endpoint decides the build for that one run', () => {
  assert.equal(
    channelFromProfile(channelProfileForArgs(['--api-base', 'https://api-beta.notis.ai'], {})),
    'nightly',
  );
  assert.equal(
    channelFromProfile(channelProfileForArgs([], { NOTIS_API_BASE: 'https://api.notis.ai' })),
    'stable',
  );
});

test('environment profiles, JWT credentials, and worktree routing preserve the effective channel', () => {
  const config = {
    current_profile: 'stable-account',
    profiles: {
      'stable-account': { release_channel: 'stable' },
      // Written by a CLI from before the nightly rename.
      'beta-account': { channel: 'beta', oauth_access_token: 'grant', oauth_access_expires_at: 4102444800 },
      'signed-out-beta': { channel: 'beta' },
    },
  };
  assert.equal(
    channelFromProfile(channelProfileForArgs([], { NOTIS_PROFILE: 'beta-account' }, {
      config,
      worktreeRuntime: null,
    })),
    'nightly',
  );
  // NOTIS_JWT replaces credentials only; the current profile still routes.
  assert.equal(
    channelFromProfile(channelProfileForArgs([], { NOTIS_JWT: 'token' }, {
      config: { ...config, current_profile: 'beta-account' },
      worktreeRuntime: null,
    })),
    'nightly',
  );
  // Even a profile with no credential keeps routing the NOTIS_JWT it is given.
  assert.equal(
    channelFromProfile(channelProfileForArgs([], { NOTIS_JWT: 'token' }, {
      config: { ...config, current_profile: 'signed-out-beta' },
      worktreeRuntime: null,
    })),
    'nightly',
  );
  assert.equal(
    channelProfileForArgs([], {}, {
      config,
      worktreeRuntime: {
        profile: 'dev-worktree',
        api_base: 'http://127.0.0.1:4311',
        dev_access_token: 'dev-token',
      },
    }).profile,
    'dev-worktree',
  );
  assert.deepEqual(
    channelProfileForArgs([], {}, {
      config,
      worktreeRuntime: { unavailable: new Error('stopped') },
    }),
    {},
  );
});

test('a signed-out profile runs the stable build whatever channel it was pinned to', () => {
  // A logout or a Desktop sign-out keeps the pin and the address of the
  // account that used to be there; the next login follows the account instead.
  const config = {
    current_profile: 'signed-out',
    profiles: {
      'signed-out': { beta: true, release_channel: 'nightly', api_base: 'https://api-beta.notis.ai' },
      custom: { api_base: 'https://notis.example.test', release_channel: 'nightly' },
      'refresh-only': { api_base: 'https://api-nightly.notis.ai', release_channel: 'nightly', oauth_refresh_token: 'refresh' },
    },
  };
  const current = channelProfileForArgs([], {}, { config, worktreeRuntime: null });
  assert.equal(channelFromProfile(current), null);
  assert.equal(resolveChannelSwitch({ runningVersion: '0.2.28', profile: current }).switch, false);
  // A refresh token alone is still a sign-in (Desktop reads it so too).
  assert.equal(
    channelFromProfile(channelProfileForArgs([], { NOTIS_PROFILE: 'refresh-only' }, { config, worktreeRuntime: null })),
    'nightly',
  );
  // `notis profile list` shows the route commands take.
  assert.equal(listProfiles(config).find((entry) => entry.name === 'signed-out').api_base, 'https://api.notis.ai');
  // A custom endpoint was chosen on purpose, so its pin stays.
  assert.equal(
    channelFromProfile(channelProfileForArgs([], { NOTIS_PROFILE: 'custom' }, { config, worktreeRuntime: null })),
    'nightly',
  );
});

test('an explicit API route overrides the stored profile channel in the effective runtime', () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-channel-runtime-')), 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'account',
    profiles: { account: { release_channel: 'stable', api_base: 'https://api.notis.ai' } },
  }));
  const previous = {
    config: process.env.NOTIS_CLI_CONFIG_FILE,
    disableWorktree: process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = '1';
  process.env.NODE_ENV = 'test';
  try {
    const runtime = resolveRuntimeProfile(
      { apiBase: 'https://api-beta.notis.ai' },
      { requireAuth: false },
    );
    assert.equal(runtime.channel, 'nightly');
  } finally {
    if (previous.config === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previous.config;
    if (previous.disableWorktree === undefined) delete process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING;
    else process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = previous.disableWorktree;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
  }
});

test('the login of a signed-out profile starts on the stable API, a signed-in one keeps its channel', () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-channel-signed-out-')), 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      // What a logout leaves of an account that was on the nightly channel.
      default: { api_base: 'https://api-nightly.notis.ai', release_channel: 'nightly', beta: true },
      nightly: {
        api_base: 'https://api-nightly.notis.ai',
        release_channel: 'nightly',
        oauth_api_base: 'https://api-nightly.notis.ai',
        oauth_access_token: 'grant',
        oauth_access_expires_at: 4102444800,
      },
    },
  }));
  const previous = {
    config: process.env.NOTIS_CLI_CONFIG_FILE,
    disableWorktree: process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING,
    nodeEnv: process.env.NODE_ENV,
    apiBase: process.env.NOTIS_API_BASE,
    jwt: process.env.NOTIS_JWT,
  };
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = '1';
  process.env.NODE_ENV = 'test';
  delete process.env.NOTIS_API_BASE;
  delete process.env.NOTIS_JWT;
  try {
    const signedOut = resolveRuntimeProfile({}, { requireAuth: false });
    assert.equal(signedOut.apiBase, 'https://api.notis.ai');
    assert.equal(signedOut.channel, 'stable');
    const signedIn = resolveRuntimeProfile({ profile: 'nightly' }, { requireAuth: false });
    assert.equal(signedIn.apiBase, 'https://api-nightly.notis.ai');
    assert.equal(signedIn.channel, 'nightly');
  } finally {
    for (const [key, name] of [['config', 'NOTIS_CLI_CONFIG_FILE'], ['disableWorktree', 'NOTIS_TEST_DISABLE_WORKTREE_ROUTING'],
      ['nodeEnv', 'NODE_ENV'], ['apiBase', 'NOTIS_API_BASE'], ['jwt', 'NOTIS_JWT']]) {
      if (previous[key] === undefined) delete process.env[name];
      else process.env[name] = previous[key];
    }
  }
});

// CLI-035: a grant whose server-sent refresh expiry passed routes like a
// signed-out profile; a guessed or unknown expiry keeps the route.
test('a grant the server proved dead signs in on stable, one with an unknown expiry keeps its channel', () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-channel-dead-grant-')), 'config.json');
  const beta = {
    api_base: 'https://api-nightly.notis.ai',
    beta: true,
    oauth_api_base: 'https://api-nightly.notis.ai',
    oauth_access_token: 'grant',
    oauth_refresh_token: 'refresh',
    oauth_access_expires_at: 1,
    oauth_refresh_expires_at: 2,
  };
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: { ...beta, oauth_refresh_expiry_from_server: true },
      guessed: beta,
      unknown: { ...beta, oauth_refresh_expires_at: undefined, oauth_refresh_expiry_from_server: true },
      renewable: { ...beta, oauth_refresh_expires_at: 4102444800, oauth_refresh_expiry_from_server: true },
      // The access token still works, whatever the refresh expiry says.
      working: { ...beta, oauth_access_expires_at: 4102444800, oauth_refresh_expiry_from_server: true },
    },
  }));
  const previous = {
    NOTIS_CLI_CONFIG_FILE: process.env.NOTIS_CLI_CONFIG_FILE,
    NOTIS_TEST_DISABLE_WORKTREE_ROUTING: process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING,
    NODE_ENV: process.env.NODE_ENV,
    NOTIS_API_BASE: process.env.NOTIS_API_BASE,
    NOTIS_JWT: process.env.NOTIS_JWT,
  };
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = '1';
  process.env.NODE_ENV = 'test';
  delete process.env.NOTIS_API_BASE;
  delete process.env.NOTIS_JWT;
  try {
    const dead = resolveRuntimeProfile({}, { requireAuth: true });
    assert.equal(dead.apiBase, 'https://api.notis.ai');
    assert.equal(dead.channel, 'stable');
    assert.equal(dead.credentialKind, 'oauth');
    assert.equal(dead.oauthApiBase, 'https://api-nightly.notis.ai');
    assert.equal(channelProfileForArgs(['login'], {}, { worktreeRuntime: null }).release_channel, undefined);
    for (const name of ['guessed', 'unknown', 'renewable', 'working']) {
      const kept = resolveRuntimeProfile({ profile: name }, { requireAuth: true });
      assert.equal(kept.apiBase, 'https://api-nightly.notis.ai', name);
      assert.equal(kept.channel, 'nightly', name);
      assert.equal(channelProfileForArgs(['--profile', name, 'login'], {}, { worktreeRuntime: null }).release_channel, 'nightly', name);
    }
    const listed = Object.fromEntries(listProfiles(JSON.parse(readFileSync(configFile, 'utf-8')))
      .map(({ name, api_base: apiBase }) => [name, apiBase]));
    assert.deepEqual(listed, {
      default: 'https://api.notis.ai',
      guessed: 'https://api-nightly.notis.ai',
      unknown: 'https://api-nightly.notis.ai',
      renewable: 'https://api-nightly.notis.ai',
      working: 'https://api-nightly.notis.ai',
    });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('the handoff falls back only when the target package cannot boot', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.10',
    profile: { release_channel: 'nightly' },
    moduleDirectory: INSTALLED,
    env: {},
  });
  const calls = [];
  const unavailable = executeChannelSwitch(decision, ['tools', 'search'], {}, {
    spawn: (...args) => {
      calls.push(args);
      return { status: 1, signal: null, error: null };
    },
  });
  assert.equal(unavailable.switch, false);
  assert.equal(unavailable.reason, 'switch_unavailable');
  assert.equal(calls.length, 1);
});

test('the handoff propagates command failures and interrupts without local replay', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.10',
    profile: { release_channel: 'nightly' },
    moduleDirectory: INSTALLED,
    env: {},
  });
  for (const [actual, exitCode, reason] of [
    [{ status: 7, signal: null, error: null }, 7, 'channel_mismatch'],
    [{ status: null, signal: 'SIGINT', error: null }, 130, 'switch_interrupted'],
  ]) {
    let count = 0;
    const result = executeChannelSwitch(decision, ['tools', 'exec'], {}, {
      spawn: () => {
        count += 1;
        return count === 1
          ? { status: 0, signal: null, error: null }
          : actual;
      },
    });
    assert.equal(result.switch, true);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.reason, reason);
    assert.equal(count, 2);
  }
});
