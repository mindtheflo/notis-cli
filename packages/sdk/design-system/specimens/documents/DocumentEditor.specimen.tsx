import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { DocumentEditor } from '../../../src';
import { InLanguages, LEGACY_DOCUMENT_IDS, LegacyApp, type LegacyDocumentCase } from '../../fixtures/documents/runtimes';
import { Code, Columns, Example, Stack } from '../../fixtures/documents/layout';
import { DOCUMENT_EDITOR_PROPS, PropsTable } from '../../fixtures/documents/props';

const RECORD_KEY = 'tasks:task-1';

/** One legacy App document, with the code that opens it as the caption. */
function LegacyDocument({ lang, kind, variant }: { lang: SpecimenLang; kind: LegacyDocumentCase; variant?: 'full' | 'body' }) {
  const id = LEGACY_DOCUMENT_IDS[kind];
  const code = `<DocumentEditor documentId="${id}"${variant ? ` variant="${variant}"` : ''} />`;
  return (
    <Example caption={<Code>{code}</Code>} width={760}>
      <LegacyApp lang={lang}><DocumentEditor documentId={id} variant={variant} /></LegacyApp>
    </Example>
  );
}

export const specimen = defineSpecimen({
  id: 'document-editor',
  name: 'DocumentEditor',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['DocumentEditor'],
  summary: 'Embeds the Notis editor for one record anywhere in a view; the Portal host draws it, a legacy App without the host gets a read-only preview.',
  states: [
    {
      id: 'space-fallback',
      label: 'In a Space without the host (what a Space sees outside Notis)',
      render: () => (
        <Stack gap={12}>
          <Code>{`<DocumentEditor recordKey="${RECORD_KEY}" variant="body" />`}</Code>
          <InLanguages>{() => <DocumentEditor recordKey={RECORD_KEY} variant="body" />}</InLanguages>
        </Stack>
      ),
    },
    {
      id: 'legacy-markdown',
      label: 'Legacy App preview: a Markdown note (title, body, read-only line)',
      render: ({ lang }) => <LegacyDocument lang={lang} kind="markdown" />,
    },
    {
      id: 'legacy-body',
      label: 'Legacy App preview: variant="body" (no title) and an untitled note',
      render: ({ lang }) => (
        <Columns min={340}>
          <LegacyDocument lang={lang} kind="markdown" variant="body" />
          <LegacyDocument lang={lang} kind="untitled" />
        </Columns>
      ),
    },
    {
      id: 'legacy-loading',
      label: 'Legacy App preview: loading',
      render: ({ lang }) => <LegacyDocument lang={lang} kind="loading" />,
    },
    {
      id: 'legacy-error',
      label: 'Legacy App preview: the document could not load, and a deleted document',
      render: ({ lang }) => (
        <Columns min={340}>
          <LegacyDocument lang={lang} kind="error" />
          <LegacyDocument lang={lang} kind="missing" />
        </Columns>
      ),
    },
    {
      id: 'legacy-other-types',
      label: 'Legacy App preview: a report, an HTML page and a PDF file',
      render: ({ lang }) => (
        <Stack gap={24}>
          <LegacyDocument lang={lang} kind="report" />
          <LegacyDocument lang={lang} kind="html" />
          <LegacyDocument lang={lang} kind="file" />
        </Stack>
      ),
    },
    {
      id: 'narrow',
      label: 'At 390 px: the Space fallback and the legacy preview',
      width: 390,
      render: ({ lang }) => (
        <Stack gap={24}>
          <InLanguages>{() => <DocumentEditor recordKey={RECORD_KEY} />}</InLanguages>
          <LegacyDocument lang={lang} kind="markdown" />
        </Stack>
      ),
    },
    {
      id: 'props',
      label: 'Props a Space can pass (the host draws the editor)',
      render: ({ lang }) => <PropsTable spec={DOCUMENT_EDITOR_PROPS} lang={lang} />,
    },
  ],
});
