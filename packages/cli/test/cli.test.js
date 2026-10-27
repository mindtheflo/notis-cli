import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { promisify } from 'node:util';

import { collectSourceFiles, pullAppSource, scaffoldProject } from '../src/runtime/app-platform.js';
import { collectProjectBoundaryViolations } from '../src/runtime/app-boundary-validator.js';
import { doctorChannelSummary, DOCTOR_TOOL_ROUNDTRIP_TIMEOUT_MS, doctorToolRoundtripRuntime } from '../src/command-specs/meta.js';

import { getApiBase, normalizeConfig, parseDebugEntitlementOverride } from '../src/runtime/profiles.js';
import { SPACES_PROTOCOL } from '../src/runtime/transport.js';
import { COMMAND_SPECS } from '../src/command-specs/index.js';
import { validateArguments } from '../src/command-specs/helpers.js';
import { classifyToolMutation } from '../src/command-specs/tools.js';
import { buildUserContextSql, extractSqlRows, traceFileDiagnostics } from '../src/command-specs/diagnostics.js';

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
    release_channel: undefined,
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
    assert.equal(betaFromFlag, 'https://api-nightly.notis.ai');

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

test('top-level help omits the removed db and apps command groups', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr);

  assert.match(result.stdout, /^\s+spaces\s+Build independent Spaces/m);
  assert.match(result.stdout, /^\s+tools\s+/m);
  assert.match(result.stdout, /Discover and execute generic tools exposed/);
  assert.doesNotMatch(result.stdout, /^\s+apps\s/m);
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

// `notis spaces pull` checks the downloaded archive and hands it to
// pullAppSource, which owns the checkout transaction. These tests drive that
// transaction directly with a fixture download.
const SPACE_SOURCE_LINK = { space_id: 'space-1', api_base: 'https://fixture.invalid' };

function spaceSourceDownload(archiveBuffer, revision, onDownload = null) {
  return {
    sourceLink: SPACE_SOURCE_LINK,
    async downloadSource() {
      if (onDownload) await onDownload();
      return { archiveBuffer, revision };
    },
  };
}

function unreachableDownload() {
  return {
    sourceLink: SPACE_SOURCE_LINK,
    async downloadSource() {
      throw new Error('The pull must be refused before the download starts.');
    },
  };
}

function gatedDownload() {
  let release;
  const gate = new Promise((resolvePromise) => { release = resolvePromise; });
  let markStarted;
  const started = new Promise((resolvePromise) => { markStarted = resolvePromise; });
  return {
    started,
    release,
    async wait() {
      markStarted();
      await gate;
    },
  };
}

function readSpaceSourceLink(projectDir) {
  return JSON.parse(readFileSync(join(projectDir, '.notis', 'space-source.json'), 'utf-8'));
}

function writeSpaceSourceLink(projectDir, revision) {
  mkdirSync(join(projectDir, '.notis'), { recursive: true });
  writeFileSync(
    join(projectDir, '.notis', 'space-source.json'),
    JSON.stringify({ ...SPACE_SOURCE_LINK, revision }),
  );
}

test('pullAppSource extracts the downloaded source and records the Space source link', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-target-'));
  const tarball = makeTarGz({
    'package.json': '{"name":"sample"}\n',
    'app/page.tsx': 'export default function Page() { return null; }\n',
  });

  const result = await pullAppSource({ targetDir, ...spaceSourceDownload(tarball, 7) });

  assert.equal(result.version, 7);
  assert.equal(readFileSync(join(targetDir, 'package.json'), 'utf-8'), '{"name":"sample"}\n');
  assert.deepEqual(readSpaceSourceLink(targetDir), { ...SPACE_SOURCE_LINK, revision: 7 });
  assert.equal(existsSync(join(targetDir, '.notis', 'state.json')), false);
});

test('pullAppSource extracts the PAX path emitted for long server source names', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-pax-'));
  const longPath = `skills/${'long-segment-'.repeat(10)}guide.md`;
  const tarball = makePaxTarGz(longPath, '# Long path\n');

  await pullAppSource({ targetDir, version: 4, ...spaceSourceDownload(tarball, 4) });

  assert.equal(readFileSync(join(targetDir, longPath), 'utf-8'), '# Long path\n');
  assert.equal(readSpaceSourceLink(targetDir).revision, 4);
});

test('pullAppSource serializes concurrent forced pulls for one target', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-concurrent-'));
  let activeDownloads = 0;
  let maxActiveDownloads = 0;
  const download = (revision) => spaceSourceDownload(
    makeTarGz({ 'package.json': `{"version":${revision}}\n` }),
    revision,
    async () => {
      activeDownloads += 1;
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      activeDownloads -= 1;
    },
  );

  await Promise.all([
    pullAppSource({ targetDir, version: 2, force: true, ...download(2) }),
    pullAppSource({ targetDir, version: 3, force: true, ...download(3) }),
  ]);

  assert.equal(maxActiveDownloads, 1);
  assert.equal(readSpaceSourceLink(targetDir).revision, 3);
  assert.equal(readFileSync(join(targetDir, 'package.json'), 'utf-8'), '{"version":3}\n');
});

test('pullAppSource rejects a symlinked target before acquiring a separate lock', async () => {
  const realTarget = mkdtempSync(join(tmpdir(), 'notis-pull-real-target-'));
  const aliasParent = mkdtempSync(join(tmpdir(), 'notis-pull-alias-parent-'));
  const aliasTarget = join(aliasParent, 'target');
  writeFileSync(join(realTarget, 'existing.txt'), 'keep me');
  symlinkSync(realTarget, aliasTarget, 'dir');

  await assert.rejects(
    () => pullAppSource({ targetDir: aliasTarget, force: true, ...unreachableDownload() }),
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
  const download = gatedDownload();

  const pulling = pullAppSource({
    targetDir,
    version: 2,
    force: true,
    ...spaceSourceDownload(tarball, 2, download.wait),
  });
  try {
    await Promise.race([download.started, pulling]);
    renameSync(targetDir, originalDir);
    symlinkSync(outsideDir, targetDir, 'dir');
    download.release();

    await assert.rejects(pulling, /unsafe target|target changed/);
    assert.equal(readFileSync(join(originalDir, 'existing.txt'), 'utf-8'), 'original source');
    assert.equal(readFileSync(join(outsideDir, 'outside.txt'), 'utf-8'), 'keep outside');
    assert.equal(existsSync(join(outsideDir, 'package.json')), false);
  } finally {
    download.release();
    await pulling.catch(() => {});
  }
});

test('pullAppSource rejects a parent-directory swap for a new target during download', async () => {
  const parentDir = mkdtempSync(join(tmpdir(), 'notis-pull-parent-swap-'));
  const targetDir = join(parentDir, 'target');
  const movedParent = `${parentDir}-original`;
  const outsideParent = mkdtempSync(join(tmpdir(), 'notis-pull-parent-outside-'));
  const tarball = makeTarGz({ 'package.json': '{"name":"fresh"}\n' });
  const download = gatedDownload();

  const pulling = pullAppSource({
    targetDir,
    version: 2,
    ...spaceSourceDownload(tarball, 2, download.wait),
  });
  try {
    await Promise.race([download.started, pulling]);
    renameSync(parentDir, movedParent);
    symlinkSync(outsideParent, parentDir, 'dir');
    download.release();

    await assert.rejects(pulling, /parent changed/);
    assert.equal(existsSync(join(outsideParent, 'target')), false);
    assert.equal(existsSync(join(movedParent, 'target')), false);
  } finally {
    download.release();
    await pulling.catch(() => {});
  }
});

test('pullAppSource leaves the checkout untouched when the download fails', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-no-source-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'keep me');

  await assert.rejects(
    () => pullAppSource({
      targetDir,
      force: true,
      sourceLink: SPACE_SOURCE_LINK,
      async downloadSource() {
        throw new Error('No editable source snapshot exists for this Space revision.');
      },
    }),
    /No editable source snapshot exists/,
  );
  assert.equal(readFileSync(join(targetDir, 'existing.txt'), 'utf-8'), 'keep me');
  assert.equal(existsSync(join(targetDir, '.notis')), false);
});

test('pullAppSource rejects unsafe source archive paths', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-unsafe-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'keep me');
  const tarball = makeTarGz({ '../outside.txt': 'nope' });

  await assert.rejects(
    () => pullAppSource({ targetDir, force: true, ...spaceSourceDownload(tarball, 1) }),
    /unsafe path/,
  );
  assert.equal(readFileSync(join(targetDir, 'existing.txt'), 'utf-8'), 'keep me');
});

test('pullAppSource rejects a download that does not match the pinned revision', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-version-race-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'keep me');
  const tarball = makeTarGz({ 'package.json': '{"name":"newer"}\n' });

  await assert.rejects(
    () => pullAppSource({ targetDir, version: 2, force: true, ...spaceSourceDownload(tarball, 3) }),
    /Requested Space source version 2, but the server returned version 3/,
  );
  assert.equal(readFileSync(join(targetDir, 'existing.txt'), 'utf-8'), 'keep me');
});

test('pullAppSource requires the download to prove its source revision', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-missing-version-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'keep me');
  const tarball = makeTarGz({ 'package.json': '{"name":"unversioned"}\n' });

  await assert.rejects(
    () => pullAppSource({ targetDir, version: 2, force: true, ...spaceSourceDownload(tarball, null) }),
    /did not identify a valid positive version/,
  );
  assert.equal(readFileSync(join(targetDir, 'existing.txt'), 'utf-8'), 'keep me');
});

test('pullAppSource rejects case-folded local-only archive entries', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-casefold-'));
  writeFileSync(join(targetDir, '.env.local'), 'keep secret');
  const tarball = makeTarGz({
    'package.json': '{"name":"bad"}\n',
    'app/.ENV.LOCAL': 'replace secret',
  });

  await assert.rejects(
    () => pullAppSource({ targetDir, version: 2, force: true, ...spaceSourceDownload(tarball, 2) }),
    /local-only path/,
  );
  assert.equal(readFileSync(join(targetDir, '.env.local'), 'utf-8'), 'keep secret');
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
  writeSpaceSourceLink(targetDir, 8);

  const tarball = makeTarGz({
    'package.json': '{"name":"fresh"}\n',
    'app/page.tsx': 'export default function Page() { return null; }\n',
    'packages/foo/index.ts': 'export const fresh = true;\n',
  });

  await pullAppSource({ targetDir, version: 2, force: true, ...spaceSourceDownload(tarball, 2) });

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
  assert.deepEqual(readSpaceSourceLink(targetDir), { ...SPACE_SOURCE_LINK, revision: 2 });
});

test('pullAppSource fails closed when a preserved symlink collides with pulled source', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-symlink-conflict-'));
  const localAppDir = mkdtempSync(join(tmpdir(), 'notis-pull-local-app-'));
  writeFileSync(join(localAppDir, 'local.txt'), 'keep local');
  symlinkSync(localAppDir, join(targetDir, 'app'), 'dir');
  writeSpaceSourceLink(targetDir, 1);
  const tarball = makeTarGz({
    'package.json': '{"name":"fresh"}\n',
    'app/page.tsx': 'export default null;\n',
  });

  await assert.rejects(
    () => pullAppSource({ targetDir, version: 2, force: true, ...spaceSourceDownload(tarball, 2) }),
    /Local-only path conflicts with pulled source: app/,
  );
  assert.equal(lstatSync(join(targetDir, 'app')).isSymbolicLink(), true);
  assert.equal(readFileSync(join(targetDir, 'app', 'local.txt'), 'utf-8'), 'keep local');
  assert.deepEqual(readSpaceSourceLink(targetDir), { ...SPACE_SOURCE_LINK, revision: 1 });
});

test('pullAppSource refuses a non-empty target directory without force', async () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'notis-pull-non-empty-'));
  writeFileSync(join(targetDir, 'existing.txt'), 'x');
  await assert.rejects(
    () => pullAppSource({ targetDir, ...unreachableDownload() }),
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

test('pullAppSource rejects a symlinked .notis directory', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-state-dir-symlink-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'notis-state-dir-outside-'));
  symlinkSync(outsideDir, join(projectDir, '.notis'), 'dir');
  const tarball = makeTarGz({ 'package.json': '{"name":"fresh"}\n' });

  await assert.rejects(
    () => pullAppSource({ targetDir: projectDir, force: true, ...spaceSourceDownload(tarball, 2) }),
    /unsafe Notis state directory/,
  );
  assert.equal(lstatSync(join(projectDir, '.notis')).isSymbolicLink(), true);
  assert.equal(existsSync(join(outsideDir, 'space-source.json')), false);
  assert.equal(existsSync(join(projectDir, 'package.json')), false);
});

test('pullAppSource rejects a symlinked Space source link file', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-state-file-symlink-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'notis-state-file-outside-'));
  const outsideFile = join(outsideDir, 'outside.json');
  mkdirSync(join(projectDir, '.notis'), { recursive: true });
  writeFileSync(outsideFile, 'keep outside');
  symlinkSync(outsideFile, join(projectDir, '.notis', 'space-source.json'));
  const tarball = makeTarGz({ 'package.json': '{"name":"fresh"}\n' });

  await assert.rejects(
    () => pullAppSource({ targetDir: projectDir, force: true, ...spaceSourceDownload(tarball, 2) }),
    /unsafe Notis state file/,
  );
  assert.equal(readFileSync(outsideFile, 'utf-8'), 'keep outside');
  assert.equal(existsSync(join(projectDir, 'package.json')), false);
});

test('scaffoldProject refuses a non-empty destination without overwriting it', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-non-empty-'));
  writeFileSync(join(projectDir, 'keep.txt'), 'keep me');

  await assert.rejects(
    scaffoldProject({ projectDir, appName: 'Dice Lab' }),
    /target must be empty/,
  );

  assert.equal(readFileSync(join(projectDir, 'keep.txt'), 'utf8'), 'keep me');
  assert.equal(existsSync(join(projectDir, 'package.json')), false);
});

test('scaffoldProject refuses a symlinked destination', async () => {
  const parentDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-symlink-parent-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-symlink-outside-'));
  const projectDir = join(parentDir, 'target');
  writeFileSync(join(outsideDir, 'keep.txt'), 'keep me');
  symlinkSync(outsideDir, projectDir, 'dir');

  await assert.rejects(
    scaffoldProject({ projectDir, appName: 'Dice Lab' }),
    /unsafe target/,
  );

  assert.equal(readFileSync(join(outsideDir, 'keep.txt'), 'utf8'), 'keep me');
  assert.equal(existsSync(join(outsideDir, 'package.json')), false);
});

test('scaffoldProject names the package and starts a Space workspace without App release metadata', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-scaffold-bare-'));
  try {
    await scaffoldProject({ projectDir, appName: 'Mind the Flo' });

    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
    assert.equal(pkg.name, 'mind-the-flo');
    assert.equal('notisAppVersion' in pkg, false);
    assert.equal(existsSync(join(projectDir, 'CHANGELOG.md')), false);
    assert.match(readFileSync(join(projectDir, 'notis.config.ts'), 'utf-8'), /defineSpaces\(/);
    // A starter kit, not an App: no home route and no copy of the CLI theme source.
    assert.equal(existsSync(join(projectDir, 'app', 'layout.tsx')), true);
    assert.equal(existsSync(join(projectDir, 'components', 'ui', 'button.tsx')), true);
    assert.equal(existsSync(join(projectDir, 'app', 'page.tsx')), false);
    assert.equal(existsSync(join(projectDir, '.harness')), false);
    assert.deepEqual(collectProjectBoundaryViolations(projectDir), [],
      'the complete generated source, including its bundled SDK, must pass the build boundary gate');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('authenticated commands fail with a JSON auth envelope in non-interactive mode', () => {
  const result = runCli(['spaces', 'list', '--json', '--non-interactive'], {
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

  const result = runCli(['spaces', 'list', '--json', '--non-interactive'], { HOME: homeDir });
  assert.equal(result.status, 3, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'auth_expired');
  assert.equal(payload.error.details.credential_source, 'oauth');
  assert.match(payload.error.message, /"work"/);
  // The profile lives on the nightly API, so recovery must point at the
  // nightly build: reinstalling `@latest` would send it back to the channel it
  // failed on.
  assert.equal(
    payload.hints[0].command,
    "npx --package @notis_ai/cli@nightly -- notis login --profile 'work'",
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
    ['--profile', 'dev-somewhere', 'spaces', 'list', '--json', '--non-interactive'],
    { HOME: homeDir },
  );
  assert.equal(result.status, 4, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'dev_runtime_unavailable');
  assert.match(payload.hints[0].message, /\/tmp\/somewhere/);
});

test('expired NOTIS_JWT never falls back to a stored profile', () => {
  const result = runCli(['spaces', 'list', '--json', '--non-interactive'], {
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
  assert.equal(classifyToolMutation('LOCAL_NOTIS_SANDBOX_PREVIEW', { action: 'status' }), false);
  for (const action of ['register', 'open', 'heartbeat', 'stop']) {
    assert.equal(classifyToolMutation('LOCAL_NOTIS_SANDBOX_PREVIEW', { action }), true);
  }
  assert.equal(classifyToolMutation('LOCAL_NOTIS_SANDBOX_PREVIEW'), null);
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
  assert.equal(payload.data.spec.backend_call.type, 'toolkit_inventory');
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
      coverage: { complete: true, families: { composio: 'available' } },
      results: [],
      toolkit_connection_statuses: [
        {
          toolkit: 'todoist',
          provider: 'composio',
          description: 'Todoist',
          has_active_connection: true,
          status_message: 'Connected',
        },
        {
          toolkit: 'notion',
          provider: 'composio',
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
    assert.equal(requestBody.operation, 'toolkit_inventory');
    assert.equal(requestBody.tool_name, undefined);
    assert.equal(requestBody.arguments, undefined);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.data.toolkits.map((toolkit) => toolkit.id), [
      'notion',
      'todoist',
    ]);
    assert.equal(payload.data.toolkits[1].has_active_connection, true);
    assert.equal(payload.data.toolkits[0].has_active_connection, false);
    assert.equal(payload.data.coverage.complete, true);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test('doctor and whoami verify the server account without trusting a cached OAuth identity', async () => {
  let canonicalUser = 'canonical-owner';
  let inventoryCalls = 0;
  const server = createHttpServer(async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { operation: 'toolkit_inventory' });
    inventoryCalls += 1;
    res.end(JSON.stringify({ success: true, user_id: canonicalUser, toolkit_connection_statuses: [],
      coverage: { complete: true, families: {} } }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const configDir = mkdtempSync(join(tmpdir(), 'notis-cli-identity-'));
  const configFile = join(configDir, 'config.json');
  try {
    for (const scenario of [
      { kind: 'jwt', cached: 'auth-subject', server: 'canonical-owner', check: 'ok' },
      { kind: 'oauth', cached: 'canonical-owner', server: 'canonical-owner', check: 'ok' },
      { kind: 'oauth', cached: 'wrong-cached-owner', server: 'canonical-owner', check: 'mismatch' },
      { kind: 'oauth', cached: 'legacy-owner', server: undefined, check: 'unverified' },
    ]) {
      canonicalUser = scenario.server;
      writeFileSync(configFile, JSON.stringify({ current_profile: 'default', profiles: { default: {
        api_base: apiBase,
        ...(scenario.kind === 'oauth' ? { oauth_access_token: makeJwt('auth-subject'),
          oauth_access_expires_at: 4102444800, oauth_refresh_expires_at: 4102444800,
          oauth_client_id: 'notis_cli', oauth_issuer: apiBase, oauth_scopes: ['notis:read'],
          oauth_user_id: scenario.cached } : {}),
      } } }));
      const env = { NOTIS_CLI_CONFIG_FILE: configFile,
        ...(scenario.kind === 'jwt' ? { NOTIS_JWT: makeJwt('auth-subject') } : {}) };
      const invoke = async (command) => {
        const result = await runCliAsync(['--json', '--api-base', apiBase, command], env);
        assert.equal(result.status, 0, result.stderr);
        return JSON.parse(result.stdout);
      };
      const whoami = await invoke('whoami');
      const doctor = await invoke('doctor');
      assert.equal(whoami.data.user_id, scenario.server || scenario.cached);
      assert.equal(whoami.data.identity_source, scenario.server ? 'server' : 'profile_unverified');
      assert.equal(doctor.data.checks.identity, scenario.check);
      assert.equal(doctor.data.user_id, scenario.server || null);
      assert.equal(whoami.warnings.some(w => /saved OAuth account differs/i.test(w)), scenario.check === 'mismatch');
      assert.equal(whoami.warnings.some(w => /not verified/i.test(w)), scenario.check === 'unverified');
      if (scenario.check === 'unverified') {
        const human = await runCliAsync(['--output', 'table', '--api-base', apiBase, 'whoami'], env);
        assert.equal(human.status, 0, human.stderr);
        assert.match(human.stdout, /Identity:\s+unverified saved profile/);
      }
    }
    assert.equal(inventoryCalls, 9, 'each command reuses its existing read-only inventory request');
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('inventory completeness is shared by toolkits, whoami and doctor; malformed inventory fails', async () => {
  let mode = 'partial';
  const server = createHttpServer(async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(body, { operation: 'toolkit_inventory' });
    return res.end(JSON.stringify(mode === 'malformed' ? { success: true } : {
      success: true,
      toolkit_connection_statuses: [{ toolkit: 'todoist', provider: 'composio', has_active_connection: true }],
      coverage: { complete: false, families: { composio: 'available', mcp_records: 'unavailable' } },
      warnings: ['MCP inventory unavailable.'],
    }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const run = (command) => runCliAsync(['--json', '--api-base', apiBase, ...command], { NOTIS_JWT: makeJwt() });
  try {
    const toolkits = JSON.parse((await run(['tools', 'toolkits'])).stdout);
    const whoami = JSON.parse((await run(['whoami'])).stdout);
    const doctor = JSON.parse((await run(['doctor'])).stdout);
    assert.equal(toolkits.data.coverage.complete, false);
    assert.deepEqual(toolkits.data.toolkits.map((row) => row.id), whoami.data.toolkits);
    assert.equal(whoami.data.toolkit_count, null);
    assert.equal(whoami.data.observed_toolkit_count, 1);
    assert.equal(doctor.data.checks.tool_roundtrip, 'partial');
    assert.equal(doctor.data.toolkit_coverage.complete, false);
    for (const result of [toolkits, whoami, doctor]) assert.ok(result.warnings.length > 0);
    mode = 'malformed';
    for (const command of [['tools', 'toolkits'], ['whoami']]) {
      const result = await run(command);
      assert.equal(result.status, 6);
      assert.equal(JSON.parse(result.stdout).error.code, 'invalid_toolkit_inventory');
    }
    const failedDoctor = JSON.parse((await run(['doctor'])).stdout);
    assert.equal(failedDoctor.data.checks.tool_roundtrip, 'error');
    assert.equal(failedDoctor.data.toolkit_coverage, null);
  } finally {
    await new Promise((done) => server.close(done));
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
      ['beta', 'https://api-nightly.notis.ai', true],
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
        settings: { first_name: 'Florian', timezone: 'Europe/Paris' },
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
        missing_settings: ['first_name', 'position', 'language', 'timezone', 'attribution'],
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
      ['first_name', 'position', 'language', 'timezone', 'attribution']);
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
      res.end(JSON.stringify({ success: true, toolkit_connection_statuses: [], coverage: { complete: true, families: {} } }));
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

test('history list sends the returned cursor with the Spaces protocol and rejects invalid cursors before network', async () => {
  const spaceId = '3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b';
  const requests = [];
  const server = createHttpServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url, protocol: req.headers['x-notis-spaces-protocol'] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ versions: [], next_before: null }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = { NOTIS_API_BASE: `http://127.0.0.1:${server.address().port}`, NOTIS_JWT: makeJwt() };
    const result = await runCliAsync(['--json', 'spaces', 'history', 'list', spaceId, '--before', '7'], env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(requests, [{ method: 'GET', url: `/portal_spaces/history?space_id=${spaceId}&before=7`, protocol: String(SPACES_PROTOCOL) }]);
    for (const cursor of ['abc', '-1', '1.5']) {
      const invalid = await runCliAsync(['--json', 'spaces', 'history', 'list', spaceId, '--before', cursor], env);
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr + invalid.stdout, /numeric --before cursor/);
    }
    assert.equal(requests.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the documented history restore example reaches the restore endpoint', async () => {
  // The root program owns -V/--version, so the saved version needs its own flag.
  const spaceId = '3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b';
  const spec = COMMAND_SPECS.find((item) => item.command_path.join(' ') === 'spaces history restore');
  const argv = spec.examples[0].split(' ').slice(1).map((part) => (part === '<space-id>' ? spaceId : part));
  const requests = [];
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, url: req.url, protocol: req.headers['x-notis-spaces-protocol'],
      body: JSON.parse(Buffer.concat(chunks).toString('utf-8') || 'null') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'dry_run', target_revision: 2 }));
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
    const result = await runCliAsync(['--json', ...argv], {
      NOTIS_API_BASE: `http://127.0.0.1:${port}`,
      NOTIS_JWT: makeJwt(),
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).data.target_revision, 2);
    assert.deepEqual(requests, [{
      method: 'POST',
      url: '/portal_spaces/history-restore',
      protocol: String(SPACES_PROTOCOL),
      body: { space_id: spaceId, target_revision: 2, revision: 5, request_id: 'undo-last-change', dry_run: true },
    }]);
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  }
});



test('the retired apps command group is not registered', () => {
  const commandPaths = COMMAND_SPECS.map((spec) => spec.command_path.join(' '));
  assert.ok(!commandPaths.includes('run dev'));
  assert.equal(COMMAND_SPECS.some((spec) => spec.command_path[0] === 'apps'), false);

  const result = runCli(['apps', 'list']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown command/i);
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
