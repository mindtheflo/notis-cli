import { useEffect, useMemo } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { NotisProvider, type NotisRuntime } from '../../../src';
import {
  CommentAvatar, CommentPane, CommentPins, CommentThreadCard, useComments,
  type CommentAnchor, type CommentScope, type UseCommentsOptions,
} from '../../../src/ui/index';
import { w } from '../../../src/words/index';
import { bookRuntime } from '../../fixtures/documents/runtimes';

type Ctx = SpecimenRenderContext;

/** The Slides Comments table with its zone columns. */
const ZONE_COLUMNS = { w: 'W', h: 'H' };

const SLIDE_WORDS = { thisAnchor: w('This slide', 'Cette diapositive'), anchorLabel: w('Slide {n}', 'Diapositive {n}'),
  newCommentOn: w('New comment on slide {n}', 'Nouveau commentaire sur la diapositive {n}'),
  newCommentWhole: w('New comment on all of slide {n}', 'Nouveau commentaire sur toute la diapositive {n}'),
  commentOnAnchor: w('Comment on all of slide {n}', 'Commenter toute la diapositive {n}') };

const ANCHORS: CommentAnchor[] = [
  { id: 'slide-1', recordKey: 'slide-1', order: 1, title: 'Why now' },
  { id: 'slide-2', recordKey: 'slide-2', order: 2, title: 'The plan' },
];
const SCOPE: CommentScope = { id: 'deck-1', recordKey: 'deck-1', name: 'Q3 review', checkpoint: '2026-06-14T18:00:00Z' };

interface Seed {
  key: string; body: { en: string; fr: string }; author: string; slide: string; at: string; thread?: string; x?: number; y?: number;
  w?: number; h?: number;
  needs?: string; options?: string; status?: string; change?: string; files?: { name: string; url: string }[];
}

const SEEDS: Seed[] = [
  { key: 'c1', author: 'Flo', slide: 'slide-1', at: '2026-06-15T08:10:00Z', x: 0.22, y: 0.3, change: 'created',
    body: { en: 'The title is too long for the room.', fr: 'Le titre est trop long pour la salle.' } },
  { key: 'r1', author: 'Claude', slide: 'slide-1', at: '2026-06-15T08:40:00Z', thread: 'c1',
    body: { en: 'Shortened to five words.', fr: 'Raccourci à cinq mots.' } },
  { key: 'c2', author: 'Claude', slide: 'slide-1', at: '2026-06-15T09:05:00Z', x: 0.68, y: 0.62, needs: 'check',
    body: { en: 'I moved the chart under the title. Keep it?', fr: 'J’ai déplacé le graphique sous le titre. On le garde ?' } },
  { key: 'z1', author: 'Flo', slide: 'slide-1', at: '2026-06-15T09:08:00Z', x: 0.08, y: 0.55, w: 0.32, h: 0.3,
    body: { en: 'This whole block is hard to read.', fr: 'Tout ce bloc est difficile à lire.' } },
  { key: 'c5', author: 'Flo', slide: 'slide-1', at: '2026-06-15T09:10:00Z',
    body: { en: 'Too many words on this slide.', fr: 'Trop de mots sur cette diapositive.' } },
  { key: 'c3', author: 'Claude', slide: 'slide-1', at: '2026-06-15T09:12:00Z', x: 0.45, y: 0.82, needs: 'choice', options: 'Bar | Line',
    body: { en: 'Which chart reads better from the back row?', fr: 'Quel graphique se lit le mieux du fond de la salle ?' } },
  { key: 'c4', author: 'Flo', slide: 'slide-2', at: '2026-06-14T16:00:00Z', status: 'Resolved',
    body: { en: 'Add the dates.', fr: 'Ajoute les dates.' } },
];

function rows(lang: Ctx['lang'], seeds: Seed[] = SEEDS) {
  const text = (value: string) => ({ type: 'rich_text', rich_text: [{ text: { content: value } }] });
  const select = (value: string) => ({ type: 'select', select: { name: value } });
  return seeds.map(seed => ({
    id: `id-${seed.key}`, record_key: seed.key, revision: 1, title: seed.body[lang], created_at: seed.at,
    properties: {
      Deck: { type: 'relation', relation: [{ id: 'deck-1' }] },
      Slide: { type: 'relation', relation: [{ id: seed.slide }] },
      Author: select(seed.author), Status: select(seed.status ?? 'Open'), Needs: select(seed.needs ?? 'none'),
      Thread: text(seed.thread ?? ''), Options: text(seed.options ?? ''), Answer: text(''),
      ...(seed.x != null ? { X: { type: 'number', number: seed.x }, Y: { type: 'number', number: seed.y } } : {}),
      ...(seed.w != null ? { W: { type: 'number', number: seed.w }, H: { type: 'number', number: seed.h } } : {}),
      ...(seed.change ? { Change: select(seed.change), 'Changed at': { type: 'date', date: { start: seed.at } } } : {}),
      ...(seed.files ? { Attachments: { type: 'files', files: seed.files } } : {}),
    },
  }));
}

/** A flat screenshot as an inline SVG, so the frames never load from the network. */
function screenshot(fill: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">`
    + `<rect width="640" height="400" fill="${fill}"/><rect x="40" y="40" width="560" height="56" rx="8" fill="#fff" opacity=".9"/>`
    + `<rect x="40" y="120" width="360" height="24" rx="6" fill="#fff" opacity=".6"/>`
    + `<text x="320" y="300" font-family="sans-serif" font-size="44" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Asks with pictures: a before and after to pick from, and a check with the agent's own answers. */
const PICTURE_SEEDS: Seed[] = [
  { key: 'p1', author: 'Claude', slide: 'slide-1', at: '2026-06-15T09:20:00Z', needs: 'choice', options: 'Before | After',
    body: { en: 'The floating button covered the last menu. Which spacing do you keep?',
      fr: 'Le bouton flottant cachait le dernier menu. Quel espacement gardes-tu ?' },
    files: [{ name: 'Before.png', url: screenshot('#8a8f98', 'Before') }, { name: 'After.png', url: screenshot('#5b7cfa', 'After') }] },
  { key: 'p2', author: 'Claude', slide: 'slide-1', at: '2026-06-15T09:25:00Z', needs: 'check', options: 'Keep the fix | Hold',
    body: { en: 'The full review is at https://beta.notis.ai/notes/review . May I keep the fix?',
      fr: 'La revue complète est sur https://beta.notis.ai/notes/review . Je garde la correction ?' },
    files: [{ name: 'Menu.png', url: screenshot('#2f9e77', 'Menu') }, { name: 'Review.pdf', url: 'https://example.com/review.pdf' }] },
];

/** The book runtime plus a Comments list that answers from fixtures and writes that succeed without a server. */
function commentRuntime(lang: Ctx['lang'], empty: boolean, seeds: Seed[] = SEEDS): NotisRuntime {
  const base = bookRuntime(lang);
  let next = 0;
  return {
    ...base,
    space: {
      ...base.space!, cacheScope: `comments-book:${lang}:${empty ? 'empty' : seeds === SEEDS ? 'full' : 'pictures'}`,
      actions: { 'comments.insert': { readOnly: false }, 'comments.update': { readOnly: false } },
      shows: { comments: { database: 'comments' } },
      bindings: { comments: { kind: 'database', operations: { insert: 'comments.insert', update: 'comments.update' } } },
    } as unknown as NotisRuntime['space'],
    shown: async () => ({ rows: empty ? [] : rows(lang, seeds), schema_revision: 1 }),
    callAction: async () => ({ record_key: `book-${next += 1}`, revision: 2 }),
  } as unknown as NotisRuntime;
}

type Draft = 'pin' | 'zone' | 'whole' | 'commenting';

function Deck({ anchorKey, draft, options }: { anchorKey: string; draft?: Draft; options?: Partial<UseCommentsOptions> }) {
  const controller = useComments({
    scope: SCOPE, anchors: ANCHORS, anchorKey, authors: ['Flo', 'Claude', 'Notis'], words: SLIDE_WORDS,
    columns: ZONE_COLUMNS, ...options,
  });
  const { placePin, setCommenting, hasData } = controller;
  useEffect(() => {
    if (!hasData) return;
    if (draft === 'pin') placePin(anchorKey, 0.5, 0.45);
    if (draft === 'zone') placePin(anchorKey, 0.55, 0.12, 0.38, 0.34);
    if (draft === 'whole') placePin(anchorKey, null, null);
    if (draft === 'commenting') setCommenting(true);
  }, [draft, hasData, anchorKey, placePin, setCommenting]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, height: 520 }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', alignSelf: 'start', borderRadius: 12,
        background: 'hsl(var(--muted))' }}>
        <CommentPins controller={controller} anchorKey={anchorKey} />
      </div>
      <CommentPane controller={controller} />
    </div>
  );
}

function Demo({ ctx, empty = false, draft }: { ctx: Ctx; empty?: boolean; draft?: Draft }) {
  const runtime = useMemo(() => commentRuntime(ctx.lang, empty), [ctx.lang, empty]);
  return <NotisProvider runtime={runtime}><Deck anchorKey="slide-1" draft={draft} /></NotisProvider>;
}

function PicturesDemo({ ctx }: { ctx: Ctx }) {
  const runtime = useMemo(() => commentRuntime(ctx.lang, false, PICTURE_SEEDS), [ctx.lang]);
  return <NotisProvider runtime={runtime}><PicturesPane /></NotisProvider>;
}

/** The pane alone, as a Space's side panel shows it. */
function PicturesPane() {
  const controller = useComments({
    scope: SCOPE, anchors: ANCHORS, anchorKey: 'slide-1', authors: ['Flo', 'Claude', 'Notis'], words: SLIDE_WORDS,
  });
  return <div style={{ maxWidth: 360 }}><CommentPane controller={controller} /></div>;
}

function CardOnly({ ctx }: { ctx: Ctx }) {
  const runtime = useMemo(() => commentRuntime(ctx.lang, false), [ctx.lang]);
  return <NotisProvider runtime={runtime}><Card /></NotisProvider>;
}

function Card() {
  const controller = useComments({
    scope: SCOPE, anchors: ANCHORS, anchorKey: 'slide-1', authors: ['Flo', 'Claude', 'Notis'], columns: ZONE_COLUMNS,
  });
  const thread = controller.threads[0];
  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 340 }}>
      <div style={{ display: 'flex', gap: 8 }}><CommentAvatar author="Flo" me="Flo" /><CommentAvatar author="Claude" me="Flo" /></div>
      {thread ? <CommentThreadCard controller={controller} thread={thread} showAnchor /> : null}
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'comment-pane',
  name: 'CommentPane',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['CommentPane', 'CommentThreadCard', 'NewCommentBox', 'CommentPins', 'CommentAvatar'],
  summary: 'Review comments on a page: pins, zones and whole-item comments with replies, pictures and files, asks the agent waits on (answered from under a picture), Resolve and Copy changes.',
  states: [
    {
      id: 'threads',
      label: 'A slide with pins, a zone, a whole-slide comment, a reply, a check and a choice to answer',
      height: 560,
      render: ctx => <Demo ctx={ctx} />,
    },
    {
      id: 'new-comment',
      label: 'A pin placed: the new comment box takes focus',
      height: 560,
      render: ctx => <Demo ctx={ctx} draft="pin" />,
    },
    {
      id: 'new-zone',
      label: 'A zone dragged on the slide: the new comment box takes focus',
      height: 560,
      render: ctx => <Demo ctx={ctx} draft="zone" />,
    },
    {
      id: 'new-whole',
      label: 'A comment on the whole slide, with no pin',
      height: 560,
      render: ctx => <Demo ctx={ctx} draft="whole" />,
    },
    {
      id: 'commenting',
      label: 'Add comment mode: click to pin, hold and drag to mark a zone',
      height: 560,
      render: ctx => <Demo ctx={ctx} draft="commenting" />,
    },
    {
      id: 'pictures',
      label: 'Asks with pictures: pick the before or the after, a check with the agent\'s own answers, a link and a file',
      render: ctx => <PicturesDemo ctx={ctx} />,
    },
    {
      id: 'empty',
      label: 'No comments yet',
      height: 560,
      render: ctx => <Demo ctx={ctx} empty />,
    },
    {
      id: 'card',
      label: 'One thread card and the avatars on their own',
      render: ctx => <CardOnly ctx={ctx} />,
    },
  ],
});
