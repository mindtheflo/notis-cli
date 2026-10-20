/**
 * Words of the period picker, calendar, timeline and charts (toolkit spec 2.11), EN and FR.
 * French uses tu, as everywhere in Notis. Pure: no React.
 */

import { w, type Words } from '../../words/types';
import type { CompareId, PresetId } from './periods';

export const PRESET_WORDS: Readonly<Record<PresetId, Words>> = Object.freeze({
  today: w('Today', 'Aujourd’hui'),
  yesterday: w('Yesterday', 'Hier'),
  last7: w('Last 7 days', '7 derniers jours'),
  last30: w('Last 30 days', '30 derniers jours'),
  last90: w('Last 90 days', '90 derniers jours'),
  thisMonth: w('This month', 'Ce mois-ci'),
  lastMonth: w('Last month', 'Le mois dernier'),
  thisQuarter: w('This quarter', 'Ce trimestre'),
  thisYear: w('This year', 'Cette année'),
  custom: w('Custom range', 'Période personnalisée'),
});

export const COMPARE_WORDS: Readonly<Record<CompareId, Words>> = Object.freeze({
  prev: w('Previous period', 'Période précédente'),
  year: w('Same period last year', 'Même période l’an dernier'),
  none: w('No comparison', 'Aucune comparaison'),
});

/** "vs ..." after a delta. The stat row drops the leading "vs " under the previous value. */
export const VS_WORDS: Readonly<Record<'prev' | 'year', Words>> = Object.freeze({
  prev: w('vs previous period', 'vs période précédente'),
  year: w('vs last year', 'vs l’an dernier'),
});

export const PERIOD_WORDS = Object.freeze({
  range: w('Date range', 'Période'),
  compare: w('Compare to', 'Comparer à'),
  apply: w('Apply', 'Appliquer'),
  cancel: w('Cancel', 'Annuler'),
  pickStart: w('Pick the first day', 'Choisis le premier jour'),
  pickEnd: w('Pick the last day', 'Choisis le dernier jour'),
  prevMonth: w('Previous month', 'Mois précédent'),
  nextMonth: w('Next month', 'Mois suivant'),
  thisPeriod: w('This period', 'Cette période'),
  value: w('Value', 'Valeur'),
  previous: w('Previous', 'Avant'),
});

export const CHART_WORDS = Object.freeze({
  tip: w('{v} on {d}', '{v} le {d}'),
  tipCompare: w('{v} on {d}, {c} before', '{v} le {d}, {c} avant'),
  label: w('{m}, {r}.', '{m}, {r}.'),
  date: w('Date', 'Date'),
  metric: w('Metric', 'Indicateur'),
  trend: w('Trend', 'Tendance'),
  change: w('Change', 'Évolution'),
  stats: w('Key figures', 'Chiffres clés'),
  noValue: w('No data', 'Aucune donnée'),
});

export const CALENDAR_WORDS = Object.freeze({
  month: w('Month', 'Mois'),
  week: w('Week', 'Semaine'),
  agenda: w('Agenda', 'Agenda'),
  view: w('Calendar range', 'Période du calendrier'),
  items: w('Items by date', 'Éléments par date'),
  today: w('Today', 'Aujourd’hui'),
  tomorrow: w('Tomorrow', 'Demain'),
  yesterday: w('Yesterday', 'Hier'),
  prevMonth: w('Previous month', 'Mois précédent'),
  nextMonth: w('Next month', 'Mois suivant'),
  prevWeek: w('Previous week', 'Semaine précédente'),
  nextWeek: w('Next week', 'Semaine suivante'),
  prevAgenda: w('Previous three weeks', 'Trois semaines précédentes'),
  nextAgenda: w('Next three weeks', 'Trois semaines suivantes'),
  agendaEmpty: w('Nothing planned in these three weeks.', 'Rien de prévu sur ces trois semaines.'),
  agendaToday: w('Nothing planned today', 'Rien de prévu aujourd’hui'),
  more: w('+{n} more', '+{n} autres'),
  less: w('Show less', 'Afficher moins'),
  /** The "+N" link of a narrow month cell, where the full words do not fit. */
  moreShort: w('+{n}', '+{n}'),
  /** "Show less" in a narrow month cell. */
  lessShort: w('Less', 'Moins'),
  noDate: w('No date', 'Sans date'),
  trayShow: w('Show items with no date', 'Afficher les éléments sans date'),
  trayHide: w('Hide items with no date', 'Masquer les éléments sans date'),
  keyToday: w('Go to today', 'Aller à aujourd’hui'),
  keyPrev: w('Previous month or week', 'Mois ou semaine d’avant'),
  keyNext: w('Next month or week', 'Mois ou semaine d’après'),
  keyNextItem: w('Next item', 'Élément suivant'),
  keyPrevItem: w('Previous item', 'Élément précédent'),
  keyNextDay: w('Next day with items', 'Jour suivant avec des éléments'),
  keyPrevDay: w('Previous day with items', 'Jour précédent avec des éléments'),
  keyOpen: w('Open', 'Ouvrir'),
});

export const TIMELINE_WORDS = Object.freeze({
  zoom: w('Zoom', 'Zoom'),
  week: w('Week', 'Semaine'),
  month: w('Month', 'Mois'),
  quarter: w('Quarter', 'Trimestre'),
  today: w('Today', 'Aujourd’hui'),
  items: w('Timeline', 'Frise'),
  empty: w('Nothing in this period.', 'Rien sur cette période.'),
  earlier: w('Earlier', 'Plus tôt'),
  later: w('Later', 'Plus tard'),
  bar: w('{t}, {s}, {a} to {b}', '{t}, {s}, du {a} au {b}'),
  barPlain: w('{t}, {a} to {b}', '{t}, du {a} au {b}'),
  keyToday: w('Go to today', 'Aller à aujourd’hui'),
  keyPrev: w('Earlier', 'Plus tôt'),
  keyNext: w('Later', 'Plus tard'),
  keyNextItem: w('Next item', 'Élément suivant'),
  keyPrevItem: w('Previous item', 'Élément précédent'),
  keyOpen: w('Open', 'Ouvrir'),
});
