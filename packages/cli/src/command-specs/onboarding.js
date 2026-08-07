import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliError, EXIT_CODES } from '../runtime/errors.js';
import { getDesktopAuthRecovery, waitForDesktopAuth } from '../runtime/desktop-auth.js';
import {
  credentialIsExpired,
  getProfile,
  loadConfig,
} from '../runtime/profiles.js';
import { ensureFreshOAuthCredential, loginWithOAuth } from '../runtime/oauth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED_BRIEF_PATH = join(HERE, '..', '..', 'skills', 'notis-onboarding', 'BRIEF.md');

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

async function requestSignupLink(apiBase, { email, useCases }) {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/signup/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      ...(useCases && useCases.length ? { preferred_use_cases: useCases } : {}),
    }),
  });
  const payload = await response.json().catch(() => null);

  if (response.status === 429) {
    // Requesting another link invalidates the previous one, so retrying is
    // actively harmful. Surface the cooldown and stop.
    throw new CliError({
      code: 'signup_throttled',
      message: payload?.message || 'A sign-in link was just sent to this address.',
      exitCode: EXIT_CODES.usage,
      details: payload || {},
      hints: [
        {
          command: 'Open the newest Notis email on this machine',
          reason: 'Requesting another link makes earlier links stop working',
        },
      ],
    });
  }

  if (!response.ok) {
    throw new CliError({
      code: 'signup_failed',
      message: payload?.message || `Signup failed with status ${response.status}`,
      exitCode: EXIT_CODES.backend,
      details: payload || {},
    });
  }

  return payload || {};
}

async function startHandler(ctx) {
  const { runtime, options, output } = ctx;
  const apiBase = runtime.apiBase;
  if (runtime.credentialKind === 'oauth') {
    try {
      await ensureFreshOAuthCredential(runtime);
    } catch {
      // A failed refresh is equivalent to no usable session here. Interactive
      // starts may still authorize again; brief-only and agent runs surface
      // the normal authentication recovery below.
    }
  }
  let authenticated = Boolean(runtime.jwt)
    && !credentialIsExpired(
      runtime,
      getProfile(loadConfig(runtime.worktreeRuntime), runtime.profileName),
    );

  // Safe to re-run: an already-authenticated machine skips straight to the brief.
  // Agents retry commands, and a second signup would invalidate the first email.
  if (authenticated || options.briefOnly) {
    if (!authenticated) {
      const recovery = getDesktopAuthRecovery(runtime, { mode: 'missing' });
      throw new CliError({
        code: 'auth_missing',
        message: 'This machine is not signed in to Notis yet.',
        exitCode: EXIT_CODES.auth,
        hints: recovery.hints,
      });
    }
    const brief = await fetchBrief(apiBase, runtime.timeoutMs);
    return output.emitSuccess({
      command: 'start',
      data: { authenticated: true, brief: brief.markdown, brief_source: brief.source },
      humanSummary: 'Notis CLI is authenticated on this machine.',
      renderHuman: () => brief.markdown || 'Notis CLI is authenticated.',
    });
  }

  if (
    !options.email
    && !runtime.agentMode
    && !runtime.nonInteractive
    && options.wait !== false
  ) {
    let authorization;
    let authorizationError;
    try {
      authorization = await loginWithOAuth(runtime, { browser: true }, output);
    } catch (error) {
      // Keep the original OAuth failure while checking whether another process
      // completed authentication before this attempt failed.
      authorizationError = error;
      authorization = null;
    }
    if (authorization?.agentAuthorization) {
      return output.emitSuccess({
        command: 'start',
        data: { authenticated: false, ...authorization.agentAuthorization },
        humanSummary: 'Open the authorization URL to finish signing in.',
        renderHuman: () => `Authorize Notis CLI: ${authorization.agentAuthorization.authorize_url}`,
      });
    }
    // A failed authorization leaves the stale credential that got us here in
    // place, so re-apply the same expiry test used above rather than reporting
    // a machine as signed in on the strength of a dead token.
    authenticated = Boolean(runtime.jwt)
      && !credentialIsExpired(runtime, getProfile(loadConfig(runtime.worktreeRuntime), runtime.profileName));
    if (authenticated) {
      const brief = await fetchBrief(apiBase, runtime.timeoutMs);
      return output.emitSuccess({
        command: 'start',
        data: {
          authenticated: true,
          credential_source: runtime.credentialKind,
          brief: brief.markdown,
          brief_source: brief.source,
        },
        humanSummary: 'Notis CLI is authenticated. Follow the onboarding brief below.',
        renderHuman: () => brief.markdown || 'Notis CLI is authenticated.',
      });
    }
    if (authorizationError) {
      throw authorizationError;
    }
  }

  if (!options.email) {
    // The one point in the flow that has to stop and talk to the human.
    throw new CliError({
      code: 'signup_email_required',
      message: 'An email address is required to create or access a Notis account.',
      exitCode: EXIT_CODES.usage,
      hints: [
        {
          command: 'Ask the user for their email address, then rerun with --email <address>',
          reason: 'Notis sends a sign-in link there to prove they own the address',
        },
      ],
    });
  }

  const signup = await requestSignupLink(apiBase, {
    email: options.email,
    useCases: options.useCase,
  });

  // Commander stores the negatable `--no-wait` flag as `options.wait === false`
  // and never sets `options.noWait` — the same footgun already fixed for
  // `--no-open` in apps.js. Reading `noWait` made the flag a no-op, so an agent
  // that asked not to wait blocked for the full timeout instead.
  if (options.wait === false) {
    return output.emitSuccess({
      command: 'start',
      data: { authenticated: false, next_action: 'open_email_link', ...signup },
      humanSummary: `A sign-in link is on its way to ${options.email}.`,
    });
  }

  const timeoutMs = Number(options.waitTimeoutMs) > 0 ? Number(options.waitTimeoutMs) : 300_000;
  const jwt = await waitForDesktopAuth({
    loadConfig,
    getJwt: (config, profileName) => {
      const profile = getProfile(config, profileName);
      if (
        profile.jwt
        && !credentialIsExpired(
          { credentialKind: 'desktop', jwt: profile.jwt },
          profile,
        )
      ) {
        return profile.jwt;
      }
      if (
        profile.oauth_access_token
        && !credentialIsExpired(
          { credentialKind: 'oauth', jwt: profile.oauth_access_token },
          profile,
        )
      ) {
        return profile.oauth_access_token;
      }
      return undefined;
    },
    isJwtExpired: () => false,
    profileName: runtime.profileName,
    timeoutMs,
    onTick: (remaining) => {
      if (runtime.outputMode !== 'json' && remaining % 15_000 < 2_000) {
        output.note?.(`Waiting for Notis Desktop to sign in (${Math.round(remaining / 1000)}s left)...`);
      }
    },
  });

  if (!jwt) {
    throw new CliError({
      code: 'auth_timeout',
      message: 'Timed out waiting for Notis Desktop to authenticate the CLI.',
      exitCode: EXIT_CODES.auth,
      details: { desktop_download_url: signup.desktop_download_url || null },
      hints: [
        {
          command: `Install Notis Desktop: ${signup.desktop_download_url || 'https://notis.ai/channels/desktop-app'}`,
          reason: 'The desktop app is what writes the CLI credential',
        },
        { command: 'notis login', reason: 'Authorize this machine directly in a browser' },
        { command: 'notis start --brief-only', reason: 'Resume once authentication is complete' },
        { command: 'notis doctor', reason: 'Re-check config, auth, and API reachability' },
      ],
    });
  }

  const brief = await fetchBrief(apiBase, runtime.timeoutMs);
  return output.emitSuccess({
    command: 'start',
    data: { authenticated: true, brief: brief.markdown, brief_source: brief.source },
    humanSummary: 'Notis CLI is authenticated. Follow the onboarding brief below.',
    renderHuman: () => brief.markdown || 'Notis CLI is authenticated.',
  });
}

export const onboardingCommandSpecs = [
  {
    command_path: ['start'],
    summary: 'Create or access a Notis account and authorize the CLI.',
    when_to_use:
      'Run this first on a new machine, before anything that needs auth. Safe to re-run: an already-signed-in machine just reprints the onboarding brief.',
    args_schema: {
      arguments: [],
      options: [
        { flags: '--email <email>', description: 'Email to create or sign in the Notis account with.' },
        { flags: '--use-case <slug>', description: 'Primary use case (repeatable).', collect: true },
        {
          flags: '--wait-timeout-ms <n>',
          description: 'How long to wait for the desktop sign-in (default 300000).',
        },
        { flags: '--no-wait', description: 'Send the link and exit without waiting.' },
        { flags: '--brief-only', description: 'Print the onboarding brief for an already-signed-in profile.' },
      ],
    },
    examples: [
      'notis start --email you@example.com',
      'notis start --brief-only',
      'notis start --email you@example.com --json',
    ],
    output_schema:
      'Returns {authenticated, brief, brief_source} once signed in, or {next_action, cooldown_seconds, desktop_download_url} while waiting.',
    mutates: true,
    idempotent: true,
    require_auth: false,
    related_commands: ['notis doctor', 'notis tools link'],
    backend_call: { type: 'http', name: 'POST /signup/agent' },
    handler: startHandler,
  },
];
