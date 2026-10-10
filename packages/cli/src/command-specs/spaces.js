import { scaffoldSpaceCollection } from '../runtime/space-collection-scaffold.js';
import { appFilesDigest, pullAppSource, resolveProjectDir, saveSpaceVerification, spacePublicationIntent } from '../runtime/app-platform.js';
import { buildSpaceArtifact, prepareSpaceRelease } from '../runtime/space-platform.js';
import { verifySpaceRelease } from '../runtime/space-verification.js';
import { loadSelectedSpace } from '../runtime/space-source.js';
import { refreshSpaceAuthoring } from '../runtime/space-database-structures.js';
import { RESOURCES_FILE, SKILLS_DIR, applyPublication, collectSkillFolders, computeSpaceSourceChanges, describeAppliedChanges,
  lockAfterPull, readResourceList, readSpaceLock, resourceEntries, skillFolderFiles, writeResourceList, writeSkillFolder, writeSpaceLock, isFolderAlias } from '../runtime/space-lock.js';
import { CliError, usageError } from '../runtime/errors.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { httpRequest } from '../runtime/transport.js';
import { assertSourceRoot } from '../runtime/source-root.js';
import { parseJson } from './helpers.js';
import { createHash } from 'node:crypto';
import { viewRenderCommandSpec } from './views.js';

function selected(ctx) {
  if (!ctx.options.space) throw usageError('Choose the independent Space with --space <key>.');
  // build, verify, preview, deploy and inspect write or stage inside this folder.
  return { directory: assertSourceRoot(resolveProjectDir(ctx.args.dir || '.')), key: ctx.options.space };
}

function requestId(ctx) {
  const value = ctx.options.requestId || ctx.globalOptions.idempotencyKey;
  if (!value || value.length > 200) throw usageError('Pass --request-id <stable-key>; keep it unchanged when retrying this intent.');
  return value;
}

function revision(ctx) {
  const value = Number(ctx.options.revision);
  if (!Number.isSafeInteger(value) || value < 1) throw usageError('Pass the published --revision <number> from spaces get.');
  return value;
}

function schemaRevision(ctx) {
  if (ctx.options.schemaRevision === undefined) return undefined;
  const value = Number(ctx.options.schemaRevision);
  if (!Number.isSafeInteger(value) || value < 0) throw usageError('Pass the exact --schema-revision <number> returned by the native schema or query.');
  return value;
}

function object(value, label) {
  const parsed = parseJson(value, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw usageError(`${label} must be a JSON object.`);
  return parsed;
}

async function remote(ctx, operation, { method = 'POST', body, query } = {}) {
  const suffix = query ? `?${new URLSearchParams(Object.entries(query).filter(([, value]) => value != null))}` : '';
  const result = await httpRequest({ runtime: ctx.runtime, method, path: `/portal_spaces/${operation}${suffix}`, body, spacesProtocol: 1 });
  return ctx.output.emitSuccess({ command: ctx.spec.command_path.join(' '), data: result.payload,
    humanSummary: JSON.stringify(result.payload, null, 2), meta: { mutating: method !== 'GET' && !body?.dry_run && ctx.spec.mutates !== false, request_id: result.requestId } });
}

/**
 * What changed since the pull in `skills/` and `resources.json` (R5). Without a
 * lock file the workspace was authored, not pulled: those files are ignored and
 * the caller is told so. `recorded` replaces the lock and list on disk with the
 * ones a deploy intent was first made from (its Skill folders are still read).
 */
function localSpaceChanges(directory, spaceId, manifest, recorded = null) {
  const lock = recorded ? recorded.lock : readSpaceLock(directory);
  const folders = collectSkillFolders(directory);
  const resources = recorded ? recorded.resources ?? null : readResourceList(directory);
  if (!lock) {
    const warnings = Object.keys(folders).length || resources
      ? [`${SKILLS_DIR}/ and ${RESOURCES_FILE} are deployed only from a pulled Space (notis spaces pull); this workspace has no .notis/space-lock.json, so they were ignored.`]
      : [];
    return { lock: null, folders, changes: null, summary: null, fingerprint: null, warnings };
  }
  if (lock.space_id !== spaceId) {
    throw usageError(`This workspace was pulled from Space ${lock.space_id}. Deploy it with --space-id ${lock.space_id}, or pull the other Space into another directory.`);
  }
  return { lock, resources, folders, ...computeSpaceSourceChanges({ lock, resources, folders, manifest }), warnings: [] };
}

/**
 * The local changes a deploy intent stands for. A publication this request ID
 * completed rewrote the lock and list (recordPublication), so the identical
 * command finds nothing left to deploy against them: an untouched workspace is
 * then checked against the lock and list the intent was first made from, and
 * replays the same release. Anything edited since is still a different intent.
 */
function intentChanges(directory, spaceId, manifest, local, intent) {
  if (!intent?.local_state || local.fingerprint !== null
      || (intent.local_changes_fingerprint ?? null) === local.fingerprint) return local;
  const original = localSpaceChanges(directory, spaceId, manifest, intent.local_state);
  return (original.fingerprint ?? null) === (intent.local_changes_fingerprint ?? null) ? original : local;
}

/** After a publication, the lock and list record the applied versions and the Space's current links. */
function recordPublication(directory, local, result) {
  if (!local?.lock || !result || result.published_revision === undefined) return;
  const updated = applyPublication({ lock: local.lock, folders: local.folders, result });
  writeSpaceLock(directory, updated.lock);
  if (updated.resources) writeResourceList(directory, updated.resources);
}

/** Reviewable: a page with viewer reads shows each signed-in viewer what they can open, with their own access. */
function describeViewerReads(capabilities) {
  const families = capabilities?.viewerReads;
  return Array.isArray(families) && families.length
    ? ` Viewer reads: this page lists the ${families.join(' and ')} each signed-in viewer can open, with that viewer's own access (never on a Site).`
    : '';
}

/** Reviewable: a page that uses the cloud computer runs on each viewer's own one, after that viewer allows it. */
function describeCloudComputer(capabilities) {
  const level = capabilities?.cloudComputer;
  if (level === 'shell') return " Cloud computer: this page runs commands and writes files on each signed-in viewer's own cloud computer, once that viewer allows it (never on a Site).";
  if (level === 'read') return " Cloud computer: this page reads whether each signed-in viewer's own cloud computer is running and signed in to GitHub, once that viewer allows it.";
  return '';
}

function describePendingChanges(summary) {
  if (!summary) return '';
  const parts = [];
  if (summary.skills.edited.length) parts.push(`Skills to update: ${summary.skills.edited.join(', ')}`);
  if (summary.skills.created.length) parts.push(`Skills to create: ${summary.skills.created.join(', ')}`);
  if (summary.links.added.length) parts.push(`Links to add: ${summary.links.added.join(', ')}`);
  if (summary.links.removed.length) parts.push(`Links to remove: ${summary.links.removed.join(', ')}`);
  return parts.length ? ` ${parts.join('. ')}.` : '';
}

async function sourceRelease(ctx, publish, stageOnly = false) {
  const { directory, key } = selected(ctx);
  if (!ctx.options.spaceId) throw usageError('Pass --space-id <id> for the existing Space.');
  const intentKey = publish ? requestId(ctx) : null;
  const release = await prepareSpaceRelease(directory, key);
  try {
    const identity = [ctx.runtime.apiBase.replace(/\/$/, ''), ctx.runtime.profileName, key, ctx.options.spaceId, intentKey];
    let verification = publish && !ctx.options.dryRun ? spacePublicationIntent(directory, identity) : null;
    const local = intentChanges(directory, ctx.options.spaceId, release.manifest,
      localSpaceChanges(directory, ctx.options.spaceId, release.manifest), verification);
    const body = { space_id: ctx.options.spaceId, manifest: release.manifest, source_files: release.sourceFiles,
      artifact_files: release.files, reuse_grants: object(ctx.options.reuseGrants || '{}', '--reuse-grants'),
      ...(ctx.options.reuseGrantsOnly ? { authorization_mode: 'reuse_only' } : {}),
      ...(local.changes ? { changes: local.changes } : {}) };
    const sourceDigest = appFilesDigest(release.sourceFiles), artifactDigest = appFilesDigest(release.files);
    const call = (operation, data) => httpRequest({ runtime: { ...ctx.runtime, timeoutMs: Math.max(ctx.runtime.timeoutMs || 0, 600_000) },
      method: 'POST', path: `/portal_spaces/${operation}`, body: data, spacesProtocol: 1 });
    if (verification && (verification.local_changes_fingerprint ?? null) !== local.fingerprint) {
      throw usageError('This request ID belongs to different Skill folders or list entries. Restore the state you first deployed to retry, or use a new request ID for a new release.');
    }
    if (!verification) {
      verification = (await call('source-verify', body)).payload;
    }
    if (verification?.valid !== true || verification.space_id !== body.space_id || verification.source_digest !== sourceDigest
      || verification.artifact_digest !== artifactDigest || JSON.stringify(Object.entries(verification.reuse_grants || {}).sort())
        !== JSON.stringify(Object.entries(body.reuse_grants).sort())
      || (verification.authorization_mode ?? 'authorize_missing') !== (body.authorization_mode ?? 'authorize_missing')) {
      throw usageError('This request ID belongs to different source or grant choices. Keep the original bytes to retry, or use a new request ID for a new release.');
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    let render;
    try { render = await verifySpaceRelease(release, { capabilities: verification.capabilities, signal: controller.signal,
      authorizationMode: body.authorization_mode, unavailableActions: verification.unavailable_actions }); }
    finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    const diagnosticPath = saveSpaceVerification(directory, { ...render, space_id: body.space_id });
    if (!['passed', 'not_applicable_container'].includes(render.status)) {
      throw usageError('The built Space did not pass offline render verification. Nothing was published.', { render, diagnostic_path: diagnosticPath });
    }
    if (publish && !ctx.options.dryRun) {
      // The retained intent pins the local change set next to the server verification, with the
      // lock and list it was computed from: the lock and list this publication then rewrites can
      // never turn the identical command into a different intent.
      verification = spacePublicationIntent(directory, identity, { ...verification, local_changes_fingerprint: local.fingerprint,
        local_state: local.lock ? { lock: local.lock, resources: local.resources ?? null } : null });
    }
    const { local_changes_fingerprint: _fingerprint, local_state: _state, ...serverVerification } = verification;
    // Close/check the pinned local snapshot before the first remote mutation.
    // The upload uses the captured bytes, not mutable working-tree paths.
    release.close();
    const result = publish && !ctx.options.dryRun
      ? (await call(stageOnly ? 'source-stage' : 'source-publish', { ...body, verification: serverVerification, request_id: intentKey })).payload
      : serverVerification;
    if (publish && !ctx.options.dryRun && !stageOnly) recordPublication(directory, local, result);
    const data = { ...result, render, diagnostic_path: diagnosticPath, ...(local.summary ? { local_changes: local.summary } : {}) };
    return ctx.output.emitSuccess({ command: ctx.spec.command_path.join(' '), data,
      humanSummary: publish && !ctx.options.dryRun
        ? stageOnly ? `Prepared ${key} as revision ${result.candidate_revision}. ${result.preview_url || 'This container has no executable preview.'} Live source was not changed.${describePendingChanges(local.summary).replace(/\.$/, '; they go live with notis spaces promote.')}`
          : `Published ${key} as revision ${result.published_revision}${result.replayed ? ' (confirmed retry)' : ''}.${describeAppliedChanges(result)}${describeViewerReads(serverVerification.capabilities)}${describeCloudComputer(serverVerification.capabilities)}`
        : `Verified ${key}'s frozen source${render.status === 'passed' ? ', rendered fixtures' : ' (container)'} and current authorizations; nothing was published.${describePendingChanges(local.summary)}${describeViewerReads(serverVerification.capabilities)}${describeCloudComputer(serverVerification.capabilities)}`,
      warnings: local.warnings, meta: { mutating: publish && !ctx.options.dryRun } });
  } finally { release.close(); }
}

/** Pull the Space's links as its resource list and every editable linked Skill as a folder (R5). */
async function materializeSpaceLinks(ctx, { projectDir, spaceId, sourceRevision }) {
  const sourceSkillFolders = collectSkillFolders(projectDir);
  const query = new URLSearchParams({ space_id: spaceId });
  const links = (await httpRequest({ runtime: ctx.runtime, method: 'GET', path: `/portal_spaces/space-links?${query}`, spacesProtocol: 1 })).payload?.links;
  const list = Array.isArray(links) ? links : [];
  const skills = {}, skipped = [];
  for (const link of list.filter((entry) => entry?.kind === 'skill')) {
    if (link.available === false) { skipped.push({ alias: link.alias, reason: 'unavailable' }); continue; }
    if (!isFolderAlias(link.alias)) {
      // A staged `skill:<id>` alias cannot name a folder: rename the link first to edit the Skill here.
      skipped.push({ alias: link.alias, reason: `rename with notis spaces resources name ${spaceId} ${link.binding_id}` }); continue;
    }
    let read;
    try {
      read = (await httpRequest({ runtime: ctx.runtime, method: 'POST', path: '/portal_skills/native-authoring', spacesProtocol: 1,
        body: { operation: 'read', target: { space_id: spaceId, binding_id: link.binding_id }, include_files: true } })).payload;
    } catch (error) {
      // A curated or otherwise read-only Skill stays listed without a folder; the deploy never edits it.
      if (error instanceof CliError && ['forbidden', 'conflict', 'usage_error'].includes(error.code)) {
        skipped.push({ alias: link.alias, reason: 'read-only' }); continue;
      }
      throw error;
    }
    const files = read?.definition?.files;
    if (!files || typeof files !== 'object' || typeof files['SKILL.md'] !== 'string' || read.skill_id !== link.resource_id
      || read.target?.binding_id !== link.binding_id || !read.version) {
      throw usageError(`The server did not return the verified files of Skill ${link.alias}.`);
    }
    // Hash exactly what the folder keeps, so an untouched folder never reads as an edit (bytecode caches are not kept).
    const kept = skillFolderFiles(files);
    writeSkillFolder(projectDir, link.alias, kept, { sourceSnapshot: sourceSkillFolders[link.alias]?.files });
    skills[link.alias] = { skill_id: read.skill_id, binding_id: read.target.binding_id, binding_revision: read.target.binding_revision,
      version: read.version, folder_hash: appFilesDigest(kept) };
  }
  writeResourceList(projectDir, resourceEntries(list));
  writeSpaceLock(projectDir, lockAfterPull({ spaceId, apiBase: ctx.runtime.apiBase.replace(/\/$/, ''), sourceRevision, links: list, skills }));
  return { links: resourceEntries(list), skills: Object.keys(skills).sort(), skipped };
}

const idArgument = { token: '<space-id>', key: 'spaceId', description: 'Exact existing Space ID.' };
const recordOption = { flags: '--record <record-key>', description: 'Fixed record context, when this is a record-scoped Space.' };
const requestOption = { flags: '--request-id <key>', description: 'Stable intent key. Reuse after timeouts or lost replies.' };

export const spacesCommandSpecs = [
  viewRenderCommandSpec({ screenshotOnly: true }),
  {
    command_path: ['spaces', 'init'], summary: 'Scaffold an editable collection view with first-party record components.',
    when_to_use: 'Start a local Space collection source for an existing linked database. Does not create or deploy remote resources.',
    args_schema: { arguments: [{ token: '<name>', key: 'name', description: 'Space display name.' },
      { token: '[dir]', key: 'dir', description: 'New or empty local source directory.' }], options: [
      { flags: '--database-key <key>', description: 'Portable key of the database this Space links.' },
      { flags: '--path <path>', description: 'Descriptive view path; defaults to records.' },
      { flags: '--title-property <id>', description: 'Canonical title/number property ID, or the title column (default).' },
    ] },
    examples: ['notis spaces init Notes ./notes --database-key notes --path notes'],
    mutates: true, idempotent: false, require_auth: false, backend_call: { type: 'local', name: 'scaffold_space_collection' },
    async handler(ctx) {
      const result = await scaffoldSpaceCollection({ projectDir: resolveProjectDir(ctx.args.dir || ctx.args.name), name: ctx.args.name,
        databaseKey: ctx.options.databaseKey, path: ctx.options.path, titleProperty: ctx.options.titleProperty });
      return ctx.output.emitSuccess({ command: 'spaces init', data: result,
        humanSummary: `Collection source created in ${result.projectDir}. Build with --space collection after linking the declared database.` });
    },
  },
  {
    command_path: ['spaces', 'navigation', 'bind'],
    summary: 'Bind a named destination for the next source publication without granting target access.',
    when_to_use: 'Connect a portable navigation alias to an existing Space or exact record before building and publishing.',
    args_schema: { arguments: [idArgument], options: [
      { flags: '--alias <name>', description: 'Declared portable navigation alias.' },
      { flags: '--target <json>', description: 'Exact {space_id,document_id?}, or null to remove the draft binding.' },
      { flags: '--revision <number>', description: 'Current source Space metadata revision.' },
      { flags: '--dry-run', description: 'Check current source/target access and revision without changing anything.' },
    ] },
    examples: ['notis spaces navigation bind <space-id> --alias history --target \'{"space_id":"<history-id>"}\' --revision 2 --dry-run'],
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/navigation-binding' },
    handler(ctx) {
      const expected = ctx.options.revision;
      if (typeof expected !== 'string' || !/^\d+$/.test(expected) || !Number.isSafeInteger(Number(expected))) throw usageError('Pass the current metadata --revision.');
      if (typeof ctx.options.alias !== 'string' || !/^[a-z][a-z0-9_-]{0,99}$/.test(ctx.options.alias)) throw usageError('Pass a stable lowercase --alias.');
      const target = ctx.options.target === 'null' ? null : object(ctx.options.target, '--target');
      return remote(ctx, 'navigation-binding', { body: { space_id: ctx.args.spaceId, alias: ctx.options.alias,
        target, revision: Number(expected), dry_run: Boolean(ctx.options.dryRun) } });
    },
  },
  // Linking a database, Skill or automation into a Space is the resource's own
  // operation (`notis skills links`, LOCAL_NOTIS_UPDATE_AUTOMATION links,
  // LOCAL_NOTIS_DATABASE_UPSERT_DATABASE links); there is no Space-side include.
  {
    command_path: ['spaces','resources','name'],
    summary: 'Give an included resource a portable alias before the first source revision.',
    when_to_use: 'Prepare staged resources for source authoring without replacing their IDs, scope or owners.',
    args_schema: { arguments: [idArgument,{token:'<binding-id>',key:'bindingId',description:'Exact included binding ID from spaces get.'}], options:[
      {flags:'--alias <name>',description:'Stable lowercase alias to use in source.'},
      {flags:'--revision <number>',description:'Current Space metadata revision.'},
      {flags:'--dry-run',description:'Check naming, current access and revision without changing metadata.'},
    ]},
    examples:['notis spaces resources name <space-id> <binding-id> --alias weekly-report --revision 0 --dry-run'],
    mutates:true,idempotent:true,require_auth:true,
    backend_call:{type:'http',path:'/portal_spaces/resource-name'},
    handler(ctx) {
      const expected=ctx.options.revision;
      if(typeof expected!=='string'||!/^\d+$/.test(expected)||!Number.isSafeInteger(Number(expected))) throw usageError('Pass the current --revision from spaces get.');
      if(typeof ctx.options.alias!=='string'||!/^[a-z][a-z0-9_-]{0,99}$/.test(ctx.options.alias)) throw usageError('Pass a stable lowercase --alias.');
      return remote(ctx,'resource-name',{body:{space_id:ctx.args.spaceId,binding_id:ctx.args.bindingId,
        alias:ctx.options.alias,revision:Number(expected),dry_run:Boolean(ctx.options.dryRun)}});
    },
  },
  {
    command_path: ['spaces', 'pull'], summary: 'Pull one editable Space source snapshot, its resource list and its Skill folders into an empty directory.',
    when_to_use: `Edit a Space you can administer: the source, its links (${RESOURCES_FILE}) and every editable linked Skill (${SKILLS_DIR}/<alias>/) arrive together, with a local lock file so a later deploy sends only what you changed.`,
    args_schema: { arguments: [idArgument, { token: '[dir]', key: 'dir', description: 'New or empty destination directory (defaults to the Space ID).' }],
      options: [{ flags: '--revision <number>', description: 'Exact published source revision; defaults to the current one.' }] },
    examples: ['notis spaces pull <space-id> ./space-source'], mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/source' },
    async handler(ctx) {
      const requestedRevision = ctx.options.revision === undefined ? null : revision(ctx);
      const sourceLink = { space_id: ctx.args.spaceId, api_base: ctx.runtime.apiBase.replace(/\/$/, '') };
      let databaseStructures, authoringOverrides;
      const result = await pullAppSource({ targetDir: resolve(ctx.args.dir || ctx.args.spaceId), force: false,
        sourceKind: 'space', sourceLink, version: requestedRevision || 'latest',
        async downloadSource() {
          const query = new URLSearchParams({ space_id: ctx.args.spaceId, format: 'archive',
            ...(requestedRevision === null ? {} : { revision: String(requestedRevision) }) });
          const source = (await httpRequest({ runtime: ctx.runtime, method: 'GET',
            path: `/portal_spaces/source?${query}`, spacesProtocol: 1 })).payload;
          if (source?.space_id !== ctx.args.spaceId || source.archive_format !== 'tar-gzip-v1'
            || typeof source.source_archive !== 'string' || !/^[a-f0-9]{64}$/.test(source.source_digest || '')) {
            throw usageError('The server did not return a verified Space source snapshot.');
          }
          const archiveBuffer = Buffer.from(source.source_archive, 'base64');
          if (archiveBuffer.toString('base64') !== source.source_archive
            || createHash('sha256').update(archiveBuffer).digest('hex') !== source.archive_sha256) {
            throw usageError('The downloaded Space source bytes do not match their fingerprint.');
          }
          sourceLink.source_digest = source.source_digest;
          sourceLink.local_key = source.manifest?.local_key;
          databaseStructures = source.database_structures;
          authoringOverrides = source.authoring_overrides;
          return { archiveBuffer, revision: source.revision };
        } });
      const authoringFiles = refreshSpaceAuthoring(result.projectDir, sourceLink.local_key, { databaseStructures, authoringOverrides });
      const materialized = await materializeSpaceLinks(ctx, { projectDir: result.projectDir, spaceId: ctx.args.spaceId, sourceRevision: result.version });
      const skipped = materialized.skipped.map((entry) => `${entry.alias} (${entry.reason})`);
      return ctx.output.emitSuccess({ command: 'spaces pull', data: { ...result, space_id: ctx.args.spaceId, ...materialized, authoring_projection_files: authoringFiles },
        humanSummary: `Pulled source revision ${result.version} into ${result.projectDir}: ${materialized.links.length} linked resources in ${RESOURCES_FILE}, `
          + `${materialized.skills.length} Skill folders under ${SKILLS_DIR}/.${skipped.length ? ` Listed without a folder: ${skipped.join(', ')}.` : ''}`,
        warnings: skipped.length ? [`Skills listed without an editable folder: ${skipped.join(', ')}.`] : [] });
    },
  },
  ...['verify', 'preview', 'deploy'].map(operation => ({
    command_path: ['spaces', operation],
    summary: operation === 'verify' ? 'Render one frozen Space with offline fixtures and validate its current action authorizations.'
      : operation === 'preview' ? 'Seal a checked unpublished revision of the same Space and return its authenticated preview link.'
      : 'Publish one built Space with a retry-safe, independent source revision.',
    when_to_use: operation === 'verify' ? 'Check immutable build bytes and authoring compatibility without executing actions or publishing.'
      : operation === 'preview' ? 'Review a checked candidate using current Editor access without changing live source or cloning the Space.'
        : 'Update only the selected existing Space; this does not publish to the Store or change siblings.',
    args_schema: { arguments: [{ token: '[dir]', key: 'dir', description: 'Source workspace (default current directory).' }],
      options: [{ flags: '--space <key>', description: 'Exact source key from the workspace index.' },
        { flags: '--space-id <id>', description: 'Exact existing destination Space.' },
        { flags: '--reuse-grants <json>', description: 'Explicit action-key to saved-grant-ID map. Otherwise your own connections are used.' },
        { flags: '--reuse-grants-only', description: 'Never authorize new actions. Reuse only the supplied saved grants; other declarations remain unavailable. Requires existing bound databases.' },
        ...(operation !== 'verify' ? [requestOption, { flags: '--dry-run', description: 'Validate without uploading or publishing.' }] : [])] },
    examples: [`notis spaces ${operation} . --space overview --space-id <space-id>${operation !== 'verify' ? ' --request-id release-1' : ''}`],
    mutates: operation !== 'verify', idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: operation === 'deploy' ? '/portal_spaces/source-publish'
      : operation === 'preview' ? '/portal_spaces/source-stage' : '/portal_spaces/source-verify' },
    handler: ctx => sourceRelease(ctx, operation !== 'verify', operation === 'preview'),
  })),
  ...['promote', 'abandon'].map(operation => ({
    command_path: ['spaces', operation],
    summary: operation === 'promote' ? 'Publish the exact sealed Space revision, with its pending Skill and link changes, after current permission and concurrency checks.'
      : 'Close an unpublished Space preview without changing its live source, Skills or links, or deleting action history.',
    when_to_use: operation === 'promote' ? 'Finish a reviewed preview without rebuilding or substituting a different candidate. The Skill edits, new Skills and list changes the preview carried go live in the same transaction.'
      : 'Stop using a candidate while preserving live source and completed effects.',
    args_schema: { arguments: [{ token: '<release-id>', key: 'releaseId', description: 'Exact immutable release ID returned by spaces preview.' },
      ...(operation === 'promote' ? [{ token: '[dir]', key: 'dir', description: 'The pulled workspace of this Space; its lock file and resources.json then record what went live.' }] : [])] },
    examples: [`notis spaces ${operation} <release-id>`], mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: `/portal_spaces/source-${operation}` },
    async handler(ctx) {
      const result = await httpRequest({ runtime: ctx.runtime, method: 'POST', path: `/portal_spaces/source-${operation}`,
        body: { release_id: ctx.args.releaseId }, spacesProtocol: 1 });
      if (operation === 'promote' && ctx.args.dir) {
        const directory = resolveProjectDir(ctx.args.dir);
        const lock = readSpaceLock(directory);
        if (lock && result.payload?.space_id && lock.space_id !== result.payload.space_id) {
          throw usageError(`${directory} was pulled from Space ${lock.space_id}, not from the promoted Space.`);
        }
        if (lock) recordPublication(directory, { lock, folders: collectSkillFolders(directory) }, result.payload);
      }
      return ctx.output.emitSuccess({ command: ctx.spec.command_path.join(' '), data: result.payload,
        humanSummary: operation === 'promote' && result.payload?.published_revision !== undefined
          ? `Published revision ${result.payload.published_revision}${result.payload.replayed ? ' (confirmed retry)' : ''}.${describeAppliedChanges(result.payload)}`
          : JSON.stringify(result.payload, null, 2),
        meta: { mutating: true, request_id: result.requestId } });
    },
  })),
  {
    command_path: ['spaces', 'list'], summary: 'List Spaces currently available to your account.',
    when_to_use: 'Discover accessible Spaces without exposing an issuer-wide resource catalogue.',
    args_schema: {}, examples: ['notis spaces list'], mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/list' },
    handler: ctx => remote(ctx, 'list', { method: 'GET' }),
  },
  {
    command_path: ['spaces', 'get'], summary: 'Read one accessible Space and its scoped resources.',
    when_to_use: 'Inspect the current published revision and named capabilities before executing.',
    args_schema: { arguments: [idArgument], options: [recordOption] },
    examples: ['notis spaces get <space-id>'], mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/get' },
    handler: ctx => remote(ctx, 'get', { method: 'GET', query: { space_id: ctx.args.spaceId, document_id: ctx.options.record } }),
  },
  {
    command_path: ['spaces', 'action'], summary: 'Execute a declared action using its saved authorization.',
    when_to_use: 'Use Space capabilities as the actual actor, with the saved issuer connection and payer.',
    args_schema: { arguments: [idArgument, { token: '<action-id>', key: 'actionId', description: 'Declared action key.' }],
      options: [{ flags: '--revision <number>', description: 'Exact published source revision.' },
        { flags: '--preview-release <id>', description: 'Exact sealed candidate ID; requires current Editor access.' },
        { flags: '--schema-revision <number>', description: 'Native schema revision; required for native row writes.' },
        { flags: '--inputs <json>', description: 'Declared action input values; defaults to {}.' }, recordOption, requestOption,
        { flags: '--dry-run', description: 'Validate current access and action inputs without executing or billing.' }] },
    examples: ['notis spaces action <space-id> refresh --revision 1 --inputs \'{}\' --request-id refresh-1 --dry-run'],
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/action' },
    handler: ctx => remote(ctx, 'action', { body: { space_id: ctx.args.spaceId, action_id: ctx.args.actionId,
      revision: revision(ctx), inputs: object(ctx.options.inputs || '{}', '--inputs'), request_id: requestId(ctx),
      ...(ctx.options.previewRelease ? { preview_release_id: ctx.options.previewRelease } : {}),
      document_id: ctx.options.record, schema_revision: schemaRevision(ctx), dry_run: Boolean(ctx.options.dryRun) } }),
  },
  {
    command_path: ['spaces', 'viewer-read'], summary: 'Run one declared viewer read as yourself.',
    when_to_use: 'Check what an explorer Space shows you: the databases or Skills you can open, with your own access and never an issuer grant.',
    args_schema: { arguments: [idArgument, { token: '<operation>', key: 'operation',
      description: 'list_databases, get_database, query_database, list_skills or get_skill.' }],
      options: [{ flags: '--revision <number>', description: 'Exact published source revision.' },
        { flags: '--preview-release <id>', description: 'Exact sealed candidate ID; requires current Editor access.' },
        { flags: '--input <json>', description: 'Read input, e.g. {"database_id":"<id>"}; defaults to {}.' }, recordOption] },
    examples: ['notis spaces viewer-read <space-id> list_databases --revision 3',
      'notis spaces viewer-read <space-id> query_database --revision 3 --input \'{"database_id":"<id>","request":{"page_size":20}}\''],
    mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/viewer-read' },
    handler: ctx => remote(ctx, 'viewer-read', { body: { space_id: ctx.args.spaceId, operation: ctx.args.operation,
      revision: revision(ctx), input: object(ctx.options.input || '{}', '--input'), document_id: ctx.options.record,
      ...(ctx.options.previewRelease ? { preview_release_id: ctx.options.previewRelease } : {}) } }),
  },
  {
    command_path: ['spaces', 'grants', 'list'], summary: 'Inspect authorization records for a Space you can edit.',
    when_to_use: 'Inspect issuers and exact constraints without exposing connection secrets.',
    args_schema: { arguments: [idArgument], options: [recordOption] }, examples: ['notis spaces grants list <space-id>'],
    mutates: false, idempotent: true, require_auth: true, backend_call: { type: 'http', path: '/portal_spaces/grants' },
    handler: ctx => remote(ctx, 'grants', { method: 'GET', query: { space_id: ctx.args.spaceId, document_id: ctx.options.record } }),
  },
  {
    command_path: ['spaces', 'grants', 'create'], summary: 'Authorize an exact template using your current connection.',
    when_to_use: 'Create a Space-bound authorization; the server resolves the signed-in issuer connection.',
    args_schema: { arguments: [idArgument], options: [{ flags: '--template <file>', description: 'Canonical action template JSON file.' },
      recordOption, requestOption, { flags: '--dry-run', description: 'Validate the template and Editor access without creating a grant.' }] },
    examples: ['notis spaces grants create <space-id> --template action.json --request-id grant-1 --dry-run'],
    mutates: true, idempotent: true, require_auth: true, backend_call: { type: 'http', path: '/portal_spaces/grant-authorize' },
    handler(ctx) {
      if (!ctx.options.template) throw usageError('Pass --template <file> with the canonical action template.');
      return remote(ctx, 'grant-authorize', { body: { space_id: ctx.args.spaceId, request_id: requestId(ctx),
        template: object(readFileSync(resolve(ctx.options.template), 'utf8'), '--template'),
        document_id: ctx.options.record, dry_run: Boolean(ctx.options.dryRun) } });
    },
  },
  {
    command_path: ['spaces', 'grants', 'revoke'], summary: 'Revoke one saved Space authorization.',
    when_to_use: 'Stop future dispatches for an authorization you issued or can administer.',
    args_schema: { arguments: [{ token: '<grant-id>', key: 'grantId', description: 'Exact grant ID from grants list.' }] },
    examples: ['notis spaces grants revoke <grant-id>'], mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/grant-revoke' },
    handler: ctx => remote(ctx, 'grant-revoke', { body: { grant_id: ctx.args.grantId } }),
  },
  {
    command_path: ['spaces', 'store', 'list'], summary: 'List Space Store listings you can see.',
    when_to_use: 'Find Space templates published to your team or approved for everyone, and your own listings.',
    args_schema: { options: [{ flags: '--channel <team|public>', description: 'Only one channel.' }] },
    examples: ['notis spaces store list --channel team'], mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/store-listings' },
    handler: ctx => remote(ctx, 'store-listings', { method: 'GET', query: { channel: ctx.options.channel } }),
  },
  {
    command_path: ['spaces', 'store', 'get'], summary: 'Read one Store listing with its versions and your installs.',
    when_to_use: 'Check what a listing contains, its review state and whether your copies have an update.',
    args_schema: { arguments: [{ token: '<listing-id>', key: 'listingId', description: 'Exact listing ID.' }] },
    examples: ['notis spaces store get <listing-id>'], mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/store-listing' },
    handler: ctx => remote(ctx, 'store-listing', { method: 'GET', query: { listing_id: ctx.args.listingId } }),
  },
  {
    command_path: ['spaces', 'store', 'installs'], summary: 'List the Spaces you installed from the Store.',
    when_to_use: 'See which installed copies have an update or conflicts to resolve.',
    args_schema: {}, examples: ['notis spaces store installs'], mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_spaces/store-installs' },
    handler: ctx => remote(ctx, 'store-installs', { method: 'GET' }),
  },
  {
    command_path: ['spaces', 'store', 'publish'], summary: 'Publish a Space and its sub-Spaces as the next Store version.',
    when_to_use: 'Share a Space as an installable template: team listings publish at once, public ones wait for review.',
    args_schema: { arguments: [idArgument], options: [{ flags: '--channel <team|public>', description: 'Where to publish.' },
      { flags: '--metadata <json>', description: 'Listing name, tagline, description, category, icon, accent.' },
      { flags: '--starter <json>', description: 'Starter row IDs per database ({"<database-id>":["<record-key>"]}).' },
      { flags: '--notes <text>', description: 'Release notes for this version.' },
      requestOption, { flags: '--dry-run', description: 'Show the package counts and review diff without publishing.' }] },
    examples: ['notis spaces store publish <space-id> --channel team --request-id publish-1 --dry-run'],
    mutates: true, idempotent: true, require_auth: true, backend_call: { type: 'http', path: '/portal_spaces/store-publish' },
    handler(ctx) {
      if (!['team', 'public'].includes(ctx.options.channel)) throw usageError('Pass --channel team or --channel public.');
      return remote(ctx, 'store-publish', { body: { space_id: ctx.args.spaceId, channel: ctx.options.channel, request_id: requestId(ctx),
        ...(ctx.options.metadata ? { metadata: object(ctx.options.metadata, '--metadata') } : {}),
        ...(ctx.options.starter ? { starter: object(ctx.options.starter, '--starter') } : {}),
        ...(ctx.options.notes ? { notes: ctx.options.notes } : {}), dry_run: Boolean(ctx.options.dryRun) } });
    },
  },
  {
    command_path: ['spaces', 'store', 'install'], summary: 'Install a Store listing as your own independent copy.',
    when_to_use: 'Add a published Space template to your account; your copy keeps your changes on later updates.',
    args_schema: { arguments: [{ token: '<listing-id>', key: 'listingId', description: 'Exact listing ID.' }],
      options: [{ flags: '--name <name>', description: 'Name of the installed top Space.' },
        { flags: '--parent <space-id>', description: 'Install under one of your Spaces.' },
        requestOption, { flags: '--dry-run', description: 'Show what the copy contains without installing.' }] },
    examples: ['notis spaces store install <listing-id> --request-id install-1'],
    mutates: true, idempotent: true, require_auth: true, backend_call: { type: 'http', path: '/portal_spaces/store-install' },
    handler: ctx => remote(ctx, 'store-install', { body: { listing_id: ctx.args.listingId, request_id: requestId(ctx),
      ...(ctx.options.name ? { name: ctx.options.name } : {}), ...(ctx.options.parent ? { parent_space_id: ctx.options.parent } : {}),
      dry_run: Boolean(ctx.options.dryRun) } }),
  },
  {
    command_path: ['spaces', 'store', 'update'], summary: 'Update an installed copy, keeping your changes, or resolve its conflicts.',
    when_to_use: 'Take a newer Store version: unchanged parts update, your edits stay, and parts both sides changed become conflicts you resolve.',
    args_schema: { arguments: [{ token: '<install-id>', key: 'installId', description: 'Exact install ID from store installs.' }],
      options: [{ flags: '--resolve <json>', description: 'Per conflict key: "keep_mine" or "take_theirs".' },
        requestOption, { flags: '--dry-run', description: 'Show the three-way plan without changing anything.' }] },
    examples: ['notis spaces store update <install-id> --request-id update-1 --dry-run',
      'notis spaces store update <install-id> --resolve \'{"skill:<key>":"keep_mine"}\' --request-id resolve-1'],
    mutates: true, idempotent: true, require_auth: true, backend_call: { type: 'http', path: '/portal_spaces/store-update' },
    handler: ctx => remote(ctx, 'store-update', { body: { install_id: ctx.args.installId, request_id: requestId(ctx),
      ...(ctx.options.resolve ? { resolution: object(ctx.options.resolve, '--resolve') } : {}), dry_run: Boolean(ctx.options.dryRun) } }),
  },
  {
    command_path: ['spaces', 'store', 'unpublish'], summary: 'Stop new installs of a Store listing.',
    when_to_use: 'Withdraw a listing: existing copies keep working and a version waiting for review is withdrawn.',
    args_schema: { arguments: [{ token: '<listing-id>', key: 'listingId', description: 'Exact listing ID.' }], options: [requestOption] },
    examples: ['notis spaces store unpublish <listing-id> --request-id unpublish-1'],
    mutates: true, idempotent: true, require_auth: true, backend_call: { type: 'http', path: '/portal_spaces/store-unpublish' },
    handler: ctx => remote(ctx, 'store-unpublish', { body: { listing_id: ctx.args.listingId, request_id: requestId(ctx) } }),
  },
  {
    command_path: ['spaces', 'build'],
    summary: 'Build one independent Space and save its frozen source/artifact snapshot.',
    when_to_use: 'Prepare a selected Space for verification without publishing it or changing siblings.',
    args_schema: { arguments: [{ token: '[dir]', key: 'dir', description: 'Source workspace (default current directory).' }],
      options: [{ flags: '--space <key>', description: 'Exact source key from the workspace Space index.' }] },
    examples: ['notis spaces build . --space overview'],
    mutates: true, idempotent: true, require_auth: false,
    backend_call: { type: 'local', name: 'space_build' },
    async handler(ctx) {
      const { directory, key } = selected(ctx);
      const result = await buildSpaceArtifact(directory, key, { stdio: ctx.output.isMachineMode() ? 'pipe' : 'inherit' });
      return ctx.output.emitSuccess({ command: 'spaces build', data: result, humanSummary: `Built ${key}; no Space was published.` });
    },
  },
  {
    command_path: ['spaces', 'inspect'],
    summary: 'Inspect one local Space definition and its declared capabilities.',
    when_to_use: 'Read the selected source definition without loading sibling definitions or account resources.',
    args_schema: { arguments: [{ token: '[dir]', key: 'dir', description: 'Source workspace (default current directory).' }],
      options: [{ flags: '--space <key>', description: 'Exact source key from the workspace Space index.' }] },
    examples: ['notis spaces inspect . --space overview'],
    mutates: false, idempotent: true, require_auth: false,
    backend_call: { type: 'local', name: 'space_source_inspect' },
    async handler(ctx) {
      const { directory, key } = selected(ctx);
      const selection = await loadSelectedSpace(directory, key);
      return ctx.output.emitSuccess({ command: 'spaces inspect', data: { key, definition: selection.definition, definition_path: selection.definitionPath },
        humanSummary: `${selection.definition.name} (${key})` });
    },
  },
];
