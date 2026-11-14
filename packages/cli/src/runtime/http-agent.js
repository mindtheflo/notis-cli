/**
 * Node's fetch gives up on any answer that takes longer than 300 s to start (headersTimeout) or
 * pauses longer than 300 s mid-body (bodyTimeout), and reports it as a bare "fetch failed". The
 * CLI already bounds every request with its own AbortSignal (--timeout-ms, or a longer limit a
 * command sets), so these requests go through an agent without those two hidden limits: the
 * caller's signal is the one deadline, and its timeout message is the one a user reads.
 *
 * Only pass this dispatcher with a signal that ends the request.
 */
let agent;

/**
 * Node's own fetch sends through HTTP_PROXY / HTTPS_PROXY (and honours NO_PROXY) only when its env
 * proxy is on (NODE_USE_ENV_PROXY=1 or --use-env-proxy). A plain Agent would connect directly, so
 * that case keeps the proxy with undici's EnvHttpProxyAgent, which reads the same variables.
 */
export function nodeEnvProxyEnabled(env = process.env, execArgv = process.execArgv) {
  // As Node decides: the last --use-env-proxy / --no-use-env-proxy wins (NODE_OPTIONS, then the command line),
  // and without either flag only NODE_USE_ENV_PROXY=1 turns it on.
  const flags = [...String(env.NODE_OPTIONS || '').split(/\s+/), ...execArgv]
    .filter(flag => flag === '--use-env-proxy' || flag === '--no-use-env-proxy');
  return flags.length ? flags.at(-1) === '--use-env-proxy' : env.NODE_USE_ENV_PROXY === '1';
}

export async function deadlineDispatcher() {
  if (agent === undefined) {
    try {
      const { Agent, EnvHttpProxyAgent } = await import('undici');
      const options = { headersTimeout: 0, bodyTimeout: 0 };
      agent = nodeEnvProxyEnabled() ? new EnvHttpProxyAgent(options) : new Agent(options);
    } catch {
      // A checkout whose dependencies predate undici keeps Node's default agent and its 300 s limits.
      agent = null;
    }
  }
  return agent ?? undefined;
}

// A connect timeout is undici's own 10 s, not a slow answer: it stays a network_error naming UND_ERR_CONNECT_TIMEOUT.
const TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/** The network code under fetch's bare "fetch failed" (ECONNRESET, ENOTFOUND, UND_ERR_SOCKET, ...), when there is one. */
export function networkCauseCode(error) {
  for (let value = error, depth = 0; value && depth < 4; value = value.cause, depth += 1) {
    if (typeof value.code === 'string' && value.code) return value.code;
  }
  return null;
}

/** True when the transport itself stopped waiting for an answer (not our own AbortSignal). */
export function isTransportTimeout(error) {
  return TIMEOUT_CODES.has(networkCauseCode(error));
}
