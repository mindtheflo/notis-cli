/**
 * Shared data and pieces for the selection specimens: the fixture tasks as list rows, and bulk actions built from
 * the standard action catalogue so labels, icons and keys match every other Notis surface.
 */
import * as React from 'react';
import type { ReactNode } from 'react';
import {
  MultiSelectActionBar, MultiSelectCheckbox, MultiSelectDragOverlay, useCollectionInteractions, type MultiSelectAction,
} from '../../../src';
import { Icon, STATUS_WORDS, StatusIcon } from '../../../src/ui';
import { SHELL_WORDS, STANDARD_ACTIONS, actionToast, fillWords, selectedCount, type StandardActionId, type Words } from '../../../src/words';
import type { SpecimenLang, SpecimenRenderContext } from '../../specimen';
import { fixtureRecords } from '../records';

export type Ctx = SpecimenRenderContext;

export interface TaskRowData {
  id: string;
  title: string;
  status: 'todo' | 'active' | 'done';
  statusLabel: Words;
  due: string;
}

const STATUS_GROUP: Record<string, TaskRowData['status']> = { 'To do': 'todo', 'In progress': 'active', Done: 'done' };

/** The eight fixture tasks as rows, titled and dated in `lang` (due dates from the fixed clock). */
export function taskRows(lang: SpecimenLang): TaskRowData[] {
  const day = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return fixtureRecords(lang).map((record) => {
    const status = STATUS_GROUP[String(record.properties.Status)] ?? 'todo';
    const due = String(record.properties.Due);
    return {
      id: record.id,
      title: record.title,
      status,
      statusLabel: STATUS_WORDS[status],
      due: day.format(new Date(`${due}T12:00:00Z`)),
    };
  });
}

/** Words of the selection specimens that the components do not own. */
export const SELECTION_COPY = {
  task: { en: 'task', fr: 'tâche' },
  tasks: { en: 'tasks', fr: 'tâches' },
  nothingSelected: {
    en: 'Nothing is selected, so the bar is not shown. Tick a row to bring it back.',
    fr: 'Rien n’est sélectionné, la barre n’est donc pas affichée. Coche une ligne pour la faire réapparaître.',
  },
  tasksHeading: { en: 'Tasks this week', fr: 'Tâches de la semaine' },
} satisfies Record<string, Words>;

export interface BulkActionOptions {
  /** Shows the action's catalogue key as a keycap (the icon then hides). Default true. */
  keys?: boolean;
  pending?: StandardActionId[];
  disabled?: StandardActionId[];
  onRun?: (id: StandardActionId) => void;
}

/** Bulk actions from the catalogue: label in the page language, icon, key and tone. */
export function bulkActions(t: Ctx['t'], ids: StandardActionId[], options: BulkActionOptions = {}): MultiSelectAction[] {
  const { keys = true, pending = [], disabled = [], onRun } = options;
  return ids.map((id) => {
    const action = STANDARD_ACTIONS[id];
    return {
      id,
      label: t(action.label),
      icon: <Icon name={action.icon} />,
      shortcut: keys && action.key ? action.key : undefined,
      destructive: action.tone === 'danger',
      pending: pending.includes(id),
      disabled: disabled.includes(id),
      onRun: () => onRun?.(id),
    };
  });
}

/**
 * Takes the floating bar out of its fixed bottom-center spot so several sit side by side in one state. The
 * component's own styles still apply; only the position changes.
 */
export const INLINE_BAR_STYLE = {
  position: 'relative',
  left: 'auto',
  bottom: 'auto',
  transform: 'none',
  zIndex: 'auto',
  width: 'fit-content',
  maxWidth: '100%',
} as const;

/** Row height of the task lists, in px (inline: the book's Tailwind pass does not scan the fixtures). */
export const ROW_HEIGHT = 36;

/** One task row: checkbox slot, status, title and due day. Selected rows take a full tint, never an edge. */
export function TaskRow({ task, selected, active, checkbox, rowProps }: {
  task: TaskRowData;
  selected?: boolean;
  active?: boolean;
  checkbox?: ReactNode;
  rowProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div
      {...rowProps}
      data-ds-row={task.id}
      data-ds-selected={selected ? 'true' : 'false'}
      className="flex items-center gap-3 rounded-md px-2 text-sm"
      style={{
        height: ROW_HEIGHT,
        background: selected ? 'hsl(var(--primary) / .08)' : undefined,
        boxShadow: active ? 'inset 0 0 0 1px hsl(var(--ring, var(--primary)) / .6)' : undefined,
        ...(rowProps?.style as React.CSSProperties | undefined),
      }}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">{checkbox}</span>
      <StatusIcon status={task.status} label={task.statusLabel} />
      <span className="min-w-0 flex-1 truncate" style={{ textDecoration: task.status === 'done' ? 'line-through' : undefined, opacity: task.status === 'done' ? 0.6 : 1 }}>
        {task.title}
      </span>
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{task.due}</span>
    </div>
  );
}

/** A plain page section with its heading, as a Space page lays out a list. */
export function ListSection({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="flex max-w-3xl flex-col gap-1">
      <h3 className="px-2 pb-1 text-sm font-semibold">{title}</h3>
      {children}
      {footer}
    </section>
  );
}

/** A short note under a state that explains what the component does there (in the page language). */
export function Note({ children }: { children: ReactNode }) {
  return <p className="px-2 pt-2 text-xs text-muted-foreground">{children}</p>;
}

const REVEAL_CSS = `
[data-ds-reveal] [data-notis-multiselect-checkbox][data-selected="false"] { opacity: 0; }
[data-ds-reveal] [data-ds-row]:hover [data-notis-multiselect-checkbox],
[data-ds-reveal] [data-ds-row]:focus-within [data-notis-multiselect-checkbox],
[data-ds-reveal][data-ds-any-selected] [data-notis-multiselect-checkbox] { opacity: 1; }
`;

const SELECT_TASK: Words = { en: 'Select {title}', fr: 'Sélectionner {title}' };

export interface LiveTaskListProps {
  ctx: Ctx;
  defaultSelected?: string[];
  /** Shows the floating bulk action bar while something is selected. Default true. */
  bar?: boolean;
  actionIds?: StandardActionId[];
  /** Hides unselected checkboxes until the row is hovered or focused. Default false. */
  reveal?: boolean;
  /** How many fixture tasks to list. Default all eight. */
  count?: number;
  /** Adds a header row whose checkbox selects or clears every task. Default false. */
  selectAllRow?: boolean;
}

/**
 * A working task list wired with `useCollectionInteractions`: checkboxes, drag to select (the marquee), the floating
 * bar and its actions. Actions change the rows and say what they did with the catalogue's toast words.
 */
export function LiveTaskList({ ctx, defaultSelected = [], bar = true, actionIds = ['complete', 'later', 'move', 'delete'], reveal = false, count = 8, selectAllRow = false }: LiveTaskListProps) {
  const { t, lang } = ctx;
  const [tasks, setTasks] = React.useState(() => taskRows(lang).slice(0, count));
  const [done, setDone] = React.useState<string | null>(null);
  const controller = useCollectionInteractions({
    items: tasks,
    getId: (task) => task.id,
    defaultSelectedIds: defaultSelected,
    actions: actionIds.map((id) => {
      const action = STANDARD_ACTIONS[id];
      return {
        id,
        label: t(action.label),
        icon: <Icon name={action.icon} />,
        shortcut: action.key ?? false,
        destructive: action.tone === 'danger',
        onRun: ({ selectedIds, clearSelection }) => {
          const picked = new Set(selectedIds);
          if (id === 'delete') setTasks((rows) => rows.filter((row) => !picked.has(row.id)));
          if (id === 'complete') {
            setTasks((rows) => rows.map((row) => (picked.has(row.id) ? { ...row, status: 'done', statusLabel: STATUS_WORDS.done } : row)));
          }
          const toast = actionToast(id, selectedIds.length);
          setDone(toast ? t(toast) : null);
          clearSelection();
        },
      };
    }),
  });
  const container = controller.getContainerProps();
  return (
    <section
      className="flex max-w-3xl flex-col gap-1"
      data-ds-reveal={reveal ? '' : undefined}
      data-ds-any-selected={controller.selectedCount > 0 ? '' : undefined}
    >
      {reveal ? <style>{REVEAL_CSS}</style> : null}
      <h3 className="px-2 pb-1 text-sm font-semibold">{t(SELECTION_COPY.tasksHeading)}</h3>
      {selectAllRow ? (
        <div className="flex h-8 items-center gap-3 px-2 text-xs text-muted-foreground">
          <span className="flex w-4 shrink-0 items-center justify-center">
            <MultiSelectCheckbox
              alwaysVisible
              isSelected={tasks.length > 0 && controller.selectedCount === tasks.length}
              ariaLabel={t(SHELL_WORDS.selectAll)}
              onClick={() => (controller.selectedCount === tasks.length ? controller.clear() : controller.selectAll())}
            />
          </span>
          <span>{controller.selectedCount > 0 ? t(selectedCount(controller.selectedCount)) : t(SHELL_WORDS.selectAll)}</span>
        </div>
      ) : null}
      <div {...container} data-ds-list="" className="flex flex-col gap-px px-4 py-2" style={{ ...container.style, margin: '0 -1rem' }}>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={controller.isSelected(task.id)}
            active={controller.activeId === task.id && controller.selectedCount === 0}
            rowProps={controller.getItemProps(task.id) as React.HTMLAttributes<HTMLDivElement>}
            checkbox={<MultiSelectCheckbox {...controller.getCheckboxProps(task.id)} ariaLabel={t(fillWords(SELECT_TASK, { title: task.title }))} />}
          />
        ))}
      </div>
      {done ? <Note>{done}</Note> : null}
      <MultiSelectDragOverlay rect={controller.dragRect} />
      {bar ? (
        <MultiSelectActionBar
          {...controller.getActionBarProps()}
          itemLabel={{ singular: t(SELECTION_COPY.task), plural: t(SELECTION_COPY.tasks) }}
        />
      ) : null}
    </section>
  );
}

/** "Select {title}", the checkbox label of one task in the page language. */
export function selectTaskLabel(t: Ctx['t'], title: string): string {
  return t(fillWords(SELECT_TASK, { title }));
}
