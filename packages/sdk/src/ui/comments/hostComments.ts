/**
 * The bridge from a Space's comment controllers to the host Comments panel (SPC-113 to SPC-131). The pane no longer
 * sits inside a Space: `CommentPane` and `PassageCommentPane` attach their controller here and draw their threads into
 * the element the host hands them, in its right panel beside the chat (a React portal: the controller, its uploads,
 * toasts and keys stay with the Space). A `SidePane` given one of them shows its page alone.
 *
 * While the host has no Comments panel for the viewer (comments off, a Site, a link, a preview) the Space shows no
 * comments at all: `useHostComments()` is false and the pins and highlights stay hidden.
 */

import { useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../../provider';
import type { SpaceCommentSource } from '../../space';

/** True when the host shows comments for this viewer: pins, highlights and the Comment button may show. */
export function useHostComments(): boolean {
  return Boolean(useNotisRuntime()?.spaceComments);
}

/** The view param a link to one comment carries (a push, a chat pill): `comment=<root record key>`. */
export const COMMENT_FOCUS_PARAM = 'comment';

/**
 * The comment a link asks to show: the `comment` view param the host puts on the Space page URL (a push opens
 * `...?comment=<root_key>`), or null. Read raw, so a Space need not declare the param. `useComments` and
 * `usePassageComments` read it by default (their `focusKey`) and focus and scroll to that thread once it is read.
 * Null while the host shows no comments (`useHostComments` false): a Space's own `comment` param is then its own.
 */
export function useCommentFocusParam(): string | null {
  const runtime = useNotisRuntime();
  const value = runtime?.spaceComments ? runtime.context?.params?.[COMMENT_FOCUS_PARAM] : undefined;
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : null;
}

/** The controller's `revealRequest` (C8), 0 when it has none. */
function revealOf(controller: unknown): number {
  const value = controller && typeof controller === 'object' ? (controller as { revealRequest?: unknown }).revealRequest : 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Keeps `controller` listed in the host Comments panel while the calling component is mounted, and returns the panel
 * element to draw its threads in (null while the panel does not show them). `options` carries what the pane was given
 * (a title, the groups of a passage pane). `watch` lists what the host reads (the threads, the new comment, the
 * selected thread): the host hears of a render only when one of them changed, never on each pointer move of a drag.
 * `current().revealRequest` is the controller's (C8): the host hears of each increase.
 *
 * The source object stays the same for the life of the component. A new transport object from the host (its viewer
 * resolving) lists that same source again without taking the panel element away, so the pane, a reply being typed and
 * the list's scroll stay as they are.
 */
export function useHostCommentSource(
  kind: SpaceCommentSource['kind'],
  controller: unknown,
  options: Readonly<Record<string, unknown>> = {},
  watch?: readonly unknown[],
): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const transport = useNotisRuntime()?.spaceComments;
  const state = useRef<{ value: ReturnType<SpaceCommentSource['current']>; listeners: Set<() => void> }>({
    value: { controller, options, revealRequest: revealOf(controller) },
    listeners: new Set(),
  });
  /** True while this hook lists its source again for a new transport: the old listing's show(null) is not a close. */
  const relisting = useRef(false);
  const sourceRef = useRef<SpaceCommentSource | null>(null);
  if (!sourceRef.current) {
    const current = state.current;
    sourceRef.current = {
      kind,
      current: () => current.value,
      subscribe(listener) {
        current.listeners.add(listener);
        return () => { current.listeners.delete(listener); };
      },
      show(element) {
        if (!element && relisting.current) return;
        setTarget(element);
      },
    };
  }

  const seen = useRef<readonly unknown[] | null>(null);

  // After each commit: the host reads the newest controller, never one from a render React threw away. It is told
  // only when what it reads changed.
  useEffect(() => {
    const revealRequest = revealOf(controller);
    state.current.value = { controller, options, revealRequest };
    const now = [...(watch ?? [controller]), revealRequest, ...Object.values(options)];
    const before = seen.current;
    seen.current = now;
    if (before && before.length === now.length && before.every((item, index) => Object.is(item, now[index]))) return;
    for (const listener of [...state.current.listeners]) listener();
  });

  useEffect(() => {
    if (!transport) { setTarget(null); return undefined; }
    // An element a host listing before this one handed and has since removed is not drawn into.
    if (targetRef.current && !targetRef.current.isConnected) setTarget(null);
    const detach = transport.attach(sourceRef.current!);
    return () => {
      relisting.current = true;
      try { detach(); } finally { relisting.current = false; }
    };
  }, [transport]);

  return transport ? target : null;
}

const RETIRED = Symbol.for('notis.sdk.hostCommentPane');

/** Marks a pane that draws in the host Comments panel: a `SidePane` given one shows its page alone. */
export function markRetiredPane<T extends object>(component: T): T {
  (component as Record<symbol, boolean>)[RETIRED] = true;
  return component;
}

/** Whether `node` is a pane element drawn in the host panel (`<CommentPane />`, `<PassageCommentPane />`). */
export function isRetiredPane(node: unknown): boolean {
  if (!node || typeof node !== 'object' || !('type' in node)) return false;
  const type = (node as { type: unknown }).type;
  return Boolean(type && (typeof type === 'function' || typeof type === 'object') && (type as Record<symbol, boolean>)[RETIRED]);
}
