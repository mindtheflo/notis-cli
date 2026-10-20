/**
 * The Tickets list of the Product Space, as Flo validated it in the deck (slide "Product / Tickets"). Data only, in
 * English and French, dated from the book's fixed clock (Monday 15 June 2026, 11:30 in Paris).
 */
import type { SpecimenCopy } from '../../specimen';
import { fromNow } from '../time';

export type TicketStatus = 'backlog' | 'todo' | 'active' | 'review' | 'waiting' | 'done' | 'cancelled';
export type TicketPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export interface Person {
  name: string;
  initials: string;
}

export interface Ticket {
  id: string;
  title: SpecimenCopy;
  status: TicketStatus;
  priority: TicketPriority;
  labels: readonly SpecimenCopy[];
  owner: Person;
  starred: boolean;
  /** Archived tickets show the Move to triage action instead of Archive. */
  archived: boolean;
  updated: Date;
  created: Date;
  description: SpecimenCopy;
}

export const PEOPLE = {
  flo: { name: 'Flo Pariset', initials: 'FP' },
  alice: { name: 'Alice Laurent', initials: 'AL' },
  marc: { name: 'Marc Bernard', initials: 'MB' },
  chloe: { name: 'Chloé Dubois', initials: 'CD' },
  sofia: { name: 'Sofia Reyes', initials: 'SR' },
  lucas: { name: 'Lucas Moreau', initials: 'LM' },
} satisfies Record<string, Person>;

export const LABELS = {
  portal: { en: 'Portal', fr: 'Portail' },
  spaces: { en: 'Spaces', fr: 'Spaces' },
  keyboard: { en: 'Keyboard', fr: 'Clavier' },
  sdk: { en: 'SDK', fr: 'SDK' },
  design: { en: 'Design', fr: 'Design' },
  french: { en: 'French', fr: 'Français' },
  phone: { en: 'Phone', fr: 'Mobile' },
} satisfies Record<string, SpecimenCopy>;

export const PRIORITY_WORDS: Readonly<Record<TicketPriority, SpecimenCopy>> = {
  urgent: { en: 'Urgent', fr: 'Urgente' },
  high: { en: 'High', fr: 'Haute' },
  medium: { en: 'Medium', fr: 'Moyenne' },
  low: { en: 'Low', fr: 'Basse' },
  none: { en: 'No priority', fr: 'Sans priorité' },
};

/** Minutes before the fixed clock. */
const minutesAgo = (minutes: number) => fromNow(0, -minutes / 60);

function ticket(input: Omit<Ticket, 'starred' | 'archived' | 'description'> & Partial<Pick<Ticket, 'starred' | 'archived' | 'description'>>): Ticket {
  return {
    starred: false,
    archived: false,
    description: {
      en: 'Seen on the Product Space after the last release. Steps and a screen recording are in the thread.',
      fr: 'Vu dans le Space Produit après la dernière mise en production. Les étapes et un enregistrement d’écran sont dans le fil.',
    },
    ...input,
  };
}

/** The 16 tickets of the deck's "All" tab, newest first. */
export const TICKETS: readonly Ticket[] = [
  ticket({
    id: 'NB-418', status: 'active', priority: 'high', owner: PEOPLE.flo, labels: [LABELS.portal, LABELS.spaces],
    title: { en: 'Sidebar flickers when a Space finishes loading', fr: 'La barre latérale clignote quand un Space finit de charger' },
    updated: minutesAgo(12), created: fromNow(-2, -3),
    description: {
      en: 'The sidebar redraws once the Space data arrives. Keep the frame on screen and swap only the content.',
      fr: 'La barre latérale se redessine à l’arrivée des données du Space. Garder le cadre à l’écran et ne changer que le contenu.',
    },
  }),
  ticket({
    id: 'NB-417', status: 'todo', priority: 'medium', owner: PEOPLE.alice, labels: [LABELS.keyboard, LABELS.sdk],
    title: { en: 'Shortcut sheet lists keys the Space never uses', fr: 'La liste des raccourcis affiche des touches que le Space n’utilise jamais' },
    updated: minutesAgo(45), created: fromNow(-4, -1),
    description: {
      en: 'The sheet shows every default key, even when the Space has no archive or star action. It should only list keys that do something here.',
      fr: 'La liste affiche toutes les touches par défaut, même quand le Space n’a ni archivage ni favori. Elle ne devrait montrer que les touches qui servent ici.',
    },
  }),
  ticket({
    id: 'NB-416', status: 'waiting', priority: 'medium', owner: PEOPLE.marc, labels: [LABELS.design, LABELS.sdk], starred: true,
    title: { en: 'Selection bar covers the last row', fr: 'La barre de sélection cache la dernière ligne' },
    updated: minutesAgo(120), created: fromNow(-5),
  }),
  ticket({
    id: 'NB-415', status: 'todo', priority: 'low', owner: PEOPLE.chloe, labels: [LABELS.french],
    title: { en: 'French dates show the English month', fr: 'Les dates en français affichent le mois en anglais' },
    updated: minutesAgo(180), created: fromNow(-6),
  }),
  ticket({
    id: 'NB-414', status: 'active', priority: 'high', owner: PEOPLE.flo, labels: [LABELS.spaces],
    title: { en: 'Reader loses its scroll position after archiving', fr: 'Le lecteur perd sa position de défilement après un archivage' },
    updated: minutesAgo(240), created: fromNow(-6, -2),
  }),
  ticket({
    id: 'NB-413', status: 'todo', priority: 'urgent', owner: PEOPLE.alice, labels: [LABELS.portal],
    title: { en: 'Chat panel resize jumps on Windows', fr: 'Le redimensionnement du panneau de discussion saute sous Windows' },
    updated: minutesAgo(300), created: fromNow(-7),
  }),
  ticket({
    id: 'NB-412', status: 'done', priority: 'low', owner: PEOPLE.marc, labels: [LABELS.design],
    title: { en: 'Board cards cut long titles', fr: 'Les cartes du tableau coupent les titres longs' },
    updated: fromNow(-1, -2), created: fromNow(-9),
  }),
  ticket({
    id: 'NB-411', status: 'waiting', priority: 'medium', owner: PEOPLE.flo, labels: [LABELS.keyboard], starred: true,
    title: { en: 'Escape clears the search before closing', fr: 'Échap vide la recherche avant de fermer le panneau' },
    updated: fromNow(-1, -5), created: fromNow(-10),
  }),
  ticket({
    id: 'NB-410', status: 'done', priority: 'low', owner: PEOPLE.chloe, labels: [LABELS.design],
    title: { en: 'Dark mode borders too strong in tables', fr: 'Les bordures du mode sombre sont trop marquées dans les tableaux' },
    updated: fromNow(-2, -1), created: fromNow(-12),
  }),
  ticket({
    id: 'NB-409', status: 'todo', priority: 'medium', owner: PEOPLE.alice, labels: [LABELS.sdk],
    title: { en: 'Add a Load all button to long lists', fr: 'Ajouter un bouton Tout charger aux longues listes' },
    updated: fromNow(-2, -4), created: fromNow(-13),
  }),
  ticket({
    id: 'NB-408', status: 'active', priority: 'medium', owner: PEOPLE.marc, labels: [LABELS.keyboard],
    title: { en: 'Keyboard cursor disappears after a refresh', fr: 'Le curseur clavier disparaît après une actualisation' },
    updated: fromNow(-3, -1), created: fromNow(-14),
  }),
  ticket({
    id: 'NB-407', status: 'todo', priority: 'high', owner: PEOPLE.chloe, labels: [LABELS.phone],
    title: { en: 'On phones, a long press opens the menu twice', fr: 'Sur mobile, un appui long ouvre le menu deux fois' },
    updated: fromNow(-3, -6), created: fromNow(-15),
  }),
  ticket({
    id: 'NB-406', status: 'done', priority: 'low', owner: PEOPLE.flo, labels: [LABELS.design, LABELS.sdk],
    title: { en: 'Empty state shows a grey box', fr: 'L’état vide affiche un rectangle gris' },
    updated: fromNow(-4, -2), created: fromNow(-16),
  }),
  ticket({
    id: 'NB-405', status: 'backlog', priority: 'none', owner: PEOPLE.alice, labels: [LABELS.keyboard],
    title: { en: 'Tooltip shows ⌘ on Windows', fr: 'L’infobulle affiche ⌘ sous Windows' },
    updated: fromNow(-5, -3), created: fromNow(-18),
  }),
  ticket({
    id: 'NB-404', status: 'review', priority: 'medium', owner: PEOPLE.sofia, labels: [LABELS.spaces, LABELS.french],
    title: { en: 'Space settings page in French', fr: 'Page des réglages du Space en français' },
    updated: fromNow(-6, -1), created: fromNow(-20),
  }),
  ticket({
    id: 'NB-388', status: 'cancelled', priority: 'none', owner: PEOPLE.lucas, labels: [LABELS.portal], archived: true,
    title: { en: 'Old theme picker keeps the last colour', fr: 'L’ancien sélecteur de thème garde la dernière couleur' },
    updated: new Date(Date.UTC(2025, 10, 28, 15, 10)), created: new Date(Date.UTC(2025, 10, 3, 9, 0)),
  }),
];

export const TICKETS_BY_ID: ReadonlyMap<string, Ticket> = new Map(TICKETS.map((entry) => [entry.id, entry]));

/** A ticket by id; throws on a typo so a broken fixture fails loudly. */
export function ticketById(id: string): Ticket {
  const found = TICKETS_BY_ID.get(id);
  if (!found) throw new Error(`No ticket ${id} in the lists fixtures`);
  return found;
}

/** The "Open" tab: everything not done or cancelled. */
export const OPEN_TICKETS: readonly Ticket[] = TICKETS.filter((entry) => entry.status !== 'done' && entry.status !== 'cancelled');

/** The "Mine" tab: Flo's tickets. */
export const MY_TICKETS: readonly Ticket[] = TICKETS.filter((entry) => entry.owner === PEOPLE.flo);

/** A ticket with a title long enough to wrap (French at least 30 percent longer). */
export const LONG_TICKET: Ticket = ticket({
  id: 'NB-419', status: 'review', priority: 'high', owner: PEOPLE.sofia, labels: [LABELS.spaces, LABELS.keyboard, LABELS.french],
  title: {
    en: 'Moving several tickets to another Space keeps the old Space in the breadcrumb until the page reloads',
    fr: 'Déplacer plusieurs tickets vers un autre Space laisse l’ancien Space dans le fil d’Ariane jusqu’au rechargement complet de la page',
  },
  updated: minutesAgo(3), created: fromNow(0, -1),
});

/** Group order of the Status grouping. */
export const STATUS_ORDER: readonly TicketStatus[] = ['active', 'review', 'waiting', 'todo', 'backlog', 'done', 'cancelled'];

/** The tickets sorted by status group, for `groupBy` (consecutive items share a heading). */
export const TICKETS_BY_STATUS: readonly Ticket[] = [...TICKETS].sort(
  (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
);

/** The Move to choices of the Product Space. */
export const MOVE_TARGETS: readonly { value: string; label: SpecimenCopy }[] = [
  { value: 'tickets', label: { en: 'Tickets', fr: 'Tickets' } },
  { value: 'roadmap', label: { en: 'Roadmap', fr: 'Feuille de route' } },
  { value: 'ideas', label: { en: 'Ideas', fr: 'Idées' } },
];

/** "45 min ago" style words for the reader's facts, from the fixed clock. */
export function agoWords(date: Date, now: number): SpecimenCopy {
  const minutes = Math.max(1, Math.round((now - date.getTime()) / 60000));
  if (minutes < 60) return { en: `${minutes} min ago`, fr: `il y a ${minutes} min` };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { en: `${hours} h ago`, fr: `il y a ${hours} h` };
  const days = Math.round(hours / 24);
  if (days < 60) return { en: days === 1 ? '1 day ago' : `${days} days ago`, fr: days === 1 ? 'il y a 1 jour' : `il y a ${days} jours` };
  const months = Math.round(days / 30);
  return { en: `${months} months ago`, fr: `il y a ${months} mois` };
}

/** The copy the list specimens share (French at least as long as the English, usually longer). */
export const LIST_COPY = {
  all: { en: 'All', fr: 'Tous' },
  open: { en: 'Open', fr: 'Ouverts' },
  mine: { en: 'Mine', fr: 'Les miens' },
  newTicket: { en: 'New ticket', fr: 'Nouveau ticket' },
  tickets: { en: 'Tickets', fr: 'Tickets' },
  status: { en: 'Status', fr: 'Statut' },
  priority: { en: 'Priority', fr: 'Priorité' },
  assignee: { en: 'Assignee', fr: 'Responsable' },
  labels: { en: 'Labels', fr: 'Étiquettes' },
  updated: { en: 'Updated', fr: 'Mis à jour' },
  created: { en: 'Created', fr: 'Créé' },
  description: { en: 'Description', fr: 'Description' },
  activity: { en: 'Activity', fr: 'Activité' },
  createdIt: { en: 'created it', fr: 'l’a créé' },
  ticket: { en: 'Ticket', fr: 'Ticket' },
  title: { en: 'Title', fr: 'Titre' },
  noTickets: { en: 'No open tickets', fr: 'Aucun ticket ouvert pour le moment' },
  noTicketsBody: {
    en: 'New bug reports from the Portal land here. Press C to add one by hand.',
    fr: 'Les nouveaux signalements de bugs venus du Portail arrivent ici. Appuie sur C pour en ajouter un à la main.',
  },
  loadFailed: { en: 'The tickets did not load.', fr: 'Les tickets n’ont pas pu être chargés pour le moment.' },
  pageOf: { en: '1 to 16 of 214', fr: '1 à 16 sur 214' },
  saving: { en: 'Saving the new status…', fr: 'Enregistrement du nouveau statut en cours…' },
  locked: { en: 'Locked by a release', fr: 'Verrouillé par une mise en production' },
  moved: { en: 'Moved to Roadmap.', fr: 'Déplacé vers la feuille de route.' },
  assigned: { en: 'Assigned.', fr: 'Responsable attribué.' },
  denied: {
    en: 'NB-405 is locked by the 2.14 release.',
    fr: 'NB-405 est verrouillé par la mise en production 2.14.',
  },
} satisfies Record<string, SpecimenCopy>;
