/**
 * Row (toolkit spec 2.5): the content of one list row. Inside a ListReader the list draws the row element (it
 * carries the keys, pointer rules and states) and Row fills it; on its own Row draws a `nui-row` element with the
 * looks of its `state` prop.
 */

import { useContext, type ReactNode } from 'react';
import { SHELL_WORDS, pick, type Locale, type Words } from '../../words';
import { useToolkitLocale } from '../engine/hooks';
import { Icon, renderIcon } from '../icons';
import { cx, flag, useT } from '../util';
import { IDLE_ROW_STATE, RowIdContext, RowStateContext, useRowState, type RowState } from './rowState';

export type Tone = 'default' | 'info' | 'success' | 'warning' | 'danger';

export type RowLabel = string | { label: Words | string; tone?: Tone };

export interface RowOwner {
  name: string;
  avatarUrl?: string;
}

export interface RowProps {
  /** Lead, 20px. `{ status }` draws the status icon of that status (see `statusGroup`). */
  icon?: ReactNode | { status: string };
  title: ReactNode;
  /** The start of the muted line under the title (12/16); `labels` follow it after a " · ". */
  meta?: ReactNode;
  /** One clamped line (13/18). */
  snippet?: ReactNode;
  /**
   * Words on the meta line, as text joined by ", " (never chips). A warning or danger label comes first and keeps
   * its tone.
   */
  labels?: readonly RowLabel[];
  /** A 24px avatar after the time. */
  owner?: RowOwner;
  /**
   * A compact relative time ("12m", "2h", "1d"; French "12 min", "2 h", "1 j") up to 30 days back, else the day and
   * month this year and the full date before it. A date-only value (a 'YYYY-MM-DD' string, or any value with
   * `dateOnly`) reads as that local day: "Today", or its day and month.
   */
  time?: Date | string | number;
  /** `time` is a day, not a moment: no relative time, and no shift across time zones. */
  dateOnly?: boolean;
  /** The clock `time` is read against. Default the current time; pass it for a stable render (a test, a specimen). */
  now?: Date;
  /** First in the trail, before the time (a star). */
  trailing?: ReactNode;
  /** The row-more button (28px). Default true when the list has actions. */
  more?: boolean;
  /** Injected by ListReader; pass it when drawing a Row on its own. */
  state?: RowState;
  /**
   * 2: a long title (a memory, a note) wraps onto a second line before it ends in an ellipsis; the row then aligns to
   * its top, with the trail on the first title line. Default 1.
   */
  wrap?: 1 | 2;
  /** Only on a Row drawn on its own; inside a list the list's row element carries the classes. */
  className?: string;
}

// ---- status ----

/**
 * Work moves backlog to done (`review`: the work is ready and a person checks it next); `up` and `down` are a service or
 * a monitor (a health page, an integration).
 */
export type StatusGroup =
  'backlog' | 'todo' | 'active' | 'review' | 'waiting' | 'done' | 'cancelled' | 'failed' | 'up' | 'down';

const STATUS_ALIASES: Readonly<Record<string, StatusGroup>> = Object.freeze({
  backlog: 'backlog', icebox: 'backlog', someday: 'backlog',
  todo: 'todo', to_do: 'todo', open: 'todo', new: 'todo', planned: 'todo', triage: 'todo', queued: 'todo',
  active: 'active', in_progress: 'active', doing: 'active', started: 'active', running: 'active', live: 'active',
  beta: 'active', in_beta: 'active',
  review: 'review', in_review: 'review', ready_for_review: 'review', needs_review: 'review', to_review: 'review',
  for_review: 'review', awaiting_review: 'review', pending_review: 'review', under_review: 'review',
  waiting: 'waiting', blocked: 'waiting', paused: 'waiting', on_hold: 'waiting', pending: 'waiting',
  done: 'done', completed: 'done', complete: 'done', closed: 'done', resolved: 'done', shipped: 'done', merged: 'done',
  cancelled: 'cancelled', canceled: 'cancelled', wont_do: 'cancelled', duplicate: 'cancelled', skipped: 'cancelled',
  failed: 'failed', error: 'failed', errored: 'failed', rejected: 'failed',
  up: 'up', operational: 'up', online: 'up', available: 'up',
  down: 'down', offline: 'down', outage: 'down', unavailable: 'down', unreachable: 'down',
});

const STATUS_ICONS: Readonly<Record<StatusGroup, string>> = Object.freeze({
  backlog: 'circle-dashed',
  todo: 'circle',
  active: 'circle-half',
  review: 'circle-three-quarter',
  waiting: 'clock-countdown',
  done: 'check-circle-fill',
  cancelled: 'minus-circle',
  failed: 'x-circle-fill',
  up: 'check-circle-fill',
  down: 'x-circle-fill',
});

export const STATUS_WORDS: Readonly<Record<StatusGroup, Words>> = Object.freeze({
  backlog: { en: 'Backlog', fr: 'En réserve' },
  todo: { en: 'To do', fr: 'À faire' },
  active: { en: 'In progress', fr: 'En cours' },
  review: { en: 'Ready for review', fr: 'À relire' },
  waiting: { en: 'Waiting', fr: 'En attente' },
  done: { en: 'Done', fr: 'Terminé' },
  cancelled: { en: 'Cancelled', fr: 'Annulé' },
  failed: { en: 'Failed', fr: 'Échec' },
  up: { en: 'Up', fr: 'Disponible' },
  down: { en: 'Down', fr: 'Indisponible' },
});

/** The status group of a Space status ('In progress', 'in_progress', 'doing' are all active). Unknown: todo. */
export function statusGroup(status: string): StatusGroup {
  const key = status.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_ALIASES[key] ?? 'todo';
}

/**
 * The status icon of one status, labelled for screen readers. `decorative`: hidden from screen readers (the status
 * is already said in text next to it).
 */
export function StatusIcon({ status, label, decorative = false }: {
  status: string; label?: Words | string; decorative?: boolean;
}) {
  const t = useT();
  const group = statusGroup(status);
  return (
    <span className="nui-st" data-st={group === 'todo' ? undefined : group}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t(label ?? STATUS_WORDS[group]) })}>
      <Icon name={STATUS_ICONS[group]} />
    </span>
  );
}

/** The words of the star mark. */
export const STAR_WORDS = Object.freeze({
  starred: { en: 'Starred', fr: 'Favori' },
}) satisfies Readonly<Record<string, Words>>;

/** A starred item's filled amber star (14px, labelled "Starred"), for a row's trailing slot or a reader head. */
export function StarMark({ decorative = false }: { decorative?: boolean }) {
  const t = useT();
  return (
    <span className="nui-star" {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t(STAR_WORDS.starred) })}>
      <Icon name="star-fill" />
    </span>
  );
}

/**
 * The row-more button and its action menu for the current row, for content that is not a Row (a tile, a table
 * cell). Draws nothing outside a ListReader or when the list has no actions for the item.
 */
export function RowMore() {
  const source = useContext(RowStateContext);
  const id = useContext(RowIdContext);
  if (!source?.more || id === null) return null;
  return <>{source.more(id)}</>;
}

// ---- time ----

/** The words of row and reader times. `{t}` in `ago` is a compact time from `formatRowAgo`. */
export const ROW_TIME_WORDS = Object.freeze({
  today: { en: 'Today', fr: 'Aujourd’hui' },
  ago: { en: '{t} ago', fr: 'il y a {t}' },
}) satisfies Readonly<Record<string, Words>>;

/** French puts a narrow no-break space between a number and its unit. */
const NB = '\u202f';
const MINUTE = 60_000;
/** Up to 30 days back a row time is relative; older times show their date. */
const RELATIVE_DAYS = 30;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A row time as a Date. A 'YYYY-MM-DD' string (or any value when `dateOnly`) maps to local noon of that day, so a
 * day never shows as the day before west of UTC.
 */
export function parseRowDate(value: Date | string | number, dateOnly = false): { date: Date; dateOnly: boolean } {
  if (typeof value === 'string') {
    const match = DATE_ONLY.exec(value.trim());
    if (match) {
      return { date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12), dateOnly: true };
    }
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (dateOnly && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(value.trim())) {
    // Midnight UTC of a date-only field: keep its calendar day.
    return { date: new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12), dateOnly: true };
  }
  if (dateOnly && !Number.isNaN(date.getTime())) date.setHours(12, 0, 0, 0);
  return { date, dateOnly };
}

/**
 * A compact time since `value`, the deck's: minutes under an hour, hours under a day, else days. English "12m",
 * "2h", "4d"; French "12 min", "2 h", "4 j". Null for an invalid value or a time ahead of `now`.
 */
export function formatRowAgo(value: Date | string | number, locale: Locale, now: Date = new Date()): string | null {
  const { date } = parseRowDate(value);
  const ms = now.getTime() - date.getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const fr = locale === 'fr';
  const minutes = Math.max(1, Math.floor(ms / MINUTE));
  if (minutes < 60) return fr ? `${minutes}${NB}min` : `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return fr ? `${hours}${NB}h` : `${hours}h`;
  const days = Math.round(hours / 24);
  return fr ? `${days}${NB}j` : `${days}d`;
}

/** The long time a reader shows: "45m ago" / "il y a 45 min". Empty for an invalid value or a time ahead of `now`. */
export function formatReaderAgo(value: Date | string | number, locale: Locale, now: Date = new Date()): string {
  const ago = formatRowAgo(value, locale, now);
  return ago === null ? '' : pick(ROW_TIME_WORDS.ago, locale).replace('{t}', ago);
}

/**
 * The compact row time: a relative time up to 30 days back ("12m", "2h", "1d"), else the day and month this year
 * and the full date before it ("Oct 3", "Oct 3, 2025"; French "3 oct.", "3 oct. 2025"). A date-only value shows
 * "Today" / "Aujourd’hui" or its day and month; a time ahead of `now` shows its date.
 */
export function formatRowTime(value: Date | string | number, locale: Locale, now: Date = new Date(),
  timeOptions: { dateOnly?: boolean } = {}): string {
  const { date, dateOnly } = parseRowDate(value, timeOptions.dateOnly);
  if (Number.isNaN(date.getTime())) return '';
  const tag = locale === 'fr' ? 'fr-FR' : 'en-US';
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay && dateOnly) return pick(ROW_TIME_WORDS.today, locale);
  if (!dateOnly && now.getTime() - date.getTime() < RELATIVE_DAYS * 24 * 60 * MINUTE) {
    const ago = formatRowAgo(date, locale, now);
    if (ago !== null) return ago;
  }
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat(tag, options).format(date);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '';
  return (first + last).toUpperCase();
}

function Check() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2.5 6.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"
        strokeLinejoin="round" />
    </svg>
  );
}

/** A warning or danger label (Overdue, Failed): it leads the labels, so a narrow row keeps it when the meta truncates. */
function isUrgentLabel(entry: RowLabel): boolean {
  return typeof entry !== 'string' && (entry.tone === 'warning' || entry.tone === 'danger');
}

function isStatusIcon(icon: unknown): icon is { status: string } {
  return !!icon && typeof icon === 'object' && !Array.isArray(icon)
    && typeof (icon as { status?: unknown }).status === 'string' && !('$$typeof' in (icon as object));
}

/** One list row: lead icon, a title over a meta line, then the trail (trailing, time, avatar, More). */
export function Row({
  icon, title, meta, snippet, labels, owner, time, dateOnly, now, trailing, more, state, wrap, className,
}: RowProps) {
  const locale = useToolkitLocale();
  const source = useContext(RowStateContext);
  const contextId = useContext(RowIdContext);
  const contextState = useRowState();
  const inList = !!source && contextId !== null;
  const rowState = state ?? (inList ? contextState : IDLE_ROW_STATE);

  const lead = icon === undefined || icon === null || icon === false ? null
    : isStatusIcon(icon) ? <StatusIcon status={icon.status} /> : renderIcon(icon as ReactNode);
  const toggle = inList ? source!.toggle : null;
  const showMore = (more ?? true) && inList && !!source!.more;
  const hasMeta = meta !== undefined && meta !== null && meta !== false;
  const ordered = labels?.length
    ? [...labels.filter(isUrgentLabel), ...labels.filter((entry) => !isUrgentLabel(entry))] : [];
  const hasTime = time !== undefined && time !== null && time !== '';

  const content = (
    <>
      {(lead || toggle) && (
        <span className="nui-row-lead">
          {lead && <span className="nui-row-icon">{lead}</span>}
          {toggle && (
            <button type="button" className="nui-row-check" tabIndex={-1} role="checkbox"
              aria-checked={rowState.selected} aria-label={pick(SHELL_WORDS.select, locale)}
              onClick={(event) => { event.stopPropagation(); toggle(contextId!); }}>
              <Check />
            </button>
          )}
        </span>
      )}
      <span className="nui-row-main" data-wrap={wrap === 2 ? 2 : undefined}>
        <span className="nui-row-title" data-lines={wrap === 2 ? 2 : undefined}>{title}</span>
        {(hasMeta || ordered.length > 0) && (
          <span className="nui-row-meta">
            {hasMeta && <span className="nui-row-meta-start">{meta}</span>}
            {hasMeta && ordered.length > 0 && <span className="nui-row-dot" aria-hidden="true">·</span>}
            {ordered.length > 0 && (
              <span className="nui-row-labels">
                {ordered.map((entry, index) => {
                  const label = typeof entry === 'string' ? entry : entry.label;
                  const tone = typeof entry === 'string' ? undefined : entry.tone;
                  return (
                    <span key={index} className="nui-row-label" data-tone={tone && tone !== 'default' ? tone : undefined}>
                      {index > 0 ? ', ' : ''}{pick(label, locale)}
                    </span>
                  );
                })}
              </span>
            )}
          </span>
        )}
        {snippet !== undefined && snippet !== null && snippet !== false
          && <span className="nui-row-snippet">{snippet}</span>}
      </span>
      {(owner || hasTime || trailing || showMore) && (
        <span className="nui-row-trail">
          {trailing}
          {hasTime && (
            <time className="nui-row-time" dateTime={toIso(time, dateOnly)}>
              {formatRowTime(time, locale, now ?? new Date(), { dateOnly })}
            </time>
          )}
          {owner && (
            <span className="nui-avatar" title={owner.name} role="img" aria-label={owner.name}>
              {owner.avatarUrl ? <img src={owner.avatarUrl} alt="" /> : initials(owner.name)}
            </span>
          )}
          {showMore && source!.more!(contextId!)}
        </span>
      )}
    </>
  );

  // Inside a list the list's row element carries the states and `className`.
  if (inList) return content;
  return (
    <div className={cx('nui-row', className)} data-cursor={flag(rowState.cursor)} data-open={flag(rowState.open)}
      data-selected={flag(rowState.selected)} data-wrap={wrap === 2 ? 2 : undefined}>
      {content}
    </div>
  );
}

function toIso(value: Date | string | number, dateOnly?: boolean): string | undefined {
  const parsed = parseRowDate(value, dateOnly);
  if (Number.isNaN(parsed.date.getTime())) return undefined;
  if (!parsed.dateOnly) return parsed.date.toISOString();
  const d = parsed.date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
