'use client';

import React, { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NotisProvider } from './provider';
import { citeSpaceSelection, copySpaceSelection } from './components/NotisSelectionBoundary';
import { QUOTE_GLYPH, SELECTION_BAR_WORDS, SelectionActionBar, clearSelectionIn, useSelectionAnchor } from './components/SelectionActionBar';
import { useToolkitLocale } from './ui/engine/hooks';
import type { NotisRuntime } from './runtime';
import { ShortcutScope } from './ui/engine/KeyboardEngine';

type BoundaryProps = {
  children: ReactNode;
  resetKey: string;
  fallback: (error: Error) => ReactNode;
  onError: (error: Error, info: ErrorInfo) => void;
};

/** A navigation can recover a crashed view without remounting healthy drafts. */
export class PresentationErrorBoundary extends React.Component<BoundaryProps, { error: Error | null; resetKey: string }> {
  constructor(props: BoundaryProps) { super(props); this.state = { error: null, resetKey: props.resetKey }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: BoundaryProps, state: { resetKey: string }) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError(error, info); }
  render() { return this.state.error ? this.props.fallback(this.state.error) : this.props.children; }
}

function CommittedPresentation({ mount, onCommit, children }: { mount: HTMLElement; onCommit?: (hasContent: boolean) => void; children: ReactNode }) {
  useLayoutEffect(() => {
    if (!onCommit) return;
    const publish = () => onCommit?.(Boolean(mount.querySelector('[data-notis-app-root]')?.childNodes.length));
    publish();
    // A source may render null while its first query resolves. Observe the
    // committed source DOM, not only commits of the unchanged host component.
    const Observer = mount.ownerDocument.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(publish) : null;
    observer?.observe(mount, { childList: true, subtree: true, characterData: true });
    return () => observer?.disconnect();
  }, [mount, onCommit]);
  return children;
}

/** Portal and offline verification share this exact React/Shadow presentation.
 * Source is trusted code in the host JS realm; Shadow DOM only isolates CSS.
 * Loading, credentials and action authority belong to the respective host.
 */
export function SdkPresentation({ mount, runtime, component: Component, shell: Shell, theme, resetKey, active = true,
  fallback, onError, onCommit, boundsCss, onProtocolError }: {
  mount: HTMLElement | null;
  runtime: NotisRuntime | null;
  component: React.ComponentType | null;
  shell?: React.ComponentType<{ children: ReactNode }>;
  theme: { mode: 'light' | 'dark'; style: CSSProperties };
  resetKey: string;
  fallback: BoundaryProps['fallback'];
  onError: BoundaryProps['onError'];
  onCommit?: (hasContent: boolean) => void;
  boundsCss?: string;
  active?: boolean;
  onProtocolError?: (error: Error) => void;
}) {
  // A retained record and its parent can render the same source at once.
  // Keyboard ownership belongs to this presentation, not to the source ID.
  const shortcutOwner = `space:presentation:${useId()}`;
  const shortcutsAvailable = useCallback(() => {
    if (!active || !mount?.isConnected) return false;
    let element: HTMLElement | null = mount;
    while (element) {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      if (element.hidden || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true'
          || style?.display === 'none' || style?.visibility === 'hidden') return false;
      const root = element.getRootNode();
      element = element.parentElement || ('host' in root ? (root as ShadowRoot).host as HTMLElement : null);
    }
    return true;
  }, [active, mount]);
  // Every Space quotes copied text by default; a Site's runtime has no chat to quote into.
  const onCopy = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => copySpaceSelection(event, runtime), [runtime]);
  const appRoot = useRef<HTMLDivElement>(null);
  return <PresentationErrorBoundary resetKey={resetKey} fallback={fallback} onError={onError}>
    {mount && runtime && Component ? createPortal(<CommittedPresentation mount={mount} onCommit={onCommit}>
      {boundsCss ? <style data-notis-runtime-bounds>{boundsCss}</style> : null}
      <ShortcutScope owner={shortcutOwner} kind="space" available={shortcutsAvailable()}>
      <NotisProvider runtime={runtime} onProtocolError={onProtocolError} shortcutsAvailable={shortcutsAvailable}>
        <div ref={appRoot} data-notis-app-root data-notis-theme={theme.mode} style={theme.style} onCopy={onCopy}>
          {Shell ? <Shell><Component /></Shell> : <Component />}
          <SpaceSelectionCite root={appRoot} runtime={runtime} />
        </div>
      </NotisProvider>
      </ShortcutScope>
    </CommittedPresentation>, mount) : null}
  </PresentationErrorBoundary>;
}

/**
 * Every Space view gets Cite on selected text by default (truth PRT-087), quoting what copy would quote. A comment
 * boundary draws its own bar (Cite and Comment), and a Site's runtime has no chat, so neither shows this one.
 */
function SpaceSelectionCite({ root, runtime }: { root: React.RefObject<HTMLDivElement | null>; runtime: NotisRuntime }) {
  const locale = useToolkitLocale();
  const [barSize, setBarSize] = useState({ width: 72, height: 32 });
  const { anchor, dismiss } = useSelectionAnchor(root, {
    enabled: Boolean(runtime.addContext),
    barSize,
    accept: range => {
      const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
      return !element?.closest('[data-notis-comment-boundary]');
    },
  });
  if (!anchor) return null;
  return <SelectionActionBar anchor={anchor} onSize={setBarSize} actions={[{
    key: 'cite', label: SELECTION_BAR_WORDS.cite[locale], title: SELECTION_BAR_WORDS.citeHint[locale], icon: QUOTE_GLYPH,
    onSelect: () => {
      const { range, text } = anchor;
      clearSelectionIn(root.current);
      dismiss();
      void citeSpaceSelection(runtime, range, text).catch(() => false);
    },
  }]} />;
}
