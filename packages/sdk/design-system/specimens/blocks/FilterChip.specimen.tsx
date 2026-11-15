import { useState } from 'react';
import { defineSpecimen } from '../../specimen';
import { FilterChip } from '../../../src/ui/index';
import { w } from '../../../src/words/index';

const FILTERS = [
  { id: 'initiative', label: w('Podcasts', 'Podcasts') },
  { id: 'owner', label: w('Assigned to me', 'Assignés à moi') },
  { id: 'long', label: w('Partnerships with a very long initiative name', 'Partenariats avec un nom d’initiative très long') },
];

function Removable() {
  const [shown, setShown] = useState(FILTERS);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map(({ id, label }) => (
        <FilterChip key={id} label={label} onClear={() => setShown((list) => list.filter((item) => item.id !== id))} />
      ))}
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'filter-chip',
  name: 'FilterChip',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['FilterChip'],
  summary: 'A filter the view applies, as a chip whose x clears it. ListReader draws its filters with it.',
  states: [
    {
      id: 'chips',
      label: 'Filters, a long one truncated; each x clears its own',
      render: () => <Removable />,
    },
  ],
});
