import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

function makeJwt(subject) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: subject })}.signature`;
}

function runRuntimeProbe(cwd, env = {}) {
  const source = `
    import { resolveRuntimeProfile } from ${JSON.stringify(profilesUrl)};
    try {
      const runtime = resolveRuntimeProfile({}, { requireAuth: true });
      console.log(JSON.stringify({
        apiBase: runtime.apiBase,
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

function runRefreshProbe(cwd, configFile, replacementJwt) {
  const source = `
    import { writeFileSync } from 'node:fs';
    import { resolveRuntimeProfile } from ${JSON.stringify(profilesUrl)};
    import { httpRequest } from ${JSON.stringify(transportUrl)};
    const runtime = resolveRuntimeProfile({}, { requireAuth: true });
    writeFileSync(
      ${JSON.stringify(configFile)},
      JSON.stringify({
        current_profile: 'default',
        profiles: {
          default: {
            jwt: ${JSON.stringify(replacementJwt)},
            api_base: runtime.apiBase,
          },
        },
      }),
    );
    try {
      await httpRequest({ runtime, method: 'GET', path: '/health' });
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, message: error.message }));
      process.exitCode = error.exitCode || 1;
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: mkdtempSync(join(tmpdir(), 'notis-cli-refresh-home-')),
    },
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
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-runtime-'));
  const nested = join(root, 'packages', 'feature');
  const context = join(root, '.context');
  const configFile = join(context, 'notis-cli-config.json');
  mkdirSync(nested, { recursive: true });
  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(
    configFile,
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          jwt: makeJwt(expectedUserId),
          api_base: 'http://localhost:4311',
        },
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
      api_base: 'http://localhost:4311',
      config_file: configFile,
      bridge_instance_id: 'bridge-a',
      app_dev_sessions_file: join(context, 'sessions-for-bridge-a.json'),
      desktop_deep_link_scheme: 'notis-dev-bridge-a',
      dev_pid: process.pid,
      expected_user_id: expectedUserId,
    }),
  );

  const result = runRuntimeProbe(nested, {
    NOTIS_API_BASE: 'https://api-beta.notis.ai',
    NOTIS_JWT: 'personal-jwt',
    NOTIS_CLI_CONFIG_FILE: join(root, 'other-worktree-config.json'),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    apiBase: 'http://localhost:4311',
    jwt: makeJwt(expectedUserId),
    credentialSource: 'worktree',
    bridge: 'bridge-a',
    appDevSessionsFile: join(context, 'sessions-for-bridge-a.json'),
    desktopDeepLinkScheme: 'notis-dev-bridge-a',
  });
});

test('CLI rejects a scoped credential for a different dev user', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-identity-'));
  const nested = join(root, 'server');
  const context = join(root, '.context');
  const configFile = join(context, 'notis-cli-config.json');
  mkdirSync(nested, { recursive: true });
  mkdirSync(context, { recursive: true });
  writeFileSync(
    configFile,
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          jwt: makeJwt('wrong-user'),
          api_base: 'http://localhost:4311',
        },
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
      api_base: 'http://localhost:4311',
      config_file: configFile,
      bridge_instance_id: 'bridge-a',
      dev_pid: process.pid,
      expected_user_id: 'approved-test-user',
    }),
  );

  const result = runRuntimeProbe(nested);

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, 'dev_runtime_identity_mismatch');
  assert.match(payload.message, /does not belong/);
});

test('CLI rejects a refreshed scoped credential for a different dev user', () => {
  const expectedUserId = 'approved-test-user';
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-refresh-'));
  const nested = join(root, 'packages', 'cli');
  const context = join(root, '.context');
  const configFile = join(context, 'notis-cli-config.json');
  mkdirSync(nested, { recursive: true });
  mkdirSync(context, { recursive: true });
  writeFileSync(
    configFile,
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          jwt: makeJwt(expectedUserId),
          api_base: 'http://localhost:4311',
        },
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
      api_base: 'http://localhost:4311',
      config_file: configFile,
      bridge_instance_id: 'bridge-a',
      dev_pid: process.pid,
      expected_user_id: expectedUserId,
    }),
  );

  const result = runRefreshProbe(nested, configFile, makeJwt('wrong-user'));

  assert.equal(result.status, 3, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, 'dev_runtime_identity_mismatch');
  assert.match(payload.message, /refreshed scoped dev credential/);
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

test('CLI renders a structured error when a local-only runtime is stopped', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-worktree-stopped-'));
  const nested = join(root, 'packages', 'cli');
  mkdirSync(join(root, '.context'), { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(root, '.context', 'notis-routing.json'),
    JSON.stringify({ version: 1, mode: 'local-only', workspace_root: root }),
  );

  const result = runCliProbe(nested, ['doctor', '--json'], {
    NOTIS_API_BASE: 'https://api-beta.notis.ai',
    NOTIS_JWT: 'personal-jwt',
  });

  assert.equal(result.status, 4, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.command, 'doctor');
  assert.equal(payload.error.code, 'dev_runtime_unavailable');
  assert.equal(result.stderr, '');

  const tableResult = runCliProbe(nested, ['doctor', '--output', 'table']);
  assert.equal(tableResult.status, 4);
  assert.match(tableResult.stderr, /Start \.\/dev\.sh in this worktree/);
  assert.doesNotMatch(tableResult.stderr, /undefined/);
});
