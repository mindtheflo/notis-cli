import * as React from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { Button, LayerRootProvider, Popover, findLayerRoot, type PopoverController } from '../../../src/ui';
import { STANDARD_ACTIONS } from '../../../src/words';
import { SHORT_COPY } from '../../fixtures/copy';
import { NB_418, OVERLAY_COPY, SNOOZE_OPTIONS } from '../../fixtures/overlays-open/tickets';
import { layerScope, pointerClick, settle, waitFor } from '../../fixtures/overlays-open/interact';

type Ctx = SpecimenRenderContext;

const COPY = {
  hostTitle: { en: 'Embedded preview', fr: 'Aperçu intégré' },
  hostHint: {
    en: 'The host draws its own overlay container and pins it with LayerRootProvider.',
    fr: 'L’hôte dessine son propre conteneur d’overlays et l’épingle avec LayerRootProvider.',
  },
  inPinned: { en: 'Open in the pinned container', fr: 'Ouverts dans le conteneur épinglé' },
  inSpace: { en: 'Open in the Space layer', fr: 'Ouverts dans la couche du Space' },
  snoozeTicket: { en: 'Snooze NB-418', fr: 'Reporter NB-418' },
} as const;

/**
 * The snooze choices from the fixed clock (Monday 15 June, 11:30 in Paris). The padding sits on an inner span: the
 * toolkit's button reset in the layer drops a Space's own padding classes on a button (see the group report).
 */
function SnoozePanel({ ctx, close }: { ctx: Ctx; close: PopoverController['close'] }) {
  return (
    <div className="flex w-[19rem] flex-col gap-1">
      <p className="m-0 px-2 pb-1 text-xs font-medium text-muted-foreground">{ctx.t(OVERLAY_COPY.snoozeTitle)}</p>
      {SNOOZE_OPTIONS.map((option) => (
        <button key={option.id} type="button" onClick={close}
          className="flex h-8 w-full items-center rounded-md text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3 px-2">
            <span className="truncate">{ctx.t(option.label)}</span>
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{ctx.t(option.when)}</span>
          </span>
        </button>
      ))}
      <button type="button" onClick={close}
        className="mt-1 flex h-8 w-full items-center rounded-md text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
        <span className="px-2 text-muted-foreground">{ctx.t(OVERLAY_COPY.pickDate)}</span>
      </button>
    </div>
  );
}

function SnoozePopover({ ctx, align = 'start', side }: { ctx: Ctx; align?: 'start' | 'end'; side?: 'top' | 'bottom' }) {
  return (
    <Popover label={COPY.snoozeTicket} align={align} side={side}
      trigger={<Button icon={STANDARD_ACTIONS.later.icon} data-trigger="snooze">{STANDARD_ACTIONS.later.label}</Button>}
      content={({ close }) => <SnoozePanel ctx={ctx} close={close} />} />
  );
}

/** The ticket's toolbar: the snooze button sits beside the ticket id. */
function Toolbar({ ctx, children, end }: { ctx: Ctx; children: React.ReactNode; end?: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-6${end ? ' justify-between' : ''}`}>
      <span className="min-w-0 truncate text-sm">
        <span className="font-mono text-xs text-muted-foreground">{NB_418.id}</span>{' '}
        {ctx.t(NB_418.title)}
      </span>
      {children}
    </div>
  );
}

/** A modal popover opened by its `open` prop: a small form with its first field focused. */
function RenameView({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = React.useState(true);
  const [name, setName] = React.useState(ctx.t(OVERLAY_COPY.viewNameValue));
  const inputId = React.useId();
  return (
    <div className="p-6">
      <Popover modal open={open} onOpenChange={setOpen} label={OVERLAY_COPY.renameView}
        trigger={<Button variant="ghost">{OVERLAY_COPY.renameView}</Button>}
        content={({ close }) => (
          <form className="flex w-72 flex-col gap-2" onSubmit={(event) => { event.preventDefault(); close(); }}>
            <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">{ctx.t(OVERLAY_COPY.viewName)}</label>
            <input id={inputId} value={name} onChange={(event) => setName(event.target.value)}
              className="h-8 w-full rounded-md bg-muted px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <p className="m-0 text-xs text-muted-foreground">{ctx.t(OVERLAY_COPY.viewNameHint)}</p>
            <div className="mt-1 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close}>{ctx.t(SHORT_COPY.cancel)}</Button>
              <Button variant="primary" size="sm" type="submit">{ctx.t(SHORT_COPY.save)}</Button>
            </div>
          </form>
        )} />
    </div>
  );
}

/** Counts the open overlays in the pinned container and in the Space's own layer. */
function useOverlayCounts(container: HTMLElement | null): { pinned: number; space: number } {
  const [counts, setCounts] = React.useState({ pinned: 0, space: 0 });
  React.useEffect(() => {
    if (!container) return undefined;
    const scope = container.getRootNode() as ParentNode & Node;
    const count = () => {
      const pinned = container.querySelectorAll('[data-notis-floating]').length;
      const all = (scope as ParentNode).querySelectorAll('[data-notis-floating]').length;
      setCounts((current) => (current.pinned === pinned && current.space === all - pinned ? current : { pinned, space: all - pinned }));
    };
    count();
    const observer = new MutationObserver(count);
    observer.observe(scope, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);
  return counts;
}

/** LayerRootProvider: a host pins the container its overlays render into. */
function PinnedLayer({ ctx }: { ctx: Ctx }) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(true);
  const counts = useOverlayCounts(container);
  // Created so the counts below compare against the layer an unpinned overlay would use.
  React.useEffect(() => { if (container) findLayerRoot(container); }, [container]);
  return (
    <div className="flex items-start gap-6 p-6">
      <div className="flex w-[22rem] shrink-0 flex-col gap-3 rounded-lg bg-muted p-4">
        <p className="m-0 text-sm font-medium">{ctx.t(COPY.hostTitle)}</p>
        <p className="m-0 text-xs text-muted-foreground">{ctx.t(COPY.hostHint)}</p>
        <div>
          <LayerRootProvider root={container}>
            <Popover open={open && container !== null} onOpenChange={setOpen} label={COPY.snoozeTicket}
              trigger={<Button icon={STANDARD_ACTIONS.later.icon}>{STANDARD_ACTIONS.later.label}</Button>}
              content={({ close }) => <SnoozePanel ctx={ctx} close={close} />} />
          </LayerRootProvider>
        </div>
        <div ref={setContainer} data-host-overlays="" />
      </div>
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 pt-4 text-xs">
        <dt className="text-muted-foreground">{ctx.t(COPY.inPinned)}</dt>
        <dd className="m-0 tabular-nums" data-count="pinned">{counts.pinned}</dd>
        <dt className="text-muted-foreground">{ctx.t(COPY.inSpace)}</dt>
        <dd className="m-0 tabular-nums" data-count="space">{counts.space}</dd>
      </dl>
    </div>
  );
}

async function openSnooze(root: HTMLElement): Promise<void> {
  const trigger = await waitFor<HTMLElement>(root, '[data-trigger="snooze"]');
  await pointerClick(trigger);
  await waitFor(layerScope(root), '.nui-popover');
  await settle(4);
}

export const specimen = defineSpecimen({
  id: 'popover',
  name: 'Popover',
  group: 'overlays-open',
  from: '@notis/sdk/ui',
  covers: ['Popover', 'LayerRootProvider'],
  summary: 'A floating panel under a button for a small choice or form, light (closes on a press outside) or modal (keeps Tab and keys inside).',
  states: [
    {
      id: 'closed',
      label: 'Closed: the button that opens it',
      render: (ctx) => <Toolbar ctx={ctx}><SnoozePopover ctx={ctx} /></Toolbar>,
    },
    {
      id: 'snooze',
      label: 'Opened with the mouse: snooze choices from the fixed clock',
      height: 340,
      render: (ctx) => <Toolbar ctx={ctx}><SnoozePopover ctx={ctx} /></Toolbar>,
      interact: openSnooze,
    },
    {
      id: 'modal-form',
      label: 'Modal, opened by its open prop: a form with its field focused',
      height: 260,
      render: (ctx) => <RenameView ctx={ctx} />,
      interact: async (root) => { await waitFor(layerScope(root), '.nui-popover input'); await settle(4); },
    },
    {
      id: 'flip-up',
      label: 'No room below: it opens above its button',
      height: 360,
      // The frame pads the state by 24px: 312px puts the button 72px above the bottom edge.
      render: (ctx) => (
        <div className="flex h-[312px] flex-col justify-end">
          <Toolbar ctx={ctx}><SnoozePopover ctx={ctx} /></Toolbar>
        </div>
      ),
      interact: openSnooze,
    },
    {
      id: 'narrow-end',
      label: 'Narrow screen: aligned to the end of a button at the right edge',
      width: 390,
      height: 320,
      render: (ctx) => <Toolbar ctx={ctx} end><SnoozePopover ctx={ctx} align="end" /></Toolbar>,
      interact: openSnooze,
    },
    {
      id: 'pinned-layer',
      label: 'LayerRootProvider: the panel opens in the host container, not the Space layer',
      height: 440,
      render: (ctx) => <PinnedLayer ctx={ctx} />,
      interact: async (root) => { await waitFor(layerScope(root), '[data-host-overlays] .nui-popover'); await settle(4); },
    },
  ],
});
