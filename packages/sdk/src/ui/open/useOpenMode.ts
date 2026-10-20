/**
 * `useOpenMode` (toolkit spec 2.9): the open mode of one list (side, center or full), persisted per Space and list.
 * The cached mode shows at once; the store's answer (user settings) replaces it when it differs.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNotisRuntime } from '../../provider';
import {
  OPEN_MODES, isOpenMode, readOpenModeCache, useOpenModeStore, writeOpenModeCache, type OpenMode,
} from './openModeStore';

export interface UseOpenModeOptions {
  /** The modes this list offers; the first is the default. Default all three, side first. */
  allowed?: OpenMode | readonly OpenMode[];
  /** Default `${spaceId}:${listId}` (list id 'list'). Leave out with no Space and nothing persists. */
  storageKey?: string;
  /** The list id inside the Space, for the default storage key. Default 'list'. */
  listId?: string;
}

export function normalizeAllowed(allowed: OpenMode | readonly OpenMode[] | undefined): OpenMode[] {
  const list = allowed === undefined ? OPEN_MODES : typeof allowed === 'string' ? [allowed] : allowed;
  const out: OpenMode[] = [];
  for (const mode of list) if (isOpenMode(mode) && !out.includes(mode)) out.push(mode);
  return out.length ? out : ['side'];
}

/** The storage key: given, else `${spaceId}:${listId}`, else null (nothing persists). */
export function useOpenModeKey(storageKey: string | undefined, listId = 'list'): string | null {
  const runtime = useNotisRuntime();
  if (storageKey) return storageKey;
  const spaceId = runtime?.resource?.kind === 'space' ? runtime.resource.id : runtime?.space?.id;
  return spaceId ? `${spaceId}:${listId}` : null;
}

export function useOpenMode(options: UseOpenModeOptions = {}): [OpenMode, (mode: OpenMode) => void] {
  const allowed = normalizeAllowed(options.allowed);
  const allowedKey = allowed.join(',');
  const key = useOpenModeKey(options.storageKey, options.listId);
  const store = useOpenModeStore();
  const fit = useCallback((mode: OpenMode | null | undefined): OpenMode =>
    (mode && allowed.includes(mode) ? mode : allowed[0]!), [allowedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [mode, setModeState] = useState<OpenMode>(() => fit(key ? readOpenModeCache(key) : null));

  useEffect(() => {
    if (!key) { setModeState((current) => fit(current)); return undefined; }
    let alive = true;
    setModeState(fit(readOpenModeCache(key)));
    const apply = (value: OpenMode | null) => {
      if (!alive || !value) return;
      writeOpenModeCache(key, value);
      setModeState(fit(value));
    };
    try {
      const answer = store.read(key);
      if (answer && typeof (answer as Promise<OpenMode | null>).then === 'function') {
        (answer as Promise<OpenMode | null>).then(apply, () => {});
      } else {
        apply(answer as OpenMode | null);
      }
    } catch {
      // The cache stands.
    }
    const unsubscribe = store.subscribe?.(key, apply);
    return () => { alive = false; unsubscribe?.(); };
  }, [key, store, fit]);

  const setMode = useCallback((next: OpenMode) => {
    const value = fit(next);
    setModeState(value);
    if (!key) return;
    writeOpenModeCache(key, value);
    try {
      void Promise.resolve(store.write(key, value)).catch(() => {});
    } catch {
      // The cache already holds it.
    }
  }, [key, store, fit]);

  return [mode, setMode];
}
