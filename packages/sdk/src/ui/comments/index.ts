// E: the comment pane (threads, pins, asks, Copy changes) bound to a Space's Comments database, and comments on
// passages of a record's text (highlights, Comment on a selection, Passage changed) in the same pane: archive with
// Undo, delete and edit by the viewer's rights, where a thread goes, comment modes and the page tool bar.
export * from './commentModel';
export * from './commentWords';
export * from './useComments';
export * from './CommentPane';
export {
  COMMENT_HARNESS_NAMES, CommentAgentBadge, commentAgentRuntimeView, type CommentAgentRuntimeView, type CommentHarness,
} from './agentRuntime';
export * from './commentFiles';
export * from './passageModel';
export * from './usePassageComments';
export * from './PassageComments';
export { COMMENT_FOCUS_PARAM, useCommentFocusParam, useHostComments } from './hostComments';
export { useCommentRouting, type CommentRouting } from './useCommentRouting';
export type { CommentListOptions } from './paneParts';
