/**
 * PeriodPicker (toolkit spec 2.11, deck round 6 "period picker, like Stripe"): two triggers. The first picks a preset
 * (Today ... This year) or a custom range on the DayPicker with Apply and Cancel; the second picks what to compare it
 * with. Pair it with `usePeriod` so the period lives in the URL.
 *
 * Inside a menu the arrows move between options and days and Escape closes it (the engine's escape chain). The picker
 * registers no page keys.
 */

import * as React from 'react';
import { addMonths, startOfDay, startOfMonth } from 'date-fns';
import { pick, type Locale } from '../../words/types';
import { Popover } from '../overlay/Popover';
import { cx } from '../util';
import { DayPicker, type DateRange as DayPickerRange } from '../calendar/DayPicker';
import { COMPARE_WORDS, PERIOD_WORDS, PRESET_WORDS } from './dateWords';
import { formatDateRange } from './dateFormat';
import { CalendarGlyph, CaretDownGlyph, CheckGlyph } from './glyphs';
import {
  COMPARES,
  PRESETS,
  compareRange,
  customPeriod,
  periodRanges,
  type CompareId,
  type Period,
  type PresetId,
} from './periods';
import { useDateLocale } from './useDateLocale';

export interface PeriodPickerProps {
  value: Period;
  onChange: (period: Period) => void;
  /** Shows the "Compare to" trigger. Default true. */
  compare?: boolean;
  /**
   * Presets offered, in order. Default every preset. `custom` adds the custom range: its entry and the calendar to
   * pick days in. Leave it out for presets only (no calendar).
   */
  presets?: readonly PresetId[];
  locale?: Locale;
  className?: string;
}

/** Below this width the range menu stacks the presets over one month (deck `data-one`). */
export const PERIOD_PICKER_TWO_MONTHS_MIN = 700;

interface Draft {
  a: Date;
  b: Date | null;
}

/** Arrow, Home and End keys over the options of a listbox (focus moves; the option itself is a button). */
function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
  if (!options.length) return;
  const index = options.findIndex((el) => el === event.target || el.contains(event.target as Node));
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? options.length - 1
    : event.key === 'ArrowDown' ? (index + 1) % options.length
    : (index - 1 + options.length) % options.length;
  event.preventDefault();
  options[next]?.focus();
}

function focusSoon(panel: () => HTMLElement | null, selector: string) {
  requestAnimationFrame(() => panel()?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));
}

function pageWidth(from: Element | null): number {
  if (typeof document === 'undefined') return 1200;
  const root = from?.closest('[data-notis-app-root]') ?? document.documentElement;
  return root.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1200);
}

export function PeriodPicker({ value, onChange, compare = true, presets = PRESETS, locale: localeProp, className }:
  PeriodPickerProps) {
  const locale = useDateLocale(localeProp);
  const t = (words: Parameters<typeof pick>[0]) => pick(words, locale);
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const rangePanel = React.useRef<HTMLDivElement | null>(null);
  const cmpPanel = React.useRef<HTMLDivElement | null>(null);
  const [pop, setPop] = React.useState<'range' | 'cmp' | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [two, setTwo] = React.useState(true);
  const [month, setMonth] = React.useState<Date>(() => startOfMonth(new Date()));

  const today = startOfDay(new Date());
  const custom = presets.includes('custom');
  const { range, compareRange: cmpRange } = periodRanges(value);
  const months = two ? 2 : 1;

  const openRange = (open: boolean) => {
    setDraft(null);
    if (open) {
      const wide = pageWidth(barRef.current) >= PERIOD_PICKER_TWO_MONTHS_MIN;
      setTwo(wide);
      setMonth(startOfMonth(addMonths(range.to, wide ? -1 : 0)));
      focusSoon(() => rangePanel.current, '[role="option"][aria-selected="true"]');
    }
    setPop(open ? 'range' : null);
  };

  const pickPreset = (preset: PresetId, close: () => void) => {
    if (preset === 'custom') {
      setDraft(null);
      focusSoon(() => rangePanel.current, '.nui-dp-range-end .nui-dp-day-btn, .nui-dp-selected .nui-dp-day-btn, .nui-dp-day-btn');
      return;
    }
    onChange({ preset, compare: value.compare });
    close();
  };

  const onDayClick = (day: Date) => {
    const d = startOfDay(day);
    setDraft((current) => (!current || current.b ? { a: d, b: null } : d < current.a ? { a: d, b: current.a } : { a: current.a, b: d }));
  };

  const apply = (close: () => void) => {
    if (!draft?.b) return;
    onChange(customPeriod(draft.a, draft.b, value.compare));
    close();
  };

  const selected: DayPickerRange = draft ? { from: draft.a, to: draft.b ?? undefined } : { from: range.from, to: range.to };
  const hint = !draft ? t(PERIOD_WORDS.pickStart)
    : !draft.b ? t(PERIOD_WORDS.pickEnd)
    : formatDateRange({ from: draft.a, to: draft.b }, locale);

  const rangeTrigger = (
    <button type="button" className="nui-pp-trigger" data-pp-open="range">
      <CalendarGlyph className="nui-pp-glyph" />
      <span className="nui-pp-name">{t(PRESET_WORDS[value.preset])}</span>
      <span className="nui-pp-dates">{formatDateRange(range, locale)}</span>
      <CaretDownGlyph className="nui-pp-caret" />
    </button>
  );

  const cmpTrigger = (
    <button type="button" className="nui-pp-trigger" data-pp-open="cmp">
      <span className="nui-pp-muted">{t(PERIOD_WORDS.compare)}</span>
      <span className="nui-pp-name">{t(COMPARE_WORDS[value.compare])}</span>
      <CaretDownGlyph className="nui-pp-caret" />
    </button>
  );

  return (
    <div ref={barRef} className={cx('nui-pp', className)} data-notis-ui="">
      <Popover
        trigger={rangeTrigger}
        open={pop === 'range'}
        onOpenChange={openRange}
        label={PERIOD_WORDS.range}
        className="nui-pp-pop"
        autoFocus={false}
        content={({ close }) => (
          <div ref={rangePanel} className="nui-pp-panel" data-one={custom && !two ? '' : undefined}>
            <div className="nui-pp-presets" role="listbox" aria-label={t(PERIOD_WORDS.range)} onKeyDown={onListKeyDown}>
              {presets.map((preset) => {
                const on = preset === value.preset;
                return (
                  <button key={preset} type="button" role="option" className="nui-pp-opt" data-pp-preset={preset}
                    aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => pickPreset(preset, close)}>
                    <span className="nui-pp-opt-text">{t(PRESET_WORDS[preset])}</span>
                    {on && <CheckGlyph className="nui-pp-check" />}
                  </button>
                );
              })}
            </div>
            {custom && (
              <div className="nui-pp-cal">
                <DayPicker
                  mode="range"
                  locale={locale}
                  numberOfMonths={months}
                  month={month}
                  onMonthChange={setMonth}
                  endMonth={startOfMonth(today)}
                  disabled={{ after: today }}
                  selected={selected}
                  onSelect={() => undefined}
                  onDayClick={onDayClick}
                  labels={{
                    labelPrevious: () => t(PERIOD_WORDS.prevMonth),
                    labelNext: () => t(PERIOD_WORDS.nextMonth),
                  }}
                />
                <div className="nui-pp-foot">
                  <span className="nui-pp-hint" aria-live="polite">{hint}</span>
                  <span className="nui-pp-grow" />
                  <button type="button" className="nui-pp-btn" onClick={close}>{t(PERIOD_WORDS.cancel)}</button>
                  <button type="button" className="nui-pp-btn nui-pp-primary" disabled={!draft?.b} onClick={() => apply(close)}>
                    {t(PERIOD_WORDS.apply)}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      />
      {compare && (
        <Popover
          trigger={cmpTrigger}
          open={pop === 'cmp'}
          onOpenChange={(open) => {
            setPop(open ? 'cmp' : null);
            if (open) focusSoon(() => cmpPanel.current, '[aria-selected="true"]');
          }}
          label={PERIOD_WORDS.compare}
          className="nui-pp-pop nui-pp-pop-cmp"
          autoFocus={false}
          content={({ close }) => (
            <div ref={cmpPanel} className="nui-pp-presets" role="listbox" aria-label={t(PERIOD_WORDS.compare)}
              onKeyDown={onListKeyDown}>
              {COMPARES.map((id: CompareId) => {
                const on = id === value.compare;
                const r = id === 'none' ? null : id === value.compare ? cmpRange : compareRange(range, id);
                return (
                  <button key={id} type="button" role="option" className="nui-pp-opt nui-pp-opt-2" data-pp-cmp={id}
                    aria-selected={on} tabIndex={on ? 0 : -1}
                    onClick={() => { onChange({ ...value, compare: id }); close(); }}>
                    <span className="nui-pp-opt-text">
                      <span className="nui-pp-opt-name">{t(COMPARE_WORDS[id])}</span>
                      {r && <span className="nui-pp-opt-dates">{formatDateRange(r, locale)}</span>}
                    </span>
                    {on && <CheckGlyph className="nui-pp-check" />}
                  </button>
                );
              })}
            </div>
          )}
        />
      )}
    </div>
  );
}
PeriodPicker.displayName = 'PeriodPicker';
