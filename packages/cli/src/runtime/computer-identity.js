import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveCliConfigFile, withConfigFileWriteLock } from './config-lock.js';

// This computer's identity, shared by the CLI and Desktop: one stable id per
// computer (the server keeps one CLI sign-in and one local shell connection per
// computer) and the name the user sees for it. It lives next to the CLI config
// file, so NOTIS_CLI_CONFIG_FILE moves it too, and is written under the same
// lock as the config.
export const COMPUTER_IDENTITY_VERSION = 1;
export const COMPUTER_NAME_MAX_LENGTH = 64;
const COMPUTER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FALLBACK_COMPUTER_NAME = 'Computer';

export function computerIdentityFile(configFile = resolveCliConfigFile()) {
  return join(dirname(configFile), 'computer.json');
}

/**
 * Trim, collapse whitespace and cap at 64 characters. Returns null for a name
 * that is empty after cleanup, which means "use the computer's own name".
 */
export function normalizeComputerName(value) {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  if (!collapsed) return null;
  // Count code points so a cut never splits a character in two.
  const characters = Array.from(collapsed);
  if (characters.length <= COMPUTER_NAME_MAX_LENGTH) return collapsed;
  return characters.slice(0, COMPUTER_NAME_MAX_LENGTH).join('').trim();
}

function readMacComputerName() {
  try {
    return execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    });
  } catch {
    return null;
  }
}

/**
 * The computer's own name: the macOS Computer Name, else the host name without
 * a trailing `.local`.
 */
export function defaultComputerName(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') {
    const macName = normalizeComputerName((options.readMacComputerName ?? readMacComputerName)());
    if (macName) return macName;
  }
  let host = '';
  try {
    host = String((options.hostname ?? osHostname)() || '');
  } catch {
    host = '';
  }
  return normalizeComputerName(host.replace(/\.local\.?$/iu, '')) || FALLBACK_COMPUTER_NAME;
}

function parseIdentityFile(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
}

function validStored(raw) {
  if (!raw || raw.version !== COMPUTER_IDENTITY_VERSION) return null;
  if (typeof raw.computer_id !== 'string' || !COMPUTER_ID_PATTERN.test(raw.computer_id)) return null;
  return {
    computerId: raw.computer_id.toLowerCase(),
    name: normalizeComputerName(raw.name),
  };
}

function writeIdentityFile(file, stored) {
  mkdirSync(dirname(file), { recursive: true });
  const contents = {
    version: COMPUTER_IDENTITY_VERSION,
    computer_id: stored.computerId,
    ...(stored.name ? { name: stored.name } : {}),
  };
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryFile, file);
}

function withIdentity(stored, options) {
  const defaultName = defaultComputerName(options);
  return {
    computerId: stored.computerId,
    name: stored.name,
    defaultName,
    displayName: stored.name ?? defaultName,
  };
}

// Under the config lock: re-read so two first reads agree on one id, then
// create (or repair) the file only when it holds no valid identity.
function readOrCreateLocked(configFile, file) {
  const raw = parseIdentityFile(file);
  const existing = validStored(raw);
  if (existing) return existing;
  const created = {
    computerId: randomUUID(),
    // A file with a broken id keeps the name the user chose.
    name: normalizeComputerName(raw?.name),
  };
  writeIdentityFile(file, created);
  return created;
}

/**
 * Read this computer's identity, creating `computer.json` on first read.
 */
export function readComputerIdentity(options = {}) {
  const configFile = options.configFile ?? resolveCliConfigFile();
  const file = computerIdentityFile(configFile);
  const stored = validStored(parseIdentityFile(file))
    ?? withConfigFileWriteLock(configFile, () => readOrCreateLocked(configFile, file));
  return withIdentity(stored, options);
}

/**
 * Rename this computer for every account on it. An empty name goes back to the
 * computer's own name.
 */
export function setComputerName(name, options = {}) {
  const configFile = options.configFile ?? resolveCliConfigFile();
  const file = computerIdentityFile(configFile);
  const stored = withConfigFileWriteLock(configFile, () => {
    const current = readOrCreateLocked(configFile, file);
    const next = { computerId: current.computerId, name: normalizeComputerName(name) };
    if (next.name !== current.name) {
      writeIdentityFile(file, next);
    }
    return next;
  });
  return withIdentity(stored, options);
}
