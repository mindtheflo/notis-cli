import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  AGENT_ID_HEADER,
  AGENT_NAME_HEADER,
  AGENT_THREAD_HEADER,
  AGENT_THREAD_LIMIT,
  agentIdForName,
  agentIdentityHeaders,
  agentIdsFile,
  readAgentIdentity,
  validateAgentIdentity,
} from '../src/runtime/agent-identity.js';
import { createProgram } from '../src/cli.js';

const cliRoot = resolve(import.meta.dirname, '..');

function withConfigDir(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'notis-agent-ids-'));
  try {
    return callback(join(dir, 'config.json'), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an agent declares itself with flags or NOTIS_AGENT_* variables, a flag winning', () => {
  assert.equal(readAgentIdentity({}, {}), null);
  assert.equal(readAgentIdentity({}, { NOTIS_AGENT_NAME: '  ' }), null);
  assert.deepEqual(
    readAgentIdentity({}, { NOTIS_AGENT_NAME: 'fred-and-the-machine', NOTIS_AGENT_ID: 'cc-1', NOTIS_AGENT_THREAD: 't-1' }),
    { name: 'fred-and-the-machine', id: 'cc-1', thread: 't-1' },
  );
  assert.deepEqual(
    readAgentIdentity({ agentName: 'john-trash', agentThread: 'flag-thread' }, { NOTIS_AGENT_NAME: 'fred-and-the-machine', NOTIS_AGENT_ID: 'cc-1' }),
    { name: 'john-trash', id: 'cc-1', thread: 'flag-thread' },
  );
});

test('a declaration is checked before it is sent', () => {
  assert.deepEqual(validateAgentIdentity({ name: '  fred-and-the-machine  ' }), { name: 'fred-and-the-machine' });
  assert.deepEqual(validateAgentIdentity({ name: 'ab-1', id: 'agent.1:a@b/c+d-e', thread: 'https://x.test/t?a=1' }),
    { name: 'ab-1', id: 'agent.1:a@b/c+d-e', thread: 'https://x.test/t?a=1' });
  assert.deepEqual(validateAgentIdentity({ name: `a-${'b'.repeat(58)}` }), { name: `a-${'b'.repeat(58)}` });
  assert.throws(() => validateAgentIdentity({ id: 'cc-1' }), /NOTIS_AGENT_NAME/);
  // N2: anything but a lowercase hyphenated band name of 3 to 60 characters is refused, with the rule and an example.
  for (const name of ['Claude Code', 'claude', 'Fred-and-the-machine', 'fred_and_the_machine', 'fred--machine',
    '-fred-machine', 'fred-machine-', 'clément-bot', 'a-', `a-${'b'.repeat(59)}`, 'bad\u0000-name']) {
    assert.throws(() => validateAgentIdentity({ name }), /lowercase letters and digits in at least two words.*fred-and-the-machine/, name);
  }
  assert.throws(() => validateAgentIdentity({ name: 'ok-bot', id: '-starts-with-dash' }), /NOTIS_AGENT_ID/);
  assert.throws(() => validateAgentIdentity({ name: 'ok-bot', id: 'a'.repeat(129) }), /NOTIS_AGENT_ID/);
  assert.throws(() => validateAgentIdentity({ name: 'ok-bot', thread: 'has space' }), /NOTIS_AGENT_THREAD/);
  assert.throws(() => validateAgentIdentity({ name: 'ok-bot', thread: 't'.repeat(513) }), /NOTIS_AGENT_THREAD/);
  try {
    validateAgentIdentity({ id: 'x' });
  } catch (error) {
    assert.equal(error.code, 'usage_error');
    assert.equal(error.exitCode, 2);
  }
});

test('the declaration travels percent-encoded in the X-Notis-Agent-* headers', () => withConfigDir((configFile) => {
  assert.deepEqual(agentIdentityHeaders({}, { configFile }), {});
  assert.deepEqual(agentIdentityHeaders({ agentIdentity: { name: 'clement-bot', id: 'cb-1', thread: 'https://app.notis.ai/t/1' } }, { configFile }), {
    [AGENT_NAME_HEADER]: 'clement-bot',
    [AGENT_ID_HEADER]: 'cb-1',
    [AGENT_THREAD_HEADER]: 'https%3A%2F%2Fapp.notis.ai%2Ft%2F1',
  });
  const headers = agentIdentityHeaders({ agentIdentity: { name: 'john-trash' } }, { configFile });
  assert.deepEqual(headers, { [AGENT_NAME_HEADER]: 'john-trash', [AGENT_ID_HEADER]: agentIdForName('john-trash', { configFile }) });
}));

test('the CLI generates one id per agent name and keeps it; an explicit id wins', () => withConfigDir((configFile, dir) => {
  const first = agentIdForName('fred-and-the-machine', { configFile });
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(agentIdForName('fred-and-the-machine', { configFile }), first);
  const other = agentIdForName('john-trash', { configFile });
  assert.notEqual(other, first);
  assert.equal(agentIdsFile(configFile), join(dir, 'agents.json'));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'agents.json'), 'utf8')),
    { version: 1, agents: { 'fred-and-the-machine': first, 'john-trash': other } });
  const explicit = agentIdentityHeaders({ agentIdentity: { name: 'fred-and-the-machine', id: 'mine-1' } }, { configFile });
  assert.equal(explicit[AGENT_ID_HEADER], 'mine-1');
  // Another computer (another config folder) gives the same name another id: two agents.
  withConfigDir((otherConfig) => assert.notEqual(agentIdForName('fred-and-the-machine', { configFile: otherConfig }), first));
}));

test('the program takes --agent-name, --agent-id and --agent-thread as global flags', () => {
  const program = createProgram();
  const flags = program.options.map((option) => option.long);
  for (const flag of ['--agent-name', '--agent-id', '--agent-thread']) assert.ok(flags.includes(flag), flag);
  program.parseOptions(['--agent-name', 'john-trash', '--agent-id', 'cx-1', '--agent-thread', 't-1']);
  assert.deepEqual(
    { name: program.opts().agentName, id: program.opts().agentId, thread: program.opts().agentThread },
    { name: 'john-trash', id: 'cx-1', thread: 't-1' },
  );
});

test('httpRequest sends the declared agent, and a bad declaration as written for the backend to judge', () => {
  const script = `
    import { httpRequest } from ${JSON.stringify(join(cliRoot, 'src/runtime/transport.js'))};
    const seen = [];
    globalThis.fetch = async (url, options = {}) => {
      seen.push(options.headers);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const base = { profileName: 'default', apiBase: 'https://api.example.com', timeoutMs: 5000, cliVersion: 'test',
      outputMode: 'json', agentMode: true, nonInteractive: true };
    await httpRequest({ runtime: { ...base, agentIdentity: { name: 'fred-and-the-machine', id: 'cc-1' } }, method: 'GET',
      path: '/health', requireAuth: false });
    await httpRequest({ runtime: base, method: 'GET', path: '/health', requireAuth: false });
    await httpRequest({ runtime: { ...base, agentIdentity: { name: 'john-trash' } }, method: 'GET', path: '/health',
      requireAuth: false });
    await httpRequest({ runtime: { ...base, agentIdentity: { name: 'john-trash' } }, method: 'GET', path: '/health',
      requireAuth: false });
    let refused = null;
    try {
      await httpRequest({ runtime: { ...base, agentIdentity: { name: 'Claude Code' } }, method: 'GET', path: '/health',
        requireAuth: false });
      await httpRequest({ runtime: { ...base, agentIdentity: { id: 'cc-1' } }, method: 'GET', path: '/health',
        requireAuth: false });
    } catch (error) {
      refused = error.code;
    }
    process.stdout.write(JSON.stringify({ seen, refused, calls: seen.length }));
  `;
  withConfigDir((configFile) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: cliRoot,
      env: { PATH: process.env.PATH, HOME: join(cliRoot, 'test', 'fixtures', 'no-such-home'), NOTIS_CLI_CONFIG_FILE: configFile },
      encoding: 'utf-8',
      timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const { seen, refused, calls } = JSON.parse(result.stdout);
    assert.equal(calls, 6);
    assert.equal(seen[0][AGENT_NAME_HEADER], 'fred-and-the-machine');
    assert.equal(seen[0][AGENT_ID_HEADER], 'cc-1');
    assert.equal(seen[0][AGENT_THREAD_HEADER], undefined);
    assert.equal(seen[1][AGENT_NAME_HEADER], undefined);
    // A name without an id sends the id this computer generated for it, the same on every call.
    assert.equal(seen[2][AGENT_NAME_HEADER], 'john-trash');
    assert.ok(seen[2][AGENT_ID_HEADER]);
    assert.equal(seen[3][AGENT_ID_HEADER], seen[2][AGENT_ID_HEADER]);
    // A name that breaks the rule never stops a command (reads, a person without unified comments): it goes as
    // written, with no kept id, and the backend answers invalid_agent_identity where declarations count.
    assert.equal(refused, null);
    assert.equal(seen[4][AGENT_NAME_HEADER], 'Claude%20Code');
    assert.equal(seen[4][AGENT_ID_HEADER], undefined);
    assert.equal(seen[5][AGENT_NAME_HEADER], undefined);
    assert.equal(seen[5][AGENT_ID_HEADER], 'cc-1');
  });
});

test('a bad declaration too long to send whole is cut by whole characters and stays too long', () => {
  const name = `${'a'.repeat(511)}\u{1F3B8}${'b'.repeat(100)}`;
  const headers = agentIdentityHeaders({ agentIdentity: { name, thread: 'x'.repeat(700) } });
  const sentName = decodeURIComponent(headers[AGENT_NAME_HEADER]);
  assert.ok(sentName.startsWith('a'.repeat(511)) && sentName.includes('\u{1F3B8}'));
  assert.equal(Array.from(sentName).length, AGENT_THREAD_LIMIT + 1);
  assert.equal(decodeURIComponent(headers[AGENT_THREAD_HEADER]).length, AGENT_THREAD_LIMIT + 1);
});
