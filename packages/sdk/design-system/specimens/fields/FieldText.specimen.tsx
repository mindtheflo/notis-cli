import { useState, type ReactNode } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { FieldList, FieldLongText, FieldRow, FieldText } from '../../../src/ui';
import { w, type Words } from '../../../src/words';
import { LONG_TEXT, LONG_TITLE } from '../../fixtures';
import {
  Caption, CRON_INVALID, INSTRUCTIONS, LABELS, NO_INSTRUCTIONS, Pane, SCHEDULE_CRON, SCHEDULE_CRON_INVALID, TIMEZONE, UNTITLED,
} from '../../fixtures/fields/automation';
import { keyboardFocus, settle, waitFor } from '../../fixtures/fields/interact';

type Ctx = SpecimenRenderContext;

// ---- the Skills reader header (Portal: SkillsPage) ----

const SKILL = {
  name: w('Meeting notes', 'Notes de réunion'),
  description: w(
    'Turns a meeting transcript into decisions, owners and next steps, saved to the Notes database.',
    'Transforme la transcription d’une réunion en décisions, responsables et prochaines étapes, enregistrées dans la base Notes.',
  ),
  nameLabel: w('Name', 'Nom'),
  namePlaceholder: w('My Custom Skill', 'Mon Skill personnalisé'),
  descriptionLabel: w('Description', 'Description'),
  descriptionPlaceholder: w('Say what the skill does and when to use it', 'Dis ce que fait le Skill et quand l’utiliser'),
};
const FILLED = w('Filled', 'Rempli');
const EMPTY = w('Empty', 'Vide');
const CRON_PLACEHOLDER = w(SCHEDULE_CRON, SCHEDULE_CRON);
const NAME_LABEL = w('Automation name', 'Nom de l’automatisation');
const AUTOMATION_NAME = w('Weekly digest', 'Résumé hebdomadaire');

/** The Skills reader header: the name as a title field, the description muted under it. */
function SkillHeader({ name, description, readOnly = false }: { name: string; description: string; readOnly?: boolean }) {
  const [value, setValue] = useState(name);
  const [about, setAbout] = useState(description);
  return (
    <header className="flex flex-col gap-1">
      <FieldText size="title" value={value} label={SKILL.nameLabel} placeholder={SKILL.namePlaceholder} maxLength={200}
        readOnly={readOnly} onChange={setValue} />
      <FieldLongText rows={2} className="text-muted-foreground" value={about} label={SKILL.descriptionLabel}
        placeholder={SKILL.descriptionPlaceholder} maxLength={10000} readOnly={readOnly} onChange={setAbout} />
    </header>
  );
}

interface RowsProps {
  ctx: Ctx;
  name?: string;
  cron?: string;
  instructions?: string;
  readOnly?: boolean;
  invalid?: boolean;
}

/** An automation's text facts as rows: its name, its cron expression, its instructions (stacked). */
function TextRows({ ctx, name: startName, cron: startCron, instructions: startInstructions, readOnly = false, invalid = false }: RowsProps) {
  const [name, setName] = useState(startName ?? ctx.t(AUTOMATION_NAME));
  const [cron, setCron] = useState(startCron ?? SCHEDULE_CRON);
  const [instructions, setInstructions] = useState(startInstructions ?? ctx.t(INSTRUCTIONS));
  return (
    <FieldList label={LABELS.form}>
      <FieldRow label={LABELS.name}>
        <FieldText value={name} label={NAME_LABEL} placeholder={UNTITLED} readOnly={readOnly} onChange={setName} />
      </FieldRow>
      <FieldRow label={LABELS.cron} invalid={invalid} hint={invalid ? ctx.t(CRON_INVALID) : ctx.t(TIMEZONE)}>
        <FieldText value={cron} label={LABELS.cron} placeholder={CRON_PLACEHOLDER} readOnly={readOnly} onChange={setCron} />
      </FieldRow>
      <FieldRow label={LABELS.instructions} stacked>
        <FieldLongText value={instructions} label={LABELS.instructions} placeholder={NO_INSTRUCTIONS} readOnly={readOnly}
          onChange={setInstructions} />
      </FieldRow>
    </FieldList>
  );
}

function Sample({ ctx, caption, children }: { ctx: Ctx; caption: Words; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Caption>{ctx.t(caption)}</Caption>
      {children}
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'field-text',
  name: 'FieldText',
  group: 'fields',
  from: '@notis/sdk/ui',
  covers: ['FieldText', 'FieldLongText'],
  summary: 'Text that edits in place: one line (or a title), and long text whose box grows with what is written.',
  states: [
    {
      id: 'values',
      label: 'Values: a name, a cron expression and instructions, each editable where it is',
      render: (ctx) => <Pane><TextRows ctx={ctx} /></Pane>,
    },
    {
      id: 'title',
      label: 'Title: the name of a Skill with its muted description, filled and empty',
      render: (ctx) => (
        <Pane>
          <Sample ctx={ctx} caption={FILLED}>
            <SkillHeader name={ctx.t(SKILL.name)} description={ctx.t(SKILL.description)} />
          </Sample>
          <Sample ctx={ctx} caption={EMPTY}>
            <SkillHeader name="" description="" />
          </Sample>
        </Pane>
      ),
    },
    {
      id: 'editing',
      label: 'Editing: the field in focus shows its ring',
      render: (ctx) => <Pane><TextRows ctx={ctx} /></Pane>,
      interact: async (root) => {
        const input = await waitFor<HTMLInputElement>(root, 'input.nui-field-input');
        keyboardFocus(input);
        input.setSelectionRange(input.value.length, input.value.length);
        await settle();
      },
    },
    {
      id: 'invalid',
      label: 'Invalid: the cron expression names a day that does not exist, the hint reads as the error',
      render: (ctx) => <Pane><TextRows ctx={ctx} cron={SCHEDULE_CRON_INVALID} invalid /></Pane>,
    },
    {
      id: 'read-only',
      label: 'Read only: the values show as text, nothing to edit',
      render: (ctx) => (
        <Pane>
          <SkillHeader name={ctx.t(SKILL.name)} description={ctx.t(SKILL.description)} readOnly />
          <TextRows ctx={ctx} readOnly />
        </Pane>
      ),
    },
    {
      id: 'empty',
      label: 'Empty: each field shows its placeholder',
      render: (ctx) => <Pane><TextRows ctx={ctx} name="" cron="" instructions="" /></Pane>,
    },
    {
      id: 'long-text',
      label: 'Long text: a long title stays on one line, long instructions grow the box',
      render: (ctx) => (
        <Pane>
          <SkillHeader name={ctx.t(LONG_TITLE)} description={`${ctx.t(SKILL.description)} ${ctx.t(LONG_TEXT)}`} />
          <TextRows ctx={ctx} name={ctx.t(LONG_TITLE)} instructions={`${ctx.t(INSTRUCTIONS)}\n\n${ctx.t(LONG_TEXT)}`} />
        </Pane>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow pane (320px): labels stack above their fields',
      width: 320,
      render: (ctx) => (
        <Pane>
          <SkillHeader name={ctx.t(SKILL.name)} description={ctx.t(SKILL.description)} />
          <TextRows ctx={ctx} />
        </Pane>
      ),
    },
  ],
});
