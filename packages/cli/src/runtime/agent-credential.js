import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// A Notis agent's Cloud Computer command gets NOTIS_JWT naming that agent, for a few hours only
// (server/lib/delegated_agents/cli_caller.py). A process that outlives it renews it here: the newest renewed token
// sits in a per-token cache file next to the CLI's config, and each run uses the newest unexpired of the
// environment token and the cached one. No other credential kind is ever renewed.
const MANAGED_AGENT_TYPE = 'notis_managed_agent';
const AGENT_CLAIM = 'notis_agent';
const CACHE_DIRNAME = 'agent-credentials';
// Renew once the token in use has less than this left.
export const AGENT_RENEW_WINDOW_SECONDS = 60 * 60;
// The renewal never holds a command up for long: on failure the current token is still used.
const RENEW_TIMEOUT_MS = 15_000;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// Read without verifying, only for `type`, `notis_agent`, `sub` and `exp`: the server verifies every token.
function unverifiedPayload(jwt) {
  if (typeof jwt !== 'string' || !jwt) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** The exp of a managed credential naming an agent, or null for any other token. */
function agentCredentialExpiry(jwt) {
  const payload = unverifiedPayload(jwt);
  if (
    !payload
    || payload.type !== MANAGED_AGENT_TYPE
    || !payload[AGENT_CLAIM]
    || typeof payload[AGENT_CLAIM] !== 'object'
    || typeof payload.exp !== 'number'
  ) {
    return null;
  }
  return payload.exp;
}

export function isManagedAgentCredential(jwt) {
  return agentCredentialExpiry(jwt) !== null;
}

function cacheDirectory(configFile) {
  return join(dirname(configFile), CACHE_DIRNAME);
}

export function agentCredentialCacheFile(configFile, envJwt) {
  return join(cacheDirectory(configFile), `${createHash('sha256').update(envJwt).digest('hex')}.json`);
}

function readCachedToken(configFile, envJwt) {
  try {
    const cached = JSON.parse(readFileSync(agentCredentialCacheFile(configFile, envJwt), 'utf-8'));
    const token = typeof cached?.token === 'string' ? cached.token : null;
    // Only a credential naming the same person's agent ever replaces the environment one.
    if (
      !token
      || agentCredentialExpiry(token) === null
      || unverifiedPayload(token).sub !== unverifiedPayload(envJwt).sub
    ) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * The credential a run should use for an environment token: null when it is not a managed agent credential (it is
 * used as is), else the newest unexpired of it and its cached renewal, or the environment token once both lapsed.
 */
export function selectAgentCredential(envJwt, { configFile, now = nowSeconds() } = {}) {
  const envExpiry = agentCredentialExpiry(envJwt);
  if (envExpiry === null) return null;
  const cached = configFile ? readCachedToken(configFile, envJwt) : null;
  const cachedExpiry = cached ? agentCredentialExpiry(cached) : null;
  if (cached && cachedExpiry > now && cachedExpiry > envExpiry) {
    return { jwt: cached };
  }
  return { jwt: envJwt };
}

function pruneExpired(directory, keep, now) {
  let names = [];
  try {
    names = readdirSync(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === keep || !name.endsWith('.json')) continue;
    const path = join(directory, name);
    try {
      const expiry = agentCredentialExpiry(JSON.parse(readFileSync(path, 'utf-8'))?.token);
      if (expiry === null || expiry <= now) unlinkSync(path);
    } catch {
      try {
        unlinkSync(path);
      } catch {
        // Another process removed it first.
      }
    }
  }
}

export function storeAgentCredential(configFile, envJwt, token, { now = nowSeconds() } = {}) {
  const directory = cacheDirectory(configFile);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = agentCredentialCacheFile(configFile, envJwt);
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify({ token, exp: agentCredentialExpiry(token) }), { mode: 0o600 });
  // writeFileSync's mode is masked by the umask; the file holds a credential, so it is the owner's only.
  chmodSync(temporaryFile, 0o600);
  renameSync(temporaryFile, file);
  pruneExpired(directory, file.slice(directory.length + 1), now);
}

/**
 * Renew the run's agent credential once when it expires within AGENT_RENEW_WINDOW_SECONDS. `renew` sends the
 * renewal request with the current token and resolves to the server's `{ token, expires_at }`. A refused or failed
 * renewal changes nothing: the current token is used while it is valid (no dead ends).
 */
export async function renewAgentCredentialIfDue(runtime, { configFile, renew, now = nowSeconds() }) {
  if (!runtime?.agentEnvJwt || runtime.agentRenewAttempted) return false;
  const expiry = agentCredentialExpiry(runtime.jwt);
  // The server renews only an unexpired credential.
  if (expiry === null || expiry <= now || expiry - now > AGENT_RENEW_WINDOW_SECONDS) return false;
  runtime.agentRenewAttempted = true;
  try {
    const answer = await renew();
    const token = typeof answer?.token === 'string' ? answer.token : null;
    const renewedExpiry = token ? agentCredentialExpiry(token) : null;
    if (
      renewedExpiry === null
      || renewedExpiry <= expiry
      || unverifiedPayload(token).sub !== unverifiedPayload(runtime.jwt).sub
    ) {
      return false;
    }
    runtime.jwt = token;
    try {
      storeAgentCredential(configFile, runtime.agentEnvJwt, token, { now });
    } catch {
      // This run still uses the fresh token; the next run renews again.
    }
    return true;
  } catch {
    return false;
  }
}

export const AGENT_RENEW_REQUEST = Object.freeze({
  path: '/cli_tools',
  body: Object.freeze({ operation: 'renew_agent_credential' }),
  timeoutMs: RENEW_TIMEOUT_MS,
});
