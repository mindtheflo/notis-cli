/**
 * One engine per page, even when two copies of the toolkit load (a Space bundle that inlined `@notis/sdk/ui` by
 * mistake). The first copy stores its core and React contexts on `globalThis` under a registered symbol; a second
 * copy logs once and reuses them, so its shortcuts land in the same registry and its hooks read the same contexts.
 */

import { createContext, type Context } from 'react';
import { KeyboardEngineCore } from './core';
import { ROOT_OWNER } from './registry';
import type { KeycapOn } from './keycapContext';

export interface SharedInstance {
  readonly version: 1;
  readonly core: KeyboardEngineCore;
  /** An injected core (tests, preview) overrides the shared one below it. */
  readonly EngineContext: Context<KeyboardEngineCore | null>;
  /** The nearest `<ShortcutScope>` owner. */
  readonly OwnerContext: Context<string>;
  /** Keycap `on` default for a subtree (SelectionBar: pill, Menu and HelpSheet: discreet). */
  readonly KeycapContext: Context<KeycapOn | null>;
}

const KEY = Symbol.for('notis.sdk.ui.instance');

type Slot = { [KEY]?: SharedInstance };

function create(): SharedInstance {
  return Object.freeze({
    version: 1 as const,
    core: new KeyboardEngineCore(),
    EngineContext: createContext<KeyboardEngineCore | null>(null),
    OwnerContext: createContext<string>(ROOT_OWNER),
    KeycapContext: createContext<KeycapOn | null>(null),
  });
}

let local: SharedInstance | null = null;

export function getSharedInstance(): SharedInstance {
  if (local) return local;
  const slot = globalThis as Slot;
  const existing = slot[KEY];
  if (existing && existing.version === 1) {
    if (typeof console !== 'undefined') {
      console.warn('[notis keys] A second copy of the Notis toolkit loaded. It shares the first keyboard engine.');
    }
    local = existing;
    return local;
  }
  local = create();
  try {
    Object.defineProperty(slot, KEY, { value: local, configurable: true, enumerable: false, writable: false });
  } catch {
    // A frozen global: this copy keeps its own instance.
  }
  return local;
}

/** Tests only: forget this module's cached instance (the global slot stays). */
export function __resetSharedInstanceForTests(): void {
  local = null;
  try { delete (globalThis as Slot)[KEY]; } catch { /* non-configurable */ }
}
