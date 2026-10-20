import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotisRuntime } from '../../provider';
import { writeViewParams } from '../../hooks/useViewParams';
import {
  formatPeriodParam,
  parsePeriodParam,
  periodRanges,
  type CompareId,
  type DateRange,
  type Period,
  type PresetId,
} from './periods';

export interface UsePeriodOptions {
  /** URL parameter holding the period. A Space declares it as a text param. Default `period`. */
  param?: string;
  /** Preset when the URL has none. Default `last30`. */
  default?: PresetId;
  /** Comparison when the URL has none. Default `prev`. */
  compare?: CompareId;
}

export interface UsePeriodResult {
  period: Period;
  range: DateRange;
  compareRange: DateRange | null;
  set(period: Period): void;
}

function readWindowParam(param: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get(param);
  } catch {
    return null;
  }
}

function writeWindowParam(param: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (value == null) url.searchParams.delete(param);
    else url.searchParams.set(param, value);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // A sandboxed or opaque page keeps the period in memory only.
  }
}

/**
 * The period of a dashboard, kept in the URL so links keep it (toolkit spec 2.11).
 *
 * In a Space the value lives in the Space's view params (declare `period` as a text param, or the host drops it) and
 * changes go through `useViewParams().setParams`, replacing the history entry. On a Notis page outside a Space it lives in the page's query string.
 * Ranges are computed for today and recomputed when the period changes.
 */
export function usePeriod(options: UsePeriodOptions = {}): UsePeriodResult {
  const param = options.param ?? 'period';
  const defaults = useMemo(() => ({ preset: options.default ?? 'last30', compare: options.compare ?? 'prev' }), [
    options.default,
    options.compare,
  ]);
  const runtime = useNotisRuntime();
  const inSpace = runtime?.resource?.kind === 'space' && typeof runtime.navigate === 'function';
  const raw = runtime?.context?.params ?? null;
  const urlValue = inSpace ? raw?.[param] ?? null : null;

  const [local, setLocal] = useState<string | null>(() => (inSpace ? null : readWindowParam(param)));

  // The Space's URL wins; a local value is only kept outside a Space.
  const value = inSpace ? urlValue : local;
  const period = useMemo(() => parsePeriodParam(value, defaults), [value, defaults]);
  const day = new Date().toDateString();
  const ranges = useMemo(() => periodRanges(period), [period, day]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (inSpace || typeof window === 'undefined') return undefined;
    const onPop = () => setLocal(readWindowParam(param));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [inSpace, param]);

  const set = useCallback((next: Period) => {
    const encoded = formatPeriodParam(next, defaults.compare);
    const isDefault = next.preset === defaults.preset && next.compare === defaults.compare;
    if (inSpace) {
      // One of the Space's own view params: the same Space and record stay open, Back skips period changes.
      void writeViewParams(runtime, { [param]: isDefault ? null : encoded }, { replace: true }).catch(() => {});
      return;
    }
    setLocal(isDefault ? null : encoded);
    writeWindowParam(param, isDefault ? null : encoded);
  }, [defaults, inSpace, param, runtime]);

  return { period, range: ranges.range, compareRange: ranges.compareRange, set };
}
