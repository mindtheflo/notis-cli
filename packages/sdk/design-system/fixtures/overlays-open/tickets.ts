/**
 * Data for the overlay and open-mode specimens: the Product Space's Tickets list from the deck (NB-418 open in a
 * side peek), its people, and snooze times worked out from the book's fixed clock, Monday 15 June 2026 at 11:30 in
 * Paris (2026-06-15T09:30:00Z).
 */
import type { SpecimenCopy } from '../../specimen';

export const SPACE_NAME: SpecimenCopy = { en: 'Product', fr: 'Produit' };
export const TICKETS_LIST: SpecimenCopy = { en: 'Tickets', fr: 'Tickets' };
export const RELEASES_LIST: SpecimenCopy = { en: 'Releases', fr: 'Versions' };

export interface Person {
  initials: string;
  name: string;
}

export const PEOPLE: readonly Person[] = [
  { initials: 'FP', name: 'Flo Pariset' },
  { initials: 'AL', name: 'Alice Laurent' },
  { initials: 'MB', name: 'Marc Bernard' },
  { initials: 'CD', name: 'Chloé Dubois' },
];

export type TicketStatus = 'backlog' | 'todo' | 'active' | 'review' | 'done';

export interface Ticket {
  id: string;
  title: SpecimenCopy;
  status: TicketStatus;
  owner: string;
  priority: SpecimenCopy;
  labels: readonly string[];
  /** Days from the fixed clock. */
  updated: number;
}

export const NB_418: Ticket = {
  id: 'NB-418',
  title: {
    en: 'Sidebar flickers when a Space finishes loading',
    fr: 'La barre latérale clignote quand un Space finit de charger',
  },
  status: 'active',
  owner: 'FP',
  priority: { en: 'High', fr: 'Haute' },
  labels: ['portal', 'spaces'],
  updated: 0,
};

export const NB_417: Ticket = {
  id: 'NB-417',
  title: {
    en: 'Shortcut sheet lists keys the Space never uses',
    fr: 'La fiche des raccourcis liste des touches que le Space n’utilise pas',
  },
  status: 'todo',
  owner: 'AL',
  priority: { en: 'Medium', fr: 'Moyenne' },
  labels: ['keyboard'],
  updated: -1,
};

export const NB_416: Ticket = {
  id: 'NB-416',
  title: {
    en: 'Selection bar covers the last row on small screens',
    fr: 'La barre de sélection masque la dernière ligne sur petit écran',
  },
  status: 'review',
  owner: 'MB',
  priority: { en: 'Medium', fr: 'Moyenne' },
  labels: ['mobile'],
  updated: -2,
};

export const TICKETS: readonly Ticket[] = [NB_418, NB_417, NB_416];

/** An item of the Product Space's Releases list, for the open-mode states that keep one mode per list. */
export const RELEASE_2_14 = {
  id: 'v2.14',
  title: { en: 'Spaces for teams, beta', fr: 'Les Spaces pour les équipes, bêta' },
} as const satisfies { id: string; title: SpecimenCopy };

/** The status order of the Tickets list. */
export const TICKET_STATUSES: readonly TicketStatus[] = ['backlog', 'todo', 'active', 'review', 'done'];

/** Lists a ticket can move to, long in French on purpose. */
export const MOVE_TARGETS: readonly SpecimenCopy[] = [
  { en: 'Releases', fr: 'Versions' },
  { en: 'Design reviews', fr: 'Revues de design' },
  { en: 'Customer requests from the help centre', fr: 'Demandes des clients reçues par le centre d’aide' },
];

export interface SnoozeOption {
  id: string;
  label: SpecimenCopy;
  /** When it comes back, in Paris time. */
  when: SpecimenCopy;
}

/** Snooze times from Monday 15 June 2026, 11:30 in Paris. */
export const SNOOZE_OPTIONS: readonly SnoozeOption[] = [
  { id: 'today', label: { en: 'Later today', fr: 'Plus tard aujourd’hui' }, when: { en: '18:00', fr: '18:00' } },
  { id: 'tomorrow', label: { en: 'Tomorrow', fr: 'Demain' }, when: { en: 'Tue 16 Jun, 09:00', fr: 'mar. 16 juin, 09:00' } },
  { id: 'weekend', label: { en: 'This weekend', fr: 'Ce week-end' }, when: { en: 'Sat 20 Jun, 09:00', fr: 'sam. 20 juin, 09:00' } },
  { id: 'next-week', label: { en: 'Next week', fr: 'La semaine prochaine' }, when: { en: 'Mon 22 Jun, 09:00', fr: 'lun. 22 juin, 09:00' } },
];

/** Copy used by more than one specimen of the group. */
export const OVERLAY_COPY = {
  updatedToday: { en: 'Updated today', fr: 'Mis à jour aujourd’hui' },
  snoozeTitle: { en: 'Snooze until', fr: 'Reporter jusqu’à' },
  pickDate: { en: 'Pick a date and time', fr: 'Choisir une date et une heure' },
  renameView: { en: 'Rename view', fr: 'Renommer la vue' },
  viewName: { en: 'View name', fr: 'Nom de la vue' },
  viewNameValue: { en: 'Open tickets this week', fr: 'Tickets ouverts cette semaine' },
  viewNameHint: { en: 'Everyone in the Space sees this name.', fr: 'Tout le monde dans le Space voit ce nom.' },
  status: { en: 'Status', fr: 'Statut' },
  assignee: { en: 'Assignee', fr: 'Responsable' },
  moveTo: { en: 'Move to', fr: 'Déplacer vers' },
} satisfies Record<string, SpecimenCopy>;

/** Storage keys for the open-mode states. Frames share one localStorage, so every state keeps its own key. */
export const OPEN_MODE_KEYS = {
  tickets: 'space-product:tickets-specimen',
  releases: 'space-product:releases-specimen',
  pending: 'space-product:pending-specimen',
  failed: 'space-product:failed-specimen',
} as const;
