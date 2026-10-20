import * as React from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { MultiSelectCheckbox, MultiSelectDragOverlay, SelectionMarquee, type MultiSelectDragOverlayProps } from '../../../src';
import { w, type Words } from '../../../src/words';
import { layerScope, mouseDownAt, mouseMoveTo, settle, waitFor } from '../../fixtures/interactions/interact';
import { LiveTaskList, Note, ROW_HEIGHT, SELECTION_COPY, TaskRow, selectTaskLabel, taskRows } from '../../fixtures/interactions/selection';

type Ctx = SpecimenRenderContext;

const COPY = {
  over: w(
    'Dragging from the empty space beside the list draws the marquee; every row it touches joins the selection.',
    'Glisser depuis l’espace vide à côté de la liste trace le cadre de sélection ; chaque ligne qu’il touche rejoint la sélection.',
  ),
  starting: w(
    'The marquee shows once the pointer has moved 5 px; nothing is selected yet.',
    'Le cadre apparaît dès que le pointeur s’est déplacé de 5 px ; rien n’est encore sélectionné.',
  ),
  live: w(
    'A real drag over this list, held before the button comes up.',
    'Un vrai glissement sur cette liste, maintenu avant que le bouton ne soit relâché.',
  ),
  none: w(
    'Without a drag the marquee renders nothing.',
    'Sans glissement, le cadre de sélection n’affiche rien.',
  ),
} satisfies Record<string, Words>;

/** Row geometry of the static list: rows ROW_HEIGHT px tall, 1 px apart, under 8 px of padding. */
const ROW_TOP = (index: number) => 8 + index * (ROW_HEIGHT + 1);

/** A marquee drawn in the list's own coordinates so a static state needs no measuring. */
function placed(rect: NonNullable<MultiSelectDragOverlayProps['rect']>) {
  return { rect, style: { position: 'absolute' as const } };
}

function StaticList({ ctx, selected, children }: { ctx: Ctx; selected: number[]; children: React.ReactNode }) {
  const tasks = taskRows(ctx.lang).slice(0, 6);
  return (
    <section className="flex max-w-3xl flex-col gap-1">
      <h3 className="px-2 pb-1 text-sm font-semibold">{ctx.t(SELECTION_COPY.tasksHeading)}</h3>
      <div className="relative flex flex-col gap-px px-4 py-2" style={{ margin: '0 -1rem', userSelect: 'none' }}>
        {tasks.map((task, index) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={selected.includes(index)}
            checkbox={(
              <MultiSelectCheckbox
                alwaysVisible
                isSelected={selected.includes(index)}
                ariaLabel={selectTaskLabel(ctx.t, task.title)}
                onClick={() => undefined}
              />
            )}
          />
        ))}
        {children}
      </div>
    </section>
  );
}

export const specimen = defineSpecimen({
  id: 'multi-select-drag-overlay',
  name: 'MultiSelectDragOverlay',
  group: 'interactions',
  from: '@notis/sdk',
  covers: ['MultiSelectDragOverlay', 'SelectionMarquee'],
  summary: 'The marquee rectangle drawn while dragging across a list to select several rows at once.',
  states: [
    {
      id: 'over-rows',
      label: 'Over three rows',
      render: (ctx) => (
        <div>
          <StaticList ctx={ctx} selected={[1, 2, 3]}>
            <MultiSelectDragOverlay {...placed({ left: 6, top: ROW_TOP(1) + 7, width: 320, height: 88 })} />
          </StaticList>
          <Note>{ctx.t(COPY.over)}</Note>
        </div>
      ),
    },
    {
      id: 'starting',
      label: 'Just past the drag threshold',
      render: (ctx) => (
        <div>
          <StaticList ctx={ctx} selected={[]}>
            <SelectionMarquee {...placed({ left: 6, top: ROW_TOP(2) - 4, width: 9, height: 7 })} />
          </StaticList>
          <Note>{ctx.t(COPY.starting)}</Note>
        </div>
      ),
    },
    {
      id: 'live-drag',
      label: 'A real drag',
      height: 520,
      render: (ctx) => (
        <div>
          <LiveTaskList ctx={ctx} count={6} />
          <Note>{ctx.t(COPY.live)}</Note>
        </div>
      ),
      interact: async (root) => {
        await settle();
        const list = await waitFor(layerScope(root), '[data-ds-list]');
        const rows = list.querySelectorAll<HTMLElement>('[data-ds-row]');
        const second = rows[1]?.getBoundingClientRect();
        const fourth = rows[3]?.getBoundingClientRect();
        if (!second || !fourth) return;
        const box = list.getBoundingClientRect();
        const start = { x: box.left + 6, y: second.top + 8 };
        const end = { x: box.left + Math.min(360, box.width * 0.6), y: fourth.bottom - 10 };
        mouseDownAt(list, start.x, start.y);
        await settle(1);
        for (const step of [0.25, 0.6, 1]) {
          mouseMoveTo(list.ownerDocument, start.x + (end.x - start.x) * step, start.y + (end.y - start.y) * step);
          await settle(1);
        }
        await settle();
      },
    },
    {
      id: 'dark',
      label: 'Dark',
      theme: 'dark',
      render: (ctx) => (
        <StaticList ctx={ctx} selected={[1, 2, 3]}>
          <MultiSelectDragOverlay {...placed({ left: 6, top: ROW_TOP(1) + 7, width: 320, height: 88 })} />
        </StaticList>
      ),
    },
    {
      id: 'none',
      label: 'No drag',
      render: (ctx) => (
        <div>
          <StaticList ctx={ctx} selected={[]}>
            <MultiSelectDragOverlay rect={null} />
          </StaticList>
          <Note>{ctx.t(COPY.none)}</Note>
        </div>
      ),
    },
  ],
});
