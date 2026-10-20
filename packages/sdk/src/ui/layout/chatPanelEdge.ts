/**
 * The chat panel's left edge, without a framework: the host (the Portal) renders the
 * separator element and forwards its events here. Everything the Manager chat rule does to
 * the page lives here, so a Space in the page viewport gets exactly the Manager behaviour:
 *
 * - The chat pushes the page down to 320px, then slides over it, leaving an 80px strip.
 * - A 200ms rest on the covered page narrows the chat back until the page has 320px. The
 *   chat never goes under 360px. It stays so until the pointer is back on the chat (the
 *   edge is exempt). Leaving elsewhere only cancels a pending rest. Keyboard focus on the
 *   covered page also brings it back, including focus inside a Space's shadow root.
 * - Nothing moves on mouse over otherwise.
 *
 * Host-only concerns come in through adapters (`ChatPanelEdgeAdapters`): the page kind for
 * analytics (the Portal reads its router), the analytics recorder (the Portal sends it to
 * its product analytics with the signed-in actor) and the ARIA value sink. Nothing here
 * imports React, Next or an analytics client.
 *
 * The widths go straight onto the panel as CSS custom properties, so neither a drag nor a
 * hover re-renders the conversation.
 */
import {
  CHAT_NARROWED_ATTRIBUTE,
  CHAT_PANEL_DEFAULT_WIDTH_PX,
  CHAT_PANEL_KEYBOARD_STEP_PX,
  CHAT_PANEL_OVERLAP_PROPERTY,
  CHAT_PANEL_PAGE_HOVER_DELAY_MS,
  CHAT_PANEL_WIDTH_PROPERTY,
  CHAT_PANEL_WIDTH_STORAGE_KEY,
  MANAGER_PHONE_LAYOUT_BELOW_PX,
  chatPanelMaxWidth,
  chatPanelOverlap,
  chatPanelPageWidth,
  chatPanelPushLimit,
  clampChatPanelWidth,
  parseStoredChatPanelWidth,
} from './panelMath';

/** The page column (the Manager, a Space, any page) is marked with this attribute. */
export const PAGE_VIEWPORT_ATTRIBUTE = 'data-notis-view-viewport';

export type ChatPanelEdgeMethod = 'drag' | 'keyboard' | 'reset';
export type ChatPanelEdgeTrigger = 'hover' | 'keyboard';

export type ChatPanelEdgeOutcome<Page extends string = string> = {
  method: ChatPanelEdgeMethod;
  width: number | null;
  coversPage: boolean;
  page: Page;
  managerPhoneLayout: boolean;
};

/** What the edge reports. Structural, so the host's own recorder fits as is. */
export interface ChatPanelEdgeAnalytics<Page extends string = string> {
  available(page: Page): void;
  resized(outcome: ChatPanelEdgeOutcome<Page>): void;
  pageExtended(trigger: ChatPanelEdgeTrigger, page: Page): void;
}

export type ChatPanelEdgeAria = { now: number; max: number | undefined };

export interface ChatPanelEdgeAdapters<Page extends string = string> {
  /** The separator element; its parent is the panel. Read lazily: hosts attach refs late. */
  handle(): HTMLElement | null;
  /** The page kind analytics name, read whenever something is reported. */
  page(): Page;
  /** The recorder, read whenever something is reported (a host may swap it). */
  analytics(): ChatPanelEdgeAnalytics<Page>;
  /** The separator's ARIA value changed. */
  onDescribe(aria: ChatPanelEdgeAria): void;
  /**
   * Root custom property where the host publishes its resting sidebar inset (px or rem).
   * Without one the whole window is the resting row.
   */
  sidebarInsetProperty?: string;
}

/** The pointer fields the edge reads; a DOM or React pointer event fits. */
export type EdgePointerEvent = {
  button: number;
  pointerId: number;
  clientX: number;
  currentTarget: EventTarget | null;
  preventDefault(): void;
};

/** The key fields the edge reads; a DOM or React keyboard event fits. */
export type EdgeKeyboardEvent = {
  key: string;
  preventDefault(): void;
  stopPropagation(): void;
};

export interface ChatPanelEdge {
  /** Before paint: read the stored width and apply it. */
  mount(): void;
  /** The panel opened or closed. */
  setHidden(hidden: boolean): void;
  /** The desktop layout (the panel beside the page) turned on or off. */
  setDesktop(desktop: boolean): void;
  /** Report the reached denominator: an open desktop panel that shows its edge. */
  reportAvailable(): void;
  /** Track whether the last input was a key press; returns the detach. */
  trackInput(): () => void;
  /** Follow the page viewport (size, sidebar, pointer rest, focus); returns the detach. */
  attach(): () => void;
  pointerDown(event: EdgePointerEvent): void;
  pointerMove(event: EdgePointerEvent): void;
  endDrag(): void;
  keyDown(event: EdgeKeyboardEvent): void;
  doubleClick(): void;
  focus(): void;
  blur(): void;
}

type Drag = {
  pointerId: number;
  startX: number;
  startWidth: number;
  sharedWidth: number | null;
  /** The resting row, read once: a drag must not restyle-read the root on every move. */
  restingSharedWidth: number;
  width: number | null;
  /** The edge already had focus; a mouse drag must not leave it focused otherwise. */
  focusedAtStart: boolean;
  bodyCursor: string;
  bodyUserSelect: string;
};

/** The page column the panel splits its row with in the host shell. */
export function pageViewport(panel: HTMLElement): HTMLElement | null {
  return panel.parentElement?.querySelector<HTMLElement>(`:scope > [${PAGE_VIEWPORT_ATTRIBUTE}]`) ?? null;
}

/**
 * From the page's left edge to the panel's right edge. Unlike adding the two widths, this
 * stays right while the panel slides over the page.
 */
function measureSharedWidth(panel: HTMLElement): number | null {
  const viewport = pageViewport(panel);
  if (!viewport) return null;
  return panel.getBoundingClientRect().right - viewport.getBoundingClientRect().left;
}

/** The width the panel's classes fall back to without a chosen width: 420 at every window width. */
function defaultPanelWidth(): number {
  return CHAT_PANEL_DEFAULT_WIDTH_PX;
}

/** Write only real changes: the page observer calls back on every frame of a transition. */
function setPixels(panel: HTMLElement, property: string, value: number | null) {
  const next = value === null ? '' : `${value}px`;
  if (panel.style.getPropertyValue(property) === next) return;
  if (next) panel.style.setProperty(property, next);
  else panel.style.removeProperty(property);
}

function readStoredWidth(): number | null {
  try {
    return parseStoredChatPanelWidth(window.localStorage.getItem(CHAT_PANEL_WIDTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeWidth(width: number | null) {
  try {
    if (width === null) window.localStorage.removeItem(CHAT_PANEL_WIDTH_STORAGE_KEY);
    else window.localStorage.setItem(CHAT_PANEL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Private mode or a full quota: the width still holds for this session.
  }
}

/** Hover belongs to mouse and pen; a tap on the strip just uses the page. */
function isHoverPointer(event: PointerEvent): boolean {
  return event.pointerType === 'mouse' || event.pointerType === 'pen';
}

/**
 * The element that actually took focus. Focus inside a Space's shadow root reaches the
 * page as an event retargeted to the shadow host, which does not match `:focus-visible`
 * itself; the composed path still starts at the focused element.
 */
function focusedElement(event: FocusEvent): EventTarget | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path[0] ?? event.target;
}

function isFocusVisible(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (!element || typeof element.matches !== 'function') return false;
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function createChatPanelEdge<Page extends string = string>(
  adapters: ChatPanelEdgeAdapters<Page>,
  initial: { hidden: boolean; desktop: boolean },
): ChatPanelEdge {
  /** The stored preference; null keeps the breakpoint default. */
  let preferred: number | null = null;
  let drag: Drag | null = null;
  /** The page shows at its minimum width instead of under the panel. */
  let pageExtended = false;
  let pageHoverTimer: ReturnType<typeof setTimeout> | null = null;
  let hidden = initial.hidden;
  let desktop = initial.desktop;
  /** The last input was a key press, not a pointer: focus moved by keyboard. */
  let keyboardInput = false;
  /** Arrow keys changed the width since the edge took focus; reported once on blur. */
  let keyboardResized = false;

  const panelNode = () => adapters.handle()?.parentElement ?? null;

  function sidebarInsetValue(): string {
    const property = adapters.sidebarInsetProperty;
    return property ? document.documentElement.style.getPropertyValue(property).trim() : '';
  }

  /**
   * The same room with the sidebar at rest. A sidebar that only hover-expands changes the
   * measured row for a moment; what the chosen width narrows the page to must not follow it.
   */
  function restingSharedWidth(): number {
    const raw = sidebarInsetValue();
    const value = Number.parseFloat(raw);
    const inset = !Number.isFinite(value)
      ? 0
      : raw.endsWith('rem') ? value * (Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16) : value;
    return window.innerWidth - inset;
  }

  /**
   * Writes a width (null: the 420px default, left to the panel's classes) and how far it slides over the page. The
   * default overlaps a narrow row too, so its overlap and data-overlay come from here as well: the page reveal (a
   * rest or keyboard focus on the covered page) then works without a chosen width.
   */
  function applyWidth(width: number | null, sharedWidth: number | null) {
    const panel = panelNode();
    if (!panel) return;
    const overlap = chatPanelOverlap(width ?? defaultPanelWidth(), sharedWidth);
    setPixels(panel, CHAT_PANEL_WIDTH_PROPERTY, width);
    setPixels(panel, CHAT_PANEL_OVERLAP_PROPERTY, overlap > 0 ? overlap : null);
    // Floating over the page earns the panel its shadow.
    panel.toggleAttribute('data-overlay', overlap > 0);
  }

  /** The width the user chose, inside the current row; the breakpoint default without one. */
  function chosenWidth(sharedWidth: number | null): number {
    return preferred !== null ? clampChatPanelWidth(preferred, sharedWidth) : defaultPanelWidth();
  }

  /** What the panel shows: the chosen width (or the default), stepped aside while the page is extended. */
  function displayedWidth(sharedWidth: number | null): number {
    const width = chosenWidth(sharedWidth);
    return pageExtended ? Math.min(width, chatPanelPushLimit(sharedWidth)) : width;
  }

  let lastAria: ChatPanelEdgeAria | null = null;
  function describe(width: number, sharedWidth: number | null) {
    const max = chatPanelMaxWidth(sharedWidth);
    const next = { now: Math.round(width), max: Number.isFinite(max) ? max : undefined };
    if (lastAria?.now === next.now && lastAria?.max === next.max) return;
    lastAria = next;
    adapters.onDescribe(next);
  }

  /**
   * A chosen width (null: the default) that leaves the page under the Manager's
   * phone-layout width, and narrower than the default would: a window that is already
   * tight at the default keeps its rows until the chat is actually widened.
   */
  function narrowsPage(chosen: number | null, resting = restingSharedWidth()): boolean {
    if (chosen === null || hidden || !desktop) return false;
    const limit = Math.min(MANAGER_PHONE_LAYOUT_BELOW_PX, chatPanelPageWidth(defaultPanelWidth(), resting));
    return chatPanelPageWidth(chosen, resting) < limit;
  }

  function syncPageNarrowed(chosen: number | null, resting?: number) {
    const panel = panelNode();
    const viewport = panel ? pageViewport(panel) : null;
    viewport?.toggleAttribute(CHAT_NARROWED_ATTRIBUTE, narrowsPage(chosen, resting));
  }

  // Keep the stored width inside the row as the window or the sidebar changes size, and the
  // default's overlap current. The clamp is only applied, never stored: the preference comes
  // back once there is room.
  function fit() {
    const panel = panelNode();
    if (!panel || drag) return;
    const sharedWidth = measureSharedWidth(panel);
    // Without a chosen width the classes keep the default, unless the panel stands aside for the page.
    applyWidth(preferred === null && !pageExtended ? null : displayedWidth(sharedWidth), sharedWidth);
    describe(displayedWidth(sharedWidth), sharedWidth);
    syncPageNarrowed(preferred);
  }

  function cancelPageHover() {
    if (pageHoverTimer !== null) clearTimeout(pageHoverTimer);
    pageHoverTimer = null;
  }

  /** True when the page changed state. */
  function setPageExtended(extended: boolean): boolean {
    cancelPageHover();
    if (pageExtended === extended) return false;
    pageExtended = extended;
    fit();
    return true;
  }

  function reportResize(method: ChatPanelEdgeMethod, width: number | null, sharedWidth: number | null) {
    const overlap = chatPanelOverlap(width ?? defaultPanelWidth(), sharedWidth);
    adapters.analytics().resized({ method, width, coversPage: overlap > 0, page: adapters.page(), managerPhoneLayout: narrowsPage(width) });
  }

  function setWidth(width: number | null, sharedWidth: number | null) {
    cancelPageHover();
    pageExtended = false;
    preferred = width;
    storeWidth(width);
    applyWidth(width, sharedWidth);
    syncPageNarrowed(width);
  }

  function endDrag() {
    const current = drag;
    if (!current) return;
    drag = null;
    panelNode()?.removeAttribute('data-resizing');
    document.body.style.cursor = current.bodyCursor;
    document.body.style.userSelect = current.bodyUserSelect;
    // A focused separator keeps single-key shortcuts away; a mouse drag gives focus back.
    const handle = adapters.handle();
    if (!current.focusedAtStart && handle && document.activeElement === handle) handle.blur();
    // A click without movement keeps the default instead of pinning it.
    if (current.width === null) return;
    setWidth(current.width, current.sharedWidth);
    reportResize('drag', current.width, current.sharedWidth);
  }

  function flushKeyboardResize() {
    const panel = panelNode();
    if (!panel || !keyboardResized) return;
    keyboardResized = false;
    const sharedWidth = measureSharedWidth(panel);
    reportResize('keyboard', chosenWidth(sharedWidth), sharedWidth);
  }

  return {
    mount() {
      preferred = readStoredWidth();
      fit();
    },

    // A closing panel finishes what the edge was doing, reported as it was while open; a
    // reopened one comes back at its chosen width, not stepped aside for the page.
    setHidden(next: boolean) {
      if (next) {
        endDrag();
        flushKeyboardResize();
      }
      hidden = next;
      setPageExtended(false);
      syncPageNarrowed(preferred);
    },

    // Below lg the panel fills the screen: nothing to extend, nothing narrowed.
    setDesktop(next: boolean) {
      desktop = next;
      if (!next) setPageExtended(false);
      syncPageNarrowed(preferred);
    },

    reportAvailable() {
      if (!hidden && desktop) adapters.analytics().available(adapters.page());
    },

    trackInput() {
      const onKey = (event: KeyboardEvent) => {
        if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboardInput = true;
      };
      const onPointer = () => {
        keyboardInput = false;
      };
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('pointerdown', onPointer, true);
      return () => {
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('pointerdown', onPointer, true);
      };
    },

    attach() {
      const panel = panelNode();
      const viewport = panel ? pageViewport(panel) : null;
      if (!panel || !viewport) return () => {};
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
      observer?.observe(viewport);
      // The host publishes the resting sidebar inset after it renders; follow its changes
      // too, or a sidebar that reappears without a resize would leave the flag stale.
      let inset = sidebarInsetValue();
      const insetObserver = adapters.sidebarInsetProperty && window.MutationObserver ? new window.MutationObserver(() => {
        const next = sidebarInsetValue();
        if (next === inset) return;
        inset = next;
        if (!drag) syncPageNarrowed(preferred);
      }) : null;
      insetObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
      const covering = () => !hidden && desktop && panel.hasAttribute('data-overlay');

      // Only a page the panel covers extends, and only after a rest: crossing the strip on
      // the way to the sidebar must not move anything.
      const onPagePointer = (event: PointerEvent) => {
        if (!isHoverPointer(event) || drag || !covering()) return;
        if (pageExtended || pageHoverTimer !== null) return;
        pageHoverTimer = setTimeout(() => {
          if (setPageExtended(true)) adapters.analytics().pageExtended('hover', adapters.page());
        }, CHAT_PANEL_PAGE_HOVER_DELAY_MS);
      };
      // Leaving the page only cancels a pending rest. An extended page stays until the
      // pointer is back on the panel, so menus and dialogs opened from the page keep it.
      const onPageLeave = (event: PointerEvent) => {
        if (isHoverPointer(event)) cancelPageHover();
      };
      // The edge is exempt, so the handle stays where it is and can still be grabbed.
      const onPanelPointer = (event: PointerEvent) => {
        if (!isHoverPointer(event) || adapters.handle()?.contains(event.target as Node)) return;
        setPageExtended(false);
      };
      // Keyboard focus on a covered page element extends the page so the element shows. A
      // click or tap that focuses a text field matches :focus-visible too, so the input counts.
      const onPageFocus = (event: FocusEvent) => {
        if (!covering() || !keyboardInput || !isFocusVisible(focusedElement(event))) return;
        if (setPageExtended(true)) adapters.analytics().pageExtended('keyboard', adapters.page());
      };
      viewport.addEventListener('pointerenter', onPagePointer);
      viewport.addEventListener('pointermove', onPagePointer);
      viewport.addEventListener('pointerleave', onPageLeave);
      viewport.addEventListener('focusin', onPageFocus);
      panel.addEventListener('pointerover', onPanelPointer);
      return () => {
        observer?.disconnect();
        insetObserver?.disconnect();
        cancelPageHover();
        viewport.removeAttribute(CHAT_NARROWED_ATTRIBUTE);
        viewport.removeEventListener('pointerenter', onPagePointer);
        viewport.removeEventListener('pointermove', onPagePointer);
        viewport.removeEventListener('pointerleave', onPageLeave);
        viewport.removeEventListener('focusin', onPageFocus);
        panel.removeEventListener('pointerover', onPanelPointer);
      };
    },

    pointerDown(event: EdgePointerEvent) {
      const panel = panelNode();
      if (!panel || event.button !== 0) return;
      event.preventDefault();
      const target = event.currentTarget as HTMLElement | null;
      target?.setPointerCapture?.(event.pointerId);
      // From where the edge is drawn, even while it stands aside for the page.
      const startWidth = panel.getBoundingClientRect().width;
      const sharedWidth = measureSharedWidth(panel);
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth,
        sharedWidth,
        restingSharedWidth: restingSharedWidth(),
        width: null,
        focusedAtStart: document.activeElement === target,
        bodyCursor: document.body.style.cursor,
        bodyUserSelect: document.body.style.userSelect,
      };
      // Follow the pointer instead of easing toward it, and keep text from selecting.
      panel.setAttribute('data-resizing', '');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      describe(startWidth, sharedWidth);
    },

    pointerMove(event: EdgePointerEvent) {
      const current = drag;
      if (!current || event.pointerId !== current.pointerId) return;
      // The handle sits on the left edge: moving left widens the panel.
      const width = clampChatPanelWidth(current.startWidth + current.startX - event.clientX, current.sharedWidth);
      if (width === current.width) return;
      current.width = width;
      applyWidth(width, current.sharedWidth);
      syncPageNarrowed(width, current.restingSharedWidth);
      describe(width, current.sharedWidth);
    },

    endDrag,

    keyDown(event: EdgeKeyboardEvent) {
      const panel = panelNode();
      const direction = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
      if (!panel || direction === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const sharedWidth = measureSharedWidth(panel);
      // Step from what is on screen, including a panel stepped aside for the page.
      const width = clampChatPanelWidth(displayedWidth(sharedWidth) + direction * CHAT_PANEL_KEYBOARD_STEP_PX, sharedWidth);
      setWidth(width, sharedWidth);
      keyboardResized = true;
      describe(width, sharedWidth);
    },

    doubleClick() {
      const panel = panelNode();
      if (!panel) return;
      const sharedWidth = measureSharedWidth(panel);
      setWidth(null, sharedWidth);
      reportResize('reset', null, sharedWidth);
      describe(chosenWidth(sharedWidth), sharedWidth);
    },

    focus() {
      const panel = panelNode();
      if (!panel) return;
      const sharedWidth = measureSharedWidth(panel);
      describe(displayedWidth(sharedWidth), sharedWidth);
    },

    blur: flushKeyboardResize,
  };
}
