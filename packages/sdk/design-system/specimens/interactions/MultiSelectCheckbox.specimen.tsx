import * as React from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { MultiSelectCheckbox, SelectionCheckbox } from '../../../src';
import { w, type Words } from '../../../src/words';
import { keyboardFocus, layerScope, settle, waitFor } from '../../fixtures/interactions/interact';
import { LiveTaskList, Note, TaskRow, selectTaskLabel, taskRows } from '../../fixtures/interactions/selection';

type Ctx = SpecimenRenderContext;

const COPY = {
  notSelected: w('Not selected', 'Non sélectionnée'),
  selected: w('Selected', 'Sélectionnée'),
  disabled: w('Disabled', 'Désactivée'),
  disabledSelected: w('Disabled and selected', 'Désactivée et sélectionnée'),
  alias: w(
    'SelectionCheckbox is the same component under its toolkit name.',
    'SelectionCheckbox est le même composant sous son nom de la boîte à outils.',
  ),
  reveal: w(
    'Unticked boxes stay hidden until the row is hovered or focused; once one row is ticked, every box shows.',
    'Les cases non cochées restent masquées tant que la ligne n’est ni survolée ni sélectionnée au clavier ; dès qu’une ligne est cochée, toutes les cases s’affichent.',
  ),
  live: w(
    'Tick boxes one by one, or use the header box to select every task.',
    'Coche les cases une par une, ou utilise la case d’en-tête pour sélectionner toutes les tâches.',
  ),
} satisfies Record<string, Words>;

type Variant = { id: string; caption: Words; selected: boolean; disabled?: boolean };

const VARIANTS: Variant[] = [
  { id: 'not-selected', caption: COPY.notSelected, selected: false },
  { id: 'selected', caption: COPY.selected, selected: true },
  { id: 'disabled', caption: COPY.disabled, selected: false, disabled: true },
  { id: 'disabled-selected', caption: COPY.disabledSelected, selected: true, disabled: true },
];

/** Each checkbox state on a real task row, its name beside it. */
function StateRows({ ctx }: { ctx: Ctx }) {
  const tasks = taskRows(ctx.lang);
  return (
    <div className="grid items-center gap-x-6 gap-y-1" style={{ gridTemplateColumns: 'minmax(9rem, max-content) minmax(0, 28rem)' }}>
      {VARIANTS.map((variant, index) => {
        const task = tasks[index]!;
        return (
          <React.Fragment key={variant.id}>
            <span className="text-xs text-muted-foreground">{ctx.t(variant.caption)}</span>
            <TaskRow
              task={task}
              selected={variant.selected}
              checkbox={(
                <MultiSelectCheckbox
                  alwaysVisible
                  isSelected={variant.selected}
                  disabled={variant.disabled}
                  ariaLabel={selectTaskLabel(ctx.t, task.title)}
                  onClick={() => undefined}
                />
              )}
            />
          </React.Fragment>
        );
      })}
      <span className="text-xs text-muted-foreground">SelectionCheckbox</span>
      <div className="flex items-center gap-3 px-2 text-xs text-muted-foreground">
        <SelectionCheckbox alwaysVisible isSelected ariaLabel={selectTaskLabel(ctx.t, tasks[4]!.title)} onClick={() => undefined} />
        <span>{ctx.t(COPY.alias)}</span>
      </div>
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'multi-select-checkbox',
  name: 'MultiSelectCheckbox',
  group: 'interactions',
  from: '@notis/sdk',
  covers: ['MultiSelectCheckbox', 'SelectionCheckbox'],
  summary: 'The small checkbox that ticks one row of a list into the current selection.',
  states: [
    {
      id: 'states',
      label: 'Not selected, selected and disabled',
      render: (ctx) => <StateRows ctx={ctx} />,
    },
    {
      id: 'hover-reveal',
      label: 'Revealed on hover or focus',
      height: 420,
      render: (ctx) => (
        <div>
          <LiveTaskList ctx={ctx} reveal bar={false} count={5} />
          <Note>{ctx.t(COPY.reveal)}</Note>
        </div>
      ),
      interact: async (root) => {
        await settle();
        const box = await waitFor(layerScope(root), '[data-ds-row="task-2"] [data-notis-multiselect-checkbox]');
        keyboardFocus(box);
        await settle();
      },
    },
    {
      id: 'live-list',
      label: 'Ticking rows and selecting all',
      height: 520,
      render: (ctx) => (
        <div>
          <LiveTaskList ctx={ctx} selectAllRow defaultSelected={['task-1', 'task-4']} />
          <Note>{ctx.t(COPY.live)}</Note>
        </div>
      ),
    },
    {
      id: 'keyboard-focus',
      label: 'Keyboard focus',
      render: (ctx) => <StateRows ctx={ctx} />,
      interact: async (root) => {
        await settle();
        const box = await waitFor(layerScope(root), '[data-notis-multiselect-checkbox][data-selected="true"]:not([disabled])');
        keyboardFocus(box);
        await settle();
      },
    },
    {
      id: 'dark',
      label: 'Dark',
      theme: 'dark',
      render: (ctx) => <StateRows ctx={ctx} />,
    },
  ],
});
