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
