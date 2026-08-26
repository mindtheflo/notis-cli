import type { CSSProperties, ClipboardEvent, ReactNode } from 'react';
import { useCallback } from 'react';
import { useNotisRuntime } from '../provider';
import type { ContextResource, ContextSelection } from '../runtime';

export const NOTIS_CONTEXT_CLIPBOARD_TYPE = 'application/x-notis-context+json';

export interface NotisSelectionBoundaryProps {
  resource?: ContextResource | null;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function selectionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Adds structured provenance to ordinary copied text. Pasting still works in
 * every app because `text/plain` is preserved; Notis chat additionally reads
 * the custom MIME payload and renders a separate quote pill.
 */
export function NotisSelectionBoundary({
  resource,
  children,
  className,
  style,
}: NotisSelectionBoundaryProps) {
  const runtime = useNotisRuntime();
  const onCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (
      !text
      || !selection
      || !event.currentTarget.contains(selection.anchorNode)
      || !event.currentTarget.contains(selection.focusNode)
    ) return;

    const payload: ContextSelection = {
      id: selectionId(),
      text: text.slice(0, 12_000),
      ...(resource ? { resource: { ...resource, snapshot: undefined } } : {}),
    };
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData(NOTIS_CONTEXT_CLIPBOARD_TYPE, JSON.stringify(payload));
    event.preventDefault();
    runtime?.captureContextSelection?.(payload);
  }, [resource, runtime]);

  return <div className={className} style={style} onCopy={onCopy}>{children}</div>;
}
