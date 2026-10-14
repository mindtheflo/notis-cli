import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNpmOidcAccess } from '../scripts/npm-oidc-preflight.js';

const requestSecret = 'request-secret-never-returned';
const jwt = 'header.payload.secret';
const npmSecret = 'npm-secret-never-returned';
const current = Date.parse('2026-10-13T15:00:00Z');
const env = { GITHUB_ACTIONS: 'true', ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestSecret,
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://run-actions-fixture.actions.githubusercontent.com/token?audience=wrong&api-version=2.0' };
const valid = { token_type: 'oidc', token: npmSecret, created: '2026-10-13T15:00:00Z', expires: '2026-10-13T16:00:00Z' };
const response = (status, json) => ({ status, json: async () => json });
function fixture({ github = response(200, { value: jwt }), npm = response(201, valid), fail } = {}) {
  const calls = [];
  return { calls, options: { packageName: '@notis_ai/cli', env, now: () => current,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      if (fail === calls.length) throw Error(`${requestSecret} ${jwt} ${npmSecret} ${url}`);
      return calls.length === 1 ? github : npm;
    } } };
}
const safeFailure = error => {
  for (const secret of [requestSecret, jwt, npmSecret]) assert.ok(!(error.stack + JSON.stringify(error)).includes(secret));
  assert.equal(error.cause, undefined);
  return true;
};

test('performs auth-only audience-specific exchange and returns no credential', async () => {
  const { calls, options } = fixture();
  const receipt = await verifyNpmOidcAccess(options);
  assert.deepEqual(receipt, { verified: true, status: 'oidc_exchange_verified', provider: 'github-actions', packageName: '@notis_ai/cli',
    createdAt: '2026-10-13T15:00:00.000Z', expiresAt: '2026-10-13T16:00:00.000Z' });
  assert.equal(calls.length, 2);
  assert.deepEqual(new URL(calls[0].url).searchParams.getAll('audience'), ['npm:registry.npmjs.org']);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${requestSecret}`);
  assert.equal(calls[1].url, 'https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/%40notis_ai%2Fcli');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${jwt}`);
  assert.equal(calls[1].options.body, undefined);
  assert.deepEqual(env, { GITHUB_ACTIONS: 'true', ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestSecret,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://run-actions-fixture.actions.githubusercontent.com/token?audience=wrong&api-version=2.0' });
});

test('invalid package/provider/endpoint never sends a credential', async () => {
  for (const override of [{ packageName: '@other/cli' }, { env: { ...env, GITHUB_ACTIONS: 'false' } },
    ...['http://pipelines.actions.githubusercontent.com/token', 'https://evil.invalid/token',
      'https://pipelines.actions.githubusercontent.com.evil.invalid/token', 'https://user:pass@pipelines.actions.githubusercontent.com/token',
      'https://pipelines.actions.githubusercontent.com:444/token', 'invalid'].map(url => ({ env: { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: url } }))]) {
    const { calls, options } = fixture();
    await assert.rejects(() => verifyNpmOidcAccess({ ...options, ...override }), safeFailure);
    assert.equal(calls.length, 0);
  }
});

test('transport, redirect, HTTP and JSON failures never expose tokens and never retry', async () => {
  for (const config of [{ fail: 1 }, { fail: 2 }, { github: response(302, { secret: requestSecret }) },
    { npm: response(401, { message: jwt + npmSecret }) }, { npm: response(200, valid) },
    { npm: { status: 201, json() { throw Error(npmSecret); } } }, { github: response(200, { value: '' }) }]) {
    const { calls, options } = fixture(config);
    await assert.rejects(() => verifyNpmOidcAccess(options), safeFailure);
    assert.ok(calls.length <= 2);
  }
});

test('exchange must return an unexpired OIDC credential with normalized dates', async () => {
  for (const delta of [{ token_type: 'bearer' }, { token: '' }, { created: npmSecret }, { expires: npmSecret }, { created: 5 }, { expires: null },
    { expires: '2026-10-13T14:59:00Z' }, { created: '2026-10-13T15:30:00Z' }]) {
    const { options } = fixture({ npm: response(201, { ...valid, ...delta }) });
    await assert.rejects(() => verifyNpmOidcAccess(options), safeFailure);
  }
});

test('normalizes live numeric Unix seconds and milliseconds without weakening expiry checks', async () => {
  for (const divisor of [1, 1000]) {
    const numeric = { ...valid, created: current / divisor, expires: (current + 3_600_000) / divisor };
    const { options } = fixture({ npm: response(201, numeric) });
    const receipt = await verifyNpmOidcAccess(options);
    assert.equal(receipt.createdAt, '2026-10-13T15:00:00.000Z');
    assert.equal(receipt.expiresAt, '2026-10-13T16:00:00.000Z');
    for (const delta of [{ expires: (current - 1000) / divisor },
      { created: (current + 600_000) / divisor }, { expires: numeric.created }]) {
      const invalid = fixture({ npm: response(201, { ...numeric, ...delta }) });
      await assert.rejects(() => verifyNpmOidcAccess(invalid.options), safeFailure);
    }
  }
});

test('rejects unsafe, fractional, negative, ambiguous and overflow Unix timestamps', async () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER,
    10_000_000_000, 999_999_999_999, 10_000_000_000_000]) {
    for (const field of ['created', 'expires']) {
      const { options } = fixture({ npm: response(201, { ...valid, [field]: value }) });
      await assert.rejects(() => verifyNpmOidcAccess(options), safeFailure);
    }
  }
});

test('rejected exchange exposes only allowlisted shape/date diagnostics, never values or extra keys', async () => {
  const { options } = fixture({ npm: response(201, { token: npmSecret, token_type: jwt,
    created: requestSecret, expires: null, [npmSecret]: jwt }) });
  await assert.rejects(() => verifyNpmOidcAccess(options), error => {
    safeFailure(error);
    assert.deepEqual(error.responseShape, { tokenPresent: true, tokenType: 'other-or-missing',
      fieldTypes: { token_type: 'string', token: 'string', created: 'string', expires: 'null' },
      createdDateValid: false, expiresDateValid: false, checkedAt: '2026-10-13T15:00:00.000Z' });
    return true;
  });
});
