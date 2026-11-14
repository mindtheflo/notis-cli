import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { CalendarHeatmap, type CalendarHeatmapDay } from '../../../src/ui/index';
import { labelValue, pick, pluralWords, w, type Locale } from '../../../src/words/index';
import { JOURNAL_ENTRIES, MOODS_BY_DAY, SIX_MONTHS_FROM, WORKOUTS } from '../../fixtures/charts/heatmap';
import { focusFrom, revealTable } from '../../fixtures/charts/interact';
import { Pad } from '../../fixtures/charts/parts';

const WORDS = {
  entries: w('Journal entries by day', 'Entrées du journal par jour'),
  workouts: w('Workouts by day', 'Séances par jour'),
  mood: w('Mood by day', 'Humeur par jour'),
  picked: w('Picked', 'Choisi'),
  none: w('Press a day to pick it.', 'Appuie sur un jour pour le choisir.'),
} as const;

const entries = (value: number, locale: Locale) =>
  pick(pluralWords(value, { one: w('{n} entry', '{n} entrée'), other: w('{n} entries', '{n} entrées') }), locale);
const workouts = (value: number, locale: Locale) =>
  pick(pluralWords(value, { one: w('{n} workout', '{n} séance'), other: w('{n} workouts', '{n} séances') }), locale);
const mood = (value: number, locale: Locale) => (locale === 'fr' ? `humeur ${value} sur 5` : `mood ${value} of 5`);

/** A heatmap whose days pick, with the picked day under it. */
function Pickable({ lang }: { lang: SpecimenLang }) {
  const [picked, setPicked] = React.useState<CalendarHeatmapDay | null>(null);
  return (
    <div className="grid gap-3">
      <CalendarHeatmap data={JOURNAL_ENTRIES} title={WORDS.entries} format={entries} locale={lang}
        onSelect={setPicked} />
      <span className="text-xs text-muted-foreground">
        {picked ? labelValue(pick(WORDS.picked, lang), picked.key, lang) : pick(WORDS.none, lang)}
      </span>
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'calendar-heatmap',
  name: 'CalendarHeatmap',
  group: 'charts',
  from: '@notis/sdk/ui',
  covers: ['CalendarHeatmap'],
  summary: 'A GitHub-style grid of days coloured by value: weeks as columns, a tooltip and a spoken name per day, a hidden data table.',
  states: [
    {
      id: 'year',
      label: 'The last 12 months of journal entries, in the first chart colour',
      render: ({ lang }) => (
        <Pad><CalendarHeatmap data={JOURNAL_ENTRIES} title={WORDS.entries} format={entries} locale={lang} /></Pad>
      ),
    },
    {
      id: 'french',
      label: 'In French: month and weekday names, Moins and Plus',
      render: () => (
        <Pad><CalendarHeatmap data={JOURNAL_ENTRIES} title={WORDS.entries} format={entries} locale="fr" /></Pad>
      ),
    },
    {
      id: 'tone',
      label: 'A success tone over six months, counting one row per workout',
      render: ({ lang }) => (
        <Pad>
          <CalendarHeatmap data={WORKOUTS} valueKey={null} from={SIX_MONTHS_FROM} tone="success" title={WORDS.workouts}
            format={workouts} locale={lang} />
        </Pad>
      ),
    },
    {
      id: 'diverging',
      label: 'Good to bad: moods from 1 to 5 around 3, green above and red below',
      render: ({ lang }) => (
        <Pad>
          <CalendarHeatmap data={MOODS_BY_DAY} from={SIX_MONTHS_FROM} scale="diverging" domain={[1, 5]} title={WORDS.mood}
            format={mood} locale={lang} />
        </Pad>
      ),
    },
    {
      id: 'empty',
      label: 'No data yet: the empty grid and its legend',
      render: ({ lang }) => <Pad><CalendarHeatmap data={[]} title={WORDS.entries} locale={lang} /></Pad>,
    },
    {
      id: 'narrow',
      label: 'Narrow (390): the grid scrolls inside itself, the latest week in view',
      width: 390,
      render: ({ lang }) => (
        <Pad><CalendarHeatmap data={JOURNAL_ENTRIES} title={WORDS.entries} format={entries} locale={lang} /></Pad>
      ),
    },
    {
      id: 'focus',
      label: 'A day focused from the keyboard: its tooltip says what the cell is named',
      height: 260,
      render: ({ lang }) => <Pad><Pickable lang={lang} /></Pad>,
      interact: (root) => focusFrom(root, '[data-nav-id="2026-06-10"]').then(() => undefined),
    },
    {
      id: 'data-table',
      label: 'The hidden data table view Markdown reads, drawn in full under the heatmap',
      render: ({ lang }) => (
        <Pad className="grid gap-4">
          <CalendarHeatmap data={MOODS_BY_DAY.slice(-12)} from="2026-06-01" scale="diverging" domain={[1, 5]}
            title={WORDS.mood} format={mood} locale={lang} />
          <div data-chart-table-out="" className="max-w-[40rem]" />
        </Pad>
      ),
      interact: (root) => revealTable(root),
    },
  ],
});
