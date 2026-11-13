import { useEffect, useMemo, useState } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import type { NotisRuntime } from '../../../src';
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

interface Seed { key: string; field: string; lang: string; quote: string; prefix?: string; author: string; at: string;
  body: { en: string; fr: string }; status?: string; thread?: string;
  /** The server's stamp of the agent that wrote it, with what it ran on (its logo and hover card). */
  agent?: { name: string; runtime: Record<string, string | null> } }

const SEEDS: Seed[] = [
  { key: 'p1', field: 'Body', lang: 'EN', quote: 'comments on any passage', prefix: 'a new editor, ', author: 'Flo',
    at: '2026-11-02T09:00:00Z', body: { en: 'Say what a passage is.', fr: 'Dis ce qu’est un passage.' } },
  { key: 'r1', field: 'Body', lang: 'EN', quote: '', author: 'fred-and-the-machine', at: '2026-11-02T09:20:00Z', thread: 'p1',
    agent: { name: 'fred-and-the-machine', runtime: { provider: 'claude_code', label: 'Claude', model: 'claude-opus-5.5',
      intelligence: null, effort: 'high', speed: 'normal' } },
    body: { en: 'Changed to "comments on the words you select".', fr: 'Remplacé par « commentaires sur les mots choisis ».' } },
  { key: 'p2', field: 'Subject', lang: 'EN', quote: 'Three new things', author: 'Flo', at: '2026-11-02T09:05:00Z',
    body: { en: 'Name them instead?', fr: 'Les nommer plutôt ?' } },
  { key: 'p3', field: 'Body', lang: 'EN', quote: 'a smarter inbox', author: 'Flo', at: '2026-11-01T17:00:00Z',
    body: { en: 'Is this ready?', fr: 'C’est prêt ?' } },
  { key: 'p4', field: 'Body', lang: 'FR', quote: 'une recherche plus rapide', author: 'Flo', at: '2026-11-02T10:00:00Z',
    body: { en: 'Same order as in English.', fr: 'Même ordre qu’en anglais.' } },
];

function rows(lang: Ctx['lang']) {
  const text = (value: string) => ({ type: 'rich_text', rich_text: [{ text: { content: value } }] });
  const select = (value: string) => ({ type: 'select', select: { name: value } });
  return SEEDS.map(seed => ({
    id: `id-${seed.key}`, record_key: seed.key, revision: 1, title: seed.body[lang], created_at: seed.at,
    ...(seed.agent ? { agent: seed.agent } : {}),
    properties: {
      Issue: { type: 'relation', relation: [{ id: 'issue-1' }] }, Author: select(seed.author),
      Status: select(seed.status ?? 'Open'), Needs: select('none'), Thread: text(seed.thread ?? ''),
      Field: select(seed.field), Language: select(seed.lang), Quote: text(seed.quote), Prefix: text(seed.prefix ?? ''),
      Suffix: text(''),
    },
  }));
}

function passageRuntime(lang: Ctx['lang'], empty: boolean): NotisRuntime {
  const base = bookRuntime(lang);
  let next = 0;
  return {
    ...base,
    space: {
      ...base.space!, cacheScope: `passages-book:${lang}:${empty ? 'empty' : 'full'}`,
      actions: { 'comments.insert': { readOnly: false }, 'comments.update': { readOnly: false } },
      shows: { comments: { database: 'comments' } },
      bindings: { comments: { kind: 'database', operations: { insert: 'comments.insert', update: 'comments.update' } } },
    } as unknown as NotisRuntime['space'],
    shown: async () => ({ rows: empty ? [] : rows(lang), schema_revision: 1 }),
    callAction: async () => ({ record_key: `book-${next += 1}`, revision: 2 }),
  } as unknown as NotisRuntime;
}

function Issue({ drafting }: { drafting?: boolean }) {
  const [group, setGroup] = useState('EN');
  const comments = usePassageComments({
    scope: SCOPE, fields: FIELDS, values: VALUES, group, columns: { scope: 'Issue', anchor: null },
    authors: ['Flo', 'Claude', 'Notis', 'fred-and-the-machine'],
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
  const runtime = useMemo(() => passageRuntime(ctx.lang, empty), [ctx.lang, empty]);
  // Each card names the thread it goes to at its top (the host's best match, from fixtures).
  return <HostCommentsProvider runtime={runtime} routing={ROUTING_FIXTURE}><Issue drafting={drafting} /></HostCommentsProvider>;
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
