import { randomUUID } from 'node:crypto';
import { SUPPORTED_CHANNELS, branchForChannel, channelForBranch } from './release-channels.cjs';
import { ARTIFACT_NAMES, PACKAGE_NAME, sha256, verifyArtifact } from './release-artifact.js';
import { intentTag, validateIntent } from './release-intent.js';
import { recordTag } from './github-immutable-record.js';
import { finalizerDigest, finalizerRunName } from './github-release-handoff.js';
import { validateReservedVersion, verifyPublishedReceipt } from './release-registry.js';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function requireSame(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) throw new Error(`${label} differs from its immutable record; publication held`);
}
export function handoffKinds(readOnly) {
  return readOnly ? { binding: 'preview-handoff', dispatch: 'preview-dispatch' } : { binding: 'handoff', dispatch: 'dispatch' };
}
export function dispatchInputs(binding, handoffRefSha) {
  return { source_sha: binding.sourceSha, channel: branchForChannel(binding.channel),
    release_id: String(binding.releaseId), handoff_ref_sha: handoffRefSha, read_only: String(binding.readOnly) };
}

export async function stageHandoff({ manifest, tarball, planBytes, api, records, intents, repository }) {
  if (repository !== 'mindtheflo/notis') throw new Error('Wrong handoff repository');
  const { plan } = verifyArtifact({ manifest, tarball, planBytes });
  const { sourceSha, channel, version, readOnly } = manifest;
  const identity = { sourceSha, channel };
  const kinds = handoffKinds(readOnly);
  let tag, intentRefSha;
  if (readOnly) {
    const preview = { schema: 1, packageName: PACKAGE_NAME, ...identity, version, preview: true };
    const saved = await records.putIfAbsent('preview-intent', identity, preview);
    requireSame(saved.record, preview, 'Preview identity');
    tag = saved.tag;
    intentRefSha = saved.refSha;
  } else {
    const intentRef = await intents.readRef(plan.intent);
    const reserved = intentRef?.intent;
    intentRefSha = intentRef?.refSha;
    validateIntent(reserved, { packageName: PACKAGE_NAME, ...identity });
    requireSame(reserved, plan.intent, 'Release intent');
    tag = intentTag(identity);
  }
  const previous = await records.read(kinds.binding, identity);
  if (previous) {
    // A whole-workflow retry reuses the original attested CI bytes, not a
    // fresh build whose timestamp or toolchain output may differ.
    const old = await downloadHandoff({ binding: previous.record, api });
    if (previous.record.intentRefSha !== intentRefSha || old.manifest.version !== version || old.manifest.readOnly !== readOnly) throw new Error('Existing handoff version/mode conflict');
    return dispatchBoundHandoff({ binding: previous.record, saved: previous, records, api, repository });
  }
  const release = await api.ensureDraftRelease({ tag, sourceSha });
  const existingAssets = await api.listAssets(release.id);
  const oldManifest = existingAssets.filter(item => item.name === ARTIFACT_NAMES.manifest);
  if (oldManifest.length > 1) throw new Error('Conflicting partial handoff manifests');
  if (oldManifest.length) {
    // The plan and manifest precede the tarball upload. Recover the original
    // builder on a partial-stage retry; an absent original tgz can resume only
    // when the current retained smoke artifact has the same bound bytes.
    const oldPlan = existingAssets.filter(item => item.name === ARTIFACT_NAMES.plan);
    const oldTarball = existingAssets.filter(item => item.name === ARTIFACT_NAMES.tarball);
    if (oldPlan.length !== 1 || oldTarball.length > 1) throw new Error('Incomplete/conflicting partial handoff');
    const original = JSON.parse(await api.downloadAsset(oldManifest[0].id));
    planBytes = await api.downloadAsset(oldPlan[0].id);
    if (oldTarball.length) tarball = await api.downloadAsset(oldTarball[0].id);
    verifyArtifact({ manifest: original, tarball, planBytes, expected: { sourceSha, channel, version, readOnly } });
    manifest = original;
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const assets = {};
  for (const [key, bytes] of Object.entries({ plan: planBytes, manifest: manifestBytes, tarball })) {
    const asset = await api.ensureAsset({ releaseId: release.id, name: ARTIFACT_NAMES[key], bytes,
      contentType: key === 'tarball' ? 'application/gzip' : 'application/json' });
    assets[key] = { id: asset.id, name: asset.name, size: bytes.length, sha256: sha256(bytes) };
  }
  const binding = { schema: 1, packageName: PACKAGE_NAME, ...identity, version, readOnly,
    intentTag: tag, intentRefSha, releaseId: release.id, assets, integrity: manifest.tarball.integrity, builder: manifest.builder };
  const saved = await records.putIfAbsent(kinds.binding, identity, binding);
  requireSame(saved.record, binding, 'Artifact handoff');
  return dispatchBoundHandoff({ binding, saved, records, api, repository });
}

async function dispatchBoundHandoff({ binding, saved, records, api, repository }) {
  const { sourceSha, channel, version, readOnly, intentTag: tag } = binding;
  const identity = { sourceSha, channel };
  const kinds = handoffKinds(readOnly);
  const inputs = dispatchInputs(binding, saved.refSha);
  const dispatchIdentity = { repository, tag, sourceSha, inputs };
  const digest = finalizerDigest(dispatchIdentity);
  const runName = finalizerRunName(dispatchIdentity);
  // Every read runs before the claim, so a transient read failure leaves no
  // claim behind and the next attempt starts clean.
  let result = await api.preflightFinalizer({ tag, inputs });
  if (result.status !== 'reconciled') {
    // Write-once claim BEFORE dispatch. A crash/timeout leaves a held record,
    // never permission to repeat a possibly accepted workflow-dispatch POST.
    const claim = { schema: 1, ...identity, handoffRefSha: saved.refSha, digest, runName, claimId: randomUUID() };
    const recorded = await records.putIfAbsent(kinds.dispatch, identity, claim);
    requireSame({ ...recorded.record, claimId: claim.claimId }, claim, 'Dispatch claim');
    if (!recorded.created || recorded.record.claimId !== claim.claimId) {
      const runs = await api.findFinalizerRuns(dispatchIdentity);
      if (!runs.length) throw new Error(`Dispatch already claimed without an indexed run; reconcile ${runName}, never blindly redispatch`);
      result = { status: 'reconciled', handoff_digest: digest, run_name: runName, runs };
    } else {
      result = await api.postFinalizer({ tag, inputs });
    }
  }
  return { schema: 1, phase: 'handoff_dispatched', published: false, ...identity, version, readOnly,
    intentTag: tag, releaseId: binding.releaseId, handoffRefSha: saved.refSha, ...result,
    runUrls: result.runs.map(run => `https://github.com/${repository}/actions/runs/${run.id}`) };
}

export async function downloadHandoff({ binding, api }) {
  if (binding?.schema !== 1 || binding.packageName !== PACKAGE_NAME || typeof binding.readOnly !== 'boolean') throw new Error('Invalid handoff binding');
  const release = await api.readRelease(binding.releaseId);
  const expectedTag = binding.readOnly ? recordTag('preview-intent', binding) : intentTag(binding);
  if (binding.intentTag !== expectedTag || release.tag_name !== expectedTag || release.draft !== true) throw new Error('Private draft release identity mismatch');
  const listed = await api.listAssets(binding.releaseId);
  const bytes = {};
  for (const key of ['tarball', 'plan', 'manifest']) {
    const asset = binding.assets?.[key];
    const matches = listed.filter(item => item.name === ARTIFACT_NAMES[key]);
    if (!asset || asset.name !== ARTIFACT_NAMES[key] || matches.length !== 1 || matches[0].id !== asset.id
        || matches[0].state !== 'uploaded' || matches[0].size !== asset.size) throw new Error('Handoff asset ID/ownership mismatch');
    bytes[key] = await api.downloadAsset(asset.id);
    if (bytes[key].length !== asset.size || sha256(bytes[key]) !== asset.sha256) throw new Error('Handoff asset bytes differ from immutable binding');
  }
  const manifest = JSON.parse(bytes.manifest);
  const verified = verifyArtifact({ manifest, tarball: bytes.tarball, planBytes: bytes.plan, expected: binding });
  requireSame(manifest.builder, binding.builder, 'CI build provenance');
  if (manifest.tarball.integrity !== binding.integrity) throw new Error('Handoff npm integrity mismatch');
  return { ...verified, manifest, tarball: bytes.tarball, planBytes: bytes.plan };
}

export async function verifyFinalizerHandoff({ repository, inputs, context, records, api, intents }) {
  const sourceSha = inputs.source_sha;
  const channel = SUPPORTED_CHANNELS.includes(inputs.channel) ? channelForBranch(inputs.channel) : null;
  if (!channel || !['true', 'false'].includes(inputs.read_only)) throw new Error('Invalid finalizer channel or mode');
  const readOnly = inputs.read_only === 'true';
  const identity = { sourceSha, channel };
  const kinds = handoffKinds(readOnly);
  const tag = readOnly ? recordTag('preview-intent', identity) : intentTag(identity);
  const dispatchIdentity = { repository, tag, sourceSha, inputs };
  const digest = finalizerDigest(dispatchIdentity);
  if (repository !== 'mindtheflo/notis' || context.event !== 'workflow_dispatch'
      || context.sha !== sourceSha || context.ref !== `refs/tags/${tag}`
      || inputs.handoff_digest !== digest || context.workflowRef !== `${repository}/.github/workflows/publish-cli-package.yml@refs/tags/${tag}`) {
    throw new Error('Finalizer event/ref/source/digest provenance mismatch');
  }
  const saved = await records.read(kinds.binding, identity, inputs.handoff_ref_sha);
  if (!saved || saved.record.releaseId !== Number(inputs.release_id) || saved.record.readOnly !== readOnly) throw new Error('Finalizer immutable binding mismatch');
  const claim = await records.read(kinds.dispatch, identity);
  if (!claim || claim.record.handoffRefSha !== saved.refSha || claim.record.digest !== digest
      || claim.record.runName !== finalizerRunName(dispatchIdentity)) throw new Error('Finalizer dispatch claim mismatch');
  const run = await api.readFinalizerRun({ ...dispatchIdentity, runId: Number(context.runId) });
  if (String(run.id) !== String(context.runId)) throw new Error('Finalizer run is not the authenticated exact dispatch');
  const bundle = await downloadHandoff({ binding: saved.record, api });
  if (readOnly) {
    const preview = await records.read('preview-intent', identity, saved.record.intentRefSha);
    requireSame(preview?.record, { schema: 1, packageName: PACKAGE_NAME, ...identity, version: bundle.manifest.version, preview: true }, 'Preview intent');
  } else {
    const intentRef = await intents.readRef(bundle.plan.intent);
    if (intentRef?.refSha !== saved.record.intentRefSha) throw new Error('Release intent annotated object changed');
    requireSame(intentRef?.intent, bundle.plan.intent, 'Release intent');
  }
  return { ...bundle, binding: saved.record, handoffRefSha: saved.refSha, digest, tag };
}

export async function deliverVerifiedBundle({ bundle, enabled, intents, readHistory, publish, tarball, cwd, env }) {
  if (bundle.manifest.readOnly) return null;
  const { manifest, plan } = bundle;
  const history = await readHistory(manifest.packageName);
  validateReservedVersion(history, plan.intent);
  const existing = history.versions[manifest.version];
  if (existing) {
    verifyPublishedReceipt({ receipt: existing, tagged: history.versions[history['dist-tags'][plan.publishTag]],
      sourceSha: manifest.sourceSha, channel: manifest.channel, version: manifest.version, integrity: manifest.tarball.integrity });
    return { verified: true, reconciled: true, packageName: manifest.packageName, version: manifest.version,
      tag: plan.publishTag, sourceSha: manifest.sourceSha, integrity: manifest.tarball.integrity };
  }
  if (enabled !== true) throw new Error('CLI finalizer channel activation is disabled');
  const branch = branchForChannel(bundle.manifest.channel);
  if (await intents.readBranchHead(branch) !== bundle.manifest.sourceSha) throw new Error('Release is stale; current branch HEAD differs');
  return publish({ packageName: bundle.manifest.packageName, version: bundle.manifest.version,
    tag: bundle.plan.publishTag, sourceSha: bundle.manifest.sourceSha, channel: bundle.manifest.channel,
    tarball, integrity: bundle.manifest.tarball.integrity, cwd, env });
}
