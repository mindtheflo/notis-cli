import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { NotisProvider } from '../provider';
import { createQueryClient } from '../queryCache';
import type { NotisRuntime } from '../runtime';
import type { SpaceAgentsStatus, SpaceItemThread } from '../space';
import { useAgentQueue, AGENT_QUEUE_WORDS, type UseAgentQueueResult } from './useAgentQueue';
import { useItemThread, type UseItemThreadResult } from './useItemThread';
import { readCommentRow } from '../ui/comments/commentModel';
import { CommentAgentSource } from '../ui/comments/CommentPane';
import { commentWords } from '../ui/comments/commentWords';
import type { CommentController } from '../ui/comments/useComments';

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function runtimeWith(threads: Record<string, unknown>, extra: Record<string, unknown> = {}, locale: 'en' | 'fr' = 'en') {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {}, bindings: {} },
    context: { params: {}, locale },
    queryClient: createQueryClient(),
    callAction: async () => { throw new Error('no actions in this test'); },
    spaceThreads: threads,
    ...extra,
  } as unknown as NotisRuntime;
}

async function mount(runtime: NotisRuntime, Probe: () => null) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  await settle();
  return root;
}

test('useItemThread reads the matched thread and opens it with the draft', async () => {
  const opened: Array<[string, unknown]> = [];
  const resolved: Array<unknown> = [];
  const runtime = runtimeWith({
    resolve: async (input?: { recordKey?: string }) => {
      resolved.push(input);
      return { thread_id: 't-record', rule: 'best_match', level: 'record' } satisfies SpaceItemThread;
    },
    open: async (threadId: string, options?: unknown) => { opened.push([threadId, options]); return true; },
  });
  let result: UseItemThreadResult | null = null;
  const root = await mount(runtime, function Probe() { result = useItemThread('rec-1'); return null; });
  assert.equal(result!.thread?.thread_id, 't-record');
  assert.equal(result!.available, true);
  assert.deepEqual(resolved[0], { recordKey: 'rec-1' });
  let ok = false;
  await act(async () => { ok = await result!.open({ draft: 'Fix slide 2' }); });
  assert.equal(ok, true);
  assert.deepEqual(opened, [['t-record', { draft: 'Fix slide 2' }]], 'the item thread opens, never a new chat');
  root.unmount();
});

test('useItemThread starts a new chat when nothing matches yet', async () => {
  const drafts: unknown[] = [];
  const runtime = runtimeWith({
    resolve: async () => ({ thread_id: null, rule: 'space', level: null }),
    open: async () => { throw new Error('nothing to open'); },
  }, { draftHandover: async (payload: unknown) => { drafts.push(payload); return { status: 'drafted' }; } });
  let result: UseItemThreadResult | null = null;
  const root = await mount(runtime, function Probe() { result = useItemThread(); return null; });
  assert.equal(result!.thread?.thread_id, null);
  await act(async () => { await result!.open({ draft: 'Hello' }); });
  assert.deepEqual(drafts, [{ prompt: 'Hello' }]);
  root.unmount();
});

test('without the transport the hooks say unavailable and do nothing', async () => {
  const runtime = runtimeWith(undefined as unknown as Record<string, unknown>);
  let queue: UseAgentQueueResult | null = null;
  let thread: UseItemThreadResult | null = null;
  const root = await mount(runtime, function Probe() { queue = useAgentQueue('editor'); thread = useItemThread('r'); return null; });
  assert.equal(queue!.available, false);
  assert.equal(queue!.label, AGENT_QUEUE_WORDS.unavailable.en);
  assert.equal(thread!.available, false);
  assert.equal(await thread!.open(), false);
  assert.equal(await queue!.approve(), false);
  root.unmount();
});

test('useAgentQueue shows the status in French with the thread link, and approval releases held comments', async () => {
  let approved = false;
  const asked: Array<[string, string | undefined]> = [];
  const opened: string[] = [];
  const runtime = runtimeWith({
    agentStatus: async (agentId: string, scope?: string): Promise<SpaceAgentsStatus> => {
      asked.push([agentId, scope]);
      return approved
        ? { declared: ['editor'], approved: true, queue: { status: 'waiting', thread_id: 't-1', pending: 0, approval_required: false, updated_at: '2026-11-03T10:00:00Z' } }
        : { declared: ['editor'], approved: false, queue: { status: 'waiting', thread_id: null, pending: 2, approval_required: true, updated_at: null } };
    },
    approveAgents: async () => { approved = true; return { approved: true, released: 1 }; },
    open: async (threadId: string) => { opened.push(threadId); return true; },
  }, {}, 'fr');
  let queue: UseAgentQueueResult | null = null;
  const root = await mount(runtime, function Probe() { queue = useAgentQueue('editor', 'deck-1'); return null; });
  assert.deepEqual(asked[0], ['editor', 'deck-1']);
  assert.equal(queue!.approvalRequired, true);
  assert.equal(queue!.approveLabel, 'Autoriser');
  assert.equal(queue!.approvalLabel, 'Autorise cet agent à répondre à tes commentaires');
  assert.equal(queue!.threadId, null);
  assert.equal(await queue!.openThread(), false, 'no thread yet');
  await act(async () => { await queue!.approve(); });
  await settle();
  assert.equal(queue!.status, 'waiting');
  assert.equal(queue!.label, 'Attend ta réponse');
  assert.equal(queue!.openLabel, 'Ouvrir la conversation');
  assert.equal(queue!.threadId, 't-1');
  await act(async () => { await queue!.openThread(); });
  assert.deepEqual(opened, ['t-1']);
  root.unmount();
});

test('useAgentQueue keeps reading while the agent works, even when the answer stays the same', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const answers: Array<SpaceAgentsStatus['queue']> = [];
  const working = { status: 'working', thread_id: 't-1', pending: 0, approval_required: false, updated_at: '2026-11-03T10:00:00Z' } as const;
  const runtime = runtimeWith({
    agentStatus: async (): Promise<SpaceAgentsStatus> => {
      const queue = answers.length < 3 ? working : { ...working, status: 'waiting' as const };
      answers.push(queue);
      return { declared: ['editor'], approved: true, queue };
    },
  });
  let queue: UseAgentQueueResult | null = null;
  const root = await mount(runtime, function Probe() { queue = useAgentQueue('editor', 'deck-1'); return null; });
  assert.equal(queue!.status, 'working');
  for (let read = 0; read < 3; read += 1) {
    await act(async () => { t.mock.timers.tick(4_000); });
    await settle();
  }
  assert.equal(queue!.status, 'waiting', 'the same "working" answer twice must not stop the reads');
  const reads = answers.length;
  await act(async () => { t.mock.timers.tick(12_000); });
  await settle();
  assert.equal(answers.length, reads, 'no fast reads once the agent stopped working');
  await act(async () => { t.mock.timers.tick(3_000); });
  await settle();
  assert.equal(answers.length, reads + 1, 'an idle queue still reads every 15 seconds, so a new comment shows Queued');
  root.unmount();
});

test('every queue status has its words in both languages', () => {
  for (const status of ['idle', 'queued', 'working', 'waiting', 'failed', 'done'] as const) {
    assert.ok(AGENT_QUEUE_WORDS[status].en && AGENT_QUEUE_WORDS[status].fr, status);
    assert.notEqual(AGENT_QUEUE_WORDS[status].en, AGENT_QUEUE_WORDS[status].fr, status);
  }
});

test('a comment an agent wrote carries its signature, clickable to its thread only for its owner', () => {
  const base = { record_key: 'c1', id: 'c1', title: 'Shortened the title', properties: { Author: 'Notis' } };
  const owner = readCommentRow({ ...base, agent: { name: 'Editor', thread_id: 't-9', row_id: 'row-3' } } as never);
  const other = readCommentRow({ ...base, agent: { name: 'Editor' } } as never);
  const person = readCommentRow({ ...base, properties: { Author: 'Flo' } } as never);
  assert.deepEqual(owner.agent, { name: 'Editor', threadId: 't-9', rowId: 'row-3' });
  assert.deepEqual(other.agent, { name: 'Editor', threadId: null, rowId: null });
  assert.equal(person.agent, null, 'the Author column alone never makes an agent');

  const words = commentWords();
  const controller = (locale: 'en' | 'fr', openThread?: (id: string) => void) => ({
    words, locale, openThread,
    say: (key: keyof typeof words, vars: Record<string, string> = {}) =>
      words[key][locale].replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? ''),
  }) as unknown as CommentController;
  const linked = renderToStaticMarkup(<CommentAgentSource controller={controller('en', () => undefined)} comment={owner} />);
  assert.match(linked, /^<button type="button" class="nui-comment-agent" data-agent-thread="t-9"/);
  assert.match(linked, /From Editor/);
  const plain = renderToStaticMarkup(<CommentAgentSource controller={controller('fr', () => undefined)} comment={other} />);
  assert.match(plain, /^<span class="nui-comment-agent">/);
  assert.match(plain, /De Editor/);
  assert.equal(renderToStaticMarkup(<CommentAgentSource controller={controller('en')} comment={person} />), '');
});
