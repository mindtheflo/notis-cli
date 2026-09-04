import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { promisify } from 'node:util';

import {
  appLinkedStateProfileKey,
  buildArtifact,
  collectSourceFiles,
  detectProjectWarnings,
  generateManifest,
  inspectListingReadiness,
  normalizeAppCapabilities,
  normalizeAppToolBindings,
  pullAppSource,
  readLinkedState,
  scaffoldProject,
  writeLinkedState,
} from '../src/runtime/app-platform.js';
import {
  acquireScaffoldSource,
  filterScaffoldCatalog,
  loadScaffoldCatalog,
  resolveScaffoldTargetPath,
} from '../src/runtime/app-registry-scaffolds.js';
import {
  doctorChannelSummary,
  DOCTOR_TOOL_ROUNDTRIP_TIMEOUT_MS,
  doctorToolRoundtripRuntime,
} from '../src/command-specs/meta.js';
import { startAppDevServer } from '../src/runtime/app-dev-server.js';
import {
  APP_DEPLOY_TIMEOUT_MS,
  appRowFieldsFromManifest,
  assertDirectDeployAccess,
  buildDevelopmentAppHref,
  doctorLinkSummary,
  ensureDevInstall,
  pruneStaleScreenshotFiles,
  screenshotExitCode,
  screenshotIndexByRouteSlug,
  shouldPruneStaleScreenshotFiles,
} from '../src/command-specs/apps.js';
import {
  heartbeatAppDevSession,
  linkAppDevSessionTarget,
  readAppDevSessions,
  removeAppDevSession,
  upsertAppDevSessions,
} from '../src/runtime/app-dev-sessions.js';
import { getApiBase, normalizeConfig, parseDebugEntitlementOverride } from '../src/runtime/profiles.js';
import { COMMAND_SPECS } from '../src/command-specs/index.js';
import { validateArguments } from '../src/command-specs/helpers.js';
import { classifyToolMutation } from '../src/command-specs/tools.js';
import {
  buildUserContextSql,
  extractSqlRows,
  traceFileDiagnostics,
} from '../src/command-specs/diagnostics.js';

const cliRoot = resolve(import.meta.dirname, '..');
const binPath = join(cliRoot, 'bin', 'notis.js');
const docsScript = join(cliRoot, 'scripts', 'generate-docs.js');
const execFileAsync = promisify(execFile);

test('doctor reports a live worktree as the dev channel', () => {
  const summary = doctorChannelSummary({
    cliVersion: '0.2.0',
    channel: null,
    apiBase: 'http://localhost:4311',
    worktreeRuntime: { profile: 'dev-worktree' },
  });
  assert.equal(summary.releaseChannel, 'dev');
  assert.equal(summary.status, 'dev');
  assert.equal(summary.mismatch, false);
});

function runCli(args, env = {}) {
  return spawnSync('node', [binPath, ...args], {
    cwd: cliRoot,
    env: {
      PATH: process.env.PATH,
      HOME: mkdtempSync(join(tmpdir(), 'notis-cli-home-')),
      NODE_ENV: 'test',
      NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
      ...env,
    },
    encoding: 'utf-8',
  });
}

test('unauthenticated skills sync still repairs auth-independent base skills', () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-base-preflight-'));
  const result = runCli(['--json', 'skills', 'sync'], { HOME: home });
  assert.notEqual(result.status, 0);
  for (const agent of ['.codex', '.claude']) {
    assert.equal(existsSync(join(home, agent, 'skills', 'notis-cli')), true);
  }
});

async function runCliAsync(args, env = {}) {
  const options = {
    cwd: cliRoot,
    env: {
      PATH: process.env.PATH,
      HOME: mkdtempSync(join(tmpdir(), 'notis-cli-home-')),
      NODE_ENV: 'test',
      NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
      ...env,
    },
    encoding: 'utf-8',
  };

  try {
    const result = await execFileAsync('node', [binPath, ...args], options);
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

async function runCliWithInputAsync(args, input, env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [binPath, ...args], {
      cwd: cliRoot,
      env: {
        PATH: process.env.PATH,
        HOME: mkdtempSync(join(tmpdir(), 'notis-cli-home-')),
        NODE_ENV: 'test',
        NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('close', (status) => resolvePromise({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function getAvailablePort() {
  const server = createHttpServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });
  const { port } = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    }
  }
}

function tarEntry(name, content, typeFlag = '0') {
  const data = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf-8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(32, 148, 156);
  header.write(typeFlag, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  const padding = Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length);
  return Buffer.concat([header, data, padding]);
}

function makeTarGz(files) {
  const entries = Object.entries(files).map(([name, content]) => tarEntry(name, content));
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

function makePaxTarGz(name, content) {
  const body = `path=${name}\n`;
  let recordLength = Buffer.byteLength(body, 'utf-8') + 3;
  while (true) {
    const record = `${recordLength} ${body}`;
    const actualLength = Buffer.byteLength(record, 'utf-8');
    if (actualLength === recordLength) {
      return gzipSync(Buffer.concat([
        tarEntry('././@PaxHeader', record, 'x'),
        tarEntry(name.slice(-100), content),
        Buffer.alloc(1024),
      ]));
    }
    recordLength = actualLength;
  }
}

function makeJwt(sub = 'auth-user-123', exp = 4102444800) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub, exp })}.sig`;
}

function makeStoreScreenshotPngHeader() {
  const buffer = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(2000, 16);
  buffer.writeUInt32BE(1250, 20);
  return buffer;
}

test('normalizeConfig migrates the legacy flat config shape', () => {
  const normalized = normalizeConfig({
    oauth_access_token: 'legacy-token',
    api_base: 'https://legacy.example.com',
  });

  assert.equal(normalized.current_profile, 'default');
  assert.equal(normalized.profiles.default.oauth_access_token, 'legacy-token');
  assert.equal(normalized.profiles.default.api_base, 'https://legacy.example.com');
});

// Every key Notis Desktop used to own is dropped on read. Leaving them
// readable would let an upgraded machine keep authenticating with a Supabase
// token nothing renews, instead of being told to run `notis login`.
test('normalizeConfig drops the credential and liveness keys Notis Desktop wrote', () => {
  const normalized = normalizeConfig({
    current_profile: 'default',
    profiles: {
      default: {
        jwt: 'access-token',
        api_base: 'http://localhost:3001',
        auth_mode: 'dev_portal',
        refresh_token: 'refresh-token',
        access_expires_at: 123,
        refresh_expires_at: 456,
        desktop_app_name: 'Notis Beta',
        desktop_pid: 4242,
      },
    },
  });

  const profile = normalized.profiles.default;
  for (const key of [
    'jwt',
    'auth_mode',
    'refresh_token',
    'access_expires_at',
    'refresh_expires_at',
    'desktop_app_name',
    'desktop_pid',
  ]) {
    assert.equal(profile[key], undefined, key);
  }
  assert.equal(profile.api_base, 'http://localhost:3001');
});

test('normalizeConfig keeps the dev.sh credential a worktree profile is built on', () => {
  const normalized = normalizeConfig({
    current_profile: 'dev-workspace',
    profiles: {
      'dev-workspace': {
        api_base: 'http://localhost:4311',
        label: './dev.sh (test@example.com)',
        dev_access_token: 'dev-token',
        dev_access_expires_at: 123,
        dev_user_id: 'test-user',
        dev_workspace_root: '/tmp/workspace',
      },
    },
  });

  assert.equal(normalized.current_profile, 'dev-workspace');
  assert.deepEqual(normalized.profiles['dev-workspace'], {
    api_base: 'http://localhost:4311',
    beta: undefined,
    channel: undefined,
    label: './dev.sh (test@example.com)',
    dev_access_token: 'dev-token',
    dev_access_expires_at: 123,
    dev_user_id: 'test-user',
    dev_workspace_root: '/tmp/workspace',
    oauth_access_token: undefined,
    oauth_refresh_token: undefined,
    oauth_access_expires_at: undefined,
    oauth_refresh_expires_at: undefined,
    oauth_client_id: undefined,
    oauth_issuer: undefined,
    oauth_api_base: undefined,
    oauth_resource: undefined,
    oauth_scopes: undefined,
    oauth_user_id: undefined,
  });
});

test('httpRequest retries with a fresh timeout after dev.sh re-mints its credential', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'notis-cli-home-'));
  mkdirSync(join(homeDir, '.notis'), { recursive: true });
  writeFileSync(
    join(homeDir, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          dev_access_token: 'stale-access-token',
          api_base: 'https://api.example.com',
          dev_access_expires_at: 4102444800,
        },
      },
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import { mkdirSync, writeFileSync } from 'node:fs';
        import { httpRequest } from ${JSON.stringify(join(cliRoot, 'src/runtime/transport.js'))};

        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let protectedCalls = 0;

        globalThis.fetch = async (url, options = {}) => {
          const target = String(url);
          if (target.endsWith('/health')) {
            protectedCalls += 1;
            if (protectedCalls === 1) {
              await delay(5);
              mkdirSync(${JSON.stringify(join(homeDir, '.notis'))}, { recursive: true });
              writeFileSync(${JSON.stringify(join(homeDir, '.notis', 'config.json'))}, JSON.stringify({
                current_profile: 'default',
                profiles: {
                  default: {
                    dev_access_token: 'dev-remitted-access-token',
                    api_base: 'https://api.example.com',
                    dev_access_expires_at: 4102444800,
                  },
                },
              }));
              return {
                ok: false,
                status: 401,
                json: async () => ({ error: { message: 'expired token' } }),
              };
            }

            if (options.signal?.aborted) {
              const error = new Error('retry request aborted');
              error.name = 'AbortError';
              throw error;
            }

            return {
              ok: true,
              status: 200,
              json: async () => ({
                ok: true,
                authorization: options.headers?.Authorization || null,
              }),
            };
          }

          throw new Error(\`Unexpected URL: \${target}\`);
        };

        const runtime = {
          profileName: 'default',
          apiBase: 'https://api.example.com',
          jwt: 'stale-access-token',
          credentialKind: 'worktree',
          timeoutMs: 15,
          cliVersion: 'test',
          outputMode: 'json',
          agentMode: false,
          nonInteractive: true,
        };

        const response = await httpRequest({
          runtime,
          method: 'GET',
          path: '/health',
          requireAuth: true,
        });

        process.stdout.write(JSON.stringify({
          response,
          protectedCalls,
          jwt: runtime.jwt,
        }));
      `,
    ],
    {
      cwd: cliRoot,
      env: {
        PATH: process.env.PATH,
        HOME: homeDir,
      },
      encoding: 'utf-8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.protectedCalls, 2);
  assert.equal(payload.jwt, 'dev-remitted-access-token');
  assert.deepEqual(payload.response.payload, {
    ok: true,
    authorization: 'Bearer dev-remitted-access-token',
  });
});

test('httpRequest consumes the newest dev.sh credential before sending', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'notis-cli-home-'));
  mkdirSync(join(homeDir, '.notis'), { recursive: true });
  writeFileSync(
    join(homeDir, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          dev_access_token: 'fresh-disk-token',
          api_base: 'https://api.example.com',
          dev_access_expires_at: 4102444800,
        },
      },
    }),
  );

  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import { httpRequest } from ${JSON.stringify(join(cliRoot, 'src/runtime/transport.js'))};

        let calls = 0;
        const seenAuth = [];

        globalThis.fetch = async (url, options = {}) => {
          if (!String(url).endsWith('/health')) {
            throw new Error('Unexpected URL: ' + String(url));
          }
          calls += 1;
          seenAuth.push(options.headers?.Authorization || null);
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
          };
        };

        const runtime = {
          profileName: 'default',
          apiBase: 'https://api.example.com',
          jwt: 'stale-memory-token',
          credentialKind: 'worktree',
          timeoutMs: 5000,
          cliVersion: 'test',
          outputMode: 'json',
          agentMode: false,
          nonInteractive: true,
        };

        const response = await httpRequest({
          runtime,
          method: 'GET',
          path: '/health',
          requireAuth: true,
        });

        process.stdout.write(JSON.stringify({
          response,
          calls,
          seenAuth,
          jwt: runtime.jwt,
        }));
      `,
    ],
    {
      cwd: cliRoot,
      env: {
        PATH: process.env.PATH,
        HOME: homeDir,
      },
      encoding: 'utf-8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.calls, 1);
  assert.equal(payload.jwt, 'fresh-disk-token');
  assert.deepEqual(payload.seenAuth, ['Bearer fresh-disk-token']);
});

test('httpRequest does not retry on 401 when the on-disk JWT matches the in-memory one', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'notis-cli-home-'));
  mkdirSync(join(homeDir, '.notis'), { recursive: true });
  writeFileSync(
    join(homeDir, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          dev_access_token: 'same-token',
          api_base: 'https://api.example.com',
          dev_access_expires_at: 4102444800,
        },
      },
    }),
  );

  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import { httpRequest } from ${JSON.stringify(join(cliRoot, 'src/runtime/transport.js'))};

        let calls = 0;
        globalThis.fetch = async (url) => {
          if (!String(url).endsWith('/health')) throw new Error('Unexpected: ' + String(url));
          calls += 1;
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: { message: 'expired token' } }),
          };
        };

        const runtime = {
          profileName: 'default',
          apiBase: 'https://api.example.com',
          jwt: 'same-token',
          credentialKind: 'worktree',
          timeoutMs: 5000,
          cliVersion: 'test',
          outputMode: 'json',
          agentMode: false,
          nonInteractive: true,
        };

        try {
          await httpRequest({ runtime, method: 'GET', path: '/health', requireAuth: true });
          process.stdout.write(JSON.stringify({ calls, error: null }));
        } catch (error) {
          process.stdout.write(JSON.stringify({ calls, error: error.code || error.message }));
        }
      `,
    ],
    {
      cwd: cliRoot,
      env: {
        PATH: process.env.PATH,
        HOME: homeDir,
      },
      encoding: 'utf-8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.calls, 1);
  assert.equal(payload.error, 'auth_invalid');
});

test('getApiBase defaults to live APIs and ignores stale localhost / Conductor ports', () => {
  const originalConductorPort = process.env.CONDUCTOR_PORT;
  const originalApiBase = process.env.NOTIS_API_BASE;
  delete process.env.CONDUCTOR_PORT;
  delete process.env.NOTIS_API_BASE;
  process.env.CONDUCTOR_PORT = '55000';
  try {
    const staleLocalhost = getApiBase(
      {
        current_profile: 'default',
        profiles: {
          default: {
            api_base: 'http://localhost:3001',
          },
        },
      },
      'default',
      undefined,
    );
    assert.equal(staleLocalhost, 'https://api.notis.ai');

    const staleConductorLocalhost = getApiBase(
      {
        current_profile: 'default',
        profiles: {
          default: {
            api_base: 'http://localhost:55041',
          },
        },
      },
      'default',
      undefined,
    );
    assert.equal(staleConductorLocalhost, 'https://api.notis.ai');

    const remoteApiBase = getApiBase(
      {
        current_profile: 'default',
        profiles: {
          default: {
            api_base: 'https://api.notis.ai',
          },
        },
      },
      'default',
      undefined,
    );
    assert.equal(remoteApiBase, 'https://api.notis.ai');

    const betaFromFlag = getApiBase(
      {
        current_profile: 'default',
        profiles: {
          default: {
            beta: true,
          },
        },
      },
      'default',
      undefined,
    );
    assert.equal(betaFromFlag, 'https://api-beta.notis.ai');

    const betaFromStoredApi = getApiBase(
      {
        current_profile: 'default',
        profiles: {
          default: {
            api_base: 'https://api-beta.notis.ai',
          },
        },
      },
      'default',
      undefined,
    );
    assert.equal(betaFromStoredApi, 'https://api-beta.notis.ai');
  } finally {
    if (originalConductorPort) {
      process.env.CONDUCTOR_PORT = originalConductorPort;
    } else {
      delete process.env.CONDUCTOR_PORT;
    }
    if (originalApiBase) {
      process.env.NOTIS_API_BASE = originalApiBase;
    } else {
      delete process.env.NOTIS_API_BASE;
    }
  }
});

test('top-level help omits the removed db command group', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr);

  assert.match(result.stdout, /apps\s+Develop, deploy, and submit Notis Apps\./);
  assert.match(result.stdout, /^\s+tools\s+/m);
  assert.match(result.stdout, /Discover and execute generic tools exposed/);
  assert.doesNotMatch(result.stdout, /^\s+db\s/m);
  assert.doesNotMatch(result.stdout, /^\s+agent-context\s/m);
  assert.doesNotMatch(result.stdout, /^\s+agent-capture\s/m);
});

test('coding-agent setup is registered while hook adapters stay hidden', () => {
  const result = runCli(['describe', 'agents', 'install', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.data.spec.command_path.join(' '), 'agents install');
  assert.equal(payload.data.spec.idempotent, true);
  assert.equal(
    COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'agent-context')?.hidden,
    true,
  );
  assert.equal(
    COMMAND_SPECS.find((spec) => spec.command_path.join(' ') === 'agent-capture')?.hidden,
    true,
  );
});

test('db commands are no longer registered', () => {
  const commandPaths = COMMAND_SPECS.map((spec) => spec.command_path.join(' '));
  assert.equal(commandPaths.some((commandPath) => commandPath.startsWith('db ')), false);

  const result = runCli(['db', 'list']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown command/i);
});

test('describe removed database query command fails', () => {
  const result = runCli(['describe', 'db', 'query', '--json']);
  assert.equal(result.status, 2, result.stdout || result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'usage_error');
});

test('describe apps create is registered', () => {
  const result = runCli(['describe', 'apps', 'create', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.spec.command_path.join(' '), 'apps create');
  assert.equal(payload.data.spec.backend_call.name, 'LOCAL_NOTIS_CREATE_APP');
  const optionFlags = (payload.data.spec.args_schema.options || []).map((o) => o.flags);
  assert.equal(optionFlags.some((flags) => flags.includes('--icon')), false);
});

test('apps create reads icon metadata from notis.config.ts instead of a CLI flag', async () => {
  let requestBody = null;
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-create-icon-'));
  writeFileSync(
    join(projectDir, 'notis.config.mjs'),
    `export default {
      name: 'task-manager',
      title: 'Task Manager',
      description: 'Track team tasks',
      icon: 'phosphor:check-square',
      routes: [],
      tools: []
    };\n`,
  );

  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ app: { id: 'app-1', name: 'Task Manager' } }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', `http://127.0.0.1:${port}`, 'apps', 'create', 'Task Manager', projectDir],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.tool_name, 'LOCAL_NOTIS_CREATE_APP');
    assert.equal(requestBody.arguments.icon, 'phosphor:check-square');
    assert.equal(requestBody.arguments.description, 'Track team tasks');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('apps duplicate emits machine output and identifies the mutation', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-duplicate-app-'));
  mkdirSync(join(projectDir, '.notis'), { recursive: true });
  writeFileSync(join(projectDir, '.notis', 'state.json'), JSON.stringify({
    app_id: 'app-1',
    version: 3,
    linked_at: '2026-07-29T00:00:00.000Z',
  }));

  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      app: { id: 'app-copy-1', name: 'Task Manager Copy', slug: 'task-manager-copy' },
      duplicated_from_app_id: 'app-1',
      copied_document_count: 4,
      portal_url: 'https://app.notis.ai/apps/app-copy-1',
      databases: [{ id: 'db-copy-1', slug: 'tasks', name: 'Tasks' }],
    }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'apps',
        'duplicate',
        projectDir,
        '--name',
        'Task Manager Copy',
      ],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.app_id, 'app-copy-1');
    assert.equal(payload.data.duplicated_from_app_id, 'app-1');
    assert.equal(payload.data.copied_document_count, 4);
    assert.equal(payload.data.databases[0].id, 'db-copy-1');
    assert.equal(payload.meta.mutating, true);
    assert.match(payload.data.idempotency_key, /^[0-9a-f-]{36}$/);
    assert.equal(requestBody.tool_name, 'LOCAL_NOTIS_DUPLICATE_APP');
    assert.equal(requestBody.arguments.app_id, 'app-1');
    assert.equal(requestBody.arguments.name, 'Task Manager Copy');
    assert.equal(requestBody.arguments.copy_documents, 'declared');
    assert.equal(requestBody.idempotency_key, payload.data.idempotency_key);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('apps pull and publish are registered for source and Store workflows', () => {
  const pullSpec = COMMAND_SPECS.find(
    (spec) => spec.command_path.join(' ') === 'apps pull',
  );
  assert.ok(pullSpec, 'apps pull command spec should exist');
  assert.equal(pullSpec.backend_call.type, 'http');
  assert.equal(pullSpec.backend_call.name, 'portal_apps/source');
  assert.equal(pullSpec.mutates, true);
  assert.equal(pullSpec.require_auth, true);

  const appCommands = COMMAND_SPECS
    .filter((spec) => spec.command_path[0] === 'apps')
    .map((spec) => spec.command_path.join(' '));
  assert.ok(appCommands.includes('apps publish'));

  const publishSpec = COMMAND_SPECS.find(
    (spec) => spec.command_path.join(' ') === 'apps publish',
  );
  assert.equal(publishSpec.backend_call.type, 'http');
  assert.equal(publishSpec.backend_call.name, 'portal_apps/publish');
  assert.equal(publishSpec.require_auth, true);
});

test('cli tool access does not expose store publish tools', () => {
  const toolAccess = JSON.parse(
    readFileSync(resolve(cliRoot, '../../server/config/tool_access/cli.json'), 'utf-8'),
  );
  const tools = toolAccess?.base?.tools || [];

  assert.ok(!tools.includes('LOCAL_NOTIS_PUBLISH_APP'));
});

test('apps publish requires explicit App Details confirmation', () => {
  const result = runCli(['--json', 'apps', 'publish'], { NOTIS_JWT: makeJwt() });
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.error.message, /--confirm-ready/);
});

test('apps publish submits the matching deployed version for Store review', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-publish-ready-'));
  mkdirSync(join(projectDir, '.notis'), { recursive: true });
  mkdirSync(join(projectDir, 'metadata'), { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name: 'ready-app',
    version: '0.1.0',
    notisAppVersion: '0.1.0',
  }));
  writeFileSync(join(projectDir, '.notis', 'state.json'), JSON.stringify({
    app_id: 'app-1',
    version: 8,
    linked_at: '2026-07-16T00:00:00.000Z',
  }));
  writeFileSync(join(projectDir, 'notis.config.mjs'), `export default {
    name: 'ready-app',
    title: 'Ready App',
    description: 'Ready for the Store.',
    tagline: 'A ready Store app.',
    categories: ['Productivity'],
    screenshots: [
      { path: 'metadata/screenshot-1.png', alt: 'First screenshot.' },
      { path: 'metadata/screenshot-2.png', alt: 'Second screenshot.' },
      { path: 'metadata/screenshot-3.png', alt: 'Third screenshot.' },
    ],
    routes: [],
    tools: [],
  };\n`);
  writeFileSync(join(projectDir, 'CHANGELOG.md'), `# Ready App Changelog

## [Ready for the Store] - 2026-07-16

- Initial Store release.
`);
  for (let index = 1; index <= 3; index += 1) {
    writeFileSync(join(projectDir, 'metadata', `screenshot-${index}.png`), makeStoreScreenshotPngHeader());
  }

  const requests = [];
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    requests.push({ url: req.url, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/cli_tools') {
      res.end(JSON.stringify({
        app: {
          id: 'app-1',
          visibility: 'public_store_hidden',
          current_version: 8,
        },
        active_submission: { status: 'merged' },
      }));
      return;
    }
    assert.equal(req.url, '/portal_apps/publish');
    res.end(JSON.stringify({
      submission: {
        id: 'submission-1',
        app_id: 'app-1',
        source_version: 8,
        status: 'pending_review',
        github_pr_url: 'https://github.com/notis/app-store/pull/8',
      },
    }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'apps',
        'publish',
        projectDir,
        '--confirm-ready',
      ],
      { NOTIS_JWT: makeJwt() },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.source_version, 8);
    assert.equal(payload.data.submission.status, 'pending_review');
    assert.equal(requests[0].body.tool_name, 'LOCAL_NOTIS_GET_APP');
    assert.deepEqual(requests[1].body, { app_id: 'app-1' });
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('describe apps pull --json renders the spec', () => {
  const result = runCli(['describe', 'apps', 'pull', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.spec.command_path.join(' '), 'apps pull');
  assert.equal(payload.data.spec.backend_call.name, 'portal_apps/source');
});

test('apps pull pins an explicitly requested source version', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-pinned-version-'));
  const tarball = makeTarGz({ 'package.json': '{"name":"pinned"}\n' });
  let lookupToolName = null;
  const server = createHttpServer(async (req, res) => {
    if (req.url === '/cli_tools' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      lookupToolName = JSON.parse(Buffer.concat(chunks).toString('utf-8')).tool_name;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ apps: [{ app_id: 'app-1', slug: 'pinned-app' }] }));
      return;
    }
    assert.equal(req.url, '/portal_apps/source?app_id=app-1&version=2');
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="pinned-v2.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'apps',
        'pull',
        'app-1',
        targetDir,
        '--force',
        '--source-version',
        '2',
      ],
      { NOTIS_JWT: makeJwt() },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.version, 2);
    assert.equal(lookupToolName, 'LOCAL_NOTIS_LIST_APPS');
    const state = readLinkedState(payload.data.project_dir, appLinkedStateProfileKey({
      apiBase: `http://127.0.0.1:${port}`,
      userId: 'auth-user-123',
    }));
    assert.equal(state.app_id, 'app-1');
    assert.equal(state.version, 2);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource downloads source, extracts it, and writes linked state', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-target-'));
  const tarball = makeTarGz({
    'package.json': '{"name":"sample"}\n',
    'app/page.tsx': 'export default function Page() { return null; }\n',
  });
  const server = createHttpServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer jwt-1');
    assert.equal(req.url, '/portal_apps/source?app_id=app-1&version=latest');
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="sample-v7.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const result = await pullAppSource({
      apiBase: `http://127.0.0.1:${port}`,
      jwt: 'jwt-1',
      appId: 'app-1',
      targetDir,
    });
    assert.equal(result.version, 7);
    assert.equal(readFileSync(join(targetDir, 'package.json'), 'utf-8'), '{"name":"sample"}\n');
    const state = JSON.parse(readFileSync(join(targetDir, '.notis', 'state.json'), 'utf-8'));
    assert.equal(state.app_id, 'app-1');
    assert.equal(state.version, 7);
    assert.match(state.linked_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource extracts the PAX path emitted for long server source names', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-pax-'));
  const longPath = `skills/${'long-segment-'.repeat(10)}guide.md`;
  const tarball = makePaxTarGz(longPath, '# Long path\n');
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="pax-v4.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    await pullAppSource({
      apiBase: `http://127.0.0.1:${port}`,
      jwt: 'jwt-1',
      appId: 'app-1',
      targetDir,
      version: 4,
    });
    assert.equal(readFileSync(join(targetDir, longPath), 'utf-8'), '# Long path\n');
    assert.equal(readLinkedState(targetDir).version, 4);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('apps pull uses the OAuth credential refreshed during app lookup for source download', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-refreshed-oauth-'));
  const configHome = mkdtempSync(join(tmpdir(), 'notis-pull-refreshed-config-'));
  const configFile = join(configHome, 'config.json');
  const tarball = makeTarGz({ 'package.json': '{"name":"refreshed"}\n' });
  let sourceAuthorization = null;
  const server = createHttpServer(async (req, res) => {
    if (req.url === '/oauth/token') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        access_token: makeJwt('oauth-user'),
        refresh_token: 'rotated-refresh',
        expires_in: 900,
        refresh_expires_in: 3600,
        scope: 'notis:read notis:apps',
      }));
      return;
    }
    if (req.url === '/cli_tools') {
      assert.equal(req.headers.authorization, `Bearer ${makeJwt('oauth-user')}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ apps: [{ app_id: 'app-1', slug: 'refreshed-app' }] }));
      return;
    }
    if (req.url === '/portal_apps/source?app_id=app-1&version=latest') {
      sourceAuthorization = req.headers.authorization;
      res.writeHead(200, {
        'content-type': 'application/gzip',
        'content-disposition': 'attachment; filename="refreshed-v3.tar.gz"',
      });
      res.end(tarball);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const apiBase = `http://127.0.0.1:${port}`;
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: apiBase,
        oauth_access_token: makeJwt('oauth-user', 1),
        oauth_refresh_token: 'refresh-token',
        oauth_access_expires_at: 1,
        oauth_refresh_expires_at: 4102444800,
        oauth_client_id: 'notis_cli',
        oauth_issuer: apiBase,
        oauth_scopes: ['notis:read', 'notis:apps'],
        oauth_user_id: 'oauth-user',
      },
    },
  }));

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', apiBase, 'apps', 'pull', 'app-1', targetDir],
      { NOTIS_CLI_CONFIG_FILE: configFile },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sourceAuthorization, `Bearer ${makeJwt('oauth-user')}`);
    assert.equal(readFileSync(join(targetDir, 'package.json'), 'utf-8'), '{"name":"refreshed"}\n');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource serializes concurrent forced pulls for one target', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-concurrent-'));
  const tarballs = new Map([
    ['2', makeTarGz({ 'package.json': '{"version":2}\n' })],
    ['3', makeTarGz({ 'package.json': '{"version":3}\n' })],
  ]);
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const server = createHttpServer(async (req, res) => {
    const requestedVersion = new URL(req.url, 'http://localhost').searchParams.get('version');
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="concurrent-v${requestedVersion}.tar.gz"`,
    });
    res.end(tarballs.get(requestedVersion));
    activeRequests -= 1;
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const base = {
    apiBase: `http://127.0.0.1:${port}`,
    jwt: 'jwt-1',
    appId: 'app-1',
    targetDir,
    force: true,
  };
  try {
    await Promise.all([
      pullAppSource({ ...base, version: 2 }),
      pullAppSource({ ...base, version: 3 }),
    ]);
    assert.equal(maxActiveRequests, 1);
    assert.equal(readLinkedState(targetDir).version, 3);
    assert.equal(readFileSync(join(targetDir, 'package.json'), 'utf-8'), '{"version":3}\n');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource rejects a symlinked target before acquiring a separate lock', async () => {
  const realTarget = mkdtempSync(join(tmpdir(), 'notis-pull-real-target-'));
  const aliasParent = mkdtempSync(join(tmpdir(), 'notis-pull-alias-parent-'));
  const aliasTarget = join(aliasParent, 'target');
  writeFileSync(join(realTarget, 'existing.txt'), 'keep me');
  symlinkSync(realTarget, aliasTarget, 'dir');

  await assert.rejects(
    () => pullAppSource({
      apiBase: 'http://127.0.0.1:9',
      jwt: 'jwt-1',
      appId: 'app-1',
      targetDir: aliasTarget,
      force: true,
    }),
    /unsafe target/,
  );
  assert.equal(readFileSync(join(realTarget, 'existing.txt'), 'utf-8'), 'keep me');
});

test('pullAppSource rejects a directory-to-symlink swap during download', async () => {
  const parentDir = mkdtempSync(join(tmpdir(), 'notis-pull-swap-parent-'));
  const targetDir = join(parentDir, 'target');
  const originalDir = join(parentDir, 'original-target');
  const outsideDir = mkdtempSync(join(tmpdir(), 'notis-pull-swap-outside-'));
  mkdirSync(targetDir);
  writeFileSync(join(targetDir, 'existing.txt'), 'original source');
  writeFileSync(join(outsideDir, 'outside.txt'), 'keep outside');
  const tarball = makeTarGz({ 'package.json': '{"name":"fresh"}\n' });
  let releaseResponse;
  const responseGate = new Promise((resolvePromise) => { releaseResponse = resolvePromise; });
  let markRequestStarted;
  const requestStarted = new Promise((resolvePromise) => { markRequestStarted = resolvePromise; });
  const server = createHttpServer(async (_req, res) => {
    markRequestStarted();
    await responseGate;
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="fresh-v2.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const pulling = pullAppSource({
      apiBase: `http://127.0.0.1:${port}`,
      jwt: 'jwt-1',
      appId: 'app-1',
      targetDir,
      version: 2,
      force: true,
    });
    await requestStarted;
    renameSync(targetDir, originalDir);
    symlinkSync(outsideDir, targetDir, 'dir');
    releaseResponse();

    await assert.rejects(pulling, /unsafe target|target changed/);
    assert.equal(readFileSync(join(originalDir, 'existing.txt'), 'utf-8'), 'original source');
    assert.equal(readFileSync(join(outsideDir, 'outside.txt'), 'utf-8'), 'keep outside');
    assert.equal(existsSync(join(outsideDir, 'package.json')), false);
  } finally {
    releaseResponse?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource rejects a parent-directory swap for a new target during download', async () => {
  const parentDir = mkdtempSync(join(tmpdir(), 'notis-pull-parent-swap-'));
  const targetDir = join(parentDir, 'target');
  const movedParent = `${parentDir}-original`;
  const outsideParent = mkdtempSync(join(tmpdir(), 'notis-pull-parent-outside-'));
  const tarball = makeTarGz({ 'package.json': '{"name":"fresh"}\n' });
  let releaseResponse;
  const responseGate = new Promise((resolvePromise) => { releaseResponse = resolvePromise; });
  let markRequestStarted;
  const requestStarted = new Promise((resolvePromise) => { markRequestStarted = resolvePromise; });
  const server = createHttpServer(async (_req, res) => {
    markRequestStarted();
    await responseGate;
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="fresh-v2.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const pulling = pullAppSource({
      apiBase: `http://127.0.0.1:${port}`,
      jwt: 'jwt-1',
      appId: 'app-1',
      targetDir,
      version: 2,
    });
    await requestStarted;
    renameSync(parentDir, movedParent);
    symlinkSync(outsideParent, parentDir, 'dir');
    releaseResponse();

    await assert.rejects(pulling, /parent changed/);
    assert.equal(existsSync(join(outsideParent, 'target')), false);
    assert.equal(existsSync(join(movedParent, 'target')), false);
  } finally {
    releaseResponse?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource reports readable no-source errors', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-no-source-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'keep me');
  const server = createHttpServer((req, res) => {
    assert.equal(req.url, '/portal_apps/source?app_id=app-legacy&version=latest');
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: 'No editable source snapshot exists for this app version. Re-deploy the app with the current Notis CLI, then run `notis apps pull` again.',
    }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => pullAppSource({
        apiBase: `http://127.0.0.1:${port}`,
        jwt: 'jwt-1',
        appId: 'app-legacy',
        targetDir,
        force: true,
      }),
      /No editable source snapshot exists/,
    );
    assert.equal(readFileSync(join(targetDir, 'existing.txt'), 'utf-8'), 'keep me');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource rejects unsafe source archive paths', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-unsafe-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'keep me');
  const tarball = makeTarGz({ '../outside.txt': 'nope' });
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="sample-v1.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => pullAppSource({
        apiBase: `http://127.0.0.1:${port}`,
        jwt: 'jwt-1',
        appId: 'app-1',
        targetDir,
        force: true,
      }),
      /unsafe path/,
    );
    assert.equal(readFileSync(join(targetDir, 'existing.txt'), 'utf-8'), 'keep me');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource rejects a server response that does not match the pinned version', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-version-race-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'keep me');
  const tarball = makeTarGz({ 'package.json': '{"name":"newer"}\n' });
  const server = createHttpServer((req, res) => {
    assert.equal(req.url, '/portal_apps/source?app_id=app-1&version=2');
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="newer-v3.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => pullAppSource({
        apiBase: `http://127.0.0.1:${port}`,
        jwt: 'jwt-1',
        appId: 'app-1',
        targetDir,
        version: 2,
        force: true,
      }),
      /Requested app source version 2, but the server returned version 3/,
    );
    assert.equal(readFileSync(join(targetDir, 'existing.txt'), 'utf-8'), 'keep me');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource requires the response to prove its source version', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-missing-version-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'keep me');
  const tarball = makeTarGz({ 'package.json': '{"name":"unversioned"}\n' });
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/gzip' });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => pullAppSource({
        apiBase: `http://127.0.0.1:${port}`,
        jwt: 'jwt-1',
        appId: 'app-1',
        targetDir,
        version: 2,
        force: true,
      }),
      /did not identify a valid positive version/,
    );
    assert.equal(readFileSync(join(targetDir, 'existing.txt'), 'utf-8'), 'keep me');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource rejects case-folded local-only archive entries', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-casefold-'));
  writeFileSync(join(targetDir, '.env.local'), 'keep secret');
  const tarball = makeTarGz({
    'package.json': '{"name":"bad"}\n',
    'app/.ENV.LOCAL': 'replace secret',
  });
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="bad-v2.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => pullAppSource({
        apiBase: `http://127.0.0.1:${port}`,
        jwt: 'jwt-1',
        appId: 'app-1',
        targetDir,
        version: 2,
        force: true,
      }),
      /local-only path/,
    );
    assert.equal(readFileSync(join(targetDir, '.env.local'), 'utf-8'), 'keep secret');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource stages forced updates and preserves local-only checkout state', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-transactional-'));
  mkdirSync(join(targetDir, 'app'), { recursive: true });
  mkdirSync(join(targetDir, '.git'), { recursive: true });
  mkdirSync(join(targetDir, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(targetDir, '.notis', 'output'), { recursive: true });
  mkdirSync(join(targetDir, 'packages', 'foo', 'node_modules', 'nested'), { recursive: true });
  mkdirSync(join(targetDir, 'packages', 'foo', '.notis'), { recursive: true });
  writeFileSync(join(targetDir, 'app', 'old.tsx'), 'stale source');
  symlinkSync('../local-target', join(targetDir, 'app', 'local-link'));
  writeFileSync(join(targetDir, 'stale.txt'), 'remove me');
  writeFileSync(join(targetDir, '.git', 'config'), 'keep git');
  writeFileSync(join(targetDir, '.env.local'), 'keep env');
  writeFileSync(join(targetDir, 'node_modules', 'pkg', 'index.js'), 'keep deps');
  writeFileSync(join(targetDir, '.notis', 'output', 'manifest.json'), 'keep build');
  writeFileSync(join(targetDir, 'packages', 'foo', '.env.local'), 'keep nested env');
  writeFileSync(join(targetDir, 'packages', 'foo', 'node_modules', 'nested', 'index.js'), 'keep nested deps');
  writeFileSync(join(targetDir, 'packages', 'foo', '.notis', 'runtime.json'), 'keep nested runtime');
  writeLinkedState(targetDir, { app_id: 'old-app', version: 8 });

  const tarball = makeTarGz({
    'package.json': '{"name":"fresh"}\n',
    'app/page.tsx': 'export default function Page() { return null; }\n',
    'packages/foo/index.ts': 'export const fresh = true;\n',
  });
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="fresh-v2.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    await pullAppSource({
      apiBase: `http://127.0.0.1:${port}`,
      jwt: 'jwt-1',
      appId: 'app-1',
      targetDir,
      version: 2,
      force: true,
    });

    assert.equal(existsSync(join(targetDir, 'app', 'old.tsx')), false);
    assert.equal(existsSync(join(targetDir, 'stale.txt')), false);
    assert.equal(readFileSync(join(targetDir, 'package.json'), 'utf-8'), '{"name":"fresh"}\n');
    assert.equal(readFileSync(join(targetDir, '.git', 'config'), 'utf-8'), 'keep git');
    assert.equal(readFileSync(join(targetDir, '.env.local'), 'utf-8'), 'keep env');
    assert.equal(readFileSync(join(targetDir, 'node_modules', 'pkg', 'index.js'), 'utf-8'), 'keep deps');
    assert.equal(readFileSync(join(targetDir, '.notis', 'output', 'manifest.json'), 'utf-8'), 'keep build');
    assert.equal(readFileSync(join(targetDir, 'packages', 'foo', '.env.local'), 'utf-8'), 'keep nested env');
    assert.equal(
      readFileSync(join(targetDir, 'packages', 'foo', 'node_modules', 'nested', 'index.js'), 'utf-8'),
      'keep nested deps',
    );
    assert.equal(
      readFileSync(join(targetDir, 'packages', 'foo', '.notis', 'runtime.json'), 'utf-8'),
      'keep nested runtime',
    );
    assert.equal(lstatSync(join(targetDir, 'app', 'local-link')).isSymbolicLink(), true);
    assert.deepEqual(
      { app_id: readLinkedState(targetDir).app_id, version: readLinkedState(targetDir).version },
      { app_id: 'app-1', version: 2 },
    );
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource fails closed when a preserved symlink collides with pulled source', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-symlink-conflict-'));
  const localAppDir = mkdtempSync(join(tmpdir(), 'notis-pull-local-app-'));
  writeFileSync(join(localAppDir, 'local.txt'), 'keep local');
  symlinkSync(localAppDir, join(targetDir, 'app'), 'dir');
  writeLinkedState(targetDir, { app_id: 'old-app', version: 1 });
  const tarball = makeTarGz({
    'package.json': '{"name":"fresh"}\n',
    'app/page.tsx': 'export default null;\n',
  });
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="fresh-v2.tar.gz"',
    });
    res.end(tarball);
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => pullAppSource({
        apiBase: `http://127.0.0.1:${port}`,
        jwt: 'jwt-1',
        appId: 'app-1',
        targetDir,
        version: 2,
        force: true,
      }),
      /Local-only path conflicts with pulled source: app/,
    );
    assert.equal(lstatSync(join(targetDir, 'app')).isSymbolicLink(), true);
    assert.equal(readFileSync(join(targetDir, 'app', 'local.txt'), 'utf-8'), 'keep local');
    assert.deepEqual(readLinkedState(targetDir), { app_id: 'old-app', version: 1 });
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('pullAppSource refuses a non-empty target directory without force', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-non-empty-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'x');
  await assert.rejects(
    () => pullAppSource({
      apiBase: 'http://127.0.0.1:9',
      jwt: 'jwt-1',
      appId: 'app-1',
      targetDir,
    }),
    /Target directory is not empty/,
  );
});

test('collectSourceFiles keeps lockfiles and excludes runtime, build, and secret files', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-source-files-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  mkdirSync(join(projectDir, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(projectDir, '.notis', 'output'), { recursive: true });
  mkdirSync(join(projectDir, '.notis-app-pull-retained', 'backup'), { recursive: true });
  mkdirSync(join(projectDir, '.notis-app-scaffold-retained', 'stage'), { recursive: true });
  mkdirSync(join(projectDir, 'dist'), { recursive: true });
  writeFileSync(join(projectDir, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default null;\n');
  writeFileSync(join(projectDir, '.env.local'), 'SECRET=1\n');
  writeFileSync(join(projectDir, 'app', '.ENV.LOCAL'), 'SECRET=2\n');
  writeFileSync(join(projectDir, 'node_modules', 'pkg', 'index.js'), 'ignored\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), '{}\n');
  writeFileSync(join(projectDir, '.notis-app-pull-retained', 'backup', 'old.ts'), 'ignored\n');
  writeFileSync(join(projectDir, '.notis-app-scaffold-retained', 'stage', 'copy.ts'), 'ignored\n');
  writeFileSync(join(projectDir, 'dist', 'bundle.js'), 'ignored\n');
  writeFileSync(join(projectDir, 'tsconfig.tsbuildinfo'), '{}\n');

  const sourceFiles = collectSourceFiles(projectDir);

  assert.equal(sourceFiles['package-lock.json'], Buffer.from('{"lockfileVersion":3}\n').toString('base64'));
  assert.equal(sourceFiles['app/page.tsx'], Buffer.from('export default null;\n').toString('base64'));
  assert.equal(sourceFiles['.env.local'], undefined);
  assert.equal(sourceFiles['app/.ENV.LOCAL'], undefined);
  assert.equal(sourceFiles['node_modules/pkg/index.js'], undefined);
  assert.equal(sourceFiles['.notis/output/manifest.json'], undefined);
  assert.equal(sourceFiles['.notis-app-pull-retained/backup/old.ts'], undefined);
  assert.equal(sourceFiles['.notis-app-scaffold-retained/stage/copy.ts'], undefined);
  assert.equal(sourceFiles['dist/bundle.js'], undefined);
  assert.equal(sourceFiles['tsconfig.tsbuildinfo'], undefined);
});

test('linked app state rejects a symlinked .notis directory', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-state-dir-symlink-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'notis-state-dir-outside-'));
  symlinkSync(outsideDir, join(projectDir, '.notis'), 'dir');

  assert.throws(
    () => writeLinkedState(projectDir, { app_id: 'app-1', version: 2 }),
    /unsafe Notis state directory/,
  );
  assert.equal(existsSync(join(outsideDir, 'state.json')), false);
});

test('linked app state rejects a symlinked state file', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-state-file-symlink-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'notis-state-file-outside-'));
  const outsideFile = join(outsideDir, 'outside.json');
  mkdirSync(join(projectDir, '.notis'), { recursive: true });
  writeFileSync(outsideFile, 'keep outside');
  symlinkSync(outsideFile, join(projectDir, '.notis', 'state.json'));

  assert.throws(
    () => writeLinkedState(projectDir, { app_id: 'app-1', version: 2 }),
    /unsafe Notis state file/,
  );
  assert.equal(readFileSync(outsideFile, 'utf-8'), 'keep outside');
});

test('apps link clears same-id development state without claiming remote source provenance', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-link-promotion-recovery-'));
  writeLinkedState(projectDir, {
    dev_app_id: 'app-1',
    dev_linked_at: '2026-05-01T00:00:00.000Z',
  });

  const server = createHttpServer(async (req, res) => {
    if (req.url !== '/cli_tools' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    assert.equal(body.tool_name, 'LOCAL_NOTIS_GET_APP');
    assert.equal(body.arguments.app_id, 'app-1');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      app: {
        id: 'app-1',
        current_version: 4,
        manifest: { version: 4, is_dev: false },
      },
    }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const result = await runCliAsync(
      ['--json', '--api-base', `http://127.0.0.1:${port}`, 'apps', 'link', 'app-1', projectDir],
      { NOTIS_JWT: makeJwt() },
    );
    assert.equal(result.status, 0, result.stderr);
    const state = readLinkedState(projectDir, appLinkedStateProfileKey({
      apiBase: `http://127.0.0.1:${port}`,
      userId: 'auth-user-123',
    }));
    assert.equal(state.app_id, 'app-1');
    assert.equal(state.version, undefined);
    assert.equal(state.deployed_at, undefined);
    assert.equal(state.dev_app_id, undefined);
    assert.equal(state.dev_linked_at, undefined);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('apps deploy sends pulled base version and updates linked state after deploy', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-deploy-linked-state-'));
  mkdirSync(join(projectDir, '.notis', 'output', 'bundle'), { recursive: true });
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, '.notis', 'state.json'), JSON.stringify({
    app_id: 'app-1',
    version: 7,
    linked_at: '2026-05-01T00:00:00.000Z',
  }, null, 2) + '\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'export default function App() {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), '[data-notis-app-root] {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), JSON.stringify({
    version: 7,
    app: { name: 'Linked App', title: 'Linked App', accent: 'violet' },
    routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    databases: [],
    tools: [],
  }));
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');

  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: 8 }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const result = await runCliAsync(
      ['--json', '--api-base', `http://127.0.0.1:${port}`, 'apps', 'deploy', projectDir, '--skip-build'],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.tool_name, 'LOCAL_NOTIS_SAVE_APP_FILES');
    assert.equal(requestBody.arguments.app_id, 'app-1');
    assert.equal(requestBody.arguments.base_version, 7);
    assert.equal(requestBody.arguments.name, 'Linked App');
    assert.equal(requestBody.arguments.accent, 'violet');
    const state = readLinkedState(projectDir, appLinkedStateProfileKey({
      apiBase: `http://127.0.0.1:${port}`,
      userId: 'auth-user-123',
    }));
    assert.equal(state.app_id, 'app-1');
    assert.equal(state.version, 8);
    assert.equal(state.linked_at, '2026-05-01T00:00:00.000Z');
    assert.match(state.deployed_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('apps deploy promotes a dev-only project instead of failing', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-deploy-promote-'));
  mkdirSync(join(projectDir, '.notis', 'output', 'bundle'), { recursive: true });
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  // Only a dev app: the project has iterated locally but never deployed.
  writeFileSync(join(projectDir, '.notis', 'state.json'), JSON.stringify({
    dev_app_id: 'dev-app-1',
    dev_linked_at: '2026-05-01T00:00:00.000Z',
  }, null, 2) + '\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'export default function App() {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), '[data-notis-app-root] {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), JSON.stringify({
    version: 1,
    app: { name: 'Dev Only App', title: 'Dev Only App' },
    routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    databases: [],
    tools: [],
  }));
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');

  const toolCalls = [];
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    toolCalls.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: 1, promoted: true }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const result = await runCliAsync(
      ['--json', '--api-base', `http://127.0.0.1:${port}`, 'apps', 'deploy', projectDir, '--skip-build'],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].tool_name, 'LOCAL_NOTIS_SAVE_APP_FILES');
    assert.equal(toolCalls[0].arguments.promote_dev_app, true);
    assert.equal(toolCalls[0].arguments.name, 'Dev Only App');
    // Promotion keeps the id: the deploy targets the same row dev was using.
    assert.equal(toolCalls[0].arguments.app_id, 'dev-app-1');
    const state = readLinkedState(projectDir, appLinkedStateProfileKey({
      apiBase: `http://127.0.0.1:${port}`,
      userId: 'auth-user-123',
    }));
    assert.equal(state.app_id, 'dev-app-1');
    assert.equal(state.dev_app_id, undefined);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('apps deploy does not direct-fallback after an ambiguous backend timeout', async () => {
  assert.equal(APP_DEPLOY_TIMEOUT_MS, 600_000);
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-deploy-timeout-'));
  mkdirSync(join(projectDir, '.notis', 'output', 'bundle'), { recursive: true });
  writeFileSync(join(projectDir, '.notis', 'state.json'), JSON.stringify({
    app_id: 'app-1',
    version: 7,
  }));
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'export default function App() {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), '[data-notis-app-root] {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), JSON.stringify({
    version: 7,
    app: { name: 'Timeout App' },
    routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    databases: [],
    tools: [],
  }));

  let mutationCount = 0;
  const server = createHttpServer(async (_req, res) => {
    mutationCount += 1;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: 8 }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const result = await runCliAsync(
      [
        '--json',
        '--timeout-ms',
        '50',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'apps',
        'deploy',
        projectDir,
        '--skip-build',
      ],
      { NOTIS_JWT: makeJwt() },
    );

    // Deploy raises its operation-specific timeout above the short global
    // default, so this delayed-but-successful mutation completes once.
    assert.equal(result.status, 0, result.stderr);
    assert.equal(mutationCount, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.version, 8);
    assert.equal(payload.data.mode, undefined);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('apps deploy does not direct-fallback after a post-commit socket reset', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-deploy-reset-'));
  mkdirSync(join(projectDir, '.notis', 'output', 'bundle'), { recursive: true });
  writeFileSync(join(projectDir, '.notis', 'state.json'), JSON.stringify({
    app_id: 'app-1',
    version: 7,
  }));
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'export default function App() {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), '[data-notis-app-root] {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), JSON.stringify({
    version: 7,
    app: { name: 'Reset App' },
    routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    databases: [],
    tools: [],
  }));

  let mutationCount = 0;
  const server = createHttpServer(async (req, res) => {
    for await (const _chunk of req) {
      // Drain the complete mutation request before simulating a lost response.
    }
    mutationCount += 1;
    res.socket.destroy();
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const result = await runCliAsync(
      ['--json', '--api-base', `http://127.0.0.1:${port}`, 'apps', 'deploy', projectDir, '--skip-build'],
      { NOTIS_JWT: makeJwt() },
    );

    assert.notEqual(result.status, 0);
    assert.equal(mutationCount, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, 'network_error');
    assert.match(payload.error.message, /direct fallback was not attempted/i);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('apps deploy fails closed after a partial successful response body', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-deploy-partial-response-'));
  mkdirSync(join(projectDir, '.notis', 'output', 'bundle'), { recursive: true });
  writeFileSync(join(projectDir, '.notis', 'state.json'), JSON.stringify({
    app_id: 'app-1',
    version: 7,
  }));
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'export default function App() {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), '[data-notis-app-root] {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), JSON.stringify({
    version: 7,
    app: { name: 'Partial Response App' },
    routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    databases: [],
    tools: [],
  }));

  let mutationCount = 0;
  const server = createHttpServer(async (req, res) => {
    for await (const _chunk of req) {
      // Drain the complete mutation request before simulating a torn response.
    }
    mutationCount += 1;
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': '64',
    });
    res.write('{"version":8');
    res.socket.destroy();
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  try {
    const result = await runCliAsync(
      ['--json', '--api-base', `http://127.0.0.1:${port}`, 'apps', 'deploy', projectDir, '--skip-build'],
      { NOTIS_JWT: makeJwt() },
    );

    assert.notEqual(result.status, 0);
    assert.equal(mutationCount, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, 'network_error');
    assert.match(payload.error.message, /direct fallback was not attempted/i);
    const state = JSON.parse(readFileSync(join(projectDir, '.notis', 'state.json'), 'utf-8'));
    assert.equal(state.version, 7);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('buildArtifact loads a TypeScript notis.config.ts without CommonJS globals', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-build-'));

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'test-app',
      notisAppVersion: '1.2.3',
      private: true,
      scripts: {
        build: `node -e "const fs=require('fs'); const p='.notis/output/bundle'; fs.mkdirSync(p,{recursive:true}); fs.writeFileSync(p+'/app.js','export default function(){return null;}'); fs.writeFileSync(p+'/app.css','body{}');"`,
      },
    }),
  );
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Test App',
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true, resourceDeepLinks: true }],
  databases: ['tasks'],
  tools: [],
});
`);
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');

  const { manifest } = await buildArtifact(projectDir);
  assert.equal(manifest.app.name, 'Test App');
  assert.equal(manifest.app.release_version, '1.2.3');
  assert.equal(manifest.spec_version, 4);
  assert.equal(manifest.routes[0].path, '/');
  assert.equal(manifest.routes[0].resourceDeepLinks, true);
  assert.ok(manifest.routes[0].export_name);
  assert.ok(manifest.bundle);
  assert.deepEqual(manifest.databases, ['tasks']);
});

test('generateManifest rejects non-boolean resourceDeepLinks route config', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-resource-links-'));
  assert.throws(
    () => generateManifest({
      name: 'Bad resource links',
      routes: [{
        path: '/',
        slug: 'home',
        name: 'Home',
        default: true,
        resourceDeepLinks: 'yes',
      }],
    }, projectDir),
    /resourceDeepLinks must be a boolean/,
  );
});

test('apps build keeps machine output parseable when the project build writes logs', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-build-json-'));
  const buildScript = [
    "console.log('BUILD_LOG_MUST_NOT_REACH_STDOUT')",
    "const fs=require('fs')",
    "const p='.notis/output/bundle'",
    "fs.mkdirSync(p,{recursive:true})",
    "fs.writeFileSync(p+'/app.js','export default function(){return null;}')",
    "fs.writeFileSync(p+'/app.css','body{}')",
  ].join(';');

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'json-build-app',
      private: true,
      scripts: { build: `node -e "${buildScript}"` },
    }),
  );
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(
    join(projectDir, 'notis.config.mjs'),
    `export default {
      name: 'JSON Build App',
      routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
      databases: [],
      tools: [],
    };\n`,
  );
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');

  const result = runCli(['apps', 'build', projectDir, '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /BUILD_LOG_MUST_NOT_REACH_STDOUT/);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'apps build');
});

test('buildArtifact preserves named imports and sanitizes generated route export names', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-build-edge-'));

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'edge-test-app',
      private: true,
      scripts: {
        build: `node -e "const fs=require('fs'); const p='.notis/output/bundle'; fs.mkdirSync(p,{recursive:true}); fs.writeFileSync(p+'/app.js','export default function(){return null;}'); fs.writeFileSync(p+'/app.css','body{}');"`,
      },
    }),
  );
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'shared.js'), `
export const ROUTE_PATHS = ['/step-1', '/api-V2', '/404'];
export const DB_SLUGS = ['tasks', 'notes'];
`);
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';
import { ROUTE_PATHS, DB_SLUGS } from './shared.js';

export default defineNotisApp({
  name: 'Edge Test App',
  routes: ROUTE_PATHS.map((path, index) => ({
    path,
    slug: path === '/' ? 'home' : path.slice(1).toLowerCase(),
    name: path,
    default: index === 0,
  })),
  databases: DB_SLUGS,
  tools: [],
});
`);

  mkdirSync(join(projectDir, 'app', 'step-1'), { recursive: true });
  mkdirSync(join(projectDir, 'app', 'api-V2'), { recursive: true });
  mkdirSync(join(projectDir, 'app', '404'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'step-1', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'app', 'api-V2', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'app', '404', 'page.tsx'), 'export default function Page() { return null; }\n');

  const { manifest } = await buildArtifact(projectDir);
  assert.deepEqual(manifest.databases, ['tasks', 'notes']);
  assert.deepEqual(
    manifest.routes.map((route) => route.export_name),
    ['step1', 'apiV2', 'r404'],
  );

  const entrySource = readFileSync(join(projectDir, '.notis', '_entry.tsx'), 'utf-8');
  assert.match(entrySource, /export \{ default as step1 \}/);
  assert.match(entrySource, /export \{ default as apiV2 \}/);
  assert.match(entrySource, /export \{ default as r404 \}/);
});

test('buildArtifact rewrites Tailwind-style global selectors into shadow-safe bundle selectors', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-build-shadow-css-'));

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'shadow-css-test-app',
      private: true,
      scripts: {
        build: `node -e "const fs=require('fs'); const p='.notis/output/bundle'; fs.mkdirSync(p,{recursive:true}); fs.writeFileSync(p+'/app.js','export default function(){return null;}'); fs.writeFileSync(p+'/app.css','html,:host{line-height:1.5}:root{--radius:8px}body{margin:0}');"`,
      },
    }),
  );
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Shadow CSS Test App',
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
});
`);
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');

  await buildArtifact(projectDir);

  const css = readFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), 'utf-8');
  assert.equal(css, ':host{line-height:1.5}:host{--radius:8px}[data-notis-app-root]{margin:0}');
});

test('buildArtifact rejects source CSS that escapes the app surface', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-build-invalid-source-'));

  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'invalid-source-app', private: true }));
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Invalid Source App',
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
});
`);
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'app', 'globals.css'), 'body { color: red; }\n');

  await assert.rejects(
    () => buildArtifact(projectDir),
    /body selectors are forbidden/i,
  );
});

test('buildArtifact rejects artifact JS that reaches for the portal runtime global', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-build-invalid-artifact-'));

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'invalid-artifact-app',
      private: true,
      scripts: {
        build: `node -e "const fs=require('fs'); const p='.notis/output/bundle'; fs.mkdirSync(p,{recursive:true}); fs.writeFileSync(p+'/app.js','const runtime = window.__NOTIS_RUNTIME__; export default function(){return runtime ? null : null;}'); fs.writeFileSync(p+'/app.css','[data-notis-app-root]{}');"`,
      },
    }),
  );
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Invalid Artifact App',
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
});
`);
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');

  await assert.rejects(
    () => buildArtifact(projectDir),
    /window\.__NOTIS_RUNTIME__/i,
  );
});

test('startAppDevServer exposes a deployable source snapshot for the portal', async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-dev-snapshot-'));
  mkdirSync(join(projectDir, '.notis', 'output', 'bundle'), { recursive: true });
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.js'), 'console.log("snapshot");');
  writeFileSync(join(projectDir, '.notis', 'output', 'bundle', 'app.css'), ':host{}');
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(
    join(projectDir, '.notis', 'output', 'manifest.json'),
    JSON.stringify({
      version: 1,
      app: { name: 'Snapshot App' },
      routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
      databases: [],
      tools: [],
    }),
  );

  const port = await getAvailablePort();
  const registryPath = join(projectDir, 'app-dev-sessions.json');
  writeLinkedState(projectDir, {
    dev_app_id: 'app-1',
    dev_linked_at: '2026-04-24T00:00:00.000Z',
  });
  upsertAppDevSessions({
    sessionId: 'session-1',
    userId: 'user-1',
    apiBase: 'https://api.notis.ai',
    appId: 'app-1',
    targetAppId: 'installed-app-1',
    mountNonce: 'mount-1',
    devSlug: 'snapshot-dev',
    bundleBaseUrl: `http://127.0.0.1:${port}/a/snapshot-dev`,
    projectDir,
    startedAt: '2026-04-24T00:00:00.000Z',
    lastHeartbeatAt: '2026-04-24T00:00:00.000Z',
  }, registryPath);

  const server = await startAppDevServer({
    apps: [{
      slug: 'snapshot-dev',
      appId: 'app-1',
      targetAppId: 'installed-app-1',
      userId: 'user-1',
      sessionId: 'session-1',
      mountNonce: 'mount-1',
      projectDir,
    }],
    port,
    watch: false,
    sessionsFilePath: registryPath,
    log: () => {},
    logError: (message) => {
      throw new Error(message);
    },
  });

  t.after(async () => {
    await server.close();
  });

  const response = await fetch(`http://127.0.0.1:${port}/a/snapshot-dev/snapshot`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.app_id, 'app-1');
  assert.equal(body.target_app_id, 'installed-app-1');
  assert.equal(body.manifest.app.name, 'Snapshot App');
  assert.equal(body.files['bundle/app.js'], Buffer.from('console.log("snapshot");').toString('base64'));
  assert.equal(body.source_files['app/page.tsx'], Buffer.from('export default function Page() { return null; }\n').toString('base64'));
  assert.equal(body.source_files['.notis/output/bundle/app.js'], undefined);

  const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.deepEqual(health.apps, ['snapshot-dev']);
  assert.equal(health.sessions[0].appId, 'app-1');
  assert.equal(health.sessions[0].userId, 'user-1');
  assert.equal(health.sessions[0].devSlug, 'snapshot-dev');
  assert.equal(health.sessions[0].bundleBaseUrl, `http://127.0.0.1:${port}/a/snapshot-dev`);
  assert.equal(health.sessions[0].targetAppId, 'installed-app-1');

  const forgedLinkResponse = await fetch(`http://127.0.0.1:${port}/a/snapshot-dev/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: 'installed-app-2',
      version: 8,
      session_id: 'session-1',
      mount_nonce: 'wrong-nonce',
    }),
  });
  assert.equal(forgedLinkResponse.status, 403);
  assert.equal(readLinkedState(projectDir).app_id, undefined);

  const linkResponse = await fetch(`http://127.0.0.1:${port}/a/snapshot-dev/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: 'installed-app-1',
      version: 8,
      session_id: 'session-1',
      mount_nonce: 'mount-1',
    }),
  });
  assert.equal(linkResponse.status, 200);
  const linkBody = await linkResponse.json();
  assert.equal(linkBody.app_id, 'installed-app-1');
  assert.equal(linkBody.dev_app_id, 'app-1');
  const linkedState = readLinkedState(projectDir);
  assert.equal(linkedState.app_id, 'installed-app-1');
  assert.equal(linkedState.dev_app_id, 'app-1');
  assert.equal(linkedState.dev_linked_at, '2026-04-24T00:00:00.000Z');
  assert.equal(linkedState.version, 8);
  assert.ok(Date.parse(linkedState.deployed_at) > 0);
  const registry = readAppDevSessions(registryPath);
  assert.equal(registry.sessions[0].targetAppId, 'installed-app-1');
});

test('startAppDevServer link records same-id promotion without stale dev identity', async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-dev-promotion-link-'));
  const registryPath = join(projectDir, 'app-dev-sessions.json');
  const port = await getAvailablePort();
  writeLinkedState(projectDir, {
    dev_app_id: 'app-1',
    dev_linked_at: '2026-04-24T00:00:00.000Z',
  });
  upsertAppDevSessions({
    sessionId: 'session-promotion',
    userId: 'user-1',
    apiBase: 'https://api.notis.ai',
    appId: 'app-1',
    mountNonce: 'mount-promotion',
    devSlug: 'promotion-dev',
    bundleBaseUrl: `http://127.0.0.1:${port}/a/promotion-dev`,
    projectDir,
    startedAt: '2026-04-24T00:00:00.000Z',
    lastHeartbeatAt: '2026-04-24T00:00:00.000Z',
  }, registryPath);

  const server = await startAppDevServer({
    apps: [{
      slug: 'promotion-dev',
      appId: 'app-1',
      targetAppId: null,
      userId: 'user-1',
      sessionId: 'session-promotion',
      mountNonce: 'mount-promotion',
      projectDir,
    }],
    port,
    watch: false,
    sessionsFilePath: registryPath,
    log: () => {},
  });
  t.after(() => server.close());

  const promotionResponse = await fetch(`http://127.0.0.1:${port}/a/promotion-dev/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: 'app-1',
      version: 9,
      session_id: 'session-promotion',
      mount_nonce: 'mount-promotion',
    }),
  });
  assert.equal(promotionResponse.status, 200);
  const promotionBody = await promotionResponse.json();
  assert.equal(promotionBody.dev_app_id, null);
  const promotedState = readLinkedState(projectDir);
  assert.equal(promotedState.app_id, 'app-1');
  assert.equal(promotedState.version, 9);
  assert.equal(promotedState.dev_app_id, undefined);
  assert.equal(promotedState.dev_linked_at, undefined);
});

test('startAppDevServer prepares generated app entry and manifest before serving', async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-dev-prepare-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'prepare-app',
      private: true,
      scripts: { build: 'node -e "setInterval(() => {}, 1000)"' },
    }),
  );
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Prepare App',
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
});
`);

  const port = await getAvailablePort();
  const server = await startAppDevServer({
    apps: [{ slug: 'prepare-dev', appId: 'app-prepare', projectDir }],
    port,
    watch: true,
    log: () => {},
    logError: (message) => {
      throw new Error(message);
    },
  });

  t.after(async () => {
    await server.close();
  });

  assert.equal(
    readFileSync(join(projectDir, '.notis', '_entry.tsx'), 'utf-8'),
    "export { default as index } from '../app/page';\n",
  );
  const manifest = JSON.parse(readFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), 'utf-8'));
  assert.equal(manifest.app.name, 'Prepare App');
  assert.equal(manifest.routes[0].export_name, 'index');
});

test('buildDevelopmentAppHref matches Portal synthetic local development ids', () => {
  const manifest = {
    routes: [{ slug: 'day', default: true }],
  };
  assert.equal(
    buildDevelopmentAppHref({
      appSlug: 'calories-dev',
      appId: 'dev-runtime-id',
      devSlug: 'calories-dev',
      targetAppId: 'installed-app-id',
      targetAppSlug: 'calories',
      manifest,
    }),
    '/apps/calories-installed-app-id__local_dev__calories-dev/day',
  );
  assert.equal(
    buildDevelopmentAppHref({
      appSlug: 'calories-dev',
      appId: 'dev-runtime-id',
      devSlug: 'calories-dev',
      manifest,
    }),
    '/apps/calories-dev-dev-runtime-id__local_dev__calories-dev/day',
  );
});

// The catalog is the public app registry (github.com/mindtheflo/notis-apps):
// every published Store app is automatically a scaffold. Tests run against the
// local fixture registry so they stay hermetic.
const FIXTURE_REGISTRY_DIR = resolve('./fixtures/app-registry');

async function withFixtureRegistry(run) {
  const previous = process.env.NOTIS_APP_REGISTRY_DIR;
  process.env.NOTIS_APP_REGISTRY_DIR = FIXTURE_REGISTRY_DIR;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.NOTIS_APP_REGISTRY_DIR;
    } else {
      process.env.NOTIS_APP_REGISTRY_DIR = previous;
    }
  }
}

test('scaffold catalog lists published registry apps', async () => {
  await withFixtureRegistry(async () => {
    const catalog = await loadScaffoldCatalog();
    const entry = catalog.find((scaffold) => scaffold.slug === 'demo-dice');

    assert.ok(entry, 'fixture registry app missing from catalog');
    assert.equal(entry.name, 'Demo Dice');
    assert.equal(entry.tagline, 'Roll dice from a published Store app.');
    assert.equal(entry.categories[0], 'Personal');
    assert.equal(entry.icon, 'phosphor:dice-five');
  });
});

test('scaffold catalog search matches name, tagline, and category', async () => {
  await withFixtureRegistry(async () => {
    const catalog = await loadScaffoldCatalog();

    assert.equal(filterScaffoldCatalog(catalog, 'dice').length, 1);
    assert.equal(filterScaffoldCatalog(catalog, 'PERSONAL roll').length, 1);
    assert.equal(filterScaffoldCatalog(catalog, 'spreadsheet').length, 0);
    assert.equal(filterScaffoldCatalog(catalog, '  ').length, catalog.length);
  });
});

test('registry scaffold targets reject cross-platform traversal paths', () => {
  const root = join(tmpdir(), 'notis-scaffold-boundary');
  assert.equal(
    resolveScaffoldTargetPath(root, 'app/page.tsx'),
    join(root, 'app', 'page.tsx'),
  );
  for (const unsafe of [
    '../outside',
    '..\\outside',
    'app/../../outside',
    'app\\..\\..\\outside',
    '/absolute/path',
    'C:\\absolute\\path',
  ]) {
    assert.throws(
      () => resolveScaffoldTargetPath(root, unsafe),
      /Refusing (unsafe path|path outside scaffold directory)/,
    );
  }
});

function fakeRegistryResponse(body, { status = 200, binary = false } = {}) {
  const bytes = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => bytes.toString('utf-8'),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    binary,
  };
}

async function withRemoteRegistryFetch(fetchImpl, run) {
  const previousFetch = globalThis.fetch;
  const previousDir = process.env.NOTIS_APP_REGISTRY_DIR;
  const previousRepo = process.env.NOTIS_APP_REGISTRY_REPO;
  const previousRef = process.env.NOTIS_APP_REGISTRY_REF;
  delete process.env.NOTIS_APP_REGISTRY_DIR;
  process.env.NOTIS_APP_REGISTRY_REPO = 'example/scaffolds';
  process.env.NOTIS_APP_REGISTRY_REF = 'main';
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.NOTIS_APP_REGISTRY_DIR;
    else process.env.NOTIS_APP_REGISTRY_DIR = previousDir;
    if (previousRepo === undefined) delete process.env.NOTIS_APP_REGISTRY_REPO;
    else process.env.NOTIS_APP_REGISTRY_REPO = previousRepo;
    if (previousRef === undefined) delete process.env.NOTIS_APP_REGISTRY_REF;
    else process.env.NOTIS_APP_REGISTRY_REF = previousRef;
  }
}

test('remote scaffold resolves the registry ref once and downloads by immutable commit', async () => {
  const commitSha = 'a'.repeat(40);
  const urls = [];
  await withRemoteRegistryFetch(async (url) => {
    urls.push(String(url));
    if (String(url).includes('/commits/main')) {
      return fakeRegistryResponse(JSON.stringify({ sha: commitSha }));
    }
    if (String(url).includes(`/git/trees/${commitSha}`)) {
      return fakeRegistryResponse(JSON.stringify({ tree: [
        { type: 'blob', path: 'apps/demo/notis.config.ts' },
        { type: 'blob', path: 'apps/demo/app/page.tsx' },
      ] }));
    }
    return fakeRegistryResponse('export default {}');
  }, async () => {
    const source = await acquireScaffoldSource('demo');
    try {
      assert.equal(existsSync(join(source.dir, 'notis.config.ts')), true);
      assert.equal(existsSync(join(source.dir, 'app', 'page.tsx')), true);
    } finally {
      source.cleanup();
    }
  });

  const rawUrls = urls.filter((url) => url.includes('raw.githubusercontent.com'));
  assert.equal(rawUrls.length, 2);
  assert.ok(rawUrls.every((url) => url.includes(`/${commitSha}/`)));
  assert.equal(urls.filter((url) => url.includes('/commits/main')).length, 1);
});

test('remote scaffold accepts a bounded large GitHub commit-detail response', async () => {
  const commitSha = 'e'.repeat(40);
  await withRemoteRegistryFetch(async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/commits/main')) {
      return fakeRegistryResponse(JSON.stringify({
        sha: commitSha,
        files: [{ patch: 'x'.repeat(300 * 1024) }],
      }));
    }
    if (requestUrl.includes(`/git/trees/${commitSha}`)) {
      return fakeRegistryResponse(JSON.stringify({ tree: [
        { type: 'blob', path: 'apps/demo/notis.config.ts', size: 20 },
      ] }));
    }
    if (requestUrl.includes('raw.githubusercontent.com')) {
      return fakeRegistryResponse("export default { name: 'demo' };\n");
    }
    throw new Error(`unexpected registry request: ${requestUrl}`);
  }, async () => {
    const catalog = await loadScaffoldCatalog();
    assert.equal(catalog[0].slug, 'demo');
  });
});

test('remote scaffold rejects a truncated GitHub registry tree', async () => {
  const commitSha = 'd'.repeat(40);
  await withRemoteRegistryFetch(async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/commits/main')) {
      return fakeRegistryResponse(JSON.stringify({ sha: commitSha }));
    }
    if (requestUrl.includes(`/git/trees/${commitSha}`)) {
      return fakeRegistryResponse(JSON.stringify({ truncated: true, tree: [
        { type: 'blob', path: 'apps/demo/notis.config.ts' },
      ] }));
    }
    throw new Error(`unexpected download: ${requestUrl}`);
  }, async () => {
    await assert.rejects(loadScaffoldCatalog(), /tree was truncated/);
  });
});

test('failed remote scaffold waits for sibling downloads before removing its temp directory', async () => {
  const commitSha = 'b'.repeat(40);
  const before = new Set(
    readdirSync(tmpdir()).filter((name) => name.startsWith('notis-scaffold-')),
  );
  await withRemoteRegistryFetch(async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/commits/main')) {
      return fakeRegistryResponse(JSON.stringify({ sha: commitSha }));
    }
    if (requestUrl.includes(`/git/trees/${commitSha}`)) {
      return fakeRegistryResponse(JSON.stringify({ tree: [
        { type: 'blob', path: 'apps/demo/notis.config.ts' },
        { type: 'blob', path: 'apps/demo/app/late.tsx' },
      ] }));
    }
    if (requestUrl.endsWith('/apps/demo/notis.config.ts')) {
      throw new Error('fixture download failure');
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    return fakeRegistryResponse('export default function Late() {}', { binary: true });
  }, async () => {
    await assert.rejects(acquireScaffoldSource('demo'), /fixture download failure/);
  });

  const leaked = readdirSync(tmpdir())
    .filter((name) => name.startsWith('notis-scaffold-') && !before.has(name));
  assert.deepEqual(leaked, []);
});

test('remote scaffold refuses declared files above the source size limit', async () => {
  const commitSha = 'c'.repeat(40);
  await withRemoteRegistryFetch(async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/commits/main')) {
      return fakeRegistryResponse(JSON.stringify({ sha: commitSha }));
    }
    if (requestUrl.includes(`/git/trees/${commitSha}`)) {
      return fakeRegistryResponse(JSON.stringify({ tree: [
        { type: 'blob', path: 'apps/demo/notis.config.ts', size: 6 * 1024 * 1024 },
      ] }));
    }
    throw new Error(`unexpected download: ${requestUrl}`);
  }, async () => {
    await assert.rejects(acquireScaffoldSource('demo'), /file larger than/);
  });
});

test('scaffoldProject copies a published scaffold and renames slug plus title', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-from-'));

  await withFixtureRegistry(() => scaffoldProject({ projectDir, appName: 'Dice Lab', fromSlug: 'demo-dice' }));

  const config = readFileSync(join(projectDir, 'notis.config.ts'), 'utf-8');
  const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
  assert.match(config, /name:\s*'dice-lab'/);
  assert.match(config, /devSlug:\s*'dice-lab'/);
  assert.match(config, /title:\s*'Dice Lab'/);
  assert.equal(existsSync(join(projectDir, 'CHANGELOG.md')), true);
  assert.equal(existsSync(join(projectDir, 'app', 'page.tsx')), true);
  assert.equal(pkg.dependencies['@notis/sdk'], 'file:./packages/sdk');
  assert.equal(pkg.notisAppVersion, '0.1.0');
  assert.equal(pkg.scripts.build, 'vite build');
  assert.equal(pkg.scripts['generate-entry'], 'node -e ""');
  assert.equal(pkg.scripts.prebuild, undefined);
  assert.equal(existsSync(join(projectDir, 'packages', 'sdk', 'package.json')), true);
  assert.equal(existsSync(join(projectDir, 'package-lock.json')), true);
  const lockfile = JSON.parse(readFileSync(join(projectDir, 'package-lock.json'), 'utf-8'));
  assert.equal(lockfile.name, 'dice-lab');
  assert.equal(lockfile.packages[''].name, 'dice-lab');
});

test('scaffoldProject refuses a non-empty destination without overwriting it', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-non-empty-'));
  writeFileSync(join(projectDir, 'keep.txt'), 'keep me');

  await withFixtureRegistry(() => assert.rejects(
    scaffoldProject({ projectDir, appName: 'Dice Lab', fromSlug: 'demo-dice' }),
    /target must be empty/,
  ));

  assert.equal(readFileSync(join(projectDir, 'keep.txt'), 'utf8'), 'keep me');
  assert.equal(existsSync(join(projectDir, 'package.json')), false);
});

test('scaffoldProject refuses a symlinked destination', async () => {
  const parentDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-symlink-parent-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-symlink-outside-'));
  const projectDir = join(parentDir, 'target');
  writeFileSync(join(outsideDir, 'keep.txt'), 'keep me');
  symlinkSync(outsideDir, projectDir, 'dir');

  await withFixtureRegistry(() => assert.rejects(
    scaffoldProject({ projectDir, appName: 'Dice Lab', fromSlug: 'demo-dice' }),
    /unsafe target/,
  ));

  assert.equal(readFileSync(join(outsideDir, 'keep.txt'), 'utf8'), 'keep me');
  assert.equal(existsSync(join(outsideDir, 'package.json')), false);
});

test('scaffoldProject rejects source symlinks before normalizing staged files', async () => {
  const registryDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-source-symlink-registry-'));
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-source-symlink-target-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-source-symlink-outside-'));
  const outsidePackage = join(outsideDir, 'package.json');
  cpSync(FIXTURE_REGISTRY_DIR, registryDir, { recursive: true });
  writeFileSync(outsidePackage, '{"name":"outside","scripts":{}}\n');
  const packagePath = join(registryDir, 'apps', 'demo-dice', 'package.json');
  unlinkSync(packagePath);
  symlinkSync(outsidePackage, packagePath, 'file');
  const previousRegistryDir = process.env.NOTIS_APP_REGISTRY_DIR;
  process.env.NOTIS_APP_REGISTRY_DIR = registryDir;
  try {
    await assert.rejects(
      scaffoldProject({ projectDir, appName: 'Dice Lab', fromSlug: 'demo-dice' }),
      /Refusing symlinked scaffold source entry/,
    );
  } finally {
    if (previousRegistryDir === undefined) delete process.env.NOTIS_APP_REGISTRY_DIR;
    else process.env.NOTIS_APP_REGISTRY_DIR = previousRegistryDir;
  }

  assert.equal(readFileSync(outsidePackage, 'utf8'), '{"name":"outside","scripts":{}}\n');
  assert.deepEqual(readdirSync(projectDir), []);
});

test('scaffoldProject leaves an existing empty destination retryable after staging fails', async () => {
  const registryDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-invalid-registry-'));
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-retryable-'));
  cpSync(FIXTURE_REGISTRY_DIR, registryDir, { recursive: true });
  writeFileSync(join(registryDir, 'apps', 'demo-dice', 'package.json'), '{invalid json');
  const previousRegistryDir = process.env.NOTIS_APP_REGISTRY_DIR;
  process.env.NOTIS_APP_REGISTRY_DIR = registryDir;
  try {
    await assert.rejects(
      scaffoldProject({ projectDir, appName: 'Dice Lab', fromSlug: 'demo-dice' }),
      /JSON/,
    );
  } finally {
    if (previousRegistryDir === undefined) delete process.env.NOTIS_APP_REGISTRY_DIR;
    else process.env.NOTIS_APP_REGISTRY_DIR = previousRegistryDir;
  }

  assert.deepEqual(readdirSync(projectDir), []);
});

test('scaffoldProject makes composed legacy generate-entry calls portable without parsing shell source', async () => {
  const registryDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-custom-prebuild-registry-'));
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-custom-prebuild-'));
  cpSync(FIXTURE_REGISTRY_DIR, registryDir, { recursive: true });
  const packagePath = join(registryDir, 'apps', 'demo-dice', 'package.json');
  const fixturePackage = JSON.parse(readFileSync(packagePath, 'utf8'));
  fixturePackage.scripts.prebuild = 'npm run generate-entry && npm run typecheck';
  fixturePackage.scripts.dev = 'npm run generate-entry && vite';
  fixturePackage.scripts.prepare = "sh -c 'npm run generate-entry'";
  fixturePackage.scripts.inspect = `node -e "console.log('a&&b')" && npm run generate-entry`;
  fixturePackage.scripts.alternate = 'npm run-script generate-entry';
  writeFileSync(packagePath, `${JSON.stringify(fixturePackage, null, 2)}\n`);
  const previousRegistryDir = process.env.NOTIS_APP_REGISTRY_DIR;
  process.env.NOTIS_APP_REGISTRY_DIR = registryDir;
  try {
    await scaffoldProject({ projectDir, appName: 'Custom Build', fromSlug: 'demo-dice' });
  } finally {
    if (previousRegistryDir === undefined) delete process.env.NOTIS_APP_REGISTRY_DIR;
    else process.env.NOTIS_APP_REGISTRY_DIR = previousRegistryDir;
  }

  const scaffoldPackage = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
  assert.equal(scaffoldPackage.scripts['generate-entry'], 'node -e ""');
  assert.equal(scaffoldPackage.scripts.prebuild, 'npm run generate-entry && npm run typecheck');
  assert.equal(scaffoldPackage.scripts.dev, 'npm run generate-entry && vite');
  assert.equal(scaffoldPackage.scripts.prepare, "sh -c 'npm run generate-entry'");
  assert.equal(scaffoldPackage.scripts.inspect, `node -e "console.log('a&&b')" && npm run generate-entry`);
  assert.equal(scaffoldPackage.scripts.alternate, 'npm run-script generate-entry');
});

test('scaffoldProject rejects a slug missing from the registry', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-unknown-'));

  await withFixtureRegistry(() =>
    assert.rejects(
      scaffoldProject({ projectDir, appName: 'Nope', fromSlug: 'not-a-published-app' }),
      /Unknown scaffold "not-a-published-app"\. Available scaffolds: demo-dice/,
    ));
});

test('scaffoldProject leaves listing and registry artifacts behind', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-listing-'));

  await withFixtureRegistry(() => scaffoldProject({ projectDir, appName: 'Dice Lab', fromSlug: 'demo-dice' }));

  const metadata = existsSync(join(projectDir, 'metadata'))
    ? readdirSync(join(projectDir, 'metadata'))
    : [];
  assert.deepEqual(metadata.filter((entry) => /^screenshot-\d+\.png$/.test(entry)), []);
  // The fixtures file is harness stub data, not listing media: a fresh project
  // must keep it or every route renders its empty state under `apps dev`.
  assert.ok(metadata.includes('screenshot-fixtures.json'));
  // Registry bookkeeping describes the published app, not the new project.
  assert.equal(existsSync(join(projectDir, 'notis-listing.json')), false);
  assert.equal(existsSync(join(projectDir, 'screenshots')), false);

  const config = readFileSync(join(projectDir, 'notis.config.ts'), 'utf-8');
  assert.doesNotMatch(config, /screenshots\s*:/);
  assert.doesNotMatch(config, /metadata\/screenshot-/);
  // The rest of the listing declaration must survive the screenshot removal.
  assert.match(config, /tagline:/);
  assert.match(config, /routes:\s*\[/);

  const changelog = readFileSync(join(projectDir, 'CHANGELOG.md'), 'utf-8');
  assert.match(changelog, /^# Dice Lab Changelog/);
  assert.equal(changelog.match(/^## \[/gm).length, 1);
});

test('apps doctor distinguishes deployed links from local development identities', () => {
  assert.equal(doctorLinkSummary({ app_id: 'app-1', dev_app_id: 'dev-1' }), ' Linked to app app-1.');
  assert.equal(
    doctorLinkSummary({ dev_app_id: 'dev-1' }),
    ' Local development app dev-1 is active.',
  );
  assert.equal(doctorLinkSummary(null), ' Not linked.');
});

test('scaffoldProject renames the bare template slug plus title', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-bare-'));

  await scaffoldProject({ projectDir, appName: 'Mind the Flo' });

  const config = readFileSync(join(projectDir, 'notis.config.ts'), 'utf-8');
  assert.match(config, /name:\s*'mind-the-flo'/);
  assert.match(config, /devSlug:\s*'mind-the-flo'/);
  assert.match(config, /title:\s*'Mind the Flo'/);
});

test('listing readiness validates the locked category enum', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-listing-category-'));

  assert.throws(
    () => inspectListingReadiness(projectDir, { categories: ['Developer Tools'] }),
    /Invalid Notis app category/,
  );
});

test('workspace database catalog apps do not get an empty database warning', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-workspace-database-warning-'));

  const ordinaryWarnings = detectProjectWarnings(projectDir, { databases: [] });
  assert.match(ordinaryWarnings.join('\n'), /No database references declared/);

  const catalogWarnings = detectProjectWarnings(projectDir, {
    databases: [],
    capabilities: { workspaceDatabases: 'read' },
  });
  assert.doesNotMatch(catalogWarnings.join('\n'), /No database references declared/);
});

test('cloud shell consent is explicit, recorded, and never inferred from authorship', async () => {
  const { resolveCloudShellConsent } = await import('../src/command-specs/apps.js');
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-cloud-shell-consent-'));
  mkdirSync(join(projectDir, '.notis'), { recursive: true });
  const warnings = [];
  const logger = { warn: (message) => warnings.push(message) };
  const shellApp = { name: 'Workspaces', capabilities: { cloudComputer: 'shell' } };

  // A read-only declaration asks for nothing here.
  assert.equal(
    await resolveCloudShellConsent({
      appConfig: { name: 'Reader', capabilities: { cloudComputer: 'read' } },
      projectDir,
      logger,
    }),
    null,
  );

  // Non-interactive without a recorded decision: no grant, actionable warning.
  const denied = await resolveCloudShellConsent({ appConfig: shellApp, projectDir, logger });
  assert.equal(denied, null);
  assert.match(warnings.join('\n'), /--grant-cloud-shell/);

  // The flag grants and records; the next run reuses the recorded decision.
  const granted = await resolveCloudShellConsent({
    appConfig: shellApp,
    projectDir,
    grantCloudShell: true,
    logger,
  });
  assert.deepEqual(granted, ['cloud_computer_read', 'cloud_computer_shell']);
  const remembered = await resolveCloudShellConsent({ appConfig: shellApp, projectDir, logger });
  assert.deepEqual(remembered, ['cloud_computer_read', 'cloud_computer_shell']);
});

test('capability normalization accepts both cloudComputer values and drops the rest', () => {
  assert.deepEqual(normalizeAppCapabilities({ cloudComputer: 'read' }), { cloudComputer: 'read' });
  assert.deepEqual(normalizeAppCapabilities({ cloudComputer: 'shell' }), { cloudComputer: 'shell' });
  assert.deepEqual(normalizeAppCapabilities({ cloudComputer: 'write' }), {});
  assert.deepEqual(
    normalizeAppCapabilities({ workspaceDatabases: 'read', cloudComputer: 'shell', bogus: true }),
    { workspaceDatabases: 'read', cloudComputer: 'shell' },
  );
});

test('tool binding normalization keeps only exact public/provider name pairs', () => {
  assert.deepEqual(
    normalizeAppToolBindings([
      { name: ' LOCAL_MCP_SITE_EXECUTE_SQL ', providerToolName: ' execute_sql ' },
      { name: '', providerToolName: 'ignored' },
      { name: 'LOCAL_MCP_SITE_MISSING' },
    ]),
    [{ name: 'LOCAL_MCP_SITE_EXECUTE_SQL', provider_tool_name: 'execute_sql' }],
  );
});

function listingPng(width = 2000, height = 1250) {
  const content = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(content, 0);
  content.writeUInt32BE(width, 16);
  content.writeUInt32BE(height, 20);
  return content;
}

function writeListingChangelog(projectDir) {
  writeFileSync(
    join(projectDir, 'CHANGELOG.md'),
    '# App Changelog\n\n## [Initial Release] - {PR_MERGE_DATE}\n\n- First release.\n',
  );
}

test('listing readiness requires three exact screenshots with alt text', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-listing-media-'));
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name: 'listing-media',
    version: '0.1.0',
    notisAppVersion: '0.1.0',
  }));
  writeListingChangelog(projectDir);
  mkdirSync(join(projectDir, 'metadata'));
  for (let index = 1; index <= 3; index += 1) {
    writeFileSync(join(projectDir, 'metadata', `screenshot-${index}.png`), listingPng());
  }
  const config = {
    tagline: 'See the patterns in your days.',
    categories: ['Personal'],
    screenshots: [1, 2, 3].map((index) => ({
      path: `metadata/screenshot-${index}.png`,
      alt: `Journal state ${index}`,
      focus: index === 2 ? '[data-journal-detail]' : undefined,
      theme: index === 2 ? 'dark' : 'light',
    })),
  };

  const ready = inspectListingReadiness(projectDir, config);
  assert.equal(ready.ready, true);
  assert.equal(ready.metadata.screenshots[1].focus, '[data-journal-detail]');
  assert.equal(ready.metadata.screenshots[1].theme, 'dark');

  config.screenshots[0].alt = '';
  const missingAlt = inspectListingReadiness(projectDir, config);
  assert.equal(missingAlt.ready, false);
  assert.match(missingAlt.errors.join('\n'), /missing descriptive alt text/);

  config.screenshots[0].alt = 'Journal overview';
  writeFileSync(join(projectDir, 'metadata', 'screenshot-1.png'), listingPng(1600, 1000));
  const wrongDimensions = inspectListingReadiness(projectDir, config);
  assert.equal(wrongDimensions.ready, false);
  assert.match(wrongDimensions.errors.join('\n'), /exactly 2000x1250/);

  config.screenshots[0].theme = 'sepia';
  assert.throws(
    () => inspectListingReadiness(projectDir, config),
    /theme must be light or dark/,
  );
});

test('listing readiness requires the registry app version contract', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-listing-version-'));
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name: 'listing-version',
    version: '0.1.0',
  }));

  const readiness = inspectListingReadiness(projectDir, {});
  assert.equal(readiness.ready, false);
  assert.match(readiness.errors.join('\n'), /notisAppVersion/);
});

test('screenshot cleanup only prunes stale files during a full successful refresh', () => {
  assert.equal(shouldPruneStaleScreenshotFiles(null, 0), true);
  assert.equal(shouldPruneStaleScreenshotFiles(['home'], 0), false);
  assert.equal(shouldPruneStaleScreenshotFiles(null, 1), false);

  const outputDir = mkdtempSync(join(tmpdir(), 'notis-screenshots-'));
  writeFileSync(join(outputDir, 'screenshot-1.png'), 'one');
  writeFileSync(join(outputDir, 'screenshot-2.png'), 'two');
  writeFileSync(join(outputDir, 'screenshot-3.png'), 'three');
  writeFileSync(join(outputDir, 'notes.txt'), 'keep');

  pruneStaleScreenshotFiles(outputDir, 2);

  assert.equal(existsSync(join(outputDir, 'screenshot-1.png')), true);
  assert.equal(existsSync(join(outputDir, 'screenshot-2.png')), true);
  assert.equal(existsSync(join(outputDir, 'screenshot-3.png')), false);
  assert.equal(existsSync(join(outputDir, 'notes.txt')), true);
});

test('selected route screenshots keep their full-manifest slot numbers', () => {
  const slots = screenshotIndexByRouteSlug({
    routes: [
      { slug: 'home' },
      { slug: 'history' },
      { slug: 'settings' },
    ],
  });

  assert.equal(slots.get('home'), 1);
  assert.equal(slots.get('history'), 2);
  assert.equal(slots.get('settings'), 3);
});

test('manifest display title and accent are forwarded to app row fields', () => {
  assert.deepEqual(
    appRowFieldsFromManifest({ app: { name: 'internal-slug', title: 'Display Title', accent: 'mint' } }),
    { name: 'Display Title', accent: 'mint' },
  );
  assert.deepEqual(
    appRowFieldsFromManifest({ app: { name: 'Legacy Display Name' } }),
    { name: 'Legacy Display Name', accent: null },
  );
  assert.deepEqual(
    appRowFieldsFromManifest({ app: {} }),
    { accent: null },
  );
});

test('screenshot command exits nonzero when any capture fails', () => {
  assert.equal(screenshotExitCode(0), 0);
  assert.notEqual(screenshotExitCode(1), 0);
});

test('app dev session registry upserts, heartbeats, and removes sessions', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'notis-app-dev-sessions-'));
  const registryPath = join(workspace, 'app-dev-sessions.json');
  const startedAt = new Date(0).toISOString();
  const lastHeartbeatAt = new Date(1_000).toISOString();

  upsertAppDevSessions({
    sessionId: 'session-1',
    userId: 'user-1',
    apiBase: 'https://api.notis.ai',
    appId: 'app-1',
    targetAppId: 'installed-app-1',
    devSlug: 'notes-dev',
    bundleBaseUrl: 'http://127.0.0.1:5173/a/notes-dev',
    projectDir: workspace,
    startedAt,
    lastHeartbeatAt,
  }, registryPath);

  assert.equal(readAppDevSessions(registryPath).sessions.length, 1);
  assert.equal(readAppDevSessions(registryPath).sessions[0].targetAppId, 'installed-app-1');
  linkAppDevSessionTarget({ appId: 'app-1', targetAppId: 'app-1' }, registryPath);
  assert.equal(readAppDevSessions(registryPath).sessions[0].targetAppId, 'app-1');
  heartbeatAppDevSession('session-1', new Date(2_000).toISOString(), registryPath);
  assert.equal(readAppDevSessions(registryPath).sessions[0].lastHeartbeatAt, new Date(2_000).toISOString());
  removeAppDevSession('session-1', registryPath);
  assert.deepEqual(readAppDevSessions(registryPath).sessions, []);
});

test('direct deploy requires edit access and refuses development identities', async () => {
  const runtime = {};
  await assert.rejects(
    assertDirectDeployAccess(runtime, 'read-only-app', async () => ({
      payload: { app: { id: 'read-only-app', can_edit: false, manifest: {} }, apps_access: { has_access: true } },
    })),
    /requires edit access/,
  );
  await assert.rejects(
    assertDirectDeployAccess(runtime, 'dev-app', async () => ({
      payload: { app: { id: 'dev-app', can_edit: true, manifest: { is_dev: true } }, apps_access: { has_access: true } },
    })),
    /cannot be deployed directly/,
  );
});

test('ensureDevInstall keeps installed target separate from hidden dev runtime app', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-ensure-dev-install-'));
  writeLinkedState(projectDir, {
    app_id: 'installed-app-1',
    dev_app_id: 'dev-runtime-app-1',
    linked_at: '2026-04-24T00:00:00.000Z',
    dev_linked_at: '2026-04-24T00:00:01.000Z',
  });
  const calls = [];

  const result = await ensureDevInstall({
    ctx: { runtime: { apiBase: 'https://api.notis.ai' } },
    projectDir,
    appConfig: {
      name: 'Notes',
      routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    },
    idempotencyKey: 'test-key',
    runTool: async (call) => {
      calls.push(call);
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return call.arguments_.app_id === 'dev-runtime-app-1'
          ? { payload: { app: { id: 'dev-runtime-app-1', manifest: { is_dev: true } } } }
          : { payload: { app: { id: 'installed-app-1', manifest: { is_dev: false } } } };
      }
      if (call.toolName === 'LOCAL_NOTIS_ENSURE_DEV_APP_INSTALLATION') {
        return { payload: { app_id: 'dev-runtime-app-1', slug: 'notes-dev' } };
      }
      throw new Error(`Unexpected tool ${call.toolName}`);
    },
  });

  assert.equal(result.appId, 'dev-runtime-app-1');
  assert.equal(result.targetAppId, 'installed-app-1');
  assert.equal(calls[2].toolName, 'LOCAL_NOTIS_ENSURE_DEV_APP_INSTALLATION');
  assert.equal(calls[2].arguments_.app_id, 'dev-runtime-app-1');
  const state = readLinkedState(projectDir);
  assert.equal(state.app_id, 'installed-app-1');
  assert.equal(state.dev_app_id, 'dev-runtime-app-1');
});

test('ensureDevInstall migrates legacy dev app links into dev_app_id', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-ensure-dev-legacy-'));
  writeLinkedState(projectDir, {
    app_id: 'legacy-dev-app',
    linked_at: '2026-04-24T00:00:00.000Z',
    version: 1,
  });

  await ensureDevInstall({
    ctx: { runtime: { apiBase: 'https://api.notis.ai' } },
    projectDir,
    appConfig: {
      name: 'Legacy Dev',
      routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    },
    idempotencyKey: 'test-key',
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return { payload: { app: { id: 'legacy-dev-app', manifest: { is_dev: true } } } };
      }
      if (call.toolName === 'LOCAL_NOTIS_ENSURE_DEV_APP_INSTALLATION') {
        assert.equal(call.arguments_.app_id, 'legacy-dev-app');
        return { payload: { app_id: 'legacy-dev-app', slug: 'legacy-dev-dev' } };
      }
      if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
        return { payload: { apps: [] } };
      }
      throw new Error(`Unexpected tool ${call.toolName}`);
    },
  });

  const state = readLinkedState(projectDir);
  assert.equal(state.app_id, undefined);
  assert.equal(state.dev_app_id, 'legacy-dev-app');
  assert.equal(state.version, undefined);
});

test('apps roots commands are registered for persistent discovery', () => {
  const paths = new Set(COMMAND_SPECS.map((spec) => spec.command_path.join(' ')));
  assert.equal(paths.has('apps roots list'), true);
  assert.equal(paths.has('apps roots remove'), true);
});

test('authenticated commands fail with a JSON auth envelope in non-interactive mode', () => {
  const result = runCli(['apps', 'list', '--json', '--non-interactive'], {
    NOTIS_API_BASE: 'http://localhost:3001',
  });
  assert.equal(result.status, 3);
  assert.equal(result.stderr, '');

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'auth_missing');
  // A machine that was never signed in may not have an account yet, and
  // `notis login` both creates one and authorizes this machine.
  assert.equal(
    payload.hints[0].command,
    'npx --package @notis_ai/cli@latest -- notis login',
  );
  assert.ok(payload.hints.some(
    (hint) => hint.command === 'npx --package @notis_ai/cli@latest -- notis profile list',
  ));
});

test('an expired OAuth grant points at re-authorizing the profile that failed', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'notis-cli-expired-home-'));
  mkdirSync(join(homeDir, '.notis'), { recursive: true });
  writeFileSync(
    join(homeDir, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'work',
      profiles: {
        default: {},
        work: {
          oauth_access_token: makeJwt('auth-user-123', 1),
          oauth_access_expires_at: 1,
          api_base: 'https://api-beta.notis.ai',
          oauth_api_base: 'https://api-beta.notis.ai',
        },
      },
    }),
  );

  const result = runCli(['apps', 'list', '--json', '--non-interactive'], { HOME: homeDir });
  assert.equal(result.status, 3, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'auth_expired');
  assert.equal(payload.error.details.credential_source, 'oauth');
  assert.match(payload.error.message, /"work"/);
  // The profile lives on api-beta, so recovery must point at the beta build:
  // reinstalling `@latest` would send it back to the channel it failed on.
  assert.equal(
    payload.hints[0].command,
    "npx --package @notis_ai/cli@beta -- notis login --profile 'work'",
  );
});

// A dev credential is only spendable against the loopback backend that minted
// it. Falling through to the live API would authenticate there as the test user.
test('a dev.sh profile without its runtime refuses to route to the live API', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'notis-cli-dev-detached-home-'));
  mkdirSync(join(homeDir, '.notis'), { recursive: true });
  writeFileSync(
    join(homeDir, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {},
        'dev-somewhere': {
          api_base: 'http://localhost:4311',
          dev_access_token: makeJwt('test-user'),
          dev_access_expires_at: 4102444800,
          dev_user_id: 'test-user',
          dev_workspace_root: '/tmp/somewhere',
        },
      },
    }),
  );

  const result = runCli(
    ['--profile', 'dev-somewhere', 'apps', 'list', '--json', '--non-interactive'],
    { HOME: homeDir },
  );
  assert.equal(result.status, 4, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'dev_runtime_unavailable');
  assert.match(payload.hints[0].message, /\/tmp\/somewhere/);
});

test('expired NOTIS_JWT never falls back to a stored profile', () => {
  const result = runCli(['apps', 'list', '--json', '--non-interactive'], {
    NOTIS_API_BASE: 'https://api.notis.ai',
    NOTIS_JWT: makeJwt('auth-user-123', 1),
  });
  assert.equal(result.status, 3, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'auth_expired');
  assert.equal(payload.error.details.credential_source, 'env');
  assert.match(payload.hints[0].command, /NOTIS_JWT/);
});

test('describe tools exec includes --get-schema and --dry-run options', () => {
  const result = runCli(['describe', 'tools', 'exec', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.spec.command_path.join(' '), 'tools exec');

  const optionFlags = (payload.data.spec.args_schema.options || []).map((o) => o.flags);
  assert.ok(optionFlags.some((f) => f.includes('--get-schema')), 'should have --get-schema option');
  assert.ok(optionFlags.some((f) => f.includes('--dry-run')), 'should have --dry-run option');
  assert.ok(optionFlags.some((f) => f.includes('--arguments-file')), 'should have --arguments-file option');
  assert.ok(!optionFlags.some((f) => f.includes('--toolkits')), 'should not keep legacy --toolkits option');
});

test('debug and smoke first-class commands are registered', () => {
  const userContext = runCli(['describe', 'debug', 'user-context', '--json']);
  const smoke = runCli(['describe', 'smoke', 'file-upload', '--json']);
  assert.equal(userContext.status, 0, userContext.stderr);
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.equal(JSON.parse(userContext.stdout).data.spec.mutates, false);
  assert.equal(JSON.parse(smoke.stdout).data.spec.mutates, true);
});

test('tool mutation metadata distinguishes reads, writes, and unknown tools', () => {
  assert.equal(classifyToolMutation('LOCAL_NOTIS_DATABASE_QUERY'), false);
  assert.equal(classifyToolMutation('DROPBOX_GET_METADATA'), false);
  assert.equal(classifyToolMutation('DROPBOX_UPLOAD_FILE'), true);
  assert.equal(classifyToolMutation('SLACK_FIND_OR_CREATE_CONVERSATION'), true);
  assert.equal(classifyToolMutation('GMAIL_GET_OR_CREATE_LABEL'), true);
  assert.equal(classifyToolMutation('LOCAL_NOTIS_GET_APP_UPDATE_CONTEXT'), false);
  assert.equal(
    classifyToolMutation('LOCAL_MCP_SUPABASE_EXECUTE_SQL', { query: 'select * from users' }),
    null,
  );
  assert.equal(
    classifyToolMutation('LOCAL_MCP_SUPABASE_EXECUTE_SQL', { query: 'update users set beta = true' }),
    true,
  );
  assert.equal(
    classifyToolMutation('LOCAL_MCP_SUPABASE_EXECUTE_SQL', {
      query: 'EXPLAIN ANALYZE DELETE FROM users WHERE user_id = 1',
    }),
    true,
  );
  assert.equal(
    classifyToolMutation('LOCAL_MCP_SUPABASE_EXECUTE_SQL', {
      query: 'EXPLAIN (ANALYZE, BUFFERS) UPDATE users SET beta = true',
    }),
    true,
  );
  assert.equal(
    classifyToolMutation('LOCAL_MCP_SUPABASE_EXECUTE_SQL', {
      query: 'EXPLAIN DELETE FROM users WHERE user_id = 1',
    }),
    false,
  );
  assert.equal(
    classifyToolMutation('LOCAL_MCP_SUPABASE_EXECUTE_SQL', {
      query: 'SELECT 1; UPDATE users SET beta = true',
    }),
    true,
  );
  assert.equal(
    classifyToolMutation('LOCAL_MCP_SUPABASE_EXECUTE_SQL', {
      query: "SELECT 'a; UPDATE users SET beta = true'",
    }),
    null,
  );
  assert.equal(
    classifyToolMutation('LOCAL_MCP_SUPABASE_EXECUTE_SQL', {
      query: 'SELECT public.portal_delete_automation_template(1)',
    }),
    null,
  );
  assert.equal(classifyToolMutation('CUSTOM_DO_MAGIC'), null);
});

test('debug override accepts plain and base64url JSON', () => {
  const value = { reference_user: 'user-1', expires_at: '2030-01-01T00:00:00Z' };
  assert.deepEqual(parseDebugEntitlementOverride(JSON.stringify(value)), value);
  assert.deepEqual(
    parseDebugEntitlementOverride(Buffer.from(JSON.stringify(value)).toString('base64url')),
    value,
  );
});

test('malformed debug override remains inside the structured CLI error envelope', () => {
  const result = runCli(['describe', 'whoami', '--json'], {
    NOTIS_DEBUG_ENTITLEMENT_OVERRIDE: 'not-json',
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'debug_entitlement_override_invalid');
  assert.match(payload.error.message, /JSON object or base64url-encoded JSON object/);
});

test('user context SQL falls back to a team owned by a user with a stale team id', () => {
  const sql = buildUserContextSql('user-1');
  assert.match(sql, /'created_at', to_jsonb\(effective\)->>'created_at'/);
  assert.match(sql, /OR t\.owner_id = target\.user_id/);
  assert.doesNotMatch(sql, /target\.team_id IS NULL AND t\.owner_id/);
  assert.match(sql, /ORDER BY CASE WHEN t\.id::text = target\.team_id::text THEN 0 ELSE 1 END/);
});

test('trace diagnostics use recorded generation, retry, failure, and model fields', () => {
  const tracePath = join(mkdtempSync(join(tmpdir(), 'notis-trace-')), 'trace.json');
  writeFileSync(tracePath, JSON.stringify({
    observations: [
      { id: 'gen-1', type: 'GENERATION', model: 'gpt-test', status: 'success' },
      { id: 'retry-1', type: 'EVENT', name: 'tool retry', status: 'success' },
      { id: 'tool-1', type: 'TOOL', name: 'Dropbox upload tool', status: 'error' },
    ],
  }));
  assert.deepEqual(traceFileDiagnostics(tracePath), {
    generations: 1,
    retries: 1,
    tool_failures: 1,
    model_counts: { 'gpt-test': 1 },
    source: tracePath,
  });
});

test('SQL diagnostics parse the Supabase MCP untrusted-data envelope', () => {
  const payload = {
    data: {
      results: [{
        response: {
          data: {
            result: 'Below is data within the below <untrusted-data-abc> boundaries.\\n\\n<untrusted-data-abc>\\n[{"context":{"billing":{"scope_type":"user"}}}]\\n</untrusted-data-abc>',
          },
        },
      }],
    },
  };
  assert.equal(extractSqlRows(payload)[0].context.billing.scope_type, 'user');
});

test('SQL diagnostics preserve escaped newlines inside untrusted JSON values', () => {
  const payload = {
    data: {
      results: [{
        response: {
          data: {
            result: 'Envelope\\n<untrusted-data-abc>\\n[{"interaction":{"error":"line1\\nline2"}}]\\n</untrusted-data-abc>',
          },
        },
      }],
    },
  };

  assert.equal(extractSqlRows(payload)[0].interaction.error, 'line1\nline2');
});

test('tools exec remains the database execution path', async () => {
  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', documents: [] }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'tools',
        'exec',
        'LOCAL_NOTIS_DATABASE_QUERY',
        '--arguments',
        '{"database_slug":"tasks","query":{"page_size":10}}',
      ],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.tool_name, 'COMPOSIO_MULTI_EXECUTE_TOOL');
    assert.deepEqual(requestBody.arguments, {
      tools: [{ tool_slug: 'LOCAL_NOTIS_DATABASE_QUERY', arguments: { database_slug: 'tasks', query: { page_size: 10 } } }],
    });
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.meta.mutating, false);
    assert.match(payload.meta.idempotency_key, /^[A-Za-z0-9._:~-]{8,160}$/);
    assert.equal(requestBody.idempotency_key, payload.meta.idempotency_key);
    assert.match(payload.request_id, /^req_/);
    assert.match(result.stderr, /\[prepare\].*\[execute\].*\[complete\]/s);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('tools exec reads JSON from --arguments-file', async () => {
  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'success' }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const argumentsPath = join(mkdtempSync(join(tmpdir(), 'notis-cli-args-')), 'arguments.json');
  writeFileSync(argumentsPath, JSON.stringify({ database_slug: 'tasks', query: { page_size: 3 } }));
  try {
    const result = await runCliAsync([
      '--json', '--api-base', `http://127.0.0.1:${port}`,
      'tools', 'exec', 'LOCAL_NOTIS_DATABASE_QUERY',
      '--arguments-file', argumentsPath,
    ], { NOTIS_JWT: makeJwt() });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.arguments.tools[0].arguments.query.page_size, 3);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('tools exec does not rewrite unknown underscore aliases', async () => {
  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'success' }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'tools',
        'exec',
        'legacy_query_alias',
        '--arguments',
        '{}',
      ],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(requestBody.arguments, {
      tools: [{ tool_slug: 'legacy_query_alias', arguments: {} }],
    });
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('tools exec sends multipart file bindings when --file is provided', async () => {
  let requestContentType = null;
  let requestBody = null;
  const uploadPath = join(mkdtempSync(join(tmpdir(), 'notis-cli-upload-')), 'invoice.pdf');
  writeFileSync(uploadPath, 'pdf-bytes');
  const expectedHash = '29d1283686193dc1461a7deac4f53d9bc5402a28b95d854f69e94986756fd0a9';

  const server = createHttpServer(async (req, res) => {
    requestContentType = req.headers['content-type'];
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = Buffer.concat(chunks).toString('utf-8');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'success' }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'tools',
        'exec',
        'composio-dropbox-upload_file',
        '--arguments',
        '{"path":"/target/in/dropbox.pdf"}',
        '--file',
        `content=${uploadPath}`,
      ],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(requestContentType, /^multipart\/form-data; boundary=/);
    assert.match(requestBody, /name="payload"/);
    assert.match(requestBody, /"tool_name":"COMPOSIO_MULTI_EXECUTE_TOOL"/);
    assert.match(requestBody, /"tool_slug":"composio-dropbox-upload_file"/);
    assert.match(requestBody, /"argument_path":"content"/);
    assert.match(requestBody, /"field_name":"file_0"/);
    assert.match(requestBody, /"basename":"invoice\.pdf"/);
    assert.match(requestBody, new RegExp(`"sha256":"${expectedHash}"`));
    assert.match(requestBody, /filename="invoice\.pdf"/);
    assert.match(requestBody, /pdf-bytes/);
    assert.equal(requestBody.includes(uploadPath), false);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('tools exec supports JSON Pointer file binding targets', async () => {
  let requestBody = null;
  const uploadPath = join(mkdtempSync(join(tmpdir(), 'notis-cli-upload-')), 'nested.txt');
  writeFileSync(uploadPath, 'nested');

  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = Buffer.concat(chunks).toString('utf-8');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'success' }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'tools',
        'exec',
        'composio-example-upload',
        '--arguments',
        '{"items":[{"name":"first"}]}',
        '--file',
        `/items/0/content=${uploadPath}`,
      ],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(requestBody, /"argument_path":"\/items\/0\/content"/);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('tools exec rejects missing --file local paths before transport', async () => {
  const result = await runCliAsync(
    [
      '--json',
      '--api-base',
      'http://127.0.0.1:9',
      'tools',
      'exec',
      'composio-dropbox-upload_file',
      '--arguments',
      '{}',
      '--file',
      'content=/tmp/notis-missing-file.pdf',
    ],
    { NOTIS_JWT: makeJwt() },
  );

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, /File not found/);
});

test('tools exec-parallel rejects --file with a clear usage error', async () => {
  const uploadPath = join(mkdtempSync(join(tmpdir(), 'notis-cli-upload-')), 'invoice.pdf');
  writeFileSync(uploadPath, 'pdf-bytes');

  const result = await runCliAsync(
    [
      '--json',
      '--api-base',
      'http://127.0.0.1:9',
      'tools',
      'exec-parallel',
      '[{"tool_name":"LOCAL_NOTIS_DATABASE_QUERY","arguments":{}}]',
      '--file',
      `content=${uploadPath}`,
    ],
    { NOTIS_JWT: makeJwt() },
  );

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, /tools exec/);
});

test('describe tools exec-parallel is registered', () => {
  const result = runCli(['describe', 'tools', 'exec-parallel', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.spec.command_path.join(' '), 'tools exec-parallel');
  assert.equal(payload.data.spec.backend_call.name, 'COMPOSIO_MULTI_EXECUTE_TOOL');
});

test('validateArguments reports missing required fields', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      count: { type: 'integer' },
    },
    required: ['name'],
    additionalProperties: false,
  };

  const errors = validateArguments(schema, { count: 5 });
  assert.ok(errors.some((e) => e.includes('Missing required field: "name"')));
});

test('validateArguments reports unknown fields', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: [],
    additionalProperties: false,
  };

  const errors = validateArguments(schema, { name: 'ok', bogus: true });
  assert.ok(errors.some((e) => e.includes('Unknown field: "bogus"')));
});

test('validateArguments reports type mismatches', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      count: { type: 'integer' },
      tags: { type: 'array' },
      meta: { type: 'object' },
    },
    required: [],
  };

  const errors = validateArguments(schema, {
    name: 123,
    count: 'not-a-number',
    tags: 'not-an-array',
    meta: 'not-an-object',
  });

  assert.equal(errors.length, 4);
});

test('validateArguments returns empty for valid input', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  };

  const errors = validateArguments(schema, { name: 'hello' });
  assert.equal(errors.length, 0);
});

test('describe whoami is registered', () => {
  const result = runCli(['describe', 'whoami', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.spec.command_path.join(' '), 'whoami');
  assert.equal(payload.data.spec.backend_call.name, 'COMPOSIO_SEARCH_TOOLS');
});

test('tools toolkits reads canonical toolkit connection statuses', async () => {
  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      results: [],
      toolkit_connection_statuses: [
        {
          toolkit: 'composio-todoist',
          description: 'Todoist',
          has_active_connection: true,
          status_message: 'Connected',
        },
        {
          toolkit: 'composio-notion',
          description: 'Notion',
          has_active_connection: false,
          status_message: 'composio-notion is not connected. Call LOCAL_NOTIS_AUTHENTIFY.',
        },
      ],
      tool_schemas: {},
      session: { id: 'session-1' },
    }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', `http://127.0.0.1:${port}`, 'tools', 'toolkits'],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.tool_name, 'COMPOSIO_SEARCH_TOOLS');
    assert.equal(requestBody.arguments.queries[0].use_case, 'List available toolkit namespaces and connection statuses');
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.data.toolkits.map((toolkit) => toolkit.id), [
      'composio-todoist',
      'composio-notion',
    ]);
    assert.equal(payload.data.toolkits[0].has_active_connection, true);
    assert.equal(payload.data.toolkits[1].has_active_connection, false);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('tools search returns full canonical discovery payload', async () => {
  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      error: null,
      results: [
        {
          index: 1,
          use_case: 'create a Todoist task',
          primary_tool_slugs: ['composio-todoist-create_task'],
          related_tool_slugs: [],
          toolkits: ['composio-todoist'],
          execution_guidance: 'Use the canonical tool.',
        },
      ],
      toolkit_connection_statuses: [
        {
          toolkit: 'composio-todoist',
          description: 'Todoist',
          has_active_connection: true,
          status_message: 'Connected',
        },
      ],
      tool_schemas: {
        'composio-todoist-create_task': {
          toolkit: 'composio-todoist',
          description: 'Create a Todoist task',
          input_schema: { type: 'object', properties: { content: { type: 'string' } } },
        },
      },
      session: { id: 'session-2' },
    }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', `http://127.0.0.1:${port}`, 'tools', 'search', 'create a Todoist task'],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.tool_name, 'COMPOSIO_SEARCH_TOOLS');
    assert.equal(requestBody.arguments.queries[0].use_case, 'create a Todoist task');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.results[0].primary_tool_slugs[0], 'composio-todoist-create_task');
    assert.equal(payload.data.toolkit_connection_statuses[0].toolkit, 'composio-todoist');
    assert.equal(
      payload.data.tool_schemas['composio-todoist-create_task'].input_schema.properties.content.type,
      'string',
    );
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('tools describe fetches an exact canonical schema slug', async () => {
  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      tool_schemas: {
        'composio-notion-create_notion_page': {
          toolkit: 'composio-notion',
          description: 'Create a Notion page',
          input_schema: { type: 'object', properties: { title: { type: 'string' } } },
          hasFullSchema: true,
        },
      },
      session: { id: 'session-schema' },
    }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'tools',
        'describe',
        'composio-notion-create_notion_page',
      ],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.tool_name, 'COMPOSIO_GET_TOOL_SCHEMAS');
    assert.deepEqual(requestBody.arguments.tool_slugs, ['composio-notion-create_notion_page']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.tool.name, 'composio-notion-create_notion_page');
    assert.equal(payload.data.tool.parameters.properties.title.type, 'string');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('tools exec --get-schema fetches an exact canonical schema slug', async () => {
  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      tool_schemas: {
        LOCAL_NOTIS_DATABASE_QUERY: {
          toolkit: 'notis',
          description: 'Query native databases',
          input_schema: { type: 'object', properties: { database_slug: { type: 'string' } } },
          hasFullSchema: true,
        },
      },
    }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();

  try {
    const result = await runCliAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'tools',
        'exec',
        'notis-query',
        '--get-schema',
      ],
      { NOTIS_JWT: makeJwt() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.tool_name, 'COMPOSIO_GET_TOOL_SCHEMAS');
    assert.deepEqual(requestBody.arguments.tool_slugs, ['LOCAL_NOTIS_DATABASE_QUERY']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.tool.name, 'LOCAL_NOTIS_DATABASE_QUERY');
    assert.equal(payload.data.tool.parameters.properties.database_slug.type, 'string');
    assert.equal(payload.data.tool.schema_available, true);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('describe tools link is registered', () => {
  const result = runCli(['describe', 'tools', 'link', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.spec.command_path.join(' '), 'tools link');
  assert.equal(payload.data.spec.backend_call.name, 'LOCAL_NOTIS_AUTHENTIFY');
  assert.equal(payload.data.spec.mutates, true);
  assert.equal(payload.data.spec.require_auth, true);
  const optionFlags = (payload.data.spec.args_schema.options || []).map((option) => option.flags);
  assert.ok(optionFlags.includes('--reconnect'));
  assert.ok(optionFlags.some((flags) => flags.startsWith('--connection-id')));
  assert.ok(optionFlags.some((flags) => flags.startsWith('--credentials')));
});

test('tools link reconnects through LOCAL_NOTIS_AUTHENTIFY with credentials from stdin', async () => {
  let requestBody = null;
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'success',
      auth_type: 'basic',
      toolkit: 'composio-dataforseo',
      reconnected: true,
      replaced_connection_id: 'conn-old',
      connection_id: 'conn-new',
      message: 'Authentication completed successfully for composio-dataforseo.',
    }));
  });

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const credentials = { username: 'fake-user', password: 'fake-secret' };

  try {
    const result = await runCliWithInputAsync(
      [
        '--json',
        '--api-base',
        `http://127.0.0.1:${port}`,
        'tools',
        'link',
        'dataforseo',
        '--reconnect',
        '--credentials',
        '-',
      ],
      JSON.stringify(credentials),
      { NOTIS_JWT: makeJwt('user-123') },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requestBody.tool_name, 'LOCAL_NOTIS_AUTHENTIFY');
    assert.deepEqual(requestBody.arguments, {
      toolkit: 'dataforseo',
      reconnect: true,
      credentials,
    });
    assert.equal(result.stdout.includes('fake-secret'), false);
    assert.equal(result.stderr.includes('fake-secret'), false);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.reconnected, true);
    assert.equal(payload.data.connection_id, 'conn-new');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('browser OAuth login is registered as a first-class command', () => {
  const result = runCli(['describe', 'login', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.data.spec.command_path.join(' '), 'login');
  assert.equal(payload.data.spec.backend_call.name, 'authorization_code+pkce');
});

test('start preserves browser OAuth failures when no email fallback exists', async () => {
  const server = createHttpServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'oauth_temporarily_unavailable',
      error_description: 'OAuth metadata is temporarily unavailable.',
    }));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const apiBase = `http://127.0.0.1:${port}`;
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-start-oauth-error-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: { default: { api_base: apiBase } },
  }));

  try {
    const result = await runCliAsync(
      ['--api-base', apiBase, 'start'],
      { NOTIS_CLI_CONFIG_FILE: configFile },
    );
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, 'oauth_temporarily_unavailable');
    assert.equal(payload.error.message, 'OAuth metadata is temporarily unavailable.');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

// Signing one account out is not a reason to sign the others out with it.
test('logout clears only the profile it ran against', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-logout-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'work',
    profiles: {
      default: {
        api_base: 'https://api.notis.ai',
        oauth_access_token: makeJwt('kept-user'),
        oauth_access_expires_at: 4102444800,
        oauth_user_id: 'kept-user',
      },
      work: {
        api_base: 'https://api-beta.notis.ai',
        oauth_access_token: makeJwt('oauth-user'),
        oauth_access_expires_at: 4102444800,
        oauth_user_id: 'oauth-user',
      },
    },
  }));

  const result = runCli(
    ['logout', '--json'],
    { NOTIS_CLI_CONFIG_FILE: configFile },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.data.oauth_connected, false);
  assert.deepEqual(payload.data.cleared_profiles, ['work']);
  const stored = JSON.parse(readFileSync(configFile, 'utf-8'));
  assert.equal(stored.profiles.work.oauth_access_token, undefined);
  assert.equal(stored.profiles.default.oauth_access_token, makeJwt('kept-user'));
});

test('profile use switches the active account without touching any credential', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-profile-switch-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: 'https://api.notis.ai',
        oauth_access_token: makeJwt('prod-user'),
        oauth_access_expires_at: 4102444800,
        oauth_user_id: 'prod-user',
      },
      beta: {
        api_base: 'https://api-beta.notis.ai',
        oauth_access_token: makeJwt('beta-user'),
        oauth_access_expires_at: 4102444800,
        oauth_user_id: 'beta-user',
      },
    },
  }));

  const switched = runCli(['profile', 'use', 'beta', '--json'], {
    NOTIS_CLI_CONFIG_FILE: configFile,
  });
  assert.equal(switched.status, 0, switched.stderr);
  assert.equal(JSON.parse(switched.stdout).data.active_profile, 'beta');

  const stored = JSON.parse(readFileSync(configFile, 'utf-8'));
  assert.equal(stored.current_profile, 'beta');
  assert.equal(stored.profiles.default.oauth_access_token, makeJwt('prod-user'));
  assert.equal(stored.profiles.beta.oauth_access_token, makeJwt('beta-user'));

  const listed = runCli(['profile', 'list', '--json'], {
    NOTIS_CLI_CONFIG_FILE: configFile,
  });
  assert.equal(listed.status, 0, listed.stderr);
  const data = JSON.parse(listed.stdout).data;
  assert.equal(data.effective_profile, 'beta');
  assert.deepEqual(
    data.profiles.map((entry) => [entry.name, entry.api_base, entry.authenticated]),
    [
      ['default', 'https://api.notis.ai', true],
      ['beta', 'https://api-beta.notis.ai', true],
    ],
  );
});

test('profile command hints shell-quote legacy profile names', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-legacy-profile-hints-'));
  const configFile = join(configHome, 'config.json');
  const legacyName = "legacy work's; echo unsafe";
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {},
      [legacyName]: {
        oauth_access_token: makeJwt('legacy-user'),
        oauth_access_expires_at: 4102444800,
      },
    },
  }));

  const refused = runCli(['profile', 'remove', legacyName, '--json'], {
    NOTIS_CLI_CONFIG_FILE: configFile,
    NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
  });

  assert.equal(refused.status, 2, refused.stderr);
  const hints = JSON.parse(refused.stdout).hints.map((hint) => hint.command);
  const quotedName = `'legacy work'"'"'s; echo unsafe'`;
  assert.deepEqual(hints, [
    `notis logout --profile ${quotedName}`,
    `notis profile remove ${quotedName} --force`,
  ]);
});

test('profile commands reject names inherited from Object.prototype', () => {
  for (const profileName of ['__proto__', 'constructor', 'toString']) {
    const homeDir = mkdtempSync(join(tmpdir(), 'notis-cli-invalid-profile-home-'));
    mkdirSync(join(homeDir, '.notis'), { recursive: true });
    const configFile = join(homeDir, '.notis', 'config.json');
    writeFileSync(configFile, JSON.stringify({
      current_profile: 'default',
      profiles: { default: {} },
    }));
    const before = readFileSync(configFile, 'utf8');

    const result = runCli(
      ['profile', 'use', profileName, '--json'],
      { HOME: homeDir, NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1', NODE_ENV: 'test' },
    );

    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code, 'profile_unknown');
    assert.equal(readFileSync(configFile, 'utf8'), before);
  }
});

// In a hosted shell NOTIS_JWT is the credential and every stored profile reads
// as signed out. Reporting that without context tells an agent whose commands
// are working fine that it needs to go authorize something.
test('profile list reports the NOTIS_JWT override instead of claiming signed out', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-profile-env-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: { default: {} },
  }));

  const result = runCli(['profile', 'list', '--json'], {
    NOTIS_CLI_CONFIG_FILE: configFile,
    NOTIS_JWT: makeJwt('hosted-user'),
  });

  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout).data;
  assert.equal(data.env_credential_override, true);
  assert.equal(data.effective_credential_kind, 'env');
  assert.match(JSON.parse(result.stdout).human_summary, /NOTIS_JWT overrides/);
});

test('profile remove refuses to discard a profile that is still authorized', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-profile-remove-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {},
      work: { oauth_access_token: makeJwt('work-user'), oauth_access_expires_at: 4102444800 },
    },
  }));

  const refused = runCli(['profile', 'remove', 'work', '--json'], {
    NOTIS_CLI_CONFIG_FILE: configFile,
  });
  assert.equal(refused.status, 2, refused.stderr);
  assert.equal(JSON.parse(refused.stdout).error.code, 'profile_still_authorized');

  const forced = runCli(['profile', 'remove', 'work', '--force', '--json'], {
    NOTIS_CLI_CONFIG_FILE: configFile,
  });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(
    JSON.parse(readFileSync(configFile, 'utf-8')).profiles.work,
    undefined,
  );
});

test('doctor can report a missing credential without requiring auth first', () => {
  const result = runCli(['doctor', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.checks.auth, 'missing');
});

test('start --brief-only refreshes an expired OAuth session instead of requiring a new grant', async () => {
  let refreshCalls = 0;
  const server = createHttpServer(async (req, res) => {
    if (req.url === '/oauth/token' && req.method === 'POST') {
      refreshCalls += 1;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf-8'));
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), 'refresh-token');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: makeJwt('oauth-user'),
        refresh_token: 'rotated-refresh-token',
        expires_in: 900,
        refresh_expires_in: 3600,
        scope: 'notis:read',
      }));
      return;
    }
    if (req.url === '/signup/onboarding-brief' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ markdown: '# Refreshed session brief' }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const apiBase = `http://127.0.0.1:${port}`;
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-refresh-start-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: apiBase,
        oauth_access_token: makeJwt('oauth-user', 1),
        oauth_refresh_token: 'refresh-token',
        oauth_access_expires_at: 1,
        oauth_refresh_expires_at: 4102444800,
        oauth_client_id: 'notis_cli',
        oauth_issuer: apiBase,
        oauth_scopes: ['notis:read'],
        oauth_user_id: 'oauth-user',
      },
    },
  }));

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', apiBase, 'start', '--brief-only'],
      { NOTIS_CLI_CONFIG_FILE: configFile },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.authenticated, true);
    assert.equal(payload.data.brief, '# Refreshed session brief');
    assert.equal(refreshCalls, 1);
    const stored = JSON.parse(readFileSync(configFile, 'utf-8'));
    assert.equal(stored.profiles.default.oauth_refresh_token, 'rotated-refresh-token');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

// The whole point of the onboarding-state check: a returning user must not be
// handed the new-user script. Before this, `start` served the same brief to a
// fresh signup and a year-old account, and a compliant agent re-onboarded them.
test('start withholds the onboarding brief from an account that is already set up', async () => {
  let briefRequests = 0;
  const server = createHttpServer(async (req, res) => {
    if (req.url === '/cli_tools' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      assert.equal(body.tool_name, 'LOCAL_NOTIS_GET_USER_SETTINGS');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        onboarding_complete: true,
        settings: { full_name: 'Florian', timezone: 'Europe/Paris' },
        missing_settings: [],
      }));
      return;
    }
    if (req.url === '/signup/onboarding-brief' && req.method === 'GET') {
      briefRequests += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ markdown: '# New user onboarding brief' }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const apiBase = `http://127.0.0.1:${port}`;
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-start-onboarded-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: apiBase,
        oauth_access_token: makeJwt('oauth-user'),
        oauth_access_expires_at: 4102444800,
        oauth_user_id: 'oauth-user',
      },
    },
  }));

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', apiBase, 'start'],
      { NOTIS_CLI_CONFIG_FILE: configFile },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.authenticated, true);
    assert.equal(payload.data.onboarding_complete, true);
    assert.equal(payload.data.brief, null);
    assert.equal(payload.data.brief_source, null);
    // Not merely withheld from the payload — never fetched.
    assert.equal(briefRequests, 0);
    assert.match(payload.human_summary, /already set up/);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('start still serves the brief to an account that has not onboarded', async () => {
  const server = createHttpServer(async (req, res) => {
    if (req.url === '/cli_tools' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        onboarding_complete: false,
        settings: { email: 'new@example.com' },
        missing_settings: ['full_name', 'position', 'language', 'timezone', 'attribution'],
      }));
      return;
    }
    if (req.url === '/signup/onboarding-brief' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ markdown: '# New user onboarding brief' }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const apiBase = `http://127.0.0.1:${port}`;
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-start-fresh-'));
  const agentHome = mkdtempSync(join(tmpdir(), 'notis-cli-start-agent-home-'));
  mkdirSync(join(agentHome, '.codex'), { recursive: true });
  writeFileSync(join(agentHome, '.codex', 'config.toml'), 'model = "auto"\n');
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: apiBase,
        oauth_access_token: makeJwt('new-user'),
        oauth_access_expires_at: 4102444800,
        oauth_user_id: 'new-user',
      },
    },
  }));

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', apiBase, 'start'],
      { NOTIS_CLI_CONFIG_FILE: configFile, HOME: agentHome },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.onboarding_complete, false);
    assert.equal(payload.data.brief, '# New user onboarding brief');
    // The agent is told exactly which questions are still worth asking.
    assert.deepEqual(payload.data.missing_settings,
      ['full_name', 'position', 'language', 'timezone', 'attribution']);
    assert.equal(payload.data.agent_setup[0].agent, 'codex');
    assert.match(
      readFileSync(join(agentHome, '.codex', 'AGENTS.md'), 'utf-8'),
      /notis-cli:instructions:start/,
    );
    assert.equal(payload.data.agent_setup[0].memory_hook.status, 'preserved');
    assert.equal(existsSync(join(agentHome, '.codex', 'hooks.json')), false);
    assert.match(
      payload.hints.map((hint) => hint.command || hint.message).join('\n'),
      /notis agents install/,
    );
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

// An unreachable tool bridge must not block sign-in. Degrading to the old
// behaviour is the safe direction: worst case the agent sees a brief it should
// not have, which the brief's own step 0 then catches.
test('start degrades to serving the brief when onboarding state is unavailable', async () => {
  const server = createHttpServer(async (req, res) => {
    if (req.url === '/signup/onboarding-brief' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ markdown: '# Fallback brief' }));
      return;
    }
    res.writeHead(500).end();
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const apiBase = `http://127.0.0.1:${port}`;
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-start-degraded-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: apiBase,
        oauth_access_token: makeJwt('oauth-user'),
        oauth_access_expires_at: 4102444800,
        oauth_user_id: 'oauth-user',
      },
    },
  }));

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', apiBase, 'start'],
      { NOTIS_CLI_CONFIG_FILE: configFile },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.authenticated, true);
    assert.equal(payload.data.onboarding_complete, false);
    assert.equal(payload.data.brief, '# Fallback brief');
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('doctor refreshes a lapsed OAuth grant before reporting on it', async () => {
  const server = createHttpServer(async (req, res) => {
    if (req.url === '/oauth/token' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: makeJwt('canonical-notis-user'),
        refresh_token: 'rotated-refresh-token',
        expires_in: 900,
        refresh_expires_in: 3600,
        scope: 'notis:read',
      }));
      return;
    }
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/cli_tools' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ toolkit_connection_statuses: [] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  const apiBase = `http://127.0.0.1:${port}`;
  const configHome = mkdtempSync(join(tmpdir(), 'notis-cli-refresh-doctor-'));
  const configFile = join(configHome, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: apiBase,
        oauth_access_token: makeJwt('canonical-notis-user', 1),
        oauth_refresh_token: 'refresh-token',
        oauth_access_expires_at: 1,
        oauth_refresh_expires_at: 4102444800,
        oauth_client_id: 'notis_cli',
        oauth_issuer: apiBase,
        oauth_scopes: ['notis:read'],
        oauth_user_id: 'canonical-notis-user',
      },
    },
  }));

  try {
    const result = await runCliAsync(
      ['--json', '--api-base', apiBase, 'doctor'],
      { NOTIS_CLI_CONFIG_FILE: configFile },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.checks.auth, 'configured');
    assert.equal(payload.data.checks.routing, 'ok');
    assert.equal(payload.data.checks.tool_roundtrip, 'ok');
    assert.equal(
      payload.hints.some((hint) => /expired|different accounts/i.test(hint.reason || '')),
      false,
    );
    assert.ok(payload.data.oauth_access_expires_at > 1);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('doctor gives a cold connected-tool roundtrip the documented 90 second timeout', () => {
  const runtime = { timeoutMs: 30_000, marker: 'preserved' };
  const diagnosticRuntime = doctorToolRoundtripRuntime(runtime);

  assert.equal(DOCTOR_TOOL_ROUNDTRIP_TIMEOUT_MS, 90_000);
  assert.equal(diagnosticRuntime.timeoutMs, 90_000);
  assert.equal(diagnosticRuntime.marker, 'preserved');
  assert.equal(runtime.timeoutMs, 30_000);
  assert.equal(doctorToolRoundtripRuntime({ timeoutMs: 120_000 }).timeoutMs, 120_000);
});

test('tools exec does not include --watch option', () => {
  const result = runCli(['describe', 'tools', 'exec', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  const optionFlags = (payload.data.spec.args_schema.options || []).map((o) => o.flags);
  assert.equal(optionFlags.some((f) => f.includes('--watch')), false);
});

test('tools exec accepts @file for --arguments', () => {
  const result = runCli(['describe', 'tools', 'exec', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  const argDesc = payload.data.spec.args_schema.options.find((o) => o.flags.includes('--arguments'));
  assert.ok(argDesc.description.includes('@file'), 'should mention @file in description');
});

test('tools exec gives image generation tools a long-running timeout floor', async () => {
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

    assert.equal(payload.tool_name, 'COMPOSIO_MULTI_EXECUTE_TOOL');
    assert.equal(payload.arguments.tools[0].tool_slug, 'LOCAL_NOTIS_GENERATE_IMAGE_OPENAI');

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', media_urls: ['https://example.com/image.png'] }));
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  try {
    const { port } = server.address();
    const result = await runCliAsync(
      [
        '--timeout-ms',
        '10',
        '--json',
        'tools',
        'exec',
        'LOCAL_NOTIS_GENERATE_IMAGE_OPENAI',
        '--arguments',
        '{"prompt":"banana"}',
      ],
      {
        NOTIS_API_BASE: `http://127.0.0.1:${port}`,
        NOTIS_JWT: makeJwt(),
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.status, 'success');
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  }
});


test('describe apps dev is registered', () => {
  const result = runCli(['describe', 'apps', 'dev', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.spec.command_path.join(' '), 'apps dev');
  const flagTokens = (payload.data.spec.args_schema.options || []).map((o) => o.flags);
  assert.ok(flagTokens.some((f) => f.startsWith('--port')));
  assert.ok(!flagTokens.some((f) => f.startsWith('--portal-url')));
  assert.ok(!flagTokens.includes('--no-open'));
  assert.equal(payload.data.spec.require_auth, true);
});

test.todo('apps dev describes the Raycast-style workflow and no preview-only local mode');


test('deprecated app dev command surfaces are not registered', () => {
  const commandPaths = COMMAND_SPECS.map((spec) => spec.command_path.join(' '));
  assert.ok(!commandPaths.includes('run dev'));
  assert.ok(!commandPaths.includes('apps preview'));
});


test('docs generator stays in sync with committed docs', () => {
  const result = spawnSync('node', [docsScript, '--check'], {
    cwd: cliRoot,
    env: {
      PATH: process.env.PATH,
      HOME: mkdtempSync(join(tmpdir(), 'notis-cli-home-')),
    },
    encoding: 'utf-8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
