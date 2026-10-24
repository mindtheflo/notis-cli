import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const cliRoot = resolve(import.meta.dirname, '..');
const exec = promisify(execFile);
const helpers = [
  'COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS',
  'COMPOSIO_MULTI_EXECUTE_TOOL', 'COMPOSIO_MANAGE_CONNECTIONS',
  'COMPOSIO_WAIT_FOR_CONNECTIONS', 'COMPOSIO_REMOTE_WORKBENCH',
  'COMPOSIO_REMOTE_BASH_TOOL',
];
const jwtPart = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = `${jwtPart({ alg: 'none' })}.${jwtPart({ sub: 'isolated-cli-fixture', exp: 4102444800 })}.sig`;

async function withCli(run) {
  const requests = [];
  const configDir = await mkdtemp(join(tmpdir(), 'notis-meta-dispatch-'));
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ successful: true, data: { fixture: 'accepted' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = async args => {
    // Exercise the public parser and command transport without the unrelated
    // launch-time skill installation. Never redirect HOME or touch real profiles.
    const launcher = `import { createProgram } from './src/cli.js'; await createProgram().parseAsync([process.execPath, 'notis', ...process.argv.slice(1)]);`;
    const { stdout } = await exec(process.execPath, ['--input-type=module', '--eval', launcher, '--', '--api-base', `http://127.0.0.1:${server.address().port}`, ...args], {
      cwd: cliRoot,
      env: { PATH: process.env.PATH, NODE_ENV: 'test', NOTIS_CLI_CONFIG_FILE: join(configDir, 'config.json'), NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1', NOTIS_JWT: jwt },
    });
    return JSON.parse(stdout);
  };
  try { await run(call, requests); }
  finally {
    await new Promise(resolve => server.close(resolve));
    await rm(configDir, { recursive: true, force: true });
  }
}

test('tools exec dispatches router helpers directly without nesting a batch wrapper', async t => {
  await withCli(async (call, requests) => {
    for (const name of helpers) {
      await t.test(name, async () => {
        const args = { marker: name };
        const result = await call(['tools', 'exec', name, '--arguments', JSON.stringify(args)]);
        const sent = requests.at(-1);
        assert.equal(sent.tool_name, name);
        assert.deepEqual(sent.arguments, args);
        assert.match(sent.idempotency_key, /^[A-Za-z0-9._:~-]{8,160}$/);
        assert.equal(result.meta.idempotency_key, sent.idempotency_key);
      });
    }
  });
});

test('ordinary tools and unknown helper-looking names retain the batch transport', async () => {
  await withCli(async (call, requests) => {
    for (const name of ['LOCAL_NOTIS_DATABASE_QUERY', 'GMAIL_FETCH_EMAILS', 'COMPOSIO_NOT_A_ROUTER_HELPER']) {
      const args = { marker: 'unchanged' };
      await call(['tools', 'exec', name, '--arguments', JSON.stringify(args)]);
      assert.equal(requests.at(-1).tool_name, 'COMPOSIO_MULTI_EXECUTE_TOOL');
      assert.deepEqual(requests.at(-1).arguments, { tools: [{ tool_slug: name, arguments: args }] });
    }
  });
});

test('tools exec-parallel chooses helper and ordinary transport independently', async () => {
  await withCli(async (call, requests) => {
    const calls = [
      { tool_name: 'COMPOSIO_REMOTE_WORKBENCH', arguments: { marker: 'helper' } },
      { tool_name: 'LOCAL_NOTIS_DATABASE_QUERY', arguments: { marker: 'native' } },
    ];
    const result = await call(['tools', 'exec-parallel', JSON.stringify(calls)]);
    assert.equal(result.data.results.length, 2);
    const helper = requests.find(r => r.tool_name === 'COMPOSIO_REMOTE_WORKBENCH');
    assert.deepEqual(helper?.arguments, { marker: 'helper' });
    const native = requests.find(r => r.tool_name === 'COMPOSIO_MULTI_EXECUTE_TOOL');
    assert.deepEqual(native?.arguments, { tools: [{ tool_slug: 'LOCAL_NOTIS_DATABASE_QUERY', arguments: { marker: 'native' } }] });
    assert.ok(requests.every(r => typeof r.idempotency_key === 'string'));
    assert.notEqual(requests[0].idempotency_key, requests[1].idempotency_key);
  });
});
