/**
 * A stand-in for the host Comments panel in specimens: the comment panes draw in the host's right panel
 * (`runtime.spaceComments`), so a specimen gives them a slot where the panel would be. The comments come from an
 * in-memory store seeded with `rows` (writes succeed without a server); the viewer is Flo, who can edit the Space;
 * `routing` adds the host's threads (links, best match, the @ picker) from fixtures.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  NotisProvider, type NotisRuntime, type SpaceCommentPage, type SpaceCommentRow, type SpaceCommentSource,
  type SpaceCommentsTransport, type SpaceCommentThreadRef,
} from '../../src';
import { CommentPaneOutlet, registerPaneOutlet } from '../../src/ui/index';
import { memoryCommentStore } from '../runtime/memoryComments';

const THREADS: Record<string, SpaceCommentThreadRef> = {
  deck: { threadId: 'thread-deck', title: 'Q3 deck polish', harness: 'claude', status: 'Working' },
  copy: { threadId: 'thread-copy', title: 'Newsletter copy', harness: 'codex', status: 'Waiting for you' },
};

/** The host's threads from fixtures: c1 goes to the deck thread, the best match is the copy thread. */
export const ROUTING_FIXTURE: Partial<SpaceCommentsTransport> = {
  links: async ({ rootIds }) => Object.fromEntries(rootIds.filter(key => key === 'c1').map(key => [key, [THREADS.deck!]])),
  bestMatch: async () => THREADS.copy!,
  pickThread: async () => THREADS.deck!,
  link: async input => ('threadId' in input.pick ? input.pick : null),
  openThread: () => {},
};

const SlotContext = createContext<((node: HTMLElement | null) => void) | null>(null);

export function HostCommentsProvider({ runtime, routing, rows, page, upload, more, children }: {
  runtime: NotisRuntime; routing?: Partial<SpaceCommentsTransport>;
  /** The comments the store starts with. */
  rows?: readonly Partial<SpaceCommentRow>[];
  /** The page the host shows. Default: none (the Space home). */
  page?: SpaceCommentPage | null;
  /** Whether files can be attached. Default true. */
  upload?: boolean;
  /** More transport parts (an upload that keeps going, a refusal). */
  more?: Partial<SpaceCommentsTransport>;
  children: ReactNode;
}) {
  const sources = useRef(new Set<SpaceCommentSource>());
  const slot = useRef<HTMLElement | null>(null);
  const store = useMemo(() => memoryCommentStore({ rows, page, upload }), [rows, page, upload]);
  const withPanel = useMemo(() => ({
    ...runtime,
    spaceComments: {
      ...store.transport,
      ...routing,
      ...more,
      attach(source: SpaceCommentSource) {
        sources.current.add(source);
        source.show(slot.current);
        return () => { sources.current.delete(source); source.show(null); };
      },
    } satisfies SpaceCommentsTransport,
  }) as NotisRuntime, [runtime, routing, store, more]);
  const setSlot = useCallback((node: HTMLElement | null) => {
    slot.current = node;
    for (const source of sources.current) source.show(node);
  }, []);
  return <SlotContext.Provider value={setSlot}><NotisProvider runtime={withPanel}>{children}</NotisProvider></SlotContext.Provider>;
}

/**
 * Where the host Comments panel sits beside the page. Like the host (C7), it gives the pane its full height and never
 * scrolls itself: the pane scrolls its own list and keeps its toasts at the bottom of what shows.
 *
 * `hostDrawn`: the host draws the pane itself, in its own React tree (`registerPaneOutlet`, `CommentPaneOutlet`), as the
 * Portal's Comments panel does, so the pane's elements stay when a newer version of the page takes the place of the
 * one on screen.
 */
export function HostPanelSlot({ style, hostDrawn = false }: { style?: CSSProperties; hostDrawn?: boolean }) {
  const setSlot = useContext(SlotContext);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const unregister = useRef<(() => void) | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    unregister.current?.();
    // Said before the element is handed to a source, so the pane never portals into it first.
    unregister.current = node && hostDrawn ? registerPaneOutlet(node) : null;
    setTarget(node);
    setSlot?.(node);
  }, [setSlot, hostDrawn]);
  return (
    <div ref={ref} style={{ minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden', ...style }}>
      {hostDrawn ? <CommentPaneOutlet target={target} /> : null}
    </div>
  );
}
