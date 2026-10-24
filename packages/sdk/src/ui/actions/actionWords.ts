/** The words and timing of the toast after an action (toolkit spec 2.7). */

import { fillWords, w, type Words } from '../../words';

/** How long a toast stays (the Manager's undo toast). An Undo that is running keeps it until it ends. */
export const ACTION_TOAST_MS = 6000;

export const ACTION_WORDS = Object.freeze({
  failed: w('That did not work. Try again.', 'Ça n’a pas marché. Réessaie.'),
  resultUnknown: w('We could not confirm the result. Check before trying again.',
    'Impossible de confirmer le résultat. Vérifie avant de réessayer.'),
  undone: w('Undone.', 'Annulé.'),
  undoing: w('Undoing…', 'Annulation…'),
  undoFailed: w('Could not undo that.', 'Impossible d’annuler.'),
  dismiss: w('Dismiss', 'Fermer'),
  failedOne: w('1 item could not be changed. It stays selected.',
    '1 élément n’a pas pu être modifié. Il reste sélectionné.'),
  failedMany: w('{n} items could not be changed. They stay selected.',
    '{n} éléments n’ont pas pu être modifiés. Ils restent sélectionnés.'),
}) satisfies Readonly<Record<string, Words>>;

/** The toast words after `n` items failed in a run that changed others. */
export function failedItemsWords(n: number): Words {
  return n === 1 ? ACTION_WORDS.failedOne : fillWords(ACTION_WORDS.failedMany, { n });
}
