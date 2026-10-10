'use client';

import { useMemo } from 'react';
import { useNotisRuntime } from '../provider';
import { useQuery, type UseQueryResult } from './useQuery';
import { SdkQueryError } from '../queryErrors';
import type { SpaceDefinition, SpaceShownOptions, SpaceShownResult, SpaceViewParam } from '../space';

type ParamValue<P> = P extends { type: 'enum'; values: readonly (infer V)[] } ? V
  : P extends { type: 'number' } ? number : P extends { type: 'boolean' } ? boolean : string;

/** Typed params of a definition: `useViewParams<typeof definition>()`. */
export type ViewParamsOf<D extends Pick<SpaceDefinition, 'params'>> = D['params'] extends Record<string, SpaceViewParam>
  ? { [K in keyof D['params']]?: ParamValue<D['params'][K]> } : Record<string, string | number | boolean | undefined>;

export interface ViewParams<T> {
  /** Declared params only, typed; invalid URL values are left out (their default applies). */
  params: T;
  /** Declared params whose URL value was invalid and ignored. */
  invalid: string[];
  /** Required params without a value. */
  missing: string[];
  declared: Record<string, SpaceViewParam>;
  ready: boolean;
}

const RECORD_KEY = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function parseValue(declaration: SpaceViewParam, raw: string): string | number | boolean | undefined {
  switch (declaration.type) {
    case 'text': return raw.length <= 500 && !CONTROL.test(raw) ? raw : undefined;
    case 'enum': return declaration.values?.includes(raw) ? raw : undefined;
    case 'number': { const value = Number(raw); return NUMBER.test(raw) && Number.isFinite(value) ? value : undefined; }
    case 'boolean': return raw === 'true' ? true : raw === 'false' ? false : undefined;
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
      const parsed = new Date(`${raw}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : undefined;
    }
    case 'record': {
      if (!RECORD_KEY.test(raw)) return undefined;
      const hex = raw.replaceAll('-', '').toLowerCase();
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    default: return undefined;
  }
}

/** Keep declared, valid values only; unknown params are dropped and defaults applied. */
export function parseViewParams(declared: Record<string, SpaceViewParam> | undefined,
  raw: Record<string, string> | null | undefined): Omit<ViewParams<Record<string, string | number | boolean>>, 'declared' | 'ready'> {
  const params: Record<string, string | number | boolean> = {};
  const invalid: string[] = [], missing: string[] = [];
  for (const [name, declaration] of Object.entries(declared || {})) {
    const value = raw && Object.hasOwn(raw, name) && typeof raw[name] === 'string' && raw[name] !== '' ? raw[name] : undefined;
    const parsed = value === undefined ? undefined : parseValue(declaration, value);
    if (value !== undefined && parsed === undefined) invalid.push(name);
    if (parsed !== undefined) params[name] = parsed;
    else if (declaration.default !== undefined) params[name] = declaration.default;
    else if (declaration.required) missing.push(name);
  }
  return { params, invalid, missing };
}

/**
 * The view's declared URL params, typed and validated. Unknown params (such as `?foo=`) never
 * reach the view. Record params are record keys; the server authorizes them where it uses them.
 */
export function useViewParams<D extends Pick<SpaceDefinition, 'params'> = SpaceDefinition>(): ViewParams<ViewParamsOf<D>> {
  const runtime = useNotisRuntime();
  const declared = runtime?.space?.params;
  const raw = runtime?.context?.params;
  return useMemo(() => ({ ...parseViewParams(declared, raw), declared: declared || {}, ready: runtime !== null }) as ViewParams<ViewParamsOf<D>>,
    [declared, raw, runtime]);
}

export interface UseShownOptions extends SpaceShownOptions {
  enabled?: boolean;
  staleTimeMs?: number;
}

/** True when a declared list has an authorized host reader (Editor or exact record Site). */
export function useShownAvailable(name: string): boolean {
  const runtime = useNotisRuntime();
  const list = runtime?.space?.shows && Object.hasOwn(runtime.space.shows, name) ? runtime.space.shows[name] : null;
  return runtime?.resource?.kind === 'space' && typeof runtime.shown === 'function' && Boolean(list && 'database' in list);
}

/**
 * Runs exactly the list this view declares in `shows` with the current params, so the declaration
 * is the list the view displays. Only sorting and paging are chosen here.
 *
 * A list this view context cannot read (undeclared, described only, or no host reader) answers
 * with `error` instead of a query that never starts, so the view can show an error state. Missing
 * required params are not an error: they are listed by `useViewParams().missing`.
 */
export function useShown<TRow = Record<string, unknown>>(name: string, options: UseShownOptions = {}):
  UseQueryResult<SpaceShownResult & { rows: TRow[] }> {
  const runtime = useNotisRuntime();
  const available = useShownAvailable(name);
  const { params, missing } = useViewParams();
  const { sorts, pageSize, offset, includeContent } = options;
  const list = runtime?.space?.shows && Object.hasOwn(runtime.space.shows, name) ? runtime.space.shows[name] : null;
  const reads = list && 'database' in list && Array.isArray(list.params) ? list.params : null;
  // Rows are keyed by the params the list reads: picking another record in the view keeps the rows
  // already shown instead of reading the same list again. The read itself always sends every param.
  const keyed = useMemo(() => reads ? Object.fromEntries(Object.entries(params).filter(([param]) => reads.includes(param))) : params,
    [params, reads]);
  const result = useQuery(['shown', name, keyed, sorts ?? null, pageSize ?? null, offset ?? null, includeContent ?? false], async () => {
    if (!runtime?.shown) throw new SdkQueryError('listUnavailable');
    return runtime.shown<SpaceShownResult & { rows: TRow[] }>(name, params as Record<string, unknown>,
      { sorts, pageSize, offset, includeContent });
  }, { readOnly: true, enabled: available && !missing.length && options.enabled !== false, staleTimeMs: options.staleTimeMs });
  const unavailable = runtime !== null && !available && options.enabled !== false;
  const error = useMemo(() => unavailable ? new SdkQueryError('listUnavailable', `The list "${name}" is unavailable in this view: declare it in \`shows\` `
    + `with a database, or gate it on useShownAvailable("${name}").`, runtime?.context?.locale) : null, [unavailable, name, runtime?.context?.locale]);
  return unavailable ? { ...result, loading: false, isFetching: false, error } : result;
}
