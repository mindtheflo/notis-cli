import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveCliConfigFile, withConfigFileWriteLock } from './config-lock.js';
import { usageError } from './errors.js';

/**
 * An agent's declared identity, sent on every backend call.
 *
 * Any agent driving the CLI (Claude Code or Codex on a person's computer, a script, a Cloud Computer session) says
 * who it is with `--agent-name`, `--agent-id` and `--agent-thread`, or the NOTIS_AGENT_NAME, NOTIS_AGENT_ID and
 * NOTIS_AGENT_THREAD variables (a flag wins over its variable). The backend then treats what the call writes as that
 * agent's, not the person's: a comment's Author is the declared name, it never counts as the person's comment and it
 * never wakes the agent that wrote it. The declaration is self-asserted: it names the writer, it never grants access.
 *
 * The name is a band name: a fresh lowercase imaginary rock-band name, lowercase letters and digits in at least two
 * words joined by hyphens, 3 to 60 characters, such as fred-and-the-machine. The name is only a name: the id decides
 * which comments are the agent's own. Without an explicit id the CLI generates a random one the first time a name is
 * used on this computer and keeps it for that name in `agents.json`, next to the CLI config file (so
 * NOTIS_CLI_CONFIG_FILE moves it too), written under the config lock. An explicit id always wins.
 *
 * The values travel percent-encoded (encodeURIComponent) in the X-Notis-Agent-* headers. The backend applies the same
 * rules (server/lib/delegated_agents/declared_agent.py) and refuses a comment written through the CLI without a name.
 */
export const AGENT_NAME_HEADER = 'X-Notis-Agent-Name';
export const AGENT_ID_HEADER = 'X-Notis-Agent-Id';
export const AGENT_THREAD_HEADER = 'X-Notis-Agent-Thread';
export const AGENT_IDENTITY_ENV = {
  name: 'NOTIS_AGENT_NAME',
  id: 'NOTIS_AGENT_ID',
  thread: 'NOTIS_AGENT_THREAD',
};
export const AGENT_NAME_MIN = 3;
export const AGENT_NAME_LIMIT = 60;
export const BAND_NAME_EXAMPLE = 'fred-and-the-machine';
export const BAND_NAME_RULE = `a fresh lowercase imaginary rock-band name: lowercase letters and digits in at least two words joined by hyphens, ${AGENT_NAME_MIN} to ${AGENT_NAME_LIMIT} characters, such as ${BAND_NAME_EXAMPLE}`;
export const AGENT_IDS_VERSION = 1;
export const AGENT_ID_LIMIT = 128;
export const AGENT_THREAD_LIMIT = 512;

const BAND_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;
// Printable ASCII without spaces: an id or a link.
const THREAD_PATTERN = /^[\x21-\x7e]+$/;

function pick(flag, variable) {
  if (typeof flag === 'string') return flag;
  return typeof variable === 'string' ? variable : undefined;
}

/** The raw declaration from the global flags and the environment, or null when nothing is declared. */
export function readAgentIdentity(globalOptions = {}, env = process.env) {
  const raw = {
    name: pick(globalOptions.agentName, env[AGENT_IDENTITY_ENV.name]),
    id: pick(globalOptions.agentId, env[AGENT_IDENTITY_ENV.id]),
    thread: pick(globalOptions.agentThread, env[AGENT_IDENTITY_ENV.thread]),
  };
  return Object.values(raw).some((value) => typeof value === 'string' && value.trim()) ? raw : null;
}

/** The validated declaration ({name, id?, thread?}), or null; a usage error names what to fix. */
export function validateAgentIdentity(raw) {
  if (!raw) return null;
  const name = String(raw.name ?? '').trim();
  const id = String(raw.id ?? '').trim();
  const thread = String(raw.thread ?? '').trim();
  if (!name) {
    throw usageError(
      `Name the agent: set ${AGENT_IDENTITY_ENV.name} (or --agent-name) whenever ${AGENT_IDENTITY_ENV.id} or ${AGENT_IDENTITY_ENV.thread} is set.`,
    );
  }
  if (!isBandName(name)) {
    throw usageError(
      `${AGENT_IDENTITY_ENV.name} (or --agent-name) must be ${BAND_NAME_RULE}. Pick one for this agent and keep it.`,
    );
  }
  if (id && (id.length > AGENT_ID_LIMIT || !ID_PATTERN.test(id))) {
    throw usageError(
      `${AGENT_IDENTITY_ENV.id} must be at most ${AGENT_ID_LIMIT} characters: letters, digits and . _ : @ / + - , starting with a letter or digit.`,
    );
  }
  if (thread && (thread.length > AGENT_THREAD_LIMIT || !THREAD_PATTERN.test(thread))) {
    throw usageError(
      `${AGENT_IDENTITY_ENV.thread} must be a thread id or link of at most ${AGENT_THREAD_LIMIT} characters, without spaces.`,
    );
  }
  return { name, ...(id ? { id } : {}), ...(thread ? { thread } : {}) };
}

const RAW_HEADER_LIMIT = AGENT_THREAD_LIMIT;

function rawIdentityHeaders(raw) {
  const headers = {};
  const put = (header, value) => {
    // Capped by whole characters (never splitting one, which encodeURIComponent refuses), one past the longest
    // valid value, so a value too long stays too long for the backend to refuse.
    const text = Array.from(String(value ?? '').trim()).slice(0, RAW_HEADER_LIMIT + 1).join('');
    if (text) headers[header] = encodeURIComponent(text);
  };
  put(AGENT_NAME_HEADER, raw?.name);
  put(AGENT_ID_HEADER, raw?.id);
  put(AGENT_THREAD_HEADER, raw?.thread);
  return headers;
}

/** Whether `name` follows the band-name rule (BAND_NAME_RULE). */
export function isBandName(name) {
  return typeof name === 'string' && name.length >= AGENT_NAME_MIN && name.length <= AGENT_NAME_LIMIT
    && BAND_NAME.test(name);
}

export function agentIdsFile(configFile = resolveCliConfigFile()) {
  return join(dirname(configFile), 'agents.json');
}

function readAgentIds(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw?.version === AGENT_IDS_VERSION && raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)) {
      return raw.agents;
    }
  } catch {
    // A missing or broken file holds no ids yet.
  }
  return {};
}

function storedId(agents, name) {
  const id = Object.hasOwn(agents, name) ? agents[name] : null;
  return typeof id === 'string' && id.length <= AGENT_ID_LIMIT && ID_PATTERN.test(id) ? id : null;
}

/**
 * The id this computer keeps for an agent name, generated (a random UUID) the first time the name is used. Read again
 * under the config lock so two first calls agree on one id.
 */
export function agentIdForName(name, options = {}) {
  const configFile = options.configFile ?? resolveCliConfigFile();
  const file = agentIdsFile(configFile);
  const known = storedId(readAgentIds(file), name);
  if (known) return known;
  return withConfigFileWriteLock(configFile, () => {
    const agents = readAgentIds(file);
    const existing = storedId(agents, name);
    if (existing) return existing;
    const id = randomUUID();
    mkdirSync(dirname(file), { recursive: true });
    const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporaryFile, `${JSON.stringify({ version: AGENT_IDS_VERSION, agents: { ...agents, [name]: id } }, null, 2)}\n`,
      { mode: 0o600 });
    renameSync(temporaryFile, file);
    return id;
  });
}

/**
 * The headers that declare the runtime's agent (empty when it declares none). A name without an explicit id carries
 * the id this computer keeps for it; when that id cannot be kept (a read-only disk) the name goes alone and the
 * backend asks for NOTIS_AGENT_ID before a comment write.
 */
export function agentIdentityHeaders(runtime, options = {}) {
  const raw = runtime?.agentIdentity ?? null;
  let identity;
  try {
    identity = validateAgentIdentity(raw);
  } catch {
    // A declaration that breaks the rules is sent as written, with no kept id: where declarations count (unified
    // comments on) the routes that read them (tools, Space data and actions, document restores and removes) refuse
    // the call with invalid_agent_identity, reads included; elsewhere it is ignored, so a stray NOTIS_AGENT_NAME never
    // breaks a person without unified comments.
    return rawIdentityHeaders(raw);
  }
  if (!identity) return {};
  let id = identity.id;
  if (!id) {
    try {
      id = agentIdForName(identity.name, options);
    } catch {
      id = undefined;
    }
  }
  const headers = { [AGENT_NAME_HEADER]: encodeURIComponent(identity.name) };
  if (id) headers[AGENT_ID_HEADER] = encodeURIComponent(id);
  if (identity.thread) headers[AGENT_THREAD_HEADER] = encodeURIComponent(identity.thread);
  return headers;
}
