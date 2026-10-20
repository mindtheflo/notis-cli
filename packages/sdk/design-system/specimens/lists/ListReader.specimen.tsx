import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenRenderContext } from '../../specimen';
import { NotisProvider, type NotisRuntime } from '../../../src';
import {
  EmptyState, ListReader, Notice, RowMore, STATUS_WORDS,
  type ListReaderApi, type ListReaderProps, type ReaderAction, type ReaderCtx, type TabRowProps, type ViewMenuProps,
} from '../../../src/ui';
import { STANDARD_ACTIONS } from '../../../src/words';
import { bookRuntime } from '../../fixtures/documents/runtimes';
import { LIST_COPY, LONG_TICKET, TICKETS, TICKETS_BY_STATUS, ticketById, type Ticket } from '../../fixtures/lists/tickets';
import {
  NO_TICKET_COUNTS, TICKET_ACTIONS, TICKET_CREATE, TICKET_HANDLERS, TICKET_TABS, TicketReader, ticketCells,
  ticketColumns, ticketReaderActions, ticketRow, ticketTabItems, ticketTile, ticketTileParts, type TicketCounts,
  type TicketTab,
} from '../../fixtures/lists/views';
import { clickIn, inner, layerScope, settle, waitFor, waitForMenu } from '../../fixtures/lists/interact';

type Ctx = SpecimenRenderContext;

/** The frame height of the full-size states: the list and reader fill it. */
const TALL = 640;

/** Tall enough for every status group, so the folded Done and Cancelled headings show. */
const GROUPED = 980;

interface DemoProps extends Partial<Omit<ListReaderProps<Ticket>, 'open' | 'selected'>> {
  ctx: Ctx;
  /** One list id per state, so an open mode a reviewer picks stays with that state. */
  id: string;
  height?: number;
  /** The open ticket at first (controlled after that). */
  initialOpen?: string | null;
  initialSelected?: readonly string[];
  /** Puts the keyboard cursor on this ticket without opening it. */
  cursor?: string;
  /** False: no filter pills (the toolbar then shows `title` alone). */
  withTabs?: boolean;
  /** Extra filter pill options (`maxVisible`, `lead`). */
  tabOptions?: Partial<Omit<TabRowProps<string>, 'end' | 'items' | 'value' | 'onChange' | 'role'>>;
  /** Fixed items instead of the filter tab's. */
  fixedItems?: readonly Ticket[];
  /** The filter tab at first. */
  initialTab?: TicketTab;
  /** The tab counts; null hides them. Default: the fixture's 16, 12 and 4. */
  counts?: TicketCounts | null;
}

/**
 * The Tickets list of the Product Space as the deck shows it: All, Open and Mine pills with "+" New ticket (N), rows,
 * and the reader with its bar (the ticket id, then Complete (E) and Star).
 */
function TicketsDemo({
  ctx, id, height = TALL, initialOpen = null, initialSelected = [], cursor, withTabs = true, tabOptions, fixedItems,
  initialTab = 'all', counts = undefined, ...rest
}: DemoProps) {
  const { t } = ctx;
  const [tab, setTab] = useState<TicketTab>(initialTab);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [selected, setSelected] = useState<readonly string[]>(initialSelected);
  const api = useRef<ListReaderApi>(null);
  useEffect(() => { if (cursor) api.current?.focus(cursor); }, [cursor]);
  const items = fixedItems ?? TICKET_TABS[tab];
  return (
    <div className="relative flex flex-col bg-background" style={{ height: inner(height) }}>
      <ListReader<Ticket>
        items={items}
        getId={(ticket) => ticket.id}
        row={(ticket) => ticketRow(ticket, t)}
        reader={(ticket) => <TicketReader ticket={ticket} t={t} />}
        readerLabel={(ticket) => ticket.id}
        readerActions={ticketReaderActions}
        actions={TICKET_ACTIONS}
        handlers={TICKET_HANDLERS}
        tabs={withTabs ? {
          role: 'filter', items: ticketTabItems(counts), value: tab, label: LIST_COPY.tickets,
          onChange: (next) => { setTab(next as TicketTab); }, ...tabOptions,
        } : undefined}
        create={TICKET_CREATE}
        open={open}
        onOpenChange={(next) => { setOpen(next); }}
        selected={selected}
        onSelectedChange={setSelected}
        openInUrl={false}
        apiRef={api}
        listId={`book-${id}`}
        label={LIST_COPY.tickets}
        {...rest}
      />
    </div>
  );
}

/** Keeps the open ticket: the reader is saving, so Close and the other rows say why. */
function KeptOpenDemo({ ctx }: { ctx: Ctx }) {
  return <TicketsDemo ctx={ctx} id="kept-open" initialOpen="NB-417" onOpenChange={() => LIST_COPY.saving} />;
}

/** A status grouping with Done folded away. */
function GroupedDemo({ ctx }: { ctx: Ctx }) {
  const [collapsed, setCollapsed] = useState<readonly string[]>(['done', 'cancelled']);
  return (
    <TicketsDemo ctx={ctx} id="grouped" height={GROUPED} fixedItems={TICKETS_BY_STATUS} collapsible collapsed={collapsed}
      onCollapsedChange={setCollapsed} groupBy={(ticket) => ({ id: ticket.status, label: STATUS_WORDS[ticket.status] })} />
  );
}

function tableRow(ctx: Ctx) {
  return (ticket: Ticket) => ticketCells(ticket, ctx.t, ctx.lang, <RowMore />);
}

function tileRow(ctx: Ctx) {
  return (ticket: Ticket) => ticketTile(ticket, ctx.t, ctx.lang, <RowMore />);
}

const noop = () => undefined;

/** Recent tickets plus the locked NB-405, so the pending and the disabled rows are both on screen. */
const PENDING_ITEMS: readonly Ticket[] = ['NB-418', 'NB-417', 'NB-416', 'NB-415', 'NB-414', 'NB-413', 'NB-405', 'NB-404'].map(ticketById);

function ErrorNotice({ ctx }: { ctx: Ctx }): ReactNode {
  return <div className="w-full max-w-md px-6"><Notice tone="danger" onRetry={noop}>{ctx.t(LIST_COPY.loadFailed)}</Notice></div>;
}

const COPY = {
  sort: { en: 'Sort', fr: 'Trier' },
  group: { en: 'Group', fr: 'Grouper' },
  noGroup: { en: 'No grouping', fr: 'Aucun groupe' },
  list: { en: 'List', fr: 'Liste' },
  table: { en: 'Table', fr: 'Tableau' },
  tiles: { en: 'Tiles', fr: 'Tuiles' },
  viewDescription: { en: 'Every ticket of the Product Space, newest first.', fr: 'Tous les tickets du Space Produit, les plus récents d’abord.' },
  refreshView: { en: 'Refresh the tickets', fr: 'Actualiser les tickets' },
  synced: { en: 'Synced from Linear 2 min ago.', fr: 'Synchronisé depuis Linear il y a 2 min.' },
  product: { en: 'Product', fr: 'Produit' },
  topBar: { en: 'Top bar title', fr: 'Titre de la barre du haut' },
  assign: { en: 'Assign', fr: 'Attribuer' },
  later: { en: 'Later', fr: 'Plus tard' },
  copyLink: { en: 'Copy link', fr: 'Copier le lien' },
} satisfies Record<string, SpecimenCopy>;

type Sort = 'updated' | 'priority' | 'created';
type Layout = 'list' | 'table' | 'tiles';

/** The view menu: Sort (Updated, Priority, Created), Group (none or status), the layout switch and a description. */
function useViewMenu(): [ViewMenuProps, { sort: Sort; grouped: boolean; layout: Layout }] {
  const [sort, setSort] = useState<Sort>('updated');
  const [grouped, setGrouped] = useState(false);
  const [layout, setLayout] = useState<Layout>('list');
  const menu = useMemo<ViewMenuProps>(() => ({
    sort: (['updated', 'priority', 'created'] as const).map((value) => ({
      id: value, label: LIST_COPY[value], checked: sort === value, onSelect: () => { setSort(value); },
    })),
    group: [
      { id: 'none', label: COPY.noGroup, checked: !grouped, onSelect: () => { setGrouped(false); } },
      { id: 'status', label: LIST_COPY.status, checked: grouped, onSelect: () => { setGrouped(true); } },
    ],
    layout: {
      value: layout,
      options: [
        { value: 'list', label: COPY.list },
        { value: 'table', label: COPY.table },
        { value: 'tiles', label: COPY.tiles },
      ],
      onChange: (value) => { setLayout(value as Layout); },
    },
    actions: [{ id: 'refresh', label: COPY.refreshView, icon: 'arrow-clockwise', onSelect: () => {} }],
    description: COPY.viewDescription,
  }), [sort, grouped, layout]);
  return [menu, { sort, grouped, layout }];
}

/** A titled list with no pills: "Tickets 16", then "+" and the view menu. */
function TitledDemo({ ctx, id, ...rest }: { ctx: Ctx; id: string } & Partial<DemoProps>) {
  const [viewMenu, view] = useViewMenu();
  return (
    <TicketsDemo ctx={ctx} id={id} withTabs={false} title={{ text: LIST_COPY.tickets, count: TICKETS.length }}
      viewMenu={viewMenu}
      groupBy={view.grouped ? (ticket) => ({ id: ticket.status, label: STATUS_WORDS[ticket.status] }) : undefined}
      {...rest} />
  );
}

/** Five bar buttons: three show (Complete, Star, Assign) and Later and Copy link fold into More. */
function fiveActions(ticket: Ticket, ctx: ReaderCtx<Ticket>): ReaderAction[] {
  return [
    ...ticketReaderActions(ticket, ctx),
    { id: 'assign', label: COPY.assign, icon: 'user-plus', key: 'a', labelled: false, run: noop },
    { id: 'later', label: COPY.later, icon: STANDARD_ACTIONS.later.icon, run: noop },
    { id: 'copy-link', label: COPY.copyLink, icon: 'arrow-bend-up-right', run: noop },
  ];
}

/**
 * crumbLabel: the open ticket's id joins the host's top bar title. The book has no host top bar, so a runtime catches
 * the leaf the list sends and a caption draws the title the Portal would show.
 */
function CrumbDemo({ ctx }: { ctx: Ctx }) {
  const [leaf, setLeaf] = useState<string | null>(null);
  const runtime = useMemo<NotisRuntime>(() => ({
    ...bookRuntime(ctx.lang), setTopBarTitleLeaf: (next) => { setLeaf(next?.label ?? null); },
  }), [ctx.lang]);
  const crumbs = [ctx.t(COPY.product), ctx.t(LIST_COPY.tickets), ...(leaf ? [leaf] : [])];
  return (
    <NotisProvider runtime={runtime}>
      <div className="flex h-11 items-center gap-2 border-b border-border px-4 text-sm" aria-label={ctx.t(COPY.topBar)}>
        {crumbs.map((crumb, index) => (
          <span key={`${index}-${crumb}`} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true" className="text-muted-foreground">/</span>}
            <span className={index === crumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'}>{crumb}</span>
          </span>
        ))}
      </div>
      <TicketsDemo ctx={ctx} id="crumb-label" height={TALL - 44} initialOpen="NB-417"
        crumbLabel={(ticket) => `${ticket.id} ${ctx.t(ticket.title)}`} />
    </NotisProvider>
  );
}

/** autoOpen beside the list: the first ticket opens by itself, and after a close the reader says how to pick one. */
function AutoOpenDemo({ ctx, id }: { ctx: Ctx; id: string }) {
  const { t } = ctx;
  return (
    <div className="relative flex flex-col bg-background" style={{ height: inner(TALL) }}>
      <ListReader<Ticket>
        items={TICKETS}
        getId={(ticket) => ticket.id}
        row={(ticket) => ticketRow(ticket, t)}
        reader={(ticket) => <TicketReader ticket={ticket} t={t} />}
        readerLabel={(ticket) => ticket.id}
        readerActions={ticketReaderActions}
        actions={TICKET_ACTIONS}
        handlers={TICKET_HANDLERS}
        title={{ text: LIST_COPY.tickets, count: TICKETS.length }}
        create={TICKET_CREATE}
        autoOpen
        openInUrl={false}
        listId={`book-${id}`}
        label={LIST_COPY.tickets}
      />
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'list-reader',
  name: 'ListReader',
  group: 'lists',
  from: '@notis/sdk/ui',
  covers: ['ListReader'],
  summary: 'A list of rows with a reader for the open one: keys, selection, actions, toast and open modes in one piece.',
  states: [
    {
      id: 'reader-side',
      label: 'List and reader side by side (Tickets, NB-417 open)',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="reader-side" initialOpen="NB-417" />,
    },
    {
      id: 'list-only',
      label: 'List alone, nothing open',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="list-only" />,
    },
    {
      id: 'cursor',
      label: 'Keyboard cursor on NB-415, reader closed',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="cursor" cursor="NB-415" />,
    },
    {
      id: 'compact',
      label: 'Compact density',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="compact" density="compact" initialOpen="NB-418" />,
    },
    {
      id: 'selected',
      label: 'Two rows selected: checkboxes and the selection bar',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="selected" initialSelected={['NB-417', 'NB-415']} />,
    },
    {
      id: 'marquee',
      label: 'Drag to select: a marquee from empty space selects the rows under it, live',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="marquee" withTabs={false} title={{ text: LIST_COPY.tickets }}
        fixedItems={TICKETS.slice(0, 5)} />,
      interact: async (root) => {
        // Press on the empty space under the rows and drag up over three of them, without letting go.
        const scroll = await waitFor(root, '.nui-lr-scroll');
        const rows = scroll.querySelectorAll<HTMLElement>('[data-nui-item]');
        const box = scroll.getBoundingClientRect();
        const last = rows[rows.length - 1]!.getBoundingClientRect();
        const second = rows[1]!.getBoundingClientRect();
        const view = root.ownerDocument.defaultView!;
        const at = (x: number, y: number) => ({ bubbles: true, cancelable: true, composed: true, button: 0, clientX: x, clientY: y });
        const from: [number, number] = [box.left + box.width * 0.62, Math.min(last.bottom + 56, box.bottom - 8)];
        scroll.dispatchEvent(new view.MouseEvent('mousedown', at(...from)));
        root.ownerDocument.dispatchEvent(new view.MouseEvent('mousemove', at(from[0] - 8, from[1] - 8)));
        root.ownerDocument.dispatchEvent(new view.MouseEvent('mousemove', at(box.left + 48, second.top + second.height / 2)));
        await waitFor(root, '.nui-marquee');
        await settle(4);
      },
    },
    {
      id: 'selected-open',
      label: 'Selection while a ticket is open',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="selected-open" initialOpen="NB-418" initialSelected={['NB-418', 'NB-414', 'NB-413']} />,
    },
    {
      id: 'toast',
      label: 'After Complete on two rows: the toast with Undo',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="toast" initialSelected={['NB-417', 'NB-415']} />,
      interact: async (root) => {
        await clickIn(root, '.nui-sb-btn[data-action="complete"]');
        await waitFor(root, '.nui-toast');
        await settle(4);
      },
    },
    {
      id: 'row-menu',
      label: 'Row menu open: actions, keys and the Move to picker',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="row-menu" cursor="NB-416" />,
      interact: async (root) => {
        await clickIn(root, '[data-nui-item="NB-416"] .nui-row-more');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'reader-menu',
      label: 'Reader bar More menu open',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="reader-menu" initialOpen="NB-417" />,
      interact: async (root) => {
        await clickIn(root, '.nui-lr-bar [data-part="more"]');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'open-as-menu',
      label: 'Open as menu: side, center or full page',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="open-as-menu" initialOpen="NB-418" />,
      interact: async (root) => {
        await clickIn(root, '.nui-lr-bar [data-part="mode"]');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'center',
      label: 'Center peek over the list',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="center" initialOpen="NB-414" openAs={['center', 'side', 'full']} />,
    },
    {
      id: 'full',
      label: 'Full page reader with Back',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="full" initialOpen="NB-414" openAs={['full', 'side', 'center']} />,
    },
    {
      id: 'long-title',
      label: 'Long title in the row and the reader',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="long-title" fixedItems={[LONG_TICKET, ...TICKETS.slice(0, 7)]} initialOpen={LONG_TICKET.id} />
      ),
    },
    {
      id: 'grouped',
      label: 'Grouped by status, Done and Cancelled folded',
      height: GROUPED,
      render: (ctx) => <GroupedDemo ctx={ctx} />,
    },
    {
      id: 'table',
      label: 'Table layout with columns and the row menu cell',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="table" layout="table" columns={ticketColumns(ctx.t)} row={tableRow(ctx)}
          openAs={['center', 'full']} cursor="NB-417" />
      ),
    },
    {
      id: 'tiles',
      label: 'Tiles layout',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="tiles" layout="tiles" row={tileRow(ctx)} openAs={['center', 'full']} cursor="NB-416" />
      ),
    },
    {
      id: 'tile-parts',
      label: 'Tiles from renderTile: mark, title, id, body, priority and the date with the assignee',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="tile-parts" layout="tiles" renderTile={(ticket) => ticketTileParts(ticket, ctx.t, ctx.lang)}
          openAs={['center', 'full']} />
      ),
    },
    {
      id: 'tile-parts-phone',
      label: 'Phone: renderTile tiles in one column',
      width: 390,
      height: 720,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="tile-parts-phone" height={720} layout="tiles"
          renderTile={(ticket) => ticketTileParts(ticket, ctx.t, ctx.lang)} openAs={['center', 'full']} />
      ),
    },
    {
      id: 'title-toolbar',
      label: 'Toolbar without pills: the title and count, then "+" and the view menu',
      height: TALL,
      render: (ctx) => <TitledDemo ctx={ctx} id="title-toolbar" />,
    },
    {
      id: 'view-menu',
      label: 'View menu open: Sort, Group, the layout switch, a view action and a description',
      height: TALL,
      render: (ctx) => <TitledDemo ctx={ctx} id="view-menu" />,
      interact: async (root) => {
        await clickIn(root, '[data-part="view-menu"]');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'tabs-lead',
      label: 'Pills after the title (lead), two shown and the rest in More, with "+" at the end',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="tabs-lead" title={{ text: LIST_COPY.tickets }} tabOptions={{ maxVisible: 2 }} />
      ),
    },
    {
      id: 'info-line',
      label: 'An info line under the toolbar',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="info-line" infoLine={<span className="text-xs text-muted-foreground">{ctx.t(COPY.synced)}</span>} />
      ),
    },
    {
      id: 'reader-bar',
      label: 'Reader bar order: close, open as, previous, next, the label, three actions, then More',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="reader-bar" initialOpen="NB-416" readerActions={fiveActions} />,
    },
    {
      id: 'reader-bar-more',
      label: 'Reader bar: the actions past three fold into More, above the item\'s own actions',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="reader-bar-more" initialOpen="NB-416" readerActions={fiveActions} />,
      interact: async (root) => {
        await clickIn(root, '.nui-lr-bar [data-part="more"]');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'reader-bar-disabled',
      label: 'ReaderAction disabled: Assign is dimmed and neither its click nor its key runs it',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="reader-bar-disabled" initialOpen="NB-416"
          readerActions={(ticket, readerCtx) => fiveActions(ticket, readerCtx)
            .map((action) => (action.id === 'assign' ? { ...action, disabled: true } : action))} />
      ),
    },
    {
      id: 'reader-bar-pending',
      label: 'The open ticket is saving (isPending): every reader action is disabled until it lands',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="reader-bar-pending" fixedItems={PENDING_ITEMS} initialOpen="NB-418"
          isPending={(ticket) => ticket.id === 'NB-418'} readerActions={fiveActions} />
      ),
    },
    {
      id: 'two-tone',
      label: 'Two-tone look: the list on the muted tone, the reader on the page',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="two-tone" look="two-tone" initialOpen="NB-417" />,
    },
    {
      id: 'two-tone-dark',
      label: 'Two-tone look, dark theme',
      theme: 'dark',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="two-tone-dark" look="two-tone" initialOpen="NB-417" />,
    },
    {
      id: 'auto-open',
      label: 'autoOpen: the first ticket opens beside the list (on a phone, where the reader would cover the list, nothing opens)',
      height: TALL,
      render: (ctx) => <AutoOpenDemo ctx={ctx} id="auto-open" />,
    },
    {
      id: 'auto-open-closed',
      label: 'autoOpen after a close: the reader says how to pick one (beside the list only, fixed 1440 px wide)',
      width: 1440,
      height: TALL,
      render: (ctx) => <AutoOpenDemo ctx={ctx} id="auto-open-closed" />,
      interact: async (root) => {
        await clickIn(root, '.nui-lr-bar [data-part="close"]');
        await waitFor(root, '.nui-lr-pick');
        await settle(4);
      },
    },
    {
      id: 'crumb-label',
      label: 'crumbLabel: the open ticket joins the top bar title',
      height: TALL,
      render: (ctx) => <CrumbDemo ctx={ctx} />,
    },
    {
      id: 'pending-disabled',
      label: 'A pending row (NB-418 saving) and a disabled one (NB-405 locked)',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="pending-disabled" fixedItems={PENDING_ITEMS} isPending={(ticket) => ticket.id === 'NB-418'}
          isDisabled={(ticket) => ticket.id === 'NB-405'} />
      ),
    },
    {
      id: 'kept-open',
      label: 'Close refused while the reader saves: the list says why',
      height: TALL,
      render: (ctx) => <KeptOpenDemo ctx={ctx} />,
      interact: async (root) => {
        await clickIn(root, '.nui-lr-bar [data-part="close"]');
        await waitFor(root, '.nui-toast');
        await settle(4);
      },
    },
    {
      id: 'not-found',
      label: 'The open id is not in the list',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="not-found" initialOpen="NB-999" />,
    },
    {
      id: 'footer',
      label: 'Footer with the page range',
      height: TALL,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="footer" footer={<span className="text-sm text-muted-foreground tabular-nums">{ctx.t(LIST_COPY.pageOf)}</span>} />
      ),
    },
    {
      id: 'has-more',
      label: 'More to load',
      height: 480,
      render: (ctx) => <TicketsDemo ctx={ctx} id="has-more" height={480} fixedItems={TICKETS.slice(0, 5)} hasMore onLoadMore={noop} />,
    },
    {
      id: 'loading-more',
      label: 'Loading the next page',
      height: 480,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="loading-more" height={480} fixedItems={TICKETS.slice(0, 5)} hasMore loadingMore onLoadMore={noop} />
      ),
    },
    {
      id: 'loading',
      label: 'First load: skeleton rows',
      height: 480,
      render: (ctx) => <TicketsDemo ctx={ctx} id="loading" height={480} fixedItems={[]} counts={null} loading />,
    },
    {
      id: 'refreshing',
      label: 'Refreshing with rows on screen',
      height: 480,
      render: (ctx) => <TicketsDemo ctx={ctx} id="refreshing" height={480} fixedItems={TICKETS.slice(0, 6)} loading />,
    },
    {
      id: 'empty-default',
      label: 'Empty, the default words',
      height: 360,
      render: (ctx) => <TicketsDemo ctx={ctx} id="empty-default" height={360} fixedItems={[]} counts={NO_TICKET_COUNTS} />,
    },
    {
      id: 'empty-custom',
      label: 'Empty Open tab, the Space\'s own words (3 tickets, all done)',
      height: 360,
      render: (ctx) => (
        <TicketsDemo ctx={ctx} id="empty-custom" height={360} fixedItems={[]} initialTab="open"
          counts={{ all: 3, open: 0, mine: 0 }} empty={<EmptyState title={LIST_COPY.noTickets} body={LIST_COPY.noTicketsBody} />} />
      ),
    },
    {
      id: 'error',
      label: 'The list did not load: a notice with Retry',
      height: 360,
      render: (ctx) => <TicketsDemo ctx={ctx} id="error" height={360} fixedItems={[]} counts={null} empty={<ErrorNotice ctx={ctx} />} />,
    },
    {
      id: 'tablet',
      label: 'Tablet width with a ticket open',
      width: 768,
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="tablet" initialOpen="NB-417" />,
    },
    {
      id: 'phone-list',
      label: 'Phone: the list',
      width: 390,
      height: 720,
      render: (ctx) => <TicketsDemo ctx={ctx} id="phone-list" height={720} />,
    },
    {
      id: 'phone-reader',
      label: 'Phone: the reader covers the list, with Back',
      width: 390,
      height: 720,
      render: (ctx) => <TicketsDemo ctx={ctx} id="phone-reader" height={720} initialOpen="NB-417" />,
    },
    {
      id: 'phone-selected',
      label: 'Phone: selection bar',
      width: 390,
      height: 720,
      render: (ctx) => <TicketsDemo ctx={ctx} id="phone-selected" height={720} initialSelected={['NB-418', 'NB-417', 'NB-413']} />,
    },
    {
      id: 'dark',
      label: 'Dark theme, ticket open and two selected',
      theme: 'dark',
      height: TALL,
      render: (ctx) => <TicketsDemo ctx={ctx} id="dark" initialOpen="NB-416" initialSelected={['NB-416', 'NB-411']} />,
    },
  ],
});

// Keeps the fixture lookup honest: every id the states open exists (NB-999 is the not-found state on purpose).
void ['NB-417', 'NB-418', 'NB-414', 'NB-416', 'NB-415', 'NB-413', 'NB-411', 'NB-405'].map(ticketById);
void layerScope;
