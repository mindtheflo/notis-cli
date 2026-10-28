'use client';

import { useCallback, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useNotisRuntime } from '../provider';
import { useTopBarTitleLeaf } from '../hooks/useTopBarTitleLeaf';
import { DocumentEditor } from './DocumentEditor';
import { HtmlFrame, ShareControl } from './RecordComponents';
import { Skeleton } from './Skeleton';
import { renderIcon } from '../ui/icons';
import { useIsoLayoutEffect } from '../ui/util';
import { beginWait, isWaiting } from '../perf';
import type { NotisDocumentPageProps } from '../runtime';

const copy = {
  en: { loading: 'Loading document', breadcrumb: 'Breadcrumb', untitled: 'Untitled' },
  fr: { loading: 'Chargement du document', breadcrumb: "Fil d'Ariane", untitled: 'Sans titre' },
};

/** Column widths shared by the host page, its skeleton and the fallback, so nothing moves when the page arrives. */
export const DOCUMENT_PAGE_WIDTHS = { standard: 900, wide: 1200, full: undefined } as const;
/**
 * The page's horizontal gutter: 16px, then 48px from 640px wide (the host page's px-4 sm:px-12), and its
 * toolbar height (56px plus its 1px border, Beta's py-3 toolbar). The skeleton uses the same values.
 */
export const DOCUMENT_PAGE_GUTTER = { narrow: 16, wide: 48, breakpoint: 640, toolbar: 57 } as const;

/** The widest a crumb before the last one gets; past it the words end in an ellipsis (C10). */
const CRUMB_MAX = 160;
// The room the fallback crumb keeps beside its buttons, and the one padding every crumb part has.
const CRUMB_MIN = 72;
const CRUMB_PADDING = '4px 6px';

const SKELETON = 'notis-document-page-skeleton';
// Inline styles cannot change with the width; this sheet (rendered with the skeleton, so it reaches a
// Space's ShadowRoot) gives the skeleton the page's own gutter and icon row at every width.
const skeletonCss = `.${SKELETON}__column{padding:8px ${DOCUMENT_PAGE_GUTTER.narrow}px 0}`
  + `.${SKELETON}__icon{width:44px;height:44px;margin-bottom:4px}`
  + `@media (min-width:${DOCUMENT_PAGE_GUTTER.breakpoint}px){.${SKELETON}__column{padding:8px ${DOCUMENT_PAGE_GUTTER.wide}px 0}`
  + `.${SKELETON}__icon{width:56px;height:56px}}`;

function useCopy() {
  return copy[useNotisRuntime()?.context?.locale === 'fr' ? 'fr' : 'en'];
}

function columnStyle(width: NotisDocumentPageProps['width'] = 'standard'): CSSProperties {
  const max = DOCUMENT_PAGE_WIDTHS[width];
  return { width: '100%', maxWidth: max ? `${max}px` : undefined, margin: '0 auto', boxSizing: 'border-box' };
}

/**
 * Placeholder shaped like the document page (toolbar, icon row, title, meta strip, body lines) at the
 * same column width and gutter, so the page replaces it without a layout shift. Hosts show it while the
 * record and the editor load; a Space can show it while its own data decides which record opens.
 */
export function DocumentPageSkeleton({ width = 'standard', className, label, title }: {
  width?: NotisDocumentPageProps['width']; className?: string; label?: string;
  /** The record's title when already known (from the list row that opened it): shown in place of its bar. */
  title?: string | null;
}): ReactElement {
  const t = useCopy();
  return <div role="status" aria-busy="true" aria-label={label || t.loading} data-notis-skeleton="document-page" className={className}
    style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
    <style>{skeletonCss}</style>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: DOCUMENT_PAGE_GUTTER.toolbar,
      padding: `0 ${DOCUMENT_PAGE_GUTTER.narrow}px`, boxSizing: 'border-box' }}>
      <Skeleton style={{ width: 180, height: 14 }} />
      <Skeleton style={{ width: 48, height: 12 }} />
    </div>
    <div className={`${SKELETON}__column`} style={{ ...columnStyle(width), display: 'flex', flexDirection: 'column' }}>
      <Skeleton className={`${SKELETON}__icon`} style={{ borderRadius: 12, height: undefined }} />
      {title ? <div data-notis-skeleton-title="" style={{ margin: '2px 0 10px', minHeight: 36, fontSize: 32, lineHeight: '36px',
        fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        : <Skeleton style={{ width: '58%', height: 36, margin: '2px 0 10px' }} />}
      <Skeleton style={{ width: '72%', height: 14, margin: '15px 0' }} />
      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        {[100, 96, 88, 100, 64].map((size, index) => <Skeleton key={index} style={{ width: `${size}%`, height: 16 }} />)}
      </div>
    </div>
  </div>;
}

/**
 * Shown by hosts that predate DocumentPage: the same record, with the editor these hosts already have.
 * menuItems show as toolbar buttons (icon only when they carry one) and onSaved is called when a save finishes (title null);
 * layout, header parts, meta and width options other than the column are not available there.
 * With viewer 'html' the host's HtmlFrame replaces the editor.
 */
// A 16px box for a menu item's icon, sized here because a host without the toolkit stylesheet gives the svg no size.
const ICON_BOX: CSSProperties = { display: 'inline-flex', width: 16, height: 16, overflow: 'hidden' };

function DocumentPageFallback(props: NotisDocumentPageProps) {
  const t = useCopy();
  const { recordKey, breadcrumb, actions, share = false, aboveBody, belowBody, width, readOnly, className, menuItems = [], onSaved, onSavingChange } = props;
  const crumbs = breadcrumb === false ? [] : breadcrumb || [];
  const showToolbar = crumbs.length > 0 || Boolean(actions) || share || menuItems.length > 0;
  // DocumentEditor reports saving, not what it saved: a finished save tells the Space to refresh its lists.
  const saving = useRef(false);
  const savingChange = useCallback((value: boolean) => {
    if (saving.current && !value) onSaved?.({ recordKey, title: null });
    saving.current = value;
    onSavingChange?.(value);
  }, [onSaved, onSavingChange, recordKey]);
  return <div className={className} style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
    {showToolbar ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 16px' }}>
      {/* C10: the crumb shrinks (each part ends in an ellipsis, a slash only between parts) and never runs under the
        buttons, which never wrap. The last part gets the room the others leave; every part has the same padding. When
        the buttons alone outgrow the bar (longer French labels), their labels shorten too, down to CRUMB_MIN of crumb. */}
      <nav aria-label={t.breadcrumb} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: CRUMB_MIN, overflow: 'hidden', fontSize: 14 }}>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const text: CSSProperties = { display: 'block', minWidth: 0, maxWidth: last ? '100%' : CRUMB_MAX, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'hsl(var(--muted-foreground))' };
          return <span key={`${crumb.label}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '0 1 auto' }}>
            {crumb.onSelect ? <button type="button" onClick={crumb.onSelect} title={crumb.label}
              style={{ ...text, background: 'none', border: 0, padding: CRUMB_PADDING, borderRadius: 6, cursor: 'pointer', font: 'inherit' }}>
              {crumb.label}</button>
              : <span title={crumb.label} style={{ ...text, padding: CRUMB_PADDING }}>{crumb.label}</span>}
            {last ? null : <span aria-hidden="true" style={{ flex: 'none', color: 'hsl(var(--muted-foreground))' }}>/</span>}
          </span>;
        })}
      </nav>
      <div data-notis-document-page-actions="" style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '0 1 auto', minWidth: 0, whiteSpace: 'nowrap' }}>
        {actions}
        {share ? <ShareControl recordKey={recordKey} /> : null}
        {/* The host's '...' menu is not available here: its entries show as buttons, icon only when they carry one. */}
        {menuItems.map((item, index) => <button key={`${item.label}-${index}`} type="button" onClick={item.onSelect} disabled={item.disabled} title={item.label}
          aria-label={item.icon ? item.label : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: 0, padding: item.icon ? 6 : '4px 8px', borderRadius: 6, cursor: item.disabled ? 'default' : 'pointer', font: 'inherit', fontSize: 13,
            flex: '0 1 auto', minWidth: 0, maxWidth: CRUMB_MAX, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: item.destructive ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))', opacity: item.disabled ? 0.5 : 1 }}>{item.icon ? <span style={ICON_BOX}>{renderIcon(item.icon)}</span> : item.label}</button>)}
      </div>
    </div> : null}
    {props.viewer === 'html' ? <HtmlFrame recordKey={recordKey} /> :
    <div style={{ ...columnStyle(width), padding: '24px 16px 96px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {aboveBody}
      <DocumentEditor recordKey={recordKey} variant={props.header === false ? 'body' : 'full'} showProperties={props.properties !== 'hidden'}
        readOnly={readOnly} onDirtyChange={props.onDirtyChange} onSavingChange={savingChange} />
      {belowBody}
    </div>}
  </div>;
}

/**
 * The full page of one record that is the main content of a Space view, such as a note: breadcrumb,
 * Saving or Saved status, '...' menu, cover, icon, title, meta strip, properties that save
 * automatically, and the collaborative body with presence. The host (Portal) draws it and keeps one
 * save queue for the whole record. Files open in their viewer under the header; HTML and reports show
 * only the toolbar (breadcrumb, actions, Share, '...' menu) above their frame, with no header, meta,
 * properties, aboveBody or belowBody. `viewer: 'html'` opens a record whose one stored `.html` file is
 * the page (for example a note that keeps a saved HTML report) the same way.
 *
 * ```tsx
 * if (params.note) return <DocumentPage recordKey={params.note}
 *   breadcrumb={[{ label: 'All notes', onSelect: () => setParams({ note: null }) }]}
 *   actions={<TrashButton />} onSaved={() => notes.refetch()} />;
 * ```
 *
 * Slots (`breadcrumb`, `actions`, `menuItems`, `aboveBody`, `belowBody`) and toggles (`share`,
 * `header`, `meta`, `properties`, `width`) adjust it; `layout` rearranges its parts. Hosts without
 * this component show the record with `DocumentEditor` instead.
 */
export function DocumentPage(props: NotisDocumentPageProps): ReactElement {
  const runtime = useNotisRuntime();
  const Host = runtime?.ui?.DocumentPage;
  const t = useCopy();
  const { recordKey, onTitle } = props;
  // A record opened from the view (it draws a way back) names the top bar leaf with its title, so the view's page
  // becomes a parent crumb. The host reports the title; until it does, and on hosts that never do, there is no leaf.
  const leaf = props.topBarTitle ?? (Array.isArray(props.breadcrumb) && props.breadcrumb.length > 0);
  // The top bar is then the page's crumb: its view crumb goes back as the page's last crumb did, and the host draws
  // its own breadcrumb only where the top bar shows none.
  const inTopBar = Boolean(leaf && Host && runtime?.setTopBarTitleLeaf);
  const back = Array.isArray(props.breadcrumb) ? [...props.breadcrumb].reverse().find(crumb => crumb.onSelect)?.onSelect : undefined;
  const [reported, setReported] = useState<{ recordKey: string; title: string } | null>(null);
  const reportTitle = useCallback((title: string) => {
    setReported(current => current?.recordKey === recordKey && current.title === title ? current : { recordKey, title });
    onTitle?.(title);
  }, [recordKey, onTitle]);
  const title = reported?.recordKey === recordKey ? reported.title : null;
  useTopBarTitleLeaf(leaf && title !== null ? title.trim() || t.untitled : null, back, { recordKey });
  // Another record opening here is timed until the host paints it (a list's open has started that wait already).
  const timed = Boolean(Host);
  useIsoLayoutEffect(() => { if (timed && recordKey && !isWaiting('notis:record-open')) beginWait('notis:record-open'); }, [recordKey, timed]);
  return Host ? <Host {...props} topBarTitle={inTopBar} onTitle={reportTitle} /> : <DocumentPageFallback {...props} />;
}

/**
 * Starts reading a record before it opens (for example on a list row's hover or focus), so its
 * DocumentPage shows at once. Does nothing outside a host that supports it.
 */
export function usePrefetchRecord(): (recordKey: string) => void {
  const prefetch = useNotisRuntime()?.ui?.prefetchRecord;
  return useCallback((recordKey: string) => { if (recordKey) prefetch?.(recordKey); }, [prefetch]);
}
