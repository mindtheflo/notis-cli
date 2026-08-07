import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const CONFIG_DIR = join(homedir(), '.notis');
const BIN_DIR = join(CONFIG_DIR, 'bin');
const DEFAULT_CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const WRAPPER_PATH = join(BIN_DIR, 'notis');
const DEFAULT_PROFILE = 'default';
const BUNDLED_SKILL_NAMES = ['notis-cli', 'notis-apps'] as const;
const AGENTS_DIR = join(homedir(), '.agents');
const DESKTOP_SKILL_ROOTS = [
  join(AGENTS_DIR, 'skills'),
  join(homedir(), '.codex', 'skills'),
  join(homedir(), '.cursor', 'skills'),
  join(homedir(), '.claude', 'skills'),
];

type ProfileConfig = {
  jwt?: string;
  api_base?: string;
  beta?: boolean;
  auth_mode?: 'dev_portal';
  refresh_token?: string;
  access_expires_at?: number;
  refresh_expires_at?: number;
  desktop_app_name?: string;
  desktop_pid?: number;
  oauth_access_token?: string;
  oauth_refresh_token?: string;
  oauth_access_expires_at?: number;
  oauth_refresh_expires_at?: number;
  oauth_client_id?: string;
  oauth_issuer?: string;
  oauth_api_base?: string;
  oauth_resource?: string;
  oauth_scopes?: string[];
  oauth_user_id?: string;
};

type NotisConfig = {
  current_profile: string;
  profiles: Record<string, ProfileConfig>;
};

// Cross-process write lock over ~/.notis/config.json, shared with the npx CLI's
// withConfigWriteLock in packages/cli/src/runtime/profiles.js. The two runtimes
// are separate packages and coordinate only through the lock directory on disk,
// so the `${configFile}.write-lock` name and these three timings must stay
// identical on both sides. Guarded by packages/cli/test/runtime-auth.test.js.
const CONFIG_WRITE_LOCK_TIMEOUT_MS = 5_000;
const CONFIG_WRITE_LOCK_STALE_MS = 2_000;
const CONFIG_WRITE_LOCK_POLL_MS = 10;

export type StoredCliAuth = {
  jwt: string;
  authMode?: 'dev_portal';
  refreshToken?: string;
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function betaFlagForApiBase(apiBase: string | undefined): boolean | undefined {
  if (!apiBase) {
    return undefined;
  }
  try {
    const hostname = new URL(apiBase).hostname.toLowerCase();
    if (hostname === 'api-beta.notis.ai') {
      return true;
    }
    if (hostname === 'api.notis.ai') {
      return false;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function getConfigFile(): string {
  const configured = process.env.NOTIS_CLI_CONFIG_FILE?.trim();
  return configured ? resolve(configured) : DEFAULT_CONFIG_FILE;
}

function normalizeConfig(rawConfig: unknown = {}): NotisConfig {
  const raw =
    rawConfig && typeof rawConfig === 'object' ? clone(rawConfig as Record<string, unknown>) : {};

  if (raw.profiles && typeof raw.profiles === 'object') {
    const profiles: Record<string, ProfileConfig> = {};

    for (const [name, profile] of Object.entries(raw.profiles as Record<string, unknown>)) {
      if (!profile || typeof profile !== 'object') {
        continue;
      }

      const typedProfile = profile as Record<string, unknown>;
      profiles[name] = {
        jwt: typeof typedProfile.jwt === 'string' ? typedProfile.jwt : undefined,
        api_base:
          typeof typedProfile.api_base === 'string' ? typedProfile.api_base : undefined,
        beta: typeof typedProfile.beta === 'boolean' ? typedProfile.beta : undefined,
        auth_mode: typedProfile.auth_mode === 'dev_portal' ? typedProfile.auth_mode : undefined,
        refresh_token:
          typeof typedProfile.refresh_token === 'string' ? typedProfile.refresh_token : undefined,
        access_expires_at:
          typeof typedProfile.access_expires_at === 'number' ? typedProfile.access_expires_at : undefined,
        refresh_expires_at:
          typeof typedProfile.refresh_expires_at === 'number' ? typedProfile.refresh_expires_at : undefined,
        desktop_app_name:
          typeof typedProfile.desktop_app_name === 'string' ? typedProfile.desktop_app_name : undefined,
        desktop_pid:
          typeof typedProfile.desktop_pid === 'number' ? typedProfile.desktop_pid : undefined,
        oauth_access_token:
          typeof typedProfile.oauth_access_token === 'string'
            ? typedProfile.oauth_access_token
            : undefined,
        oauth_refresh_token:
          typeof typedProfile.oauth_refresh_token === 'string'
            ? typedProfile.oauth_refresh_token
            : undefined,
        oauth_access_expires_at:
          typeof typedProfile.oauth_access_expires_at === 'number'
            ? typedProfile.oauth_access_expires_at
            : undefined,
        oauth_refresh_expires_at:
          typeof typedProfile.oauth_refresh_expires_at === 'number'
            ? typedProfile.oauth_refresh_expires_at
            : undefined,
        oauth_client_id:
          typeof typedProfile.oauth_client_id === 'string'
            ? typedProfile.oauth_client_id
            : undefined,
        oauth_issuer:
          typeof typedProfile.oauth_issuer === 'string'
            ? typedProfile.oauth_issuer
            : undefined,
        oauth_api_base:
          typeof typedProfile.oauth_api_base === 'string'
            ? typedProfile.oauth_api_base
            : undefined,
        oauth_resource:
          typeof typedProfile.oauth_resource === 'string'
            ? typedProfile.oauth_resource
            : undefined,
        oauth_scopes:
          Array.isArray(typedProfile.oauth_scopes)
            ? typedProfile.oauth_scopes.filter(
                (scope): scope is string => typeof scope === 'string',
              )
            : undefined,
        oauth_user_id:
          typeof typedProfile.oauth_user_id === 'string'
            ? typedProfile.oauth_user_id
            : undefined,
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
          typeof raw.oauth_access_expires_at === 'number'
            ? raw.oauth_access_expires_at
            : undefined,
        oauth_refresh_expires_at:
          typeof raw.oauth_refresh_expires_at === 'number'
            ? raw.oauth_refresh_expires_at
            : undefined,
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
            ? raw.oauth_scopes.filter((scope): scope is string => typeof scope === 'string')
            : undefined,
        oauth_user_id:
          typeof raw.oauth_user_id === 'string' ? raw.oauth_user_id : undefined,
      },
    },
  };
}

function loadConfig(): NotisConfig {
  const configFile = getConfigFile();
  if (!existsSync(configFile)) {
    return normalizeConfig({});
  }

  try {
    return normalizeConfig(JSON.parse(readFileSync(configFile, 'utf8')));
  } catch {
    return normalizeConfig({});
  }
}

function writeConfig(configFile: string, config: NotisConfig): void {
  const temporaryFile = `${configFile}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryFile, JSON.stringify(normalizeConfig(config), null, 2), { mode: 0o600 });
    renameSync(temporaryFile, configFile);
  } catch (error) {
    try {
      unlinkSync(temporaryFile);
    } catch {
      // Nothing to clean up when the temporary file was never created.
    }
    throw error;
  }
}

// The lock records who holds it and when they took it. Reclaiming by mtime
// alone cannot tell an abandoned lock from one being stolen from a live
// writer, and the victim's own release would then delete the thief's lock.
function readLockOwner(lockDirectory: string): { id?: string; at?: number } | null {
  try {
    return JSON.parse(readFileSync(join(lockDirectory, 'owner'), 'utf-8'));
  } catch {
    return null;
  }
}

function lockDirectoryMtime(lockDirectory: string): number | null {
  try {
    return statSync(lockDirectory).mtimeMs;
  } catch {
    return null;
  }
}

function publishConfigWriteLock(lockDirectory: string, ownerId: string): boolean {
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

async function updateConfig(
  updater: (config: NotisConfig) => NotisConfig,
): Promise<NotisConfig> {
  const configFile = getConfigFile();
  const lockDirectory = `${configFile}.write-lock`;
  const ownerId = `${process.pid}.${randomUUID()}`;
  const deadline = Date.now() + CONFIG_WRITE_LOCK_TIMEOUT_MS;
  mkdirSync(dirname(configFile), { recursive: true, mode: 0o700 });
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
        // Losing the reclaim race is normal; keep waiting.
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting to update ${configFile}`);
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG_WRITE_LOCK_POLL_MS));
  }
  try {
    const next = normalizeConfig(updater(loadConfig()));
    writeConfig(configFile, next);
    return next;
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

export function loadStoredCliAuth(): StoredCliAuth | null {
  const config = loadConfig();
  const currentProfile = config.profiles[config.current_profile];
  const defaultProfile = config.profiles[DEFAULT_PROFILE];
  const profile = currentProfile?.jwt?.trim() ? currentProfile : defaultProfile;
  if (!profile?.jwt?.trim()) {
    return null;
  }

  return {
    jwt: profile.jwt.trim(),
    authMode: profile.auth_mode,
    refreshToken: profile.refresh_token,
    accessExpiresAt: profile.access_expires_at,
    refreshExpiresAt: profile.refresh_expires_at,
  };
}

export function resolveLegacyCliRoot(): string {
  if (app.isPackaged && !process.env.ELECTRON_DEV_URL) {
    return join(process.resourcesPath, 'cli');
  }

  const candidates = [
    join(__dirname, '..', '..', '..', 'packages', 'cli'),
    join(__dirname, '..', '..', '..', 'cli', 'npm'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'bin', 'notis.js'))) || candidates[0];
}

function removeLegacyCliPackageSkillSymlinks(cliRoot: string): number {
  const cliPackageSkillsRoot = resolve(cliRoot, 'skills');
  let removed = 0;

  for (const skillDir of DESKTOP_SKILL_ROOTS) {
    let entries: string[];
    try {
      entries = readdirSync(skillDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const linkPath = join(skillDir, entry);
      try {
        const stat = lstatSync(linkPath);
        if (!stat.isSymbolicLink()) {
          continue;
        }
        const currentTarget = resolve(skillDir, readlinkSync(linkPath));
        if (isLegacyCliPackageSkillTarget(entry, currentTarget, cliPackageSkillsRoot)) {
          unlinkSync(linkPath);
          removed += 1;
        }
      } catch {
        // Missing or unreadable paths are safe to ignore during cleanup.
      }
    }
  }

  return removed;
}

function isLegacyCliPackageSkillTarget(
  skillName: string,
  currentTarget: string,
  cliPackageSkillsRoot: string,
): boolean {
  if (!BUNDLED_SKILL_NAMES.includes(skillName as (typeof BUNDLED_SKILL_NAMES)[number])) {
    return false;
  }

  const expectedTarget = join(cliPackageSkillsRoot, skillName);
  if (currentTarget === expectedTarget) {
    return true;
  }

  const normalizedTarget = currentTarget.replace(/\\/g, '/');
  return (
    normalizedTarget.endsWith(`/packages/cli/skills/${skillName}`) ||
    normalizedTarget.endsWith(`/cli/npm/skills/${skillName}`) ||
    normalizedTarget.endsWith(`/cli/skills/${skillName}`)
  );
}

function isLegacyManagedWrapper(wrapper: string, cliEntry: string): boolean {
  if (!wrapper.includes('ELECTRON_RUN_AS_NODE=1')) {
    return false;
  }

  return (
    wrapper.includes(cliEntry) ||
    /(?:packages\/cli|cli\/npm|Resources\/cli)\/bin\/notis\.js/.test(wrapper)
  );
}

function removeManagedWrapper(cliRoot: string): void {
  try {
    const wrapper = readFileSync(WRAPPER_PATH, 'utf8');
    const cliEntry = join(cliRoot, 'bin', 'notis.js');
    if (isLegacyManagedWrapper(wrapper, cliEntry)) {
      unlinkSync(WRAPPER_PATH);
    }
  } catch {
    // Missing wrapper is expected for non-entitled users.
  }
}

export async function cleanupLegacyCliArtifacts(): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  if (getConfigFile() !== DEFAULT_CONFIG_FILE) {
    console.log('[Notis CLI] Skipped global CLI cleanup for scoped dev config');
    return;
  }

  const cliRoot = resolveLegacyCliRoot();
  const removedSkills = removeLegacyCliPackageSkillSymlinks(cliRoot);
  removeManagedWrapper(cliRoot);
  console.log(
    `[Notis CLI] Removed managed CLI wrapper and ${removedSkills} legacy CLI-package skill symlink(s)`,
  );
}

export async function prepareCliAuthConfig(options?: { apiBase?: string }): Promise<void> {
  if (process.platform === 'win32') {
    console.log('[Notis CLI] CLI config preparation is not yet supported on Windows');
    return;
  }

  const cliRoot = resolveLegacyCliRoot();
  const scopedDevConfig = getConfigFile() !== DEFAULT_CONFIG_FILE;
  const removedSkills = scopedDevConfig ? 0 : removeLegacyCliPackageSkillSymlinks(cliRoot);
  if (!scopedDevConfig) {
    removeManagedWrapper(cliRoot);
  }
  if (removedSkills > 0) {
    console.log(
      `[Notis CLI] Removed ${removedSkills} legacy CLI-package skill symlink(s); skills now sync from the signed-in user's cloud skills`,
    );
  }
  // Pre-configure the API base so NPX CLI points at the Desktop channel's
  // backend (live prod/beta, or the worktree loopback lease in local-only
  // checkouts). Localhost is never a silent default outside that lease.
  if (options?.apiBase) {
    await updateConfig((nextConfig) => {
      nextConfig.profiles[DEFAULT_PROFILE] = {
        ...nextConfig.profiles[DEFAULT_PROFILE],
        api_base: options.apiBase,
        beta: betaFlagForApiBase(options.apiBase),
      };
      return nextConfig;
    });
    console.log(`[Notis CLI] Pre-configured API base: ${options.apiBase}`);
  }
}

export async function syncAuth(
  auth: {
    jwt: string;
    authMode?: 'dev_portal';
    refreshToken?: string;
    accessExpiresAt?: number;
    refreshExpiresAt?: number;
  },
  apiBase: string,
  desktop?: { appName: string; pid: number },
): Promise<void> {
  await updateConfig((nextConfig) => {
    nextConfig.current_profile = DEFAULT_PROFILE;
    const currentProfile = nextConfig.profiles[DEFAULT_PROFILE] || {};
    nextConfig.profiles[DEFAULT_PROFILE] = {
      ...currentProfile,
      jwt: auth.jwt,
      api_base: apiBase,
      // Mirror users.beta for the CLI default resolver: beta Desktop /
      // api-beta.notis.ai → true, production api.notis.ai → false. Loopback
      // worktree leases leave the prior flag alone (undefined here).
      beta: betaFlagForApiBase(apiBase) ?? currentProfile.beta,
      // The renderer owns Supabase refresh-token rotation. Never persist the
      // rotating credential into the CLI-readable profile.
      auth_mode: undefined,
      refresh_token: undefined,
      access_expires_at: auth.accessExpiresAt ?? currentProfile.access_expires_at,
      refresh_expires_at: undefined,
      desktop_app_name: desktop?.appName ?? currentProfile.desktop_app_name,
      desktop_pid: desktop?.pid ?? currentProfile.desktop_pid,
    };
    return nextConfig;
  });
  console.log('[Notis CLI] Synced CLI auth');
}

export async function clearAuth(): Promise<void> {
  await updateConfig((nextConfig) => {
    const defaultProfile = nextConfig.profiles[DEFAULT_PROFILE] || {};
    nextConfig.profiles[DEFAULT_PROFILE] = {
      ...defaultProfile,
      jwt: undefined,
      auth_mode: undefined,
      refresh_token: undefined,
      access_expires_at: undefined,
      refresh_expires_at: undefined,
      desktop_app_name: undefined,
      desktop_pid: undefined,
    };
    return nextConfig;
  });
  console.log('[Notis CLI] Cleared CLI auth');
}
