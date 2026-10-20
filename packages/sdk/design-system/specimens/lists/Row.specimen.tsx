import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { SHELL_WORDS } from '../../../src/words/index';
import { defineSpecimen, type SpecimenCopy, type SpecimenRenderContext } from '../../specimen';
import {
  IDLE_ROW_STATE, Icon, ListReader, Row, RowMore, STATUS_WORDS, StatusIcon, statusGroup,
  type ListReaderApi, type ListReaderProps, type RowLabel, type RowProps, type RowState, type StatusGroup,
} from '../../../src/ui';
import { dayFromNow, fromNow } from '../../fixtures/time';
import { LIST_COPY, LONG_TICKET, TICKETS, ticketById, type Ticket } from '../../fixtures/lists/tickets';
import {
  StarMark, TICKET_ACTIONS, TICKET_HANDLERS, TicketMeta, TicketReader, ticketCells, ticketColumns, ticketTile,
} from '../../fixtures/lists/views';
import { clickIn, inner, settle, waitForMenu } from '../../fixtures/lists/interact';
import { ListRows, type ListRowsProps } from '../../fixtures/lists/rows';

type Ctx = SpecimenRenderContext;


const COPY = {
  rest: { en: 'At rest', fr: 'Au repos' },
  hover: { en: 'Pointer over', fr: 'Sous le pointeur' },
  cursor: { en: 'Keyboard cursor', fr: 'Curseur clavier' },
  open: { en: 'Open in the reader', fr: 'Ouverte dans le lecteur' },
  selected: { en: 'Selected', fr: 'Sélectionnée' },
  openSelected: { en: 'Open and selected', fr: 'Ouverte et sélectionnée' },
  openCursor: { en: 'Open, cursor on it', fr: 'Ouverte, curseur dessus' },
  oneLine: { en: 'One line (default)', fr: 'Une ligne (par défaut)' },
  twoLines: { en: 'Two lines', fr: 'Deux lignes' },
  today: { en: 'Today, a moment', fr: 'Aujourd’hui, un instant' },
  todayDay: { en: 'Today, a day', fr: 'Aujourd’hui, un jour' },
  thisYear: { en: 'This year', fr: 'Cette année' },
  otherYear: { en: 'Another year', fr: 'Une autre année' },
  dayOnly: { en: 'A day (YYYY-MM-DD)', fr: 'Un jour (AAAA-MM-JJ)' },
  minutes: { en: '12 minutes before now', fr: '12 minutes avant now' },
  hours: { en: '2 hours before now', fr: '2 heures avant now' },
  days: { en: 'A day before now', fr: 'Un jour avant now' },
  later: { en: 'The same 12 minutes, now two days later', fr: 'Les mêmes 12 minutes, now deux jours plus tard' },
  alias: { en: 'Space status', fr: 'Statut du Space' },
  group: { en: 'Shown as', fr: 'Affiché comme' },
  overdue: { en: 'Overdue', fr: 'En retard' },
  blocked: { en: 'Blocked', fr: 'Bloqué' },
  shipped: { en: 'Shipped', fr: 'Livré' },
  beta: { en: 'In beta', fr: 'En bêta' },
  invoice: { en: 'Invoice from Render for September', fr: 'Facture de Render pour septembre' },
  invoiceMeta: { en: 'billing@render.com', fr: 'billing@render.com' },
  invoiceSnippet: {
    en: 'Your invoice for September 2026 is ready. Total due: $412.80, paid with the card ending in 4242.',
    fr: 'Ta facture de septembre 2026 est prête. Montant dû\u202f: 412,80\u00a0$, réglé avec la carte se terminant par 4242.',
  },
  health: { en: 'Website SQL connector', fr: 'Connecteur SQL du site' },
  healthMeta: { en: 'Checked every 5 minutes', fr: 'Vérifié toutes les 5 minutes' },
  standup: { en: 'Weekly product review', fr: 'Revue produit de la semaine' },
  standupMeta: { en: 'Notes · 6 people', fr: 'Notes · 6 personnes' },
  release: { en: 'Release the Spaces review build to Beta', fr: 'Publier la version de revue des Spaces sur la Beta' },
  releaseMeta: { en: 'Roadmap · Spaces', fr: 'Feuille de route · Spaces' },
  notes: { en: 'November release notes', fr: 'Notes de version de novembre' },
  notesMeta: { en: 'Changelog · Portal and Desktop', fr: 'Journal des versions · Portail et Desktop' },
} satisfies Record<string, SpecimenCopy>;

/** One ticket as a standalone Row (the list fixture's row, with the props a standalone row takes). */
function ticketRowAlone(ticket: Ticket, ctx: Ctx, extra: Partial<RowProps> = {}): ReactNode {
  const { t } = ctx;
  return (
    <Row icon={{ status: ticket.status }} title={t(ticket.title)} meta={<TicketMeta ticket={ticket} t={t} />}
      owner={{ name: ticket.owner.name }} time={ticket.updated} now={fromNow(0)}
      trailing={ticket.starred ? <StarMark /> : undefined} {...extra} />
  );
}

const at = (patch: Partial<RowState>): RowState => ({ ...IDLE_ROW_STATE, ...patch });

/**
 * Captioned rows: caption on the left, the row at list width (up to `rowWidth`) on the right. Where both do not fit
 * (a phone), the caption goes above its row and the row takes the whole width.
 */
function Gallery({ entries, ctx, rowWidth = 520 }: { entries: Array<[SpecimenCopy, ReactNode]>; ctx: Ctx; rowWidth?: number }) {
  return (
    <div className="flex flex-col gap-3 bg-background p-6">
      {entries.map(([caption, row], index) => (
        <div key={index} className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="w-44 shrink-0 text-xs text-muted-foreground">{ctx.t(caption)}</span>
          <div className="min-w-0" style={{ flex: '1 1 280px', maxWidth: rowWidth }}>{row}</div>
        </div>
      ))}
    </div>
  );
}

function RowStates({ ctx }: { ctx: Ctx }) {
  const ticket = ticketById('NB-416');
  // Every state as the Tickets list draws its row element: the More slot on each row, shown under the pointer and on
  // the cursor; the box in the icon's place under the pointer and when selected (a standalone Row has neither).
  const inList = (props: Partial<ListRowsProps>): ReactNode => (
    <ListRows ids={[ticket.id]} row={() => ticketRowAlone(ticket, ctx)} more={() => <MoreButton ctx={ctx} />} {...props} />
  );
  return (
    <Gallery ctx={ctx} entries={[
      [COPY.rest, inList({})],
      [COPY.hover, inList({ rowClassName: () => HOVER_ROW })],
      [COPY.cursor, inList({ cursor: ticket.id })],
      [COPY.open, inList({ open: ticket.id })],
      [COPY.selected, inList({ selected: [ticket.id] })],
      [COPY.openSelected, inList({ selected: [ticket.id], open: ticket.id })],
      [COPY.openCursor, inList({ open: ticket.id, cursor: ticket.id })],
    ]} />
  );
}

const ALL_GROUPS: readonly StatusGroup[] = ['backlog', 'todo', 'active', 'review', 'waiting', 'done', 'cancelled', 'failed', 'up', 'down'];
const ALIASES: readonly string[] = ['In progress', 'in_review', 'blocked', 'shipped', 'wont_do', 'operational', 'outage', 'Triage'];

function StatusGallery({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  return (
    <div className="flex flex-wrap gap-12 bg-background p-6">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {ALL_GROUPS.map((group) => (
          <li key={group} className="flex items-center gap-3 text-sm text-foreground">
            <StatusIcon status={group} />
            <span>{t(STATUS_WORDS[group])}</span>
          </li>
        ))}
      </ul>
      <table className="border-separate text-sm" style={{ borderSpacing: '24px 10px' }}>
        <thead>
          <tr className="text-left text-xs font-medium text-muted-foreground">
            <th className="font-medium">{t(COPY.alias)}</th>
            <th className="font-medium">{t(COPY.group)}</th>
          </tr>
        </thead>
        <tbody>
          {ALIASES.map((alias) => (
            <tr key={alias}>
              <td className="font-mono text-xs text-muted-foreground">{alias}</td>
              <td>
                <span className="inline-flex items-center gap-2 text-foreground">
                  <StatusIcon status={alias} decorative />
                  {t(STATUS_WORDS[statusGroup(alias)])}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rows other Spaces draw: a mail, a service, a note, a roadmap item with tones. */
function Anatomy({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const labels: RowLabel[] = [
    { label: COPY.overdue, tone: 'danger' }, { label: COPY.blocked, tone: 'warning' }, { label: COPY.beta, tone: 'info' },
  ];
  return (
    <div className="flex flex-col bg-background p-6" style={{ maxWidth: 760 }}>
      {ticketRowAlone(ticketById('NB-418'), ctx, { snippet: t(ticketById('NB-418').description) })}
      <Row icon="envelope-simple" title={t(COPY.invoice)} meta={t(COPY.invoiceMeta)} snippet={t(COPY.invoiceSnippet)}
        time={fromNow(0, -1.5)} />
      <Row icon={{ status: 'operational' }} title={t(COPY.health)} meta={t(COPY.healthMeta)}
        labels={[{ label: STATUS_WORDS.up, tone: 'success' }]} time={fromNow(0, -0.1)} />
      <Row icon="clock" title={t(COPY.standup)} meta={t(COPY.standupMeta)} owner={{ name: 'Sofia Reyes' }}
        time={dayFromNow(-3)} dateOnly />
      <Row icon={{ status: 'active' }} title={t(COPY.release)} meta={t(COPY.releaseMeta)} labels={labels}
        owner={{ name: 'Flo Pariset' }} time={fromNow(-40)} trailing={<StarMark />} />
      <Row icon={{ status: 'shipped' }} title={t(COPY.notes)} meta={t(COPY.notesMeta)}
        labels={[{ label: COPY.shipped, tone: 'success' }, 'v2.14']} time={new Date(Date.UTC(2025, 10, 28, 15, 10))} />
    </div>
  );
}

function Times({ ctx }: { ctx: Ctx }) {
  const ticket = ticketById('NB-415');
  return (
    <Gallery ctx={ctx} entries={[
      [COPY.today, ticketRowAlone(ticket, ctx, { time: fromNow(0, -3) })],
      [COPY.todayDay, ticketRowAlone(ticket, ctx, { time: dayFromNow(0), dateOnly: true })],
      [COPY.thisYear, ticketRowAlone(ticket, ctx, { time: fromNow(-104) })],
      [COPY.otherYear, ticketRowAlone(ticket, ctx, { time: new Date(Date.UTC(2025, 10, 28, 15, 10)) })],
      [COPY.dayOnly, ticketRowAlone(ticket, ctx, { time: '2026-03-02' })],
    ]} />
  );
}

/** Compact times against `now`: the book's clock, then a `now` two days on, which makes the 12 minutes read 2 days. */
function NowTimes({ ctx }: { ctx: Ctx }) {
  const ticket = ticketById('NB-415');
  return (
    <Gallery ctx={ctx} entries={[
      [COPY.minutes, ticketRowAlone(ticket, ctx, { time: fromNow(0, -0.2) })],
      [COPY.hours, ticketRowAlone(ticket, ctx, { time: fromNow(0, -2) })],
      [COPY.days, ticketRowAlone(ticket, ctx, { time: fromNow(-1) })],
      [COPY.later, ticketRowAlone(ticket, ctx, { time: fromNow(0, -0.2), now: fromNow(2) })],
    ]} />
  );
}

function LongTitles({ ctx, width = 520 }: { ctx: Ctx; width?: number }) {
  return (
    <Gallery ctx={ctx} rowWidth={width} entries={[
      [COPY.oneLine, ticketRowAlone(LONG_TICKET, ctx)],
      [COPY.twoLines, ticketRowAlone(LONG_TICKET, ctx, { wrap: 2 })],
      [COPY.twoLines, ticketRowAlone(LONG_TICKET, ctx, { wrap: 2, state: at({ open: true }) })],
    ]} />
  );
}

function StackOf({ ctx, compact = false }: { ctx: Ctx; compact?: boolean }) {
  return (
    <div className="bg-background p-6">
      <div data-density={compact ? 'compact' : undefined} style={{ maxWidth: 520 }}>
        {TICKETS.slice(0, 6).map((ticket, index) => (
          <Fragment key={ticket.id}>
            {ticketRowAlone(ticket, ctx, { state: index === 1 ? at({ cursor: true }) : undefined })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** The row-more button as the list draws it (ListReader's row menu trigger), for the drawn pointer-over row. */
function MoreButton({ ctx }: { ctx: Ctx }) {
  return (
    <button type="button" className="nui-row-more" tabIndex={-1} aria-label={ctx.t(SHELL_WORDS.more)}>
      <Icon name="dots-three" />
    </button>
  );
}

/** The pointer-over look on one list row element: the same rules as HOVER_NB416, scoped to the row itself. */
const HOVER_ROW = [
  '[--nui-row-rest:var(--nui-row-hover)]',
  '[&_.nui-row-more]:opacity-100!',
  '[&_.nui-row-check]:inline-flex!',
  '[&_.nui-row-icon]:hidden!',
].join(' ');

/**
 * The look a row takes under the pointer inside a list (checkbox in place of the status icon, the row-more button
 * shown), for NB-416. The book cannot hold a real pointer over a row, so these classes draw the same rules. The
 * toolkit's rules sit outside Tailwind's layers, so the overrides are marked important to win over them.
 */
const HOVER_NB416 = [
  '[&_[data-nui-item=NB-416]]:[--nui-row-rest:var(--nui-row-hover)]',
  '[&_[data-nui-item=NB-416]_.nui-row-more]:opacity-100!',
  '[&_[data-nui-item=NB-416]_.nui-row-check]:inline-flex!',
  '[&_[data-nui-item=NB-416]_.nui-row-icon]:hidden!',
].join(' ');

interface InListProps extends Partial<ListReaderProps<Ticket>> {
  ctx: Ctx;
  id: string;
  height: number;
  cursor?: string;
}

/** Rows inside a ListReader: the list draws the row element, its states, the checkbox and RowMore. */
function InList({ ctx, id, height, cursor, ...rest }: InListProps) {
  const { t } = ctx;
  const api = useRef<ListReaderApi>(null);
  useEffect(() => { if (cursor) api.current?.focus(cursor); }, [cursor]);
  return (
    <div className="relative flex flex-col bg-background" style={{ height: inner(height) }}>
      <ListReader<Ticket>
        items={TICKETS.slice(0, 8)}
        getId={(ticket) => ticket.id}
        row={(ticket) => ticketRowAlone(ticket, ctx)}
        reader={(ticket) => <TicketReader ticket={ticket} t={t} />}
        actions={TICKET_ACTIONS}
        handlers={TICKET_HANDLERS}
        openInUrl={false}
        apiRef={api}
        listId={`book-row-${id}`}
        label={LIST_COPY.tickets}
        {...rest}
      />
    </div>
  );
}

/** Rows with label badges (labels go first on a narrow list; a warning or danger label stays). */
function labelledRow(ctx: Ctx) {
  return (ticket: Ticket) => {
    const labels: RowLabel[] = ticket.labels.map((label) => ({ label }));
    if (ticket.priority === 'urgent') labels.unshift({ label: COPY.overdue, tone: 'danger' });
    return ticketRowAlone(ticket, ctx, { meta: ticket.id, labels });
  };
}

export const specimen = defineSpecimen({
  id: 'row',
  name: 'Row',
  group: 'lists',
  from: '@notis/sdk/ui',
  covers: ['Row', 'RowMore', 'StarMark', 'StatusIcon'],
  summary: 'One list row: status, title, meta, snippet, labels, owner, time and the row-more menu, in every state a list gives it.',
  states: [
    {
      id: 'states',
      label: 'Row states: at rest, pointer over, cursor, open, selected',
      render: (ctx) => <RowStates ctx={ctx} />,
    },
    {
      id: 'in-list',
      label: 'In a list: two selected, the cursor on NB-414, the pointer over NB-416',
      height: 440,
      render: (ctx) => (
        <InList ctx={ctx} id="in-list" height={440} cursor="NB-414" selected={['NB-418', 'NB-415']} className={HOVER_NB416} />
      ),
    },
    {
      id: 'in-list-open',
      label: 'In a list with the reader: open row, cursor on another',
      height: 440,
      render: (ctx) => <InList ctx={ctx} id="in-list-open" height={440} cursor="NB-414" open="NB-417" onOpenChange={() => undefined} />,
    },
    {
      id: 'row-menu',
      label: 'RowMore menu of a list row',
      height: 480,
      render: (ctx) => <InList ctx={ctx} id="row-menu" height={480} cursor="NB-416" />,
      interact: async (root) => {
        await clickIn(root, '[data-nui-item="NB-416"] .nui-row-more');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'tile-more',
      label: 'RowMore placed by hand in a tile, its menu open',
      height: 520,
      render: (ctx) => (
        <InList ctx={ctx} id="tile-more" height={520} layout="tiles" cursor="NB-416" openAs={['center', 'full']}
          row={(ticket) => ticketTile(ticket, ctx.t, ctx.lang, <RowMore />)} />
      ),
      interact: async (root) => {
        await clickIn(root, '[data-nui-item="NB-416"] .nui-row-more');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'table-more',
      label: 'RowMore placed by hand in the last table cell',
      height: 420,
      render: (ctx) => (
        <InList ctx={ctx} id="table-more" height={420} layout="table" cursor="NB-417" openAs={['center', 'full']}
          columns={ticketColumns(ctx.t)} row={(ticket) => ticketCells(ticket, ctx.t, ctx.lang, <RowMore />)} />
      ),
    },
    {
      id: 'content',
      label: 'Content: snippet, labels and tones, owner, time, trailing StarMark',
      render: (ctx) => <Anatomy ctx={ctx} />,
    },
    {
      id: 'status-icons',
      label: 'StatusIcon: the ten groups and how Space statuses map to them',
      render: (ctx) => <StatusGallery ctx={ctx} />,
    },
    {
      id: 'times',
      label: 'Time: clock time today, day this year, full date before',
      render: (ctx) => <Times ctx={ctx} />,
    },
    {
      id: 'long-title',
      label: 'Long title: one line with an ellipsis, or two lines',
      render: (ctx) => <LongTitles ctx={ctx} />,
    },
    {
      id: 'now',
      label: 'now: the clock a row reads its time against (12m, 2h, 1d), and the same row two days later',
      render: (ctx) => <NowTimes ctx={ctx} />,
    },
    {
      id: 'now-phone',
      label: 'Phone width: compact times beside the avatar',
      width: 390,
      render: (ctx) => <NowTimes ctx={ctx} />,
    },
    {
      id: 'compact',
      label: 'Compact density',
      render: (ctx) => <StackOf ctx={ctx} compact />,
    },
    {
      id: 'narrow',
      label: 'Phone width: labels give way, a danger label stays, then the avatar goes',
      width: 390,
      height: 560,
      render: (ctx) => <InList ctx={ctx} id="narrow" height={560} row={labelledRow(ctx)} cursor="NB-413" />,
    },
    {
      id: 'wide-labels',
      label: 'The same rows at full width with every label',
      height: 440,
      render: (ctx) => <InList ctx={ctx} id="wide-labels" height={440} row={labelledRow(ctx)} cursor="NB-413" />,
    },
    {
      id: 'dark',
      label: 'Dark theme: row states',
      theme: 'dark',
      render: (ctx) => <RowStates ctx={ctx} />,
    },
    {
      id: 'dark-status',
      label: 'Dark theme: status icons',
      theme: 'dark',
      render: (ctx) => <StatusGallery ctx={ctx} />,
    },
  ],
});
