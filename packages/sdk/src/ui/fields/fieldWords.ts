/** Words of the editable fields (EN/FR). Kept with the fields until they move into `src/words`. */

import type { Words } from '../../words';

export const FIELD_WORDS = Object.freeze({
  save: { en: 'Save', fr: 'Enregistrer' },
  saving: { en: 'Saving', fr: 'Enregistrement' },
  cancel: { en: 'Cancel', fr: 'Annuler' },
  unsaved: { en: 'Unsaved changes', fr: 'Modifications non enregistrées' },
  changed: { en: 'Changed', fr: 'Modifié' },
  empty: { en: 'Empty', fr: 'Vide' },
  choose: { en: 'Choose', fr: 'Choisir' },
  edit: { en: 'Change', fr: 'Changer' },
  done: { en: 'Done', fr: 'Terminé' },
  saveFailed: { en: 'Your changes were not saved. Try again.', fr: 'Tes modifications n’ont pas été enregistrées. Réessaie.' },
  /** A multi-select's search: the entry that adds the typed text, and the line when nothing matches it. */
  add: { en: 'Add "{text}"', fr: 'Ajouter "{text}"' },
  noMatch: { en: 'No match', fr: 'Aucun résultat' },
  addFailed: { en: 'Could not add "{text}". Try again.', fr: 'Impossible d’ajouter "{text}". Réessaie.' },
}) satisfies Readonly<Record<string, Words>>;
