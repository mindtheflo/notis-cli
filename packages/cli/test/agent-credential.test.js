import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveRuntimeProfile } from '../src/runtime/profiles.js';
import { httpRequest } from '../src/runtime/transport.js';
import { agentCredentialCacheFile } from '../src/runtime/agent-credential.js';

const now = () => Math.floor(Date.now() / 1000);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(payload) {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'owner', aud: 'authenticated', ...payload })}.sig`;
}
const AGENT = { thread_id: 'thread-1', agent_id: 'agent-1', display_name: 'Reviewer' };
const agentToken = (exp, extra = {}) => token({ type: 'notis_managed_agent', notis_agent: AGENT, exp, ...extra });

// One fake backend: the renewal operation answers `renewal`, every other path echoes the bearer it got.
async function backend(renewal) {
  const seen = { renewals: 0, bearers: [] };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const bearer = String(request.headers.authorization || '').replace(/^Bearer /, '');
      response.setHeader('Content-Type', 'application/json');
      if (body.operation === 'renew_agent_credential') {
        seen.renewals += 1;
        seen.renewalBearer = bearer;
        const { status, payload } = renewal();
        response.statusCode = status;
        response.end(JSON.stringify(payload));
        return;
      }
      seen.bearers.push(bearer);
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { seen, server, base: `http://127.0.0.1:${server.address().port}` };
}

function withEnv(t, envJwt, apiBase) {
  const home = mkdtempSync(join(tmpdir(), 'notis-agent-credential-'));
  const configFile = join(home, '.notis', 'config.json');
  const names = ['NOTIS_JWT', 'NOTIS_CLI_CONFIG_FILE', 'NOTIS_API_BASE', 'NODE_ENV', 'NOTIS_TEST_DISABLE_WORKTREE_ROUTING', 'NOTIS_PROFILE'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    NOTIS_JWT: envJwt,
    NOTIS_CLI_CONFIG_FILE: configFile,
    NOTIS_API_BASE: apiBase,
    NODE_ENV: 'test',
    NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
  });
  delete process.env.NOTIS_PROFILE;
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return configFile;
}

test('an agent credential near expiry renews once, caches the answer 0600 and the next run uses it', async (t) => {
  const envJwt = agentToken(now() + 30 * 60);
  const renewed = agentToken(now() + 7 * 3600);
  const { seen, server, base } = await backend(() => ({ status: 200, payload: { token: renewed, expires_at: now() + 7 * 3600 } }));
  t.after(() => server.close());
  const configFile = withEnv(t, envJwt, base);
  // An expired cache file of another command is pruned when this one is written.
  const stale = join(configFile, '..', 'agent-credentials', `${'0'.repeat(64)}.json`);
  mkdirSync(join(stale, '..'), { recursive: true });
  writeFileSync(stale, JSON.stringify({ token: agentToken(now() - 10), exp: now() - 10 }));

  const runtime = resolveRuntimeProfile({});
  assert.equal(runtime.jwt, envJwt);
  await httpRequest({ runtime, path: '/x', body: {} });
  await httpRequest({ runtime, path: '/x', body: {} });
  assert.equal(seen.renewals, 1);
  assert.equal(seen.renewalBearer, envJwt);
  assert.deepEqual(seen.bearers, [renewed, renewed]);

  const cacheFile = agentCredentialCacheFile(configFile, envJwt);
  assert.equal(statSync(cacheFile).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(cacheFile, 'utf-8')).token, renewed);
  assert.equal(existsSync(stale), false);

  // The next run starts from the cached, newer token and has no reason to renew.
  const next = resolveRuntimeProfile({});
  assert.equal(next.jwt, renewed);
  await httpRequest({ runtime: next, path: '/x', body: {} });
  assert.equal(seen.renewals, 1);
});

test('a refused or failed renewal keeps the valid token and never blocks the command', async (t) => {
  for (const renewal of [
    () => ({ status: 403, payload: { error: { code: 'agent_credential_not_renewable', status: 403 } } }),
    () => ({ status: 500, payload: {} }),
    () => ({ status: 200, payload: { token: 'not-a-token' } }),
  ]) {
    const envJwt = agentToken(now() + 10 * 60);
    const { seen, server, base } = await backend(renewal);
    const configFile = withEnv(t, envJwt, base);
    try {
      const runtime = resolveRuntimeProfile({});
      const answered = await httpRequest({ runtime, path: '/x', body: {} });
      assert.deepEqual(answered.payload, { ok: true });
      await httpRequest({ runtime, path: '/x', body: {} });
      assert.equal(seen.renewals, 1);
      assert.deepEqual(seen.bearers, [envJwt, envJwt]);
      assert.equal(existsSync(agentCredentialCacheFile(configFile, envJwt)), false);
    } finally {
      server.close();
    }
  }
});

test('no other environment credential is ever renewed', async (t) => {
  const soon = now() + 10 * 60;
  for (const envJwt of [
    token({ type: 'notis_managed_agent', exp: soon }),
    token({ exp: soon }),
    token({ type: 'api_key' }),
    token({ type: 'notis_managed_agent', notis_agent: 'not-a-claim', exp: soon }),
  ]) {
    const { seen, server, base } = await backend(() => ({ status: 200, payload: { token: agentToken(now() + 7 * 3600) } }));
    withEnv(t, envJwt, base);
    try {
      const runtime = resolveRuntimeProfile({});
      assert.equal(runtime.agentEnvJwt, null);
      await httpRequest({ runtime, path: '/x', body: {} });
      assert.equal(seen.renewals, 0);
      assert.deepEqual(seen.bearers, [envJwt]);
    } finally {
      server.close();
    }
  }
});

test('once the agent credential and its renewals lapsed, the expired error says to start a new command', async (t) => {
  const envJwt = agentToken(now() - 5);
  const { seen, server, base } = await backend(() => ({ status: 200, payload: {} }));
  t.after(() => server.close());
  withEnv(t, envJwt, base);
  const runtime = resolveRuntimeProfile({});
  await assert.rejects(httpRequest({ runtime, path: '/x', body: {} }), (error) => {
    assert.equal(error.code, 'auth_expired');
    assert.equal(error.details.agent_credential, true);
    assert.match(error.hints[0].message, /Start a new Cloud Computer command/);
    assert.doesNotMatch(JSON.stringify(error), new RegExp(envJwt.split('.')[1]));
    return true;
  });
  assert.equal(seen.renewals + seen.bearers.length, 0);
});
