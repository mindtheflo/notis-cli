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
export { useAction, useActionQuery } from './hooks/useAction';
export { useNativeDocuments, useNativeMutation } from './hooks/useNativeDocuments';
export type { NativeField, NativeFilter, NativeQuery, NativeInsert, NativeUpdate, NativeDelete, NativeMutationReceipt } from './nativeData';
export type { SpaceDatabaseCreate, SpaceResourceReference } from './space';
export type { SpaceActionTemplate, SpaceActionDescriptor, SpaceRuntimeDescriptor, SpaceActionOptions } from './space';
export type { SpaceDocumentBodyRequest, SpaceDocumentBodyRead, SpaceDocumentBodySave, SpaceDocumentBodyResult } from './space';
export { useNativeDocumentBody } from './hooks/useNativeDocumentBody';
export { useViewerRead, useViewerReadAvailable, useViewerDatabases, useViewerSkills } from './hooks/useViewerReads';
export type { UseViewerReadOptions } from './hooks/useViewerReads';
export { useViewParams, useShown, useShownAvailable, parseViewParams } from './hooks/useViewParams';
export type { ViewParams, ViewParamsOf, UseShownOptions } from './hooks/useViewParams';
export { SPACE_VIEW_SPEC_VERSION } from './space';
export type { SpaceViewParam, SpaceViewParamType, SpaceShows, SpaceShownDescriptor, SpaceShownOptions, SpaceShownResult,
  SpaceMemoryPolicy, SpaceMemorySnapshot, SpaceChrome, SpaceMarkdownInput } from './space';
export { SPACE_VIEWER_READ_OPERATIONS } from './space';
export { SPACE_CLOUD_COMPUTER_OPERATIONS, spaceCloudComputerAllows } from './space';
export type { SpaceCloudComputerLevel, SpaceCloudComputerOperation, SpaceCloudComputerStatus, SpaceCloudComputerRelease, SpaceCloudComputerRunInput,
  SpaceCloudComputerRunResult, SpaceCloudComputerUploadInput, SpaceCloudComputerUploadResult, SpaceCloudComputerTransport } from './space';
export type { SpaceViewerReadFamily, SpaceViewerReadOperation, SpaceViewerReadInput, SpaceViewerReadResult, SpaceViewerLink,
  SpaceViewerDatabase, SpaceViewerDatabaseSchema, SpaceViewerSkill, SpaceViewerSkillPage } from './space';
export { SpaceActionError, SpaceNavigationCancelled, isSpaceNavigationCancelled } from './space';
export type { SpaceActionFailureDetails } from './space';
export { useQuery, useQueryClient } from './hooks/useQuery';
export type { UseQueryOptions, UseQueryResult } from './hooks/useQuery';
export { createQueryClient, createPrefetchQueue, queryKey } from './queryCache';
export type { NotisQueryClient, QuerySnapshot, QueryFetchOptions } from './queryCache';
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
export { useCloudComputerShell } from './hooks/useCloudComputerShell';
export type { UseCloudComputerShellResult } from './hooks/useCloudComputerShell';
export { useNotisNavigation } from './hooks/useNotisNavigation';
export { useTopBarSearch } from './hooks/useTopBarSearch';
export { useBackend } from './hooks/useBackend';
export { useMultiSelect } from './hooks/useMultiSelect';
export { useCollectionInteractions, COLLECTION_ITEM_ATTRIBUTE } from './hooks/useCollectionInteractions';
export { useActiveResource } from './hooks/useActiveResource';
export {
  ShortcutProvider,
  SHORTCUT_SCOPE_PRIORITY,
  isEditableShortcutEvent,
  shortcutDisplay,
  useShortcuts,
} from './interactions/shortcuts';

// Documents & markdown
export { Markdown } from './components/Markdown';
export type { MarkdownProps } from './components/Markdown';
export { DocumentEditor } from './components/DocumentEditor';
export { DocumentPage, DocumentPageSkeleton, usePrefetchRecord } from './components/DocumentPage';
export { RecordProperties, HtmlFrame, ReportFrame, ShareControl } from './components/RecordComponents';
export { RenderChartData } from './components/RenderChartData';
export { MarkdownEditor } from './components/MarkdownEditor';
export { NotisSelectionBoundary, NOTIS_CONTEXT_CLIPBOARD_TYPE } from './components/NotisSelectionBoundary';
export type { NotisSelectionBoundaryProps } from './components/NotisSelectionBoundary';
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
export { Dialog } from './components/Dialog';
export type { DialogProps } from './components/Dialog';
export { MultiSelectActionBar } from './components/MultiSelectActionBar';
export { MultiSelectCheckbox, MultiSelectCheckbox as SelectionCheckbox } from './components/MultiSelectCheckbox';
export { MultiSelectDragOverlay, MultiSelectDragOverlay as SelectionMarquee } from './components/MultiSelectDragOverlay';
export { ShortcutHints } from './components/ShortcutHints';
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
export type { MultiSelectCheckboxProps as SelectionCheckboxProps } from './components/MultiSelectCheckbox';
export type { MultiSelectDragOverlayProps as SelectionMarqueeProps } from './components/MultiSelectDragOverlay';
export type { ShortcutHint, ShortcutHintsProps } from './components/ShortcutHints';
export type {
  CollectionInteractionController,
  CollectionInteractionReason,
  CollectionKeyboardShortcuts,
  CollectionNavigationContext,
  CollectionNavigationDirection,
  CollectionSelectionChange,
  SelectionMarqueeRect,
  UseCollectionInteractionsOptions,
} from './hooks/useCollectionInteractions';
export type {
  ShortcutDefinition,
  ShortcutHelpEntry,
  ShortcutScope,
  UseShortcutsOptions,
} from './interactions/shortcuts';
export type {
  CollectionAction,
  CollectionActionContext,
  CollectionActionIntent,
  ResolvedCollectionAction,
} from './interactions/actions';

// Types (re-exported for convenience)
export type {
  AppDescriptor,
  CloudComputerCliAuthFacts,
  CloudComputerFacts,
  CloudComputerSandboxFacts,
  ContextAttributeValue,
  ContextResource,
  ContextSelection,
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
  NotisDocumentPageProps,
  NotisDocumentPageCrumb,
  NotisDocumentPageMenuItem,
  NotisDocumentPageParts,
  NotisRecordProps,
  NotisRecordPropertiesProps,
  NotisHtmlFrameProps,
  NotisReportFrameProps,
  NotisShareControlProps,
  NotisMarkdownEditorProps,
  NotisMarkdownEditorSavePayload,
  NotisMarkdownEditorSaveResult,
  NotisRuntime,
  RuntimeResource,
  NotisRuntimeContext,
  NotisRuntimeUI,
  QueryFilter,
  RouteDescriptor,
  SecretPropertyValue,
  SubscribeDatabaseOptions,
  ToolDescriptor,
  ToolCallOptions,
  ToolInputSchema,
} from './runtime';

export { useToolQuery } from './hooks/useToolQuery';

export { Skeleton, ViewSkeleton } from './components/Skeleton';

export { useLongPressSelection } from './hooks/useLongPressSelection';
export { isInteractionElementVisible } from './interactions/visibility';

export type { AgentContextContent, AgentContextItem, ContextAttachment } from './agentContext';
export { useAgentContext } from './hooks/useAgentContext';
export { NotisCommentBoundary, NotisCommentBox } from './components/NotisCommentBoundary';
export type { NotisCommentBoundaryProps, NotisCommentBoxProps } from './components/NotisCommentBoundary';
