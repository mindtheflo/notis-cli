import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { CliError, EXIT_CODES } from './errors.js';
import {
  DEFAULT_PROFILE,
  credentialIsExpired,
  getProfile,
  getJwtSubject,
  isJwtExpired,
  loadConfig,
} from './profiles.js';
import { createExpiredAuthError, createInvalidAuthHints } from './desktop-auth.js';
import { refreshOAuthCredential } from './oauth.js';

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

function normalizeBackendError(status, payload, runtime) {
  const backendError = payload?.error;
  const message =
    backendError?.message ||
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

  if (status === 403) {
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

function reloadJwtFromConfig(runtime, loadedProfile = null) {
  if (runtime.credentialKind === 'env' || runtime.credentialKind === 'oauth') {
    return false;
  }
  const profileName = runtime.profileName || DEFAULT_PROFILE;
  let profile = loadedProfile;
  if (!profile) {
    try {
      profile = getProfile(loadConfig(runtime.worktreeRuntime), profileName);
    } catch {
      return false;
    }
  }
  const nextJwt = typeof profile.jwt === 'string' && profile.jwt ? profile.jwt : null;
  if (!nextJwt || nextJwt === runtime.jwt) {
    return false;
  }
  const expectedUserId = runtime.worktreeRuntime?.expected_user_id;
  if (expectedUserId && getJwtSubject(nextJwt) !== expectedUserId) {
    throw new CliError({
      code: 'dev_runtime_identity_mismatch',
      message: 'The refreshed scoped dev credential does not belong to this worktree test user',
      exitCode: EXIT_CODES.auth,
      hints: [
        { message: 'Restart ./dev.sh to restore the approved worktree identity.' },
        { message: `Expected user: ${expectedUserId}` },
      ],
    });
  }
  runtime.jwt = nextJwt;
  runtime.credentialKind = runtime.worktreeRuntime ? 'worktree' : 'desktop';
  runtime.desktopAppName = profile.desktop_app_name;
  runtime.desktopPid = profile.desktop_pid;
  return true;
}

export async function httpRequest({
  runtime,
  method = 'POST',
  path,
  body,
  multipart = false,
  requireAuth = true,
}) {
  // The desktop renderer is the single owner of the rotating Supabase refresh
  // token. Each CLI request only consumes the newest access token it synced to
  // disk, avoiding refresh-token races between independent CLI processes and
  // the running desktop session.
  let currentProfile;
  if (runtime.credentialKind === 'oauth') {
    if (requireAuth && credentialIsExpired(runtime, {
      oauth_access_expires_at: runtime.oauthAccessExpiresAt,
    })) {
      await refreshOAuthCredential(runtime);
    }
    currentProfile = getProfile(
      loadConfig(runtime.worktreeRuntime),
      runtime.profileName,
    );
  } else {
    currentProfile = getProfile(
      loadConfig(runtime.worktreeRuntime),
      runtime.profileName,
    );
    reloadJwtFromConfig(runtime, currentProfile);
  }
  if (requireAuth && credentialIsExpired(runtime, currentProfile)) {
    throw createExpiredAuthError(runtime);
  }

  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), runtime.timeoutMs);
  const requestId = `req_${randomUUID().replace(/-/g, '')}`;
  const resetTimeout = () => {
    clearTimeout(timeout);
    controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), runtime.timeoutMs);
  };

  const headers = {
    'X-Notis-CLI-Version': runtime.cliVersion,
    'X-Notis-Request-Id': requestId,
  };
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
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status === 401) {
      const refreshed = runtime.credentialKind === 'oauth'
        ? await refreshOAuthCredential(runtime)
        : reloadJwtFromConfig(runtime) && !isJwtExpired(runtime.jwt);
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
        try {
          payload = await response.json();
        } catch {
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
          getProfile(loadConfig(runtime.worktreeRuntime), runtime.profileName),
        )
      ) {
        throw createExpiredAuthError(runtime);
      }
      throw normalizeBackendError(response.status, payload, runtime);
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
  const requestId = idempotencyKey || (runtime.mutating ? randomUUID() : null);
  const payload = {
    tool_name: toolName,
    arguments: argumentsPayload,
    idempotency_key: requestId,
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
  };

  if (Array.isArray(fileBindings) && fileBindings.length) {
    const bindingMetadata = fileBindings.map((binding) => {
      const {
        contentType,
        localPath,
        ...metadata
      } = binding;
      return metadata;
    });

    return httpRequest({
      runtime,
      path: '/cli_tools',
      body: () => createMultipartFileUpload(payload, bindingMetadata, fileBindings),
      multipart: true,
    });
  }

  return httpRequest({
    runtime,
    path: '/cli_tools',
    body: payload,
  });
}
