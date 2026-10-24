"use client";

import type { ReactElement } from 'react';
import { useNotisRuntime } from '../provider';
import type {
  NotisHtmlFrameProps, NotisRecordPropertiesProps, NotisReportFrameProps, NotisShareControlProps, NotisSpacePageFrameProps,
} from '../runtime';
import { pick, type Locale, type Words } from '../words/types';

/** The words a record component says outside Notis, in English and French. */
export const RECORD_COMPONENT_WORDS = Object.freeze({
  unavailable: { en: 'Open this record in Notis to use this component.', fr: 'Ouvre cet enregistrement dans Notis pour utiliser ce composant.' },
  /** Short enough for a toolbar (C11); the full sentence is its tooltip. */
  shareUnavailable: { en: 'Share unavailable', fr: 'Partage indisponible' },
  shareUnavailableHint: { en: 'Open this record in Notis to share it.', fr: 'Ouvre cet enregistrement dans Notis pour le partager.' },
  spacePageTitle: { en: 'Space page', fr: 'Page du Space' },
  spacePagePreview: { en: 'This page shows here live when the Space opens in Notis.', fr: 'Cette page s’affiche ici en direct quand le Space est ouvert dans Notis.' },
  spacePageOpen: { en: 'Open page', fr: 'Ouvrir la page' },
}) satisfies Readonly<Record<string, Words>>;

function useLocale(): Locale {
  return useNotisRuntime()?.context?.locale === 'fr' ? 'fr' : 'en';
}

/** What a record component shows when the host does not draw it: one sentence, in the Space's language. */
export function RecordComponentUnavailable({ className }: { className?: string }): ReactElement {
  return <div role="status" className={className}>{pick(RECORD_COMPONENT_WORDS.unavailable, useLocale())}</div>;
}
/** The record's properties, drawn by the host. */
export function RecordProperties(props: NotisRecordPropertiesProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.RecordProperties;
  return Host ? <Host {...props} /> : <RecordComponentUnavailable className={props.className} />;
}
/** The host applies its viewer CSP and an opaque-origin sandbox; source cannot relax either. */
export function HtmlFrame(props: NotisHtmlFrameProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.HtmlFrame;
  return Host ? <Host {...props} /> : <RecordComponentUnavailable className={props.className} />;
}
/** A saved report's frame, drawn by the host. */
export function ReportFrame(props: NotisReportFrameProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.ReportFrame;
  return Host ? <Host {...props} /> : <RecordComponentUnavailable className={props.className} />;
}
/**
 * Private/shared state, copy link and revoke, backed by this record's Site. Outside Notis it sits in a toolbar as a
 * short muted label whose tooltip says where sharing works (C11), never a sentence that fills the bar.
 */
export function ShareControl(props: NotisShareControlProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.ShareControl;
  const locale = useLocale();
  if (Host) return <Host {...props} />;
  const hint = pick(RECORD_COMPONENT_WORDS.shareUnavailableHint, locale);
  return <span role="status" className={props.className} title={hint} aria-label={hint} data-notis-share-unavailable=""
    style={{ display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 8px', fontSize: 13, whiteSpace: 'nowrap',
      color: 'hsl(var(--muted-foreground))' }}>
    {pick(RECORD_COMPONENT_WORDS.shareUnavailable, locale)}
  </span>;
}

/**
 * The path a Space page link names and the link the fallback card may open: a site-relative path, or an http(s) URL
 * without credentials. Anything else (script URLs, protocol-relative links) opens nothing.
 */
export function spacePageLink(href: string): { path: string; openHref: string | null } {
  const value = typeof href === 'string' ? href.trim() : '';
  // Control characters and backslashes change how browsers read a URL; such a link never opens.
  if (!value || /[\u0000-\u001f\u007f\\]/.test(value)) return { path: value, openHref: null };
  if (value.startsWith('/') && !value.startsWith('//')) {
    const path = value.split(/[?#]/, 1)[0] || '/';
    return { path, openHref: value };
  }
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
      return { path: url.pathname, openHref: url.href };
    }
  } catch { /* not a URL */ }
  return { path: value, openHref: null };
}

/** What a Space page frame shows when the host does not draw it (previews, verify): its title, its path and Open page. */
export function SpacePageCard({ href, title, className, notice }: Pick<NotisSpacePageFrameProps, 'href' | 'title' | 'className'> & {
  /** One sentence under the path; default: the page shows live once the Space opens in Notis. */
  notice?: string;
}): ReactElement {
  const locale = useLocale();
  const { path, openHref } = spacePageLink(href);
  const muted = 'hsl(var(--muted-foreground))';
  return <div role="group" aria-label={title || pick(RECORD_COMPONENT_WORDS.spacePageTitle, locale)} className={className}
    data-notis-space-page-card=""
    style={{ display: 'grid', alignContent: 'start', gap: 8, padding: 16, borderRadius: 10, minWidth: 0,
      background: 'hsl(var(--muted) / .5)', color: 'hsl(var(--foreground))' }}>
    <div style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>{title || pick(RECORD_COMPONENT_WORDS.spacePageTitle, locale)}</div>
    {path ? <div style={{ fontSize: 12, color: muted, overflowWrap: 'anywhere',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{path}</div> : null}
    <div style={{ fontSize: 13, color: muted }}>{notice ?? pick(RECORD_COMPONENT_WORDS.spacePagePreview, locale)}</div>
    {openHref ? <div><a className="nui-btn" href={openHref} style={{ textDecoration: 'none' }}>
      {pick(RECORD_COMPONENT_WORDS.spacePageOpen, locale)}
    </a></div> : null}
  </div>;
}

/**
 * Another Space page shown live inside this view. The host loads only a Space page of its own Notis origin, with the
 * viewer's own access; any other link (and every host without the frame) shows a card with the title, the path and
 * Open page. Not interactive by default, so a deck around it keeps its keys and clicks.
 */
export function SpacePageFrame(props: NotisSpacePageFrameProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.SpacePageFrame;
  return Host ? <Host {...props} /> : <SpacePageCard href={props.href} title={props.title} className={props.className} />;
}
