/**
 * Data for the layout and keyboard specimens: a Product Space's Tickets list, as the Panels list and its open item
 * show it. Times are relative to the book's fixed clock, Monday 15 June 2026 at 11:30 in Paris
 * (2026-06-15T09:30:00Z). People are named by their full name only; the copy says they/them.
 */
import type { SpecimenCopy } from '../../specimen';
import { fromNow } from '../time';

export type TicketTone = 'default' | 'info' | 'success' | 'warning' | 'danger';

export interface TicketLabel {
  label: SpecimenCopy;
  tone?: TicketTone;
}

export interface Ticket {
  id: string;
  /** The ticket key shown in the meta line. */
  key: string;
  title: SpecimenCopy;
  /** A Space status; Row maps it to a status group ('in_review' reads as Ready for review). */
  status: string;
  labels: readonly TicketLabel[];
  owner: string;
  updated: Date;
  /** The open item's paragraphs. */
  body: SpecimenCopy<readonly string[]>;
}

const KEYBOARD: TicketLabel = { label: { en: 'Keyboard', fr: 'Clavier' }, tone: 'info' };
const MOBILE: TicketLabel = { label: { en: 'Mobile', fr: 'Mobile' } };
const BUG: TicketLabel = { label: { en: 'Bug', fr: 'Bogue' }, tone: 'danger' };
const REMINDERS: TicketLabel = { label: { en: 'Reminders', fr: 'Rappels' } };
const LAYOUT: TicketLabel = { label: { en: 'Layout', fr: 'Mise en page' }, tone: 'success' };
const BLOCKED: TicketLabel = { label: { en: 'Blocked', fr: 'Bloqué' }, tone: 'warning' };

export const TICKETS: readonly Ticket[] = [
  {
    id: 'nb-1042',
    key: 'NB-1042',
    title: { en: 'Help sheet lists Space keys first', fr: 'La fiche d’aide liste d’abord les touches du Space' },
    status: 'done',
    labels: [KEYBOARD],
    owner: 'Camille Martin',
    updated: fromNow(0, -2),
    body: {
      en: [
        'Pressing ? now shows the keys of the open Space under This Space, then the Notis keys.',
        'Camille checked it on the Tickets and Calendar views; they found no key listed twice.',
      ],
      fr: [
        'La touche ? affiche maintenant les touches du Space ouvert sous Ce Space, puis les touches de Notis.',
        'Camille a vérifié sur les vues Tickets et Calendrier : aucune touche n’apparaît deux fois.',
      ],
    },
  },
  {
    id: 'nb-1051',
    key: 'NB-1051',
    title: {
      en: 'Calendar keeps the week when the reader opens',
      fr: 'Le calendrier garde la semaine quand le lecteur s’ouvre',
    },
    status: 'in_review',
    labels: [LAYOUT],
    owner: 'Hugo Lefèvre',
    updated: fromNow(-1, 3),
    body: {
      en: [
        'Opening an event beside the calendar used to jump back to the current week.',
        'Hugo kept the shown period in the view state; they ask for a check on a narrow window.',
      ],
      fr: [
        'Ouvrir un événement à côté du calendrier ramenait à la semaine en cours.',
        'Hugo garde la période affichée dans l’état de la vue et demande une vérification sur une fenêtre étroite.',
      ],
    },
  },
  {
    id: 'nb-1057',
    key: 'NB-1057',
    title: {
      en: 'Selection bar drops the count on phones',
      fr: 'La barre de sélection perd le nombre sur téléphone',
    },
    status: 'in_progress',
    labels: [MOBILE, BUG],
    owner: 'Inès Moreau',
    updated: fromNow(-2),
    body: {
      en: [
        'At 390 pixels the selection bar hides "3 selected" behind the actions.',
        'Inès is moving the actions into the more menu so the count always shows.',
      ],
      fr: [
        'À 390 pixels, la barre de sélection cache « 3 sélectionnés » derrière les actions.',
        'Inès déplace les actions dans le menu Plus pour que le nombre reste toujours visible.',
      ],
    },
  },
  {
    id: 'nb-1060',
    key: 'NB-1060',
    title: {
      en: 'Reminder sent twice after a time zone change',
      fr: 'Rappel envoyé deux fois après un changement de fuseau horaire',
    },
    status: 'todo',
    labels: [REMINDERS, BUG],
    owner: 'Sam Okafor',
    updated: fromNow(-4),
    body: {
      en: [
        'A person who moved from Paris to Montreal got their 9:00 reminder twice on the same day.',
        'Sam will reproduce it with a fixed clock before changing the schedule.',
      ],
      fr: [
        'Une personne passée de Paris à Montréal a reçu son rappel de 9 h deux fois le même jour.',
        'Sam va le reproduire avec une horloge fixe avant de modifier la planification.',
      ],
    },
  },
  {
    id: 'nb-1063',
    key: 'NB-1063',
    title: { en: 'Reader width survives a reload', fr: 'La largeur du lecteur survit au rechargement' },
    status: 'done',
    labels: [LAYOUT],
    owner: 'Camille Martin',
    updated: fromNow(-9),
    body: {
      en: ['The width chosen with the handle is kept per list, so each list opens the way it was left.'],
      fr: ['La largeur choisie avec la poignée est gardée pour chaque liste, qui s’ouvre donc comme on l’a laissée.'],
    },
  },
];

/** A ticket whose title and text run long, for wrapping and truncation. */
export const LONG_TICKET: Ticket = {
  id: 'nb-1066',
  key: 'NB-1066',
  title: {
    en: 'Spaces publish fails for accounts that still have a legacy app with the same name',
    fr: 'La publication d’un Space échoue pour les comptes qui possèdent encore une ancienne application portant exactement le même nom',
  },
  status: 'blocked',
  labels: [BLOCKED, BUG],
  owner: 'Hugo Lefèvre',
  updated: fromNow(-21),
  body: {
    en: [
      'Publishing a Space stops with a name conflict when the account still has a legacy app called the same thing. The person sees the error after the preview already passed, so they think the Space itself is broken.',
      'Hugo is waiting for the legacy app removal to land; until then the publish step should say which app is in the way and how to rename it.',
    ],
    fr: [
      'La publication d’un Space s’arrête sur un conflit de nom lorsque le compte possède encore une ancienne application portant exactement le même nom. La personne voit l’erreur alors que l’aperçu avait déjà réussi, et pense donc que le Space lui-même ne fonctionne plus.',
      'Hugo attend que la suppression des anciennes applications soit en ligne ; d’ici là, l’étape de publication devrait indiquer quelle application gêne et comment la renommer.',
    ],
  },
};

export const ALL_TICKETS: readonly Ticket[] = [...TICKETS, LONG_TICKET];

export const TICKETS_TITLE: SpecimenCopy = { en: 'Tickets', fr: 'Tickets' };
