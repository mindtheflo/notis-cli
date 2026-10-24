/** EN/FR words of the second-screen presenter: the audience window and what the presenter is told. */

import type { Words } from '../../words';

export const PRESENT_WORDS = Object.freeze({
  audienceTitle: { en: 'Presentation', fr: 'Présentation' },
  fillScreen: { en: 'Click to fill this screen', fr: 'Clique pour remplir cet écran' },
  dragToScreen: {
    en: 'Drag this window to the other screen, then click to fill it',
    fr: 'Fais glisser cette fenêtre sur l’autre écran, puis clique pour la remplir',
  },
  pressAgain: {
    en: 'Press Present again to show it on the other screen',
    fr: 'Appuie de nouveau sur Présenter pour l’afficher sur l’autre écran',
  },
  blocked: {
    en: 'The presentation window was blocked. Allow pop-ups for Notis, then press Present again.',
    fr: 'La fenêtre de présentation a été bloquée. Autorise les fenêtres pop-up pour Notis, puis appuie de nouveau sur Présenter.',
  },
  onOtherScreen: { en: 'Showing on the other screen', fr: 'Affiché sur l’autre écran' },
}) satisfies Readonly<Record<string, Words>>;
