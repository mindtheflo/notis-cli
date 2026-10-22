// Decides whether a release, a merge or a catch-up publishes the CLI, and from
// which commit. The CLI (and the SDK inside it) ships right after the release
// that changed it, so the web app and the agents stay in sync: it never ships
// ahead of the server it talks to, and it compares against the source commit of
// the version the channel's npm tag points at, not against a date window.
//
// CommonJS (.cjs) on purpose, like release-channels.cjs: the Depot workflow's
// github-script step requires this file. Unit tests: test/release-trigger.test.js.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PACKAGE_NAME = '@notis_ai/cli';
const CHANNEL_TAGS = Object.freeze({ beta: 'beta', production: 'latest' });

// The push paths of .depot/workflows/publish-cli-package.yml, as git pathspecs.
// A change here is a CLI change. A test keeps the two lists equal.
const WATCHED_PATHS = Object.freeze([
  'packages/cli',
  'packages/sdk',
  'packages/view-renderer',
  'portal/src/lib/blockNote.ts',
  'server/skills/notis-spaces',
  'server/skills/notis-query',
  'server/skills/notis-cli',
  'server/config/notis_app_boundary_rules.json',
  '.depot/workflows/publish-cli-package.yml',
]);

// The push paths of .depot/workflows/temporal-release.yml. A change here is not
// live until its release, and that release publishes the CLI when it is.
const RELEASE_INPUT_PATHS = Object.freeze([
  'server',
  'prompts',
  'scripts/temporal_release.py',
  'scripts/temporal_maintenance.py',
  'scripts/render_infrastructure.py',
  'scripts/render_post_release_jobs.py',
  'infra',
  'packages/view-renderer',
  '.github/scripts/sync_voice_agent_prompt.py',
  '.depot/workflows/temporal-release.yml',
]);

const SHA = /^[0-9a-f]{40}$/;
const BRANCHES = Object.freeze({ 'refs/heads/beta': 'beta', 'refs/heads/production': 'production' });
const MAX_LISTED = 5;

// preview: any manual run of the workflow itself, always read-only.
// merge: a push of CLI files to beta or production.
// release: called by temporal-release.yml after it made a commit live.
// catch-up: called by post-release-catch-up.yml with the commit Render serves;
// it publishes only the CLI that commit contains, nothing newer.
// GitHub gives a called workflow its caller's event; workflow_call is accepted
// too so that a runner reporting the call itself still resolves the same mode.
function resolveMode({ eventName, trigger }) {
  if (!trigger) {
    if (eventName === 'workflow_dispatch') return 'preview';
    if (eventName === 'push') return 'merge';
    throw new Error(`The CLI publisher does not run on ${eventName || 'an unknown'} events`);
  }
  if (trigger === 'release' && ['push', 'workflow_call'].includes(eventName)) return 'release';
  if (trigger === 'catch-up' && ['workflow_dispatch', 'workflow_call'].includes(eventName)) return 'catch-up';
  throw new Error(`The ${trigger} trigger cannot run from a ${eventName || 'an unknown'} event`);
}

function isWatched(file) {
  return WATCHED_PATHS.some(watched => file === watched || file.startsWith(`${watched}/`));
}

// The version a channel's tag ships and the commit it was built from.
function publishedSource(history, channel) {
  const tag = CHANNEL_TAGS[channel];
  if (!tag) throw new Error(`Unsupported channel: ${channel}`);
  const version = history?.['dist-tags']?.[tag] || null;
  const receipt = version ? history.versions?.[version] : null;
  const recorded = receipt?.notisRelease?.sourceSha || receipt?.gitHead || '';
  return { tag, version, sourceSha: SHA.test(recorded) ? recorded : null };
}

async function readRegistryHistory({ fetcher } = {}) {
  const { readReleaseHistory } = await import(pathToFileURL(path.join(__dirname, 'release-registry.js')).href);
  return readReleaseHistory(PACKAGE_NAME, fetcher ? { fetcher } : {});
}

function gitClient(cwd) {
  const run = args => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  const status = args => {
    try {
      run(args);
      return 0;
    } catch (error) {
      return typeof error.status === 'number' ? error.status : -1;
    }
  };
  const present = sha => status(['cat-file', '-e', `${sha}^{commit}`]) === 0;
  return {
    // True when the commit is local, fetching it by SHA from origin if needed.
    ensure(sha) {
      if (present(sha)) return true;
      status(['fetch', '--quiet', '--no-tags', 'origin', sha]);
      return present(sha);
    },
    isAncestor(ancestor, descendant) {
      const code = status(['merge-base', '--is-ancestor', ancestor, descendant]);
      if (code !== 0 && code !== 1) throw new Error('git merge-base failed');
      return code === 0;
    },
    changed(from, to, pathspecs) {
      return run(['diff', '--name-only', '--no-renames', from, to, '--', ...pathspecs])
        .split('\n').filter(Boolean);
    },
  };
}

function listed(files) {
  const shown = files.slice(0, MAX_LISTED).join(', ');
  return files.length > MAX_LISTED ? `${shown} and ${files.length - MAX_LISTED} more` : shown;
}

// head: the channel's branch head, the only commit the npm finalizer publishes.
// liveSha: the commit the channel's servers run. published: publishedSource().
// strict (catch-up): publish only the CLI the live release contains, so the
// head's CLI files must equal the live commit's.
function decide({ channel, head, liveSha, published, git, strict = false }) {
  if (!CHANNEL_TAGS[channel]) throw new Error(`Unsupported channel: ${channel}`);
  if (!SHA.test(head || '') || !SHA.test(liveSha || '')) throw new Error('The branch head and the live release must be exact commits');
  if (!git.ensure(head) || !git.ensure(liveSha)) throw new Error('The branch head or the live release is not on origin');
  if (!git.isAncestor(liveSha, head)) throw new Error(`The live release ${liveSha} is not on ${channel}`);
  const pending = git.changed(liveSha, head, RELEASE_INPUT_PATHS);
  if (pending.length) {
    return { publish: false, reason: `${channel} at ${head} changes server files that are not live yet `
      + `(${listed(pending)}); their release publishes the CLI` };
  }
  const newer = strict ? git.changed(liveSha, head, WATCHED_PATHS) : [];
  if (newer.length) {
    return { publish: false, reason: `${channel} changed CLI files after the live release ${liveSha} `
      + `(${listed(newer)}); a catch-up publishes only what that release contains` };
  }
  const { tag, version, sourceSha } = published;
  if (!version) return { publish: true, reason: `nothing is published on ${tag} yet` };
  if (!sourceSha) return { publish: true, reason: `${tag} ${version} records no source commit` };
  if (sourceSha === head) return { publish: false, reason: `${tag} ${version} already ships ${head}` };
  if (!git.ensure(sourceSha)) {
    return { publish: true, reason: `${tag} ${version} was built from ${sourceSha}, which origin no longer has` };
  }
  if (git.isAncestor(head, sourceSha)) {
    return { publish: false, reason: `${tag} ${version} ships ${sourceSha}, which already contains ${head}` };
  }
  const changed = git.changed(sourceSha, head, WATCHED_PATHS);
  if (!changed.length) {
    return { publish: false, reason: `no CLI or SDK file changed since ${tag} ${version} (${sourceSha})` };
  }
  return { publish: true, changed,
    reason: `${changed.length} CLI or SDK file(s) changed since ${tag} ${version}: ${listed(changed)}` };
}

// Plans one publishing run. Returns the matrix row to build, or none, and why.
async function planPublication({ mode, ref, sha, channel, sourceSha, liveState, liveSha, readHead, cwd,
  readHistory = readRegistryHistory, git = gitClient(cwd) }) {
  const branch = BRANCHES[ref];
  if (!branch) throw new Error(`A ${mode} run publishes only from beta or production, not ${ref || 'an unknown ref'}`);
  let target = channel;
  let live = sourceSha;
  if (mode === 'merge') {
    target = branch;
    if (liveState === 'off') {
      return { channel: target, row: { channel: target, source_sha: await readHead(target),
        publish_reason: `${target} releases are off: rehearsal only` }, reason: `${target} releases are off: rehearsal only` };
    }
    if (liveState === 'deploying') {
      return { channel: target, row: null, reason: 'a release is deploying; it publishes the CLI when it is live' };
    }
    if (liveState !== 'live') throw new Error(`The live release of ${target} is unknown (${liveState || 'no answer'})`);
    live = liveSha;
  } else if (mode === 'release') {
    if (channel !== branch) throw new Error(`A ${branch} release cannot publish the ${channel} CLI`);
    if (sourceSha !== sha) throw new Error('A release publishes after its own released commit only');
  } else if (mode === 'catch-up') {
    if (!CHANNEL_TAGS[channel]) throw new Error(`Unsupported channel: ${channel}`);
  } else {
    throw new Error(`planPublication does not plan ${mode} runs`);
  }
  const head = await readHead(target);
  const published = publishedSource(await readHistory(), target);
  const decision = decide({ channel: target, head, liveSha: live, published, git, strict: mode === 'catch-up' });
  return { channel: target, reason: decision.reason,
    row: decision.publish ? { channel: target, source_sha: head, publish_reason: decision.reason } : null };
}

module.exports = {
  PACKAGE_NAME, CHANNEL_TAGS, WATCHED_PATHS, RELEASE_INPUT_PATHS,
  resolveMode, isWatched, publishedSource, readRegistryHistory, gitClient, decide, planPublication,
};
