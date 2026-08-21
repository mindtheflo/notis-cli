import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
import { resolveRuntimeProfile } from '../src/runtime/profiles.js';

test('CLI launch defers base refresh only to the already-locked skills sync command', () => {
  assert.equal(isSkillsSyncInvocation(['--json', 'skills', 'sync']), true);
  assert.equal(isSkillsSyncInvocation(['skills', 'list']), false);
  assert.equal(isSkillsSyncInvocation(['tools', 'search', 'skills sync']), false);
});

const INSTALLED = '/Users/x/.npm/_npx/abc/node_modules/@notis_ai/cli/src/runtime';
const CHECKOUT = '/Users/x/code/notis/packages/cli/src/runtime';

test('the running build names its own channel from the published version', () => {
  assert.equal(channelFromVersion('0.2.10'), 'stable');
  assert.equal(channelFromVersion('0.2.0-beta.129.1'), 'beta');
  assert.equal(packageTagForChannel('beta'), 'beta');
  assert.equal(packageTagForChannel('stable'), 'latest');
  assert.equal(packageTagForChannel(undefined), 'latest');
  assert.equal(cliCommandForChannel('beta'), 'npx --package @notis_ai/cli@beta -- notis');
});

test('a profile resolves its channel from the pin, then the flag, then the endpoint', () => {
  assert.equal(channelFromProfile({ channel: 'beta', beta: false }), 'beta');
  assert.equal(channelFromProfile({ beta: true }), 'beta');
  assert.equal(channelFromProfile({ beta: false }), 'stable');
  // Profiles authorized before channels existed still resolve, so upgrading
  // does not require every machine to sign in again.
  assert.equal(channelFromProfile({ oauth_api_base: 'https://api-beta.notis.ai' }), 'beta');
  assert.equal(channelFromProfile({ api_base: 'https://api.notis.ai' }), 'stable');
  assert.equal(channelFromProfile({}), null);
  assert.equal(channelFromProfile({ api_base: 'not a url' }), null);
  assert.equal(channelFromProfile({ channel: 'nightly' }), null);
});

test('a beta profile hands its invocation to the beta build', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.10',
    profile: { channel: 'beta' },
    moduleDirectory: INSTALLED,
    env: {},
  });
  assert.equal(decision.switch, true);
  assert.equal(decision.targetChannel, 'beta');
  assert.equal(decision.command, 'npx');
  assert.deepEqual(decision.args, [
    '--yes',
    '--package',
    '@notis_ai/cli@beta',
    '--',
    'notis',
  ]);
});

test('a production profile running the beta build switches back', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.0-beta.129.1',
    profile: { channel: 'stable' },
    moduleDirectory: INSTALLED,
    env: {},
  });
  assert.equal(decision.switch, true);
  assert.deepEqual(decision.args.slice(0, 3), ['--yes', '--package', '@notis_ai/cli@latest']);
});

test('the Windows handoff uses the npm command shim', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.10',
    profile: { channel: 'beta' },
    moduleDirectory: INSTALLED,
    env: {},
    platform: 'win32',
  });
  assert.equal(decision.command, 'npx.cmd');
});

test('nothing switches when the channel already matches or is unknown', () => {
  for (const profile of [{ channel: 'stable' }, {}, { api_base: 'http://localhost:4311' }]) {
    const decision = resolveChannelSwitch({
      runningVersion: '0.2.10',
      profile,
      moduleDirectory: INSTALLED,
      env: {},
    });
    assert.equal(decision.switch, false);
  }
});

test('the switch never runs twice, and can be turned off', () => {
  const beta = { runningVersion: '0.2.10', profile: { channel: 'beta' }, moduleDirectory: INSTALLED };
  assert.equal(
    resolveChannelSwitch({ ...beta, env: { NOTIS_CLI_CHANNEL_SWITCHED: '1' } }).reason,
    'already_switched',
  );
  assert.equal(
    resolveChannelSwitch({ ...beta, env: { NOTIS_CLI_AUTO_CHANNEL: '0' } }).reason,
    'disabled',
  );
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
      // Beta pin, loopback endpoint: `./dev.sh` owns this profile and its CLI.
      profile: { channel: 'beta', api_base: 'http://localhost:4311' },
      moduleDirectory: INSTALLED,
      env: {},
    }).reason,
    'dev_managed_profile',
  );
  assert.equal(
    resolveChannelSwitch({
      runningVersion: '0.2.10',
      profile: { channel: 'beta' },
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
    'beta',
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
      'stable-account': { channel: 'stable' },
      'beta-account': { channel: 'beta' },
    },
  };
  assert.equal(
    channelFromProfile(channelProfileForArgs([], { NOTIS_PROFILE: 'beta-account' }, {
      config,
      worktreeRuntime: null,
    })),
    'beta',
  );
  // NOTIS_JWT replaces credentials only; the current profile still routes.
  assert.equal(
    channelFromProfile(channelProfileForArgs([], { NOTIS_JWT: 'token' }, {
      config: { ...config, current_profile: 'beta-account' },
      worktreeRuntime: null,
    })),
    'beta',
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

test('an explicit API route overrides the stored profile channel in the effective runtime', () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-channel-runtime-')), 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'account',
    profiles: { account: { channel: 'stable', api_base: 'https://api.notis.ai' } },
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
    assert.equal(runtime.channel, 'beta');
  } finally {
    if (previous.config === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previous.config;
    if (previous.disableWorktree === undefined) delete process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING;
    else process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = previous.disableWorktree;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
  }
});

test('the handoff falls back only when the target package cannot boot', () => {
  const decision = resolveChannelSwitch({
    runningVersion: '0.2.10',
    profile: { channel: 'beta' },
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
    profile: { channel: 'beta' },
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
