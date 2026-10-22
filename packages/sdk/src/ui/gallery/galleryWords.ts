/** EN/FR words of the attachment gallery and the image viewer. */

import type { Words } from '../../words';

export const GALLERY_WORDS = Object.freeze({
  attachments: { en: 'Attachments', fr: 'Pièces jointes' },
  open: { en: 'Open {name}', fr: 'Ouvrir {name}' },
  scrollBack: { en: 'Show earlier files', fr: 'Voir les fichiers précédents' },
  scrollForward: { en: 'Show more files', fr: 'Voir plus de fichiers' },
  viewer: { en: 'Image viewer', fr: 'Visionneuse d’images' },
  previous: { en: 'Previous image', fr: 'Image précédente' },
  previousHint: { en: 'Previous image (Left arrow)', fr: 'Image précédente (flèche gauche)' },
  next: { en: 'Next image', fr: 'Image suivante' },
  nextHint: { en: 'Next image (Right arrow)', fr: 'Image suivante (flèche droite)' },
  counter: { en: '{index} / {count}', fr: '{index} / {count}' },
  zoomIn: { en: 'Zoom in', fr: 'Zoom avant' },
  zoomInHint: { en: 'Zoom in (+)', fr: 'Zoom avant (+)' },
  zoomOut: { en: 'Zoom out', fr: 'Zoom arrière' },
  zoomOutHint: { en: 'Zoom out (-)', fr: 'Zoom arrière (-)' },
  resetZoom: { en: 'Reset zoom to fit (0)', fr: 'Ajuster à l’écran (0)' },
  fit: { en: 'Fit', fr: 'Ajuster' },
  download: { en: 'Download', fr: 'Télécharger' },
  copyLink: { en: 'Copy link', fr: 'Copier le lien' },
  linkCopied: { en: 'Link copied', fr: 'Lien copié' },
  copyFailed: { en: 'Failed to copy link', fr: 'Impossible de copier le lien' },
  downloadFailed: { en: 'Failed to download image', fr: 'Impossible de télécharger l’image' },
  close: { en: 'Close', fr: 'Fermer' },
  closeHint: { en: 'Close (Esc)', fr: 'Fermer (Échap)' },
}) satisfies Readonly<Record<string, Words>>;
