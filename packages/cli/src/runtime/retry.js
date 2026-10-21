import { CliError } from './errors.js';

/**
 * Safe automatic retries for tool calls.
 *
 * A call is replayed only when the replay is provably harmless:
 * - A read the server proves read-only. Keyless writes are refused before
 *   they run, so replaying a keyless call never repeats an effect.
 * - A call with an idempotency key. The server stores the first outcome under
 *   that key, so the same key and the same body either join the running call,
 *   or return its stored answer.
 * - A native write that answered "outcome unknown" and carries its own
 *   `request_id`. Its stored answer is that unknown outcome, so the replay
 *   sends identical arguments under a fresh idempotency key and the native
 *   receipt for the `request_id` decides whether it already happened.
 *
 * Every other failure is returned after the first attempt.
 */

export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 250;
export const RETRY_MAX_DELAY_MS = 2000;
const RETRY_MIN_ATTEMPT_WINDOW_MS = 1000;

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set(['network_error', 'network_timeout']);

// Native tool results that end with an unknown outcome and dedupe a replay by
// the caller's `request_id`.
export const TOOL_OUTCOME_UNKNOWN_CODES = new Set([
  'document_outcome_unknown',
  'record_file_outcome_unknown',
]);

const FALSE_VALUES = new Set(['', '0', 'false', 'no', 'off']);

/** `--no-retry` or a truthy NOTIS_NO_RETRY turns automatic retries off. */
export function resolveRetryEnabled(globalOptions = {}, env = process.env) {
  if (globalOptions.retry === false) return false;
  const raw = env.NOTIS_NO_RETRY;
  if (raw === undefined || raw === null) return true;
  return FALSE_VALUES.has(String(raw).trim().toLowerCase());
}

export function retriesEnabled(runtime) {
  return runtime?.retry !== false;
}

function backendErrorCode(details) {
  const error = details?.error;
  if (error && typeof error === 'object' && typeof error.code === 'string') return error.code;
  return typeof error === 'string' ? error : null;
}

/** Whether the failure is temporary, so the same request may succeed. */
export function isTransientFailure(error) {
  if (!(error instanceof CliError)) return false;
  if (TRANSIENT_NETWORK_CODES.has(error.code)) return true;
  const code = backendErrorCode(error.details);
  // An unknown outcome is a final answer for this key, never a transport blip.
  if (typeof code === 'string' && code.endsWith('_outcome_unknown')) return false;
  if (TRANSIENT_HTTP_STATUSES.has(error.httpStatus)) return true;
  return error.httpStatus === 409 && code === 'idempotency_in_progress';
}

/** Whether sending the identical request again can never repeat an effect. */
export function canReplayRequest({ mutating, idempotencyKey }) {
  return Boolean(idempotencyKey) || !mutating;
}

/**
 * The native outcome-unknown code a tool answer carries, if any. The answer
 * may be the tool output itself or a multi-execute envelope around it.
 */
export function findToolOutcomeUnknown(payload, depth = 0) {
  if (!payload || typeof payload !== 'object' || depth > 6) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const code = findToolOutcomeUnknown(item, depth + 1);
      if (code) return code;
    }
    return null;
  }
  const own = backendErrorCode(payload);
  if (own && TOOL_OUTCOME_UNKNOWN_CODES.has(own)) return own;
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object') {
      const code = findToolOutcomeUnknown(value, depth + 1);
      if (code) return code;
    }
  }
  return null;
}

function hasRequestId(args) {
  return Boolean(args) && typeof args === 'object' && typeof args.request_id === 'string'
    && args.request_id.trim().length > 0;
}

/**
 * Whether the call names exactly one tool whose arguments carry a stable
 * `request_id`. A batch of several tools is never resent: its other items
 * might not deduplicate a second run.
 */
export function callCarriesToolRequestId(argumentsPayload) {
  if (!argumentsPayload || typeof argumentsPayload !== 'object') return false;
  if (Array.isArray(argumentsPayload.tools)) {
    return argumentsPayload.tools.length === 1 && hasRequestId(argumentsPayload.tools[0]?.arguments);
  }
  return hasRequestId(argumentsPayload);
}

export function retryDelayMs(attempt, random = Math.random) {
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/**
 * Wait before the next attempt when it still fits in the overall time budget.
 * Returns false when no attempt is left or the budget is spent.
 */
export async function waitForNextAttempt({ attempt, deadline, budgetMs, now = Date.now, sleep = defaultSleep }) {
  if (attempt >= RETRY_MAX_ATTEMPTS) return false;
  const delay = retryDelayMs(attempt);
  const window = Math.min(RETRY_MIN_ATTEMPT_WINDOW_MS, Math.floor(budgetMs / 4));
  if (deadline - now() - delay < window) return false;
  await sleep(delay);
  return true;
}

function defaultSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Record how many attempts a failed call made, without changing its shape. */
export function withAttempts(error, attempts) {
  if (error instanceof CliError) {
    const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details)
      ? error.details
      : {};
    error.details = { ...details, attempts };
    if (attempts > 1) {
      error.hints = [
        ...(Array.isArray(error.hints) ? error.hints : []),
        { reason: `The CLI already tried this call ${attempts} times. Check the cause before running it again.` },
      ];
    }
  }
  return error;
}
