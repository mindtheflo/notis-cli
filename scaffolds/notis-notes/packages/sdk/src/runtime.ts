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
  | 'files';

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

export interface NotisRuntime {
  app: AppDescriptor;
  route: RouteDescriptor;
  databases: DatabaseDescriptor[];
  context: NotisRuntimeContext;
  ui?: NotisRuntimeUI;

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
