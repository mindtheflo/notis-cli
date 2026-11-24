/**
 * Space functions: server code a Space declares once in `defineSpace({ functions })` and Notis calls from the
 * Space's views (`useFunction`), its HTTP API and MCP server, Notis agents, thread items, thread hooks and comment
 * options. A handler never reaches the browser, has no network and no secrets, and reaches only what `uses` lists.
 *
 * ```ts
 * // space.config.ts
 * functions: {
 *   count_open: {
 *     description: 'Count the open pull requests of a repository.',
 *     kind: 'read',
 *     input: { type: 'object', additionalProperties: false, required: ['repo'], properties: { repo: { type: 'string' } } },
 *     expose: ['page', 'api', 'agents'],
 *     access: ['viewer', 'editor', 'key'],
 *     uses: { actions: ['list_pull_requests'] },
 *     handler: './functions/count-open.ts',
 *   },
 * },
 *
 * // functions/count-open.ts
 * import type { SpaceFunctionHandler } from '@notis/sdk';
 * const handler: SpaceFunctionHandler<{ repo: string }, { open: number }> = async (input, ctx) => {
 *   const pulls = await ctx.actions.list_pull_requests({ repo: input.repo }) as { items: unknown[] };
 *   return { open: pulls.items.length };
 * };
 * export default handler;
 * ```
 *
 * A handler module imports types only from `@notis/sdk`: the SDK's code is for the page, not for functions.
 */
import type { SpaceCloudComputerLevel, SpaceThreadItemText } from './space';

/** What a call does: `read` changes nothing, `write` changes this Space's data, `action` reaches further. */
export type SpaceFunctionKind = 'read' | 'write' | 'action';
/** The ways in from outside the Space's own declarations: its views, its API and MCP server, Notis agents. */
export type SpaceFunctionExposure = 'page' | 'api' | 'agents';
/** Who may call: a Site or link visitor, a signed-in person who can open the Space, an editor, a Space key. */
export type SpaceFunctionRole = 'public' | 'viewer' | 'editor' | 'key';
/** Notis's built-in thread actions a function may run, only on a thread one of the Space's items is attached to. */
export type SpaceThreadOperation = 'archive' | 'unarchive' | 'read' | 'unread' | 'star' | 'unstar' | 'later' | 'back';
/** The built-in thread actions a Space can follow with a function (`threadHooks`). */
export type SpaceThreadHookEvent = SpaceThreadOperation | 'delete' | 'idle';

export interface SpaceFunctionUses {
  /** This Space's declared `actions`, run through the sealed action pipeline with the caller as the actor. */
  actions?: string[];
  /** The caller's own cloud computer, at most the level the Space declares, once that person allowed it. */
  cloudComputer?: SpaceCloudComputerLevel;
  /** Built-in thread actions on a thread holding one of this Space's items. Needs `threadItems`. */
  threads?: SpaceThreadOperation[];
}

export interface SpaceFunctionDeclaration {
  /** What the function does and when to call it: agents read it as the tool's description. */
  description: string;
  kind: SpaceFunctionKind;
  /** A closed object schema (`additionalProperties: false`), checked before the handler runs. */
  input: { type: 'object'; additionalProperties: false; properties?: Record<string, unknown>; required?: readonly string[];
    [key: string]: unknown };
  /** Checked on what the handler returns, and given to agents as the tool's output schema. */
  output?: Record<string, unknown>;
  /** Default: none. A closed function still runs from this Space's thread items, thread hooks and comment options. */
  expose?: SpaceFunctionExposure[];
  /** Default: editors only. The handler reads the caller's role in `ctx.caller.role`. */
  access?: SpaceFunctionRole[];
  /** Everything the handler can reach. Undeclared: the handler only computes. */
  uses?: SpaceFunctionUses;
  /** Source-relative module whose default export is the handler. */
  handler: string;
}

/** A comment option that runs a function when a person answers a choice comment with it (`commentOptions`). */
export interface SpaceCommentOption {
  /** The option as people read it; an agent offers it by writing this label in a choice comment's options. */
  label: SpaceThreadItemText;
  /** A function whose `input` is `commentOptionInput`. */
  function: string;
}

/** The `input` of a function a thread hook runs (`threadHooks`): copy it as written. */
export const threadHookInput = {
  type: 'object', additionalProperties: false, required: ['event', 'thread', 'items', 'actor'],
  properties: {
    event: { type: 'string', enum: ['archive', 'unarchive', 'read', 'unread', 'star', 'unstar', 'later', 'back', 'delete'] },
    actor: { type: 'string', enum: ['person', 'agent', 'notis'] },
    thread: { type: 'object', additionalProperties: false, required: ['id', 'thread_id'], properties: {
      id: { type: 'string' }, thread_id: { type: 'string' }, title: { type: ['string', 'null'] },
      archived: { type: 'boolean' }, starred: { type: 'boolean' }, read: { type: 'boolean' },
      later_until: { type: ['string', 'null'] } } },
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'kind', 'inputs'], properties: {
        id: { type: 'string' }, kind: { type: 'string' }, inputs: { type: 'object' },
        state: { type: ['string', 'null'] }, title: { type: ['string', 'null'] },
        url: { type: ['string', 'null'] } } } },
  },
} satisfies SpaceFunctionDeclaration['input'];

/** Input for the idle hook after the thread finishes its current work. */
export const threadIdleInput = {
  ...threadHookInput,
  required: [...threadHookInput.required, 'run_id'],
  properties: {
    ...threadHookInput.properties,
    event: { type: 'string', enum: ['idle'] },
    run_id: { type: 'string' },
  },
} satisfies SpaceFunctionDeclaration['input'];

/**
 * The `input` of the function a thread item kind settles with (`threadItems.<kind>.settle`): copy it as written.
 * Notis runs it once when an item of that kind first reaches a final state, with the item and its thread.
 */
export const threadSettleInput = {
  type: 'object', additionalProperties: false, required: ['item', 'thread'],
  properties: {
    item: { type: 'object', additionalProperties: false, required: ['id', 'kind', 'inputs'], properties: {
      id: { type: 'string' }, kind: { type: 'string' }, inputs: { type: 'object' },
      state: { type: ['string', 'null'] }, title: { type: ['string', 'null'] },
      url: { type: ['string', 'null'] } } },
    thread: { type: 'object', additionalProperties: false, required: ['id', 'thread_id'], properties: {
      id: { type: 'string' }, thread_id: { type: 'string' }, title: { type: ['string', 'null'] },
      archived: { type: 'boolean' }, starred: { type: 'boolean' }, read: { type: 'boolean' },
      later_until: { type: ['string', 'null'] } } },
  },
} satisfies SpaceFunctionDeclaration['input'];

/** The `input` of a function a comment option runs (`commentOptions`): copy it as written. */
export const commentOptionInput = {
  type: 'object', additionalProperties: false, required: ['option', 'comment'],
  properties: {
    option: { type: 'string' },
    comment: { type: 'object', additionalProperties: false, required: ['id'], properties: {
      id: { type: 'string' }, body: { type: 'string' }, view: { type: ['string', 'null'] },
      page_key: { type: ['string', 'null'] },
      anchor_keys: { type: 'array', items: { type: 'string' } } } },
  },
} satisfies SpaceFunctionDeclaration['input'];

/** One of the Space's items on a thread, as a hook or an item action receives it. */
export interface SpaceFunctionThreadItem {
  id: string; kind: string; inputs: Record<string, unknown>;
  state?: string | null; title?: string | null; url?: string | null;
}
/** A thread as a function sees it. `id` is what `ctx.threads` takes. */
export interface SpaceFunctionThread {
  id: string; thread_id: string; title?: string | null;
  archived?: boolean; starred?: boolean; read?: boolean; later_until?: string | null;
}
/** What a thread hook's function receives: the built-in action that just happened, and who did it. */
export interface SpaceThreadHookInput {
  event: Exclude<SpaceThreadHookEvent, 'idle'>;
  /** The person, one of their agents, or Notis itself (an automatic change, or another function's thread action). */
  actor: 'person' | 'agent' | 'notis';
  thread: SpaceFunctionThread;
  /** This Space's items attached to the thread. */
  items: SpaceFunctionThreadItem[];
}
export interface SpaceThreadIdleInput extends Omit<SpaceThreadHookInput, 'event'> {
  event: 'idle';
  run_id: string;
}
/** What a thread item kind's settle function receives: the item that reached a final state, and its thread. */
export interface SpaceThreadSettleInput {
  item: SpaceFunctionThreadItem;
  thread: SpaceFunctionThread;
}
/** What a comment option's function receives. */
export interface SpaceCommentOptionInput {
  /** The id of the declared option. */
  option: string;
  comment: { id: string; body?: string; view?: string | null; page_key?: string | null; anchor_keys?: string[] };
}

export interface SpaceFunctionCloudComputer {
  facts(): Promise<Record<string, unknown>>;
  /** Needs `uses.cloudComputer: 'shell'`. `cwd` is a folder inside the machine's workspace. */
  run(input: { command: string; cwd?: string; timeoutMs?: number }): Promise<{ exit_code: number | null; output: string;
    [key: string]: unknown }>;
}

/** What a handler can reach: nothing beyond the function's declared `uses`. */
export interface SpaceFunctionContext {
  /** Who is calling. `userId` is null for a Site or link visitor and for a Space key. */
  caller: { role: SpaceFunctionRole; userId: string | null };
  space: { id: string; revision: number };
  /** The way this call came in. */
  via: SpaceFunctionExposure | 'thread_item' | 'thread_hook' | 'thread_settle' | 'comment_option';
  /** One method per action named in `uses.actions`: the action's result, or a thrown error. */
  actions: Record<string, (inputs?: Record<string, unknown>) => Promise<unknown>>;
  /** The caller's own cloud computer. Calls throw until that person allowed this Space to use it. */
  cloudComputer: SpaceFunctionCloudComputer;
  /**
   * Built-in thread actions named in `uses.threads`, by thread `id`. Notis refuses a thread none of this Space's
   * items is attached to. `later` takes the time the thread comes back, as an ISO date with its zone.
   */
  threads: { [Operation in SpaceThreadOperation]: Operation extends 'later'
    ? (threadId: string, until: string) => Promise<void> : (threadId: string) => Promise<void> };
  /** Set when a thread item's action or settle runs the function: the item and its thread. */
  item?: SpaceFunctionThreadItem & { thread: SpaceFunctionThread };
}

export type SpaceFunctionHandler<TInput = Record<string, unknown>, TOutput = unknown> =
  (input: TInput, ctx: SpaceFunctionContext) => TOutput | Promise<TOutput>;

/** A function the page can call, as the host describes it (`runtime.space.functions`). */
export interface SpaceFunctionDescriptor {
  kind: SpaceFunctionKind;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** True when visitors may call it too: what "view as the public" keeps. */
  public?: boolean;
}

export interface SpaceFunctionCallOptions {
  /** A caller-controlled idempotency key, kept across a deliberate retry of a write or an action. */
  requestId?: string;
}
