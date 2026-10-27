// An annotated tag is the durable reservation, not evidence of npm delivery.
// Never update/delete one: a retry must reconcile its exact reserved version.
import { SUPPORTED_CHANNELS, gitBranchesForChannel, isPackageChannel, versionMatchesChannel } from './release-channels.cjs';

const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function intentTag({ sourceSha, channel }) {
  if (!SHA.test(sourceSha || '') || !isPackageChannel(channel)) {
    throw new Error('Invalid release intent identity');
  }
  return `notis-cli-intent/${channel}/${sourceSha}`;
}

export function validateIntent(intent, identity) {
  intentTag(identity);
  if (intent?.schema !== 1 || intent.packageName !== identity.packageName
      || intent.sourceSha !== identity.sourceSha || intent.channel !== identity.channel
      || !VERSION.test(intent.version || '')
      || !versionMatchesChannel(intent.version, identity.channel)) {
    throw new Error('Stored release intent conflicts with the exact package, source or channel');
  }
  return intent;
}

export async function resolveReleaseIntent({ identity, store, reserve = false, preview, allocateVersion }) {
  if (preview) {
    if (reserve || preview.preview !== true) throw new Error('Preview intent cannot reserve a live release');
    const intent = validateIntent({ schema: 1, ...identity, version: preview.version }, identity);
    validateIntent(preview, identity);
    return { intent, reserved: false };
  }
  if (reserve && !store) throw new Error('Publishing requires the durable release intent store');
  const existing = store ? await store.read(identity) : null;
  if (existing) return { intent: existing, reserved: true };
  const intent = validateIntent({ schema: 1, ...identity, version: await allocateVersion() }, identity);
  return { intent: reserve ? await store.reserve(intent) : intent, reserved: reserve };
}

export function createIntentStore({ repository, token, fetcher = fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !token) {
    throw new Error('GitHub repository and scoped token are required for release intents');
  }
  const base = `https://api.github.com/repos/${repository}/git`;
  async function request(method, path, body, allowMissing = false) {
    let response;
    try {
      response = await fetcher(`${base}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error(`Release intent ${method} outcome unavailable; reconcile before publication`);
    }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Release intent ${method} failed (HTTP ${response.status}); publication held`);
    return response.json();
  }

  async function readRef(identity) {
    const tag = intentTag(identity);
    const ref = await request('GET', `/ref/tags/${tag}`, undefined, true);
    if (!ref) return null;
    if (ref.ref !== `refs/tags/${tag}` || ref.object?.type !== 'tag' || !SHA.test(ref.object.sha || '')) {
      throw new Error('Release intent reference is not the expected annotated tag');
    }
    const object = await request('GET', `/tags/${ref.object.sha}`);
    if (object.tag !== tag || object.object?.type !== 'commit' || object.object.sha !== identity.sourceSha) {
      throw new Error('Release intent tag does not point to its exact source commit');
    }
    let intent;
    try { intent = JSON.parse(object.message); } catch { throw new Error('Release intent annotation is invalid'); }
    return { intent: validateIntent(intent, identity), refSha: ref.object.sha };
  }
  async function read(identity) { return (await readRef(identity))?.intent || null; }

  async function reserve(intent) {
    validateIntent(intent, intent);
    const existing = await read(intent);
    if (existing) {
      if (existing.version !== intent.version) throw new Error('Release version is already reserved; retry using the stored intent');
      return existing;
    }
    const tag = intentTag(intent);
    const object = await request('POST', '/tags', { tag, message: JSON.stringify(intent),
      object: intent.sourceSha, type: 'commit' });
    if (!SHA.test(object.sha || '')) throw new Error('Invalid annotated-tag creation receipt');
    // A lost create-ref response or a racing writer is resolved by exactly the
    // same ref. There is no second allocation, ref update, or publish retry.
    try { await request('POST', '/refs', { ref: `refs/tags/${tag}`, sha: object.sha }); }
    catch { /* Read the authoritative reference below, even for HTTP 422. */ }
    const reserved = await read(intent);
    if (!reserved || reserved.version !== intent.version) {
      throw new Error('Release intent creation is unconfirmed or conflicting; reconcile the same reference before publishing');
    }
    return reserved;
  }
  // The release's branch under its current name, then its name before the
  // 2026-10-27 rename (beta -> nightly, production -> stable).
  async function readBranchHead(branch) {
    if (!SUPPORTED_CHANNELS.includes(branch)) throw new Error('Invalid publication branch');
    for (const name of gitBranchesForChannel(branch)) {
      const ref = await request('GET', `/ref/heads/${name}`, undefined, true);
      if (ref === null) continue;
      if (ref.ref !== `refs/heads/${name}` || ref.object?.type !== 'commit' || !SHA.test(ref.object.sha || '')) {
        throw new Error('Invalid publication branch receipt');
      }
      return ref.object.sha;
    }
    throw new Error('Publication branch not found; publication held');
  }
  return { read, readRef, reserve, readBranchHead };
}
