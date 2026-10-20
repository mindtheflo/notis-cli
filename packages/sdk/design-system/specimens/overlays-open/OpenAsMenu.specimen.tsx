import * as React from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenRenderContext } from '../../specimen';
import {
  Icon, OPEN_MODE_CACHE_PREFIX, OPEN_MODE_WORDS, OpenAsMenu, OpenModeStoreProvider, STATUS_WORDS, useOpenMode,
  writeOpenModeCache, type OpenMode, type OpenModeStore,
} from '../../../src/ui';
import { SHELL_WORDS, labelValue } from '../../../src/words';
import {
  NB_418, OPEN_MODE_KEYS, OVERLAY_COPY, RELEASE_2_14, RELEASES_LIST, SPACE_NAME, TICKETS_LIST,
} from '../../fixtures/overlays-open/tickets';
import { layerScope, pointerClick, settle, waitFor } from '../../fixtures/overlays-open/interact';

type Ctx = SpecimenRenderContext;

interface Item {
  id: string;
  title: SpecimenCopy;
}

const COPY = {
  oneModeNote: {
    en: 'This list only opens items in a side peek, so the Open as button is hidden.',
    fr: 'Cette liste n’ouvre les éléments qu’en aperçu latéral : le bouton « Ouvrir en » est masqué.',
  },
  storedNote: {
    en: 'Each list keeps its own mode in user settings: Tickets opens in a center peek, Releases in a full page.',
    fr: 'Chaque liste garde son mode dans les réglages : Tickets s’ouvre en aperçu centré, Versions en pleine page.',
  },
  pendingNote: {
    en: 'User settings have not answered yet, and this browser has nothing saved: the list default shows meanwhile.',
    fr: 'Les réglages n’ont pas encore répondu et ce navigateur n’a rien enregistré : l’ouverture par défaut s’affiche en attendant.',
  },
  failedNote: {
    en: 'User settings could not be read: the mode this browser saved last time stands.',
    fr: 'Impossible de lire les réglages : le mode enregistré par ce navigateur la dernière fois reste en place.',
  },
  showing: { en: 'Opens in', fr: 'S’ouvre en' },
} satisfies Record<string, SpecimenCopy>;

/** The reader of an item, as ListReader draws it: Close, Open as, the item, then Previous and Next. */
function Reader({ ctx, item, list, allowed, mode, onChange, children }: {
  ctx: Ctx;
  item: Item;
  list: SpecimenCopy;
  allowed?: OpenMode | readonly OpenMode[];
  mode: OpenMode;
  onChange(mode: OpenMode): void;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2" data-reader={item.id}>
      <p className="m-0 px-2 text-xs text-muted-foreground">{ctx.t(SPACE_NAME)} / {ctx.t(list)}</p>
      <div className="flex min-w-0 flex-col rounded-lg bg-muted">
        <div className="flex h-12 min-w-0 items-center gap-1 px-2">
          <button type="button" className="nui-om-btn" aria-label={ctx.t(SHELL_WORDS.close)}><Icon name="x" /></button>
          <OpenAsMenu allowed={allowed} mode={mode} onChange={onChange} />
          <span className="min-w-0 flex-1 truncate px-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{item.id}</span>{' '}{ctx.t(item.title)}
          </span>
          <button type="button" className="nui-om-btn" aria-label={ctx.t(SHELL_WORDS.previous)}><Icon name="caret-up" /></button>
          <button type="button" className="nui-om-btn" aria-label={ctx.t(SHELL_WORDS.next)}><Icon name="caret-down" /></button>
        </div>
        <div className="flex flex-col gap-1 px-4 pb-4 pt-1">
          <p className="m-0 text-base font-medium">{ctx.t(item.title)}</p>
          <p className="m-0 text-xs text-muted-foreground">
            {item.id === NB_418.id ? `${ctx.t(STATUS_WORDS.active)} · ${ctx.t(NB_418.priority)} · ` : ''}
            {ctx.t(OVERLAY_COPY.updatedToday)}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** The mode a reader opens in, read back from the live state. */
function ModeLine({ ctx, mode }: { ctx: Ctx; mode: OpenMode }) {
  return (
    <p className="m-0 px-2 text-xs" data-open-mode={mode}>
      {labelValue(ctx.t(COPY.showing), ctx.t(OPEN_MODE_WORDS[mode]).toLowerCase(), ctx.lang)}
    </p>
  );
}

function Note({ ctx, copy }: { ctx: Ctx; copy: SpecimenCopy }) {
  return <p className="m-0 max-w-xl text-sm text-muted-foreground">{ctx.t(copy)}</p>;
}

/** OpenAsMenu on its own: the mode lives in this state (the reader passes `mode` and `onChange`). */
function Controlled({ ctx, initial = 'side', allowed, item = NB_418, list = TICKETS_LIST }: {
  ctx: Ctx;
  initial?: OpenMode;
  allowed?: OpenMode | readonly OpenMode[];
  item?: Item;
  list?: SpecimenCopy;
}) {
  const [mode, setMode] = React.useState<OpenMode>(initial);
  return (
    <Reader ctx={ctx} item={item} list={list} allowed={allowed} mode={mode} onChange={setMode}>
      <ModeLine ctx={ctx} mode={mode} />
    </Reader>
  );
}

/** One reader per mode, closed: the button shows the current mode's icon. */
function AllModes({ ctx }: { ctx: Ctx }) {
  const modes: readonly OpenMode[] = ['side', 'center', 'full'];
  return (
    <div className="grid max-w-2xl gap-4 p-6">
      {modes.map((mode) => <Controlled key={mode} ctx={ctx} initial={mode} />)}
    </div>
  );
}

/** A reader whose mode comes from `useOpenMode`, so from the store above it. */
function StoredReader({ ctx, item, list, storageKey }: { ctx: Ctx; item: Item; list: SpecimenCopy; storageKey: string }) {
  const [mode, setMode] = useOpenMode({ storageKey });
  return (
    <Reader ctx={ctx} item={item} list={list} mode={mode} onChange={setMode}>
      <ModeLine ctx={ctx} mode={mode} />
    </Reader>
  );
}

/** A user-settings store held in memory: answers at once, keeps what is picked. */
function memoryStore(seed: Record<string, OpenMode>): OpenModeStore {
  const values = new Map<string, OpenMode>(Object.entries(seed));
  return {
    read: (key) => values.get(key) ?? null,
    write: (key, mode) => { values.set(key, mode); },
  };
}

/** Frames share this browser's storage: each store state sets its own cache key before its reader mounts. */
function clearCache(key: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(OPEN_MODE_CACHE_PREFIX + key);
  } catch {
    // No storage: nothing is cached anyway.
  }
}

function StoredModes({ ctx }: { ctx: Ctx }) {
  const [store] = React.useState(() => memoryStore({ [OPEN_MODE_KEYS.tickets]: 'center', [OPEN_MODE_KEYS.releases]: 'full' }));
  return (
    <div className="grid max-w-2xl gap-4 p-6">
      <Note ctx={ctx} copy={COPY.storedNote} />
      <OpenModeStoreProvider store={store}>
        <StoredReader ctx={ctx} item={NB_418} list={TICKETS_LIST} storageKey={OPEN_MODE_KEYS.tickets} />
        <StoredReader ctx={ctx} item={RELEASE_2_14} list={RELEASES_LIST} storageKey={OPEN_MODE_KEYS.releases} />
      </OpenModeStoreProvider>
    </div>
  );
}

/** Loading: the store's answer never comes, and the cache is empty. */
function PendingStore({ ctx }: { ctx: Ctx }) {
  const [store] = React.useState<OpenModeStore>(() => {
    clearCache(OPEN_MODE_KEYS.pending);
    return { read: () => new Promise<OpenMode | null>(() => {}), write: () => {} };
  });
  return (
    <div className="grid max-w-2xl gap-4 p-6">
      <Note ctx={ctx} copy={COPY.pendingNote} />
      <OpenModeStoreProvider store={store}>
        <StoredReader ctx={ctx} item={NB_418} list={TICKETS_LIST} storageKey={OPEN_MODE_KEYS.pending} />
      </OpenModeStoreProvider>
    </div>
  );
}

/** Error: the store throws, and this browser cached Center peek on an earlier visit. */
function FailedStore({ ctx }: { ctx: Ctx }) {
  const [store] = React.useState<OpenModeStore>(() => {
    writeOpenModeCache(OPEN_MODE_KEYS.failed, 'center');
    return {
      read: () => { throw new Error('User settings are unreachable.'); },
      write: () => Promise.reject(new Error('User settings are unreachable.')),
    };
  });
  return (
    <div className="grid max-w-2xl gap-4 p-6">
      <Note ctx={ctx} copy={COPY.failedNote} />
      <OpenModeStoreProvider store={store}>
        <StoredReader ctx={ctx} item={NB_418} list={TICKETS_LIST} storageKey={OPEN_MODE_KEYS.failed} />
      </OpenModeStoreProvider>
    </div>
  );
}

/** Opens the first reader's Open as menu with a pointer click. */
async function openModes(root: HTMLElement): Promise<void> {
  const button = await waitFor<HTMLElement>(root, '.nui-om-btn[data-mode]');
  await settle(2);
  await pointerClick(button);
  await waitFor(layerScope(root), '.nui-menu');
  await settle(4);
}

export const specimen = defineSpecimen({
  id: 'open-as-menu',
  name: 'OpenAsMenu',
  group: 'overlays-open',
  from: '@notis/sdk/ui',
  covers: ['OpenAsMenu', 'OpenModeStoreProvider'],
  summary: 'The Open as button at the top left of the reader: Side peek, Center peek or Full page, kept per Space and list in user settings.',
  states: [
    {
      id: 'modes',
      label: 'Closed: the button shows the current mode (side, center, full)',
      render: (ctx) => <AllModes ctx={ctx} />,
    },
    {
      id: 'open',
      label: 'Open: the three modes, the current one checked',
      height: 280,
      render: (ctx) => <div className="max-w-2xl p-6"><Controlled ctx={ctx} /></div>,
      interact: openModes,
    },
    {
      id: 'picked',
      label: 'After a pick: Center peek chosen from the menu',
      height: 240,
      render: (ctx) => <div className="max-w-2xl p-6"><Controlled ctx={ctx} /></div>,
      interact: async (root) => {
        await openModes(root);
        const item = [...layerScope(root).querySelectorAll<HTMLElement>('.nui-menu [role^="menuitem"]')][1];
        if (!item) throw new Error('The Center peek item is missing.');
        item.click();
        await waitFor(root, '[data-open-mode="center"]');
        await settle(3);
      },
    },
    {
      id: 'two-modes',
      label: 'A list that allows two modes: only those are offered',
      height: 240,
      render: (ctx) => <div className="max-w-2xl p-6"><Controlled ctx={ctx} allowed={['side', 'full']} /></div>,
      interact: openModes,
    },
    {
      id: 'one-mode',
      label: 'A list that allows one mode: no button',
      render: (ctx) => (
        <div className="grid max-w-2xl gap-4 p-6">
          <Note ctx={ctx} copy={COPY.oneModeNote} />
          <Controlled ctx={ctx} allowed="side" />
        </div>
      ),
    },
    {
      id: 'narrow-open',
      label: 'Narrow screen: the menu opens under the button, inside the screen',
      width: 390,
      height: 300,
      render: (ctx) => <div className="p-4"><Controlled ctx={ctx} initial="full" /></div>,
      interact: openModes,
    },
    {
      id: 'stored-mode',
      label: 'OpenModeStoreProvider: each list reads its own mode from the store',
      render: (ctx) => <StoredModes ctx={ctx} />,
    },
    {
      id: 'store-pending',
      label: 'Loading: the store has not answered, the default mode shows',
      render: (ctx) => <PendingStore ctx={ctx} />,
    },
    {
      id: 'store-failed',
      label: 'Error: the store cannot be read, the mode cached in this browser stands',
      render: (ctx) => <FailedStore ctx={ctx} />,
    },
  ],
});
