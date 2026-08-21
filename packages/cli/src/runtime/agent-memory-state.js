import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_SEEN_HASHES = 500;
const MAX_PROMPT_CHARS = 12_000;

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function statePath(sessionId, home = homedir()) {
  if (!sessionId) return null;
  return join(home, '.notis', 'agent-memory-hooks', `${hash(sessionId)}.json`);
}

function readState(sessionId, home) {
  const filePath = statePath(sessionId, home);
  if (!filePath || !existsSync(filePath)) return { seen: [], pending: null };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object'
      ? {
          seen: Array.isArray(parsed.seen) ? parsed.seen.filter((item) => typeof item === 'string') : [],
          pending: parsed.pending && typeof parsed.pending === 'object' ? parsed.pending : null,
          identity: parsed.identity && typeof parsed.identity === 'object' ? parsed.identity : null,
        }
      : { seen: [], pending: null };
  } catch {
    return { seen: [], pending: null };
  }
}

function inputIdentity(input) {
  const profile = typeof input?.profile_name === 'string' ? input.profile_name : '';
  const account = typeof input?.account_id === 'string' ? input.account_id : '';
  const apiBase = typeof input?.api_base === 'string' ? input.api_base : '';
  return profile && account && apiBase ? { profile, account, apiBase } : null;
}

function identityMatches(left, right) {
  return (!left && !right) || Boolean(
    left && right
      && left.profile === right.profile
      && left.account === right.account
      && left.apiBase === right.apiBase,
  );
}

function stateForInput(sessionId, input, home) {
  const state = readState(sessionId, home);
  const identity = inputIdentity(input);
  if (identityMatches(state.identity, identity)) return state;
  return { seen: [], pending: null, identity };
}

function writeState(sessionId, state, home) {
  const filePath = statePath(sessionId, home);
  if (!filePath) return;
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

export function rememberPendingTurn(input, home = homedir()) {
  const sessionId = input?.session_id;
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (!sessionId || !prompt || ['/', '!', '#'].includes(prompt[0])) return;
  const state = stateForInput(sessionId, input, home);
  state.pending = {
    prompt: prompt.slice(0, MAX_PROMPT_CHARS),
    turn_id: typeof input?.turn_id === 'string' ? input.turn_id : null,
    cwd: typeof input?.cwd === 'string' ? input.cwd : null,
    recorded_at: new Date().toISOString(),
  };
  writeState(sessionId, state, home);
}

export function pendingTurn(input, home = homedir()) {
  const sessionId = input?.session_id;
  const state = readState(sessionId, home);
  const identity = inputIdentity(input);
  if (!identityMatches(state.identity, identity)) {
    if (sessionId) writeState(sessionId, { seen: [], pending: null, identity }, home);
    return null;
  }
  if (!state.pending) return null;
  if (state.pending.turn_id && input?.turn_id && state.pending.turn_id !== input.turn_id) return null;
  return state.pending;
}

export function completePendingTurn(input, home = homedir()) {
  const sessionId = input?.session_id;
  if (!sessionId) return;
  const filePath = statePath(sessionId, home);
  if (!filePath || !existsSync(filePath)) return;
  const state = readState(sessionId, home);
  if (!state.pending) return;
  state.pending = null;
  writeState(sessionId, state, home);
}

export function freshRecallItems(input, items, home = homedir()) {
  const sessionId = input?.session_id;
  if (!sessionId) return items;
  const state = stateForInput(sessionId, input, home);
  const seen = new Set(state.seen);
  const fresh = [];
  for (const item of items) {
    const fingerprint = hash(item);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    fresh.push(item);
  }
  state.seen = [...seen].slice(-MAX_SEEN_HASHES);
  writeState(sessionId, state, home);
  return fresh;
}
