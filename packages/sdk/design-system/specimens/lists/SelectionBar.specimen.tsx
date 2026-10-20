import type { ReactNode } from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenRenderContext } from '../../specimen';
import {
  Row, SelectionBar, availableActions, resolveActions,
  type ActionHandlers, type ResolvedAction,
} from '../../../src/ui';
import type { ActionOption, ActionRef } from '../../../src/words';
import { fromNow } from '../../fixtures/time';
import { TICKETS, ticketById, type Ticket } from '../../fixtures/lists/tickets';
import { ASSIGN_OPTIONS, StarMark, TICKET_ACTIONS, TICKET_HANDLERS, TicketMeta } from '../../fixtures/lists/views';
import { clickIn, inner, settle, waitForMenu } from '../../fixtures/lists/interact';
import { ListRows } from '../../fixtures/lists/rows';

type Ctx = SpecimenRenderContext;

const noop = () => undefined;

/** The bulk actions the Tickets list puts in the bar for these tickets (what ListReader computes). */
function ticketBar(ids: readonly string[]): ResolvedAction<Ticket>[] {
  const items = ids.map(ticketById);
  return availableActions(resolveActions(TICKET_ACTIONS, TICKET_HANDLERS), items).filter((action) => action.bulk);
}

// ---- the Mail Space: seven bulk actions, so two go into More ----

interface Mail {
  id: string;
  from: string;
  subject: SpecimenCopy;
  read: boolean;
  starred: boolean;
  at: Date;
}

const FOLDERS: readonly ActionOption[] = [
  { value: 'inbox', label: { en: 'Inbox', fr: 'Boîte de réception' } },
  { value: 'receipts', label: { en: 'Receipts', fr: 'Reçus' } },
  { value: 'newsletters', label: { en: 'Newsletters', fr: 'Lettres d’information' } },
];

const MAIL_ACTIONS: readonly ActionRef<Mail>[] = [
  'archive',
  { id: 'read', appliesTo: (mail) => !mail.read },
  { id: 'unread', appliesTo: (mail) => mail.read },
  { id: 'star', appliesTo: (mail) => !mail.starred },
  { id: 'unstar', appliesTo: (mail) => mail.starred },
  'later',
  { id: 'move', options: FOLDERS, value: () => 'inbox' },
  { id: 'assign', options: ASSIGN_OPTIONS },
  'delete',
];

const MAIL_HANDLERS: ActionHandlers<Mail> = {
  archive: () => noop, read: () => noop, unread: () => noop, star: () => noop, unstar: () => noop, later: () => noop,
  move: () => noop, assign: () => noop, delete: () => noop,
};

const MAILS: readonly Mail[] = [
  { id: 'm1', from: 'Render', subject: { en: 'Your September invoice is ready', fr: 'Ta facture de septembre est prête' }, read: false, starred: false, at: fromNow(0, -1) },
  { id: 'm2', from: 'Sofia Reyes', subject: { en: 'French copy for the Spaces settings page', fr: 'Textes en français pour la page des réglages des Spaces' }, read: false, starred: false, at: fromNow(0, -2) },
  { id: 'm3', from: 'Stripe', subject: { en: 'Payout of €2,480.00 on its way', fr: 'Virement de 2\u202f480,00\u00a0€ en route' }, read: false, starred: false, at: fromNow(0, -3) },
];

const MAIL_BAR = availableActions(resolveActions(MAIL_ACTIONS, MAIL_HANDLERS), MAILS).filter((action) => action.bulk);

const COPY = {
  slot: (px: number): SpecimenCopy => ({ en: `List ${px} px wide`, fr: `Liste de ${px} px de large` }),
} as const;

/**
 * List widths for the three fits: keys and words, words only (no keys), icons only. French words run longer
 * (the Mail pill is 840 px with keys in French, 652 px in English), so each language gets its own widths.
 */
const FIT_WIDTHS: Readonly<Record<Ctx['lang'], readonly number[]>> = { en: [720, 600, 360], fr: [900, 760, 360] };

/** Rows above the bar, the selected ones checked, so the pill reads in its place at the bottom of a list. */
function TicketRows({ ids, ctx, count = 3 }: { ids: readonly string[]; ctx: Ctx; count?: number }) {
  const { t } = ctx;
  return (
    <ListRows ids={TICKETS.slice(0, count).map((ticket) => ticket.id)} selected={ids} row={(id) => {
      const ticket = ticketById(id);
      return (
        <Row icon={{ status: ticket.status }} title={t(ticket.title)} meta={<TicketMeta ticket={ticket} t={t} />}
          owner={{ name: ticket.owner.name }} time={ticket.updated}
          trailing={ticket.starred ? <StarMark /> : undefined} />
      );
    }} />
  );
}

const MAIL_IDS = MAILS.map((mail) => mail.id);

function MailRows({ ctx }: { ctx: Ctx }) {
  return (
    <ListRows ids={MAIL_IDS} selected={MAIL_IDS} row={(id) => {
      const mail = MAILS.find((candidate) => candidate.id === id)!;
      return <Row icon="envelope-simple" title={ctx.t(mail.subject)} meta={mail.from} time={mail.at} />;
    }} />
  );
}

/** A list area `height` px tall (`width` px wide when given), `rows` on top and the bar's slot at its bottom. */
function Stage({ height, width, rows, children }: { height: number; width?: number; rows?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative bg-background" style={{ height, width }}>
      {rows && <div className="pt-2">{rows}</div>}
      {children}
    </div>
  );
}

function Bar<T>(props: { actions: readonly ResolvedAction<T>[]; count: number; busy?: ReadonlySet<string> }) {
  return <SelectionBar actions={props.actions} count={props.count} busy={props.busy} onClear={noop} onRun={noop} />;
}

const TWO = ['NB-418', 'NB-417'];

export const specimen = defineSpecimen({
  id: 'selection-bar',
  name: 'SelectionBar',
  group: 'lists',
  from: '@notis/sdk/ui',
  covers: ['SelectionBar'],
  summary: 'The pill at the bottom of a list while rows are selected: count, bulk actions with their keys, More and clear.',
  states: [
    {
      id: 'tickets',
      label: 'Two tickets selected: Complete, Star, Move to, Delete',
      height: 280,
      render: (ctx) => (
        <Stage height={inner(280)} rows={<TicketRows ids={TWO} ctx={ctx} />}>
          <Bar actions={ticketBar(TWO)} count={2} />
        </Stage>
      ),
    },
    {
      id: 'one',
      label: 'One selected, already starred: Unstar takes S',
      height: 280,
      render: (ctx) => (
        <Stage height={inner(280)} rows={<TicketRows ids={['NB-416']} ctx={ctx} />}>
          <Bar actions={ticketBar(['NB-416'])} count={1} />
        </Stage>
      ),
    },
    {
      id: 'many',
      label: 'Twelve selected, starred and not: the Star pair shows Star',
      height: 160,
      render: () => (
        <Stage height={inner(160)}>
          <Bar actions={ticketBar(TICKETS.slice(0, 12).map((ticket) => ticket.id))} count={12} />
        </Stage>
      ),
    },
    {
      id: 'busy',
      label: 'Complete running: its button is busy',
      height: 160,
      render: () => (
        <Stage height={inner(160)}>
          <Bar actions={ticketBar(TWO)} count={2} busy={new Set(['complete'])} />
        </Stage>
      ),
    },
    {
      id: 'overflow',
      label: 'Mail, seven actions: five in the pill, the rest in More',
      height: 260,
      render: (ctx) => (
        <Stage height={inner(260)} rows={<MailRows ctx={ctx} />}>
          <Bar actions={MAIL_BAR} count={3} />
        </Stage>
      ),
    },
    {
      id: 'overflow-menu',
      label: 'More open: Assign and Delete with their keys',
      height: 320,
      render: (ctx) => (
        <Stage height={inner(320)} rows={<MailRows ctx={ctx} />}>
          <Bar actions={MAIL_BAR} count={3} />
        </Stage>
      ),
      interact: async (root) => {
        await clickIn(root, '.nui-sb-btn:not([data-action])');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'fits',
      label: 'Where it does not fit: the keys go, then the words, and each button gets a tooltip with both',
      // The lists are drawn at set widths (up to 900 px in French), so the page is fixed wide enough to hold them.
      width: 1440,
      height: 360,
      render: (ctx) => (
        <div className="flex flex-col gap-3 bg-background">
          {FIT_WIDTHS[ctx.lang].map((px) => (
            <div key={px} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{ctx.t(COPY.slot(px))}</span>
              <Stage height={72} width={px}>
                <Bar actions={MAIL_BAR} count={3} />
              </Stage>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'phone',
      label: 'Phone width',
      width: 390,
      height: 280,
      render: (ctx) => (
        <Stage height={inner(280)} rows={<TicketRows ids={TWO} ctx={ctx} />}>
          <Bar actions={ticketBar(TWO)} count={2} />
        </Stage>
      ),
    },
    {
      id: 'dark',
      label: 'Dark theme',
      theme: 'dark',
      height: 280,
      render: (ctx) => (
        <Stage height={inner(280)} rows={<TicketRows ids={TWO} ctx={ctx} />}>
          <Bar actions={ticketBar(TWO)} count={2} />
        </Stage>
      ),
    },
  ],
});
