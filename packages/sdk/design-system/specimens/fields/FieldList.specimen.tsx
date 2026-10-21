import { useState } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { Button, FIELD_WORDS, FieldList, FieldLongText, FieldMultiSelect, FieldRow, FieldSelect, FieldText } from '../../../src/ui';
import { LONG_TEXT, LONG_TITLE, fixtureRecords } from '../../fixtures';
import {
  LABELS, LABEL_OPTIONS, Pane, TASK_ESTIMATE, TASK_NOTES, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, dayText,
  type LabelId, type TaskPriority, type TaskStatus,
} from '../../fixtures/fields/automation';

type Ctx = SpecimenRenderContext;

/** The task as the sheet shows it: the first task of the fixtures. */
interface Task {
  title: string;
  status: TaskStatus | null;
  priority: TaskPriority | null;
  labels: LabelId[];
  /** Days from the fixed clock, or null when there is no due date. */
  due: number | null;
  estimate: string | null;
  notes: string | null;
}

const STATUS_OF: Record<string, TaskStatus> = { 'To do': 'todo', 'In progress': 'doing', Done: 'done' };
const PRIORITY_OF: Record<string, TaskPriority> = { Low: 'low', Medium: 'medium', High: 'high' };
const LABEL_OF: Record<string, LabelId> = { Design: 'design', Website: 'website', Operations: 'operations' };

/** The first fixture task ("Write the launch email"), due tomorrow. */
function firstTask(ctx: Ctx): Task {
  const record = fixtureRecords(ctx.lang)[0]!;
  const props = record.properties as { Status: string; Priority: string; Tags: string[] };
  return {
    title: record.title ?? '',
    status: STATUS_OF[props.Status] ?? null,
    priority: PRIORITY_OF[props.Priority] ?? null,
    labels: props.Tags.map((tag) => LABEL_OF[tag]).filter((tag): tag is LabelId => Boolean(tag)),
    due: 1,
    estimate: ctx.t(TASK_ESTIMATE),
    notes: ctx.t(TASK_NOTES),
  };
}

function Empty({ ctx }: { ctx: Ctx }) {
  return <span className="text-muted-foreground">{ctx.t(FIELD_WORDS.empty)}</span>;
}

/** A read-only sheet of the task, or (`live`) facts that save on their own: each change applies at once. */
function TaskSheet({ ctx, task: start, live = false }: { ctx: Ctx; task: Task; live?: boolean }) {
  const [task, setTask] = useState(start);
  const readOnly = !live;
  return (
    <Pane>
      <h2 className="text-lg font-semibold leading-7 tracking-tight">{task.title}</h2>
      <FieldList label={LABELS.task}>
        <FieldRow label={LABELS.status}>
          <FieldSelect<TaskStatus> value={task.status} options={TASK_STATUS_OPTIONS} label={LABELS.status} readOnly={readOnly}
            onChange={(status) => setTask({ ...task, status })} />
        </FieldRow>
        <FieldRow label={LABELS.priority}>
          <FieldSelect<TaskPriority> value={task.priority} options={TASK_PRIORITY_OPTIONS} label={LABELS.priority}
            readOnly={readOnly} onChange={(priority) => setTask({ ...task, priority })} />
        </FieldRow>
        <FieldRow label={LABELS.labels}>
          <FieldMultiSelect<LabelId> values={task.labels} options={LABEL_OPTIONS} label={LABELS.labels} readOnly={readOnly}
            searchable onChange={(labels) => setTask({ ...task, labels })} />
        </FieldRow>
        <FieldRow label={LABELS.due}>
          {task.due === null ? <Empty ctx={ctx} /> : <span className="tabular-nums">{dayText(task.due, ctx.lang)}</span>}
        </FieldRow>
        <FieldRow label={LABELS.estimate}>
          {task.estimate === null ? <Empty ctx={ctx} /> : <span className="tabular-nums">{task.estimate}</span>}
        </FieldRow>
        <FieldRow label={LABELS.notes} stacked>
          {task.notes === null ? <Empty ctx={ctx} /> : <span>{task.notes}</span>}
        </FieldRow>
      </FieldList>
    </Pane>
  );
}

/** A visitor's signup form, the words it shows in English and French. */
const SIGNUP = {
  name: { en: 'Name', fr: 'Nom' },
  namePlaceholder: { en: 'Ada Lovelace', fr: 'Ada Lovelace' },
  email: { en: 'Email', fr: 'E-mail' },
  emailPlaceholder: { en: 'ada@example.com', fr: 'ada@exemple.fr' },
  idea: { en: 'What will you build first?', fr: 'Que vas-tu construire en premier ?' },
  ideaPlaceholder: { en: 'A CRM for my clients, a reading list...', fr: 'Un CRM pour mes clients, une liste de lecture...' },
  required: { en: 'Fill this in.', fr: 'Remplis ce champ.' },
  submit: { en: 'Join the beta', fr: 'Rejoindre la bêta' },
};

/** A form a visitor fills in from empty: every field shows its box, labels above (`invalid` shows a missing email). */
function SignupForm({ ctx, invalid = false }: { ctx: Ctx; invalid?: boolean }) {
  const [values, setValues] = useState({ name: invalid ? 'Ada Lovelace' : '', email: '', idea: '' });
  const set = (key: keyof typeof values) => (value: string) => setValues({ ...values, [key]: value });
  return (
    <Pane width={480}>
      <FieldList filled>
        <FieldRow label={SIGNUP.name}>
          <FieldText label={SIGNUP.name} value={values.name} placeholder={SIGNUP.namePlaceholder} onChange={set('name')} />
        </FieldRow>
        <FieldRow label={SIGNUP.email} invalid={invalid} hint={invalid ? ctx.t(SIGNUP.required) : undefined}>
          <FieldText label={SIGNUP.email} value={values.email} placeholder={SIGNUP.emailPlaceholder} onChange={set('email')} />
        </FieldRow>
        <FieldRow label={SIGNUP.idea} stacked>
          <FieldLongText label={SIGNUP.idea} value={values.idea} placeholder={SIGNUP.ideaPlaceholder} onChange={set('idea')} />
        </FieldRow>
      </FieldList>
      <div><Button variant="primary">{ctx.t(SIGNUP.submit)}</Button></div>
    </Pane>
  );
}

export const specimen = defineSpecimen({
  id: 'field-list',
  name: 'FieldList',
  group: 'fields',
  from: '@notis/sdk/ui',
  covers: ['FieldList'],
  summary: 'Rows laid out as in a form, without Save and Cancel: a read-only sheet, facts that save on their own, or a visitor\'s form (filled).',
  states: [
    {
      id: 'sheet',
      label: 'Read-only sheet: the facts of a task',
      render: (ctx) => <TaskSheet ctx={ctx} task={firstTask(ctx)} />,
    },
    {
      id: 'saves-on-its-own',
      label: 'Saves on its own: each select applies at once, there is no bar',
      render: (ctx) => <TaskSheet ctx={ctx} task={firstTask(ctx)} live />,
    },
    {
      id: 'empty',
      label: 'Empty: missing facts read Empty, selects with nothing chosen show their placeholder',
      render: (ctx) => (
        <TaskSheet ctx={ctx} live task={{ ...firstTask(ctx), priority: null, labels: [], due: null, estimate: null, notes: null }} />
      ),
    },
    {
      id: 'long-text',
      label: 'Long text: a long title and notes, three labels',
      render: (ctx) => (
        <TaskSheet ctx={ctx} task={{
          ...firstTask(ctx),
          title: ctx.t(LONG_TITLE),
          labels: ['website', 'operations', 'summer'],
          notes: `${ctx.t(TASK_NOTES)} ${ctx.t(LONG_TEXT)}`,
        }} />
      ),
    },
    {
      id: 'filled',
      label: 'Filled: a visitor\'s form, labels above and every field boxed at rest',
      render: (ctx) => <SignupForm ctx={ctx} />,
    },
    {
      id: 'filled-invalid',
      label: 'Filled, invalid: a missing email tints its box and says what to do',
      render: (ctx) => <SignupForm ctx={ctx} invalid />,
    },
    {
      id: 'filled-narrow',
      label: 'Filled in a narrow pane (320px)',
      width: 320,
      render: (ctx) => <SignupForm ctx={ctx} />,
    },
    {
      id: 'narrow',
      label: 'Narrow pane (320px): labels stack above their values',
      width: 320,
      render: (ctx) => <TaskSheet ctx={ctx} task={firstTask(ctx)} live />,
    },
  ],
});
