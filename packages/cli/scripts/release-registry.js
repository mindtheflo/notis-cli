import { spawnSync } from 'node:child_process';
import { distTagForChannel, versionMatchesChannel } from './release-channels.cjs';

export function compareReleaseVersions(left, right) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value || '');
    if (!match) throw new Error('Unsupported registry release version');
    return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') };
  };
  const a = parse(left), b = parse(right);
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index], y = b.pre[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function validateReservedVersion(history, { version, sourceSha, channel }) {
  const receipt = history.versions[version];
  if (receipt && !matchesRelease(receipt, sourceSha, channel)) {
    throw new Error('Reserved version belongs to another release; publication held');
  }
  const latest = history['dist-tags'][distTagForChannel(channel)];
  if (latest && latest !== version && compareReleaseVersions(version, latest) <= 0) {
    throw new Error('Reserved version was superseded; reconcile it without moving the registry tag backwards');
  }
}

// Reads must fail closed: an unavailable registry is not an unpublished version.
export function readRegistry(packageName, tag, { run = spawnSync, cwd = process.cwd(), env = process.env } = {}) {
  const result = run('npm', ['view', `${packageName}@${tag}`, '--json'], { cwd, env, encoding: 'utf-8' });
  if (result.status !== 0) {
    let error;
    try { error = JSON.parse(result.stdout || '{}').error; } catch { /* not JSON */ }
    if (error?.code === 'E404') return null;
    throw new Error(`Registry lookup failed for ${packageName}@${tag}; publication is held`);
  }
  const value = JSON.parse(result.stdout);
  if (!value || Array.isArray(value) || typeof value.version !== 'string') {
    throw new Error('Registry returned an invalid package receipt');
  }
  return value;
}

export function matchesRelease(receipt, sourceSha, channel) {
  if (receipt?.gitHead && receipt.gitHead !== sourceSha) return false;
  if (receipt?.notisRelease) return receipt.notisRelease.sourceSha === sourceSha
    && receipt.notisRelease.channel === channel;
  // Before provider-neutral receipts, npm stored the checkout SHA as gitHead.
  return receipt?.gitHead === sourceSha && typeof receipt.version === 'string'
    && versionMatchesChannel(receipt.version, channel);
}

export async function readReleaseHistory(packageName, { fetcher = fetch } = {}) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return { versions: {}, 'dist-tags': {} };
  if (!response.ok) throw new Error('Registry history is unavailable; reconcile before publication');
  const history = await response.json();
  if (!history.versions || !history['dist-tags']) throw new Error('Invalid registry history');
  return history;
}

export function findPublishedRelease(history, sourceSha, channel) {
  const matches = Object.values(history.versions).filter(receipt => matchesRelease(receipt, sourceSha, channel));
  if (!matches.length) return null;
  const tag = distTagForChannel(channel);
  const tagged = matches.find(receipt => receipt.version === history['dist-tags'][tag]);
  if (!tagged) throw new Error(`Source was already published as ${matches.map(item => item.version).join(', ')} but ${tag} points elsewhere; reconcile that version, do not republish`);
  return tagged;
}

export function verifyPublishedReceipt({ receipt, tagged, sourceSha, channel, version, integrity }) {
  if (!matchesRelease(receipt, sourceSha, channel) || receipt.version !== version
      || !integrity || receipt.dist?.integrity !== integrity || tagged?.version !== version) {
    throw new Error('Publication outcome is not verified; reconcile the exact version and tag before retrying');
  }
}

// npm acknowledges a publish before the registry serves it ("being processed
// and may take a few minutes"): in October 2026 the version and its dist-tag
// appeared 1.6 to 7.2 minutes after `npm publish` returned. Back off to a
// 15-second cadence and keep reading for 12 minutes; the finalize job's
// timeout-minutes must stay above this window (see release-registry.test.js).
const RECONCILE_WINDOW_MS = 12 * 60_000;
export const DEFAULT_RECONCILE_DELAYS_MS = Object.freeze((() => {
  const delays = [1_000, 2_000, 4_000, 8_000];
  let total = delays.reduce((sum, ms) => sum + ms, 0);
  while (total < RECONCILE_WINDOW_MS) { delays.push(15_000); total += 15_000; }
  return delays;
})());

async function readVerifiedPublishedReceipt({ packageName, version, tag, sourceSha, channel, integrity,
  read, sleep, delays }) {
  let lastError;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const receipt = await read(packageName, version);
    const tagged = await read(packageName, tag);
    try {
      verifyPublishedReceipt({ receipt, tagged, sourceSha, channel, version, integrity });
      return { receipt, tagged };
    } catch (error) {
      lastError = error;
    }
    if (attempt < delays.length) await sleep(delays[attempt]);
  }
  throw lastError;
}

// Never replay an ambiguous publish. Even a nonzero exit can mean npm accepted it.
export async function publishAndReconcile({ packageName, version, tag, sourceSha, channel, tarball, integrity,
  read = readRegistry, run = spawnSync, cwd = process.cwd(), env = process.env,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), reconcileDelaysMs = DEFAULT_RECONCILE_DELAYS_MS }) {
  const readOptions = { cwd, env };
  let receipt = await read(packageName, version, readOptions);
  if (!receipt) {
    await run('npm', ['publish', tarball, '--ignore-scripts', '--tag', tag], { cwd, env, stdio: 'inherit' });
    await readVerifiedPublishedReceipt({ packageName, version, tag, sourceSha, channel, integrity,
      read: (name, selector) => read(name, selector, readOptions), sleep, delays: reconcileDelaysMs });
  } else {
    const tagged = await read(packageName, tag, readOptions);
    verifyPublishedReceipt({ receipt, tagged, sourceSha, channel, version, integrity });
  }
  return { verified: true, packageName, version, tag, sourceSha, integrity };
}
