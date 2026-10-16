import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getCurrentProfileName, getProfile, loadConfig, resolveRuntimeProfile } from './runtime/profiles.js';
import { ensureFreshOAuthCredential } from './runtime/oauth.js';
import { runSkillSync, fetchSyncSettings } from '../dist/skill-sync/index.js';
import { withSkillSyncLock } from './runtime/sync-skills.js';

// The server rejected the stored sign-in itself. Presenting it again can only
// fail the same way, so the worker waits for the sign-in to change instead of
// asking every minute (docs/no-dead-ends.md).
const REJECTED_SIGN_IN_CODES = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

function currentCliProfile() {
  try {
    return getCurrentProfileName(loadConfig());
  } catch {
    return null;
  }
}

/**
 * A fingerprint of the profile's stored sign-in that changes whenever it is
 * renewed or replaced, by any process, and holds no credential.
 */
export function signInFingerprint(profileName, config = loadConfig()) {
  const profile = getProfile(config, profileName);
  if (!profile.oauth_client_id && !profile.oauth_access_expires_at) return null;
  return createHash('sha256').update(JSON.stringify([
    profile.oauth_issuer ?? null,
    profile.oauth_client_id ?? null,
    profile.oauth_user_id ?? null,
    profile.oauth_access_expires_at ?? null,
    profile.oauth_refresh_expires_at ?? null,
  ])).digest('hex').slice(0, 16);
}

export async function runAutomaticSkillSync({ profile, apiBase, userId }, {
  resolveRuntime = resolveRuntimeProfile, refresh = ensureFreshOAuthCredential,
  settings = fetchSyncSettings, sync = runSkillSync, lock = withSkillSyncLock,
  currentProfile = currentCliProfile,
} = {}) {
  const runtime = resolveRuntime({ profile }, { requireAuth: true });
  if (runtime.credentialKind !== 'oauth' || runtime.apiBase !== apiBase
    || runtime.oauthUserId !== userId) throw new Error('Automatic skill sync account changed; run notis skills sync to rebind');
  await refresh(runtime);
  const saved = await settings(runtime.apiBase, runtime.jwt);
  if (saved.user_id !== userId) throw new Error('Automatic skill sync identity mismatch');
  // Do not gather, unlink foreign accounts or write anything when opted out.
  if (!saved.sync_enabled) return { status: 'disabled' };
  // The service stays bound to its profile; after `notis profile use` moves the
  // default away, it keeps that account's folder in sync without linking it.
  const linkAgentFolders = (currentProfile() ?? profile) === profile;
  const result = await lock(() => sync(runtime.apiBase, runtime.jwt, {
    fetchSyncSettings: async () => saved,
  }, { honorSyncEnabled: true, ...(linkAgentFolders ? {} : { linkAgentFolders: false }) }));
  return { status: (result.failedLinks?.length || result.failedPushes?.length) ? 'partial' : 'synced', ...result };
}

function readStatus(target) {
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

export async function main(args = process.argv.slice(2), {
  home = homedir(), run = runAutomaticSkillSync, fingerprint = signInFingerprint,
  deadlineMs = 240_000,
} = {}) {
  const [profile, apiBase, userId] = args;
  const root = join(home, '.notis', 'skills', 'service');
  const target = join(root, 'status.json');
  const record = (value) => {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...value, profile, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
    renameSync(temporary, target);
  };
  let signIn = null;
  try {
    signIn = fingerprint(profile);
  } catch {
    signIn = null;
  }
  const previous = readStatus(target);
  if (
    signIn
    && previous?.status === 'error'
    && previous.profile === profile
    && REJECTED_SIGN_IN_CODES.has(previous.code)
    && previous.sign_in === signIn
  ) {
    // Same rejected sign-in: wait for `notis login`, or for any process to
    // renew it, before presenting it again.
    return;
  }
  const deadline = setTimeout(() => {
    record({ status: 'error', code: 'sync_timeout' });
    process.exit(1);
  }, deadlineMs);
  try {
    record(await run({ profile, apiBase, userId }));
  } catch (error) {
    // Persist only a classified error, never a bearer, signed URL or response body.
    const code = error.code || 'sync_failed';
    record({ status: 'error', code, ...(REJECTED_SIGN_IN_CODES.has(code) && signIn ? { sign_in: signIn } : {}) });
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}
