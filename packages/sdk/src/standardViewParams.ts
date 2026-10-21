import type { SpaceViewParam, SpaceViewFilter } from './space';

/** Standard Journal/Tasks URL settings. Authors bind these to their actual schemas and controls. */
export function journalViewParams(timezone: string): Record<string, SpaceViewParam> {
  return { period: { type: 'period', description: 'Calendar period, inclusive. Which dates should the journal show?', timezone } };
}

export function tasksViewParams({ timezone, projectDatabase, statuses }: {
  timezone: string; projectDatabase: string; statuses: readonly string[];
}): Record<string, SpaceViewParam> {
  return {
    ...journalViewParams(timezone),
    dueDate: { type: 'date', description: 'Which exact due date should the task list show?', timezone },
    late: { type: 'boolean', description: 'Only unfinished tasks due before today in the selected timezone.' },
    notPlanned: { type: 'boolean', description: 'Only tasks without a due date.' },
    today: { type: 'date', default: 'today', timezone, description: 'Reference date for late tasks; pin it for a dated answer.' },
    project: { type: 'record', database: projectDatabase, description: 'Which project should the tasks belong to?' },
    status: { type: 'enum', values: statuses, description: 'Which task status should the list show?' },
  };
}

/** Server-side filters, applied before pagination. Omitted URL settings omit their conditions. */
export function tasksViewFilter({ dueProperty, statusProperty, projectProperty, doneStatus }: {
  dueProperty: string; statusProperty: string; projectProperty: string; doneStatus: string;
}): SpaceViewFilter {
  return { and: [
    { field: { property: dueProperty }, op: 'equals', value: '{dueDate}' },
    { field: { property: dueProperty }, op: 'on_or_after', value: '{period.start}' },
    { field: { property: dueProperty }, op: 'on_or_before', value: '{period.end}' },
    { field: { property: dueProperty }, op: 'before', value: '{today}', when: 'late' },
    { field: { property: statusProperty }, op: 'not_equals', value: doneStatus, when: 'late' },
    { field: { property: dueProperty }, op: 'is_empty', when: 'notPlanned' },
    { field: { property: projectProperty }, op: 'contains', value: '{project}' },
    { field: { property: statusProperty }, op: 'equals', value: '{status}' },
  ] };
}
