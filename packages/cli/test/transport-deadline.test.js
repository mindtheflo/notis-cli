import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { httpRequest } from '../src/runtime/transport.js';
import { deadlineDispatcher, isTransportTimeout, networkCauseCode, nodeEnvProxyEnabled } from '../src/runtime/http-agent.js';

// `credentialKind: 'env'` keeps the transport hermetic: no profile is read from disk.
function runtime(apiBase, timeoutMs = 1000) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({ alg: 'none' })}.${encode({ sub: 'deadline-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  return { credentialKind: 'env', profileName: 'deadline-test', jwt, apiBase, timeoutMs, cliVersion: 'test' };
}

test('a request waits for its own deadline, not fetch\'s hidden 300 s one', async () => {
  // Nov 2026: a deploy step the server took more than 300 s to answer failed as a bare "fetch failed"
  // (UND_ERR_HEADERS_TIMEOUT) although the CLI was set to wait 600 s.
  const dispatcher = await deadlineDispatcher();
  assert.ok(dispatcher, 'the CLI ships its own agent');
  const server = createServer((_request, response) => setTimeout(() => response.end('{"ok":true}'), 300));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const answered = await httpRequest({ runtime: runtime(base), path: '/slow', timeoutMs: 5000 });
    assert.deepEqual(answered.payload, { ok: true });
    await assert.rejects(httpRequest({ runtime: runtime(base, 60_000), path: '/slow', timeoutMs: 100 }), (error) => {
      assert.equal(error.code, 'network_timeout');
      // The attempt's own limit, not the whole --timeout-ms budget.
      assert.match(error.message, /^\/slow got no answer from http:\/\/127\.0\.0\.1:\d+ within 100 ms \(request req_[a-f0-9]{32}\)\.$/);
      assert.equal(error.details.timeout_ms, 100);
      // Never less than the --timeout-ms already set (a retry's attempt gets only the rest of that budget).
      assert.deepEqual(error.hints[1], { command: '--timeout-ms 120000', reason: 'Retry with a longer timeout' });
      return true;
    });
  } finally {
    server.close();
  }
});

test('every request goes through the deadline agent, and a transport timeout reads as a timeout', async (t) => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    seen.push(init.dispatcher);
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }) });
  });
  await assert.rejects(httpRequest({ runtime: runtime('https://fixture.invalid'), path: '/x' }), (error) => {
    assert.equal(error.code, 'network_timeout');
    // The transport stopped, not our deadline: say which, never a limit that did not apply.
    assert.match(error.message, /^\/x got no answer from https:\/\/fixture\.invalid before the transport gave up \(UND_ERR_HEADERS_TIMEOUT\)/);
    return true;
  });
  assert.equal(seen[0], await deadlineDispatcher());
});

test('a network failure names its cause under fetch\'s bare message', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
  });
  await assert.rejects(httpRequest({ runtime: runtime('https://fixture.invalid'), path: '/portal_spaces/source-verify' }), (error) => {
    assert.equal(error.code, 'network_error');
    assert.match(error.message, /^\/portal_spaces\/source-verify failed before https:\/\/fixture\.invalid answered: fetch failed \(ECONNRESET\) \(request req_[a-f0-9]{32}\)\.$/);
    assert.equal(error.details.cause_code, 'ECONNRESET');
    return true;
  });
  assert.equal(networkCauseCode(new Error('plain')), null);
  assert.equal(isTransportTimeout(new TypeError('fetch failed', { cause: { code: 'UND_ERR_BODY_TIMEOUT' } })), true);
  assert.equal(isTransportTimeout(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })), false);
  // undici's own 10 s connect limit is not a slow answer: a longer --timeout-ms would not help.
  assert.equal(isTransportTimeout(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })), false);
});

test('with Node\'s env proxy on, the deadline agent still sends through HTTP_PROXY', () => {
  assert.equal(nodeEnvProxyEnabled({}, []), false);
  assert.equal(nodeEnvProxyEnabled({ NODE_USE_ENV_PROXY: '1' }, []), true);
  assert.equal(nodeEnvProxyEnabled({}, ['--use-env-proxy']), true);
  assert.equal(nodeEnvProxyEnabled({ NODE_OPTIONS: '--max-old-space-size=4096 --use-env-proxy' }, []), true);
  // Only what turns Node's own env proxy on: the exact value 1, and the last flag wins over the variable.
  assert.equal(nodeEnvProxyEnabled({ NODE_USE_ENV_PROXY: 'true' }, []), false);
  assert.equal(nodeEnvProxyEnabled({ NODE_USE_ENV_PROXY: '1' }, ['--no-use-env-proxy']), false);
  assert.equal(nodeEnvProxyEnabled({ NODE_USE_ENV_PROXY: '1', NODE_OPTIONS: '--no-use-env-proxy' }, []), false);
  assert.equal(nodeEnvProxyEnabled({}, ['--use-env-proxy', '--no-use-env-proxy']), false);
  assert.equal(nodeEnvProxyEnabled({ NODE_OPTIONS: '--no-use-env-proxy' }, ['--use-env-proxy']), true);
  // A child process, since the agent is made once per process from its environment.
  const agentModule = fileURLToPath(new URL('../src/runtime/http-agent.js', import.meta.url));
  const script = `
    import { createServer } from 'node:http';
    const { deadlineDispatcher } = await import(${JSON.stringify(agentModule)});
    const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    // undici tunnels through the proxy (CONNECT) even for http targets: reaching the proxy is the proof.
    const reached = () => { console.log('proxied'); process.exit(0); };
    const proxy = createServer(reached).on('connect', reached);
    const target = createServer((_q, r) => r.end('"direct"'));
    process.env.HTTP_PROXY = 'http://127.0.0.1:' + await listen(proxy);
    const port = await listen(target);
    const dispatcher = await deadlineDispatcher();
    console.log(await (await fetch('http://127.0.0.1:' + port + '/', { dispatcher })).json());
    process.exit(0);`;
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !/^(no|http|https|all)_proxy$|^NODE_USE_ENV_PROXY$|^NODE_OPTIONS$/i.test(name)));
  const run = env => spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20_000, env: { ...inherited, ...env } });
  const proxied = run({ NODE_USE_ENV_PROXY: '1' });
  assert.equal(proxied.stdout.trim(), 'proxied', proxied.stderr);
  const direct = run({});
  assert.equal(direct.stdout.trim(), 'direct', direct.stderr);
});
