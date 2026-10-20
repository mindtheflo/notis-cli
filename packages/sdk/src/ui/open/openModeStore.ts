/**
 * Where the chosen open mode lives (toolkit spec 2.9). The mode belongs in Notis user settings, keyed by Space and
 * list. No user-settings call reaches Space code yet, so this is an adapter: a host (or a test) installs a store with
 * `setOpenModeStore` or `<OpenModeStoreProvider>`, and the default keeps the choice in this browser's localStorage.
 * localStorage also stays a cache in front of any remote store, so the mode shows at once on the next visit.
 */

import { createContext, createElement, useContext, type ReactNode } from 'react';

export type OpenMode = 'side' | 'center' | 'full';

export const OPEN_MODES: readonly OpenMode[] = Object.freeze(['side', 'center', 'full'] as OpenMode[]);

export function isOpenMode(value: unknown): value is OpenMode {
  return value === 'side' || value === 'center' || value === 'full';
}

/** A user-settings backend for open modes. `read` may be async (a settings call); `write` is fire and forget. */
export interface OpenModeStore {
  read(key: string): OpenMode | null | Promise<OpenMode | null>;
  write(key: string, mode: OpenMode): void | Promise<void>;
  /** Changes made elsewhere (another tab, another device through settings). Returns an unsubscribe. */
  subscribe?(key: string, onChange: (mode: OpenMode | null) => void): () => void;
}

export const OPEN_MODE_CACHE_PREFIX = 'notis:open-mode:';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The localStorage cache: read synchronously before the store answers. */
export function readOpenModeCache(key: string): OpenMode | null {
  try {
    const value = storage()?.getItem(OPEN_MODE_CACHE_PREFIX + key);
    return isOpenMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeOpenModeCache(key: string, mode: OpenMode): void {
  try {
    storage()?.setItem(OPEN_MODE_CACHE_PREFIX + key, mode);
  } catch {
    // Private mode or a full quota: the mode still holds for this visit.
  }
}

/** The default store: this browser only, until a Notis user-settings adapter is installed. */
export const localStorageOpenModeStore: OpenModeStore = Object.freeze({
  read: (key: string) => readOpenModeCache(key),
  write: (key: string, mode: OpenMode) => writeOpenModeCache(key, mode),
  subscribe: (key: string, onChange: (mode: OpenMode | null) => void) => {
    if (typeof window === 'undefined') return () => {};
    const listener = (event: StorageEvent) => {
      if (event.key !== OPEN_MODE_CACHE_PREFIX + key) return;
      onChange(isOpenMode(event.newValue) ? event.newValue : null);
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  },
});

/**
 * A store over a generic user-settings API (get and set by key), for a host that has one. Values are kept under
 * `openMode:<key>`.
 */
export function userSettingsOpenModeStore(settings: {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
}): OpenModeStore {
  return {
    read: async (key) => {
      const value = await settings.get(`openMode:${key}`);
      return isOpenMode(value) ? value : null;
    },
    write: (key, mode) => settings.set(`openMode:${key}`, mode),
  };
}

let globalStore: OpenModeStore = localStorageOpenModeStore;

/** Installs the store every `useOpenMode` uses outside an `OpenModeStoreProvider`. Returns the previous one. */
export function setOpenModeStore(store: OpenModeStore | null): OpenModeStore {
  const previous = globalStore;
  globalStore = store ?? localStorageOpenModeStore;
  return previous;
}

export function getOpenModeStore(): OpenModeStore {
  return globalStore;
}

const OpenModeStoreContext = createContext<OpenModeStore | null>(null);

export function OpenModeStoreProvider({ store, children }: { store: OpenModeStore; children?: ReactNode }) {
  return createElement(OpenModeStoreContext.Provider, { value: store }, children);
}

export function useOpenModeStore(): OpenModeStore {
  return useContext(OpenModeStoreContext) ?? globalStore;
}
