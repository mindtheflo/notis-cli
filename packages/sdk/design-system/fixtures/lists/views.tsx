/**
 * The Tickets list pieces of the deck's "Product / Tickets" slide, built on the real toolkit: the row, the tile, the
 * reader, the reader bar's actions, the filter pills and the action set. Inline styles and toolkit classes only (the book's
 * Tailwind scans `specimens/`, not `fixtures/`).
 */
import type { CSSProperties, ReactNode } from 'react';
import type { SpecimenCopy } from '../../specimen';
import { FIXED_NOW } from '../../specimen';
import {
  Badge, Row, STATUS_WORDS, StarMark, StatusIcon,
  type ActionHandlers, type ReaderAction, type ReaderCtx, type TabRowItem, type TileParts,
} from '../../../src/ui';
import {
  STANDARD_ACTIONS, actionToast, type ActionOption, type ActionRef, type UndoFn, type Words,
} from '../../../src/words';
import {
  LIST_COPY, MOVE_TARGETS, MY_TICKETS, OPEN_TICKETS, PEOPLE, PRIORITY_WORDS, TICKETS, agoWords,
  type Ticket, type TicketPriority,
} from './tickets';

type T = <V>(copy: SpecimenCopy<V>) => V;

const MUTED = 'hsl(var(--muted-foreground))';
/** The book's fixed clock as a Date, so row times read the same in every frame. */
const BOOK_NOW = new Date(FIXED_NOW);

// ---- small marks ----

const PRIORITY_BARS: Readonly<Record<Exclude<TicketPriority, 'urgent'>, number>> = { high: 3, medium: 2, low: 1, none: 0 };

/** The priority mark of the deck: three bars, or a red square with "!" for urgent. */
export function PriorityIcon({ priority, label }: { priority: TicketPriority; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  if (priority === 'urgent') {
    return (
      <svg width={12} height={12} viewBox="0 0 12 12" style={{ flexShrink: 0, color: 'hsl(var(--destructive))' }} {...a11y}>
        <rect x={0.5} y={0.5} width={11} height={11} rx={3} fill="currentColor" />
        <path d="M6 3v3.6" stroke="hsl(var(--background))" strokeWidth={1.6} strokeLinecap="round" />
        <circle cx={6} cy={8.7} r={0.9} fill="hsl(var(--background))" />
      </svg>
    );
  }
  const filled = PRIORITY_BARS[priority];
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" style={{ flexShrink: 0, color: 'hsl(var(--foreground))' }} {...a11y}>
      {[4, 7, 10].map((height, index) => (
        <rect key={height} x={1 + index * 4} y={11 - height} width={2.5} height={height} rx={0.75} fill="currentColor"
          opacity={index < filled ? 0.85 : 0.25} />
      ))}
    </svg>
  );
}

/** The toolkit's star mark, re-exported for the specimens that draw starred tickets. */
export { StarMark };

/** The row meta of a ticket: priority, id, then its labels (the labels give way first). */
export function TicketMeta({ ticket, t }: { ticket: Ticket; t: T }) {
  const labels = ticket.labels.map((label) => t(label)).join(', ');
  return (
    <>
      <PriorityIcon priority={ticket.priority} label={`${t(LIST_COPY.priority)}: ${t(PRIORITY_WORDS[ticket.priority])}`} />
      <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{ticket.id}</span>
      {labels && <span aria-hidden="true" style={{ flexShrink: 0 }}>·</span>}
      {labels && <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labels}</span>}
    </>
  );
}

/** One ticket as a list row: status, title, meta, snippet, owner, time and the star. */
export function ticketRow(ticket: Ticket, t: T, options: { snippet?: boolean; wrap?: 1 | 2 } = {}): ReactNode {
  return (
    <Row icon={{ status: ticket.status }} title={t(ticket.title)} meta={<TicketMeta ticket={ticket} t={t} />}
      snippet={options.snippet ? t(ticket.description) : undefined} owner={{ name: ticket.owner.name }}
      time={ticket.updated} trailing={ticket.starred ? <StarMark /> : undefined}
      now={BOOK_NOW} wrap={options.wrap} />
  );
}

// ---- table and tiles ----

const CELL_MUTED: CSSProperties = { color: MUTED, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/** The table head of the Tickets table (lead, title, priority, assignee, updated, more). */
export function ticketColumns(t: T): ReactNode {
  return (
    <>
      <th style={{ width: 40 }} aria-hidden="true" />
      <th>{t(LIST_COPY.title)}</th>
      <th style={{ width: 136 }}>{t(LIST_COPY.priority)}</th>
      <th style={{ width: 176 }}>{t(LIST_COPY.assignee)}</th>
      <th style={{ width: 96 }}>{t(LIST_COPY.updated)}</th>
      <th style={{ width: 44 }} aria-hidden="true" />
    </>
  );
}

const DAY_FORMAT: Readonly<Record<'en' | 'fr', Intl.DateTimeFormatOptions>> = {
  en: { month: 'short', day: 'numeric' }, fr: { day: 'numeric', month: 'short' },
};

/** "Jun 15" / "15 juin", from the fixed clock's year (the year shows when it differs). */
export function shortDay(date: Date, lang: 'en' | 'fr'): string {
  const options: Intl.DateTimeFormatOptions = { ...DAY_FORMAT[lang] };
  if (date.getFullYear() !== new Date(FIXED_NOW).getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', options).format(date);
}

/** A person: initials avatar and name. */
export function PersonText({ name, initials }: { name: string; initials: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="nui-avatar" aria-hidden="true">{initials}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </span>
  );
}

/** A priority: mark and words. */
export function PriorityText({ priority, t }: { priority: TicketPriority; t: T }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      <PriorityIcon priority={priority} />
      {t(PRIORITY_WORDS[priority])}
    </span>
  );
}

/** One ticket as table cells; `more` is the row's More menu (RowMore, placed by hand in a table). */
export function ticketCells(ticket: Ticket, t: T, lang: 'en' | 'fr', more: ReactNode): ReactNode {
  return (
    <>
      <td><StatusIcon status={ticket.status} /></td>
      <td>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ ...CELL_MUTED, fontSize: 12 }}>{ticket.id}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(ticket.title)}</span>
          {ticket.starred && <StarMark />}
        </span>
      </td>
      <td><PriorityText priority={ticket.priority} t={t} /></td>
      <td><PersonText {...ticket.owner} /></td>
      <td style={CELL_MUTED}>{shortDay(ticket.updated, lang)}</td>
      <td>{more}</td>
    </>
  );
}

/** One ticket as a tile; `more` is RowMore, which the tile pins to its top right corner. */
export function ticketTile(ticket: Ticket, t: T, lang: 'en' | 'fr', more: ReactNode): ReactNode {
  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: MUTED, paddingRight: 28 }}>
        <StatusIcon status={ticket.status} />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{ticket.id}</span>
        {ticket.starred && <StarMark />}
      </span>
      <span style={{ display: 'block', marginTop: 8, fontSize: 14, fontWeight: 500, lineHeight: '20px' }}>{t(ticket.title)}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: MUTED }}>
        <PriorityIcon priority={ticket.priority} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(PRIORITY_WORDS[ticket.priority])}</span>
        <span>{shortDay(ticket.updated, lang)}</span>
        <span className="nui-avatar" role="img" aria-label={ticket.owner.name}>{ticket.owner.initials}</span>
      </span>
      {more}
    </>
  );
}

/** One ticket as `renderTile` parts: status mark, title, id, the description, priority, then date and assignee. */
export function ticketTileParts(ticket: Ticket, t: T, lang: 'en' | 'fr'): TileParts {
  return {
    mark: <StatusIcon status={ticket.status} />,
    title: t(ticket.title),
    subtitle: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{ticket.id}</span>,
    body: t(ticket.description),
    figure: <PriorityText priority={ticket.priority} t={t} />,
    trailing: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {ticket.starred && <StarMark />}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{shortDay(ticket.updated, lang)}</span>
        <span className="nui-avatar" role="img" aria-label={ticket.owner.name}>{ticket.owner.initials}</span>
      </span>
    ),
  };
}

// ---- the reader ----

const H2: CSSProperties = { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600, textWrap: 'balance', overflowWrap: 'anywhere' } as CSSProperties;
const DL: CSSProperties = { display: 'grid', gridTemplateColumns: '8rem minmax(0, 1fr)', columnGap: 16, margin: '24px 0 0', fontSize: 14 };
const DT: CSSProperties = { display: 'flex', alignItems: 'center', minHeight: 36, color: MUTED };
const DD: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 4, minWidth: 0, minHeight: 36, margin: 0, padding: '4px 0' };
const H3: CSSProperties = { margin: '32px 0 0', fontSize: 14, fontWeight: 500 };
const PARA: CSSProperties = { margin: '8px 0 0', fontSize: 14, lineHeight: '24px', color: 'hsl(var(--foreground) / 0.85)', textWrap: 'pretty' } as CSSProperties;

const SET_STATUS: SpecimenCopy<(who: string) => string> = {
  en: (who) => `${who} set the status to`,
  fr: (who) => `${who} a passé le statut à`,
};

/** The ticket reader of the deck: title, facts, description and activity. */
export function TicketReader({ ticket, t }: { ticket: Ticket; t: T }) {
  const rows: [string, ReactNode][] = [
    [t(LIST_COPY.status), <><StatusIcon status={ticket.status} decorative />{t(STATUS_WORDS[ticket.status])}</>],
    [t(LIST_COPY.priority), <PriorityText priority={ticket.priority} t={t} />],
    [t(LIST_COPY.assignee), <PersonText {...ticket.owner} />],
    ...(ticket.labels.length
      ? [[t(LIST_COPY.labels), <>{ticket.labels.map((label) => <Badge key={label.en}>{t(label)}</Badge>)}</>] as [string, ReactNode]]
      : []),
    [t(LIST_COPY.updated), t(agoWords(ticket.updated, FIXED_NOW))],
    [t(LIST_COPY.created), t(agoWords(ticket.created, FIXED_NOW))],
  ];
  const activity = [
    ...(ticket.status !== 'todo' ? [{
      who: ticket.owner,
      text: <>{t(SET_STATUS)(ticket.owner.name)} <strong style={{ fontWeight: 500 }}>{t(STATUS_WORDS[ticket.status])}</strong></>,
      when: ticket.updated,
    }] : []),
    { who: PEOPLE.flo, text: <>{PEOPLE.flo.name} {t(LIST_COPY.createdIt)}</>, when: ticket.created },
  ];
  return (
    <>
      <h2 style={H2}>{t(ticket.title)}</h2>
      <dl style={DL}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt style={DT}>{label}</dt>
            <dd style={DD}>{value}</dd>
          </div>
        ))}
      </dl>
      <section data-section="description">
        <h3 style={H3}>{t(LIST_COPY.description)}</h3>
        <p style={PARA}>{t(ticket.description)}</p>
      </section>
      <section data-section="activity">
        <h3 style={H3}>{t(LIST_COPY.activity)}</h3>
        <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 12 }}>
          {activity.map((entry, index) => (
            <li key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, lineHeight: '20px' }}>
              <span className="nui-avatar" aria-hidden="true">{entry.who.initials}</span>
              <span style={{ flex: 1, minWidth: 0, paddingTop: 2, color: 'hsl(var(--foreground) / 0.85)' }}>{entry.text}</span>
              <span style={{ flexShrink: 0, paddingTop: 2, fontSize: 12, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                {t(agoWords(entry.when, FIXED_NOW))}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

/** Complete (E) then Star or Unstar (S): the reader bar buttons of the deck, each running the list's own action. */
export function ticketReaderActions(ticket: Ticket, ctx: ReaderCtx<Ticket>): ReaderAction[] {
  const bar: ReaderAction[] = [];
  const has = (id: string) => ctx.actions.some((action) => action.id === id);
  if (has('complete')) {
    bar.push({ id: 'complete', label: STANDARD_ACTIONS.complete.label, icon: STANDARD_ACTIONS.complete.icon, key: 'e',
      run: () => { void ctx.run('complete'); } });
  }
  const star = ticket.starred ? 'unstar' : 'star';
  if (has(star)) {
    bar.push({ id: star, label: STANDARD_ACTIONS[star].label, icon: STANDARD_ACTIONS[star].icon, key: 's',
      run: () => { void ctx.run(star); } });
  }
  return bar;
}

// ---- the toolbar ----

export type TicketTab = 'all' | 'open' | 'mine';

export const TICKET_TABS: Readonly<Record<TicketTab, readonly Ticket[]>> = { all: TICKETS, open: OPEN_TICKETS, mine: MY_TICKETS };

export type TicketCounts = Readonly<Record<TicketTab, number>>;

/** The counts the fixture tabs hold: 16, 12 and 4. */
export const TICKET_COUNTS: TicketCounts = { all: TICKETS.length, open: OPEN_TICKETS.length, mine: MY_TICKETS.length };

/** An empty Space: every tab reads 0. */
export const NO_TICKET_COUNTS: TicketCounts = { all: 0, open: 0, mine: 0 };

/** All, Open and Mine as filter pills; counts null hides them (not known, as while the list fails to load). */
export function ticketTabItems(counts: TicketCounts | null = TICKET_COUNTS): TabRowItem<TicketTab>[] {
  return [
    { id: 'all', label: LIST_COPY.all, count: counts?.all },
    { id: 'open', label: LIST_COPY.open, count: counts?.open },
    { id: 'mine', label: LIST_COPY.mine, count: counts?.mine },
  ];
}

/** The list's "+" New ticket button (N; C stays the host's key). */
export const TICKET_CREATE = { label: LIST_COPY.newTicket, key: 'n', onCreate: () => undefined } as const;

// ---- actions ----

const noop: UndoFn = () => undefined;

/** Move to: the Product Space's lists. */
export const MOVE_OPTIONS: readonly ActionOption[] = MOVE_TARGETS.map((target) => ({ value: target.value, label: target.label }));

/** Assign: the Space's people (initials as the hint). */
export const ASSIGN_OPTIONS: readonly ActionOption[] = Object.values(PEOPLE).map((person) => ({
  value: person.initials, label: person.name, hint: person.initials,
}));

const notDoneOrCancelled = (ticket: Ticket) => ticket.status !== 'done' && ticket.status !== 'cancelled';

/**
 * The Tickets actions of the deck: Complete (E) leads the bar, Start progress and Archive keep no key and sit in
 * the reader and the row menu. Archive is the Space's own action with the catalogue's words, because the standard
 * one takes E as Complete does and a ref cannot drop a standard key.
 */
export const TICKET_ACTIONS: readonly ActionRef<Ticket>[] = [
  { id: 'complete', appliesTo: notDoneOrCancelled },
  { id: 'progress', bulk: false, appliesTo: (ticket) => notDoneOrCancelled(ticket) && ticket.status !== 'active' },
  { id: 'star', appliesTo: (ticket) => !ticket.starred },
  { id: 'unstar', appliesTo: (ticket) => ticket.starred },
  { id: 'move', options: MOVE_OPTIONS, value: () => 'tickets' },
  {
    id: 'archive-ticket', label: STANDARD_ACTIONS.archive.label, icon: STANDARD_ACTIONS.archive.icon, bulk: false,
    appliesTo: (ticket) => !ticket.archived, run: () => noop, toast: (n) => actionToast('archive', n),
  },
  'delete',
];

/** Every handler returns an Undo, so the toast offers it. */
export const TICKET_HANDLERS: ActionHandlers<Ticket> = {
  complete: () => noop,
  progress: () => noop,
  star: () => noop,
  unstar: () => noop,
  later: () => noop,
  move: (_items, choice) => ({
    undo: noop,
    toast: choice ? movedWords(choice.label) : null,
  }),
  assign: () => ({ undo: noop, toast: LIST_COPY.assigned }),
  delete: () => noop,
};

/** "Moved to Roadmap." in both languages, from the picked option's words. */
export function movedWords(label: Words | string): Words {
  const words = typeof label === 'string' ? { en: label, fr: label } : label;
  return { en: `Moved to ${words.en}.`, fr: `Déplacé vers ${words.fr}.` };
}
