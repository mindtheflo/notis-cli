// E: the comment pane (threads, pins, asks, Copy changes) on the Space's one comment store, and comments on
// passages of a record's text (highlights, Comment on a selection, Passage changed) in the same pane: archive with
// Undo, delete and edit by the viewer's rights, where a thread goes, comment modes and the page tool bar.
export * from './commentModel';
export * from './commentWords';
export * from './useComments';
export {
  CommentAgentSource, CommentPane, CommentPins, CommentToolBar, commentExcerpt, sendsOnEnter,
  type CommentPaneProps, type CommentPinsProps, type CommentToolBarProps,
} from './CommentPane';
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
// Deprecated stand-ins for removed names: deployed Spaces import this package live from the host.
export {
  COMMENT_COLUMNS, COMMENT_PERSON_AUTHOR, CommentAvatar, CommentThreadCard, NewCommentBox, PASSAGE_COLUMNS,
  commentAuthorCandidates, commentColumns, commentRowsHaveColumn, commentRowsOf, commentText, isRefusedChoice,
  passageColumns, passageFieldValues, passageProperties, readCommentRow, readPassage,
  type CommentAvatarProps, type CommentRow, type CommentThreadCardProps, type NewCommentBoxProps, type PassageColumns,
} from '../../compat/comments';
