import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGithubHandoffStore, finalizerDigest, finalizerRunName,
  FINALIZER_WORKFLOW } from '../scripts/github-release-handoff.js';

const repository = 'mindtheflo/notis';
const token = 'private-test-token';
const sourceSha = 'a'.repeat(40);
const tagObject = 'b'.repeat(40);
const tag = `notis-cli-intent/nightly/${sourceSha}`;
const inputs = { source_sha: sourceSha, channel: 'beta', release_id: '11',
  handoff_ref_sha: 'c'.repeat(40), read_only: 'false' };
const workflow = `# notis-cli-handoff-contract: v1
name: CLI finalizer
run-name: notis-cli-handoff:\${{ inputs.handoff_digest }}
on:
  workflow_dispatch:
    inputs:
${[...Object.keys(inputs), 'handoff_digest'].map((name) => `      ${name}:\n        required: true\n        type: string`).join('\n')}
jobs:
  finalize:
    runs-on: ubuntu-latest
`;
const release = { id: 11, tag_name: tag, target_commitish: 'beta', draft: true, name: 'handoff',
  upload_url: 'https://untrusted.invalid/do-not-use', body: 'do-not-return-release-body' };
const bytes = Buffer.from('exact handoff tarball bytes');
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const asset = { id: 23, name: 'package.tgz', size: bytes.length, state: 'uploaded',
  content_type: 'application/octet-stream', digest: digest(bytes),
  browser_download_url: 'https://untrusted.invalid/do-not-use' };
const response = (status, value) => new Response(status === 204 ? null : JSON.stringify(value),
  { status, headers: { 'Content-Type': 'application/json' } });
const run = (changes = {}, identity = { repository, tag, sourceSha, inputs }) => ({
  id: 81, event: 'workflow_dispatch', head_sha: sourceSha, head_branch: identity.tag, path: `.github/workflows/${FINALIZER_WORKFLOW}`,
  display_title: finalizerRunName(identity), status: 'queued', conclusion: null, run_attempt: 1,
  html_url: 'https://untrusted.invalid/do-not-return', ...changes,
});

function api(options = {}) {
  const state = {
    repository: { id: 1, private: true, full_name: repository, default_branch: 'beta' },
    releases: [], assets: [], assetBytes: new Map([[asset.id, bytes]]), runs: [], sleeps: [],
    workflow, tag, targetSha: sourceSha, tagType: 'tag', tagExists: true,
    annotation: { schema: 1, packageName: '@notis_ai/cli', sourceSha, channel: 'nightly', preview: true },
    ...options,
  };
  const calls = [];
  const fetcher = async (value, request) => {
    const url = new URL(value);
    calls.push({ url, ...request });
    assert.equal(request.signal instanceof AbortSignal, true);
    if (['api.github.com', 'uploads.github.com'].includes(url.hostname)) {
      assert.equal(request.headers.Authorization, `Bearer ${token}`);
      assert.equal(request.headers['X-GitHub-Api-Version'], '2026-03-10');
    } else {
      assert.equal(request.headers.Authorization, undefined);
    }
    if (state.intercept) {
      const answer = await state.intercept(url, request, state);
      if (answer !== undefined) return answer;
    }
    const path = url.pathname.replace(`/repos/${repository}`, '');
    const page = Number(url.searchParams.get('page') || 1);
    const paginate = (list) => list.slice((page - 1) * 100, page * 100);
    if (path === '' && request.method === 'GET') return response(200, state.repository);
    if (path.startsWith('/git/ref/tags/') && request.method === 'GET') {
      return state.tagExists ? response(200, { ref: `refs/tags/${state.tag}`,
        object: { type: state.tagType, sha: tagObject } }) : response(404, {});
    }
    if (path === `/git/tags/${tagObject}` && request.method === 'GET') {
      return response(200, { sha: tagObject, tag: state.tag,
        object: { type: 'commit', sha: state.targetSha }, message: JSON.stringify(state.annotation) });
    }
    if (path === '/releases' && request.method === 'GET') return response(200, paginate(state.releases));
    if (path === '/releases' && request.method === 'POST') {
      const body = JSON.parse(request.body);
      assert.equal(body.tag_name, state.tag);
      assert.equal(body.draft, true);
      assert.equal(body.generate_release_notes, false);
      assert.equal(Object.hasOwn(body, 'target_commitish'), false);
      if (!state.rejectCreate) state.releases.push({ ...release, tag_name: state.tag });
      if (state.loseCreate) throw new Error('secret signed create URL private-test-token');
      return response(state.rejectCreate ? 422 : 201, state.releases.at(-1) || {});
    }
    if (path === '/releases/11' && request.method === 'GET') {
      return response(200, state.releases.find((item) => item.id === 11) || { ...release, tag_name: state.tag });
    }
    if (path === '/releases/11/assets' && request.method === 'GET') return response(200, paginate(state.assets));
    if (path === '/releases/11/assets' && request.method === 'POST') {
      assert.equal(url.hostname, 'uploads.github.com');
      assert.equal(request.redirect, 'error');
      assert.equal(request.headers['Content-Length'], String(request.body.length));
      const uploaded = { ...asset, name: url.searchParams.get('name'),
        size: request.body.length, digest: digest(request.body), content_type: request.headers['Content-Type'] };
      if (!state.rejectUpload) {
        state.assets.push(uploaded);
        state.assetBytes.set(uploaded.id, Buffer.from(request.body));
      }
      if (state.loseUpload) throw new Error('secret signed upload URL private-test-token');
      return response(state.rejectUpload ? 422 : 201, uploaded);
    }
    if (path.startsWith('/releases/assets/') && request.method === 'GET') {
      assert.equal(url.hostname, 'api.github.com');
      assert.equal(request.redirect, 'manual');
      assert.equal(request.headers.Accept, 'application/octet-stream');
      return new Response(state.assetBytes.get(Number(path.split('/').at(-1))), { status: 200 });
    }
    if (path === `/contents/.github/workflows/${FINALIZER_WORKFLOW}` && request.method === 'GET') {
      assert.equal(url.searchParams.get('ref'), state.tag);
      return response(200, { type: 'file', path: `.github/workflows/${FINALIZER_WORKFLOW}`,
        encoding: 'base64', content: Buffer.from(state.workflow).toString('base64') });
    }
    if (path === '/actions/runs/81' && request.method === 'GET') return response(200, run(state.directRun || {}, { repository, tag: state.tag, sourceSha, inputs: state.dispatchBody?.inputs || inputs }));
    if (path === `/actions/workflows/${FINALIZER_WORKFLOW}/runs` && request.method === 'GET') {
      assert.equal(url.searchParams.get('event'), 'workflow_dispatch');
      assert.equal(url.searchParams.get('head_sha'), sourceSha);
      return response(200, { total_count: state.runCount ?? state.runs.length, workflow_runs: paginate(state.runs) });
    }
    if (path === `/actions/workflows/${FINALIZER_WORKFLOW}/dispatches` && request.method === 'POST') {
      const body = JSON.parse(request.body);
      assert.equal(body.ref, state.tag);
      assert.equal(body.inputs.handoff_digest, finalizerDigest({ repository, tag: state.tag, sourceSha, inputs: body.inputs }));
      state.dispatchBody = body;
      if (state.indexDispatchedRun) state.runs.push(run({}, { repository, tag: state.tag, sourceSha, inputs: body.inputs }));
      if (state.loseDispatch) throw new Error('secret signed dispatch URL private-test-token');
      return response(200, { workflow_run_id: 81, run_url: 'https://untrusted.invalid/never-follow', html_url: 'https://untrusted.invalid/never-return' });
    }
    assert.fail(`Unexpected mocked request: ${request.method} ${url.pathname}`);
  };
  const sleep = async (ms) => { state.sleeps.push(ms); };
  return { store: createGithubHandoffStore({ repository, token, fetcher, sleep }), state, calls };
}

function posts(calls) { return calls.filter((call) => call.method === 'POST'); }

test('all entrypoints reject a public or different repository before any private reads or writes', async () => {
  const operations = [
    (store) => store.getRepository(), (store) => store.readRelease(11),
    (store) => store.findRelease(tag), (store) => store.ensureDraftRelease({ tag, sourceSha }),
    (store) => store.listAssets(11), (store) => store.downloadAsset(23),
    (store) => store.ensureAsset({ releaseId: 11, name: asset.name, bytes }),
    (store) => store.dispatchFinalizer({ tag, inputs }),
    (store) => store.findFinalizerRuns({ tag, sourceSha, inputs }),
  ];
  for (const operation of operations) {
    const { store, calls } = api({ repository: { private: false, full_name: repository } });
    await assert.rejects(operation(store), /exact private repository/);
    assert.equal(calls.length, 1);
  }
  await assert.rejects(api({ repository: { private: true, full_name: 'other/repo' } }).store.getRepository(), /exact private/);
});

test('existing private draft is found by paginated listings, not the published-only tag endpoint', async () => {
  const unrelated = Array.from({ length: 100 }, (_, i) => ({ ...release, id: 100 + i, tag_name: `other-${i}` }));
  const { store, calls } = api({ releases: [...unrelated, release] });
  assert.equal((await store.ensureDraftRelease({ tag, sourceSha })).id, release.id);
  assert.equal(posts(calls).length, 0);
  assert.ok(calls.some((call) => call.url.searchParams.get('page') === '2'));
  assert.ok(calls.every((call) => !call.url.pathname.includes('/releases/tags/')));
});

test('draft creation attaches the verified existing tag and reconciles a lost creation response', async () => {
  for (const loseCreate of [false, true]) {
    const { store, calls } = api({ loseCreate });
    const result = await store.ensureDraftRelease({ tag, sourceSha });
    assert.equal(result.id, 11);
    assert.equal(result.body, undefined);
    assert.equal(result.upload_url, undefined);
    assert.equal(posts(calls).length, 1);
    assert.ok(posts(calls).every((call) => call.url.pathname.endsWith('/releases')));
    assert.ok(calls.every((call) => !['PATCH', 'DELETE'].includes(call.method)));
  }
});

test('unconfirmed draft creation holds after one attempt and never creates another tag or release', async () => {
  const { store, calls } = api({ loseCreate: true, rejectCreate: true });
  await assert.rejects(store.ensureDraftRelease({ tag, sourceSha }), { code: 'HANDOFF_CREATE_UNCONFIRMED' });
  assert.equal(posts(calls).length, 1);
});

test('unconfirmed draft keeps only sanitized POST code/status without provider body or token', async () => {
  for (const status of [403, 422, 500]) {
    const { store, calls } = api({ intercept(url, request) {
      if (url.pathname.endsWith('/releases') && request.method === 'POST') {
        return response(status, { message: `${token} signed-secret-url`, headers: { Authorization: token } });
      }
    } });
    await assert.rejects(store.ensureDraftRelease({ tag, sourceSha }), error => {
      assert.equal(error.code, 'HANDOFF_CREATE_UNCONFIRMED');
      assert.deepEqual(error.postOutcome, { code: 'HANDOFF_HTTP_ERROR', httpStatus: status });
      assert.match(error.message, new RegExp(`POST HTTP ${status}`));
      assert.ok(!(error.stack + JSON.stringify(error)).includes(token));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(posts(calls).length, 1);
  }
  const { store } = api({ loseCreate: true, rejectCreate: true });
  await assert.rejects(store.ensureDraftRelease({ tag, sourceSha }), error => {
    assert.deepEqual(error.postOutcome, { code: 'HANDOFF_UNAVAILABLE' });
    assert.ok(!(error.stack + JSON.stringify(error)).includes(token));
    return true;
  });
});

test('accepted but not yet listed draft is confirmed by numeric ID without another create', async () => {
  const { store, calls } = api({ intercept(url, request) {
    if (url.pathname.endsWith('/releases') && request.method === 'POST') return response(201, release);
  } });
  assert.equal((await store.ensureDraftRelease({ tag, sourceSha })).id, release.id);
  assert.ok(calls.some(call => call.url.pathname.endsWith('/releases/11')));
  assert.equal(posts(calls).length, 1);
});

test('accepted draft with unavailable exact-ID readback retains sanitized original identity', async () => {
  const { store, calls } = api({ intercept(url, request) {
    if (url.pathname.endsWith('/releases') && request.method === 'POST') return response(201, release);
    if (url.pathname.endsWith('/releases/11')) return response(404, { message: token });
  } });
  await assert.rejects(store.ensureDraftRelease({ tag, sourceSha }), error => {
    assert.equal(error.createdReleaseId, release.id);
    assert.deepEqual(error.postOutcome, { code: 'HANDOFF_RESPONSE_ACCEPTED', httpStatus: 201 });
    assert.deepEqual(error.readbackOutcome, { code: 'HANDOFF_HTTP_ERROR', httpStatus: 404 });
    assert.ok(!(error.stack + JSON.stringify(error)).includes(token));
    return true;
  });
  assert.equal(posts(calls).length, 1);
});

test('missing, lightweight, moved and conflicting release identities hold before creation', async () => {
  for (const changes of [
    { tagExists: false }, { tagType: 'commit' }, { targetSha: 'd'.repeat(40) },
    { releases: [{ ...release, draft: false }] },
    { releases: [release, { ...release, id: 12 }] },
  ]) {
    const { store, calls } = api(changes);
    await assert.rejects(store.ensureDraftRelease({ tag, sourceSha }));
    assert.equal(posts(calls).length, 0);
  }
});

test('asset upload uses only the constructed GitHub upload endpoint and verifies actual bytes and ID', async () => {
  const { store, calls } = api({ releases: [release] });
  const result = await store.ensureAsset({ releaseId: 11, name: 'package.tgz', bytes });
  assert.equal(result.id, asset.id);
  assert.equal(result.browser_download_url, undefined);
  assert.equal(posts(calls).length, 1);
  assert.equal(posts(calls)[0].url.hostname, 'uploads.github.com');
  assert.ok(calls.some((call) => call.url.pathname.endsWith(`/releases/assets/${asset.id}`)));
});

test('lost asset upload is reconciled by same name and downloaded bytes without another upload', async () => {
  const { store, calls } = api({ loseUpload: true });
  assert.equal((await store.ensureAsset({ releaseId: 11, name: asset.name, bytes })).id, asset.id);
  assert.equal(posts(calls).length, 1);
});

test('existing exact asset is reused; conflicting bytes, starter state, digest or duplicates cannot overwrite it', async () => {
  const good = api({ assets: [asset] });
  assert.equal((await good.store.ensureAsset({ releaseId: 11, name: asset.name, bytes })).id, asset.id);
  assert.equal(posts(good.calls).length, 0);
  for (const changes of [
    { assets: [asset], assetBytes: new Map([[asset.id, Buffer.from('X'.repeat(bytes.length))]]) },
    { assets: [{ ...asset, state: 'starter' }] },
    { assets: [{ ...asset, digest: digest(Buffer.from('different')) }] },
    { assets: [asset, { ...asset, id: 24 }] },
  ]) {
    const { store, calls } = api(changes);
    await assert.rejects(store.ensureAsset({ releaseId: 11, name: asset.name, bytes }));
    assert.equal(posts(calls).length, 0);
    assert.ok(calls.every((call) => !['PATCH', 'DELETE'].includes(call.method)));
  }
});

test('unconfirmed asset upload holds after one attempt', async () => {
  const { store, calls } = api({ loseUpload: true, rejectUpload: true });
  await assert.rejects(store.ensureAsset({ releaseId: 11, name: asset.name, bytes }), { code: 'HANDOFF_UPLOAD_UNCONFIRMED' });
  assert.equal(posts(calls).length, 1);
});

test('download follows only GitHub asset hosts with no authorization after the first API request', async () => {
  const { store, calls } = api({ intercept: (url) => {
    if (url.pathname.endsWith(`/releases/assets/${asset.id}`)) {
      return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset?signed=do-not-log' } });
    }
    if (url.hostname === 'release-assets.githubusercontent.com') {
      return new Response(null, { status: 307, headers: { location: 'https://objects.githubusercontent.com/asset?signed=do-not-log' } });
    }
    if (url.hostname === 'objects.githubusercontent.com') return new Response(bytes);
  } });
  assert.deepEqual(await store.downloadAsset(asset.id), bytes);
  const redirects = calls.filter((call) => call.url.hostname !== 'api.github.com');
  assert.equal(redirects.length, 2);
  assert.ok(redirects.every((call) => Object.keys(call.headers).join() === 'Accept'));
});

test('asset redirects reject untrusted hosts, plaintext, credentials, ports and host suffix tricks', async () => {
  for (const location of ['https://attacker.invalid/private', 'http://release-assets.githubusercontent.com/private',
    'https://release-assets.githubusercontent.com.attacker.invalid/private',
    'https://attacker@release-assets.githubusercontent.com/private',
    'https://release-assets.githubusercontent.com:444/private']) {
    const { store, calls } = api({ intercept: (url) => url.pathname.endsWith(`/releases/assets/${asset.id}`)
      ? new Response(null, { status: 302, headers: { location } }) : undefined });
    await assert.rejects(store.downloadAsset(asset.id), /approved asset hosts/);
    assert.equal(calls.length, 2);
  }
});

test('transport errors and HTTP bodies never expose secrets or signed URLs', async () => {
  const failing = api({ intercept: () => { throw new Error('private-test-token https://signed.invalid/?key=secret'); } });
  await assert.rejects(failing.store.getRepository(), (error) => {
    assert.doesNotMatch(error.message, /private-test-token|https:|secret/);
    assert.equal(error.cause, undefined);
    return true;
  });
  let readBody = false;
  const rejected = api({ intercept: () => ({ status: 403, ok: false,
    json: () => { readBody = true; throw new Error('secret body'); } }) });
  await assert.rejects(rejected.store.getRepository(), /HTTP 403/);
  assert.equal(readBody, false);
});

test('dispatch identity is deterministic, order independent and binds channel, source, mode and asset binding', () => {
  const identity = { repository, tag, sourceSha, inputs };
  assert.match(finalizerDigest(identity), /^[0-9a-f]{64}$/);
  assert.equal(finalizerRunName(identity), `notis-cli-handoff:${finalizerDigest(identity)}`);
  assert.equal(finalizerDigest(identity), finalizerDigest({ ...identity, inputs: Object.fromEntries(Object.entries(inputs).reverse()) }));
  for (const changes of [{ read_only: 'true' }, { release_id: '12' }, { handoff_ref_sha: 'd'.repeat(40) }]) {
    assert.notEqual(finalizerDigest(identity), finalizerDigest({ ...identity, inputs: { ...inputs, ...changes } }));
  }
  for (const changes of [{ channel: 'production' }, { source_sha: 'd'.repeat(40) }, { read_only: true },
    { unknown: 'surprise' }, { handoff_digest: '0'.repeat(64) }]) {
    assert.throws(() => finalizerDigest({ ...identity, inputs: { ...inputs, ...changes } }));
  }
});

test('run search matches event, exact source and the complete handoff input digest', async () => {
  const right = run();
  const { store, calls } = api({ runs: [run({ id: 82, event: 'push' }),
    run({ id: 83, head_sha: 'd'.repeat(40) }), run({ id: 84, display_title: 'other' }), right] });
  const found = await store.findFinalizerRuns({ tag, sourceSha, inputs });
  assert.deepEqual(found.map((item) => item.id), [right.id]);
  assert.equal(found[0].html_url, undefined);
  assert.equal(posts(calls).length, 0);
});

test('existing matching finalizer run is reconciled without dispatching again', async () => {
  const { store, calls } = api({ runs: [run()] });
  const result = await store.dispatchFinalizer({ tag, inputs });
  assert.equal(result.status, 'reconciled');
  assert.equal(result.runs[0].id, 81);
  assert.equal(posts(calls).length, 0);
});

test('accepted dispatch uses the exact existing tag and injected digest, never repository_dispatch', async () => {
  const { store, state, calls } = api();
  const result = await store.dispatchFinalizer({ tag, inputs });
  assert.equal(result.status, 'accepted');
  assert.equal(result.runs[0].id, 81); // Direct receipt works before list indexing.
  assert.equal(result.acceptedRunId, 81);
  assert.equal(result.runs[0].html_url, undefined);
  assert.deepEqual(state.dispatchBody, { ref: tag, inputs: { ...inputs,
    handoff_digest: finalizerDigest({ repository, tag, sourceSha, inputs }) } });
  assert.equal(posts(calls).length, 1);
  assert.ok(posts(calls)[0].url.pathname.endsWith(`/workflows/${FINALIZER_WORKFLOW}/dispatches`));
  assert.ok(calls.some((call) => call.url.pathname.includes('/contents/.github/workflows/')));
});

test('current exact finalizer run uses numeric GET even before run-list indexing', async () => {
  const { store, calls } = api({ directRun: { id: '81' } });
  const result = await store.readFinalizerRun({ tag, sourceSha, inputs, runId: 81 });
  assert.equal(result.id, 81);
  assert.ok(calls.some(call => call.url.pathname.endsWith('/actions/runs/81')));
  assert.ok(!calls.some(call => call.url.pathname.includes('/workflows/')));
  assert.equal(posts(calls).length, 0);
});

test('numeric dispatch run receipt rejects altered ID/source/event/title/workflow/tag without redispatch', async () => {
  for (const [directRun, failedKey] of [[{ id: 82 }, 'id'], [{ head_sha: 'f'.repeat(40) }, 'source'], [{ event: 'push' }, 'event'],
    [{ display_title: 'unrelated' }, 'title'], [{ path: '.github/workflows/other.yml' }, 'workflow'], [{ head_branch: 'beta' }, 'tag']]) {
    const { store, state, calls } = api({ directRun });
    await assert.rejects(store.dispatchFinalizer({ tag, inputs }), error => {
      assert.equal(error.code, 'HANDOFF_DISPATCH_UNCONFIRMED');
      assert.equal(error.acceptedRunId, 81);
      assert.deepEqual(error.postOutcome, { code: 'HANDOFF_RESPONSE_ACCEPTED', httpStatus: 200 });
      assert.equal(error.readbackOutcome.code, 'HANDOFF_RUN_MISMATCH');
      assert.equal(error.readbackOutcome.identityChecks[failedKey], false);
      assert.deepEqual(Object.keys(error.readbackOutcome.identityChecks).sort(), ['event', 'id', 'source', 'tag', 'title', 'workflow']);
      return true;
    });
    assert.equal(posts(calls).length, 1);
    // Only a title that never settles is re-read (bounded); other mismatches hold at once.
    const reads = calls.filter(call => call.url.pathname.endsWith('/actions/runs/81')).length;
    assert.equal(reads, failedKey === 'title' ? 7 : 1);
    assert.equal(state.sleeps.reduce((total, ms) => total + ms, 0), failedKey === 'title' ? 60_000 : 0);
  }
});

test('provisional run title settles on the same accepted run without redispatch', async () => {
  let reads = 0;
  const { store, state, calls } = api({ intercept: (url, request, current) => {
    if (!url.pathname.endsWith('/actions/runs/81') || request.method !== 'GET') return undefined;
    reads += 1;
    const identity = { repository, tag, sourceSha, inputs: current.dispatchBody.inputs };
    return response(200, run(reads < 3 ? { display_title: 'CLI finalizer' } : {}, identity));
  } });
  const result = await store.dispatchFinalizer({ tag, inputs });
  assert.equal(result.status, 'accepted');
  assert.equal(result.acceptedRunId, 81);
  assert.equal(result.runs[0].display_title, finalizerRunName({ repository, tag, sourceSha, inputs }));
  assert.equal(reads, 3);
  assert.deepEqual(state.sleeps, [1_000, 2_000]);
  assert.equal(posts(calls).length, 1);
});

test('accepted dispatch readback failure retains only numeric ID/status for recovery', async () => {
  const { store, calls } = api({ intercept: url => url.pathname.endsWith('/actions/runs/81')
    ? response(404, { message: `${token} https://private.invalid` }) : undefined });
  await assert.rejects(store.dispatchFinalizer({ tag, inputs }), error => {
    assert.equal(error.acceptedRunId, 81);
    assert.deepEqual(error.readbackOutcome, { code: 'HANDOFF_HTTP_ERROR', httpStatus: 404 });
    assert.ok(!(error.stack + JSON.stringify(error)).includes(token));
    assert.equal(error.runName, finalizerRunName({ repository, tag, sourceSha, inputs }));
    return true;
  });
  assert.equal(posts(calls).length, 1);
});

test('lost dispatch response reconciles an indexed matching run with no second POST', async () => {
  const { store, calls } = api({ loseDispatch: true, indexDispatchedRun: true });
  const result = await store.dispatchFinalizer({ tag, inputs });
  assert.equal(result.status, 'reconciled');
  assert.equal(result.runs.length, 1);
  assert.equal(posts(calls).length, 1);
});

test('ambiguous dispatch without matching execution exposes only a stable reconciliation identity', async () => {
  const { store, calls } = api({ loseDispatch: true });
  await assert.rejects(store.dispatchFinalizer({ tag, inputs }), (error) => {
    assert.equal(error.code, 'HANDOFF_DISPATCH_UNCONFIRMED');
    assert.equal(error.runName, finalizerRunName({ repository, tag, sourceSha, inputs }));
    assert.equal(error.handoffDigest, finalizerDigest({ repository, tag, sourceSha, inputs }));
    assert.doesNotMatch(error.message, /private-test-token|https:/);
    return true;
  });
  assert.equal(posts(calls).length, 1);
});

test('old or incomplete source-tag finalizer contracts fail before dispatch', async () => {
  for (const value of [workflow.replace('# notis-cli-handoff-contract: v1', '# no contract'),
    workflow.replace('inputs.handoff_digest', 'inputs.source_sha'),
    workflow.replace('      release_id:', '      # release_id:'),
    workflow.replace('  workflow_dispatch:', '  workflow_call:')]) {
    const { store, calls } = api({ workflow: value });
    await assert.rejects(store.dispatchFinalizer({ tag, inputs }), /contract|dispatch inputs/);
    assert.equal(posts(calls).length, 0);
  }
});

test('preview tags require the preview annotation and can never trigger a live finalizer', async () => {
  const previewTag = tag.replace('intent/', 'preview/');
  const previewInputs = { ...inputs, read_only: 'true' };
  const good = api({ tag: previewTag });
  assert.equal((await good.store.ensureDraftRelease({ tag: previewTag, sourceSha })).tag_name, previewTag);
  assert.equal((await good.store.dispatchFinalizer({ tag: previewTag, inputs: previewInputs })).status, 'accepted');
  const bad = api({ tag: previewTag });
  await assert.rejects(bad.store.dispatchFinalizer({ tag: previewTag, inputs }), /Invalid exact-source finalizer inputs/);
  assert.equal(bad.calls.length, 0);
  const wrongAnnotation = api({ tag: previewTag, annotation: { schema: 1, preview: false } });
  await assert.rejects(wrongAnnotation.store.ensureDraftRelease({ tag: previewTag, sourceSha }), /preview annotation/);
  assert.equal(posts(wrongAnnotation.calls).length, 0);
});

test('run-search truncation is not treated as proof that no dispatch exists', async () => {
  for (const runCount of [1001, 1]) {
    const { store, calls } = api({ runCount });
    await assert.rejects(store.dispatchFinalizer({ tag, inputs }), /search is incomplete/);
    assert.equal(posts(calls).length, 0);
  }
});

test('malformed successful dispatch body is held with sanitized status and no retry', async () => {
  const { store, calls } = api({ intercept: (url, request) => request.method === 'POST'
    && url.pathname.endsWith('/dispatches') ? response(200, { unrelated: true }) : undefined });
  await assert.rejects(store.dispatchFinalizer({ tag, inputs }), { code: 'HANDOFF_DISPATCH_UNCONFIRMED' });
  assert.equal(posts(calls).length, 1);
});

test('invalid resource names and identities fail without fetching', async () => {
  const { store, calls } = api();
  await assert.rejects(store.downloadAsset('../secret'), /resource ID/);
  await assert.rejects(store.ensureAsset({ releaseId: 11, name: '../package.tgz', bytes }), /Invalid handoff asset/);
  await assert.rejects(store.findRelease('arbitrary-tag'), /intent tag/);
  assert.equal(calls.length, 0);
});
