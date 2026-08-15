import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPOSIO_SEARCH_TOOLS, healthCheck, probeAuth } from './helpers.js';
import { findCommandSpec, formatDescribe } from '../runtime/help.js';
import { createExpiredAuthError, getAuthRecovery } from '../runtime/auth-recovery.js';
import { cliCommandForChannel, resolveChannelSwitch } from '../runtime/channel.js';
import {
  credentialIsExpired,
  getProfile,
  loadConfig,
} from '../runtime/profiles.js';
import { ensureFreshOAuthCredential } from '../runtime/oauth.js';

export const DOCTOR_TOOL_ROUNDTRIP_TIMEOUT_MS = 90_000;

export function doctorToolRoundtripRuntime(runtime) {
  return {
    ...runtime,
    timeoutMs: Math.max(runtime.timeoutMs || 0, DOCTOR_TOOL_ROUNDTRIP_TIMEOUT_MS),
  };
}

export function doctorChannelSummary(
  runtime,
  moduleDirectory = dirname(fileURLToPath(import.meta.url)),
) {
  const decision = resolveChannelSwitch({
    runningVersion: runtime.cliVersion,
    profile: {
      channel: runtime.channel,
      api_base: runtime.apiBase,
    },
    moduleDirectory,
  });
  const mismatch = Boolean(
    decision.targetChannel
    && decision.targetChannel !== decision.runningChannel,
  );
  const releaseChannel = runtime.worktreeRuntime ? 'dev' : runtime.channel;
  return {
    decision,
    mismatch,
    releaseChannel,
    status: runtime.worktreeRuntime
      ? 'dev'
      : mismatch
        ? `mismatch:${decision.reason}`
        : decision.runningChannel,
  };
}

async function doctorHandler(ctx) {
  const checks = {
    config: 'ok',
    auth: 'missing',
    channel: 'unknown',
    routing: 'ok',
    health: 'unknown',
    tool_roundtrip: 'unknown',
  };

  if (ctx.runtime.credentialKind === 'oauth') {
    try {
      await ensureFreshOAuthCredential(ctx.runtime);
    } catch {
      // Doctor still reports the remaining health and recovery checks when a
      // refresh endpoint is unavailable or rejects the stored credential.
    }
  }
  let profile = getProfile(loadConfig(), ctx.runtime.profileName);
  checks.auth = ctx.runtime.jwt
    ? (credentialIsExpired(ctx.runtime, profile) ? 'expired' : 'configured')
    : 'missing';
  // A worktree whose ./dev.sh has stopped leaves commands with no local
  // backend to reach. Say so here rather than letting every later command fail
  // as an opaque network error.
  if (
    ctx.runtime.worktreeRuntimeUnavailable
    && ctx.runtime.profileSource !== 'explicit'
  ) {
    checks.routing = 'dev_runtime_unavailable';
  } else if (
    ctx.runtime.detachedWorktreeRuntime
    || (ctx.runtime.worktreeRuntimeUnavailable && ctx.runtime.profileSource === 'explicit')
  ) {
    checks.routing = 'detached';
  }

  try {
    await healthCheck(ctx.runtime);
    checks.health = 'ok';
  } catch (error) {
    checks.health = 'error';
  }

  if (ctx.runtime.jwt) {
    try {
      // Tool discovery may have to query several connected MCP servers on a
      // cold local backend. A diagnostic must not report a false failure just
      // because that legitimate roundtrip exceeds the general 30s default.
      const payload = await probeAuth(doctorToolRoundtripRuntime(ctx.runtime));
      checks.tool_roundtrip = Array.isArray(payload.toolkit_connection_statuses) ? 'ok' : 'error';
      profile = getProfile(loadConfig(), ctx.runtime.profileName);
      checks.auth = ctx.runtime.jwt
        ? (credentialIsExpired(ctx.runtime, profile) ? 'expired' : 'configured')
        : 'missing';
    } catch {
      checks.tool_roundtrip = 'error';
    }
  }

  // A mismatch here means the automatic hand-off could not happen: a source
  // checkout, an explicit opt-out, or a switch that could not reach npm. The
  // profile still routes to the right API, so this reports rather than fails.
  const {
    decision: channelDecision,
    mismatch: channelMismatch,
    releaseChannel,
    status: channelStatus,
  } = doctorChannelSummary(ctx.runtime);
  checks.channel = channelStatus;

  const hints = [];
  if (channelMismatch) {
    hints.push({
      command: `${cliCommandForChannel(channelDecision.targetChannel)} doctor`,
      reason: `Profile "${ctx.runtime.profileName}" belongs to the ${channelDecision.targetChannel} CLI channel`,
    });
  }
  if (checks.auth === 'missing') {
    hints.push(...getAuthRecovery(ctx.runtime, { mode: 'missing' }).hints);
  } else if (checks.auth === 'expired') {
    hints.push(...createExpiredAuthError(ctx.runtime).hints);
  }
  if (checks.routing === 'dev_runtime_unavailable') {
    hints.push(...ctx.runtime.worktreeRuntimeUnavailable.hints);
  } else if (checks.routing === 'detached') {
    hints.push({
      message: ctx.runtime.detachedWorktreeRuntime?.profile
        ? `This worktree's ./dev.sh profile is "${ctx.runtime.detachedWorktreeRuntime.profile}"; profile "${ctx.runtime.profileName}" bypasses it.`
        : `Explicit profile "${ctx.runtime.profileName}" bypasses this stopped worktree runtime.`,
    });
  }
  if (checks.health === 'error' && checks.auth !== 'expired') {
    hints.push({ command: 'notis profile show', reason: 'Check which API endpoint this profile targets' });
  }
  if (checks.tool_roundtrip === 'error') {
    hints.push({ command: 'notis whoami', reason: 'Verify your account and permissions' });
  }

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      profile: ctx.runtime.profileName,
      profile_source: ctx.runtime.profileSource,
      api_base: ctx.runtime.apiBase,
      release_channel: releaseChannel || null,
      cli_version: ctx.runtime.cliVersion || null,
      credential_source: ctx.runtime.credentialKind || null,
      ...(ctx.runtime.credentialKind === 'oauth'
        ? {
            oauth_client_id: profile.oauth_client_id || null,
            oauth_scopes: profile.oauth_scopes || [],
            oauth_access_expires_at: profile.oauth_access_expires_at || null,
            oauth_refresh_expires_at: profile.oauth_refresh_expires_at || null,
          }
        : {}),
      checks,
    },
    humanSummary: `Doctor checks completed for profile ${ctx.runtime.profileName}`,
    hints,
    renderHuman: () =>
      Object.entries(checks)
        .map(([name, status]) => `${name.padEnd(14)} ${status}`)
        .join('\n'),
  });
}

function decodeJwtUserId(jwt) {
  if (!jwt) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return decoded.sub || decoded.user_id || null;
  } catch {
    return null;
  }
}

export function activeRuntimeUserId(runtime) {
  return runtime.credentialKind === 'oauth'
    ? runtime.oauthUserId
    : decodeJwtUserId(runtime.jwt);
}

async function whoamiHandler(ctx) {
  const payload = await probeAuth(ctx.runtime);
  const toolkits = payload.toolkit_connection_statuses || [];
  const userId = activeRuntimeUserId(ctx.runtime);

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      profile: ctx.runtime.profileName,
      profile_source: ctx.runtime.profileSource,
      api_base: ctx.runtime.apiBase,
      credential_source: ctx.runtime.credentialKind || null,
      user_id: userId,
      toolkit_count: toolkits.length,
      toolkits: toolkits.map((t) => t.toolkit),
      cli_version: ctx.runtime.cliVersion,
    },
    humanSummary: `Logged in as ${userId || 'unknown'} via profile "${ctx.runtime.profileName}"`,
    renderHuman: () =>
      [
        `Profile:   ${ctx.runtime.profileName}`,
        `API:       ${ctx.runtime.apiBase}`,
        `User:      ${userId || 'unknown'}`,
        `Toolkits:  ${toolkits.length}`,
        `Version:   ${ctx.runtime.cliVersion}`,
      ].join('\n'),
    hints: [
      { command: 'notis profile list', reason: 'See the other accounts this machine can switch to' },
      { command: 'notis tools toolkits', reason: 'List available toolkit namespaces and connection statuses' },
    ],
  });
}

async function describeHandler(ctx) {
  const spec = findCommandSpec(ctx.registrySpecs, ctx.args.commandPath);
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { spec },
    humanSummary: `Described ${spec.command_path.join(' ')}`,
    renderHuman: () => formatDescribe(spec),
  });
}

export const metaCommandSpecs = [
  {
    command_path: ['whoami'],
    summary: 'Display the active profile, user, and available toolkit connection statuses.',
    when_to_use: 'Use this to quickly confirm which account and environment a command will target.',
    args_schema: { arguments: [], options: [] },
    examples: ['notis whoami', 'notis whoami --json'],
    output_schema: 'Returns profile, api_base, user_id, toolkit count, and CLI version.',
    mutates: false,
    idempotent: true,
    related_commands: ['notis doctor'],
    backend_call: { type: 'tool', name: COMPOSIO_SEARCH_TOOLS },
    handler: whoamiHandler,
  },
  {
    command_path: ['doctor'],
    summary: 'Run a quick CLI health check for config, auth, and API reachability.',
    when_to_use: 'Use this before relying on the CLI in automation or after changing environments.',
    args_schema: { arguments: [], options: [] },
    examples: ['notis doctor', 'notis doctor --json'],
    output_schema: 'Returns config, auth, health, and roundtrip check statuses.',
    mutates: false,
    idempotent: true,
    require_auth: false,
    related_commands: ['notis tools toolkits'],
    backend_call: { type: 'health+tool_roundtrip' },
    handler: doctorHandler,
  },
  {
    command_path: ['describe'],
    summary: 'Describe a first-class CLI command in detail.',
    when_to_use: 'Use this when an agent or human needs the exact shape, examples, and semantics of a command.',
    args_schema: {
      arguments: [{ token: '<command...>', key: 'commandPath', description: 'Command path to describe, such as "apps deploy".' }],
      options: [],
    },
    examples: ['notis describe apps deploy', 'notis describe tools exec'],
    output_schema: 'Returns the command spec metadata for the requested command.',
    mutates: false,
    idempotent: true,
    require_auth: false,
    related_commands: ['notis --help', 'notis tools describe <tool-name>'],
    backend_call: { type: 'local_registry' },
    handler: describeHandler,
  },
];
