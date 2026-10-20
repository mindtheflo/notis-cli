import * as React from 'react';
import type { ClipboardEvent, ReactNode } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { NOTIS_CONTEXT_CLIPBOARD_TYPE, NotisSelectionBoundary, type ContextResource } from '../../../src';
import { w, type Words } from '../../../src/words';
import { copyFrom, layerScope, selectText, settle, waitFor } from '../../fixtures/interactions/interact';
import { Note, taskRows } from '../../fixtures/interactions/selection';

type Ctx = SpecimenRenderContext;

const COPY = {
  intro: w(
    'The pricing page needs the new Team plan before the launch on Tuesday 16 June. Show the yearly price first and keep the monthly one a click away.',
    'La page des tarifs doit montrer la nouvelle offre Team avant le lancement du mardi 16 juin. Affiche d’abord le prix annuel et garde le prix mensuel à un clic.',
  ),
  quote: w('Show the yearly price first', 'Affiche d’abord le prix annuel'),
  draft: w('Looks good, ship it on Monday.', 'C’est bon, on publie lundi.'),
  draftLabel: w('Reply', 'Réponse'),
  idle: w(
    'Copying words from this page keeps their plain text and adds where they came from, so the Notis chat can show them as a quote.',
    'Copier des mots de cette page garde leur texte brut et ajoute leur provenance : le chat Notis peut alors les afficher comme une citation.',
  ),
  copied: w('What the copy carries', 'Ce que contient la copie'),
  plain: w('Plain text, for every app', 'Texte brut, pour toutes les applications'),
  context: w('Notis context, for the chat', 'Contexte Notis, pour le chat'),
  none: w('No Notis context: only the field’s own copy.', 'Aucun contexte Notis : seulement la copie propre au champ.'),
  freshId: w('a new id on every copy', 'un nouvel identifiant à chaque copie'),
  leftToField: w(
    'Left to the field: the browser copies the selected words as usual.',
    'Laissée au champ : le navigateur copie les mots sélectionnés comme d’habitude.',
  ),
  inputNote: w(
    'Copying inside a text field is left to the field, so drafts never turn into quotes.',
    'Une copie dans un champ de texte est laissée au champ : un brouillon ne devient jamais une citation.',
  ),
  noResource: w(
    'Without a resource the copy still carries the text, with no record attached.',
    'Sans ressource, la copie garde le texte, sans fiche associée.',
  ),
} satisfies Record<string, Words>;

function resourceFor(ctx: Ctx): ContextResource {
  const task = taskRows(ctx.lang)[1]!;
  return { id: 'tasks:task-2', kind: 'record', label: task.title };
}

interface Copied { plain: string; context: string }

/** Reads the clipboard after the boundary wrote it: the copy bubbles from the boundary to this wrapper. */
function useCopyProbe() {
  const [copied, setCopied] = React.useState<Copied | null>(null);
  const onCopy = React.useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const data = event.clipboardData;
    setCopied({ plain: data.getData('text/plain'), context: data.getData(NOTIS_CONTEXT_CLIPBOARD_TYPE) });
  }, []);
  return { copied, onCopy };
}

/** The context payload with its random id replaced by words, so the shot stays the same on every run. */
function readablePayload(raw: string, freshId: string): string {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify({ ...payload, id: `<${freshId}>` }, null, 2);
  } catch {
    return raw;
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function CopyPanel({ ctx, copied }: { ctx: Ctx; copied: Copied | null }) {
  if (!copied) return null;
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-muted/60 p-4" data-ds-copied="">
      <h3 className="text-sm font-semibold">{ctx.t(COPY.copied)}</h3>
      <Field label={`${ctx.t(COPY.plain)} (text/plain)`}>
        {copied.plain
          ? <p className="text-sm">{copied.plain}</p>
          : <p className="text-sm text-muted-foreground">{ctx.t(COPY.leftToField)}</p>}
      </Field>
      <Field label={`${ctx.t(COPY.context)} (${NOTIS_CONTEXT_CLIPBOARD_TYPE})`}>
        {copied.context
          ? <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-5">{readablePayload(copied.context, ctx.t(COPY.freshId))}</pre>
          : <p className="text-sm text-muted-foreground">{ctx.t(COPY.none)}</p>}
      </Field>
    </section>
  );
}

function Page({ ctx, resource = true, input = false, note }: { ctx: Ctx; resource?: boolean; input?: boolean; note?: Words }) {
  const task = taskRows(ctx.lang)[1]!;
  const { copied, onCopy } = useCopyProbe();
  return (
    <div className="flex max-w-2xl flex-col gap-4" onCopy={onCopy}>
      <NotisSelectionBoundary resource={resource ? resourceFor(ctx) : null} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{task.title}</h2>
        <p className="text-sm leading-6" data-ds-quote-source="" data-ds-quote={ctx.t(COPY.quote)}>{ctx.t(COPY.intro)}</p>
        {input ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {ctx.t(COPY.draftLabel)}
            <textarea
              className="min-h-16 rounded-md bg-muted/60 px-3 py-2 text-sm text-foreground outline-none"
              defaultValue={ctx.t(COPY.draft)}
              data-ds-draft=""
            />
          </label>
        ) : null}
      </NotisSelectionBoundary>
      <CopyPanel ctx={ctx} copied={copied} />
      {note ? <Note>{ctx.t(note)}</Note> : null}
    </div>
  );
}

/** Selects the quote in the page and copies it, as a reader pressing Cmd C. */
async function copyQuote(root: HTMLElement): Promise<void> {
  await settle();
  const source = await waitFor(layerScope(root), '[data-ds-quote-source]');
  selectText(source, source.dataset.dsQuote ?? '');
  copyFrom(source);
  await waitFor(layerScope(root), '[data-ds-copied]');
  await settle();
}

export const specimen = defineSpecimen({
  id: 'notis-selection-boundary',
  name: 'NotisSelectionBoundary',
  group: 'interactions',
  from: '@notis/sdk',
  covers: ['NotisSelectionBoundary'],
  summary: 'Adds where copied words came from, so pasting them in the Notis chat shows a quote of the record.',
  states: [
    {
      id: 'idle',
      label: 'Page before a copy',
      render: (ctx) => <Page ctx={ctx} note={COPY.idle} />,
    },
    {
      id: 'copied',
      label: 'Words copied',
      height: 520,
      render: (ctx) => <Page ctx={ctx} />,
      interact: copyQuote,
    },
    {
      id: 'no-resource',
      label: 'Copied without a resource',
      height: 460,
      render: (ctx) => <Page ctx={ctx} resource={false} note={COPY.noResource} />,
      interact: copyQuote,
    },
    {
      id: 'in-a-field',
      label: 'Copied inside a text field',
      height: 460,
      render: (ctx) => <Page ctx={ctx} input note={COPY.inputNote} />,
      interact: async (root) => {
        await settle();
        const draft = await waitFor<HTMLTextAreaElement>(layerScope(root), '[data-ds-draft]');
        draft.focus({ preventScroll: true });
        draft.setSelectionRange(0, draft.value.length);
        copyFrom(draft);
        await waitFor(layerScope(root), '[data-ds-copied]');
        await settle();
      },
    },
    {
      id: 'dark',
      label: 'Dark',
      theme: 'dark',
      height: 520,
      render: (ctx) => <Page ctx={ctx} />,
      interact: copyQuote,
    },
  ],
});
