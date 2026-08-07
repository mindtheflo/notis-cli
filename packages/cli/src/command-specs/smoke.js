import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { usageError } from '../runtime/errors.js';
import {
  COMPOSIO_MULTI_EXECUTE_TOOL,
  fetchToolDiscovery,
  fetchToolSchema,
  nextIdempotencyKey,
  runToolCommand,
} from './helpers.js';
import { mintEntitlementOverride, unwrapToolExecutionPayload } from './diagnostics.js';
import { hashFileSha256, parseFileBindings } from './tools.js';

function discoveryNames(payload) {
  return [...new Set(
    (payload.results || []).flatMap((result) => [
      ...(result.primary_tool_slugs || []),
      ...(result.related_tool_slugs || []),
    ]).filter(Boolean),
  )];
}

function selectDropboxTools(payloads) {
  const names = [...new Set(payloads.flatMap(discoveryNames))];
  const find = (preferred, ...needles) => (
    names.find((name) => name.toUpperCase() === preferred)
    || names.find((name) => {
    const upper = name.toUpperCase();
    return upper.includes('DROPBOX')
      && !upper.includes('ALPHA')
      && needles.every((needle) => upper.includes(needle));
    })
  );
  const tools = {
    upload: find('DROPBOX_UPLOAD_FILE', 'UPLOAD', 'FILE'),
    metadata: find('DROPBOX_GET_METADATA', 'GET', 'METADATA'),
    read: find('DROPBOX_READ_FILE', 'READ', 'FILE')
      || find('DROPBOX_DOWNLOAD_FILE', 'DOWNLOAD', 'FILE'),
    delete: find('DROPBOX_DELETE_FILE', 'DELETE', 'FILE'),
  };
  const missing = Object.entries(tools).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw usageError(`Dropbox smoke could not discover: ${missing.join(', ')}.`);
  }
  return tools;
}

async function fetchDiscoveryWithRetry(ctx, useCase, knownFields) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchToolDiscovery(ctx.runtime, useCase, knownFields);
    } catch (error) {
      if (!error?.retryable || attempt === maxAttempts) throw error;
      ctx.output.emitProgress({
        phase: 'discover-retry',
        message: `Tool discovery transiently failed; retrying (${attempt}/${maxAttempts - 1})`,
        requestId: error?.details?.request_id || null,
      });
      await delay(250 * (2 ** (attempt - 1)));
    }
  }
  throw usageError('Dropbox tool discovery exhausted its retries.');
}

function targetResponse(payload) {
  const unwrapped = unwrapToolExecutionPayload(payload);
  if (unwrapped?.results?.[0]?.response) return unwrapped.results[0].response;
  if (payload?.data?.results?.[0]?.response) return payload.data.results[0].response;
  if (payload?.results?.[0]?.response) return payload.results[0].response;
  return unwrapped;
}

function requireSuccessfulResponse(payload, phase) {
  const response = targetResponse(payload);
  if (!response || response.successful === false || payload?.successful === false) {
    throw usageError(`Dropbox ${phase} failed.`, { phase, response });
  }
  return response.data ?? response;
}

async function executeDropboxTool(ctx, toolName, args, {
  mutating,
  fileBindings = [],
  phase,
}) {
  ctx.output.emitProgress({ phase, message: `${phase} via ${toolName}` });
  const baseIdempotencyKey = mutating ? nextIdempotencyKey(ctx.globalOptions) : null;
  const result = await runToolCommand({
    runtime: ctx.runtime,
    toolName: COMPOSIO_MULTI_EXECUTE_TOOL,
    arguments_: { tools: [{ tool_slug: toolName, arguments: args }] },
    mutating,
    idempotencyKey: baseIdempotencyKey ? `${baseIdempotencyKey}:${phase}` : null,
    fileBindings,
  });
  return result;
}

function remotePath(folder, name) {
  const normalizedFolder = `/${String(folder || '/Notis Tests/cli-file-upload')
    .split('/')
    .filter(Boolean)
    .join('/')}`;
  return `${normalizedFolder}/${name}`;
}

async function smokeFileUploadHandler(ctx) {
  const tempDir = mkdtempSync(join(tmpdir(), 'notis-smoke-file-upload-'));
  const marker = `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
  const generatedFixture = !ctx.options.sourceFile;
  const fixturePath = ctx.options.sourceFile || join(tempDir, `notis-file-upload-${marker}.txt`);
  if (generatedFixture) {
    writeFileSync(
      fixturePath,
      `Notis Dropbox file-upload smoke\nmarker=${marker}\nunicode=été Zürich 東京\n`,
      'utf-8',
    );
  }
  const localHash = await hashFileSha256(fixturePath);
  const localBytes = readFileSync(fixturePath);
  const destination = remotePath(
    ctx.options.remoteFolder,
    `notis-file-upload-${marker}-${basename(fixturePath)}`,
  );
  const result = {
    marker,
    destination,
    local: { bytes: localBytes.length, sha256: localHash },
    phases: [],
    request_ids: {},
    cleanup: { attempted: false, deleted: false, not_found_verified: false },
    parity: null,
  };
  let uploadAttempted = false;
  let deleted = false;
  let revision = null;
  let tools;

  try {
    ctx.output.emitProgress({ phase: 'discover', message: 'Resolving Dropbox upload, metadata, read, and delete capabilities' });
    // Discover sequentially. Both calls can materialize the same provider session,
    // and racing that initialization has caused otherwise healthy smoke runs to
    // fail with a transient "Server disconnected" before any upload occurred.
    const discoveries = [
      await fetchDiscoveryWithRetry(
        ctx,
        'Upload a local file to Dropbox, get its exact metadata, and read the same file bytes back',
        'path, content, strict_conflict',
      ),
      await fetchDiscoveryWithRetry(
        ctx,
        'Delete one Dropbox file by exact canonical path and parent revision, then verify metadata reports path not found',
        'path, parent_rev',
      ),
    ];
    tools = selectDropboxTools(discoveries);
    const uploadSchema = await fetchToolSchema(ctx.runtime, tools.upload);
    if (uploadSchema.parameters?.properties?.content?.file_uploadable !== true) {
      throw usageError(`${tools.upload} content is not marked file_uploadable.`);
    }

    if (ctx.options.parityUser) {
      const minted = await mintEntitlementOverride(ctx, ctx.options.parityUser);
      ctx.runtime.debugEntitlementOverride = minted.override;
      result.parity = {
        requested: true,
        expected_parity_hash: minted.parity_hash,
        reference_scope_type: minted.reference_scope_type,
        persistent: false,
      };
    }

    const fileBindings = await parseFileBindings([`content=${fixturePath}`]);
    uploadAttempted = true;
    const upload = await executeDropboxTool(
      ctx,
      tools.upload,
      { path: destination, strict_conflict: true, mode: 'add', autorename: false },
      { mutating: true, fileBindings, phase: 'upload' },
    );
    result.request_ids.upload = upload.requestId;
    const uploadData = requireSuccessfulResponse(upload.payload, 'upload');
    const appliedParity = upload.payload?.debug_entitlement_override;
    if (result.parity) {
      if (!appliedParity?.applied || appliedParity.parity_hash !== result.parity.expected_parity_hash) {
        throw usageError('Backend did not assert the requested entitlement parity before upload.');
      }
      result.parity.applied = true;
      result.parity.expires_at = appliedParity.expires_at;
    }
    revision = uploadData.rev;
    result.upload = {
      path: uploadData.path_display,
      revision,
      bytes: uploadData.size,
      provider_content_hash: uploadData.content_hash,
    };
    result.phases.push('upload');

    const metadata = await executeDropboxTool(
      ctx,
      tools.metadata,
      { path: uploadData.path_display || destination },
      { mutating: false, phase: 'metadata' },
    );
    result.request_ids.metadata = metadata.requestId;
    const metadataData = requireSuccessfulResponse(metadata.payload, 'metadata').metadata;
    if (!metadataData || metadataData.rev !== revision || Number(metadataData.size) !== localBytes.length) {
      throw usageError('Dropbox metadata did not match the uploaded file revision and byte count.');
    }
    result.metadata = {
      path: metadataData.path_display,
      revision: metadataData.rev,
      bytes: metadataData.size,
    };
    result.phases.push('metadata');

    const read = await executeDropboxTool(
      ctx,
      tools.read,
      { path: metadataData.path_display },
      { mutating: false, phase: 'download' },
    );
    result.request_ids.download = read.requestId;
    const readData = requireSuccessfulResponse(read.payload, 'read');
    const signedUrl = readData.content?.s3url;
    if (!signedUrl) throw usageError('Dropbox read did not return a temporary download URL.');
    const downloadResponse = await fetch(signedUrl);
    if (!downloadResponse.ok) {
      throw usageError(`Dropbox temporary download returned HTTP ${downloadResponse.status}.`);
    }
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
    const downloadedHash = createHash('sha256').update(downloaded).digest('hex');
    if (downloadedHash !== localHash) {
      throw usageError('Downloaded Dropbox bytes did not match the uploaded fixture hash.');
    }
    result.download = {
      bytes: downloaded.length,
      sha256: downloadedHash,
      hash_match: true,
    };
    result.phases.push('download');

    result.cleanup.attempted = true;
    const deletion = await executeDropboxTool(
      ctx,
      tools.delete,
      { path: metadataData.path_display, parent_rev: revision },
      { mutating: true, phase: 'delete' },
    );
    result.request_ids.delete = deletion.requestId;
    requireSuccessfulResponse(deletion.payload, 'delete');
    result.cleanup.deleted = true;
    result.phases.push('delete');

    const finalMetadata = await executeDropboxTool(
      ctx,
      tools.metadata,
      { path: metadataData.path_display },
      { mutating: false, phase: 'verify-not-found' },
    );
    result.request_ids.verify_not_found = finalMetadata.requestId;
    const finalResponse = targetResponse(finalMetadata.payload);
    const finalText = JSON.stringify(finalResponse);
    if (finalResponse?.successful !== false || !finalText.includes('path/not_found')) {
      throw usageError('Dropbox cleanup verification did not return path/not_found.');
    }
    result.cleanup.not_found_verified = true;
    deleted = true;
    result.phases.push('verify-not-found');
    ctx.output.emitProgress({ phase: 'complete', message: 'Dropbox file-upload smoke passed with verified cleanup' });
    return ctx.output.emitSuccess({
      command: ctx.spec.command_path.join(' '),
      data: { ...result, tools },
      humanSummary: `Dropbox file-upload smoke passed for ${destination}; SHA-256 matched and cleanup was verified.`,
      requestId: result.request_ids.verify_not_found,
      meta: { mutating: true, cleaned_up: true },
      renderHuman: () => JSON.stringify({ ...result, tools }, null, 2),
    });
  } catch (error) {
    if (error && typeof error === 'object') {
      error.details = {
        ...(error.details || {}),
        smoke_result: { ...result, tools },
      };
    }
    throw error;
  } finally {
    if (uploadAttempted && !result.cleanup.not_found_verified && tools) {
      result.cleanup.attempted = true;
      try {
        let cleanupRevision = revision;
        if (!cleanupRevision) {
          const recoveryMetadata = await executeDropboxTool(
            ctx,
            tools.metadata,
            { path: destination },
            { mutating: false, phase: 'recover-cleanup-metadata' },
          );
          result.request_ids.recover_cleanup_metadata = recoveryMetadata.requestId;
          const recoveryResponse = targetResponse(recoveryMetadata.payload);
          const recoveryText = JSON.stringify(recoveryResponse);
          if (recoveryResponse?.successful === false && recoveryText.includes('path/not_found')) {
            result.cleanup.deleted = true;
            result.cleanup.not_found_verified = true;
          } else {
            const recoveryData = requireSuccessfulResponse(recoveryMetadata.payload, 'cleanup metadata');
            cleanupRevision = recoveryData.metadata?.rev || recoveryData.rev;
            if (!cleanupRevision) {
              throw usageError('Dropbox cleanup metadata did not return the uploaded file revision.');
            }
          }
        }
        if (!result.cleanup.not_found_verified) {
          const cleanup = await executeDropboxTool(
            ctx,
            tools.delete,
            { path: destination, parent_rev: cleanupRevision },
            { mutating: true, phase: 'cleanup-after-failure' },
          );
          result.request_ids.cleanup_after_failure = cleanup.requestId;
          const cleanupResponse = targetResponse(cleanup.payload);
          const cleanupText = JSON.stringify(cleanupResponse);
          result.cleanup.deleted = (
            cleanupResponse?.successful === true
            || cleanupText.includes('path/not_found')
          );
        }
        const verification = await executeDropboxTool(
          ctx,
          tools.metadata,
          { path: destination },
          { mutating: false, phase: 'verify-cleanup-after-failure' },
        );
        result.request_ids.verify_cleanup_after_failure = verification.requestId;
        const verificationResponse = targetResponse(verification.payload);
        const verificationText = JSON.stringify(verificationResponse);
        result.cleanup.not_found_verified = (
          verificationResponse?.successful === false
          && verificationText.includes('path/not_found')
        );
        deleted = result.cleanup.not_found_verified;
        result.cleanup.deleted = deleted;
      } catch {
        deleted = false;
        result.cleanup.deleted = false;
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export const smokeCommandSpecs = [
  {
    command_path: ['smoke', 'file-upload'],
    summary: 'Run a complete Dropbox upload/read/hash/delete smoke test.',
    when_to_use: 'Use to prove the local-file bridge and connected Dropbox behavior under the current or parity entitlement context.',
    args_schema: {
      arguments: [],
      options: [
        { flags: '--source-file <path>', description: 'Use an existing local fixture instead of generating one.' },
        { flags: '--remote-folder <path>', description: 'Unique Dropbox parent folder (default /Notis Tests/cli-file-upload).' },
        { flags: '--parity-user <user>', description: 'Apply this reference user’s effective plan for only the smoke requests.' },
      ],
    },
    examples: [
      'notis smoke file-upload --json',
      'notis smoke file-upload --parity-user user@example.com --json',
    ],
    output_schema: 'Returns structured phase results, request ids, metadata, hashes, parity proof, and cleanup verification.',
    mutates: true,
    idempotent: true,
    related_commands: ['notis debug user-context <user>', 'notis debug entitlement-override <reference-user>'],
    backend_call: { type: 'tool-discovery', name: 'Dropbox upload/read/delete capabilities' },
    handler: smokeFileUploadHandler,
  },
];
