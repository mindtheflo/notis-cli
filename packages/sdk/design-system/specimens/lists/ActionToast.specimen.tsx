import type { ReactNode } from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenRenderContext } from '../../specimen';
import {
  ACTION_WORDS, ActionToast, LIST_READER_WORDS, Row, failedItemsWords,
  type ActionToastState,
} from '../../../src/ui';
import { actionToast, type Words } from '../../../src/words';
import { LIST_COPY, TICKETS, ticketById } from '../../fixtures/lists/tickets';
import { MOVE_OPTIONS, StarMark, TicketMeta, movedWords } from '../../fixtures/lists/views';
import { inner } from '../../fixtures/lists/interact';
import { ListRows } from '../../fixtures/lists/rows';

type Ctx = SpecimenRenderContext;

const noop = () => undefined;

const COPY = {
  undoOffered: { en: 'Undo offered (Z)', fr: 'Annulation proposée (Z)' },
  wordsOnly: { en: 'Words only', fr: 'Message seul' },
  undone: { en: 'After Undo', fr: 'Après l’annulation' },
  failed: { en: 'Failed, with a reason', fr: 'Échec, avec la raison' },
  someFailed: { en: 'Some items failed', fr: 'Certains éléments ont échoué' },
  undoFailed: { en: 'Undo failed', fr: 'L’annulation a échoué' },
  keptOpen: { en: 'The reader kept its item open', fr: 'Le lecteur a gardé son élément ouvert' },
  /** The reason when the three selected tickets (NB-418, NB-417, NB-416) all failed. */
  lockedMany: {
    en: 'These tickets are locked by release 2.14.',
    fr: 'Ces tickets sont verrouillés par la mise en production 2.14.',
  },
  /** A Space's own note under the words (default tone). */
  sentNote: {
    en: 'Alice Martin gets an email once the release ships.',
    fr: 'Alice Martin recevra un e-mail une fois la mise en production faite.',
  },
} as const satisfies Readonly<Record<string, SpecimenCopy>>;

const ROADMAP = MOVE_OPTIONS.find((option) => option.value === 'roadmap')?.label ?? 'Roadmap';

/** A toast as `useToast` holds it. */
function toast(words: Words, patch: Partial<Omit<ActionToastState, 'id' | 'words'>> = {}): ActionToastState {
  return { id: 1, words, reason: null, tone: 'default', undo: null, undoing: false, ...patch };
}

const COMPLETED_TWO = toast(actionToast('complete', 2)!, { undo: noop });
const ARCHIVED_ONE = toast(actionToast('archive', 1)!, { undo: noop });
const MOVED = toast(movedWords(ROADMAP), { undo: noop });
const ASSIGNED = toast(LIST_COPY.assigned);
const UNDOING = toast(actionToast('complete', 2)!, { undo: noop, undoing: true });
const UNDONE = toast(ACTION_WORDS.undone);
const FAILED = toast(ACTION_WORDS.failed, { tone: 'danger', reason: LIST_COPY.denied });
const FAILED_ONE = toast(failedItemsWords(1), { tone: 'danger', reason: LIST_COPY.denied });
const FAILED_MANY = toast(failedItemsWords(3), { tone: 'danger', reason: COPY.lockedMany });
const UNDO_FAILED = toast(ACTION_WORDS.undoFailed, { tone: 'danger', reason: LIST_COPY.denied });
const KEPT_OPEN = toast(LIST_READER_WORDS.keptOpen);
const WITH_NOTE = toast(actionToast('complete', 1)!, { undo: noop, reason: COPY.sentNote });

/** The bottom of the Tickets list, the toast floating over it as it does in a ListReader; the first `select` checked. */
function TicketRows({ ctx, count = 3, select = 0 }: { ctx: Ctx; count?: number; select?: number }) {
  const { t } = ctx;
  const ids = TICKETS.slice(0, count).map((ticket) => ticket.id);
  return (
    <div className="pt-2">
      <ListRows ids={ids} selected={ids.slice(0, select)} row={(id) => {
        const ticket = ticketById(id);
        return (
          <Row icon={{ status: ticket.status }} title={t(ticket.title)} meta={<TicketMeta ticket={ticket} t={t} />}
            owner={{ name: ticket.owner.name }} time={ticket.updated}
            trailing={ticket.starred ? <StarMark /> : undefined} />
        );
      }} />
    </div>
  );
}

/** A list area `height` px tall: the toast sits 18px above its bottom edge. */
function Stage({ height, rows, children }: { height: number; rows?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative bg-background" style={{ height }}>
      {rows}
      {children}
    </div>
  );
}

function Toast({ value, dismiss = false }: { value: ActionToastState; dismiss?: boolean }) {
  return <ActionToast toast={value} onUndo={noop} onDismiss={dismiss ? noop : undefined} />;
}

/**
 * Every kind of toast, one per stage. Only the first offers Undo (Z has one owner), so Undoing has its own state.
 * Two columns from 768 px, one below; stages grow where the words wrap to more lines.
 */
function Gallery({ ctx }: { ctx: Ctx }) {
  const stage = ctx.width >= 1024 ? 88 : 128;
  const entries: ReadonlyArray<{ caption: SpecimenCopy; value: ActionToastState; dismiss?: boolean }> = [
    { caption: COPY.undoOffered, value: COMPLETED_TWO },
    { caption: COPY.wordsOnly, value: ASSIGNED },
    { caption: COPY.undone, value: UNDONE },
    { caption: COPY.failed, value: FAILED, dismiss: true },
    { caption: COPY.someFailed, value: FAILED_MANY, dismiss: true },
    { caption: COPY.undoFailed, value: UNDO_FAILED, dismiss: true },
    { caption: COPY.keptOpen, value: KEPT_OPEN },
  ];
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 bg-background md:grid-cols-2">
      {entries.map((entry) => (
        <div key={ctx.t(entry.caption)} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{ctx.t(entry.caption)}</span>
          <Stage height={stage}><Toast value={entry.value} dismiss={entry.dismiss} /></Stage>
        </div>
      ))}
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'action-toast',
  name: 'ActionToast',
  group: 'lists',
  from: '@notis/sdk/ui',
  covers: ['ActionToast'],
  summary: 'The words after an action at the bottom of its list: Undo with Z, a muted reason line, Dismiss, and tone danger for failures.',
  states: [
    {
      id: 'all',
      label: 'Every kind side by side',
      render: (ctx) => <Gallery ctx={ctx} />,
    },
    {
      id: 'undo',
      label: 'Two tickets completed: Undo, and Z undoes',
      height: 270,
      render: (ctx) => (
        <Stage height={inner(270)} rows={<TicketRows ctx={ctx} />}>
          <Toast value={COMPLETED_TWO} />
        </Stage>
      ),
    },
    {
      id: 'one',
      label: 'One item archived',
      height: 120,
      render: () => <Stage height={inner(120)}><Toast value={ARCHIVED_ONE} /></Stage>,
    },
    {
      id: 'moved',
      label: 'Moved to Roadmap: the picked option in the words',
      height: 120,
      render: () => <Stage height={inner(120)}><Toast value={MOVED} /></Stage>,
    },
    {
      id: 'words-only',
      label: 'Words only: the action returned no Undo',
      height: 120,
      render: () => <Stage height={inner(120)}><Toast value={ASSIGNED} /></Stage>,
    },
    {
      id: 'note',
      label: 'With a note under the words',
      height: 140,
      render: () => <Stage height={inner(140)}><Toast value={WITH_NOTE} /></Stage>,
    },
    {
      id: 'dismiss',
      label: 'With Dismiss',
      height: 120,
      render: () => <Stage height={inner(120)}><Toast value={COMPLETED_TWO} dismiss /></Stage>,
    },
    {
      id: 'undoing',
      label: 'Undo running: the button says so, Z does nothing, Dismiss hides',
      height: 120,
      render: () => <Stage height={inner(120)}><Toast value={UNDOING} dismiss /></Stage>,
    },
    {
      id: 'undone',
      label: 'After Undo',
      height: 120,
      render: () => <Stage height={inner(120)}><Toast value={UNDONE} /></Stage>,
    },
    {
      id: 'failed',
      label: 'Failed (tone danger): the reason under it, Dismiss',
      height: 140,
      render: () => <Stage height={inner(140)}><Toast value={FAILED} dismiss /></Stage>,
    },
    {
      id: 'failed-one',
      label: 'One item failed in a run that changed others',
      height: 140,
      render: () => <Stage height={inner(140)}><Toast value={FAILED_ONE} dismiss /></Stage>,
    },
    {
      id: 'failed-many',
      label: 'Three items failed: they stay selected',
      height: 270,
      render: (ctx) => (
        <Stage height={inner(270)} rows={<TicketRows ctx={ctx} select={3} />}>
          <Toast value={FAILED_MANY} dismiss />
        </Stage>
      ),
    },
    {
      id: 'undo-failed',
      label: 'Undo failed',
      height: 140,
      render: () => <Stage height={inner(140)}><Toast value={UNDO_FAILED} dismiss /></Stage>,
    },
    {
      id: 'kept-open',
      label: 'The reader refused to change item',
      height: 120,
      render: () => <Stage height={inner(120)}><Toast value={KEPT_OPEN} /></Stage>,
    },
    {
      id: 'phone',
      label: 'Phone width: long words wrap inside the toast',
      width: 390,
      height: 160,
      render: () => <Stage height={inner(160)}><Toast value={FAILED_MANY} dismiss /></Stage>,
    },
    {
      id: 'dark',
      label: 'Dark theme',
      theme: 'dark',
      height: 270,
      render: (ctx) => (
        <Stage height={inner(270)} rows={<TicketRows ctx={ctx} />}>
          <Toast value={COMPLETED_TWO} dismiss />
        </Stage>
      ),
    },
    {
      id: 'dark-failed',
      label: 'Dark theme, failed',
      theme: 'dark',
      height: 140,
      render: () => <Stage height={inner(140)}><Toast value={FAILED} dismiss /></Stage>,
    },
  ],
});
