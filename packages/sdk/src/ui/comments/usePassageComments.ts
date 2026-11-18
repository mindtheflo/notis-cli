/**
 * The controller for comments on passages of a record's text: a `useComments` controller (reading, live feed,
 * replies, Archive, Delete, Edit, where a thread goes) plus where each thread sits (its field and quoted words), the
 * comment being written on a selection, which threads read Passage changed (their words are gone; they stay open with
 * the old quote), and the reading order. `CommentableText`, `CommentableRichText` and `PassageCommentPane` render from
 * it. Its modes default to text (a selection) and the whole page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpaceCommentAnchor } from '../../space';
import { commentDraftKey, forgetCommentDraft, hasDraftContent, readCommentDraft, writeCommentDraft } from './commentDrafts';
import type { CommentThread } from './commentModel';
import { useCommentFocusParam } from './hostComments';
import { useComments, type CommentController, type CommentFile, type UseCommentsOptions } from './useComments';
import { passageOffset, type PassageAnchor, type PassageField } from './passageModel';

/** Where a thread was opened: its highlight in the text, its card or its quote in the pane, or a link to one comment. */
export type PassageOpenedFrom = 'passage' | 'pane' | 'quote' | 'link';

export interface UsePassageCommentsOptions extends Omit<UseCommentsOptions, 'anchors' | 'anchorKey' | 'onSelectThread'> {
  /** The text properties comments can sit on, in reading order. */
  fields: readonly PassageField[];
  /** @deprecated A passage is kept in the comment store (`field`, `quote`, `prefix`, `suffix`): ignored. */
  passageColumns?: Partial<Record<'field' | 'quote' | 'prefix' | 'suffix', string>>;
  /**
   * Each field's value as edited on screen, by field key: a thread whose words are no longer there reads Text
   * changed, and threads list in reading order. A field left out is never marked changed.
   */
  values?: Readonly<Record<string, string>>;
  /** The group of fields on screen (a language). Null: every field. */
  group?: string | null;
  /** A thread was opened. Show its field (switch to its group, open the pane) before its passage flashes. */
  onOpen?(thread: CommentThread, passage: PassageAnchor | undefined, from: PassageOpenedFrom): void;
  /** A selection started a new comment: show the pane, which holds its box. */
  onDraft?(passage: PassageAnchor): void;
  /**
   * Open the thread of this comment (a root or a reply) once it is read: a link to one comment. Default: the
   * `comment` view param (`useCommentFocusParam`); null turns that off.
   */
  focusKey?: string | null;
}

export interface PassageCommentController {
  /** The underlying comment controller: thread cards, Archive, Delete, Edit, the status filter, routing and the toast. */
  controller: CommentController;
  fields: readonly PassageField[];
  field(key: string): PassageField | undefined;
  /** The passage a thread's first comment sits on; undefined for a comment on the whole record. */
  passageOf(rootKey: string): PassageAnchor | undefined;
  group: string | null;
  /** Threads of a group (default: the group on screen; null: all), open ones first, each in reading order. */
  threads(group?: string | null): CommentThread[];
  /** Threads on one field, in reading order. */
  threadsOn(field: string): CommentThread[];
  /** Open threads of a group (default: the group on screen; null: all). */
  openCount(group?: string | null): number;
  /** Whether a thread's quoted words are gone from its field. */
  isChanged(rootKey: string): boolean;
  /** The comment being written on a selection. */
  draft: PassageAnchor | null;
  /** The comment being placed or written on the page (the New comment menu): the same as `controller.draftPin`. */
  draftPin: CommentController['draftPin'];
  startDraft(passage: PassageAnchor): void;
  /**
   * Starts a new comment on a place the host names (Comment on a selection): words in one of `fields` open this
   * controller's own box on them, anything else the page's new comment. True when it was taken.
   */
  startAnchor(anchor: SpaceCommentAnchor): boolean;
  cancelDraft(): void;
  /**
   * Saves the draft with its text and the pictures and files attached to it (SPC-131: paste, drop or the paperclip),
   * either one enough. True once saved; its thread is then selected.
   */
  send(body: string, files?: readonly CommentFile[]): Promise<boolean>;
  sending: boolean;
  /** The last send failed. */
  failed: boolean;
  /** The thread whose passage flashes, whether to scroll to it, and a count that changes on each flash. */
  flash: { key: string; scroll: boolean; n: number } | null;
  /**
   * Opens a thread: its passage flashes and the pane selects it. From the page ('passage': a highlight or a field's
   * Comment count) or a link ('link') it is a reveal: `revealRequest` goes up by one and the host shows its Comments
   * panel (C8). From the pane ('pane', 'quote') the panel stays as it is.
   */
  open(thread: CommentThread, from: PassageOpenedFrom): void;
  openKey(rootKey: string, from: PassageOpenedFrom): void;
  /** Starts at 0 and goes up by one on each comment picked on the page: the same number as `controller.revealRequest`. */
  revealRequest: number;
  /** Rich text on screen reports which passages it shows: Text changed then follows what is rendered. */
  reportFound(field: string, keys: ReadonlySet<string> | null): void;
}

const NO_FIELDS: readonly PassageField[] = Object.freeze([]);
const PASSAGE_MODES = Object.freeze(['text', 'page'] as const);

export function usePassageComments(options: UsePassageCommentsOptions): PassageCommentController {
  const { fields = NO_FIELDS, values, group = null } = options;
  const urlFocus = useCommentFocusParam();
  const focusKey = options.focusKey === undefined ? urlFocus : options.focusKey;
  const latest = useRef(options);
  latest.current = options;
  const fieldIndex = useMemo(() => new Map(fields.map((item, index) => [item.key, index])), [fields]);
  const field = useCallback((key: string) => fields.find(item => item.key === key), [fields]);

  const [flash, setFlash] = useState<PassageCommentController['flash']>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const openedFrom = useRef<PassageOpenedFrom>('pane');

  const passagesRef = useRef<Map<string, PassageAnchor>>(new Map());
  const controller = useComments({
    ...options,
    anchors: undefined,
    anchorKey: null,
    // This controller opens a linked comment itself, with its passage flash.
    focusKey: null,
    modes: options.modes ?? PASSAGE_MODES,
    onSelectThread: (thread) => {
      const passage = passagesRef.current.get(thread.root.recordKey);
      const from = openedFrom.current;
      openedFrom.current = 'pane';
      latest.current.onOpen?.(thread, passage, from);
      if (timer.current) clearTimeout(timer.current);
      setFlash(current => ({ key: thread.root.recordKey, scroll: from !== 'passage', n: (current?.n ?? 0) + 1 }));
      timer.current = setTimeout(() => setFlash(null), 1600);
    },
  });

  // The passage each thread's first comment sits on: words in one of the declared fields.
  const passages = useMemo(() => {
    const map = new Map<string, PassageAnchor>();
    for (const comment of controller.comments) {
      const passage = comment.passage;
      if (comment.thread || !passage?.quote || !passage.field || !fieldIndex.has(passage.field)) continue;
      map.set(comment.recordKey, { field: passage.field, quote: passage.quote, prefix: passage.prefix, suffix: passage.suffix });
    }
    return map;
  }, [controller.comments, fieldIndex]);
  passagesRef.current = passages;

  // What rich text on screen shows, by field: it wins over the value for Text changed.
  const [found, setFound] = useState<Readonly<Record<string, ReadonlySet<string>>>>({});
  const reportFound = useCallback((key: string, keys: ReadonlySet<string> | null) => {
    setFound(current => {
      const previous = current[key];
      if (!keys) {
        if (!previous) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      if (previous && previous.size === keys.size && [...keys].every(item => previous.has(item))) return current;
      return { ...current, [key]: new Set(keys) };
    });
  }, []);

  // Reading position and Text changed of every passage, from the values on screen.
  const placement = useMemo(() => {
    const changed = new Set<string>();
    const rank = new Map<string, number>();
    for (const [key, passage] of passages) {
      const index = fieldIndex.get(passage.field) ?? fields.length;
      const value = values?.[passage.field];
      const shown = found[passage.field];
      const at = value == null ? 0 : passageOffset(value, passage, field(passage.field)?.markdown);
      const gone = shown ? !shown.has(key) : value != null && at == null;
      if (gone) changed.add(key);
      rank.set(key, (gone ? fields.length + 1 : 0) + index + Math.min(at ?? 0, 999999) / 1000000);
    }
    return { changed, rank };
  }, [passages, fieldIndex, fields.length, values, found, field]);

  const inGroup = useCallback((thread: CommentThread, wanted: string | null) => {
    if (wanted == null) return true;
    const passage = passages.get(thread.root.recordKey);
    if (!passage) return true;
    return (field(passage.field)?.group ?? null) === wanted;
  }, [passages, field]);
  const ordered = useCallback((list: CommentThread[]) => {
    const rankOf = (thread: CommentThread) => placement.rank.get(thread.root.recordKey) ?? -1;
    const sorted = [...list].sort((a, b) => rankOf(a) - rankOf(b));
    return [...sorted.filter(thread => thread.root.status !== 'Resolved'), ...sorted.filter(thread => thread.root.status === 'Resolved')];
  }, [placement]);
  const threads = useCallback((wanted?: string | null) => {
    const target = wanted === undefined ? group : wanted;
    return ordered(controller.threads.filter(thread => inGroup(thread, target)));
  }, [controller.threads, group, inGroup, ordered]);
  const threadsOn = useCallback((key: string) => ordered(controller.threads.filter(thread =>
    passages.get(thread.root.recordKey)?.field === key)), [controller.threads, passages, ordered]);
  const openCount = useCallback((wanted?: string | null) =>
    threads(wanted).filter(thread => thread.root.status === 'Open').length, [threads]);

  // A new comment on a selection, saved with its passage.
  // A comment being written on a passage outlives the pane, like a new comment's pin: the passage comes back while its
  // box kept text (`commentDrafts`).
  const draftKey = commentDraftKey(controller.draftScope, 'passage');
  const restoredPassage = (key: string | null): PassageAnchor | null => {
    const stored = readCommentDraft(key);
    return hasDraftContent(stored) && stored?.place ? stored.place as PassageAnchor : null;
  };
  const [draft, setDraft] = useState<PassageAnchor | null>(() => restoredPassage(draftKey));
  const passageKeyRef = useRef(draftKey);
  useEffect(() => {
    if (passageKeyRef.current !== draftKey) {
      // Another page (record A to B while mounted): its own passage comes back, if one was left there, and A's passage
      // is never saved under B's key.
      passageKeyRef.current = draftKey;
      setDraft(restoredPassage(draftKey));
      return;
    }
    writeCommentDraft(draftKey, { place: draft ?? undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, draft]);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const { setThreadKey, canWrite, cancelMode, cancelPin, draftPin, sendAt, startAnchor: startPageAnchor } = controller;
  const { clearPick } = controller.routing;

  const startDraft = useCallback((passage: PassageAnchor) => {
    setFailed(false);
    cancelMode();
    cancelPin();
    setDraft(passage);
    setThreadKey(null);
    latest.current.onDraft?.(passage);
  }, [setThreadKey, cancelMode, cancelPin]);
  // A comment on the whole page started (the New comment menu): it replaces a comment on a selection.
  useEffect(() => { if (draftPin) setDraft(null); }, [draftPin]);
  // Cancelling forgets the conversation picked for it too: the next comment goes to the best match again.
  const cancelDraft = useCallback(() => { setDraft(null); setFailed(false); clearPick(); forgetCommentDraft(draftKey); },
    [clearPick, draftKey]);

  const startAnchor = useCallback((anchor: SpaceCommentAnchor) => {
    if (anchor?.mode === 'text' && anchor.field && fieldIndex.has(anchor.field) && anchor.quote?.trim()) {
      startDraft({ field: anchor.field, quote: anchor.quote, prefix: anchor.prefix ?? '', suffix: anchor.suffix ?? '' });
      return true;
    }
    return startPageAnchor(anchor);
  }, [fieldIndex, startDraft, startPageAnchor]);

  const send = useCallback(async (body: string, files: readonly CommentFile[] = []) => {
    const text = body.trim();
    const target = draft ? field(draft.field) : undefined;
    const attached = controller.attach === 'on' ? files : [];
    if (!draft || !target || (!text && !attached.length) || sending) return false;
    // Nothing is sent until the signed-in viewer is known.
    if (!canWrite) { console.warn('[comments] the viewer is not known yet: nothing was sent'); return false; }
    setSending(true);
    setFailed(false);
    try {
      const id = await sendAt({ anchorKey: null, x: null, y: null, w: null, h: null,
        text: { quote: draft.quote, prefix: draft.prefix, suffix: draft.suffix, field: draft.field } }, text, attached);
      if (!id) { setFailed(true); return false; }
      setDraft(null);
      return true;
    } finally {
      setSending(false);
    }
  }, [draft, field, sending, canWrite, sendAt, controller.attach]);

  const { selectThread, revealThread } = controller;
  const open = useCallback((thread: CommentThread, from: PassageOpenedFrom) => {
    openedFrom.current = from;
    if (from === 'passage' || from === 'link') revealThread(thread); else selectThread(thread);
  }, [selectThread, revealThread]);
  const openKey = useCallback((rootKey: string, from: PassageOpenedFrom) => {
    const thread = controller.threads.find(item => item.root.recordKey === rootKey);
    if (thread) open(thread, from);
  }, [controller.threads, open]);

  // A link to one comment: open its thread once it is read.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    // A link the host took away is forgotten, so a later link to the same comment opens it again.
    if (!focusKey) { focused.current = null; return; }
    if (focused.current === focusKey) return;
    const thread = controller.threads.find(item => item.root.recordKey === focusKey
      || item.replies.some(reply => reply.recordKey === focusKey));
    if (!thread) return;
    focused.current = focusKey;
    open(thread, 'link');
  }, [focusKey, controller.threads, open]);

  return {
    controller, fields, field, passageOf: (rootKey: string) => passages.get(rootKey), group, threads, threadsOn, openCount,
    isChanged: (rootKey: string) => placement.changed.has(rootKey),
    draft, draftPin, startDraft, startAnchor, cancelDraft, send, sending, failed, flash, open, openKey, reportFound,
    revealRequest: controller.revealRequest,
  };
}
