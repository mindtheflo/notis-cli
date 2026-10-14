import test from 'node:test';
import assert from 'node:assert/strict';
import { stageHandoff, verifyFinalizerHandoff, dispatchInputs, deliverVerifiedBundle } from '../scripts/release-handoff.js';
import { createGithubHandoffStore, finalizerDigest, finalizerRunName } from '../scripts/github-release-handoff.js';
import { recordTag } from '../scripts/github-immutable-record.js';
import { validBundle } from '../test-support/release-artifact-fixture.js';

const repository = 'mindtheflo/notis';

test('preview never reserves or invokes npm delivery even with live activation', async () => {
  const forbidden = () => { throw Error('Unexpected provider mutation'); };
  assert.equal(await deliverVerifiedBundle({ bundle: validBundle(true), enabled: true,
    intents: { readBranchHead: forbidden }, readHistory: forbidden, publish: forbidden }), null);
});

test('live delivery requires activation, exact fresh native branch and unchanged verified tarball', async () => {
  const bundle = validBundle(false, { channel: 'stable' });
  const calls = [];
  const args = { bundle, enabled: true, intents: { async readBranchHead(branch) { assert.equal(branch, 'production'); return bundle.manifest.sourceSha; } },
    readHistory: async () => ({ versions: {}, 'dist-tags': {} }), publish: options => { calls.push(options); return { verified: true }; },
    tarball: '/tmp/immutable-package.tgz', cwd: '/tmp/isolated', env: { fixture: 'no-token' } };
  await assert.rejects(() => deliverVerifiedBundle({ ...args, enabled: false }), /disabled/);
  await assert.rejects(() => deliverVerifiedBundle({ ...args, intents: { readBranchHead: async () => 'f'.repeat(40) } }), /stale/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await deliverVerifiedBundle(args), { verified: true });
  assert.equal(calls[0].tarball, args.tarball);
  assert.equal(calls[0].integrity, bundle.manifest.tarball.integrity);
  assert.equal(calls[0].channel, 'stable');
  assert.equal(calls[0].tag, 'latest');
});
function harness(readOnly = true) {
  const bundle = validBundle(readOnly);
  const state = { records: new Map(), assets: new Map(), dispatches: 0, preflights: 0, reservations: 0, runs: [] };
  const records = {
    async read(kind, identity, expected) {
      const saved = state.records.get(recordTag(kind, identity));
      if (expected && saved?.refSha !== expected) throw Error('reference mismatch');
      return saved || null;
    },
    async putIfAbsent(kind, identity, record) {
      const tag = recordTag(kind, identity);
      if (state.records.has(tag)) return { ...state.records.get(tag), created: false };
      const saved = { tag, refSha: String(state.records.size + 1).repeat(40), record: structuredClone(record) };
      state.records.set(tag, saved);
      return { ...saved, created: true };
    },
  };
  const api = {
    async ensureDraftRelease({ tag }) { state.tag = tag; return { id: 1, tag_name: tag, draft: true }; },
    async ensureAsset({ name, bytes }) {
      const old = [...state.assets.values()].find(item => item.name === name);
      if (old) { assert.deepEqual(old.bytes, bytes); return old; }
      const asset = { id: state.assets.size + 11, name, size: bytes.length, state: 'uploaded', bytes: Buffer.from(bytes) };
      state.assets.set(asset.id, asset); return asset;
    },
    async readRelease(id) { assert.equal(id, 1); return { id, tag_name: state.tag, draft: true }; },
    async listAssets() { return [...state.assets.values()]; },
    async downloadAsset(id) { return state.assets.get(id).bytes; },
    async findFinalizerRuns() { return state.runs; },
    async readFinalizerRun({ runId }) { const result = state.runs.find(run => run.id === runId); if (!result) throw Error('Finalizer run is not the authenticated exact dispatch'); return result; },
    async preflightFinalizer({ tag, inputs }) {
      state.preflights++;
      const identity = { repository, tag, sourceSha: inputs.source_sha, inputs };
      return { status: state.runs.length ? 'reconciled' : 'ready', runs: state.runs,
        handoff_digest: finalizerDigest(identity), run_name: finalizerRunName(identity) };
    },
    async postFinalizer({ tag, inputs }) {
      state.dispatches++;
      const identity = { repository, tag, sourceSha: inputs.source_sha, inputs };
      state.runs = [{ id: 77, head_sha: inputs.source_sha, event: 'workflow_dispatch', display_title: finalizerRunName(identity) }];
      return { status: 'accepted', runs: state.runs, handoff_digest: finalizerDigest(identity), run_name: finalizerRunName(identity) };
    },
  };
  const intents = { async readRef() { return { intent: bundle.plan.intent, refSha: 'e'.repeat(40) }; }, async read() { return bundle.plan.intent; }, async reserve() { state.reservations++; throw Error('No reservations in handoff'); } };
  const stage = () => stageHandoff({ ...bundle, api, records, intents, repository });
  const finalizerArgs = () => {
    const saved = [...state.records.values()].find(item => item.tag.includes('handoff/'));
    const inputs = dispatchInputs(saved.record, saved.refSha);
    const tag = state.tag;
    inputs.handoff_digest = finalizerDigest({ repository, tag, sourceSha: inputs.source_sha, inputs });
    return { repository, inputs, api, records, intents, context: { event: 'workflow_dispatch', sha: inputs.source_sha,
      ref: `refs/tags/${tag}`, runId: 77, workflowRef: `${repository}/.github/workflows/publish-cli-package.yml@refs/tags/${tag}` } };
  };
  return { bundle, state, api, records, intents, stage, finalizerArgs };
}

for (const readOnly of [true, false]) {
  test(`authenticates exact ${readOnly ? 'preview' : 'reserved live'} bundle end-to-end`, async () => {
    const h = harness(readOnly);
    const receipt = await h.stage();
    assert.equal(receipt.published, false);
    assert.equal(h.state.dispatches, 1);
    assert.equal(h.state.reservations, 0);
    const verified = await verifyFinalizerHandoff(h.finalizerArgs());
    assert.deepEqual(verified.tarball, h.bundle.tarball);
    assert.equal(verified.manifest.readOnly, readOnly);
    assert.equal(h.state.records.size, readOnly ? 3 : 2);
  });
}

test('whole workflow retry reuses immutable original Depot bytes and reconciles one dispatch', async () => {
  const h = harness(false);
  await h.stage();
  h.bundle.manifest.builder.runId = 'second-attempt';
  await h.stage();
  assert.equal(h.state.dispatches, 1);
  assert.equal(h.state.assets.size, 3);
});

test('claimed dispatch with no indexed run holds across retries without another POST', async () => {
  const h = harness();
  h.api.postFinalizer = async () => { h.state.dispatches++; throw Error('Unknown dispatch'); };
  await assert.rejects(h.stage, /Unknown dispatch/);
  await assert.rejects(h.stage, /already claimed/);
  assert.equal(h.state.dispatches, 1);
});

const FINALIZER_PATH = '.github/workflows/publish-cli-package.yml';
const finalizerContract = `# notis-cli-handoff-contract: v1
run-name: notis-cli-handoff:\${{ inputs.handoff_digest }}
on:
  workflow_dispatch:
    inputs:
${['source_sha', 'channel', 'release_id', 'handoff_ref_sha', 'read_only', 'handoff_digest']
  .map(name => `      ${name}:\n        type: string`).join('\n')}
`;

// The real GitHub store behind a scripted API, so the read/claim/POST order is
// exercised exactly as Depot runs it. `failOnce` fails one matching request.
function githubHarness(failOnce, readOnly) {
  const h = harness(readOnly);
  const sourceSha = h.bundle.manifest.sourceSha;
  Object.assign(h.state, { failed: false, posts: 0, finalizerRuns: [] });
  const intent = { tag: `notis-cli-intent/beta/${sourceSha}`, refSha: 'e'.repeat(40), record: h.bundle.plan.intent };
  const saved = () => [...h.state.records.values(), intent];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = async (url, { method, body }) => {
    const path = new URL(url).pathname.replace(`/repos/${repository}`, '');
    if (method === 'POST' && path.endsWith('/dispatches')) h.state.posts++;
    if (!h.state.failed && failOnce(method, path)) { h.state.failed = true; return json(502, {}); }
    if (method === 'GET' && path === '') return json(200, { id: 1, private: true, full_name: repository, default_branch: 'beta' });
    if (method === 'GET' && path.startsWith('/git/ref/tags/')) {
      const record = saved().find(item => item.tag === path.slice('/git/ref/tags/'.length));
      return record ? json(200, { ref: `refs/tags/${record.tag}`, object: { type: 'tag', sha: record.refSha } }) : json(404, {});
    }
    if (method === 'GET' && path.startsWith('/git/tags/')) {
      const record = saved().find(item => item.refSha === path.slice('/git/tags/'.length));
      return json(200, { sha: record.refSha, tag: record.tag, object: { type: 'commit', sha: sourceSha }, message: JSON.stringify(record.record) });
    }
    if (method === 'GET' && path === `/contents/${FINALIZER_PATH}`) {
      return json(200, { type: 'file', path: FINALIZER_PATH, encoding: 'base64', content: Buffer.from(finalizerContract).toString('base64') });
    }
    if (method === 'GET' && path === '/actions/workflows/publish-cli-package.yml/runs') {
      return json(200, { total_count: h.state.finalizerRuns.length, workflow_runs: h.state.finalizerRuns });
    }
    if (method === 'POST' && path === '/actions/workflows/publish-cli-package.yml/dispatches') {
      const { ref, inputs } = JSON.parse(body);
      h.state.finalizerRuns = [{ id: 4242, event: 'workflow_dispatch', head_sha: inputs.source_sha, head_branch: ref,
        path: FINALIZER_PATH, display_title: `notis-cli-handoff:${inputs.handoff_digest}`, status: 'queued', conclusion: null, run_attempt: 1 }];
      return json(200, { workflow_run_id: 4242 });
    }
    if (method === 'GET' && path === '/actions/runs/4242') return json(200, h.state.finalizerRuns[0]);
    throw new Error(`Unexpected ${method} ${path}`);
  };
  const store = createGithubHandoffStore({ repository, token: 'fixture-not-a-token', fetcher, sleep: async () => {} });
  for (const name of ['preflightFinalizer', 'postFinalizer', 'findFinalizerRuns', 'readFinalizerRun']) h.api[name] = store[name];
  const claimTag = recordTag(readOnly ? 'preview-dispatch' : 'dispatch', { sourceSha, channel: 'beta' });
  return { ...h, claimed: () => h.state.records.has(claimTag) };
}

const preflightReads = {
  repository: (method, path) => method === 'GET' && path === '',
  'intent tag': (method, path) => method === 'GET' && path.startsWith('/git/ref/tags/'),
  'run search': (method, path) => method === 'GET' && path.endsWith('/runs'),
  'finalizer contract': (method, path) => method === 'GET' && path.startsWith('/contents/'),
};
for (const readOnly of [true, false]) {
  for (const [name, failOnce] of Object.entries(preflightReads)) {
    test(`${readOnly ? 'preview' : 'live'}: a transient ${name} read leaves no claim and the retry dispatches once`, async () => {
      const h = githubHarness(failOnce, readOnly);
      await assert.rejects(h.stage, /HTTP 502/);
      assert.equal(h.state.posts, 0);
      assert.equal(h.claimed(), false);
      assert.equal((await h.stage()).status, 'accepted');
      assert.equal(h.claimed(), true);
      assert.equal((await h.stage()).status, 'reconciled');
      assert.equal(h.state.posts, 1);
    });
  }
}

test('an unknown dispatch POST stays held: the retry never sends a second POST', async () => {
  const h = githubHarness((method, path) => method === 'POST' && path.endsWith('/dispatches'), true);
  await assert.rejects(h.stage, /unconfirmed/);
  assert.equal(h.claimed(), true);
  await assert.rejects(h.stage, /already claimed/);
  assert.equal(h.state.posts, 1);
});

test('partial upload resumes the original manifest/provenance without replacement', async () => {
  const h = harness(false);
  const ensure = h.api.ensureAsset;
  h.api.ensureAsset = async args => { if (args.name === 'notis-cli.tgz') throw Error('Upload interrupted'); return ensure(args); };
  await assert.rejects(h.stage, /interrupted/);
  assert.equal(h.state.assets.size, 2);
  const originalBuilder = { ...h.bundle.manifest.builder };
  h.bundle.manifest.builder.runId = 'retry-new-run';
  h.api.ensureAsset = ensure;
  await h.stage();
  const result = await verifyFinalizerHandoff(h.finalizerArgs());
  assert.deepEqual(result.manifest.builder, originalBuilder);
  assert.equal(h.state.assets.size, 3);
});

test('accepted npm delivery reconciles after branch advances or activation is disabled', async () => {
  const bundle = validBundle(false);
  const { manifest, plan } = bundle;
  const receipt = { version: manifest.version, notisRelease: { sourceSha: manifest.sourceSha, channel: manifest.channel },
    gitHead: manifest.sourceSha, dist: { integrity: manifest.tarball.integrity } };
  const forbidden = () => { throw Error('Must reconcile without mutation/fresh-head lookup'); };
  const result = await deliverVerifiedBundle({ bundle, enabled: false, intents: { readBranchHead: forbidden }, publish: forbidden,
    readHistory: async () => ({ versions: { [manifest.version]: receipt }, 'dist-tags': { [plan.publishTag]: manifest.version } }) });
  assert.equal(result.reconciled, true);
  assert.equal(result.integrity, manifest.tarball.integrity);
});

test('changed annotated live intent object is rejected even with unchanged JSON', async () => {
  const h = harness(false); await h.stage();
  h.intents.readRef = async () => ({ intent: h.bundle.plan.intent, refSha: 'f'.repeat(40) });
  await assert.rejects(() => verifyFinalizerHandoff(h.finalizerArgs()), /annotated object changed/);
});

test('read-only namespaces cannot authorize live npm mode', async () => {
  const h = harness(); await h.stage();
  const args = h.finalizerArgs(); args.inputs.read_only = 'false';
  await assert.rejects(() => verifyFinalizerHandoff(args), /digest|provenance/);
});

for (const field of ['source_sha', 'channel', 'release_id', 'handoff_ref_sha', 'handoff_digest']) {
  test(`rejects changed dispatch ${field}`, async () => {
    const h = harness(); await h.stage(); const args = h.finalizerArgs();
    args.inputs[field] = field.includes('sha') ? 'f'.repeat(40) : field === 'channel' ? 'production' : '9';
    await assert.rejects(() => verifyFinalizerHandoff(args));
  });
}

for (const field of ['event', 'sha', 'ref', 'workflowRef', 'runId']) {
  test(`rejects different actual finalizer ${field}`, async () => {
    const h = harness(); await h.stage(); const args = h.finalizerArgs(); args.context[field] = 'wrong';
    await assert.rejects(() => verifyFinalizerHandoff(args), /provenance|dispatch/);
  });
}

for (const change of ['asset-id', 'bytes', 'release-tag', 'builder']) {
  test(`rejects tampered private handoff ${change}`, async () => {
    const h = harness(); await h.stage(); const args = h.finalizerArgs();
    if (change === 'asset-id') h.state.assets.values().next().value.id = 999;
    if (change === 'bytes') h.state.assets.values().next().value.bytes = Buffer.from('wrong');
    if (change === 'release-tag') h.state.tag = 'wrong';
    if (change === 'builder') [...h.state.records.values()].find(item => item.tag.includes('handoff/')).record.builder.runId = 'wrong';
    await assert.rejects(() => verifyFinalizerHandoff(args));
  });
}
