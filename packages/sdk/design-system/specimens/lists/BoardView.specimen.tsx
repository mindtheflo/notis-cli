import { useEffect, useRef, useState } from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { BoardView, type BoardColumn, type BoardViewProps, type ListReaderApi } from '../../../src/ui/index';
import { inner, settle, waitFor, waitForMenu } from '../../fixtures/lists/interact';

/** The frame height of every state: the board and its reader fill it. */
const TALL = 640;

interface Deal { id: string; company: string; contact: { en: string; fr: string }; value: string; stage: string; owner: string }

const STAGES: readonly BoardColumn[] = [
  { id: 'lead', label: { en: 'Lead', fr: 'Piste' } },
  { id: 'call', label: { en: 'Discovery call', fr: 'Appel découverte' }, tone: 'info' },
  { id: 'proposal', label: { en: 'Proposal sent', fr: 'Proposition envoyée' }, tone: 'warning' },
  { id: 'won', label: { en: 'Won', fr: 'Gagné' }, tone: 'success' },
  { id: 'lost', label: { en: 'Lost', fr: 'Perdu' }, tone: 'danger' },
];

const DEALS: readonly Deal[] = [
  { id: 'D-101', company: 'Acme Bakery', contact: { en: 'Head of operations', fr: 'Responsable des opérations' }, value: '€4,800', stage: 'lead', owner: 'CL' },
  { id: 'D-102', company: 'Bolt Studio', contact: { en: 'Founder', fr: 'Fondatrice' }, value: '€1,200', stage: 'lead', owner: 'FP' },
  { id: 'D-103', company: 'Cove Architects', contact: { en: 'Office manager', fr: 'Responsable administratif' }, value: '€9,600', stage: 'lead', owner: 'CL' },
  { id: 'D-104', company: 'Dune Travel', contact: { en: 'Marketing lead', fr: 'Responsable marketing' }, value: '€3,000', stage: 'call', owner: 'FP' },
  { id: 'D-105', company: 'Ember Coffee Roasters', contact: { en: 'Co-founder', fr: 'Cofondateur' }, value: '€2,400', stage: 'call', owner: 'AM' },
  { id: 'D-106', company: 'Fable Books', contact: { en: 'Owner', fr: 'Propriétaire' }, value: '€6,000', stage: 'proposal', owner: 'CL' },
  { id: 'D-107', company: 'Grove Dental Clinic', contact: { en: 'Practice manager', fr: 'Gérante du cabinet' }, value: '€12,000', stage: 'won', owner: 'AM' },
];

const BOARD_LABEL = { en: 'Deals', fr: 'Affaires' };

/** Moves deals on the page, as a Space does (optimistically), and keeps the open deal. */
function Funnel({ lang, id, initialOpen = null, initialSelected = [], cursor, readOnly, items: start = DEALS, ...rest }: {
  lang: SpecimenLang;
  id: string;
  initialOpen?: string | null;
  initialSelected?: readonly string[];
  cursor?: string;
  readOnly?: boolean;
  items?: readonly Deal[];
} & Partial<BoardViewProps<Deal>>) {
  const [deals, setDeals] = useState(start);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [selected, setSelected] = useState<readonly string[]>(initialSelected);
  const api = useRef<ListReaderApi>(null);
  useEffect(() => { if (cursor) api.current?.focus(cursor); }, [cursor]);
  return (
    <div className="relative flex flex-col bg-background" style={{ height: inner(TALL) }}>
      <BoardView<Deal>
        items={deals}
        getId={(deal) => deal.id}
        columns={STAGES}
        getColumn={(deal) => deal.stage}
        renderTile={(deal) => ({
          title: deal.company,
          subtitle: deal.contact[lang],
          figure: deal.value,
          trailing: <span className="nui-avatar" style={{ width: 20, height: 20, fontSize: 10 }} aria-hidden="true">{deal.owner}</span>,
        })}
        reader={(deal) => (
          <article className="flex flex-col gap-2 p-6">
            <h2 className="text-lg font-semibold">{deal.company}</h2>
            <p className="text-sm text-muted-foreground">{deal.contact[lang]}</p>
            <p className="text-sm">{deal.value}</p>
          </article>
        )}
        readerLabel={(deal) => deal.id}
        onMove={readOnly ? undefined : (ids, to, index) => {
          setDeals((previous) => {
            const moved = previous.filter((deal) => ids.includes(deal.id)).map((deal) => ({ ...deal, stage: to }));
            const rest = previous.filter((deal) => !ids.includes(deal.id));
            const lane = rest.filter((deal) => deal.stage === to);
            const before = index === undefined ? undefined : lane[index];
            const at = before ? rest.indexOf(before) : rest.length;
            return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
          });
        }}
        title={{ text: BOARD_LABEL }}
        label={BOARD_LABEL}
        open={open}
        onOpenChange={(next) => { setOpen(next); }}
        selected={selected}
        onSelectedChange={setSelected}
        openInUrl={false}
        apiRef={api}
        listId={`book-board-${id}`}
        groupCounts
        {...rest}
      />
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'board-view',
  name: 'BoardView',
  group: 'lists',
  from: '@notis/sdk/ui',
  covers: ['BoardView'],
  summary: 'A Kanban board: one column per stage, tiles that open in the reader and move between columns.',
  states: [
    {
      id: 'board',
      label: 'A sales funnel: one column per stage, a tone dot before some labels, an empty column says so',
      height: TALL,
      render: ({ lang }) => <Funnel lang={lang} id="board" />,
    },
    {
      id: 'cursor',
      label: 'The keyboard cursor on a tile (arrows move it within and across columns)',
      height: TALL,
      render: ({ lang }) => <Funnel lang={lang} id="cursor" cursor="D-104" />,
    },
    {
      id: 'selected',
      label: 'Two tiles selected: the selection bar floats as a pill',
      height: TALL,
      render: ({ lang }) => <Funnel lang={lang} id="selected" initialSelected={['D-101', 'D-103']} />,
    },
    {
      id: 'open',
      label: 'A deal open in the reader beside the board',
      height: TALL,
      render: ({ lang }) => <Funnel lang={lang} id="open" initialOpen="D-105" />,
    },
    {
      id: 'move-menu',
      label: 'M: Move to, with the current column checked',
      height: TALL,
      render: ({ lang }) => <Funnel lang={lang} id="move-menu" cursor="D-102" />,
      interact: async (root) => {
        await waitFor(root, '.nui-tile[data-cursor]');
        const scroll = await waitFor(root, '.nui-lr-scroll');
        const target = root.ownerDocument.activeElement ?? scroll;
        const view = root.ownerDocument.defaultView!;
        const init = { key: 'm', code: 'KeyM', bubbles: true, cancelable: true, composed: true };
        target.dispatchEvent(new view.KeyboardEvent('keydown', init));
        target.dispatchEvent(new view.KeyboardEvent('keyup', init));
        await waitForMenu(root);
        await settle();
      },
    },
    {
      id: 'drop-line',
      label: 'Dragging a tile: a line shows where it lands',
      height: TALL,
      render: ({ lang }) => <Funnel lang={lang} id="drop-line" />,
      interact: async (root) => {
        const tile = await waitFor(root, '.nui-tile[data-nui-item="D-101"]');
        const body = await waitFor(root, '.nui-board-col[data-column="call"] .nui-board-body');
        const target = body.querySelector<HTMLElement>('.nui-tile[data-nui-item="D-105"]');
        const view = root.ownerDocument.defaultView!;
        const data = new Map<string, string>();
        const transfer = {
          setData: (key: string, value: string) => { data.set(key, value); },
          getData: (key: string) => data.get(key) ?? '',
          get types() { return [...data.keys()]; },
          setDragImage: () => {},
          effectAllowed: 'all', dropEffect: 'none',
        };
        const fire = (type: string, el: HTMLElement, clientY: number) => {
          const event = new view.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientY });
          Object.defineProperty(event, 'dataTransfer', { value: transfer });
          el.dispatchEvent(event);
        };
        fire('dragstart', tile, 0);
        const box = target?.getBoundingClientRect();
        fire('dragover', body, box ? box.top + 4 : 0);
        await settle(4);
      },
    },
    {
      id: 'read-only',
      label: 'A board without onMove only reads: tiles open, nothing drags',
      height: TALL,
      render: ({ lang }) => <Funnel lang={lang} id="read-only" readOnly />,
    },
    {
      id: 'narrow',
      label: 'Phone: columns about 85% wide snap into place; every open is a slide',
      width: 390,
      height: TALL,
      render: ({ lang }) => <Funnel lang={lang} id="narrow" />,
    },
  ],
});
