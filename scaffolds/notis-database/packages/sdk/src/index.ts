/**
 * @notis/sdk - The Notis App SDK
 *
 * Public API for building Notis apps. Import hooks and the provider from
 * this entrypoint. For configuration, use `@notis/sdk/config`. For the
 * Vite config builder, use `@notis/sdk/vite`.
 */

// Provider
export { NotisProvider, useNotisRuntime } from './provider';

// Hooks
export { useNotis } from './hooks/useNotis';
export { useDocuments } from './hooks/useDocuments';
export type { UseDocumentsOptions, UseDocumentsResult } from './hooks/useDocuments';
export { useDatabaseSubscription } from './hooks/useDatabaseSubscription';
export type {
  UseDatabaseSubscriptionOptions,
  UseDatabaseSubscriptionResult,
} from './hooks/useDatabaseSubscription';
export { useDocument } from './hooks/useDocument';
export type { UseDocumentOptions, UseDocumentResult } from './hooks/useDocument';
export { useUpsertDocument } from './hooks/useUpsertDocument';
export type { UpsertDocumentArgs, UseUpsertDocumentResult } from './hooks/useUpsertDocument';
export { useDatabaseSchema } from './hooks/useDatabaseSchema';
export type { UseDatabaseSchemaResult } from './hooks/useDatabaseSchema';
export { useTool } from './hooks/useTool';
export type { ToolCallState, UseToolResult } from './hooks/useTool';
export { useTools } from './hooks/useTools';
export { useHandover } from './hooks/useHandover';
export type { UseHandoverResult } from './hooks/useHandover';
export { useCloudComputer } from './hooks/useCloudComputer';
export type { UseCloudComputerResult } from './hooks/useCloudComputer';
export { useNotisNavigation } from './hooks/useNotisNavigation';
export { useTopBarSearch } from './hooks/useTopBarSearch';
export { useBackend } from './hooks/useBackend';
export { useMultiSelect } from './hooks/useMultiSelect';

// Documents & markdown
export { Markdown } from './components/Markdown';
export type { MarkdownProps } from './components/Markdown';
export { DocumentEditor } from './components/DocumentEditor';
export {
  asRecord,
  blockNoteToPlainText,
  extractRichText,
  getDocumentPreview,
  getRelationIds,
  getSecretValue,
  isPresentString,
  markdownToPlainText,
  normalizeDatabaseProperty,
  normalizeDocumentRecord,
  normalizePropertyValue,
  optionalString,
} from './documents';

// Multi-select components
export { MultiSelectActionBar } from './components/MultiSelectActionBar';
export { MultiSelectCheckbox } from './components/MultiSelectCheckbox';
export { MultiSelectDragOverlay } from './components/MultiSelectDragOverlay';
export type {
  DragRect,
  MultiSelectController,
  UseMultiSelectOptions,
} from './hooks/useMultiSelect';
export type {
  MultiSelectAction,
  MultiSelectActionBarProps,
} from './components/MultiSelectActionBar';
export type { MultiSelectCheckboxProps } from './components/MultiSelectCheckbox';
export type { MultiSelectDragOverlayProps } from './components/MultiSelectDragOverlay';

// Types (re-exported for convenience)
export type {
  AppDescriptor,
  CloudComputerCliAuthFacts,
  CloudComputerFacts,
  CloudComputerSandboxFacts,
  CollectionItem,
  CollectionItemDetail,
  DatabaseDescriptor,
  DatabaseProperty,
  DatabasePropertyOption,
  DatabasePropertyType,
  DocumentContentType,
  DocumentRecord,
  HandoverPayload,
  HandoverResult,
  NotisDocumentEditorProps,
  NotisRuntime,
  NotisRuntimeContext,
  NotisRuntimeUI,
  QueryFilter,
  RouteDescriptor,
  SecretPropertyValue,
  SubscribeDatabaseOptions,
  ToolDescriptor,
  ToolInputSchema,
} from './runtime';
