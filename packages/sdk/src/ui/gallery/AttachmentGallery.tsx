/**
 * The attachment row of Notis conversations: 140px cards (image thumbnail or file icon, name, extension) in a
 * horizontal snap scroller with edge fades. Images open the ImageViewer on the gallery's images; other files open in
 * a new tab unless `onOpen` or `renderOpener` takes them.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fillWords, type Words } from '../../words';
import { renderIcon } from '../icons';
import { cx, useT } from '../util';
import { GALLERY_WORDS } from './galleryWords';
import { ImageViewer, type GalleryNoticeTone, type ImageViewerImage } from './ImageViewer';

export type GalleryItemKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';

export interface GalleryItem {
  url?: string | null;
  /** File name shown under the thumbnail. Default `file.<extension>`. */
  name?: string | null;
  /** MIME type, used to tell images from other files. */
  type?: string | null;
  /** Extension without the dot; shown as the badge. Default: taken from the name. */
  extension?: string | null;
  size?: number | null;
  /** Overrides the kind found from `type` and `extension`. */
  kind?: GalleryItemKind;
  /** The card icon for non-images: an icon name or a node. Default: by kind. */
  icon?: ReactNode | string;
  /** A smaller picture for the image card. Default: `url`. */
  thumbnailUrl?: string | null;
}

export interface GalleryOpenerProps {
  /** The card class; put it on the element that opens the item. */
  className: string;
  /** The card content (thumbnail, name, badge). */
  children: ReactNode;
  index: number;
}

export interface AttachmentGalleryProps<T extends GalleryItem = GalleryItem> {
  items: readonly T[];
  /** Accessible name of the row. Default "Attachments". */
  label?: Words | string;
  className?: string;
  /** Opens a non-image item. Default: its url in a new tab. */
  onOpen?: (item: T, index: number) => void;
  /** Renders a custom opener for an item (a preview pill); return undefined to keep the default button. */
  renderOpener?: (item: T, props: GalleryOpenerProps) => ReactNode | undefined;
  /** A small button in the card's top right corner (for example share). */
  itemAction?: (item: T, index: number) => ReactNode;
  /** Extra buttons in the image viewer's control bar. */
  viewerActions?: (image: ImageViewerImage, index: number) => ReactNode;
  /** Copy and download outcomes from the image viewer. */
  onNotice?: (tone: GalleryNoticeTone, text: string) => void;
}

const AUDIO_EXTENSIONS = ['webm', 'ogg', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'opus'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'mpeg'];

function extensionOf(item: GalleryItem): string {
  if (item.extension) return item.extension.replace(/^\./, '').toLowerCase();
  const name = item.name ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The kind of an attachment, from its MIME type and extension (a webm voice note is audio). */
export function galleryItemKind(item: GalleryItem): GalleryItemKind {
  if (item.kind) return item.kind;
  const type = (item.type ?? '').toLowerCase();
  const ext = extensionOf(item);
  if (type.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)) {
    return ext === 'webm' && type.startsWith('video/') ? 'video' : 'audio';
  }
  if (type.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (type.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (type.includes('pdf') || ext === 'pdf') return 'pdf';
  return 'file';
}

/** The name a card shows. */
export function galleryItemName(item: GalleryItem): string {
  return item.name || `file.${extensionOf(item) || 'bin'}`;
}

const KIND_ICON: Record<GalleryItemKind, string> = {
  image: 'file-image',
  video: 'file-video',
  audio: 'file-audio',
  pdf: 'file-text',
  file: 'file',
};

export function AttachmentGallery<T extends GalleryItem = GalleryItem>({
  items, label, className, onOpen, renderOpener, itemAction, viewerActions, onNotice,
}: AttachmentGalleryProps<T>) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ start: false, end: false });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const images = useMemo(() => items.reduce<Array<ImageViewerImage & { itemIndex: number }>>((list, item, itemIndex) => {
    if (galleryItemKind(item) === 'image' && item.url) list.push({ src: item.url, alt: galleryItemName(item), itemIndex });
    return list;
  }, []), [items]);
  const imageIndexOf = useMemo(() => new Map(images.map((image, i) => [image.itemIndex, i])), [images]);
  const viewerImages = useMemo(() => images.map(({ src, alt }) => ({ src, alt })), [images]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    // Keep the same state when nothing changed: a fresh object on every scroll or resize re-renders for nothing.
    const update = () => {
      const start = el.scrollLeft > 4;
      const end = el.scrollLeft < el.scrollWidth - el.clientWidth - 4;
      setFades((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [items.length]);

  if (!items.length) return null;

  const open = (item: T, index: number) => {
    const imageIndex = imageIndexOf.get(index);
    if (imageIndex !== undefined) { setViewerIndex(imageIndex); return; }
    if (onOpen) { onOpen(item, index); return; }
    if (item.url) window.open(item.url, '_blank', 'noopener');
  };

  return (
    <div className={cx('nui-root nui-gallery', className)}>
      <div ref={scrollRef} className="nui-gallery-row" role="list" aria-label={t(label ?? GALLERY_WORDS.attachments)}>
        {items.map((item, index) => {
          const kind = galleryItemKind(item);
          const name = galleryItemName(item);
          const ext = extensionOf(item).toUpperCase();
          const picture = kind === 'image' ? item.thumbnailUrl || item.url : null;
          const content = (
            <>
              {picture ? (
                <span className="nui-gallery-thumb"><img src={picture} alt={name} loading="lazy" /></span>
              ) : (
                <span className="nui-gallery-glyph">{renderIcon(item.icon ?? KIND_ICON[kind])}</span>
              )}
              <span className="nui-gallery-name" title={name}>{name}</span>
              {ext && <span className="nui-gallery-ext">{ext}</span>}
            </>
          );
          const custom = kind === 'image' ? undefined
            : renderOpener?.(item, { className: 'nui-gallery-card', children: content, index });
          const action = itemAction?.(item, index);
          return (
            <div key={item.url || index} className="nui-gallery-item" role="listitem">
              {custom ?? (
                <button type="button" className="nui-gallery-card" disabled={!item.url}
                  aria-label={t(fillWords(GALLERY_WORDS.open, { name }))} onClick={() => open(item, index)}>
                  {content}
                </button>
              )}
              {action && <span className="nui-gallery-action">{action}</span>}
            </div>
          );
        })}
      </div>
      {fades.start && <span className="nui-gallery-fade nui-gallery-fade-start" aria-hidden="true" />}
      {fades.end && <span className="nui-gallery-fade nui-gallery-fade-end" aria-hidden="true" />}
      {viewerIndex !== null && viewerImages.length > 0 && (
        <ImageViewer images={viewerImages} initialIndex={viewerIndex} onClose={() => setViewerIndex(null)}
          actions={viewerActions} onNotice={onNotice} />
      )}
    </div>
  );
}
