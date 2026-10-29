/**
 * End-to-end `handover start`: a real git repository with a real origin, a stub
 * /cli_tools, and the actual CLI binary. What this pins down is the contract
 * between the two halves -- that the branch really reaches origin before the
 * hand-over is sent, and that the agent the user named is the one that
 * arrives at the server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CLI = new URL('../bin/notis.js', import.meta.url).pathname;
const THREADS_TOOL = 'LOCAL_NOTIS_CONTROL_THREADS';
// Each route the user can type, with the agent it is reported as. The first
// four are the advertised ones; the rest are older values the CLI still
// accepts silently and maps to the agent they name.
const ROUTES = [
  ['auto', 'auto'],
  ['notis', 'notis'],
  ['codex', 'codex'],
  ['claude', 'claude'],
  ['codex_cloud', 'codex'],
  ['claude_cloud', 'claude'],
  ['codex_local', 'codex'],
  ['claude_local', 'claude'],
];
// How the thread's task names an agent: a plain sentence at its end.
const AGENT_SENTENCES = {
  notis: 'Use Notis for this task.',
  codex: 'Use Codex for this task.',
  claude: 'Use Claude for this task.',
};
const ANY_AGENT_SENTENCE = /Use (Notis|Codex|Claude) for this task\./;
// Every hand-over names who runs it and how. Tests about something else pass
// these, and the retry hints repeat them.
const CHOICES = ['--route', 'codex', '--intelligence', 'medium', '--speed', 'normal'];
const CHOSEN = '--route codex --intelligence medium --speed normal';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A repository with a real (bare, local) origin, so `git push` genuinely runs. */
function makeRepoWithOrigin(root) {
  const originDir = join(root, 'origin.git');
  const workDir = join(root, 'work');
  mkdirSync(originDir, { recursive: true });
  git(root, 'init', '-q', '--bare', originDir);
  git(root, 'clone', '-q', originDir, workDir);
  git(workDir, 'config', 'user.email', 'test@example.com');
  git(workDir, 'config', 'user.name', 'Test');
  writeFileSync(join(workDir, 'README.md'), '# test\n');
  git(workDir, 'add', '-A');
  git(workDir, 'commit', '-q', '-m', 'init');
  git(workDir, 'push', '-q', '-u', 'origin', 'HEAD:refs/heads/main');
  git(workDir, 'switch', '-q', '-c', 'feat/auth');
  return { originDir, workDir };
}

async function withStubServer(handler, run) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      calls.push({ path: req.url, body: parsed });
      const response = handler(parsed, req);
      if (response.drop) {
        // The connection dies before any answer, as when a network drops.
        req.socket.destroy();
        return;
      }
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await run(`http://127.0.0.1:${port}`, calls);
  } finally {
    // fetch leaves the socket keep-alive, and close() waits for open
    // connections -- without this the suite hangs instead of finishing.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * Must not be spawnSync: the stub server runs in this process, so blocking the
 * event loop would stop it ever answering the CLI's request.
 */
// These flow fixtures model a personal terminal. The delegated-context tests
// exercise the real cloud guard without this process-local preload.
const PERSONAL_TERMINAL = `data:text/javascript;base64,${Buffer.from(`
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  const exists = fs.existsSync;
  fs.existsSync = path => path === '/vercel/sandbox' ? false : exists(path);
  syncBuiltinESMExports();
`).toString('base64')}`;

function runCli(args, { cwd, apiBase }) {
  const fixtureHome = join(cwd, '..', 'cli-home');
  mkdirSync(fixtureHome, { recursive: true });
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['--import', PERSONAL_TERMINAL, CLI, ...args, '--api-base', apiBase], {
      cwd,
      env: {
        ...process.env,
        // The actual CLI repairs base skills on startup. Its fictional account
        // must not contend with Desktop or touch the real user's skill roots.
        HOME: fixtureHome,
        USERPROFILE: fixtureHome,
        NOTIS_CLI_CONFIG_FILE: join(fixtureHome, '.notis', 'config.json'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: devNull,
        NOTIS_JWT: 'test-token',
        NOTIS_OUTPUT: 'json',
        NOTIS_NON_INTERACTIVE: '1',
        // NOTIS_JWT + NOTIS_AGENT would look like a delegated run to the guard.
        NOTIS_AGENT: '',
        NOTIS_DELEGATED_CONTEXT: '',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }
      resolvePromise({ status, stdout, stderr, parsed });
    });
  });
}

// `/cli_tools` returns the tool's own result dict as the response body, so the
// stub answers with exactly that shape -- not a wrapper around it.
//
// `handover start` makes two calls: a schema preflight (so it can refuse before
// committing anything) and then the thread create itself.
const SCHEMA_TOOL = 'COMPOSIO_GET_TOOL_SCHEMAS';
const REQUEST_ID = '6f1c2e8a-4b7d-5c3e-9a1f-2d8b7e6c5a4f';

const schemaResponse = {
  status: 200,
  body: { tools: [{ name: THREADS_TOOL, parameters: { type: 'object' } }] },
};

const okHandover = (payload) => {
  if (payload?.tool_name === SCHEMA_TOOL) {
    return schemaResponse;
  }
  return {
    status: 200,
    body: {
      status: 'accepted',
      request_id: REQUEST_ID,
      row_id: 'row-1',
      thread_id: 'thread-1',
      interaction_id: 'int-1',
      title: payload?.arguments?.title,
      request_key: payload?.arguments?.request_id,
    },
  };
};

/** The thread create, not the preflight that precedes it. */
const handoverCall = (calls) =>
  calls.find((c) => c.path === '/cli_tools' && c.body.tool_name === THREADS_TOOL);

test('handover start pushes the branch and forwards each routing target', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-flow-'));
  try {
    const { originDir, workDir } = makeRepoWithOrigin(root);

    for (const [route, agent] of ROUTES) {
      // A commit per route, so each run has something new to push.
      writeFileSync(join(workDir, `${route}.txt`), `${route}\n`);
      git(workDir, 'add', '-A');
      git(workDir, 'commit', '-q', '-m', `work for ${route}`);

      const result = await withStubServer(okHandover, async (apiBase, calls) => {
        const run = await runCli(
          ['handover', 'start', `do the ${route} work`, '--route', route, '--intelligence', 'high', '--speed', 'normal'],
          { cwd: workDir, apiBase },
        );
        return { run, calls };
      });

      assert.equal(result.run.parsed?.ok, true, `${route}: ${result.run.stderr}`);
      assert.equal(result.run.parsed.data.agent_routing, agent);
      assert.equal(result.run.parsed.data.intelligence, 'high');
      assert.equal(result.run.parsed.data.speed, 'normal');
      assert.equal(result.run.parsed.data.branch, 'feat/auth');
      assert.equal(result.run.parsed.data.request_id, REQUEST_ID);
      assert.equal(result.run.parsed.data.thread_id, 'thread-1');

      const call = handoverCall(result.calls);
      assert.ok(call, `${route}: no hand-over call`);
      assert.equal(call.body.arguments.action, 'create');
      // The intelligence and speed are thread settings. The agent is not: a
      // named one is a sentence at the end of the task, and auto adds none and
      // leaves that choice to Notis.
      assert.deepEqual(call.body.arguments.settings, { mode: 'high', speed: 'normal' });
      if (agent === 'auto') {
        assert.doesNotMatch(call.body.arguments.instructions, ANY_AGENT_SENTENCE);
      } else {
        assert.ok(
          call.body.arguments.instructions.endsWith(`\n\n${AGENT_SENTENCES[agent]}`),
          `${route}: the task must end by naming ${agent}`,
        );
      }
      assert.equal(call.body.arguments.title, `do the ${route} work`);
      assert.ok(call.body.idempotency_key, 'a mutating call must carry an idempotency key');
      // One key names the hand-over end to end, so a retry finds the same thread.
      assert.equal(call.body.arguments.request_id, `handover:${call.body.idempotency_key}`);
      assert.ok(
        result.run.parsed.hints.some((h) => h.command === `notis handover status ${REQUEST_ID}`),
        'the way to follow the hand-over must be offered',
      );

      // The branch has to exist on origin before the agent is told about it.
      const remoteHead = git(originDir, 'rev-parse', 'refs/heads/feat/auth');
      assert.equal(remoteHead, git(workDir, 'rev-parse', 'HEAD'), `${route}: branch not pushed`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing choice stops the hand-over before anything is committed, pushed or sent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-choices-'));
  try {
    const { originDir, workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'dirty.txt'), 'unsaved\n');

    const { run, calls } = await withStubServer(okHandover, async (apiBase, calls) => ({
      run: await runCli(['handover', 'start', 'do the work', '--route', 'codex'], { cwd: workDir, apiBase }),
      calls,
    }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'usage_error');
    assert.deepEqual(run.parsed.error.details.missing, ['--intelligence', '--speed']);
    assert.deepEqual(calls.filter((c) => c.path === '/cli_tools'), [], 'not even the preflight runs');
    assert.notEqual(git(workDir, 'status', '--porcelain'), '', 'the tree must be left dirty');
    const onOrigin = spawnSync(
      'git',
      ['-C', originDir, 'rev-parse', '--verify', '--quiet', 'refs/heads/feat/auth'],
      { encoding: 'utf8' },
    );
    assert.notEqual(onOrigin.status, 0, 'the branch must never reach origin');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auto leaves the agent and the intelligence to Notis, and still sends the speed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-auto-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'x.txt'), 'x\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'work');

    const result = await withStubServer(okHandover, async (apiBase, calls) => {
      const run = await runCli(
        ['handover', 'start', 'do the work', '--route', 'auto', '--intelligence', 'auto', '--speed', 'normal'],
        { cwd: workDir, apiBase },
      );
      return { run, calls };
    });

    assert.equal(result.run.parsed?.ok, true, result.run.stderr);
    const sent = handoverCall(result.calls).body.arguments;
    assert.deepEqual(sent.settings, { auto: true, speed: 'normal' });
    assert.doesNotMatch(sent.instructions, ANY_AGENT_SENTENCE);
    assert.equal(result.run.parsed.data.agent_routing, 'auto');
    assert.equal(result.run.parsed.data.intelligence, 'auto');
    assert.equal(result.run.parsed.data.speed, 'normal');
    assert.match(
      result.run.parsed.human_summary,
      /over to Notis, which picks the agent \(Notis picks the intelligence, normal speed; new branch from it\)\./,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('branch mode reaches the agent as an explicit instruction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-mode-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'x.txt'), 'x\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'work');

    const same = await withStubServer(okHandover, async (apiBase, calls) => {
      await runCli(['handover', 'start', 'finish it', '--branch-mode', 'same', ...CHOICES], { cwd: workDir, apiBase });
      return handoverCall(calls);
    });
    // Quoted: the branch is interpolated into a command line the agent runs.
    assert.match(same.body.arguments.instructions, /--continue-branch 'feat\/auth'/);
    assert.match(same.body.arguments.instructions, /Work ON branch feat\/auth itself/);
    assert.match(same.body.arguments.instructions, /never force-push/);

    const fresh = await withStubServer(okHandover, async (apiBase, calls) => {
      await runCli(
        ['handover', 'start', 'start beside it', '--route', 'notis', '--intelligence', 'low', '--speed', 'flex'],
        { cwd: workDir, apiBase },
      );
      return handoverCall(calls);
    });
    assert.match(fresh.body.arguments.instructions, /--base 'feat\/auth'/);
    assert.match(fresh.body.arguments.instructions, /Cut a NEW branch/);
    assert.deepEqual(fresh.body.arguments.settings, { mode: 'low', speed: 'flex' });

    // Both modes must tell the receiving agent not to hand the task on again.
    for (const call of [same, fresh]) {
      assert.match(call.body.arguments.instructions, /do not run `notis handover` yourself/i);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uncommitted work is committed and pushed rather than left behind', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-wip-'));
  try {
    const { originDir, workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'base.txt'), 'base\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'base');
    // Uncommitted, and untracked: both have to survive the hand-over.
    writeFileSync(join(workDir, 'dirty.txt'), 'unsaved\n');
    writeFileSync(join(workDir, 'README.md'), '# edited\n');

    const call = await withStubServer(okHandover, async (apiBase, calls) => {
      const run = await runCli(['handover', 'start', 'keep my work', ...CHOICES], { cwd: workDir, apiBase });
      assert.equal(run.parsed?.ok, true, run.stderr);
      assert.ok(run.parsed.data.wip_commit, 'a wip commit should be reported');
      return handoverCall(calls);
    });
    assert.ok(call);

    // The pushed tree must contain the previously-uncommitted files.
    const pushed = git(originDir, 'ls-tree', '-r', '--name-only', 'refs/heads/feat/auth');
    assert.match(pushed, /dirty\.txt/);
    assert.equal(git(workDir, 'log', '-1', '--pretty=%s'), 'wip: hand over to Notis');
    assert.equal(git(workDir, 'status', '--porcelain'), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the automatic wip commit respects repository pre-commit hooks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-hook-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'dirty.txt'), 'unsaved\n');
    const hook = join(workDir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho blocked-by-hook >&2\nexit 1\n');
    chmodSync(hook, 0o755);

    const { run, calls } = await withStubServer(okHandover, async (apiBase, calls) => ({
      run: await runCli(['handover', 'start', 'sensitive task text', ...CHOICES], { cwd: workDir, apiBase }),
      calls,
    }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'git_commit_failed');
    assert.match(run.parsed.error.message, /blocked-by-hook/);
    assert.equal(handoverCall(calls), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('automatic wip refuses sensitive files even without repository hooks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-sensitive-wip-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, '.env'), 'SERVICE_PASSWORD=do-not-publish\n');
    writeFileSync(join(workDir, '.envrc'), 'export DATABASE_URL=postgres://user:password@host/db\n');
    writeFileSync(join(workDir, '.git-credentials'), 'https://user:password@host.example\n');
    const privateKeyHeader = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
    const privateKeyFooter = ['-----END', 'PRIVATE KEY-----'].join(' ');
    writeFileSync(
      join(workDir, ' notes.txt'),
      `${privateKeyHeader}\nnot-a-real-key\n${privateKeyFooter}\n`,
    );
    writeFileSync(join(workDir, '..secret'), 'https://user:password@host.example\n');

    const { run, calls } = await withStubServer(okHandover, async (apiBase, calls) => ({
      run: await runCli(['handover', 'start', 'do it', ...CHOICES], { cwd: workDir, apiBase }),
      calls,
    }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'sensitive_working_tree');
    assert.deepEqual(
      run.parsed.error.details.sensitive_files.sort(),
      [' notes.txt', '..secret', '.env', '.envrc', '.git-credentials'],
    );
    assert.equal(handoverCall(calls), undefined);
    assert.notEqual(git(workDir, 'status', '--porcelain'), '', 'sensitive files stay local');
    assert.equal(git(workDir, 'log', '-1', '--pretty=%s'), 'init');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--no-wip refuses instead of committing for you', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-nowip-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'base.txt'), 'base\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'base');
    writeFileSync(join(workDir, 'dirty.txt'), 'unsaved\n');

    const { run, calls } = await withStubServer(okHandover, async (apiBase, calls) => ({
      run: await runCli(['handover', 'start', 'x', '--no-wip', ...CHOICES], { cwd: workDir, apiBase }),
      calls,
    }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'working_tree_dirty');
    assert.equal(handoverCall(calls), undefined, 'no hand-over when the tree is refused');
    assert.notEqual(git(workDir, 'status', '--porcelain'), '', 'the tree must be left untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a server-side refusal surfaces as a CLI error, not a false success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-refused-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'a.txt'), 'a\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'work');

    const refuse = (payload) => (payload?.tool_name === SCHEMA_TOOL
      ? schemaResponse
      : {
        status: 200,
        body: {
          status: 'error',
          error_code: 'thread_control_intake_conflict',
          http_status: 409,
          message: 'That request id was already used for different instructions.',
        },
      });

    const run = await withStubServer(refuse, async (apiBase) =>
      runCli(['handover', 'start', 'x', ...CHOICES], { cwd: workDir, apiBase }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'thread_control_intake_conflict');
    assert.match(run.parsed.error.message, /already used/);
    // A refusal is final: asking again, with any key, cannot change the answer.
    assert.ok(
      !run.parsed.hints.some((h) => (h.command || '').includes('handover start')),
      `a refusal must not offer a retry: ${JSON.stringify(run.parsed.hints)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a hostile branch name cannot inject into the command the agent runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-inject-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    // Legal git ref (no spaces), and a command substitution if pasted unquoted.
    const hostile = 'feat/x;curl|sh';
    git(workDir, 'switch', '-q', '-c', hostile);
    writeFileSync(join(workDir, 'a.txt'), 'a\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'work');

    const call = await withStubServer(okHandover, async (apiBase, calls) => {
      const run = await runCli(['handover', 'start', 'do it', ...CHOICES], { cwd: workDir, apiBase });
      assert.equal(run.parsed?.ok, true, run.stderr);
      return handoverCall(calls);
    });

    const line = call.body.arguments.instructions
      .split('\n')
      .find((l) => l.includes('workspace.sh new'));
    // The whole ref sits inside one single-quoted argument, so the shell sees
    // data rather than a second command.
    assert.match(line, /--base 'feat\/x;curl\|sh'/);
    assert.doesNotMatch(line, /--base feat\/x;/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Assembled at runtime so the literal never appears in this file's source: the
// CLI package is mirrored to a public repository, and its sync refuses to
// publish anything containing a token-shaped string.
const FAKE_TOKEN = ['gh', 'p_', 'NOTAREALTOKEN'].join('');

test('a token embedded in the origin url never reaches the instruction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-secret-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'a.txt'), 'a\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'work');
    // Push against the real local origin, but present the remote the way an
    // https checkout with a stored credential does.
    const pushUrl = git(workDir, 'remote', 'get-url', 'origin');
    git(workDir, 'remote', 'set-url', '--push', 'origin', pushUrl);
    git(workDir, 'remote', 'set-url', 'origin',
      `https://x-access-token:${FAKE_TOKEN}@github.com/acme/widgets.git`);

    const call = await withStubServer(okHandover, async (apiBase, calls) => {
      const run = await runCli(['handover', 'start', 'do it', ...CHOICES], { cwd: workDir, apiBase });
      assert.equal(run.parsed?.ok, true, run.stderr);
      return handoverCall(calls);
    });

    const sent = JSON.stringify(call.body);
    assert.ok(!sent.includes(FAKE_TOKEN), 'the token must not be sent anywhere');
    assert.doesNotMatch(sent, /x-access-token/);
    assert.match(call.body.arguments.instructions, /Repository: acme\/widgets/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a wip commit is disclosed when the push then fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-pushfail-'));
  try {
    const { originDir, workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'base.txt'), 'base\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'base');
    writeFileSync(join(workDir, 'dirty.txt'), 'unsaved\n');
    // Make the push fail without touching the working tree.
    rmSync(originDir, { recursive: true, force: true });

    const { run, calls } = await withStubServer(okHandover, async (apiBase, calls) => ({
      run: await runCli(['handover', 'start', 'x', ...CHOICES], { cwd: workDir, apiBase }),
      calls,
    }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'git_push_failed');
    // The commit exists; the user has to be told, and told how to undo it.
    assert.ok(run.parsed.error.details.wip_commit, 'the wip commit must be reported');
    assert.ok(
      run.parsed.hints.some((h) => (h.command || '').includes('git reset --soft')),
      'a way to undo the wip commit must be offered',
    );
    assert.equal(handoverCall(calls), undefined, 'no hand-over when the branch never reached origin');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a hand-over the account cannot make commits and pushes nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-gated-'));
  try {
    const { originDir, workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'base.txt'), 'base\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'base');
    writeFileSync(join(workDir, 'dirty.txt'), 'unsaved\n');

    // The rollout flag is off, so the tool is not available to this account.
    const gated = () => ({
      status: 404,
      body: { error: { code: 'tool_not_available', message: 'Tool is not available.' } },
    });

    const { run, calls } = await withStubServer(gated, async (apiBase, calls) => ({
      run: await runCli(['handover', 'start', 'x', ...CHOICES], { cwd: workDir, apiBase }),
      calls,
    }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'handover_not_available');
    assert.equal(handoverCall(calls), undefined);
    // The point of the preflight: the user's branch is untouched.
    assert.notEqual(git(workDir, 'status', '--porcelain'), '', 'the tree must be left dirty');
    const onOrigin = spawnSync(
      'git',
      ['-C', originDir, 'rev-parse', '--verify', '--quiet', 'refs/heads/feat/auth'],
      { encoding: 'utf8' },
    );
    assert.notEqual(onOrigin.status, 0, 'the branch must never reach origin when refused');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unconfirmed start asks to check its status before handing it over again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-unknown-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'a.txt'), 'a\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'work');

    const unknown = (payload) => (payload?.tool_name === SCHEMA_TOOL
      ? schemaResponse
      : {
        status: 200,
        body: {
          status: 'unknown',
          error_code: 'thread_operation_unconfirmed',
          request_ids: [REQUEST_ID],
          request_key: payload?.arguments?.request_id,
        },
      });

    const { run, calls } = await withStubServer(unknown, async (apiBase, calls) => ({
      run: await runCli(
        [
          'handover', 'start', 'finish it', '--branch-mode', 'same',
          '--route', 'codex_cloud', '--intelligence', 'high', '--speed', 'priority',
        ],
        { cwd: workDir, apiBase },
      ),
      calls,
    }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'handover_unconfirmed');
    assert.match(run.parsed.error.message, /check its status/);
    const key = handoverCall(calls).body.idempotency_key;
    assert.equal(run.parsed.error.details.request_key, `handover:${key}`);
    assert.deepEqual(run.parsed.error.details.request_ids, [REQUEST_ID]);
    // The server keeps this answer under the key and replays it, so the same
    // key can never settle it: check the request, and start a new one only if
    // it never began.
    const commands = run.parsed.hints.map((h) => h.command || '');
    const status = commands.indexOf(`notis handover status ${REQUEST_ID}`);
    // An older route value comes back as the agent it names.
    const fresh = commands.indexOf(
      "notis handover start 'finish it' --route codex --intelligence high --speed priority --branch-mode same",
    );
    assert.ok(status >= 0 && fresh > status, `status first, then a fresh start: ${JSON.stringify(commands)}`);
    assert.ok(!commands.some((c) => c.startsWith('notis --idempotency-key')), 'the same key would replay this answer');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an uncertain failure asks to check the status first, never the same key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-5xx-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'a.txt'), 'a\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'work');

    // A server error, and the cached answer for a call whose outcome is
    // unknown: the gateway replays both to the same key.
    const failures = [
      { status: 502, body: { error: { code: 'bad_gateway', message: 'Upstream went away.' } } },
      {
        status: 409,
        body: {
          error: { code: 'idempotency_outcome_unknown', message: 'The call may have run.' },
          hints: [{ reason: 'Verify the result in the connected service.' }],
        },
      },
    ];
    for (const failure of failures) {
      const failed = await withStubServer(
        (payload) => (payload?.tool_name === SCHEMA_TOOL ? schemaResponse : failure),
        async (apiBase) => runCli(['handover', 'start', 'x', ...CHOICES], { cwd: workDir, apiBase }),
      );
      const label = failure.body.error.code;
      assert.equal(failed.parsed.ok, false, label);
      assert.match(failed.parsed.error.details.request_key, /^handover:/, label);
      const commands = failed.parsed.hints.map((h) => h.command || '');
      const status = commands.indexOf('notis handover status');
      const fresh = commands.indexOf(`notis handover start 'x' ${CHOSEN}`);
      assert.ok(status >= 0 && fresh > status, `${label}: status first, then a fresh start: ${JSON.stringify(commands)}`);
      assert.ok(!commands.some((c) => c.startsWith('notis --idempotency-key')), `${label}: the same key replays it`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a start that is still running, or whose answer was lost, is retried with the same key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-inprogress-'));
  try {
    const { workDir } = makeRepoWithOrigin(root);
    writeFileSync(join(workDir, 'a.txt'), 'a\n');
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'work');

    const busy = {
      status: 409,
      body: {
        error: { code: 'idempotency_in_progress', message: 'This call is still running.' },
        hints: [{ reason: 'Retry with the same idempotency key after the in-progress call completes.' }],
      },
    };
    let key = null;
    for (const [failure, code] of [[busy, 'conflict'], [{ drop: true }, 'network_error']]) {
      const failed = await withStubServer(
        (payload) => (payload?.tool_name === SCHEMA_TOOL ? schemaResponse : failure),
        async (apiBase) => runCli(['handover', 'start', 'x', ...CHOICES], { cwd: workDir, apiBase }),
      );
      assert.equal(failed.parsed.ok, false, code);
      assert.equal(failed.parsed.error.code, code);
      key = failed.parsed.error.details.request_key.slice('handover:'.length);
      const commands = failed.parsed.hints.map((h) => h.command || '');
      assert.ok(
        commands.includes(`notis --idempotency-key '${key}' handover start 'x' ${CHOSEN}`),
        `${code}: the same-key retry must be offered: ${JSON.stringify(commands)}`,
      );
      assert.ok(!commands.some((c) => c.startsWith('notis handover start')), `${code}: a new request could start it twice`);
    }

    // Running that retry sends the same request id, which the server answers
    // with the thread the first attempt started.
    const call = await withStubServer(okHandover, async (apiBase, calls) => {
      const run = await runCli(
        ['--idempotency-key', key, 'handover', 'start', 'x', ...CHOICES],
        { cwd: workDir, apiBase },
      );
      assert.equal(run.parsed?.ok, true, run.stderr);
      return handoverCall(calls);
    });
    assert.equal(call.body.idempotency_key, key);
    assert.equal(call.body.arguments.request_id, `handover:${key}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('handover status reads one request, or the running threads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-status-'));
  try {
    const answer = (payload) => (payload?.arguments?.action === 'request'
      ? {
        status: 200,
        body: {
          status: 'success',
          request_id: REQUEST_ID,
          state: 'completed',
          events: [
            { id: 1, kind: 'thread_progress', body: { message: { text: 'Opened a draft PR.' } }, terminal: false },
            { id: 2, kind: 'thread_result', body: { message: { text: 'Done: tests pass.' } }, terminal: true },
          ],
          has_more: false,
        },
      }
      : { status: 200, body: { status: 'success', threads: [{ id: 'row-1', title: 'fix the tests' }] } });

    const { one, all, calls } = await withStubServer(answer, async (apiBase, calls) => ({
      one: await runCli(['handover', 'status', REQUEST_ID], { cwd: root, apiBase }),
      all: await runCli(['handover', 'status'], { cwd: root, apiBase }),
      calls,
    }));

    assert.equal(one.parsed?.ok, true, one.stderr);
    assert.equal(one.parsed.data.state, 'completed');
    assert.match(one.parsed.human_summary, /finished/);
    assert.equal(all.parsed?.ok, true, all.stderr);
    assert.deepEqual(all.parsed.data.threads, [{ id: 'row-1', title: 'fix the tests' }]);

    const reads = calls.filter((c) => c.body.tool_name === THREADS_TOOL);
    assert.deepEqual(reads.map((c) => c.body.arguments), [
      { action: 'request', request_id: REQUEST_ID },
      { action: 'list', filters: { activity: 'running' }, limit: 20 },
    ]);
    // The server asks every call to this tool for a key; reads must never
    // share one, or the second would replay the first's cached answer.
    const keys = reads.map((c) => c.body.idempotency_key);
    assert.ok(keys.every(Boolean), 'each read carries a key');
    assert.notEqual(keys[0], keys[1]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
