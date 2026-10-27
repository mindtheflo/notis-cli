import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname } from 'node:path';
import { CliError, EXIT_CODES } from './errors.js';
import {
  credentialIsExpired,
  getJwtExpiration,
  getJwtSubject,
  getProfile,
  isJwtExpired,
  loadConfig,
  resolveWorktreeRuntime,
} from './profiles.js';
import { createExpiredAuthError, createInvalidAuthHints } from './auth-recovery.js';
import { refreshOAuthCredential } from './oauth.js';
import { findUpsell, renderUpsell } from './upsell.js';
import { releaseChannelMismatchError } from './release-channel.js';
import {
  callCarriesToolRequestId,
  canReplayRequest,
  findToolOutcomeUnknown,
  isTransientFailure,
  retriesEnabled,
  waitForNextAttempt,
  withAttempts,
} from './retry.js';

function escapeMultipartHeaderValue(value) {
  return String(value ?? '')
    .replace(/"/g, '%22')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function multipartTextPart(boundary, name, value) {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${escapeMultipartHeaderValue(name)}"`,
    '',
    value,
    '',
  ].join('\r\n');
}

function multipartFileHeader(boundary, binding) {
  const filename = escapeMultipartHeaderValue(binding.basename || binding.field_name);
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${escapeMultipartHeaderValue(binding.field_name)}"; filename="${filename}"`,
    `Content-Type: ${binding.contentType || 'application/octet-stream'}`,
    '',
    '',
  ].join('\r\n');
}

async function* multipartFileBody(boundary, payload, bindingMetadata, fileBindings) {
  yield Buffer.from(multipartTextPart(boundary, 'payload', JSON.stringify(payload)));
  yield Buffer.from(multipartTextPart(boundary, 'file_bindings', JSON.stringify(bindingMetadata)));
  for (const binding of fileBindings) {
    yield Buffer.from(multipartFileHeader(boundary, binding));
    for await (const chunk of createReadStream(binding.localPath)) {
      yield chunk;
    }
    yield Buffer.from('\r\n');
  }
  yield Buffer.from(`--${boundary}--\r\n`);
}

function createMultipartFileUpload(payload, bindingMetadata, fileBindings) {
  const boundary = `----notis-cli-${randomUUID().replace(/-/g, '')}`;
  const textParts = [
    multipartTextPart(boundary, 'payload', JSON.stringify(payload)),
    multipartTextPart(boundary, 'file_bindings', JSON.stringify(bindingMetadata)),
  ];
  const fileHeaderParts = fileBindings.map((binding) => multipartFileHeader(boundary, binding));
  const closingPart = `--${boundary}--\r\n`;
  const contentLength = [
    ...textParts,
    ...fileHeaderParts,
    ...fileBindings.map(() => '\r\n'),
    closingPart,
  ].reduce((total, part) => total + Buffer.byteLength(part), 0)
    + fileBindings.reduce((total, binding) => total + binding.size, 0);

  return {
    body: multipartFileBody(boundary, payload, bindingMetadata, fileBindings),
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(contentLength),
    },
    duplex: 'half',
  };
}

// The Spaces client protocol this CLI speaks. The server refuses every other
// version with a 410 `client_update_required` answer, so an older CLI is told
// to update instead of half-working.
export const SPACES_PROTOCOL = 2;
export const CLI_UPDATE_COMMAND = 'npx --package @notis_ai/cli@latest -- notis';

export function normalizeBackendError(status, payload, runtime) {
  const backendError = payload?.error;
  if (backendError === 'client_update_required') {
    return new CliError({
      code: 'cli_update_required',
      message: `This Notis CLI is too old for Spaces. Run the latest one with: ${CLI_UPDATE_COMMAND}`,
      exitCode: EXIT_CODES.usage,
      details: payload || {},
      hints: [{ command: CLI_UPDATE_COMMAND, reason: 'Run your command again with the latest Notis CLI' }],
    });
  }
  // Space errors answer {error: <stable code>, message: <readable text>}: show
  // the text (it can name the Space involved); the code stays in details.
  const codedMessage = typeof backendError === 'string' && /^[a-z][a-z0-9_]*$/.test(backendError)
    && typeof payload?.message === 'string' && payload.message ? payload.message : null;
  const message =
    backendError?.message ||
    codedMessage ||
    backendError ||
    payload?.message ||
    payload?.error ||
    `Request failed with status ${status}`;

  if (status === 401) {
    return new CliError({
      code: 'auth_invalid',
      message,
      exitCode: EXIT_CODES.auth,
      hints: [
        ...createInvalidAuthHints(runtime),
      ],
      details: payload || {},
    });
  }

  if (status === 409) {
    return new CliError({
      code: 'conflict',
      message,
      exitCode: EXIT_CODES.conflict,
      retryable: false,
      hints: payload?.hints || [],
      details: payload || {},
    });
  }

  if (status === 403 && backendError === 'release_channel_mismatch') {
    // The account belongs to the other release channel's API. Nothing here
    // can be retried; signing the profile in on its own channel fixes it.
    return releaseChannelMismatchError(payload, runtime);
  }

  if (status === 403) {
    const upsellBody = findUpsell(payload);
    if (upsellBody) {
      // Same code as every 403 so callers that treat a refusal as "not
      // available" keep working; the message and hints are the shared upsell.
      const rendered = renderUpsell(upsellBody, { apiBase: runtime?.apiBase });
      return new CliError({
        code: 'forbidden',
        message: rendered.text,
        exitCode: EXIT_CODES.auth,
        details: { ...(payload || {}), upsell: rendered.upsell },
        hints: rendered.hints,
      });
    }
    return new CliError({
      code: 'forbidden',
      message,
      exitCode: EXIT_CODES.auth,
      details: payload || {},
      hints: [
        { command: 'notis tools toolkits', reason: 'Check which toolkits are available' },
        { command: 'notis whoami', reason: 'Verify your active profile and permissions' },
        ...(payload?.hints || []),
      ],
    });
  }

  if (status === 402) {
    // Distinct from auth on purpose: an agent that sees an auth exit code will
    // loop trying to re-authenticate, when the actual fix is to add credit.
    return new CliError({
      code: 'payment_required',
      message,
      exitCode: EXIT_CODES.payment,
      details: payload || {},
      hints: payload?.hints || [],
    });
  }

  if (status >= 400 && status < 500) {
    return new CliError({
      code: 'usage_error',
      message,
      exitCode: EXIT_CODES.usage,
      details: payload || {},
      hints: payload?.hints || [],
    });
  }

  return new CliError({
    code: 'backend_error',
    message,
    exitCode: EXIT_CODES.backend,
    retryable: status >= 500,
    details: payload || {},
    hints: payload?.hints || [],
  });
}

/**
 * Pick up a dev credential that `./dev.sh` re-minted mid-process.
 *
 * Restarting the local runtime rewrites the worktree lease in place, so a
 * long-running command can recover from a single 401 instead of failing and
 * making the caller rerun it. The refreshed token still has to belong to the
 * worktree's approved test user.
 */
function reloadDevJwt(runtime, loadedProfile = null) {
  if (runtime.credentialKind !== 'worktree') {
    return false;
  }
  let nextJwt = null;
  const expectedUserId = runtime.worktreeRuntime?.expected_user_id;
  const runtimePath = runtime.worktreeRuntime?.runtime_path;
  if (runtimePath) {
    const refreshedRuntime = resolveWorktreeRuntime(dirname(runtimePath));
    if (
      refreshedRuntime
      && !refreshedRuntime.unavailable
      && refreshedRuntime.runtime_path === runtimePath
      && refreshedRuntime.profile === runtime.profileName
      && refreshedRuntime.api_base === runtime.apiBase
    ) {
      if (
        expectedUserId
        && refreshedRuntime.expected_user_id !== expectedUserId
      ) {
        throw new CliError({
          code: 'dev_runtime_identity_mismatch',
          message: 'The restarted worktree runtime belongs to a different test user',
          exitCode: EXIT_CODES.auth,
          hints: [
            { message: 'Restart this CLI command under the worktree\'s current dev identity.' },
            { message: `Expected user: ${expectedUserId}` },
          ],
        });
      }
      runtime.worktreeRuntime = refreshedRuntime;
      nextJwt = refreshedRuntime.dev_access_token;
    }
  }
  let profile = loadedProfile;
  if (!nextJwt && !profile) {
    try {
      profile = getProfile(loadConfig(), runtime.profileName);
    } catch {
      return false;
    }
  }
  nextJwt = nextJwt || (
    typeof profile?.dev_access_token === 'string' && profile.dev_access_token
      ? profile.dev_access_token
      : null
  );
  if (!nextJwt || nextJwt === runtime.jwt) {
    return false;
  }
  if (expectedUserId && getJwtSubject(nextJwt) !== expectedUserId) {
    throw new CliError({
      code: 'dev_runtime_identity_mismatch',
      message: 'The refreshed dev credential does not belong to this worktree test user',
      exitCode: EXIT_CODES.auth,
      hints: [
        { message: 'Restart ./dev.sh to restore the approved worktree identity.' },
        { message: `Expected user: ${expectedUserId}` },
      ],
    });
  }
  runtime.jwt = nextJwt;
  return true;
}

/**
 * A live worktree lease is authoritative over any stale dev metadata left in
 * the shared profile store. Prefer its explicit expiry, then the active JWT's
 * expiry, and deliberately fail closed when neither can be verified.
 */
export function getActiveWorktreeCredentialProfile(runtime, loadedProfile = {}) {
  if (runtime.credentialKind !== 'worktree') {
    return loadedProfile;
  }
  return {
    ...loadedProfile,
    dev_access_expires_at:
      runtime.worktreeRuntime?.dev_access_expires_at
      ?? getJwtExpiration(runtime.jwt)
      ?? loadedProfile.dev_access_expires_at,
  };
}

export async function httpRequest({
  runtime,
  method = 'POST',
  path,
  body,
  multipart = false,
  requireAuth = true,
  spacesProtocol,
  // This attempt's own limit; defaults to the whole --timeout-ms budget.
  timeoutMs = runtime.timeoutMs,
}) {
  // Refresh before spending the credential rather than after a rejection: the
  // rotating refresh token is shared with every other `notis` process reading
  // the same profile, so a lapsed access token is renewed once, under the
  // config write lock, instead of racing on a 401 retry.
  let currentProfile;
  if (runtime.credentialKind === 'oauth') {
    if (requireAuth && credentialIsExpired(runtime, {
      oauth_access_expires_at: runtime.oauthAccessExpiresAt,
    })) {
      await refreshOAuthCredential(runtime);
    }
    currentProfile = getProfile(loadConfig(), runtime.profileName);
  } else {
    currentProfile = getProfile(loadConfig(), runtime.profileName);
    reloadDevJwt(runtime, currentProfile);
    currentProfile = getActiveWorktreeCredentialProfile(runtime, currentProfile);
  }
  if (requireAuth && credentialIsExpired(runtime, currentProfile)) {
    throw createExpiredAuthError(runtime);
  }

  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestId = `req_${randomUUID().replace(/-/g, '')}`;
  const resetTimeout = () => {
    clearTimeout(timeout);
    controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  };

  const headers = {
    'X-Notis-CLI-Version': runtime.cliVersion,
    'X-Notis-Request-Id': requestId,
  };
  if (spacesProtocol) headers['X-Notis-Spaces-Protocol'] = String(SPACES_PROTOCOL);
  if (!multipart) {
    headers['Content-Type'] = 'application/json';
  }

  if (requireAuth && runtime.jwt) {
    headers.Authorization = `Bearer ${runtime.jwt}`;
  }

  const resolveBody = () => {
    if (!multipart) {
      return {
        body: body ? JSON.stringify(body) : undefined,
        headers: {},
      };
    }
    if (typeof body === 'function') {
      return body();
    }
    return {
      body,
      headers: {},
    };
  };

  try {
    let requestBody = resolveBody();
    let response = await fetch(`${runtime.apiBase}${path}`, {
      method,
      headers: { ...headers, ...requestBody.headers },
      body: requestBody.body,
      signal: controller.signal,
      ...(requestBody.duplex ? { duplex: requestBody.duplex } : {}),
    });

    let payload = null;
    let payloadReadError = null;
    try {
      payload = await response.json();
    } catch (error) {
      payloadReadError = error;
      payload = null;
    }

    if (response.status === 401) {
      const refreshed = runtime.credentialKind === 'oauth'
        ? await refreshOAuthCredential(runtime)
        : reloadDevJwt(runtime) && !isJwtExpired(runtime.jwt);
      if (refreshed) {
        if (requireAuth && runtime.jwt) {
          headers.Authorization = `Bearer ${runtime.jwt}`;
        }
        resetTimeout();
        requestBody = resolveBody();
        response = await fetch(`${runtime.apiBase}${path}`, {
          method,
          headers: { ...headers, ...requestBody.headers },
          body: requestBody.body,
          signal: controller.signal,
          ...(requestBody.duplex ? { duplex: requestBody.duplex } : {}),
        });
        payloadReadError = null;
        try {
          payload = await response.json();
        } catch (error) {
          payloadReadError = error;
          payload = null;
        }
      }
    }

    clearTimeout(timeout);

    if (!response.ok) {
      if (
        response.status === 401
        && credentialIsExpired(
          runtime,
          getActiveWorktreeCredentialProfile(
            runtime,
            getProfile(loadConfig(), runtime.profileName),
          ),
        )
      ) {
        throw createExpiredAuthError(runtime);
      }
      const backendError = normalizeBackendError(response.status, payload, runtime);
      // Kept off the serialized error; the retry policy reads the HTTP status.
      backendError.httpStatus = response.status;
      throw backendError;
    }

    // A successful status is not a successful tool call until its response
    // body has been read. Mutations may already have committed before a socket
    // reset truncates the JSON; surface that as an ambiguous network failure
    // so callers never persist an undefined result or attempt a second write.
    if (response.status !== 204 && payloadReadError) {
      throw payloadReadError;
    }

    return {
      requestId,
      payload: payload || {},
    };
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof CliError) {
      throw error;
    }

    if (error?.name === 'AbortError') {
      throw new CliError({
        code: 'network_timeout',
        message: `Request timed out after ${runtime.timeoutMs}ms`,
        exitCode: EXIT_CODES.network,
        retryable: true,
        hints: [
          { command: 'notis doctor', reason: 'Check API reachability' },
          { command: `--timeout-ms ${runtime.timeoutMs * 2}`, reason: 'Retry with a longer timeout' },
        ],
      });
    }

    throw new CliError({
      code: 'network_error',
      message: error instanceof Error ? error.message : String(error),
      exitCode: EXIT_CODES.network,
      retryable: true,
      cause: error,
    });
  }
}

export async function callTool({
  runtime,
  toolName,
  arguments_: argumentsPayload = {},
  idempotencyKey,
  fileBindings = [],
}) {
  const firstKey = idempotencyKey || (runtime.mutating ? randomUUID() : null);
  const buildPayload = (key) => ({
    tool_name: toolName,
    arguments: argumentsPayload,
    idempotency_key: key,
    cli_context: {
      output_mode: runtime.outputMode,
      profile: runtime.profileName,
      cwd: process.cwd(),
      agent_mode: runtime.agentMode,
      cli_version: runtime.cliVersion,
      ...(runtime.debugEntitlementOverride
        ? { debug_entitlement_override: runtime.debugEntitlementOverride }
        : {}),
    },
  });

  const hasFiles = Array.isArray(fileBindings) && fileBindings.length > 0;
  const bindingMetadata = hasFiles
    ? fileBindings.map((binding) => {
      const {
        contentType,
        localPath,
        ...metadata
      } = binding;
      return metadata;
    })
    : [];

  const send = (key, timeoutMs) => (hasFiles
    ? httpRequest({
      runtime,
      path: '/cli_tools',
      // A function, so every attempt streams the files again from the start.
      body: () => createMultipartFileUpload(buildPayload(key), bindingMetadata, fileBindings),
      multipart: true,
      timeoutMs,
    })
    : httpRequest({
      runtime,
      path: '/cli_tools',
      body: buildPayload(key),
      timeoutMs,
    }));

  if (!retriesEnabled(runtime)) {
    let result;
    try {
      result = await send(firstKey, runtime.timeoutMs);
    } catch (error) {
      throw isTransientFailure(error) ? withAttempts(error, 1) : error;
    }
    return { ...result, idempotencyKey: firstKey, attempts: 1 };
  }

  // --timeout-ms bounds the whole call, every attempt included.
  const budgetMs = runtime.timeoutMs;
  const deadline = Date.now() + budgetMs;
  let key = firstKey;
  for (let attempt = 1; ; attempt += 1) {
    let result;
    try {
      result = await send(key, Math.max(1, deadline - Date.now()));
    } catch (error) {
      const transient = isTransientFailure(error);
      if (
        transient
        && canReplayRequest({ mutating: runtime.mutating, idempotencyKey: key })
        && await waitForNextAttempt({ attempt, deadline, budgetMs })
      ) {
        continue;
      }
      throw transient ? withAttempts(error, attempt) : error;
    }

    // The stored answer under this key is the unknown outcome itself, so only
    // a fresh key reaches the tool again; its request_id receipt dedupes it.
    if (
      runtime.mutating
      && key
      && findToolOutcomeUnknown(result.payload)
      && callCarriesToolRequestId(argumentsPayload)
      && await waitForNextAttempt({ attempt, deadline, budgetMs })
    ) {
      key = randomUUID();
      continue;
    }
    return { ...result, idempotencyKey: key, attempts: attempt };
  }
}
