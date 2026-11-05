import assert from 'node:assert/strict';
import test from 'node:test';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';

function context(path, options = {}, args = {}) {
  const spec = spacesCommandSpecs.find(value => value.command_path.join(' ') === path);
  assert.ok(spec, path);
  return { spec, options, args, globalOptions: {}, runtime: { credentialKind: 'env', profileName: 'store-check-unit-only',
    jwt: 'fixture-not-a-real-credential', apiBase: 'https://fixture.invalid', timeoutMs: 1000, cliVersion: 'fixture' },
    output: { emitSuccess: value => value } };
}

function recordRequests(t, payload = { receipt_id: 'receipt-1' }) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body), headers: request.headers });
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

test('store check sends the listing, and the install and language only when given', async t => {
  const calls = recordRequests(t);
  for (const [options, body] of [
    [{}, { listing_id: 'listing-1' }],
    [{ install: 'install-1', locale: 'fr' }, { listing_id: 'listing-1', install_id: 'install-1', locale: 'fr' }],
  ]) {
    const ctx = context('spaces store check', options, { listingId: 'listing-1' });
    await ctx.spec.handler(ctx);
    assert.equal(calls.at(-1).url, 'https://fixture.invalid/portal_spaces/store-check');
    assert.deepEqual(calls.at(-1).body, body);
    // The CLI version header makes the server treat this as an agent, whatever the credential.
    assert.equal(calls.at(-1).headers['X-Notis-CLI-Version'], 'fixture');
  }
  const bad = context('spaces store check', { locale: 'de' }, { listingId: 'listing-1' });
  assert.throws(() => bad.spec.handler(bad), /--locale en or --locale fr/);
  assert.equal(calls.length, 2);
});

test('store install and update carry the check receipt and the yes, and --confirmed needs a receipt', async t => {
  const calls = recordRequests(t, { install_id: 'install-1' });
  const install = context('spaces store install', { requestId: 'install-1', receipt: 'receipt-1', confirmed: true },
    { listingId: 'listing-1' });
  await install.spec.handler(install);
  assert.deepEqual(calls.at(-1).body, { listing_id: 'listing-1', request_id: 'install-1', receipt_id: 'receipt-1',
    confirmed: true, dry_run: false });
  const update = context('spaces store update', { requestId: 'update-1', receipt: 'receipt-2', confirmed: true },
    { installId: 'install-1' });
  await update.spec.handler(update);
  assert.deepEqual(calls.at(-1).body, { install_id: 'install-1', request_id: 'update-1', receipt_id: 'receipt-2',
    confirmed: true, dry_run: false });
  // Without a receipt the request still goes out unchanged: the server answers store_check_required.
  const unchecked = context('spaces store install', { requestId: 'install-2' }, { listingId: 'listing-1' });
  await unchecked.spec.handler(unchecked);
  assert.deepEqual(calls.at(-1).body, { listing_id: 'listing-1', request_id: 'install-2', dry_run: false });
  for (const path of ['spaces store install', 'spaces store update']) {
    const bad = context(path, { requestId: 'x', confirmed: true }, { listingId: 'listing-1', installId: 'install-1' });
    assert.throws(() => bad.spec.handler(bad), /--receipt <receipt-id>/);
    const flags = bad.spec.args_schema.options.map(option => option.flags);
    assert.ok(flags.includes('--receipt <receipt-id>') && flags.includes('--confirmed'));
  }
  assert.equal(calls.length, 3);
});

test('store check is listed before install and says to ask the person', () => {
  const paths = spacesCommandSpecs.map(spec => spec.command_path.join(' '));
  assert.ok(paths.indexOf('spaces store check') < paths.indexOf('spaces store install'));
  const check = spacesCommandSpecs.find(spec => spec.command_path.join(' ') === 'spaces store check');
  assert.match(check.when_to_use, /wait for their yes/);
});

test('store check, publish, install and update wait at least three minutes, other Store reads keep the default', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
  // Records each wait the request arms, without arming it (the abort never fires during the test).
  const waits = [];
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (_fn, ms) => { waits.push(ms); return realSetTimeout(() => {}, 0); });
  const longest = async (path, options, args) => {
    waits.length = 0;
    const ctx = context(path, options, args);
    await ctx.spec.handler(ctx);
    return Math.max(...waits);
  };
  assert.equal(await longest('spaces store check', {}, { listingId: 'listing-1' }), 180_000);
  assert.equal(await longest('spaces store install', { requestId: 'i' }, { listingId: 'listing-1' }), 180_000);
  assert.equal(await longest('spaces store update', { requestId: 'u' }, { installId: 'install-1' }), 180_000);
  assert.equal(await longest('spaces store publish', { requestId: 'p', channel: 'link' }, { spaceId: 'space-1' }), 180_000);
  assert.equal(await longest('spaces store installs', {}, {}), 1000);
});
