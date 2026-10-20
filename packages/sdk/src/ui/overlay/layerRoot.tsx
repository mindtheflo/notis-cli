/**
 * Where overlays (Menu, Popover, Tooltip) render (toolkit spec 1.4.8): the nearest element with the layer-root
 * attribute inside the current shadow root, so they open inside the Space and pick up its adopted toolkit sheet and
 * theme; in the Portal document, the page body.
 *
 * A shadow root without a host layer root gets one, created inside the app root (which carries the theme and the
 * Portal token snapshot) or, without it, at the end of the shadow root.
 */

import React, { createContext, useContext, type ReactNode } from 'react';

export const LAYER_ROOT_ATTRIBUTE = 'data-notis-layer-root';

const LayerRootContext = createContext<HTMLElement | null>(null);

/** Pins the layer root for a subtree (a host that renders its own overlay container). */
export function LayerRootProvider({ root, children }: { root: HTMLElement | null; children?: ReactNode }) {
  return <LayerRootContext.Provider value={root}>{children}</LayerRootContext.Provider>;
}

/** The layer root for overlays opened from `from` (usually the trigger element). */
export function findLayerRoot(from: Node | null | undefined): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const root = from && typeof from.getRootNode === 'function' ? from.getRootNode() : document;
  if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
    const existing = root.querySelector<HTMLElement>(`[${LAYER_ROOT_ATTRIBUTE}]`);
    if (existing) return existing;
    const created = root.ownerDocument.createElement('div');
    created.setAttribute(LAYER_ROOT_ATTRIBUTE, '');
    created.className = 'nui-layer';
    const appRoot = root.querySelector<HTMLElement>('[data-notis-app-root]');
    (appRoot ?? root).appendChild(created);
    return created;
  }
  const doc = root instanceof Document ? root : document;
  return doc.body;
}

/**
 * The layer root: the pinned one from LayerRootProvider, else found from `anchor` (an element inside the view),
 * else the page body.
 */
export function useLayerRoot(anchor?: Element | null): HTMLElement | null {
  const pinned = useContext(LayerRootContext);
  if (pinned) return pinned;
  if (anchor) return findLayerRoot(anchor);
  return typeof document === 'undefined' ? null : document.body;
}

/** The pinned layer root only (overlays fall back to findLayerRoot from their trigger). */
export function usePinnedLayerRoot(): HTMLElement | null {
  return useContext(LayerRootContext);
}
