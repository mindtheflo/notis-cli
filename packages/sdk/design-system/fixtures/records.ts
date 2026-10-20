/** Fixture databases and records used by the fake runtime and by specimens. */
import type { DatabaseDescriptor, DocumentRecord } from '../../src';
import type { SpecimenLang } from '../specimen';
import { isoFromNow } from './time';

export const TASKS_DATABASE: DatabaseDescriptor = {
  slug: 'tasks',
  title: 'Tasks',
  icon: 'check-square',
  properties: [
    { id: 'title', name: 'Name', type: 'title' },
    { id: 'status', name: 'Status', type: 'status', options: [
      { id: 'opt_todo', name: 'To do', color: 'gray', order: 0 },
      { id: 'opt_doing', name: 'In progress', color: 'blue', order: 1 },
      { id: 'opt_done', name: 'Done', color: 'green', order: 2 },
    ] },
    { id: 'priority', name: 'Priority', type: 'select', options: [
      { id: 'opt_low', name: 'Low', color: 'gray' },
      { id: 'opt_mid', name: 'Medium', color: 'yellow' },
      { id: 'opt_high', name: 'High', color: 'red' },
    ] },
    { id: 'tags', name: 'Tags', type: 'multi_select', options: [
      { id: 'opt_design', name: 'Design', color: 'purple' },
      { id: 'opt_web', name: 'Website', color: 'blue' },
      { id: 'opt_ops', name: 'Operations', color: 'orange' },
    ] },
    { id: 'due', name: 'Due', type: 'date' },
    { id: 'estimate', name: 'Estimate', type: 'number' },
    { id: 'done', name: 'Done', type: 'checkbox' },
    { id: 'notes', name: 'Notes', type: 'rich_text' },
  ],
};

export const NOTES_DATABASE: DatabaseDescriptor = {
  slug: 'notes',
  title: 'Notes',
  icon: 'file-text',
  properties: [
    { id: 'title', name: 'Name', type: 'title' },
    { id: 'created', name: 'Created', type: 'date' },
  ],
};

export const FIXTURE_DATABASES: DatabaseDescriptor[] = [TASKS_DATABASE, NOTES_DATABASE];

const TASKS: Array<{ en: string; fr: string; status: string; priority: string; tags: string[]; due: number; estimate: number }> = [
  { en: 'Write the launch email', fr: 'Rédiger l’e-mail de lancement', status: 'In progress', priority: 'High', tags: ['Website'], due: 1, estimate: 3 },
  { en: 'Review the pricing page', fr: 'Relire la page des tarifs', status: 'To do', priority: 'Medium', tags: ['Website', 'Design'], due: 3, estimate: 2 },
  { en: 'Plan the team offsite', fr: "Organiser le séminaire de l’équipe", status: 'To do', priority: 'Low', tags: ['Operations'], due: 12, estimate: 5 },
  { en: 'Ship the new onboarding', fr: 'Livrer le nouvel accueil des comptes', status: 'Done', priority: 'High', tags: ['Design'], due: -2, estimate: 8 },
  { en: 'Update the help centre', fr: "Mettre à jour le centre d’aide", status: 'In progress', priority: 'Medium', tags: ['Website'], due: 0, estimate: 4 },
  { en: 'Prepare the quarterly report', fr: 'Préparer le rapport trimestriel', status: 'To do', priority: 'High', tags: ['Operations'], due: 7, estimate: 6 },
  { en: 'Fix the invoice export', fr: "Corriger l’export des factures", status: 'Done', priority: 'Low', tags: ['Operations'], due: -6, estimate: 1 },
  { en: 'Design the mobile settings', fr: 'Concevoir les réglages sur mobile', status: 'In progress', priority: 'Medium', tags: ['Design'], due: 5, estimate: 5 },
];

/** The task records, titled in `lang`. Ids and keys are stable across languages. */
export function fixtureRecords(lang: SpecimenLang = 'en'): DocumentRecord[] {
  return TASKS.map((task, index) => ({
    id: `task-${index + 1}`,
    recordKey: `tasks:task-${index + 1}`,
    revision: 1,
    databaseSlug: 'tasks',
    title: task[lang],
    contentType: 'markdown',
    properties: {
      Name: task[lang],
      Status: task.status,
      Priority: task.priority,
      Tags: task.tags,
      Due: isoFromNow(task.due).slice(0, 10),
      Estimate: task.estimate,
      Done: task.status === 'Done',
      Notes: '',
    },
    createdAt: isoFromNow(-30 + index),
    lastEditedTime: isoFromNow(-index, -index),
  }));
}
