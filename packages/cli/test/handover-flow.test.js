/**
 * End-to-end `handover start`: a real git repository with a real origin, a stub
 * /cli_tools, and the actual CLI binary. What this pins down is the contract
 * between the two halves -- that the branch really reaches origin before the
 * hand-over is sent, and that the routing target the user typed is the one that
 * arrives at the server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CLI = new URL('../bin/notis.js', import.meta.url).pathname;
const ROUTES = ['notis', 'auto', 'codex_cloud', 'claude_cloud', 'codex_local', 'claude_local'];

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
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
function runCli(args, { cwd, apiBase }) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args, '--api-base', apiBase], {
      cwd,
      env: {
        ...process.env,
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
// committing anything) and then the hand-over itself.
const SCHEMA_TOOL = 'COMPOSIO_GET_TOOL_SCHEMAS';

const okHandover = (payload) => {
  if (payload?.tool_name === SCHEMA_TOOL) {
    return {
      status: 200,
      body: { tools: [{ name: 'LOCAL_NOTIS_HAND_OVER', parameters: { type: 'object' } }] },
    };
  }
  return {
    status: 200,
    body: {
      status: 'success',
      message: 'Handed over.',
      interaction_id: 'int-1',
      agent_routing: payload?.arguments?.agent_routing || 'notis',
    },
  };
};

/** The hand-over call, not the preflight that precedes it. */
const handoverCall = (calls) =>
  calls.find((c) => c.path === '/cli_tools' && c.body.tool_name === 'LOCAL_NOTIS_HAND_OVER');

test('handover start pushes the branch and forwards each routing target', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-handover-flow-'));
  try {
    const { originDir, workDir } = makeRepoWithOrigin(root);

    for (const route of ROUTES) {
      // A commit per route, so each run has something new to push.
      writeFileSync(join(workDir, `${route}.txt`), `${route}\n`);
      git(workDir, 'add', '-A');
      git(workDir, 'commit', '-q', '-m', `work for ${route}`);

      const result = await withStubServer(okHandover, async (apiBase, calls) => {
        const run = await runCli(
          ['handover', 'start', `do the ${route} work`, '--route', route],
          { cwd: workDir, apiBase },
        );
        return { run, calls };
      });

      assert.equal(result.run.parsed?.ok, true, `${route}: ${result.run.stderr}`);
      assert.equal(result.run.parsed.data.agent_routing, route);
      assert.equal(result.run.parsed.data.branch, 'feat/auth');

      const call = handoverCall(result.calls);
      assert.ok(call, `${route}: no hand-over call`);
      assert.equal(call.body.tool_name, 'LOCAL_NOTIS_HAND_OVER');
      assert.equal(call.body.arguments.agent_routing, route);
      assert.ok(call.body.idempotency_key, 'a mutating call must carry an idempotency key');

      // The branch has to exist on origin before the agent is told about it.
      const remoteHead = git(originDir, 'rev-parse', 'refs/heads/feat/auth');
      assert.equal(remoteHead, git(workDir, 'rev-parse', 'HEAD'), `${route}: branch not pushed`);
    }
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
      await runCli(['handover', 'start', 'finish it', '--branch-mode', 'same'], { cwd: workDir, apiBase });
      return handoverCall(calls);
    });
    // Quoted: the branch is interpolated into a command line the agent runs.
    assert.match(same.body.arguments.instruction, /--continue-branch 'feat\/auth'/);
    assert.match(same.body.arguments.instruction, /Work ON branch feat\/auth itself/);
    assert.match(same.body.arguments.instruction, /never force-push/);

    const fresh = await withStubServer(okHandover, async (apiBase, calls) => {
      await runCli(['handover', 'start', 'start beside it'], { cwd: workDir, apiBase });
      return handoverCall(calls);
    });
    assert.match(fresh.body.arguments.instruction, /--base 'feat\/auth'/);
    assert.match(fresh.body.arguments.instruction, /Cut a NEW branch/);

    // Both modes must tell the receiving agent not to hand the task on again.
    for (const call of [same, fresh]) {
      assert.match(call.body.arguments.instruction, /do not run `notis handover` yourself/i);
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
      const run = await runCli(['handover', 'start', 'keep my work'], { cwd: workDir, apiBase });
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
      run: await runCli(['handover', 'start', 'sensitive task text'], { cwd: workDir, apiBase }),
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
      run: await runCli(['handover', 'start', 'do it'], { cwd: workDir, apiBase }),
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
      run: await runCli(['handover', 'start', 'x', '--no-wip'], { cwd: workDir, apiBase }),
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
      ? { status: 200, body: { tools: [{ name: 'LOCAL_NOTIS_HAND_OVER' }] } }
      : {
        status: 200,
        body: {
          status: 'error',
          error_code: 'handover_not_available_here',
          message: 'Hand-over runs only from a signed-in Notis CLI or MCP client.',
        },
      });

    const run = await withStubServer(refuse, async (apiBase) =>
      runCli(['handover', 'start', 'x'], { cwd: workDir, apiBase }));

    assert.equal(run.parsed.ok, false);
    assert.equal(run.parsed.error.code, 'handover_not_available_here');
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
      const run = await runCli(['handover', 'start', 'do it'], { cwd: workDir, apiBase });
      assert.equal(run.parsed?.ok, true, run.stderr);
      return handoverCall(calls);
    });

    const line = call.body.arguments.instruction
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
      const run = await runCli(['handover', 'start', 'do it'], { cwd: workDir, apiBase });
      assert.equal(run.parsed?.ok, true, run.stderr);
      return handoverCall(calls);
    });

    const sent = JSON.stringify(call.body);
    assert.ok(!sent.includes(FAKE_TOKEN), 'the token must not be sent anywhere');
    assert.doesNotMatch(sent, /x-access-token/);
    assert.match(call.body.arguments.instruction, /Repository: acme\/widgets/);
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
      run: await runCli(['handover', 'start', 'x'], { cwd: workDir, apiBase }),
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
      run: await runCli(['handover', 'start', 'x'], { cwd: workDir, apiBase }),
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
