import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { Icon, TimelineView, type TimelineLaneInfo, type TimelineZoom } from '../../../src/ui/index';
import {
  AREAS, DATES_TODAY, ROADMAP_LABEL, ROADMAP_LANES, STATUS_GLYPH, projectEnd, projectGroup, projectStart, projectStatus,
  roadmap, roadmapLongTitles, type AreaId, type Project,
} from '../../fixtures/dates/dates';
import { clickWhenReady, settle } from '../../fixtures/dates/interact';

const NOTHING: readonly Project[] = [];

const laneOf = (item: Project): TimelineLaneInfo => ({ id: item.area, label: item.areaLabel });

// Lane lists per language, built once so the view gets the same array on every render.
function lanesFor(ids: readonly AreaId[]): Record<SpecimenLang, readonly TimelineLaneInfo[]> {
  const make = (lang: SpecimenLang) => ids.map((id) => ({ id, label: AREAS[id][lang] }));
  return { en: make('en'), fr: make('fr') };
}
const DECK_LANES = lanesFor(ROADMAP_LANES);
// The long-title roadmap adds a lane with nothing planned yet.
const WITH_MOBILE = lanesFor([...ROADMAP_LANES, 'mobile']);

/** The deck's bar: status glyph, title, owner. */
function projectBar(item: Project): React.ReactNode {
  return (
    <>
      <span className="nui-st" data-st={item.group} aria-hidden="true"><Icon name={STATUS_GLYPH[item.group]} /></span>
      <span className="nui-tl-bar-t">{item.title}</span>
      <span className="nui-avatar" style={{ width: 20, height: 20, fontSize: 10 }} aria-hidden="true">{item.owner}</span>
    </>
  );
}

/** A roadmap that keeps the open project, as a Space does with its peek. */
function Roadmap({ lang, items = roadmap(lang), lanes = DECK_LANES[lang], zoom, plain, open }: {
  lang: SpecimenLang;
  items?: readonly Project[];
  lanes?: readonly TimelineLaneInfo[];
  zoom?: TimelineZoom;
  plain?: boolean;
  open?: string;
}) {
  const [openId, setOpenId] = React.useState<string | null>(open ?? null);
  return (
    <TimelineView<Project>
      items={items}
      getStart={projectStart}
      getEnd={projectEnd}
      lane={laneOf}
      lanes={lanes}
      getGroup={projectGroup}
      getStatus={plain ? undefined : projectStatus}
      bar={plain ? undefined : projectBar}
      defaultZoom={zoom}
      openId={openId}
      onOpen={(item) => setOpenId(item.id)}
      label={ROADMAP_LABEL}
      locale={lang}
      today={DATES_TODAY}
    />
  );
}

export const specimen = defineSpecimen({
  id: 'timeline-view',
  name: 'TimelineView',
  group: 'dates',
  from: '@notis/sdk/ui',
  covers: ['TimelineView'],
  summary: 'A roadmap: bars across days, one lane per area, zoomed by week, month or quarter, with today marked.',
  states: [
    {
      id: 'month',
      label: 'Month zoom: status colours, bars cut at the window edges',
      render: ({ lang }) => <Roadmap lang={lang} />,
    },
    {
      id: 'week',
      label: 'Week zoom',
      render: ({ lang }) => <Roadmap lang={lang} zoom="week" />,
    },
    {
      id: 'quarter',
      label: 'Quarter zoom: every project in sight',
      render: ({ lang }) => <Roadmap lang={lang} zoom="quarter" />,
    },
    {
      id: 'bar-open',
      label: 'A project open (with the cursor on it)',
      render: ({ lang }) => <Roadmap lang={lang} />,
      interact: async (root) => {
        await clickWhenReady(root, '.nui-tl-bar[data-nav-id="PRJ-5"]');
        await settle();
      },
    },
    {
      id: 'plain-bars',
      label: 'Default bars: the title only',
      render: ({ lang }) => <Roadmap lang={lang} plain />,
    },
    {
      id: 'long-titles',
      label: 'Long titles in short bars, and a lane with nothing planned',
      render: ({ lang }) => <Roadmap lang={lang} items={roadmapLongTitles(lang)} lanes={WITH_MOBILE[lang]} zoom="week" />,
    },
    {
      id: 'empty',
      label: 'Nothing planned: lanes stay, with a line saying so',
      render: ({ lang }) => <Roadmap lang={lang} items={NOTHING} />,
    },
    {
      id: 'narrow',
      label: 'Phone: the roadmap scrolls sideways, lanes stay put',
      width: 390,
      render: ({ lang }) => <Roadmap lang={lang} />,
    },
  ],
});
