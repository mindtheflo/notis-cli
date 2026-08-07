import { CliError, EXIT_CODES } from './errors.js';

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function defaultDesktopAppName(apiBase) {
  try {
    return new URL(apiBase).hostname === 'api-beta.notis.ai' ? 'Notis Beta' : 'Notis';
  } catch {
    return 'Notis';
  }
}

/**
 * Recovery hints for an unusable desktop-managed credential.
 *
 * `mode` distinguishes the two cases an agent has to act on differently:
 * "expired" means a session existed and the desktop app can renew it, while
 * "missing" means this machine was never signed in — telling that caller to
 * renew something is misleading.
 */
export function getDesktopAuthRecovery(runtime, { mode = 'expired' } = {}) {
  const desktopRunning = isPidRunning(runtime.desktopPid);
  const appName = runtime.desktopAppName || defaultDesktopAppName(runtime.apiBase);
  let command = 'Start the Notis desktop app';
  if (process.platform === 'darwin') {
    command = `open -a ${quoteShellArgument(appName)}`;
  }

  let reason;
  if (mode === 'missing') {
    reason = desktopRunning
      ? `Sign in to ${appName} to authenticate the CLI on this machine, then retry`
      : `Install and sign in to ${appName} to authenticate the CLI on this machine, then retry`;
  } else {
    reason = desktopRunning
      ? `Bring ${appName} forward so it can renew CLI authentication, then retry`
      : `Start ${appName} to renew expired CLI authentication, then retry`;
  }

  const hints = [{ command, reason }];
  if (mode === 'missing') {
    // Leads the list: a machine that was never signed in may not even have an
    // account yet, and `notis start` covers both cases.
    hints.unshift({
      command: 'notis login',
      reason: 'Sign in or create an account in the browser and authorize this machine',
    });
  }
  hints.push({
    command: 'notis doctor',
    reason: 'Retry the auth and API checks after the desktop app is ready',
  });

  return { desktopRunning, appName, hints };
}

/**
 * Block until the desktop app writes an unexpired JWT into the CLI profile.
 *
 * Polls the local config file only — never the server. The desktop app is what
 * mints the credential, and `transport.js` re-reads the profile before every
 * request, so this loop exists purely so the caller's process can wait rather
 * than fail and make the user re-run the command.
 */
export async function waitForDesktopAuth({
  loadConfig,
  getJwt,
  isJwtExpired,
  profileName = 'default',
  timeoutMs = 300_000,
  intervalMs = 2_000,
  onTick,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const jwt = getJwt(loadConfig(), profileName);
    if (jwt && !isJwtExpired(jwt)) {
      return jwt;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    if (onTick) onTick(Math.max(0, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function createExpiredAuthError(runtime) {
  if (runtime.credentialKind === 'oauth') {
    return new CliError({
      code: 'auth_expired',
      message: 'Notis CLI OAuth authentication has expired',
      exitCode: EXIT_CODES.auth,
      details: { credential_source: 'oauth' },
      hints: [
        { command: 'notis login', reason: 'Authorize a new scoped CLI credential' },
        { command: 'notis doctor', reason: 'Inspect the active credential state' },
      ],
    });
  }
  if (runtime.credentialSource === 'env') {
    return new CliError({
      code: 'auth_expired',
      message: 'NOTIS_JWT is expired',
      exitCode: EXIT_CODES.auth,
      details: { credential_source: 'env' },
      hints: [
        {
          command: 'Set NOTIS_JWT to a fresh token',
          reason: 'The explicit environment credential overrides desktop-managed auth',
        },
      ],
    });
  }

  const recovery = getDesktopAuthRecovery(runtime);
  return new CliError({
    code: 'auth_expired',
    message: 'Notis CLI authentication has expired',
    exitCode: EXIT_CODES.auth,
    details: {
      credential_source: 'desktop',
      desktop_running: recovery.desktopRunning,
      desktop_app_name: recovery.appName,
    },
    hints: recovery.hints,
  });
}

export function createInvalidAuthHints(runtime) {
  if (runtime?.credentialKind === 'oauth') {
    return [
      {
        command: 'notis login',
        reason: 'Authorize a new scoped CLI credential',
      },
    ];
  }
  if (runtime?.credentialSource === 'env') {
    return [
      {
        command: 'Set NOTIS_JWT to a fresh token',
        reason: 'The explicit environment credential was rejected',
      },
    ];
  }
  return getDesktopAuthRecovery(runtime || {}).hints;
}
