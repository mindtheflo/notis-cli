/** The board's own words (EN and FR). Move to, Open and the rest come from the action catalogue and the list. */

import { w, type Words } from '../../words';

export const BOARD_WORDS = Object.freeze({
  board: w('Board', 'Tableau'),
  moveLeft: w('Move to the column on the left', 'Déplacer vers la colonne de gauche'),
  moveRight: w('Move to the column on the right', 'Déplacer vers la colonne de droite'),
  emptyColumn: w('No items', 'Aucun élément'),
  moved: w('Moved to {column}.', 'Déplacé vers {column}.'),
}) satisfies Readonly<Record<string, Words>>;
