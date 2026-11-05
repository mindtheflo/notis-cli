/**
 * The words of the Cloud Computer hooks and `CloudComputerWaking`, in English and French. `{seconds}` is a wait in
 * seconds and `{price}` an hourly price already formatted for the reader's language.
 */

import { NNBSP, fillWords, w, type Locale, type Words } from './words';

export const CLOUD_COMPUTER_WORDS = Object.freeze({
  starting: w('Starting your Cloud Computer', 'Démarrage de ton Cloud Computer'),
  startingHint: w('This can take up to a minute the first time.', 'Ça peut prendre jusqu’à une minute la première fois.'),
  restoring: w('Your Cloud Computer is restoring its files', 'Ton Cloud Computer restaure ses fichiers'),
  restoringHint: w('It is bringing your files back after a pause. This can take a few minutes.',
    'Il récupère tes fichiers après une pause. Ça peut prendre quelques minutes.'),
  restoringTimedOut: w('It is still restoring its files. Try again in a few minutes.',
    'Il restaure encore ses fichiers. Réessaie dans quelques minutes.'),
  failedTitle: w('Your Cloud Computer could not start this', 'Ton Cloud Computer n’a pas pu lancer ça'),
  failedGeneric: w('Something went wrong while starting it.', 'Un problème est survenu au démarrage.'),
  timedOut: w('It did not start within {seconds} seconds.', `Il n’a pas démarré en {seconds}${NNBSP}secondes.`),
  noAnswer: w('Your Cloud Computer did not answer.', 'Ton Cloud Computer n’a pas répondu.'),
  retry: w('Try again', 'Réessayer'),
  approvalTitle: w('Allow this Space to use your Cloud Computer', 'Autorise ce Space à utiliser ton Cloud Computer'),
  approvalHint: w('Notis asks once for each version of this Space.', 'Notis te le demande une fois par version de ce Space.'),
  allow: w('Allow', 'Autoriser'),
  retryIn: w('Try again in {seconds} s', `Réessayer dans {seconds}${NNBSP}s`),
  priceInfo: w('What it costs', 'Ce que ça coûte'),
  price: w('About {price} per hour while it runs, from your credit.', 'Environ {price} par heure tant qu’il tourne, sur ton crédit.'),
  unavailable: w('This page needs the Cloud Computer in Notis. Open it in Notis to use it.',
    'Cette page a besoin du Cloud Computer dans Notis. Ouvre-la dans Notis pour l’utiliser.'),
  noGate: w('This service cannot be reached yet. Wait until it is ready.', 'Ce service n’est pas encore joignable. Attends qu’il soit prêt.'),
  notOffered: w('The Cloud Computer is not available in this Space.', 'Le Cloud Computer n’est pas disponible dans ce Space.'),
  frameTitle: w('Cloud Computer service', 'Service du Cloud Computer'),
  frameOpening: w('Opening it', 'Ouverture'),
  frameFailed: w('This service could not open here.', 'Ce service n’a pas pu s’ouvrir ici.'),
}) satisfies Readonly<Record<string, Words>>;

export type CloudComputerWordKey = keyof typeof CLOUD_COMPUTER_WORDS;

/** "$0.14" in English, "0,14 $" in French; three decimals under one cent. */
export function formatHourlyPrice(usd: number, locale: Locale): string {
  const digits = usd > 0 && usd < 0.01 ? 3 : 2;
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(usd);
}

/** "About $0.14 per hour while it runs, from your credit." in both languages, or null when the price is unknown. */
export function cloudComputerPriceWords(hourlyUsd: number | null | undefined): Words | null {
  if (typeof hourlyUsd !== 'number' || !Number.isFinite(hourlyUsd) || hourlyUsd < 0) return null;
  return {
    en: fillWords(CLOUD_COMPUTER_WORDS.price, { price: formatHourlyPrice(hourlyUsd, 'en') }).en,
    fr: fillWords(CLOUD_COMPUTER_WORDS.price, { price: formatHourlyPrice(hourlyUsd, 'fr') }).fr,
  };
}
