import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { delegatedContextReason } from '../src/runtime/delegated-context.js';
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

// Only validation fixtures simulate a personal terminal. The real subprocess guard
// remains in use for delegated-context tests; production has no test override.
const PERSONAL_TERMINAL = `data:text/javascript;base64,${Buffer.from(`
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  const exists = fs.existsSync;
  fs.existsSync = path => path === '/vercel/sandbox' ? false : exists(path);
  syncBuiltinESMExports();
`).toString('base64')}`;

function runCli(args, env = {}, { personalTerminal = false } = {}) {
  const preload = personalTerminal ? ['--import', PERSONAL_TERMINAL] : [];
  const result = spawnSync(process.execPath, [...preload, CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NOTIS_JWT: 'test-token',
      NOTIS_OUTPUT: 'json',
      NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
      ...(personalTerminal ? { NOTIS_AGENT: '', NOTIS_DELEGATED_CONTEXT: '' } : {}),
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

function runPersonalCli(args) {
  return runCli(args, {}, { personalTerminal: true });
}

test('handover commands are registered under their own group', () => {
  const paths = COMMAND_SPECS
    .filter((spec) => spec.command_path[0] === 'handover')
    .map((spec) => spec.command_path.join(' '));
  assert.deepEqual(paths, ['handover start', 'handover status']);
  assert.ok(GROUP_SUMMARIES.handover, 'the group needs a summary for help output');
});

test('handover start asks for the agent, intelligence and speed, and shows nothing older', () => {
  const spec = COMMAND_SPECS.find((s) => s.command_path.join(' ') === 'handover start');
  const option = (flag) => spec.args_schema.options.find((o) => o.flags.startsWith(flag));
  const choices = {
    '--route': ['notis', 'codex', 'claude', 'auto'],
    '--intelligence': ['low', 'medium', 'high', 'auto'],
    '--speed': ['normal', 'priority', 'flex'],
  };
  for (const [flag, values] of Object.entries(choices)) {
    // Required, so the caller turns the user's words into a choice instead of
    // leaving it to the Manager.
    assert.match(option(flag).description, /^Required\./, `${flag} must say it is required`);
    for (const value of values) {
      assert.match(option(flag).description, new RegExp(`\\b${value}\\b`), `${flag} must document ${value}`);
    }
  }
  assert.match(option('--speed').description, /for Codex or Claude only when the user asks for their fast mode/);
  assert.match(spec.when_to_use, /from the user's words/);
  for (const example of spec.examples) {
    for (const flag of Object.keys(choices)) {
      assert.ok(example.includes(` ${flag} `), `${example} must name ${flag}`);
    }
  }
  // The older values still work (see handover-flow.test.js) but are never shown.
  const shown = [
    ...spec.args_schema.options.map((o) => o.description), spec.when_to_use, spec.output_schema, ...spec.examples,
  ].join('\n');
  assert.doesNotMatch(shown, /codex_cloud|claude_cloud|codex_local|claude_local/);
  assert.equal(spec.mutates, true);
  assert.equal(spec.backend_call.name, 'LOCAL_NOTIS_CONTROL_THREADS');
});

test('handover status reads threads through the same tool', () => {
  const spec = COMMAND_SPECS.find((s) => s.command_path.join(' ') === 'handover status');
  assert.equal(spec.mutates, false);
  assert.equal(spec.backend_call.name, 'LOCAL_NOTIS_CONTROL_THREADS');
  assert.deepEqual(spec.args_schema.arguments.map((a) => a.key), ['requestId']);
});

test('a delegated context is detected from each marker Notis sets', () => {
  const never = () => false;
  assert.equal(delegatedContextReason({}, { fileExists: never }), null);
  assert.match(delegatedContextReason({}, { fileExists: path => path === '/vercel/sandbox' }), /Notis cloud computer/);
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

test('handover start validates every choice and the branch mode before touching git', () => {
  const badRoute = runPersonalCli(['handover', 'start', 'x', '--route', 'gpt5']);
  assert.equal(badRoute.parsed.error.code, 'usage_error');
  assert.match(badRoute.parsed.error.message, /--route must be one of: notis, codex, claude, auto$/);

  const badIntelligence = runPersonalCli(['handover', 'start', 'x', '--intelligence', 'ultra']);
  assert.equal(badIntelligence.parsed.error.code, 'usage_error');
  assert.match(badIntelligence.parsed.error.message, /--intelligence must be one of: low, medium, high, auto$/);

  const badSpeed = runPersonalCli(['handover', 'start', 'x', '--speed', 'turbo']);
  assert.equal(badSpeed.parsed.error.code, 'usage_error');
  assert.match(badSpeed.parsed.error.message, /--speed must be one of: normal, priority, flex$/);

  const badMode = runPersonalCli(['handover', 'start', 'x', '--branch-mode', 'sideways']);
  assert.equal(badMode.parsed.error.code, 'usage_error');
  assert.match(badMode.parsed.error.message, /--branch-mode must be one of/);
});

test('handover start makes the caller name the agent, intelligence and speed', () => {
  const none = runPersonalCli(['handover', 'start', 'x']);
  assert.equal(none.parsed.error.code, 'usage_error');
  assert.deepEqual(none.parsed.error.details.missing, ['--route', '--intelligence', '--speed']);
  // One refusal lists every missing choice with its values, and asks for the
  // user's own words rather than a default.
  assert.match(none.parsed.error.message, /from the user's words/);
  assert.match(none.parsed.error.message, /--route notis\|codex\|claude\|auto/);
  assert.match(none.parsed.error.message, /--intelligence low\|medium\|high\|auto/);
  assert.match(none.parsed.error.message, /--speed normal\|priority\|flex/);

  const some = runPersonalCli(['handover', 'start', 'x', '--route', 'codex']);
  assert.deepEqual(some.parsed.error.details.missing, ['--intelligence', '--speed']);
});

test('flex is refused unless Notis runs it, since Codex and Claude have no flex speed', () => {
  // auto too: Notis may pick Codex or Claude, which would then inherit flex.
  for (const route of ['codex', 'claude', 'claude_cloud', 'auto']) {
    const { parsed } = runPersonalCli(['handover', 'start', 'x', '--route', route, '--intelligence', 'medium', '--speed', 'flex']);
    assert.equal(parsed.error.code, 'usage_error', route);
    assert.match(parsed.error.message, /--speed flex runs on Notis only/, route);
  }
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

test('tools exec stays open inside a delegated run', () => {
  // Agents start and steer threads on purpose; only `handover start` refuses.
  const { parsed } = runCli(
    ['tools', 'exec', 'LOCAL_NOTIS_CONTROL_THREADS', '--dry-run', '--arguments', '{"action":"list"}'],
    { NOTIS_DELEGATED_CONTEXT: '1', NOTIS_API_BASE: 'http://127.0.0.1:9' },
  );
  assert.notEqual(parsed?.error?.code, 'handover_from_delegated_context');
});
