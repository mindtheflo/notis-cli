import { useState } from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenLang } from '../../specimen';
import { MarkdownEditor } from '../../../src';
import { FIELD_WORDS } from '../../../src/ui/index';
import { pick, w } from '../../../src/words/index';
import { fixtureMarkdown } from '../../fixtures';
import { pressSave, typeInto, waitFor } from '../../fixtures/documents/interact';
import { Code, Columns, Example, Readout, Stack } from '../../fixtures/documents/layout';
import { MARKDOWN_EDITOR_PROPS, PropsTable } from '../../fixtures/documents/props';

/** How a Space styles the editor: flat, the Portal's muted fill, a full focus ring. */
const SPACE_CLASS = 'block w-full rounded-md bg-muted/50 p-4 font-mono text-[13px] leading-6 text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

const COPY = {
  status: { en: 'Status:', fr: 'État :' },
  typed: { en: '\n- [ ] Book the review with Alex', fr: '\n- [ ] Réserver la relecture avec Alex' },
  placeholder: { en: 'Write the meeting notes…', fr: 'Écris les notes de la réunion…' },
} satisfies Record<string, SpecimenCopy>;

const UP_TO_DATE = w('Up to date', 'À jour');
const SAVED = w('Saved', 'Enregistré');
const REVISION = w('revision', 'révision');

/** What onSave does in the book: answer with a new revision, never answer, or nothing (no onSave). */
type SaveBehaviour = 'saves' | 'hangs';

function onSaveFor(behaviour: SaveBehaviour) {
  return behaviour === 'hangs'
    ? () => new Promise<never>(() => undefined)
    : () => Promise.resolve({ revision: 'r-8' });
}

/**
 * The editor with a status line fed by its callbacks (onDirtyChange, onSavingChange, onSave), as a Space shows it.
 * `data-ds-typed` holds the words the interact step types.
 */
function EditorWithStatus({ lang, behaviour = 'saves', autosaveMs, className, readOnly }: {
  lang: SpecimenLang; behaviour?: SaveBehaviour; autosaveMs?: number; className?: string; readOnly?: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState<string | null>(null);
  const save = onSaveFor(behaviour);
  const status = saving
    ? pick(FIELD_WORDS.saving, lang)
    : dirty
      ? pick(FIELD_WORDS.unsaved, lang)
      : revision
        ? `${pick(SAVED, lang)} (${pick(REVISION, lang)} ${revision})`
        : pick(UP_TO_DATE, lang);
  return (
    <Stack gap={8}>
      <Readout label={COPY.status[lang]}>{status}</Readout>
      <div data-ds-typed={COPY.typed[lang]}>
        <MarkdownEditor
          resourceKey="tasks:task-1"
          value={fixtureMarkdown(lang)}
          revision="r-7"
          readOnly={readOnly}
          autosaveMs={autosaveMs}
          className={className}
          onDirtyChange={setDirty}
          onSavingChange={setSaving}
          onSave={async (payload) => {
            const result = await save();
            setRevision(result.revision);
            return result;
          }}
        />
      </div>
    </Stack>
  );
}

/** Types into the editor (the words in `data-ds-typed`), then presses Cmd+S when `thenSave`. */
function typeAnd(thenSave: boolean) {
  return async (root: HTMLElement) => {
    const holder = await waitFor<HTMLElement>(root, '[data-ds-typed]');
    const textarea = await waitFor<HTMLTextAreaElement>(holder, 'textarea');
    await typeInto(textarea, holder.dataset.dsTyped ?? '');
    if (thenSave) await pressSave(textarea);
  };
}

export const specimen = defineSpecimen({
  id: 'markdown-editor',
  name: 'MarkdownEditor',
  group: 'documents',
  from: '@notis/sdk',
  covers: ['MarkdownEditor'],
  summary: 'Notis’ Markdown editor for text the Space stores itself: the Space saves through onSave; without the host it is a plain text area.',
  states: [
    {
      id: 'default',
      label: 'Without the host, as shipped (no className)',
      render: ({ lang }) => (
        <Example caption={<Code>{'<MarkdownEditor value={body} revision="r-7" onSave={save} />'}</Code>} width={760}>
          <EditorWithStatus lang={lang} />
        </Example>
      ),
    },
    {
      id: 'space-styled',
      label: 'Without the host, styled by the Space (className)',
      render: ({ lang }) => (
        <Example caption={<Code>{'<MarkdownEditor className="rounded-md bg-muted/50 p-4 font-mono ..." ... />'}</Code>} width={760}>
          <EditorWithStatus lang={lang} className={SPACE_CLASS} />
        </Example>
      ),
    },
    {
      id: 'empty',
      label: 'Empty: the default placeholder and a Space placeholder',
      render: ({ t }) => (
        <Columns min={320}>
          <Example caption={<Code>{'<MarkdownEditor value="" />'}</Code>}>
            <MarkdownEditor value="" className={SPACE_CLASS} />
          </Example>
          <Example caption={<Code>{`<MarkdownEditor value="" placeholder="${t(COPY.placeholder)}" />`}</Code>}>
            <MarkdownEditor value="" placeholder={t(COPY.placeholder)} className={SPACE_CLASS} />
          </Example>
        </Columns>
      ),
    },
    {
      id: 'read-only',
      label: 'Read only',
      render: ({ lang }) => (
        <Example caption={<Code>{'<MarkdownEditor value={body} readOnly />'}</Code>} width={760}>
          <EditorWithStatus lang={lang} className={SPACE_CLASS} readOnly />
        </Example>
      ),
    },
    {
      id: 'dirty',
      label: 'Unsaved changes (typed, autosave not due yet)',
      render: ({ lang }) => (
        <Example caption={<Code>{'onDirtyChange(true) after typing; autosave runs autosaveMs after the last change'}</Code>} width={760}>
          <EditorWithStatus lang={lang} className={SPACE_CLASS} autosaveMs={600000} />
        </Example>
      ),
      interact: typeAnd(false),
    },
    {
      id: 'saving',
      label: 'Saving (Cmd+S, onSave still running)',
      render: ({ lang }) => (
        <Example caption={<Code>{'onSavingChange(true) while onSave runs'}</Code>} width={760}>
          <EditorWithStatus lang={lang} className={SPACE_CLASS} behaviour="hangs" autosaveMs={600000} />
        </Example>
      ),
      interact: typeAnd(true),
    },
    {
      id: 'saved',
      label: 'Saved (Cmd+S, onSave answered with a new revision)',
      render: ({ lang }) => (
        <Example caption={<Code>{'onSave resolves { revision: "r-8" }; onDirtyChange(false)'}</Code>} width={760}>
          <EditorWithStatus lang={lang} className={SPACE_CLASS} autosaveMs={600000} />
        </Example>
      ),
      interact: typeAnd(true),
    },
    {
      id: 'narrow',
      label: 'At 390 px',
      width: 390,
      render: ({ lang }) => <EditorWithStatus lang={lang} className={SPACE_CLASS} />,
    },
    {
      id: 'props',
      label: 'Props a Space can pass (the host draws the editor)',
      render: ({ lang }) => <PropsTable spec={MARKDOWN_EDITOR_PROPS} lang={lang} />,
    },
  ],
});
