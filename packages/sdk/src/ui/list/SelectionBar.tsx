/**
 * SelectionBar (toolkit spec 2.6): the locked "today" pill at the bottom of a list while rows are selected.
 *
 * "{n} selected", then one button per action (label, then a pill keycap), overflow in a More menu, and X to clear
 * (its tooltip shows Esc). Where it does not fit the pill drops the keys, then the words (`data-fit`), and every
 * button then carries a tooltip with both, as in the deck.
 *
 * `useSelectionBar` registers the action keys once per key at `collection` with boost 25, so they win over row keys.
 * With nothing selected the keys act on a fallback (the open item or the cursor row), as in the Manager.
 */

import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { SHELL_WORDS, canonicalKey, keyList, selectedCount, type Words } from '../../words';
import { useShortcuts, useToolkitLocale, useToolkitPlatform } from '../engine/hooks';
import type { ShortcutDef } from '../engine/types';
import { Keycap, KeycapSurface } from '../keycap';
import { Icon, renderIcon } from '../icons';
import { Menu } from '../overlay/Menu';
import { Tooltip } from '../overlay/Tooltip';
import { cx, useIsoLayoutEffect, useLatest, useT } from '../util';
import type { ActionOutcome, ActionsController, ResolvedAction } from '../actions/useActions';
import type { Selection } from './useSelection';

/** Buttons shown in the pill before the rest go into More. */
export const SELECTION_BAR_MAX_INLINE = 5;

/** The boost of the bar's keys over row keys (toolkit spec 2.1). */
export const SELECTION_BAR_BOOST = 25;

export type SelectionBarFit = '' | 'nokeys' | 'icons';

export interface SelectionBarProps {
  /** The actions that apply to the selected items, in order. */
  actions: readonly ResolvedAction<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  count: number;
  onClear(): void;
  /** `anchor` is the pressed button (a picker action opens its menu there). */
  onRun(action: ResolvedAction<any>, anchor?: HTMLElement | null): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Ids of the actions running now: their buttons show busy and ignore presses. */
  busy?: ReadonlySet<string>;
  /** 'list' (default): the pill centres on its list. 'page': on the whole page. */
  anchor?: 'list' | 'page';
  className?: string;
}

const BAR_WORDS = Object.freeze({
  label: { en: 'Selection actions', fr: 'Actions de la sélection' },
}) satisfies Readonly<Record<string, Words>>;

/** The first fit that leaves `room` px, trying keys and words, then words only, then icons. */
export function chooseFit(measure: (fit: SelectionBarFit) => number, room: number): SelectionBarFit {
  for (const fit of ['', 'nokeys', 'icons'] as const) if (measure(fit) <= room) return fit;
  return 'icons';
}

export function SelectionBar({ actions, count, onClear, onRun, busy, anchor = 'list', className }: SelectionBarProps) {
  const t = useT();
  const locale = useToolkitLocale();
  const barRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<SelectionBarFit>('');
  const inline = actions.slice(0, SELECTION_BAR_MAX_INLINE);
  const overflow = actions.slice(SELECTION_BAR_MAX_INLINE);
  const label = t(selectedCount(count));
  const signature = `${actions.map((action) => action.id).join(',')}|${count}|${locale}`;

  // Step down until the pill fits its slot (24px of air), as the deck's fitPill does.
  const refit = useCallback(() => {
    const bar = barRef.current;
    const slot = bar?.parentElement;
    if (!bar || !slot) return;
    const room = slot.clientWidth - 24;
    if (room <= 0) return;
    bar.style.maxWidth = 'none';
    const next = chooseFit((candidate) => {
      if (candidate) bar.dataset.fit = candidate;
      else delete bar.dataset.fit;
      return bar.offsetWidth;
    }, room);
    bar.style.maxWidth = '';
    if (next) bar.dataset.fit = next;
    else delete bar.dataset.fit;
    setFit(next);
  }, []);

  useIsoLayoutEffect(() => { refit(); }, [refit, signature]);
  useIsoLayoutEffect(() => {
    const slot = barRef.current?.parentElement;
    if (!slot || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => refit());
    observer.observe(slot);
    return () => observer.disconnect();
  }, [refit]);

  // Tooltips only while something is hidden (the deck's wordsShown rule).
  const tipped = (key: string, node: ReactElement, name: Words | string, keys: string[] | undefined) => (
    <Tooltip key={key} label={name} keys={keys} disabled={fit === ''}>{node}</Tooltip>
  );

  return (
    <div className="nui-selbar-slot" data-anchor={anchor === 'page' ? 'page' : undefined}>
      <KeycapSurface on="pill">
        <div ref={barRef} className={cx('nui-selbar', className)} role="toolbar" aria-label={t(BAR_WORDS.label)}
          data-fit={fit || undefined}>
          <span className="nui-sb-count" aria-live="polite">{label}</span>
          {inline.map((action) => {
            const keys = keyList(action.key);
            const name = t(action.label);
            const running = !!busy?.has(action.id);
            return tipped(action.id,
                  <button type="button" className="nui-sb-btn" aria-label={name} data-action={action.id}
                    aria-busy={running || undefined} disabled={running}
                    aria-haspopup={action.options ? 'menu' : undefined}
                    data-tone={action.tone === 'danger' ? 'danger' : undefined}
                    onClick={(event) => onRun(action, event.currentTarget)}>
                    <span className="nui-sb-icon">{renderIcon(action.icon as ReactNode)}</span>
                    <span className="nui-sb-label">{name}</span>
                    {keys.length > 0 && <Keycap keys={keys} className="nui-sb-keys" />}
                  </button>,
                  action.label, keys.length ? keys : undefined);
          })}
          {overflow.length > 0 && (
            <Menu side="top" align="end" label={SHELL_WORDS.more} accelerators={false}
              trigger={(
                <button type="button" className="nui-sb-btn" aria-label={t(SHELL_WORDS.more)}>
                  <span className="nui-sb-icon"><Icon name="dots-three" /></span>
                  <span className="nui-sb-label">{t(SHELL_WORDS.more)}</span>
                </button>
              )}>
              {overflow.map((action) => (
                <Menu.Item key={action.id} icon={action.icon as ReactNode} tone={action.tone}
                  disabled={!!busy?.has(action.id)}
                  keys={action.key ? keyList(action.key) : undefined} onSelect={() => onRun(action, null)}>
                  {t(action.label)}
                </Menu.Item>
              ))}
            </Menu>
          )}
          {tipped('clear',
            <button type="button" className="nui-sb-btn" aria-label={t(SHELL_WORDS.clearSelection)} data-action="clear"
              onClick={onClear}>
              <Icon name="x" className="nui-sb-x" />
            </button>,
            SHELL_WORDS.clearSelection, ['escape'],
          )}
        </div>
      </KeycapSurface>
    </div>
  );
}

// ---- hook ----

export interface UseSelectionBarOptions<T> {
  controller: ActionsController<T>;
  selection: Selection;
  /** Items by id (the list's items). */
  getItem(id: string): T | undefined;
  /** What the keys act on while nothing is selected (the open item, else the cursor row). */
  fallback?: () => T[];
  /** Keys off while false (the list is hidden). */
  when?: () => boolean;
  /** Owner override (default the nearest ShortcutScope). */
  owner?: string;
  /** Called after an action ran on the selection (ListReader moves the cursor off removed rows). */
  onRan?: (action: ResolvedAction<T>, items: T[], outcome: ActionOutcome<T>) => void;
  /**
   * A picker action (one with `options`) was chosen: open its menu at `anchor` (the bar button, null from a key or
   * the More menu). Without it the action runs at once with no choice.
   */
  onPick?: (action: ResolvedAction<T>, items: T[], anchor: HTMLElement | null) => void;
}

export interface SelectionBarState<T> {
  /** Something is selected and the list has bulk actions: draw the bar. */
  visible: boolean;
  selectedItems: T[];
  /** Spread on `<SelectionBar />`. */
  barProps: SelectionBarProps;
  /**
   * Runs an action on the selection (or the fallback when nothing is selected). A picker action goes to `onPick`
   * instead and resolves null.
   */
  runAction(action: ResolvedAction<T>, anchor?: HTMLElement | null): Promise<ActionOutcome<T> | null>;
}

export function useSelectionBar<T>(options: UseSelectionBarOptions<T>): SelectionBarState<T> {
  const { controller, selection, getItem } = options;
  const platform = useToolkitPlatform();
  const latest = useLatest(options);
  const selectedItems = useMemo(() => {
    const out: T[] = [];
    for (const id of selection.selected) {
      const item = getItem(id);
      if (item !== undefined) out.push(item);
    }
    return out;
  }, [selection.selected, getItem]);
  const bulk = useMemo(() => controller.actions.filter((action) => action.bulk), [controller.actions]);
  const available = useMemo(() => controller.available(selectedItems).filter((action) => action.bulk),
    [controller, selectedItems]);

  const targets = useCallback((): T[] => {
    const { selection: sel, getItem: lookup, fallback } = latest.current;
    if (sel.count > 0) {
      const out: T[] = [];
      for (const id of sel.selected) { const item = lookup(id); if (item !== undefined) out.push(item); }
      return out;
    }
    return fallback?.() ?? [];
  }, [latest]);

  const runAction = useCallback(async (action: ResolvedAction<T>, anchor: HTMLElement | null = null) => {
    const items = targets();
    if (!items.length) return null;
    const live = latest.current;
    if (action.options && live.onPick) {
      live.onPick(action, items, anchor);
      return null;
    }
    const outcome = await live.controller.run(action, items);
    if (outcome.status !== 'busy') latest.current.onRan?.(action, items, outcome);
    return outcome;
  }, [latest, targets]);

  // One def per key: E is Complete or Archive, S is Star or Unstar (the one that fits every target).
  const groups = useMemo(() => {
    const byKey = new Map<string, { spec: string; actions: ResolvedAction<T>[] }>();
    for (const action of bulk) {
      for (const spec of keyList(action.key)) {
        const canonical = canonicalKey(spec, platform);
        const group = byKey.get(canonical) ?? { spec, actions: [] };
        group.actions.push(action);
        byKey.set(canonical, group);
      }
    }
    return [...byKey.entries()];
  }, [bulk, platform]);

  const defs = useMemo<ShortcutDef[]>(() => groups.map(([canonical, group]) => ({
    id: `selection.${group.actions.map((action) => action.id).join('|')}.${canonical}`,
    keys: [group.spec],
    scope: 'collection',
    boost: SELECTION_BAR_BOOST,
    label: group.actions[0]!.label,
    ...(latest.current.owner ? { owner: latest.current.owner } : {}),
    when: () => (latest.current.when?.() ?? true) && targets().length > 0,
    run: () => {
      const items = targets();
      const fits = latest.current.controller.available(items);
      const action = group.actions.find((candidate) => fits.some((fit) => fit.id === candidate.id));
      if (!action) return false;
      void runAction(action);
      return true;
    },
  })), [groups, latest, runAction, targets]);

  useShortcuts(defs);

  const barProps: SelectionBarProps = {
    actions: available,
    count: selection.count,
    onClear: selection.clear,
    onRun: (action, anchor) => { void runAction(action as ResolvedAction<T>, anchor ?? null); },
    busy: controller.busy,
  };

  return { visible: selection.count > 0 && bulk.length > 0, selectedItems, barProps, runAction };
}
