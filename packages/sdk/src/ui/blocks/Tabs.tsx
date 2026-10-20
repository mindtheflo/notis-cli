/**
 * Tabs and TabRow: strips of pills (one look for both, Flo 5b). SegmentedControl stays for mode switches inside a
 * section (a chart's Bars, Line, Area).
 *
 * Tabs: a strip of views where the choice switches the whole content below it (a page's sections, a record's panes),
 * with its panel. TabRow: the 44px row over a list or a page (TLB1, TLB2). Role 'tabs' when the choice switches the
 * content (tablist), role 'filter' when it narrows one list (radiogroup). It never wraps: `lead` sits before the
 * pills, `end` is pinned at the row's end and `maxVisible` moves the rest of the pills into a More menu.
 *
 * The active pill is tinted (never a line or an edge on one side). Each pill can show a count. [ and ] switch to the
 * previous or next view from anywhere on the page (route scope, listed in the ? sheet), the arrow keys move between
 * pills while one has focus, Home and End jump to the ends. A calendar or timeline in the content takes [ and ] only
 * while focus is inside it. On narrow widths the Tabs strip scrolls sideways; a TabRow folds the pills its row has no
 * room for into the More menu.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DEFAULT_KEYMAP, type KeymapEntry, type Words } from '../../words';
import { isVisibleComposed } from '../engine/dom';
import { useShortcuts } from '../engine/hooks';
import type { ShortcutDef } from '../engine/types';
import { Icon, renderIcon } from '../icons';
import { Menu } from '../overlay/Menu';
import { cssEscape } from '../period/viewHelpers';
import { cx, deepActiveElement, revealInline, useIsoLayoutEffect, useT } from '../util';

type Text = Words | string;

/** The words of Tabs and TabRow: a strip's default name and its [ and ] shortcuts. */
export const TABS_WORDS = Object.freeze({
  views: { en: 'Views', fr: 'Vues' },
  previousView: { en: 'Previous view', fr: 'Vue précédente' },
  nextView: { en: 'Next view', fr: 'Vue suivante' },
}) satisfies Readonly<Record<string, Words>>;

/** The words of a TabRow: its default name as a filter and its More menu. */
export const TABROW_WORDS = Object.freeze({
  filters: { en: 'Filters', fr: 'Filtres' },
  more: { en: 'More', fr: 'Plus' },
  showMore: { en: 'Show more', fr: 'Afficher plus' },
}) satisfies Readonly<Record<string, Words>>;

/** The width of a TabRow's More pill before it was ever drawn (its label and caret). */
const MORE_GUESS = 72;

/** One tab of `Tabs`. */
export interface TabItem<V extends string> {
  value: V;
  label: Text;
  icon?: ReactNode | string;
  /** Shown after the label in a muted tone (0 included). */
  count?: number;
  disabled?: boolean;
}

/** The props of `Tabs`. */
export interface TabsProps<V extends string> {
  tabs: readonly TabItem<V>[];
  value: NoInfer<V>;
  onChange(value: NoInfer<V>): void;
  /** The strip's accessible name. Default "Views". */
  label?: Text;
  /**
   * [ and ] switch views (default true). One strip per page carries them: set false on a second or nested strip.
   * The strip owns them: a calendar or timeline inside the content steps its period with [ and ] only while focus is
   * inside it (after a click on it, or once a key moved focus into it).
   */
  keys?: boolean;
  /**
   * 'auto' (default): an arrow key moves to the tab and shows it. 'manual': arrows move focus only, Enter or Space
   * shows the focused tab (for views that are slow to show).
   */
  activation?: 'auto' | 'manual';
  /** When given, rendered as the tab panel of the active tab (labelled by it). Omit to render the panel yourself
   *  with `tabPanelProps`. */
  children?: ReactNode;
  /** Stable prefix for tab and panel ids. Default a generated one. */
  id?: string;
  className?: string;
  panelClassName?: string;
}

/** One pill of a TabRow. */
export interface TabRowItem<V extends string = string> {
  id: V;
  label: Text;
  /** Shown after the label in a muted tone (0 included). */
  count?: number;
  icon?: ReactNode | string;
  disabled?: boolean;
}

/** The props of `TabRow`. */
export interface TabRowProps<V extends string = string> {
  /** 'tabs': the choice switches the content below (tablist). 'filter': it narrows one list (radiogroup). */
  role: 'tabs' | 'filter';
  items: readonly TabRowItem<V>[];
  value: NoInfer<V>;
  onChange(id: NoInfer<V>): void;
  /** The strip's accessible name. Default "Views" for tabs, "Filters" for a filter. */
  label?: Text;
  /** The most pills the strip shows; the rest go into a More menu. The active pill always shows. Default all that fit. */
  maxVisible?: number;
  /** Before the pills, in the same line: a section title, a back button. */
  lead?: ReactNode;
  /** Pinned at the row's end: the "+" create button and the view menu. */
  end?: ReactNode;
  /** 'list' (default): 6px before, 8px after (8 each on a phone). 'page': 20px each side (12 on a phone). */
  inset?: 'list' | 'page';
  /** [ and ] step through every item from anywhere on the page (default false). One row per page carries them. */
  keys?: boolean;
  /** Role 'tabs': a stable prefix for tab and panel ids; the pills then control `tabPanelProps(id, value)`. */
  id?: string;
  className?: string;
}

/** Ids shared by a tab and its panel, for a panel rendered outside `<Tabs>`. */
export function tabIds(prefix: string, value: string): { tab: string; panel: string } {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, '_');
  return { tab: `${prefix}-tab-${safe}`, panel: `${prefix}-panel-${safe}` };
}

/** Props for a panel rendered outside `<Tabs>`: `<div {...tabPanelProps(prefix, value)}>`. */
export function tabPanelProps(prefix: string, value: string) {
  const ids = tabIds(prefix, value);
  return { id: ids.panel, role: 'tabpanel' as const, 'aria-labelledby': ids.tab, tabIndex: 0 };
}

/** The next enabled item from the one keyed `from` in `direction`, wrapping round. Null when no other is enabled. */
function stepIn<T extends { disabled?: boolean }>(list: readonly T[], keyOf: (item: T) => string, from: string,
  direction: 1 | -1): T | null {
  const count = list.length;
  const found = list.findIndex((item) => keyOf(item) === from);
  const start = found !== -1 ? found : direction === 1 ? -1 : count;
  for (let step = 1; step <= count; step += 1) {
    const item = list[(((start + direction * step) % count) + count) % count]!;
    if (!item.disabled && keyOf(item) !== from) return item;
  }
  return null;
}

/** The first or last enabled item. */
function edgeIn<T extends { disabled?: boolean }>(list: readonly T[], end: 'first' | 'last'): T | null {
  const ordered = end === 'first' ? list : [...list].reverse();
  return ordered.find((item) => !item.disabled) ?? null;
}

const tabValue = (tab: { value: string }) => tab.value;
const rowItemId = (item: { id: string }) => item.id;

/** The next enabled tab from `from` in `direction`, wrapping round. Null when no other tab is enabled. */
export function stepTab<V extends string>(tabs: readonly TabItem<V>[], from: V, direction: 1 | -1): V | null {
  return stepIn(tabs, tabValue, from, direction)?.value ?? null;
}

/** A strip of view pills whose choice switches the content below it, with its panel when `children` is given. */
export function Tabs<V extends string>({
  tabs, value, onChange, label, keys = true, activation = 'auto', children, id, className, panelClassName,
}: TabsProps<V>) {
  const t = useT();
  const generated = useId();
  const prefix = id ?? `nui-tabs${generated.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ tabs, value, onChange });
  latest.current = { tabs, value, onChange };

  const tabElement = useCallback((tabValue: string) =>
    stripRef.current?.querySelector<HTMLElement>(`[data-tab-value="${cssEscape(tabValue)}"]`) ?? null, []);

  // Keep the active tab in view when the strip scrolls sideways.
  useEffect(() => {
    revealInline(tabElement(value));
  }, [value, tabElement]);

  const show = useCallback((next: V, focus: boolean) => {
    const { value: current, onChange: change } = latest.current;
    if (next !== current) change(next);
    if (focus) tabElement(next)?.focus();
  }, [tabElement]);

  const focusInStrip = () => {
    const strip = stripRef.current;
    const active = strip?.ownerDocument.activeElement ?? null;
    return !!strip && !!active && strip.contains(active);
  };

  const defs = useMemo<ShortcutDef[]>(() => {
    if (!keys) return [];
    const live = () => isVisibleComposed(stripRef.current)
      && latest.current.tabs.filter((tab) => !tab.disabled).length > 1;
    const step = (direction: 1 | -1) => () => {
      const { tabs: list, value: current } = latest.current;
      const next = stepTab(list, current, direction);
      if (next === null) return false;
      show(next, focusInStrip());
      return undefined;
    };
    const def = (entry: KeymapEntry, label: Words, run: ShortcutDef['run']): ShortcutDef =>
      ({ id: entry.id, keys: [...entry.keys], scope: entry.scope, label, when: live, run });
    return [
      def(DEFAULT_KEYMAP['view.prev'], TABS_WORDS.previousView, step(-1)),
      def(DEFAULT_KEYMAP['view.next'], TABS_WORDS.nextView, step(1)),
    ];
  }, [keys, show]);
  useShortcuts(defs, [defs]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    const from = (target?.dataset.tabValue ?? value) as V;
    let next: V | null = null;
    if (event.key === 'ArrowRight') next = stepTab(tabs, from, 1);
    else if (event.key === 'ArrowLeft') next = stepTab(tabs, from, -1);
    else if (event.key === 'Home') next = edgeIn(tabs, 'first')?.value ?? null;
    else if (event.key === 'End') next = edgeIn(tabs, 'last')?.value ?? null;
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (next === null || next === from) return;
    if (activation === 'auto') show(next, true);
    else tabElement(next)?.focus();
  };

  const activeIds = tabIds(prefix, value);
  return (
    <>
      <div ref={stripRef} role="tablist" aria-orientation="horizontal" className={cx('nui-tabs', className)}
        aria-label={t(label ?? TABS_WORDS.views)} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.value === value;
          const ids = tabIds(prefix, tab.value);
          return (
            <button key={tab.value} type="button" role="tab" id={ids.tab} data-tab-value={tab.value}
              aria-selected={selected} aria-controls={ids.panel} tabIndex={selected ? 0 : -1} disabled={tab.disabled}
              className="nui-tab" onClick={() => show(tab.value, false)}>
              {tab.icon !== undefined && renderIcon(tab.icon)}
              <span className="nui-tab-label">{t(tab.label)}</span>
              {typeof tab.count === 'number' && <span className="nui-tab-count">{tab.count}</span>}
            </button>
          );
        })}
      </div>
      {children !== undefined && (
        <div id={activeIds.panel} role="tabpanel" aria-labelledby={activeIds.tab} tabIndex={0}
          className={cx('nui-tabpanel', panelClassName)}>
          {children}
        </div>
      )}
    </>
  );
}

/** The pills a TabRow strip shows: the first `maxVisible`, the active one in the last place when it comes later. */
function splitItems<T extends { id: string }>(items: readonly T[], value: string, maxVisible: number | undefined) {
  if (maxVisible === undefined || items.length <= maxVisible) return { shown: items, hidden: [] as T[] };
  const cap = Math.max(1, Math.floor(maxVisible));
  const active = items.findIndex((item) => item.id === value);
  const shown = active >= cap ? [...items.slice(0, cap - 1), items[active]!] : items.slice(0, cap);
  const ids = new Set(shown.map((item) => item.id));
  return { shown, hidden: items.filter((item) => !ids.has(item.id)) };
}

/** The sum of two lengths from a computed style (padding), or a single one (gap), as pixels. */
function px(...values: (string | undefined)[]): number {
  return values.reduce((total, value) => total + (parseFloat(value ?? '') || 0), 0);
}

/**
 * The 44px row of pills over a list or a page (TLB1, TLB2). Role 'tabs' switches the content below (tablist), role
 * 'filter' narrows one list (radiogroup); one look for both. It never wraps or scrolls: the pills its row has no room
 * for, and those past `maxVisible`, go into a More menu, the active pill kept in the last place. When even the active
 * pill alone has no room beside More and the end content, its label shortens with an ellipsis (its count stays).
 */
export function TabRow<V extends string>({
  role, items, value, onChange, label, maxVisible, lead, end, inset = 'list', keys = false, id, className,
}: TabRowProps<V>) {
  const t = useT();
  const generated = useId();
  const prefix = id ?? `nui-tabrow${generated.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const isTabs = role === 'tabs';
  const stripRef = useRef<HTMLDivElement | null>(null);
  const focusNext = useRef<string | null>(null);
  const widths = useRef(new Map<string, number>());
  const moreWidth = useRef(MORE_GUESS);
  // The pills the row has room for (undefined: all of them), measured from every pill drawn once.
  const [fit, setFit] = useState<number | undefined>(undefined);
  const sizeKey = items.map((item) => [item.id, t(item.label), item.count ?? '',
    typeof item.icon === 'string' ? item.icon : item.icon === undefined ? '' : '*'].join('\u0001')).join('\u0002');
  const [measuredKey, setMeasuredKey] = useState<string | null>(null);
  const measuring = measuredKey !== sizeKey;
  const limit = measuring ? undefined : fit ?? maxVisible;
  const { shown, hidden } = useMemo(() => splitItems(items, value, limit), [items, value, limit]);
  const latest = useRef({ items, value, onChange, maxVisible });
  latest.current = { items, value, onChange, maxVisible };

  const pill = useCallback((itemId: string) =>
    stripRef.current?.querySelector<HTMLElement>(`[data-item-id="${cssEscape(itemId)}"]`) ?? null, []);

  // Folds the pills past the row's room into More: the largest cap whose pills (and the More pill) fit.
  const refit = useCallback(() => {
    const strip = stripRef.current;
    const tabs = strip?.parentElement;
    const row = tabs?.parentElement;
    const view = row?.ownerDocument.defaultView;
    if (!strip || !tabs || !row || !view) return;
    const { items: list, value: current, maxVisible: cap } = latest.current;
    const rowStyle = view.getComputedStyle(row);
    const stripStyle = view.getComputedStyle(strip);
    const gap = px(rowStyle.columnGap);
    const more = row.querySelector<HTMLElement>(':scope > .nui-tabrow-more');
    if (more && more.offsetWidth > 0) moreWidth.current = more.offsetWidth;
    let room = row.clientWidth - px(rowStyle.paddingLeft, rowStyle.paddingRight);
    for (const kid of Array.from(row.children) as HTMLElement[]) {
      if (kid !== tabs && kid !== more) room -= kid.offsetWidth + gap;
    }
    // A row that is not laid out (hidden, or no layout at all) keeps its last fold.
    if (row.clientWidth <= 0) return;
    if (list.some((item) => !widths.current.has(item.id))) { setMeasuredKey(null); return; }
    const pillGap = px(stripStyle.columnGap);
    const span = (pills: readonly { id: string }[]) => pills.reduce((total, item, index) =>
      total + (widths.current.get(item.id) ?? 0) + (index > 0 ? pillGap : 0),
    px(stripStyle.paddingLeft, stripStyle.paddingRight));
    const all = splitItems(list, current, cap);
    let next: number | undefined;
    if (all.hidden.length === 0 && span(all.shown) <= room) next = undefined;
    else {
      const left = room - gap - moreWidth.current;
      next = 1;
      for (let count = Math.min(cap ?? list.length, list.length); count > 1; count -= 1) {
        if (span(splitItems(list, current, count).shown) <= left) { next = count; break; }
      }
      if (cap !== undefined && next >= cap) next = undefined;
    }
    setFit((prev) => (prev === next ? prev : next));
  }, []);

  // Every render: note the drawn pills' widths (all of them after a label or count changed), then fold to the room.
  // A squeezed active pill counts at its whole width (the part its cut label hides added back): its cut width would
  // make the row look roomy, unfold, fold again and never settle.
  useIsoLayoutEffect(() => {
    const strip = stripRef.current;
    const laidOut = !!strip?.parentElement?.parentElement && strip.parentElement.parentElement.clientWidth > 0;
    if (measuring) widths.current.clear();
    if (strip && laidOut) {
      for (const kid of Array.from(strip.children) as HTMLElement[]) {
        if (kid.dataset.itemId === undefined) continue;
        const label = kid.querySelector<HTMLElement>(':scope > .nui-pill-label');
        const cut = label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0;
        widths.current.set(kid.dataset.itemId, kid.offsetWidth + cut);
      }
    }
    if (measuring) { setMeasuredKey(sizeKey); return; }
    refit();
  });

  useEffect(() => {
    const row = stripRef.current?.closest('.nui-tabrow');
    if (!row) return undefined;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => refit()) : null;
    observer?.observe(row);
    let alive = true;
    // Web fonts change every pill's width: draw them all once more.
    void row.ownerDocument.fonts?.ready.then(() => { if (alive) setMeasuredKey(null); });
    return () => { alive = false; observer?.disconnect(); };
  }, [refit]);

  // Focuses a pill that came in from the More menu once it joins the strip.
  const shownKey = shown.map((item) => item.id).join('\n');
  useEffect(() => {
    // A choice the caller did not take leaves nothing to focus later.
    const wanted = focusNext.current;
    focusNext.current = null;
    if (wanted !== null && wanted === value) pill(value)?.focus();
  }, [value, shownKey, pill]);

  const select = useCallback((next: V, focus: boolean) => {
    const { value: current, onChange: change } = latest.current;
    if (next !== current) change(next);
    if (!focus) return;
    // A pill chosen from the More menu joins the strip on the next render: focus it there.
    const target = pill(next);
    if (target) target.focus();
    else focusNext.current = next;
  }, [pill]);

  const focusInRow = () => {
    const strip = stripRef.current;
    const row = strip?.closest('.nui-tabrow') ?? null;
    const active = strip ? deepActiveElement(strip.getRootNode() as Document | ShadowRoot) : null;
    return !!row && !!active && row.contains(active);
  };

  const defs = useMemo<ShortcutDef[]>(() => {
    if (!keys) return [];
    const live = () => isVisibleComposed(stripRef.current)
      && latest.current.items.filter((item) => !item.disabled).length > 1;
    const step = (direction: 1 | -1) => () => {
      const { items: list, value: current } = latest.current;
      const next = stepIn(list, rowItemId, current, direction);
      if (next === null) return false;
      select(next.id, focusInRow());
      return undefined;
    };
    const def = (entry: KeymapEntry, label: Words, run: ShortcutDef['run']): ShortcutDef =>
      ({ id: entry.id, keys: [...entry.keys], scope: entry.scope, label, when: live, run });
    return [
      def(DEFAULT_KEYMAP['view.prev'], TABS_WORDS.previousView, step(-1)),
      def(DEFAULT_KEYMAP['view.next'], TABS_WORDS.nextView, step(1)),
    ];
  }, [keys, select]);
  useShortcuts(defs, [defs]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
    const from = target?.dataset.itemId ?? value;
    // A radio group answers all four arrows; a tab list only the sideways ones.
    const forward = event.key === 'ArrowRight' || (!isTabs && event.key === 'ArrowDown');
    const back = event.key === 'ArrowLeft' || (!isTabs && event.key === 'ArrowUp');
    let next: TabRowItem<V> | null = null;
    if (forward) next = stepIn(shown, rowItemId, from, 1);
    else if (back) next = stepIn(shown, rowItemId, from, -1);
    else if (event.key === 'Home') next = edgeIn(shown, 'first');
    else if (event.key === 'End') next = edgeIn(shown, 'last');
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (next === null || next.id === from) return;
    select(next.id, true);
  };

  const tabStop = shown.some((item) => item.id === value && !item.disabled) ? value : edgeIn(shown, 'first')?.id;

  return (
    <div className={cx('nui-tabrow', className)} data-inset={inset === 'page' ? 'page' : undefined}
      data-fold={!measuring && limit === 1 && hidden.length > 0 ? 'least' : undefined}>
      {lead}
      <div className="nui-tabrow-tabs">
        <div ref={stripRef} role={isTabs ? 'tablist' : 'radiogroup'} aria-orientation={isTabs ? 'horizontal' : undefined}
          aria-label={t(label ?? (isTabs ? TABS_WORDS.views : TABROW_WORDS.filters))} className="nui-tabrow-strip"
          onKeyDown={onKeyDown}>
          {shown.map((item) => {
            const on = item.id === value;
            const ids = tabIds(prefix, item.id);
            return (
              <button key={item.id} type="button" className="nui-pill" data-item-id={item.id}
                data-on={on ? '' : undefined} role={isTabs ? 'tab' : 'radio'} id={isTabs ? ids.tab : undefined}
                aria-selected={isTabs ? on : undefined} aria-checked={isTabs ? undefined : on}
                aria-controls={isTabs && id !== undefined ? ids.panel : undefined}
                tabIndex={item.id === tabStop ? 0 : -1} disabled={item.disabled} onClick={() => select(item.id, false)}>
                {item.icon !== undefined && renderIcon(item.icon)}
                <span className="nui-pill-label">{t(item.label)}</span>
                {typeof item.count === 'number' && <span className="nui-pill-count">{item.count}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {hidden.length > 0 && (
        <Menu label={TABROW_WORDS.showMore} trigger={
          <button type="button" className="nui-pill nui-tabrow-more">
            <span className="nui-pill-label">{t(TABROW_WORDS.more)}</span>
            <Icon name="caret-down" className="nui-tabrow-caret" />
          </button>
        }>
          {hidden.map((item) => (
            <Menu.Item key={item.id} icon={item.icon} disabled={item.disabled} onSelect={() => select(item.id, true)}>
              {t(item.label)}
              {typeof item.count === 'number' && <span className="nui-tabrow-menu-count">{item.count}</span>}
            </Menu.Item>
          ))}
        </Menu>
      )}
      {end !== undefined && <div className="nui-tabrow-end">{end}</div>}
    </div>
  );
}
