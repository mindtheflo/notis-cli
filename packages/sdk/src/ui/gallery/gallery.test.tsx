import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyboardEngine, KeyboardEngineCore } from '../engine';
import { AttachmentGallery, galleryItemKind, galleryItemName } from './AttachmentGallery';
import { ImageViewer } from './ImageViewer';

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode, locale: 'en' | 'fr' = 'en') {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => {
    root!.render(
      <KeyboardEngine host="preview" locale={locale} platform="mac" engine={new KeyboardEngineCore()} document={doc} strict>
        {node}
      </KeyboardEngine>,
    );
  });
}

async function press(key: string) {
  await act(async () => {
    doc.activeElement?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
  });
}

const items = [
  { url: 'https://cdn.test/a.png', name: 'a.png', type: 'image/png' },
  { url: 'https://cdn.test/report.pdf', name: 'report.pdf', type: 'application/pdf' },
  { url: 'https://cdn.test/b.jpg', name: 'b.jpg' },
];

test('galleryItemKind: MIME type first, extension second, webm voice notes are audio', () => {
  assert.equal(galleryItemKind({ type: 'image/png' }), 'image');
  assert.equal(galleryItemKind({ name: 'photo.JPG' }), 'image');
  assert.equal(galleryItemKind({ name: 'clip.mp4' }), 'video');
  assert.equal(galleryItemKind({ name: 'voice.webm' }), 'audio');
  assert.equal(galleryItemKind({ name: 'screen.webm', type: 'video/webm' }), 'video');
  assert.equal(galleryItemKind({ name: 'deck.pdf' }), 'pdf');
  assert.equal(galleryItemKind({ name: 'notes.txt' }), 'file');
  assert.equal(galleryItemKind({ name: 'a.png', kind: 'file' }), 'file', 'an explicit kind wins');
  assert.equal(galleryItemName({ extension: 'csv' }), 'file.csv');
});

test('AttachmentGallery: one card per item, thumbnails for images, icon and badge for files', async () => {
  await mount(<AttachmentGallery items={items} />);
  const row = doc.querySelector('.nui-gallery-row')!;
  assert.equal(row.getAttribute('role'), 'list');
  assert.equal(row.getAttribute('aria-label'), 'Attachments');
  const cards = [...doc.querySelectorAll('.nui-gallery-card')];
  assert.equal(cards.length, 3);
  assert.equal(cards[0].querySelector('.nui-gallery-thumb img')?.getAttribute('src'), 'https://cdn.test/a.png');
  assert.ok(cards[1].querySelector('.nui-gallery-glyph svg.nui-icon'), 'a file shows an icon');
  assert.equal(cards[1].querySelector('.nui-gallery-ext')?.textContent, 'PDF');
  assert.equal(cards[1].getAttribute('aria-label'), 'Open report.pdf');
});

test('AttachmentGallery: an image opens the viewer on the images only; a file goes to onOpen', async () => {
  const opened: string[] = [];
  await mount(<AttachmentGallery items={items} onOpen={(item) => opened.push(item.name!)} />);
  const cards = [...doc.querySelectorAll<HTMLButtonElement>('.nui-gallery-card')];
  await act(async () => { cards[1].click(); });
  assert.deepEqual(opened, ['report.pdf']);
  assert.equal(doc.querySelector('.nui-viewer'), null);

  await act(async () => { cards[2].click(); });
  const viewer = doc.querySelector('.nui-viewer')!;
  assert.equal(viewer.getAttribute('role'), 'dialog');
  assert.equal(viewer.getAttribute('aria-modal'), 'true');
  assert.equal(viewer.querySelector('.nui-viewer-image')?.getAttribute('src'), 'https://cdn.test/b.jpg');
  assert.equal(viewer.querySelector('.nui-viewer-count')?.textContent, '2 / 2', 'the pdf is not in the viewer');

  await press('ArrowLeft');
  assert.equal(doc.querySelector('.nui-viewer-image')?.getAttribute('src'), 'https://cdn.test/a.png');
  await press('Escape');
  assert.equal(doc.querySelector('.nui-viewer'), null, 'Escape closes the viewer');
});

test('AttachmentGallery: renderOpener and itemAction let the host add its own opener and corner button', async () => {
  await mount(
    <AttachmentGallery
      items={items}
      renderOpener={(item, { className, children }) => (item.name === 'report.pdf'
        ? <a className={className} href={item.url!} data-testid="pill">{children}</a> : undefined)}
      itemAction={(item) => <button type="button" aria-label={`Share ${item.name}`} />}
    />,
  );
  const pill = doc.querySelector('[data-testid="pill"]')!;
  assert.equal(pill.className, 'nui-gallery-card');
  assert.equal(pill.querySelector('.nui-gallery-name')?.textContent, 'report.pdf');
  assert.equal(doc.querySelectorAll('button.nui-gallery-card').length, 2, 'images keep the viewer button');
  assert.equal(doc.querySelectorAll('.nui-gallery-action button').length, 3);
});

test('AttachmentGallery: a scroll that changes no fade does not re-render (no update loop in a busy host)', async () => {
  let renders = 0;
  await mount(<AttachmentGallery items={items} itemAction={() => { renders += 1; return null; }} />);
  const settled = renders;
  const row = doc.querySelector('.nui-gallery-row')!;
  await act(async () => { row.dispatchEvent(new dom.window.Event('scroll')); });
  await act(async () => { row.dispatchEvent(new dom.window.Event('scroll')); });
  assert.equal(renders, settled);
});

test('ImageViewer: zoom keys, French words and an actions slot', async () => {
  let closed = 0;
  await mount(
    <ImageViewer
      images={[{ src: 'https://cdn.test/a.png', alt: 'a' }]}
      onClose={() => { closed += 1; }}
      actions={() => <button type="button" className="nui-viewer-btn" data-testid="share">Partager</button>}
    />,
    'fr',
  );
  const viewer = doc.querySelector('.nui-viewer')!;
  assert.equal(viewer.getAttribute('aria-label'), 'Visionneuse d’images');
  assert.ok(viewer.querySelector('.nui-viewer-bar [data-testid="share"]'));
  assert.equal(viewer.querySelector('.nui-viewer-nav'), null, 'one image has no arrows');
  const zoom = viewer.querySelector('.nui-viewer-zoom')!;
  assert.equal(zoom.textContent, 'Ajuster');
  await press('+');
  assert.equal(doc.querySelector('.nui-viewer-zoom')?.textContent, '125%');
  await press('0');
  assert.equal(doc.querySelector('.nui-viewer-zoom')?.textContent, 'Ajuster');
  await press('Escape');
  assert.equal(closed, 1);
});

const twoImages = [{ src: 'https://cdn.test/a.png', alt: 'a' }, { src: 'https://cdn.test/b.png', alt: 'b' }];

async function mouse(target: Element, type: string, x = 0, y = 0) {
  await act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
  });
}

test('ImageViewer: mounts on the page body, opens at fit, arrows and labelled buttons move between images', async () => {
  await mount(<ImageViewer images={twoImages} onClose={() => {}} />);
  const viewer = doc.querySelector('.nui-viewer')!;
  assert.equal(viewer.parentElement, doc.body, 'portalled to the body, outside the host');
  assert.equal(doc.getElementById('app')!.querySelector('.nui-viewer'), null);
  assert.equal(viewer.querySelector('.nui-viewer-zoom')?.textContent, 'Fit');
  assert.match((viewer.querySelector('.nui-viewer-image') as HTMLElement).style.transform, /scale\(1\)/);
  assert.equal(viewer.querySelector('.nui-viewer-prev')?.getAttribute('aria-label'), 'Previous image');
  assert.equal(viewer.querySelector('.nui-viewer-next')?.getAttribute('aria-label'), 'Next image');
  assert.equal((viewer.querySelector('.nui-viewer-prev') as HTMLButtonElement).disabled, true);

  await press('ArrowRight');
  assert.equal(doc.querySelector('.nui-viewer-image')?.getAttribute('src'), 'https://cdn.test/b.png');
  assert.equal(doc.querySelector('.nui-viewer-count')?.textContent, '2 / 2');
  assert.equal((doc.querySelector('.nui-viewer-next') as HTMLButtonElement).disabled, true);
  await act(async () => { (doc.querySelector('.nui-viewer-prev') as HTMLButtonElement).click(); });
  assert.equal(doc.querySelector('.nui-viewer-image')?.getAttribute('src'), 'https://cdn.test/a.png');

  await act(async () => {
    doc.querySelector('.nui-viewer-stage')!.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, deltaY: -1 }));
  });
  assert.equal(doc.querySelector('.nui-viewer-zoom')?.textContent, '125%', 'the wheel zooms in');
});

test('ImageViewer in a Space shadow root: mounted empty, it opens in the Space layer once images arrive', async () => {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="host"></div>';
  const shadow = doc.getElementById('host')!.attachShadow({ mode: 'open' });
  const app = doc.createElement('div');
  app.setAttribute('data-notis-app-root', '');
  shadow.appendChild(app);
  const mountPoint = doc.createElement('div');
  app.appendChild(mountPoint);
  root = createRoot(mountPoint);
  let show: (images: typeof twoImages) => void = () => {};
  function Host() {
    const [images, setImages] = useState<typeof twoImages>([]);
    show = setImages;
    return <ImageViewer images={images} onClose={() => {}} />;
  }
  await act(async () => {
    root!.render(
      <KeyboardEngine host="preview" locale="en" platform="mac" engine={new KeyboardEngineCore()} document={doc} strict>
        <Host />
      </KeyboardEngine>,
    );
  });
  assert.equal(shadow.querySelector('.nui-viewer'), null);
  await act(async () => { show(twoImages); });
  const viewer = shadow.querySelector('.nui-viewer');
  assert.ok(viewer, 'the viewer opens inside the Space shadow root');
  assert.equal(doc.body.querySelector('.nui-viewer'), null, 'never on the page body');
  assert.ok(viewer!.parentElement!.classList.contains('nui-layer'), 'in the shared layer root, which carries the theme');
  assert.equal(viewer!.parentElement!.parentElement, app);
  assert.ok(viewer!.contains(shadow.activeElement), 'focus moves into the viewer');
});

test('ImageViewer: a drag (pan) past 3 px never closes; a plain backdrop click does', async () => {
  let closed = 0;
  await mount(<ImageViewer images={twoImages} onClose={() => { closed += 1; }} />);
  const stage = doc.querySelector('.nui-viewer-stage')!;
  await mouse(stage, 'mousedown', 100, 100);
  await mouse(stage, 'mousemove', 140, 120);
  assert.match((doc.querySelector('.nui-viewer-image') as HTMLElement).style.transform, /translate\(40px, 20px\)/);
  await mouse(stage, 'mouseup', 140, 120);
  await mouse(stage, 'click', 140, 120);
  assert.equal(closed, 0, 'the click that ends a pan keeps the viewer open');

  await mouse(stage, 'mousedown', 10, 10);
  await mouse(stage, 'mousemove', 12, 11);
  await mouse(stage, 'mouseup', 12, 11);
  await mouse(stage, 'click', 12, 11);
  assert.equal(closed, 1, 'a jitter under the gate still closes');
  await mouse(doc.querySelector('.nui-viewer-image')!, 'click');
  assert.equal(closed, 1, 'a click on the image never closes');
});

test('ImageViewer: the drag gate is exactly 3 px on either axis on its own', async () => {
  let closed = 0;
  await mount(<ImageViewer images={twoImages} onClose={() => { closed += 1; }} />);
  const stage = doc.querySelector('.nui-viewer-stage')!;
  async function gesture(dx: number, dy: number) {
    await mouse(stage, 'mousedown', 50, 50);
    await mouse(stage, 'mousemove', 50 + dx, 50 + dy);
    await mouse(stage, 'mouseup', 50 + dx, 50 + dy);
    await mouse(stage, 'click', 50 + dx, 50 + dy);
  }
  await gesture(3, 3);
  assert.equal(closed, 1, '3 px on both axes is under the gate: the click closes');
  await gesture(-3, 0);
  assert.equal(closed, 2, '3 px back on one axis is still under the gate');
  await gesture(4, 0);
  assert.equal(closed, 2, '4 px across alone is a drag: the click keeps the viewer open');
  await gesture(0, 4);
  assert.equal(closed, 2, '4 px down alone is a drag: the click keeps the viewer open');
  await gesture(-4, -1);
  assert.equal(closed, 2, '4 px left alone is a drag, whatever the other axis does');
});

test('ImageViewer: focus moves in, Tab stays inside, focus returns on close', async () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" id="opener" onClick={() => setOpen(true)}>open</button>
        {open && <ImageViewer images={twoImages} onClose={() => setOpen(false)} />}
      </>
    );
  }
  await mount(<Host />);
  const opener = doc.getElementById('opener') as HTMLButtonElement;
  opener.focus();
  await act(async () => { opener.click(); });
  const viewer = doc.querySelector<HTMLElement>('.nui-viewer')!;
  assert.equal(doc.activeElement, viewer, 'the dialog takes focus');

  const buttons = [...viewer.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  buttons[buttons.length - 1]!.focus();
  await press('Tab');
  assert.equal(doc.activeElement, buttons[0], 'Tab from the last button wraps to the first');
  await act(async () => {
    doc.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  });
  assert.equal(doc.activeElement, buttons[buttons.length - 1], 'Shift+Tab from the first wraps to the last');

  await press('Escape');
  assert.equal(doc.querySelector('.nui-viewer'), null);
  assert.equal(doc.activeElement, opener, 'focus returns to the opener');
});

test('ImageViewer: copy shows a check and reports it; a failed download opens the image in a new tab', async () => {
  const notices: string[] = [];
  const opened: unknown[][] = [];
  const copiedText: string[] = [];
  const realFetch = globalThis.fetch;
  const realOpen = dom.window.open;
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async (text: string) => { copiedText.push(text); } },
  });
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  dom.window.open = ((...args: unknown[]) => { opened.push(args); return null; }) as typeof dom.window.open;
  try {
    await mount(<ImageViewer images={twoImages} onClose={() => {}} onNotice={(tone, text) => notices.push(`${tone}:${text}`)} />);
    const copy = doc.querySelector<HTMLButtonElement>('button[aria-label="Copy link"]')!;
    const linkIcon = copy.innerHTML;
    await act(async () => { copy.click(); });
    assert.deepEqual(copiedText, ['https://cdn.test/a.png']);
    assert.equal(copy.getAttribute('aria-label'), 'Link copied');
    assert.notEqual(copy.innerHTML, linkIcon, 'the link icon turns into a check');
    assert.deepEqual(notices, ['success:Link copied']);

    await act(async () => { doc.querySelector<HTMLButtonElement>('button[aria-label="Download"]')!.click(); });
    assert.deepEqual(opened, [['https://cdn.test/a.png', '_blank', 'noopener']]);
    assert.deepEqual(notices, ['success:Link copied', 'error:Failed to download image']);
  } finally {
    await act(async () => { root?.unmount(); });
    root = null;
    globalThis.fetch = realFetch;
    dom.window.open = realOpen;
    delete (dom.window.navigator as { clipboard?: unknown }).clipboard;
  }
});

const toolkitCss = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');

function cssRule(selector: string): Record<string, string> {
  const match = toolkitCss.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} has a rule in toolkit.css`);
  return Object.fromEntries(match[1].split(';').map((part) => part.split(':').map((side) => side.trim()))
    .filter(([name, value]) => name && value).map(([name, value]) => [name, value]));
}

test('ImageViewer: the image fits the viewport by default; minus key and zoom buttons; the copy check clears on its own', async () => {
  const image = cssRule('.nui-viewer-image');
  assert.equal(image['max-width'], 'calc(100vw - 32px)');
  assert.equal(image['max-height'], 'calc(100vh - 96px)');
  assert.equal(image['object-fit'], 'contain');
  assert.equal(image['user-select'], 'none');
  const stage = cssRule('.nui-viewer-stage');
  assert.equal(stage['min-height'], '0', 'the stage can shrink so the image stays inside the viewport');
  assert.equal(stage.overflow, 'hidden');

  const copiedText: string[] = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async (text: string) => { copiedText.push(text); } },
  });
  try {
    await mount(<ImageViewer images={twoImages} onClose={() => {}} />);
    const img = doc.querySelector<HTMLImageElement>('.nui-viewer-image')!;
    assert.equal(img.style.maxWidth, '', 'no inline size overrides the viewport fit');
    assert.equal(img.style.maxHeight, '');
    assert.equal(img.draggable, false);
    const zoom = () => doc.querySelector('.nui-viewer-zoom')?.textContent;
    const button = (label: string) => doc.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

    await press('-');
    assert.equal(zoom(), '75%', 'the minus key zooms out');
    await act(async () => { button('Zoom out').click(); });
    await act(async () => { button('Zoom out').click(); });
    assert.equal(zoom(), '25%');
    assert.equal(button('Zoom out').disabled, true, 'zoom out stops at the smallest level');
    await act(async () => { doc.querySelector<HTMLButtonElement>('.nui-viewer-zoom')!.click(); });
    assert.equal(zoom(), 'Fit', 'the zoom label resets to fit');
    for (let i = 0; i < 4; i += 1) await act(async () => { button('Zoom in').click(); });
    assert.equal(zoom(), '300%');
    assert.equal(button('Zoom in').disabled, true, 'zoom in stops at the largest level');
    assert.match(doc.querySelector<HTMLElement>('.nui-viewer-image')!.style.transform, /scale\(3\)/);

    await act(async () => { button('Copy link').click(); });
    assert.deepEqual(copiedText, ['https://cdn.test/a.png']);
    assert.ok(doc.querySelector('button[aria-label="Link copied"]'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); });
    assert.equal(doc.querySelector('button[aria-label="Link copied"]'), null, 'the check goes back to the link icon');
    assert.ok(button('Copy link'));
  } finally {
    await act(async () => { root?.unmount(); });
    root = null;
    delete (dom.window.navigator as { clipboard?: unknown }).clipboard;
  }
});
