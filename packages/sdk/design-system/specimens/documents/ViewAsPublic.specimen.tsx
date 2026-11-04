import { useMemo, useState } from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenLang } from '../../specimen';
import { Editors, NotisProvider, Public, ViewAsPublic, useAudience, type NotisRuntime } from '../../../src';
import { bookRuntime } from '../../fixtures/documents/runtimes';
import { Code, Example, Stack } from '../../fixtures/documents/layout';

const COPY = {
  editors: { en: 'Draft months and the newsletter tools, for editors only.', fr: 'Les mois en brouillon et les outils de la newsletter, pour les Editors uniquement.' },
  public: { en: 'The published months, as everyone sees them.', fr: 'Les mois publiés, comme tout le monde les voit.' },
} satisfies Record<string, SpecimenCopy>;

/** The book's Space runtime, for an editor of a Space that marks something editor-only, switchable to the public. */
function AudienceRuntime({ lang, start, editor = true, children }: {
  lang: SpecimenLang; start: 'public' | null; editor?: boolean; children: React.ReactNode;
}) {
  const [viewAs, setViewAs] = useState<'public' | null>(start);
  const base = bookRuntime(lang);
  const runtime = useMemo(() => ({
    ...base,
    space: { ...base.space!, audience: editor ? 'editor' : 'public',
      ...(editor ? { editorsOnly: { shows: ['drafts'] } } : {}), ...(viewAs ? { viewAs } : {}) },
    ...(editor ? { setSpaceViewAs: setViewAs } : {}),
  }) as NotisRuntime, [base, editor, viewAs]);
  return <NotisProvider runtime={runtime}>{children}</NotisProvider>;
}

function Page({ lang }: { lang: SpecimenLang }) {
  const { audience } = useAudience();
  return (
    <Stack>
      <ViewAsPublic />
      <Code>{`useAudience().audience = '${audience}'`}</Code>
      <Editors><p style={{ margin: 0 }}>{COPY.editors[lang]}</p></Editors>
      <Public><p style={{ margin: 0 }}>{COPY.public[lang]}</p></Public>
    </Stack>
  );
}

export const specimen = defineSpecimen({
  id: 'view-as-public',
  name: 'ViewAsPublic',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['ViewAsPublic', 'Editors', 'Public'],
  summary: 'One Space for its editors and the public: Editors and Public show what differs, ViewAsPublic lets an editor check the public page.',
  states: [
    {
      id: 'editor',
      label: 'An editor: editor-only content and the View as the public switch',
      render: ({ lang }) => (
        <Example caption={<Code>{'<ViewAsPublic /> <Editors>...</Editors> <Public>...</Public>'}</Code>}>
          <AudienceRuntime lang={lang} start={null}><Page lang={lang} /></AudienceRuntime>
        </Example>
      ),
    },
    {
      id: 'viewing-as-public',
      label: 'An editor viewing the Space as the public: Back to editing',
      render: ({ lang }) => (
        <Example caption={<Code>{"space.viewAs = 'public'"}</Code>}>
          <AudienceRuntime lang={lang} start="public"><Page lang={lang} /></AudienceRuntime>
        </Example>
      ),
    },
    {
      id: 'public',
      label: 'The public: no switch, public content only',
      render: ({ lang }) => (
        <Example caption={<Code>{"space.audience = 'public'"}</Code>}>
          <AudienceRuntime lang={lang} start={null} editor={false}><Page lang={lang} /></AudienceRuntime>
        </Example>
      ),
    },
  ],
});
