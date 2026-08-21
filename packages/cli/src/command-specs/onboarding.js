import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliError, EXIT_CODES } from '../runtime/errors.js';
import { getAuthRecovery } from '../runtime/auth-recovery.js';
import {
  credentialIsExpired,
  getProfile,
  loadConfig,
} from '../runtime/profiles.js';
import { ensureFreshOAuthCredential, loginWithOAuth } from '../runtime/oauth.js';
import { runToolCommand } from './helpers.js';
import { installLocalAgentContext } from './agents.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED_BRIEF_PATH = join(HERE, '..', '..', 'skills', 'notis-onboarding', 'BRIEF.md');

/**
 * Ask the account whether it has already been onboarded.
 *
 * The brief itself is served unauthenticated and is identical for everyone, so
 * it can never answer this. Without the check `start` hands a year-old account
 * the new-user script, and a compliant agent re-asks the user their own name
 * and calls COMPLETE_TUTORIAL on someone who converted long ago.
 *
 * A failure here is not fatal: an unreachable tool bridge should not block
 * sign-in. It resolves to null and the caller degrades to serving the brief,
 * which is the previous behaviour.
 */
async function fetchOnboardingState(runtime) {
  try {
    const { payload } = await runToolCommand({
      runtime,
      toolName: 'LOCAL_NOTIS_GET_USER_SETTINGS',
      arguments_: {},
    });
    const data = payload?.data ?? payload?.result ?? payload;
    if (data && typeof data.onboarding_complete === 'boolean') {
      return {
        onboardingComplete: data.onboarding_complete,
        settings: data.settings || {},
        missingSettings: Array.isArray(data.missing_settings) ? data.missing_settings : [],
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The brief is served rather than bundled so it tracks the deployed server. The
 * bundled copy is a fallback for an offline or unreachable API, and the payload
 * says which one the caller got so a stale brief is diagnosable.
 */
async function fetchBrief(apiBase, timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs || 30_000, 30_000));
    try {
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/signup/onboarding-brief`, {
        signal: controller.signal,
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.markdown) {
          return { markdown: payload.markdown, source: 'server' };
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // fall through to the bundled copy
  }

  try {
    return { markdown: readFileSync(BUNDLED_BRIEF_PATH, 'utf-8'), source: 'bundled' };
  } catch {
    return { markdown: null, source: null };
  }
}

function isAuthenticated(runtime) {
  return Boolean(runtime.jwt)
    && !credentialIsExpired(runtime, getProfile(loadConfig(), runtime.profileName));
}

function renderAgentSetup(results) {
  const configured = (results || []).filter((result) => result?.agent && result?.instructions);
  if (!configured.length) return '';
  const lines = configured.map((result) => {
    const label = result.agent === 'claude-code' ? 'Claude Code' : 'Codex';
    const instructions = result.instructions?.status || 'skipped';
    const memoryStatus = result.memory_hook?.status || 'skipped';
    const memory = memoryStatus === 'preserved'
      ? 'memory hooks not changed'
      : `memory recall and capture ${memoryStatus}`;
    return `- ${label}: instructions ${instructions}; ${memory}`;
  });
  if (configured.some((result) => (
    result.agent === 'codex'
    && ['installed', 'updated', 'unchanged'].includes(result.memory_hook?.status)
  ))) {
    lines.push('- Codex: open /hooks once and trust the Notis hooks before they can run.');
  }
  return ['## Coding-agent setup', ...lines].join('\n');
}

function agentSetupHints(results) {
  const hints = [];
  if ((results || []).some((result) => (
    result.agent === 'codex'
    && ['installed', 'updated', 'unchanged'].includes(result.memory_hook?.status)
  ))) {
    hints.push({ message: 'In Codex, open /hooks once and trust the Notis hooks.' });
  }
  if ((results || []).some((result) => result.status === 'not_detected')) {
    hints.push({ command: 'notis agents install', reason: 'Configure Codex and Claude Code later if they were not detected now' });
  }
  if ((results || []).some((result) => result.memory_hook?.status === 'preserved')) {
    hints.push({ command: 'notis agents install', reason: 'Explicitly enable Notis memory recall and completed-turn capture' });
  }
  return hints;
}

/**
 * What an authenticated `start` reports.
 *
 * A returning user does not need an onboarding script — they need orientation:
 * which account, which endpoint, and confirmation that nothing is expected of
 * them. Only an account that has genuinely not finished onboarding gets the
 * brief, so `brief: null` is a positive signal to the agent, not a failure.
 */
async function authenticatedResult(ctx) {
  const state = await fetchOnboardingState(ctx.runtime);
  const onboardingComplete = state?.onboardingComplete === true;
  const base = {
    authenticated: true,
    profile: ctx.runtime.profileName,
    api_base: ctx.runtime.apiBase,
    credential_source: ctx.runtime.credentialKind,
    onboarding_complete: onboardingComplete,
    ...(state ? { known_settings: state.settings, missing_settings: state.missingSettings } : {}),
  };
  try {
    base.agent_setup = installLocalAgentContext(ctx, {
      onlyExisting: true,
      memoryHooks: null,
    });
  } catch {
    // Authentication and onboarding remain usable if a local vendor config is
    // malformed or read-only. `notis agents install` reports the exact path.
    base.agent_setup = [];
  }

  if (onboardingComplete) {
    const name = state?.settings?.full_name;
    const setupSummary = renderAgentSetup(base.agent_setup);
    return ctx.output.emitSuccess({
      command: 'start',
      data: { ...base, brief: null, brief_source: null },
      humanSummary:
        `Profile "${ctx.runtime.profileName}" is signed in and this account is already set up.`,
      renderHuman: () =>
        [
          `Signed in${name ? ` as ${name}` : ''} on profile "${ctx.runtime.profileName}".`,
          `API: ${ctx.runtime.apiBase}`,
          '',
          'This account has already completed onboarding. Do not run an onboarding',
          'flow and do not call LOCAL_NOTIS_COMPLETE_TUTORIAL.',
          ...(setupSummary ? ['', setupSummary] : []),
        ].join('\n'),
      hints: [
        { command: 'notis whoami', reason: 'Show the account and its connected toolkits' },
        { command: 'notis tools search "<what you need>"', reason: 'Find a tool and get on with the task' },
        ...agentSetupHints(base.agent_setup),
      ],
    });
  }

  const brief = await fetchBrief(ctx.runtime.apiBase, ctx.runtime.timeoutMs);
  const setupSummary = renderAgentSetup(base.agent_setup);
  return ctx.output.emitSuccess({
    command: 'start',
    data: { ...base, brief: brief.markdown, brief_source: brief.source },
    humanSummary: `Notis CLI is authenticated for profile "${ctx.runtime.profileName}". Onboarding is not complete.`,
    renderHuman: () => [
      brief.markdown || 'Notis CLI is authenticated.',
      setupSummary,
    ].filter(Boolean).join('\n\n'),
    hints: agentSetupHints(base.agent_setup),
  });
}

async function startHandler(ctx) {
  const { runtime, options, output } = ctx;
  if (runtime.credentialKind === 'oauth') {
    try {
      await ensureFreshOAuthCredential(runtime);
    } catch {
      // A failed refresh is equivalent to no usable session here. Interactive
      // starts may still authorize again; brief-only runs surface the normal
      // authentication recovery below.
    }
  }

  // Safe to re-run: an already-authorized profile skips straight to the brief.
  if (isAuthenticated(runtime)) {
    return authenticatedResult(ctx);
  }

  if (options.briefOnly) {
    throw new CliError({
      code: 'auth_missing',
      message: `Profile "${runtime.profileName}" is not signed in to Notis yet.`,
      exitCode: EXIT_CODES.auth,
      hints: getAuthRecovery(runtime, { mode: 'missing' }).hints,
    });
  }

  // Browser authorization is the whole signup path: it creates the account when
  // the address is new and authorizes this machine either way. There is nothing
  // for the CLI to collect up front, and nothing to wait on afterwards.
  const authorization = await loginWithOAuth(runtime, { browser: true }, output);
  if (authorization?.agentAuthorization) {
    return output.emitSuccess({
      command: 'start',
      data: {
        authenticated: false,
        profile: runtime.profileName,
        ...authorization.agentAuthorization,
      },
      humanSummary: 'Open the authorization URL to create or access the Notis account.',
      renderHuman: () => `Authorize Notis CLI: ${authorization.agentAuthorization.authorize_url}`,
    });
  }

  // A failed authorization leaves whatever stale credential got us here in
  // place, so re-apply the same expiry test rather than reporting a machine as
  // signed in on the strength of a dead token.
  if (!isAuthenticated(runtime)) {
    throw new CliError({
      code: 'auth_missing',
      message: `Authorization did not complete for profile "${runtime.profileName}".`,
      exitCode: EXIT_CODES.auth,
      hints: getAuthRecovery(runtime, { mode: 'missing' }).hints,
    });
  }

  return authenticatedResult(ctx);
}

export const onboardingCommandSpecs = [
  {
    command_path: ['start'],
    summary: 'Create or access a Notis account and authorize this CLI profile.',
    when_to_use:
      'Run this first on a new machine, before anything that needs auth. Safe to re-run. An account that has already completed onboarding gets orientation instead of an onboarding brief.',
    args_schema: {
      arguments: [],
      options: [
        { flags: '--brief-only', description: 'Print the onboarding brief for an already-signed-in profile.' },
      ],
    },
    examples: [
      'notis start',
      'notis start --profile work',
      'notis start --brief-only',
      'notis start --json',
    ],
    output_schema:
      'Returns {authenticated, profile, api_base, onboarding_complete, known_settings, missing_settings, agent_setup, brief, brief_source} once signed in — brief is null when onboarding_complete is true — or {authorize_url, expires_in, redeem_command} while waiting for browser authorization.',
    mutates: true,
    idempotent: true,
    require_auth: false,
    allow_unknown_profile: true,
    related_commands: ['notis login', 'notis profile list', 'notis doctor', 'notis tools link'],
    backend_call: { type: 'oauth', name: 'authorization_code+pkce' },
    handler: startHandler,
  },
];
