/**
 * CalendarView (toolkit spec 2.11, deck "calendar": month, week and agenda over the same items, plus a tray of items
 * with no date). Keys (spec 3, settled in 6): `[` and `]` step a month (a week, three weeks in the agenda), T comes
 * back to today and puts the cursor on today's first item, J/K and the up and down arrows walk the items in reading
 * order, the left and right arrows jump to the next or previous day with items, Enter opens.
 *
 * Generic over the item: give `getDate` (and `getEnd` for multi-day items); `row` draws an item, else its title.
 */

import * as React from 'react';
import { startOfDay } from 'date-fns';
import { fillWords, pick, type Locale, type Words } from '../../words/types';
import { isVisibleComposed } from '../engine/dom';
import { useShortcuts } from '../engine/hooks';
import { stepCursor } from '../engine/step';
import type { ShortcutDef } from '../engine/types';
import { cx, flag, useLatest } from '../util';
import {
  focusFreeFor, focusInside, keymapDef, useCursorFocus, useElementWidth, useKeepFocusInside,
} from '../period/viewHelpers';
import { CALENDAR_WORDS } from '../period/dateWords';
import { dayNumberLabel, formatDateRange, formatLongDay, formatMonthYear, weekdayNames } from '../period/dateFormat';
import { CaretLeftGlyph, CaretRightGlyph, TrayGlyph } from '../period/glyphs';
import { useDateLocale } from '../period/useDateLocale';
import {
  CALENDAR_VIEWS,
  agendaDays,
  bucketByDay,
  dayKey,
  isWeekend,
  monthGrid,
  navOrder,
  offsetStep,
  settleCursor,
  shownChips,
  stepDay,
  todayCursor,
  viewStart,
  visibleDays,
  type CalendarViewKind,
  type DateInput,
  type NavEntry,
} from './calendarMath';

/** How an item is drawn: a month chip, a dot (narrow month), a week or tray card, an agenda row. */
export type CalendarItemVariant = 'chip' | 'dot' | 'card' | 'row';

export interface CalendarViewProps<T> {
  items: readonly T[];
  getDate: (item: T) => DateInput;
  /** Last day of a multi-day item (drawn on every day, counted once by the keys). */
  getEnd?: (item: T) => DateInput;
  /** Default `item.id`. */
  getId?: (item: T) => string;
  /** Default `item.title` (or `item.name`). */
  getTitle?: (item: T) => string;
  /** Draws an item; the toolkit gives the chip, focus and keys around it. */
  row?: (item: T, variant: CalendarItemVariant) => React.ReactNode;
  view?: CalendarViewKind;
  defaultView?: CalendarViewKind;
  onViewChange?: (view: CalendarViewKind) => void;
  /** Views offered by the switch, in order. Default month, week, agenda. */
  views?: readonly CalendarViewKind[];
  onOpen?: (item: T) => void;
  /** The open item (drawn as open). */
  openId?: string | null;
  /** Shows the tray of items with no date. Default true. */
  tray?: boolean;
  /** Accessible name of the item list. Default "Items by date". */
  label?: Words | string;
  locale?: Locale;
  className?: string;
  /** Today, for tests and previews. */
  today?: Date;
}

/** Below this width the month view draws dots and narrow weekday names, and the week stacks. */
export const CALENDAR_NARROW_MAX = 640;
/** Below this width the tray goes under the grid. */
export const CALENDAR_TRAY_SIDE_MIN = 900;

function defaultId(item: unknown): string {
  const id = (item as { id?: unknown } | null)?.id;
  return id == null ? '' : String(id);
}

function defaultTitle(item: unknown): string {
  const record = item as { title?: unknown; name?: unknown } | null;
  return String(record?.title ?? record?.name ?? '');
}

export function CalendarView<T>(props: CalendarViewProps<T>) {
  const {
    items, getDate, getEnd, getId = defaultId, getTitle = defaultTitle, row, views = CALENDAR_VIEWS,
    onOpen, openId = null, tray = true, label, className,
  } = props;
  const locale = useDateLocale(props.locale);
  const t = (words: Words | string) => pick(words, locale);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(rootRef);
  const narrow = width < CALENDAR_NARROW_MAX;
  const trayBelow = width < CALENDAR_TRAY_SIDE_MIN;

  const [innerView, setInnerView] = React.useState<CalendarViewKind>(props.defaultView ?? views[0] ?? 'month');
  const view = props.view ?? innerView;
  const setView = (next: CalendarViewKind) => {
    if (props.view === undefined) setInnerView(next);
    props.onViewChange?.(next);
  };
  const [offset, setOffset] = React.useState(0);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [expandedDay, setExpandedDay] = React.useState<string | null>(null);
  const [trayOpen, setTrayOpen] = React.useState(true);

  const today = startOfDay(props.today ?? new Date());
  const todayKey = dayKey(today);
  const { byDay, none } = React.useMemo(() => bucketByDay(items, getDate, getEnd), [items, getDate, getEnd]);
  const byId = React.useMemo(() => new Map(items.map((item) => [getId(item), item])), [items, getId]);
  const trayShown = tray && none.length > 0 && trayOpen;

  const orderFor = (at: number, expanded: string | null): NavEntry[] => navOrder({
    view, days: visibleDays(view, at, today), byDay, none: trayShown ? none : [], getId, expandedDay: expanded, today,
  });
  const order = orderFor(offset, expandedDay);
  const orderIds = order.map((e) => e.id);
  const orderKey = orderIds.join('\n');

  // A step or a filter that hides the cursor moves it to the first shown item.
  React.useEffect(() => {
    if (cursor === null) return;
    const next = settleCursor(order, cursor);
    if (next !== cursor) setCursor(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  const focusTo = useCursorFocus(rootRef, cursor);
  const keepFocus = useKeepFocusInside(rootRef);
  const latest = useLatest({ cursor, offset, view, expandedDay, order, onOpen, byId });
  const move = (id: string | null) => {
    if (id === null) return false;
    focusTo(id, latest.current.cursor);
    setCursor(id);
    return true;
  };
  const live = () => isVisibleComposed(rootRef.current);
  // Tabs own [ and ]: the period steps by key only while focus is inside the view (T works while it shows).
  const stepLive = () => live() && focusInside(rootRef.current);
  const hasItems = () => live() && latest.current.order.length > 0;

  const step = (delta: 1 | -1) => () => {
    keepFocus();
    const { offset: at, view: v, cursor: current } = latest.current;
    const next = at + delta * offsetStep(v);
    setOffset(next);
    setExpandedDay(null);
    const settled = current === null ? null : settleCursor(orderFor(next, null), current);
    if (settled !== null) move(settled);
    else setCursor(null);
    return true;
  };

  const defs: ShortcutDef[] = [
    keymapDef('period.prev', CALENDAR_WORDS.keyPrev, stepLive, step(-1)),
    keymapDef('period.next', CALENDAR_WORDS.keyNext, stepLive, step(1)),
    keymapDef('period.today', CALENDAR_WORDS.keyToday, live, () => {
      keepFocus();
      setOffset(0);
      setExpandedDay(null);
      const target = todayCursor(orderFor(0, null), today);
      if (target === null) setCursor(null);
      else move(target);
      return true;
    }),
    keymapDef('list.next', CALENDAR_WORDS.keyNextItem, hasItems, (event) =>
      move(stepCursor(latest.current.order.map((e) => e.id), latest.current.cursor, 1, { repeat: event.repeat }))),
    keymapDef('list.prev', CALENDAR_WORDS.keyPrevItem, hasItems, (event) =>
      move(stepCursor(latest.current.order.map((e) => e.id), latest.current.cursor, -1, { repeat: event.repeat }))),
    {
      id: 'calendar.nextDay', keys: ['arrowright'], scope: 'collection', label: CALENDAR_WORDS.keyNextDay, repeat: true,
      when: () => hasItems() && focusFreeFor(rootRef.current),
      run: () => move(stepDay(latest.current.order, latest.current.cursor, 1)),
    },
    {
      id: 'calendar.prevDay', keys: ['arrowleft'], scope: 'collection', label: CALENDAR_WORDS.keyPrevDay, repeat: true,
      when: () => hasItems() && focusFreeFor(rootRef.current),
      run: () => move(stepDay(latest.current.order, latest.current.cursor, -1)),
    },
    keymapDef('list.open', CALENDAR_WORDS.keyOpen, hasItems, () => {
      const { cursor: current, byId: map, onOpen: open } = latest.current;
      const item = current === null ? undefined : map.get(current);
      if (!item || !open) return false;
      open(item);
      return true;
    }),
  ];
  useShortcuts(defs, [locale]);

  // ---- drawing ----

  const roving = cursor !== null && orderIds.includes(cursor) ? cursor : orderIds[0] ?? null;
  const tabbed = new Set<string>();
  const chip = (item: T, variant: CalendarItemVariant) => {
    const id = getId(item);
    const first = !tabbed.has(id);
    tabbed.add(id);
    const title = getTitle(item);
    return (
      <div key={id} role="option" className="nui-cal-chip" data-variant={variant} data-nav-id={id}
        aria-selected={id === openId} aria-label={variant === 'dot' ? title : undefined}
        tabIndex={first && id === roving ? 0 : -1} data-cursor={flag(id === cursor)} data-open={flag(id === openId)}
        onFocus={() => setCursor(id)}
        onClick={() => { setCursor(id); onOpen?.(item); }}>
        {variant === 'dot' ? <span className="nui-cal-dot" aria-hidden="true" />
          : row ? row(item, variant) : <span className="nui-cal-chip-text">{title}</span>}
      </div>
    );
  };

  const dayLabel = (d: Date) => (dayKey(d) === todayKey
    ? `${formatLongDay(d, locale)}, ${t(CALENDAR_WORDS.today)}` : formatLongDay(d, locale));

  const start = viewStart(view, offset, today);
  const days = visibleDays(view, offset, today);
  const title = view === 'month' ? formatMonthYear(start, locale)
    : formatDateRange({ from: days[0]!, to: days[days.length - 1]! }, locale);
  const prevWords = view === 'month' ? CALENDAR_WORDS.prevMonth : view === 'week' ? CALENDAR_WORDS.prevWeek : CALENDAR_WORDS.prevAgenda;
  const nextWords = view === 'month' ? CALENDAR_WORDS.nextMonth : view === 'week' ? CALENDAR_WORDS.nextWeek : CALENDAR_WORDS.nextAgenda;
  const weekdays = weekdayNames(locale, narrow ? 'narrow' : 'short');

  let grid: React.ReactNode;
  if (view === 'month') {
    const { month, rows } = monthGrid(start);
    const expandedRow = expandedDay === null ? -1 : Math.floor(days.findIndex((d) => dayKey(d) === expandedDay) / 7);
    const rowSizes = Array.from({ length: rows }, (_, r) => (r === expandedRow ? 'minmax(min-content, 1fr)' : 'minmax(100px, 1fr)'));
    grid = (
      <div className="nui-cal-grid" data-view="month" style={{ gridTemplateRows: `30px ${rowSizes.join(' ')}` }}>
        {/* Keyed by position: narrow names repeat ("M T W T", "L M M"). */}
        {weekdays.map((name, i) => <div key={i} className="nui-cal-wd" aria-hidden="true">{name}</div>)}
        {days.map((d) => {
          const key = dayKey(d);
          const list = byDay.get(key) ?? [];
          const expanded = expandedDay === key;
          // Narrow cells draw dots under the same cap as chips, so the "+N" link and the keys agree (C5).
          const { shown, more } = shownChips(list, expanded);
          return (
            <div key={key} role="group" className="nui-cal-day" aria-label={dayLabel(d)}
              data-outside={flag(d.getMonth() !== month.getMonth())} data-today={flag(key === todayKey)}
              data-weekend={flag(isWeekend(d))}>
              <span className="nui-cal-num" aria-hidden="true">{dayNumberLabel(d, locale, narrow)}</span>
              <div className="nui-cal-chips" data-dots={flag(narrow)}>
                {shown.map((item) => chip(item, narrow ? 'dot' : 'chip'))}
              </div>
              {(more > 0 || (expanded && list.length > shownChips(list, false).shown.length)) && (
                <button type="button" className="nui-cal-more" aria-expanded={expanded}
                  aria-label={narrow ? (expanded ? t(CALENDAR_WORDS.less) : t(fillWords(CALENDAR_WORDS.more, { n: more })))
                    : undefined}
                  onClick={() => setExpandedDay(expanded ? null : key)}>
                  {expanded ? t(narrow ? CALENDAR_WORDS.lessShort : CALENDAR_WORDS.less)
                    : t(fillWords(narrow ? CALENDAR_WORDS.moreShort : CALENDAR_WORDS.more, { n: more }))}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  } else if (view === 'week') {
    grid = (
      <div className="nui-cal-grid" data-view="week" data-stacked={flag(narrow)}>
        {days.map((d, i) => {
          const key = dayKey(d);
          const list = byDay.get(key) ?? [];
          return (
            <div key={key} role="group" className="nui-cal-wday" aria-label={dayLabel(d)}
              data-today={flag(key === todayKey)} data-weekend={flag(isWeekend(d))}>
              <div className="nui-cal-wdh" aria-hidden="true">
                <span className="nui-cal-wdh-name">{weekdays[i]}</span>
                <span className="nui-cal-num">{d.getDate()}</span>
              </div>
              <div className="nui-cal-cards">{list.map((item) => chip(item, 'card'))}</div>
            </div>
          );
        })}
      </div>
    );
  } else {
    const shownDays = agendaDays(days, byDay, today);
    const empty = shownDays.every((d) => (byDay.get(dayKey(d))?.length ?? 0) === 0);
    let lastMonth = -1;
    grid = (
      <div className="nui-cal-agenda">
        {shownDays.map((d) => {
          const key = dayKey(d);
          const list = byDay.get(key) ?? [];
          const heading = d.getMonth() !== lastMonth;
          lastMonth = d.getMonth();
          return (
            <React.Fragment key={key}>
              {heading && <div className="nui-cal-amonth" aria-hidden="true">{formatMonthYear(d, locale)}</div>}
              <div role="group" className="nui-cal-aday" aria-label={dayLabel(d)} data-today={flag(key === todayKey)}
                data-past={flag(key < todayKey)}>
                <div className="nui-cal-adate" aria-hidden="true">
                  <span className="nui-cal-awd">{weekdayNames(locale, 'short')[(d.getDay() + 6) % 7]}</span>
                  <span className="nui-cal-anum">{d.getDate()}</span>
                </div>
                <div className="nui-cal-arows">
                  {list.length ? list.map((item) => chip(item, 'row'))
                    : <div className="nui-cal-aempty">{t(CALENDAR_WORDS.agendaToday)}</div>}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        {empty && <div className="nui-cal-aempty" data-all="">{t(CALENDAR_WORDS.agendaEmpty)}</div>}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cx('nui-cal', className)} data-notis-ui="" data-view={view} data-narrow={flag(narrow)}
      tabIndex={-1}>
      <div className="nui-cal-head">
        <h2 className="nui-cal-title" aria-live="polite">{title}</h2>
        {/* The view switch sits right after the title (deck); the tools take the rest of the line from Today on. */}
        {views.length > 1 && (
          <div className="nui-cal-views" role="group" aria-label={t(CALENDAR_WORDS.view)}>
            {views.map((v) => (
              <button key={v} type="button" className="nui-cal-btn" aria-pressed={v === view}
                onClick={() => { setView(v); setExpandedDay(null); }}>
                {t(CALENDAR_WORDS[v])}
              </button>
            ))}
          </div>
        )}
        <div className="nui-cal-tools">
          <button type="button" className="nui-cal-btn" data-cal-today=""
            onClick={() => { setOffset(0); setExpandedDay(null); }}>
            {t(CALENDAR_WORDS.today)}
          </button>
          <button type="button" className="nui-cal-nav" aria-label={t(prevWords)} onClick={() => setOffset((o) => o - offsetStep(view))}>
            <CaretLeftGlyph />
          </button>
          <button type="button" className="nui-cal-nav" aria-label={t(nextWords)} onClick={() => setOffset((o) => o + offsetStep(view))}>
            <CaretRightGlyph />
          </button>
          {tray && none.length > 0 && (
            <button type="button" className="nui-cal-btn" data-cal-tray="" aria-expanded={trayOpen}
              aria-label={t(trayOpen ? CALENDAR_WORDS.trayHide : CALENDAR_WORDS.trayShow)}
              onClick={() => setTrayOpen((open) => !open)}>
              <TrayGlyph />
              <span className="nui-cal-tray-word">{t(CALENDAR_WORDS.noDate)}</span>
              <span className="nui-cal-count">{none.length}</span>
            </button>
          )}
        </div>
      </div>
      <div className="nui-cal-body" data-tray={trayShown ? (trayBelow ? 'below' : 'side') : undefined}>
        <div className="nui-cal-main" role="listbox" aria-label={t(label ?? CALENDAR_WORDS.items)} data-notis-engine-list="">
          {grid}
          {trayShown && (
            <div className="nui-cal-tray" role="group" aria-label={t(CALENDAR_WORDS.noDate)}>
              <div className="nui-cal-tray-head" aria-hidden="true">
                <span>{t(CALENDAR_WORDS.noDate)}</span>
                <span className="nui-cal-count">{none.length}</span>
              </div>
              <div className="nui-cal-tray-list">{none.map((item) => chip(item, 'card'))}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
CalendarView.displayName = 'CalendarView';
