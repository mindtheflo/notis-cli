/**
 * Full-screen image viewer (the Portal's attachment lightbox): zoom (buttons, wheel, + - 0), drag to pan, arrows
 * between images, download, copy link, Escape or a backdrop click to close. Modal: focus moves in, Tab stays inside,
 * and focus returns on close.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { fillWords } from '../../words';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer, useToolkitLocale } from '../engine/hooks';
import { Icon } from '../icons';
import { findLayerRoot, usePinnedLayerRoot } from '../overlay/layerRoot';
import { cx, deepActiveElement, useLatest, useT } from '../util';
import { GALLERY_WORDS } from './galleryWords';

export interface ImageViewerImage {
  src: string;
  /** Alt text, also the download file name. */
  alt?: string;
}

export type GalleryNoticeTone = 'success' | 'error';

export interface ImageViewerProps {
  images: readonly ImageViewerImage[];
  /** The image shown first. Default 0. */
  initialIndex?: number;
  onClose: () => void;
  /** Where the viewer mounts. Default: the pinned layer root, else the page body (inside a Space: its layer root). */
  container?: Element | DocumentFragment | null;
  /** Extra buttons placed first in the control bar for the current image (for example a share button). */
  actions?: (image: ImageViewerImage, index: number) => ReactNode;
  /** Reports copy and download outcomes (a toast). The copy button also shows a check for a moment. */
  onNotice?: (tone: GalleryNoticeTone, text: string) => void;
  className?: string;
}

export const IMAGE_VIEWER_ZOOM_LEVELS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]);
const DEFAULT_ZOOM_INDEX = 3;
const DRAG_GATE_PX = 3;
const COPIED_MS = 1500;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

export function ImageViewer({ container, ...props }: ImageViewerProps) {
  const pinned = usePinnedLayerRoot();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<Element | DocumentFragment | null>(container ?? pinned ?? null);
  const hasImages = props.images.length > 0;

  useEffect(() => {
    if (container || pinned) { setTarget(container ?? pinned); return; }
    // Resolve only once the anchor is rendered: a viewer mounted empty must still find its Space when images arrive.
    if (!hasImages) { setTarget(null); return; }
    setTarget(findLayerRoot(anchorRef.current) ?? (typeof document === 'undefined' ? null : document.body));
  }, [container, pinned, hasImages]);

  if (!hasImages) return null;
  // The anchor finds the Space's shadow root (findLayerRoot) before the viewer portals out of the flow.
  if (!target) return <span ref={anchorRef} hidden />;
  return createPortal(<ImageViewerPanel {...props} />, target);
}

function ImageViewerPanel({ images, initialIndex = 0, onClose, actions, onNotice, className }:
  Omit<ImageViewerProps, 'container'>) {
  const t = useT();
  const locale = useToolkitLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => clampIndex(initialIndex, images.length));
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const dragged = useRef(false);
  const closeRef = useLatest(onClose);
  const current = images[clampIndex(index, images.length)];
  const zoom = IMAGE_VIEWER_ZOOM_LEVELS[zoomIndex] ?? 1;
  const many = images.length > 1;

  const zoomIn = useCallback(() => setZoomIndex((i) => Math.min(i + 1, IMAGE_VIEWER_ZOOM_LEVELS.length - 1)), []);
  const zoomOut = useCallback(() => setZoomIndex((i) => Math.max(i - 1, 0)), []);
  const resetZoom = useCallback(() => { setZoomIndex(DEFAULT_ZOOM_INDEX); setTranslate({ x: 0, y: 0 }); }, []);
  const previous = useCallback(() => setIndex((i) => clampIndex(i - 1, images.length)), [images.length]);
  const next = useCallback(() => setIndex((i) => clampIndex(i + 1, images.length)), [images.length]);

  useEffect(() => { setIndex((i) => clampIndex(i, images.length)); }, [images.length]);
  useEffect(() => { resetZoom(); setCopied(false); }, [index, resetZoom]);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // Escape closes through the toolkit chain; the window listener covers a page without a keyboard engine.
  useEscapeLayer('image-viewer', () => { closeRef.current(); return true; }, { priority: ESCAPE_PRIORITY.overlay });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        if (event.defaultPrevented || event.repeat) return;
        event.preventDefault();
        closeRef.current();
      } else if (event.key === '+' || event.key === '=') zoomIn();
      else if (event.key === '-') zoomOut();
      else if (event.key === '0') resetZoom();
      else if (many && event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
      else if (many && event.key === 'ArrowRight') { event.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeRef, many, next, previous, resetZoom, zoomIn, zoomOut]);

  // Focus moves in, and back to where it was on close.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const previousFocus = deepActiveElement(panel.ownerDocument) as HTMLElement | null;
    panel.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) { event.preventDefault(); panel.focus(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = deepActiveElement(panel.getRootNode() as Document | ShadowRoot);
    if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  const download = async () => {
    if (!current) return;
    try {
      const response = await fetch(current.src);
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = current.alt || 'image';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      onNotice?.('error', t(GALLERY_WORDS.downloadFailed));
      window.open(current.src, '_blank', 'noopener');
    }
  };

  const copyLink = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.src);
      setCopied(true);
      onNotice?.('success', t(GALLERY_WORDS.linkCopied));
    } catch {
      onNotice?.('error', t(GALLERY_WORDS.copyFailed));
    }
  };

  const onMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    dragged.current = false;
    setDragging(true);
    dragStart.current = { x: event.clientX, y: event.clientY, tx: translate.x, ty: translate.y };
  };
  const onMouseMove = (event: ReactMouseEvent) => {
    if (!dragging) return;
    const dx = event.clientX - dragStart.current.x;
    const dy = event.clientY - dragStart.current.y;
    if (Math.abs(dx) > DRAG_GATE_PX || Math.abs(dy) > DRAG_GATE_PX) dragged.current = true;
    setTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
  };
  const stopDrag = () => setDragging(false);
  const onWheel = (event: ReactWheelEvent) => {
    if (event.deltaY < 0) zoomIn();
    else if (event.deltaY > 0) zoomOut();
  };

  if (!current) return null;
  const position = clampIndex(index, images.length);

  return (
    <div
      ref={panelRef}
      className={cx('nui-root nui-viewer', className)}
      role="dialog"
      aria-modal="true"
      aria-label={t(GALLERY_WORDS.viewer)}
      tabIndex={-1}
      lang={locale}
      data-notis-escape-owned=""
      onKeyDown={trapTab}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <div
        className={cx('nui-viewer-stage', dragging && 'nui-viewer-dragging')}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onWheel={onWheel}
        onClick={(event) => { if (event.target === event.currentTarget && !dragged.current) onClose(); }}
      >
        {many && (
          <>
            <button type="button" className="nui-viewer-nav nui-viewer-prev" onMouseDown={(e) => e.stopPropagation()}
              onClick={previous} disabled={position === 0} title={t(GALLERY_WORDS.previousHint)}
              aria-label={t(GALLERY_WORDS.previous)}>
              <Icon name="caret-left" />
            </button>
            <button type="button" className="nui-viewer-nav nui-viewer-next" onMouseDown={(e) => e.stopPropagation()}
              onClick={next} disabled={position === images.length - 1} title={t(GALLERY_WORDS.nextHint)}
              aria-label={t(GALLERY_WORDS.next)}>
              <Icon name="caret-right" />
            </button>
          </>
        )}
        <img
          className="nui-viewer-image"
          src={current.src}
          alt={current.alt || ''}
          draggable={false}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${zoom})`,
            transition: dragging ? 'none' : undefined,
          }}
        />
      </div>

      <div className="nui-viewer-bar">
        {actions?.(current, position)}
        <button type="button" className="nui-viewer-btn" onClick={zoomOut} disabled={zoomIndex === 0}
          title={t(GALLERY_WORDS.zoomOutHint)} aria-label={t(GALLERY_WORDS.zoomOut)}>
          <Icon name="magnifying-glass-minus" />
        </button>
        <button type="button" className="nui-viewer-btn nui-viewer-zoom" onClick={resetZoom}
          title={t(GALLERY_WORDS.resetZoom)}>
          {zoomIndex === DEFAULT_ZOOM_INDEX ? t(GALLERY_WORDS.fit) : `${Math.round(zoom * 100)}%`}
        </button>
        {many && (
          <span className="nui-viewer-count" aria-live="polite">
            {t(fillWords(GALLERY_WORDS.counter, { index: position + 1, count: images.length }))}
          </span>
        )}
        <button type="button" className="nui-viewer-btn" onClick={zoomIn}
          disabled={zoomIndex === IMAGE_VIEWER_ZOOM_LEVELS.length - 1}
          title={t(GALLERY_WORDS.zoomInHint)} aria-label={t(GALLERY_WORDS.zoomIn)}>
          <Icon name="magnifying-glass-plus" />
        </button>
        <span className="nui-viewer-sep" aria-hidden="true" />
        <button type="button" className="nui-viewer-btn" onClick={() => void download()}
          title={t(GALLERY_WORDS.download)} aria-label={t(GALLERY_WORDS.download)}>
          <Icon name="download-simple" />
        </button>
        <button type="button" className="nui-viewer-btn" onClick={() => void copyLink()}
          title={t(copied ? GALLERY_WORDS.linkCopied : GALLERY_WORDS.copyLink)}
          aria-label={t(copied ? GALLERY_WORDS.linkCopied : GALLERY_WORDS.copyLink)}>
          <Icon name={copied ? 'check' : 'link'} />
        </button>
        <span className="nui-viewer-sep" aria-hidden="true" />
        <button type="button" className="nui-viewer-btn" onClick={onClose}
          title={t(GALLERY_WORDS.closeHint)} aria-label={t(GALLERY_WORDS.close)}>
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}
