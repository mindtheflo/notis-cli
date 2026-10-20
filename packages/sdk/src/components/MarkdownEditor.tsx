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

function MarkdownEditorFallback({
  value,
  revision,
  readOnly,
  autosaveMs = 1500,
  placeholder,
  className,
  onChange,
  onSave,
  onDirtyChange,
  onSavingChange,
}: NotisMarkdownEditorProps) {
  const locale = useNotisRuntime()?.context?.locale === 'fr' ? 'fr' : 'en';
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

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.currentTarget.value;
    draftRef.current = next;
    setDraft(next);
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      onDirtyChange?.(true);
    }
    onChange?.(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  return (
    <textarea
      value={draft}
      readOnly={readOnly}
      aria-readonly={readOnly || undefined}
      data-readonly={readOnly ? '' : undefined}
      placeholder={readOnly ? undefined : placeholder ?? pick(MARKDOWN_EDITOR_WORDS.placeholder, locale)}
      className={className}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      style={readOnly ? readOnlyStyle : editableStyle}
    />
  );
}

/** Use Notis' editor while leaving persistence entirely under app control; outside Notis a plain EN/FR textarea stands in. */
export function MarkdownEditor(props: NotisMarkdownEditorProps): ReactElement {
  const runtime = useNotisRuntime();
  const HostEditor = runtime?.ui?.MarkdownEditor;
  return HostEditor
    ? <HostEditor key={props.resourceKey} {...props} />
    : <MarkdownEditorFallback key={props.resourceKey} {...props} />;
}
