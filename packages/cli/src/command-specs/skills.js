import { getJwtSubject } from '../runtime/profiles.js';
import { reconcileAllSkills } from '../runtime/sync-skills.js';
import { ensureFreshOAuthCredential } from '../runtime/oauth.js';
import { installSkillSyncService } from '../runtime/skill-sync-service.js';

async function loadSkillSyncEngine() {
  return import('../../dist/skill-sync/index.js');
}

export async function syncSkillsHandler(ctx, {
  refresh = ensureFreshOAuthCredential, loadEngine = loadSkillSyncEngine,
  reconcile = reconcileAllSkills, install = installSkillSyncService,
} = {}) {
  await refresh(ctx.runtime);
  const userId = ctx.runtime.oauthUserId || getJwtSubject(ctx.runtime.jwt);
  const { runSkillSync, fetchSyncSettings } = await loadEngine();
  const settings = await fetchSyncSettings(ctx.runtime.apiBase, ctx.runtime.jwt);
  const result = await reconcile({
    serverUrl: ctx.runtime.apiBase,
    jwt: ctx.runtime.jwt,
    userId: settings.user_id || userId,
    honorSyncEnabled: Boolean(ctx.options.electronRepeat),
    runAccountSync: (serverUrl, jwt, dependencies, options) => runSkillSync(
      serverUrl, jwt, { ...dependencies, fetchSyncSettings: async () => settings }, options,
    ),
  });
  if (settings.sync_enabled && !ctx.options.electronRepeat) {
    try {
      result.automaticSync = await install(ctx.runtime);
    } catch (error) {
      result.automaticSync = { status: 'error', message: error.message };
    }
  }

  const failures = [...(result.failedPushes || []), ...(result.failedLinks || [])];
  return ctx.output.emitSuccess({
    command: 'skills sync',
    data: result,
    warnings: result.automaticSync?.status === 'error'
      ? [`Skills synced, but automatic refresh could not start: ${result.automaticSync.message}`] : [],
    humanSummary: failures.length ? `Skill sync completed with ${failures.length} reported failures; inspect failedPushes and failedLinks.` : result.syncEnabled
      ? `Synced account skills and kept ${result.baseSkills.length} base skills current.`
      : `Automatic Desktop sync is off; kept ${result.baseSkills.length} base skills current.`,
    renderHuman: () => failures.length ? `Skill sync needs attention: ${failures.map((failure) => `${failure.name}: ${failure.error}`).join("; ")}` : result.syncEnabled
      ? `Skills synced. Base skills current: ${result.baseSkills.join(', ')}.`
      : `Automatic Desktop sync is off. Base skills remain current: ${result.baseSkills.join(', ')}.`,
  });
}

export const skillsCommandSpecs = [
  {
    command_path: ['skills', 'sync'],
    summary: 'Synchronize account skills and keep the three Notis base skills current.',
    when_to_use:
      'Run manually whenever local agent skills should be reconciled. Manual runs ignore the Desktop automatic-sync preference.',
    args_schema: {
      arguments: [],
      options: [
        {
          flags: '--electron-repeat',
          description: 'Honor the automatic Desktop sync preference (used by Notis Desktop).',
        },
      ],
    },
    examples: ['notis skills sync', 'notis skills sync --json'],
    output_schema:
      'Returns account sync counts plus baseSkills, baseInstalled, baseLinked, and baseBackups.',
    mutates: true,
    idempotent: true,
    require_auth: true,
    related_commands: ['notis login', 'notis start', 'notis doctor'],
    backend_call: { type: 'local', name: 'skill_sync' },
    handler: syncSkillsHandler,
  },
];
