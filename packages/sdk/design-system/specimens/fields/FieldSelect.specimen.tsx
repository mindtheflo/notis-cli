import { useState, type ReactNode } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { FieldList, FieldMultiSelect, FieldRow, FieldSelect, Notice, type FieldOption } from '../../../src/ui';
import { w, type Words } from '../../../src/words';
import {
  AGENT_OPTIONS, CHANNEL_OPTIONS, CHANNEL_PLACEHOLDER, INTELLIGENCE_HINTS, KEEP_LOCKED_HINT, KEEP_OPTIONS,
  LABELS, LABEL_OPTIONS, NEEDS_ONE_AGENT, Pane, TRIGGER_OPTIONS, UPGRADE_NOTE, intelligenceOptions,
  type AgentId, type ChannelId, type IntelligenceChoice, type KeepChoice, type LabelId, type TriggerKind,
} from '../../fixtures/fields/automation';
import { layerScope, openField, pressEnter, settle, typeInto, until } from '../../fixtures/fields/interact';

type Ctx = SpecimenRenderContext;

const ROWS = {
  one: w('One agent', 'Un agent'),
  two: w('Two agents', 'Deux agents'),
  three: w('Three agents', 'Trois agents'),
  none: w('None yet', 'Aucun pour l’instant'),
  readOnly: w('Read only', 'Lecture seule'),
};
const AGENTS_PLACEHOLDER = w('Choose agents', 'Choisis des agents');
const LABELS_PLACEHOLDER = w('Add labels', 'Ajoute des étiquettes');
/** What the search states type: a word that matches one label and is not a label itself (so Add shows). */
const TYPED_MATCH = w('Launch', 'Lancement');
const TYPED_NO_MATCH = w('zz', 'zz');
const TYPED_NEW = w('Partners', 'Partenaires');
const ADD_REFUSED = 'The fixture server refused the new label.';

/** A select the reviewer can change. */
function LiveSelect<V extends string>({ start, ...props }: {
  start: V | null; options: readonly FieldOption<V>[]; label: Words; placeholder?: Words; readOnly?: boolean; menuHeader?: ReactNode;
}) {
  const [value, setValue] = useState<V | null>(start);
  return <FieldSelect<V> {...props} value={value} onChange={setValue} />;
}

/** Runs on: several agents, the last one cannot be removed (the hint says why). */
function AgentsSelect({ start, minOne = true, readOnly = false }: { start: AgentId[]; minOne?: boolean; readOnly?: boolean }) {
  const [values, setValues] = useState<AgentId[]>(start);
  return (
    <FieldMultiSelect<AgentId> values={values} options={AGENT_OPTIONS} label={LABELS.runsOn} placeholder={AGENTS_PLACEHOLDER}
      minOne={minOne} readOnly={readOnly} onChange={setValues} />
  );
}

function AgentsRow({ ctx, label = LABELS.runsOn, start, minOne = true, readOnly = false }: {
  ctx: Ctx; label?: Words; start: AgentId[]; minOne?: boolean; readOnly?: boolean;
}) {
  const [values, setValues] = useState<AgentId[]>(start);
  const [needOne, setNeedOne] = useState(false);
  return (
    <FieldRow label={label} invalid={needOne} hint={needOne ? ctx.t(NEEDS_ONE_AGENT) : undefined}>
      <FieldMultiSelect<AgentId> values={values} options={AGENT_OPTIONS} label={LABELS.runsOn} placeholder={AGENTS_PLACEHOLDER}
        minOne={minOne} readOnly={readOnly} onNeedOne={() => setNeedOne(true)}
        onChange={(next) => { setValues(next); setNeedOne(false); }} />
    </FieldRow>
  );
}

type AddMode = 'none' | 'works' | 'fails';

/** Labels of a task: a long list with a search box, and (`add`) new labels from the typed text. */
function LabelsRow({ start, add = 'none' }: { start: LabelId[]; add?: AddMode }) {
  const [values, setValues] = useState<string[]>(start);
  const [options, setOptions] = useState<FieldOption<string>[]>(() => [...LABEL_OPTIONS]);
  const onAdd = add === 'none' ? undefined : async (text: string) => {
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    if (add === 'fails') throw new Error(ADD_REFUSED);
    const value = `label-${options.length + 1}`;
    setOptions((current) => [...current, { value, label: w(text, text) }]);
    return value;
  };
  return (
    <FieldRow label={LABELS.labels}>
      <FieldMultiSelect<string> values={values} options={options} label={LABELS.labels} placeholder={LABELS_PLACEHOLDER}
        searchable onAdd={onAdd} onChange={setValues} />
    </FieldRow>
  );
}

function IntelligenceRow({ ctx, start = 'auto', priorityAccess = true }: { ctx: Ctx; start?: IntelligenceChoice; priorityAccess?: boolean }) {
  const [value, setValue] = useState<IntelligenceChoice>(start);
  return (
    <FieldRow label={LABELS.intelligence} hint={ctx.t(INTELLIGENCE_HINTS[value])}>
      <FieldSelect<IntelligenceChoice> value={value} options={intelligenceOptions(priorityAccess)} label={LABELS.intelligence}
        onChange={setValue}
        menuHeader={priorityAccess ? undefined : <div className="p-1.5"><Notice>{UPGRADE_NOTE}</Notice></div>} />
    </FieldRow>
  );
}

/** The selects of the Automations reader: icons, hints, a placeholder, and a value locked by the channel. */
function Selects({ ctx, channel = null }: { ctx: Ctx; channel?: ChannelId | null }) {
  return (
    <FieldList label={LABELS.form}>
      <FieldRow label={LABELS.trigger}>
        <LiveSelect<TriggerKind> start="schedule" options={TRIGGER_OPTIONS} label={LABELS.trigger} />
      </FieldRow>
      <IntelligenceRow ctx={ctx} />
      <FieldRow label={LABELS.sendsTo}>
        <LiveSelect<ChannelId> start={channel} options={CHANNEL_OPTIONS} label={LABELS.sendsTo} placeholder={CHANNEL_PLACEHOLDER} />
      </FieldRow>
      <FieldRow label={LABELS.keepContext} hint={ctx.t(KEEP_LOCKED_HINT)}>
        <LiveSelect<KeepChoice> start="on" options={KEEP_OPTIONS} label={LABELS.keepContext} readOnly />
      </FieldRow>
    </FieldList>
  );
}

/** Carries the text a search state types, in the state's language (interact steps only get the root). */
function Typed({ ctx, text, children }: { ctx: Ctx; text: Words; children: ReactNode }) {
  return <div data-typed={ctx.t(text)}>{children}</div>;
}

function typedText(root: HTMLElement): string {
  return root.querySelector<HTMLElement>('[data-typed]')?.dataset.typed ?? '';
}

/** Opens the search of the first multi-select and types the state's text. */
async function searchFor(root: HTMLElement): Promise<HTMLInputElement> {
  const search = await openField(root, '.nui-popover input.nui-field-search') as HTMLInputElement;
  await typeInto(search, typedText(root));
  return search;
}

function statusText(root: HTMLElement): string {
  return layerScope(root).querySelector('.nui-field-search-status')?.textContent ?? '';
}

export const specimen = defineSpecimen({
  id: 'field-select',
  name: 'FieldSelect',
  group: 'fields',
  from: '@notis/sdk/ui',
  covers: ['FieldSelect', 'FieldMultiSelect'],
  summary: 'Choices that edit in place: one value from a menu, or several, with a search box and Add for long lists.',
  states: [
    {
      id: 'select',
      label: 'Select: icons, a hint for the choice, a placeholder, and a value the channel keeps locked',
      render: (ctx) => <Pane><Selects ctx={ctx} /></Pane>,
    },
    {
      id: 'select-open',
      label: 'Select open: each choice with its hint, the current one checked',
      height: 400,
      render: (ctx) => <Pane><FieldList label={LABELS.form}><IntelligenceRow ctx={ctx} start="medium" /></FieldList></Pane>,
      interact: async (root) => {
        await openField(root, '[role="menu"]');
        await settle();
      },
    },
    {
      id: 'select-upgrade',
      label: 'Select open without access: an upgrade note above the choices, the paid ones disabled',
      height: 440,
      render: (ctx) => <Pane><FieldList label={LABELS.form}><IntelligenceRow ctx={ctx} priorityAccess={false} /></FieldList></Pane>,
      interact: async (root) => {
        await openField(root, '[role="menu"]');
        await settle();
      },
    },
    {
      id: 'multi',
      label: 'Multi-select: one or two names, three as icons only, nothing chosen yet, and read only',
      render: (ctx) => (
        <Pane>
          <FieldList label={LABELS.form}>
            <AgentsRow ctx={ctx} label={ROWS.one} start={['notis']} />
            <AgentsRow ctx={ctx} label={ROWS.two} start={['notis', 'codex']} />
            <AgentsRow ctx={ctx} label={ROWS.three} start={['notis', 'codex', 'claude']} />
            <AgentsRow ctx={ctx} label={ROWS.none} start={[]} minOne={false} />
            <AgentsRow ctx={ctx} label={ROWS.readOnly} start={['notis', 'claude']} readOnly />
          </FieldList>
        </Pane>
      ),
    },
    {
      id: 'multi-open',
      label: 'Multi-select open: the menu stays open while agents are checked and unchecked',
      height: 340,
      render: () => (
        <Pane>
          <FieldList label={LABELS.form}>
            <FieldRow label={LABELS.runsOn}><AgentsSelect start={['notis', 'claude']} /></FieldRow>
          </FieldList>
        </Pane>
      ),
      interact: async (root) => {
        await openField(root, '[role="menu"]');
        await settle();
      },
    },
    {
      id: 'multi-search',
      label: 'Search: typing filters the labels (case and accents ignored) and offers to add the text as a new label',
      height: 400,
      render: (ctx) => (
        <Typed ctx={ctx} text={TYPED_MATCH}>
          <Pane><FieldList label={LABELS.task}><LabelsRow start={['website']} add="works" /></FieldList></Pane>
        </Typed>
      ),
      interact: async (root) => {
        await searchFor(root);
        await until(() => Boolean(layerScope(root).querySelector('.nui-field-option')));
        await settle();
      },
    },
    {
      id: 'multi-no-match',
      label: 'Search with no match: the list empties and says so',
      height: 300,
      render: (ctx) => (
        <Typed ctx={ctx} text={TYPED_NO_MATCH}>
          <Pane><FieldList label={LABELS.task}><LabelsRow start={['website', 'design']} /></FieldList></Pane>
        </Typed>
      ),
      interact: async (root) => {
        await searchFor(root);
        await until(() => Boolean(statusText(root)));
        await settle();
      },
    },
    {
      id: 'multi-add-failed',
      label: 'Add failed: the new label was refused, the typed text stays and the panel says so',
      height: 300,
      render: (ctx) => (
        <Typed ctx={ctx} text={TYPED_NEW}>
          <Pane><FieldList label={LABELS.task}><LabelsRow start={['website']} add="fails" /></FieldList></Pane>
        </Typed>
      ),
      interact: async (root) => {
        const search = await searchFor(root);
        await pressEnter(search);
        await until(() => Boolean(statusText(root)), 240);
        await settle();
      },
    },
    {
      id: 'narrow',
      label: 'Narrow pane (320px): labels stack above their choices',
      width: 320,
      render: (ctx) => (
        <Pane>
          <Selects ctx={ctx} channel="slack" />
          <FieldList label={LABELS.task}>
            <AgentsRow ctx={ctx} start={['notis', 'codex']} />
            <LabelsRow start={['website', 'summer']} />
          </FieldList>
        </Pane>
      ),
    },
  ],
});
