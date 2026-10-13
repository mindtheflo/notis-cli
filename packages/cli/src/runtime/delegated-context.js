/**
 * Detect that this CLI is running *as* a Notis agent rather than for a person.
 *
 * Hand-over is the one command where that distinction matters: an agent Notis
 * is already running has no business handing the same work back to Notis, and
 * nothing about the loop it would create is self-limiting.
 *
 * The guard covers the friendly command only. Agents start and steer threads
 * on purpose through `LOCAL_NOTIS_CONTROL_THREADS`, so `notis tools exec` is
 * not refused here and the server applies no extra check. What this adds is a
 * clear message at the point of the common mistake: an agent running the
 * hand-over its own instructions describe.
 */

import { existsSync } from 'node:fs';
import { CliError, EXIT_CODES } from './errors.js';

// The cloud computer's root. Present only inside the user's Vercel sandbox.
const SANDBOX_ROOT = '/vercel/sandbox';

export function delegatedContextReason(env = process.env, { fileExists = existsSync } = {}) {
  if (env.NOTIS_DELEGATED_CONTEXT === '1') {
    // Set by Notis Desktop on every coding agent it spawns. Those runs use the
    // user's own OAuth profile, so nothing else distinguishes them.
    return 'this process was started by Notis as a delegated coding agent';
  }
  if (fileExists(SANDBOX_ROOT)) {
    return 'this process is running on the Notis cloud computer';
  }
  if (env.NOTIS_AGENT === '1' && env.NOTIS_JWT) {
    return 'this process is authenticated as a Notis agent, not as you';
  }
  return null;
}

export function assertNotDelegated(commandLabel, env = process.env) {
  const reason = delegatedContextReason(env);
  if (!reason) {
    return;
  }
  throw new CliError({
    code: 'handover_from_delegated_context',
    message:
      `\`notis ${commandLabel}\` hands work to a Notis agent, and ${reason}. ` +
      'An agent cannot hand its own task back to Notis.',
    exitCode: EXIT_CODES.usage,
    hints: [
      { message: 'Run the hand-over from the terminal on your own machine.' },
      { message: 'If you are the agent: just do the work here, in this workspace.' },
    ],
  });
}
