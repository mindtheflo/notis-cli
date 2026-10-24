import type { ReactNode } from 'react';
import { defineSpecimen, type SpecimenCopy } from '../../specimen';
import { HtmlFrame, RecordProperties, ReportFrame, ShareControl, SpacePageFrame } from '../../../src';
import { fixtureRecords } from '../../fixtures';
import { InLanguages } from '../../fixtures/documents/runtimes';
import { Code, Example, Outline, Stack } from '../../fixtures/documents/layout';
import {
  HTML_FRAME_PROPS, PropsTables, RECORD_PROPERTIES_PROPS, REPORT_FRAME_PROPS, SHARE_CONTROL_PROPS, SPACE_PAGE_FRAME_PROPS,
} from '../../fixtures/documents/props';

const TASK_KEY = 'tasks:task-1';
const REPORT_KEY = 'notes:note-weekly-report';
/** A Space page link, as a deck's Page property holds it. */
const SPACE_PAGE = '/product/roadmap?view=quarter';

/** A small page a declared Site read action returns, for HtmlFrame's html prop. */
const PRICING_HTML = '<main><h1>Pricing</h1><p>Team plan, 12 dollars per seat each month.</p></main>';

const COPY = {
  properties: { en: 'Properties', fr: 'Propriétés' },
  report: { en: 'Weekly report', fr: 'Rapport hebdomadaire' },
} satisfies Record<string, SpecimenCopy>;

/** One fallback with the code that renders it; the ring marks the component's box. */
function Fallback({ code, children }: { code: string; children: ReactNode }) {
  return <Example caption={<Code>{code}</Code>}><Outline>{children}</Outline></Example>;
}

function AllFallbacks() {
  return (
    <Stack gap={20}>
      <Fallback code={`<RecordProperties recordKey="${TASK_KEY}" />`}><RecordProperties recordKey={TASK_KEY} /></Fallback>
      <Fallback code={`<HtmlFrame recordKey="${REPORT_KEY}" title="Report" />`}><HtmlFrame recordKey={REPORT_KEY} title="Report" /></Fallback>
      <Fallback code={'<HtmlFrame html={page} title="Pricing" />'}><HtmlFrame html={PRICING_HTML} title="Pricing" /></Fallback>
      <Fallback code={`<ReportFrame recordKey="${REPORT_KEY}" />`}><ReportFrame recordKey={REPORT_KEY} /></Fallback>
      <Fallback code={`<ShareControl recordKey="${TASK_KEY}" />`}><ShareControl recordKey={TASK_KEY} /></Fallback>
      <Fallback code={`<SpacePageFrame href="${SPACE_PAGE}" title="Roadmap" />`}><SpacePageFrame href={SPACE_PAGE} title="Roadmap" /></Fallback>
    </Stack>
  );
}

export const specimen = defineSpecimen({
  id: 'record-properties',
  name: 'RecordProperties',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['RecordProperties', 'HtmlFrame', 'ReportFrame', 'ShareControl', 'SpacePageFrame'],
  summary: 'Host-drawn parts a Space can place anywhere: a record’s properties, an HTML or report frame, Share, and another Space page shown live.',
  states: [
    {
      id: 'fallbacks',
      label: 'Without the host: each component in English and French',
      render: () => <InLanguages minColumn={360}>{() => <AllFallbacks />}</InLanguages>,
    },
    {
      id: 'in-a-page',
      label: 'Without the host, placed in a Space’s record view (Share in the header, properties on the side)',
      render: ({ lang, t }) => {
        const task = fixtureRecords(lang).find((record) => record.id === 'task-1');
        return (
          <div className="grid gap-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="m-0 text-xl font-semibold text-foreground">{task?.title ?? TASK_KEY}</h2>
              <div className="max-w-sm text-sm text-muted-foreground"><ShareControl recordKey={TASK_KEY} /></div>
            </div>
            <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_280px]">
              <section className="grid content-start gap-2">
                <h3 className="m-0 text-sm font-medium text-muted-foreground">{t(COPY.report)}</h3>
                <ReportFrame recordKey={REPORT_KEY} className="text-sm" />
              </section>
              <aside className="grid content-start gap-2">
                <h3 className="m-0 text-sm font-medium text-muted-foreground">{t(COPY.properties)}</h3>
                <RecordProperties recordKey={TASK_KEY} className="text-sm" />
              </aside>
            </div>
          </div>
        );
      },
    },
    {
      id: 'narrow',
      label: 'Without the host at 390 px',
      width: 390,
      render: () => <InLanguages>{() => <AllFallbacks />}</InLanguages>,
    },
    {
      id: 'props',
      label: 'Props a Space can pass (the host draws each part)',
      render: ({ lang }) => (
        <PropsTables specs={[RECORD_PROPERTIES_PROPS, HTML_FRAME_PROPS, REPORT_FRAME_PROPS, SHARE_CONTROL_PROPS, SPACE_PAGE_FRAME_PROPS]} lang={lang} />
      ),
    },
  ],
});
