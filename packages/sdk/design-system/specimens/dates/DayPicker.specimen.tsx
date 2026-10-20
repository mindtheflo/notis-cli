import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { DayPicker, formatLongDay, type DateRange } from '../../../src/ui/index';
import { DATES_TODAY, dayFromToday } from '../../fixtures/dates/dates';

// Fixed clock: Monday 15 June 2026.
const JUNE = new Date(2026, 5, 1);
const MAY = new Date(2026, 4, 1);

// The calendar sizes to its months, as in the date field's popover; the root block would spread the arrows apart.
const FIT: React.CSSProperties = { width: 'fit-content' };
// The footer slot is muted; the picked date reads in the foreground after its muted label.
const FOOTER: React.CSSProperties = { display: 'flex', gap: 6, lineHeight: '16px', color: 'hsl(var(--foreground))' };
const MUTED: React.CSSProperties = { color: 'hsl(var(--muted-foreground))' };

function Single({ lang, due }: { lang: SpecimenLang; due?: string }) {
  const [day, setDay] = React.useState<Date | undefined>(dayFromToday(3));
  return (
    <DayPicker mode="single" locale={lang} defaultMonth={JUNE} selected={day} onSelect={setDay} style={FIT}
      captionLayout={due ? 'dropdown' : undefined} startMonth={new Date(2025, 0, 1)} endMonth={new Date(2027, 11, 1)}
      footer={due && day ? <span style={FOOTER}><span style={MUTED}>{due}</span>{formatLongDay(day, lang)}</span> : undefined} />
  );
}

function Range({ lang, months }: { lang: SpecimenLang; months: number }) {
  const [range, setRange] = React.useState<DateRange | undefined>({ from: dayFromToday(-21), to: dayFromToday(-3) });
  return (
    <DayPicker mode="range" locale={lang} numberOfMonths={months} defaultMonth={months === 2 ? MAY : JUNE} selected={range} onSelect={setRange} style={FIT}
      endMonth={JUNE} disabled={{ after: DATES_TODAY }} />
  );
}

function Multiple({ lang }: { lang: SpecimenLang }) {
  // Office days of the team in June: every Tuesday and Thursday picked so far.
  const [days, setDays] = React.useState<Date[] | undefined>([2, 4, 9, 11, 16, 18].map((d) => new Date(2026, 5, d)));
  return <DayPicker mode="multiple" locale={lang} defaultMonth={JUNE} selected={days} onSelect={setDays} style={FIT} />;
}

function Disabled({ lang }: { lang: SpecimenLang }) {
  // A booking calendar: weekends and past days are closed, the next free slot is picked.
  const [day, setDay] = React.useState<Date | undefined>(dayFromToday(2));
  return (
    <DayPicker mode="single" locale={lang} defaultMonth={JUNE} selected={day} onSelect={setDay} style={FIT}
      disabled={[{ before: DATES_TODAY }, { dayOfWeek: [0, 6] }]} />
  );
}

export const specimen = defineSpecimen({
  id: 'day-picker',
  name: 'DayPicker',
  group: 'dates',
  from: '@notis/sdk/ui',
  covers: ['DayPicker'],
  summary: 'The month calendar under every date field and the period picker: one day, several days or a range, weeks from Monday.',
  states: [
    {
      id: 'single',
      label: 'One day picked, today marked with a dot',
      render: ({ lang }) => <Single lang={lang} />,
    },
    {
      id: 'range-two-months',
      label: 'A range across two months, future days disabled',
      render: ({ lang }) => <Range lang={lang} months={2} />,
    },
    {
      id: 'range-one-month',
      label: 'The same range in one month (narrow)',
      width: 390,
      render: ({ lang }) => <Range lang={lang} months={1} />,
    },
    {
      id: 'multiple',
      label: 'Several days picked',
      render: ({ lang }) => <Multiple lang={lang} />,
    },
    {
      id: 'disabled-days',
      label: 'Past days and weekends disabled',
      render: ({ lang }) => <Disabled lang={lang} />,
    },
    {
      id: 'no-outside-days',
      label: 'Without the days of the next and previous months',
      render: ({ lang }) => <DayPicker mode="single" locale={lang} defaultMonth={JUNE} selected={DATES_TODAY} showOutsideDays={false} style={FIT} />,
    },
    {
      id: 'dropdown-caption',
      label: 'Month and year menus with a footer line',
      render: ({ lang, t }) => <Single lang={lang} due={t({ en: 'Due', fr: 'Échéance' })} />,
    },
  ],
});
