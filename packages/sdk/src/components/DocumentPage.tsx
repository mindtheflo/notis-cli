'use client';

import { useCallback, useRef, type CSSProperties, type ReactElement } from 'react';
import { useNotisRuntime } from '../provider';
import { DocumentEditor } from './DocumentEditor';
import { ShareControl } from './RecordComponents';
import { Skeleton } from './Skeleton';
import type { NotisDocumentPageProps } from '../runtime';

const copy = {
  en: { loading: 'Loading document', breadcrumb: 'Breadcrumb' },
  fr: { loading: 'Chargement du document', breadcrumb: "Fil d'Ariane" },
};

/** Column widths shared by the host page, its skeleton and the fallback, so nothing moves when the page arrives. */
export const DOCUMENT_PAGE_WIDTHS = { standard: 900, wide: 1200, full: undefined } as const;
/**
 * The page's horizontal gutter: 16px, then 48px from 640px wide (the host page's px-4 sm:px-12), and its
 * toolbar height (56px plus its 1px border, Beta's py-3 toolbar). The skeleton uses the same values.
 */
export const DOCUMENT_PAGE_GUTTER = { narrow: 16, wide: 48, breakpoint: 640, toolbar: 57 } as const;

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
export function DocumentPageSkeleton({ width = 'standard', className, label }: {
  width?: NotisDocumentPageProps['width']; className?: string; label?: string;
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
      <Skeleton style={{ width: '58%', height: 36, margin: '2px 0 10px' }} />
      <Skeleton style={{ width: '72%', height: 14, margin: '15px 0' }} />
      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        {[100, 96, 88, 100, 64].map((size, index) => <Skeleton key={index} style={{ width: `${size}%`, height: 16 }} />)}
      </div>
    </div>
  </div>;
}

/**
 * Shown by hosts that predate DocumentPage: the same record, with the editor these hosts already have.
 * menuItems show as plain toolbar buttons and onSaved is called when a save finishes (title null);
 * layout, header parts, meta and width options other than the column are not available there.
 */
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
      <nav aria-label={t.breadcrumb} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, fontSize: 14 }}>
        {crumbs.map((crumb, index) => <span key={`${crumb.label}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {crumb.onSelect ? <button type="button" onClick={crumb.onSelect}
            style={{ background: 'none', border: 0, padding: '4px 6px', borderRadius: 6, cursor: 'pointer', color: 'hsl(var(--muted-foreground))', font: 'inherit' }}>
            {crumb.label}</button> : <span style={{ color: 'hsl(var(--muted-foreground))' }}>{crumb.label}</span>}
          <span aria-hidden="true" style={{ color: 'hsl(var(--muted-foreground))' }}>/</span>
        </span>)}
      </nav>
      {actions}
      {share ? <ShareControl recordKey={recordKey} /> : null}
      {/* The host's '...' menu is not available here: its entries show as plain buttons. */}
      {menuItems.map((item, index) => <button key={`${item.label}-${index}`} type="button" onClick={item.onSelect} disabled={item.disabled}
        style={{ background: 'none', border: 0, padding: '4px 8px', borderRadius: 6, cursor: item.disabled ? 'default' : 'pointer', font: 'inherit', fontSize: 13,
          color: item.destructive ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))', opacity: item.disabled ? 0.5 : 1 }}>{item.label}</button>)}
    </div> : null}
    <div style={{ ...columnStyle(width), padding: '24px 16px 96px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {aboveBody}
      <DocumentEditor recordKey={recordKey} variant={props.header === false ? 'body' : 'full'} showProperties={props.properties !== 'hidden'}
        readOnly={readOnly} onDirtyChange={props.onDirtyChange} onSavingChange={savingChange} />
      {belowBody}
    </div>
  </div>;
}

/**
 * The full page of one record that is the main content of a Space view, such as a note: breadcrumb,
 * Saving or Saved status, '...' menu, cover, icon, title, meta strip, properties that save
 * automatically, and the collaborative body with presence. The host (Portal) draws it and keeps one
 * save queue for the whole record. Files open in their viewer under the header; HTML and reports show
 * only the toolbar (breadcrumb, actions, Share, '...' menu) above their frame, with no header, meta,
 * properties, aboveBody or belowBody.
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
  const Host = useNotisRuntime()?.ui?.DocumentPage;
  return Host ? <Host {...props} /> : <DocumentPageFallback {...props} />;
}

/**
 * Starts reading a record before it opens (for example on a list row's hover or focus), so its
 * DocumentPage shows at once. Does nothing outside a host that supports it.
 */
export function usePrefetchRecord(): (recordKey: string) => void {
  const prefetch = useNotisRuntime()?.ui?.prefetchRecord;
  return useCallback((recordKey: string) => { if (recordKey) prefetch?.(recordKey); }, [prefetch]);
}
