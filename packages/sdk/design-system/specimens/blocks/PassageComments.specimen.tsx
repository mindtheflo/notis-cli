import { useEffect, useMemo, useState } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import type { SpaceCommentRow } from '../../../src';
import { HostCommentsProvider, HostPanelSlot, ROUTING_FIXTURE } from '../hostCommentsPanel';
import {
  CommentableRichText, CommentableText, PassageCommentPane, usePassageComments, type CommentScope, type PassageField,
} from '../../../src/ui/index';
import { w } from '../../../src/words/index';
import { bookRuntime } from '../../fixtures/documents/runtimes';

type Ctx = SpecimenRenderContext;

const SCOPE: CommentScope = { id: 'issue-1', recordKey: 'issue-1', name: 'Week 44', checkpoint: null };

/** A newsletter issue: a subject and a body per language, each a field comments can sit on. */
const FIELDS: PassageField[] = [
  { key: 'subjectEn', label: w('Subject', 'Objet'), group: 'EN', values: { Field: 'Subject', Language: 'EN' } },
  { key: 'bodyEn', label: w('Body', 'Corps'), group: 'EN', markdown: true, values: { Field: 'Body', Language: 'EN' } },
  { key: 'subjectFr', label: w('Subject', 'Objet'), group: 'FR', values: { Field: 'Subject', Language: 'FR' } },
  { key: 'bodyFr', label: w('Body', 'Corps'), group: 'FR', markdown: true, values: { Field: 'Body', Language: 'FR' } },
];

const VALUES = {
  subjectEn: 'Three new things in Notis this week',
  bodyEn: 'Hi there, this week brings a new editor, comments on any passage and a faster search.',
  subjectFr: 'Trois nouveautés dans Notis cette semaine',
  bodyFr: 'Bonjour, cette semaine apporte un nouvel éditeur, des commentaires sur tout passage et une recherche plus rapide.',
};

const GROUPS = { EN: w('the English copy', 'la version anglaise'), FR: w('the French copy', 'la version française') };

/** `field`: the key of the field the words are in. */
interface Seed { key: string; field: string; quote: string; prefix?: string; author: string; at: string;
  body: { en: string; fr: string }; thread?: string;
  /** The server's stamp of the agent that wrote it, with what it ran on (its logo and hover card). */
  agent?: { name: string; runtime: Record<string, string | null> } }

const SEEDS: Seed[] = [
  { key: 'p1', field: 'bodyEn', quote: 'comments on any passage', prefix: 'a new editor, ', author: 'Flo',
    at: '2026-11-02T09:00:00Z', body: { en: 'Say what a passage is.', fr: 'Dis ce qu’est un passage.' } },
  { key: 'r1', field: 'bodyEn', quote: '', author: 'fred-and-the-machine', at: '2026-11-02T09:20:00Z', thread: 'p1',
    agent: { name: 'fred-and-the-machine', runtime: { provider: 'claude_code', label: 'Claude', model: 'claude-opus-5.5',
      intelligence: null, effort: 'high', speed: 'normal' } },
    body: { en: 'Changed to "comments on the words you select".', fr: 'Remplacé par « commentaires sur les mots choisis ».' } },
  { key: 'p2', field: 'subjectEn', quote: 'Three new things', author: 'Flo', at: '2026-11-02T09:05:00Z',
    body: { en: 'Name them instead?', fr: 'Les nommer plutôt ?' } },
  { key: 'p3', field: 'bodyEn', quote: 'a smarter inbox', author: 'Flo', at: '2026-11-01T17:00:00Z',
    body: { en: 'Is this ready?', fr: 'C’est prêt ?' } },
  { key: 'p4', field: 'bodyFr', quote: 'une recherche plus rapide', author: 'Flo', at: '2026-11-02T10:00:00Z',
    body: { en: 'Same order as in English.', fr: 'Même ordre qu’en anglais.' } },
];

/** The seeds as comment store rows, in the viewer's language. Flo is the viewer. */
function rows(lang: Ctx['lang']): Partial<SpaceCommentRow>[] {
  return SEEDS.map(seed => ({
    id: seed.key, page_key: 'issue-1', thread_root_id: seed.thread ?? null, mode: 'text',
    field: seed.thread ? null : seed.field, quote: seed.thread ? null : seed.quote, prefix: seed.thread ? null : seed.prefix ?? '',
    suffix: seed.thread ? null : '', body: seed.body[lang], created_at: seed.at, changed_at: seed.at,
    author: seed.agent ? { user_id: 'user-flo', name: 'Flo', you: false } : { user_id: 'user-flo', name: seed.author, you: seed.author === 'Flo' },
    agent: seed.agent ?? null,
  }));
}

function Issue({ drafting }: { drafting?: boolean }) {
  const [group, setGroup] = useState('EN');
  const comments = usePassageComments({
    scope: SCOPE, fields: FIELDS, values: VALUES, group,
  });
  const { startDraft, controller } = comments;
  useEffect(() => {
    if (drafting && controller.hasData) startDraft({ field: 'bodyEn', quote: 'a faster search', prefix: 'any passage and ', suffix: '.' });
  }, [drafting, controller.hasData, startDraft]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, minHeight: 480 }}>
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <CommentableText comments={comments} field="subjectEn" value={VALUES.subjectEn}>
          <input aria-label="Subject" defaultValue={VALUES.subjectEn} style={{ width: '100%', font: 'inherit', padding: 8,
            border: '1px solid hsl(var(--border))', borderRadius: 8, background: 'hsl(var(--background))', color: 'inherit' }} />
        </CommentableText>
        <CommentableRichText comments={comments} field="bodyEn">
          <p style={{ margin: 0, lineHeight: 1.6 }}>{VALUES.bodyEn}</p>
        </CommentableRichText>
      </div>
      <PassageCommentPane comments={comments} groups={GROUPS} onGroup={setGroup} />
      <HostPanelSlot />
    </div>
  );
}

function Demo({ ctx, empty = false, drafting }: { ctx: Ctx; empty?: boolean; drafting?: boolean }) {
  const runtime = useMemo(() => bookRuntime(ctx.lang), [ctx.lang]);
  const seeded = useMemo(() => (empty ? [] : rows(ctx.lang)), [ctx.lang, empty]);
  // Each card names the thread it goes to at its top (the host's best match, from fixtures).
  return (
    <HostCommentsProvider runtime={runtime} rows={seeded} routing={ROUTING_FIXTURE}>
      <Issue drafting={drafting} />
    </HostCommentsProvider>
  );
}

export const specimen = defineSpecimen({
  id: 'passage-comments',
  name: 'PassageComments',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['CommentableText', 'CommentableRichText', 'PassageCommentPane'],
  summary: 'Comments on passages of a record\'s text: highlights in a field or a Markdown body, Comment on a selection, Text changed when the words are gone, the comments of the other language one click away, the thread each card goes to at its top, and an agent\'s signature with its harness logo.',
  states: [
    {
      id: 'threads',
      label: 'Highlighted passages in a subject and a body, a reply, a passage no longer in the text, and the French copy\'s thread',
      height: 520,
      render: ctx => <Demo ctx={ctx} />,
    },
    {
      id: 'new-comment',
      label: 'A selection turned into a new comment: the box shows the quoted words',
      height: 520,
      render: ctx => <Demo ctx={ctx} drafting />,
    },
    {
      id: 'empty',
      label: 'No comments yet: select a passage to comment on it',
      height: 520,
      render: ctx => <Demo ctx={ctx} empty />,
    },
  ],
});
