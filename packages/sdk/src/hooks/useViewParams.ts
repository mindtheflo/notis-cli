'use client';

import { useCallback, useMemo } from 'react';
import { useNotisRuntime } from '../provider';
import type { NotisRuntime } from '../runtime';
import { useQuery, type UseQueryResult } from './useQuery';
import { SdkQueryError } from '../queryErrors';
import type { SpaceDefinition, SpaceShownOptions, SpaceShownResult, SpaceViewParam } from '../space';
import { isViewDate, isViewPeriod } from '../viewPeriod';

type ParamValue<P> = P extends { type: 'enum'; values: readonly (infer V)[] } ? V
  : P extends { type: 'number' } ? number : P extends { type: 'boolean' } ? boolean : string;

/** Typed params of a definition: `useViewParams<typeof definition>()`. */
export type ViewParamsOf<D extends Pick<SpaceDefinition, 'params'>> = D['params'] extends Record<string, SpaceViewParam>
  ? { [K in keyof D['params']]?: ParamValue<D['params'][K]> } : Record<string, string | number | boolean | undefined>;

/** A change to the view's URL params: a value sets that param, null or undefined removes it. */
export type ViewParamChanges<T> = { [K in keyof T]?: T[K] | null };

export interface SetViewParamsOptions {
  /** Replace the current history entry instead of adding one, so Back skips this change. Default false. */
  replace?: boolean;
}

export interface ViewParams<T> {
  /** Declared params only, typed; invalid URL values are left out (their default applies). */
  params: T;
  /** Declared params whose URL value was invalid and ignored. */
  invalid: string[];
  /** Required params without a value. */
  missing: string[];
  declared: Record<string, SpaceViewParam>;
  ready: boolean;
  /**
   * Change this view's own URL params; the same Space and record stay open. Names left out of `changes` keep their
   * value. No destination lookup and no alias to declare: use `useNotisNavigation().toNamedSpace` for another Space.
   * Undeclared names are dropped by the host. Rejects outside a Space.
   */
  setParams: (changes: ViewParamChanges<T>, options?: SetViewParamsOptions) => Promise<void>;
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
      return ['today', 'tomorrow'].includes(raw) || isViewDate(raw) ? raw : undefined;
    }
    case 'period': return isViewPeriod(raw) ? raw : undefined;
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
  raw: Record<string, string> | null | undefined): Pick<ViewParams<Record<string, string | number | boolean>>, 'params' | 'invalid' | 'missing'> {
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

// The params a view asked for last, until the host answers with new ones: two changes in one tick keep each other.
const pendingWrites = new WeakMap<object, { base: Record<string, string> | null; params: Record<string, string> }>();

/**
 * Write the open Space's own URL params (`setParams` of useViewParams; the toolkit's open item and period use it).
 * The host keeps the Space and record, checks no destination, and adds a history entry unless `replace` is set.
 */
export function writeViewParams(runtime: NotisRuntime | null | undefined, changes: Record<string, unknown>,
  options: SetViewParamsOptions = {}): Promise<void> {
  if (runtime?.resource?.kind !== 'space' || typeof runtime.navigate !== 'function') {
    return Promise.reject(new Error('Open this Space in a current Notis host to change its params.'));
  }
  const current = runtime.context?.params ?? null;
  const pending = pendingWrites.get(runtime);
  const next: Record<string, string> = { ...(pending && pending.base === current ? pending.params : current ?? {}) };
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === undefined) delete next[name];
    else next[name] = String(value);
  }
  pendingWrites.set(runtime, { base: current, params: next });
  const forget = (error: unknown) => {
    if (pendingWrites.get(runtime)?.params === next) pendingWrites.delete(runtime);
    throw error;
  };
  try {
    return Promise.resolve(runtime.navigate({ kind: 'view-params', params: next, ...(options.replace ? { replace: true } : {}) }))
      .then(() => undefined, forget);
  } catch (error) {
    return Promise.reject(error).catch(forget);
  }
}

/**
 * The view's declared URL params, typed and validated, and `setParams` to change them. Unknown params (such as
 * `?foo=`) never reach the view. Record params are record keys; the server authorizes them where it uses them.
 */
export function useViewParams<D extends Pick<SpaceDefinition, 'params'> = SpaceDefinition>(): ViewParams<ViewParamsOf<D>> {
  const runtime = useNotisRuntime();
  const declared = runtime?.space?.params;
  const raw = runtime?.context?.params;
  const setParams = useCallback((changes: ViewParamChanges<ViewParamsOf<D>>, options?: SetViewParamsOptions) =>
    writeViewParams(runtime, changes as Record<string, unknown>, options), [runtime]);
  return useMemo(() => ({ ...parseViewParams(declared, raw), declared: declared || {}, ready: runtime !== null, setParams }) as
    ViewParams<ViewParamsOf<D>>, [declared, raw, runtime, setParams]);
}

export interface UseShownOptions extends SpaceShownOptions {
  enabled?: boolean;
  staleTimeMs?: number;
  /**
   * Read every page and answer with all rows: pages of `pageSize` (default 200) are read from `offset` until one
   * comes back short, up to `SHOWN_ALL_PAGES_MAX` pages.
   */
  allPages?: boolean;
}

/** The most pages `useShown({ allPages: true })` reads. */
export const SHOWN_ALL_PAGES_MAX = 50;
const SHOWN_ALL_PAGES_SIZE = 200;

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
  const { sorts, pageSize, offset, includeContent, allPages = false } = options;
  const list = runtime?.space?.shows && Object.hasOwn(runtime.space.shows, name) ? runtime.space.shows[name] : null;
  const reads = list && 'database' in list && Array.isArray(list.params) ? list.params : null;
  // Rows are keyed by the params the list reads: picking another record in the view keeps the rows
  // already shown instead of reading the same list again. The read itself always sends every param.
  const keyed = useMemo(() => reads ? Object.fromEntries(Object.entries(params).filter(([param]) => reads.includes(param))) : params,
    [params, reads]);
  const result = useQuery(['shown', name, keyed, sorts ?? null, pageSize ?? null, offset ?? null, includeContent ?? false,
    allPages], async () => {
    if (!runtime?.shown) throw new SdkQueryError('listUnavailable');
    if (!allPages) {
      return runtime.shown<SpaceShownResult & { rows: TRow[] }>(name, params as Record<string, unknown>,
        { sorts, pageSize, offset, includeContent });
    }
    const size = pageSize ?? SHOWN_ALL_PAGES_SIZE;
    let first: (SpaceShownResult & { rows: TRow[] }) | null = null;
    const rows: TRow[] = [];
    for (let page = 0; page < SHOWN_ALL_PAGES_MAX; page += 1) {
      const answer = await runtime.shown<SpaceShownResult & { rows: TRow[] }>(name, params as Record<string, unknown>,
        { sorts, pageSize: size, offset: (offset ?? 0) + page * size, includeContent });
      first ??= answer;
      const pageRows = Array.isArray(answer?.rows) ? answer.rows : [];
      rows.push(...pageRows);
      if (pageRows.length < size) break;
    }
    const merged = { ...(first as SpaceShownResult & { rows: TRow[] }), rows } as SpaceShownResult & { rows: TRow[] };
    return merged;
  }, { readOnly: true, enabled: available && !missing.length && options.enabled !== false, staleTimeMs: options.staleTimeMs,
    // The list's filter stays on the server: only its sorts are known here.
    rows: list && 'database' in list ? { binding: list.database, at: 'rows', list: name, query: { sorts } } : undefined });
  const unavailable = runtime !== null && !available && options.enabled !== false;
  const error = useMemo(() => unavailable ? new SdkQueryError('listUnavailable', `The list "${name}" is unavailable in this view: declare it in \`shows\` `
    + `with a database, or gate it on useShownAvailable("${name}").`, runtime?.context?.locale) : null, [unavailable, name, runtime?.context?.locale]);
  return unavailable ? { ...result, loading: false, isFetching: false, error } : result;
}
