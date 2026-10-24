/**
 * The second-screen presenter, like PowerPoint: with two screens, the audience sees the presentation full screen on
 * the other one while this window stays the presenter's (notes, previews, timer). The Space renders the audience view
 * with `portal(...)`, in its own React tree, so both windows show the same state and stay in sync.
 *
 * The browser asks once to place windows on screens (Window Management API); Electron never asks and fills the other
 * display itself. One screen, or a browser without the API: `open` answers 'one-screen' and the Space presents as
 * before.
 */

import React, { useCallback, useEffect, useRef, useState, type ReactNode, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';
import { LAYER_ROOT_ATTRIBUTE, LayerRootProvider } from '../overlay/layerRoot';
import { useToolkitLocale } from '../engine/hooks';
import { useT } from '../util';
import type { Words } from '../../words';
import { PRESENT_WORDS } from './presentWords';
import {
  AUDIENCE_WINDOW_NAME, audienceFeatures, clickHasOwnTarget, copyStylesInto, fillsScreen, hasSecondScreen, keyAction,
  pickAudienceScreen, type PresentAction, type ScreenArea,
} from './screens';

/**
 * 'opened': the audience window is up. 'one-screen': present in this window. 'press-again': the browser just asked
 * for permission and used up the press, so the window could not open; the same press works now. 'blocked': the
 * browser blocked the window.
 */
export type AudienceOpenResult = 'opened' | 'one-screen' | 'press-again' | 'blocked';

export type UseAudienceScreenOptions = {
  /** A key, click or right click in the audience window. Escape is 'stop'. */
  onAction: (action: PresentAction) => void;
  /** The audience window closed (by the person, by Escape in the Space, or by `close`). */
  onClose?: () => void;
  /** The audience window's title. Default: "Presentation". */
  title?: Words | string;
};

export type UseAudienceScreenResult = {
  /** True when a second screen is connected (updates when one is plugged in or out). */
  secondScreen: boolean;
  isOpen: boolean;
  /** Open the audience window on the other screen. Call from the press itself; `anchor` is an element of the Space. */
  open: (anchor?: Element | null) => Promise<AudienceOpenResult>;
  close: () => void;
  /** Render the audience view into the audience window; null while it is closed. */
  portal: (node: ReactNode) => ReactPortal | null;
};

type Audience = { win: Window; container: HTMLElement; layer: HTMLElement; placed: boolean };

type ScreenDetails = { screens: readonly ScreenArea[]; currentScreen: ScreenArea | null };

type WindowManagement = 'granted' | 'prompt' | 'denied' | 'unsupported';

async function windowManagementState(win: Window): Promise<WindowManagement> {
  if (typeof (win as Window & { getScreenDetails?: unknown }).getScreenDetails !== 'function') return 'unsupported';
  try {
    const status = await win.navigator.permissions.query({ name: 'window-management' as PermissionName });
    return status.state as WindowManagement;
  } catch {
    // Older Chrome names it window-placement; asking still works.
    return 'prompt';
  }
}

async function screenDetails(win: Window): Promise<ScreenDetails | null> {
  try {
    return await (win as Window & { getScreenDetails: () => Promise<ScreenDetails> }).getScreenDetails();
  } catch {
    return null;
  }
}

const AUDIENCE_BASE_CSS = [
  'html,body{height:100%;margin:0;overflow:hidden;background:hsl(0 0% 0%)}',
  '[data-notis-audience-root]{position:fixed;inset:0;display:flex;flex-direction:column}',
].join('');

function setUpWindow(win: Window, anchor: Element | null, title: string, locale: string): Audience {
  const doc = win.document;
  const root = anchor?.getRootNode();
  const shadow = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root : null;
  doc.head.replaceChildren();
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  doc.head.append(charset);
  doc.title = title;
  doc.documentElement.lang = locale;
  copyStylesInto(doc, document, shadow);
  const base = doc.createElement('style');
  base.textContent = AUDIENCE_BASE_CSS;
  doc.head.append(base);
  // The app root carries the theme and the Portal token snapshot; the audience view needs both.
  const appRoot = anchor?.closest('[data-notis-app-root]') ?? null;
  const container = doc.createElement('div');
  container.setAttribute('data-notis-app-root', '');
  container.setAttribute('data-notis-audience-root', '');
  const theme = appRoot?.getAttribute('data-notis-theme');
  if (theme) container.setAttribute('data-notis-theme', theme);
  const style = appRoot?.getAttribute('style');
  if (style) container.setAttribute('style', style);
  const layer = doc.createElement('div');
  layer.setAttribute(LAYER_ROOT_ATTRIBUTE, '');
  doc.body.replaceChildren(container, layer);
  return { win, container, layer, placed: false };
}

function AudienceView({ audience, children }: { audience: Audience; children?: ReactNode }) {
  const t = useT();
  const { win } = audience;
  const [filled, setFilled] = useState(() => fillsScreen(win));
  useEffect(() => {
    const update = () => setFilled(fillsScreen(win));
    update();
    win.addEventListener('resize', update);
    win.document.addEventListener('fullscreenchange', update);
    return () => {
      win.removeEventListener('resize', update);
      win.document.removeEventListener('fullscreenchange', update);
    };
  }, [win]);
  const fill = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void win.document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => undefined);
    },
    [win],
  );
  return (
    <LayerRootProvider root={audience.layer}>
      {children}
      {filled ? null : (
        <button
          type="button"
          data-notis-audience-fill=""
          onClick={fill}
          className="fixed inset-0 z-[1000] flex cursor-pointer items-end justify-center bg-transparent p-8"
        >
          <span className="rounded-full bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg ring-1 ring-border">
            {t(audience.placed ? PRESENT_WORDS.fillScreen : PRESENT_WORDS.dragToScreen)}
          </span>
        </button>
      )}
    </LayerRootProvider>
  );
}

/** The second-screen presenter. See the module comment. */
export function useAudienceScreen(options: UseAudienceScreenOptions): UseAudienceScreenResult {
  const t = useT();
  const locale = useToolkitLocale();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [secondScreen, setSecondScreen] = useState(() => (typeof window === 'undefined' ? false : hasSecondScreen(window)));
  const [audience, setAudience] = useState<Audience | null>(null);
  const audienceRef = useRef<Audience | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const screen = window.screen as Screen & Partial<EventTarget>;
    const update = () => setSecondScreen(hasSecondScreen(window));
    update();
    if (typeof screen.addEventListener !== 'function') return undefined;
    screen.addEventListener('change', update);
    return () => screen.removeEventListener?.('change', update);
  }, []);

  const finish = useCallback((closeWindow: boolean) => {
    const current = audienceRef.current;
    if (!current) return;
    audienceRef.current = null;
    teardownRef.current?.();
    teardownRef.current = null;
    if (closeWindow && !current.win.closed) current.win.close();
    setAudience(null);
    optionsRef.current.onClose?.();
  }, []);

  const close = useCallback(() => finish(true), [finish]);

  const open = useCallback(
    async (anchor?: Element | null): Promise<AudienceOpenResult> => {
      const current = audienceRef.current;
      if (current && !current.win.closed) {
        current.win.focus();
        return 'opened';
      }
      if (typeof window === 'undefined' || !hasSecondScreen(window)) return 'one-screen';
      const state = await windowManagementState(window);
      let target: ScreenArea | null = null;
      if (state === 'granted' || state === 'prompt') {
        const details = await screenDetails(window);
        if (details) target = pickAudienceScreen(details.screens, details.currentScreen);
      }
      const win = window.open('', AUDIENCE_WINDOW_NAME, audienceFeatures(target));
      if (!win) return state === 'prompt' ? 'press-again' : 'blocked';
      const next = setUpWindow(win, anchor ?? null, t(optionsRef.current.title ?? PRESENT_WORDS.audienceTitle), locale);
      next.placed = target !== null;

      const onKey = (event: KeyboardEvent) => {
        const action = keyAction(event);
        if (!action) return;
        event.preventDefault();
        optionsRef.current.onAction(action);
      };
      const onClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || clickHasOwnTarget(event.target)) return;
        optionsRef.current.onAction('next');
      };
      const onContextMenu = (event: MouseEvent) => {
        if (event.defaultPrevented || clickHasOwnTarget(event.target)) return;
        event.preventDefault();
        optionsRef.current.onAction('previous');
      };
      const onGone = () => finish(false);
      const onLeave = () => finish(true);
      win.addEventListener('keydown', onKey);
      win.addEventListener('click', onClick);
      win.addEventListener('contextmenu', onContextMenu);
      win.addEventListener('pagehide', onGone);
      window.addEventListener('pagehide', onLeave);
      // Closing a window does not always fire pagehide in it; the poll catches the rest.
      const poll = window.setInterval(() => {
        if (win.closed) finish(false);
      }, 500);
      teardownRef.current?.();
      teardownRef.current = () => {
        window.clearInterval(poll);
        window.removeEventListener('pagehide', onLeave);
        win.removeEventListener('keydown', onKey);
        win.removeEventListener('click', onClick);
        win.removeEventListener('contextmenu', onContextMenu);
        win.removeEventListener('pagehide', onGone);
      };
      audienceRef.current = next;
      setAudience(next);
      win.focus();
      return 'opened';
    },
    [finish, locale, t],
  );

  useEffect(() => () => finish(true), [finish]);

  const portal = useCallback(
    (node: ReactNode): ReactPortal | null =>
      audience ? createPortal(<AudienceView audience={audience}>{node}</AudienceView>, audience.container) : null,
    [audience],
  );

  return { secondScreen, isOpen: audience !== null, open, close, portal };
}
