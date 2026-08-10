import { CliError, EXIT_CODES } from './errors.js';

const CLI_NPX = 'npx --package @notis_ai/cli@latest -- notis';

export function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function profileSuffix(profileName) {
  return profileName && profileName !== 'default'
    ? ` --profile ${quoteShellArgument(profileName)}`
    : '';
}

/**
 * How to get an unusable profile back to a working credential.
 *
 * `mode` distinguishes the two cases a caller has to act on differently:
 * "expired" means the profile holds a grant the browser can renew, while
 * "missing" means this profile has never been authorized at all.
 */
export function getAuthRecovery({ profileName } = {}, { mode = 'expired' } = {}) {
  const suffix = profileSuffix(profileName);
  const hints = [
    {
      command: `${CLI_NPX} login${suffix}`,
      reason: mode === 'missing'
        ? 'Sign in or create an account in the browser and authorize this machine'
        : 'Authorize a fresh scoped CLI credential for this profile',
    },
    {
      command: `${CLI_NPX} profile list`,
      reason: 'Check whether another profile on this machine is already signed in',
    },
    {
      command: `${CLI_NPX} doctor${suffix}`,
      reason: 'Retry the auth and API checks once authorization completes',
    },
  ];
  return { hints };
}

export function createExpiredAuthError(runtime) {
  if (runtime?.credentialKind === 'worktree') {
    return new CliError({
      code: 'auth_expired',
      message: `The ./dev.sh credential for profile "${runtime.profileName}" has expired`,
      exitCode: EXIT_CODES.auth,
      details: { credential_source: 'worktree' },
      hints: [
        { message: 'Restart ./dev.sh in this worktree to mint a fresh dev credential.' },
        {
          command: `${CLI_NPX} profile list`,
          reason: 'Switch to a live account profile instead of the dev one',
        },
      ],
    });
  }
  if (runtime?.credentialSource === 'env') {
    return new CliError({
      code: 'auth_expired',
      message: 'NOTIS_JWT is expired',
      exitCode: EXIT_CODES.auth,
      details: { credential_source: 'env' },
      hints: [
        {
          command: 'Set NOTIS_JWT to a fresh token',
          reason: 'The explicit environment credential overrides every stored profile',
        },
      ],
    });
  }

  return new CliError({
    code: 'auth_expired',
    message: `Notis CLI authorization for profile "${runtime?.profileName || 'default'}" has expired`,
    exitCode: EXIT_CODES.auth,
    details: { credential_source: 'oauth' },
    hints: getAuthRecovery(runtime).hints,
  });
}

export function createInvalidAuthHints(runtime) {
  if (runtime?.credentialKind === 'worktree') {
    return [
      {
        message: 'Restart ./dev.sh in this worktree to mint a fresh dev credential.',
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
  return getAuthRecovery(runtime || {}).hints;
}
