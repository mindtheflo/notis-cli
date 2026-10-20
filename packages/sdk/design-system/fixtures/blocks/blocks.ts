/**
 * Fixed Notis data for the Blocks and icons specimens: the Manager pages Flo validated in the deck (automations,
 * skills, integrations) in both languages. Times are written relative to the fixed clock (2026-06-15T09:30:00Z),
 * so "18 minutes ago" means 09:12 UTC that day.
 */
import type { SpecimenCopy } from '../../specimen';

type Copy = SpecimenCopy<string>;

const c = (en: string, fr: string): Copy => ({ en, fr });

/** The automation filters of the Automations page (deck slide mg-automations). */
export const AUTOMATION_FILTERS = [
  { value: 'all', label: c('All', 'Toutes'), count: 24 },
  { value: 'active', label: c('Active', 'Actives'), count: 18 },
  { value: 'paused', label: c('Paused', 'En pause'), count: 4 },
  { value: 'failed', label: c('Failed', 'En échec'), count: 2 },
] as const;

/** The skill filters of the Skills page (deck slide mg-skills). */
export const SKILL_FILTERS = [
  { value: 'all', label: c('All', 'Toutes'), count: 41 },
  { value: 'personal', label: c('Personal', 'Personnelles'), count: 12 },
  { value: 'spaces', label: c('From Spaces', 'Issues des Spaces'), count: 9 },
  { value: 'curated', label: c('Curated', 'Sélectionnées'), count: 15 },
  { value: 'community', label: c('Community', 'Communauté'), count: 5 },
  { value: 'archived', label: c('Archived', 'Archivées'), count: 0 },
] as const;

export interface AutomationFixture {
  id: string;
  name: Copy;
  schedule: Copy;
  enabled: boolean;
}

export const AUTOMATIONS: readonly AutomationFixture[] = [
  {
    id: 'morning-briefing',
    name: c('Morning briefing', 'Briefing du matin'),
    schedule: c('Every weekday at 08:00', 'Chaque jour de semaine à 08:00'),
    enabled: true,
  },
  {
    id: 'weekly-seo-report',
    name: c('Weekly SEO report', 'Rapport SEO hebdomadaire'),
    schedule: c('Mondays at 09:00', 'Le lundi à 09:00'),
    enabled: true,
  },
  {
    id: 'invoice-follow-up',
    name: c('Invoice follow-up', 'Relance des factures'),
    schedule: c('When an invoice is 7 days late', 'Quand une facture a 7 jours de retard'),
    enabled: false,
  },
];

export type IntegrationStatus = 'connected' | 'expiring' | 'expired' | 'off';

export interface IntegrationFixture {
  id: string;
  name: string;
  status: IntegrationStatus;
  detail: Copy;
}

export const INTEGRATIONS: readonly IntegrationFixture[] = [
  { id: 'gmail', name: 'Gmail', status: 'connected', detail: c('Synced 18 minutes ago', 'Synchronisé il y a 18 minutes') },
  {
    id: 'google-calendar', name: 'Google Calendar', status: 'connected',
    detail: c('Synced 2 minutes ago', 'Synchronisé il y a 2 minutes'),
  },
  { id: 'notion', name: 'Notion', status: 'expiring', detail: c('Sign-in expires on 18 June', 'La connexion expire le 18 juin') },
  { id: 'slack', name: 'Slack', status: 'expired', detail: c('Signed out on 12 June', 'Déconnecté le 12 juin') },
];

/** Badge words for each integration status, with the tone and icon the Integrations page uses. */
export const INTEGRATION_STATUS: Readonly<Record<IntegrationStatus, {
  label: Copy; tone: 'default' | 'success' | 'warning' | 'danger'; icon: string;
}>> = {
  connected: { label: c('Connected', 'Connecté'), tone: 'success', icon: 'check-circle-fill' },
  expiring: { label: c('Expires soon', 'Expire bientôt'), tone: 'warning', icon: 'clock-countdown' },
  expired: { label: c('Needs sign-in', 'Reconnexion nécessaire'), tone: 'danger', icon: 'x-circle-fill' },
  off: { label: c('Not connected', 'Non connecté'), tone: 'default', icon: 'circle-dashed' },
};

/** The week the metrics compare: 8 to 14 June against 1 to 7 June 2026. */
export const WEEK_METRICS = {
  runs: { label: c('Runs this week', 'Exécutions cette semaine'), current: 142, previous: 118 },
  automations: { label: c('Active automations', 'Automatisations actives'), current: 18, previous: 20 },
  duration: { label: c('Average run time', 'Durée moyenne'), current: 42, previous: 42 },
  credits: { label: c('Credits used', 'Crédits utilisés'), current: 3480, previous: 2950 },
  failures: { label: c('Failed runs', 'Exécutions en échec'), current: 3, previous: 7 },
} as const;

/**
 * Every icon name the toolkit draws, in the order of `packages/sdk/src/ui/icons.tsx`. The toolkit does not export
 * its list, so this one is kept by hand; the Icon specimen flags a name `hasIcon` no longer knows.
 */
export const ICON_NAMES = [
  'arrow-left', 'x', 'caret-up', 'caret-down', 'caret-right', 'caret-left', 'arrows-out', 'dots-three',
  'sidebar-simple', 'square-center', 'corners-out', 'check', 'archive', 'tray-arrow-up', 'star', 'clock',
  'arrow-bend-up-right', 'user-plus', 'envelope-open', 'envelope-simple', 'trash', 'circle-half',
  'circle-three-quarter', 'pause', 'play', 'toggle-right', 'toggle-left', 'hourglass', 'arrow-counter-clockwise',
  'arrow-clockwise', 'arrows-clockwise', 'plus', 'circle-dashed', 'circle', 'clock-countdown', 'check-circle-fill',
  'minus-circle', 'x-circle-fill',
] as const;
