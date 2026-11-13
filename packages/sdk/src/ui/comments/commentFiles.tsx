/**
 * Pictures and files attached to a comment before it is sent: paste a picture, drop files on the box or pick them with
 * the paperclip. Each file uploads at once (`controller.uploadFile`) and shows as a chip with its progress and a remove
 * control; Send waits for every chip to be ready. A failed upload keeps the chip (Remove, and Try again when another try
 * can help) and never the typed text. The comment row is written only on Send, with the uploaded references in its Attachments column.
 */

import React, { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { SpaceFileError } from '../../space';
import { Button } from '../blocks';
import { Icon } from '../icons';
import { Tooltip } from '../overlay';
import { readCommentDraft, writeCommentDraft, type StoredCommentFile } from './commentDrafts';
import type { CommentWordKey } from './commentWords';
import type { CommentController, CommentFile } from './useComments';

/** Files one comment carries at most. */
export const COMMENT_MAX_FILES = 10;
const IMAGE_TYPE = /^image\/(png|jpeg|gif|webp)$/;
const TYPE_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export interface CommentFileDraft {
  id: string;
  name: string;
  /** A local picture shown while it uploads (an object URL), or null for other files. */
  thumb: string | null;
  state: 'uploading' | 'ready' | 'failed';
  /** 0 to 100 while uploading. */
  percent: number;
  file: File;
  uploaded: CommentFile | null;
  error: string | null;
  /** False when trying the same file again cannot help (too large, a refused kind, empty, no upload here). */
  retryable: boolean;
}

let draftCount = 0;
const NO_FILES: CommentFileDraft[] = [];

/** A pasted picture often comes as "image.png": name it by its kind so the comment shows something useful. */
function namedFile(file: File): File {
  if (file.name && file.name !== 'image.png' && /\.[a-z0-9]{1,8}$/i.test(file.name)) return file;
  const extension = TYPE_EXTENSIONS[file.type];
  if (!extension) return file;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new File([file], `pasted-${stamp}.${extension}`, { type: file.type, lastModified: file.lastModified });
}

function errorWord(error: unknown): CommentWordKey {
  const code = error instanceof SpaceFileError ? error.code : '';
  if (code === 'space_file_too_large') return 'fileTooLarge';
  if (code === 'space_file_type_unsupported') return 'fileType';
  if (code === 'space_file_empty') return 'fileEmpty';
  if (['space_file_column_missing', 'space_file_write_required', 'editor_required'].includes(code)) return 'filesUnavailable';
  return 'fileFailed';
}

export interface CommentFilesState {
  drafts: CommentFileDraft[];
  /** The uploaded files, in order, once none is still uploading or failed. */
  ready: CommentFile[];
  uploading: boolean;
  failed: boolean;
  /** Something the box can send with: no upload running and none failed. */
  settled: boolean;
  add(files: Iterable<File>): void;
  remove(id: string): void;
  retry(id: string): void;
  /** Forget every chip (after Send). */
  clear(): void;
  dragging: boolean;
  /** Paste and drop handlers for the box. */
  boxHandlers: {
    onPaste(event: ClipboardEvent<HTMLElement>): void;
    onDragOver(event: DragEvent<HTMLElement>): void;
    onDragLeave(event: DragEvent<HTMLElement>): void;
    onDrop(event: DragEvent<HTMLElement>): void;
  };
}

function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function thumbOf(file: File): string | null {
  return IMAGE_TYPE.test(file.type) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

/** The chips a box kept in the session store (`commentDrafts`): pictures get a new preview, a cut upload starts again. */
function restoredFiles(key: string | null | undefined): CommentFileDraft[] {
  return (readCommentDraft(key)?.files ?? []).map(stored => ({
    id: `file-${++draftCount}`, name: stored.name, thumb: thumbOf(stored.file), state: stored.state,
    percent: stored.state === 'ready' ? 100 : 0, file: stored.file, uploaded: (stored.uploaded ?? null) as CommentFile | null,
    error: stored.error, retryable: stored.retryable,
  }));
}

/**
 * The attachment queue of one comment box. With `draftKey` the chips are kept in the session store while the box is
 * away (the page's comments left the panel) and come back with it; an upload cut short by that starts again.
 */
export function useCommentFiles(controller: CommentController, draftKey: string | null = null): CommentFilesState {
  // The chips and the draft they belong to travel together: a box that moves to another draft (another page) shows that
  // draft's chips and never saves the previous draft's under the new key.
  const [held, setHeld] = useState(() => ({ key: draftKey, drafts: restoredFiles(draftKey) }));
  const drafts = held.key === draftKey ? held.drafts : NO_FILES;
  const setDrafts = useCallback((change: (current: CommentFileDraft[]) => CommentFileDraft[]) =>
    setHeld(before => ({ key: before.key, drafts: change(before.drafts) })), []);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [dragging, setDragging] = useState(false);
  const aborts = useRef(new Map<string, AbortController>());
  const thumbs = useRef(new Set<string>(drafts.flatMap(draft => draft.thumb ? [draft.thumb] : [])));
  const live = useRef(true);
  const { uploadFile, toaster, say } = controller;
  const sayRef = useRef(say);
  sayRef.current = say;
  const maxMb = Math.floor(controller.maxFileBytes / (1024 * 1024));

  useEffect(() => {
    live.current = true;
    const pending = aborts.current;
    const shown = thumbs.current;
    return () => {
      live.current = false;
      for (const abort of pending.values()) abort.abort();
      pending.clear();
      for (const url of shown) URL.revokeObjectURL(url);
      shown.clear();
    };
  }, []);

  const patch = useCallback((id: string, change: Partial<CommentFileDraft>) => {
    if (live.current) setDrafts(current => current.map(draft => draft.id === id ? { ...draft, ...change } : draft));
  }, [setDrafts]);

  const start = useCallback((draft: CommentFileDraft) => {
    const abort = new AbortController();
    aborts.current.set(draft.id, abort);
    uploadFile(draft.file, {
      signal: abort.signal,
      onProgress: (sent, total) => patch(draft.id, { percent: total ? Math.min(99, Math.round(sent / total * 100)) : 0 }),
    }).then(uploaded => {
      if (aborts.current.get(draft.id) !== abort) return;
      aborts.current.delete(draft.id);
      patch(draft.id, { state: 'ready', percent: 100, uploaded, error: null });
    }, (error: unknown) => {
      if (aborts.current.get(draft.id) !== abort || abort.signal.aborted) return;
      aborts.current.delete(draft.id);
      const word = errorWord(error);
      const message = sayRef.current(word, { name: draft.name, size: maxMb });
      console.warn('[comments] file upload failed', error);
      patch(draft.id, { state: 'failed', error: message, retryable: word === 'fileFailed' });
      if (live.current) toaster.notify(message, { tone: 'danger' });
    });
  }, [uploadFile, patch, toaster, maxMb]);

  // Restored chips whose upload was cut short start again (once per mount).
  useEffect(() => {
    for (const draft of draftsRef.current) if (draft.state === 'uploading' && !aborts.current.has(draft.id)) start(draft);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Another draft for the same box: the previous draft's chips stay saved under its own key (an upload cut short starts
  // again when it comes back), and this draft's chips load before anything is saved under its key.
  useEffect(() => {
    if (held.key === draftKey) return;
    for (const abort of aborts.current.values()) abort.abort();
    aborts.current.clear();
    for (const url of thumbs.current) URL.revokeObjectURL(url);
    thumbs.current.clear();
    const restored = restoredFiles(draftKey);
    for (const draft of restored) if (draft.thumb) thumbs.current.add(draft.thumb);
    draftsRef.current = restored;
    setHeld({ key: draftKey, drafts: restored });
    for (const draft of restored) if (draft.state === 'uploading') start(draft);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // The chips follow the box into the session store, so they outlive it; only under the draft they belong to.
  useEffect(() => {
    if (!draftKey || held.key !== draftKey) return;
    writeCommentDraft(draftKey, { files: held.drafts.map<StoredCommentFile>(draft => ({
      name: draft.name, file: draft.file, state: draft.state, uploaded: draft.uploaded, error: draft.error, retryable: draft.retryable,
    })) });
  }, [draftKey, held]);

  const add = useCallback((files: Iterable<File>) => {
    if (controller.attach === 'off') { toaster.notify(controller.words.filesUnavailable, { tone: 'danger' }); return; }
    const incoming = Array.from(files).map(namedFile);
    if (!incoming.length) return;
    const room = COMMENT_MAX_FILES - draftsRef.current.length;
    if (incoming.length > room) toaster.notify(sayRef.current('fileTooMany', { n: COMMENT_MAX_FILES }), { tone: 'danger' });
    const added = incoming.slice(0, Math.max(0, room)).map<CommentFileDraft>(file => {
      const thumb = thumbOf(file);
      if (thumb) thumbs.current.add(thumb);
      return { id: `file-${++draftCount}`, name: file.name, thumb, state: 'uploading', percent: 0, file, uploaded: null, error: null, retryable: true };
    });
    if (!added.length) return;
    draftsRef.current = [...draftsRef.current, ...added];
    setDrafts(current => [...current, ...added]);
    for (const draft of added) start(draft);
  }, [controller.attach, controller.words, toaster, start, setDrafts]);

  const remove = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    aborts.current.delete(id);
    setDrafts(current => {
      const gone = current.find(draft => draft.id === id);
      if (gone?.thumb) { URL.revokeObjectURL(gone.thumb); thumbs.current.delete(gone.thumb); }
      return current.filter(draft => draft.id !== id);
    });
  }, [setDrafts]);

  const retry = useCallback((id: string) => {
    const draft = drafts.find(item => item.id === id);
    if (!draft || draft.state !== 'failed') return;
    const again = { ...draft, state: 'uploading' as const, percent: 0, error: null };
    patch(id, again);
    start(again);
  }, [drafts, patch, start]);

  const clear = useCallback(() => {
    for (const url of thumbs.current) URL.revokeObjectURL(url);
    thumbs.current.clear();
    setDrafts(() => []);
  }, [setDrafts]);

  const enabled = controller.attach !== 'off';
  const boxHandlers = {
    onPaste: (event: ClipboardEvent<HTMLElement>) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length || !enabled) return;
      // A pasted picture is attached; any text pasted with it still goes into the box.
      if (!event.clipboardData.getData('text/plain')) event.preventDefault();
      add(files);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
      if (enabled && !dragging) setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event)) return;
      // A file dropped here never makes the browser open it in place of the Space.
      event.preventDefault();
      setDragging(false);
      add(Array.from(event.dataTransfer.files));
    },
  };

  const uploading = drafts.some(draft => draft.state === 'uploading');
  const failed = drafts.some(draft => draft.state === 'failed');
  const ready = uploading || failed ? [] : drafts.flatMap(draft => draft.uploaded ? [draft.uploaded] : []);
  return { drafts, ready, uploading, failed, settled: !uploading && !failed, add, remove, retry, clear, dragging, boxHandlers };
}

/** The paperclip that opens the file picker. Renders nothing when the pane is text only. */
export function CommentAttachButton({ controller, files, disabled }: {
  controller: CommentController; files: CommentFilesState; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  if (controller.attach !== 'on') return null;
  const label = controller.say('attachFiles');
  return (
    <>
      <Tooltip label={label}>
        <Button variant="ghost" size="sm" className="nui-comment-icon-btn" aria-label={label} disabled={disabled}
          onClick={() => input.current?.click()} icon={<Icon name="paperclip" />} />
      </Tooltip>
      <input ref={input} type="file" multiple className="nui-sr-only" tabIndex={-1} aria-hidden="true"
        accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.md,.csv,.tsv,.json"
        onChange={event => { files.add(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    </>
  );
}

/** The chips of the files attached to a box: a thumbnail or a file icon, the name, progress, and remove. */
export function CommentFileChips({ controller, files }: { controller: CommentController; files: CommentFilesState }) {
  if (!files.drafts.length) return null;
  return (
    <ul className="nui-comment-files" aria-label={controller.say('attachments')}>
      {files.drafts.map(draft => {
        const status = draft.state === 'uploading' ? controller.say('fileUploading', { name: draft.name, percent: draft.percent })
          : draft.state === 'failed' ? draft.error ?? '' : controller.say('fileReady', { name: draft.name });
        return (
          <li key={draft.id} className="nui-comment-file" data-state={draft.state} title={status}>
            <span className="nui-comment-file-thumb" aria-hidden="true">
              {draft.thumb ? <img src={draft.thumb} alt="" /> : <Icon name="file-text" />}
            </span>
            <span className="nui-comment-file-name">{draft.name}</span>
            <span className="nui-sr-only" role="status">{status}</span>
            {draft.state === 'uploading' ? (
              <span className="nui-comment-file-progress" aria-hidden="true">
                <span style={{ width: `${Math.max(4, draft.percent)}%` }} />
              </span>
            ) : null}
            {draft.state === 'failed' && draft.retryable ? (
              <button type="button" className="nui-comment-file-btn" aria-label={controller.say('fileRetry', { name: draft.name })}
                onClick={() => files.retry(draft.id)}><Icon name="arrow-clockwise" /></button>
            ) : null}
            <button type="button" className="nui-comment-file-btn" aria-label={controller.say('fileRemove', { name: draft.name })}
              onClick={() => files.remove(draft.id)}><Icon name="x" /></button>
          </li>
        );
      })}
    </ul>
  );
}

/** The "Drop to attach" veil over a box while files are dragged over it. */
export function CommentDropVeil({ controller, files }: { controller: CommentController; files: CommentFilesState }) {
  return files.dragging ? <span className="nui-comment-drop" aria-hidden="true">{controller.say('dropFiles')}</span> : null;
}
