import { createHash } from 'node:crypto';
import { PACKAGE_CHANNELS, branchForChannel, channelForBranch } from './release-channels.cjs';

export const FINALIZER_WORKFLOW = 'publish-cli-package.yml';
const WORKFLOW_PATH = `.github/workflows/${FINALIZER_WORKFLOW}`;
const API_VERSION = '2026-03-10';
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const INTENT_TAG = new RegExp(`^notis-cli-(intent|preview)/(${PACKAGE_CHANNELS.join('|')})/([0-9a-f]{40})$`);
const INPUTS = ['channel', 'handoff_ref_sha', 'read_only', 'release_id', 'source_sha'];
const ASSET_HOSTS = new Set([
  'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
// GitHub returns the dispatched run ID before it evaluates `run-name`, so the
// first readback can still show a provisional title (about 60 s in total).
const TITLE_SETTLE_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

function held(message, code = 'HANDOFF_HELD') {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Retain only our own typed diagnostic fields when a POST is reconciled. Never
// retain a transport Error/cause, provider body, headers, or signed asset URL.
function postFailure(error) {
  const codes = new Set(['HANDOFF_UNAVAILABLE', 'HANDOFF_HTTP_ERROR', 'HANDOFF_INVALID_RECEIPT', 'HANDOFF_RUN_MISMATCH']);
  return { code: codes.has(error?.code) ? error.code : 'HANDOFF_HELD',
    ...(Number.isInteger(error?.httpStatus) ? { httpStatus: error.httpStatus } : {}),
    ...(error?.identityChecks && typeof error.identityChecks === 'object'
      ? { identityChecks: Object.fromEntries(Object.entries(error.identityChecks)
        .filter(([, value]) => typeof value === 'boolean')) } : {}) };
}

function dispatchReceipt(identity, status, runs) {
  return { status, handoff_digest: identity.digest, run_name: identity.runName, runs };
}

function unconfirmed(message, code, outcome) {
  const suffix = outcome?.httpStatus ? ` (POST HTTP ${outcome.httpStatus})` : '';
  const error = held(message + suffix, code);
  error.postOutcome = outcome;
  return error;
}

function requireId(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw held('Invalid GitHub handoff resource ID');
  return id;
}

function requireTag(tag, sourceSha) {
  const match = typeof tag === 'string' && tag.match(INTENT_TAG);
  if (!match || (sourceSha !== undefined && (!SHA.test(sourceSha) || match[3] !== sourceSha))) {
    throw held('Invalid exact-source release intent tag');
  }
  return { channel: branchForChannel(match[2]), sourceSha: match[3], preview: match[1] === 'preview' };
}

function dispatchIdentity({ repository, tag, sourceSha, inputs }) {
  if (!REPOSITORY.test(repository || '')) throw held('Invalid GitHub handoff repository');
  const identity = requireTag(tag, sourceSha);
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)
      || Object.keys(inputs).some((key) => ![...INPUTS, 'handoff_digest'].includes(key))
      || INPUTS.some((key) => typeof inputs[key] !== 'string')
      || inputs.source_sha !== identity.sourceSha || inputs.channel !== identity.channel
      || !SHA.test(inputs.handoff_ref_sha)
      || !/^[1-9][0-9]*$/.test(inputs.release_id)
      || !Number.isSafeInteger(Number(inputs.release_id))
      || !['true', 'false'].includes(inputs.read_only) || (identity.preview && inputs.read_only !== 'true')) {
    throw held('Invalid exact-source finalizer inputs');
  }
  const normalized = Object.fromEntries(INPUTS.map((key) => [key, inputs[key]]));
  const digest = createHash('sha256').update(JSON.stringify({
    schema: 1, repository: repository.toLowerCase(), tag,
    source_sha: identity.sourceSha, inputs: normalized,
  })).digest('hex');
  if (inputs.handoff_digest !== undefined && inputs.handoff_digest !== digest) {
    throw held('Finalizer input digest does not match the handoff identity');
  }
  return { digest, tag, runName: `notis-cli-handoff:${digest}`,
    sourceSha: identity.sourceSha, inputs: { ...normalized, handoff_digest: digest } };
}

export function finalizerDigest(identity) {
  return dispatchIdentity(identity).digest;
}

export function finalizerRunName(identity) {
  return dispatchIdentity(identity).runName;
}

function releaseMetadata(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id <= 0
      || typeof value.tag_name !== 'string' || typeof value.draft !== 'boolean') {
    throw held('Invalid GitHub release receipt');
  }
  return { id: value.id, tag_name: value.tag_name, target_commitish: value.target_commitish,
    draft: value.draft, name: value.name };
}

function draftRelease(value, tag) {
  const release = releaseMetadata(value);
  if (!release.draft || (tag !== undefined && release.tag_name !== tag)) {
    throw held('Handoff release is not the expected private draft');
  }
  requireTag(release.tag_name);
  return release;
}

function assetMetadata(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id <= 0
      || typeof value.name !== 'string' || !Number.isSafeInteger(value.size) || value.size < 0
      || typeof value.state !== 'string') {
    throw held('Invalid GitHub release asset receipt');
  }
  return { id: value.id, name: value.name, size: value.size, state: value.state,
    content_type: value.content_type, digest: value.digest };
}

// Accept only the deliberately small YAML contract installed with the finalizer.
// A comment/step mentioning an input is not a workflow_dispatch capability.
function verifyWorkflowContract(content) {
  const lines = content.split(/\r?\n/);
  if (!lines.some((line) => /^# notis-cli-handoff-contract: v1\s*$/.test(line))
      || !lines.some((line) => /^run-name:\s*['"]?notis-cli-handoff:\$\{\{\s*inputs\.handoff_digest\s*\}\}['"]?\s*$/.test(line))) {
    throw held('Source tag does not provide the versioned CLI finalizer contract');
  }
  const indent = (line) => line.match(/^ */)[0].length;
  const endOf = (start) => {
    for (let i = start + 1; i < lines.length; i += 1) {
      if (lines[i].trim() && !lines[i].trim().startsWith('#') && indent(lines[i]) <= indent(lines[start])) return i;
    }
    return lines.length;
  };
  const child = (parent, key) => {
    const end = endOf(parent);
    for (let i = parent + 1; i < end; i += 1) {
      if (new RegExp(`^ {${indent(lines[parent]) + 2}}${key}:\\s*$`).test(lines[i])) return i;
    }
    return -1;
  };
  const on = lines.findIndex((line) => /^(?:on|'on'|"on"):\s*$/.test(line));
  const dispatch = on < 0 ? -1 : child(on, 'workflow_dispatch');
  const inputs = dispatch < 0 ? -1 : child(dispatch, 'inputs');
  if (inputs < 0 || [...INPUTS, 'handoff_digest'].some((name) => child(inputs, name) < 0)) {
    throw held('Source tag is missing required finalizer dispatch inputs');
  }
}

export function createGithubHandoffStore({ repository, token, fetcher = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!REPOSITORY.test(repository || '') || typeof token !== 'string' || !token.trim()
      || typeof fetcher !== 'function' || typeof sleep !== 'function') {
    throw held('GitHub repository and scoped token are required for release handoff');
  }
  const base = `https://api.github.com/repos/${repository}`;
  const uploads = `https://uploads.github.com/repos/${repository}`;

  async function fetchResponse(url, options, label) {
    try {
      return await fetcher(url, { ...options, signal: AbortSignal.timeout(30_000) });
    } catch {
      // Never propagate a fetch error/cause: signed asset URLs and credentials
      // can appear in transport errors. HTTP error bodies are never read.
      throw held(`GitHub handoff ${label} outcome unavailable`, 'HANDOFF_UNAVAILABLE');
    }
  }

  async function request(method, path, { body, binary, contentType, missing = false, upload = false,
    expectedStatus = method === 'GET' ? 200 : 201 } = {}) {
    const response = await fetchResponse(`${upload ? uploads : base}${path}`, {
      method, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        ...(binary !== undefined ? { 'Content-Type': contentType, 'Content-Length': String(binary.length) }
          : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(binary !== undefined ? { body: binary } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    }, method);
    if (missing && response.status === 404) return null;
    if (!response.ok || response.status !== expectedStatus) {
      const status = Number.isInteger(response.status) ? response.status : 'unknown';
      const error = held(`GitHub handoff ${method} failed (HTTP ${status})`, 'HANDOFF_HTTP_ERROR');
      if (Number.isInteger(response.status)) error.httpStatus = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    try { return await response.json(); }
    catch { throw held('Invalid GitHub handoff JSON receipt', 'HANDOFF_INVALID_RECEIPT'); }
  }

  async function getRepository() {
    const value = await request('GET', '');
    if (value?.private !== true || typeof value.full_name !== 'string'
        || value.full_name.toLowerCase() !== repository.toLowerCase()) {
      throw held('GitHub handoff requires the exact private repository');
    }
    return { id: value.id, full_name: value.full_name, private: true, default_branch: value.default_branch };
  }

  async function verifyIntent(tag, sourceSha) {
    const identity = requireTag(tag, sourceSha);
    const ref = await request('GET', `/git/ref/tags/${tag}`);
    if (ref?.ref !== `refs/tags/${tag}` || ref.object?.type !== 'tag' || !SHA.test(ref.object.sha || '')) {
      throw held('Existing release intent is not the exact annotated tag');
    }
    const object = await request('GET', `/git/tags/${ref.object.sha}`);
    if (object?.tag !== tag || object.object?.type !== 'commit' || object.object.sha !== sourceSha
        || object.sha !== ref.object.sha) {
      throw held('Existing release intent does not resolve to the exact source SHA');
    }
    if (identity.preview) {
      let record;
      try { record = JSON.parse(object.message); } catch { /* Rejected below. */ }
      if (record?.schema !== 1 || record.preview !== true || record.sourceSha !== sourceSha
          || record.packageName !== '@notis_ai/cli'
          || record.channel !== channelForBranch(identity.channel)) {
        throw held('Existing preview annotation does not match the read-only source identity');
      }
    }
    return ref.object.sha;
  }

  async function pages(path, field) {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}&page=${page}`);
      if (field === 'workflow_runs' && (!Number.isSafeInteger(payload?.total_count) || payload.total_count > 1000)) {
        throw held('Finalizer run search is incomplete; reconcile without redispatching');
      }
      const values = field ? payload?.[field] : payload;
      if (!Array.isArray(values)) throw held('Invalid paginated GitHub handoff receipt');
      all.push(...values);
      if (values.length < PAGE_SIZE) {
        if (field === 'workflow_runs' && all.length < payload.total_count) {
          throw held('Finalizer run search is incomplete; reconcile without redispatching');
        }
        return all;
      }
    }
    throw held('GitHub handoff pagination was not exhausted; reconciliation is incomplete');
  }

  async function readReleaseInternal(id) {
    const release = draftRelease(await request('GET', `/releases/${requireId(id)}`));
    if (release.id !== id) throw held('GitHub returned a different release ID');
    return release;
  }

  async function readRelease(id) {
    requireId(id);
    await getRepository();
    return readReleaseInternal(id);
  }

  async function findReleaseInternal(tag) {
    // /releases/tags/{tag} is published-only; it cannot reconcile a draft.
    const matches = (await pages('/releases')).filter((release) => release?.tag_name === tag);
    const byId = new Map(matches.map((release) => [requireId(release.id), release]));
    if (byId.size > 1) throw held('More than one release claims the same handoff tag');
    return matches.length ? draftRelease(matches[0], tag) : null;
  }

  async function findRelease(tag) {
    requireTag(tag);
    await getRepository();
    return findReleaseInternal(tag);
  }

  async function ensureDraftRelease({ tag, sourceSha }) {
    requireTag(tag, sourceSha);
    await getRepository();
    const tagObject = await verifyIntent(tag, sourceSha);
    const existing = await findReleaseInternal(tag);
    if (existing) return existing;
    let created, outcome;
    try {
      created = await request('POST', '/releases', { body: {
        tag_name: tag, name: `Notis CLI handoff ${tag}`, draft: true, prerelease: true,
        generate_release_notes: false, make_latest: 'false',
        // Existing intent tags already fix the commit. target_commitish is
        // intentionally omitted; this call never creates/updates a Git ref.
      } });
      outcome = { code: 'HANDOFF_RESPONSE_ACCEPTED', httpStatus: 201 };
    } catch (error) { outcome = postFailure(error); }
    let found;
    try {
      // A successful POST gives an authoritative numeric identity. The release
      // listing can lag that write; confirm the same ID without another POST.
      found = created ? draftRelease(await readReleaseInternal(draftRelease(created, tag).id), tag)
        : await findReleaseInternal(tag);
    } catch (error) {
      const failure = unconfirmed('Draft handoff readback unavailable; reconcile the same release ID/tag', 'HANDOFF_CREATE_UNCONFIRMED', outcome);
      failure.readbackOutcome = postFailure(error);
      if (Number.isSafeInteger(created?.id) && created.id > 0) failure.createdReleaseId = created.id;
      throw failure;
    }
    if (!found || (created?.id !== undefined && created.id !== found.id)
        || await verifyIntent(tag, sourceSha) !== tagObject) {
      const error = unconfirmed('Draft handoff creation is unconfirmed or conflicting; reconcile the same tag', 'HANDOFF_CREATE_UNCONFIRMED', outcome);
      if (Number.isSafeInteger(created?.id) && created.id > 0) error.createdReleaseId = created.id;
      throw error;
    }
    return found;
  }

  async function listAssetsInternal(releaseId) {
    const assets = (await pages(`/releases/${requireId(releaseId)}/assets`)).map(assetMetadata);
    const ids = new Set(assets.map((asset) => asset.id));
    if (ids.size !== assets.length) throw held('Duplicate asset IDs in GitHub handoff listing');
    return assets;
  }

  async function listAssets(releaseId) {
    requireId(releaseId);
    await getRepository();
    await readReleaseInternal(releaseId);
    return listAssetsInternal(releaseId);
  }

  async function downloadAssetInternal(assetId) {
    let url = `${base}/releases/assets/${requireId(assetId)}`;
    let headers = { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream',
      'X-GitHub-Api-Version': API_VERSION };
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await fetchResponse(url, { method: 'GET', redirect: 'manual', headers }, 'asset download');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        let next;
        try { next = new URL(response.headers.get('location'), url); }
        catch { throw held('Invalid GitHub release asset redirect'); }
        if (next.protocol !== 'https:' || next.port || next.username || next.password || next.hash
            || !ASSET_HOSTS.has(next.hostname)) {
          throw held('GitHub release asset redirect is outside the approved asset hosts');
        }
        url = next.href;
        headers = { Accept: 'application/octet-stream' };
        continue;
      }
      if (response.status !== 200) throw held('GitHub release asset download failed');
      try { return Buffer.from(await response.arrayBuffer()); }
      catch { throw held('GitHub release asset download is incomplete'); }
    }
    throw held('GitHub release asset redirect limit exceeded');
  }

  async function downloadAsset(assetId) {
    requireId(assetId);
    await getRepository();
    return downloadAssetInternal(assetId);
  }

  async function ensureAsset({ releaseId, name, bytes, contentType = 'application/octet-stream' }) {
    requireId(releaseId);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name || '')
        || !(bytes instanceof Uint8Array) || !bytes.length
        || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(contentType)) {
      throw held('Invalid handoff asset name, bytes or content type');
    }
    const expected = Buffer.from(bytes);
    const digest = `sha256:${createHash('sha256').update(expected).digest('hex')}`;
    await getRepository();
    const release = await readReleaseInternal(releaseId);
    await verifyIntent(release.tag_name, requireTag(release.tag_name).sourceSha);
    const match = async () => {
      const assets = (await listAssetsInternal(releaseId)).filter((asset) => asset.name === name);
      if (assets.length > 1) throw held('Multiple handoff assets use the same name');
      return assets[0] || null;
    };
    const verify = async (asset) => {
      if (asset.state !== 'uploaded' || asset.size !== expected.length
          || (asset.digest != null && asset.digest !== digest)
          || !(await downloadAssetInternal(asset.id)).equals(expected)) {
        throw held('Existing handoff asset conflicts with the exact bytes; never overwrite it');
      }
      return asset;
    };
    const existing = await match();
    if (existing) return verify(existing);
    let uploaded;
    try {
      uploaded = await request('POST', `/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        { upload: true, binary: expected, contentType });
    } catch { /* Reconcile the same name and downloaded bytes, never re-upload. */ }
    const found = await match();
    if (!found || (uploaded?.id !== undefined && uploaded.id !== found.id)) {
      throw held('Handoff asset upload is unconfirmed or conflicting; reconcile the same name', 'HANDOFF_UPLOAD_UNCONFIRMED');
    }
    await readReleaseInternal(releaseId);
    return verify(found);
  }

  async function findRuns(identity) {
    const query = new URLSearchParams({ event: 'workflow_dispatch', head_sha: identity.sourceSha });
    const runs = await pages(`/actions/workflows/${FINALIZER_WORKFLOW}/runs?${query}`, 'workflow_runs');
    return runs.filter((run) => run?.event === 'workflow_dispatch' && run.head_sha === identity.sourceSha
      && run.display_title === identity.runName && run.path === WORKFLOW_PATH && run.head_branch === identity.tag).map((run) => ({
      id: requireId(run.id), event: run.event, head_sha: run.head_sha, display_title: run.display_title,
      status: run.status, conclusion: run.conclusion, run_attempt: run.run_attempt,
      created_at: run.created_at, updated_at: run.updated_at,
    }));
  }

  async function findFinalizerRuns({ tag, sourceSha, inputs }) {
    const identity = dispatchIdentity({ repository, tag, sourceSha, inputs });
    await getRepository();
    return findRuns(identity);
  }

  async function readRun(identity, tag, runId) {
    const run = await request('GET', `/actions/runs/${requireId(runId)}`);
    const returnedId = typeof run?.id === 'string' && /^[1-9][0-9]*$/.test(run.id)
      && Number.isSafeInteger(Number(run.id)) ? Number(run.id) : run?.id;
    const identityChecks = {
      id: returnedId === runId,
      event: run?.event === 'workflow_dispatch',
      source: run?.head_sha === identity.sourceSha,
      title: run?.display_title === identity.runName,
      workflow: run?.path === WORKFLOW_PATH,
      tag: run?.head_branch === tag,
    };
    if (!Object.values(identityChecks).every(Boolean)) {
      const error = held('Finalizer run ID has different source, tag, workflow or dispatch identity', 'HANDOFF_RUN_MISMATCH');
      error.identityChecks = identityChecks;
      throw error;
    }
    return { id: returnedId, event: run.event, head_sha: run.head_sha, head_branch: run.head_branch,
      path: run.path, display_title: run.display_title, status: run.status, conclusion: run.conclusion,
      run_attempt: run.run_attempt, created_at: run.created_at, updated_at: run.updated_at };
  }

  // Re-read only the exact accepted run, and only while every identity field
  // except the provisional title already matches. Never redispatch or accept
  // any title other than the exact handoff run name.
  async function readAcceptedRun(identity, tag, runId) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await readRun(identity, tag, runId); }
      catch (error) {
        const checks = error?.code === 'HANDOFF_RUN_MISMATCH' ? error.identityChecks : null;
        const titlePending = checks?.title === false
          && Object.entries(checks).every(([key, value]) => key === 'title' || value === true);
        if (!titlePending || attempt >= TITLE_SETTLE_DELAYS_MS.length) throw error;
        await sleep(TITLE_SETTLE_DELAYS_MS[attempt]);
      }
    }
  }

  async function readFinalizerRun({ tag, sourceSha, inputs, runId }) {
    const identity = dispatchIdentity({ repository, tag, sourceSha, inputs });
    await getRepository();
    return readRun(identity, tag, requireId(runId));
  }

  async function verifyFinalizer(tag) {
    const query = new URLSearchParams({ ref: tag });
    const file = await request('GET', `/contents/${WORKFLOW_PATH}?${query}`);
    if (file?.type !== 'file' || file.path !== WORKFLOW_PATH || file.encoding !== 'base64'
        || typeof file.content !== 'string' || file.content.length > 1_500_000
        || !/^[A-Za-z0-9+/=\r\n]+$/.test(file.content)) {
      throw held('Source tag finalizer content receipt is invalid');
    }
    verifyWorkflowContract(Buffer.from(file.content, 'base64').toString('utf8'));
  }

  // Every read a dispatch depends on, run before the caller writes its
  // write-once claim: a transient read failure then leaves nothing behind.
  async function preflightFinalizer({ tag, inputs }) {
    const identity = dispatchIdentity({ repository, tag, sourceSha: inputs?.source_sha, inputs });
    await getRepository();
    await verifyIntent(tag, identity.sourceSha);
    const previous = await findRuns(identity);
    if (previous.length) return dispatchReceipt(identity, 'reconciled', previous);
    await verifyFinalizer(tag);
    return dispatchReceipt(identity, 'ready', []);
  }

  // The one POST, sent only after a `ready` preflight and the caller's claim.
  // An unknown outcome is held for reconciliation, never sent again.
  async function postFinalizer({ tag, inputs }) {
    const identity = dispatchIdentity({ repository, tag, sourceSha: inputs?.source_sha, inputs });
    const receipt = (status, runs) => dispatchReceipt(identity, status, runs);
    let acceptedRunId, outcome;
    try {
      // API version 2026-03-10 returns 200 + workflow_run_id, not legacy 204.
      const accepted = await request('POST', `/actions/workflows/${FINALIZER_WORKFLOW}/dispatches`, {
        body: { ref: tag, inputs: identity.inputs }, expectedStatus: 200,
      });
      outcome = { code: 'HANDOFF_RESPONSE_ACCEPTED', httpStatus: 200 };
      if (!Number.isSafeInteger(accepted?.workflow_run_id) || accepted.workflow_run_id <= 0) {
        throw held('Dispatch response has no valid numeric run ID', 'HANDOFF_INVALID_RECEIPT');
      }
      acceptedRunId = accepted.workflow_run_id;
    } catch (error) {
      outcome = { ...postFailure(error), ...(outcome?.httpStatus ? { httpStatus: outcome.httpStatus } : {}) };
    }
    if (acceptedRunId) {
      try {
        const run = await readAcceptedRun(identity, tag, acceptedRunId);
        return { ...receipt('accepted', [run]), acceptedRunId };
      } catch (error) {
        const failure = unconfirmed('Finalizer accepted but exact run readback is unconfirmed; reconcile the same run ID',
          'HANDOFF_DISPATCH_UNCONFIRMED', outcome);
        failure.acceptedRunId = acceptedRunId;
        failure.handoffDigest = identity.digest;
        failure.runName = identity.runName;
        failure.readbackOutcome = postFailure(error);
        throw failure;
      }
    }
    let runs = [];
    try { runs = await findRuns(identity); }
    catch { /* An unknown POST remains held when listing is unavailable. */ }
    if (runs.length) return receipt('reconciled', runs);
    const error = unconfirmed('Finalizer dispatch is unconfirmed; reconcile the same run name without redispatching',
      'HANDOFF_DISPATCH_UNCONFIRMED', outcome);
    error.handoffDigest = identity.digest;
    error.runName = identity.runName;
    throw error;
  }

  async function dispatchFinalizer({ tag, inputs }) {
    const preflight = await preflightFinalizer({ tag, inputs });
    return preflight.status === 'reconciled' ? preflight : postFinalizer({ tag, inputs });
  }

  return { getRepository, readRelease, findRelease, ensureDraftRelease, listAssets,
    downloadAsset, ensureAsset, preflightFinalizer, postFinalizer, dispatchFinalizer,
    findFinalizerRuns, readFinalizerRun };
}
