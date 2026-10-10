'use client';

import React, { useCallback, useLayoutEffect, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NotisProvider } from './provider';
import type { NotisRuntime } from './runtime';

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
  return <PresentationErrorBoundary resetKey={resetKey} fallback={fallback} onError={onError}>
    {mount && runtime && Component ? createPortal(<CommittedPresentation mount={mount} onCommit={onCommit}>
      {boundsCss ? <style data-notis-runtime-bounds>{boundsCss}</style> : null}
      <NotisProvider runtime={runtime} onProtocolError={onProtocolError} shortcutsAvailable={shortcutsAvailable}>
        <div data-notis-app-root data-notis-theme={theme.mode} style={theme.style}>
          {Shell ? <Shell><Component /></Shell> : <Component />}
        </div>
      </NotisProvider>
    </CommittedPresentation>, mount) : null}
  </PresentationErrorBoundary>;
}
