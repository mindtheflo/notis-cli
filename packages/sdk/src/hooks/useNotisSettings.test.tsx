import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import type { NotisRuntime } from '../runtime';
import { settingsNavigation, settingsRepositoryName, useNotisSettings, type UseNotisSettingsResult } from './useNotisSettings';

function runtimeFor(more: Partial<NotisRuntime>): NotisRuntime {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params: {}, locale: 'en' },
    callAction: async () => undefined,
    ...more,
  } as unknown as NotisRuntime;
}

async function settingsFor(more: Partial<NotisRuntime> | null): Promise<UseNotisSettingsResult> {
  let settings!: UseNotisSettingsResult;
  function Probe() { settings = useNotisSettings(); return null; }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => {
    root.render(more ? <NotisProvider runtime={runtimeFor(more)}><Probe /></NotisProvider> : <Probe />);
  });
  await act(async () => { root.unmount(); });
  return settings;
}

test('openSettings sends the repository secrets target with the short name, through the host navigation (4.3)', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const settings = await settingsFor({ settingsAvailable: true, navigate: payload => { sent.push(payload); } });
  assert.equal(settings.available, true);
  await settings.openSettings({ page: 'cloud-computer', section: 'repository-secrets',
    repository: 'mindtheflo/Naturalisation-Switzerland', add: 'env_file' });
  await settings.openSettings({ page: 'cloud-computer', section: 'repository-secrets' });
  assert.deepEqual(sent, [
    { kind: 'settings', page: 'cloud-computer', section: 'repository-secrets', repository: 'naturalisation-switzerland', add: 'env_file' },
    { kind: 'settings', page: 'cloud-computer', section: 'repository-secrets' },
  ]);
  await assert.rejects(settings.openSettings({ page: 'cloud-computer', section: 'repository-secrets', repository: 'a/b/c' }),
    /short name/);
  await assert.rejects(settings.openSettings({ page: 'cloud-computer', section: 'repository-secrets',
    add: 'secret' as unknown as 'env_file' }), /env_file/);
  assert.equal(sent.length, 2);
});

test('openSettings is unavailable without a host that opens Settings (Sites, links, verify, the vite preview)', async () => {
  for (const more of [null, { navigate: () => {} }, { settingsAvailable: true }]) {
    const settings = await settingsFor(more);
    assert.equal(settings.available, false);
    await assert.rejects(settings.openSettings({ page: 'cloud-computer', section: 'repository-secrets' }), /signed in/);
  }
});

test('a refusal from the host rejects openSettings without an unhandled rejection', async () => {
  const settings = await settingsFor({ settingsAvailable: true,
    navigate: () => ({ refused: 'context_inactive', message: 'This view is not on screen.' }) });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(settings.openSettings({ page: 'cloud-computer', section: 'repository-secrets' }), /not on screen/);
  } finally { console.warn = warn; }
});

test('repository names follow the repository secrets rule', () => {
  assert.equal(settingsRepositoryName('notis'), 'notis');
  assert.equal(settingsRepositoryName(' Owner-1/My.Repo_2 '), 'my.repo_2');
  for (const bad of ['', '-x', 'x-', 'a/b/c', '../etc', 'a b', 'x'.repeat(65), 'own_er/repo', 42]) {
    assert.equal(settingsRepositoryName(bad), null, String(bad));
  }
  assert.ok(settingsNavigation({ page: 'cloud-computer', section: 'repository-secrets', extra: 1 }) instanceof Error);
  assert.ok(settingsNavigation(null) instanceof Error);
});
