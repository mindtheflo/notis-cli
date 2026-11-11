import { useState, type ReactNode } from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import {
  Badge, DataTable, EmptyState, Section, formatDuration, formatNumber, type DataTableColumn,
} from '../../../src/ui/index';
import { fillWords } from '../../../src/words/index';
import {
  FLEET_WORDS, MACHINES, THREADS, THREAD_GROUPS, type MachineFixture, type ThreadFixture,
} from '../../fixtures/blocks/fleet';
import { focusFrom } from '../../fixtures/charts/interact';

const GIB = { en: 'GiB', fr: 'Gio' } as const;
const ONLINE = { en: 'Online', fr: 'En ligne' } as const;
const ASLEEP = { en: 'Asleep', fr: 'En veille' } as const;

/** Bleeds the table to the frame edges, as a Space page lays one out: its edge cells carry the 24 px inset. */
function Bleed({ children }: { children: ReactNode }) {
  return <div className="-mx-6">{children}</div>;
}

function machineColumns(lang: SpecimenLang): DataTableColumn<MachineFixture>[] {
  return [
    { id: 'name', label: FLEET_WORDS.name, primary: true, cell: (m) => m.name },
    { id: 'status', label: FLEET_WORDS.status, width: 112,
      cell: (m) => <Badge>{m.online ? ONLINE : ASLEEP}</Badge> },
    { id: 'region', label: FLEET_WORDS.region, mono: true, hideBelow: 640, cell: (m) => m.region },
    { id: 'memory', label: FLEET_WORDS.memory, align: 'end', hideBelow: 480,
      cell: (m) => `${formatNumber(m.memoryUsed, lang)} / ${formatNumber(m.memoryMax, lang)} ${GIB[lang]}` },
    { id: 'threads', label: FLEET_WORDS.threads, align: 'end', hideBelow: 560, cell: (m) => formatNumber(m.threads, lang) },
    { id: 'uptime', label: FLEET_WORDS.uptime, align: 'end', cell: (m) => formatDuration(m.uptimeMs, lang) },
  ];
}

function threadColumns(lang: SpecimenLang): DataTableColumn<ThreadFixture>[] {
  return [
    { id: 'title', label: FLEET_WORDS.threads, primary: true, cell: (row) => row.title[lang] },
    { id: 'machine', label: FLEET_WORDS.machine, mono: true, width: 160, hideBelow: 600, cell: (row) => row.machine },
    { id: 'agent', label: FLEET_WORDS.agent, hideBelow: 480, cell: (row) => row.agent },
    { id: 'duration', label: FLEET_WORDS.duration, align: 'end', cell: (row) => formatDuration(row.durationMs, lang) },
  ];
}

function threadGroups(threads: readonly ThreadFixture[]) {
  return THREAD_GROUPS.map((group) => ({ ...group, rows: threads.filter((thread) => thread.status === group.key) }));
}

/** Threads by status; a press opens one (here it marks the last one opened). */
function Threads({ lang, threads = THREADS }: { lang: SpecimenLang; threads?: readonly ThreadFixture[] }) {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <Section kind="data" title={FLEET_WORDS.threads} count={threads.length}
      meta={opened ? fillWords(FLEET_WORDS.open, { name: opened }) : undefined}>
      <DataTable columns={threadColumns(lang)} groups={threadGroups(threads)} rowKey={(row) => row.id}
        label={FLEET_WORDS.threads} onRowPress={(row) => setOpened(row.title[lang])}
        rowLabel={(row) => fillWords(FLEET_WORDS.open, { name: row.title[lang] })[lang]} />
    </Section>
  );
}

export const specimen = defineSpecimen({
  id: 'data-table',
  name: 'DataTable',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['DataTable'],
  summary: 'A read-only table for a dashboard section: rows that truncate, optional group headings, pressable rows.',
  states: [
    {
      id: 'machines',
      label: 'Machines in a data Section: a status badge in a fixed column, a mono region, numbers on the right',
      render: ({ lang }) => (
        <Bleed>
          <Section kind="data" title={FLEET_WORDS.machines} count={MACHINES.length}>
            <DataTable columns={machineColumns(lang)} rows={MACHINES} rowKey={(m) => m.id} label={FLEET_WORDS.machines} />
          </Section>
        </Bleed>
      ),
    },
    {
      id: 'grouped',
      label: 'Threads under group headings with their counts; rows open a thread',
      render: ({ lang }) => <Bleed><Threads lang={lang} /></Bleed>,
    },
    {
      id: 'row-focus',
      label: 'A row focused from the keyboard',
      render: ({ lang }) => <Bleed><Threads lang={lang} /></Bleed>,
      interact: (root) => focusFrom(root, '.nui-dtable-pick', 1).then(() => undefined),
    },
    {
      id: 'tablet',
      label: 'At 768: every column still fits',
      width: 768,
      render: ({ lang }) => <Bleed><Threads lang={lang} /></Bleed>,
    },
    {
      id: 'narrow',
      label: 'Narrow (390): region, threads and memory hide, long names truncate, nothing scrolls sideways',
      width: 390,
      render: ({ lang }) => (
        <Bleed>
          <Section kind="data" title={FLEET_WORDS.machines} count={MACHINES.length}>
            <DataTable columns={machineColumns(lang)} rows={MACHINES} rowKey={(m) => m.id} label={FLEET_WORDS.machines} />
          </Section>
        </Bleed>
      ),
    },
    {
      id: 'narrow-grouped',
      label: 'Narrow (390): grouped threads keep the title and the duration',
      width: 390,
      render: ({ lang }) => <Bleed><Threads lang={lang} /></Bleed>,
    },
    {
      id: 'empty',
      label: 'No rows: the header, then the empty content',
      render: ({ lang }) => (
        <Bleed>
          <Section kind="data" title={FLEET_WORDS.threads} count={0}>
            <DataTable columns={threadColumns(lang)} rows={[]} rowKey={(row) => row.id}
              empty={<EmptyState title={FLEET_WORDS.noThreads} body={FLEET_WORDS.noThreadsBody} />} />
          </Section>
        </Bleed>
      ),
    },
  ],
});
