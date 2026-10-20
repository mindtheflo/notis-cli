/**
 * Fields group fixtures: the "Weekly digest" automation as the Automations reader shows it, the first task of the
 * shared task fixtures as a read-only sheet, and the option lists their selects offer. Copy comes from the Portal's
 * own message catalogues (automations, pages) in English and French; dates are relative to the fixed clock.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { FieldOption } from '../../../src/ui';
import type { Words } from '../../../src/words';
import type { SpecimenLang } from '../../specimen';
import { fromNow } from '../time';

type Copy = Words;

// ---- layout helpers (no decoration: page background, no border) ----

/** A reader-like column: the width a form gets in the Notis reader pane. The frame's state root already pads 24px. */
export function Pane({ children, width = 560 }: { children: ReactNode; width?: number }) {
  return (
    <div style={{ boxSizing: 'border-box', width: '100%', maxWidth: width, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {children}
    </div>
  );
}

/** A one-line caption above a sample, muted, so a state that shows several samples says which is which. */
export function Caption({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted-foreground">{children}</div>;
}

const MARK_STYLE: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 16, height: 16,
  borderRadius: 4, background: 'hsl(var(--foreground) / .08)', color: 'hsl(var(--foreground))', fontSize: 9,
  fontWeight: 600, lineHeight: 1, letterSpacing: 0,
};

/** A small letter mark standing in for a channel or agent logo (the Portal passes its own logo nodes). */
export function Mark({ text }: { text: string }) {
  return <span aria-hidden="true" style={MARK_STYLE}>{text}</span>;
}

// ---- row labels (Portal: AutomationsPage.list.reader and friends) ----

export const LABELS = {
  form: { en: 'Automation', fr: 'Automatisation' },
  name: { en: 'Name', fr: 'Nom' },
  status: { en: 'Status', fr: 'Statut' },
  trigger: { en: 'Trigger', fr: 'Déclencheur' },
  when: { en: 'When', fr: 'Quand' },
  nextRun: { en: 'Next run', fr: 'Prochaine exécution' },
  runsOn: { en: 'Runs on', fr: 'Tourne sur' },
  intelligence: { en: 'Intelligence', fr: 'Intelligence' },
  keepContext: { en: 'Keep context', fr: 'Garder le contexte' },
  sendsTo: { en: 'Sends to', fr: 'Envoie sur' },
  instructions: { en: 'Instructions', fr: 'Instructions' },
  description: { en: 'Description', fr: 'Description' },
  repeats: { en: 'Repeats', fr: 'Répétition' },
  at: { en: 'At', fr: 'À' },
  cron: { en: 'Cron expression', fr: 'Expression cron' },
  labels: { en: 'Labels', fr: 'Étiquettes' },
  priority: { en: 'Priority', fr: 'Priorité' },
  due: { en: 'Due', fr: 'Échéance' },
  estimate: { en: 'Estimate', fr: 'Estimation' },
  notes: { en: 'Notes', fr: 'Notes' },
  task: { en: 'Task', fr: 'Tâche' },
} satisfies Record<string, Copy>;

// ---- the automation ----

export const AUTOMATION_NAME: Copy = { en: 'Weekly digest', fr: 'Résumé hebdomadaire' };
export const AUTOMATION_NAME_EDITED: Copy = { en: 'Monday digest', fr: 'Résumé du lundi' };
export const UNTITLED: Copy = { en: 'Untitled automation', fr: 'Automatisation sans titre' };
export const STATUS_ON: Copy = { en: 'On', fr: 'Activée' };
export const SCHEDULE_SUMMARY: Copy = { en: 'Every Monday at 09:00', fr: 'Chaque lundi à 09:00' };
export const SCHEDULE_CRON = '0 9 * * 1';
/** A day of week that does not exist: what the cron builder rejects. */
export const SCHEDULE_CRON_INVALID = '0 9 * * 8';
export const CRON_INVALID: Copy = { en: 'Invalid expression', fr: 'Expression invalide' };
export const CRON_FORMAT_ERROR: Copy = { en: 'Invalid cron expression format', fr: 'Format d’expression cron invalide' };
export const TIMEZONE: Copy = { en: 'Timezone: Europe/Paris', fr: 'Fuseau horaire : Europe/Paris' };
export const CHANNEL_PLACEHOLDER: Copy = { en: 'Select channel', fr: 'Choisis un canal' };
export const NEEDS_ONE_AGENT: Copy = { en: 'It needs at least one agent.', fr: 'Il faut au moins un agent.' };
export const KEEP_LOCKED_HINT: Copy = {
  en: 'Always on: this channel continues on the same thread',
  fr: 'Toujours activé : ce canal continue sur le même fil',
};
export const UPGRADE_NOTE: Copy = {
  en: 'Customizing automation intelligence is a Pro+ feature.',
  fr: 'Personnaliser l’intelligence des automatisations est une fonctionnalité Pro+.',
};
export const DESCRIPTION_PLACEHOLDER: Copy = {
  en: 'Brief description of what this template does...',
  fr: 'Décris en quelques mots ce que fait ce modèle...',
};
export const INSTRUCTIONS: Copy = {
  en: 'Every Monday, read my unread newsletters and the Product channel, then send me the five things worth knowing this week with a link to each source.',
  fr: 'Chaque lundi, lis mes newsletters non lues et le canal Produit, puis envoie-moi les cinq choses à retenir cette semaine, avec un lien vers chaque source et une phrase qui explique pourquoi c’est important.',
};
export const NO_INSTRUCTIONS: Copy = { en: 'No instructions yet.', fr: 'Pas encore d’instructions.' };

/** The next run: Monday 22 June 2026 at 09:00 in Paris, a week after the fixed clock. */
export function nextRunText(lang: SpecimenLang): string {
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  }).format(fromNow(7, -2.5));
}

export type TriggerKind = 'schedule' | 'once' | 'integration' | 'webhook' | 'database';
export const TRIGGER_OPTIONS: readonly FieldOption<TriggerKind>[] = [
  { value: 'schedule', label: { en: 'Schedule', fr: 'Horaire' }, icon: 'clock' },
  { value: 'once', label: { en: 'One time', fr: 'Une fois' }, icon: 'hourglass' },
  { value: 'integration', label: { en: 'App event', fr: 'Événement d’une app' }, icon: 'arrows-clockwise' },
  { value: 'webhook', label: { en: 'Webhook', fr: 'Webhook' }, icon: 'arrow-bend-up-right' },
  { value: 'database', label: { en: 'Database', fr: 'Base de données' }, icon: 'archive' },
];

export type RepeatKind = 'day' | 'week' | 'month';
export const REPEAT_OPTIONS: readonly FieldOption<RepeatKind>[] = [
  { value: 'day', label: { en: 'Every day', fr: 'Chaque jour' } },
  { value: 'week', label: { en: 'Every week', fr: 'Chaque semaine' } },
  { value: 'month', label: { en: 'Every month', fr: 'Chaque mois' } },
];

export type IntelligenceChoice = 'auto' | 'low' | 'medium' | 'high';
export const INTELLIGENCE_HINTS: Record<IntelligenceChoice, Copy> = {
  auto: { en: 'Notis picks for each run', fr: 'Notis choisit à chaque exécution' },
  low: { en: 'Lower cost', fr: 'Coût réduit' },
  medium: { en: 'Balanced', fr: 'Équilibré' },
  high: { en: 'Higher cost', fr: 'Coût plus élevé' },
};
/** Auto, then Low, Medium and High, which need priority access (disabled without it). */
export function intelligenceOptions(priorityAccess = true): FieldOption<IntelligenceChoice>[] {
  return [
    { value: 'auto', label: { en: 'Auto', fr: 'Auto' }, hint: INTELLIGENCE_HINTS.auto },
    { value: 'low', label: { en: 'Low', fr: 'Faible' }, hint: INTELLIGENCE_HINTS.low, disabled: !priorityAccess },
    { value: 'medium', label: { en: 'Medium', fr: 'Moyen' }, hint: INTELLIGENCE_HINTS.medium, disabled: !priorityAccess },
    { value: 'high', label: { en: 'High', fr: 'Élevé' }, hint: INTELLIGENCE_HINTS.high, disabled: !priorityAccess },
  ];
}

export type KeepChoice = 'on' | 'off';
export const KEEP_HINTS: Record<KeepChoice, Copy> = {
  on: { en: 'Remembers earlier runs', fr: 'Se souvient des exécutions précédentes' },
  off: { en: 'Each run starts fresh', fr: 'Chaque exécution repart de zéro' },
};
export const KEEP_OPTIONS: readonly FieldOption<KeepChoice>[] = [
  { value: 'on', label: { en: 'On', fr: 'Activé' }, hint: KEEP_HINTS.on },
  { value: 'off', label: { en: 'Off', fr: 'Désactivé' }, hint: KEEP_HINTS.off },
];

export type ChannelId = 'email' | 'whatsapp' | 'slack' | 'telegram';
export const CHANNEL_OPTIONS: readonly FieldOption<ChannelId>[] = [
  { value: 'email', label: { en: 'Email', fr: 'E-mail' }, icon: <Mark text="@" /> },
  { value: 'whatsapp', label: { en: 'WhatsApp', fr: 'WhatsApp' }, icon: <Mark text="W" /> },
  { value: 'slack', label: { en: 'Slack', fr: 'Slack' }, icon: <Mark text="S" /> },
  { value: 'telegram', label: { en: 'Telegram', fr: 'Telegram' }, icon: <Mark text="T" /> },
];

export type AgentId = 'notis' | 'codex' | 'claude';
export const AGENT_OPTIONS: readonly FieldOption<AgentId>[] = [
  { value: 'notis', label: { en: 'Notis', fr: 'Notis' }, icon: <Mark text="N" /> },
  { value: 'codex', label: { en: 'Codex', fr: 'Codex' }, icon: <Mark text="Cx" /> },
  { value: 'claude', label: { en: 'Claude Code', fr: 'Claude Code' }, icon: <Mark text="Cl" /> },
];

/** Task labels, enough of them that the search box earns its place ("ete" finds "Été" in French). */
export type LabelId = 'design' | 'website' | 'operations' | 'newsletters' | 'product' | 'finance' | 'hiring' | 'customers' | 'summer';
export const LABEL_OPTIONS: readonly FieldOption<LabelId>[] = [
  { value: 'design', label: { en: 'Design', fr: 'Design' } },
  { value: 'website', label: { en: 'Website', fr: 'Site web' } },
  { value: 'operations', label: { en: 'Operations', fr: 'Opérations' } },
  { value: 'newsletters', label: { en: 'Newsletters', fr: 'Newsletters' } },
  { value: 'product', label: { en: 'Product', fr: 'Produit' } },
  { value: 'finance', label: { en: 'Finance', fr: 'Finance' } },
  { value: 'hiring', label: { en: 'Hiring', fr: 'Recrutement' } },
  { value: 'customers', label: { en: 'Customers', fr: 'Clients' } },
  { value: 'summer', label: { en: 'Summer launch', fr: 'Lancement de l’été' } },
];

// ---- the task sheet (the first task of fixtures/records.ts) ----

export type TaskStatus = 'todo' | 'doing' | 'done';
export const TASK_STATUS_OPTIONS: readonly FieldOption<TaskStatus>[] = [
  { value: 'todo', label: { en: 'To do', fr: 'À faire' }, icon: 'circle' },
  { value: 'doing', label: { en: 'In progress', fr: 'En cours' }, icon: 'circle-half' },
  { value: 'done', label: { en: 'Done', fr: 'Terminé' }, icon: 'check-circle-fill' },
];
export type TaskPriority = 'low' | 'medium' | 'high';
export const TASK_PRIORITY_OPTIONS: readonly FieldOption<TaskPriority>[] = [
  { value: 'low', label: { en: 'Low', fr: 'Basse' } },
  { value: 'medium', label: { en: 'Medium', fr: 'Moyenne' } },
  { value: 'high', label: { en: 'High', fr: 'Haute' } },
];
export const TASK_ESTIMATE: Copy = { en: '3 hours', fr: '3 heures' };
export const TASK_NOTES: Copy = {
  en: 'Draft with the new pricing, send to Camille for a read before Thursday.',
  fr: 'Rédiger avec les nouveaux tarifs, puis l’envoyer à Camille pour relecture avant jeudi.',
};

/** A date of the fixed clock's calendar as the reader writes it ("Tue 16 Jun 2026"). */
export function dayText(days: number, lang: SpecimenLang): string {
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris',
  }).format(fromNow(days));
}
