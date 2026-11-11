import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { InfoTip, StatRow, type StatMetric } from '../../../src/ui/index';
import { w } from '../../../src/words/index';

const STACKS = w('Dev stacks', 'Stacks de dev');
const HOW = w(
  'Counted on machines that are on. A stack a thread no longer holds still counts until the machine frees it.',
  'Compté sur les machines allumées. Une stack qu’aucun fil ne tient compte encore tant que la machine ne l’a pas libérée.',
);

function figures(lang: SpecimenLang): StatMetric[] {
  return [
    { id: 'threads', label: w('Running threads', 'Fils en cours'), value: 9 },
    { id: 'stacks', label: STACKS, value: '4 / 10', about: <InfoTip label={STACKS}>{HOW[lang]}</InfoTip> },
    { id: 'waiting', label: w('Starts waiting', 'Démarrages en attente'), value: 1, hint: w('On notis-sandbox', 'Sur notis-sandbox') },
  ];
}

export const specimen = defineSpecimen({
  id: 'infotip',
  name: 'InfoTip',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['InfoTip'],
  summary: 'A small info button beside a label: a press or a tap opens how the figure is counted, instead of prose on the page.',
  states: [
    {
      id: 'beside-a-label',
      label: 'Beside a heading',
      render: ({ lang }) => (
        <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
          <span>{STACKS[lang]}</span>
          <InfoTip label={STACKS}>{HOW[lang]}</InfoTip>
        </div>
      ),
    },
    {
      id: 'in-a-figure',
      label: 'In a StatRow figure, through `about`',
      render: ({ lang }) => <StatRow metrics={figures(lang)} compare="none" locale={lang} />,
    },
  ],
});
