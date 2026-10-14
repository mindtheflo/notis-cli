// Additional CI records are separate from the never-modified version reservation.
const SHA = /^[0-9a-f]{40}$/;
const PREFIXES = { handoff: 'notis-cli-handoff', 'preview-intent': 'notis-cli-preview',
  'preview-handoff': 'notis-cli-preview-handoff', dispatch: 'notis-cli-dispatch',
  'preview-dispatch': 'notis-cli-preview-dispatch' };

export function recordTag(kind, { sourceSha, channel }) {
  if (!PREFIXES[kind] || !SHA.test(sourceSha || '') || !['beta', 'stable'].includes(channel)) throw new Error('Invalid immutable handoff identity');
  return `${PREFIXES[kind]}/${channel}/${sourceSha}`;
}

// Re-read (never re-write) a just-created reference while GitHub is briefly
// unavailable or has not indexed it yet: about 7 s in total.
const READBACK_DELAYS_MS = [1_000, 2_000, 4_000];

function transient(message) {
  const error = new Error(message);
  error.transient = true;
  return error;
}

export function createRecordStore({ repository, token, fetcher = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (repository !== 'mindtheflo/notis' || !token) throw new Error('Private Notis repository token required');
  const base = `https://api.github.com/repos/${repository}/git`;
  async function request(method, path, body, allowMissing = false) {
    let response;
    try {
      response = await fetcher(base + path, { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw transient('Immutable handoff record outcome unavailable; reconcile the same reference'); }
    if (allowMissing && response.status === 404) return null;
    if (response.status === 429 || response.status >= 500) throw transient(`Immutable handoff record failed (HTTP ${response.status})`);
    if (!response.ok) throw new Error(`Immutable handoff record failed (HTTP ${response.status})`);
    // A reset or timeout while the body streams leaves the outcome unknown too.
    try { return await response.json(); }
    catch { throw transient('Immutable handoff record receipt unavailable; reconcile the same reference'); }
  }
  async function read(kind, identity, expectedRefSha) {
    const tag = recordTag(kind, identity);
    const ref = await request('GET', `/ref/tags/${tag}`, undefined, true);
    if (!ref) return null;
    if (ref.ref !== `refs/tags/${tag}` || ref.object?.type !== 'tag' || !SHA.test(ref.object.sha || '')
        || (expectedRefSha && ref.object.sha !== expectedRefSha)) throw new Error('Immutable handoff reference mismatch');
    const object = await request('GET', `/tags/${ref.object.sha}`);
    if (object.tag !== tag || object.object?.type !== 'commit' || object.object.sha !== identity.sourceSha) throw new Error('Immutable handoff tag source mismatch');
    let record;
    try { record = JSON.parse(object.message); } catch { throw new Error('Invalid handoff annotation'); }
    if (record.schema !== 1 || record.sourceSha !== identity.sourceSha || record.channel !== identity.channel) throw new Error('Immutable handoff annotation identity mismatch');
    return { tag, refSha: ref.object.sha, record };
  }
  async function putIfAbsent(kind, identity, record) {
    if (record.schema !== 1 || record.sourceSha !== identity.sourceSha || record.channel !== identity.channel) throw new Error('Invalid handoff record identity');
    const existing = await read(kind, identity);
    if (existing) return { ...existing, created: false };
    const tag = recordTag(kind, identity);
    const object = await request('POST', '/tags', { tag, message: JSON.stringify(record), object: identity.sourceSha, type: 'commit' });
    if (!SHA.test(object.sha || '')) throw new Error('Invalid immutable tag creation receipt');
    try { await request('POST', '/refs', { ref: `refs/tags/${tag}`, sha: object.sha }); }
    catch { /* Ambiguous creation/competing writers reconcile the exact ref. */ }
    const result = await readBack(kind, identity);
    return { ...result, created: result.refSha === object.sha };
  }
  async function readBack(kind, identity) {
    for (let attempt = 0; ; attempt += 1) {
      let result = null, failure = null;
      try { result = await read(kind, identity); }
      catch (error) { if (!error.transient) throw error; failure = error; }
      if (result) return result;
      if (attempt >= READBACK_DELAYS_MS.length) throw failure || new Error('Immutable handoff reference not confirmed');
      await sleep(READBACK_DELAYS_MS[attempt]);
    }
  }
  return { read, putIfAbsent };
}
