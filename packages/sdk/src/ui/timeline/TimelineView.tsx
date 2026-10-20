/**
 * TimelineView (toolkit spec 2.11, deck round 5 "timeline"): bars across days, one lane per group, zoomed by week,
 * month or quarter. The roadmap scrolls sideways; lane labels and the date axis stay put.
 *
 * Keys (spec 3, settled in 6): `[` and `]` move the window earlier or later, T comes back to today and puts the
 * cursor on the bar running today, J/K and the up and down arrows walk the bars lane by lane, Enter opens.
 */

import * as React from 'react';
import { startOfDay } from 'date-fns';
import { fillWords, pick, type Locale, type Words } from '../../words/types';
import { isVisibleComposed } from '../engine/dom';
import { useShortcuts } from '../engine/hooks';
import { stepCursor } from '../engine/step';
import type { ShortcutDef } from '../engine/types';
import { cx, flag, useLatest, useStableId } from '../util';
import { TIMELINE_WORDS } from '../period/dateWords';
import { formatShortDay } from '../period/dateFormat';
import { CaretLeftGlyph, CaretRightGlyph } from '../period/glyphs';
import { useDateLocale } from '../period/useDateLocale';
import { focusInside, keymapDef, useCursorFocus, useKeepFocusInside } from '../period/viewHelpers';
import type { DateInput } from '../calendar/calendarMath';
import {
  TIMELINE_ZOOMS,
  dayPercent,
  layoutTimeline,
  timelineMinWidth,
  timelineTicks,
  timelineTodayCursor,
  timelineWindow,
  todayInWindow,
  type TimelineLaneInfo,
  type TimelineZoom,
} from './timelineMath';

export interface TimelineViewProps<T> {
  items: readonly T[];
  getStart: (item: T) => DateInput;
  getEnd: (item: T) => DateInput;
  /** The lane an item sits in. */
  lane: (item: T) => TimelineLaneInfo;
  /** Lane order (and lanes that show even when empty). */
  lanes?: readonly TimelineLaneInfo[];
  /** Default `item.id`. */
  getId?: (item: T) => string;
  /** Default `item.title` (or `item.name`). */
  getTitle?: (item: T) => string;
  /** Status words for the bar's accessible name. */
  getStatus?: (item: T) => string;
  /** Colour group of a bar: `todo`, `active`, `waiting` or `done` (deck status groups). */
  getGroup?: (item: T) => string | undefined;
  /** Draws the inside of a bar; default its title. */
  bar?: (item: T) => React.ReactNode;
  zoom?: TimelineZoom;
  defaultZoom?: TimelineZoom;
  onZoomChange?: (zoom: TimelineZoom) => void;
  onOpen?: (item: T) => void;
  openId?: string | null;
  label?: Words | string;
  locale?: Locale;
  className?: string;
  /** Today, for tests and previews. */
  today?: Date;
}

function defaultId(item: unknown): string {
  const id = (item as { id?: unknown } | null)?.id;
  return id == null ? '' : String(id);
}

function defaultTitle(item: unknown): string {
  const record = item as { title?: unknown; name?: unknown } | null;
  return String(record?.title ?? record?.name ?? '');
}

export function TimelineView<T>(props: TimelineViewProps<T>) {
  const {
    items, getStart, getEnd, lane, lanes: laneOrder, getId = defaultId, getTitle = defaultTitle, getStatus, getGroup,
    bar, onOpen, openId = null, label, className,
  } = props;
  const locale = useDateLocale(props.locale);
  const t = (words: Words | string) => pick(words, locale);
  const uid = useStableId('nui-tl');
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const [innerZoom, setInnerZoom] = React.useState<TimelineZoom>(props.defaultZoom ?? 'month');
  const zoom = props.zoom ?? innerZoom;
  const setZoom = (next: TimelineZoom) => {
    if (props.zoom === undefined) setInnerZoom(next);
    props.onZoomChange?.(next);
  };
  const [offset, setOffset] = React.useState(0);
  const [cursor, setCursor] = React.useState<string | null>(null);

  const today = startOfDay(props.today ?? new Date());
  const layoutFor = (at: number, z: TimelineZoom = zoom) => layoutTimeline({
    items, getId, getStart, getEnd, lane, lanes: laneOrder, win: timelineWindow(z, at), today,
  });
  const win = timelineWindow(zoom, offset);
  const { lanes, order } = layoutFor(offset);
  const byId = React.useMemo(() => new Map(items.map((item) => [getId(item), item])), [items, getId]);
  const orderKey = order.join('\n');

  React.useEffect(() => {
    if (cursor !== null && !order.includes(cursor)) setCursor(order[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  // Keep today in sight when the window or zoom changes: scroll so day 0 (or the window start) sits a little in.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const day = todayInWindow(win) ? 0 : win.from;
    const x = ((day - win.from) / win.span) * (el.scrollWidth - el.clientWidth);
    el.scrollLeft = Math.max(0, x - el.clientWidth / 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, offset]);

  const focusTo = useCursorFocus(rootRef, cursor);
  const keepFocus = useKeepFocusInside(rootRef);
  const latest = useLatest({ cursor, offset, zoom, order, byId, onOpen });
  const move = (id: string | null) => {
    if (id === null) return false;
    focusTo(id, latest.current.cursor);
    setCursor(id);
    return true;
  };
  const live = () => isVisibleComposed(rootRef.current);
  // Tabs own [ and ]: the period steps by key only while focus is inside the view (T works while it shows).
  const stepLive = () => live() && focusInside(rootRef.current);
  const hasBars = () => live() && latest.current.order.length > 0;
  const step = (delta: 1 | -1) => () => {
    keepFocus();
    setOffset(latest.current.offset + delta);
    return true;
  };

  const defs: ShortcutDef[] = [
    keymapDef('period.prev', TIMELINE_WORDS.keyPrev, stepLive, step(-1)),
    keymapDef('period.next', TIMELINE_WORDS.keyNext, stepLive, step(1)),
    keymapDef('period.today', TIMELINE_WORDS.keyToday, live, () => {
      keepFocus();
      setOffset(0);
      const target = timelineTodayCursor(layoutFor(0, latest.current.zoom).lanes);
      if (target === null) setCursor(null);
      else move(target);
      return true;
    }),
    keymapDef('list.next', TIMELINE_WORDS.keyNextItem, hasBars, (event) =>
      move(stepCursor(latest.current.order, latest.current.cursor, 1, { repeat: event.repeat }))),
    keymapDef('list.prev', TIMELINE_WORDS.keyPrevItem, hasBars, (event) =>
      move(stepCursor(latest.current.order, latest.current.cursor, -1, { repeat: event.repeat }))),
    keymapDef('list.open', TIMELINE_WORDS.keyOpen, hasBars, () => {
      const { cursor: current, byId: map, onOpen: open } = latest.current;
      const item = current === null ? undefined : map.get(current);
      if (!item || !open) return false;
      open(item);
      return true;
    }),
  ];
  useShortcuts(defs, [locale]);

  const ticks = timelineTicks(win, today, locale);
  const showToday = todayInWindow(win);
  const todayLeft = `${dayPercent(0, win)}%`;
  const roving = cursor !== null && order.includes(cursor) ? cursor : order[0] ?? null;
  const gridLines = ticks.map((tick) => <span key={tick.day} className="nui-tl-grid" style={{ left: `${tick.percent}%` }} />);

  return (
    <div ref={rootRef} className={cx('nui-tl-view', className)} data-notis-ui="" data-zoom={zoom} tabIndex={-1}>
      <div className="nui-tl-head">
        <div className="nui-tl-zooms" role="group" aria-label={t(TIMELINE_WORDS.zoom)}>
          {TIMELINE_ZOOMS.map((z) => (
            <button key={z} type="button" className="nui-tl-btn" aria-pressed={z === zoom}
              onClick={() => { setZoom(z); setOffset(0); }}>
              {t(TIMELINE_WORDS[z])}
            </button>
          ))}
        </div>
        <span className="nui-tl-grow" />
        <button type="button" className="nui-tl-btn" data-tl-today="" onClick={() => setOffset(0)}>
          {t(TIMELINE_WORDS.today)}
        </button>
        <button type="button" className="nui-tl-nav" aria-label={t(TIMELINE_WORDS.earlier)} onClick={() => setOffset((o) => o - 1)}>
          <CaretLeftGlyph />
        </button>
        <button type="button" className="nui-tl-nav" aria-label={t(TIMELINE_WORDS.later)} onClick={() => setOffset((o) => o + 1)}>
          <CaretRightGlyph />
        </button>
      </div>
      <div ref={scrollRef} className="nui-tl-scroll">
        <div className="nui-tl" style={{ minWidth: timelineMinWidth(win) }}>
          <div className="nui-tl-row nui-tl-axis" aria-hidden="true">
            <div className="nui-tl-lab" />
            <div className="nui-tl-track">
              {ticks.filter((tick) => tick.showLabel).map((tick) => (
                <span key={tick.day} className="nui-tl-tick" style={{ left: `${tick.percent}%` }}>{tick.label}</span>
              ))}
              {showToday && <span className="nui-tl-today-chip" style={{ left: todayLeft }}>{t(TIMELINE_WORDS.today)}</span>}
            </div>
          </div>
          <div role="listbox" aria-label={t(label ?? TIMELINE_WORDS.items)} data-notis-engine-list="">
            {lanes.map((ln, index) => {
              const labelId = `${uid}-lane-${index}`;
              return (
                <div key={ln.id} className="nui-tl-row nui-tl-lane" role="group" aria-labelledby={labelId}>
                  <div className="nui-tl-lab">
                    <span id={labelId} className="nui-tl-lab-text">{ln.label}</span>
                    <span className="nui-tl-count">{ln.count}</span>
                  </div>
                  <div className="nui-tl-track" style={{ height: ln.height }}>
                    {gridLines}
                    {showToday && <span className="nui-tl-today" style={{ left: todayLeft }} aria-hidden="true" />}
                    {ln.bars.map(({ item, id, span, geometry }) => {
                      const title = getTitle(item);
                      const status = getStatus?.(item);
                      const a = formatShortDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + span.s), locale);
                      const b = formatShortDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + span.e - 1), locale);
                      const name = status
                        ? t(fillWords(TIMELINE_WORDS.bar, { t: title, s: status, a, b }))
                        : t(fillWords(TIMELINE_WORDS.barPlain, { t: title, a, b }));
                      return (
                        <div key={id} role="option" className={cx('nui-tl-bar', geometry.cutLeft && 'nui-tl-cut-l',
                          geometry.cutRight && 'nui-tl-cut-r')} data-nav-id={id} data-group={getGroup?.(item)}
                          aria-label={name} aria-selected={id === openId} title={title}
                          tabIndex={id === roving ? 0 : -1} data-cursor={flag(id === cursor)} data-open={flag(id === openId)}
                          style={{ left: `${geometry.left}%`, width: `${geometry.width}%`, top: geometry.top }}
                          onFocus={() => setCursor(id)}
                          onClick={() => { setCursor(id); onOpen?.(item); }}>
                          {bar ? bar(item) : <span className="nui-tl-bar-t">{title}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {order.length === 0 && <div className="nui-tl-empty">{t(TIMELINE_WORDS.empty)}</div>}
        </div>
      </div>
    </div>
  );
}
TimelineView.displayName = 'TimelineView';
