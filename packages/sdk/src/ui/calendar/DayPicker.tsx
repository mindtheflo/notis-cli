/**
 * DayPicker: the react-day-picker calendar the Portal used (`portal/src/components/ui/calendar.tsx`), moved into the
 * toolkit (spec 2.11) and re-skinned with `nui-dp-*` classes in toolkit.css instead of Tailwind and the library sheet.
 *
 * Weeks start on Monday, as in the deck. Month and day names follow the toolkit locale (EN or FR) unless a
 * react-day-picker `locale` is passed. Weekday heads use the narrow names ("M T W" / "L M M", B7) so the grid fits.
 */

import * as React from 'react';
import { DayPicker as ReactDayPicker, type ChevronProps, type ClassNames } from 'react-day-picker';
import { enUS } from 'react-day-picker/locale/en-US';
import { fr } from 'react-day-picker/locale/fr';
import type { Locale } from '../../words/types';
import { weekdayNames } from '../period/dateFormat';
import { useDateLocale } from '../period/useDateLocale';

export type { DateRange, Matcher } from 'react-day-picker';

type ReactDayPickerProps = React.ComponentProps<typeof ReactDayPicker>;

/** Omit that keeps the single, multiple and range modes apart. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type DayPickerProps = DistributiveOmit<ReactDayPickerProps, 'locale'> & {
  /** `en` or `fr`; defaults to the toolkit locale. A react-day-picker locale object is accepted too. */
  locale?: Locale | ReactDayPickerProps['locale'];
};

const CLASS_NAMES: Partial<ClassNames> = {
  root: 'nui-dp',
  months: 'nui-dp-months',
  month: 'nui-dp-month',
  month_caption: 'nui-dp-caption',
  caption_label: 'nui-dp-caption-label',
  dropdowns: 'nui-dp-dropdowns',
  dropdown_root: 'nui-dp-dropdown-root',
  dropdown: 'nui-dp-dropdown',
  months_dropdown: 'nui-dp-months-dropdown',
  years_dropdown: 'nui-dp-years-dropdown',
  nav: 'nui-dp-nav',
  button_previous: 'nui-dp-nav-btn',
  button_next: 'nui-dp-nav-btn',
  chevron: 'nui-dp-chevron',
  month_grid: 'nui-dp-grid',
  weekdays: 'nui-dp-weekdays',
  weekday: 'nui-dp-weekday',
  week: 'nui-dp-week',
  day: 'nui-dp-day',
  day_button: 'nui-dp-day-btn',
  selected: 'nui-dp-selected',
  range_start: 'nui-dp-range-start',
  range_middle: 'nui-dp-range-middle',
  range_end: 'nui-dp-range-end',
  today: 'nui-dp-today',
  outside: 'nui-dp-outside',
  disabled: 'nui-dp-disabled',
  hidden: 'nui-dp-hidden',
  focused: 'nui-dp-focused',
  footer: 'nui-dp-footer',
};

function Chevron({ orientation = 'left', className }: ChevronProps) {
  const d = orientation === 'left' ? 'M10 3.5 5.5 8l4.5 4.5'
    : orientation === 'right' ? 'M6 3.5 10.5 8 6 12.5'
    : orientation === 'up' ? 'M3.5 10 8 5.5l4.5 4.5'
    : 'M3.5 6 8 10.5 12.5 6';
  return (
    <svg className={className} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function joinClass(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ');
}

/** A calendar of days in the toolkit look: Monday first, narrow weekday heads, EN or FR names. */
export function DayPicker({ className, classNames, components, formatters, showOutsideDays = true, locale, ...props }: DayPickerProps) {
  const toolkitLocale = useDateLocale(typeof locale === 'string' ? locale : undefined);
  const rdpLocale = typeof locale === 'object' && locale ? locale : toolkitLocale === 'fr' ? fr : enUS;
  const narrow = React.useMemo(() => weekdayNames(toolkitLocale, 'narrow'), [toolkitLocale]);
  const ownLocale = !(typeof locale === 'object' && locale);
  const merged: Partial<ClassNames> = { ...CLASS_NAMES };
  if (classNames) {
    for (const [key, value] of Object.entries(classNames) as Array<[keyof ClassNames, string | undefined]>) {
      merged[key] = joinClass(CLASS_NAMES[key], value);
    }
  }
  return (
    <ReactDayPicker
      data-notis-ui=""
      weekStartsOn={1}
      showOutsideDays={showOutsideDays}
      {...(props as ReactDayPickerProps)}
      locale={rdpLocale}
      className={joinClass('nui-dp-root', className)}
      classNames={merged}
      formatters={ownLocale ? { formatWeekdayName: (day: Date) => narrow[(day.getDay() + 6) % 7], ...formatters } : formatters}
      components={{ Chevron, ...components }}
    />
  );
}
DayPicker.displayName = 'DayPicker';
