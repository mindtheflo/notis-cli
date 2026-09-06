import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidProfileName, loadConfig } from './profiles.js';
import { withSkillSyncLock } from './sync-skills.js';

export const SKILL_SYNC_SERVICE_LABEL = 'ai.notis.skills-sync';
const bundlePath = fileURLToPath(new URL('../../dist/skill-sync-worker.mjs', import.meta.url));

function atomicWrite(target, value, mode = 0o600) {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, value, { mode });
  renameSync(temporary, target);
}

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export async function maybeInstallSkillSyncService(runtime, {
  config = loadConfig(), install = installSkillSyncService,
  fetchSettings, refresh,
} = {}) {
  if (process.platform !== 'darwin' || runtime.credentialKind !== 'oauth'
    || config.current_profile !== runtime.profileName
    || !['https://api.notis.ai', 'https://api-beta.notis.ai'].includes(runtime.apiBase)) return;
  // Ordinary commands must not steal another explicitly bound account's job.
  const plist = join(homedir(), 'Library', 'LaunchAgents', `${SKILL_SYNC_SERVICE_LABEL}.plist`);
  if (existsSync(plist)) {
    const saved = readFileSync(plist, 'utf8');
    if (runtime.oauthUserId && [runtime.profileName, runtime.apiBase, runtime.oauthUserId]
      .every(value => saved.includes(`<string>${xml(value)}</string>`))) return install(runtime);
    return;
  }
  const refreshCredential = refresh || (await import('./oauth.js')).ensureFreshOAuthCredential;
  await refreshCredential(runtime);
  const getSettings = fetchSettings || (await import('../../dist/skill-sync/index.js')).fetchSyncSettings;
  const settings = await getSettings(runtime.apiBase, runtime.jwt);
  if (settings.sync_enabled && settings.user_id === runtime.oauthUserId) return install(runtime);
}

export async function installSkillSyncService(runtime, options = {}) {
  if ((options.platform || process.platform) !== 'darwin') return { status: 'unsupported_platform' };
  if (runtime.credentialKind !== 'oauth' || !runtime.oauthUserId
    || !['https://api.notis.ai', 'https://api-beta.notis.ai'].includes(runtime.apiBase)) {
    return { status: 'skipped_non_personal_profile' };
  }
  // Registration upgrades must not kill a worker holding the filesystem lock,
  // nor race another CLI registering the same LaunchAgent.
  return withSkillSyncLock(() => installSkillSyncServiceLocked(runtime, options),
    options.home ? { home: options.home } : {});
}

async function installSkillSyncServiceLocked(runtime, {
  home = homedir(), platform = process.platform, nodePath = process.execPath,
  source = bundlePath, run = spawnSync, uid = process.getuid?.(),
} = {}) {
  // A single explicitly selected personal account owns global agent folders.
  // Development and hosted credentials must never enroll a machine-wide job.
  if (platform !== 'darwin') return { status: 'unsupported_platform' };
  if (runtime.credentialKind !== 'oauth' || runtime.envCredentialOverride
    || !isValidProfileName(runtime.profileName)
    || !['https://api.notis.ai', 'https://api-beta.notis.ai'].includes(runtime.apiBase)) {
    return { status: 'skipped_non_personal_profile' };
  }
  const root = join(home, '.notis', 'skills', 'service');
  const bundle = readFileSync(source);
  const digest = createHash('sha256').update(bundle).digest('hex');
  const installedBundle = join(root, 'runtime', digest, 'worker.mjs');
  if (!existsSync(installedBundle)
    || !readFileSync(installedBundle).equals(bundle)) atomicWrite(installedBundle, bundle, 0o500);
  const args = [nodePath, installedBundle, runtime.profileName, runtime.apiBase, runtime.oauthUserId];
  if (!runtime.oauthUserId) return { status: 'skipped_missing_account' };
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${SKILL_SYNC_SERVICE_LABEL}</string>
<key>ProgramArguments</key><array>${args.map(value => `<string>${xml(value)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>StartInterval</key><integer>60</integer>
<key>ProcessType</key><string>Background</string>
</dict></plist>
`;
  const plistPath = join(home, 'Library', 'LaunchAgents', `${SKILL_SYNC_SERVICE_LABEL}.plist`);
  const domain = `gui/${uid}`;
  const target = `${domain}/${SKILL_SYNC_SERVICE_LABEL}`;
  const unchanged = existsSync(plistPath) && readFileSync(plistPath, 'utf8') === plist;
  const loaded = run('/bin/launchctl', ['print', target], { encoding: 'utf8', timeout: 5000 });
  if (unchanged && loaded.status === 0) return { status: 'installed', intervalSeconds: 60, profile: runtime.profileName };
  if (loaded.status === 0) {
    const stopped = run('/bin/launchctl', ['bootout', target], { encoding: 'utf8', timeout: 5000 });
    if (stopped.status !== 0) throw new Error('Could not update the existing automatic skill sync job');
  }
  atomicWrite(plistPath, plist);
  let started;
  // launchd may finish tearing down an old registration after bootout returns.
  for (let attempt = 0; attempt < 10; attempt++) {
    started = run('/bin/launchctl', ['bootstrap', domain, plistPath], { encoding: 'utf8', timeout: 5000 });
    if (started.status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (started?.status !== 0) throw new Error('Could not register automatic skill sync with macOS');
  return { status: 'installed', intervalSeconds: 60, profile: runtime.profileName };
}
