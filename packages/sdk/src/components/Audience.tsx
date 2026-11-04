'use client';

import React, { type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useNotisRuntime } from '../provider';
import { spaceAudience, type SpaceAudience } from '../space';
import { pick, type Locale, type Words } from '../words/types';

/** The words of the view-as switch, in English and French. */
export const AUDIENCE_WORDS = Object.freeze({
  viewAsPublic: { en: 'View as the public', fr: 'Voir comme le public' },
  backToEditing: { en: 'Back to editing', fr: 'Revenir en édition' },
}) satisfies Readonly<Record<string, Words>>;

export interface UseAudienceResult {
  /** Who the page is drawn for. `public` while an editor views the Space as the public. */
  audience: SpaceAudience;
  /** An editor is viewing this Space as the public. */
  viewingAsPublic: boolean;
  /** The viewer is an editor and this host can switch View as the public on and off. */
  canViewAsPublic: boolean;
  /** Switch View as the public on or off; does nothing where `canViewAsPublic` is false. */
  setViewingAsPublic(on: boolean): void;
}

/**
 * Who the Space is drawn for: its editors or the public (Site and link visitors, signed-in people who cannot edit).
 * Outside a Space, and on servers that predate audiences, the answer is `public`. The server enforces the same
 * split, so this only decides what differs on screen.
 */
export function useAudience(): UseAudienceResult {
  const runtime = useNotisRuntime();
  const space = runtime?.resource?.kind === 'space' ? runtime.space : undefined;
  const viewingAsPublic = space?.viewAs === 'public';
  const isEditor = viewingAsPublic || space?.audience === 'editor';
  const setter = runtime?.setSpaceViewAs;
  const canViewAsPublic = Boolean(isEditor && setter);
  return {
    audience: spaceAudience(space),
    viewingAsPublic,
    canViewAsPublic,
    setViewingAsPublic(on: boolean) { if (canViewAsPublic) setter!(on ? 'public' : null); },
  };
}

/** Shown to the Space's editors only (never while they view it as the public). */
export function Editors({ children }: { children?: ReactNode }): ReactElement | null {
  return useAudience().audience === 'editor' ? <>{children}</> : null;
}

/** Shown to the public only, and to editors viewing the Space as the public. */
export function Public({ children }: { children?: ReactNode }): ReactElement | null {
  return useAudience().audience === 'public' ? <>{children}</> : null;
}

export interface ViewAsPublicProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * The View as the public switch, placed by the Space's own page. Editors only: renders nothing for the public and
 * on hosts that cannot switch. The host's Share menu offers the same switch when the page does not place it.
 */
export function ViewAsPublic({ className, style }: ViewAsPublicProps): ReactElement | null {
  const runtime = useNotisRuntime();
  const { viewingAsPublic, canViewAsPublic, setViewingAsPublic } = useAudience();
  if (!canViewAsPublic) return null;
  const locale: Locale = runtime?.context?.locale === 'fr' ? 'fr' : 'en';
  return <button type="button" className={className} aria-pressed={viewingAsPublic} data-notis-view-as-public=""
    onClick={() => setViewingAsPublic(!viewingAsPublic)}
    style={{ display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', borderRadius: 8, border: 'none',
      background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))', fontSize: 13, fontWeight: 500, cursor: 'pointer',
      whiteSpace: 'nowrap', ...style }}>
    {pick(viewingAsPublic ? AUDIENCE_WORDS.backToEditing : AUDIENCE_WORDS.viewAsPublic, locale)}
  </button>;
}
