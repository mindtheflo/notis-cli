/** Pure fixture adapter for the exact CLI/service renderer; no network client. */
import { createSpaceFixtureEngine, spaceHarnessSnapshot } from './space-test-server.js';
import { usageError } from './errors.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function createSpaceFixtureBroker({ release, capabilities, width, outputs = ['markdown', 'screenshot'],
  authorizationMode = 'authorize_missing', unavailableActions = [] }) {
  const engine = createSpaceFixtureEngine(release);
  const frozen = spaceHarnessSnapshot(release, capabilities, engine, { authorizationMode, unavailableActions });
  const calls = [];
  const params = structuredClone(engine.context.params || {});
  const value = { ...frozen, url: `https://app.notis.ai/verification/${encodeURIComponent(release.manifest.local_key)}`,
    view: { space_id: frozen.descriptor.resource.id, name: release.manifest.name, revision: 1 },
    locale: engine.context.locale === 'fr' ? 'fr' : 'en', params,
    markdownExport: release.manifest.markdown?.export_name || null, render_options: { outputs, width } };
  return {
    fixtureDigest: engine.digest,
    calls,
    async snapshot() { return structuredClone(value); },
    async read(request) {
      let result;
      const log = { operation: request?.operation, ...(request?.action_id ? { actionId: request.action_id } : {}), ok: false };
      calls.push(log);
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
      } else if (['record', 'html', 'report'].includes(request?.operation) && exact(request, ['operation', 'record_key'])) {
        result = engine.executeRecordView(request.operation, request.record_key);
      } else {
        throw usageError('Only declared read-only synthetic fixtures are available.');
      }
      log.ok = true;
      return result;
    },
    async finish() {
      if (calls.some(value => !value.ok)) throw usageError('A synthetic fixture read failed.');
      return { valid: true };
    },
  };
}
