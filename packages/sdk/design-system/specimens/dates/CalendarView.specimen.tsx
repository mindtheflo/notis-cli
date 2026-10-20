import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { CalendarView, Icon, type CalendarItemVariant, type CalendarViewKind } from '../../../src/ui/index';
import {
  CONTENT_LABEL, DATES_TODAY, STATUS_GLYPH, contentCalendar, contentDate, contentEnd, datedContent, type ContentItem,
} from '../../fixtures/dates/dates';
import { clickWhenReady, settle, waitFor } from '../../fixtures/dates/interact';

const NOTHING: readonly ContentItem[] = [];

/** A content calendar that keeps the open item, as a Space does with its peek. */
function Calendar({ lang, items = contentCalendar(lang), view, views, tray, custom, open }: {
  lang: SpecimenLang;
  items?: readonly ContentItem[];
  view?: CalendarViewKind;
  views?: readonly CalendarViewKind[];
  tray?: boolean;
  custom?: boolean;
  open?: string;
}) {
  const [openId, setOpenId] = React.useState<string | null>(open ?? null);
  return (
    <CalendarView<ContentItem>
      items={items}
      getDate={contentDate}
      getEnd={contentEnd}
      defaultView={view}
      views={views}
      tray={tray}
      row={custom ? contentRow : undefined}
      openId={openId}
      onOpen={(item) => setOpenId(item.id)}
      label={CONTENT_LABEL}
      locale={lang}
      today={DATES_TODAY}
    />
  );
}

/** A Space's own row: the status glyph before the title, and the status and owner under it on cards and rows. */
function contentRow(item: ContentItem, variant: CalendarItemVariant): React.ReactNode {
  const glyph = (
    <span className="nui-st" data-st={item.group} role="img" aria-label={item.statusLabel}>
      <Icon name={STATUS_GLYPH[item.group]} />
    </span>
  );
  if (variant === 'chip') {
    return <>{glyph}<span className="nui-cal-chip-text">{item.title}</span></>;
  }
  return (
    <>
      <span className="nui-cal-chip-text">{item.title}</span>
      <span style={{ ...META, ...(variant === 'row' ? { flexShrink: 0 } : { minWidth: 0 }) }}>
        {glyph}
        <span style={CLIP}>{item.statusLabel}</span>
        <span aria-hidden="true">·</span>
        <span>{item.owner}</span>
      </span>
    </>
  );
}

// The book frame loads the toolkit stylesheet only, so the meta line styles itself.
const META: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '16px', color: 'hsl(var(--muted-foreground))',
};
const CLIP: React.CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export const specimen = defineSpecimen({
  id: 'calendar-view',
  name: 'CalendarView',
  group: 'dates',
  from: '@notis/sdk/ui',
  covers: ['CalendarView'],
  summary: 'Month, week and agenda views over the same dated items, with a tray for the items that have no date.',
  states: [
    {
      id: 'month',
      label: 'Month: chips, a multi-day item, a busy day and the No date tray',
      render: ({ lang }) => <Calendar lang={lang} />,
    },
    {
      id: 'month-day-expanded',
      label: 'Month with the busy day expanded from its More link',
      width: 1440,
      render: ({ lang }) => <Calendar lang={lang} />,
      interact: async (root) => {
        await clickWhenReady(root, '.nui-cal-more');
        await settle();
      },
    },
    {
      id: 'item-open',
      label: 'An item open (with the cursor on it)',
      render: ({ lang }) => <Calendar lang={lang} />,
      interact: async (root) => {
        await clickWhenReady(root, '.nui-cal-chip[data-nav-id="CC-21"]');
        await settle();
      },
    },
    {
      id: 'week',
      label: 'Week view: cards per day',
      render: ({ lang }) => <Calendar lang={lang} view="week" />,
    },
    {
      id: 'agenda',
      label: 'Agenda: three weeks as a schedule',
      render: ({ lang }) => <Calendar lang={lang} view="agenda" />,
    },
    {
      id: 'agenda-empty',
      label: 'Agenda with nothing planned',
      render: ({ lang }) => <Calendar lang={lang} items={NOTHING} view="agenda" />,
    },
    {
      id: 'month-empty',
      label: 'Empty month (no items, no tray button)',
      render: ({ lang }) => <Calendar lang={lang} items={NOTHING} />,
    },
    {
      id: 'custom-row',
      label: 'A Space\'s own row: status glyphs on chips and cards',
      render: ({ lang }) => <Calendar lang={lang} custom />,
    },
    {
      id: 'custom-row-week',
      label: 'A Space\'s own row in the week view',
      render: ({ lang }) => <Calendar lang={lang} custom view="week" />,
    },
    {
      id: 'tray-below',
      label: 'Tablet: the tray goes under the grid',
      width: 768,
      render: ({ lang }) => <Calendar lang={lang} />,
    },
    {
      id: 'narrow',
      label: 'Phone: dots and narrow weekday names',
      width: 390,
      render: ({ lang }) => <Calendar lang={lang} />,
    },
    {
      id: 'narrow-more',
      label: 'Phone: dots under the same cap as chips, and the busy day\'s "+N" link',
      width: 390,
      render: ({ lang }) => <Calendar lang={lang} />,
      interact: async (root) => {
        await waitFor(root, '.nui-cal-more');
        await settle();
      },
    },
    {
      id: 'narrow-day-expanded',
      label: 'Phone: the busy day expanded from "+N", every dot shown and the Less link',
      width: 390,
      render: ({ lang }) => <Calendar lang={lang} />,
      interact: async (root) => {
        await clickWhenReady(root, '.nui-cal-more');
        await settle();
      },
    },
    {
      id: 'narrow-week',
      label: 'Phone: the week stacks',
      width: 390,
      render: ({ lang }) => <Calendar lang={lang} view="week" />,
    },
    {
      id: 'month-week-only',
      label: 'Two views offered, every item dated, tray off',
      render: ({ lang }) => <Calendar lang={lang} items={datedContent(lang)} views={['month', 'week']} tray={false} />,
    },
  ],
});
