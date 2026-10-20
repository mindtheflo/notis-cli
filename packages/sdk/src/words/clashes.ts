/**
 * Key clash rules (toolkit spec 2.1). The engine runs them at registration; the design check (stream C) runs
 * `checkClashes` on a Space's declared shortcuts at build time. Pure.
 */

import { canonicalKey, isHostReserved, keyList, parseKeySpec } from './keys';
import { SCOPE_ORDER, type KeySpec, type Scope } from './types';

export type ClashKind =
  /** A Space binds a key the Notis host owns. Error. */
  | 'reserved'
  /** A Space registers at app scope, which is host only (spec 6.7). Error. */
  | 'app-scope'
  /** Same key, same scope, same owner, both available. Error. */
  | 'duplicate'
  /** Same key at different scopes: legal, the higher scope wins. Info. */
  | 'shadowed'
  /** A single key that also starts a sequence in the same scope and owner ('g' and 'g i'): the single key wins. Info. */
  | 'prefix'
  /** The spec does not parse. Error. */
  | 'invalid';

export interface ClashCandidate {
  id: string;
  keys: KeySpec | readonly KeySpec[];
  scope: Scope;
  /** Who registered it: a Space id, a retained view, or 'notis'. Default 'notis'. */
  owner?: string;
  /** 'space' defs may not use reserved keys or the app scope. Default 'space' when owner is set and not 'notis'. */
  ownerKind?: 'space' | 'host';
  /** Default true. Unavailable defs (hidden retained views) never clash. */
  available?: boolean;
}

export interface Clash {
  kind: ClashKind;
  severity: 'error' | 'info';
  /** Canonical key ('shift+e', 'g i'). */
  key: string;
  ids: string[];
  scope?: Scope;
  scopes?: Scope[];
  owner?: string;
  message: string;
}

const PLATFORMS = ['mac', 'other'] as const;

/** Canonical forms of a def's keys on both platforms ('ctrl+a' equals 'mod+a' off a Mac). */
export function keyFingerprints(keys: KeySpec | readonly KeySpec[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const spec of keyList(keys)) {
    for (const platform of PLATFORMS) out.set(`${platform}:${canonicalKey(spec, platform)}`, canonicalKey(spec, 'mac'));
  }
  return out;
}

export function ownerOf(candidate: ClashCandidate): string {
  return candidate.owner ?? 'notis';
}

export function ownerKindOf(candidate: ClashCandidate): 'space' | 'host' {
  if (candidate.ownerKind) return candidate.ownerKind;
  return ownerOf(candidate) === 'notis' ? 'host' : 'space';
}

/** Errors a single def has on its own (invalid, reserved, app scope). */
export function selfClashes(candidate: ClashCandidate): Clash[] {
  const clashes: Clash[] = [];
  const space = ownerKindOf(candidate) === 'space';
  for (const spec of keyList(candidate.keys)) {
    try { parseKeySpec(spec); } catch (error) {
      clashes.push({
        kind: 'invalid', severity: 'error', key: spec, ids: [candidate.id], scope: candidate.scope,
        owner: ownerOf(candidate), message: (error as Error).message,
      });
      continue;
    }
    if (space && isHostReserved(spec)) {
      clashes.push({
        kind: 'reserved', severity: 'error', key: canonicalKey(spec), ids: [candidate.id], scope: candidate.scope,
        owner: ownerOf(candidate),
        message: `"${candidate.id}" uses ${canonicalKey(spec)}, which Notis keeps for itself. Pick another key.`,
      });
    }
  }
  if (space && candidate.scope === 'app') {
    clashes.push({
      kind: 'app-scope', severity: 'error', key: keyList(candidate.keys).join(', '), ids: [candidate.id],
      scope: 'app', owner: ownerOf(candidate),
      message: `"${candidate.id}" registers at app scope, which only Notis uses. Use route or a lower scope.`,
    });
  }
  return clashes;
}

function safeFingerprints(keys: KeySpec | readonly KeySpec[]): Map<string, string> {
  try { return keyFingerprints(keys); } catch { return new Map(); }
}

/** Errors and infos between two defs, `later` registered after `earlier`. */
export function pairClashes(earlier: ClashCandidate, later: ClashCandidate): Clash[] {
  if (earlier.available === false || later.available === false) return [];
  const a = safeFingerprints(earlier.keys);
  const b = safeFingerprints(later.keys);
  const shared = new Set<string>();
  for (const [fingerprint, key] of b) if (a.has(fingerprint)) shared.add(key);
  const clashes: Clash[] = [];
  const sameOwner = ownerOf(earlier) === ownerOf(later);
  for (const key of shared) {
    if (earlier.scope === later.scope && sameOwner) {
      clashes.push({
        kind: 'duplicate', severity: 'error', key, ids: [earlier.id, later.id], scope: later.scope,
        owner: ownerOf(later),
        message: `NotisKeyClash: "${earlier.id}" and "${later.id}" both use ${key} in the ${later.scope} scope.`,
      });
    } else if (earlier.scope !== later.scope) {
      const [low, high] = SCOPE_ORDER[earlier.scope] < SCOPE_ORDER[later.scope] ? [earlier, later] : [later, earlier];
      clashes.push({
        kind: 'shadowed', severity: 'info', key, ids: [high.id, low.id], scopes: [high.scope, low.scope],
        message: `${key}: "${high.id}" (${high.scope}) is asked before "${low.id}" (${low.scope}).`,
      });
    }
  }
  if (earlier.scope === later.scope && sameOwner) {
    for (const [single, sequence] of [[earlier, later], [later, earlier]] as const) {
      for (const one of keyList(single.keys)) {
        for (const seq of keyList(sequence.keys)) {
          let s: ReturnType<typeof parseKeySpec>; let q: ReturnType<typeof parseKeySpec>;
          try { s = parseKeySpec(one); q = parseKeySpec(seq); } catch { continue; }
          if (s.length !== 1 || q.length < 2) continue;
          if (canonicalKey(one) !== canonicalKey(seq).split(' ')[0]) continue;
          clashes.push({
            kind: 'prefix', severity: 'info', key: canonicalKey(one), ids: [single.id, sequence.id],
            scope: single.scope, owner: ownerOf(single),
            message: `${canonicalKey(one)} runs "${single.id}" at once, so "${sequence.id}" (${canonicalKey(seq)}) never starts.`,
          });
        }
      }
    }
  }
  return clashes;
}

/** Every clash in a list of defs, in registration order. */
export function checkClashes(defs: readonly ClashCandidate[]): Clash[] {
  const clashes: Clash[] = [];
  defs.forEach((def, index) => {
    clashes.push(...selfClashes(def));
    for (let i = 0; i < index; i += 1) clashes.push(...pairClashes(defs[i]!, def));
  });
  return clashes;
}

/** Only the clashes that must stop a build or throw in dev. */
export function clashErrors(defs: readonly ClashCandidate[]): Clash[] {
  return checkClashes(defs).filter((clash) => clash.severity === 'error');
}
