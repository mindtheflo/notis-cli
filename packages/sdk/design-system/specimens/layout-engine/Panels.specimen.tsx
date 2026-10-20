import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { FIXED_NOW, defineSpecimen, nextFrame, type SpecimenRenderContext } from '../../specimen';
import {
  Button, IDLE_ROW_STATE, Panels, Row, STATUS_WORDS, formatRowTime, statusGroup, usePanels,
} from '../../../src/ui';
import { SHELL_WORDS } from '../../../src/words';
import { ALL_TICKETS, LONG_TICKET, TICKETS, TICKETS_TITLE, type Ticket } from '../../fixtures/layout-engine/tickets';

type Lang = SpecimenRenderContext['lang'];
type T = SpecimenRenderContext['t'];

const UPDATED = { en: 'Updated', fr: 'Mis à jour' };

/** The open ticket, as a Space draws its reader. `ownBack` draws a Back of its own in stacked mode. */
function TicketReader({ ticket, lang, t, ownBack }: { ticket: Ticket; lang: Lang; t: T; ownBack?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-4">
      {ownBack ? <ReaderBack onBack={ownBack} /> : null}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{ticket.key}</span>
        <span aria-hidden="true">·</span>
        <span>{t(STATUS_WORDS[statusGroup(ticket.status)])}</span>
      </div>
      <h2 className="mt-2 text-lg font-semibold leading-7 text-foreground">{t(ticket.title)}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {ticket.owner}
        {' · '}
        {t(UPDATED)} {formatRowTime(ticket.updated, lang, new Date(FIXED_NOW))}
      </p>
      <div className="mt-4 grid gap-3 text-sm leading-6 text-foreground">
        {t(ticket.body).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
    </div>
  );
}

/** A Back the reader draws itself, read from `usePanels().mode`: only when the reader covers the list. */
function ReaderBack({ onBack }: { onBack: () => void }) {
  const { mode } = usePanels();
  if (mode !== 'stacked') return null;
  return (
    <div className="-ml-2 mb-2">
      <Button variant="ghost" size="sm" icon="arrow-left" onClick={onBack}>{SHELL_WORDS.back}</Button>
    </div>
  );
}

function TicketList({ tickets, openId, onOpen, t }: {
  tickets: readonly Ticket[]; openId: string | null; onOpen: (id: string) => void; t: T;
}) {
  const onKey = (id: string) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(id); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="text-sm font-semibold text-foreground">{t(TICKETS_TITLE)}</span>
        <span className="text-xs text-muted-foreground">{tickets.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {tickets.map((ticket) => (
          <div key={ticket.id} role="button" tabIndex={0} aria-current={ticket.id === openId ? 'true' : undefined}
            className="cursor-pointer rounded-md" onClick={() => onOpen(ticket.id)} onKeyDown={onKey(ticket.id)}>
            <Row
              icon={{ status: ticket.status }}
              title={t(ticket.title)}
              meta={ticket.key}
              labels={ticket.labels.map((label) => ({ label: label.label, tone: label.tone }))}
              owner={{ name: ticket.owner }}
              time={ticket.updated}
              state={{ ...IDLE_ROW_STATE, open: ticket.id === openId }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface DemoProps {
  ctx: SpecimenRenderContext;
  open: string | null;
  tickets?: readonly Ticket[];
  /** Panels draws Back (stacked) and Esc goes back. Default true. */
  back?: boolean;
  /** The reader draws its own Back instead (`onBack` left out). */
  ownBack?: boolean;
  listMin?: number;
  readerMin?: number;
  defaultReaderWidth?: number;
  resizable?: boolean;
  height?: number;
}

/** Tickets in Panels: click a row (or Enter) to open it, Back or Esc to close it. */
function TicketsPanels({
  ctx, open, tickets = TICKETS, back = true, ownBack = false, listMin, readerMin, defaultReaderWidth, resizable,
  height = 520,
}: DemoProps): ReactNode {
  const [openId, setOpenId] = useState<string | null>(open);
  const ticket = tickets.find((entry) => entry.id === openId) ?? null;
  const close = () => setOpenId(null);
  return (
    <div style={{ height, display: 'flex' }}>
      <Panels
        list={<TicketList tickets={tickets} openId={openId} onOpen={setOpenId} t={ctx.t} />}
        reader={ticket
          ? <TicketReader ticket={ticket} lang={ctx.lang} t={ctx.t} ownBack={ownBack ? close : undefined} />
          : null}
        listMin={listMin}
        readerMin={readerMin}
        defaultReaderWidth={defaultReaderWidth}
        resizable={resizable}
        onBack={back && !ownBack ? close : undefined}
      />
    </div>
  );
}

const FIRST = TICKETS[0]!.id;
const THIRD = TICKETS[2]!.id;

export const specimen = defineSpecimen({
  id: 'panels',
  name: 'Panels',
  group: 'layout-engine',
  from: '@notis/sdk/ui',
  covers: ['Panels'],
  summary: 'A list and its open item: side by side when both fit, otherwise the open item covers the list with Back.',
  states: [
    {
      id: 'split-open',
      label: 'Split, one ticket open (fixed 1024 px wide)',
      width: 1024,
      render: (ctx) => <TicketsPanels ctx={ctx} open={THIRD} />,
    },
    {
      id: 'list-only',
      label: 'Nothing open: the list takes the whole width (fixed 1024 px wide)',
      width: 1024,
      render: (ctx) => <TicketsPanels ctx={ctx} open={null} />,
    },
    {
      id: 'resizable',
      label: 'Resizable, 520 px reader, handle focused (fixed 1024 px wide)',
      width: 1024,
      render: (ctx) => <TicketsPanels ctx={ctx} open={FIRST} resizable defaultReaderWidth={520} />,
      interact: async (root) => {
        root.querySelector<HTMLElement>('.nui-panels-handle')?.focus();
        await nextFrame();
      },
    },
    {
      id: 'stacked-open',
      label: 'Stacked on a phone: the open ticket covers the list, Panels draws Back (fixed 390 px wide)',
      width: 390,
      render: (ctx) => <TicketsPanels ctx={ctx} open={THIRD} height={640} />,
    },
    {
      id: 'stacked-list',
      label: 'Stacked on a phone, nothing open (fixed 390 px wide)',
      width: 390,
      render: (ctx) => <TicketsPanels ctx={ctx} open={null} height={640} />,
    },
    {
      id: 'stacked-own-back',
      label: 'Stacked without onBack: the reader draws its own Back from usePanels (fixed 390 px wide)',
      width: 390,
      render: (ctx) => <TicketsPanels ctx={ctx} open={FIRST} ownBack height={640} />,
    },
    {
      id: 'custom-split',
      label: 'Custom minimums (list 400, reader 560): split from 960 px (fixed 1200 px wide)',
      width: 1200,
      render: (ctx) => <TicketsPanels ctx={ctx} open={THIRD} listMin={400} readerMin={560} defaultReaderWidth={560} />,
    },
    {
      id: 'custom-stacked',
      label: 'Custom minimums (list 400, reader 560): still stacked at 900 px (fixed 900 px wide)',
      width: 900,
      render: (ctx) => <TicketsPanels ctx={ctx} open={THIRD} listMin={400} readerMin={560} defaultReaderWidth={560} />,
    },
    {
      id: 'long-text',
      label: 'Long title and text, open in split mode (fixed 1024 px wide)',
      width: 1024,
      render: (ctx) => <TicketsPanels ctx={ctx} open={LONG_TICKET.id} tickets={ALL_TICKETS} height={600} />,
    },
    {
      id: 'wide-1280',
      label: 'Split at a 1280 px window: the reader wants 480 px (readerWantWidth), the list takes the rest',
      width: 1280,
      render: (ctx) => <TicketsPanels ctx={ctx} open={THIRD} />,
    },
    {
      id: 'wide-1920',
      label: 'Split at a 1920 px window: the reader stays at 480 px, the list grows',
      width: 1920,
      render: (ctx) => <TicketsPanels ctx={ctx} open={THIRD} />,
    },
    {
      id: 'responsive',
      label: 'Follows the width toggle: stacked at 390, split at 768 and 1440',
      render: (ctx) => <TicketsPanels ctx={ctx} open={THIRD} height={ctx.width < 680 ? 640 : 520} />,
    },
  ],
});
