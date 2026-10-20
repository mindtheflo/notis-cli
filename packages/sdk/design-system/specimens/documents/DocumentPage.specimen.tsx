import { useState } from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenLang } from '../../specimen';
import { DocumentPage, DocumentPageSkeleton } from '../../../src';
import { Button, Notice } from '../../../src/ui/index';
import { STANDARD_ACTIONS } from '../../../src/words/index';
import { LONG_TITLE } from '../../fixtures';
import { InLanguages } from '../../fixtures/documents/runtimes';
import { Code, Example, Readout, Stack } from '../../fixtures/documents/layout';
import { DOCUMENT_PAGE_PROPS, PropsTable } from '../../fixtures/documents/props';

/** The note the pages open: task-1 of the fixture tasks database (Ship the new onboarding). */
const RECORD_KEY = 'tasks:task-1';

const COPY = {
  notes: { en: 'Notes', fr: 'Notes' },
  launch: { en: 'June launch', fr: 'Lancement de juin' },
  markDone: { en: 'Mark as done', fr: 'Marquer comme terminé' },
  duplicate: { en: 'Duplicate', fr: 'Dupliquer' },
  exportPdf: { en: 'Export as PDF', fr: 'Exporter en PDF' },
  deleteForever: { en: 'Delete forever', fr: 'Supprimer définitivement' },
  linked: { en: 'This note is part of the June launch checklist.', fr: 'Cette note fait partie de la liste de contrôle du lancement de juin.' },
  edited: { en: 'Last edited by Sam on 14 June 2026.', fr: 'Modifiée pour la dernière fois par Sam le 14 juin 2026.' },
  last: { en: 'Last press:', fr: 'Dernier appui\u202f:' },
  none: { en: 'none yet', fr: 'aucun pour l’instant' },
  skeletonLabel: { en: 'Opening Ship the new onboarding', fr: 'Ouverture de Livrer le nouvel accueil des comptes' },
} satisfies Record<string, SpecimenCopy>;

const CODE_FULL = `<DocumentPage recordKey="${RECORD_KEY}" breadcrumb={[...]} actions={<Button />}
  share menuItems={[...]} aboveBody={<Notice />} belowBody={<p />} />`;

/** Every slot a Space can fill, with a readout of the last crumb, action or menu entry pressed. */
function FullPage({ lang }: { lang: SpecimenLang }) {
  const t = (copy: SpecimenCopy) => copy[lang];
  const [last, setLast] = useState(t(COPY.none));
  return (
    <Stack gap={12}>
      <Readout label={t(COPY.last)}>{last}</Readout>
      <DocumentPage
        recordKey={RECORD_KEY}
        breadcrumb={[{ label: t(COPY.notes), onSelect: () => setLast(t(COPY.notes)) }, { label: t(COPY.launch) }]}
        actions={<Button size="sm" icon="check" onClick={() => setLast(t(COPY.markDone))}>{t(COPY.markDone)}</Button>}
        share
        menuItems={[
          { label: t(COPY.duplicate), onSelect: () => setLast(t(COPY.duplicate)) },
          { label: t(COPY.exportPdf), onSelect: () => setLast(t(COPY.exportPdf)), disabled: true },
          { label: t(COPY.deleteForever), onSelect: () => setLast(t(COPY.deleteForever)), destructive: true },
        ]}
        aboveBody={<Notice tone="info">{t(COPY.linked)}</Notice>}
        belowBody={<p className="m-0 text-xs text-muted-foreground">{t(COPY.edited)}</p>}
        onSaved={() => setLast('onSaved')}
      />
    </Stack>
  );
}

export const specimen = defineSpecimen({
  id: 'document-page',
  name: 'DocumentPage',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['DocumentPage', 'DocumentPageSkeleton'],
  summary: 'The full page of one record (a note) as a Space view, drawn by the Portal host; its skeleton matches the page so nothing moves.',
  states: [
    {
      id: 'skeleton',
      label: 'DocumentPageSkeleton (standard width, 900 px column)',
      render: () => (
        <Example caption={<Code>{'<DocumentPageSkeleton />'}</Code>}>
          <DocumentPageSkeleton />
        </Example>
      ),
    },
    {
      id: 'skeleton-widths',
      label: 'DocumentPageSkeleton: wide (1200 px) and full',
      render: () => (
        <Stack>
          <Example caption={<Code>{'<DocumentPageSkeleton width="wide" />'}</Code>}><DocumentPageSkeleton width="wide" /></Example>
          <Example caption={<Code>{'<DocumentPageSkeleton width="full" />'}</Code>}><DocumentPageSkeleton width="full" /></Example>
        </Stack>
      ),
    },
    {
      id: 'skeleton-label',
      label: 'DocumentPageSkeleton with the label screen readers hear',
      render: ({ t }) => (
        <Example caption={<><Code>{'<DocumentPageSkeleton label={...} />'}</Code><br />
          <Code>{`role="status" aria-busy="true" aria-label="${t(COPY.skeletonLabel)}"`}</Code></>}>
          <DocumentPageSkeleton label={t(COPY.skeletonLabel)} />
        </Example>
      ),
    },
    {
      id: 'skeleton-narrow',
      label: 'DocumentPageSkeleton at 390 px (16 px gutter, smaller icon)',
      width: 390,
      render: () => <DocumentPageSkeleton />,
    },
    {
      id: 'fallback-full',
      label: 'Without the host: every slot (breadcrumb, action, Share, menu entries, above and below the body)',
      render: () => (
        <Stack gap={12}>
          <Code>{CODE_FULL}</Code>
          <InLanguages minColumn={420}>{(lang) => <FullPage lang={lang} />}</InLanguages>
        </Stack>
      ),
    },
    {
      id: 'fallback-minimal',
      label: 'Without the host: recordKey only (no toolbar)',
      render: () => (
        <Stack gap={12}>
          <Code>{`<DocumentPage recordKey="${RECORD_KEY}" />`}</Code>
          <InLanguages>{() => <DocumentPage recordKey={RECORD_KEY} />}</InLanguages>
        </Stack>
      ),
    },
    {
      id: 'fallback-html',
      label: 'Without the host: viewer="html" (the HTML frame replaces the editor)',
      render: () => (
        <Stack gap={12}>
          <Code>{`<DocumentPage recordKey="${RECORD_KEY}" viewer="html" breadcrumb={[...]} />`}</Code>
          <InLanguages>
            {(lang) => <DocumentPage recordKey={RECORD_KEY} viewer="html" breadcrumb={[{ label: COPY.notes[lang] }]} />}
          </InLanguages>
        </Stack>
      ),
    },
    {
      id: 'fallback-narrow',
      label: 'Without the host at 390 px: long breadcrumb, action and menu entries',
      width: 390,
      render: () => (
        <InLanguages>
          {(lang) => (
            <DocumentPage
              recordKey={RECORD_KEY}
              breadcrumb={[{ label: COPY.notes[lang], onSelect: () => undefined }, { label: LONG_TITLE[lang] }]}
              actions={<Button size="sm" icon={STANDARD_ACTIONS.delete.icon} variant="ghost" aria-label={STANDARD_ACTIONS.delete.label[lang]} />}
              menuItems={[{ label: COPY.duplicate[lang], onSelect: () => undefined }]}
            />
          )}
        </InLanguages>
      ),
    },
    {
      id: 'props',
      label: 'Props a Space can pass (the host draws the page)',
      render: ({ lang }) => <PropsTable spec={DOCUMENT_PAGE_PROPS} lang={lang} />,
    },
  ],
});
