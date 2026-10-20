import { useState } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import {
  FieldDisclosure, FieldList, FieldLongText, FieldMultiSelect, FieldRow, FieldSelect, FieldText, StatusIcon,
  type FieldOption,
} from '../../../src/ui';
import type { Words } from '../../../src/words';
import { LONG_TEXT, LONG_TITLE } from '../../fixtures';
import {
  AGENT_OPTIONS, CHANNEL_OPTIONS, CRON_INVALID, INSTRUCTIONS, INTELLIGENCE_HINTS, LABELS, NEEDS_ONE_AGENT, Pane,
  REPEAT_OPTIONS, SCHEDULE_CRON_INVALID, SCHEDULE_SUMMARY, STATUS_ON, TIMEZONE, intelligenceOptions, nextRunText,
  type AgentId, type ChannelId, type IntelligenceChoice, type RepeatKind,
} from '../../fixtures/fields/automation';

type Ctx = SpecimenRenderContext;

/** A select the reviewer can change. */
function LiveSelect<V extends string>({ start, ...props }: { start: V | null; options: readonly FieldOption<V>[]; label: Words }) {
  const [value, setValue] = useState<V | null>(start);
  return <FieldSelect<V> {...props} value={value} onChange={setValue} />;
}

/** A text field the reviewer can type in. */
function LiveText({ start, label, long = false }: { start: string; label: Words; long?: boolean }) {
  const [value, setValue] = useState(start);
  return long
    ? <FieldLongText value={value} label={label} onChange={setValue} />
    : <FieldText value={value} label={label} onChange={setValue} />;
}

function StatusValue({ ctx }: { ctx: Ctx }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusIcon status="live" decorative />
      {ctx.t(STATUS_ON)}
    </span>
  );
}

/**
 * The When row of the Automations reader: the schedule as words; open, the row stacks and the editor (repeats, time,
 * timezone) shows under the summary.
 */
function WhenRow({ ctx, startOpen = false, readOnly = false }: { ctx: Ctx; startOpen?: boolean; readOnly?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [repeat, setRepeat] = useState<RepeatKind>('week');
  const [time, setTime] = useState('09:00');
  return (
    <FieldRow label={LABELS.when} stacked={open && !readOnly}>
      <FieldDisclosure summary={ctx.t(SCHEDULE_SUMMARY)} label={LABELS.when} open={open} onOpenChange={setOpen} readOnly={readOnly}>
        <FieldList>
          <FieldRow label={LABELS.repeats}>
            <FieldSelect<RepeatKind> value={repeat} options={REPEAT_OPTIONS} label={LABELS.repeats} onChange={setRepeat} />
          </FieldRow>
          <FieldRow label={LABELS.at} hint={ctx.t(TIMEZONE)}>
            <FieldText value={time} label={LABELS.at} onChange={setTime} />
          </FieldRow>
        </FieldList>
      </FieldDisclosure>
    </FieldRow>
  );
}

function Basics({ ctx }: { ctx: Ctx }) {
  return (
    <Pane>
      <FieldList label={LABELS.form}>
        <FieldRow label={LABELS.status}><StatusValue ctx={ctx} /></FieldRow>
        <FieldRow label={LABELS.nextRun}><span className="tabular-nums">{nextRunText(ctx.lang)}</span></FieldRow>
        <FieldRow label={LABELS.intelligence} hint={ctx.t(INTELLIGENCE_HINTS.medium)}>
          <LiveSelect<IntelligenceChoice> start="medium" options={intelligenceOptions(true)} label={LABELS.intelligence} />
        </FieldRow>
        <FieldRow label={LABELS.sendsTo} changed>
          <LiveSelect<ChannelId> start="slack" options={CHANNEL_OPTIONS} label={LABELS.sendsTo} />
        </FieldRow>
      </FieldList>
    </Pane>
  );
}

/**
 * Runs on, where the last agent cannot be removed: the state opens just after an attempt to remove Notis, so the hint
 * says why (choosing another agent clears it).
 */
function AgentsRow({ ctx }: { ctx: Ctx }) {
  const [values, setValues] = useState<AgentId[]>(['notis']);
  const [needOne, setNeedOne] = useState(true);
  return (
    <FieldRow label={LABELS.runsOn} invalid={needOne} hint={needOne ? ctx.t(NEEDS_ONE_AGENT) : undefined}>
      <FieldMultiSelect<AgentId> values={values} options={AGENT_OPTIONS} label={LABELS.runsOn} minOne
        onNeedOne={() => setNeedOne(true)} onChange={(next) => { setValues(next); setNeedOne(false); }} />
    </FieldRow>
  );
}

export const specimen = defineSpecimen({
  id: 'field-row',
  name: 'FieldRow',
  group: 'fields',
  from: '@notis/sdk/ui',
  covers: ['FieldRow', 'FieldDisclosure'],
  summary: 'One fact: its label, its value or control, a muted hint, and marks for a changed or wrong value. FieldDisclosure is a value that opens a bigger editor.',
  states: [
    {
      id: 'basics',
      label: 'Label and value, a hint under the value, and a changed value (the dot)',
      render: (ctx) => <Basics ctx={ctx} />,
    },
    {
      id: 'invalid',
      label: 'Invalid: the hint reads as the error and the text field is marked',
      render: (ctx) => (
        <Pane>
          <FieldList label={LABELS.form}>
            <FieldRow label={LABELS.cron} invalid hint={ctx.t(CRON_INVALID)}>
              <LiveText start={SCHEDULE_CRON_INVALID} label={LABELS.cron} />
            </FieldRow>
            <AgentsRow ctx={ctx} />
          </FieldList>
        </Pane>
      ),
    },
    {
      id: 'stacked',
      label: 'Stacked: the label above a long value at every width',
      render: (ctx) => (
        <Pane>
          <FieldList label={LABELS.form}>
            <FieldRow label={LABELS.status}><StatusValue ctx={ctx} /></FieldRow>
            <FieldRow label={LABELS.instructions} stacked>
              <LiveText start={ctx.t(INSTRUCTIONS)} label={LABELS.instructions} long />
            </FieldRow>
          </FieldList>
        </Pane>
      ),
    },
    {
      id: 'disclosure-closed',
      label: 'Disclosure closed: the schedule as words (click to open), and read only beneath',
      render: (ctx) => (
        <Pane>
          <FieldList label={LABELS.form}>
            <WhenRow ctx={ctx} />
            <FieldRow label={LABELS.nextRun}><span className="tabular-nums">{nextRunText(ctx.lang)}</span></FieldRow>
          </FieldList>
          <FieldList label={LABELS.form}>
            <WhenRow ctx={ctx} readOnly />
          </FieldList>
        </Pane>
      ),
    },
    {
      id: 'disclosure-open',
      label: 'Disclosure open: the row stacks and the editor shows under the summary',
      render: (ctx) => (
        <Pane>
          <FieldList label={LABELS.form}>
            <FieldRow label={LABELS.status}><StatusValue ctx={ctx} /></FieldRow>
            <WhenRow ctx={ctx} startOpen />
            <FieldRow label={LABELS.nextRun}><span className="tabular-nums">{nextRunText(ctx.lang)}</span></FieldRow>
          </FieldList>
        </Pane>
      ),
    },
    {
      id: 'long-text',
      label: 'Long text: a long value, a long hint, a long label',
      render: (ctx) => (
        <Pane>
          <FieldList label={LABELS.form}>
            <FieldRow label={LABELS.task} hint={ctx.t(LONG_TEXT)}><span>{ctx.t(LONG_TITLE)}</span></FieldRow>
            <FieldRow label={{ en: 'Keep context between runs', fr: 'Garder le contexte entre les exécutions' }} changed>
              <span>{ctx.t({ en: 'On', fr: 'Activé' })}</span>
            </FieldRow>
          </FieldList>
        </Pane>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow pane (320px): labels stack above their values',
      width: 320,
      render: (ctx) => <Basics ctx={ctx} />,
    },
  ],
});
