/** Shared bilingual copy for specimens. French strings run at least 30 percent longer than English. */
import type { SpecimenCopy, SpecimenLang } from '../specimen';

export const LONG_TITLE: SpecimenCopy = {
  en: 'Quarterly planning review with the whole product and design team',
  fr: "Revue trimestrielle de la planification avec l’ensemble des équipes produit, design et ingénierie",
};

export const LONG_TEXT: SpecimenCopy = {
  en: 'This note is long on purpose so the layout shows how a component wraps, truncates or grows when the text does not fit on one line.',
  fr: "Cette note est volontairement longue afin que la mise en page montre comment un composant passe à la ligne, tronque le texte ou s’agrandit lorsque le contenu ne tient pas sur une seule ligne de l’écran.",
};

export const SHORT_COPY = {
  save: { en: 'Save', fr: 'Enregistrer' },
  cancel: { en: 'Cancel', fr: 'Annuler' },
  delete: { en: 'Delete', fr: 'Supprimer' },
  archive: { en: 'Archive', fr: 'Archiver' },
  share: { en: 'Share', fr: 'Partager' },
  open: { en: 'Open', fr: 'Ouvrir' },
  rename: { en: 'Rename', fr: 'Renommer' },
  duplicate: { en: 'Duplicate', fr: 'Dupliquer' },
  empty: { en: 'Nothing here yet', fr: "Il n’y a encore rien ici" },
  loading: { en: 'Loading', fr: 'Chargement en cours' },
  failed: { en: 'Could not load this view', fr: "Impossible de charger cette vue pour le moment" },
} satisfies Record<string, SpecimenCopy>;

/** Picks one language of a copy table. */
export function pick<T>(copy: SpecimenCopy<T>, lang: SpecimenLang): T {
  return copy[lang];
}
