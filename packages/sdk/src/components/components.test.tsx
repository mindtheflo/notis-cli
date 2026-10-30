import { dom } from '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DOCUMENT_WORDS, getDocumentPreview, normalizeDocumentRecord } from '../documents';
import { NotisProvider } from '../provider';
import type { NotisRuntime } from '../runtime';
import { SKELETON_WORDS, ViewSkeleton } from './Skeleton';
import { DOCUMENT_EDITOR_WORDS, DocumentEditor } from './DocumentEditor';
import { DOCUMENT_HOOK_WORDS } from '../hooks/useDocument';
import { MARKDOWN_EDITOR_WORDS, MarkdownEditor } from './MarkdownEditor';
import { DocumentPage } from './DocumentPage';
import { HtmlFrame, RECORD_COMPONENT_WORDS, ShareControl, SpacePageFrame, spacePageLink } from './RecordComponents';
import type { NotisHtmlFrameProps, NotisSpacePageFrameProps } from '../runtime';

test('HtmlFrame hands its ready signal and presentation mode to the host frame', async () => {
  const seen: NotisHtmlFrameProps[] = [];
  const runtime = { context: { locale: 'en' }, ui: { HtmlFrame: (props: NotisHtmlFrameProps) => {
    seen.push(props); return <span data-host-html="" />;
  } } } as unknown as NotisRuntime;
  const onReady = () => {};
  const presentation = { onAction: () => {} };
  await mount(<NotisProvider runtime={runtime}><HtmlFrame recordKey="r1" onReady={onReady} presentation={presentation} /></NotisProvider>);
  assert.ok(doc.querySelector('[data-host-html]'));
  assert.equal(seen.at(-1)?.onReady, onReady);
  assert.equal(seen.at(-1)?.presentation, presentation);
});

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => { root!.render(node); });
}

const inLocale = (locale: 'en' | 'fr') => ({ context: { locale } }) as unknown as NotisRuntime;
const label = () => doc.querySelector('[data-notis-content-skeleton]')!.getAttribute('aria-label');

test('ViewSkeleton says what loads in the Space’s language; a view may name what loads', async () => {
  await mount(<ViewSkeleton />);
  assert.equal(label(), 'Loading content', 'no Space: English');
  await mount(<NotisProvider runtime={inLocale('fr')}><ViewSkeleton /></NotisProvider>);
  assert.equal(label(), 'Chargement du contenu');
  assert.equal(doc.querySelector('[role="status"]')?.getAttribute('aria-busy'), 'true');
  await mount(
    <NotisProvider runtime={inLocale('fr')}>
      <ViewSkeleton label={{ en: 'Loading meetings', fr: 'Chargement des réunions' }} />
    </NotisProvider>,
  );
  assert.equal(label(), 'Chargement des réunions');
  await mount(<NotisProvider runtime={inLocale('fr')}><ViewSkeleton locale="en" label="Loading tickets" /></NotisProvider>);
  assert.equal(label(), 'Loading tickets', 'a plain string reads the same in both languages');
  assert.deepEqual(SKELETON_WORDS.loading, { en: 'Loading content', fr: 'Chargement du contenu' });
});

test('ViewSkeleton stays inside its pane: its padding is inside its width (VIEW-046)', async () => {
  await mount(<ViewSkeleton />);
  const root = doc.querySelector<HTMLElement>('[data-notis-content-skeleton]')!;
  assert.equal(root.style.width, '100%');
  assert.equal(root.style.boxSizing, 'border-box');
});

const captured = {
  schema: 'notis-space-skeleton/v1', sourceHash: 'a'.repeat(64),
  regions: {
    main: {
      '390': { en: { height: 300, bones: [[0, 0, 100, 44, 8, 0], [5, 60, 90, 120, 12, 1], [5, 60, 90, 120, 12, 2], [0, 200, 100, 1, 0, 3]] } },
      '1440': {
        en: { height: 500, bones: [[10, 0, 40, 28, 6, 0]], rows: [{ y: 100, h: 50, bones: [[2, 10, 60, 20, 4, 0]], repeat: 'fill' }] },
        fr: { height: 520, bones: [[10, 0, 50, 28, 6, 0]] },
      },
    },
    side: { '1440': { fr: { height: 80, bones: [[0, 0, 100, 80, 0, 1]] } } },
  },
};
const withSkeleton = (skeleton: unknown, locale: 'en' | 'fr' = 'en') => ({ context: { locale, skeleton } }) as unknown as NotisRuntime;
const region = () => doc.querySelector<HTMLElement>('[data-notis-content-skeleton]')!;
const bones = () => [...region().querySelectorAll<HTMLElement>(':scope > [data-notis-bone]')];

/** Lays the page out: the skeleton box is `width` px wide and its scroll parent (`[data-pane]`) shows `pane` px. */
async function laidOut(layout: { width?: number; pane?: number }, run: () => Promise<void>) {
  const proto = dom.window.Element.prototype;
  const saved = ['clientWidth', 'clientHeight'].map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: Element) {
    return this.hasAttribute('data-notis-skeleton-key') ? layout.width ?? 0 : 0;
  } });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get(this: Element) {
    return this.hasAttribute('data-pane') ? layout.pane ?? 0 : 0;
  } });
  try { await run(); } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, key, descriptor); else delete (proto as unknown as Record<string, unknown>)[key];
    }
  }
}
const inPane = (node: ReactNode) => <div data-pane="" style={{ overflowY: 'auto' }}>{node}</div>;

test('ViewSkeleton draws the bones captured for its region, each type in its own grey (VIEW-044)', async () => {
  await laidOut({ width: 500 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured)}><ViewSkeleton /></NotisProvider>);
    const root = region();
    assert.equal(root.getAttribute('role'), 'status');
    assert.equal(root.getAttribute('aria-busy'), 'true');
    assert.equal(root.getAttribute('aria-label'), 'Loading content');
    assert.ok(root.hasAttribute('data-notis-content-skeleton'));
    assert.equal(root.getAttribute('data-notis-skeleton-key'), 'main');
    assert.equal(root.style.position, 'relative');
    assert.equal(root.style.height, '300px', 'the captured height, so the page does not jump');
    assert.equal(root.style.padding, '', 'the bones already hold the layout');
    assert.equal(root.style.boxSizing, 'border-box');
    const [leaf, filled, outline, divider] = bones();
    assert.equal(bones().length, 4);
    assert.deepEqual([leaf.style.position, leaf.style.left, leaf.style.width, leaf.style.top, leaf.style.height, leaf.style.borderRadius],
      ['absolute', '0%', '100%', '0px', '44px', '8px']);
    assert.equal(leaf.style.background, 'rgba(128, 128, 128, 0.18)');
    assert.deepEqual([filled.style.left, filled.style.width, filled.style.top, filled.style.height, filled.style.borderRadius],
      ['5%', '90%', '60px', '120px', '12px']);
    assert.equal(filled.style.background, 'rgba(128, 128, 128, 0.06)');
    assert.equal(outline.style.boxShadow, 'inset 0 0 0 1px rgba(128,128,128,.14)');
    assert.equal(outline.style.background, '', 'an outlined box is not filled');
    assert.equal(divider.style.background, 'rgba(128, 128, 128, 0.16)');
    assert.equal(divider.style.height, '1px');
    for (const bone of bones()) assert.equal(bone.getAttribute('aria-hidden'), 'true');
  });
  await mount(<NotisProvider runtime={withSkeleton(captured, 'fr')}><ViewSkeleton /></NotisProvider>);
  assert.equal(region().getAttribute('aria-label'), 'Chargement du contenu', 'still named in the Space language');
});

test('ViewSkeleton draws the 390 capture under 800 px of its own width, else the 1440 one (VIEW-044)', async () => {
  const at = async (width: number) => laidOut({ width }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured)}><ViewSkeleton /></NotisProvider>);
  });
  await at(799);
  assert.equal(region().style.height, '300px');
  assert.equal(bones().length, 4);
  await at(800);
  assert.equal(region().style.height, '500px');
  assert.equal(bones()[0].style.width, '40%');
  await at(0);
  assert.equal(region().style.height, '500px', 'before its box is measured: the window width (1024 here), else 1440');
  await laidOut({ width: 500 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured, 'fr')}><ViewSkeleton skeletonKey="side" /></NotisProvider>);
  });
  assert.equal(region().style.height, '80px', 'a width that was not captured falls back to the other width');
});

test('ViewSkeleton draws the runtime locale, else the other locale (VIEW-044)', async () => {
  await laidOut({ width: 1200 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured, 'fr')}><ViewSkeleton /></NotisProvider>);
    assert.equal(region().style.height, '520px');
    assert.equal(bones()[0].style.width, '50%');
  });
  await laidOut({ width: 500 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured, 'fr')}><ViewSkeleton /></NotisProvider>);
    assert.equal(region().style.height, '300px', 'no French capture at 390: the English one');
    await mount(<NotisProvider runtime={withSkeleton(captured, 'fr')}><ViewSkeleton locale="en" /></NotisProvider>);
    assert.equal(region().style.height, '300px');
  });
});

test('ViewSkeleton repeats a captured row until the visible pane is filled (VIEW-044)', async () => {
  const rows = () => [...region().querySelectorAll<HTMLElement>('[data-notis-bone-row]')];
  await laidOut({ width: 1200, pane: 600 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(rows().length, 10, '(600 - 100) / 50');
    assert.deepEqual(rows().slice(0, 3).map((row) => row.style.top), ['100px', '150px', '200px']);
    assert.equal(rows()[0].getAttribute('aria-hidden'), 'true');
    const bone = rows()[0].querySelector<HTMLElement>('[data-notis-bone]')!;
    assert.deepEqual([bone.style.left, bone.style.width, bone.style.top, bone.style.height], ['2%', '60%', '10px', '20px']);
    assert.equal(region().style.height, '600px');
  });
  await laidOut({ width: 1200, pane: 1010 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(rows().length, 19, 'ceil((1010 - 100) / 50)');
    assert.equal(region().style.height, '1050px', 'the box grows to hold every copy');
  });
  await laidOut({ width: 1200, pane: 0 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured)}><ViewSkeleton /></NotisProvider>);
    assert.equal(rows().length, 1, 'at least one copy');
    assert.equal(region().style.height, '500px');
  });
  await laidOut({ width: 1200, pane: 10_000_000 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(captured)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(rows().length, 200, 'capped');
  });
});

test('ViewSkeleton stretches a captured frame of panes to the visible pane and clips what lay below (VIEW-053)', async () => {
  // A list beside its detail, captured in a 900 px window; the detail pane's content ran on to 1196 px.
  const frame = { schema: 'notis-space-skeleton/v1', sourceHash: 'a'.repeat(64), regions: { main: { '1440': { en: { height: 1196, bones: [
    [0, 0, 66.67, 900, 0, 1], [0, 44, 66.6, 50, 0, 1], [66.67, 0, 33.33, 900, 0, 1], [68.89, 844, 28.89, 352, 12, 1], [70, 120, 20, 16, 4, 0],
  ] } } } } };
  const heights = () => bones().map((bone) => bone.style.height);
  await laidOut({ width: 1600, pane: 982 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(frame)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '982px', 'the pane, not the capture window or the content below it');
    assert.equal(region().style.overflow, 'hidden');
    assert.deepEqual(heights(), ['982px', '50px', '982px', '352px', '16px'], 'only the panes stretch');
  });
  const layout = { width: 1600, pane: 700 };
  await laidOut(layout, async () => {
    await mount(<NotisProvider runtime={withSkeleton(frame)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '700px', 'a shorter pane shrinks the frame instead of running past it');
    assert.deepEqual(heights().slice(0, 3), ['700px', '50px', '700px']);
    layout.pane = 820;
    await act(async () => {
      region().parentElement!.dispatchEvent(new dom.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(region().style.height, '820px', 'scrolling shows more of the pane and the frame follows');
  });
  await laidOut({ width: 1600, pane: 80 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(frame)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '120px', 'a sliver of pane still shows the frame at its 120 px minimum');
  });
  await laidOut({ width: 1600, pane: 0 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(frame)}><ViewSkeleton /></NotisProvider>);
    assert.equal(region().style.height, '1196px', 'unmeasured: the captured height');
  });
  // One box at the top of a longer page is content, not a frame.
  const page = { ...frame, regions: { main: { '1440': { en: { height: 1400, bones: [[5, 0, 90, 400, 12, 1], [5, 420, 90, 16, 4, 0]] } } } } };
  await laidOut({ width: 1600, pane: 900 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(page)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '1400px');
    assert.equal(heights()[0], '400px');
  });
  // Nor is one inset card nearly as wide as the page: a frame across the width is panes side by side.
  const card = { ...frame, regions: { main: { '1440': { en: { height: 1400, bones: [[1.1, 0, 97.8, 400, 12, 1], [5, 420, 90, 16, 4, 0]] } } } } };
  await laidOut({ width: 1600, pane: 900 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(card)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '1400px');
    assert.equal(heights()[0], '400px');
  });
  // Nor is a wide card with a card nested in it, both ending on one line above the capture bottom.
  const nested = { ...frame, regions: { main: { '1440': { en: { height: 800, bones: [[1, 0, 97, 400, 12, 1], [2, 0, 40, 400, 8, 2]] } } } } };
  await laidOut({ width: 1600, pane: 900 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(nested)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '800px');
    assert.deepEqual(heights(), ['400px', '400px']);
  });
  // Nor is a rounded card that ends the capture; a phone's one square-cornered pane ending it is a frame.
  const lastCard = { ...frame, regions: { main: { '1440': { en: { height: 400, bones: [[1, 0, 97, 400, 12, 1]] } } } } };
  await laidOut({ width: 1600, pane: 900 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(lastCard)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '400px');
    assert.deepEqual(heights(), ['400px']);
  });
  const phonePane = { ...frame, regions: { main: { '1440': { en: { height: 700, bones: [[0, 0, 100, 700, 0, 1], [4, 20, 60, 16, 4, 0]] } } } } };
  await laidOut({ width: 1600, pane: 900 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(phonePane)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '900px');
    assert.deepEqual(heights(), ['900px', '16px']);
  });
  // Nor is a row of stat tiles across the width with the page going on below it.
  const tiles = { ...frame, regions: { main: { '1440': { en: { height: 1400, bones: [[0, 0, 49, 140, 8, 1], [51, 0, 49, 140, 8, 1], [0, 160, 100, 600, 12, 2]] } } } } };
  await laidOut({ width: 1600, pane: 900 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(tiles)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '1400px');
    assert.deepEqual(heights(), ['140px', '140px', '600px']);
  });
  // A divider on the panes' own bottom edge is not content below them.
  const edged = { ...frame, regions: { main: { '1440': { en: { height: 800, bones: [[0, 0, 50, 600, 0, 1], [50, 0, 50, 600, 0, 1], [0, 599, 50, 1, 0, 3]] } } } } };
  await laidOut({ width: 1600, pane: 900 }, async () => {
    await mount(<NotisProvider runtime={withSkeleton(edged)}>{inPane(<ViewSkeleton />)}</NotisProvider>);
    assert.equal(region().style.height, '900px');
    assert.deepEqual(heights().slice(0, 2), ['900px', '900px']);
  });
});

test('ViewSkeleton keeps its variant with no captured region, and ignores a malformed skeleton (VIEW-044)', async () => {
  const isVariant = (key: string) => {
    const root = region();
    assert.equal(root.getAttribute('data-notis-skeleton-key'), key);
    assert.equal(root.style.padding, '24px');
    assert.equal(root.style.display, 'grid');
    assert.equal(bones().length, 0);
    assert.equal(root.getAttribute('role'), 'status');
    assert.equal(root.getAttribute('aria-busy'), 'true');
  };
  await mount(<ViewSkeleton />);
  isVariant('main');
  await mount(<NotisProvider runtime={withSkeleton(captured)}><ViewSkeleton skeletonKey="chart" /></NotisProvider>);
  isVariant('chart');
  const malformed = [
    null, 'text', { ...captured, schema: 'notis-space-skeleton/v2' },
    { ...captured, sourceHash: 1 },
    { ...captured, regions: { Main: captured.regions.main } },
    { ...captured, regions: { main: { '768': captured.regions.main['390'] } } },
    { ...captured, regions: { main: { '390': { de: captured.regions.main['390'].en } } } },
    { ...captured, regions: { main: { '390': { en: { height: 300, bones: [[0, 0, '100', 44, 8, 0]] } } } } },
    { ...captured, regions: { main: { '390': { en: { height: 300, bones: [[0, 0, 100, 44, 8, 7]] } } } } },
    { ...captured, regions: { main: { '390': { en: { height: -1, bones: [] } } } } },
    { ...captured, regions: { main: { '390': { en: { height: 300, bones: [], rows: [{ y: 0, h: 0, bones: [], repeat: 'fill' }] } } } } },
  ];
  for (const skeleton of malformed) {
    await mount(<NotisProvider runtime={withSkeleton(skeleton)}><ViewSkeleton /></NotisProvider>);
    isVariant('main');
  }
});

test('an untitled document reads "Untitled" in the asked language; a real title is kept', () => {
  assert.equal(normalizeDocumentRecord({ id: 'a' }).title, 'Untitled');
  assert.equal(normalizeDocumentRecord({ id: 'a', title: '   ' }, { locale: 'fr' }).title, 'Sans titre');
  assert.equal(normalizeDocumentRecord({ id: 'a', title: 'Plan' }, { locale: 'fr' }).title, 'Plan');

  const blank = { ...normalizeDocumentRecord({ id: 'b' }), title: '' };
  assert.equal(getDocumentPreview(blank), 'Untitled');
  assert.equal(getDocumentPreview(blank, { locale: 'fr' }), 'Sans titre');
  assert.equal(getDocumentPreview({ ...blank, plainText: ' Notes  du jour ' }, { locale: 'fr' }), 'Notes du jour');
  assert.deepEqual(DOCUMENT_WORDS.untitled, { en: 'Untitled', fr: 'Sans titre' });
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const reader = (locale: 'en' | 'fr', document: unknown) => ({
  context: { locale },
  callTool: async () => ({ document }),
}) as unknown as NotisRuntime;
const noDash = (text: string | null | undefined) => assert.doesNotMatch(text ?? '', /[\u2013\u2014]/);

test('DocumentEditor fallback speaks EN and FR on a flat tinted frame, never a dashed border (C7, C8)', async () => {
  await mount(<NotisProvider runtime={reader('fr', null)}><DocumentEditor documentId="d1" /></NotisProvider>);
  await settle();
  const missing = doc.querySelector('[role="status"]') as HTMLElement;
  assert.equal(missing.textContent, 'Document introuvable');
  assert.doesNotMatch(missing.getAttribute('style') ?? '', /dashed|(^|; )border(-(top|right|bottom|left|style|width|color))?:/);
  assert.match(missing.getAttribute('style') ?? '', /background: hsl\(var\(--muted\)/);

  await mount(<NotisProvider runtime={reader('fr', { id: 'd2', title: 'Budget', content_type: 'file', file_type: 'pdf' })}>
    <DocumentEditor documentId="d2" /></NotisProvider>);
  await settle();
  assert.match(doc.body.textContent ?? '', /Fichier PDF\. Ouvre-le dans Notis pour le voir\./);

  await mount(<NotisProvider runtime={reader('en', { id: 'd3', title: 'Plan', content_type: 'markdown', content_markdown: 'Hello' })}>
    <DocumentEditor documentId="d3" /></NotisProvider>);
  await settle();
  assert.match(doc.body.textContent ?? '', /Read-only preview\. Edit it in Notis\./);

  for (const words of [...Object.values(DOCUMENT_EDITOR_WORDS), ...Object.values(DOCUMENT_HOOK_WORDS)]) {
    assert.ok(words.en && words.fr, 'every word ships in both languages');
    noDash(words.en); noDash(words.fr);
  }
});

test('MarkdownEditor fallback: placeholder in the Space language, read-only reads as text (C9)', async () => {
  const noop = async () => undefined;
  await mount(<NotisProvider runtime={inLocale('fr')}><MarkdownEditor value="" onChange={() => {}} onSave={noop} /></NotisProvider>);
  let area = doc.querySelector('textarea')!;
  assert.equal(area.getAttribute('placeholder'), 'Écris en Markdown');
  assert.equal(area.hasAttribute('data-readonly'), false);
  await mount(<MarkdownEditor value="" onChange={() => {}} onSave={noop} />);
  assert.equal(doc.querySelector('textarea')!.getAttribute('placeholder'), 'Write in Markdown');
  await mount(<MarkdownEditor value="Notes" readOnly onChange={() => {}} onSave={noop} />);
  area = doc.querySelector('textarea')!;
  assert.equal(area.hasAttribute('data-readonly'), true);
  assert.equal(area.getAttribute('aria-readonly'), 'true');
  assert.equal(area.hasAttribute('placeholder'), false, 'no placeholder on read-only text');
  assert.match(area.getAttribute('style') ?? '', /resize: none/);
  assert.match(area.getAttribute('style') ?? '', /cursor: default/);
  assert.deepEqual(MARKDOWN_EDITOR_WORDS.placeholder, { en: 'Write in Markdown', fr: 'Écris en Markdown' });
});

test('DocumentPage fallback crumb: slashes only between parts, each part ellipsized, actions never wrap (C10)', async () => {
  const long = 'A very long parent folder name that would push the buttons off the toolbar';
  await mount(<DocumentPage recordKey="" breadcrumb={[{ label: long, onSelect: () => {} }, { label: 'Notes' }]}
    menuItems={[{ label: 'Archive', onSelect: () => {} }]} viewer="html" />);
  const nav = doc.querySelector('nav')!;
  const slashes = [...nav.querySelectorAll('[aria-hidden="true"]')].map((node) => node.textContent);
  assert.deepEqual(slashes, ['/'], 'one slash for two parts, none trailing');
  const first = nav.querySelector('button')!;
  assert.equal(first.getAttribute('title'), long);
  assert.match(first.getAttribute('style') ?? '', /text-overflow: ellipsis/);
  assert.match(first.getAttribute('style') ?? '', /white-space: nowrap/);
  assert.match(first.getAttribute('style') ?? '', /max-width: 160px/);
  assert.match(nav.getAttribute('style') ?? '', /overflow: hidden/);
  const actions = doc.querySelector('[data-notis-document-page-actions]') as HTMLElement;
  assert.match(actions.getAttribute('style') ?? '', /white-space: nowrap/);
  // N4: the buttons shorten their labels (never wrap) once they alone outgrow the bar; the crumb keeps 72px.
  assert.match(actions.getAttribute('style') ?? '', /flex: 0 1 auto/);
  assert.match(nav.getAttribute('style') ?? '', /min-width: 72px/);
  const archive = actions.querySelector('button')!;
  assert.equal(archive.getAttribute('title'), 'Archive');
  assert.match(archive.getAttribute('style') ?? '', /text-overflow: ellipsis/);
  assert.match(archive.getAttribute('style') ?? '', /min-width: 0/);
  // N4: every crumb part has the same padding, a link or not.
  const plain = [...nav.querySelectorAll('span[title]')].find((node) => node.getAttribute('title') === 'Notes') as HTMLElement;
  assert.match(plain.getAttribute('style') ?? '', /padding: 4px 6px/);
  assert.match(first.getAttribute('style') ?? '', /padding: 4px 6px/);
  assert.equal(actions.textContent, 'Archive');
  // N4: a menu item with an icon shows the icon alone, named and titled by its label.
  await mount(<DocumentPage recordKey="" breadcrumb={[{ label: 'Notes' }]} viewer="html"
    menuItems={[{ label: 'Archiver la note', icon: 'archive', onSelect: () => {} }, { label: 'Copy', onSelect: () => {} }]} />);
  const [iconOnly, textOnly] = [...doc.querySelectorAll('[data-notis-document-page-actions] button')];
  assert.equal(iconOnly!.getAttribute('aria-label'), 'Archiver la note');
  assert.equal(iconOnly!.getAttribute('title'), 'Archiver la note');
  assert.ok(iconOnly!.querySelector('svg.nui-icon'), 'the icon draws');
  assert.equal(iconOnly!.textContent, '', 'no label beside the icon');
  assert.equal(textOnly!.textContent, 'Copy', 'an item without an icon keeps its label');
  // REC-004: at 390px in French the icon-only item shrank to 21px (its icon cut) and 'Archive' was clipped without an
  // ellipsis. The icon item never shrinks; the text item is an inline block, the one box that ellipsizes its own words.
  assert.match(iconOnly!.getAttribute('style') ?? '', /flex: 0 0 auto/);
  assert.doesNotMatch(iconOnly!.getAttribute('style') ?? '', /min-width: 0/);
  assert.match(textOnly!.getAttribute('style') ?? '', /display: inline-block/);
  assert.match(textOnly!.getAttribute('style') ?? '', /flex: 0 1 auto/);
  assert.match(textOnly!.getAttribute('style') ?? '', /text-overflow: ellipsis/);
});

test('ShareControl outside Notis is a short muted label; the tooltip says where sharing works (C11)', async () => {
  await mount(<NotisProvider runtime={inLocale('fr')}><ShareControl recordKey="r1" /></NotisProvider>);
  const node = doc.querySelector('[data-notis-share-unavailable]') as HTMLElement;
  assert.equal(node.textContent, 'Partage indisponible');
  assert.equal(node.getAttribute('title'), RECORD_COMPONENT_WORDS.shareUnavailableHint.fr);
  assert.match(node.getAttribute('style') ?? '', /white-space: nowrap/);
  await mount(<ShareControl recordKey="r1" />);
  assert.equal(doc.querySelector('[data-notis-share-unavailable]')!.textContent, 'Share unavailable');
  for (const words of Object.values(RECORD_COMPONENT_WORDS)) { noDash(words.en); noDash(words.fr); }
});

test('SpacePageFrame without the host is a card: title, path and Open page, in the Space’s language', async () => {
  await mount(<NotisProvider runtime={inLocale('fr')}><SpacePageFrame href="/slides/decks?deck=d1" title="Plan" /></NotisProvider>);
  const card = doc.querySelector('[data-notis-space-page-card]') as HTMLElement;
  assert.ok(card, 'the fallback card draws');
  assert.equal(doc.querySelector('iframe'), null, 'no frame without the host');
  assert.match(card.textContent ?? '', /Plan/);
  assert.match(card.textContent ?? '', /\/slides\/decks/);
  assert.doesNotMatch(card.textContent ?? '', /deck=d1/, 'the path, not its query');
  const open = card.querySelector('a') as HTMLAnchorElement;
  assert.equal(open.textContent, 'Ouvrir la page');
  assert.equal(open.getAttribute('href'), '/slides/decks?deck=d1');
  await mount(<SpacePageFrame href="/slides/decks" />);
  assert.match(doc.querySelector('[data-notis-space-page-card]')!.textContent ?? '', /Space page/);
  assert.equal(doc.querySelector('[data-notis-space-page-card] a')!.textContent, 'Open page');
});

test('SpacePageFrame fallback never links a script or protocol-relative URL', async () => {
  for (const href of ['javascript:alert(1)', '//evil.example/x', 'data:text/html,hi', '/\\evil.example', 'https://u:password@beta.notis.ai/x']) {
    await mount(<SpacePageFrame href={href} />);
    assert.equal(doc.querySelector('[data-notis-space-page-card] a'), null, href);
  }
  assert.deepEqual(spacePageLink('https://beta.notis.ai/slides/decks?deck=1'), {
    path: '/slides/decks', openHref: 'https://beta.notis.ai/slides/decks?deck=1',
  });
  assert.deepEqual(spacePageLink('/slides'), { path: '/slides', openHref: '/slides' });
});

test('SpacePageFrame hands every prop to the host frame when the host draws it', async () => {
  const seen: NotisSpacePageFrameProps[] = [];
  const runtime = { context: { locale: 'en' }, ui: { SpacePageFrame: (props: NotisSpacePageFrameProps) => {
    seen.push(props); return <span data-host-frame="" />;
  } } } as unknown as NotisRuntime;
  await mount(<NotisProvider runtime={runtime}><SpacePageFrame href="/slides" title="Deck" interactive className="h-64" /></NotisProvider>);
  assert.ok(doc.querySelector('[data-host-frame]'));
  assert.equal(doc.querySelector('[data-notis-space-page-card]'), null);
  assert.deepEqual(seen.at(-1), { href: '/slides', title: 'Deck', interactive: true, className: 'h-64' });
});
