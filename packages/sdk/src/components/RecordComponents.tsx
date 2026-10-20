"use client";

import type { ReactElement } from 'react';
import { useNotisRuntime } from '../provider';
import type { NotisHtmlFrameProps, NotisRecordPropertiesProps, NotisReportFrameProps, NotisShareControlProps } from '../runtime';
import { pick, type Locale, type Words } from '../words/types';

/** The words a record component says outside Notis, in English and French. */
export const RECORD_COMPONENT_WORDS = Object.freeze({
  unavailable: { en: 'Open this record in Notis to use this component.', fr: 'Ouvre cet enregistrement dans Notis pour utiliser ce composant.' },
  /** Short enough for a toolbar (C11); the full sentence is its tooltip. */
  shareUnavailable: { en: 'Share unavailable', fr: 'Partage indisponible' },
  shareUnavailableHint: { en: 'Open this record in Notis to share it.', fr: 'Ouvre cet enregistrement dans Notis pour le partager.' },
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
