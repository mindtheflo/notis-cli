import { usageError } from '../runtime/errors.js';
import { httpRequest } from '../runtime/transport.js';
import { unifiedDiffSummary, versionName } from './version-history.js';

const documentArgument = { token: '<document-id>', key: 'documentId', description: 'Exact document ID.' };
const versionOption = { flags: '--version-id <version-id>', description: 'Saved version ID from versions list.' };

async function remote(ctx, operation, { method = 'POST', body, query, humanSummary } = {}) {
  const suffix = query ? `?${new URLSearchParams(Object.entries(query).filter(([, value]) => value != null))}` : '';
  const result = await httpRequest({ runtime: ctx.runtime, method, path: `/portal_documents/${operation}${suffix}`, body, spacesProtocol: true });
  return ctx.output.emitSuccess({ command: ctx.spec.command_path.join(' '), data: result.payload,
    humanSummary: humanSummary ? humanSummary(result.payload) : JSON.stringify(result.payload, null, 2),
    meta: { mutating: method !== 'GET', request_id: result.requestId } });
}

function versionId(options) {
  if (typeof options.versionId !== 'string' || !options.versionId.trim()) throw usageError('Pass --version-id with a saved version ID from versions list.');
  return options.versionId;
}

function limit(value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw usageError('Pass --limit as a whole number from 1 to 100.');
  return Number(value);
}

function confirmed(options, what) {
  if (!options.yes) throw usageError(`${what} cannot be undone. Only do it when the user asked, then pass --yes.`);
}

export const documentsCommandSpecs = [
  {
    command_path: ['documents', 'versions', 'list'],
    summary: 'Read a document’s saved versions, newest first.',
    when_to_use: 'See when and by whom a document changed, before comparing or restoring a version.',
    args_schema: { arguments: [documentArgument], options: [
      { flags: '--before <version-id>', description: 'Read versions older than this version.' },
      { flags: '--limit <count>', description: 'How many versions to read (1 to 100).' },
    ] },
    examples: ['notis documents versions list <document-id>'], mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/versions' },
    handler(ctx) {
      return remote(ctx, 'versions', { method: 'GET', query: { document_id: ctx.args.documentId,
        before: ctx.options.before, limit: limit(ctx.options.limit) } });
    },
  },
  {
    command_path: ['documents', 'versions', 'read'],
    summary: 'Read one saved version of a document.',
    when_to_use: 'See exactly what a saved version said, before comparing or restoring it.',
    args_schema: { arguments: [documentArgument], options: [versionOption] },
    examples: ['notis documents versions read <document-id> --version-id <version-id>'],
    mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/versions/read' },
    handler(ctx) {
      return remote(ctx, 'versions/read', { method: 'GET', query: { document_id: ctx.args.documentId, version_id: versionId(ctx.options) } });
    },
  },
  {
    command_path: ['documents', 'versions', 'diff'],
    summary: 'Compare two saved versions of a document, or one with the current version.',
    when_to_use: 'See what changed between versions. Prints the unified diff; pass --json for the full comparison.',
    args_schema: { arguments: [documentArgument], options: [
      { flags: '--from <version-id>', description: 'The older saved version.' },
      { flags: '--to <version-id>', description: 'The newer saved version, or current (default).' },
    ] },
    examples: ['notis documents versions diff <document-id> --from <version-id>',
      'notis documents versions diff <document-id> --from <version-id> --to <version-id> --json'],
    mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/versions/diff' },
    handler(ctx) {
      if (typeof ctx.options.from !== 'string' || !ctx.options.from.trim()) throw usageError('Pass --from with a saved version ID from versions list.');
      return remote(ctx, 'versions/diff', { method: 'GET', humanSummary: unifiedDiffSummary,
        query: { document_id: ctx.args.documentId, from: ctx.options.from, to: ctx.options.to || 'current' } });
    },
  },
  {
    command_path: ['documents', 'versions', 'restore'],
    summary: 'Bring a document back to a saved version; what it replaces is kept as a version.',
    when_to_use: 'Undo changes to a document by restoring an earlier version.',
    args_schema: { arguments: [documentArgument], options: [versionOption,
      { flags: '--request-id <id>', description: 'Stable restore request ID; reuse on retry.' }] },
    examples: ['notis documents versions restore <document-id> --version-id <version-id> --request-id undo-edit'],
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/versions/restore' },
    handler(ctx) {
      const version = versionId(ctx.options);
      if (!ctx.options.requestId) throw usageError('Pass a stable --request-id and reuse it on retry.');
      return remote(ctx, 'versions/restore', { body: { document_id: ctx.args.documentId, version_id: version,
        request_id: ctx.options.requestId } });
    },
  },
  {
    command_path: ['documents', 'versions', 'name'],
    summary: 'Name a saved version of a document, or clear its name.',
    when_to_use: 'Mark a version worth keeping. Named versions are kept past the usual retention.',
    args_schema: { arguments: [documentArgument], options: [versionOption,
      { flags: '--name <name>', description: 'The version name.' },
      { flags: '--clear', description: 'Remove the version name.' }] },
    examples: ['notis documents versions name <document-id> --version-id <version-id> --name "Final draft"'],
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/versions/name' },
    handler(ctx) {
      return remote(ctx, 'versions/name', { body: { document_id: ctx.args.documentId, version_id: versionId(ctx.options),
        name: versionName(ctx.options) } });
    },
  },
  {
    command_path: ['documents', 'versions', 'delete'],
    summary: 'Delete one saved version of a document for good.',
    when_to_use: 'Only when the user asked to delete this version. It cannot be restored afterwards.',
    args_schema: { arguments: [documentArgument], options: [versionOption,
      { flags: '--yes', description: 'Confirm the user asked to delete this version for good.' }] },
    examples: ['notis documents versions delete <document-id> --version-id <version-id> --yes'],
    mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/versions/delete' },
    handler(ctx) {
      const version = versionId(ctx.options);
      confirmed(ctx.options, 'Deleting a saved version');
      return remote(ctx, 'versions/delete', { body: { document_id: ctx.args.documentId, version_id: version } });
    },
  },
  {
    command_path: ['documents', 'bin', 'list'],
    summary: 'List the documents in your Bin.',
    when_to_use: 'Find a deleted document to bring back, or to remove for good.',
    args_schema: { arguments: [], options: [] },
    examples: ['notis documents bin list'], mutates: false, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/bin' },
    handler(ctx) {
      return remote(ctx, 'bin', { method: 'GET' });
    },
  },
  {
    command_path: ['documents', 'bin', 'restore'],
    summary: 'Bring a document back from the Bin.',
    when_to_use: 'Undo deleting a document.',
    args_schema: { arguments: [documentArgument], options: [] },
    examples: ['notis documents bin restore <document-id>'], mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/bin/restore' },
    handler(ctx) {
      return remote(ctx, 'bin/restore', { body: { document_id: ctx.args.documentId } });
    },
  },
  {
    command_path: ['documents', 'bin', 'remove'],
    summary: 'Remove a document from the Bin for good.',
    when_to_use: 'Only when the user asked to remove this document for good. It cannot be brought back afterwards.',
    args_schema: { arguments: [documentArgument], options: [
      { flags: '--yes', description: 'Confirm the user asked to remove this document for good.' }] },
    examples: ['notis documents bin remove <document-id> --yes'], mutates: true, idempotent: true, require_auth: true,
    backend_call: { type: 'http', path: '/portal_documents/bin/remove' },
    handler(ctx) {
      confirmed(ctx.options, 'Removing a document from the Bin');
      return remote(ctx, 'bin/remove', { body: { document_id: ctx.args.documentId } });
    },
  },
];
