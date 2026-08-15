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
import { getAuthRecovery, quoteShellArgument } from './auth-recovery.js';
import { channelFromProfile, cliCommandForChannel, isReleaseChannel } from './channel.js';

export const CONFIG_DIR = join(homedir(), '.notis');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const WORKSPACE_DIR = join(CONFIG_DIR, 'workspace');
export const DEFAULT_API_BASE = 'https://api.notis.ai';
export const BETA_API_BASE = 'https://api-beta.notis.ai';
export const DEFAULT_PROFILE = 'default';
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LEGACY_DESKTOP_PROFILE_KEYS = [
  'jwt',
  'auth_mode',
  'refresh_token',
  'access_expires_at',
  'refresh_expires_at',
  'desktop_app_name',
  'desktop_pid',
];
const WORKTREE_RUNTIME_FILENAME = join('.context', 'notis-runtime.json');
const WORKTREE_ROUTING_FILENAME = join('.context', 'notis-routing.json');
const LOCAL_API_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LIVE_API_HOSTS = new Set(['api.notis.ai', 'api-beta.notis.ai']);
// Cross-process write lock over ~/.notis/config.json. Independent `notis`
// processes (a `login` in one terminal and a `tools exec` in another) all
// rewrite this file, so the lock directory name and these three timings are the
// whole coordination protocol. Guarded by the concurrency test in
// packages/cli/test/runtime-auth.test.js.
const CONFIG_WRITE_LOCK_TIMEOUT_MS = 5_000;
const CONFIG_WRITE_LOCK_STALE_MS = 2_000;
const CONFIG_WRITE_LOCK_POLL_MS = 10;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isValidProfileName(profileName) {
  return typeof profileName === 'string'
    && PROFILE_NAME_PATTERN.test(profileName)
    && !Object.hasOwn(Object.prototype, profileName);
}

function isSafeStoredProfileName(profileName) {
  return typeof profileName === 'string'
    && profileName.length > 0
    && !Object.hasOwn(Object.prototype, profileName);
}

export function profileExists(config, profileName) {
  const normalized = normalizeConfig(config);
  return isSafeStoredProfileName(profileName)
    && Object.hasOwn(normalized.profiles, profileName);
}

function assertValidProfileName(profileName) {
  if (isValidProfileName(profileName)) {
    return;
  }
  throw new CliError({
    code: 'profile_name_invalid',
    message: 'CLI profile names must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens (maximum 64 characters)',
    exitCode: EXIT_CODES.usage,
    hints: [
      { command: 'notis profile list', reason: 'See the valid profiles already on this machine' },
    ],
  });
}

/**
 * A profile is one account paired with one API endpoint.
 *
 * Only two credential shapes survive normalization: the browser-authorized
 * OAuth grant (`oauth_*`) that owns every real account, and the loopback
 * credential `./dev.sh` mints for its worktree test user (`dev_*`). Notis
 * Desktop used to write a Supabase access token here as `jwt`, plus the
 * `desktop_*` liveness hints the CLI used to tell people which app to reopen.
 * Dropping those keys on read is what actually retires that path: a config
 * left behind by an older Desktop build cannot silently keep authenticating
 * the CLI with a credential nothing renews anymore.
 */
function normalizeProfile(rawProfile = {}) {
  const raw = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  return {
    api_base: typeof raw.api_base === 'string' ? raw.api_base : undefined,
    beta: typeof raw.beta === 'boolean' ? raw.beta : undefined,
    // Which published CLI build this profile runs, as the deployment reported
    // it at login. Unknown values are dropped rather than trusted: this key
    // decides which code executes on the next run.
    channel: isReleaseChannel(raw.channel) ? raw.channel : undefined,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    dev_access_token:
      typeof raw.dev_access_token === 'string' ? raw.dev_access_token : undefined,
    dev_access_expires_at:
      typeof raw.dev_access_expires_at === 'number' ? raw.dev_access_expires_at : undefined,
    dev_user_id: typeof raw.dev_user_id === 'string' ? raw.dev_user_id : undefined,
    dev_workspace_root:
      typeof raw.dev_workspace_root === 'string' ? raw.dev_workspace_root : undefined,
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
    oauth_issuer: typeof raw.oauth_issuer === 'string' ? raw.oauth_issuer : undefined,
    oauth_api_base: typeof raw.oauth_api_base === 'string' ? raw.oauth_api_base : undefined,
    oauth_resource: typeof raw.oauth_resource === 'string' ? raw.oauth_resource : undefined,
    oauth_scopes:
      Array.isArray(raw.oauth_scopes)
        ? raw.oauth_scopes.filter((scope) => typeof scope === 'string')
        : undefined,
    oauth_user_id: typeof raw.oauth_user_id === 'string' ? raw.oauth_user_id : undefined,
  };
}

export function normalizeConfig(rawConfig = {}) {
  const raw = rawConfig && typeof rawConfig === 'object' ? clone(rawConfig) : {};

  if (raw.profiles && typeof raw.profiles === 'object') {
    const profiles = {};
    for (const [name, profile] of Object.entries(raw.profiles)) {
      // Older CLI releases accepted arbitrary profile names. Keep every safe
      // own-property name readable; the stricter grammar applies only when a
      // command creates a new profile.
      if (!isSafeStoredProfileName(name) || !profile || typeof profile !== 'object') {
        continue;
      }
      profiles[name] = normalizeProfile(profile);
    }

    if (!Object.hasOwn(profiles, DEFAULT_PROFILE)) {
      profiles[DEFAULT_PROFILE] = {};
    }

    return {
      current_profile:
        typeof raw.current_profile === 'string'
        && Object.hasOwn(profiles, raw.current_profile)
          ? raw.current_profile
          : DEFAULT_PROFILE,
      profiles,
    };
  }

  return {
    current_profile: DEFAULT_PROFILE,
    profiles: { [DEFAULT_PROFILE]: normalizeProfile(raw) },
  };
}

export function profileHasCredential(profile = {}) {
  return Boolean(profile.oauth_access_token || profile.dev_access_token);
}

/**
 * Names every profile a switch can land on, newest config order preserved.
 * `notis profile use` and `--profile` both validate against this.
 */
export function listProfiles(config) {
  const normalized = normalizeConfig(config);
  return Object.entries(normalized.profiles).map(([name, profile]) => ({
    name,
    active: name === normalized.current_profile,
    // Report the endpoint the profile was created against, including the
    // loopback address of a `./dev.sh` profile. getApiBase resolves a stale
    // loopback value to the live API for routing; showing that here would
    // claim a dev profile targets production, which it must never do.
    // OAuth metadata owns the route for an OAuth profile. An older Desktop
    // release may have left a conflicting api_base behind, but commands ignore
    // that legacy value and so must profile inspection.
    api_base: profile.oauth_access_token
      ? getOAuthApiBase(profile) || resolveDefaultLiveApiBase(profile)
      : profile.api_base || resolveDefaultLiveApiBase(profile),
    label: profile.label || null,
    credential_kind: profile.oauth_access_token
      ? 'oauth'
      : profile.dev_access_token
        ? 'dev'
        : null,
    user_id: profile.oauth_user_id || profile.dev_user_id || null,
    authenticated: profileHasCredential(profile),
  }));
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
      return {
        unavailable: new CliError({
          code: 'dev_runtime_unavailable',
          message: 'This worktree is local-only, but its dev.sh runtime is not active',
          exitCode: EXIT_CODES.network,
          hints: [
            { message: 'Start ./dev.sh in this worktree, then retry the command.' },
            { command: 'notis profile list', reason: 'Run against a live account profile instead' },
            { message: `Routing policy: ${routingPath}` },
          ],
        }),
      };
    }
    return null;
  }

  const runtime = readJsonFile(runtimePath);
  const apiBase = typeof runtime?.api_base === 'string' ? runtime.api_base.replace(/\/+$/, '') : '';
  const profile = typeof runtime?.profile === 'string' ? runtime.profile.trim() : '';
  const devAccessToken =
    typeof runtime?.dev_access_token === 'string' ? runtime.dev_access_token.trim() : '';
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
    !profile ||
    !devAccessToken ||
    !processIsAlive(pid)
  ) {
    // Reported rather than thrown: an unusable lease must not stop someone
    // from listing profiles or switching to a live account from inside the
    // same checkout. resolveRuntimeProfile raises it only when a command is
    // about to route through the dead local backend.
    return {
      unavailable: new CliError({
        code: 'dev_runtime_unavailable',
        message: 'The local-only worktree runtime is stale or invalid',
        exitCode: EXIT_CODES.network,
        hints: [
          { message: 'Restart ./dev.sh in this worktree, then retry the command.' },
          { command: 'notis profile list', reason: 'Run against a live account profile instead' },
          { message: `Runtime lease: ${runtimePath}` },
        ],
      }),
    };
  }

  return {
    ...runtime,
    api_base: apiBase,
    profile,
    dev_access_token: devAccessToken,
    app_dev_sessions_file: resolve(dirname(runtimePath), appDevSessionsFile),
    desktop_deep_link_scheme: desktopDeepLinkScheme || undefined,
    runtime_path: runtimePath,
    routing_path: routingPath,
  };
}

/**
 * Real account profiles live in one shared file. A `./dev.sh` worktree keeps
 * its synthetic profile credential in the worktree-owned runtime lease, so an
 * older CLI process cannot normalize it away while rewriting this file.
 */
export function resolveConfigFile() {
  const envConfigFile = process.env.NOTIS_CLI_CONFIG_FILE;
  if (envConfigFile) {
    return resolve(envConfigFile);
  }
  return CONFIG_FILE;
}

export function loadConfig() {
  const configFile = resolveConfigFile();
  if (!existsSync(configFile)) {
    return normalizeConfig({});
  }

  // Concurrent `notis` processes rewrite this file while others read it, so a
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
  let rawConfig = null;
  try {
    rawConfig = JSON.parse(readFileSync(configFile, 'utf-8'));
  } catch {
    // A missing or corrupt file has no upgrade fields to preserve.
  }
  const normalized = normalizeConfig(config);
  const persisted = clone(normalized);
  const rawProfiles = rawConfig?.profiles && typeof rawConfig.profiles === 'object'
    ? rawConfig.profiles
    : { [DEFAULT_PROFILE]: rawConfig };
  for (const [name, profile] of Object.entries(persisted.profiles)) {
    const rawProfile = Object.hasOwn(rawProfiles || {}, name) ? rawProfiles[name] : null;
    if (!rawProfile || typeof rawProfile !== 'object') continue;
    for (const key of LEGACY_DESKTOP_PROFILE_KEYS) {
      if (Object.hasOwn(rawProfile, key)) {
        profile[key] = rawProfile[key];
      }
    }
  }
  writeRawConfig(configFile, persisted);
}

function writeRawConfig(configFile, config) {
  mkdirSync(dirname(configFile), { recursive: true });
  const temporaryFile = `${configFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(config, null, 2), { mode: 0o600 });
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

function withConfigWriteLock(callback) {
  const configFile = resolveConfigFile();
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

export function saveConfig(config) {
  return withConfigWriteLock((configFile) => {
    writeConfig(configFile, config);
  });
}

export function updateConfig(updater) {
  return withConfigWriteLock((configFile) => {
    const current = loadConfig();
    const updated = updater(normalizeConfig(current));
    const next = normalizeConfig(updated ?? current);
    writeConfig(configFile, next);
    return next;
  });
}

/**
 * Remove only worktree-owned profiles without normalizing the rest of the
 * shared file. Archive cleanup can run before a packaged Desktop upgrade has
 * migrated its legacy `jwt`; preserving unknown/raw fields here keeps that
 * migrate-then-strip handoff intact.
 */
export function removeOwnedDevProfiles(profileNames, workspaceRoot) {
  return withConfigWriteLock((configFile) => {
    let raw;
    try {
      raw = JSON.parse(readFileSync(configFile, 'utf-8'));
    } catch {
      return [];
    }
    if (!raw || typeof raw !== 'object' || !raw.profiles || typeof raw.profiles !== 'object') {
      return [];
    }

    const removed = [];
    for (const name of profileNames) {
      const profile = Object.hasOwn(raw.profiles, name) ? raw.profiles[name] : null;
      if (
        !profile
        || typeof profile !== 'object'
        || profile.dev_workspace_root !== workspaceRoot
      ) {
        continue;
      }
      delete raw.profiles[name];
      removed.push(name);
      if (raw.current_profile === name) raw.current_profile = DEFAULT_PROFILE;
    }
    if (removed.length > 0) writeRawConfig(configFile, raw);
    return removed;
  });
}

export function getProfile(config, profileName) {
  const normalized = normalizeConfig(config);
  return Object.hasOwn(normalized.profiles, profileName)
    ? normalized.profiles[profileName]
    : {};
}

export function getCurrentProfileName(config, preferredName) {
  const normalized = normalizeConfig(config);
  if (preferredName && Object.hasOwn(normalized.profiles, preferredName)) {
    return preferredName;
  }
  return normalized.current_profile || DEFAULT_PROFILE;
}

/**
 * Resolve which profile this invocation runs as.
 *
 * An explicit `--profile` / `NOTIS_PROFILE` always wins, including inside a
 * `./dev.sh` worktree: naming another account is the documented way to reach
 * production from a checkout whose local backend is wedged. With nothing
 * explicit, a live worktree lease selects its own dev profile, and otherwise
 * the switch persisted by `notis profile use` applies.
 */
export function resolveProfileSelection(
  globalOptions = {},
  worktreeRuntime = null,
  config,
  { allowUnknownProfile = false } = {},
) {
  const normalized = normalizeConfig(config);
  const requested = globalOptions.profile || process.env.NOTIS_PROFILE || '';
  if (requested) {
    const existingProfile = Object.hasOwn(normalized.profiles, requested);
    if (!existingProfile) {
      // Existing profiles may have names accepted by earlier releases. Only a
      // new profile created by login/start must satisfy today's grammar.
      assertValidProfileName(requested);
    }
    if (!existingProfile && !allowUnknownProfile) {
      throw new CliError({
        code: 'profile_unknown',
        message: `No CLI profile named "${requested}"`,
        exitCode: EXIT_CODES.usage,
        details: { known_profiles: Object.keys(normalized.profiles) },
        hints: [
          { command: 'notis profile list', reason: 'See which profiles this machine has' },
          {
            command: `notis login --profile ${quoteShellArgument(requested)}`,
            reason: 'Authorize a new account under this profile name',
          },
        ],
      });
    }
    return { profileName: requested, source: 'explicit' };
  }
  if (worktreeRuntime?.profile) {
    return { profileName: worktreeRuntime.profile, source: 'worktree' };
  }
  return {
    profileName: normalized.current_profile || DEFAULT_PROFILE,
    source: 'current',
  };
}

export function ensureProfile(config, profileName) {
  const normalized = normalizeConfig(config);
  if (!Object.hasOwn(normalized.profiles, profileName)) {
    assertValidProfileName(profileName);
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
 * Beta users (`users.beta = true`, mirrored onto the profile when OAuth
 * authorizes against api-beta) hit api-beta.notis.ai; everyone else hits
 * api.notis.ai. Localhost is never a default — only a `./dev.sh` profile
 * backed by a live worktree lease may retarget the CLI at loopback.
 */
export function resolveDefaultLiveApiBase(profile = {}) {
  if (profile.beta === true) {
    return BETA_API_BASE;
  }
  if (profile.beta === false) {
    return DEFAULT_API_BASE;
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

  // A loopback api_base is only meaningful while the `./dev.sh` that wrote it
  // is still running, and resolveRuntimeProfile checks that lease before it
  // routes anywhere. Here — with no lease in hand — a leftover localhost value
  // resolves to the live API rather than to a port nothing is listening on.
  if (typeof profileApiBase === 'string' && profileApiBase && !isLocalApiBase(profileApiBase)) {
    return profileApiBase.replace(/\/+$/, '');
  }

  return resolveDefaultLiveApiBase(profile);
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
  {
    requireAuth = true,
    includeDebugEntitlementOverride = true,
    allowUnknownProfile = false,
    allowUnavailableWorktree = false,
  } = {},
) {
  const resolvedWorktree = resolveWorktreeRuntime();
  const worktreeUnavailable = resolvedWorktree?.unavailable || null;
  const worktreeRuntime = worktreeUnavailable ? null : resolvedWorktree;
  const config = loadConfig();
  const { profileName, source: profileSource } = resolveProfileSelection(
    globalOptions,
    worktreeRuntime,
    config,
    { allowUnknownProfile },
  );
  // A dead lease is an error for every command that can leave the machine,
  // including unauthenticated health and OAuth calls. Only command specs that
  // are explicitly local may continue inside a stopped worktree.
  if (worktreeUnavailable && !allowUnavailableWorktree && profileSource !== 'explicit') {
    throw worktreeUnavailable;
  }
  // Only the synthetic profile exposed by `./dev.sh` is pinned to its loopback
  // backend.
  // Naming any other profile opts out of the worktree entirely, which is how a
  // developer reaches production from a checkout whose local API is down.
  const devRuntime =
    worktreeRuntime && worktreeRuntime.profile === profileName ? worktreeRuntime : null;
  const requestedApiBase = globalOptions.apiBase;
  if (
    devRuntime &&
    requestedApiBase &&
    requestedApiBase.replace(/\/+$/, '') !== devRuntime.api_base
  ) {
    throw new CliError({
      code: 'dev_runtime_route_mismatch',
      message: `Profile "${profileName}" is bound to this worktree and cannot route to ${requestedApiBase}`,
      exitCode: EXIT_CODES.usage,
      hints: [
        { message: `Expected local API: ${devRuntime.api_base}` },
        { command: 'notis profile list', reason: 'Switch to a profile that targets that API instead' },
      ],
    });
  }
  let apiBase = devRuntime
    ? devRuntime.api_base
    : getApiBase(config, profileName, globalOptions.apiBase);
  const profile = getProfile(config, profileName);
  const envJwt = !devRuntime ? process.env.NOTIS_JWT : undefined;
  const devJwt = devRuntime?.dev_access_token || profile.dev_access_token;
  const oauthJwt = profile.oauth_access_token;
  let jwt;
  let credentialKind;

  // A dev credential is a real Supabase token for the worktree's test user. It
  // is only ever spendable against the loopback backend that minted it, so a
  // profile holding one is unusable without its live lease rather than falling
  // through to the live API and authenticating there as the test user.
  if (requireAuth && !devRuntime && devJwt && !oauthJwt && !process.env.NOTIS_JWT) {
    throw new CliError({
      code: 'dev_runtime_unavailable',
      message: `Profile "${profileName}" is a ./dev.sh profile and its local runtime is not active`,
      exitCode: EXIT_CODES.network,
      details: { workspace_root: profile.dev_workspace_root || null },
      hints: [
        profile.dev_workspace_root
          ? { message: `Start ./dev.sh in ${profile.dev_workspace_root}, then retry.` }
          : { message: 'Start ./dev.sh in the worktree that owns this profile, then retry.' },
        { command: 'notis profile list', reason: 'Switch to a live account profile instead' },
      ],
    });
  }

  if (devRuntime && devJwt) {
    jwt = devJwt;
    credentialKind = 'worktree';
  } else if (envJwt) {
    jwt = envJwt;
    credentialKind = 'env';
  } else if (
    oauthJwt
    && !credentialIsExpired({ credentialKind: 'oauth', jwt: oauthJwt }, profile)
  ) {
    jwt = oauthJwt;
    credentialKind = 'oauth';
  } else if (oauthJwt) {
    // A lapsed access token is still usable through its rotating refresh token,
    // so preserve it and let transport refresh before the first request.
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
    throw new CliError({
      code: 'oauth_api_target_mismatch',
      message: (
        `The OAuth credential for profile ${profileName} belongs to ${oauthApiBase}, `
        + `not ${normalizedRequestedApiBase}`
      ),
      exitCode: EXIT_CODES.auth,
      hints: [{
        command: [
          cliCommandForChannel(channelFromProfile({ api_base: normalizedRequestedApiBase })),
          `--profile ${quoteShellArgument(profileName)}`,
          `--api-base ${quoteShellArgument(normalizedRequestedApiBase)}`,
          'login',
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
    throw new CliError({
      code: 'auth_missing',
      message: `Profile "${profileName}" has no Notis credential`,
      exitCode: EXIT_CODES.auth,
      hints: getAuthRecovery({ profileName, apiBase }, { mode: 'missing' }).hints,
    });
  }
  if (
    devRuntime?.expected_user_id &&
    (
      credentialKind === 'oauth'
        ? profile.oauth_user_id
        : getJwtSubject(jwt)
    ) !== devRuntime.expected_user_id
  ) {
    throw new CliError({
      code: 'dev_runtime_identity_mismatch',
      message: `Profile "${profileName}" no longer holds this worktree's test identity`,
      exitCode: EXIT_CODES.auth,
      hints: [
        { message: 'Restart ./dev.sh to restore the approved worktree identity.' },
        { message: `Expected user: ${devRuntime.expected_user_id}` },
      ],
    });
  }

  return {
    config,
    profileName,
    profileSource,
    profileLabel: profile.label,
    // Which published build serves this profile. Carried on the runtime so
    // every recovery hint prints the command that will actually run.
    channel: devRuntime
      ? null
      : channelFromProfile(
          (globalOptions.apiBase || process.env.NOTIS_API_BASE)
            // An explicit route owns this invocation even when the stored
            // profile is pinned to the opposite release channel.
            ? { api_base: apiBase }
            : { ...profile, api_base: apiBase },
        ),
    apiBase,
    requestedApiBase: normalizedRequestedApiBase,
    jwt,
    credentialKind,
    credentialSource: credentialKind,
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
    agentMode,
    nonInteractive,
    outputMode,
    timeoutMs,
    debugEntitlementOverride,
    worktreeRuntime: devRuntime,
    detachedWorktreeRuntime: devRuntime ? null : worktreeRuntime,
    worktreeRuntimeUnavailable: worktreeUnavailable,
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

export function isJwtExpired(jwt, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiration = getJwtExpiration(jwt);
  return expiration !== null && expiration <= nowSeconds;
}

export function credentialIsExpired(
  runtime,
  profile = {},
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  // A credential with no declared kind is not one this CLI knows how to keep
  // alive, so it fails closed rather than defaulting to a permissive shape.
  const credentialKind = runtime?.credentialKind
    || (runtime?.credentialSource === 'env' ? 'env' : null);
  switch (credentialKind) {
    case 'oauth': {
      const expiration = Number(profile.oauth_access_expires_at);
      return !Number.isFinite(expiration) || expiration <= nowSeconds;
    }
    case 'env':
      // NOTIS_JWT is a complete override. Never combine it with expiry
      // metadata belonging to a different credential in the same profile.
      // A token with no readable `exp` is a personal API key, which never
      // expires, so let the server rather than the CLI reject it.
      {
        const expiration = getJwtExpiration(runtime?.jwt);
        return expiration !== null && expiration <= nowSeconds;
      }
    case 'worktree': {
      const rawExpiration = profile.dev_access_expires_at ?? getJwtExpiration(runtime?.jwt);
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
