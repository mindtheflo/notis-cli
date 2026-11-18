/**
 * Deprecated stand-ins for the comment names the SDK no longer has. Deployed Space bundles import `@notis/sdk` and
 * `@notis/sdk/ui` live from the host, so a Space built against an older SDK keeps loading: every removed name is still
 * exported, and does nothing. Comments now live in the Space's one comment store and show in the host Comments panel
 * (`useComments`, `CommentPane`); Cite and Comment on any selected text come with every Space page.
 *
 * Components render nothing (a boundary renders its children), hooks and helpers return inert values. Nothing here
 * may grow behaviour again: new code uses the comment store through `runtime.spaceComments`.
 */

import { createElement, type ReactNode } from 'react';
import type { ContextResource } from '../runtime';
import { NotisSelectionBoundary } from '../components/NotisSelectionBoundary';
import type { CommentColumns, CommentRecord, CommentThread } from '../ui/comments/commentModel';
import type { CommentController } from '../ui/comments/useComments';
import type { TextPassage } from '../ui/comments/passageModel';

/** Marks a stand-in, so the design system book does not ask for its specimen. */
const STAND_IN = Symbol.for('notis.sdk.standIn');
function standIn<T extends object>(value: T): T {
  Object.defineProperty(value, STAND_IN, { value: true });
  return value;
}

// ---------------------------------------------------------------------------
// @notis/sdk
// ---------------------------------------------------------------------------

/** @deprecated The comment editor on a selection is gone: Comment on any selected text opens the host Comments panel. */
export interface NotisCommentBoxProps {
  quote?: string;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
  pending?: boolean;
  error?: string;
  className?: string;
}

/** @deprecated Renders nothing: Comment on any selected text opens the host Comments panel. */
export const NotisCommentBox = standIn(function NotisCommentBox(_props: NotisCommentBoxProps): null {
  return null;
});

/** @deprecated See `NotisCommentBoundary`. */
export interface NotisCommentBoundaryProps {
  resource?: ContextResource | null;
  children: ReactNode;
  className?: string;
  commentClassName?: string;
  renderComment?: (props: NotisCommentBoxProps) => ReactNode;
}

/**
 * @deprecated Renders its children (in a `NotisSelectionBoundary` naming `resource`, so a copy or a Cite of them still
 * names it). Cite and Comment on a selection come with every Space page.
 */
export const NotisCommentBoundary = standIn(function NotisCommentBoundary({ resource, children, className }: NotisCommentBoundaryProps) {
  return createElement(NotisSelectionBoundary, {
    resource, className, style: className ? undefined : { display: 'contents' }, children,
  });
});

// ---------------------------------------------------------------------------
// @notis/sdk/ui: components that are now internal to the host Comments panel
// ---------------------------------------------------------------------------

/** @deprecated The pane draws its own avatars. */
export interface CommentAvatarProps { author: string; me?: string; className?: string }
/** @deprecated Renders nothing: the host Comments panel draws the threads. */
export const CommentAvatar = standIn(function CommentAvatar(_props: CommentAvatarProps): null {
  return null;
});

/** @deprecated The pane draws its own thread cards. */
export interface CommentThreadCardProps { controller: CommentController; thread: CommentThread; showAnchor?: boolean }
/** @deprecated Renders nothing: `CommentPane` draws the threads in the host Comments panel. */
export const CommentThreadCard = standIn(function CommentThreadCard(_props: CommentThreadCardProps): null {
  return null;
});

/** @deprecated The pane draws its own new comment box. */
export interface NewCommentBoxProps { controller: CommentController }
/** @deprecated Renders nothing: `CommentPane` draws the new comment box in the host Comments panel. */
export const NewCommentBox = standIn(function NewCommentBox(_props: NewCommentBoxProps): null {
  return null;
});

// ---------------------------------------------------------------------------
// @notis/sdk/ui: Comments database helpers (the store replaced the database)
// ---------------------------------------------------------------------------

/** @deprecated A row of the retired Comments database. */
export type CommentRow = Record<string, unknown>;

/** @deprecated The retired Comments database's column names, kept as they were. */
export const COMMENT_COLUMNS: Readonly<CommentColumns> = Object.freeze({
  body: 'Body', scope: 'Deck', anchor: 'Slide', thread: 'Thread', author: 'Author', x: 'X', y: 'Y', w: null, h: null,
  status: 'Status', needs: 'Needs', options: 'Options', answer: 'Answer', answeredAt: 'Answered at', change: 'Change',
  changedAt: 'Changed at', example: 'Example', attachments: 'Attachments', editedAt: 'Edited at', time: null,
  answerTo: 'Answer to',
});

/** @deprecated Returns the old column names with `overrides`; nothing reads them. */
export function commentColumns(overrides?: Partial<CommentColumns>): CommentColumns {
  return { ...COMMENT_COLUMNS, ...(overrides ?? {}) };
}

/** @deprecated Always null: comments come from the store (`commentFromRow`). */
export function readCommentRow(..._args: unknown[]): CommentRecord | null {
  return null;
}

/** @deprecated Always empty. */
export function commentRowsOf(..._args: unknown[]): CommentRow[] {
  return [];
}

/** @deprecated Always null (unknown). */
export function commentRowsHaveColumn(..._args: unknown[]): boolean | null {
  return null;
}

/** @deprecated Always ''. */
export function commentText(..._args: unknown[]): string {
  return '';
}

/** @deprecated The server names every author. */
export const COMMENT_PERSON_AUTHOR = 'Person';

/** @deprecated Always empty: the server signs every comment with the viewer. */
export function commentAuthorCandidates(..._args: unknown[]): string[] {
  return [];
}

/** @deprecated Always false. */
export function isRefusedChoice(_error?: unknown): boolean {
  return false;
}

/** @deprecated The retired passage column names. */
export interface PassageColumns { field: string; quote: string; prefix: string; suffix: string }

/** @deprecated The retired passage column names, kept as they were. */
export const PASSAGE_COLUMNS: Readonly<PassageColumns> = Object.freeze({
  field: 'Field', quote: 'Quote', prefix: 'Prefix', suffix: 'Suffix',
});

/** @deprecated Returns the old column names with `overrides`; nothing reads them. */
export function passageColumns(overrides?: Partial<PassageColumns>): PassageColumns {
  return { ...PASSAGE_COLUMNS, ...(overrides ?? {}) };
}

/** @deprecated Always null: a comment's passage is `CommentRecord.passage`. */
export function readPassage(..._args: unknown[]): (TextPassage & { field: string }) | null {
  return null;
}

/** @deprecated Always empty. */
export function passageProperties(..._args: unknown[]): Record<string, unknown> {
  return {};
}

/** @deprecated Always empty. */
export function passageFieldValues(..._args: unknown[]): Record<string, string> {
  return {};
}
