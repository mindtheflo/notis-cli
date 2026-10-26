import type { ReactNode } from 'react';
import { defineSpecimen, nextFrame, type SpecimenRenderContext } from '../../specimen';
import { CommentAvatar, SidePane } from '../../../src/ui';
import { ALL_TICKETS, LONG_TICKET, TICKETS, type Ticket } from '../../fixtures/layout-engine/tickets';

type T = SpecimenRenderContext['t'];

const NOTES_TITLE = { en: 'Comments', fr: 'Commentaires' };
const PANE_LABEL = { en: 'the comments', fr: 'les commentaires' };

/** The page: every ticket's title and text, long enough to scroll on its own. */
function TicketPage({ tickets, t }: { tickets: readonly Ticket[]; t: T }) {
  return (
    <div className="grid gap-6 px-6 pb-8 pt-4">
      {tickets.map((ticket) => (
        <section key={ticket.id}>
          <div className="font-mono text-xs text-muted-foreground">{ticket.key}</div>
          <h2 className="mt-1 text-lg font-semibold leading-7 text-foreground">{t(ticket.title)}</h2>
          <div className="mt-2 grid gap-3 text-sm leading-6 text-foreground">
            {t(ticket.body).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The pane: one note per ticket, as a comment list reads. */
function NotesPane({ tickets, t }: { tickets: readonly Ticket[]; t: T }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="m-0 text-sm font-semibold text-foreground">{t(NOTES_TITLE)}</h2>
      {tickets.map((ticket) => (
        <article key={ticket.id} className="flex flex-col gap-2 rounded-lg bg-foreground/[.04] p-3 text-[13px] leading-5">
          <header className="flex items-center gap-2">
            <CommentAvatar author={ticket.owner} />
            <span className="font-semibold">{ticket.owner}</span>
            <span className="text-xs text-muted-foreground">{ticket.key}</span>
          </header>
          <p className="m-0">{t(ticket.title)}</p>
        </article>
      ))}
    </div>
  );
}

function TicketsSidePane({ ctx, tickets = TICKETS, height = 520, mainMin, paneMin, defaultPaneWidth }: {
  ctx: SpecimenRenderContext;
  tickets?: readonly Ticket[];
  height?: number;
  mainMin?: number;
  paneMin?: number;
  defaultPaneWidth?: number;
}): ReactNode {
  return (
    <div style={{ height, overflowY: 'auto' }}>
      <SidePane
        pane={<NotesPane tickets={tickets} t={ctx.t} />}
        label={PANE_LABEL}
        mainMin={mainMin}
        paneMin={paneMin}
        defaultPaneWidth={defaultPaneWidth}
      >
        <TicketPage tickets={tickets} t={ctx.t} />
      </SidePane>
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'side-pane',
  name: 'SidePane',
  group: 'layout-engine',
  from: '@notis/sdk/ui',
  covers: ['SidePane'],
  summary: 'A page with a pane that stays open beside it, as wide as dragged, each scrolling on its own; one column when narrow.',
  states: [
    {
      id: 'beside',
      label: 'Beside the page, 340 px pane, page and pane scroll apart (fixed 1024 px wide)',
      width: 1024,
      render: (ctx) => <TicketsSidePane ctx={ctx} tickets={ALL_TICKETS} />,
    },
    {
      id: 'wide-pane',
      label: 'A 520 px pane, drag edge focused (fixed 1440 px wide)',
      width: 1440,
      render: (ctx) => <TicketsSidePane ctx={ctx} tickets={ALL_TICKETS} defaultPaneWidth={520} />,
      interact: async (root) => {
        root.querySelector<HTMLElement>('.nui-side-pane-handle')?.focus();
        await nextFrame();
      },
    },
    {
      id: 'squeezed',
      label: 'A 720 px pane wanted in 900 px: the page keeps its 520 px (fixed 900 px wide)',
      width: 900,
      render: (ctx) => <TicketsSidePane ctx={ctx} defaultPaneWidth={720} />,
    },
    {
      id: 'stacked',
      label: 'One column on a phone: the pane follows the page (fixed 390 px wide)',
      width: 390,
      render: (ctx) => <TicketsSidePane ctx={ctx} height={640} />,
    },
    {
      id: 'custom-split',
      label: 'Custom minimums (page 700, pane 320): still one column at 960 px (fixed 960 px wide)',
      width: 960,
      render: (ctx) => <TicketsSidePane ctx={ctx} mainMin={700} paneMin={320} />,
    },
    {
      id: 'long-text',
      label: 'Long title and text beside the pane (fixed 1024 px wide)',
      width: 1024,
      render: (ctx) => <TicketsSidePane ctx={ctx} tickets={[LONG_TICKET, ...TICKETS]} />,
    },
    {
      id: 'responsive',
      label: 'Follows the width toggle: one column at 390 and 768, beside at 1440',
      render: (ctx) => <TicketsSidePane ctx={ctx} height={ctx.width < 840 ? 640 : 520} />,
    },
  ],
});
