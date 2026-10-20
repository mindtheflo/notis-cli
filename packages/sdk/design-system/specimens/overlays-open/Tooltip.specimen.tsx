import * as React from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { Button, Icon, Tooltip } from '../../../src/ui';
import { SHELL_WORDS, STANDARD_ACTIONS, type KeySpec, type Words } from '../../../src/words';
import { NB_418 } from '../../fixtures/overlays-open/tickets';
import { hover, keyboardFocus, pause, settle, waitFor, layerScope } from '../../fixtures/overlays-open/interact';

type Ctx = SpecimenRenderContext;
type Side = 'top' | 'bottom' | 'left' | 'right';

const COPY = {
  disabledNote: {
    en: 'Tooltip off here: the button already shows its label.',
    fr: 'Pas d’infobulle ici : le bouton affiche déjà son libellé.',
  },
};

interface BarButton {
  id: string;
  icon: string;
  label: Words;
  keys?: KeySpec;
}

/** The reader bar of NB-418 in a side peek: close and step on the left, the ticket's actions on the right. */
const LEFT: readonly BarButton[] = [
  { id: 'close', icon: 'x', label: SHELL_WORDS.close, keys: 'escape' },
  { id: 'previous', icon: 'caret-up', label: SHELL_WORDS.previous, keys: 'k' },
  { id: 'next', icon: 'caret-down', label: SHELL_WORDS.next, keys: 'j' },
];
const RIGHT: readonly BarButton[] = [
  { id: 'star', icon: STANDARD_ACTIONS.star.icon, label: STANDARD_ACTIONS.star.label, keys: STANDARD_ACTIONS.star.key ?? undefined },
  { id: 'later', icon: STANDARD_ACTIONS.later.icon, label: STANDARD_ACTIONS.later.label, keys: STANDARD_ACTIONS.later.key ?? undefined },
  { id: 'archive', icon: STANDARD_ACTIONS.archive.icon, label: STANDARD_ACTIONS.archive.label, keys: STANDARD_ACTIONS.archive.key ?? undefined },
  { id: 'unarchive', icon: STANDARD_ACTIONS.unarchive.icon, label: STANDARD_ACTIONS.unarchive.label, keys: STANDARD_ACTIONS.unarchive.key ?? undefined },
  { id: 'more', icon: 'dots-three', label: SHELL_WORDS.more },
];

function BarIcon({ ctx, button, side }: { ctx: Ctx; button: BarButton; side?: Side }) {
  return (
    <Tooltip label={button.label} keys={button.keys} side={side}>
      <button type="button" className="nui-icon-btn" aria-label={ctx.t(button.label)} data-tip={button.id}>
        <Icon name={button.icon} />
      </button>
    </Tooltip>
  );
}

/** The bar sits mid-frame so a tip has room on every side. `sides` sets one button's side. */
function ReaderBar({ ctx, sides = {}, padTop = 64 }: { ctx: Ctx; sides?: Record<string, Side>; padTop?: number }) {
  const narrow = ctx.width < 600;
  const right = narrow ? RIGHT.filter((button) => button.id !== 'later' && button.id !== 'star') : RIGHT;
  return (
    <div className="px-4" style={{ paddingTop: padTop }}>
      <div className="flex h-12 min-w-0 items-center gap-1 rounded-lg bg-muted px-2">
        {LEFT.map((button) => <BarIcon key={button.id} ctx={ctx} button={button} side={sides[button.id]} />)}
        <span className="min-w-0 flex-1 truncate px-2 font-mono text-xs text-muted-foreground">{NB_418.id}</span>
        {right.map((button) => <BarIcon key={button.id} ctx={ctx} button={button} side={sides[button.id]} />)}
      </div>
    </div>
  );
}

function DisabledTip({ ctx }: { ctx: Ctx }) {
  return (
    <div className="flex flex-col items-start gap-3 p-6" style={{ paddingTop: 64 }}>
      <Tooltip label={STANDARD_ACTIONS.archive.label} keys={STANDARD_ACTIONS.archive.key ?? undefined} disabled>
        <Button icon={STANDARD_ACTIONS.archive.icon} data-tip="archive-text">{STANDARD_ACTIONS.archive.label}</Button>
      </Tooltip>
      <p className="m-0 text-sm text-muted-foreground">{ctx.t(COPY.disabledNote)}</p>
    </div>
  );
}

/** Hovers a button and waits out the 500 ms delay. */
async function hoverTip(root: HTMLElement, id: string): Promise<void> {
  const button = await waitFor<HTMLElement>(root, `[data-tip="${id}"]`);
  await settle(2);
  hover(button);
  await pause(650);
  await waitFor(layerScope(root), '.nui-tip');
  await settle(3);
}

export const specimen = defineSpecimen({
  id: 'tooltip',
  name: 'Tooltip',
  group: 'overlays-open',
  from: '@notis/sdk/ui',
  covers: ['Tooltip'],
  summary: 'The black label of an icon button, with its shortcut: after half a second of hover, or at once on keyboard focus.',
  states: [
    {
      id: 'rest',
      label: 'At rest: the reader bar of a ticket, every icon button has a tip',
      height: 140,
      render: (ctx) => <ReaderBar ctx={ctx} />,
    },
    {
      id: 'label-only',
      label: 'Hover: a label without a key',
      height: 140,
      render: (ctx) => <ReaderBar ctx={ctx} />,
      interact: (root) => hoverTip(root, 'more'),
    },
    {
      id: 'with-key',
      label: 'Hover: a label and its key',
      height: 140,
      render: (ctx) => <ReaderBar ctx={ctx} />,
      interact: (root) => hoverTip(root, 'archive'),
    },
    {
      id: 'side-bottom',
      label: 'Placed below its button (side bottom)',
      height: 160,
      render: (ctx) => <ReaderBar ctx={ctx} sides={{ next: 'bottom' }} padTop={24} />,
      interact: (root) => hoverTip(root, 'next'),
    },
    {
      id: 'flipped',
      label: 'No room above: a top tip flips below',
      height: 120,
      render: (ctx) => <ReaderBar ctx={ctx} padTop={8} />,
      interact: (root) => hoverTip(root, 'archive'),
    },
    {
      id: 'keyboard-focus',
      label: 'Keyboard focus: shown at once, with the focus ring',
      height: 140,
      render: (ctx) => <ReaderBar ctx={ctx} />,
      interact: async (root) => {
        const button = await waitFor<HTMLElement>(root, '[data-tip="close"]');
        await settle(2);
        keyboardFocus(button);
        await waitFor(layerScope(root), '.nui-tip');
        await settle(3);
      },
    },
    {
      id: 'narrow-edge',
      label: 'Narrow screen: a long label at the right edge stays on screen',
      width: 390,
      height: 140,
      render: (ctx) => <ReaderBar ctx={ctx} />,
      interact: (root) => hoverTip(root, 'unarchive'),
    },
    {
      id: 'disabled',
      label: 'Disabled: hovered, nothing shows',
      height: 160,
      render: (ctx) => <DisabledTip ctx={ctx} />,
      interact: async (root) => {
        const button = await waitFor<HTMLElement>(root, '[data-tip="archive-text"]');
        hover(button);
        await pause(650);
      },
    },
  ],
});
