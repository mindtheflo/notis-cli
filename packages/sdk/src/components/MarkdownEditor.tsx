import type { ChangeEvent, CSSProperties, KeyboardEvent, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import type { NotisMarkdownEditorProps } from '../runtime';
import { pick, type Words } from '../words/types';

/** The words of the fallback Markdown editor, in English and French (C9). */
export const MARKDOWN_EDITOR_WORDS = Object.freeze({
  placeholder: { en: 'Write in Markdown', fr: 'Écris en Markdown' },
}) satisfies Readonly<Record<string, Words>>;

const editableStyle: CSSProperties = {
  minHeight: 360, width: '100%', resize: 'vertical', boxSizing: 'border-box', padding: '12px 16px', borderRadius: 8,
  border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))',
  font: 'inherit', fontSize: 14, lineHeight: '22px',
};

// Read-only reads as text, not a field (C9): no border, no resize, no caret, a muted tint.
const readOnlyStyle: CSSProperties = {
  ...editableStyle, resize: 'none', border: '1px solid transparent', background: 'hsl(var(--muted) / .4)',
  cursor: 'default', outline: 'none',
};

/** What `useMarkdownEditorDraft` gives an editor: the text to show, and what to call on a change or a save key. */
export interface MarkdownEditorDraft {
  draft: string;
  /** The editor's text changed (typed, pasted, a block edited). */
  change: (markdown: string) => void;
  /** Saves now (Cmd-S), when there is something to save. */
  save: () => Promise<void>;
}

/**
 * The editing state every MarkdownEditor shares, the host's and the fallback's: takes a new `value` while nothing
 * is typed, autosaves `autosaveMs` after the last change through `onSave` (with the revision it opened or last
 * saved), saves again when typing went on during a save, and saves what is left when the editor goes away.
 */
export function useMarkdownEditorDraft({
  value,
  revision,
  readOnly,
  autosaveMs = 1500,
  onChange,
  onSave,
  onDirtyChange,
  onSavingChange,
}: NotisMarkdownEditorProps): MarkdownEditorDraft {
  const [draft, setDraft] = useState(value);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const draftRef = useRef(value);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const revisionRef = useRef(revision);
  const onSaveRef = useRef(onSave);
  const readOnlyRef = useRef(readOnly);
  const unmountedRef = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    onSaveRef.current = onSave;
    readOnlyRef.current = readOnly;
  }, [onSave, readOnly]);

  useEffect(() => {
    if (dirtyRef.current) return;
    draftRef.current = value;
    revisionRef.current = revision;
    setDraft(value);
  }, [revision, value]);

  const save = useCallback(async () => {
    if (!onSave || !dirtyRef.current || readOnly || savingRef.current) return;
    const markdown = draftRef.current;
    savingRef.current = true;
    if (!unmountedRef.current) onSavingChange?.(true);
    try {
      const result = await onSave({ markdown, expectedRevision: revisionRef.current });
      if (result?.revision) revisionRef.current = result.revision;
      if (draftRef.current === markdown) {
        dirtyRef.current = false;
        if (!unmountedRef.current) onDirtyChange?.(false);
      }
    } finally {
      savingRef.current = false;
      if (!unmountedRef.current) onSavingChange?.(false);
      if (dirtyRef.current && draftRef.current !== markdown) {
        if (unmountedRef.current) {
          void saveRef.current().catch((error) => console.error('Could not save Markdown on unmount', error));
        } else {
          setSaveAttempt((attempt) => attempt + 1);
        }
      }
    }
  }, [onDirtyChange, onSave, onSavingChange, readOnly]);
  saveRef.current = save;

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (!savingRef.current) {
        void saveRef.current().catch((error) => console.error('Could not save Markdown on unmount', error));
      }
    };
  }, []);

  useEffect(() => {
    if (!dirtyRef.current || !onSave || readOnly) return;
    const timer = window.setTimeout(() => void save(), Math.max(250, autosaveMs));
    return () => window.clearTimeout(timer);
  }, [autosaveMs, draft, onSave, readOnly, save, saveAttempt]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const change = useCallback((next: string) => {
    if (next === draftRef.current) return;
    draftRef.current = next;
    setDraft(next);
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      onDirtyChangeRef.current?.(true);
    }
    onChangeRef.current?.(next);
  }, []);

  return { draft, change, save };
}

/** The plain EN/FR textarea for a draft: the fallback outside Notis, and the host's when its editor cannot open. */
export function MarkdownTextArea({ state, readOnly, placeholder, className }: {
  state: MarkdownEditorDraft;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const locale = useNotisRuntime()?.context?.locale === 'fr' ? 'fr' : 'en';
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void state.save();
    }
  };
  return (
    <textarea
      value={state.draft}
      readOnly={readOnly}
      aria-readonly={readOnly || undefined}
      data-readonly={readOnly ? '' : undefined}
      placeholder={readOnly ? undefined : placeholder ?? pick(MARKDOWN_EDITOR_WORDS.placeholder, locale)}
      className={className}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => state.change(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      style={readOnly ? readOnlyStyle : editableStyle}
    />
  );
}

function MarkdownEditorFallback(props: NotisMarkdownEditorProps) {
  const state = useMarkdownEditorDraft(props);
  return <MarkdownTextArea state={state} readOnly={props.readOnly} placeholder={props.placeholder} className={props.className} />;
}

/** Use Notis' editor while leaving persistence entirely under app control; outside Notis a plain EN/FR textarea stands in. */
export function MarkdownEditor(props: NotisMarkdownEditorProps): ReactElement {
  const runtime = useNotisRuntime();
  const HostEditor = runtime?.ui?.MarkdownEditor;
  return HostEditor
    ? <HostEditor key={props.resourceKey} {...props} />
    : <MarkdownEditorFallback key={props.resourceKey} {...props} />;
}
