import { useLayoutEffect, useState } from 'react';
import { defineSpecimen, nextFrame, type SpecimenRenderContext } from '../../specimen';
import {
  EditableFields, FieldDisclosure, FieldLongText, FieldRow, FieldSelect, FieldText, StatusIcon, useFieldDraft,
} from '../../../src/ui';
import { w } from '../../../src/words';
import { LONG_TEXT, LONG_TITLE } from '../../fixtures';
import {
  AUTOMATION_NAME, AUTOMATION_NAME_EDITED, CHANNEL_OPTIONS, CHANNEL_PLACEHOLDER, CRON_FORMAT_ERROR, CRON_INVALID,
  INSTRUCTIONS, INTELLIGENCE_HINTS, KEEP_HINTS, KEEP_LOCKED_HINT, KEEP_OPTIONS, LABELS, NO_INSTRUCTIONS, Pane,
  SCHEDULE_CRON, SCHEDULE_CRON_INVALID, SCHEDULE_SUMMARY, STATUS_ON, TIMEZONE, TRIGGER_OPTIONS, UNTITLED,
  intelligenceOptions, nextRunText,
  type ChannelId, type IntelligenceChoice, type KeepChoice, type TriggerKind,
} from '../../fixtures/fields/automation';

/** The automation as the reader edits it. */
interface Automation {
  name: string;
  trigger: TriggerKind;
  cron: string;
  intelligence: IntelligenceChoice;
  keep: KeepChoice;
  channel: ChannelId | null;
  instructions: string;
}

type SaveMode = 'works' | 'fails';

const CUSTOM_SCHEDULE = w('Custom schedule', 'Horaire personnalisé');
const SAVE_REFUSED = 'The fixture server refused the change.';

/** Minute, hour, day of month, month, day of week (0 and 7 are Sunday). */
const CRON_RANGES: ReadonlyArray<readonly [number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

/** Five fields of numbers, ranges, lists, steps or `*`, each inside its range. */
function cronIsValid(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((part, index) => {
    const range = CRON_RANGES[index];
    if (!range) return false;
    return part.split(',').every((piece) => {
      const [base = '', step, extra] = piece.split('/');
      if (extra !== undefined || (step !== undefined && !/^\d+$/.test(step))) return false;
      if (base === '*') return true;
      const ends = base.split('-');
      return ends.length <= 2 && ends.every((end) => /^\d+$/.test(end) && Number(end) >= range[0] && Number(end) <= range[1]);
    });
  });
}

function savedAutomation(t: SpecimenRenderContext['t']): Automation {
  return {
    name: t(AUTOMATION_NAME),
    trigger: 'schedule',
    cron: SCHEDULE_CRON,
    intelligence: 'auto',
    keep: 'on',
    channel: 'email',
    instructions: t(INSTRUCTIONS),
  };
}

interface FormProps {
  ctx: SpecimenRenderContext;
  /** Applied on top of the saved automation when the state opens. */
  edits?: Partial<Automation>;
  saving?: boolean;
  saveMode?: SaveMode;
  whenOpen?: boolean;
  /** Set by a template: every control is read only. */
  locked?: boolean;
}

/**
 * The Automations reader: the name as a title field, the facts as rows, the instructions under them. Edits stay in a
 * draft (useFieldDraft) until Save; Save takes 0.7 s, or is refused with `saveMode: 'fails'`.
 */
function AutomationForm({ ctx, edits, saving = false, saveMode = 'works', whenOpen = false, locked = false }: FormProps) {
  const { t, lang } = ctx;
  const [saved, setSaved] = useState<Automation>(() => savedAutomation(t));
  const { draft, set, patch, dirty, changed, reset } = useFieldDraft(saved);
  const [open, setOpen] = useState(whenOpen);
  // The state opens with its edits already made (before the first paint).
  useLayoutEffect(() => {
    if (edits) patch(edits);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cronValid = cronIsValid(draft.cron);
  const whenChanged = changed('cron') || changed('trigger');
  const summary = draft.cron === SCHEDULE_CRON ? t(SCHEDULE_SUMMARY) : `${t(CUSTOM_SCHEDULE)} (${draft.cron})`;
  const save = () => new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      if (saveMode === 'fails') reject(new Error(SAVE_REFUSED));
      else {
        setSaved(draft);
        setOpen(false);
        resolve();
      }
    }, saveMode === 'fails' ? 300 : 700);
  });
  const cancel = () => {
    reset();
    setOpen(false);
  };

  return (
    <Pane>
      <header className="flex flex-col gap-1">
        <FieldText size="title" value={draft.name} label={LABELS.name} placeholder={UNTITLED} maxLength={100}
          readOnly={locked} onChange={(value) => set('name', value)} />
        <p className="text-sm text-muted-foreground">{t(SCHEDULE_SUMMARY)}</p>
      </header>
      <EditableFields
        label={LABELS.form}
        dirty={dirty}
        saving={saving}
        saveDisabled={!draft.name.trim() || !cronValid}
        onSave={save}
        onCancel={cancel}
        error={cronValid ? undefined : t(CRON_FORMAT_ERROR)}
        footer={(
          <section className="mt-6 flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t(LABELS.instructions)}</h3>
            <FieldLongText value={draft.instructions} label={LABELS.instructions} placeholder={NO_INSTRUCTIONS}
              readOnly={locked} onChange={(value) => set('instructions', value)} />
          </section>
        )}
      >
        <FieldRow label={LABELS.status}>
          <span className="inline-flex items-center gap-1.5">
            <StatusIcon status="live" decorative />
            {t(STATUS_ON)}
          </span>
        </FieldRow>
        <FieldRow label={LABELS.trigger} changed={changed('trigger')}>
          <FieldSelect<TriggerKind> value={draft.trigger} options={TRIGGER_OPTIONS} label={LABELS.trigger}
            readOnly={locked} onChange={(value) => set('trigger', value)} />
        </FieldRow>
        <FieldRow label={LABELS.when} changed={changed('cron')} stacked={open && !locked} invalid={!cronValid}
          hint={cronValid ? undefined : t(CRON_INVALID)}>
          <FieldDisclosure summary={summary} label={LABELS.when} open={open} onOpenChange={setOpen} readOnly={locked}>
            <div className="flex flex-col gap-2">
              <FieldText value={draft.cron} label={LABELS.cron} onChange={(value) => set('cron', value)} />
              <span className="text-xs text-muted-foreground">{t(TIMEZONE)}</span>
            </div>
          </FieldDisclosure>
        </FieldRow>
        {!whenChanged ? (
          <FieldRow label={LABELS.nextRun}>
            <span className="tabular-nums">{nextRunText(lang)}</span>
          </FieldRow>
        ) : null}
        <FieldRow label={LABELS.intelligence} changed={changed('intelligence')} hint={t(INTELLIGENCE_HINTS[draft.intelligence])}>
          <FieldSelect<IntelligenceChoice> value={draft.intelligence} options={intelligenceOptions(true)}
            label={LABELS.intelligence} readOnly={locked} onChange={(value) => set('intelligence', value)} />
        </FieldRow>
        <FieldRow label={LABELS.keepContext} changed={changed('keep')}
          hint={draft.channel === 'whatsapp' ? t(KEEP_LOCKED_HINT) : t(KEEP_HINTS[draft.keep])}>
          <FieldSelect<KeepChoice> value={draft.channel === 'whatsapp' ? 'on' : draft.keep} options={KEEP_OPTIONS}
            label={LABELS.keepContext} readOnly={locked || draft.channel === 'whatsapp'} onChange={(value) => set('keep', value)} />
        </FieldRow>
        <FieldRow label={LABELS.sendsTo} changed={changed('channel')}>
          <FieldSelect<ChannelId> value={draft.channel} options={CHANNEL_OPTIONS} label={LABELS.sendsTo}
            placeholder={CHANNEL_PLACEHOLDER} readOnly={locked} onChange={(value) => set('channel', value)} />
        </FieldRow>
      </EditableFields>
    </Pane>
  );
}

/** Waits until `ready` holds, a frame at a time (at most about 3 s). */
async function until(ready: () => boolean, frames = 180): Promise<void> {
  for (let frame = 0; frame < frames && !ready(); frame += 1) await nextFrame();
}

export const specimen = defineSpecimen({
  id: 'editable-fields',
  name: 'EditableFields',
  group: 'fields',
  from: '@notis/sdk/ui',
  covers: ['EditableFields'],
  summary: 'A form of facts that edit in place: once something changed, a sticky bar offers Cancel (Escape) and Save (Cmd+Enter).',
  states: [
    {
      id: 'saved',
      label: 'Saved: nothing changed, so there is no bar (edit any field to bring it up)',
      render: (ctx) => <AutomationForm ctx={ctx} />,
    },
    {
      id: 'edited',
      label: 'Edited: a new name and channel, the changed row is marked and the bar offers Cancel and Save',
      render: (ctx) => <AutomationForm ctx={ctx} edits={{ name: ctx.t(AUTOMATION_NAME_EDITED), channel: 'slack', intelligence: 'medium' }} />,
    },
    {
      id: 'saving',
      label: 'Saving: Save reads Saving and both buttons wait',
      render: (ctx) => <AutomationForm ctx={ctx} saving edits={{ name: ctx.t(AUTOMATION_NAME_EDITED), channel: 'slack' }} />,
    },
    {
      id: 'save-disabled',
      label: 'Save disabled: the name is empty, so Save stays visible but cannot run',
      render: (ctx) => <AutomationForm ctx={ctx} edits={{ name: '' }} />,
    },
    {
      id: 'invalid',
      label: 'Invalid schedule: When open with a day of week that does not exist, the error in the bar',
      render: (ctx) => <AutomationForm ctx={ctx} whenOpen edits={{ cron: SCHEDULE_CRON_INVALID }} />,
    },
    {
      id: 'save-failed',
      label: 'Save failed: the server refused the change, the draft stays and the bar says so',
      render: (ctx) => <AutomationForm ctx={ctx} saveMode="fails" edits={{ name: ctx.t(AUTOMATION_NAME_EDITED), keep: 'off' }} />,
      interact: async (root) => {
        const button = root.querySelector<HTMLButtonElement>('.nui-fields-bar button[aria-keyshortcuts]');
        button?.click();
        await until(() => Boolean(root.querySelector('.nui-fields-error')?.textContent));
        await nextFrame();
      },
    },
    {
      id: 'read-only',
      label: 'Read only: set by a template, every value is static',
      render: (ctx) => <AutomationForm ctx={ctx} locked />,
    },
    {
      id: 'long-text',
      label: 'Long text: a long name and instructions, edited',
      render: (ctx) => (
        <AutomationForm ctx={ctx} edits={{ name: ctx.t(LONG_TITLE), instructions: `${ctx.t(INSTRUCTIONS)} ${ctx.t(LONG_TEXT)}`, channel: 'whatsapp' }} />
      ),
    },
    {
      id: 'narrow',
      label: 'Phone (390px): edited, the bar puts its note on its own line',
      width: 390,
      render: (ctx) => <AutomationForm ctx={ctx} edits={{ name: ctx.t(AUTOMATION_NAME_EDITED), channel: 'slack' }} />,
    },
    {
      id: 'narrow-pane',
      label: 'Narrow pane (320px): labels stack above their values',
      width: 320,
      render: (ctx) => <AutomationForm ctx={ctx} edits={{ intelligence: 'high' }} />,
    },
  ],
});
