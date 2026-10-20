import { useNotisRuntime } from '../../provider';
import type { Locale } from '../../words/types';
import { useToolkitLocale } from '../engine/hooks';

/**
 * The language of the date pieces: an explicit `locale` prop first, then the Space runtime's locale, then the
 * toolkit locale (the mounted keyboard engine's, else the page's `<html lang>`, which the Portal's LocaleProvider sets).
 */
export function useDateLocale(override?: Locale): Locale {
  const runtime = useNotisRuntime();
  const toolkit = useToolkitLocale();
  if (override === 'en' || override === 'fr') return override;
  const fromRuntime = runtime?.context?.locale;
  if (fromRuntime === 'en' || fromRuntime === 'fr') return fromRuntime;
  return toolkit;
}
