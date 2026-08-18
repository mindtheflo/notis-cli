/**
 * Detect that this CLI is running *as* a Notis agent rather than for a person.
 *
 * Hand-over is the one command where that distinction matters: an agent Notis
 * is already running has no business handing the same work back to Notis, and
 * nothing about the loop it would create is self-limiting.
 *
 * This is the polite half of the guard. The server refuses the same call unless
 * it carries a purpose-scoped CLI/MCP OAuth token, which a delegated runtime
 * never has -- that is the half that actually holds. What this adds is a clear
 * message at the point of the mistake, instead of a permission error the agent
 * will try to work around.
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

/**
 * Tools that hand work to a Notis agent, by canonical name.
 *
 * `notis handover` is not the only way to reach these: `notis tools exec` takes
 * any tool name, and `tools exec-parallel` takes a list of them. Guarding only
 * the friendly command would leave the escape hatch it exists to wrap.
 */
export const HANDOVER_TOOL_NAMES = new Set(['LOCAL_NOTIS_HAND_OVER']);

export function assertToolNotDelegated(toolName, env = process.env) {
  if (!HANDOVER_TOOL_NAMES.has(String(toolName || '').toUpperCase())) {
    return;
  }
  assertNotDelegated(`tools exec ${toolName}`, env);
}
