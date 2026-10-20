import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { defineSpecimen, nextFrame, type SpecimenRenderContext } from '../../specimen';
import {
  Button, HelpSheet, Keycap, Notice, ShortcutScope, useEngineCore, useHelpSheet, useRegistryVersion, useShortcuts,
  type ShortcutDef,
} from '../../../src/ui';
import { DEFAULT_KEYMAP, HELP_WORDS, labelValue, w, type Words } from '../../../src/words';
import { OwnEngine, UnattachedEngine, type SpecimenPlatform as Platform } from '../../fixtures/layout-engine/engines';

type Lang = SpecimenRenderContext['lang'];
type T = SpecimenRenderContext['t'];
type KeymapId = keyof typeof DEFAULT_KEYMAP;

const COPY = {
  last: w('Last shortcut', 'Dernier raccourci'),
  none: w('Nothing yet. Click here, then press a key from the list.', 'Rien pour l’instant. Clique ici, puis appuie sur une touche de la liste.'),
  registryIntro: w(
    'What the ? sheet would list right now: the open Space first, then Notis.',
    'Ce que la fiche ? afficherait maintenant : d’abord le Space ouvert, puis Notis.',
  ),
  owner: w('Owner', 'Propriétaire'),
  scope: w('Scope', 'Portée'),
  assign: w('Assign to me', 'M’attribuer'),
  calendarHidden: w(
    'The calendar view stays mounted while hidden. Its period keys go silent and leave the list below.',
    'La vue calendrier reste montée lorsqu’elle est masquée. Ses touches de période se taisent et disparaissent de la liste ci-dessous.',
  ),
  calendarShown: w(
    'The calendar view is showing, so its period keys answer and are listed.',
    'La vue calendrier est affichée : ses touches de période répondent et figurent dans la liste.',
  ),
  showCalendar: w('Show the calendar', 'Afficher le calendrier'),
  clashIntro: w(
    'A Space asked for three keys it may not use. Outside strict mode the engine keeps the first shortcut, ignores the later one and logs why.',
    'Un Space a demandé trois touches qu’il n’a pas le droit d’utiliser. Hors du mode strict, le moteur garde le premier raccourci, ignore le suivant et consigne la raison.',
  ),
  clashStrict: w(
    'In strict mode (development and the design check) the first clash throws NotisKeyClash instead.',
    'En mode strict (développement et contrôle du design), le premier conflit lève NotisKeyClash à la place.',
  ),
  ignored: w('Ignored', 'Ignorés'),
  kept: w('Kept', 'Conservés'),
  searchTickets: w('Search tickets', 'Rechercher dans les tickets'),
  newTicket: w('New ticket', 'Nouveau ticket'),
  jumpNewest: w('Jump to the newest ticket', 'Aller au ticket le plus récent'),
  pageTitle: w('Tickets', 'Tickets'),
} satisfies Record<string, Words>;

/** A default key map entry as a ShortcutDef: its id, keys, scope and words, with a handler. */
function fromKeymap(id: KeymapId, run: (label: Words) => void): ShortcutDef {
  const entry = DEFAULT_KEYMAP[id];
  return {
    id: entry.id, keys: [...entry.keys], scope: entry.scope, label: entry.label, repeat: entry.repeat,
    hidden: entry.hidden, run: () => run(entry.label),
  };
}

const SPACE_KEYS: readonly KeymapId[] = [
  'list.next', 'list.prev', 'list.extendDown', 'list.extendUp', 'list.open', 'list.toggleSelect', 'list.selectAll', 'undo',
];
const CALENDAR_KEYS: readonly KeymapId[] = ['period.prev', 'period.next', 'period.today'];
const HOST_KEYS: readonly KeymapId[] = [
  'host.search', 'host.newChat', 'host.call', 'host.commandMenu', 'host.toggleSidebar', 'host.voiceMessage',
  'host.goInbox', 'host.goStarred',
];

function SpaceKeys({ onRun, extra = [] }: { onRun: (label: Words) => void; extra?: readonly ShortcutDef[] }) {
  useShortcuts([
    ...SPACE_KEYS.map((id) => fromKeymap(id, onRun)),
    { id: 'space:tickets.assign', keys: 'a', scope: 'collection', label: COPY.assign, run: () => onRun(COPY.assign) },
    ...extra,
  ]);
  return null;
}

function CalendarKeys({ onRun }: { onRun: (label: Words) => void }) {
  useShortcuts(CALENDAR_KEYS.map((id) => fromKeymap(id, onRun)));
  return null;
}

function HostKeys({ onRun }: { onRun: (label: Words) => void }) {
  useShortcuts(HOST_KEYS.map((id) => fromKeymap(id, onRun)));
  return null;
}

/** A Tickets Space and a Notis page, each under its own ShortcutScope. */
function PageKeys({ id, onRun }: { id: string; onRun: (label: Words) => void }) {
  return (
    <>
      <ShortcutScope owner={`space-tickets-${id}`} available>
        <SpaceKeys onRun={onRun} />
      </ShortcutScope>
      <ShortcutScope owner={`notis-page-${id}`} kind="host" available>
        <HostKeys onRun={onRun} />
      </ShortcutScope>
    </>
  );
}

/**
 * The live registry as the ? sheet reads it, with each shortcut's owner and scope under its name. One grid for both
 * groups, so the keys line up from one group to the next.
 */
function RegistryList({ lang, t }: { lang: Lang; t: T }) {
  useRegistryVersion();
  const entries = useEngineCore().registry.helpEntries();
  const groups = [
    { group: 'space' as const, title: HELP_WORDS.groupSpace },
    { group: 'notis' as const, title: HELP_WORDS.groupNotis },
  ];
  const meta = (owner: string, scope: string): ReactNode => (
    <>
      {labelValue(t(COPY.owner), '', lang)}
      <code className="font-mono">{owner}</code>
      {' · '}
      {labelValue(t(COPY.scope), '', lang)}
      <code className="font-mono">{scope}</code>
    </>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-x-6 text-[13px]">
      {groups.map(({ group, title }) => {
        const rows = entries.filter((entry) => entry.group === group);
        if (!rows.length) return null;
        return [
          <h3 key={`${group}-title`} className="col-span-2 mb-1 mt-4 text-[13px] font-semibold text-muted-foreground first:mt-0">
            {t(title)}
          </h3>,
          ...rows.map((row) => [
            <div key={`${row.id}-label`} className="min-w-0 py-1">
              <div className="text-foreground">{t(row.label)}</div>
              <div className="break-words text-xs text-muted-foreground">{meta(row.owner, row.scope)}</div>
            </div>,
            <Keycap key={`${row.id}-keys`} keys={row.keys} />,
          ]),
        ];
      })}
    </div>
  );
}

function LastShortcut({ last, lang, t }: { last: Words | null; lang: Lang; t: T }) {
  return (
    <p className="text-sm text-foreground" aria-live="polite">
      {last ? labelValue(t(COPY.last), t(last), lang) : t(COPY.none)}
    </p>
  );
}

/** A page that answers its keys and shows the last one pressed. */
function RegistryPage({ ctx, id, platform = 'mac' }: { ctx: SpecimenRenderContext; id: string; platform?: Platform }) {
  const [last, setLast] = useState<Words | null>(null);
  return (
    <OwnEngine lang={ctx.lang} platform={platform}>
      <PageKeys id={id} onRun={setLast} />
      <div className="grid max-w-2xl gap-4 p-6">
        <p className="text-sm text-muted-foreground">{ctx.t(COPY.registryIntro)}</p>
        <LastShortcut last={last} lang={ctx.lang} t={ctx.t} />
        <RegistryList lang={ctx.lang} t={ctx.t} />
      </div>
    </OwnEngine>
  );
}

/** Opens the ? sheet while mounted, as pressing ? does. */
function OpenHelp() {
  const { open, close } = useHelpSheet();
  useEffect(() => {
    open();
    return () => close();
  }, [open, close]);
  return null;
}

/**
 * The page behind the sheet and the layer the sheet portals into. The layer sits inside the state so the sheet picks
 * up the toolkit styles and theme; the default target is the page body, outside the book frame's shadow root.
 */
function SheetPage({ ctx, children }: { ctx: SpecimenRenderContext; children?: ReactNode }) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  return (
    <div>
      <div className="grid gap-2 p-6">
        <h1 className="text-lg font-semibold text-foreground">{ctx.t(COPY.pageTitle)}</h1>
        {children}
      </div>
      <div ref={setLayer} />
      {layer ? <HelpSheet container={layer} /> : null}
      <OpenHelp />
    </div>
  );
}

function HelpSheetDemo({ ctx, id, platform = 'mac' }: { ctx: SpecimenRenderContext; id: string; platform?: Platform }) {
  const noop = useCallback(() => undefined, []);
  return (
    <OwnEngine lang={ctx.lang} platform={platform}>
      <PageKeys id={id} onRun={noop} />
      <SheetPage ctx={ctx}>
        <p className="text-sm text-muted-foreground">{ctx.t(COPY.registryIntro)}</p>
      </SheetPage>
    </OwnEngine>
  );
}

function SilentScopeDemo({ ctx }: { ctx: SpecimenRenderContext }) {
  const [shown, setShown] = useState(false);
  const [last, setLast] = useState<Words | null>(null);
  return (
    <OwnEngine lang={ctx.lang}>
      <ShortcutScope owner="space-tickets-silent" available>
        <SpaceKeys onRun={setLast} />
        <ShortcutScope owner="space-tickets-silent-calendar" available={shown}>
          <CalendarKeys onRun={setLast} />
        </ShortcutScope>
      </ShortcutScope>
      <div className="grid max-w-2xl gap-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button pressed={shown} onClick={() => setShown(!shown)}>{COPY.showCalendar}</Button>
        </div>
        <p className="text-sm text-muted-foreground">{ctx.t(shown ? COPY.calendarShown : COPY.calendarHidden)}</p>
        <LastShortcut last={last} lang={ctx.lang} t={ctx.t} />
        <RegistryList lang={ctx.lang} t={ctx.t} />
      </div>
    </OwnEngine>
  );
}

function ClashKeys({ onRun }: { onRun: (label: Words) => void }) {
  useShortcuts([
    fromKeymap('list.next', onRun),
    { id: 'space:tickets.search', keys: '/', scope: 'collection', label: COPY.searchTickets, run: () => onRun(COPY.searchTickets) },
    { id: 'space:tickets.new', keys: 'n', scope: 'app', label: COPY.newTicket, run: () => onRun(COPY.newTicket) },
    { id: 'space:tickets.jump', keys: 'j', scope: 'collection', label: COPY.jumpNewest, run: () => onRun(COPY.jumpNewest) },
    fromKeymap('list.open', onRun),
  ]);
  return null;
}

function ClashDemo({ ctx }: { ctx: SpecimenRenderContext }) {
  const [messages, setMessages] = useState<readonly string[]>([]);
  const record = useCallback((message: string) => {
    setMessages((list) => (list.includes(message) ? list : [...list, message]));
  }, []);
  const noop = useCallback(() => undefined, []);
  return (
    <OwnEngine lang={ctx.lang} strict={false} onClash={record}>
      <ShortcutScope owner="space-tickets-clash" available>
        <ClashKeys onRun={noop} />
      </ShortcutScope>
      <div className="grid max-w-2xl gap-4 p-6">
        <p className="text-sm text-foreground">{ctx.t(COPY.clashIntro)}</p>
        <section className="grid gap-2" aria-label={ctx.t(COPY.ignored)}>
          <h3 className="text-[13px] font-semibold text-muted-foreground">{ctx.t(COPY.ignored)}</h3>
          {messages.map((message) => <Notice key={message} tone="danger">{message}</Notice>)}
        </section>
        <p className="text-sm text-muted-foreground">{ctx.t(COPY.clashStrict)}</p>
        <section className="grid gap-2" aria-label={ctx.t(COPY.kept)}>
          <h3 className="text-[13px] font-semibold text-muted-foreground">{ctx.t(COPY.kept)}</h3>
          <RegistryList lang={ctx.lang} t={ctx.t} />
        </section>
      </div>
    </OwnEngine>
  );
}

function EmptySheetDemo({ ctx }: { ctx: SpecimenRenderContext }) {
  return (
    <UnattachedEngine lang={ctx.lang}>
      <SheetPage ctx={ctx} />
    </UnattachedEngine>
  );
}

export const specimen = defineSpecimen({
  id: 'keyboard-engine',
  name: 'KeyboardEngine',
  group: 'layout-engine',
  from: '@notis/sdk/ui',
  covers: ['KeyboardEngine', 'ShortcutScope', 'HelpSheet'],
  summary: 'The one keyboard listener of a page: Spaces and Notis pages register keys under a ShortcutScope, and ? lists them.',
  states: [
    {
      id: 'registry',
      label: 'Registry: a Space and a Notis page each register under a ShortcutScope (press a listed key)',
      render: (ctx) => <RegistryPage ctx={ctx} id="registry" />,
    },
    {
      id: 'help-sheet',
      label: 'The ? sheet open: This Space first, then Notis (height 760)',
      height: 760,
      render: (ctx) => <HelpSheetDemo ctx={ctx} id="sheet" />,
    },
    {
      id: 'help-sheet-narrow',
      label: 'The ? sheet on a phone fills the screen (fixed 390 px wide, height 760)',
      width: 390,
      height: 760,
      render: (ctx) => <HelpSheetDemo ctx={ctx} id="sheet-narrow" />,
    },
    {
      id: 'help-sheet-other-platform',
      label: 'The ? sheet on Windows and Linux: Ctrl, Alt and Shift spelled out, Maj in French (height 760)',
      height: 760,
      render: (ctx) => <HelpSheetDemo ctx={ctx} id="sheet-other" platform="other" />,
    },
    {
      id: 'scope-silent',
      label: 'Hidden retained view: ShortcutScope available=false silences its keys (toggle the calendar)',
      render: (ctx) => <SilentScopeDemo ctx={ctx} />,
    },
    {
      id: 'scope-available',
      label: 'The same page after showing the calendar: available=true, so its period keys answer and are listed',
      render: (ctx) => <SilentScopeDemo ctx={ctx} />,
      interact: async (root) => {
        root.querySelector<HTMLButtonElement>('button[aria-pressed]')?.click();
        await nextFrame();
      },
    },
    {
      id: 'help-sheet-empty',
      label: 'Empty ? sheet: only reachable with an engine that never attached to a page (height 480)',
      height: 480,
      render: (ctx) => <EmptySheetDemo ctx={ctx} />,
    },
    {
      id: 'clash',
      label: 'Error: clashing keys outside strict mode are ignored and logged (messages are English only)',
      render: (ctx) => <ClashDemo ctx={ctx} />,
    },
  ],
});
