/** Shell words shared by every toolkit piece (toolkit spec 2.7). French uses tu and a narrow no-break space before ":". */

import { fillWords, type Words } from './types';

export const SHELL_WORDS = Object.freeze({
  open: { en: 'Open', fr: 'Ouvrir' },
  back: { en: 'Back', fr: 'Retour' },
  close: { en: 'Close', fr: 'Fermer' },
  previous: { en: 'Previous', fr: 'Précédent' },
  next: { en: 'Next', fr: 'Suivant' },
  more: { en: 'More', fr: 'Plus' },
  clear: { en: 'Clear', fr: 'Effacer' },
  removeNamed: { en: 'Remove {name}', fr: 'Retirer {name}' },
  savingNamed: { en: 'Saving {name}', fr: 'Enregistrement de {name}' },
  clearSelection: { en: 'Clear selection', fr: 'Effacer la sélection' },
  undo: { en: 'Undo', fr: 'Annuler' },
  select: { en: 'Select', fr: 'Sélectionner' },
  selectAll: { en: 'Select all', fr: 'Tout sélectionner' },
  extendSelection: { en: 'Extend selection', fr: 'Étendre la sélection' },
  closeThenClear: { en: 'Close, then clear selection', fr: 'Fermer, puis effacer la sélection' },
  showShortcuts: { en: 'Show shortcuts', fr: 'Afficher les raccourcis' },
  search: { en: 'Search', fr: 'Rechercher' },
  tryAgain: { en: 'Try again', fr: 'Réessayer' },
  selectedOne: { en: '1 selected', fr: '1 sélectionné' },
  selectedMany: { en: '{n} selected', fr: '{n} sélectionnés' },
  sidePeek: { en: 'Side peek', fr: 'Aperçu latéral' },
  centerPeek: { en: 'Center peek', fr: 'Aperçu centré' },
  fullPage: { en: 'Full page', fr: 'Pleine page' },
  openAs: { en: 'Open as', fr: 'Ouvrir en' },
}) satisfies Readonly<Record<string, Words>>;

export type ShellWordId = keyof typeof SHELL_WORDS;

/** "1 selected" / "{n} selected", count filled in. */
export function selectedCount(n: number): Words {
  return n === 1 ? SHELL_WORDS.selectedOne : fillWords(SHELL_WORDS.selectedMany, { n });
}

/** Words of the keyboard help sheet and the engine (toolkit spec 2.1). */
export const HELP_WORDS = Object.freeze({
  title: { en: 'Keyboard shortcuts', fr: 'Raccourcis clavier' },
  groupSpace: { en: 'This Space', fr: 'Ce Space' },
  groupNotis: { en: 'Notis', fr: 'Notis' },
  close: { en: 'Close', fr: 'Fermer' },
  empty: { en: 'No shortcuts here.', fr: 'Aucun raccourci ici.' },
}) satisfies Readonly<Record<string, Words>>;
