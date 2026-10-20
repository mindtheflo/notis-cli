import * as React from 'react';
import type { ReactNode } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { ShortcutHints, ShortcutProvider, useShortcuts, type ShortcutDefinition, type ShortcutHint } from '../../../src/interactions';
import { STATUS_WORDS } from '../../../src/ui';
import { DEFAULT_KEYMAP, STANDARD_ACTIONS, w, type KeymapId, type StandardActionId, type Words } from '../../../src/words';
import { layerScope, pressKey, settle, waitFor } from '../../fixtures/interactions/interact';
import { Note, SELECTION_COPY, TaskRow, taskRows, type TaskRowData } from '../../fixtures/interactions/selection';

type Ctx = SpecimenRenderContext;

const COPY = {
  footer: w(
    'The hints under a list name the keys that work there, in the words of the ? sheet.',
    'Les indications sous une liste nomment les touches qui y fonctionnent, avec les mots de la fiche ?.',
  ),
  chords: w(
    'Modifiers show as Mac symbols; a sequence like G then I keeps a space between its keys.',
    'Les touches de modification s’affichent en symboles Mac ; une suite comme G puis I garde une espace entre ses touches.',
  ),
  phone: w(
    'At phone width the hints wrap; with long labels each one takes its own line.',
    'À la largeur d’un téléphone, les indications passent à la ligne ; avec de longs libellés, chacune prend sa propre ligne.',
  ),
  empty: w(
    'With no shortcuts the hints render nothing, so a list without keys has no footer.',
    'Sans raccourci, les indications n’affichent rien : une liste sans touches n’a pas de pied.',
  ),
  helpSheet: w(
    'Pressing ? anywhere outside a text field opens the sheet of every shortcut the page registered; Esc closes it.',
    'Appuyer sur ? hors d’un champ de texte ouvre la fiche de tous les raccourcis de la page ; Échap la ferme.',
  ),
  live: w(
    'Pressed J twice, then E: the third task moved into focus and is now done.',
    'J appuyé deux fois, puis E : la troisième tâche a reçu le focus et est maintenant terminée.',
  ),
  surface: w('Task list, keyboard ready', 'Liste des tâches, prête pour le clavier'),
} satisfies Record<string, Words>;

/** A hint from the default key map: its first key, its words in the page language. */
function keymapHint(t: Ctx['t'], id: KeymapId): ShortcutHint {
  const entry = DEFAULT_KEYMAP[id];
  return { id, keys: entry.keys[0]!, label: t(entry.label) };
}

/** A hint from the action catalogue. */
function actionHint(t: Ctx['t'], id: StandardActionId): ShortcutHint {
  const action = STANDARD_ACTIONS[id];
  return { id, keys: action.key ?? '', label: t(action.label) };
}

function listHints(t: Ctx['t']): ShortcutHint[] {
  return [
    keymapHint(t, 'list.next'),
    keymapHint(t, 'list.prev'),
    keymapHint(t, 'list.toggleSelect'),
    actionHint(t, 'complete'),
    actionHint(t, 'later'),
    keymapHint(t, 'host.help'),
  ];
}

function chordHints(t: Ctx['t']): ShortcutHint[] {
  return [
    keymapHint(t, 'list.selectAll'),
    keymapHint(t, 'list.extendDown'),
    actionHint(t, 'unarchive'),
    keymapHint(t, 'host.modelMenu'),
    keymapHint(t, 'host.commandMenu'),
    keymapHint(t, 'host.goInbox'),
    keymapHint(t, 'host.escape'),
  ];
}

function longHints(t: Ctx['t']): ShortcutHint[] {
  return [
    keymapHint(t, 'list.extendDown'),
    keymapHint(t, 'host.toggleSidebar'),
    keymapHint(t, 'host.toggleVoiceCall'),
    actionHint(t, 'unarchive'),
    keymapHint(t, 'host.help'),
  ];
}

function TaskList({ ctx, count = 4, activeIndex, rows, footer }: { ctx: Ctx; count?: number; activeIndex?: number; rows?: TaskRowData[]; footer?: ReactNode }) {
  const tasks = rows ?? taskRows(ctx.lang).slice(0, count);
  return (
    <section className="flex max-w-3xl flex-col gap-1">
      <h3 className="px-2 pb-1 text-sm font-semibold">{ctx.t(SELECTION_COPY.tasksHeading)}</h3>
      <div className="flex flex-col gap-px">
        {tasks.map((task, index) => <TaskRow key={task.id} task={task} active={index === activeIndex} />)}
      </div>
      {footer ? <div className="px-2 pt-3">{footer}</div> : null}
    </section>
  );
}

/**
 * A list that registers its keys with the legacy provider: J and K move the focus ring, E completes, Z undoes.
 * The hints under it come from the same definitions, so the footer and the ? sheet never disagree.
 */
function KeyedList({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const [tasks, setTasks] = React.useState(() => taskRows(ctx.lang).slice(0, 5));
  const [active, setActive] = React.useState(0);
  const history = React.useRef<TaskRowData[][]>([]);
  const step = (by: number) => setActive((index) => Math.min(tasks.length - 1, Math.max(0, index + by)));
  const complete = () => {
    history.current.push(tasks);
    setTasks((rows) => rows.map((row, index) => (index === active ? { ...row, status: 'done', statusLabel: STATUS_WORDS.done } : row)));
  };
  const later = () => step(1);
  const undo = () => {
    const previous = history.current.pop();
    if (previous) setTasks(previous);
  };
  const label = (id: KeymapId) => t(DEFAULT_KEYMAP[id].label);
  const collection: ShortcutDefinition[] = [
    { id: 'list.next', keys: ['j', 'arrowdown'], label: label('list.next'), allowRepeat: true, onTrigger: () => step(1) },
    { id: 'list.prev', keys: ['k', 'arrowup'], label: label('list.prev'), allowRepeat: true, onTrigger: () => step(-1) },
    { id: 'complete', keys: 'e', label: t(STANDARD_ACTIONS.complete.label), onTrigger: complete },
    { id: 'later', keys: 'h', label: t(STANDARD_ACTIONS.later.label), onTrigger: later },
  ];
  const route: ShortcutDefinition[] = [
    { id: 'undo', keys: ['z', 'mod+z'], label: label('undo'), onTrigger: undo },
  ];
  useShortcuts(collection, { scope: 'collection' });
  useShortcuts(route, { scope: 'route' });
  const hints: ShortcutHint[] = [...collection, ...route].map((def) => ({
    id: def.id,
    keys: Array.isArray(def.keys) ? def.keys[0]! : def.keys,
    label: def.label ?? def.id,
  }));
  hints.push(keymapHint(t, 'host.help'));
  return (
    <div tabIndex={0} aria-label={t(COPY.surface)} data-ds-keys-surface="" className="rounded-lg outline-none">
      <TaskList ctx={ctx} rows={tasks} activeIndex={active} footer={<ShortcutHints shortcuts={hints} />} />
    </div>
  );
}

/** The legacy provider around the list. The book's keyboard engine is told to leave this area alone. */
function KeyedPage({ ctx, note }: { ctx: Ctx; note: Words }) {
  return (
    <div data-notis-keys="off">
      <ShortcutProvider>
        <KeyedList ctx={ctx} />
      </ShortcutProvider>
      <Note>{ctx.t(note)}</Note>
    </div>
  );
}

async function focusSurface(root: HTMLElement): Promise<HTMLElement> {
  await settle();
  const surface = await waitFor(layerScope(root), '[data-ds-keys-surface]');
  surface.focus({ preventScroll: true });
  await settle(1);
  return surface;
}

/** The help sheet renders where the provider sits; look in the shadow root first, then in the document. */
async function waitForHelp(root: HTMLElement): Promise<void> {
  const scope = layerScope(root);
  for (let i = 0; i < 120; i += 1) {
    if (scope.querySelector('[data-notis-shortcut-help]') || root.ownerDocument.querySelector('[data-notis-shortcut-help]')) return;
    await settle(1);
  }
  throw new Error('The ? sheet did not open.');
}

export const specimen = defineSpecimen({
  id: 'shortcut-hints',
  name: 'ShortcutHints',
  group: 'interactions',
  from: '@notis/sdk/interactions',
  covers: ['ShortcutHints', 'ShortcutProvider'],
  summary: 'A quiet line of keycaps that names the keyboard shortcuts of a view, and the provider behind the ? sheet.',
  states: [
    {
      id: 'footer',
      label: 'Under a list',
      render: (ctx) => (
        <div>
          <TaskList ctx={ctx} activeIndex={1} footer={<ShortcutHints shortcuts={listHints(ctx.t)} />} />
          <Note>{ctx.t(COPY.footer)}</Note>
        </div>
      ),
    },
    {
      id: 'chords',
      label: 'Modifiers and sequences',
      render: (ctx) => (
        <div className="flex flex-col gap-3">
          <ShortcutHints shortcuts={chordHints(ctx.t)} />
          <Note>{ctx.t(COPY.chords)}</Note>
        </div>
      ),
    },
    {
      id: 'phone',
      label: 'Phone width, long labels',
      width: 390,
      render: (ctx) => (
        <div className="flex flex-col gap-3">
          <ShortcutHints shortcuts={longHints(ctx.t)} />
          <Note>{ctx.t(COPY.phone)}</Note>
        </div>
      ),
    },
    {
      id: 'empty',
      label: 'No shortcuts',
      render: (ctx) => (
        <div>
          <TaskList ctx={ctx} count={3} footer={<ShortcutHints shortcuts={[]} />} />
          <Note>{ctx.t(COPY.empty)}</Note>
        </div>
      ),
    },
    {
      id: 'help-sheet',
      label: 'The ? sheet of the provider',
      height: 640,
      render: (ctx) => <KeyedPage ctx={ctx} note={COPY.helpSheet} />,
      interact: async (root) => {
        const surface = await focusSurface(root);
        pressKey(surface, '?', { shiftKey: true, code: 'Slash' });
        await waitForHelp(root);
        await settle();
      },
    },
    {
      id: 'keys-at-work',
      label: 'Keys at work',
      height: 420,
      render: (ctx) => <KeyedPage ctx={ctx} note={COPY.live} />,
      interact: async (root) => {
        const surface = await focusSurface(root);
        for (const key of ['j', 'j', 'e']) {
          pressKey(surface, key, { code: `Key${key.toUpperCase()}` });
          await settle(1);
        }
        await settle();
      },
    },
    {
      id: 'dark',
      label: 'Dark',
      theme: 'dark',
      height: 640,
      render: (ctx) => <KeyedPage ctx={ctx} note={COPY.helpSheet} />,
      interact: async (root) => {
        const surface = await focusSurface(root);
        pressKey(surface, '?', { shiftKey: true, code: 'Slash' });
        await waitForHelp(root);
        await settle();
      },
    },
  ],
});
