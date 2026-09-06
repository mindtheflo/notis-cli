import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimeProfile } from './runtime/profiles.js';
import { ensureFreshOAuthCredential } from './runtime/oauth.js';
import { runSkillSync, fetchSyncSettings } from '../dist/skill-sync/index.js';
import { withSkillSyncLock } from './runtime/sync-skills.js';

export async function runAutomaticSkillSync({ profile, apiBase, userId }, {
  resolveRuntime = resolveRuntimeProfile, refresh = ensureFreshOAuthCredential,
  settings = fetchSyncSettings, sync = runSkillSync, lock = withSkillSyncLock,
} = {}) {
  const runtime = resolveRuntime({ profile }, { requireAuth: true });
  if (runtime.credentialKind !== 'oauth' || runtime.apiBase !== apiBase
    || runtime.oauthUserId !== userId) throw new Error('Automatic skill sync account changed; run notis skills sync to rebind');
  await refresh(runtime);
  const saved = await settings(runtime.apiBase, runtime.jwt);
  if (saved.user_id !== userId) throw new Error('Automatic skill sync identity mismatch');
  // Do not gather, unlink foreign accounts or write anything when opted out.
  if (!saved.sync_enabled) return { status: 'disabled' };
  const result = await lock(() => sync(runtime.apiBase, runtime.jwt, {
    fetchSyncSettings: async () => saved,
  }, { honorSyncEnabled: true }));
  return { status: (result.failedLinks?.length || result.failedPushes?.length) ? 'partial' : 'synced', ...result };
}

export async function main(args = process.argv.slice(2)) {
  const [profile, apiBase, userId] = args;
  const root = join(homedir(), '.notis', 'skills', 'service');
  const record = (value) => {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const target = join(root, 'status.json');
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...value, profile, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
    renameSync(temporary, target);
  };
  const deadline = setTimeout(() => {
    record({ status: 'error', code: 'sync_timeout' });
    process.exit(1);
  }, 240_000);
  try {
    record(await runAutomaticSkillSync({ profile, apiBase, userId }));
  } catch (error) {
    // Persist only a classified error, never a bearer, signed URL or response body.
    record({ status: 'error', code: error.code || 'sync_failed' });
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}
