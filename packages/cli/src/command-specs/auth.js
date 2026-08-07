import { loginWithOAuth, logoutOAuth } from '../runtime/oauth.js';

async function loginHandler(ctx) {
  const result = await loginWithOAuth(ctx.runtime, ctx.options, ctx.output);
  if (result.desktopFastPath) {
    return ctx.output.emitSuccess({
      command: 'login',
      data: {
        authenticated: true,
        credential_source: result.credentialSource || 'desktop',
      },
      humanSummary: 'Notis Desktop already provides a valid CLI credential.',
    });
  }
  if (result.agentAuthorization) {
    return ctx.output.emitSuccess({
      command: 'login',
      data: result.agentAuthorization,
      humanSummary: 'Open the authorization URL in a browser to continue.',
    });
  }
  return ctx.output.emitSuccess({
    command: 'login',
    data: {
      authenticated: true,
      credential_source: 'oauth',
      profile: ctx.runtime.profileName,
      user_id: result.profile.oauth_user_id,
      scopes: result.profile.oauth_scopes,
      access_expires_at: result.profile.oauth_access_expires_at,
      refresh_expires_at: result.profile.oauth_refresh_expires_at,
    },
    humanSummary: `Notis CLI is authorized for profile "${ctx.runtime.profileName}".`,
  });
}

async function logoutHandler(ctx) {
  const result = await logoutOAuth(ctx.runtime, {
    allProfiles: Boolean(ctx.options.allProfiles),
  });
  return ctx.output.emitSuccess({
    command: 'logout',
    data: {
      oauth_connected: false,
      cleared_profiles: result.profiles,
    },
    humanSummary: ctx.options.allProfiles
      ? 'OAuth credentials were removed from all CLI profiles.'
      : `OAuth credentials were removed from profile "${ctx.runtime.profileName}".`,
  });
}

export const authCommandSpecs = [
  {
    command_path: ['login'],
    summary: 'Authorize the Notis CLI in a browser with scoped OAuth access.',
    when_to_use:
      'Use this on a machine where Notis Desktop is unavailable, signed out, or should not own CLI authentication.',
    args_schema: {
      arguments: [],
      options: [
        { flags: '--no-browser', description: 'Print the authorization URL without opening a browser.' },
        { flags: '--print-url', description: 'Print the authorization URL even when opening a browser.' },
        { flags: '--paste-code', description: 'Use the copy-paste callback for SSH and headless machines.' },
        { flags: '--force', description: 'Create an independent OAuth grant even when Desktop is signed in.' },
        { flags: '--timeout-seconds <n>', description: 'How long to wait for authorization (default 300).' },
        { flags: '--scope <scope>', description: 'OAuth permission to request (repeatable).', collect: true },
        { flags: '--code <code>', description: 'Redeem the code shown in the browser after a non-interactive login.' },
      ],
    },
    examples: [
      'notis login',
      'notis login --no-browser --print-url',
      'notis login --paste-code',
      'notis login --code 4f3c2b1a',
      'notis login --force',
    ],
    output_schema:
      'Returns credential_source, profile, user_id, scopes, and credential expiries; agent mode returns authorize_url and expires_in.',
    mutates: true,
    idempotent: true,
    require_auth: false,
    related_commands: ['notis logout', 'notis doctor', 'notis whoami'],
    backend_call: { type: 'oauth', name: 'authorization_code+pkce' },
    handler: loginHandler,
  },
  {
    command_path: ['logout'],
    summary: 'Revoke and remove the scoped OAuth credential for the active CLI profile.',
    when_to_use:
      'Use this to disconnect the command line without signing Notis Desktop out.',
    args_schema: {
      arguments: [],
      options: [
        { flags: '--all-profiles', description: 'Remove OAuth credentials from every CLI profile.' },
      ],
    },
    examples: ['notis logout', 'notis logout --all-profiles'],
    output_schema: 'Returns oauth_connected=false and the profiles whose OAuth credentials were removed.',
    mutates: true,
    idempotent: true,
    require_auth: false,
    related_commands: ['notis login', 'notis doctor'],
    backend_call: { type: 'oauth', name: 'revocation' },
    handler: logoutHandler,
  },
];
