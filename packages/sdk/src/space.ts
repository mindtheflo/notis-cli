/** Portable Space source contracts. Grants and account identities are host-owned. */
import type { NotisRuntime, ToolInputSchema } from './runtime';
import type { NativeFilter, NativeMutationReceipt, NativeQuery } from './nativeData';
import { SdkQueryError, type QueryErrorKey } from './queryErrors';

export type SpaceJson = null | boolean | number | string | SpaceJson[] | { [key: string]: SpaceJson };

/** Exact server template format; slots are data, never JavaScript inference. */
export interface SpaceActionTemplate {
  tool: string;
  inputs: ToolInputSchema;
  arguments: Record<string, SpaceJson>;
}

/**
 * Explorer reads with the signed-in viewer's own authority: everything that viewer can
 * already open, never the Space owner's or an action issuer's. Read-only, no grant, no
 * billing, never on a Site or anonymous link.
 */
export type SpaceViewerReadFamily = 'databases' | 'skills';
export type SpaceViewerReadOperation = 'list_databases' | 'get_database' | 'query_database' | 'list_skills' | 'get_skill';
export const SPACE_VIEWER_READ_OPERATIONS: Readonly<Record<SpaceViewerReadOperation, SpaceViewerReadFamily>> = Object.freeze({
  list_databases: 'databases', get_database: 'databases', query_database: 'databases', list_skills: 'skills', get_skill: 'skills',
});

/**
 * Space cloud computer access (`cloudComputer`), the Space form of a Beta App's `capabilities.cloudComputer`.
 * `read`: facts only. `shell`: facts, one command, one file write. Always the signed-in viewer's own
 * cloud computer, after that viewer allows it; never on a Site, a link or an agent render.
 */
export type SpaceCloudComputerLevel = 'read' | 'shell';
export type SpaceCloudComputerOperation = 'facts' | 'run' | 'upload';
export interface SpaceCloudComputerStatus {
  level: SpaceCloudComputerLevel;
  approved: boolean;
  /** Why it is not approved: never allowed yet, or the Space changed since you allowed it. */
  reason: 'approval_required' | 'source_changed' | null;
  /** While not approved: the code asking, as the host prompt shows it. It informs the person and decides nothing. */
  release?: SpaceCloudComputerRelease;
}
/** Who released the code asking into this Space, and whether it is an unreleased preview. */
export interface SpaceCloudComputerRelease {
  preview: boolean;
  /** You (with your agents and the CLI), or another person by first name or email; null when not recorded. */
  released_by: { you: boolean; name: string | null } | null;
  /** Copied in from another Space or the Store: the person named applied it and may not have written it. */
  copied: boolean;
}
export interface SpaceCloudComputerRunInput {
  command: string; cwd?: string; timeout_ms?: number; max_output_length?: number;
  /**
   * One key per run, kept when the page retries that run: a key that already reached the cloud computer is
   * never run again (`cloud_computer_already_ran`). The host makes one when absent and keeps it for a retry
   * of the same run after an uncertain outcome.
   */
  request_id?: string;
}
export interface SpaceCloudComputerRunResult {
  status?: 'success' | 'error' | string; stdout?: string; stderr?: string; exit_code?: number;
  message?: string; code?: string; truncated?: boolean;
}
export interface SpaceCloudComputerUploadInput {
  path: string; content: string; content_encoding?: 'base64' | 'utf-8'; overwrite?: boolean; mode?: number;
  /** As for a run: one key per upload, kept when retrying it. */
  request_id?: string;
}
export interface SpaceCloudComputerUploadResult { status?: string; path?: string; size?: number; message?: string; code?: string }
/** Host transport. Approval is only ever given in host UI the person clicks; the view can only ask. */
export interface SpaceCloudComputerTransport {
  status(): Promise<SpaceCloudComputerStatus>;
  requestApproval(): Promise<SpaceCloudComputerStatus>;
  facts(options?: { refresh?: boolean }): Promise<import('./runtime').CloudComputerFacts>;
  run(input: SpaceCloudComputerRunInput): Promise<SpaceCloudComputerRunResult>;
  upload(input: SpaceCloudComputerUploadInput): Promise<SpaceCloudComputerUploadResult>;
}
export const SPACE_CLOUD_COMPUTER_OPERATIONS: Readonly<Record<SpaceCloudComputerOperation, SpaceCloudComputerLevel>> = Object.freeze({
  facts: 'read', run: 'shell', upload: 'shell',
});
export function spaceCloudComputerAllows(level: SpaceCloudComputerLevel | undefined, operation: SpaceCloudComputerOperation): boolean {
  const needed = SPACE_CLOUD_COMPUTER_OPERATIONS[operation];
  return level === 'shell' || (level === 'read' && needed === 'read');
}

/** A link the viewer can use (R10); unavailable links are never returned. */
export interface SpaceViewerLink { space_id: string; space_name: string | null; binding_id: string; alias: string | null }
export interface SpaceViewerDatabase {
  id: string; name: string | null; slug: string | null; description: string | null;
  /** Direct access of the viewer (own or Team); otherwise reached through `links`. */
  standalone: boolean;
  links: SpaceViewerLink[];
  target: { database_id: string } | { space_id: string; binding: string };
  /** Catalog facts; null when unknown, absent from older servers. */
  updated_at?: string | null;
  /** Active documents (stored count, else live). */
  documents_count?: number | null;
  /** The root Space the database came from (a converted App), when the viewer reaches it. */
  owner_space_id?: string | null;
  owner_space_name?: string | null;
}
export interface SpaceViewerDatabaseSchema extends SpaceViewerDatabase { schema: Record<string, unknown>; schema_revision: number }
export interface SpaceViewerSkill {
  skill_id: string; name: string | null; description: string | null;
  kind: 'standalone' | 'space' | 'curated' | 'legacy'; status: string; enabled: boolean | null;
  version: { revision: number; digest: string } | null; updated_at: string | null; created_at: string | null;
  links: SpaceViewerLink[];
  /** Present when content was requested; null where the viewer holds no content access (curated, legacy). */
  skill_md?: string | null;
}
export interface SpaceViewerSkillPage { skills: SpaceViewerSkill[]; has_more: boolean; next: string | null }
export type SpaceViewerReadInput = {
  list_databases: Record<string, never>;
  get_database: { database_id: string };
  query_database: { database_id: string; request: NativeQuery };
  list_skills: { after?: string; limit?: number; include_disabled?: boolean; include_content?: boolean };
  get_skill: { skill_id: string };
};
export type SpaceViewerReadResult = {
  list_databases: { databases: SpaceViewerDatabase[] };
  get_database: { database: SpaceViewerDatabaseSchema };
  query_database: { rows?: Array<Record<string, unknown>>; database_id: string; [key: string]: unknown };
  list_skills: SpaceViewerSkillPage;
  get_skill: { skill: SpaceViewerSkill & { skill_md: string | null } };
};

/** V11 can atomically create a database as part of a source release.
 * A created database must have a record param with main:true in the same view.
 * After creation, pull projects its live schema; later schema edits use database tools.
 */
export interface SpaceDatabaseCreate {
  name: string;
  schema: Record<string, SpaceJson>;
  starterRows?: Array<Record<string, SpaceJson>>;
}
export type SpaceResourceReference = {
  kind: 'database' | 'document' | 'skill' | 'automation';
  /** Portable resource key, resolved against this profile's explicit bindings. */
  key: string;
  create?: never;
} | {
  kind: 'database';
  create: SpaceDatabaseCreate;
  key?: never;
};

/** Optional V4 marker. Presentations always require path, description and memory at build time. */
export const SPACE_VIEW_SPEC_VERSION = 2;
export type SpaceViewParamType = 'record' | 'enum' | 'text' | 'number' | 'date' | 'boolean';
/** A declared URL param; unknown params are dropped and every param is described for agents. */
export interface SpaceViewParam {
  type: SpaceViewParamType;
  /** What the param selects, for agents and people. Required. */
  description: string;
  required?: boolean;
  /** Type-checked; never for record params. */
  default?: string | number | boolean;
  /** Enum values (enum only). */
  values?: readonly string[];
  /** Record params: the declared database resource alias whose records this param opens. */
  database?: string;
  /** Record params: this view is the database's main view (one per database). */
  main?: boolean;
  /** Record params: the property that makes the record slug in links; defaults to the title. */
  slugProperty?: string;
}
/**
 * Notis data the view lists: exactly this native filter over a declared database, with `{param}`,
 * `{param.property}`, `{record}` and `{record.property}` placeholders. Anything else is described.
 */
export type SpaceShows =
  | { database: string; where: NativeFilter | Record<string, never>; open?: string }
  | { about: string; services?: readonly string[] };
/** When view snapshots go to memory: on render, on a UTC cron (fixed minute), or after changes settle. */
export type SpaceMemorySnapshot = 'on_render' | { scheduled: string } | { on_change: { debounceSeconds: number } };
/** What this view sends to memory; records follow their database's main view. See the memory guide. */
export interface SpaceMemoryPolicy {
  markdown: boolean;
  attachments: boolean;
  screenshot: boolean;
  snapshots: readonly SpaceMemorySnapshot[];
}
export type SpaceChrome = 'portal' | 'hidden';
/**
 * Public runtime form of `shows`: list names only, never filters. `params` names the declared params
 * the list's filter reads (current hosts); without it every param is assumed to matter.
 */
export type SpaceShownDescriptor = { database: string; open?: string; params?: readonly string[] }
  | { about: string; services?: readonly string[] };
export interface SpaceShownOptions {
  sorts?: NativeQuery['sorts'];
  pageSize?: number;
  offset?: number;
  includeContent?: boolean;
}
export interface SpaceShownResult {
  rows: Array<Record<string, unknown>>;
  list: string;
  database: string;
  params: Record<string, unknown>;
  /** The list database's schema revision: pass it as `schemaRevision` to a declared row write. */
  schema_revision?: number;
  [key: string]: unknown;
}
/** Input of a `markdown` module's default export (V8 renders). */
export interface SpaceMarkdownInput {
  params: Record<string, unknown>;
  shown: Record<string, SpaceShownResult | undefined>;
}

export interface SpaceDefinition {
  name: string;
  /** Optional marker (2); omitting it does not waive a presentation's required declarations. */
  specVersion?: typeof SPACE_VIEW_SPEC_VERSION;
  /** Words used in this view's links, such as `notes` or `seo/keywords`. */
  path?: string;
  params?: Record<string, SpaceViewParam>;
  shows?: Record<string, SpaceShows>;
  memory?: SpaceMemoryPolicy;
  /** `hidden` hides the Portal sidebar and header for this view, keeping a small exit control. */
  chrome?: SpaceChrome;
  /** Source-relative module whose default export `(input: SpaceMarkdownInput) => string` renders this view as Markdown. */
  markdown?: string;
  description?: string;
  icon?: string;
  accent?: string;
  /** No entry means a container; it needs no dummy JavaScript artifact. */
  entry?: string;
  layout?: string;
  readableContext?: string;
  resources?: Record<string, SpaceResourceReference>;
  /** Named destinations bound by the host; package keys never contain account IDs. */
  navigation?: Record<string, { key: string }>;
  actions?: Record<string, SpaceActionTemplate>;
  /**
   * Reviewable declaration that this page reads what each signed-in viewer can open
   * (`databases`: list, schema, rows; `skills`: list, content), with that viewer's own
   * authority. Undeclared reads are refused; Sites and anonymous links never get them.
   */
  viewerReads?: SpaceViewerReadFamily[];
  /**
   * Reviewable declaration that this page uses each signed-in viewer's own cloud computer
   * (`read`: facts; `shell`: commands and file writes), once that viewer allows it.
   */
  cloudComputer?: SpaceCloudComputerLevel;
  collection?: { database: string; titleProperty: string; parentProperty?: string; allowCreate?: boolean };
  /** Reproducible source dependencies not discovered by the module graph. */
  sourceIncludes?: string[];
  /** Explicit synthetic action cases for offline render verification. */
  verificationFixtures?: string;
}

export interface SpacesWorkspace {
  /** One project, independently built/released definitions. */
  spaces: Record<string, { definition: string; parent?: string; defaultChild?: string }>;
  resources?: Record<string, { kind: SpaceResourceReference['kind']; source: string }>;
  defaultSpace?: string;
}

export function defineSpace<const T extends SpaceDefinition>(definition: T): T { return definition; }
export function defineSpaces<const T extends SpacesWorkspace>(workspace: T): T { return workspace; }

export interface SpaceActionDescriptor {
  id: string;
  inputSchema: ToolInputSchema;
  /** Determined by the server's tool classifier, not the source author. */
  readOnly: boolean;
}

export interface SpaceRuntimeDescriptor {
  id: string;
  revision: number;
  /** Opaque host identity includes actor/link, record context and live policy version. */
  cacheScope: string;
  navigation?: string[];
  /** Declared viewer reads; present only for a signed-in viewer, never on a Site. */
  viewerReads?: SpaceViewerReadFamily[];
  /** Declared cloud computer access; present only for a signed-in Editor, never on a Site. */
  cloudComputer?: SpaceCloudComputerLevel;
  /** V4: declared URL params, list names and chrome of the executable revision. */
  params?: Record<string, SpaceViewParam>;
  shows?: Record<string, SpaceShownDescriptor>;
  chrome?: SpaceChrome;
  actions: Record<string, SpaceActionDescriptor>;
  bindings: Record<string, {
    kind: SpaceResourceReference['kind'];
    operations?: Partial<Record<'query' | 'insert' | 'update' | 'delete', string>>;
    /** Signed-in viewers: the opaque name of this database's live change signal (never its id). */
    live?: string;
  }>;
}

export interface SpaceActionOptions {
  /** A caller-controlled idempotency key is stable across a deliberate retry. */
  requestId?: string;
  /** Revision discovered with the native schema/query; required for row writes. */
  schemaRevision?: number;
  readOnly?: boolean;
  dedupe?: boolean;
}

export type SpaceDocumentBodyRequest = {
  operation: 'read'; binding: string; recordKey: string; readAction: string;
} | {
  operation: 'save'; binding: string; recordKey: string; readAction: string; writeAction: string;
  contentMarkdown: string; expectedRevision: number; schemaRevision: number; requestId: string;
};
export interface SpaceDocumentBodyRead {
  record_key: string; title: string | null; revision: number; schema_revision: number; content_markdown: string;
}
export type SpaceDocumentBodySave = {
  status: 'succeeded'; billing_status: 'free'; receipt_id: string; result: NativeMutationReceipt;
} | { status: 'unchanged'; revision: number; schema_revision: number };
export type SpaceDocumentBodyResult = SpaceDocumentBodyRead | SpaceDocumentBodySave;

export interface SpaceActionFailureDetails {
  requestId: string;
  receiptId?: string;
  status?: string;
  pendingRequestIds?: string[];
  /** Why a settled action failed, when the host knows a stable reason: `read_timeout` (a read its time limit stopped). */
  code?: string;
}

/** Retain requestId when offering a retry of an uncertain external effect. */
export class SpaceActionError extends Error implements SpaceActionFailureDetails {
  constructor(message: string, public readonly requestId: string, public readonly receiptId?: string,
    public readonly status?: string, public readonly pendingRequestIds?: string[], public readonly code?: string) {
    super(message); this.name = 'SpaceActionError';
  }
}

export function spaceActionFailureDetails(error: unknown): SpaceActionFailureDetails | undefined {
  if (!(error instanceof SpaceActionError)) return undefined;
  return { requestId: error.requestId, receiptId: error.receiptId, status: error.status, pendingRequestIds: error.pendingRequestIds,
    ...(error.code ? { code: error.code } : {}) };
}

export function restoreSpaceActionError(message: string, details?: SpaceActionFailureDetails): Error {
  return details ? new SpaceActionError(message, details.requestId, details.receiptId, details.status, details.pendingRequestIds, details.code)
    : new Error(message);
}

/** Superseded UI intent, distinct from an authorization or transport failure. */
export class SpaceNavigationCancelled extends Error {
  readonly code = 'space_navigation_cancelled';
  constructor(message = 'This navigation is no longer active.') { super(message); this.name = 'SpaceNavigationCancelled'; }
}

export function isSpaceNavigationCancelled(error: unknown): error is SpaceNavigationCancelled {
  // Source bundles and the host may contain separate SDK instances.
  return error instanceof Error && error.name === 'SpaceNavigationCancelled'
    && (error as SpaceNavigationCancelled).code === 'space_navigation_cancelled';
}

export type SpaceRuntimeFailureDetails = SpaceActionFailureDetails | { kind: 'navigation_cancelled' };
export function spaceRuntimeFailureDetails(error: unknown): SpaceRuntimeFailureDetails | undefined {
  return isSpaceNavigationCancelled(error) ? { kind: 'navigation_cancelled' } : spaceActionFailureDetails(error);
}
export function restoreSpaceRuntimeError(message: string, details?: SpaceRuntimeFailureDetails): Error {
  if (details && 'kind' in details) return details.kind === 'navigation_cancelled' ? new SpaceNavigationCancelled(message) : new Error(message);
  return restoreSpaceActionError(message, details);
}

export function spaceQueryKey(runtime: NotisRuntime | null, key: readonly unknown[]): readonly unknown[] {
  if (runtime?.resource?.kind !== 'space') return key;
  const space = runtime.space;
  if (!space?.cacheScope || space.id !== runtime.resource.id || space.revision !== runtime.resource.revision) {
    throw new Error('The host must provide this Space revision and access context.');
  }
  return ['space', space.id, space.revision, space.cacheScope, ...key];
}

/** SDK defense in depth. The host/server independently reject these transports. */
export function guardSpaceRuntime(runtime: NotisRuntime | null, onProtocolError?: (error: Error) => void): NotisRuntime | null {
  if (runtime?.resource?.kind !== 'space') return runtime;
  spaceQueryKey(runtime, []);
  const protocolError = (message: string, key?: QueryErrorKey) => {
    const error = key ? new SdkQueryError(key, message, runtime.context?.locale) : new Error(message);
    onProtocolError?.(error); return error;
  };
  const deny = async (): Promise<never> => { throw protocolError('Use a declared Space action; account-wide tool and backend calls are unavailable.'); };
  const callAction = runtime.callAction;
  if (!callAction) throw new Error('This host needs the current Space action protocol.');
  const viewerRead = runtime.viewerRead;
  const shown = runtime.shown;
  const cloudComputer = runtime.spaceCloudComputer;
  const cloudLevel = runtime.space!.cloudComputer;
  const guardedCloud = (operation: SpaceCloudComputerOperation) => {
    if (!cloudComputer || !spaceCloudComputerAllows(cloudLevel, operation)) {
      throw protocolError(operation === 'facts' ? 'This Space does not use the cloud computer.'
        : 'This Space does not declare cloudComputer: shell.');
    }
    return cloudComputer;
  };
  return Object.freeze({ ...runtime, callTool: deny, request: deny, listTools: deny,
    shown: shown ? async function guardedShown<TResult>(name: string, params: Record<string, unknown> = {},
      options: SpaceShownOptions = {}): Promise<TResult> {
      const list = runtime.space!.shows && Object.hasOwn(runtime.space!.shows, name) ? runtime.space!.shows[name] : null;
      if (!list || !('database' in list)) throw protocolError('This view does not declare that list with a filter.', 'listUnavailable');
      return shown<TResult>(name, params, options);
    } : undefined,
    handover: undefined,
    // The legacy facts hook keeps working in a Space that declares the cloud computer.
    cloudComputerFacts: cloudComputer && cloudLevel ? async (options?: { refresh?: boolean }) => guardedCloud('facts').facts(options) : undefined,
    spaceCloudComputer: cloudComputer && cloudLevel ? Object.freeze({
      status: () => cloudComputer.status(),
      requestApproval: () => cloudComputer.requestApproval(),
      facts: async (options?: { refresh?: boolean }) => guardedCloud('facts').facts(options),
      run: async (input: SpaceCloudComputerRunInput) => guardedCloud('run').run(input),
      upload: async (input: SpaceCloudComputerUploadInput) => guardedCloud('upload').upload(input),
    }) : undefined,
    viewerRead: viewerRead ? async function guardedViewerRead<TResult>(operation: SpaceViewerReadOperation,
      input: Record<string, unknown> = {}): Promise<TResult> {
      const family = Object.hasOwn(SPACE_VIEWER_READ_OPERATIONS, operation) ? SPACE_VIEWER_READ_OPERATIONS[operation] : null;
      if (!family) throw protocolError('Viewer reads never change data. Choose a supported read.', 'readUnavailable');
      if (!runtime.space!.viewerReads?.includes(family)) throw protocolError(`This Space does not declare viewer reads of ${family}.`, 'readUnavailable');
      return viewerRead<TResult>(operation, input);
    } : undefined,
    async callAction<TResult>(id: string, inputs: Record<string, unknown> = {}, options: SpaceActionOptions = {}): Promise<TResult> {
      const descriptor = Object.hasOwn(runtime.space!.actions, id) ? runtime.space!.actions[id] : null;
      if (!descriptor) throw protocolError('This action is not declared by the published Space.', options.readOnly || options.dedupe ? 'actionUnavailable' : undefined);
      if ((options.readOnly || options.dedupe) && !descriptor.readOnly) throw protocolError('A write action cannot run as a cached read.', 'readUnavailable');
      return callAction<TResult>(id, inputs, options);
    },
  });
}
