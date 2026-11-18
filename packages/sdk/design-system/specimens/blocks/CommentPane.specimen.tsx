import { useEffect, useMemo, useRef } from 'react';
import { defineSpecimen, type SpecimenRenderContext } from '../../specimen';
import { SpaceFileError, type NotisRuntime, type SpaceCommentRow, type SpaceCommentsTransport } from '../../../src';
import {
  CommentAgentBadge, CommentAgentSource, CommentAttachButton, CommentDropVeil, CommentFileChips, CommentPane,
  CommentPins, CommentToolBar, useCommentFiles, useComments,
  type CommentAnchor, type CommentMode, type CommentScope, type UseCommentsOptions,
} from '../../../src/ui/index';
import { w } from '../../../src/words/index';
import { bookRuntime } from '../../fixtures/documents/runtimes';
import { HostCommentsProvider, HostPanelSlot, ROUTING_FIXTURE } from '../hostCommentsPanel';

type Ctx = SpecimenRenderContext;

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
  needs?: SpaceCommentRow['needs']; options?: string[]; status?: SpaceCommentRow['status']; change?: SpaceCommentRow['change'];
  files?: { name: string; url: string }[];
  /** When its author edited it: the card reads "edited". */
  editedAt?: string;
  /** Another page of the Space (a deck), for the Space home. */
  deck?: string;
  /**
   * The server's stamp of the agent that wrote it (`row.agent`): a thread link only for its owner, and what it ran on
   * (the logo and hover card beside its name).
   */
  agent?: { name: string; thread_id?: string; runtime?: Record<string, string | null> };
}

/** The agents' runtimes: a Codex sub-agent at high intelligence on the Fast speed, and Notis on Claude. */
const CODEX_RUNTIME = { provider: 'codex', label: 'Codex', model: 'gpt-5.5-codex', intelligence: 'high', effort: null, speed: 'priority' };
const NOTIS_RUNTIME = { provider: 'notis', label: null, model: 'claude-opus-5.5', intelligence: 'medium', effort: null, speed: null };

const SEEDS: Seed[] = [
  { key: 'c1', author: 'Flo', slide: 'slide-1', at: '2026-06-15T08:10:00Z', x: 0.22, y: 0.3, change: 'created',
    body: { en: 'The title is too long for the room.', fr: 'Le titre est trop long pour la salle.' } },
  { key: 'r1', author: 'fred-and-the-machine', slide: 'slide-1', at: '2026-06-15T08:40:00Z', thread: 'c1',
    agent: { name: 'fred-and-the-machine', thread_id: 'thread-editor', runtime: CODEX_RUNTIME },
    body: { en: 'Shortened to five words.', fr: 'Raccourci à cinq mots.' } },
  { key: 'c2', author: 'Notis', slide: 'slide-1', at: '2026-06-15T09:05:00Z', x: 0.68, y: 0.62, needs: 'check',
    agent: { name: 'Notis', runtime: NOTIS_RUNTIME },
    body: { en: 'I moved the chart under the title. Keep it?', fr: 'J’ai déplacé le graphique sous le titre. On le garde ?' } },
  { key: 'z1', author: 'Flo', slide: 'slide-1', at: '2026-06-15T09:08:00Z', x: 0.08, y: 0.55, w: 0.32, h: 0.3,
    body: { en: 'This whole block is hard to read.', fr: 'Tout ce bloc est difficile à lire.' } },
  { key: 'c5', author: 'Flo', slide: 'slide-1', at: '2026-06-15T09:10:00Z',
    body: { en: 'Too many words on this slide.', fr: 'Trop de mots sur cette diapositive.' } },
  { key: 'c3', author: 'Claude', slide: 'slide-1', at: '2026-06-15T09:12:00Z', x: 0.45, y: 0.82, needs: 'choice', options: ['Bar', 'Line'],
    body: { en: 'Which chart reads better from the back row?', fr: 'Quel graphique se lit le mieux du fond de la salle ?' } },
  { key: 'c4', author: 'Flo', slide: 'slide-2', at: '2026-06-14T16:00:00Z', status: 'archived',
    body: { en: 'Add the dates.', fr: 'Ajoute les dates.' } },
];

/** A thread with an edited comment and a deleted reply, and comments on a second deck, for the Space home. */
const HOME_SEEDS: Seed[] = [
  { key: 'h1', author: 'Flo', slide: 'slide-1', at: '2026-06-15T08:10:00Z', editedAt: '2026-06-15T08:20:00Z',
    body: { en: 'The title is too long for the room.', fr: 'Le titre est trop long pour la salle.' } },
  { key: 'h2', author: 'Claude', slide: 'slide-1', at: '2026-06-15T08:30:00Z', thread: 'h1', status: 'deleted',
    body: { en: '', fr: '' } },
  { key: 'h3', author: 'Flo', slide: 'slide-1', at: '2026-06-15T08:50:00Z', thread: 'h1',
    body: { en: 'Better now.', fr: 'Mieux maintenant.' } },
  { key: 'h4', author: 'Claude', slide: 'slide-2', at: '2026-06-15T09:30:00Z', deck: 'deck-2',
    body: { en: 'The launch date moved to Tuesday.', fr: 'La date de lancement passe à mardi.' } },
];

/** The seeds as comment store rows, in the viewer's language. Flo is the viewer. */
function rows(lang: Ctx['lang'], seeds: Seed[] = SEEDS): Partial<SpaceCommentRow>[] {
  return seeds.map(seed => ({
    id: seed.key, page_key: seed.deck ?? 'deck-1', thread_root_id: seed.thread ?? null,
    mode: seed.w != null ? 'box' : seed.x != null ? 'point' : 'page', anchor_keys: [seed.slide],
    x: seed.x ?? null, y: seed.y ?? null, w: seed.w ?? null, h: seed.h ?? null,
    body: seed.body[lang], status: seed.status ?? 'open', needs: seed.needs ?? 'none', options: seed.options ?? [],
    change: seed.change ?? (seed.thread ? 'replied' : 'created'), created_at: seed.at, changed_at: seed.at,
    edited_at: seed.editedAt ?? null, deleted_at: seed.status === 'deleted' ? seed.at : null,
    attachments: (seed.files ?? []).map(file => ({ ...file, type: file.name.endsWith('.pdf') ? 'application/pdf' : 'image/svg+xml' })),
    author: seed.agent
      ? { user_id: 'user-flo', name: 'Flo', you: false }
      : { user_id: seed.author === 'Flo' ? 'user-flo' : `user-${seed.author.toLowerCase()}`, name: seed.author, you: seed.author === 'Flo' },
    agent: seed.agent ?? null,
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
  { key: 'p1', author: 'Claude', slide: 'slide-1', at: '2026-06-15T09:20:00Z', needs: 'choice', options: ['Before', 'After'],
    body: { en: 'The floating button covered the last menu. Which spacing do you keep?',
      fr: 'Le bouton flottant cachait le dernier menu. Quel espacement gardes-tu ?' },
    files: [{ name: 'Before.png', url: screenshot('#8a8f98', 'Before') }, { name: 'After.png', url: screenshot('#5b7cfa', 'After') }] },
  { key: 'p2', author: 'Claude', slide: 'slide-1', at: '2026-06-15T09:25:00Z', needs: 'check', options: ['Keep the fix', 'Hold'],
    body: { en: 'The full review is at https://beta.notis.ai/notes/review . May I keep the fix?',
      fr: 'La revue complète est sur https://beta.notis.ai/notes/review . Je garde la correction ?' },
    files: [{ name: 'Menu.png', url: screenshot('#2f9e77', 'Menu') }, { name: 'Review.pdf', url: 'https://example.com/review.pdf' }] },
];

/** The book runtime, with a thread the agent links open. The comments come from the host's store (HostCommentsProvider). */
function commentRuntime(lang: Ctx['lang']): NotisRuntime {
  const base = bookRuntime(lang);
  return { ...base, spaceThreads: { open: async () => true } } as unknown as NotisRuntime;
}

/** A host that uploads: pictures finish, a PDF keeps uploading, and a file over the limit is refused. */
const SHOT = 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAeCAIAAADlxgqWAAAANElEQVR42u3OMREAMAgAMXxipcpZQEQHGPL3AhJ9rAACAgLaBuWrUwMBAQEBAQEBAQEB/T3tbDKVJhI70wAAAABJRU5ErkJggg==';
const SHOT_URL = `data:image/png;base64,${SHOT}`;
const UPLOADS: Partial<SpaceCommentsTransport> = {
  maxFileBytes: 8 * 1024 * 1024,
  upload: async input => {
    const name = input.name ?? 'file';
    if (name.endsWith('.pdf')) { input.onProgress?.(input.file.size * 0.4, input.file.size); return new Promise(() => {}); }
    if (name.endsWith('.mov')) throw new SpaceFileError('Unsupported', 'space_file_type_unsupported', 415);
    return { path: `comments/${name}`, name, url: SHOT_URL, previewUrl: SHOT_URL, size: input.file.size, type: 'image/png' };
  },
};

type Draft = 'pin' | 'zone' | 'whole' | 'commenting';

function Deck({ anchorKey, draft, options, toolBar }: {
  anchorKey: string; draft?: Draft; options?: Partial<UseCommentsOptions>;
  /** Shows the page comment tool bar, with this mode waiting for a point (true: no mode yet). */
  toolBar?: CommentMode | true;
}) {
  const controller = useComments({
    scope: SCOPE, anchors: ANCHORS, anchorKey, words: SLIDE_WORDS, ...options,
  });
  const { placePin, setCommenting, setToolBar, startMode, hasData } = controller;
  useEffect(() => {
    if (!hasData) return;
    if (draft === 'pin') placePin(anchorKey, 0.5, 0.45);
    if (draft === 'zone') placePin(anchorKey, 0.55, 0.12, 0.38, 0.34);
    if (draft === 'whole') placePin(anchorKey, null, null);
    if (draft === 'commenting') setCommenting(true);
  }, [draft, hasData, anchorKey, placePin, setCommenting]);
  useEffect(() => {
    if (!hasData || !toolBar) return;
    setToolBar(true);
    if (toolBar !== true) startMode(toolBar);
  }, [toolBar, hasData, setToolBar, startMode]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, height: 520 }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', alignSelf: 'start', borderRadius: 12,
        background: 'hsl(var(--muted))' }}>
        <CommentPins controller={controller} anchorKey={anchorKey} />
        <CommentToolBar controller={controller} toggleKey={false} />
      </div>
      <CommentPane controller={controller} />
      <HostPanelSlot />
    </div>
  );
}

function Demo({ ctx, empty = false, draft, routing = false, toolBar }: {
  ctx: Ctx; empty?: boolean; draft?: Draft; routing?: boolean; toolBar?: CommentMode | true;
}) {
  const runtime = useMemo(() => commentRuntime(ctx.lang), [ctx.lang]);
  const seeded = useMemo(() => (empty ? [] : rows(ctx.lang)), [ctx.lang, empty]);
  return (
    <HostCommentsProvider runtime={runtime} rows={seeded} routing={routing ? ROUTING_FIXTURE : undefined}>
      <Deck anchorKey="slide-1" draft={draft} toolBar={toolBar} options={toolBar ? { onStartItems: () => {} } : undefined} />
    </HostCommentsProvider>
  );
}

/** The Space home: no scope, so the pane lists every comment of the Space, grouped by page. */
function HomeDemo({ ctx }: { ctx: Ctx }) {
  const runtime = useMemo(() => commentRuntime(ctx.lang), [ctx.lang]);
  const seeded = useMemo(() => rows(ctx.lang, HOME_SEEDS), [ctx.lang]);
  return <HostCommentsProvider runtime={runtime} rows={seeded}><HomePane /></HostCommentsProvider>;
}

function HomePane() {
  const controller = useComments({ scopeNames: { 'deck-1': 'Q3 review', 'deck-2': 'Launch' } });
  return <div style={{ maxWidth: 360 }}><CommentPane controller={controller} /><HostPanelSlot /></div>;
}

function PicturesDemo({ ctx }: { ctx: Ctx }) {
  const runtime = useMemo(() => commentRuntime(ctx.lang), [ctx.lang]);
  const seeded = useMemo(() => rows(ctx.lang, PICTURE_SEEDS), [ctx.lang]);
  return <HostCommentsProvider runtime={runtime} rows={seeded}><PicturesPane /></HostCommentsProvider>;
}

/** The pane alone, as a Space's side panel shows it. */
function PicturesPane() {
  const controller = useComments({
    scope: SCOPE, anchors: ANCHORS, anchorKey: 'slide-1', words: SLIDE_WORDS,
  });
  return <div style={{ maxWidth: 360 }}><CommentPane controller={controller} /><HostPanelSlot /></div>;
}

function AttachingDemo({ ctx }: { ctx: Ctx }) {
  const runtime = useMemo(() => commentRuntime(ctx.lang), [ctx.lang]);
  return <HostCommentsProvider runtime={runtime} rows={NO_ROWS} more={UPLOADS}><AttachingBox lang={ctx.lang} /></HostCommentsProvider>;
}

/** A Space that lays out its own comment box with the toolkit's attachment pieces: chips, the paperclip, the drop veil. */
function AttachingBox({ lang }: { lang: Ctx['lang'] }) {
  const controller = useComments({ scope: SCOPE, anchors: ANCHORS, anchorKey: 'slide-1', words: SLIDE_WORDS });
  const files = useCommentFiles(controller);
  const started = useRef(false);
  const { attach } = controller;
  const { add } = files;
  useEffect(() => {
    if (attach !== 'on' || started.current) return;
    started.current = true;
    const bytes = Uint8Array.from(atob(SHOT), char => char.charCodeAt(0));
    add([new File([bytes], 'Menu overlap.png', { type: 'image/png' }), new File([new Uint8Array(4096)], 'Brief.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array(16)], 'Screen recording.mov', { type: 'video/quicktime' })]);
  }, [attach, add]);
  return (
    <div style={{ maxWidth: 360 }}>
      <div className="nui-comment-new-box" {...files.boxHandlers}>
        <p className="nui-comment-new-title">{controller.say('newCommentOn', { n: 1 })}</p>
        <textarea className="nui-comment-input" rows={2} readOnly aria-label={controller.say('commentPlaceholder')}
          value={lang === 'fr' ? 'Le menu passe sous le bouton.' : 'The menu slides under the button.'} />
        <CommentFileChips controller={controller} files={files} />
        <div className="nui-comment-new-actions">
          <CommentAttachButton controller={controller} files={files} />
          <span className="nui-comment-new-gap" />
        </div>
        <CommentDropVeil controller={controller} files={files} />
      </div>
    </div>
  );
}

const NO_ROWS: Partial<SpaceCommentRow>[] = [];

function CardOnly({ ctx, runtimeCard = false }: { ctx: Ctx; runtimeCard?: boolean }) {
  const runtime = useMemo(() => commentRuntime(ctx.lang), [ctx.lang]);
  const seeded = useMemo(() => rows(ctx.lang).filter(row => row.id === 'c1' || row.id === 'r1'), [ctx.lang]);
  return (
    <HostCommentsProvider runtime={runtime} rows={seeded} routing={ROUTING_FIXTURE}>
      {runtimeCard ? <RuntimeCard /> : <Card />}
    </HostCommentsProvider>
  );
}

/** The pieces a Space lays out itself beside the pane: an agent's logo with its runtime card, and its From line. */
function Card() {
  const controller = useComments({ scope: SCOPE, anchors: ANCHORS, anchorKey: 'slide-1' });
  const thread = controller.threads.find(item => item.root.recordKey === 'c1');
  const reply = thread?.replies[0];
  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 340 }}>
      {reply ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CommentAgentBadge controller={controller} comment={reply} /><CommentAgentSource controller={controller} comment={reply} />
        </div>
      ) : null}
      <CommentPane controller={controller} />
      <div style={{ height: 320 }}><HostPanelSlot /></div>
    </div>
  );
}

/** The thread's card with the reply's runtime card open, as hover or keyboard focus shows it. */
function RuntimeCard() {
  const controller = useComments({ scope: SCOPE, anchors: ANCHORS, anchorKey: 'slide-1' });
  const box = useRef<HTMLDivElement>(null);
  const shown = controller.threads.length;
  useEffect(() => {
    const badge = box.current?.querySelector<HTMLElement>('[data-comment="r1"] [data-part="agent-runtime"]');
    badge?.focus({ preventScroll: true });
  }, [shown]);
  return (
    <div ref={box} style={{ display: 'grid', gap: 12, maxWidth: 340, paddingBottom: 160 }}>
      <CommentPane controller={controller} />
      <div style={{ height: 320 }}><HostPanelSlot /></div>
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'comment-pane',
  name: 'CommentPane',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['CommentPane', 'CommentPins', 'CommentFileChips',
    'CommentAttachButton', 'CommentDropVeil', 'CommentAgentSource', 'CommentAgentBadge', 'CommentToolBar'],
  summary: 'Review comments on a page: pins, zones and whole-item comments with replies, pictures and files (pasted, dropped or picked before Send), asks the agent waits on (answered from under a picture), Archive (E) with Undo, the Open, Done and All filter, Edit and Delete by your rights, where a reply goes, the New comment modes and the page tool bar (C), and Copy changes. Each card names the thread that owns it once at its top; a comment an agent wrote is signed with its name (a band name reads "Fred And The Machine") and its harness logo, whose hover card says what it ran on.',
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
      id: 'routing',
      label: 'Where comments go: the thread that owns each card at its top ("Thread" when linked, else "Goes to") with Change, and the To chip of a new comment',
      height: 560,
      render: ctx => <Demo ctx={ctx} draft="pin" routing />,
    },
    {
      id: 'tool-bar',
      label: 'The page comment tool bar (C): a mode waits for a point, with its hint',
      height: 560,
      render: ctx => <Demo ctx={ctx} toolBar="point" />,
    },
    {
      id: 'space-home',
      label: 'The Space home groups comments by page; an edited comment and a deleted reply',
      render: ctx => <HomeDemo ctx={ctx} />,
    },
    {
      id: 'pictures',
      label: 'Asks with pictures: pick the before or the after, a check with the agent\'s own answers, a link and a file',
      render: ctx => <PicturesDemo ctx={ctx} />,
    },
    {
      id: 'attaching',
      label: 'Files attached before Send: a picture ready, a PDF uploading, a file that cannot be attached',
      render: ctx => <AttachingDemo ctx={ctx} />,
    },
    {
      id: 'empty',
      label: 'No comments yet',
      height: 560,
      render: ctx => <Demo ctx={ctx} empty />,
    },
    {
      id: 'card',
      label: 'One thread with its owning thread, and an agent\'s logo and From line laid out on their own',
      render: ctx => <CardOnly ctx={ctx} />,
    },
    {
      id: 'agent-runtime',
      label: 'An agent\'s runtime card, open on keyboard focus: name, logo, bars and speed, harness, intelligence, speed and model',
      render: ctx => <CardOnly ctx={ctx} runtimeCard />,
    },
  ],
});
