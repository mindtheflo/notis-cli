import * as React from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { Icon, Menu, MenuItem, MenuSeparator, MenuSub, STATUS_WORDS, StatusIcon } from '../../../src/ui';
import { SHELL_WORDS, STANDARD_ACTIONS } from '../../../src/words';
import {
  MOVE_TARGETS, NB_418, OVERLAY_COPY, PEOPLE, TICKETS, TICKET_STATUSES, type Ticket, type TicketStatus,
} from '../../fixtures/overlays-open/tickets';
import { keyboardOpen, layerScope, pointerClick, settle, waitFor } from '../../fixtures/overlays-open/interact';

type Ctx = SpecimenRenderContext;

const COPY = {
  starredLine: { en: 'Starred: NB-418', fr: 'En favori : NB-418' },
  notStarredLine: { en: 'Press S to star NB-418 without opening the menu.', fr: 'Appuie sur S pour mettre NB-418 en favori sans ouvrir le menu.' },
  contextHint: { en: 'Right-click a row to open its menu.', fr: 'Clic droit sur une ligne pour ouvrir son menu.' },
  ticketActions: { en: 'Ticket actions', fr: 'Actions du ticket' },
};

function Avatar({ initials, small }: { initials: string; small?: boolean }) {
  return (
    <span className="nui-avatar" aria-hidden="true" style={small ? { width: 20, height: 20, fontSize: 10 } : undefined}>
      {initials}
    </span>
  );
}

interface TicketMenuState {
  status: TicketStatus;
  setStatus(status: TicketStatus): void;
  owner: string;
  setOwner(owner: string): void;
  starred: boolean;
  toggleStar(): void;
}

function useTicketMenuState(ticket: Ticket): TicketMenuState {
  const [status, setStatus] = React.useState<TicketStatus>(ticket.status);
  const [owner, setOwner] = React.useState(ticket.owner);
  const [starred, setStarred] = React.useState(false);
  return { status, setStatus, owner, setOwner, starred, toggleStar: () => setStarred((value) => !value) };
}

/**
 * The items of a ticket's menu: three submenus, then the standard actions with their keys. A plain function, not a
 * component, so the items sit directly in the menu's children where its accelerators read them.
 */
function ticketMenuItems(ctx: Ctx, state: TicketMenuState): React.ReactNode {
  const star = state.starred ? STANDARD_ACTIONS.unstar : STANDARD_ACTIONS.star;
  return (
    <>
      <MenuSub label={ctx.t(OVERLAY_COPY.status)} icon="circle-half">
        {TICKET_STATUSES.map((option) => (
          <MenuItem key={option} icon={<StatusIcon status={option} decorative />} checked={option === state.status}
            onSelect={() => state.setStatus(option)}>
            {ctx.t(STATUS_WORDS[option])}
          </MenuItem>
        ))}
      </MenuSub>
      <MenuSub label={ctx.t(OVERLAY_COPY.assignee)} icon="user-plus">
        {PEOPLE.map((person) => (
          <MenuItem key={person.initials} icon={<Avatar initials={person.initials} small />}
            checked={person.initials === state.owner} onSelect={() => state.setOwner(person.initials)}>
            {person.name}
          </MenuItem>
        ))}
      </MenuSub>
      <MenuSub label={ctx.t(OVERLAY_COPY.moveTo)} icon="arrow-bend-up-right">
        {MOVE_TARGETS.map((target) => (
          <MenuItem key={target.en}>{ctx.t(target)}</MenuItem>
        ))}
      </MenuSub>
      <MenuSeparator />
      <MenuItem icon={star.icon} keys={star.key ?? undefined} onSelect={state.toggleStar}>{ctx.t(star.label)}</MenuItem>
      <MenuItem icon={STANDARD_ACTIONS.later.icon} keys={STANDARD_ACTIONS.later.key ?? undefined}>
        {ctx.t(STANDARD_ACTIONS.later.label)}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={STANDARD_ACTIONS.archive.icon} keys={STANDARD_ACTIONS.archive.key ?? undefined}>
        {ctx.t(STANDARD_ACTIONS.archive.label)}
      </MenuItem>
      <MenuItem icon={STANDARD_ACTIONS.unarchive.icon} keys={STANDARD_ACTIONS.unarchive.key ?? undefined} disabled>
        {ctx.t(STANDARD_ACTIONS.unarchive.label)}
      </MenuItem>
      <MenuItem icon={STANDARD_ACTIONS.delete.icon} keys={STANDARD_ACTIONS.delete.key ?? undefined} tone="danger">
        {ctx.t(STANDARD_ACTIONS.delete.label)}
      </MenuItem>
    </>
  );
}

/** The row's more button. A plain element, not a component, so the props and ref the menu adds land on the button. */
function moreButton(ctx: Ctx, ticket: Ticket): React.ReactElement {
  return (
    <button type="button" className="nui-icon-btn" aria-label={`${ctx.t(SHELL_WORDS.more)}: ${ticket.id}`}
      data-ticket={ticket.id}>
      <Icon name="dots-three" />
    </button>
  );
}

/** One row of the Tickets list, drawn by hand so the menu is the only toolkit part on show. */
const TicketRow = React.forwardRef<HTMLDivElement, {
  ctx: Ctx; ticket: Ticket; trail?: React.ReactNode; highlighted?: boolean;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
}>(function TicketRow({ ctx, ticket, trail, highlighted, onContextMenu }, ref) {
  return (
    <div ref={ref} onContextMenu={onContextMenu}
      className={`flex h-10 min-w-0 items-center gap-3 rounded-md px-3 text-sm${highlighted ? ' bg-accent' : ''}`}>
      <StatusIcon status={ticket.status} />
      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{ticket.id}</span>
      <span className="min-w-0 flex-1 truncate">{ctx.t(ticket.title)}</span>
      <Avatar initials={ticket.owner} />
      {trail}
    </div>
  );
});

/** A row with its own menu (accelerators off: a menu drawn once per row). */
function RowWithMenu({ ctx, ticket }: { ctx: Ctx; ticket: Ticket }) {
  const state = useTicketMenuState(ticket);
  return (
    <TicketRow ctx={ctx} ticket={{ ...ticket, status: state.status, owner: state.owner }} trail={(
      <Menu align="end" label={COPY.ticketActions} accelerators={false} trigger={moreButton(ctx, ticket)}>
        {ticketMenuItems(ctx, state)}
      </Menu>
    )} />
  );
}

/** The Tickets list of the Product Space. */
function TicketList({ ctx, only }: { ctx: Ctx; only?: Ticket }) {
  const rows = only ? [only] : TICKETS;
  return (
    <div className="flex max-w-2xl flex-col p-6">
      {rows.map((ticket) => <RowWithMenu key={ticket.id} ctx={ctx} ticket={ticket} />)}
    </div>
  );
}

/** One menu with its keys live while it is closed: S stars the ticket. */
function AcceleratorDemo({ ctx }: { ctx: Ctx }) {
  const state = useTicketMenuState(NB_418);
  return (
    <div className="flex max-w-2xl flex-col gap-3 p-6">
      <TicketRow ctx={ctx} ticket={NB_418} trail={(
        <Menu align="end" label={COPY.ticketActions} trigger={moreButton(ctx, NB_418)}>
          {ticketMenuItems(ctx, state)}
        </Menu>
      )} />
      <p className="m-0 px-3 text-sm text-muted-foreground" aria-live="polite">
        {ctx.t(state.starred ? COPY.starredLine : COPY.notStarredLine)}
      </p>
    </div>
  );
}

/** A context menu: no trigger, opened at the row the caller draws (`anchor` with a controlled `open`). */
function ContextMenuDemo({ ctx }: { ctx: Ctx }) {
  const [row, setRow] = React.useState<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(true);
  const state = useTicketMenuState(NB_418);
  return (
    <div className="flex max-w-2xl flex-col gap-3 p-6">
      <p className="m-0 px-3 text-sm text-muted-foreground">{ctx.t(COPY.contextHint)}</p>
      <TicketRow ref={setRow} ctx={ctx} ticket={NB_418} highlighted={open}
        onContextMenu={(event) => { event.preventDefault(); setOpen(true); }} />
      <Menu anchor={row} open={open && row !== null} onOpenChange={setOpen} label={COPY.ticketActions}
        accelerators={false}>
        {ticketMenuItems(ctx, state)}
      </Menu>
    </div>
  );
}

const TRIGGER = '[data-ticket="NB-418"]';

async function openRowMenu(root: HTMLElement): Promise<HTMLElement> {
  const trigger = await waitFor<HTMLElement>(root, TRIGGER);
  await pointerClick(trigger);
  return waitFor<HTMLElement>(layerScope(root), '.nui-menu');
}

async function openSub(root: HTMLElement, index: number): Promise<void> {
  const menu = await openRowMenu(root);
  const sub = menu.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]')[index];
  if (!sub) throw new Error(`No submenu ${index}`);
  await pointerClick(sub);
  await waitFor(layerScope(root), '.nui-menu[id^="nui-sub"]');
  await settle(4);
}

export const specimen = defineSpecimen({
  id: 'menu',
  name: 'Menu',
  group: 'overlays-open',
  from: '@notis/sdk/ui',
  covers: ['Menu', 'MenuItem', 'MenuSeparator', 'MenuSub'],
  summary: 'The action menu of a row, a toolbar or a context click: items with icons and keys, check items, submenus and separators, opened in the Space layer.',
  states: [
    {
      id: 'closed',
      label: 'Closed: one more button per row',
      render: (ctx) => <TicketList ctx={ctx} />,
    },
    {
      id: 'row-actions',
      label: 'Opened with the mouse: submenus, keys, a disabled item and a danger item',
      height: 380,
      render: (ctx) => <TicketList ctx={ctx} />,
      interact: async (root) => { await openRowMenu(root); await settle(4); },
    },
    {
      id: 'keyboard-open',
      label: 'Opened with the keyboard: the first item has focus',
      height: 380,
      render: (ctx) => <TicketList ctx={ctx} />,
      interact: async (root) => {
        await keyboardOpen(await waitFor<HTMLElement>(root, TRIGGER));
        await waitFor(layerScope(root), '.nui-menu');
        await settle(4);
      },
    },
    {
      id: 'submenu-status',
      label: 'Status submenu: check items with status icons',
      height: 380,
      render: (ctx) => <TicketList ctx={ctx} only={NB_418} />,
      interact: async (root) => openSub(root, 0),
    },
    {
      id: 'submenu-assignee',
      label: 'Assignee submenu: people with the current owner checked',
      height: 380,
      render: (ctx) => <TicketList ctx={ctx} only={NB_418} />,
      interact: async (root) => openSub(root, 1),
    },
    {
      id: 'narrow-long-labels',
      label: 'Narrow screen: the Move to submenu with long labels',
      width: 390,
      height: 420,
      render: (ctx) => <TicketList ctx={ctx} only={NB_418} />,
      interact: async (root) => openSub(root, 2),
    },
    {
      id: 'accelerators',
      label: 'Keys while closed: S starred the ticket without opening the menu',
      render: (ctx) => <AcceleratorDemo ctx={ctx} />,
      interact: async (root) => {
        await waitFor(root, TRIGGER);
        await settle(2);
        const target = root.ownerDocument.activeElement ?? root.ownerDocument.body;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true, composed: true, cancelable: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: 's', code: 'KeyS', bubbles: true, composed: true, cancelable: true }));
        await settle(3);
      },
    },
    {
      id: 'context-menu',
      label: 'Context menu: opened at a row with anchor and open, first item focused',
      height: 440,
      render: (ctx) => <ContextMenuDemo ctx={ctx} />,
      interact: async (root) => { await waitFor(layerScope(root), '.nui-menu'); await settle(4); },
    },
  ],
});
