/**
 * `Panels`: a list and the item open from it, side by side while both fit (toolkit spec 2.10).
 *
 * The Manager chat rule, applied inside a Space: when the list minimum plus the reader
 * minimum (320 + 360) no longer fits the Panels container, it shows one pane, the list or
 * the open item, as navigation decides. The open item then slides over the list and comes
 * back with Back (and Esc when `onBack` is given).
 *
 * The switch is a container query on the Panels element (`nui-panels`, 680px for the
 * defaults), not a viewport query and not the host's `data-chat-narrowed` flag: a Space
 * renders in a shadow root, where ancestor attribute variants never reach, and its width is
 * whatever the chat leaves it. JS mirrors the same threshold through a ResizeObserver for
 * `usePanels().mode` (Back, `inert`) and for the drag clamp.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { pick, SHELL_WORDS, type Words } from '../../words';
import { ESCAPE_PRIORITY, useEscapeLayer, useToolkitLocale } from '../engine';
import { PaneHandle, measureWidth as measure } from './PaneHandle';
import {
  PANELS_LIST_MIN_PX,
  PANELS_READER_MIN_PX,
  clampReaderWidth,
  parseStoredWidth,
  readerMaxWidth,
  readerWantWidth,
  splitBreakpoint,
  splitFits,
} from './panelMath';

export type PanelsMode = 'split' | 'stacked';

export interface PanelsState {
  /** `split`: list and reader side by side. `stacked`: one pane, the reader over the list. */
  mode: PanelsMode;
  /** The reader width on screen in split mode, inside the container. */
  readerWidth: number;
  /** Choose a reader width (clamped to the container, stored under `storageKey`). */
  setReaderWidth(px: number): void;
  /** A reader is open. */
  readerOpen: boolean;
  /** `mode` is known: the container was measured, or a frame passed without a width (a hidden Space keeps split). */
  settled: boolean;
}

export interface PanelsProps {
  list: ReactNode;
  /** The open item; null shows the list alone. */
  reader: ReactNode | null;
  listMin?: number;
  readerMin?: number;
  /** The reader width wanted without a stored choice. Default `readerWantWidth(window)`: 420 under 1280, 480 from 1280. */
  defaultReaderWidth?: number;
  /** A drag handle on the reader's left edge (split mode only). */
  resizable?: boolean;
  /** Keeps the chosen reader width across visits (localStorage `notis:panels:<key>`). */
  storageKey?: string;
  /**
   * Given: in stacked mode Panels shows its own Back bar above the reader and Esc goes back.
   * Leave it out when the reader draws its own Back (read `usePanels().mode`).
   */
  onBack?: () => void;
  className?: string;
}

const PANELS_WORDS = Object.freeze({
  resizeReader: { en: 'Resize the open item', fr: 'Redimensionner l’élément ouvert' },
  resizeReaderHint: { en: 'Drag to resize, double-click to reset', fr: 'Fais glisser pour redimensionner, double-clique pour réinitialiser' },
}) satisfies Readonly<Record<string, Words>>;

const STORAGE_PREFIX = 'notis:panels:';

const PanelsContext = createContext<PanelsState | null>(null);

/** The enclosing Panels' state. Outside one: split, no reader, the default width. */
export function usePanels(): PanelsState {
  return useContext(PanelsContext) ?? OUTSIDE_PANELS;
}

const OUTSIDE_PANELS: PanelsState = Object.freeze({
  mode: 'split' as const,
  readerWidth: readerWantWidth(0),
  setReaderWidth: () => {},
  readerOpen: false,
  settled: true,
});

function readStored(storageKey: string | undefined): number | null {
  if (!storageKey) return null;
  try {
    return parseStoredWidth(window.localStorage.getItem(STORAGE_PREFIX + storageKey));
  } catch {
    return null;
  }
}

function writeStored(storageKey: string | undefined, width: number | null) {
  if (!storageKey) return;
  try {
    if (width === null) window.localStorage.removeItem(STORAGE_PREFIX + storageKey);
    else window.localStorage.setItem(STORAGE_PREFIX + storageKey, String(width));
  } catch {
    // Private mode or a full quota: the width still holds for this visit.
  }
}

function windowWidth(): number {
  return typeof window === 'undefined' ? 0 : window.innerWidth;
}

/** The window width, kept current on resize: the reader wants 480 from a 1280 window. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(windowWidth);
  useEffect(() => {
    const update = () => setWidth(windowWidth());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

/** The container width; null while it is not laid out (a hidden Space, a test DOM). */
/** Runs `fn` after the next frame (a timer where there are no frames); returns the cancel. */
function afterFrame(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const frame = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(frame);
  }
  const timer = setTimeout(fn, 16);
  return () => clearTimeout(timer);
}

/** Split-mode rules for a non-default threshold, scoped to one Panels by its own container name. */
function splitRules(name: string, id: string, breakpoint: number): string {
  const self = `.nui-panels[data-panels-id="${id}"]`;
  return `@container ${name} (min-width: ${breakpoint}px) {`
    + `${self} > .nui-panels-reader { position: relative; inset: auto; z-index: auto; flex: 0 0 auto; transform: none; transition: none;`
    + ` width: clamp(var(--nui-panels-reader-min), var(--nui-panels-reader-w), calc(100cqw - var(--nui-panels-list-min))); }`
    + `${self} > .nui-panels-reader > .nui-panels-handle { display: block; }`
    + `${self} > .nui-panels-reader > .nui-panels-backbar { display: none; }`
    + '}';
}

export function Panels({
  list,
  reader,
  listMin = PANELS_LIST_MIN_PX,
  readerMin = PANELS_READER_MIN_PX,
  defaultReaderWidth,
  resizable = false,
  storageKey,
  onBack,
  className,
}: PanelsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const locale = useToolkitLocale();
  const reactId = useId();
  const id = useMemo(() => reactId.replace(/[^a-zA-Z0-9_-]/g, ''), [reactId]);
  const customBreakpoint = listMin !== PANELS_LIST_MIN_PX || readerMin !== PANELS_READER_MIN_PX;
  const containerName = customBreakpoint ? `nui-panels nui-panels-${id}` : 'nui-panels';
  const [container, setContainer] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);
  /** The chosen width; null keeps `defaultReaderWidth`. */
  const [preferred, setPreferred] = useState<number | null>(null);
  const readerOpen = reader !== null && reader !== undefined;

  // Before paint: the stored width and the real mode are there on the first frame.
  useLayoutEffect(() => {
    setPreferred(readStored(storageKey));
  }, [storageKey]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const update = () => {
      const width = measure(root);
      // An unmeasured container keeps the last known mode instead of collapsing to one pane.
      if (width !== null) {
        setContainer((current) => (current === width ? current : width));
        setSettled(true);
      }
    };
    update();
    // A container that reports no width within a frame (hidden, a test DOM) settles on the last known mode.
    const stopFrame = afterFrame(() => setSettled(true));
    if (!root || typeof ResizeObserver === 'undefined') return stopFrame;
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => {
      stopFrame();
      observer.disconnect();
    };
  }, []);

  const mode: PanelsMode = splitFits(container, listMin, readerMin) ? 'split' : 'stacked';
  const want = readerWantWidth(useWindowWidth());
  const chosen = preferred ?? defaultReaderWidth ?? want;
  const readerWidth = clampReaderWidth(chosen, container, listMin, readerMin);

  const setReaderWidth = useCallback((px: number) => {
    const width = clampReaderWidth(px, measure(rootRef.current) ?? container, listMin, readerMin);
    setPreferred(width);
    writeStored(storageKey, width);
  }, [container, listMin, readerMin, storageKey]);

  const resetReaderWidth = useCallback(() => {
    setPreferred(null);
    writeStored(storageKey, null);
  }, [storageKey]);

  const state = useMemo<PanelsState>(
    () => ({ mode, readerWidth, setReaderWidth, readerOpen, settled }),
    [mode, readerOpen, readerWidth, setReaderWidth, settled],
  );

  const covered = mode === 'stacked' && readerOpen;
  const style = {
    containerName,
    '--nui-panels-reader-w': `${chosen}px`,
    '--nui-panels-reader-min': `${readerMin}px`,
    '--nui-panels-list-min': `${listMin}px`,
  } as CSSProperties;

  return (
    <PanelsContext.Provider value={state}>
      <div
        ref={rootRef}
        className={className ? `nui-panels ${className}` : 'nui-panels'}
        style={style}
        data-panels-id={id}
        data-custom-split={customBreakpoint ? '' : undefined}
        data-mode={mode}
        data-reader-open={readerOpen ? '' : undefined}
      >
        {customBreakpoint ? <style>{splitRules(`nui-panels-${id}`, id, splitBreakpoint(listMin, readerMin))}</style> : null}
        <div className="nui-panels-list" inert={covered || undefined} aria-hidden={covered || undefined}>
          {list}
        </div>
        {readerOpen ? (
          <div className="nui-panels-reader">
            {resizable ? (
              <PaneHandle
                className="nui-panels-handle"
                label={pick(PANELS_WORDS.resizeReader, locale)}
                hint={pick(PANELS_WORDS.resizeReaderHint, locale)}
                width={readerWidth}
                min={readerMin}
                max={container === null ? undefined : readerMaxWidth(container, listMin, readerMin)}
                clamp={(px, measured) => clampReaderWidth(px, measured, listMin, readerMin)}
                rootRef={rootRef}
                onLive={(px) => rootRef.current?.style.setProperty('--nui-panels-reader-w', `${px}px`)}
                onWidth={setReaderWidth}
                onReset={resetReaderWidth}
              />
            ) : null}
            {onBack ? <PanelsBackBar onBack={onBack} /> : null}
            {reader}
          </div>
        ) : null}
      </div>
    </PanelsContext.Provider>
  );
}

/**
 * Back above the open item, drawn in stacked mode only (CSS). Esc goes back in both modes:
 * `onBack` is how the open item closes.
 */
function PanelsBackBar({ onBack }: { onBack: () => void }) {
  const locale = useToolkitLocale();
  const onBackRef = useRef(onBack);
  useLayoutEffect(() => {
    onBackRef.current = onBack;
  });
  const onEscape = useCallback(() => {
    onBackRef.current();
    return true;
  }, []);
  useEscapeLayer(`panels-back${useId()}`, onEscape, { priority: ESCAPE_PRIORITY.detail });
  return (
    <div className="nui-panels-backbar">
      <button type="button" className="nui-panels-back" onClick={onBack}>
        <svg className="nui-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
        {pick(SHELL_WORDS.back, locale)}
      </button>
    </div>
  );
}
