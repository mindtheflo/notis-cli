const PACKAGE = '@notis_ai/cli';
const AUDIENCE = 'npm:registry.npmjs.org';
const EXCHANGE = `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(PACKAGE)}`;

function timestamp(value) {
  if (typeof value === 'string') return Date.parse(value);
  if (!Number.isSafeInteger(value) || value <= 0) return NaN;
  // Current-issued credentials use contemporary epoch values. These disjoint
  // bands cover 2001–2286 in seconds or milliseconds without guessing between
  // ambiguous 11/12-digit values, fractions, negative numbers or overflow.
  if (value >= 1_000_000_000 && value < 10_000_000_000) return value * 1000;
  if (value >= 1_000_000_000_000 && value < 10_000_000_000_000) return value;
  return NaN;
}

// Authentication only: no npm command, package publication, credential file,
// environment export or token receipt. Both short-lived tokens stay in memory.
export async function verifyNpmOidcAccess({ packageName, env = process.env, fetcher = fetch, now = Date.now } = {}) {
  if (packageName !== PACKAGE || env.GITHUB_ACTIONS !== 'true' || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('npm OIDC preflight requires the exact package and GitHub Actions id-token permission');
  }
  let url;
  try { url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); }
  catch { throw new Error('GitHub Actions OIDC request endpoint is missing or invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !url.hostname.endsWith('.actions.githubusercontent.com')) {
    throw new Error('GitHub Actions OIDC request endpoint is not an approved HTTPS host');
  }
  url.searchParams.set('audience', AUDIENCE);
  async function json(endpoint, options, expectedStatus, label) {
    let response;
    try { response = await fetcher(endpoint, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error(`${label} transport outcome unavailable`); }
    if (response.status !== expectedStatus) {
      throw new Error(`${label} failed (HTTP ${Number.isInteger(response.status) ? response.status : 'unknown'})`);
    }
    try { return await response.json(); }
    catch { throw new Error(`${label} returned an invalid JSON receipt`); }
  }
  const github = await json(url.toString(), { method: 'GET', headers: { Accept: 'application/json',
    Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } }, 200, 'GitHub OIDC request');
  if (typeof github?.value !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(github.value)) {
    throw new Error('GitHub OIDC response has no valid identity token');
  }
  const exchange = await json(EXCHANGE, { method: 'POST', headers: { Accept: 'application/json',
    Authorization: `Bearer ${github.value}` } }, 201, 'npm OIDC exchange');
  const created = timestamp(exchange?.created);
  const expires = timestamp(exchange?.expires);
  const current = now();
  if (exchange?.token_type !== 'oidc' || typeof exchange.token !== 'string' || !exchange.token
      || !Number.isFinite(created) || !Number.isFinite(expires) || expires <= created
      || expires <= current || created > current + 300_000) {
    const error = new Error('npm OIDC exchange returned an invalid or expired credential');
    const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    error.responseShape = { tokenPresent: typeof exchange?.token === 'string' && Boolean(exchange.token),
      tokenType: ['oidc', 'Bearer', 'bearer'].includes(exchange?.token_type) ? exchange.token_type : 'other-or-missing',
      fieldTypes: Object.fromEntries(['token_type', 'token', 'created', 'expires'].map(key => [key, type(exchange?.[key])])),
      createdDateValid: Number.isFinite(created), expiresDateValid: Number.isFinite(expires),
      ...(Number.isFinite(created) ? { createdAt: new Date(created).toISOString() } : {}),
      ...(Number.isFinite(expires) ? { expiresAt: new Date(expires).toISOString() } : {}),
      checkedAt: new Date(current).toISOString() };
    throw error;
  }
  return { verified: true, status: 'oidc_exchange_verified', provider: 'github-actions', packageName: PACKAGE,
    createdAt: new Date(created).toISOString(), expiresAt: new Date(expires).toISOString() };
}
