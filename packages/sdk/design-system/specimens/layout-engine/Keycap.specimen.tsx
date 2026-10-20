import type { CSSProperties, ReactNode } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { Keycap, KeycapSurface, useKeyLabel, useToolkitLocale, useToolkitPlatform, type KeycapOn } from '../../../src/ui';
import { DEFAULT_KEYMAP, formatKeySpoken, w, type KeySpec, type Words } from '../../../src/words';
import { OwnEngine, type SpecimenPlatform } from '../../fixtures/layout-engine/engines';

type T = SpecimenRenderContext['t'];
type KeymapId = keyof typeof DEFAULT_KEYMAP;
type Keys = KeySpec | readonly KeySpec[];

const COPY = {
  action: w('Action', 'Action'),
  caps: w('Caps', 'Touches'),
  asText: w('As text (useKeyLabel)', 'En texte (useKeyLabel)'),
  spoken: w('Read aloud', 'Lu à voix haute'),
  key: w('Key', 'Touche'),
  mac: w('Mac', 'Mac'),
  other: w('Windows and Linux', 'Windows et Linux'),
  surface: w('surface: pages, cards and lists', 'surface : pages, cartes et listes'),
  chrome: w('chrome: the sidebar and the top bar', 'chrome : la barre latérale et la barre du haut'),
  pill: w('pill: the selection bar', 'pill : la barre de sélection'),
  discreet: w('discreet: menus and the ? sheet', 'discreet : les menus et la fiche ?'),
  tooltip: w('tooltip: tooltips', 'tooltip : les infobulles'),
  selected: w('3 selected', '3 sélectionnés'),
  inherit: w(
    'KeycapSurface on="pill" around the selection bar: every Keycap inside reads as pill without its own on.',
    'KeycapSurface on="pill" autour de la barre de sélection : chaque Keycap à l’intérieur s’affiche en pill sans son propre on.',
  ),
  menuInherit: w(
    'KeycapSurface on="discreet" around a menu: the caps go quiet so the item names lead.',
    'KeycapSurface on="discreet" autour d’un menu : les touches s’effacent pour laisser les noms en avant.',
  ),
  explicit: w(
    'An explicit on wins over KeycapSurface: the tooltip above the bar sets on="tooltip".',
    'Un on explicite l’emporte sur KeycapSurface : l’infobulle au-dessus de la barre fixe on="tooltip".',
  ),
  noSurface: w(
    'No KeycapSurface and no on: the default surface.',
    'Ni KeycapSurface ni on : la surface par défaut.',
  ),
  noKeys: w(
    'A shortcut with no keys draws nothing: the row keeps its label and no empty cap appears.',
    'Un raccourci sans touche n’affiche rien : la ligne garde son libellé et aucune touche vide n’apparaît.',
  ),
  assign: w('Assign to me', 'M’attribuer'),
  archive: w('Archive', 'Archiver'),
  markDone: w('Mark as done', 'Marquer comme terminé'),
  snooze: w('Snooze', 'Reporter'),
  searchTip: w('Search', 'Rechercher'),
} satisfies Record<string, Words>;

const SHORTCUTS: readonly KeymapId[] = [
  'list.next', 'list.open', 'list.extendDown', 'list.selectAll', 'undo', 'host.goInbox', 'host.call', 'host.modelMenu',
  'host.commandMenu', 'host.help', 'period.prev', 'host.escape',
];

const PLATFORM_SHORTCUTS: readonly KeymapId[] = [
  'list.selectAll', 'list.extendDown', 'undo', 'host.modelMenu', 'host.commandMenu', 'host.toggleSidebar', 'list.open',
  'host.escape',
];

const NAMED_KEYS: readonly KeySpec[] = [
  'escape', 'enter', 'space', 'tab', 'backspace', 'delete', 'insert', 'home', 'end', 'pageup', 'pagedown',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'f2', 'shift+enter', 'mod+shift+z', 'ctrl+alt+k', '?', '/', '[',
];

function Spoken({ keys }: { keys: Keys }) {
  const locale = useToolkitLocale();
  const platform = useToolkitPlatform();
  return <>{formatKeySpoken(keys, { platform, locale })}</>;
}

function KeyText({ keys }: { keys: Keys }) {
  return <>{useKeyLabel(keys)}</>;
}

const HEAD = 'py-2 pr-6 text-left text-[12px] font-medium text-muted-foreground';
const CELL = 'py-1.5 pr-6 align-middle';

/** Default key map shortcuts: caps, the same as text, and what a screen reader says. */
function ShortcutTable({ ids, t, spoken = true }: { ids: readonly KeymapId[]; t: T; spoken?: boolean }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th scope="col" className={HEAD}>{t(COPY.action)}</th>
          <th scope="col" className={HEAD}>{t(COPY.caps)}</th>
          <th scope="col" className={HEAD}>{t(COPY.asText)}</th>
          {spoken ? <th scope="col" className={HEAD}>{t(COPY.spoken)}</th> : null}
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => {
          const entry = DEFAULT_KEYMAP[id];
          return (
            <tr key={id}>
              <td className={`${CELL} text-foreground`}>{t(entry.label)}</td>
              <td className={CELL}><Keycap keys={entry.keys} /></td>
              <td className={`${CELL} text-muted-foreground`}><KeyText keys={entry.keys} /></td>
              {spoken ? <td className={`${CELL} text-muted-foreground`}><Spoken keys={entry.keys} /></td> : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Backgrounds that copy the toolkit surfaces each `on` value is drawn for, with the `--kc-ink` they set. */
const SURFACE_STYLE: Record<KeycapOn, CSSProperties> = {
  surface: { background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' },
  chrome: {
    background: 'hsl(var(--sidebar-background, var(--muted)))',
    color: 'hsl(var(--sidebar-foreground, var(--foreground)))',
  },
  pill: {
    background: 'hsl(var(--foreground) / .95)', color: 'hsl(var(--background))', borderRadius: 9999,
    ['--kc-ink' as string]: 'var(--background)',
  },
  discreet: {
    background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground, var(--foreground)))',
    boxShadow: 'var(--nui-pop-ring, 0 0 0 1px rgb(0 0 0 / .08)), var(--nui-elev, 0 1px 2px rgb(0 0 0 / .05), 0 4px 12px rgb(0 0 0 / .06))',
    ['--kc-ink' as string]: 'var(--foreground)',
  },
  tooltip: { background: '#000', color: '#fff', ['--kc-ink' as string]: '0 0% 100%' },
};

const SURFACE_ROWS: readonly { on: KeycapOn; label: Words; item: Words; keys: Keys }[] = [
  { on: 'surface', label: COPY.surface, item: COPY.assign, keys: 'a' },
  { on: 'chrome', label: COPY.chrome, item: DEFAULT_KEYMAP['host.newChat'].label, keys: 'c' },
  { on: 'pill', label: COPY.pill, item: COPY.archive, keys: 'e' },
  { on: 'discreet', label: COPY.discreet, item: COPY.markDone, keys: 'shift+e' },
  { on: 'tooltip', label: COPY.tooltip, item: COPY.searchTip, keys: '/' },
];

function Swatch({ on, children, className = '' }: { on: KeycapOn; children: ReactNode; className?: string }) {
  return (
    <div className={`inline-flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] ${className}`} style={SURFACE_STYLE[on]}>
      {children}
    </div>
  );
}

function SurfacesDemo({ ctx }: { ctx: SpecimenRenderContext }) {
  return (
    <OwnEngine lang={ctx.lang}>
      <div className="grid gap-4 p-6">
        {SURFACE_ROWS.map((row) => (
          <div key={row.on} className="grid grid-cols-[minmax(0,16rem)_1fr] items-center gap-6 max-[640px]:grid-cols-1 max-[640px]:gap-2">
            <span className="text-[13px] text-muted-foreground">{ctx.t(row.label)}</span>
            <div>
              <Swatch on={row.on}>
                <span>{ctx.t(row.item)}</span>
                <Keycap keys={row.keys} on={row.on} />
              </Swatch>
            </div>
          </div>
        ))}
      </div>
    </OwnEngine>
  );
}

function InheritDemo({ ctx }: { ctx: SpecimenRenderContext }) {
  const { t } = ctx;
  return (
    <OwnEngine lang={ctx.lang}>
      <div className="grid max-w-3xl gap-8 p-6">
        <section className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t(COPY.inherit)}</p>
          <div className="relative pt-12">
            <div className="absolute left-36 top-0 inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]"
              style={SURFACE_STYLE.tooltip}>
              <span>{t(COPY.markDone)}</span>
              <Keycap keys="shift+e" on="tooltip" />
            </div>
            <KeycapSurface on="pill">
              <div className="inline-flex max-w-full flex-wrap items-center gap-4 px-4 py-2 text-[13px]" style={SURFACE_STYLE.pill}>
                <span className="font-medium">{t(COPY.selected)}</span>
                <span className="inline-flex items-center gap-2">{t(COPY.archive)} <Keycap keys="e" /></span>
                <span className="inline-flex items-center gap-2">{t(COPY.markDone)} <Keycap keys="shift+e" /></span>
                <span className="inline-flex items-center gap-2">{t(COPY.snooze)} <Keycap keys="h" /></span>
              </div>
            </KeycapSurface>
          </div>
          <p className="text-sm text-muted-foreground">{t(COPY.explicit)}</p>
        </section>
        <section className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t(COPY.menuInherit)}</p>
          <KeycapSurface on="discreet">
            <div className="grid w-72 gap-0.5 rounded-lg p-1 text-[13px]" style={SURFACE_STYLE.discreet}>
              {[
                { label: COPY.assign, keys: 'a' },
                { label: COPY.markDone, keys: 'shift+e' },
                { label: COPY.snooze, keys: 'h' },
                { label: DEFAULT_KEYMAP['host.commandMenu'].label, keys: 'mod+k' },
              ].map((item) => (
                <div key={item.keys} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
                  <span>{t(item.label)}</span>
                  <Keycap keys={item.keys} />
                </div>
              ))}
            </div>
          </KeycapSurface>
        </section>
        <section className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t(COPY.noSurface)}</p>
          <span className="inline-flex items-center gap-2 text-[13px] text-foreground">
            {t(COPY.assign)} <Keycap keys="a" />
          </span>
        </section>
      </div>
    </OwnEngine>
  );
}

function PlatformColumn({ ctx, platform }: { ctx: SpecimenRenderContext; platform: SpecimenPlatform }) {
  return (
    <OwnEngine lang={ctx.lang} platform={platform}>
      <section className="grid min-w-0 content-start gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">{ctx.t(platform === 'mac' ? COPY.mac : COPY.other)}</h3>
        <ShortcutTable ids={PLATFORM_SHORTCUTS} t={ctx.t} spoken={false} />
      </section>
    </OwnEngine>
  );
}

function NamedKeys({ ctx, platform }: { ctx: SpecimenRenderContext; platform: SpecimenPlatform }) {
  return (
    <OwnEngine lang={ctx.lang} platform={platform}>
      <section className="grid min-w-0 content-start gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">{ctx.t(platform === 'mac' ? COPY.mac : COPY.other)}</h3>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{ctx.t(COPY.key)}</th>
              <th scope="col" className={HEAD}>{ctx.t(COPY.caps)}</th>
              <th scope="col" className={HEAD}>{ctx.t(COPY.spoken)}</th>
            </tr>
          </thead>
          <tbody>
            {NAMED_KEYS.map((key) => (
              <tr key={key}>
                <td className={CELL}><code className="font-mono text-xs text-muted-foreground">{key}</code></td>
                <td className={CELL}><Keycap keys={key} /></td>
                <td className={`${CELL} text-muted-foreground`}><Spoken keys={key} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </OwnEngine>
  );
}

function NoKeysDemo({ ctx }: { ctx: SpecimenRenderContext }) {
  return (
    <OwnEngine lang={ctx.lang}>
      <div className="grid max-w-xl gap-3 p-6">
        <p className="text-sm text-muted-foreground">{ctx.t(COPY.noKeys)}</p>
        <div className="flex items-center justify-between gap-3 text-[13px] text-foreground">
          <span>{ctx.t(COPY.assign)}</span>
          <Keycap keys={[]} />
        </div>
        <div className="flex items-center justify-between gap-3 text-[13px] text-foreground">
          <span>{ctx.t(COPY.markDone)}</span>
          <Keycap keys="shift+e" />
        </div>
      </div>
    </OwnEngine>
  );
}

export const specimen = defineSpecimen({
  id: 'keycap',
  name: 'Keycap',
  group: 'layout-engine',
  from: '@notis/sdk/ui',
  covers: ['Keycap', 'KeycapSurface'],
  summary: 'How a shortcut reads on screen, the same on every Notis surface; screen readers hear it spelled out.',
  states: [
    {
      id: 'shortcuts',
      label: 'Default key map on a Mac: single keys, alternatives (or), sequences (then) and modifiers',
      render: (ctx) => (
        <OwnEngine lang={ctx.lang}>
          <div className="max-w-4xl overflow-x-auto p-6"><ShortcutTable ids={SHORTCUTS} t={ctx.t} /></div>
        </OwnEngine>
      ),
    },
    {
      id: 'surfaces',
      label: 'The five surfaces: surface, chrome, pill, discreet and tooltip',
      render: (ctx) => <SurfacesDemo ctx={ctx} />,
    },
    {
      id: 'keycap-surface',
      label: 'KeycapSurface sets the default on for every Keycap inside; an explicit on wins',
      render: (ctx) => <InheritDemo ctx={ctx} />,
    },
    {
      id: 'platforms',
      label: 'Mac glyphs beside Windows and Linux names (Ctrl, Alt, Shift; Maj and Entrée in French)',
      render: (ctx) => (
        <div className="grid gap-8 p-6 min-[900px]:grid-cols-2">
          <PlatformColumn ctx={ctx} platform="mac" />
          <PlatformColumn ctx={ctx} platform="other" />
        </div>
      ),
    },
    {
      id: 'named-keys',
      label: 'Named keys and symbols on both platforms, with what a screen reader says',
      render: (ctx) => (
        <div className="grid gap-8 p-6 min-[900px]:grid-cols-2">
          <NamedKeys ctx={ctx} platform="mac" />
          <NamedKeys ctx={ctx} platform="other" />
        </div>
      ),
    },
    {
      id: 'no-keys',
      label: 'Empty: a shortcut with no keys draws nothing',
      render: (ctx) => <NoKeysDemo ctx={ctx} />,
    },
  ],
});
