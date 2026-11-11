/**
 * A fictional fleet for the Meter and DataTable specimens: build machines with their memory, disk and uptime, and the
 * agent threads running on them, in both languages. Durations are in ms, relative to the fixed clock
 * (2026-06-15T09:30:00Z).
 */
import type { SpecimenCopy } from '../../specimen';

type Copy = SpecimenCopy<string>;

const c = (en: string, fr: string): Copy => ({ en, fr });

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const FLEET_WORDS = {
  machines: c('Machines', 'Machines'),
  threads: c('Threads', 'Fils'),
  name: c('Name', 'Nom'),
  region: c('Region', 'Région'),
  memory: c('Memory', 'Mémoire'),
  disk: c('Disk', 'Disque'),
  cpu: c('CPU', 'Processeur'),
  uptime: c('Uptime', 'Allumée depuis'),
  machine: c('Machine', 'Machine'),
  agent: c('Agent', 'Agent'),
  running: c('Running', 'En cours'),
  waiting: c('Waiting for you', 'En attente de toi'),
  done: c('Done today', 'Terminés aujourd’hui'),
  duration: c('Duration', 'Durée'),
  status: c('Status', 'Statut'),
  alertAt: c('Alert at {n}', 'Alerte à {n}'),
  noThreads: c('No threads on this machine', 'Aucun fil sur cette machine'),
  noThreadsBody: c('Threads show up here as soon as an agent starts one.', 'Les fils s’affichent ici dès qu’un agent en lance un.'),
  open: c('Open {name}', 'Ouvrir {name}'),
} as const;

export interface MachineFixture {
  id: string;
  name: string;
  region: string;
  online: boolean;
  /** GiB. */
  memoryUsed: number;
  memoryMax: number;
  /** GiB. */
  diskUsed: number;
  diskMax: number;
  /** Percent. */
  cpu: number;
  uptimeMs: number;
  threads: number;
  apps: Copy;
}

export const MACHINES: readonly MachineFixture[] = [
  {
    id: 'build-1', name: 'build-1', region: 'fra-1', online: true, memoryUsed: 8.2, memoryMax: 36, diskUsed: 212, diskMax: 500,
    cpu: 34, uptimeMs: 4 * DAY + 5 * HOUR + 12 * MIN, threads: 3, apps: c('3 threads, 2 dev stacks', '3 fils, 2 environnements de dev'),
  },
  {
    id: 'build-2', name: 'build-2', region: 'fra-1', online: true, memoryUsed: 31.4, memoryMax: 36, diskUsed: 455, diskMax: 500,
    cpu: 88, uptimeMs: 1 * HOUR + 31 * MIN, threads: 5, apps: c('5 threads, 4 dev stacks', '5 fils, 4 environnements de dev'),
  },
  {
    id: 'preview-eu-west-long-hostname', name: 'preview-eu-west-long-hostname', region: 'par-2', online: true,
    memoryUsed: 2.6, memoryMax: 16, diskUsed: 40, diskMax: 250, cpu: 6, uptimeMs: 7 * MIN, threads: 1,
    apps: c('1 thread', '1 fil'),
  },
  {
    id: 'mac-mini', name: 'mac-mini', region: 'local', online: false, memoryUsed: 0, memoryMax: 24, diskUsed: 301, diskMax: 1000,
    cpu: 0, uptimeMs: 0, threads: 0, apps: c('Asleep', 'En veille'),
  },
];

export type ThreadStatus = 'running' | 'waiting' | 'done';

export interface ThreadFixture {
  id: string;
  title: Copy;
  machine: string;
  agent: string;
  status: ThreadStatus;
  durationMs: number;
}

export const THREADS: readonly ThreadFixture[] = [
  { id: 't-3482', title: c('Fix the stalled calendar sync', 'Réparer la synchronisation du calendrier bloquée'), machine: 'build-1', agent: 'claude', status: 'running', durationMs: 18 * MIN + 40_000 },
  { id: 't-3479', title: c('Move the invoice export to the new storage bucket', 'Déplacer l’export des factures vers le nouveau stockage'), machine: 'build-2', agent: 'codex', status: 'running', durationMs: 1 * HOUR + 31 * MIN },
  { id: 't-3477', title: c('Write the release notes for June', 'Rédiger les notes de version de juin'), machine: 'build-2', agent: 'claude', status: 'running', durationMs: 45_000 },
  { id: 't-3470', title: c('Review the onboarding emails', 'Relire les e-mails d’accueil'), machine: 'build-1', agent: 'claude', status: 'waiting', durationMs: 2 * HOUR + 4 * MIN },
  { id: 't-3466', title: c('Upgrade the chart library', 'Mettre à jour la bibliothèque de graphiques'), machine: 'preview-eu-west-long-hostname', agent: 'codex', status: 'done', durationMs: 4 * DAY + 5 * HOUR },
  { id: 't-3461', title: c('Clean up old preview machines', 'Nettoyer les anciennes machines d’aperçu'), machine: 'build-1', agent: 'codex', status: 'done', durationMs: 7 * MIN },
];

export const THREAD_GROUPS: readonly { key: ThreadStatus; label: Copy }[] = [
  { key: 'running', label: FLEET_WORDS.running },
  { key: 'waiting', label: FLEET_WORDS.waiting },
  { key: 'done', label: FLEET_WORDS.done },
];
