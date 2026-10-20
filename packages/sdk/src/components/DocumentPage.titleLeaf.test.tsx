import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import type { NotisDocumentPageProps, NotisRuntime } from '../runtime';
import { DocumentPage } from './DocumentPage';

// A host page that reports the title it shows, as the Portal's SpaceDocumentPage does.
const titles = new Map<string, string>();
function HostPage({ recordKey, onTitle }: NotisDocumentPageProps) {
  const title = titles.get(recordKey) ?? '';
  useEffect(() => { onTitle?.(title); }, [onTitle, title]);
  return <div data-host-page={recordKey} />;
}

type Leaf = { label: string; onBack?: () => void } | null;
const labels = (sent: Leaf[]) => sent.map(leaf => (leaf ? { label: leaf.label } : null));

function runtimeWith(sent: Leaf[], locale = 'en', host = true): NotisRuntime {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params: {}, locale },
    callAction: async () => undefined,
    setTopBarTitleLeaf: (leaf: Leaf) => { sent.push(leaf); },
    ui: host ? { DocumentPage: HostPage } : {},
  } as unknown as NotisRuntime;
}

async function mountPage(runtime: NotisRuntime, props: NotisDocumentPageProps) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  const render = (next: NotisDocumentPageProps) => root.render(<NotisProvider runtime={runtime}><DocumentPage {...next} /></NotisProvider>);
  await act(async () => { render(props); });
  return { root, render };
}

test('a record page opened from the view (a breadcrumb) names the top bar leaf with its title, goes back through it, and follows edits', async () => {
  const sent: Leaf[] = [];
  const reported: string[] = [];
  titles.set('r1', 'Run of 12 May');
  let wentBack = 0;
  const back = [{ label: 'Link building', onSelect: () => { wentBack += 1; } }];
  const { root, render } = await mountPage(runtimeWith(sent), { recordKey: 'r1', breadcrumb: back, onTitle: title => reported.push(title) });
  assert.deepEqual(labels(sent), [{ label: 'Run of 12 May' }]);
  assert.deepEqual(reported, ['Run of 12 May'], 'the Space still hears the title');
  sent[0]!.onBack!();
  assert.equal(wentBack, 1, 'the top bar view crumb goes back through the last breadcrumb');
  titles.set('r1', 'Run of 13 May');
  await act(async () => { render({ recordKey: 'r1', breadcrumb: back }); });
  assert.deepEqual(labels(sent).at(-1), { label: 'Run of 13 May' });
  await act(async () => { root.unmount(); });
  assert.equal(sent.at(-1), null, 'closing the page clears the leaf');
});

test('an untitled record reads Untitled (Sans titre in French)', async () => {
  titles.set('r2', '  ');
  for (const [locale, word] of [['en', 'Untitled'], ['fr', 'Sans titre']]) {
    const sent: Leaf[] = [];
    const { root } = await mountPage(runtimeWith(sent, locale), { recordKey: 'r2', breadcrumb: [{ label: 'Platform Health' }] });
    assert.deepEqual(labels(sent), [{ label: word }]);
    assert.equal(sent[0]!.onBack, undefined, 'a crumb with no way back sends none');
    await act(async () => { root.unmount(); });
  }
});

test('no leaf without a breadcrumb or with topBarTitle false; topBarTitle true turns it on', async () => {
  titles.set('r3', 'A note');
  for (const [props, host] of [
    [{ recordKey: 'r3', breadcrumb: false }, true],
    [{ recordKey: 'r3' }, true],
    [{ recordKey: 'r3', breadcrumb: [{ label: 'Notes' }], topBarTitle: false }, true],
  ] as const) {
    const sent: Leaf[] = [];
    const { root } = await mountPage(runtimeWith(sent, 'en', host), props as NotisDocumentPageProps);
    await act(async () => { root.unmount(); });
    assert.deepEqual(sent, [], JSON.stringify(props));
  }
  const sent: Leaf[] = [];
  const { root } = await mountPage(runtimeWith(sent), { recordKey: 'r3', breadcrumb: false, topBarTitle: true });
  assert.deepEqual(labels(sent), [{ label: 'A note' }], 'topBarTitle turns it on without a breadcrumb');
  await act(async () => { root.unmount(); });
});
