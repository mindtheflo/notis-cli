import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { CliError, EXIT_CODES } from './errors.js';
import { getDesktopAuthRecovery } from './desktop-auth.js';

export const CONFIG_DIR = join(homedir(), '.notis');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const WORKSPACE_DIR = join(CONFIG_DIR, 'workspace');
export const DEFAULT_API_BASE = 'https://api.notis.ai';
export const BETA_API_BASE = 'https://api-beta.notis.ai';
export const DEFAULT_PROFILE = 'default';
const WORKTREE_RUNTIME_FILENAME = join('.context', 'notis-runtime.json');
const WORKTREE_ROUTING_FILENAME = join('.context', 'notis-routing.json');
const LOCAL_API_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LIVE_API_HOSTS = new Set(['api.notis.ai', 'api-beta.notis.ai']);
// Cross-process write lock over ~/.notis/config.json. Notis Desktop implements
// the same protocol independently in electron/src/cli-auth.ts (updateConfig);
// the `${configFile}.write-lock` directory name and these three timings must
// stay identical on both sides or `notis login` and desktop syncAuth stop
// excluding each other and clobber stored OAuth tokens. Guarded by the drift
// test in packages/cli/test/runtime-auth.test.js.
const CONFIG_WRITE_LOCK_TIMEOUT_MS = 5_000;
const CONFIG_WRITE_LOCK_STALE_MS = 2_000;
const CONFIG_WRITE_LOCK_POLL_MS = 10;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeConfig(rawConfig = {}) {
  const raw = rawConfig && typeof rawConfig === 'object' ? clone(rawConfig) : {};

  if (raw.profiles && typeof raw.profiles === 'object') {
    const profiles = {};
    for (const [name, profile] of Object.entries(raw.profiles)) {
      if (!profile || typeof profile !== 'object') {
        continue;
      }
      profiles[name] = {
        jwt: typeof profile.jwt === 'string' ? profile.jwt : undefined,
        api_base: typeof profile.api_base === 'string' ? profile.api_base : undefined,
        beta: typeof profile.beta === 'boolean' ? profile.beta : undefined,
        auth_mode: profile.auth_mode === 'dev_portal' ? profile.auth_mode : undefined,
        refresh_token:
          typeof profile.refresh_token === 'string' ? profile.refresh_token : undefined,
        access_expires_at:
          typeof profile.access_expires_at === 'number' ? profile.access_expires_at : undefined,
        refresh_expires_at:
          typeof profile.refresh_expires_at === 'number' ? profile.refresh_expires_at : undefined,
        desktop_app_name:
          typeof profile.desktop_app_name === 'string' ? profile.desktop_app_name : undefined,
        desktop_pid: typeof profile.desktop_pid === 'number' ? profile.desktop_pid : undefined,
        oauth_access_token:
          typeof profile.oauth_access_token === 'string' ? profile.oauth_access_token : undefined,
        oauth_refresh_token:
          typeof profile.oauth_refresh_token === 'string' ? profile.oauth_refresh_token : undefined,
        oauth_access_expires_at:
          typeof profile.oauth_access_expires_at === 'number' ? profile.oauth_access_expires_at : undefined,
        oauth_refresh_expires_at:
          typeof profile.oauth_refresh_expires_at === 'number' ? profile.oauth_refresh_expires_at : undefined,
        oauth_client_id:
          typeof profile.oauth_client_id === 'string' ? profile.oauth_client_id : undefined,
        oauth_issuer:
          typeof profile.oauth_issuer === 'string' ? profile.oauth_issuer : undefined,
        oauth_api_base:
          typeof profile.oauth_api_base === 'string' ? profile.oauth_api_base : undefined,
        oauth_resource:
          typeof profile.oauth_resource === 'string' ? profile.oauth_resource : undefined,
        oauth_scopes:
          Array.isArray(profile.oauth_scopes)
            ? profile.oauth_scopes.filter((scope) => typeof scope === 'string')
            : undefined,
        oauth_user_id:
          typeof profile.oauth_user_id === 'string' ? profile.oauth_user_id : undefined,
      };
    }

    if (!profiles[DEFAULT_PROFILE]) {
      profiles[DEFAULT_PROFILE] = {};
    }

    return {
      current_profile:
        typeof raw.current_profile === 'string' && raw.current_profile in profiles
          ? raw.current_profile
          : DEFAULT_PROFILE,
      profiles,
    };
  }

  return {
    current_profile: DEFAULT_PROFILE,
    profiles: {
      [DEFAULT_PROFILE]: {
        jwt: typeof raw.jwt === 'string' ? raw.jwt : undefined,
        api_base: typeof raw.api_base === 'string' ? raw.api_base : undefined,
        beta: typeof raw.beta === 'boolean' ? raw.beta : undefined,
        auth_mode: raw.auth_mode === 'dev_portal' ? raw.auth_mode : undefined,
        refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
        access_expires_at:
          typeof raw.access_expires_at === 'number' ? raw.access_expires_at : undefined,
        refresh_expires_at:
          typeof raw.refresh_expires_at === 'number' ? raw.refresh_expires_at : undefined,
        desktop_app_name:
          typeof raw.desktop_app_name === 'string' ? raw.desktop_app_name : undefined,
        desktop_pid: typeof raw.desktop_pid === 'number' ? raw.desktop_pid : undefined,
        oauth_access_token:
          typeof raw.oauth_access_token === 'string' ? raw.oauth_access_token : undefined,
        oauth_refresh_token:
          typeof raw.oauth_refresh_token === 'string' ? raw.oauth_refresh_token : undefined,
        oauth_access_expires_at:
          typeof raw.oauth_access_expires_at === 'number' ? raw.oauth_access_expires_at : undefined,
        oauth_refresh_expires_at:
          typeof raw.oauth_refresh_expires_at === 'number' ? raw.oauth_refresh_expires_at : undefined,
        oauth_client_id:
          typeof raw.oauth_client_id === 'string' ? raw.oauth_client_id : undefined,
        oauth_issuer:
          typeof raw.oauth_issuer === 'string' ? raw.oauth_issuer : undefined,
        oauth_api_base:
          typeof raw.oauth_api_base === 'string' ? raw.oauth_api_base : undefined,
        oauth_resource:
          typeof raw.oauth_resource === 'string' ? raw.oauth_resource : undefined,
        oauth_scopes:
          Array.isArray(raw.oauth_scopes)
            ? raw.oauth_scopes.filter((scope) => typeof scope === 'string')
            : undefined,
        oauth_user_id:
          typeof raw.oauth_user_id === 'string' ? raw.oauth_user_id : undefined,
      },
    },
  };
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function findUp(filename, startDir = process.cwd()) {
  let current = resolve(startDir);
  const root = parse(current).root;
  while (true) {
    const candidate = join(current, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (current === root) {
      return null;
    }
    current = dirname(current);
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function resolveWorktreeRuntime(startDir = process.cwd()) {
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING === '1'
  ) {
    return null;
  }
  const runtimePath = findUp(WORKTREE_RUNTIME_FILENAME, startDir);
  const routingPath = findUp(WORKTREE_ROUTING_FILENAME, startDir);
  const routing = routingPath ? readJsonFile(routingPath) : null;

  if (!runtimePath) {
    if (routing?.mode === 'local-only') {
      throw new CliError({
        code: 'dev_runtime_unavailable',
        message: `This worktree is local-only, but its dev.sh runtime is not active`,
        exitCode: EXIT_CODES.network,
        hints: [
          { message: 'Start ./dev.sh in this worktree, then retry the command.' },
          { message: `Routing policy: ${routingPath}` },
        ],
      });
    }
    return null;
  }

  const runtime = readJsonFile(runtimePath);
  const apiBase = typeof runtime?.api_base === 'string' ? runtime.api_base.replace(/\/+$/, '') : '';
  const configFile = typeof runtime?.config_file === 'string' ? runtime.config_file : '';
  const appDevSessionsFile =
    typeof runtime?.app_dev_sessions_file === 'string' && runtime.app_dev_sessions_file.trim()
      ? runtime.app_dev_sessions_file.trim()
      : join(dirname(runtimePath), 'app-dev-sessions.json');
  const desktopDeepLinkScheme =
    typeof runtime?.desktop_deep_link_scheme === 'string'
      ? runtime.desktop_deep_link_scheme.trim()
      : '';
  const pid = Number(runtime?.dev_pid);
  if (
    runtime?.mode !== 'local-only' ||
    !isLocalApiBase(apiBase) ||
    !configFile ||
    !processIsAlive(pid)
  ) {
    throw new CliError({
      code: 'dev_runtime_unavailable',
      message: 'The local-only worktree runtime is stale or invalid',
      exitCode: EXIT_CODES.network,
      hints: [
        { message: 'Restart ./dev.sh in this worktree, then retry the command.' },
        { message: `Runtime lease: ${runtimePath}` },
      ],
    });
  }

  return {
    ...runtime,
    api_base: apiBase,
    config_file: resolve(dirname(runtimePath), configFile),
    app_dev_sessions_file: resolve(dirname(runtimePath), appDevSessionsFile),
    desktop_deep_link_scheme: desktopDeepLinkScheme || undefined,
    runtime_path: runtimePath,
    routing_path: routingPath,
  };
}

export function resolveConfigFile(runtime = null) {
  if (runtime?.config_file) {
    return runtime.config_file;
  }
  const envConfigFile = process.env.NOTIS_CLI_CONFIG_FILE;
  if (envConfigFile) {
    return resolve(envConfigFile);
  }
  return CONFIG_FILE;
}

export function loadConfig(runtime = null) {
  const configFile = resolveConfigFile(runtime);
  if (!existsSync(configFile)) {
    return normalizeConfig({});
  }

  // The desktop app rewrites this file while the CLI may be reading it, so a
  // torn or corrupt read is expected rather than exceptional. Degrade to
  // "unauthenticated", which surfaces the actionable auth_missing error instead
  // of a raw SyntaxError from deep inside the runtime.
  try {
    return normalizeConfig(JSON.parse(readFileSync(configFile, 'utf-8')));
  } catch {
    return normalizeConfig({});
  }
}

function writeConfig(configFile, config) {
  mkdirSync(dirname(configFile), { recursive: true });
  const temporaryFile = `${configFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(normalizeConfig(config), null, 2), { mode: 0o600 });
  renameSync(temporaryFile, configFile);
}

// The lock records who holds it and when they took it. Reclaiming a stale lock
// by mtime alone is not safe: the reclaimer cannot tell an abandoned lock from
// one it is about to steal from a live writer, and the victim's own release
// would then delete the thief's lock and admit a third writer. Both sides are
// on the same host, so the stored timestamp and Date.now() share a clock.
function readLockOwner(lockDirectory) {
  try {
    return JSON.parse(readFileSync(join(lockDirectory, 'owner'), 'utf-8'));
  } catch {
    return null;
  }
}

function lockDirectoryMtime(lockDirectory) {
  try {
    return statSync(lockDirectory).mtimeMs;
  } catch {
    return null;
  }
}

function publishConfigWriteLock(lockDirectory, ownerId) {
  const candidateDirectory = `${lockDirectory}.candidate-${ownerId}`;
  try {
    mkdirSync(candidateDirectory);
    writeFileSync(
      join(candidateDirectory, 'owner'),
      JSON.stringify({ id: ownerId, at: Date.now() }),
      { mode: 0o600 },
    );
    try {
      renameSync(candidateDirectory, lockDirectory);
      return true;
    } catch (error) {
      if (!existsSync(lockDirectory)) throw error;
      return false;
    }
  } finally {
    rmSync(candidateDirectory, { recursive: true, force: true });
  }
}

function withConfigWriteLock(runtime, callback) {
  const configFile = resolveConfigFile(runtime);
  const lockDirectory = `${configFile}.write-lock`;
  const ownerId = `${process.pid}.${randomUUID()}`;
  const deadline = Date.now() + CONFIG_WRITE_LOCK_TIMEOUT_MS;
  mkdirSync(dirname(configFile), { recursive: true });
  for (;;) {
    if (!existsSync(lockDirectory) && publishConfigWriteLock(lockDirectory, ownerId)) {
      break;
    }

    const owner = readLockOwner(lockDirectory);
    const observedMtime = lockDirectoryMtime(lockDirectory);
    const ownerIsStale =
      owner?.id && Date.now() - Number(owner.at) > CONFIG_WRITE_LOCK_STALE_MS;
    const ownerlessIsStale =
      !owner
      && observedMtime !== null
      && Date.now() - observedMtime > CONFIG_WRITE_LOCK_STALE_MS;
    if (ownerIsStale || ownerlessIsStale) {
      try {
        const currentOwner = readLockOwner(lockDirectory);
        const ownerUnchanged = owner?.id
          ? currentOwner?.id === owner.id
          : !currentOwner && lockDirectoryMtime(lockDirectory) === observedMtime;
        if (ownerUnchanged) {
          rmSync(lockDirectory, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Losing the reclaim race is normal; fall through and keep waiting.
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting to update ${configFile}`);
    }
    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,
      0,
      CONFIG_WRITE_LOCK_POLL_MS,
    );
  }
  try {
    return callback(configFile);
  } finally {
    try {
      // Never release a lock that was reclaimed from us while we worked.
      if (readLockOwner(lockDirectory)?.id === ownerId) {
        rmSync(lockDirectory, { recursive: true, force: true });
      }
    } catch {
      // The lock may already have been removed after an interrupted write.
    }
  }
}

export function saveConfig(config, runtime = null) {
  return withConfigWriteLock(runtime, (configFile) => {
    writeConfig(configFile, config);
  });
}

export function updateConfig(updater, runtime = null) {
  return withConfigWriteLock(runtime, (configFile) => {
    const current = loadConfig(runtime);
    const updated = updater(normalizeConfig(current));
    const next = normalizeConfig(updated ?? current);
    writeConfig(configFile, next);
    return next;
  });
}

export function getProfile(config, profileName) {
  const normalized = normalizeConfig(config);
  return normalized.profiles[profileName] || {};
}

export function getCurrentProfileName(config, preferredName) {
  const normalized = normalizeConfig(config);
  if (preferredName && normalized.profiles[preferredName]) {
    return preferredName;
  }
  return normalized.current_profile || DEFAULT_PROFILE;
}

export function ensureProfile(config, profileName) {
  const normalized = normalizeConfig(config);
  if (!normalized.profiles[profileName]) {
    normalized.profiles[profileName] = {};
  }
  return normalized;
}

function isLocalApiBase(value) {
  if (typeof value !== 'string' || !value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && LOCAL_API_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isLiveApiBase(value) {
  if (typeof value !== 'string' || !value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && LIVE_API_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Pick the live Notis API for this profile.
 *
 * Beta users (`users.beta = true`, mirrored onto the CLI profile by Desktop
 * sync / OAuth against api-beta) hit api-beta.notis.ai; everyone else hits
 * api.notis.ai. Localhost is never a default — only the worktree test lease
 * (`./dev.sh` / `/notis-tests`) may retarget the CLI at loopback.
 */
export function resolveDefaultLiveApiBase(profile = {}) {
  if (profile.beta === true) {
    return BETA_API_BASE;
  }
  if (profile.beta === false) {
    return DEFAULT_API_BASE;
  }
  if (profile.desktop_app_name === 'Notis Beta') {
    return BETA_API_BASE;
  }
  if (isLiveApiBase(profile.api_base)) {
    try {
      if (new URL(profile.api_base).hostname === 'api-beta.notis.ai') {
        return BETA_API_BASE;
      }
    } catch {
      // fall through
    }
  }
  return DEFAULT_API_BASE;
}

export function getApiBase(config, profileName, override) {
  if (override) {
    return override;
  }
  const env = process.env.NOTIS_API_BASE;
  if (env) {
    return env;
  }
  const profile = getProfile(config, profileName);
  const profileApiBase = profile.api_base;

  // Prefer an explicit non-loopback API stored on the profile (Desktop sync /
  // OAuth / custom overrides). Ignore stale localhost values — loopback
  // routing is owned exclusively by the worktree runtime lease under
  // `/notis-tests`, not by CONDUCTOR_PORT or leftover local profile state.
  if (typeof profileApiBase === 'string' && profileApiBase && !isLocalApiBase(profileApiBase)) {
    return profileApiBase.replace(/\/+$/, '');
  }

  return resolveDefaultLiveApiBase(profile);
}

export function getJwt(config, profileName) {
  const env = process.env.NOTIS_JWT;
  if (env) {
    return env;
  }
  const profile = getProfile(config, profileName);
  return profile.jwt;
}

export function isAgentMode(globalOptions = {}) {
  return process.env.NOTIS_AGENT === '1' || Boolean(globalOptions.agentMode);
}

export function isNonInteractive(globalOptions = {}) {
  if (process.env.NOTIS_NON_INTERACTIVE === '1') {
    return true;
  }
  if (globalOptions.nonInteractive) {
    return true;
  }
  return isAgentMode(globalOptions);
}

export function resolveOutputMode(globalOptions = {}) {
  if (globalOptions.json) {
    return 'json';
  }
  if (globalOptions.output) {
    return globalOptions.output;
  }
  if (process.env.NOTIS_OUTPUT) {
    return process.env.NOTIS_OUTPUT;
  }
  return !process.stdout.isTTY || isAgentMode(globalOptions) ? 'json' : 'table';
}

export function resolveTimeoutMs(globalOptions = {}) {
  const raw = globalOptions.timeoutMs || process.env.NOTIS_TIMEOUT_MS;
  if (!raw) {
    return 30000;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

export function parseDebugEntitlementOverride(value = process.env.NOTIS_DEBUG_ENTITLEMENT_OVERRIDE) {
  if (!value) {
    return null;
  }
  const candidates = [value];
  try {
    candidates.push(Buffer.from(value, 'base64url').toString('utf-8'));
  } catch {
    // The plain JSON candidate below will provide the actionable error.
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next supported encoding.
    }
  }
  throw new CliError({
    code: 'debug_entitlement_override_invalid',
    message: 'NOTIS_DEBUG_ENTITLEMENT_OVERRIDE must be a JSON object or base64url-encoded JSON object.',
    exitCode: EXIT_CODES.usage,
  });
}

export function getOAuthResource(profile = {}) {
  if (typeof profile.oauth_resource === 'string' && profile.oauth_resource) {
    return profile.oauth_resource.replace(/\/+$/, '');
  }
  if (typeof profile.oauth_access_token === 'string' && profile.oauth_access_token) {
    try {
      const parts = profile.oauth_access_token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (typeof payload.aud === 'string' && payload.aud) {
          return payload.aud.replace(/\/+$/, '');
        }
      }
    } catch {
      // Legacy tokens without a readable audience fall back below.
    }
  }
  return null;
}

export function getOAuthApiBase(profile = {}) {
  if (typeof profile.oauth_api_base === 'string' && profile.oauth_api_base) {
    return profile.oauth_api_base.replace(/\/+$/, '');
  }
  const resource = getOAuthResource(profile);
  if (resource?.endsWith('/cli')) {
    return resource.slice(0, -'/cli'.length);
  }
  return null;
}

export function resolveRuntimeProfile(
  globalOptions = {},
  { requireAuth = true, includeDebugEntitlementOverride = true } = {},
) {
  const worktreeRuntime = resolveWorktreeRuntime();
  const config = loadConfig(worktreeRuntime);
  const profileName = getCurrentProfileName(config, globalOptions.profile);
  const requestedApiBase = globalOptions.apiBase;
  if (
    worktreeRuntime &&
    requestedApiBase &&
    requestedApiBase.replace(/\/+$/, '') !== worktreeRuntime.api_base
  ) {
    throw new CliError({
      code: 'dev_runtime_route_mismatch',
      message: `This local-only worktree cannot route to ${requestedApiBase}`,
      exitCode: EXIT_CODES.usage,
      hints: [{ message: `Expected local API: ${worktreeRuntime.api_base}` }],
    });
  }
  let apiBase = worktreeRuntime
    ? worktreeRuntime.api_base
    : getApiBase(config, profileName, globalOptions.apiBase);
  const profile = getProfile(config, profileName);
  const envJwt = !worktreeRuntime ? process.env.NOTIS_JWT : undefined;
  const desktopJwt = profile.jwt;
  const oauthJwt = profile.oauth_access_token;
  let jwt;
  let credentialKind;

  if (worktreeRuntime && desktopJwt) {
    jwt = desktopJwt;
    credentialKind = 'worktree';
  } else if (envJwt) {
    jwt = envJwt;
    credentialKind = 'env';
  } else if (
    desktopJwt
    && !credentialIsExpired({ credentialKind: 'desktop', jwt: desktopJwt }, profile)
  ) {
    jwt = desktopJwt;
    credentialKind = 'desktop';
  } else if (
    oauthJwt
    && !credentialIsExpired({ credentialKind: 'oauth', jwt: oauthJwt }, profile)
  ) {
    jwt = oauthJwt;
    credentialKind = 'oauth';
  } else if (oauthJwt && profile.oauth_refresh_token) {
    // A lapsed OAuth access token remains usable through its rotating refresh
    // token and must outrank an abandoned, expired Desktop credential.
    jwt = oauthJwt;
    credentialKind = 'oauth';
  } else if (desktopJwt) {
    jwt = desktopJwt;
    credentialKind = 'desktop';
  } else if (oauthJwt) {
    // Preserve the OAuth credential so transport can refresh it before use.
    jwt = oauthJwt;
    credentialKind = 'oauth';
  }
  const oauthApiBase = getOAuthApiBase(profile);
  const oauthResource = getOAuthResource(profile);
  const normalizedRequestedApiBase = requestedApiBase
    ? requestedApiBase.replace(/\/+$/, '')
    : null;
  if (
    requireAuth
    && credentialKind === 'oauth'
    && normalizedRequestedApiBase
    && oauthApiBase
    && normalizedRequestedApiBase !== oauthApiBase
  ) {
    const quoteShellArgument = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
    throw new CliError({
      code: 'oauth_api_target_mismatch',
      message: (
        `The OAuth credential for profile ${profileName} belongs to ${oauthApiBase}, `
        + `not ${normalizedRequestedApiBase}`
      ),
      exitCode: EXIT_CODES.auth,
      hints: [{
        command: [
          'npx --package @notis_ai/cli@latest -- notis',
          `--profile ${quoteShellArgument(profileName)}`,
          `--api-base ${quoteShellArgument(normalizedRequestedApiBase)}`,
          'login --force',
        ].join(' '),
        reason: 'Authorize a separate OAuth grant for the requested Notis environment',
      }],
    });
  }
  if (credentialKind === 'oauth' && oauthApiBase && !requestedApiBase) {
    apiBase = oauthApiBase;
  }
  const agentMode = isAgentMode(globalOptions);
  const nonInteractive = isNonInteractive(globalOptions);
  const outputMode = resolveOutputMode(globalOptions);
  const timeoutMs = resolveTimeoutMs(globalOptions);
  const debugEntitlementOverride = includeDebugEntitlementOverride
    ? parseDebugEntitlementOverride()
    : null;

  if (requireAuth && !jwt) {
    const recovery = getDesktopAuthRecovery(
      {
        apiBase,
        desktopAppName: profile.desktop_app_name,
        desktopPid: profile.desktop_pid,
      },
      { mode: 'missing' },
    );
    throw new CliError({
      code: 'auth_missing',
      message: `No JWT configured for profile ${profileName}`,
      exitCode: EXIT_CODES.auth,
      hints: recovery.hints,
    });
  }
  if (
    worktreeRuntime?.expected_user_id &&
    (
      credentialKind === 'oauth'
        ? profile.oauth_user_id
        : getJwtSubject(jwt)
    ) !== worktreeRuntime.expected_user_id
  ) {
    throw new CliError({
      code: 'dev_runtime_identity_mismatch',
      message: 'The scoped dev credential does not belong to this worktree test user',
      exitCode: EXIT_CODES.auth,
      hints: [
        { message: 'Restart ./dev.sh to restore the approved worktree identity.' },
        { message: `Expected user: ${worktreeRuntime.expected_user_id}` },
      ],
    });
  }

  // An explicit NOTIS_JWT is a complete credential override. Use it verbatim
  // and never replace it with a token later synced by the desktop profile.
  const usingEnvJwt = credentialKind === 'env';
  return {
    config,
    profileName,
    apiBase,
    requestedApiBase: normalizedRequestedApiBase,
    jwt,
    credentialKind,
    credentialSource: credentialKind === 'desktop' ? 'profile' : credentialKind,
    oauthAccessToken: profile.oauth_access_token,
    oauthRefreshToken: profile.oauth_refresh_token,
    oauthAccessExpiresAt: profile.oauth_access_expires_at,
    oauthRefreshExpiresAt: profile.oauth_refresh_expires_at,
    oauthClientId: profile.oauth_client_id,
    oauthIssuer: profile.oauth_issuer,
    oauthApiBase,
    oauthResource,
    oauthScopes: profile.oauth_scopes || [],
    oauthUserId: profile.oauth_user_id,
    desktopAppName: usingEnvJwt ? undefined : profile.desktop_app_name,
    desktopPid: usingEnvJwt ? undefined : profile.desktop_pid,
    agentMode,
    nonInteractive,
    outputMode,
    timeoutMs,
    debugEntitlementOverride,
    worktreeRuntime,
  };
}

export function getJwtExpiration(jwt) {
  if (typeof jwt !== 'string' || !jwt) {
    return null;
  }
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function getJwtSubject(jwt) {
  if (typeof jwt !== 'string' || !jwt) {
    return null;
  }
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function getJwtCanonicalUserId(jwt) {
  if (typeof jwt !== 'string' || !jwt) {
    return null;
  }
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const candidate = payload?.app_metadata?.app_user_id
      || payload?.user_metadata?.notis_user_id
      || payload?.notis_user_id;
    return typeof candidate === 'string' && candidate ? candidate : null;
  } catch {
    return null;
  }
}

export function isJwtExpired(jwt, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiration = getJwtExpiration(jwt);
  return expiration !== null && expiration <= nowSeconds;
}

export function credentialIsExpired(
  runtime,
  profile = {},
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  // Older callers and focused transport tests predate `credentialKind`.
  // Infer only the legacy desktop/env shapes; OAuth must always opt in
  // explicitly so a scoped token can never be mistaken for a Supabase JWT.
  const credentialKind = runtime?.credentialKind
    || (runtime?.credentialSource === 'env' ? 'env' : 'desktop');
  switch (credentialKind) {
    case 'oauth': {
      const expiration = Number(profile.oauth_access_expires_at);
      return !Number.isFinite(expiration) || expiration <= nowSeconds;
    }
    case 'env':
      // NOTIS_JWT is a complete override. Never combine it with expiry
      // metadata left behind by a desktop credential in the same profile.
      // A token with no readable `exp` is a personal API key, which never
      // expires, so let the server rather than the CLI reject it.
      {
        const expiration = getJwtExpiration(runtime?.jwt);
        return expiration !== null && expiration <= nowSeconds;
      }
    case 'worktree':
    case 'desktop': {
      const rawExpiration = profile.access_expires_at ?? getJwtExpiration(runtime?.jwt);
      // Every selected credential must carry an independently verifiable
      // expiry. Missing or malformed expiry metadata fails closed.
      if (rawExpiration === null || rawExpiration === undefined || rawExpiration === '') {
        return true;
      }
      const expiration = Number(rawExpiration);
      return !Number.isFinite(expiration) || expiration <= nowSeconds;
    }
    default:
      return true;
  }
}

export function workspacePath(appId) {
  return join(WORKSPACE_DIR, appId);
}
