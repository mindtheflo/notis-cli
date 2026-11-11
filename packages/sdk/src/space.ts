/** Portable Space source contracts. Grants and account identities are host-owned. */
import type { HandoverPayload, NotisRuntime, NotisRuntimeUI, SubscribeDatabaseOptions, ToolInputSchema } from './runtime';
import type { NativeFilter, NativeMutationReceipt, NativeQuery } from './nativeData';
import { SdkQueryError, type QueryErrorKey } from './queryErrors';

export type SpaceJson = null | boolean | number | string | SpaceJson[] | { [key: string]: SpaceJson };

/** Exact server template format; slots are data, never JavaScript inference. */
export interface SpaceActionTemplate {
  tool: string;
  inputs: ToolInputSchema;
  arguments: Record<string, SpaceJson>;
  /** Only the Space's editors can call it; the public never sees it. Default: public. */
  editorsOnly?: true;
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
 * Space cloud computer access, declared as `cloudComputer` in `defineSpace`.
 * `read`: facts and the Space folder. `shell`: also commands, background jobs, file writes and services.
 * Always the signed-in viewer's own cloud computer, after that viewer allows it; never on a Site, a link or an
 * agent render.
 */
export type SpaceCloudComputerLevel = 'read' | 'shell';

/**
 * One agent a Space's database changes wake, declared in `defineSpace({ agents })`.
 * `thread`: `best_match` (the person's thread linked to the item, else a new one linked to it) or `space`
 * (one thread per Space and person). `runtime`: hosted (`notis`) or a coding agent on the person's Cloud
 * Computer. `wake: 'sent'` wakes only for replies to and answers on the agent's own comments.
 * `columns` renames the comment columns read (defaults: Thread, Deck, Answer, Author).
 */
export interface SpaceAgentDeclaration {
  id: string;
  on: { database: string; event?: 'created' | 'changed' };
  thread?: 'best_match' | 'space';
  runtime?: 'notis' | 'cloud_computer';
  skill?: string;
  wake?: 'all' | 'sent';
  columns?: { thread?: string; scope?: string; answer?: string; author?: string };
}
/** The thread an item (a record, or the Space itself) continues, from the Space's thread rule. */
export interface SpaceItemThread {
  /** Null when nothing matches yet: the first message creates the thread and links it to the item. */
  thread_id: string | null;
  rule: 'best_match' | 'space';
  /** How closely the thread matches: record, view_params, view, space; null when none. */
  level: 'record' | 'view_params' | 'view' | 'space' | null;
}
/** One Space agent's latest wake-up for the viewer (`useAgentQueue`). */
export interface SpaceAgentQueue {
  status: 'idle' | 'queued' | 'working' | 'waiting' | 'failed' | 'done';
  thread_id: string | null;
  /** Items waiting in the quiet window or held for approval. */
  pending: number;
  /** True until the viewer allows this exact version's agents to wake their threads. */
  approval_required: boolean;
  updated_at: string | null;
}
export interface SpaceAgentsStatus {
  declared: string[];
  approved: boolean;
  queue?: SpaceAgentQueue;
}
/** Space-only transport of the thread resolver and the agents' queue. */
export interface SpaceThreadsTransport {
  resolve(input?: { recordKey?: string }): Promise<SpaceItemThread>;
  /** Open a thread in the host's side chat, optionally with an unsent draft. */
  open(threadId: string, options?: { draft?: string }): Promise<boolean>;
  agentStatus(agentId: string, scope?: string): Promise<SpaceAgentsStatus>;
  approveAgents(): Promise<{ approved: boolean; released: number }>;
}
/**
 * A long-running program the Space keeps up on the viewer's cloud computer while the page is on screen (a dev
 * server, a media server). It runs with `bash -lc`, listens on `127.0.0.1:$PORT`, and gets `HOST`,
 * `NOTIS_SPACE_DIR`, `NOTIS_SPACE_ID` and `NOTIS_SERVICE_ID`. Reach it with `useCloudComputerService(id)`.
 */
export interface SpaceCloudComputerService {
  /** `/^[a-z][a-z0-9-]{0,39}$/`, unique in the Space. */
  id: string;
  /** Non-empty, at most 4096 characters. */
  command: string;
  /** A machine path (relative to /vercel/sandbox or absolute inside it) or `{ space: '<rel>' }` in the Space folder. Default: the Space folder. */
  cwd?: string | { space: string };
  /** Readiness path, starting with `/`; default `/`. */
  ready?: string;
}
/** The object form of `cloudComputer`; `'read'` and `'shell'` mean `{ access: <level> }`. */
export interface SpaceCloudComputerDeclaration {
  access: SpaceCloudComputerLevel;
  /** Needs `access: 'shell'`; at most 4. */
  services?: readonly SpaceCloudComputerService[];
}
export type SpaceCloudComputerJobOperation = 'job.status' | 'job.logs' | 'job.cancel';
/** A direct transfer session: the host uses these for `upload({ file })`; a page never calls them itself. */
export type SpaceCloudComputerTransferOperation = 'transfer.begin' | 'transfer.status' | 'transfer.commit' | 'transfer.abort';
export type SpaceCloudComputerOperation = 'facts' | 'run' | 'upload' | SpaceCloudComputerJobOperation | 'service.lease'
  | 'service.access' | 'folder' | SpaceCloudComputerTransferOperation | 'import';
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
  command: string;
  /** A machine path, or `{ space: '<rel>' }` inside the Space folder (`''` is its root). Without it a run starts in /vercel/sandbox. */
  cwd?: string | { space: string };
  /** With `detach`, bounds the background job: 1000 to 21600000 (6 h), default 3600000. */
  timeout_ms?: number; max_output_length?: number;
  /** Start the command as a background job and answer at once with `job_id` and `job`. */
  detach?: boolean;
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
  /** A detached run: the background job it started. */
  job_id?: string; job?: SpaceCloudComputerJobStatus;
}
/** `lost`: the cloud computer stopped or forgot the job before it ended. */
export type JobState = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'lost';
export interface SpaceCloudComputerJobStatus {
  job_id: string; status: JobState; exit_code: number | null; started_at: string | null; ended_at: string | null; log_bytes: number;
}
export interface SpaceCloudComputerJobInput {
  job_id: string;
  /** `job.logs`: the first byte to read (default 0). */
  offset?: number;
  /** `job.logs`: 1 to 200000 bytes (default 65536). */
  max_bytes?: number;
}
export interface SpaceCloudComputerJobLogs {
  job_id: string; status: JobState; text: string; offset: number; next_offset: number;
  /** The job ended and every byte was read. */
  eof: boolean;
}
export type SpaceCloudComputerJobResult<O extends SpaceCloudComputerJobOperation> =
  O extends 'job.logs' ? SpaceCloudComputerJobLogs : SpaceCloudComputerJobStatus;
export interface SpaceCloudComputerLeaseInput {
  service: string;
  /** `true` renews the lease for 120 s and starts the service when needed; `false` stops renewing it. */
  visible: boolean;
  /** One id per view instance, kept for its life: 8 to 100 of `A-Z a-z 0-9 . _ : -`. */
  holder: string;
}
export interface SpaceCloudComputerLeaseResult {
  service: string;
  status: 'starting' | 'ready' | 'failed' | 'released';
  lease_expires_at: string | null;
  /** While starting: ask again after this many seconds. */
  retry_after_seconds: number | null;
  /**
   * While failed: a stable reason and what went wrong. While starting, `restoring` means the machine runs but is still
   * restoring its files after a pause (it can take minutes), and `launching` that the service runs on the machine and is
   * getting ready (the machine's own bound decides, so the view keeps waiting).
   */
  reason?: string; message?: string;
  /** The gate that serves the service, and the Bearer pass for it; null until the gate is on. */
  gate_url: string | null;
  pass: string | null;
  pass_expires_at: string | null;
  price: { hourly_usd: number | null; size: string | null };
}
export interface SpaceCloudComputerAccessInput {
  service: string;
  /** Service file paths (each starting with `/`, no query) to open in a media element: up to 50, one link each. */
  media?: string[];
  /** A one-time code the service frame exchanges for its own session. */
  frame?: boolean;
  /** With `frame`: where the frame lands. A root path (`/`) serves the service from the gate root. */
  path?: string;
}
/** One file of one service for ten minutes; seeking (Range) works. */
export interface SpaceCloudComputerMediaLink { path: string; url: string; expires_at: string }
/** Load `frame` in an iframe; when it posts `notis-gate-ready`, post `{ type: 'notis-gate-code', code }` to it. */
export interface SpaceCloudComputerFrameCode { frame: string; action: string; code: string; next: string; expires_at: string }
export interface SpaceCloudComputerAccessResult {
  service: string; gate_url: string | null; media: SpaceCloudComputerMediaLink[]; frame: SpaceCloudComputerFrameCode | null;
}
/** The folder this Space works in on the cloud computer: `mapped` when the person mapped it to an existing folder. */
export interface SpaceCloudComputerFolder { path: string; canonical_path: string; mapped: boolean }
export interface SpaceCloudComputerUploadInput {
  path: string; content: string; content_encoding?: 'base64' | 'utf-8'; overwrite?: boolean; mode?: number;
  /** As for a run: one key per upload, kept when retrying it. */
  request_id?: string;
}
export interface SpaceCloudComputerUploadResult { status?: string; path?: string; size?: number; message?: string; code?: string }

/**
 * A file a signed-in Editor attaches from a view to a database's files column (a comment's picture), uploaded
 * before the row that holds it is written. Stored privately in the EU: the row keeps `file`, and every read of
 * the row signs it for an hour, so it opens only for people (and agents) who can read that row.
 */
export interface SpaceFileUploadInput {
  /** The database binding alias the view declares (its `resources` key). */
  database: string;
  /** The files column the reference goes into. */
  column: string;
  file: Blob;
  /** The file's name with its extension. Default: the File's own name. */
  name?: string;
  /** One key per file: the same file sent again after an uncertain answer keeps it. Default: a new key per call. */
  requestId?: string;
  /** Bytes sent so far, for a progress bar. */
  onProgress?(sent: number, total: number): void;
  signal?: AbortSignal;
}
/** What a files column stores. */
export interface SpaceFileReference { name: string; url: string }
export interface SpaceFileUploadResult {
  /** Write this into the files column with the row's insert or update. */
  file: SpaceFileReference;
  /** A signed address to show the file before the row is read back (an hour), or null. */
  previewUrl: string | null;
  sizeBytes: number; contentType: string; sha256: string; requestId: string;
}
/** The database column takes files from this view, with the limits the host enforces. */
export interface SpaceFilesCheck { available: true; maxBytes: number; extensions: string[] }
/**
 * Codes a file upload fails with: `space_file_too_large`, `space_file_type_unsupported`, `space_file_empty`,
 * `space_file_column_missing`, `space_file_write_required`, `space_file_unconfirmed` (try again),
 * `space_file_offline` (no answer), `sign_in_required`, `editor_required`, or another server code.
 */
export class SpaceFileError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) {
    super(message); this.name = 'SpaceFileError';
  }
}
/** Host transport for files attached from a view. Absent on Sites, previews, verification harnesses and older hosts. */
export interface SpaceFilesTransport {
  check(database: string, column: string): Promise<SpaceFilesCheck>;
  upload(input: SpaceFileUploadInput): Promise<SpaceFileUploadResult>;
}
/** Extensions a files column accepts from a view, before the host's own check answers. */
export const SPACE_FILE_EXTENSIONS: readonly string[] = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'docx',
  'xlsx', 'pptx', 'odt', 'ods', 'odp', 'doc', 'xls', 'ppt', 'rtf', 'txt', 'md', 'csv', 'tsv', 'json']);
export const SPACE_FILE_MAX_BYTES = 8 * 1024 * 1024;
/**
 * A file the page holds (a `File` from an input or a drop, or any `Blob`) for the Space folder. Above 1 MiB its
 * parts go straight from the browser to the cloud computer, never through Notis servers; the machine checks its
 * sha256 before it replaces the file at `dest`.
 */
export interface SpaceCloudComputerFileUpload {
  file: Blob;
  /** `{ space: 'files/clip.mp4' }`: the file's path inside the Space folder. */
  dest: { space: string };
  /** Called as the file is read, sent and put in place. */
  onProgress?(progress: SpaceCloudComputerUploadProgress): void;
  /** Aborting cancels the upload and drops the parts already sent. */
  signal?: AbortSignal;
}
export interface SpaceCloudComputerUploadProgress {
  /** `preparing`: reading the file for its sha256. `finishing`: the machine checks it and puts it in place. */
  phase: 'preparing' | 'sending' | 'finishing' | 'done';
  path: string; sent_bytes: number; total_bytes: number;
}
export interface SpaceCloudComputerFileUploadResult {
  status: 'success'; path: string; size: number; sha256: string;
  /** Present when the file went through a direct transfer session. */
  session_id?: string;
}
/** Have the cloud computer download a public `http(s)` URL itself into the Space folder. */
export interface SpaceCloudComputerImportInput {
  url: string;
  /** `{ space: 'files/data.zip' }`: the file's path inside the Space folder. */
  dest: { space: string };
  /** When given, the download must match it. */
  sha256?: string;
  /** Default true. */
  overwrite?: boolean;
  /** As for a run: one key per import, kept when retrying it. */
  request_id?: string;
}
export interface SpaceCloudComputerImportResult {
  status?: 'success' | 'error' | string; path?: string; size?: number; sha256?: string;
  /** Bytes a previous unfinished download of the same URL had already fetched. */
  resumed_from?: number;
  code?: string; message?: string; retryable?: boolean;
}
/**
 * Host transport. Approval is only ever given in host UI the person clicks; the view can only ask. `lease`, `job`
 * and `folder` are absent from hosts that predate them.
 */
export interface SpaceCloudComputerTransport {
  status(): Promise<SpaceCloudComputerStatus>;
  requestApproval(): Promise<SpaceCloudComputerStatus>;
  facts(options?: { refresh?: boolean }): Promise<import('./runtime').CloudComputerFacts>;
  run(input: SpaceCloudComputerRunInput): Promise<SpaceCloudComputerRunResult>;
  upload(input: SpaceCloudComputerUploadInput): Promise<SpaceCloudComputerUploadResult>;
  lease?(input: SpaceCloudComputerLeaseInput): Promise<SpaceCloudComputerLeaseResult>;
  /** Media links and frame codes for a ready service: what an element that cannot send a header needs. */
  access?(input: SpaceCloudComputerAccessInput): Promise<SpaceCloudComputerAccessResult>;
  job?<O extends SpaceCloudComputerJobOperation>(operation: O, input: SpaceCloudComputerJobInput): Promise<SpaceCloudComputerJobResult<O>>;
  folder?(): Promise<SpaceCloudComputerFolder>;
  /** A file from the page into the Space folder (`upload({ file })`); absent from hosts that predate it. */
  sendFile?(input: SpaceCloudComputerFileUpload): Promise<SpaceCloudComputerFileUploadResult>;
  importUrl?(input: SpaceCloudComputerImportInput): Promise<SpaceCloudComputerImportResult>;
}
export const SPACE_CLOUD_COMPUTER_OPERATIONS: Readonly<Record<SpaceCloudComputerOperation, SpaceCloudComputerLevel>> = Object.freeze({
  facts: 'read', run: 'shell', upload: 'shell', 'job.status': 'shell', 'job.logs': 'shell', 'job.cancel': 'shell',
  'service.lease': 'shell', 'service.access': 'shell', folder: 'read', 'transfer.begin': 'shell', 'transfer.status': 'shell',
  'transfer.commit': 'shell', 'transfer.abort': 'shell', import: 'shell',
});
export function spaceCloudComputerAllows(level: SpaceCloudComputerLevel | undefined, operation: SpaceCloudComputerOperation): boolean {
  const needed = Object.hasOwn(SPACE_CLOUD_COMPUTER_OPERATIONS, operation) ? SPACE_CLOUD_COMPUTER_OPERATIONS[operation] : null;
  if (!needed) return false;
  return level === 'shell' || (level === 'read' && needed === 'read');
}
/** The access level of a `cloudComputer` declaration in either form, or null. */
export function spaceCloudComputerAccess(declaration: SpaceCloudComputerLevel | SpaceCloudComputerDeclaration | null | undefined):
  SpaceCloudComputerLevel | null {
  const level = typeof declaration === 'string' ? declaration : declaration?.access;
  return level === 'read' || level === 'shell' ? level : null;
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
/**
 * Database columns only the Space's editors read and write, by property name. The server leaves them out of every
 * row the public reads through this Space and refuses public writes to them.
 */
export type SpaceResourceColumns = Record<string, { editorsOnly: true }>;
export type SpaceResourceReference = {
  kind: 'database' | 'document' | 'skill' | 'automation';
  /** Portable resource key, resolved against this profile's explicit bindings. */
  key: string;
  create?: never;
  /** Database resources only. */
  columns?: SpaceResourceColumns;
} | {
  kind: 'database';
  create: SpaceDatabaseCreate;
  key?: never;
  columns?: SpaceResourceColumns;
};

/** Optional V4 marker. Presentations always require path, description and memory at build time. */
export const SPACE_VIEW_SPEC_VERSION = 2;
export type SpaceViewParamType = 'record' | 'enum' | 'text' | 'number' | 'date' | 'period' | 'boolean';
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
  /**
   * Record params, at most one per view: a record matching `where` (fixed values only) opens full screen as its own
   * page instead of this view. Editors see saved HTML pages and reports in the Portal; a record Site shows its HTML
   * page only. The server checks the rule; it never reaches the browser.
   */
  page?: { where: NativeFilter };
  /** IANA timezone for relative dates/periods (UTC if omitted). */
  timezone?: string;
  /** Only editors can set it; for the public it is dropped like an unknown param. A required one needs a default. */
  editorsOnly?: true;
}
/**
 * Notis data the view lists: exactly this native filter over a declared database, with `{param}`,
 * `{param.property}`, `{record}` and `{record.property}` placeholders. Anything else is described.
 */
export type SpaceViewFilter = { and: SpaceViewFilter[] } | { or: SpaceViewFilter[] }
  | (Extract<NativeFilter, { field: unknown }> & { /** Apply only when this boolean param is true. */ when?: string });
export type SpaceShows =
  | { database: string; where: SpaceViewFilter | Record<string, never>; open?: string; /** Editors only. Default: public. */ editorsOnly?: true }
  | { about: string; services?: readonly string[]; editorsOnly?: true };
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
  /** The list database's column names, in schema order (hosts that send them): write only columns it has. */
  property_names?: string[];
  [key: string]: unknown;
}
/** Input of a `markdown` module's default export (V8 renders). */
export interface SpaceMarkdownInput {
  params: Record<string, unknown>;
  shown: Record<string, SpaceShownResult | undefined>;
}

export interface SpaceDefinition {
  name: string;
  /**
   * The whole view is for the Space's editors: for the public it does not exist (missing from navigation, its
   * address is the Site's not-found). Lists, actions, params and database columns take their own `editorsOnly`.
   * Anything unmarked is public, for reads and writes alike.
   */
  editorsOnly?: true;
  /** Optional marker (2); omitting it does not waive a presentation's required declarations. */
  specVersion?: typeof SPACE_VIEW_SPEC_VERSION;
  /** Words used in this view's links, such as `notes` or `seo/keywords`. */
  path?: string;
  /** Questions this view can answer; used by agents when choosing an existing view. */
  questions?: string[];
  params?: Record<string, SpaceViewParam>;
  shows?: Record<string, SpaceShows>;
  memory?: SpaceMemoryPolicy;
  /** `hidden` hides the Portal sidebar and header for this view, keeping a small exit control. */
  chrome?: SpaceChrome;
  /** Source-relative module whose default export `(input: SpaceMarkdownInput) => string` renders this view as Markdown. */
  markdown?: string;
  description?: string;
  /** Required to deploy or preview: `phosphor:<kebab-name>` (for example `phosphor:calendar-check`) or an https image URL. */
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
   * (`read`: facts; `shell`: commands, jobs and file writes), once that viewer allows it. The object form adds
   * `services` the page keeps up while it is on screen.
   */
  cloudComputer?: SpaceCloudComputerLevel | SpaceCloudComputerDeclaration;
  /**
   * Agents this Space's database changes wake. A person's new comment, reply or answer wakes their own
   * thread for the item (or, for a reply to an agent's comment, that agent's thread) after a quiet
   * moment, once that person allowed this Space's agents. Agents' own writes never wake anything.
   */
  agents?: SpaceAgentDeclaration[];
  /**
   * Lists the database's records as sidebar rows under this Space. Only for a short list people navigate
   * like pages (folders, chapters); a database that keeps growing belongs in the view's `shows` instead.
   */
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

/** Who the Space is drawn for: its editors, or the public (Site and link visitors, signed-in people who cannot edit). */
export type SpaceAudience = 'editor' | 'public';
/** What the published view marks editor-only; sent to editors only. */
export interface SpaceEditorsOnly {
  view?: true;
  shows?: string[];
  actions?: string[];
  params?: string[];
  /** Database binding alias to its editor-only property names. */
  columns?: Record<string, string[]>;
}

/**
 * The editor-only column names a definition declares on one database resource:
 * `EditorOnlyColumns<typeof definition, 'tickets'>`.
 */
export type EditorOnlyColumns<D extends Pick<SpaceDefinition, 'resources'>, A extends keyof NonNullable<D['resources']>> =
  NonNullable<D['resources']>[A] extends { columns: infer C } ? Extract<{ [K in keyof C]: C[K] extends { editorsOnly: true } ? K : never }[keyof C], string>
    : never;
/**
 * A row as one audience reads it: for the public, the editor-only columns are absent from `properties` (or from the
 * row itself when it has no `properties`). `AudienceRow<Row, EditorOnlyColumns<typeof definition, 'tickets'>>`.
 */
export type AudienceRow<Row, Cols extends string, A extends SpaceAudience = 'public'> = A extends 'editor' ? Row
  : Row extends { properties: infer P } ? Omit<Row, 'properties'> & { properties: Omit<P, Cols> } : Omit<Row, Cols>;

export interface SpaceRuntimeDescriptor {
  id: string;
  revision: number;
  /** Opaque host identity includes actor/link, record context and live policy version. */
  cacheScope: string;
  /** Who the server drew this descriptor for. Absent on older servers, which means `public`. */
  audience?: SpaceAudience;
  /** Editors only: what this view marks editor-only, so the host can offer View as the public. */
  editorsOnly?: SpaceEditorsOnly;
  /**
   * Host-set: an editor is viewing this Space as the public. The SDK applies the public floors in the page
   * (editor-only lists, actions, params and columns gone); anything still allowed runs as the editor.
   */
  viewAs?: 'public';
  navigation?: string[];
  /** Declared viewer reads; present only for a signed-in viewer, never on a Site. */
  viewerReads?: SpaceViewerReadFamily[];
  /** Declared cloud computer access; present only for a signed-in Editor, never on a Site. */
  cloudComputer?: SpaceCloudComputerLevel;
  /** Declared cloud computer service ids; present only for a signed-in Editor, never on a Site. */
  cloudComputerServices?: string[];
  /** V4: declared URL params (never a record param's `page` rule), list names and chrome of the executable revision. */
  params?: Record<string, Omit<SpaceViewParam, 'page'>>;
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
  /**
   * A write that is one step of a batch: the host skips re-reading every cached list after it,
   * and the batch calls `queryClient.invalidate()` once at the end. Hosts that predate it ignore it.
   */
  deferRefresh?: boolean;
  /**
   * A cached read (`dedupe`) that must show the provider's current answer even while the view opens
   * (a check made right before a send, say). Without it, a signed-in host may first answer a provider
   * read with the person's last result of that exact read, then refresh the view with the provider's
   * answer a moment later. Hosts that predate it ignore it.
   */
  fresh?: boolean;
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
  /**
   * Why a settled action failed, when the host knows a stable reason: `read_timeout` (a read its time limit stopped)
   * or `rate_limited` (the provider refused the call for sending too fast; it did not run, so retry after a few seconds).
   */
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
  // Viewing as the public reads other rows than editing: never share their cache entries.
  return ['space', space.id, space.revision, space.cacheScope, ...(space.viewAs === 'public' ? ['view-as-public'] : []), ...key];
}

/** Who the page is drawn for: `editor` only for an editor who is not viewing the Space as the public. */
export function spaceAudience(space: SpaceRuntimeDescriptor | null | undefined): SpaceAudience {
  return space?.audience === 'editor' && space.viewAs !== 'public' ? 'editor' : 'public';
}

/** Whether the person is an editor who could view this Space as the public (the view marks something editor-only). */
export function spaceMarksEditorsOnly(space: SpaceRuntimeDescriptor | null | undefined): boolean {
  const marks = space?.editorsOnly;
  if (space?.audience !== 'editor' || !marks) return false;
  return Boolean(marks.view || marks.shows?.length || marks.actions?.length || marks.params?.length
    || Object.values(marks.columns ?? {}).some(columns => columns.length));
}

const without = <T>(record: Record<string, T> | undefined, names: readonly string[] | undefined): Record<string, T> | undefined =>
  record && names?.length ? Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name))) : record;

/**
 * The descriptor the public receives, computed from an editor's: editor-only lists, actions, params and the row
 * operations backed by them removed, and the signed-in-only reads a Site never gets. Same floors as the server.
 */
export function publicSpaceDescriptor(space: SpaceRuntimeDescriptor): SpaceRuntimeDescriptor {
  const marks = space.editorsOnly ?? {};
  const actions = without(space.actions, marks.actions) ?? {};
  const bindings = Object.fromEntries(Object.entries(space.bindings ?? {}).map(([alias, binding]) => [alias, binding.operations
    ? { ...binding, operations: Object.fromEntries(Object.entries(binding.operations).filter(([, id]) => Boolean(id && Object.hasOwn(actions, id)))) }
    : binding]));
  const { editorsOnly: _marks, viewerReads: _reads, cloudComputer: _computer, ...rest } = space;
  return { ...rest, audience: 'public', actions, bindings,
    ...(space.shows ? { shows: without(space.shows, marks.shows) } : {}),
    ...(space.params ? { params: without(space.params, marks.params) } : {}) };
}

const fold = (name: string) => name.toLowerCase();
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * The editor-only columns of what one read or write touches, while an editor views the Space as the public.
 * `hidden`: folded property names (a declared name may also be a property id, which the server accepts).
 * `ids`: property ids known to be editor-only (learned from a schema or `runtime.databases`).
 * `title`: the database's title column is editor-only, so the row's `title` is too.
 */
interface ColumnFloor {
  hidden: ReadonlySet<string>;
  ids: ReadonlySet<string>;
  title: boolean;
  /** Told the real names of the editor-only properties a row carried, and whether its title was one of them. */
  seen?: (names: readonly string[], title: boolean) => void;
}

/**
 * Whether the row's title is the value of an editor-only column. Rows do not name their title property, but they
 * carry it among their properties under its name: an editor-only property holding exactly the row's title is taken
 * to be the title column. A coincidence over-strips the title, which the preview accepts.
 */
function titleColumnHidden(row: Record<string, unknown>, hidden: ReadonlySet<string>): boolean {
  const { title, properties } = row;
  return typeof title === 'string' && title !== '' && isRecord(properties)
    && Object.entries(properties).some(([name, value]) => hidden.has(fold(name)) && value === title);
}

/** One row (or record) as the public reads it, the server's floor (`ColumnFloor.row` in space_audience.py). */
function floorRow<T>(row: T, floor: ColumnFloor): T {
  if (!isRecord(row) || !floor.hidden.size) return row;
  const result: Record<string, unknown> = { ...row };
  const title = floor.title || titleColumnHidden(row, floor.hidden);
  const named: string[] = [];
  const visible = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([name]) => {
    const hidden = floor.hidden.has(fold(name)) || floor.ids.has(name);
    if (hidden) named.push(name);
    return !hidden;
  }));
  let nested = false;
  for (const field of ['properties', 'property_states']) {
    const fields = result[field];
    if (isRecord(fields)) { nested = true; result[field] = visible(fields); }
  }
  // A row without `properties` carries its columns itself (see AudienceRow).
  if (!nested) {
    const kept = visible(result);
    for (const key of Object.keys(result)) if (!Object.hasOwn(kept, key)) delete result[key];
  }
  if (title) delete result.title;
  floor.seen?.(named, title);
  return result as T;
}

/** A schema the public reads: the editor-only properties gone, their ids and title learned for later checks. */
function floorSchema(schema: Record<string, unknown>, floor: ColumnFloor, learn: (ids: string[], names: string[], title: boolean) => void) {
  const properties = schema.properties;
  if (!isRecord(properties)) return schema;
  const ids = Object.entries(properties).filter(([id, property]) => floor.hidden.has(fold(id)) || floor.ids.has(id)
    || (isRecord(property) && typeof property.name === 'string' && floor.hidden.has(fold(property.name)))).map(([id]) => id);
  if (!ids.length) return schema;
  const names = ids.map(id => properties[id]).filter(isRecord).map(property => property.name).filter((name): name is string => typeof name === 'string');
  learn(ids, names, typeof schema.title_property_id === 'string' && ids.includes(schema.title_property_id));
  return { ...schema, properties: Object.fromEntries(Object.entries(properties).filter(([id]) => !ids.includes(id))),
    ...(Array.isArray(schema.property_order) ? { property_order: schema.property_order.filter(id => !ids.includes(id as string)) } : {}) };
}

/**
 * A native answer as the public reads it: its rows, its single `row`, `record` or `document`, a record read that is
 * the row itself, and its schema (the server's `ColumnFloor.result`).
 */
function floorResult<T>(value: T, floor: ColumnFloor, learn: (ids: string[], names: string[], title: boolean) => void = () => {}): T {
  if (!floor.hidden.size) return value;
  if (Array.isArray(value)) return value.map(row => floorRow(row, floor)) as T;
  if (!isRecord(value)) return value;
  let title = floor.title;
  let result: Record<string, unknown> = { ...value };
  if (isRecord(result.schema)) {
    result.schema = floorSchema(result.schema, floor, (ids, names, hiddenTitle) => { title ||= hiddenTitle; learn(ids, names, hiddenTitle); });
  }
  const rows = { ...floor, title };
  if (Array.isArray(result.rows)) result.rows = result.rows.map(row => floorRow(row, rows));
  for (const name of ['row', 'record', 'document']) if (isRecord(result[name])) result[name] = floorRow(result[name], rows);
  if (isRecord(result.properties) && ('record_key' in result || 'id' in result)) result = floorRow(result, rows);
  return result as T;
}

/** Rows with these properties removed (matched case-insensitively), as the server sends them to the public. */
export function withoutEditorColumns<T>(rows: readonly T[], columns: readonly string[]): T[] {
  if (!columns.length) return rows.slice();
  const floor: ColumnFloor = { hidden: new Set(columns.map(fold)), ids: new Set(), title: false };
  return rows.map(row => floorRow(row, floor));
}

/**
 * Whether a read or write names an editor-only column: a `property` or `property_id` reference anywhere (filters,
 * sorts, search, aggregate, projection), a written `properties` key, and the title (`{column: 'title'}` or a
 * `columns.title` write) once the title column is known to be editor-only.
 *
 * A `property_id` is matched against the ids learned from a schema or `runtime.databases`; the Space descriptor itself
 * carries no schema, so before one is learned only an id equal to a declared editor-only name (the server accepts an
 * exact id there) is refused, and an id of an editor-only column declared by name is not.
 */
function namesEditorColumn(value: unknown, floor: ColumnFloor): boolean {
  if (Array.isArray(value)) return value.some(item => namesEditorColumn(item, floor));
  if (!isRecord(value)) return false;
  const { property, property_id: propertyId, column, properties: written, columns } = value;
  if (typeof property === 'string' && floor.hidden.has(fold(property))) return true;
  if (typeof propertyId === 'string' && (floor.ids.has(propertyId) || floor.hidden.has(fold(propertyId)))) return true;
  if (floor.title && column === 'title') return true;
  // A row write names its columns as the keys of `properties`.
  if (isRecord(written) && Object.keys(written).some(name => floor.hidden.has(fold(name)) || floor.ids.has(name))) return true;
  if (floor.title && isRecord(columns) && Object.hasOwn(columns, 'title')) return true;
  return Object.values(value).some(item => namesEditorColumn(item, floor));
}

/** Host record components held to the public floor; `columns` reads the editor-only names known at render time. */
export type SpacePublicRecordUI = (ui: NotisRuntimeUI, columns: () => readonly string[]) => NotisRuntimeUI;

/**
 * SDK defense in depth. The host/server independently reject these transports.
 * With `space.viewAs === 'public'` it also applies the public floors in the page (View as the public): the
 * descriptor the public would receive, editor-only lists and actions refused, editor-only columns left out of every
 * row the page can read (actions, lists, document bodies, the collection item, host record components) and refused
 * in every read or write that names them. Actions still run as the editor, so this floor is what keeps the preview
 * true; real public visitors are held to it by the server.
 *
 * `options.publicRecordUI` holds the host record components to the floor (the provider passes the React one). Without
 * it, the host components that draw a record's properties are left out while viewing as the public.
 */
export function guardSpaceRuntime(runtime: NotisRuntime | null, onProtocolError?: (error: Error) => void,
  options: { publicRecordUI?: SpacePublicRecordUI } = {}): NotisRuntime | null {
  if (runtime?.resource?.kind !== 'space') return runtime;
  spaceQueryKey(runtime, []);
  const protocolError = (message: string, key?: QueryErrorKey) => {
    const error = key ? new SdkQueryError(key, message, runtime.context?.locale) : new Error(message);
    onProtocolError?.(error); return error;
  };
  const deny = async (): Promise<never> => { throw protocolError('Use a declared Space action; account-wide tool and backend calls are unavailable.'); };
  const callAction = runtime.callAction;
  if (!callAction) throw new Error('This host needs the current Space action protocol.');
  const asPublic = runtime.space!.viewAs === 'public';
  const space = asPublic ? publicSpaceDescriptor(runtime.space!) : runtime.space!;
  const viewerRead = asPublic ? undefined : runtime.viewerRead;
  const shown = runtime.shown;
  const cloudComputer = asPublic ? undefined : runtime.spaceCloudComputer;
  const cloudLevel = space.cloudComputer;
  const guardedCloud = (operation: SpaceCloudComputerOperation) => {
    if (!cloudComputer || !spaceCloudComputerAllows(cloudLevel, operation)) {
      throw protocolError(operation === 'facts' || operation === 'folder' ? 'This Space does not use the Cloud Computer.'
        : 'This Space does not declare cloudComputer: shell.');
    }
    return cloudComputer;
  };
  // Hosts that predate services, jobs or the folder do not offer them.
  const lease = cloudComputer?.lease, access = cloudComputer?.access, job = cloudComputer?.job, folder = cloudComputer?.folder;
  const sendFile = cloudComputer?.sendFile, importUrl = cloudComputer?.importUrl;
  const declaredService = (service: unknown) => {
    const declared = runtime.space!.cloudComputerServices;
    if (typeof service !== 'string' || !Array.isArray(declared) || !declared.includes(service)) {
      throw protocolError('This Space does not declare that Cloud Computer service.');
    }
  };
  const undeclared = (key?: QueryErrorKey) => protocolError('This action is not declared by the published Space.', key);
  const columnRefused = (key?: QueryErrorKey) => protocolError('The public cannot read or write this column.', key);

  // View as the public: what is editor-only, by binding alias, plus what the page learns while it reads.
  const hiddenColumns = asPublic ? runtime.space!.editorsOnly?.columns ?? {} : {};
  const declared = (alias?: string): readonly string[] => alias === undefined ? Object.values(hiddenColumns).flat()
    : (Object.hasOwn(hiddenColumns, alias) ? hiddenColumns[alias] : undefined) ?? [];
  const anyHidden = new Set(declared().map(fold));
  /** Real names of editor-only properties seen in rows and schemas, for the host components that match names exactly. */
  const observed = new Set<string>();
  /** Editor-only property ids, learned from schemas and `runtime.databases`. */
  const hiddenIds = new Set<string>();
  /** Aliases whose title column is editor-only; `titleSomewhere` when a database names no alias. */
  const hiddenTitles = new Set<string>();
  let titleSomewhere = false;
  if (anyHidden.size) {
    for (const database of runtime.databases ?? []) {
      const alias = database?.slug && Object.hasOwn(hiddenColumns, database.slug) ? database.slug : undefined;
      const hidden = alias === undefined ? anyHidden : new Set(declared(alias).map(fold));
      for (const property of database?.properties ?? []) {
        if (!property?.name || !(hidden.has(fold(property.name)) || (property.id && hidden.has(fold(property.id))))) continue;
        if (property.id) hiddenIds.add(property.id);
        observed.add(property.name);
        if (property.type === 'title') { if (alias === undefined) titleSomewhere = true; else hiddenTitles.add(alias); }
      }
    }
  }
  /**
   * The floor of one database (`alias`), or of every database when the alias is unknown or ambiguous: an action can
   * then return rows of any of them, so the union of their editor-only columns is left out (over-stripping is safe).
   */
  const floorOf = (alias: string | undefined): ColumnFloor => {
    const hidden = alias === undefined ? anyHidden : new Set(declared(alias).map(fold));
    return { hidden, ids: hiddenIds,
      title: hidden.size > 0 && (titleSomewhere || (alias === undefined ? hiddenTitles.size > 0 : hiddenTitles.has(alias))),
      seen: (names, title) => {
        for (const name of names) observed.add(name);
        if (title && alias !== undefined) hiddenTitles.add(alias);
      } };
  };
  const learnOf = (alias: string | undefined) => (ids: string[], names: string[], title: boolean) => {
    for (const id of ids) hiddenIds.add(id);
    for (const name of names) observed.add(name);
    if (title) { if (alias === undefined) titleSomewhere = true; else hiddenTitles.add(alias); }
  };
  /** The one binding an action belongs to (one of its row operations); undefined when none or several. */
  const aliasOfAction = (actionId: string) => {
    const aliases = Object.entries(space.bindings ?? {}).filter(([, binding]) =>
      binding.operations && Object.values(binding.operations).includes(actionId)).map(([alias]) => alias);
    return aliases.length === 1 ? aliases[0] : undefined;
  };
  const declaredBinding = (alias: unknown): alias is string => typeof alias === 'string' && Object.hasOwn(space.bindings ?? {}, alias);
  const documentBody = runtime.documentBody;
  const subscribeDatabase = runtime.subscribeDatabase;
  const draftHandover = runtime.draftHandover;
  const collectionItem = runtime.context?.collectionItem;

  const publicFloors: Partial<NotisRuntime> = !asPublic ? {} : {
    // Document bodies are not columns, but the read and write actions must be the public's, and the title is a column.
    ...(documentBody ? { documentBody: async (request: SpaceDocumentBodyRequest): Promise<SpaceDocumentBodyResult> => {
      const actionIds = isRecord(request) ? [request.readAction, ...(request.operation === 'save' ? [request.writeAction] : [])] : [];
      if (!actionIds.length || !declaredBinding(request.binding)
        || actionIds.some(id => typeof id !== 'string' || !Object.hasOwn(space.actions, id))) throw undeclared();
      const result = await documentBody(request);
      // The answer does not say which column is the title: it is left out once the page has learned that.
      return request.operation === 'read' && floorOf(request.binding).title && isRecord(result) && 'content_markdown' in result
        ? { ...result, title: null } : result;
    } } : {}),
    // A change signal carries no rows; only the public descriptor's databases have one.
    ...(subscribeDatabase ? { subscribeDatabase: (slug: string, onChange: () => void, config?: SubscribeDatabaseOptions) => {
      if (!declaredBinding(slug) || space.bindings[slug].kind !== 'database') { config?.onStatusChange?.(false); return () => {}; }
      return subscribeDatabase(slug, onChange, config);
    } } : {}),
    // The selected row goes to the editor's own Manager draft, never to the page; its read must be the public's.
    ...(draftHandover ? { draftHandover: async (payload: HandoverPayload) => {
      const record = payload && typeof payload === 'object' ? payload.record : undefined;
      if (record && (!declaredBinding(record.binding) || typeof record.readAction !== 'string'
        || !Object.hasOwn(space.actions, record.readAction))) throw undeclared();
      return draftHandover(payload);
    } } : {}),
    ...(anyHidden.size && isRecord(collectionItem) ? { context: { ...runtime.context, collectionItem: (() => {
      const item = floorRow(collectionItem, floorOf(undefined));
      return { ...item, title: typeof item.title === 'string' ? item.title : '' };
    })() } } : {}),
    // Host record components read and write with the editor's authority: hold what they draw to the floor.
    ...(anyHidden.size && runtime.ui ? { ui: options.publicRecordUI
      ? options.publicRecordUI(runtime.ui, () => [...new Set([...declared(), ...observed])])
      : { ...runtime.ui, DocumentEditor: undefined, DocumentPage: undefined, RecordProperties: undefined } } : {}),
  };

  return Object.freeze({ ...runtime, space, callTool: deny, request: deny, listTools: deny, ...publicFloors,
    shown: shown ? async function guardedShown<TResult>(name: string, params: Record<string, unknown> = {},
      options: SpaceShownOptions = {}): Promise<TResult> {
      const list = space.shows && Object.hasOwn(space.shows, name) ? space.shows[name] : null;
      if (!list || !('database' in list)) throw protocolError('This view does not declare that list with a filter.', 'listUnavailable');
      if (!asPublic) return shown<TResult>(name, params, options);
      const visible = space.params ? Object.fromEntries(Object.entries(params).filter(([param]) => Object.hasOwn(space.params!, param))) : params;
      const floor = floorOf(list.database);
      // The declared filter may read an editor-only column; the caller's sorts may not.
      if (floor.hidden.size && namesEditorColumn(options, floor)) throw columnRefused('readUnavailable');
      return floorResult(await shown<TResult>(name, visible, options), floor, learnOf(list.database));
    } : undefined,
    handover: undefined,
    ...(asPublic ? { spaceFiles: undefined } : {}),
    // The legacy facts hook keeps working in a Space that declares the cloud computer.
    cloudComputerFacts: cloudComputer && cloudLevel ? async (options?: { refresh?: boolean }) => guardedCloud('facts').facts(options) : undefined,
    spaceCloudComputer: cloudComputer && cloudLevel ? Object.freeze({
      status: () => cloudComputer.status(),
      requestApproval: () => cloudComputer.requestApproval(),
      facts: async (options?: { refresh?: boolean }) => guardedCloud('facts').facts(options),
      run: async (input: SpaceCloudComputerRunInput) => guardedCloud('run').run(input),
      upload: async (input: SpaceCloudComputerUploadInput) => guardedCloud('upload').upload(input),
      lease: lease ? async (input: SpaceCloudComputerLeaseInput) => {
        guardedCloud('service.lease');
        declaredService(input?.service);
        return lease.call(cloudComputer, input);
      } : undefined,
      access: access ? async (input: SpaceCloudComputerAccessInput) => {
        guardedCloud('service.access');
        declaredService(input?.service);
        return access.call(cloudComputer, input);
      } : undefined,
      job: job ? async <O extends SpaceCloudComputerJobOperation>(operation: O, input: SpaceCloudComputerJobInput) => {
        if (operation !== 'job.status' && operation !== 'job.logs' && operation !== 'job.cancel') {
          throw protocolError('Choose a supported Cloud Computer job operation.');
        }
        guardedCloud(operation);
        return cloudComputer.job!<O>(operation, input);
      } : undefined,
      folder: folder ? async () => { guardedCloud('folder'); return folder.call(cloudComputer); } : undefined,
      sendFile: sendFile ? async (input: SpaceCloudComputerFileUpload) => {
        guardedCloud('transfer.begin');
        return sendFile.call(cloudComputer, input);
      } : undefined,
      importUrl: importUrl ? async (input: SpaceCloudComputerImportInput) => {
        guardedCloud('import');
        return importUrl.call(cloudComputer, input);
      } : undefined,
    } satisfies SpaceCloudComputerTransport) : undefined,
    viewerRead: viewerRead ? async function guardedViewerRead<TResult>(operation: SpaceViewerReadOperation,
      input: Record<string, unknown> = {}): Promise<TResult> {
      const family = Object.hasOwn(SPACE_VIEWER_READ_OPERATIONS, operation) ? SPACE_VIEWER_READ_OPERATIONS[operation] : null;
      if (!family) throw protocolError('Viewer reads never change data. Choose a supported read.', 'readUnavailable');
      if (!space.viewerReads?.includes(family)) throw protocolError(`This Space does not declare viewer reads of ${family}.`, 'readUnavailable');
      return viewerRead<TResult>(operation, input);
    } : undefined,
    async callAction<TResult>(id: string, inputs: Record<string, unknown> = {}, options: SpaceActionOptions = {}): Promise<TResult> {
      const descriptor = Object.hasOwn(space.actions, id) ? space.actions[id] : null;
      if (!descriptor) throw undeclared(options.readOnly || options.dedupe ? 'actionUnavailable' : undefined);
      if ((options.readOnly || options.dedupe) && !descriptor.readOnly) throw protocolError('A write action cannot run as a cached read.', 'readUnavailable');
      if (!asPublic) return callAction<TResult>(id, inputs, options);
      // A row operation of one binding reads that binding; a named action, or one several bindings share, any of them.
      const alias = aliasOfAction(id);
      const floor = floorOf(alias);
      // Every input is checked, not only `request`: a named action's inputs may carry a filter or a row write too.
      // A template that maps a plain input onto an editor-only column cannot be seen from here; the server refuses it.
      if (floor.hidden.size && namesEditorColumn(inputs, floor)) throw columnRefused(options.readOnly || options.dedupe ? 'readUnavailable' : undefined);
      return floorResult(await callAction<TResult>(id, inputs, options), floor, learnOf(alias));
    },
  });
}
