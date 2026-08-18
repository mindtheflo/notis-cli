import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { assertToolNotDelegated, delegatedContextReason } from '../src/runtime/delegated-context.js';
import { inspectRepository, parseRemoteUrl } from '../src/runtime/git.js';
import { COMMAND_SPECS, GROUP_SUMMARIES } from '../src/command-specs/index.js';

const CLI = new URL('../bin/notis.js', import.meta.url).pathname;

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'notis-handover-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'README.md'), '# test\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git');
  return dir;
}

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NOTIS_JWT: 'test-token',
      NOTIS_OUTPUT: 'json',
      NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
      ...env,
    },
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return { ...result, parsed };
}

test('handover commands are registered under their own group', () => {
  const paths = COMMAND_SPECS
    .filter((spec) => spec.command_path[0] === 'handover')
    .map((spec) => spec.command_path.join(' '));
  assert.deepEqual(paths, ['handover start', 'handover status']);
  assert.ok(GROUP_SUMMARIES.handover, 'the group needs a summary for help output');
});

test('handover start declares every routing target the server accepts', () => {
  const spec = COMMAND_SPECS.find((s) => s.command_path.join(' ') === 'handover start');
  const route = spec.args_schema.options.find((o) => o.flags.startsWith('--route'));
  for (const target of ['notis', 'codex_cloud', 'claude_cloud', 'codex_local', 'claude_local', 'auto']) {
    assert.match(route.description, new RegExp(target), `--route must document ${target}`);
  }
  assert.equal(spec.mutates, true);
  assert.equal(spec.backend_call.name, 'LOCAL_NOTIS_HAND_OVER');
});

test('a delegated context is detected from each marker Notis sets', () => {
  const never = () => false;
  assert.equal(delegatedContextReason({}, { fileExists: never }), null);
  assert.match(
    delegatedContextReason({ NOTIS_DELEGATED_CONTEXT: '1' }, { fileExists: never }),
    /delegated coding agent/,
  );
  assert.match(
    delegatedContextReason({ NOTIS_AGENT: '1', NOTIS_JWT: 'x' }, { fileExists: never }),
    /authenticated as a Notis agent/,
  );
  // NOTIS_AGENT alone is just non-interactive output; it is not proof of a
  // delegated run and must not block a person scripting the CLI.
  assert.equal(delegatedContextReason({ NOTIS_AGENT: '1' }, { fileExists: never }), null);
});

test('handover start refuses inside a Notis-delegated run', () => {
  for (const env of [{ NOTIS_DELEGATED_CONTEXT: '1' }, { NOTIS_AGENT: '1', NOTIS_JWT: 'fake' }]) {
    const { parsed } = runCli(['handover', 'start', 'do the thing'], env);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, 'handover_from_delegated_context');
  }
});

test('handover start validates route and branch mode before touching git', () => {
  const badRoute = runCli(['handover', 'start', 'x', '--route', 'gpt5']);
  assert.equal(badRoute.parsed.error.code, 'usage_error');
  assert.match(badRoute.parsed.error.message, /--route must be one of/);

  const badMode = runCli(['handover', 'start', 'x', '--branch-mode', 'sideways']);
  assert.equal(badMode.parsed.error.code, 'usage_error');
  assert.match(badMode.parsed.error.message, /--branch-mode must be one of/);
});

test('remote urls parse in every form a git remote takes', () => {
  const expected = { owner: 'acme', repo: 'widgets' };
  for (const url of [
    'git@github.com:acme/widgets.git',
    'https://github.com/acme/widgets.git',
    'https://user@github.com/acme/widgets',
    'ssh://git@github.com/acme/widgets.git',
  ]) {
    const parsed = parseRemoteUrl(url);
    assert.equal(parsed.owner, expected.owner, url);
    assert.equal(parsed.repo, expected.repo, url);
  }
  assert.equal(parseRemoteUrl('not-a-url'), null);
  assert.equal(parseRemoteUrl(''), null);
});

test('repository inspection reports branch, remote and dirty files', () => {
  const dir = makeRepo();
  try {
    git(dir, 'switch', '-q', '-c', 'feat/auth');
    let repo = inspectRepository(dir);
    assert.equal(repo.branch, 'feat/auth');
    assert.equal(repo.remote.owner, 'acme');
    assert.equal(repo.remote.repo, 'widgets');
    assert.deepEqual(repo.dirtyFiles, []);

    writeFileSync(join(dir, 'new-file.txt'), 'wip\n');
    repo = inspectRepository(dir);
    assert.deepEqual(repo.dirtyFiles, ['new-file.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a detached HEAD is refused with a usable message', () => {
  const dir = makeRepo();
  try {
    git(dir, 'checkout', '-q', '--detach');
    assert.throws(() => inspectRepository(dir), (error) => {
      assert.equal(error.code, 'detached_head');
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a repository with no origin is refused before anything is pushed', () => {
  const dir = makeRepo();
  try {
    git(dir, 'remote', 'remove', 'origin');
    assert.throws(() => inspectRepository(dir), (error) => {
      assert.equal(error.code, 'no_origin_remote');
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory outside any repository is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notis-not-a-repo-'));
  try {
    assert.throws(() => inspectRepository(dir), (error) => {
      assert.equal(error.code, 'not_a_git_repository');
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the delegated guard covers tools exec, not just the handover command', () => {
  const env = { NOTIS_DELEGATED_CONTEXT: '1' };
  // The friendly command and the escape hatch around it must refuse alike.
  assert.throws(() => assertToolNotDelegated('LOCAL_NOTIS_HAND_OVER', env), (error) => {
    assert.equal(error.code, 'handover_from_delegated_context');
    return true;
  });
  // Lower-case names reach the same tool.
  assert.throws(() => assertToolNotDelegated('local_notis_hand_over', env));
  // Everything else a delegated agent legitimately does still works.
  assert.doesNotThrow(() => assertToolNotDelegated('LOCAL_NOTIS_DATABASE_QUERY', env));
  assert.doesNotThrow(() => assertToolNotDelegated('LOCAL_NOTIS_HAND_OVER', {}));
});

test('tools exec refuses the handover tool inside a delegated run', () => {
  const { parsed } = runCli(
    ['tools', 'exec', 'LOCAL_NOTIS_HAND_OVER', '--arguments', '{"instruction":"x"}'],
    { NOTIS_DELEGATED_CONTEXT: '1' },
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'handover_from_delegated_context');
});

test('exec-parallel refuses a batch containing the handover tool', () => {
  const calls = JSON.stringify([
    { tool_name: 'LOCAL_NOTIS_DATABASE_QUERY', arguments: {} },
    { tool_name: 'LOCAL_NOTIS_HAND_OVER', arguments: { instruction: 'x' } },
  ]);
  const { parsed } = runCli(['tools', 'exec-parallel', calls], { NOTIS_DELEGATED_CONTEXT: '1' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'handover_from_delegated_context');
});
