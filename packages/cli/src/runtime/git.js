/**
 * Local git inspection for `notis handover`.
 *
 * The CLI has no other reason to know about git, so this stays deliberately
 * small: read where we are, push the branch, and report what the remote is.
 * Everything else about the repository is the cloud workspace's problem.
 *
 * Every call is `spawnSync` on the real `git` binary rather than a library.
 * The user's credentials, hooks, SSH agent and includeIf config are what make a
 * push succeed on their machine, and only their own git honors all of them.
 */

import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { CliError, EXIT_CODES } from './errors.js';

const GIT_TIMEOUT_MS = 120_000;
const MAX_SECRET_SCAN_BYTES = 1_000_000;
const SAFE_ENV_TEMPLATES = /^\.env\.(?:example|sample|template)$/i;
const SENSITIVE_PATH = /^(?:\.env(?:\..+)?|\.envrc|\.git-credentials|\.npmrc|\.pypirc|\.netrc|credentials(?:\..+)?|secrets?(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|jks))$/i;
const SENSITIVE_CONTENT = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
];

export function runGit(
  args,
  { cwd = process.cwd(), timeoutMs = GIT_TIMEOUT_MS, trimOutput = true } = {},
) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      // A push that stops to ask for a password would hang a non-interactive
      // agent run forever. Fail fast instead and let the hint explain.
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  if (result.error && result.error.code === 'ENOENT') {
    throw new CliError({
      code: 'git_not_found',
      message: 'git is not installed or not on PATH.',
      exitCode: EXIT_CODES.usage,
    });
  }
  return {
    exitCode: result.status ?? 1,
    stdout: trimOutput ? (result.stdout || '').trim() : (result.stdout || ''),
    stderr: trimOutput ? (result.stderr || '').trim() : (result.stderr || ''),
  };
}

function gitOrNull(args, options) {
  const result = runGit(args, options);
  return result.exitCode === 0 ? result.stdout : null;
}

function nulSeparatedGitPaths(args, repository) {
  const result = runGit([...args, '-z'], { cwd: repository.toplevel, trimOutput: false });
  if (result.exitCode !== 0 || !result.stdout) return [];
  return result.stdout.split('\0').filter(Boolean);
}

/** Exact files `git add -A` would include, expanding untracked directories. */
function filesToAutoCommit(repository) {
  return [...new Set([
    ...nulSeparatedGitPaths(['diff', '--name-only'], repository),
    ...nulSeparatedGitPaths(['diff', '--cached', '--name-only'], repository),
    ...nulSeparatedGitPaths(['ls-files', '--others', '--exclude-standard'], repository),
  ])];
}

/** Refuse files that are unsafe to publish automatically without user review. */
export function sensitiveAutoCommitFiles(repository) {
  const root = resolve(repository.toplevel);
  const sensitive = [];
  for (const path of filesToAutoCommit(repository)) {
    const absolute = resolve(root, path);
    const insideRoot = relative(root, absolute);
    if (insideRoot === '..' || insideRoot.startsWith(`..${sep}`) || insideRoot === '') continue;
    const name = basename(path);
    if (SENSITIVE_PATH.test(name) && !SAFE_ENV_TEMPLATES.test(name)) {
      sensitive.push(path);
      continue;
    }
    try {
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.size > MAX_SECRET_SCAN_BYTES) continue;
      const content = readFileSync(absolute, 'utf8');
      if (SENSITIVE_CONTENT.some((pattern) => pattern.test(content))) sensitive.push(path);
    } catch {
      // Deleted files and paths racing with an editor have no content to leak.
    }
  }
  return sensitive;
}

/**
 * Parse an origin URL into {owner, repo}. Handles the three forms git remotes
 * actually take: scp-style ssh, ssh:// and https://.
 */
export function parseRemoteUrl(url) {
  if (typeof url !== 'string' || !url) {
    return null;
  }
  const trimmed = url.trim().replace(/\.git$/, '');
  const scp = trimmed.match(/^[^@]+@([^:]+):(.+)$/);
  const path = scp ? scp[2] : trimmed.replace(/^[a-z+]+:\/\/(?:[^@/]+@)?[^/]+\//i, '');
  const host = scp ? scp[1] : (trimmed.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^/]+)/i) || [])[1];
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  return {
    host: host || null,
    owner: segments[segments.length - 2],
    repo: segments[segments.length - 1],
  };
}

/** Everything `handover start` needs to know about where it is running. */
export function inspectRepository(cwd = process.cwd()) {
  const toplevel = gitOrNull(['rev-parse', '--show-toplevel'], { cwd });
  if (!toplevel) {
    throw new CliError({
      code: 'not_a_git_repository',
      message: 'Hand-over runs from inside a git repository.',
      exitCode: EXIT_CODES.usage,
      hints: [{ message: 'cd into the repository you want Notis to work on, then run the command again.' }],
    });
  }

  const branch = gitOrNull(['branch', '--show-current'], { cwd: toplevel });
  if (!branch) {
    throw new CliError({
      code: 'detached_head',
      message: 'HEAD is detached, so there is no branch to hand over.',
      exitCode: EXIT_CODES.usage,
      hints: [{ message: 'Check out a branch first: git switch -c my-feature' }],
    });
  }

  const remoteUrl = gitOrNull(['remote', 'get-url', 'origin'], { cwd: toplevel });
  if (!remoteUrl) {
    throw new CliError({
      code: 'no_origin_remote',
      message: 'This repository has no "origin" remote, so the cloud agent cannot fetch the branch.',
      exitCode: EXIT_CODES.usage,
      hints: [{ message: 'Add one: git remote add origin <url>' }],
    });
  }

  const status = runGit(['status', '--porcelain'], { cwd: toplevel });
  const dirtyFiles = status.stdout
    ? status.stdout.split('\n').map((line) => line.slice(3).trim()).filter(Boolean)
    : [];

  return {
    toplevel,
    branch,
    remoteUrl,
    remote: parseRemoteUrl(remoteUrl),
    dirtyFiles,
    head: gitOrNull(['rev-parse', 'HEAD'], { cwd: toplevel }),
    upstream: gitOrNull(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
      cwd: toplevel,
    }),
  };
}

/** Commit everything in the working tree, including untracked files. */
export function commitWorkingTree(repository, message) {
  const sensitiveFiles = sensitiveAutoCommitFiles(repository);
  if (sensitiveFiles.length) {
    throw new CliError({
      code: 'sensitive_working_tree',
      message: 'Refusing to publish files that may contain credentials or private keys.',
      exitCode: EXIT_CODES.conflict,
      details: { sensitive_files: sensitiveFiles.slice(0, 20) },
      hints: [
        { message: 'Review, remove, or ignore these files before handing over.' },
        { message: 'To publish them deliberately, commit and push them yourself first.' },
      ],
    });
  }
  const add = runGit(['add', '-A'], { cwd: repository.toplevel });
  if (add.exitCode !== 0) {
    throw new CliError({
      code: 'git_add_failed',
      message: `Could not stage the working tree: ${add.stderr || add.stdout}`,
      exitCode: EXIT_CODES.unexpected,
    });
  }
  const commit = runGit(['commit', '-m', message], { cwd: repository.toplevel });
  if (commit.exitCode !== 0) {
    throw new CliError({
      code: 'git_commit_failed',
      message: `Could not commit the working tree: ${commit.stderr || commit.stdout}`,
      exitCode: EXIT_CODES.unexpected,
      hints: [{ message: 'Commit the changes yourself, then run the hand-over again.' }],
    });
  }
  return gitOrNull(['rev-parse', 'HEAD'], { cwd: repository.toplevel });
}

/**
 * Push the branch to origin. The cloud workspace fetches from origin, so an
 * unpushed commit simply does not exist as far as the hand-over is concerned.
 */
export function pushBranch(repository, branch) {
  const args = repository.upstream
    ? ['push', 'origin', branch]
    : ['push', '--set-upstream', 'origin', branch];
  const result = runGit(args, { cwd: repository.toplevel });
  if (result.exitCode !== 0) {
    throw new CliError({
      code: 'git_push_failed',
      message: `Could not push ${branch} to origin: ${result.stderr || result.stdout}`,
      exitCode: EXIT_CODES.conflict,
      hints: [
        { message: 'The cloud agent works from origin, so the branch has to be pushed first.' },
        { message: 'If the remote moved ahead, reconcile locally (git pull --rebase) and retry.' },
      ],
    });
  }
  return true;
}
