'use client';

import { useCallback, useEffect } from 'react';
import { useNotisRuntime } from '../provider';

interface TopBarSearchOptions {
  /** Current value shown in the top bar search input. */
  value: string;
  /** Called when the user types in the top bar. */
  onChange: (value: string) => void;
  /** Placeholder text for the input. Defaults to 'Search…'. */
  placeholder?: string;
  /** Called when the user presses Enter. May return a Promise. */
  onSubmit?: () => void | Promise<void>;
}

interface TopBarSearchActions {
  /** Toggle the loader that replaces the search icon in the top bar. */
  setLoading: (loading: boolean) => void;
}

/**
 * Registers this view's search binding with the portal's top bar search input.
 * While the component is mounted, typing in the top bar calls `onChange`,
 * pressing Enter calls `onSubmit`, and the `value` prop drives the input.
 *
 * Call `setLoading(true)` to show the standard spinner in the top bar while a
 * query is running; `setLoading(false)` restores the search icon.
 *
 * Without a portal runtime, this hook is a safe no-op.
 *
 * ```tsx
 * const [q, setQ] = useState('');
 * const { setLoading } = useTopBarSearch({
 *   value: q,
 *   onChange: setQ,
 *   placeholder: 'Search notes…',
 *   onSubmit: async () => {
 *     setLoading(true);
 *     try { await runSearch(q); } finally { setLoading(false); }
 *   },
 * });
 * ```
 *
 * Stabilize `onChange` and `onSubmit` with `useCallback` to avoid re-registering
 * on every render.
 */
export function useTopBarSearch(opts: TopBarSearchOptions): TopBarSearchActions {
  const runtime = useNotisRuntime();
  const { value, onChange, placeholder, onSubmit } = opts;

  useEffect(() => {
    const register = runtime?.registerTopBarSearch;
    if (!register) return;
    register({ onChange, placeholder, onSubmit });
    return () => {
      register(null);
    };
  }, [runtime, onChange, placeholder, onSubmit]);

  useEffect(() => {
    runtime?.setTopBarSearchValue?.(value);
  }, [runtime, value]);

  const setLoading = useCallback(
    (loading: boolean) => {
      runtime?.setTopBarSearchLoading?.(loading);
    },
    [runtime],
  );

  return { setLoading };
}
