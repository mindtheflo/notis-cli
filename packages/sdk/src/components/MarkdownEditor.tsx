import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import type { NotisMarkdownEditorProps } from '../runtime';

function MarkdownEditorFallback({
  value,
  revision,
  readOnly,
  autosaveMs = 1500,
  placeholder = 'Write in Markdown…',
  className,
  onChange,
  onSave,
  onDirtyChange,
  onSavingChange,
}: NotisMarkdownEditorProps) {
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
      placeholder={placeholder}
      className={className}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      style={{ minHeight: 360, width: '100%', resize: 'vertical' }}
    />
  );
}

/** Use Notis' editor while leaving persistence entirely under app control. */
export function MarkdownEditor(props: NotisMarkdownEditorProps): ReactElement {
  const runtime = useNotisRuntime();
  const HostEditor = runtime?.ui?.MarkdownEditor;
  return HostEditor
    ? <HostEditor key={props.resourceKey} {...props} />
    : <MarkdownEditorFallback key={props.resourceKey} {...props} />;
}
