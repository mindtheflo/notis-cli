import type { ReactNode } from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { Meter, Section, StatRow, formatDuration, formatNumber, type StatMetric } from '../../../src/ui/index';
import { fillWords } from '../../../src/words/index';
import { FLEET_WORDS, MACHINES, type MachineFixture } from '../../fixtures/blocks/fleet';

const GIB = { en: 'GiB', fr: 'Gio' } as const;

/** "8.2 / 36 GiB" / "8,2 / 36 Gio". */
function ofText(used: number, max: number, lang: SpecimenLang): string {
  return `${formatNumber(used, lang)} / ${formatNumber(max, lang)} ${GIB[lang]}`;
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="grid max-w-md gap-5">{children}</div>;
}

/** The memory, disk and CPU meters of one machine; memory alerts at 30 GiB. */
function MachineMeters({ machine, lang }: { machine: MachineFixture; lang: SpecimenLang }) {
  return (
    <>
      <Meter label={FLEET_WORDS.memory} value={machine.memoryUsed} max={machine.memoryMax}
        valueText={ofText(machine.memoryUsed, machine.memoryMax, lang)} limit={30}
        limitLabel={fillWords(FLEET_WORDS.alertAt, { n: `${formatNumber(30, lang)} ${GIB[lang]}` })} hint={machine.apps} />
      <Meter label={FLEET_WORDS.disk} value={machine.diskUsed} max={machine.diskMax}
        valueText={ofText(machine.diskUsed, machine.diskMax, lang)} />
      <Meter label={FLEET_WORDS.cpu} value={machine.cpu} max={100}
        valueText={formatNumber(machine.cpu / 100, lang, { style: 'percent' })} />
    </>
  );
}

/** The five fleet figures over the machine meters, as a live status page lays them out. */
function fleetStats(lang: SpecimenLang): StatMetric[] {
  const online = MACHINES.filter((machine) => machine.online);
  const used = online.reduce((sum, machine) => sum + machine.memoryUsed, 0);
  const max = online.reduce((sum, machine) => sum + machine.memoryMax, 0);
  return [
    { id: 'machines', label: FLEET_WORDS.machines, value: online.length, hint: { en: '1 asleep', fr: '1 en veille' } },
    { id: 'threads', label: FLEET_WORDS.threads, value: 9, previous: 7 },
    { id: 'waiting', label: FLEET_WORDS.waiting, value: 1, previous: 3, higherIsBetter: false },
    { id: 'memory', label: FLEET_WORDS.memory, value: ofText(Math.round(used * 10) / 10, max, lang) },
    { id: 'uptime', label: FLEET_WORDS.uptime, value: formatDuration(MACHINES[0]!.uptimeMs, lang), hint: { en: 'build-1', fr: 'build-1' } },
  ];
}

export const specimen = defineSpecimen({
  id: 'meter',
  name: 'Meter',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Meter'],
  summary: 'How full something is: a label and its figure over a thin track, destructive once it reaches its limit.',
  states: [
    {
      id: 'default',
      label: 'One machine: memory with its limit and a hint, disk, CPU as a percentage',
      render: ({ lang }) => <Stack><MachineMeters machine={MACHINES[0]!} lang={lang} /></Stack>,
    },
    {
      id: 'over-limit',
      label: 'At or over the limit: the whole fill turns destructive, the text stays neutral',
      render: ({ lang }) => <Stack><MachineMeters machine={MACHINES[1]!} lang={lang} /></Stack>,
    },
    {
      id: 'default-text',
      label: 'No valueText: the figure reads value / max in the locale; empty and full tracks',
      render: () => (
        <Stack>
          <Meter label={{ en: 'Seats', fr: 'Places' }} value={7} max={10} />
          <Meter label={{ en: 'Credits used', fr: 'Crédits utilisés' }} value={0} max={1500} />
          <Meter label={{ en: 'Dev stacks', fr: 'Environnements de dev' }} value={16} max={16} limit={16}
            hint={{ en: 'Stop one to start another', fr: 'Arrête-en un pour en lancer un autre' }} />
        </Stack>
      ),
    },
    {
      id: 'dashboard',
      label: 'A fleet status page: five figures on one line, then each machine’s meters (a limit past max draws no tick)',
      render: ({ lang, t }) => (
        <div className="-mx-6">
          <Section kind="stats"><StatRow metrics={fleetStats(lang)} compare="prev" locale={lang} /></Section>
          <div className="grid gap-8 px-6 pt-8 md:grid-cols-3">
            {MACHINES.slice(0, 3).map((machine) => (
              <div key={machine.id} className="grid min-w-0 gap-4">
                <h3 className="m-0 truncate text-sm font-medium">{machine.name}</h3>
                <Meter label={FLEET_WORDS.memory} value={machine.memoryUsed} max={machine.memoryMax}
                  valueText={ofText(machine.memoryUsed, machine.memoryMax, lang)} limit={30} />
                <Meter label={FLEET_WORDS.disk} value={machine.diskUsed} max={machine.diskMax}
                  valueText={ofText(machine.diskUsed, machine.diskMax, lang)} hint={t(machine.apps)} />
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'tones',
      label: 'Tones: a goal met, near, one category among several, over; a reached limit still turns the fill destructive',
      render: () => (
        <Stack>
          <Meter label={{ en: 'Protein', fr: 'Protéines' }} value={128} max={140} tone="success" />
          <Meter label={{ en: 'Calories', fr: 'Calories' }} value={1920} max={2200} tone="warning" />
          <Meter label={{ en: 'Carbs', fr: 'Glucides' }} value={150} max={260} tone="info" />
          <Meter label={{ en: 'Sugar', fr: 'Sucres' }} value={62} max={50} tone="danger" />
          <Meter label={{ en: 'Fat', fr: 'Lipides' }} value={80} max={90} limit={75} tone="success" />
        </Stack>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390): long French labels truncate, the figure stays whole',
      width: 390,
      render: ({ lang }) => <Stack><MachineMeters machine={MACHINES[1]!} lang={lang} /></Stack>,
    },
  ],
});
