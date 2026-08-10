import { CliError, EXIT_CODES } from '../runtime/errors.js';
import { quoteShellArgument } from '../runtime/auth-recovery.js';
import {
  DEFAULT_PROFILE,
  getProfile,
  listProfiles,
  loadConfig,
  normalizeConfig,
  profileHasCredential,
  profileExists,
  resolveWorktreeRuntime,
  updateConfig,
} from '../runtime/profiles.js';

function describeProfile(config, name, worktreeRuntime) {
  const entry = listProfiles(config).find((candidate) => candidate.name === name);
  if (worktreeRuntime?.profile === name) {
    return {
      name,
      active: false,
      api_base: worktreeRuntime.api_base,
      label: './dev.sh worktree',
      credential_kind: 'dev',
      user_id: worktreeRuntime.expected_user_id || null,
      authenticated: true,
      dev_runtime_live: true,
    };
  }
  if (!entry) return null;
  return { ...entry, dev_runtime_live: false };
}

function unknownProfileError(name, config) {
  return new CliError({
    code: 'profile_unknown',
    message: `No CLI profile named "${name}"`,
    exitCode: EXIT_CODES.usage,
    details: { known_profiles: Object.keys(normalizeConfig(config).profiles) },
    hints: [
      { command: 'notis profile list', reason: 'See which profiles this machine has' },
      { command: `notis login --profile ${quoteShellArgument(name)}`, reason: 'Authorize a new account under this name' },
    ],
  });
}

function currentWorktreeState() {
  const resolved = resolveWorktreeRuntime();
  return resolved?.unavailable
    ? { runtime: null, unavailable: resolved.unavailable }
    : { runtime: resolved, unavailable: null };
}

function unavailableForEffectiveRoute(ctx, unavailable) {
  return ctx.runtime.profileSource === 'explicit' ? null : unavailable;
}

async function listHandler(ctx) {
  const config = loadConfig();
  const { runtime: worktreeRuntime, unavailable: worktreeUnavailable } = currentWorktreeState();
  const effectiveWorktreeUnavailable = unavailableForEffectiveRoute(ctx, worktreeUnavailable);
  const profiles = listProfiles(config).map((entry) =>
    describeProfile(config, entry.name, worktreeRuntime));
  if (
    worktreeRuntime
    && !profiles.some((entry) => entry.name === worktreeRuntime.profile)
  ) {
    profiles.unshift(describeProfile(config, worktreeRuntime.profile, worktreeRuntime));
  }
  // In a hosted shell every profile reads as signed out while commands work
  // fine, because NOTIS_JWT overrides all of them. Say so rather than letting
  // an agent conclude it needs to authorize something.
  const envOverride = ctx.runtime.credentialKind === 'env';

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      active_profile: normalizeConfig(config).current_profile,
      effective_profile: effectiveWorktreeUnavailable ? null : ctx.runtime.profileName,
      effective_profile_source: effectiveWorktreeUnavailable
        ? 'worktree-unavailable'
        : ctx.runtime.profileSource,
      worktree_runtime_unavailable: Boolean(effectiveWorktreeUnavailable),
      effective_credential_kind: ctx.runtime.credentialKind || null,
      env_credential_override: envOverride,
      profiles,
    },
    humanSummary: effectiveWorktreeUnavailable
      ? `${profiles.length} stored CLI profile${profiles.length === 1 ? '' : 's'}; this local-only worktree is stopped`
      : envOverride
      ? `NOTIS_JWT overrides all ${profiles.length} stored profile${profiles.length === 1 ? '' : 's'}`
      : `${profiles.length} CLI profile${profiles.length === 1 ? '' : 's'} on this machine`,
    renderHuman: () =>
      [
        ...(envOverride
          ? ['NOTIS_JWT is set and takes precedence over every profile below.', '']
          : []),
        ...profiles.map((entry) => {
          const marker = !envOverride && entry.name === ctx.runtime.profileName ? '*' : ' ';
          const auth = entry.authenticated ? entry.credential_kind : 'signed out';
          const live = entry.dev_runtime_live ? ' (dev.sh running)' : '';
          return `${marker} ${entry.name.padEnd(16)} ${String(entry.api_base).padEnd(32)} ${auth}${live}`;
        }),
      ].join('\n'),
    hints: [
      ...(effectiveWorktreeUnavailable
        ? [{
            command: 'notis --profile <name> <command>',
            reason: 'Explicitly escape the stopped local-only worktree for one command',
          }]
        : []),
      { command: 'notis profile use <name>', reason: 'Switch the default account outside this worktree' },
      { command: 'notis login --profile <name>', reason: 'Add another account without signing this one out' },
    ],
  });
}

async function useHandler(ctx) {
  const requested = ctx.args.name;
  const config = loadConfig();
  if (!profileExists(config, requested)) {
    throw unknownProfileError(requested, config);
  }

  // Switching only moves the pointer. Every profile keeps its own credential so
  // going back is another `profile use`, never another browser authorization.
  const next = updateConfig((latest) => {
    latest.current_profile = requested;
    return latest;
  });
  const { runtime: worktreeRuntime, unavailable: worktreeUnavailable } = currentWorktreeState();
  const profile = getProfile(next, requested);
  const worktreeOverride = Boolean(worktreeRuntime);
  const worktreeBlocked = Boolean(worktreeUnavailable);
  const authenticated = profileHasCredential(profile);

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      active_profile: requested,
      ...describeProfile(next, requested, worktreeRuntime),
      effective_profile: worktreeBlocked
        ? null
        : worktreeOverride ? worktreeRuntime.profile : requested,
      effective_profile_source: worktreeBlocked
        ? 'worktree-unavailable'
        : worktreeOverride ? 'worktree' : 'current',
      worktree_runtime_unavailable: worktreeBlocked,
    },
    humanSummary: worktreeBlocked
      ? `Saved profile "${requested}" as the default outside this worktree; this local-only checkout is stopped, so use --profile explicitly or restart ./dev.sh.`
      : worktreeOverride
      ? `Saved profile "${requested}" as the default outside this worktree; this checkout still uses "${worktreeRuntime.profile}" unless --profile is explicit.`
      : authenticated
        ? `Switched to profile "${requested}".`
        : `Switched to profile "${requested}", which has no credential yet.`,
    hints: worktreeBlocked
      ? [
          {
            command: `notis --profile ${quoteShellArgument(requested)} whoami`,
            reason: 'Explicitly use and confirm this account while the local worktree is stopped',
          },
          { message: 'Restart ./dev.sh to restore the worktree test identity.' },
        ]
      : worktreeOverride
      ? [
          {
            command: `notis --profile ${quoteShellArgument(requested)} whoami`,
            reason: 'Use and confirm this account explicitly inside the active worktree',
          },
          ...(!authenticated
            ? [{
                command: `notis login --profile ${quoteShellArgument(requested)}`,
                reason: 'Authorize an account for this profile',
              }]
            : []),
        ]
      : authenticated
        ? [{ command: 'notis whoami', reason: 'Confirm the account and API this profile targets' }]
        : [{ command: `notis login --profile ${quoteShellArgument(requested)}`, reason: 'Authorize an account for this profile' }],
  });
}

async function showHandler(ctx) {
  const config = loadConfig();
  const name = ctx.args.name || ctx.runtime.profileName;
  const { runtime: worktreeRuntime, unavailable: worktreeUnavailable } = currentWorktreeState();
  const effectiveWorktreeUnavailable = unavailableForEffectiveRoute(ctx, worktreeUnavailable);
  const described = describeProfile(config, name, worktreeRuntime);
  if (!described) {
    throw unknownProfileError(name, config);
  }
  const profile = getProfile(config, name);
  const envOverride = ctx.runtime.credentialKind === 'env';

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      ...described,
      env_credential_override: envOverride,
      worktree_runtime_unavailable: Boolean(effectiveWorktreeUnavailable),
      oauth_scopes: profile.oauth_scopes || [],
      oauth_access_expires_at: profile.oauth_access_expires_at || null,
      oauth_refresh_expires_at: profile.oauth_refresh_expires_at || null,
      dev_workspace_root:
        profile.dev_workspace_root || (
          worktreeRuntime?.profile === name
            ? worktreeRuntime.workspace_root || null
            : null
        ),
    },
    humanSummary: `Profile "${name}" targets ${described.api_base}`,
    renderHuman: () =>
      [
        `Profile:   ${name}`,
        `API:       ${described.api_base}`,
        `User:      ${described.user_id || 'unknown'}`,
        `Credential:${described.credential_kind ? ` ${described.credential_kind}` : ' none'}`,
        `Active:    ${described.active ? 'yes' : 'no'}`,
        ...(envOverride
          ? ['', 'NOTIS_JWT is set and overrides this profile\'s credential.']
          : []),
      ].join('\n'),
    hints: effectiveWorktreeUnavailable
      ? [{
          command: `notis --profile ${quoteShellArgument(name)} whoami`,
          reason: 'Explicitly use this profile while the local-only worktree is stopped',
        }]
      : [],
  });
}

async function removeHandler(ctx) {
  const requested = ctx.args.name;
  const config = loadConfig();
  if (!profileExists(config, requested)) {
    throw unknownProfileError(requested, config);
  }
  if (requested === DEFAULT_PROFILE) {
    throw new CliError({
      code: 'profile_not_removable',
      message: 'The "default" profile cannot be removed',
      exitCode: EXIT_CODES.usage,
      hints: [{ command: 'notis logout', reason: 'Clear its credential instead of removing the profile' }],
    });
  }
  if (profileHasCredential(getProfile(config, requested)) && !ctx.options.force) {
    throw new CliError({
      code: 'profile_still_authorized',
      message: `Profile "${requested}" still holds a credential`,
      exitCode: EXIT_CODES.usage,
      hints: [
        {
          command: `notis logout --profile ${quoteShellArgument(requested)}`,
          reason: 'Revoke the grant server-side before discarding it locally',
        },
        { command: `notis profile remove ${quoteShellArgument(requested)} --force`, reason: 'Discard the local credential without revoking it' },
      ],
    });
  }

  const next = updateConfig((latest) => {
    delete latest.profiles[requested];
    if (latest.current_profile === requested) {
      latest.current_profile = DEFAULT_PROFILE;
    }
    return latest;
  });

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      removed_profile: requested,
      active_profile: normalizeConfig(next).current_profile,
    },
    humanSummary: `Removed profile "${requested}".`,
  });
}

export const profileCommandSpecs = [
  {
    command_path: ['profile', 'list'],
    summary: 'List every CLI profile with its account, API endpoint, and credential state.',
    when_to_use:
      'Use this to see which accounts and environments this machine can reach before choosing one.',
    args_schema: { arguments: [], options: [] },
    examples: ['notis profile list', 'notis profile list --json'],
    output_schema:
      'Returns active_profile, effective_profile, and a profiles array of {name, api_base, credential_kind, user_id, authenticated, dev_runtime_live}.',
    mutates: false,
    idempotent: true,
    require_auth: false,
    allow_unknown_profile: true,
    related_commands: ['notis profile use', 'notis login', 'notis whoami'],
    backend_call: { type: 'local_config' },
    handler: listHandler,
  },
  {
    command_path: ['profile', 'use'],
    summary: 'Switch the default profile without signing any profile out.',
    when_to_use:
      'Use this to change which account and API subsequent commands target. Every other profile keeps its credential.',
    args_schema: {
      arguments: [{ token: '<name>', key: 'name', description: 'Profile to make active.' }],
      options: [],
    },
    examples: ['notis profile use work', 'notis profile use default'],
    output_schema: 'Returns the newly active profile with its api_base, user_id, and credential kind.',
    mutates: true,
    idempotent: true,
    require_auth: false,
    allow_unknown_profile: true,
    related_commands: ['notis profile list', 'notis login'],
    backend_call: { type: 'local_config' },
    handler: useHandler,
  },
  {
    command_path: ['profile', 'show'],
    summary: 'Show one profile in detail, including scopes and credential expiry.',
    when_to_use: 'Use this to inspect exactly which account and endpoint a profile resolves to.',
    args_schema: {
      arguments: [
        { token: '[name]', key: 'name', description: 'Profile to inspect; defaults to the active one.' },
      ],
      options: [],
    },
    examples: ['notis profile show', 'notis profile show work --json'],
    output_schema:
      'Returns name, api_base, user_id, credential_kind, oauth scopes and expiries, and dev runtime state.',
    mutates: false,
    idempotent: true,
    require_auth: false,
    allow_unknown_profile: true,
    related_commands: ['notis profile list', 'notis whoami'],
    backend_call: { type: 'local_config' },
    handler: showHandler,
  },
  {
    command_path: ['profile', 'remove'],
    summary: 'Delete a CLI profile from this machine.',
    when_to_use:
      'Use this after logging a profile out. Removing a still-authorized profile requires --force and leaves the grant live server-side.',
    args_schema: {
      arguments: [{ token: '<name>', key: 'name', description: 'Profile to delete.' }],
      options: [
        { flags: '--force', description: 'Discard a profile that still holds a credential.' },
      ],
    },
    examples: ['notis profile remove old-work', 'notis profile remove old-work --force'],
    output_schema: 'Returns removed_profile and the resulting active_profile.',
    mutates: true,
    idempotent: true,
    require_auth: false,
    allow_unknown_profile: true,
    related_commands: ['notis logout', 'notis profile list'],
    backend_call: { type: 'local_config' },
    handler: removeHandler,
  },
];
