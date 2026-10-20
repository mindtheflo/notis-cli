import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import type { Locale, Platform } from '../../words';
import type { KeyboardEngineCore } from './core';
import { useShortcutScope, type ShortcutScopeOptions } from './hooks';
import { getSharedInstance } from './instance';
import type { EngineHost } from './types';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface KeyboardEngineProps {
  host: EngineHost;
  locale: Locale;
  platform?: Platform;
  /** Clashes throw (dev, design check). Default: true unless NODE_ENV is 'production'. */
  strict?: boolean;
  /** Production clash log (telemetry). */
  onClash?: (message: string) => void;
  /** An own core (tests). Default: the page's shared core. */
  engine?: KeyboardEngineCore;
  /** The document to listen on. Default: the global document. */
  document?: Document;
  children?: ReactNode;
}

/** The one keyboard listener of a page, at the Portal root (or the preview root). */
export function KeyboardEngine(props: KeyboardEngineProps) {
  const shared = getSharedInstance();
  const core = props.engine ?? shared.core;
  const { host, locale, platform, strict, onClash } = props;

  // Settings apply before children read them (layout effects run child first, so configure during render too).
  core.configure({ host, locale, platform, strict, onClash }, { silent: true });
  useIsoLayoutEffect(() => { core.registry.notify(); }, [core, host, locale, platform, strict]);

  useIsoLayoutEffect(() => {
    core.mounted += 1;
    core.registry.notify();
    return () => {
      core.mounted -= 1;
      core.registry.notify();
    };
  }, [core]);

  const doc = props.document ?? (typeof document !== 'undefined' ? document : undefined);
  useEffect(() => (doc ? core.attach(doc) : undefined), [core, doc]);

  const content = props.children ?? null;
  return props.engine
    ? <shared.EngineContext.Provider value={props.engine}>{content}</shared.EngineContext.Provider>
    : <>{content}</>;
}

export interface ShortcutScopeProps extends ShortcutScopeOptions {
  owner: string;
  children?: ReactNode;
}

/** Owner of every shortcut below it: a Space, or a retained view that goes silent while hidden. */
export function ShortcutScope({ owner, available, kind, children }: ShortcutScopeProps) {
  const { OwnerContext } = getSharedInstance();
  useShortcutScope(owner, { available, kind });
  return <OwnerContext.Provider value={owner}>{children}</OwnerContext.Provider>;
}
