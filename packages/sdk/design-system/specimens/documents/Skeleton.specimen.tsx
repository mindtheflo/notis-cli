import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { SKELETON_WORDS, Skeleton, ViewSkeleton } from '../../../src';
import { pick, w, type Words } from '../../../src/words/index';
import { Code, Columns, Example, Stack } from '../../fixtures/documents/layout';

const LOADING_MEETINGS = w('Loading meetings', 'Chargement des réunions de la semaine');
const LOADING_REPORT = w('Loading the weekly report', 'Chargement du rapport hebdomadaire des conversations');

/** What a screen reader announces for a ViewSkeleton with this label. */
function Heard({ label, lang }: { label?: Words; lang: SpecimenLang }) {
  const said = pick(label ?? SKELETON_WORDS.loading, lang);
  return <Code>{`role="status" aria-label="${said}"`}</Code>;
}

/** A list of notes while it loads: icon, title and a line of preview per row, shaped like the rows that replace it. */
function NoteRowsLoading() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      {[72, 54, 64, 40].map((size, index) => (
        <div key={index} className="grid grid-cols-[32px_1fr] items-center gap-3">
          <Skeleton style={{ width: 32, height: 32, borderRadius: 999 }} />
          <div className="grid gap-2">
            <Skeleton style={{ width: `${size}%`, height: 14 }} />
            <Skeleton style={{ width: `${size + 20}%`, height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A metric card while its number loads. */
function MetricLoading() {
  return (
    <div className="grid max-w-56 gap-3" aria-hidden="true">
      <Skeleton style={{ width: '60%', height: 12 }} />
      <Skeleton style={{ width: '45%', height: 32 }} />
      <Skeleton style={{ width: '80%', height: 12 }} />
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'skeleton',
  name: 'Skeleton',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['Skeleton', 'ViewSkeleton'],
  summary: 'Placeholders shaped like the content that is loading; ViewSkeleton covers a whole view and announces what loads.',
  states: [
    {
      id: 'blocks',
      label: 'Skeleton blocks shaped like content (a list of notes, a metric)',
      render: () => (
        <Columns min={280}>
          <Example caption={<Code>{'<Skeleton style={{ width: 32, height: 32, borderRadius: 999 }} />'}</Code>}>
            <NoteRowsLoading />
          </Example>
          <Example caption={<Code>{'<Skeleton style={{ width: \'45%\', height: 32 }} />'}</Code>}>
            <MetricLoading />
          </Example>
          <Example caption={<Code>{'<Skeleton /> (no props: 16 px high, full width)'}</Code>}>
            <Skeleton />
          </Example>
        </Columns>
      ),
    },
    {
      id: 'view-table',
      label: 'ViewSkeleton: table (default, 5 rows)',
      render: ({ lang }) => (
        <Example caption={<Heard lang={lang} />}><ViewSkeleton /></Example>
      ),
    },
    {
      id: 'view-cards',
      label: 'ViewSkeleton: cards, 6 rows',
      render: ({ lang }) => (
        <Example caption={<Heard label={LOADING_MEETINGS} lang={lang} />}>
          <ViewSkeleton variant="cards" rows={6} label={LOADING_MEETINGS} />
        </Example>
      ),
    },
    {
      id: 'view-graph',
      label: 'ViewSkeleton: graph',
      render: ({ lang }) => (
        <Example caption={<Heard label={LOADING_REPORT} lang={lang} />}>
          <ViewSkeleton variant="graph" label={LOADING_REPORT} />
        </Example>
      ),
    },
    {
      id: 'view-detail',
      label: 'ViewSkeleton: detail, 7 lines (the last one shorter)',
      render: ({ lang }) => (
        <Example caption={<Heard lang={lang} />}><ViewSkeleton variant="detail" rows={7} /></Example>
      ),
    },
    {
      id: 'labels',
      label: 'What screen readers hear: default, a Space label, a forced locale',
      render: ({ lang }) => (
        <Stack>
          <Example caption={<><Code>{'label: default (SKELETON_WORDS.loading)'}</Code><br /><Heard lang={lang} /></>}>
            <ViewSkeleton variant="detail" rows={2} />
          </Example>
          <Example caption={<><Code>{'label={w(\'Loading meetings\', ...)}'}</Code><br /><Heard label={LOADING_MEETINGS} lang={lang} /></>}>
            <ViewSkeleton variant="detail" rows={2} label={LOADING_MEETINGS} />
          </Example>
          <Example caption={<><Code>{`locale="${lang === 'fr' ? 'en' : 'fr'}" (overrides the Space locale)`}</Code><br />
            <Heard lang={lang === 'fr' ? 'en' : 'fr'} /></>}>
            <ViewSkeleton variant="detail" rows={2} locale={lang === 'fr' ? 'en' : 'fr'} />
          </Example>
        </Stack>
      ),
    },
    {
      id: 'narrow-cards',
      label: 'Cards at 390 px (one card per row)',
      width: 390,
      render: ({ lang }) => (
        <Example caption={<Heard label={LOADING_MEETINGS} lang={lang} />}>
          <ViewSkeleton variant="cards" rows={3} label={LOADING_MEETINGS} />
        </Example>
      ),
    },
  ],
});
