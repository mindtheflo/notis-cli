import { getJwtSubject } from '../runtime/profiles.js';
import { reconcileAllSkills } from '../runtime/sync-skills.js';
import { ensureFreshOAuthCredential } from '../runtime/oauth.js';
import { installSkillSyncService } from '../runtime/skill-sync-service.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { httpRequest } from '../runtime/transport.js';
import { usageError } from '../runtime/errors.js';
import { parseJson } from './helpers.js';

async function nativeSkillAuthoring(ctx, body, path = '/portal_skills/native-authoring') {
  // A Space target, destination or link change touches Spaces: declare the protocol.
  const spaceTarget = Boolean(body.target?.space_id || body.destination?.space_id || body.links);
  const result = await httpRequest({ runtime: ctx.runtime, method: 'POST', path, body,
    ...(spaceTarget ? { spacesProtocol: 1 } : {}) });
  return ctx.output.emitSuccess({ command: ctx.spec.command_path.join(' '), data: result.payload,
    humanSummary: JSON.stringify(result.payload, null, 2),
    meta: { mutating: body.operation !== 'read' && !body.dry_run, request_id: result.requestId } });
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function skillTarget(value, updating) {
  const direct = updating ? ['skill_id', 'access_revision'] : ['skill_id'];
  const space = updating ? ['space_id', 'binding_id', 'binding_revision', 'expected_skill_id', 'space_revision'] : ['space_id', 'binding_id'];
  if (!exactKeys(value, direct) && !exactKeys(value, space)) {
    throw usageError('Use one exact direct or Space target from the Skill inventory or skills read.');
  }
  return value;
}

function requestKey(ctx) {
  const request = ctx.options.requestId || ctx.globalOptions.idempotencyKey;
  if (typeof request !== 'string' || !request || request.length > 200) throw usageError('Pass --request-id <stable-key>.');
  return request;
}

function linkLabel(link) {
  return `${link.space_name || link.space_id}/${link.alias}${link.available === false ? ' (unavailable)' : ''}`;
}

/** One line per Skill: name, ID, kind, editability and its Space links. */
export function skillInventoryLines(page) {
  const entries = Array.isArray(page?.skills) ? page.skills : [];
  if (!entries.length) return 'No Skills match.';
  const lines = entries.map(entry => {
    const state = entry.editable ? 'editable' : `read-only${entry.read_only_reason ? ` (${entry.read_only_reason})` : ''}`;
    const links = (entry.links || []).map(linkLabel);
    return `${entry.name || entry.skill_id}  ${entry.skill_id}  ${entry.kind}  ${state}  links: ${links.length ? links.join(', ') : 'none'}`;
  });
  if (page.has_more && page.next) lines.push(`More Skills: rerun with --after ${page.next}`);
  return lines.join('\n');
}

/** What a link change did and where the resource is listed now. */
export function linkChangeSummary(result) {
  const parts = [];
  const added = (result?.added || []).map(link => `${link.space_id}/${link.alias}`);
  const removed = (result?.removed || []).map(link => `${link.space_id}/${link.alias}`);
  if (added.length) parts.push(`added: ${added.join(', ')}`);
  if (removed.length) parts.push(`removed: ${removed.join(', ')}`);
  if (result?.became_standalone) parts.push('now your standalone Skill');
  if (result?.replayed) parts.push('confirmed retry');
  const current = (result?.links || []).map(linkLabel);
  return `${parts.join('; ') || 'No change'}. Listed in: ${current.length ? current.join(', ') : 'none'}.`;
}

function linkEntries(value, option, required, optional = []) {
  const parsed = parseJson(value, option);
  const valid = entry => entry && typeof entry === 'object' && !Array.isArray(entry)
    && required.every(key => key in entry) && Object.keys(entry).every(key => required.includes(key) || optional.includes(key));
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every(valid)) {
    throw usageError(`${option} must be a JSON array of {${[...required, ...optional.map(key => `${key}?`)].join(', ')}} entries.`);
  }
  return parsed;
}

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
    command_path: ['skills', 'list'],
    summary: 'List every Skill you can see, with its kind, editability and Space links.',
    when_to_use: 'Find a Skill and its exact edit target before reading or editing it, or see what a Space and its sub-Spaces list. Links to Spaces you cannot open are omitted; an unavailable link gives no access.',
    args_schema: { arguments: [], options: [
      { flags: '--space <id>', description: 'Only Skills listed by this Space and, by default, its sub-Spaces.' },
      { flags: '--no-child-spaces', description: 'With --space: direct links of that Space only.' },
      { flags: '--include-disabled', description: 'Include Skills you disabled.' },
      { flags: '--after <cursor>', description: 'Continue from the next cursor of the previous page.' },
      { flags: '--limit <n>', description: 'Page size between 1 and 100 (default 50).' },
    ] },
    examples: ['notis skills list', 'notis skills list --space <space-id> --no-child-spaces --json'],
    mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_skills/inventory' },
    async handler(ctx) {
      const body = {};
      if (ctx.options.space !== undefined) body.space_id = ctx.options.space;
      if (ctx.options.childSpaces === false) {
        if (body.space_id === undefined) throw usageError('--no-child-spaces needs --space <id>.');
        body.include_child_spaces = false;
      }
      if (ctx.options.includeDisabled) body.include_disabled = true;
      if (ctx.options.after !== undefined) body.after = ctx.options.after;
      if (ctx.options.limit !== undefined) {
        const limit = Number(ctx.options.limit);
        if (!/^\d+$/.test(String(ctx.options.limit)) || limit < 1 || limit > 100) throw usageError('Pass --limit between 1 and 100.');
        body.limit = limit;
      }
      const result = await httpRequest({ runtime: ctx.runtime, method: 'POST', path: '/portal_skills/inventory', body });
      return ctx.output.emitSuccess({ command: 'skills list', data: result.payload,
        humanSummary: skillInventoryLines(result.payload), meta: { mutating: false, request_id: result.requestId } });
    },
  },
  {
    command_path: ['skills', 'create'],
    summary: 'Create a native Skill, standalone or linked to an editable Space.',
    when_to_use: 'Create complete instructions or files without provider installation. Choose an optional Space destination, dry-run, and keep the exact request key on retry.',
    args_schema: { arguments: [{ token: '<file>', key: 'file', description: 'JSON containing name, optional description, and skill_md or base64 files.' }],
      options: [{ flags: '--request-id <key>', description: 'Stable creation intent key; reuse after an uncertain reply.' },
        { flags: '--dry-run', description: 'Validate without creating an identity or uploading files.' }] },
    examples: ['notis skills create ./skill.json --request-id create-1 --dry-run'],
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_skills/native-create' },
    handler(ctx) {
      const payload = parseJson(readFileSync(resolve(ctx.args.file), 'utf8'), 'Skill creation file');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
          || Object.keys(payload).some(key => !['destination', 'name', 'description', 'skill_md', 'files'].includes(key))) {
        throw usageError('Provide a name, complete instructions or files, and an optional current destination; never override ownership.');
      }
      const destination = payload.destination ?? { kind: 'standalone' };
      if (!(exactKeys(destination, ['kind']) && destination.kind === 'standalone')
          && !exactKeys(destination, ['space_id', 'alias', 'revision'])) throw usageError('Choose a standalone destination or exact Space, alias and revision.');
      const request = ctx.options.requestId || ctx.globalOptions.idempotencyKey;
      if (typeof request !== 'string' || !request || request.length > 200) throw usageError('Pass --request-id <stable-key>.');
      return nativeSkillAuthoring(ctx, { ...payload, operation: 'create', destination,
        request_id: request, dry_run: Boolean(ctx.options.dryRun) }, '/portal_skills/native-create');
    },
  },
  {
    command_path: ['skills', 'settings', 'read'],
    summary: 'Read a native Skill personal enablement, agent targets and settings revision.',
    when_to_use: 'Inspect direct-owner preferences without changing shared instructions or Space access.',
    args_schema: { arguments: [{ token: '<skill-id>', key: 'skillId', description: 'Exact native Skill ID.' }], options: [] },
    mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_skills/native-settings' },
    handler(ctx) { return nativeSkillAuthoring(ctx, { operation: 'read', target: { skill_id: ctx.args.skillId } }, '/portal_skills/native-settings'); },
  },
  {
    command_path: ['skills', 'settings', 'update'],
    summary: 'Update personal native Skill settings with a current revision and stable retry key.',
    when_to_use: 'Enable or disable your agents without changing a shared Skill definition or another Space.',
    args_schema: { arguments: [{ token: '<file>', key: 'file', description: 'JSON with target, revision and patch (enabled or agent_targets).' }],
      options: [{ flags: '--request-id <key>', description: 'Stable settings intent; reuse after a lost reply.' },
        { flags: '--dry-run', description: 'Validate current ownership and revision without changing settings.' }] },
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_skills/native-settings' },
    handler(ctx) {
      const payload = parseJson(readFileSync(resolve(ctx.args.file), 'utf8'), 'Skill settings file');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
          || Object.keys(payload).sort().join(',') !== 'patch,revision,target'
          || !payload.target || Object.keys(payload.target).sort().join(',') !== 'access_revision,skill_id') {
        throw usageError('Use a current standalone target, settings revision and personal settings patch.');
      }
      const request = ctx.options.requestId || ctx.globalOptions.idempotencyKey;
      if (typeof request !== 'string' || !request || request.length > 200) throw usageError('Pass --request-id <stable-key>.');
      return nativeSkillAuthoring(ctx, { ...payload, operation: 'update', request_id: request, dry_run: Boolean(ctx.options.dryRun) }, '/portal_skills/native-settings');
    },
  },
  {
    command_path: ['skills', 'read'],
    summary: 'Inspect a native Skill through direct ownership or an editable Space link.',
    when_to_use: 'Read the exact target and content version before editing. A Space target uses its current Editor authority, never a personal fallback.',
    args_schema: { arguments: [{ token: '[skill-id]', key: 'skillId', description: 'Exact directly owned Skill ID; omit when passing --target.' }],
      options: [{ flags: '--files', description: 'Include every verified supporting file as base64.' },
        { flags: '--target <json>', description: 'Exact {skill_id} or {space_id,binding_id} read target; do not combine with a Skill ID.' }] },
    examples: ['notis skills read <skill-id> --files', 'notis skills read --target \'{"space_id":"<id>","binding_id":"<binding>"}\' --files'],
    mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_skills/native-authoring' },
    handler(ctx) {
      if (Boolean(ctx.args.skillId) === Boolean(ctx.options.target)) throw usageError('Pass either a Skill ID or --target <json>.');
      const target = skillTarget(ctx.options.target ? parseJson(ctx.options.target, '--target') : { skill_id: ctx.args.skillId }, false);
      return nativeSkillAuthoring(ctx, { operation: 'read', target,
        include_files: Boolean(ctx.options.files) });
    },
  },
  {
    command_path: ['skills', 'update'],
    summary: 'Edit a native Skill through its direct or Space target, preserving its ID and supporting files.',
    when_to_use: 'Use the target/version from skills list or skills read, dry-run, then reuse the same request key and bytes to save or recover a lost reply. The same edit file works for a standalone or a Space target; an optional links key changes where the Skill is listed in the same transaction.',
    args_schema: { arguments: [{ token: '<file>', key: 'file', description: 'JSON with direct or Space target, version, skill_md or base64 files, optional name/description and links {add,remove}.' }],
      options: [{ flags: '--request-id <key>', description: 'Stable edit intent key; reuse after lost replies.' },
        { flags: '--dry-run', description: 'Check current access, content and revisions without uploading or saving.' }] },
    examples: ['notis skills update ./skill-edit.json --request-id edit-1 --dry-run'],
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_skills/native-authoring' },
    handler(ctx) {
      const payload = parseJson(readFileSync(resolve(ctx.args.file), 'utf8'), 'Skill edit file');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
          || Object.keys(payload).some(key => !['target', 'version', 'skill_md', 'files', 'name', 'description', 'links'].includes(key))) {
        throw usageError('Use an exact target, version, skill_md or files, and optional links; never override ownership.');
      }
      skillTarget(payload.target, true);
      if ('links' in payload && (!payload.links || typeof payload.links !== 'object' || Array.isArray(payload.links)
          || !Object.keys(payload.links).length || Object.keys(payload.links).some(key => !['add', 'remove'].includes(key)))) {
        throw usageError('links must be an object with add and/or remove arrays.');
      }
      return nativeSkillAuthoring(ctx, { ...payload, operation: 'update', request_id: requestKey(ctx),
        dry_run: Boolean(ctx.options.dryRun) });
    },
  },
  {
    command_path: ['skills', 'links'],
    summary: 'Add, remove or move a Skill between Spaces; the Skill keeps its ID.',
    when_to_use: 'Change where a Skill is listed without editing its content. A move is one add plus one remove in one transaction. You must be an Editor of every Space you touch and able to edit the Skill; removing its last available link keeps it as your own standalone Skill.',
    args_schema: { arguments: [{ token: '<skill-id>', key: 'skillId', description: 'Exact Skill ID from skills list.' }], options: [
      { flags: '--add <json>', description: 'JSON array of {space_id, space_revision, alias?} links to add; alias defaults to the Skill name.' },
      { flags: '--remove <json>', description: 'JSON array of {binding_id, binding_revision} links to remove, from skills list.' },
      { flags: '--request-id <key>', description: 'Stable intent key; reuse it unchanged when retrying this change.' },
    ] },
    examples: ['notis skills links <skill-id> --add \'[{"space_id":"<space-id>","space_revision":3}]\' --request-id link-1',
      'notis skills links <skill-id> --add \'[{"space_id":"<to-space-id>","space_revision":3}]\' --remove \'[{"binding_id":"<binding-id>","binding_revision":2}]\' --request-id move-1'],
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/resource-links' },
    async handler(ctx) {
      const links = {};
      if (ctx.options.add !== undefined) links.add = linkEntries(ctx.options.add, '--add', ['space_id', 'space_revision'], ['alias']);
      if (ctx.options.remove !== undefined) links.remove = linkEntries(ctx.options.remove, '--remove', ['binding_id', 'binding_revision']);
      if (!Object.keys(links).length) throw usageError('Pass --add and/or --remove.');
      const body = { kind: 'skill', resource_id: ctx.args.skillId, links, request_id: requestKey(ctx) };
      const result = await httpRequest({ runtime: ctx.runtime, method: 'POST', path: '/portal_spaces/resource-links', body, spacesProtocol: 1 });
      return ctx.output.emitSuccess({ command: 'skills links', data: result.payload,
        humanSummary: linkChangeSummary(result.payload), meta: { mutating: true, request_id: result.requestId } });
    },
  },
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
