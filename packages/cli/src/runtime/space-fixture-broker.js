/** Pure fixture adapter for the exact CLI/service renderer; no network client. */
import { createSpaceFixtureEngine, selectedFixtureContext, spaceHarnessSnapshot } from './space-test-server.js';
import { usageError } from './errors.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

/** At most this many extra param sets are measured for loading skeletons. */
export const SKELETON_PARAM_SETS_MAX = 4;

/**
 * The extra view params whose loading skeletons are measured too (fixtures `context.skeletonParams`): each is a
 * flat object of string values, such as a tab the view opens on. Anything else is ignored.
 */
export function fixtureSkeletonParams(release) {
  let list;
  try { list = createSpaceFixtureEngine(release).context.skeletonParams; } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter(item => object(item) && Object.values(item).every(value => typeof value === 'string'))
    .slice(0, SKELETON_PARAM_SETS_MAX).map(item => structuredClone(item));
}

/**
 * The fixture contexts verify opens the view in, in order: `[{ name, params, open }]` (`open`: the params open a list
 * item through ListReader's default `open` param). Unreadable fixtures give none; verify reports them on its own.
 */
export function fixtureContexts(release) {
  let engine;
  try { engine = createSpaceFixtureEngine(release); } catch { return []; }
  return engine.contexts.map(({ name, context }) => ({ name, params: structuredClone(context.params || {}),
    open: typeof context.params?.open === 'string' && context.params.open.length > 0 }));
}

/**
 * `context` names the fixture context to open the view with (default: the first). `audience: 'public'` draws the view as the public sees it: the editor's descriptor with View as the public on, so
 * the page applies the public floors itself (no editor-only lists, actions, params or columns), as in the Portal.
 */
export function createSpaceFixtureBroker({ release, capabilities, width, outputs = ['markdown', 'screenshot'],
  authorizationMode = 'authorize_missing', unavailableActions = [], onFailure, params: paramsOverride, audience = 'editor', context: contextName }) {
  const engine = createSpaceFixtureEngine(release);
  const selected = selectedFixtureContext(engine, contextName).context;
  const frozen = spaceHarnessSnapshot(release, capabilities, engine, { authorizationMode, unavailableActions, context: contextName });
  if (audience === 'public') frozen.descriptor.space.viewAs = 'public';
  const calls = [];
  // Skeleton capture may open the view with other params (a tab), on top of the fixture's own.
  const params = structuredClone({ ...(selected.params || {}), ...(paramsOverride || {}) });
  // The fixture's own "now" pins the browser clock, so a view that asks for the
  // last hour sends the exact inputs its fixtures recorded.
  const now = selected.now;
  const fixedClock = typeof now === 'string' && Number.isFinite(Date.parse(now)) ? { fixed_clock: now } : {};
  const value = { ...frozen, url: `https://app.notis.ai/verification/${encodeURIComponent(release.manifest.local_key)}`,
    view: { space_id: frozen.descriptor.resource.id, name: release.manifest.name, revision: 1 },
    locale: selected.locale === 'fr' ? 'fr' : 'en', params,
    markdownExport: release.manifest.markdown?.export_name || null, render_options: { outputs, width }, ...fixedClock,
    asset_images: [...engine.imageUrls] };
  return {
    fixtureDigest: engine.digest,
    calls,
    async snapshot() { return structuredClone(value); },
    async read(request) {
      let result;
      const log = { operation: request?.operation, ...(request?.action_id ? { actionId: request.action_id } : {}),
        ...(typeof request?.record_key === 'string' ? { recordKey: request.record_key } : {}), ok: false };
      calls.push(log);
      try {
        result = readFixture(request);
      } catch (error) {
        // Keep the reason with the call so verify reports which read failed and what the fixture lacks.
        log.error = String(error?.message || error).slice(0, 2000);
        onFailure?.(log);
        throw error;
      }
      log.ok = true;
      return result;
    },
    async finish() {
      const failed = calls.find(value => !value.ok);
      if (failed) throw usageError(failed.error ? `A synthetic fixture read failed: ${failed.error}` : 'A synthetic fixture read failed.');
      return { valid: true };
    },
  };

  function readFixture(request) {
    let result;
    if (calls.length > 256) throw usageError('The offline fixture read limit was reached.');
    if (request?.operation === 'action' && exact(request, ['operation', 'action_id', 'inputs', 'request_id'])) {
      if (frozen.descriptor.space.actions[request.action_id]?.readOnly !== true) throw usageError('Offline verification never runs write actions.');
      result = engine.execute(request.action_id, request.inputs);
    } else if (request?.operation === 'shown' && exact(request, ['operation', 'name', 'params', 'options'])) {
      result = engine.executeShown(request.name, request.params, request.options);
    } else if (request?.operation === 'viewer_read' && exact(request, ['operation', 'name', 'input'])) {
      result = engine.executeViewerRead(request.name, request.input);
    } else if (request?.operation === 'document_body' && exact(request, ['operation', 'record_key', 'binding', 'read_action'])) {
      if (frozen.descriptor.space.actions[request.read_action]?.readOnly !== true) throw usageError('This document read action is unavailable.');
      result = engine.executeBody({ operation: 'read', recordKey: request.record_key, binding: request.binding, readAction: request.read_action });
    } else if (request?.operation === 'asset' && exact(request, ['operation', 'url', 'kind']) && request.kind === 'image') {
      result = engine.executeImage(request.url);
    } else if (['record', 'html', 'report'].includes(request?.operation) && exact(request, ['operation', 'record_key'])) {
      result = engine.executeRecordView(request.operation, request.record_key);
    } else {
      throw usageError('Only declared read-only synthetic fixtures are available.');
    }
    return result;
  }
}
