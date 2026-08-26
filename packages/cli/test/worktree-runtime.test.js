import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const profilesUrl = pathToFileURL(
  resolve(import.meta.dirname, '../src/runtime/profiles.js'),
).href;
const transportUrl = pathToFileURL(
  resolve(import.meta.dirname, '../src/runtime/transport.js'),
).href;
const cliPath = resolve(import.meta.dirname, '../bin/notis.js');

const DEV_PROFILE = 'dev-worktree';

function makeJwt(subject) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: subject })}.signature`;
}

/**
 * Lay out a worktree exactly as ./dev.sh does: a routing policy and a live
 * lease naming its synthetic dev profile, alongside whatever real accounts
 * the developer already has in shared config.
 */
function makeWorktree(prefix, {
  expectedUserId,
  devJwt,
  apiBase = 'http://localhost:4311',
  lease = {},
  otherProfiles = {},
  currentProfile = 'default',
  devPid = process.pid,
}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = mkdtempSync(join(tmpdir(), `${prefix}home-`));
  const context = join(root, '.context');
  const configFile = join(home, '.notis', 'config.json');
  mkdirSync(context, { recursive: true });
  mkdirSync(dirname(configFile), { recursive: true });

  writeFileSync(
    configFile,
    JSON.stringify({
      current_profile: currentProfile,
      profiles: {
        default: {},
        ...otherProfiles,
      },
    }),
  );
  writeFileSync(
    join(context, 'notis-routing.json'),
    JSON.stringify({ version: 1, mode: 'local-only', workspace_root: root }),
  );
  writeFileSync(
    join(context, 'notis-runtime.json'),
    JSON.stringify({
      version: 1,
      mode: 'local-only',
      api_base: apiBase,
      profile: DEV_PROFILE,
      workspace_root: root,
      bridge_instance_id: 'bridge-a',
      dev_pid: devPid,
      expected_user_id: expectedUserId,
      dev_access_token: devJwt,
      dev_access_expires_at: 4_102_444_800,
      ...lease,
    }),
  );

  return { root, home, context, configFile };
}

function runRuntimeProbe(cwd, env = {}, globalOptions = {}) {
  const source = `
    import { resolveRuntimeProfile } from ${JSON.stringify(profilesUrl)};
    try {
      const runtime = resolveRuntimeProfile(${JSON.stringify(globalOptions)}, { requireAuth: true });
      console.log(JSON.stringify({
        apiBase: runtime.apiBase,
        profileName: runtime.profileName,
        profileSource: runtime.profileSource,
        jwt: runtime.jwt,
        credentialSource: runtime.credentialSource,
        bridge: runtime.worktreeRuntime?.bridge_instance_id,
        appDevSessionsFile: runtime.worktreeRuntime?.app_dev_sessions_file,
        desktopDeepLinkScheme: runtime.worktreeRuntime?.desktop_deep_link_scheme,
      }));
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, message: error.message }));
      process.exitCode = error.exitCode || 1;
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: mkdtempSync(join(tmpdir(), 'notis-cli-runtime-home-')),
      ...env,
    },
    encoding: 'utf8',
  });
}

function runRefreshProbe(
  cwd,
  home,
  runtimeFile,
  replacementJwt,
  replacementExpectedUserId = null,
) {
  const source = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { resolveRuntimeProfile } from ${JSON.stringify(profilesUrl)};
    import { httpRequest } from ${JSON.stringify(transportUrl)};
    const runtime = resolveRuntimeProfile({}, { requireAuth: true });
    const runtimeLease = JSON.parse(readFileSync(${JSON.stringify(runtimeFile)}, 'utf-8'));
    runtimeLease.dev_access_token = ${JSON.stringify(replacementJwt)};
    if (${JSON.stringify(replacementExpectedUserId)} !== null) {
      runtimeLease.expected_user_id = ${JSON.stringify(replacementExpectedUserId)};
    }
    writeFileSync(${JSON.stringify(runtimeFile)}, JSON.stringify(runtimeLease));
    try {
      await httpRequest({ runtime, method: 'GET', path: '/health' });
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, message: error.message }));
      process.exitCode = error.exitCode || 1;
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd,
    env: { PATH: process.env.PATH, HOME: home },
    encoding: 'utf8',
  });
}

function runCliProbe(cwd, args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: mkdtempSync(join(tmpdir(), 'notis-cli-probe-home-')),
      ...env,
    },
    encoding: 'utf8',
  });
}

test('CLI selects the active local-only runtime and ignores inherited remote credentials', () => {
  const expectedUserId = '5a41ca1b-0d25-4111-baa3-fcc1a10e3092';
  const { root, home, context } = makeWorktree('notis-worktree-runtime-', {
    expectedUserId,
    devJwt: makeJwt(expectedUserId),
    lease: { desktop_deep_link_scheme: 'notis-dev-bridge-a' },
  });
  const nested = join(root, 'packages', 'feature');
  mkdirSync(nested, { recursive: true });

  const result = runRuntimeProbe(nested, {
    HOME: home,
    NOTIS_API_BASE: 'https://api-beta.notis.ai',
    NOTIS_JWT: 'personal-jwt',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    apiBase: 'http://localhost:4311',
    profileName: DEV_PROFILE,
    profileSource: 'worktree',
    jwt: makeJwt(expectedUserId),
    credentialSource: 'worktree',
    bridge: 'bridge-a',
    desktopDeepLinkScheme: 'notis-dev-bridge-a',
  });
});

test('profile list includes the active lease-backed worktree profile without persisting it', () => {
  const expectedUserId = 'approved-test-user';
  const { root, home, configFile } = makeWorktree('notis-worktree-profile-list-', {
    expectedUserId,
    devJwt: makeJwt(expectedUserId),
    // Simulate a stub left by an older process that normalized unknown dev_*
    // fields away. The live lease must remain the source of truth.
    otherProfiles: { [DEV_PROFILE]: { api_base: 'http://localhost:9999' } },
  });
  const nested = join(root, 'packages', 'cli');
  mkdirSync(nested, { recursive: true });

  const result = runCliProbe(nested, ['profile', 'list', '--json'], { HOME: home });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout).data;
  assert.equal(payload.effective_profile, DEV_PROFILE);
  assert.equal(payload.effective_profile_source, 'worktree');
  const devEntry = payload.profiles.find((entry) => entry.name === DEV_PROFILE);
  assert.deepEqual(devEntry, {
    name: DEV_PROFILE,
    active: false,
    api_base: 'http://localhost:4311',
    label: './dev.sh worktree',
    credential_kind: 'dev',
    user_id: expectedUserId,
    authenticated: true,
    dev_runtime_live: true,
  });
  assert.deepEqual(
    JSON.parse(readFileSync(configFile, 'utf8')).profiles[DEV_PROFILE],
    { api_base: 'http://localhost:9999' },
  );
});

// The synthetic worktree profile and shared account profiles remain visible
// together, so an agent inside the checkout can still reach a real account when
// the task calls for it.
test('naming another profile escapes the worktree pin without disturbing the dev profile', () => {
  const expectedUserId = 'approved-test-user';
  const { root, home, configFile } = makeWorktree('notis-worktree-escape-', {
    expectedUserId,
    devJwt: makeJwt(expectedUserId),
    otherProfiles: {
      personal: {
        api_base: 'https://api.notis.ai',
        oauth_access_token: makeJwt('real-user'),
        oauth_access_expires_at: 4_102_444_800,
        oauth_user_id: 'real-user',
        oauth_api_base: 'https://api.notis.ai',
      },
    },
  });
  const nested = join(root, 'server');
  mkdirSync(nested, { recursive: true });

  const result = runRuntimeProbe(nested, { HOME: home }, { profile: 'personal' });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.apiBase, 'https://api.notis.ai');
  assert.equal(payload.profileName, 'personal');
  assert.equal(payload.profileSource, 'explicit');
  assert.equal(payload.credentialSource, 'oauth');

  const config = JSON.parse(readFileSync(configFile, 'utf-8'));
  assert.equal(config.profiles[DEV_PROFILE], undefined);
});

test('profile use reports the live worktree override and explicit escape command', () => {
  const expectedUserId = 'approved-test-user';
  const { root, home, configFile } = makeWorktree('notis-worktree-profile-use-', {
    expectedUserId,
    devJwt: makeJwt(expectedUserId),
    otherProfiles: {
      personal: {
        api_base: 'https://api.notis.ai',
        oauth_access_token: makeJwt('real-user'),
        oauth_access_expires_at: 4_102_444_800,
        oauth_user_id: 'real-user',
      },
    },
  });
  const nested = join(root, 'packages', 'cli');
  mkdirSync(nested, { recursive: true });

  const result = runCliProbe(
    nested,
    ['profile', 'use', 'personal', '--json'],
    { HOME: home },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.data.active_profile, 'personal');
  assert.equal(payload.data.effective_profile, DEV_PROFILE);
  assert.equal(payload.data.effective_profile_source, 'worktree');
  assert.match(payload.human_summary, /still uses "dev-worktree"/);
  assert.deepEqual(payload.hints[0], {
    command: "notis --profile 'personal' whoami",
    reason: 'Use and confirm this account explicitly inside the active worktree',
  });
  assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).current_profile, 'personal');
});

test('logout rejects the synthetic worktree profile without touching shared config', () => {
  const expectedUserId = 'approved-test-user';
  const { root, home, configFile } = makeWorktree('notis-worktree-logout-', {
    expectedUserId,
    devJwt: makeJwt(expectedUserId),
    otherProfiles: {
      personal: {
        api_base: 'https://api.notis.ai',
        oauth_access_token: makeJwt('real-user'),
        oauth_access_expires_at: 4_102_444_800,
        oauth_user_id: 'real-user',
      },
    },
  });
  const nested = join(root, 'packages', 'cli');
  mkdirSync(nested, { recursive: true });
  const before = readFileSync(configFile, 'utf8');

  const result = runCliProbe(nested, ['logout', '--json'], { HOME: home });

  assert.equal(result.status, 3, result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'oauth_profile_is_dev_managed');
  assert.equal(readFileSync(configFile, 'utf8'), before);
});

test('CLI rejects a dev credential for a different dev user', () => {
  const { root, home } = makeWorktree('notis-worktree-identity-', {
    expectedUserId: 'approved-test-user',
    devJwt: makeJwt('wrong-user'),
  });
  const nested = join(root, 'server');
  mkdirSync(nested, { recursive: true });

  const result = runRuntimeProbe(nested, { HOME: home });

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, 'dev_runtime_identity_mismatch');
  assert.match(payload.message, /test identity/);
});

test('CLI rejects a refreshed dev credential for a different dev user', () => {
  const expectedUserId = 'approved-test-user';
  const { root, home, context } = makeWorktree('notis-worktree-refresh-', {
    expectedUserId,
    devJwt: makeJwt(expectedUserId),
  });
  const nested = join(root, 'packages', 'cli');
  mkdirSync(nested, { recursive: true });

  const result = runRefreshProbe(
    nested,
    home,
    join(context, 'notis-runtime.json'),
    makeJwt('wrong-user'),
  );

  assert.equal(result.status, 3, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, 'dev_runtime_identity_mismatch');
  assert.match(payload.message, /refreshed dev credential/);
});

test('CLI refuses to cross identities when the worktree restarts for another user', () => {
  const expectedUserId = 'approved-test-user';
  const replacementUserId = 'different-test-user';
  const { root, home, context } = makeWorktree('notis-worktree-restart-identity-', {
    expectedUserId,
    devJwt: makeJwt(expectedUserId),
  });
  const nested = join(root, 'packages', 'cli');
  mkdirSync(nested, { recursive: true });

  const result = runRefreshProbe(
    nested,
    home,
    join(context, 'notis-runtime.json'),
    makeJwt(replacementUserId),
    replacementUserId,
  );

  assert.equal(result.status, 3, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, 'dev_runtime_identity_mismatch');
  assert.match(payload.message, /different test user/);
});

test('active worktree JWT expiry overrides stale shared-profile expiry', async () => {
  const { credentialIsExpired } = await import(profilesUrl);
  const { getActiveWorktreeCredentialProfile } = await import(transportUrl);
  const futureExpiry = Math.floor(Date.now() / 1000) + 3_600;
  const runtime = {
    credentialKind: 'worktree',
    jwt: makeJwt('approved-test-user').replace(
      Buffer.from(JSON.stringify({ sub: 'approved-test-user' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'approved-test-user', exp: futureExpiry })).toString('base64url'),
    ),
    worktreeRuntime: {},
  };

  const effectiveProfile = getActiveWorktreeCredentialProfile(runtime, {
    dev_access_expires_at: 1,
  });

  assert.equal(effectiveProfile.dev_access_expires_at, futureExpiry);
  assert.equal(credentialIsExpired(runtime, effectiveProfile), false);
});

test('CLI fails closed when a local-only worktree has no active runtime lease', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-stale-'));
  const nested = join(root, 'server');
  mkdirSync(join(root, '.context'), { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(root, '.context', 'notis-routing.json'),
    JSON.stringify({ version: 1, mode: 'local-only', workspace_root: root }),
  );

  const result = runRuntimeProbe(nested, {
    NOTIS_API_BASE: 'https://api-beta.notis.ai',
    NOTIS_JWT: 'personal-jwt',
  });

  assert.equal(result.status, 4);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, 'dev_runtime_unavailable');
  assert.match(payload.message, /local-only/);
});

test('a stopped worktree lists and saves profiles without claiming they are effective', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-listable-'));
  const home = mkdtempSync(join(tmpdir(), 'notis-worktree-listable-home-'));
  const nested = join(root, 'server');
  mkdirSync(join(root, '.context'), { recursive: true });
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(home, '.notis'), { recursive: true });
  writeFileSync(
    join(root, '.context', 'notis-routing.json'),
    JSON.stringify({ version: 1, mode: 'local-only', workspace_root: root }),
  );
  writeFileSync(
    join(home, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {},
        personal: {
          api_base: 'https://api.notis.ai',
          oauth_access_token: makeJwt('personal-user'),
          oauth_access_expires_at: 4_102_444_800,
          oauth_user_id: 'personal-user',
        },
      },
    }),
  );

  const result = runCliProbe(nested, ['profile', 'list', '--json'], { HOME: home });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data.profiles.map((entry) => entry.name), ['default', 'personal']);
  assert.equal(payload.data.effective_profile, null);
  assert.equal(payload.data.effective_profile_source, 'worktree-unavailable');
  assert.equal(payload.data.effective_credential_kind, null);
  assert.equal(payload.data.worktree_runtime_unavailable, true);
  assert.equal(payload.hints[0].command, 'notis --profile <name> <command>');

  const switched = runCliProbe(nested, ['profile', 'use', 'personal', '--json'], { HOME: home });
  assert.equal(switched.status, 0, switched.stderr);
  const switchedPayload = JSON.parse(switched.stdout);
  assert.equal(switchedPayload.data.effective_profile, null);
  assert.equal(switchedPayload.data.effective_profile_source, 'worktree-unavailable');
  assert.equal(switchedPayload.data.effective_credential_kind, undefined);
  assert.equal(switchedPayload.data.worktree_runtime_unavailable, true);
  assert.equal(switchedPayload.hints[0].command, "notis --profile 'personal' whoami");
  assert.equal(JSON.parse(readFileSync(join(home, '.notis', 'config.json'), 'utf8')).current_profile, 'personal');

  const explicit = runCliProbe(
    nested,
    ['--profile', 'personal', 'profile', 'list', '--json'],
    { HOME: home },
  );
  assert.equal(explicit.status, 0, explicit.stderr);
  const explicitPayload = JSON.parse(explicit.stdout);
  assert.equal(explicitPayload.data.effective_profile, 'personal');
  assert.equal(explicitPayload.data.effective_profile_source, 'explicit');
  assert.equal(explicitPayload.data.worktree_runtime_unavailable, false);

  const doctor = runCliProbe(
    nested,
    [
      '--profile', 'personal',
      '--api-base', 'http://127.0.0.1:9',
      '--timeout-ms', '20',
      'doctor',
      '--json',
    ],
    { HOME: home },
  );
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorPayload = JSON.parse(doctor.stdout);
  assert.equal(doctorPayload.data.profile, 'personal');
  assert.equal(doctorPayload.data.profile_source, 'explicit');
  assert.equal(doctorPayload.data.checks.routing, 'detached');
  assert.ok(doctorPayload.hints.some(
    (hint) => /bypasses this stopped worktree/.test(hint.message || ''),
  ));
});

test('a stopped local-only worktree blocks unauthenticated network commands', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-doctor-stopped-'));
  const home = mkdtempSync(join(tmpdir(), 'notis-worktree-doctor-home-'));
  const nested = join(root, 'packages', 'cli');
  mkdirSync(join(root, '.context'), { recursive: true });
  mkdirSync(join(home, '.notis'), { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(root, '.context', 'notis-routing.json'),
    JSON.stringify({ version: 1, mode: 'local-only', workspace_root: root }),
  );
  writeFileSync(
    join(home, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          api_base: 'http://127.0.0.1:1',
          oauth_access_token: makeJwt('real-user'),
          oauth_access_expires_at: 4_102_444_800,
          oauth_user_id: 'real-user',
        },
      },
    }),
  );

  const result = runCliProbe(nested, ['doctor', '--json'], { HOME: home });

  assert.equal(result.status, 4, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'dev_runtime_unavailable');
  assert.doesNotMatch(payload.error.message, /connect|fetch/i);
});

test('a stopped local-only worktree blocks live app harness modes', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-live-harness-stopped-'));
  const home = mkdtempSync(join(tmpdir(), 'notis-worktree-live-harness-home-'));
  mkdirSync(join(root, '.context'), { recursive: true });
  mkdirSync(join(home, '.notis'), { recursive: true });
  writeFileSync(
    join(root, '.context', 'notis-routing.json'),
    JSON.stringify({ version: 1, mode: 'local-only', workspace_root: root }),
  );
  writeFileSync(
    join(home, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          api_base: 'https://api.notis.ai',
          oauth_access_token: makeJwt('real-user'),
          oauth_access_expires_at: 4_102_444_800,
          oauth_user_id: 'real-user',
        },
      },
    }),
  );

  for (const command of ['verify', 'screenshot']) {
    const result = runCliProbe(root, ['apps', command, '.', '--mode', 'live', '--skip-build', '--json'], {
      HOME: home,
    });
    assert.equal(result.status, 4, result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, 'dev_runtime_unavailable');
  }

  const stub = runCliProbe(root, ['apps', 'verify', '.', '--mode', 'stub', '--skip-build', '--json'], {
    HOME: home,
  });
  assert.equal(stub.status, 2, stub.stderr);
  assert.equal(JSON.parse(stub.stdout).error.code, 'usage_error');
});

test('CLI renders a structured error when a local-only runtime is stopped', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-stopped-'));
  const nested = join(root, 'packages', 'cli');
  mkdirSync(join(root, '.context'), { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(root, '.context', 'notis-routing.json'),
    JSON.stringify({ version: 1, mode: 'local-only', workspace_root: root }),
  );

  const result = runCliProbe(nested, ['tools', 'toolkits', '--json'], {
    NOTIS_API_BASE: 'https://api-beta.notis.ai',
    NOTIS_JWT: 'personal-jwt',
  });

  assert.equal(result.status, 4, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.command, 'tools toolkits');
  assert.equal(payload.error.code, 'dev_runtime_unavailable');
  assert.equal(result.stderr, '');

  const tableResult = runCliProbe(nested, ['tools', 'toolkits', '--output', 'table']);
  assert.equal(tableResult.status, 4);
  assert.match(tableResult.stderr, /Start \.\/dev\.sh in this worktree/);
  assert.doesNotMatch(tableResult.stderr, /undefined/);
});
