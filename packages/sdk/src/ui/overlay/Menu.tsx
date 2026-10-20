/**
 * Menu (toolkit spec 2.8): a trigger and a list of items that opens in the layer root, so inside a Space it renders
 * in the Space shadow root and picks up the adopted toolkit sheet.
 *
 * Keys while open: arrows, Home, End, Enter and Space move and choose; Right opens a submenu, Left closes it; an
 * item's `keys` choose it; a letter jumps to the next item starting with it. Escape closes through the engine's
 * escape chain (overlay layer). Focus sits in the menu, so the engine's typing rule keeps page keys silent.
 *
 * Keys while closed: an item's `keys` still choose it while the trigger shows (menu accelerators, registered with the
 * engine and hidden from the help sheet). See `MenuProps.accelerators`.
 */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  isSequenceSpec, isValidKeySpec, keyFingerprints, keyList, matchChord, matchKey, selfClashes, toAriaKeyShortcuts,
  type KeySpec, type Words,
} from '../../words';
import { ESCAPE_PRIORITY, type KeyboardEngineCore } from '../engine/core';
import {
  containsComposed, eventTarget, isVisibleComposed, keysOff, modalLayerOf, openModalLayers,
} from '../engine/dom';
import { useEngineCore, useEscapeLayer, useShortcutOwner, useToolkitPlatform } from '../engine/hooks';
import { ROOT_OWNER, safeWhen } from '../engine/registry';
import type { OwnerKind, ShortcutDef } from '../engine/types';
import { Keycap, KeycapSurface } from '../keycap';
import { Icon, renderIcon } from '../icons';
import { cx, deepActiveElement, flag, useLatest, useStableId, useT } from '../util';
import { useFloatingStyle, useOutsidePress } from './floating';
import { findLayerRoot, usePinnedLayerRoot } from './layerRoot';
import type { Align, Side } from './position';
import { cloneTrigger } from './trigger';

const ITEM_SELECTOR = '[data-nui-menu-item]';

interface MenuTree {
  /** Closes the whole menu (every submenu included). */
  close(options?: { focusTrigger?: boolean }): void;
  isOpen: boolean;
  panels: Set<HTMLElement>;
}

interface PanelContextValue {
  tree: MenuTree;
  /** The open submenu of this panel, by its trigger id. */
  openSub: string | null;
  setOpenSub(id: string | null): void;
  panel: () => HTMLElement | null;
}

const TreeContext = createContext<MenuTree | null>(null);
const PanelContext = createContext<PanelContextValue | null>(null);

export interface MenuProps {
  /**
   * The element that opens the menu (usually a button). Its own props and ref are kept. Leave it out and pass
   * `anchor` with a controlled `open` to open the menu at an element the caller already draws.
   */
  trigger?: ReactElement;
  /**
   * Without a trigger: the element the menu opens at (and gives focus back to). The menu then focuses its first
   * item when it opens, as after a keyboard open.
   */
  anchor?: HTMLElement | null | React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: Align;
  side?: Side;
  /** Accessible name of the menu. */
  label?: Words | string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /**
   * Default true: while the menu is closed and its trigger (or anchor) shows and is enabled, an item's `keys` choose
   * it, and its `onSelect` runs without an event. On the page they answer at route scope; inside a dialog at modal
   * scope, while focus is in that dialog and no other menu is open. They come last: any other shortcut on the same
   * key goes first, and so does a key sequence that starts with it. They are not listed in the help sheet: the menu
   * shows them. Left out: sequence keys ('g i'), keys Notis keeps for itself in a Space, items of a disabled
   * submenu and items your own component draws (only `Menu.Item` written in the menu's children, fragments and
   * `Menu.Sub` included, is read). Pass false for a menu drawn once per row or card, or one whose keys a list or
   * selection bar already handles.
   */
  accelerators?: boolean;
}

export interface MenuController {
  close(): void;
  isOpen: boolean;
}

/** Inside a menu: close it from a custom item. */
export function useMenu(): MenuController {
  const tree = useContext(TreeContext);
  return useMemo(() => ({ close: () => tree?.close({ focusTrigger: true }), isOpen: !!tree?.isOpen }), [tree]);
}

function items(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
    .filter((item) => item.closest('.nui-menu') === panel && item.getAttribute('aria-disabled') !== 'true');
}

function focusItem(panel: HTMLElement | null, which: 'first' | 'last' | 'next' | 'prev'): void {
  const list = items(panel);
  if (list.length === 0) return;
  const active = deepActiveElement(panel?.getRootNode() as Document | ShadowRoot | undefined);
  const index = active ? list.indexOf(active as HTMLElement) : -1;
  let next: HTMLElement | undefined;
  if (which === 'first') next = list[0];
  else if (which === 'last') next = list[list.length - 1];
  else if (which === 'next') next = list[index === -1 ? 0 : (index + 1) % list.length];
  else next = list[index === -1 ? list.length - 1 : (index - 1 + list.length) % list.length];
  next?.focus({ preventScroll: false });
}

function MenuPanel({ open, anchor, side, align, label, className, tree, onKeyDownExtra, children, layerRoot, id }: {
  open: boolean; anchor: React.RefObject<HTMLElement | null>; side: Side; align: Align; label?: Words | string;
  className?: string; tree: MenuTree; onKeyDownExtra?: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
  children: ReactNode; layerRoot: HTMLElement | null; id: string;
}) {
  const t = useT();
  const platform = useToolkitPlatform();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const { style, side: placedSide } = useFloatingStyle(open && !!layerRoot, anchor, panelRef, { side, align, offset: side === 'right' || side === 'left' ? 2 : 4 });
  const typeahead = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  // Registered once the panel is in the page. On a first open the layer root arrives a render after `open`, and a
  // panel missing from the tree counts as outside the menu: pressing an item would close the menu before it chose,
  // and a keyboard open would not focus the first item.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    tree.panels.add(panel);
    return () => { tree.panels.delete(panel); };
  }, [open, tree, layerRoot]);
  useEffect(() => { if (!open) setOpenSub(null); }, [open]);

  const panelContext = useMemo<PanelContextValue>(() => ({ tree, openSub, setOpenSub, panel: () => panelRef.current }),
    [tree, openSub]);

  if (!open || !layerRoot) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const panel = panelRef.current;
    if (onKeyDownExtra?.(event)) return;
    // Keys of a nested panel are handled there.
    if ((event.target as Element).closest?.('.nui-menu') !== panel) return;
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusItem(panel, 'next'); return;
      case 'ArrowUp': event.preventDefault(); focusItem(panel, 'prev'); return;
      case 'Home': event.preventDefault(); focusItem(panel, 'first'); return;
      case 'End': event.preventDefault(); focusItem(panel, 'last'); return;
      case 'Tab': tree.close(); return;
      case 'Enter':
      case ' ': {
        const target = event.target as HTMLElement;
        if (target.matches(ITEM_SELECTOR)) { event.preventDefault(); target.click(); }
        return;
      }
      default: break;
    }
    if (event.key === 'ArrowRight') {
      const target = event.target as HTMLElement;
      if (target.getAttribute('aria-haspopup') === 'menu') { event.preventDefault(); target.click(); }
      return;
    }
    // An item's own keys choose it while the menu is open.
    for (const item of items(panel)) {
      const keys = item.getAttribute('data-nui-keys');
      if (!keys) continue;
      if (keys.split('\n').some((spec) => matchKey(event.nativeEvent, spec, platform))) {
        event.preventDefault();
        event.stopPropagation();
        item.click();
        return;
      }
    }
    if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const text = (now - typeahead.current.at < 700 ? typeahead.current.text : '') + event.key.toLowerCase();
      typeahead.current = { text, at: now };
      const list = items(panel);
      const active = deepActiveElement(panel?.getRootNode() as Document | ShadowRoot | undefined) as HTMLElement | null;
      const start = active ? list.indexOf(active) : -1;
      const ordered = [...list.slice(start + 1), ...list.slice(0, start + 1)];
      const match = ordered.find((item) => (item.textContent || '').trim().toLowerCase().startsWith(text))
        ?? (text.length > 1 ? undefined : ordered.find((item) => (item.textContent || '').trim().toLowerCase().startsWith(event.key.toLowerCase())));
      if (match) { event.preventDefault(); match.focus(); }
    }
  };

  return createPortal(
    <PanelContext.Provider value={panelContext}>
      <KeycapSurface on="discreet">
        <div
          ref={panelRef}
          id={id}
          role="menu"
          aria-label={label ? t(label) : undefined}
          aria-orientation="vertical"
          tabIndex={-1}
          data-notis-escape-owned=""
          data-notis-floating=""
          data-state="open"
          data-side={placedSide}
          className={cx('nui-menu', className)}
          style={style}
          onKeyDown={onKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        >
          {children}
        </div>
      </KeycapSurface>
    </PanelContext.Provider>,
    layerRoot,
  );
}

function resolveAnchor(anchor: MenuProps['anchor']): HTMLElement | null {
  if (!anchor) return null;
  if (typeof (anchor as HTMLElement).getBoundingClientRect === 'function') return anchor as HTMLElement;
  return (anchor as React.RefObject<HTMLElement | null>).current ?? null;
}

// ---- accelerators: item keys while the menu is closed ----

/** Ids of accelerator defs. Accelerators of two menus never give way to one another. */
const ACCELERATOR_ID = 'notis.menu-key:';
/** Per copy of the toolkit, so two copies loaded by mistake never share a menu owner. */
const OWNER_SALT = Math.random().toString(36).slice(2, 8);

interface KeyedItem {
  specs: KeySpec[];
  disabled: boolean;
  /** The item's text, the hidden label of its accelerator. */
  label: string;
  onSelect?: MenuItemProps['onSelect'];
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

/** The items with keys, read from the menu's children: `Menu.Item`, through fragments and enabled submenus. */
function keyedItems(children: ReactNode, out: KeyedItem[] = []): KeyedItem[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      keyedItems((child.props as { children?: ReactNode }).children, out);
      return;
    }
    if (child.type === MenuSub) {
      const sub = child.props as MenuSubProps;
      if (!sub.disabled) keyedItems(sub.children, out);
      return;
    }
    if (child.type !== MenuItem) return;
    const props = child.props as MenuItemProps;
    const specs = keyList(props.keys).filter((spec) => isValidKeySpec(spec) && !isSequenceSpec(spec));
    if (!specs.length) return;
    out.push({ specs, disabled: !!props.disabled, label: textOf(props.children).trim(), onSelect: props.onSelect });
  });
  return out;
}

/** Items whose keys overlap share one def, so a menu never holds a key twice in a scope. */
function groupSpecs(lists: readonly KeySpec[][]): KeySpec[][] {
  let groups: Array<{ specs: Set<KeySpec>; prints: Set<string> }> = [];
  for (const specs of lists) {
    if (!specs.length) continue;
    const next = { specs: new Set(specs), prints: new Set(keyFingerprints(specs).keys()) };
    const rest: typeof groups = [];
    for (const group of groups) {
      if ([...group.prints].some((print) => next.prints.has(print))) {
        for (const spec of group.specs) next.specs.add(spec);
        for (const print of group.prints) next.prints.add(print);
      } else {
        rest.push(group);
      }
    }
    groups = [...rest, next];
  }
  return groups.map((group) => [...group.specs]);
}

/**
 * Accelerators come last. Another shortcut on this key answers instead when the engine asks it after the accelerator
 * (a lower rank, or the same rank registered earlier), and so does a sequence that starts with the key. Shortcuts
 * asked before the accelerator already had their turn.
 */
function pageKeyComesFirst(core: KeyboardEngineCore, def: ShortcutDef, event: KeyboardEvent): boolean {
  const { platform } = core.settings;
  const ours = core.registry.all().find((entry) => entry.def === def);
  if (!ours) return false;
  for (const entry of core.registry.active({ modalOnly: def.scope === 'modal' })) {
    if (entry.def.id.startsWith(ACCELERATOR_ID)) continue;
    const asksLater = entry.rank < ours.rank || (entry.rank === ours.rank && entry.seq < ours.seq);
    const hit = entry.chords.some((chords) => matchChord(event, chords[0]!, platform) && (chords.length > 1 || asksLater));
    if (hit && (!entry.def.when || safeWhen(entry.def.when))) return true;
  }
  return false;
}

/** Inside a dialog, the key comes from that dialog (or from no focused element). */
function keyFromLayer(element: Element, event: KeyboardEvent): boolean {
  const layer = modalLayerOf(element);
  if (!layer) return false;
  const target = eventTarget(event);
  const doc = element.ownerDocument;
  return !target || target === doc.body || target === doc.documentElement || containsComposed(layer, target);
}

function useMenuAccelerators({ id, enabled, children, open, target }: {
  id: string; enabled: boolean; children: ReactNode; open: boolean; target: () => HTMLElement | null;
}): void {
  const core = useEngineCore();
  const parent = useShortcutOwner();
  const items = enabled ? keyedItems(children) : [];
  const live = useLatest({ items, open, target });
  const itemKey = JSON.stringify(items.map((item) => item.specs));

  useEffect(() => {
    const lists = live.current.items.map((item) => item.specs);
    if (!lists.length) return undefined;
    // A passive effect: the owners above are declared by now (layout effects), so their kind is known.
    const kind: OwnerKind = parent === ROOT_OWNER ? 'host' : core.registry.ownerKind(parent);
    const allowed = new Set<KeySpec>(lists.flat().filter((spec) =>
      !selfClashes({ id, keys: spec, scope: 'route', owner: parent, ownerKind: kind }).some((clash) => clash.severity === 'error')));
    const groups = groupSpecs(lists.map((specs) => specs.filter((spec) => allowed.has(spec))));
    if (!groups.length) return undefined;
    const owner = `${id}:${OWNER_SALT}:keys`;
    const release = core.defineOwner(owner, { parent, kind });

    const gate = (scope: 'route' | 'modal'): boolean => {
      if (live.current.open) return false;
      const element = live.current.target();
      if (!element || !isVisibleComposed(element) || keysOff(element)) return false;
      if (element.matches(':disabled, [aria-disabled="true"]')) return false;
      const layer = modalLayerOf(element);
      if (scope === 'route') return !layer;
      // Another open menu or list has the keys.
      return !!layer && !openModalLayers(element.ownerDocument).some((el) => el.matches('[role="menu"], [role="listbox"]'));
    };

    const unregisters: Array<(() => void) | null> = [];
    groups.forEach((specs, index) => {
      const label = live.current.items.find((item) => item.specs.some((spec) => specs.includes(spec)))?.label || specs[0]!;
      for (const scope of ['route', 'modal'] as const) {
        const def: ShortcutDef = {
          id: `${ACCELERATOR_ID}${id}:${scope}:${index}`,
          keys: specs,
          scope,
          owner,
          hidden: true,
          label: { en: label, fr: label },
          when: () => gate(scope),
          run: (event) => {
            if (!gate(scope)) return false;
            const { platform } = core.settings;
            const item = live.current.items.find((entry) => !entry.disabled
              && entry.specs.some((spec) => allowed.has(spec) && matchKey(event, spec, platform)));
            if (!item) return false;
            if (scope === 'modal' && !keyFromLayer(live.current.target()!, event)) return false;
            if (pageKeyComesFirst(core, def, event)) return false;
            item.onSelect?.();
            return true;
          },
        };
        unregisters.push(core.register(def, owner));
      }
    });
    return () => {
      for (const unregister of unregisters) unregister?.();
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, parent, id, itemKey]);
}

function MenuRoot({ trigger, anchor, children, align = 'start', side = 'bottom', label, open: controlledOpen,
  onOpenChange, className, accelerators = true }: MenuProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const triggerRef = useRef<HTMLElement | null>(null);
  const pinned = usePinnedLayerRoot();
  const [layerRoot, setLayerRoot] = useState<HTMLElement | null>(null);
  const focusFirst = useRef(false);
  const id = useStableId('nui-menu');
  const latest = useLatest({ onOpenChange, controlled: controlledOpen !== undefined });
  const panels = useRef(new Set<HTMLElement>()).current;
  if (!trigger) triggerRef.current = resolveAnchor(anchor);
  useMenuAccelerators({
    id, enabled: accelerators, children, open,
    target: () => (trigger ? triggerRef.current : resolveAnchor(anchor)),
  });

  const setOpen = useCallback((next: boolean) => {
    if (!latest.current.controlled) setUncontrolled(next);
    latest.current.onOpenChange?.(next);
  }, [latest]);

  const tree = useMemo<MenuTree>(() => ({
    isOpen: open,
    panels,
    close: ({ focusTrigger = false } = {}) => {
      const panelList = Array.from(panels);
      const active = deepActiveElement(triggerRef.current?.getRootNode() as Document | ShadowRoot | undefined);
      const focusInside = !!active && panelList.some((panel) => panel.contains(active));
      setOpen(false);
      if ((focusTrigger || focusInside) && triggerRef.current) triggerRef.current.focus({ preventScroll: true });
    },
  }), [open, panels, setOpen]);

  useEffect(() => {
    if (!open) return;
    setLayerRoot(pinned ?? findLayerRoot(triggerRef.current));
  }, [open, pinned]);

  // Focus the menu once it is placed: the first item after a keyboard open, else the panel itself.
  useEffect(() => {
    if (!open || !layerRoot) return;
    const frame = requestAnimationFrame(() => {
      const panel = Array.from(panels).find((p) => p.id === id) ?? null;
      if (!panel) return;
      if (focusFirst.current || !trigger) focusItem(panel, 'first');
      else panel.focus({ preventScroll: true });
      focusFirst.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, layerRoot, id, panels, trigger]);

  useOutsidePress(open, () => [triggerRef.current, ...Array.from(panels)], () => setOpen(false));
  useEscapeLayer(`menu:${id}`, () => {
    if (!open) return false;
    tree.close({ focusTrigger: true });
    return true;
  }, { priority: ESCAPE_PRIORITY.overlay });

  const triggerNode = trigger ? cloneTrigger(trigger, {
    ref: (node: HTMLElement | null) => { triggerRef.current = node; },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation();
      focusFirst.current = event.detail === 0;
      setOpen(!open);
    },
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusFirst.current = true;
        setOpen(true);
      }
    },
  }) : null;

  return (
    <TreeContext.Provider value={tree}>
      {triggerNode}
      <MenuPanel open={open} anchor={triggerRef} side={side} align={align} label={label} className={className}
        tree={tree} layerRoot={layerRoot} id={id}>
        {children}
      </MenuPanel>
    </TreeContext.Provider>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  icon?: ReactNode | string;
  /**
   * Shown as a discreet keycap; chooses the item while the menu is open, and while it is closed and its trigger
   * shows (see `MenuProps.accelerators`).
   */
  keys?: KeySpec | KeySpec[];
  tone?: 'default' | 'danger';
  /** The click, or no event when the item's key chose it while the menu was closed. */
  onSelect?: (event?: ReactMouseEvent<HTMLButtonElement>) => void;
  /** A check item: shows a check when true. */
  checked?: boolean;
  disabled?: boolean;
  /** Default true. */
  closeOnSelect?: boolean;
  className?: string;
}

function MenuItem({ children, icon, keys, tone = 'default', onSelect, checked, disabled, closeOnSelect = true,
  className }: MenuItemProps) {
  const tree = useContext(TreeContext);
  const panel = useContext(PanelContext);
  const platform = useToolkitPlatform();
  const specs = keyList(keys);
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === undefined ? undefined : checked}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={specs.length ? toAriaKeyShortcuts(specs, platform) : undefined}
      tabIndex={-1}
      data-nui-menu-item=""
      data-nui-keys={specs.length ? specs.join('\n') : undefined}
      data-tone={tone === 'danger' ? 'danger' : undefined}
      className={cx('nui-menu-item', className)}
      onPointerMove={(event) => {
        if (disabled) return;
        if (event.currentTarget !== deepActiveElement(event.currentTarget.getRootNode() as Document | ShadowRoot)) {
          event.currentTarget.focus({ preventScroll: true });
        }
        if (panel?.openSub) panel.setOpenSub(null);
      }}
      onClick={(event) => {
        if (disabled) return;
        onSelect?.(event);
        if (!event.defaultPrevented && closeOnSelect) tree?.close({ focusTrigger: true });
      }}
    >
      {renderIcon(icon)}
      <span className="nui-menu-label">{children}</span>
      {specs.length ? <span className="nui-menu-keys"><Keycap keys={specs} /></span> : null}
      {checked !== undefined ? <Icon name="check" className="nui-menu-check" /> : null}
    </button>
  );
}

function MenuSeparator() {
  return <div role="separator" className="nui-menu-sep" />;
}

export interface MenuSubProps {
  label: ReactNode;
  icon?: ReactNode | string;
  disabled?: boolean;
  children: ReactNode;
  /** Accessible name of the submenu; default its label when the label is text. */
  menuLabel?: Words | string;
}

function MenuSub({ label, icon, disabled, children, menuLabel }: MenuSubProps) {
  const tree = useContext(TreeContext);
  const parent = useContext(PanelContext);
  const id = useStableId('nui-sub');
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const open = !!parent && parent.openSub === id;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layerRoot = itemRef.current ? findLayerRoot(itemRef.current) : null;
  const panelId = `${id}-menu`;

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const panel = tree ? Array.from(tree.panels).find((p) => p.id === panelId) ?? null : null;
      focusItem(panel, 'first');
    });
    return () => cancelAnimationFrame(frame);
  }, [open, panelId, tree]);

  if (!tree || !parent) return null;
  return (
    <>
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-disabled={disabled || undefined}
        tabIndex={-1}
        data-nui-menu-item=""
        data-active={flag(open)}
        className="nui-menu-item"
        onPointerMove={(event) => {
          if (disabled) return;
          event.currentTarget.focus({ preventScroll: true });
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          hoverTimer.current = setTimeout(() => parent.setOpenSub(id), 120);
        }}
        onPointerLeave={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
        onClick={() => { if (!disabled) parent.setOpenSub(open ? null : id); }}
      >
        {renderIcon(icon)}
        <span className="nui-menu-label">{label}</span>
        <Icon name="caret-right" className="nui-menu-caret" />
      </button>
      <MenuPanel
        open={open}
        anchor={itemRef}
        side="right"
        align="start"
        label={menuLabel ?? (typeof label === 'string' ? label : undefined)}
        tree={tree}
        layerRoot={layerRoot}
        id={panelId}
        onKeyDownExtra={(event) => {
          if (event.key !== 'ArrowLeft') return false;
          if ((event.target as Element).closest?.('.nui-menu')?.id !== panelId) return false;
          event.preventDefault();
          parent.setOpenSub(null);
          itemRef.current?.focus();
          return true;
        }}
      >
        {children}
      </MenuPanel>
    </>
  );
}

type MenuComponent = typeof MenuRoot & {
  Item: typeof MenuItem;
  Separator: typeof MenuSeparator;
  Sub: typeof MenuSub;
};

export const Menu = MenuRoot as MenuComponent;
Menu.Item = MenuItem;
Menu.Separator = MenuSeparator;
Menu.Sub = MenuSub;

export { MenuItem, MenuSeparator, MenuSub };
