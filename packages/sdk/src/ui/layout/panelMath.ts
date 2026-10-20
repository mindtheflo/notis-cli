/**
 * The width rule shared by the Manager chat panel and Space `Panels`. Pure: no React, no DOM.
 *
 * Two panes share a row. The side pane (the chat, or a Space's reader) pushes the main pane
 * (the page, or a Space's list) until the main pane reaches its minimum width. Past that the
 * chat slides over the page, as it does on mobile, but stops short of covering it: mobile
 * brings the page back with a swipe, the desktop has no swipe. Resting the pointer on the
 * uncovered strip extends the page back to its minimum width and shrinks the chat, until the
 * pointer returns to the chat. A Space's `Panels` never overlaps: when its two minimums no
 * longer fit, it shows one pane.
 *
 * One chat width serves every page: the protected shell mounts a single panel, so the
 * Manager, Spaces and the floating chat open at the same width. Without a stored preference
 * the chat is 420px at every window width; a Space reader wants 420px under a 1280px window
 * and 480px from 1280px (`readerWantWidth`).
 */

/** CSS custom property the chat panel reads its width from on lg+. */
export const CHAT_PANEL_WIDTH_PROPERTY = '--notis-chat-panel-width';

/** CSS custom property for how far the chat panel slides over the page on lg+. */
export const CHAT_PANEL_OVERLAP_PROPERTY = '--notis-chat-panel-overlap';

export const CHAT_PANEL_WIDTH_STORAGE_KEY = 'notis:chat-panel-width';

/** The chat panel width without a stored preference, at every window width (mirrors its `lg:w-[...,420px]` fallback). */
export const CHAT_PANEL_DEFAULT_WIDTH_PX = 420;

/** The panel sits beside the page, with its edge, from Tailwind's `lg` up. */
export const CHAT_PANEL_DESKTOP_MEDIA_QUERY = '(min-width: 64rem)';

/**
 * A chosen panel width that leaves the page narrower than this switches the Manager to its
 * phone layout (the `manager-md:`/`manager-lg:` variants in the Portal's globals.css read the
 * flag). Spaces switch on their own container width instead (see `Panels`).
 */
export const MANAGER_PHONE_LAYOUT_BELOW_PX = 576;

/** Set on the page viewport while the chosen panel width narrows the page. */
export const CHAT_NARROWED_ATTRIBUTE = 'data-chat-narrowed';

/** The phone layout already renders the panel this narrow, so the composer fits it. */
export const CHAT_PANEL_MIN_WIDTH_PX = 360;

/** The panel never squeezes the page narrower than this; it slides over the page instead. */
export const CHAT_PANEL_MIN_CONTENT_WIDTH_PX = 320;

/** At its widest the panel still leaves this much of the page visible and clickable. */
export const CHAT_PANEL_PAGE_PEEK_PX = 80;

export const CHAT_PANEL_KEYBOARD_STEP_PX = 24;

/** How long the pointer rests on the page strip before the page extends; a pass is not a rest. */
export const CHAT_PANEL_PAGE_HOVER_DELAY_MS = 200;

/** `Panels` defaults: the same two minimums and the same page peek as the chat rule. */
export const PANELS_LIST_MIN_PX = CHAT_PANEL_MIN_CONTENT_WIDTH_PX;
export const PANELS_READER_MIN_PX = CHAT_PANEL_MIN_WIDTH_PX;
export const PANELS_READER_PEEK_PX = CHAT_PANEL_PAGE_PEEK_PX;
export const PANELS_KEYBOARD_STEP_PX = CHAT_PANEL_KEYBOARD_STEP_PX;
export const PANELS_HOVER_DELAY_MS = CHAT_PANEL_PAGE_HOVER_DELAY_MS;

/** The reader width a Space wants under a 1280px window. */
export const PANELS_READER_WANT_PX = 420;
/** The reader width a Space wants from a 1280px window. */
export const PANELS_READER_WANT_WIDE_PX = 480;
/** The window width from which a Space reader wants `PANELS_READER_WANT_WIDE_PX`. */
export const PANELS_READER_WIDE_FROM_PX = 1280;

/** The reader width a Space wants in a window `windowWidth` px wide: 420 under 1280, 480 from 1280. */
export function readerWantWidth(windowWidth: number): number {
  return windowWidth >= PANELS_READER_WIDE_FROM_PX ? PANELS_READER_WANT_WIDE_PX : PANELS_READER_WANT_PX;
}

/**
 * Widest a side pane may get in a row of `container` px (null when unknown) while `keep` px
 * of the main pane stay visible. A row too narrow for both still gives the side pane its
 * own minimum.
 */
export function readerMaxWidth(
  container: number | null,
  keep: number = PANELS_LIST_MIN_PX,
  readerMin: number = PANELS_READER_MIN_PX,
): number {
  if (container === null) return Number.POSITIVE_INFINITY;
  return Math.max(readerMin, Math.round(container - keep));
}

/** Widest a side pane gets without covering any of a main pane of minimum `listMin`. */
export function pushLimit(
  container: number | null,
  listMin: number = PANELS_LIST_MIN_PX,
  readerMin: number = PANELS_READER_MIN_PX,
): number {
  return readerMaxWidth(container, listMin, readerMin);
}

/** How far a side pane this wide slides over the main pane rather than squeezing it further. */
export function overlap(width: number, container: number | null, listMin: number = PANELS_LIST_MIN_PX): number {
  if (container === null) return 0;
  return Math.max(0, Math.round(width - (container - listMin)));
}

/** Both panes fit side by side at their minimums; otherwise `Panels` shows one pane. */
export function splitFits(
  container: number | null,
  listMin: number = PANELS_LIST_MIN_PX,
  readerMin: number = PANELS_READER_MIN_PX,
): boolean {
  if (container === null) return true;
  return container >= listMin + readerMin;
}

/** The container width at which `Panels` switches between one pane and two. */
export function splitBreakpoint(listMin: number = PANELS_LIST_MIN_PX, readerMin: number = PANELS_READER_MIN_PX): number {
  return listMin + readerMin;
}

/**
 * A `Panels` reader width in a Space `container` px wide (null when unknown):
 * `clamp(min(want, S - listMin), readerMin, S - peek)`. The list keeps its minimum first; a
 * row too narrow for both gives the reader its own minimum, but always leaves the peek.
 */
export function clampReaderWidth(
  want: number,
  container: number | null,
  listMin: number = PANELS_LIST_MIN_PX,
  readerMin: number = PANELS_READER_MIN_PX,
  peek: number = PANELS_READER_PEEK_PX,
): number {
  if (container === null) return Math.round(Math.max(readerMin, want));
  const pushed = Math.min(want, container - listMin);
  return Math.round(Math.max(0, Math.min(Math.max(pushed, readerMin), container - peek)));
}

/** A stored width is a preference only when it is a positive finite number. */
export function parseStoredWidth(raw: string | null): number | null {
  if (!raw) return null;
  const width = Number(raw);
  return Number.isFinite(width) && width > 0 ? width : null;
}

// The Manager chat rule, in the names the Portal has always used.

/**
 * Widest the chat panel may get. `sharedWidth` is the room the panel shares with the page
 * (null when unknown). A row too narrow for both still gives the panel its own minimum.
 */
export function chatPanelMaxWidth(sharedWidth: number | null): number {
  return readerMaxWidth(sharedWidth, CHAT_PANEL_PAGE_PEEK_PX, CHAT_PANEL_MIN_WIDTH_PX);
}

/** Widest the chat panel gets without covering any of the page. */
export function chatPanelPushLimit(sharedWidth: number | null): number {
  return pushLimit(sharedWidth, CHAT_PANEL_MIN_CONTENT_WIDTH_PX, CHAT_PANEL_MIN_WIDTH_PX);
}

export function clampChatPanelWidth(width: number, sharedWidth: number | null): number {
  return Math.round(Math.min(chatPanelMaxWidth(sharedWidth), Math.max(CHAT_PANEL_MIN_WIDTH_PX, width)));
}

/** The page width a chosen panel width leaves in a row of `sharedWidth`. */
export function chatPanelPageWidth(chosenWidth: number, sharedWidth: number): number {
  const width = clampChatPanelWidth(chosenWidth, sharedWidth);
  return sharedWidth - width + chatPanelOverlap(width, sharedWidth);
}

/** How far a chat panel this wide slides over the page rather than squeezing it further. */
export function chatPanelOverlap(width: number, sharedWidth: number | null): number {
  return overlap(width, sharedWidth, CHAT_PANEL_MIN_CONTENT_WIDTH_PX);
}

export function parseStoredChatPanelWidth(raw: string | null): number | null {
  return parseStoredWidth(raw);
}
