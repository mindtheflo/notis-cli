import * as React from 'react';
import type { ReactNode } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { MultiSelectActionBar, type MultiSelectAction } from '../../../src';
import { Icon } from '../../../src/ui';
import { STANDARD_ACTIONS, w, type Words } from '../../../src/words';
import { keyboardFocus, layerScope, settle, waitFor } from '../../fixtures/interactions/interact';
import { bulkActions, INLINE_BAR_STYLE, LiveTaskList, Note, SELECTION_COPY } from '../../fixtures/interactions/selection';

type Ctx = SpecimenRenderContext;

const COPY = {
  localizedSelection: w('2 tasks selected', '2 tâches sélectionnées'),
  localizedToolbar: w('Actions for 2 selected tasks', 'Actions pour 2 tâches sélectionnées'),
  floating: w(
    'Three tasks are ticked, so the bar floats at the bottom centre of the view. Run an action, press its key or press Escape to clear.',
    'Trois tâches sont cochées : la barre flotte en bas au centre de la vue. Lance une action, appuie sur sa touche ou sur Échap pour tout effacer.',
  ),
  one: w('One task, with the item word', 'Une tâche, avec le nom des éléments'),
  three: w('Three, without an item word', 'Trois, sans nom des éléments'),
  eight: w('Every task of the list', 'Toutes les tâches de la liste'),
  withKeys: w('With keys: the keycap replaces the icon', 'Avec touches : la touche remplace l’icône'),
  withoutKeys: w('Without keys (touch screens): the icon shows', 'Sans touches (écrans tactiles) : l’icône s’affiche'),
  pending: w('Archiving is running', 'L’archivage est en cours'),
  disabled: w('Moving is not allowed for done tasks', 'Le déplacement est interdit pour les tâches terminées'),
  destructive: w('Delete is the destructive action', 'Supprimer est l’action destructrice'),
  focus: w(
    'Tab moves through the actions; the focused one takes the hover tint.',
    'Tab parcourt les actions ; celle qui a le focus prend la teinte du survol.',
  ),
  reschedule: w('Move to next week', 'Reporter à la semaine prochaine'),
  assignTeam: w('Assign to someone else', 'Attribuer à une autre personne'),
  longNote: w(
    'French labels run longer: the list scrolls sideways instead of growing past the view.',
    'Les libellés français sont plus longs : la liste défile sur le côté au lieu de dépasser la vue.',
  ),
  narrow: w(
    'On a phone the count takes its own line and the actions grow to 48 px touch targets.',
    'Sur téléphone, le compteur passe sur sa propre ligne et les actions grandissent à 48 px pour le toucher.',
  ),
} satisfies Record<string, Words>;

const SELECTED_THREE = ['task-2', 'task-3', 'task-6'];

function itemLabel(t: Ctx['t']) {
  return { singular: t(SELECTION_COPY.task), plural: t(SELECTION_COPY.tasks) };
}

/** One labelled example: a caption, then the bar in the page flow instead of its fixed spot. */
function Example({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">{caption}</p>
      {children}
    </div>
  );
}

function Column({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

function InlineBar({ ctx, count, actions, words = true }: { ctx: Ctx; count: number; actions: MultiSelectAction[]; words?: boolean }) {
  return (
    <MultiSelectActionBar
      selectedCount={count}
      actions={actions}
      itemLabel={words ? itemLabel(ctx.t) : undefined}
      shortcutsEnabled={false}
      style={INLINE_BAR_STYLE}
    />
  );
}

/** Long, real labels: catalogue words where they exist, Space words where they do not. */
function longActions(t: Ctx['t']): MultiSelectAction[] {
  const triage = STANDARD_ACTIONS.unarchive;
  return [
    { id: 'reschedule', label: t(COPY.reschedule), icon: <Icon name="clock" />, shortcut: 'h', onRun: () => undefined },
    { id: 'assign', label: t(COPY.assignTeam), icon: <Icon name="user-plus" />, shortcut: 'a', onRun: () => undefined },
    { id: 'unarchive', label: t(triage.label), icon: <Icon name={triage.icon} />, shortcut: triage.key ?? undefined, onRun: () => undefined },
    ...bulkActions(t, ['delete']),
  ];
}

export const specimen = defineSpecimen({
  id: 'multi-select-action-bar',
  name: 'MultiSelectActionBar',
  group: 'interactions',
  from: '@notis/sdk',
  covers: ['MultiSelectActionBar'],
  summary: 'The floating bar of bulk actions that appears while rows of a list are selected.',
  states: [
    {
      id: 'localized-labels',
      label: 'Complete translated count and toolbar name',
      render: (ctx) => <MultiSelectActionBar selectedCount={2}
        actions={bulkActions(ctx.t, ['complete', 'delete'])}
        selectionLabel={ctx.t(COPY.localizedSelection)}
        toolbarLabel={ctx.t(COPY.localizedToolbar)}
        shortcutsEnabled={false} style={INLINE_BAR_STYLE} />,
    },
    {
      id: 'floating',
      label: 'Floating over a list',
      height: 480,
      render: (ctx) => (
        <div>
          <LiveTaskList ctx={ctx} defaultSelected={SELECTED_THREE} />
          <Note>{ctx.t(COPY.floating)}</Note>
        </div>
      ),
    },
    {
      id: 'counts',
      label: 'One, three and eight selected',
      render: (ctx) => (
        <Column>
          <Example caption={ctx.t(COPY.one)}>
            <InlineBar ctx={ctx} count={1} actions={bulkActions(ctx.t, ['complete', 'later', 'move', 'delete'])} />
          </Example>
          <Example caption={ctx.t(COPY.three)}>
            <InlineBar ctx={ctx} count={3} words={false} actions={bulkActions(ctx.t, ['complete', 'later', 'move', 'delete'])} />
          </Example>
          <Example caption={ctx.t(COPY.eight)}>
            <InlineBar ctx={ctx} count={8} actions={bulkActions(ctx.t, ['complete', 'later', 'move', 'delete'])} />
          </Example>
        </Column>
      ),
    },
    {
      id: 'keys-and-icons',
      label: 'With keys and with icons',
      render: (ctx) => (
        <Column>
          <Example caption={ctx.t(COPY.withKeys)}>
            <InlineBar ctx={ctx} count={2} actions={bulkActions(ctx.t, ['complete', 'star', 'read', 'assign', 'delete'])} />
          </Example>
          <Example caption={ctx.t(COPY.withoutKeys)}>
            <InlineBar ctx={ctx} count={2} actions={bulkActions(ctx.t, ['complete', 'star', 'read', 'assign', 'delete'], { keys: false })} />
          </Example>
        </Column>
      ),
    },
    {
      id: 'pending-disabled-destructive',
      label: 'Pending, disabled and destructive',
      render: (ctx) => (
        <Column>
          <Example caption={ctx.t(COPY.pending)}>
            <InlineBar ctx={ctx} count={4} actions={bulkActions(ctx.t, ['later', 'archive', 'move'], { pending: ['archive'] })} />
          </Example>
          <Example caption={ctx.t(COPY.disabled)}>
            <InlineBar ctx={ctx} count={2} actions={bulkActions(ctx.t, ['unarchive', 'move', 'delete'], { disabled: ['move'] })} />
          </Example>
          <Example caption={ctx.t(COPY.destructive)}>
            <InlineBar ctx={ctx} count={5} actions={bulkActions(ctx.t, ['later', 'delete'])} />
          </Example>
        </Column>
      ),
    },
    {
      id: 'focus',
      label: 'Keyboard focus on an action',
      render: (ctx) => (
        <Column>
          <Example caption={ctx.t(COPY.focus)}>
            <InlineBar ctx={ctx} count={3} actions={bulkActions(ctx.t, ['complete', 'later', 'move', 'delete'])} />
          </Example>
        </Column>
      ),
      interact: async (root) => {
        await settle();
        const bar = await waitFor(layerScope(root), '[data-notis-bulk-actions]');
        const buttons = bar.querySelectorAll<HTMLButtonElement>('button');
        if (buttons[1]) keyboardFocus(buttons[1]);
        await settle();
      },
    },
    {
      id: 'long-labels',
      label: 'Long labels at tablet width',
      width: 768,
      render: (ctx) => (
        <Column>
          <Example caption={ctx.t(COPY.longNote)}>
            <InlineBar ctx={ctx} count={6} actions={longActions(ctx.t)} />
          </Example>
        </Column>
      ),
    },
    {
      id: 'narrow',
      label: 'Phone width',
      width: 390,
      height: 640,
      render: (ctx) => (
        <div>
          <LiveTaskList ctx={ctx} defaultSelected={SELECTED_THREE} count={6} />
          <Note>{ctx.t(COPY.narrow)}</Note>
        </div>
      ),
    },
    {
      id: 'dark',
      label: 'Dark',
      theme: 'dark',
      height: 480,
      render: (ctx) => <LiveTaskList ctx={ctx} defaultSelected={['task-1', 'task-5']} />,
    },
    {
      id: 'empty',
      label: 'Nothing selected',
      height: 360,
      render: (ctx) => (
        <div>
          <LiveTaskList ctx={ctx} count={4} />
          <MultiSelectActionBar selectedCount={0} actions={bulkActions(ctx.t, ['complete', 'delete'])} itemLabel={itemLabel(ctx.t)} />
          <Note>{ctx.t(SELECTION_COPY.nothingSelected)}</Note>
        </div>
      ),
    },
  ],
});
