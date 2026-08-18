/**
 * NotisRuntime is the bridge between app code running in the browser and the
 * Notis platform. The portal owns the runtime and injects it through
 * `NotisProvider` when the app is rendered.
 *
 * App code should never reach for globals. Use the hooks from `@notis/sdk`
 * (useTool, useNotis, etc.) which read from the NotisProvider context.
 */

import type { ComponentType } from 'react';

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
export type DocumentContentType = 'markdown' | 'file';

export interface DocumentRecord {
  id: string;
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
  collectionItem?: CollectionItemDetail | null;
  /**
   * Set when the app is being rendered by the screenshot harness (`notis apps
   * screenshot`) for the named listing scenario. Lets apps and SDK components
   * hide dev-only chrome from listing images.
   */
  screenshotScenario?: string | null;
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
export interface NotisDocumentEditorProps {
  documentId: string;
  /** 'full' renders icon/title/cover above the content; 'body' renders content only. */
  variant?: 'full' | 'body';
  readOnly?: boolean;
  className?: string;
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
  /** The message the manager should act on. */
  prompt: string;
  /**
   * Key of a skill declared in `notis.config.ts` -> `skills[].key`. The host
   * rejects a key this app does not declare. Omit to hand over plain work.
   */
  skill?: string;
  /**
   * Accepted for forward compatibility. The portal never submits a composer on
   * the user's behalf today, so every handover resolves `drafted`; `sent` is
   * reserved for a host that can genuinely dispatch the run.
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

export interface NotisRuntime {
  app: AppDescriptor;
  route: RouteDescriptor;
  databases: DatabaseDescriptor[];
  context: NotisRuntimeContext;
  ui?: NotisRuntimeUI;

  /**
   * Subscribe to changes on an app-owned database. Returns an unsubscribe.
   *
   * The change notification is only a signal — it carries no rows. Consumers
   * react by refetching through the normal tool path, so app scoping,
   * permissions and billing are unchanged. Use the `useDatabaseSubscription`
   * hook rather than calling this directly.
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

  navigate?: (payload: { kind: string; [key: string]: unknown }) => void;

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
  callTool<TResult = unknown>(name: string, args?: Record<string, unknown>): Promise<TResult>;

  request(path: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<unknown>;
}
