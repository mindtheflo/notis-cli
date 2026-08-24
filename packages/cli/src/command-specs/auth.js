import { loginWithOAuth, logoutOAuth } from '../runtime/oauth.js';
import { installLocalAgentContext } from './agents.js';

async function loginHandler(ctx) {
  const result = await loginWithOAuth(ctx.runtime, ctx.options, ctx.output);
  if (result.agentAuthorization) {
    const presentation = loginAgentAuthorizationPresentation(result.agentAuthorization);
    return ctx.output.emitSuccess({
      command: 'login',
      data: result.agentAuthorization,
      ...presentation,
    });
  }
  let agentSetup = [];
  const setupWarnings = [];
  try {
    // Login may add static CLI guidance, but automatic capture is a separate
    // explicit choice made through `notis agents install`.
    agentSetup = installLocalAgentContext(ctx, {
      onlyExisting: true,
      memoryHooks: null,
    });
  } catch (error) {
    setupWarnings.push(`Notis CLI login succeeded, but local agent context setup failed: ${error.message}`);
  }
  return ctx.output.emitSuccess({
    command: 'login',
    data: {
      authenticated: true,
      credential_source: 'oauth',
      profile: ctx.runtime.profileName,
      api_base: result.profile.api_base || ctx.runtime.apiBase,
      user_id: result.profile.oauth_user_id,
      scopes: result.profile.oauth_scopes,
      access_expires_at: result.profile.oauth_access_expires_at,
      refresh_expires_at: result.profile.oauth_refresh_expires_at,
      agent_setup: agentSetup,
    },
    humanSummary: `Notis CLI is authorized for profile "${ctx.runtime.profileName}".`,
    warnings: setupWarnings,
    hints: [
      { command: 'notis profile list', reason: 'See every account this machine can switch between' },
      { command: 'notis agents install', reason: 'Install or refresh Notis context for Codex and Claude Code' },
    ],
  });
}

export function loginAgentAuthorizationPresentation(authorization) {
  const browserHandOff = authorization?.hand_off === 'browser_callback';
  const nextCommand = browserHandOff
    ? authorization?.confirm_command
    : authorization?.redeem_command;
  return {
    humanSummary: browserHandOff
      ? 'Give the user the authorization URL. Signing in there completes it — there is no code to ask them for.'
      : 'Give the user the authorization URL, then ask them for the code it shows.',
    hints: nextCommand
      ? [{
        command: nextCommand,
        reason: browserHandOff
          ? 'Confirm the account once they have finished in the browser'
          : 'Redeem the code shown in the browser',
      }]
      : [],
    renderHuman: () => `Authorize Notis CLI: ${authorization.authorize_url}`,
  };
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
    humanSummary: logoutHumanSummary(result, {
      allProfiles: Boolean(ctx.options.allProfiles),
      profileName: ctx.runtime.profileName,
    }),
  });
}

export function logoutHumanSummary(result, { allProfiles, profileName }) {
  if (allProfiles) {
    return result.profiles.length > 0
      ? 'OAuth state was cleared from all connected or pending CLI profiles.'
      : 'No OAuth credentials were connected in any CLI profile.';
  }
  return result.profiles.includes(profileName)
    ? `OAuth state was cleared for profile "${profileName}", including any pending authorization.`
    : `No OAuth credential was connected for profile "${profileName}".`;
}

export const authCommandSpecs = [
  {
    command_path: ['login'],
    summary: 'Authorize a CLI profile in a browser with scoped OAuth access.',
    when_to_use:
      'Run this once per account you want the CLI to reach. Pass --profile to add a second account without signing the first one out.',
    args_schema: {
      arguments: [],
      options: [
        { flags: '--no-browser', description: 'Print the authorization URL without opening a browser.' },
        { flags: '--print-url', description: 'Print the authorization URL even when opening a browser.' },
        { flags: '--mode <mode>', description: 'auto (default) hands the browser callback to a background listener when this command cannot wait; browser waits in-process; code shows a one-time code to copy.' },
        { flags: '--paste-code', description: 'Alias for --mode code.' },
        { flags: '--timeout-seconds <n>', description: 'Authorization lifetime in seconds (default 300 while waiting in a terminal; 1800 for detached or code hand-offs).' },
        { flags: '--scope <scope>', description: 'OAuth permission to request (repeatable).', collect: true },
        { flags: '--code <code>', description: 'Redeem the code shown in the browser after a non-interactive login.' },
      ],
    },
    examples: [
      'notis login',
      'notis login --profile work',
      'notis login --profile beta --api-base https://api-beta.notis.ai',
      'notis login --no-browser --print-url',
      'notis login --mode browser',
      'notis login --mode code',
      'notis login --code 4f3c2b1a',
    ],
    output_schema:
      'Returns credential_source, profile, api_base, user_id, scopes, and credential expiries; non-blocking agent, machine-output, or non-interactive modes return authorize_url, expires_in, and hand_off ("browser_callback" needs no code, "code" must be redeemed with redeem_command).',
    mutates: true,
    idempotent: true,
    require_auth: false,
    allow_unknown_profile: true,
    related_commands: ['notis profile list', 'notis profile use', 'notis logout', 'notis doctor'],
    backend_call: { type: 'oauth', name: 'authorization_code+pkce' },
    handler: loginHandler,
  },
  {
    command_path: ['logout'],
    summary: 'Revoke and remove the OAuth credential for one CLI profile.',
    when_to_use:
      'Use this to disconnect a single account. Other profiles keep their credentials unless you pass --all-profiles.',
    args_schema: {
      arguments: [],
      options: [
        { flags: '--all-profiles', description: 'Clear OAuth credentials and pending authorizations from every CLI profile.' },
      ],
    },
    examples: ['notis logout', 'notis logout --profile work', 'notis logout --all-profiles'],
    output_schema: 'Returns oauth_connected=false and the profiles whose OAuth credentials or pending authorizations were cleared.',
    mutates: true,
    idempotent: true,
    require_auth: false,
    allow_unknown_profile: true,
    related_commands: ['notis login', 'notis profile list'],
    backend_call: { type: 'oauth', name: 'revocation' },
    handler: logoutHandler,
  },
];
