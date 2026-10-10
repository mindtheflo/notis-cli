"use client";

import type { ReactElement } from 'react';
import { useNotisRuntime } from '../provider';
import type { NotisHtmlFrameProps, NotisRecordPropertiesProps, NotisReportFrameProps, NotisShareControlProps } from '../runtime';

const copy = {
  en: { unavailable: 'Open this record in Notis to use this component.' },
  fr: { unavailable: 'Ouvre cet enregistrement dans Notis pour utiliser ce composant.' },
};
export function RecordComponentUnavailable({ className }: { className?: string }): ReactElement {
  const runtime = useNotisRuntime();
  const locale = runtime?.context?.locale === 'fr' ? 'fr' : 'en';
  return <div role="status" className={className}>{copy[locale].unavailable}</div>;
}
export function RecordProperties(props: NotisRecordPropertiesProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.RecordProperties;
  return Host ? <Host {...props} /> : <RecordComponentUnavailable className={props.className} />;
}
/** The host applies its viewer CSP and an opaque-origin sandbox; source cannot relax either. */
export function HtmlFrame(props: NotisHtmlFrameProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.HtmlFrame;
  return Host ? <Host {...props} /> : <RecordComponentUnavailable className={props.className} />;
}
export function ReportFrame(props: NotisReportFrameProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.ReportFrame;
  return Host ? <Host {...props} /> : <RecordComponentUnavailable className={props.className} />;
}
/** Private/shared state, copy link and revoke, backed by this record's Site. */
export function ShareControl(props: NotisShareControlProps): ReactElement {
  const Host = useNotisRuntime()?.ui?.ShareControl;
  return Host ? <Host {...props} /> : <RecordComponentUnavailable className={props.className} />;
}
