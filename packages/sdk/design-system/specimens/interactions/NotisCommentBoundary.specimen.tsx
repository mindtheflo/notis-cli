import * as React from 'react';
import type { ReactNode } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { NotisCommentBoundary, NotisCommentBox, type ContextResource } from '../../../src';
import { w, type Words } from '../../../src/words';
import { LONG_TEXT } from '../../fixtures/copy';
import { layerScope, mouseUp, selectText, settle, typeInto, waitFor } from '../../fixtures/interactions/interact';
import { taskRows } from '../../fixtures/interactions/selection';

type Ctx = SpecimenRenderContext;

const COPY = {
  intro: w(
    'The launch email goes out on Tuesday 16 June at 9:00 to everyone on the waiting list. Keep it short: what Notis Spaces are, one screenshot and a single button to try them.',
    'L’e-mail de lancement part le mardi 16 juin à 9 h à toutes les personnes de la liste d’attente. Il doit rester court : ce que sont les Spaces Notis, une capture d’écran et un seul bouton pour les essayer.',
  ),
  quote: w('a single button to try them', 'un seul bouton pour les essayer'),
  follow: w(
    'Camille reviews the French version before Monday evening. The subject line is still open.',
    'Camille relit la version française avant lundi soir. L’objet du message n’est pas encore choisi.',
  ),
  comment: w(
    'Can we add the pricing link under the button?',
    'Tu peux ajouter le lien vers les tarifs sous le bouton ?',
  ),
  idle: w(
    'Select any words of the page to comment on them in the chat.',
    'Sélectionne des mots de la page pour les commenter dans le chat.',
  ),
  hostError: w(
    'The book has no chat, so adding the comment fails the way it does in a host without one.',
    'Le livre n’a pas de chat : l’ajout du commentaire échoue comme dans un hôte qui n’en a pas.',
  ),
  boxError: w(
    'Could not add this comment to the chat. Try again.',
    'Impossible d’ajouter ce commentaire au chat. Réessaie.',
  ),
} satisfies Record<string, Words>;

function resourceFor(ctx: Ctx): ContextResource {
  const task = taskRows(ctx.lang)[0]!;
  return { id: 'tasks:task-1', kind: 'record', label: task.title };
}

/** A task page with notes, the text a reader comments on. */
function TaskPage({ ctx }: { ctx: Ctx }) {
  const task = taskRows(ctx.lang)[0]!;
  return (
    <article className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{task.title}</h2>
      <p className="text-sm leading-6" data-ds-quote-source="" data-ds-quote={ctx.t(COPY.quote)} data-ds-comment={ctx.t(COPY.comment)}>
        {ctx.t(COPY.intro)}
      </p>
      <p className="text-sm leading-6">{ctx.t(COPY.follow)}</p>
    </article>
  );
}

/** The page, its note on top: the Comment popover opens under the selection and would cover a note below. */
function Page({ ctx, note }: { ctx: Ctx; note?: Words }) {
  return (
    <div className="flex flex-col gap-2">
      {note ? <p className="text-xs text-muted-foreground">{ctx.t(note)}</p> : null}
      <NotisCommentBoundary resource={resourceFor(ctx)} className="flex max-w-xl flex-col">
        <TaskPage ctx={ctx} />
      </NotisCommentBoundary>
    </div>
  );
}

/** Selects the quote in the page and lifts the mouse, which shows the Comment action. */
async function showAction(root: HTMLElement): Promise<HTMLElement> {
  await settle();
  const scope = layerScope(root);
  const source = await waitFor(scope, '[data-ds-quote-source]');
  selectText(source, source.dataset.dsQuote ?? '');
  mouseUp(source);
  await settle();
  return source;
}

async function openEditor(root: HTMLElement): Promise<HTMLElement> {
  const source = await showAction(root);
  const scope = layerScope(root);
  const action = await waitFor<HTMLButtonElement>(scope, '[data-notis-comment-ui] > button');
  action.click();
  await waitFor(scope, '[data-notis-comment-ui] textarea');
  await settle();
  return source;
}

async function typeComment(root: HTMLElement): Promise<void> {
  const source = await openEditor(root);
  const textarea = await waitFor<HTMLTextAreaElement>(layerScope(root), '[data-notis-comment-ui] textarea');
  typeInto(textarea, source.dataset.dsComment ?? '');
  await settle();
}

/** The standalone box, with its own state, at the width the boundary gives it. */
function Box({ ctx, quote, initial = '', pending, error }: { ctx: Ctx; quote?: string; initial?: string; pending?: boolean; error?: string }) {
  const [value, setValue] = React.useState(initial);
  return (
    <Frame>
      <NotisCommentBox
        quote={quote}
        value={value}
        onChange={setValue}
        onSubmit={() => undefined}
        onCancel={() => setValue('')}
        pending={pending}
        error={error}
      />
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div>
      <div style={{ width: 'min(20rem, calc(100vw - 1rem))' }}>{children}</div>
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'notis-comment-boundary',
  name: 'NotisCommentBoundary',
  group: 'interactions',
  from: '@notis/sdk',
  covers: ['NotisCommentBoundary', 'NotisCommentBox'],
  summary: 'Lets a reader select words on a Space page and send them with a comment to the Notis chat.',
  states: [
    {
      id: 'idle',
      label: 'Page with nothing selected',
      render: (ctx) => <Page ctx={ctx} note={COPY.idle} />,
    },
    {
      id: 'action',
      label: 'Words selected: the Comment action',
      height: 320,
      render: (ctx) => <Page ctx={ctx} />,
      interact: async (root) => { await showAction(root); },
    },
    {
      id: 'editor',
      label: 'Writing a comment',
      height: 440,
      render: (ctx) => <Page ctx={ctx} />,
      interact: typeComment,
    },
    {
      id: 'error',
      label: 'The chat could not take it',
      height: 480,
      render: (ctx) => <Page ctx={ctx} note={COPY.hostError} />,
      interact: async (root) => {
        await typeComment(root);
        const scope = layerScope(root);
        const buttons = (await waitFor(scope, '[data-notis-comment-ui] [role="dialog"]')).querySelectorAll<HTMLButtonElement>('button');
        buttons[buttons.length - 1]?.click();
        await waitFor(scope, '[data-notis-comment-ui] [role="alert"]');
        await settle();
      },
    },
    {
      id: 'editor-phone',
      label: 'Writing a comment on a phone',
      width: 390,
      height: 560,
      render: (ctx) => <Page ctx={ctx} />,
      interact: typeComment,
    },
    {
      id: 'box-empty',
      label: 'Box: empty',
      height: 200,
      render: (ctx) => <Box ctx={ctx} quote={ctx.t(COPY.quote)} />,
    },
    {
      id: 'box-typed',
      label: 'Box: comment typed',
      height: 200,
      render: (ctx) => <Box ctx={ctx} quote={ctx.t(COPY.quote)} initial={ctx.t(COPY.comment)} />,
    },
    {
      id: 'box-pending',
      label: 'Box: adding',
      height: 200,
      render: (ctx) => <Box ctx={ctx} quote={ctx.t(COPY.quote)} initial={ctx.t(COPY.comment)} pending />,
    },
    {
      id: 'box-error',
      label: 'Box: error',
      height: 240,
      render: (ctx) => <Box ctx={ctx} quote={ctx.t(COPY.quote)} initial={ctx.t(COPY.comment)} error={ctx.t(COPY.boxError)} />,
    },
    {
      id: 'box-long-quote',
      label: 'Box: long quote',
      height: 200,
      render: (ctx) => <Box ctx={ctx} quote={ctx.t(LONG_TEXT)} />,
    },
    {
      id: 'box-no-quote',
      label: 'Box: no quote',
      height: 200,
      render: (ctx) => <Box ctx={ctx} initial={ctx.t(COPY.comment)} />,
    },
    {
      id: 'dark',
      label: 'Dark',
      theme: 'dark',
      height: 440,
      render: (ctx) => <Page ctx={ctx} />,
      interact: typeComment,
    },
  ],
});
