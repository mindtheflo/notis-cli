/**
 * A draft of a record for `EditableFields`: edits stay local until Save, Cancel goes back to the saved values, and a
 * new saved record (after a save or a refresh) moves under the draft: fields the user edited keep their edits, every
 * other field takes the new saved value.
 */

import { useCallback, useMemo, useState } from 'react';

/** Keys whose values differ (compared as JSON, so arrays and plain objects compare by content). */
export function changedFieldKeys<T extends object>(saved: T, draft: T): Array<keyof T> {
  const keys = new Set<keyof T>([...Object.keys(saved), ...Object.keys(draft)] as Array<keyof T>);
  return [...keys].filter((key) => JSON.stringify(saved[key] ?? null) !== JSON.stringify(draft[key] ?? null));
}

/**
 * The draft drawn from `previousSaved`, moved onto `saved`: the fields edited since `previousSaved` keep their edits,
 * the others take the new saved values, and a field the saved record no longer has (a removed entry) is dropped.
 */
export function rebaseFieldDraft<T extends object>(previousSaved: T, draft: T, saved: T): T {
  const edited = changedFieldKeys(previousSaved, draft);
  if (edited.length === 0) return saved;
  const next = { ...saved };
  for (const key of edited) {
    if (key in previousSaved && !(key in saved)) continue;
    next[key] = draft[key];
  }
  return next;
}

export interface FieldDraft<T extends object> {
  draft: T;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  patch: (values: Partial<T>) => void;
  dirty: boolean;
  changed: (key: keyof T) => boolean;
  /** Back to the saved values. */
  reset: () => void;
}

export function useFieldDraft<T extends object>(saved: T): FieldDraft<T> {
  // The draft remembers the saved record it was drawn from: edits are measured against that record, so a refresh that
  // lands while nothing was edited replaces the draft instead of reading as an edit.
  const [state, setState] = useState(() => ({ saved, draft: saved }));
  let current = state;
  // Adjusted during render (no frame shows the old draft against the new record). A record with the same content is
  // not a new one, so a `saved` built inline on every render does not loop.
  if (state.saved !== saved && changedFieldKeys(state.saved, saved).length > 0) {
    current = { saved, draft: rebaseFieldDraft(state.saved, state.draft, saved) };
    setState(current);
  }
  const { draft } = current;
  const changedKeys = useMemo(() => changedFieldKeys(saved, draft), [saved, draft]);
  const dirty = changedKeys.length > 0;

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setState((previous) => ({ ...previous, draft: { ...previous.draft, [key]: value } }));
  }, []);
  const patch = useCallback((values: Partial<T>) => {
    setState((previous) => ({ ...previous, draft: { ...previous.draft, ...values } }));
  }, []);
  const reset = useCallback(() => setState((previous) => ({ ...previous, draft: previous.saved })), []);
  const changed = useCallback((key: keyof T) => changedKeys.includes(key), [changedKeys]);
  return { draft, set, patch, dirty, changed, reset };
}
