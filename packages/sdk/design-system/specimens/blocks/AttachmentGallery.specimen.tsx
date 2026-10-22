import { defineSpecimen } from '../../specimen';
import { AttachmentGallery, ImageViewer, type GalleryItem } from '../../../src/ui/index';
import { clickIn, settle } from '../../fixtures/lists/interact';

/** A flat picture as an inline SVG, so the frames never load from the network. */
function picture(fill: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">`
    + `<rect width="640" height="420" fill="${fill}"/>`
    + `<text x="320" y="222" font-family="sans-serif" font-size="40" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const MIXED: GalleryItem[] = [
  { url: picture('#5b7cfa', 'Moodboard'), name: 'moodboard.png', type: 'image/png' },
  { url: 'https://example.com/q3-review.pdf', name: 'Q3 review.pdf', type: 'application/pdf' },
  { url: 'https://example.com/launch.mp4', name: 'launch-teaser.mp4', type: 'video/mp4' },
  { url: 'https://example.com/pricing.csv', name: 'pricing-2026.csv', type: 'text/csv' },
];

const MANY: GalleryItem[] = [
  ...MIXED,
  { url: picture('#2f9e77', 'Cover'), name: 'cover-slide.jpg', type: 'image/jpeg' },
  { url: 'https://example.com/notes.docx', name: 'Speaker notes with a very long file name.docx' },
  { url: picture('#c2410c', 'Chart'), name: 'chart.webp', type: 'image/webp' },
];

const VIEWER_IMAGES = [
  { src: picture('#5b7cfa', 'Moodboard'), alt: 'moodboard.png' },
  { src: picture('#2f9e77', 'Cover'), alt: 'cover-slide.jpg' },
];

const frame = 'nui-root';

export const specimen = defineSpecimen({
  id: 'attachment-gallery',
  name: 'AttachmentGallery',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['AttachmentGallery', 'ImageViewer'],
  summary: 'The attachment row of conversations: file cards in a scroller; images open the image viewer.',
  states: [
    {
      id: 'mixed',
      label: 'An image, a PDF, a video and a spreadsheet',
      render: () => <div className={frame}><AttachmentGallery items={MIXED} /></div>,
    },
    {
      id: 'overflow',
      label: 'More files than fit: the row scrolls with an edge fade',
      render: () => <div className={frame} style={{ maxWidth: 520 }}><AttachmentGallery items={MANY} /></div>,
    },
    {
      id: 'narrow',
      label: 'Narrow (390px)',
      width: 390,
      render: () => <div className={frame}><AttachmentGallery items={MANY} /></div>,
    },
    {
      id: 'open-image',
      label: 'An image card opened: the viewer on the gallery images',
      height: 560,
      render: () => <div className={frame}><AttachmentGallery items={MANY} /></div>,
      interact: async (root) => {
        await clickIn(root, '.nui-gallery-card');
        await settle(4);
      },
    },
    {
      id: 'viewer',
      label: 'ImageViewer alone, on the second of two images',
      height: 560,
      render: () => <ImageViewer images={VIEWER_IMAGES} initialIndex={1} onClose={() => {}} />,
    },
  ],
});
