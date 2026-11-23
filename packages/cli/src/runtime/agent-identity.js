import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveCliConfigFile, withConfigFileWriteLock } from './config-lock.js';
import { usageError } from './errors.js';

/**
 * An agent's declared identity, sent on every backend call.
 *
 * Any agent driving the CLI (Claude Code or Codex on a person's computer, a script, a Cloud Computer session) says
 * who it is with `--agent-name`, `--agent-id`, `--agent-thread` and `--agent-thread-name`, or the NOTIS_AGENT_NAME,
 * NOTIS_AGENT_ID, NOTIS_AGENT_THREAD and NOTIS_AGENT_THREAD_NAME variables (a flag wins over its variable). The backend then treats what the call writes as that
 * agent's, not the person's: a comment's Author is the declared name, it never counts as the person's comment and it
 * never wakes the agent that wrote it. The declaration is self-asserted: it names the writer, it never grants access.
 *
 * The name is a band name: a fresh lowercase imaginary rock-band name, lowercase letters and digits in at least two
 * words joined by hyphens, 3 to 60 characters, such as fred-and-the-machine, never a harness or product name
 * (RESERVED_AGENT_NAMES: claude, codex, notis-agent...), so each sub-agent shows. The name is only a name: the id
 * decides which comments are the agent's own. The id may be the agent's own session id (a T3 thread id, a Codex or
 * Claude session id); without one the CLI generates a random one the first time a name is used on this computer and
 * keeps it for that name in `agents.json`, next to the CLI config file (so NOTIS_CLI_CONFIG_FILE moves it too),
 * written under the config lock. An explicit id always wins.
 *
 * The thread name labels the thread the agent works in (a T3 thread title, "PR #3851"), shown after its name on its
 * comments and on the Goes to line. The harness (claude_code, codex, cursor_agent...) is detected from the
 * environment the agent's tool sets (detectAgentHarness), or NOTIS_AGENT_HARNESS, and shows as its logo.
 *
 * The values travel percent-encoded (encodeURIComponent) in the X-Notis-Agent-* headers. The backend applies the same
 * rules (server/lib/delegated_agents/declared_agent.py) and refuses a comment written through the CLI without a name.
 */
export const AGENT_NAME_HEADER = 'X-Notis-Agent-Name';
export const AGENT_ID_HEADER = 'X-Notis-Agent-Id';
export const AGENT_THREAD_HEADER = 'X-Notis-Agent-Thread';
export const AGENT_THREAD_NAME_HEADER = 'X-Notis-Agent-Thread-Name';
export const AGENT_HARNESS_HEADER = 'X-Notis-Agent-Harness';
export const AGENT_IDENTITY_ENV = {
  name: 'NOTIS_AGENT_NAME',
  id: 'NOTIS_AGENT_ID',
  thread: 'NOTIS_AGENT_THREAD',
  threadName: 'NOTIS_AGENT_THREAD_NAME',
  harness: 'NOTIS_AGENT_HARNESS',
};
export const AGENT_NAME_MIN = 3;
export const AGENT_NAME_LIMIT = 60;
export const BAND_NAME_EXAMPLE = 'fred-and-the-machine';
export const BAND_NAME_RULE = `a fresh lowercase imaginary rock-band name: lowercase letters and digits in at least two words joined by hyphens, ${AGENT_NAME_MIN} to ${AGENT_NAME_LIMIT} characters, such as ${BAND_NAME_EXAMPLE}`;
export const AGENT_IDS_VERSION = 1;
export const AGENT_ID_MIN = 3;
export const AGENT_ID_LIMIT = 128;
export const AGENT_THREAD_LIMIT = 512;
export const AGENT_THREAD_NAME_LIMIT = 80;
export const AGENT_HARNESS_LIMIT = 40;
// A harness or product name is no band name (server/lib/delegated_agents/declared_agent.py RESERVED_NAMES, the same list).
const RESERVED_BASES = ['claude', 'claude-code', 'codex', 'cursor', 'cursor-agent', 'gemini', 'notis', 't3', 't3-code',
  'opencode', 'agent', 'assistant', 'bot'];
export const RESERVED_AGENT_NAMES = Object.freeze(new Set(
  RESERVED_BASES.flatMap((base) => [base, `${base}-cli`, `${base}-agent`]),
));

const BAND_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;
// Printable ASCII without spaces: an id or a link.
const THREAD_PATTERN = /^[\x21-\x7e]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\x00-\x1f\x7f]/;
const HARNESS_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * The harness running this process, from the variables each tool sets in the shells it starts, or null. Claude Code
 * sets CLAUDECODE=1 with CLAUDE_CODE_ENTRYPOINT and CLAUDE_CODE_SESSION_ID, Codex CODEX_* (CODEX_SANDBOX,
 * CODEX_THREAD_ID...; CODEX_HOME is a person's own setting), Cursor's agent CURSOR_AGENT, Gemini CLI GEMINI_CLI,
 * OpenCode OPENCODE; AI_AGENT names it in the shared convention. T3 Code runs one of these, which names the harness.
 */
export function detectAgentHarness(env = process.env) {
  const set = (name) => typeof env[name] === 'string' && env[name].trim() !== '';
  if (set('CLAUDECODE') || set('CLAUDE_CODE_ENTRYPOINT') || set('CLAUDE_CODE_SESSION_ID')) return 'claude_code';
  if (Object.keys(env).some((key) => key.startsWith('CODEX_') && key !== 'CODEX_HOME' && set(key))) return 'codex';
  if (set('CURSOR_AGENT')) return 'cursor_agent';
  if (set('GEMINI_CLI')) return 'gemini';
  if (set('OPENCODE')) return 'opencode';
  const named = String(env.AI_AGENT ?? '').toLowerCase();
  if (named.startsWith('claude')) return 'claude_code';
  if (named.startsWith('codex')) return 'codex';
  if (named.startsWith('cursor')) return 'cursor_agent';
  return null;
}

/** Whether `name` is a harness or product name rather than a band name (RESERVED_AGENT_NAMES). */
export function isReservedAgentName(name) {
  return typeof name === 'string' && RESERVED_AGENT_NAMES.has(name.trim().toLowerCase());
}

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
  const threadName = pick(globalOptions.agentThreadName, env[AGENT_IDENTITY_ENV.threadName]);
  if (threadName !== undefined) raw.threadName = threadName;
  if (!Object.values(raw).some((value) => typeof value === 'string' && value.trim())) return null;
  // The harness alone declares nothing: it is only sent with a declaration.
  const harness = pick(undefined, env[AGENT_IDENTITY_ENV.harness]) ?? detectAgentHarness(env);
  return harness ? { ...raw, harness } : raw;
}

/** The validated declaration ({name, id?, thread?, threadName?, harness?}), or null; a usage error names what to fix. */
export function validateAgentIdentity(raw) {
  if (!raw) return null;
  const name = String(raw.name ?? '').trim();
  const id = String(raw.id ?? '').trim();
  const thread = String(raw.thread ?? '').trim();
  const threadName = String(raw.threadName ?? '').trim();
  const harnessText = String(raw.harness ?? '').trim().toLowerCase();
  if (!name) {
    throw usageError(
      `Name the agent: set ${AGENT_IDENTITY_ENV.name} (or --agent-name) whenever ${AGENT_IDENTITY_ENV.id}, ${AGENT_IDENTITY_ENV.thread} or ${AGENT_IDENTITY_ENV.threadName} is set.`,
    );
  }
  if (isReservedAgentName(name)) {
    throw usageError(
      `${AGENT_IDENTITY_ENV.name} (or --agent-name) "${name.slice(0, AGENT_NAME_LIMIT)}" is a harness or product name, not a band name. Pick ${BAND_NAME_RULE}, of your own for this agent, and keep it.`,
    );
  }
  if (!isBandName(name)) {
    throw usageError(
      `${AGENT_IDENTITY_ENV.name} (or --agent-name) must be ${BAND_NAME_RULE}. Pick one for this agent and keep it.`,
    );
  }
  if (id && (id.length < AGENT_ID_MIN || id.length > AGENT_ID_LIMIT || !ID_PATTERN.test(id))) {
    throw usageError(
      `${AGENT_IDENTITY_ENV.id} must be ${AGENT_ID_MIN} to ${AGENT_ID_LIMIT} characters: letters, digits and . _ : @ / + - , starting with a letter or digit (your own session id, or leave it unset and the CLI keeps one for the name).`,
    );
  }
  if (thread && (thread.length > AGENT_THREAD_LIMIT || !THREAD_PATTERN.test(thread))) {
    throw usageError(
      `${AGENT_IDENTITY_ENV.thread} must be a thread id or link of at most ${AGENT_THREAD_LIMIT} characters, without spaces.`,
    );
  }
  if (threadName && (Array.from(threadName).length > AGENT_THREAD_NAME_LIMIT || CONTROL_PATTERN.test(threadName))) {
    throw usageError(
      `${AGENT_IDENTITY_ENV.threadName} (or --agent-thread-name) must be the name of the thread you work in, at most ${AGENT_THREAD_NAME_LIMIT} characters on one line.`,
    );
  }
  // A harness that is no identifier is dropped, never refused: it only picks a logo.
  const harness = harnessText.length <= AGENT_HARNESS_LIMIT && HARNESS_PATTERN.test(harnessText) ? harnessText : '';
  return {
    name,
    ...(id ? { id } : {}),
    ...(thread ? { thread } : {}),
    ...(threadName ? { threadName } : {}),
    ...(harness ? { harness } : {}),
  };
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
  put(AGENT_THREAD_NAME_HEADER, raw?.threadName);
  put(AGENT_HARNESS_HEADER, raw?.harness);
  return headers;
}

/** Whether `name` follows the band-name rule (BAND_NAME_RULE) and is no harness or product name. */
export function isBandName(name) {
  return typeof name === 'string' && name.length >= AGENT_NAME_MIN && name.length <= AGENT_NAME_LIMIT
    && BAND_NAME.test(name) && !isReservedAgentName(name);
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
  return typeof id === 'string' && id.length >= AGENT_ID_MIN && id.length <= AGENT_ID_LIMIT && ID_PATTERN.test(id)
    ? id : null;
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
    // A declaration that breaks the rules is sent as written, with no kept id: the routes that read declarations
    // (tools, Space data and actions, document restores and removes) refuse the call with invalid_agent_identity,
    // reads included. The server is the one judge, so the CLI never refuses it first.
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
  if (identity.threadName) headers[AGENT_THREAD_NAME_HEADER] = encodeURIComponent(identity.threadName);
  if (identity.harness) headers[AGENT_HARNESS_HEADER] = encodeURIComponent(identity.harness);
  return headers;
}
