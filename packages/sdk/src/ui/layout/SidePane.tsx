/**
 * `SidePane`: a page with a pane that always stays open beside it (comments, details), the
 * pane as wide as the person drags it.
 *
 * While the page minimum plus the pane minimum fit the SidePane element, the pane sits on the
 * right with a drag edge on its left, and the page and the pane each scroll on their own (give
 * SidePane a parent with a height, such as a reader body). Narrower, the pane follows the page
 * in one column and both scroll with the parent. The switch is a container query on the
 * SidePane element (`nui-side-pane`, 840px for the defaults), never a viewport query, for the
 * same reason as `Panels`: a Space sits in a shadow root beside a chat of any width.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { pick, type Words } from '../../words';
import { useToolkitLocale } from '../engine';
import { PaneHandle, measureWidth } from './PaneHandle';
import { parseStoredWidth } from './panelMath';

export const SIDE_PANE_MAIN_MIN_PX = 520;
export const SIDE_PANE_MIN_PX = 280;
export const SIDE_PANE_MAX_PX = 720;
export const SIDE_PANE_DEFAULT_PX = 340;

/**
 * The pane width in a row `container` px wide (null when unknown): between `min` and `max`, and
 * never squeezing the page under `mainMin`. A row too narrow for both still gives the pane `min`.
 */
export function clampSidePaneWidth(
  want: number,
  container: number | null,
  mainMin: number = SIDE_PANE_MAIN_MIN_PX,
  min: number = SIDE_PANE_MIN_PX,
  max: number = SIDE_PANE_MAX_PX,
): number {
  const room = container === null ? max : Math.min(max, container - mainMin);
  return Math.round(Math.max(min, Math.min(want, room)));
}

export interface SidePaneProps {
  /** The page. */
  children: ReactNode;
  /** The pane, always shown: beside the page while both fit, after it otherwise. */
  pane: ReactNode;
  /** The page never gets narrower than this beside the pane. */
  mainMin?: number;
  paneMin?: number;
  paneMax?: number;
  /** The pane width without a stored choice. */
  defaultPaneWidth?: number;
  /** Keeps the chosen pane width across visits (localStorage `notis:side-pane:<key>`). */
  storageKey?: string;
  /** Names the pane for screen readers (the drag edge reads "Resize <label>"). */
  label?: Words | string;
  className?: string;
  mainClassName?: string;
  paneClassName?: string;
}

const SIDE_PANE_WORDS = Object.freeze({
  pane: { en: 'the side pane', fr: 'le panneau latéral' },
  resize: { en: 'Resize {pane}', fr: 'Redimensionner {pane}' },
  resizeHint: { en: 'Drag to resize, double-click to reset', fr: 'Fais glisser pour redimensionner, double-clique pour réinitialiser' },
}) satisfies Readonly<Record<string, Words>>;

const STORAGE_PREFIX = 'notis:side-pane:';

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

/** Side-by-side rules for non-default minimums, scoped to one SidePane by its own container name. */
function splitRules(name: string, id: string, breakpoint: number): string {
  const self = `.nui-side-pane[data-side-pane-id="${id}"]`;
  return `@container ${name} (min-width: ${breakpoint}px) {`
    + `${self} > .nui-side-pane-row { flex-direction: row; height: 100%; }`
    + `${self} > .nui-side-pane-row > :is(.nui-side-pane-main, .nui-side-pane-aside) { overflow-y: auto; overscroll-behavior: contain; }`
    + `${self} > .nui-side-pane-row > .nui-side-pane-aside { flex: 0 0 auto; width: clamp(var(--nui-side-pane-min), var(--nui-side-pane-w), min(var(--nui-side-pane-max), calc(100cqw - var(--nui-side-pane-main-min))));`
    + ' box-shadow: inset 1px 0 0 hsl(var(--border)); }'
    + `${self} > .nui-side-pane-row > .nui-side-pane-aside > .nui-side-pane-handle { display: block; }`
    + '}';
}

export function SidePane({
  children,
  pane,
  mainMin = SIDE_PANE_MAIN_MIN_PX,
  paneMin = SIDE_PANE_MIN_PX,
  paneMax = SIDE_PANE_MAX_PX,
  defaultPaneWidth = SIDE_PANE_DEFAULT_PX,
  storageKey,
  label,
  className,
  mainClassName,
  paneClassName,
}: SidePaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const locale = useToolkitLocale();
  const reactId = useId();
  const id = useMemo(() => reactId.replace(/[^a-zA-Z0-9_-]/g, ''), [reactId]);
  const customBreakpoint = mainMin !== SIDE_PANE_MAIN_MIN_PX || paneMin !== SIDE_PANE_MIN_PX;
  const containerName = customBreakpoint ? `nui-side-pane nui-side-pane-${id}` : 'nui-side-pane';
  /** The chosen width; null keeps `defaultPaneWidth`. */
  const [preferred, setPreferred] = useState<number | null>(null);

  // Before paint: the stored width is there on the first frame.
  useLayoutEffect(() => {
    setPreferred(readStored(storageKey));
  }, [storageKey]);

  // The row width, for the clamp the drag edge reports; null until laid out.
  const [container, setContainer] = useState<number | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    const update = () => setContainer(measureWidth(root));
    update();
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const chosen = preferred ?? defaultPaneWidth;
  const clamp = useCallback(
    (px: number, container: number | null) => clampSidePaneWidth(px, container, mainMin, paneMin, paneMax),
    [mainMin, paneMax, paneMin],
  );
  const paneWidth = clamp(chosen, container);

  const setPaneWidth = useCallback((px: number) => {
    const width = clamp(px, measureWidth(rootRef.current));
    setPreferred(width);
    writeStored(storageKey, width);
  }, [clamp, storageKey]);

  const resetPaneWidth = useCallback(() => {
    setPreferred(null);
    writeStored(storageKey, null);
  }, [storageKey]);

  const paneName = label === undefined ? pick(SIDE_PANE_WORDS.pane, locale)
    : typeof label === 'string' ? label : pick(label, locale);
  const style = {
    containerName,
    '--nui-side-pane-w': `${chosen}px`,
    '--nui-side-pane-min': `${paneMin}px`,
    '--nui-side-pane-max': `${paneMax}px`,
    '--nui-side-pane-main-min': `${mainMin}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={className ? `nui-side-pane ${className}` : 'nui-side-pane'}
      style={style}
      data-side-pane-id={id}
      data-custom-split={customBreakpoint ? '' : undefined}
    >
      {customBreakpoint ? <style>{splitRules(`nui-side-pane-${id}`, id, mainMin + paneMin)}</style> : null}
      <div className="nui-side-pane-row">
        <div className={mainClassName ? `nui-side-pane-main ${mainClassName}` : 'nui-side-pane-main'}>{children}</div>
        <aside className={paneClassName ? `nui-side-pane-aside ${paneClassName}` : 'nui-side-pane-aside'} aria-label={paneName}>
          <PaneHandle
            className="nui-side-pane-handle"
            label={pick(SIDE_PANE_WORDS.resize, locale).replace('{pane}', paneName)}
            hint={pick(SIDE_PANE_WORDS.resizeHint, locale)}
            width={paneWidth}
            min={paneMin}
            max={container === null ? paneMax : clamp(paneMax, container)}
            clamp={clamp}
            rootRef={rootRef}
            onLive={(px) => rootRef.current?.style.setProperty('--nui-side-pane-w', `${px}px`)}
            onWidth={setPaneWidth}
            onReset={resetPaneWidth}
          />
          {pane}
        </aside>
      </div>
    </div>
  );
}
