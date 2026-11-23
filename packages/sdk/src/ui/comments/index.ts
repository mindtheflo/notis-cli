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
export { commentGroupSlot, type CommentListOptions } from './paneParts';
// What the host panel around a pane shares with it: the slots the pane leaves and the threads that wait for the viewer.
export {
  COMMENT_PANE_SLOTS, hostComposerAvailable, listHostComposers, registerHostComposerHost, setWaitingCommentCount,
  setWaitingCommentThreads, subscribeHostComposers, useWaitingCommentThreads, waitingCommentThreads,
  type HostComposerProps, type HostComposerRequest, type HostComposerTo,
} from './hostPanel';
// The review run, shared between the pane and its host: what the host tells the pane, what the pane shows and reports.
export {
  REVIEW_RUN_TRAVEL_MS, cardComesIntoPlace, cardThatTookThePlace, emitReviewRunEvent, markReviewRunAnswered, publishReviewRunPane, reviewRunAnswered, reviewRunCommands,
  reviewRunHost, reviewRunPane, resetReviewRunAnswered, setReviewRunHost, subscribeReviewRunAnswered, subscribeReviewRunEvents,
  subscribeReviewRunHost, subscribeReviewRunPane, unmarkReviewRunAnswered,
  type ReviewRunEvent, type ReviewRunHost, type ReviewRunPaneState, type ReviewRunSheet,
} from './reviewRun';
// A new version of an open page: the host draws the pane itself so it outlives the view (`paneOutlet`), hands what
// the comments show from the old view to the new one (`handover`), and keeps unsent comments between page loads.
export { CommentPaneOutlet, registerPaneOutlet } from './paneOutlet';
export { handOverCommentState } from './handover';
export { flushCommentDrafts, keepCommentDraftsIn, type CommentDraftStorage } from './commentDrafts';
