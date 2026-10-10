import type { AgentContextContent, AgentContextItem, AgentContextSource } from './agentContext';
/**
 * NotisRuntime is the bridge between app code running in the browser and the
 * Notis platform. The portal owns the runtime and injects it through
 * `NotisProvider` when the app is rendered.
 *
 * App code should never reach for globals. Use the hooks from `@notis/sdk`
 * (useTool, useNotis, etc.) which read from the NotisProvider context.
 */

import type { ComponentType, ReactNode } from 'react';
import type { NotisQueryClient } from './queryCache';
import type { SpaceRuntimeDescriptor, SpaceActionOptions, SpaceDocumentBodyRequest, SpaceDocumentBodyResult, SpaceViewerReadOperation, SpaceShownOptions, SpaceCloudComputerTransport } from './space';

// ---------------------------------------------------------------------------
// Database types
// ---------------------------------------------------------------------------

export type DatabasePropertyType =
  | 'title'
  | 'rich_text'
  | 'text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'relation'
  | 'formula'
  | 'files'
  | 'secret';

/**
 * The value of a `secret` property. The platform stores a pointer to a
 * credential held elsewhere and never the credential itself, so there is
 * deliberately nothing here to read the secret material from — only whether
 * one is attached, which credential it is, and its lifecycle state.
 */
export interface SecretPropertyValue {
  present: boolean;
  reference: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
}

export interface DatabasePropertyOption {
  id?: string | null;
  name: string;
  color?: string | null;
  order?: number;
}

export interface DatabaseProperty {
  id?: string | null;
  name: string;
  type: DatabasePropertyType;
  description?: string | null;
  options?: DatabasePropertyOption[];
}

export interface DatabaseDescriptor {
  slug: string;
  title: string;
  description?: string | null;
  icon?: string | null;
  properties: DatabaseProperty[];
}

/**
 * A document's content is typed. `markdown` documents carry rich text as
 * BlockNote JSON (canonical) with a derived markdown projection; `file`
 * documents carry an uploaded file whose format is in `fileType`
 * (pdf, xlsx, pptx, ...). Future content types (canvas, ...) extend this
 * union without changing the component contracts.
 */
export type DocumentContentType = 'markdown' | 'file' | 'view';

export interface DocumentRecord {
  id: string;
  recordKey?: string;
  revision?: number;
  title: string;
  properties: Record<string, unknown>;
  url?: string | null;
  icon?: string | null;
  cover?: string | null;
  databaseSlug?: string;
  contentType?: DocumentContentType | null;
  fileType?: string | null;
  contentBlocknote?: Array<Record<string, unknown>> | null;
  contentMarkdown?: string | null;
  plainText?: string | null;
  viewType?: string | null;
  viewState?: Record<string, unknown> | null;
  viewRevision?: number | null;
  createdAt?: string | null;
  lastEditedTime?: string | null;
}

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

export type ToolInputSchema = Record<string, unknown>;

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: ToolInputSchema;
}

export interface ToolCallOptions {
  /** Explicitly identifies an idempotent read; never set on a mutation. */
  readOnly?: boolean;
  /**
   * Coalesce an identical in-flight call. Only opt in for idempotent reads;
   * mutations must execute once per invocation.
   */
  dedupe?: boolean;
}

// ---------------------------------------------------------------------------
// Route types
// ---------------------------------------------------------------------------

export interface RouteDescriptor {
  slug: string;
  path: string;
  name: string;
  icon?: string | null;
  parentSlug?: string | null;
  default?: boolean;
  resourceDeepLinks?: boolean;
  collection?: {
    database: string;
    titleProperty: string;
    parentProperty?: string | null;
    sidebar?: {
      mode: 'flat-list' | 'tree';
      allowCreate: boolean;
    } | null;
  } | null;
}

export interface CollectionItem {
  id: string;
  title: string;
  icon?: string | null;
}

export interface CollectionItemDetail extends CollectionItem {
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// App descriptor
// ---------------------------------------------------------------------------

export interface AppDescriptor {
  id: string;
  name: string;
  icon?: string | null;
  description?: string | null;
}

export interface QueryFilter {
  filters?: Array<{
    property: string;
    operator: string;
    type?: string;
    value: unknown;
  }>;
  sorts?: Array<{
    property: string;
    direction: 'asc' | 'desc';
  }>;
  page_size?: number;
}

export interface NotisRuntimeContext {
  /** Host UI language. */
  locale?: 'en' | 'fr';
  /** Untrusted UI selection, separate from the host's fixed record authority. */
  selection?: string | null;
  /** Raw URL query values; `useViewParams()` keeps only the declared, valid ones. */
  params?: Record<string, string> | null;
  /** Trusted anonymous record-Site pin; no credentials or physical native target. */
  siteRecord?: { recordKey: string; param: string; params: Record<string, string | number | boolean> } | null;
  collectionItem?: CollectionItemDetail | null;
  /** App-owned resource requested through the route's `?resource=<id>` link. */
  resourceId?: string | null;
  /**
   * Set when the app is being rendered by the screenshot harness (`notis apps
   * screenshot`) for the named listing scenario. Lets apps and SDK components
   * hide dev-only chrome from listing images.
   */
  screenshotScenario?: string | null;
}

// ---------------------------------------------------------------------------
// App context shared with Notis
// ---------------------------------------------------------------------------

export type ContextAttributeValue = string | number | boolean | null;

/**
 * The specific thing currently in focus inside an app view. The host stamps
 * app/view provenance onto this value before it reaches chat, so apps only
 * describe their own resource rather than impersonating another surface.
 */
export interface ContextResource extends AgentContextContent {
  additionalContext?: Record<string, unknown>;
  id: string;
  kind: string;
  label: string;
  url?: string | null;
  revision?: string | null;
  attributes?: Record<string, ContextAttributeValue>;
  snapshot?: {
    format: 'text' | 'markdown';
    content: string;
  } | null;
}

/** A quote copied from an app, kept separate from the user's prompt. */
export interface ContextSelection extends AgentContextContent {
  source?: AgentContextSource;
  id: string;
  text: string;
  resource?: ContextResource | null;
}

// ---------------------------------------------------------------------------
// Host-provided UI
// ---------------------------------------------------------------------------

/**
 * Props for the host-provided document editor. The host implementation
 * dispatches on the document's content type (markdown -> rich text editor,
 * file -> matching viewer/editor), so this contract stays stable as new
 * content types ship.
 */
export interface NotisRecordProps {
  /** Stable native record key, authorized through this Space's declared databases. */
  recordKey: string;
  className?: string;
}

export type NotisDocumentEditorProps = ({ recordKey: string; documentId?: never } | {
  /** Legacy Apps only. Spaces use recordKey. */
  documentId: string; recordKey?: never;
}) & {
  /** 'full' renders icon/title/cover above the content; 'body' renders content only. */
  variant?: 'full' | 'body';
  /** Show the database properties above the body (default true). */
  showProperties?: boolean;
  readOnly?: boolean;
  className?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

export interface NotisRecordPropertiesProps extends NotisRecordProps {
  readOnly?: boolean;
  onSavingChange?: (saving: boolean) => void;
}

/** Inline HTML is useful for declared Site read actions; recordKey loads a signed-in record. */
export type NotisHtmlFrameProps = ({ recordKey: string; html?: never } | { html: string; recordKey?: never }) & {
  title?: string;
  className?: string;
};
export interface NotisReportFrameProps extends NotisRecordProps {}
export interface NotisShareControlProps extends NotisRecordProps {}

/** One breadcrumb before the record title; the title is always the last crumb. */
export interface NotisDocumentPageCrumb {
  label: string;
  onSelect?: () => void;
}

/** An extra entry in the page's '...' menu, after the host's own entries. */
export interface NotisDocumentPageMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * The host-bound parts of one document page. They share one editor session and one save queue,
 * so a Space can arrange them (for example the properties in a right column) without a second editor.
 */
export interface NotisDocumentPageParts {
  /** Breadcrumb, Saving or Saved status, actions, Share and the '...' menu. */
  Toolbar: ComponentType;
  /** Cover, icon and title. */
  Header: ComponentType;
  /** Editable or Read only, type, database, created and updated, with the Configure panel toggle. */
  Meta: ComponentType;
  /** The record's properties, saved automatically with the title, icon and cover. */
  Properties: ComponentType;
  /** The collaborative body (or the matching viewer for files, HTML and reports). */
  Body: ComponentType;
}

/**
 * The full page for one record that is the main content of a Space view (a note, a document):
 * the same page Beta's document page showed, inside the Space. Every edit (title, icon, cover,
 * properties, body) goes through the host's single save queue and live collaboration.
 */
export interface NotisDocumentPageProps extends NotisRecordProps {
  /** Crumbs before the record title, usually a way back to the list. `false` hides the breadcrumb. */
  breadcrumb?: NotisDocumentPageCrumb[] | false;
  /** Extra toolbar buttons, before Share and the '...' menu (for example the Space's own Trash button). */
  actions?: ReactNode;
  /** Extra '...' menu entries (for example a destructive Delete, as Beta's page had). Plain toolbar buttons on hosts without DocumentPage. */
  menuItems?: NotisDocumentPageMenuItem[];
  /** Show the host Share control (a record Site). Off by default: only Spaces whose records were shared on Beta turn it on. */
  share?: boolean;
  /** Which header parts show. `false` hides the whole header (cover, icon and title). */
  header?: false | { cover?: boolean; icon?: boolean; title?: boolean };
  /** Show the meta strip (Editable or Read only, type, database, dates). Default true. */
  meta?: boolean;
  /** 'panel' (default): properties in the Configure panel under the meta strip. 'hidden': none. Or choose and order them by property name. */
  properties?: 'panel' | 'hidden' | { include?: string[]; exclude?: string[]; order?: string[] };
  /** Rendered between the properties and the body. */
  aboveBody?: ReactNode;
  /** Rendered under the body. */
  belowBody?: ReactNode;
  /** Column width: standard (900px, as Beta), wide (1200px) or full. */
  width?: 'standard' | 'wide' | 'full';
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  /**
   * Called after a title, icon, cover, property or body save is confirmed, so the Space can refresh its lists.
   * On hosts without DocumentPage it is called when a save finishes, with `title` null.
   */
  onSaved?: (record: { recordKey: string; title: string | null }) => void;
  /**
   * Rearrange the page. Receives the host-bound parts; the default layout is Toolbar, Header, Meta (with
   * Properties in its panel), Body. With a layout, Meta shows only its strip and Properties shows wherever
   * the layout places it (once), so the record's properties are never edited from two places.
   * aboveBody and belowBody are not drawn: place them in the layout.
   */
  layout?: (parts: NotisDocumentPageParts) => ReactNode;
}

export interface NotisMarkdownEditorSavePayload {
  markdown: string;
  expectedRevision?: string | null;
}

export interface NotisMarkdownEditorSaveResult {
  revision?: string | null;
}

/**
 * Storage-neutral host markdown editor. The app owns persistence through
 * `onSave`; the host only supplies Notis' editing experience.
 */
export interface NotisMarkdownEditorProps {
  /** Stable identity of the edited resource. Changing it starts a fresh editor. */
  resourceKey?: string;
  value: string;
  revision?: string | null;
  readOnly?: boolean;
  autosaveMs?: number;
  placeholder?: string;
  className?: string;
  onChange?: (markdown: string) => void;
  /** Persist an uploaded media/file block and return its durable URL. */
  onUploadFile?: (file: File) => Promise<string>;
  onSave?: (
    payload: NotisMarkdownEditorSavePayload,
  ) => Promise<NotisMarkdownEditorSaveResult | void>;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

/**
 * Components the host (portal) injects through the runtime. Apps consume them
 * via the SDK wrappers (e.g. `DocumentEditor`), which fall back gracefully
 * when a host component is unavailable (standalone dev harness, snapshots).
 */
export interface NotisRuntimeUI {
  DocumentEditor?: ComponentType<NotisDocumentEditorProps>;
  DocumentPage?: ComponentType<NotisDocumentPageProps>;
  MarkdownEditor?: ComponentType<NotisMarkdownEditorProps>;
  RecordProperties?: ComponentType<NotisRecordPropertiesProps>;
  HtmlFrame?: ComponentType<NotisHtmlFrameProps>;
  ReportFrame?: ComponentType<NotisReportFrameProps>;
  ShareControl?: ComponentType<NotisShareControlProps>;
  /** Starts reading a record (and the page's code) before it opens, for example when a list row is hovered. */
  prefetchRecord?: (recordKey: string) => void;
}

// ---------------------------------------------------------------------------
// NotisRuntime
// ---------------------------------------------------------------------------

/**
 * Options for `NotisRuntime.subscribeDatabase`.
 */
export interface SubscribeDatabaseOptions {
  /**
   * Called with `true` once a live change feed is attached, and with `false`
   * when it drops or is torn down. Hosts without a change feed (dev harness,
   * screenshot stub, vite preview) never call it, so `live` stays false there.
   */
  onStatusChange?: (live: boolean) => void;
}

/**
 * Work an app hands to the Notis manager chat through `NotisRuntime.handover`.
 */
export interface HandoverPayload {
  /** Optional starter message. Omit it to open a context-only composer. */
  prompt?: string;
  /**
   * Alias of a Skill this Space links (`skills/<alias>/` in its source). The
   * host rejects an alias the Space does not link. Omit to hand over plain work.
   */
  skill?: string;
  /** Space-only selected row context; never overrides the host's access scope. */
  record?: { binding: string; recordKey: string; readAction: string };
  /**
   * Submit on an active user gesture when the host supports immediate handover;
   * background calls still open an editable draft.
   */
  autoSend?: boolean;
}

export interface HandoverResult {
  /** `drafted` when the user still has to press send, `sent` when it went straight through. */
  status: 'drafted' | 'sent';
}

/**
 * The user's cloud computer, as far as an app may see it.
 *
 * `exists` is false when the user has never had a sandbox provisioned. A
 * `status` of anything other than `'running'` means the VM is asleep; reading
 * these facts never wakes it.
 */
export interface CloudComputerSandboxFacts {
  exists: boolean;
  status: string | null;
  provider: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Whether a CLI inside the cloud computer is signed in.
 *
 * `authenticated: null` means *unknown*, never *signed out*: the sandbox was
 * not running, or the probe could not answer. `reason` says which
 * (`'sandbox_not_running'`, `'no_sandbox'`, `'sandbox_status_unknown'`,
 * `'probe_failed'`, `'not_signed_in'`).
 */
export interface CloudComputerCliAuthFacts {
  authenticated: boolean | null;
  account: string | null;
  checked_at: string | null;
  reason: string | null;
}

export interface CloudComputerFacts {
  /**
   * False when this host cannot answer at all — no cloud computer on the user's
   * plan, or the platform could not resolve the facts. Render whatever the app
   * did before rather than an error.
   */
  available: boolean;
  reason?: string | null;
  sandbox: CloudComputerSandboxFacts | null;
  cli_auth: { gh: CloudComputerCliAuthFacts };
}

export interface RuntimeResource {
  kind: 'app' | 'report' | 'space';
  /** Host-provided adoption eligibility, never report-authored authority. */
  analytics_eligible?: boolean;
  /** Host-derived report family for adoption analytics, e.g. skill review reports. */
  report_kind?: 'skill_review' | 'custom';
  id: string;
  revision: number;
  name?: string;
  icon?: string | null;
  description?: string | null;
}

export interface NotisRuntime {
  space?: SpaceRuntimeDescriptor;
  callAction?<TResult = unknown>(actionId: string, inputs?: Record<string, unknown>, options?: SpaceActionOptions): Promise<TResult>;
  documentBody?(request: SpaceDocumentBodyRequest): Promise<SpaceDocumentBodyResult>;
  /**
   * Space-only declared viewer read (`viewerReads`): what the signed-in viewer can open,
   * with their own authority. Absent on Sites, anonymous links and older hosts.
   */
  viewerRead?<TResult = unknown>(operation: SpaceViewerReadOperation, input?: Record<string, unknown>): Promise<TResult>;
  /**
   * Space-only V4 list (`shows`): runs exactly the declared filter with these params as the
   * signed-in Editor. Absent on Sites and older hosts.
   */
  shown?<TResult = unknown>(name: string, params?: Record<string, unknown>, options?: SpaceShownOptions): Promise<TResult>;
  /** Space-only unsent Manager draft; distinct from legacy App activation. */
  draftHandover?(payload: HandoverPayload): Promise<HandoverResult>;
  /**
   * Space-only cloud computer (`cloudComputer`): the signed-in viewer's own cloud computer after that
   * viewer allows it. Absent on Sites, links, verification harnesses and older hosts.
   */
  spaceCloudComputer?: SpaceCloudComputerTransport;
  /** Authenticated runtime identity; app below is presentation metadata only. */
  resource?: RuntimeResource;
  /** Optional host-scoped in-memory read cache. Older hosts remain supported. */
  queryClient?: NotisQueryClient;
  app: AppDescriptor;
  route: RouteDescriptor;
  databases: DatabaseDescriptor[];
  context: NotisRuntimeContext;
  ui?: NotisRuntimeUI;

  /** Publish or clear the focused resource inside the current app view. */
  contextSource?: AgentContextSource;
  publishActiveResource?(resource: ContextResource | null): void;

  /** Remember a copied quote so the host can recover it across iframe paste. */
  captureContextSelection?(selection: ContextSelection): void;
  addContext?(item: AgentContextItem): Promise<boolean>;
  updateContext?(item: AgentContextItem): Promise<boolean>;
  removeContext?(id: string): Promise<boolean>;

  /**
   * Subscribe to changes on an app-owned database. Returns an unsubscribe.
   *
   * The change notification is only a signal — it carries no rows. Consumers
   * react by refetching through the normal tool path, so app scoping,
   * permissions and billing are unchanged. Use the `useDatabaseSubscription`
   * hook rather than calling this directly. In a Space, `slug` is the database
   * binding alias and the hook is `useNativeDocuments(alias, { subscribe: true })`.
   */
  subscribeDatabase?(
    slug: string,
    onChange: () => void,
    options?: SubscribeDatabaseOptions,
  ): () => void;

  /**
   * Hand a piece of work to the Notis manager chat. The app cannot run an
   * agent itself: it describes the job, and the manager surface owns progress,
   * billing, cancellation and the transcript. Results come back to the app
   * through its own databases (see `useDatabaseSubscription`).
   *
   * Use the `useHandover` hook rather than calling this directly. Hosts
   * without a manager chat (the dev harness, the vite preview) leave it
   * undefined, so keep whatever fallback the app already offers.
   */
  handover?(payload: HandoverPayload): Promise<HandoverResult>;

  /**
   * Read-only facts about the user's cloud computer. Requires
   * `capabilities.cloudComputer: 'read'` in `notis.config.ts` plus the user's
   * approval; resolving it never creates, resumes or commands a sandbox.
   *
   * Use the `useCloudComputer` hook rather than calling this directly. Hosts
   * without a cloud computer (the dev harness, the vite preview) answer
   * `{ available: false }`, so keep whatever fallback the app already has.
   * `{ refresh: true }` bypasses the host's short answer cache — the hook's
   * refresh() sends it so a just-completed sign-in becomes visible.
   */
  cloudComputerFacts?(options?: { refresh?: boolean }): Promise<CloudComputerFacts>;

  navigate?: (payload: { kind: string; [key: string]: unknown }) => void | Promise<void>;

  registerTopBarSearch?: (
    config:
      | {
          onChange: (value: string) => void;
          placeholder?: string;
          onSubmit?: () => void | Promise<void>;
        }
      | null,
  ) => void;
  setTopBarSearchValue?: (value: string) => void;
  setTopBarSearchLoading?: (loading: boolean) => void;

  listTools(): Promise<ToolDescriptor[]>;
  callTool<TResult = unknown>(
    name: string,
    args?: Record<string, unknown>,
    options?: ToolCallOptions,
  ): Promise<TResult>;

  request(path: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<unknown>;
}
