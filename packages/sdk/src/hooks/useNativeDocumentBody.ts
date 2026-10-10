'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { useQuery } from './useQuery';
import { SpaceActionError, spaceQueryKey, type SpaceDocumentBodyRead, type SpaceDocumentBodySave } from '../space';

/** Explicit textarea Save. The source owns the draft and retains its request ID
 * until a receipt or unchanged result; background reads never replace that draft. */
export function useNativeDocumentBody(binding: string, recordKey: string | null, options: {
  readAction: string; writeAction?: string; enabled?: boolean;
}) {
  const runtime = useNotisRuntime();
  const scope = JSON.stringify(spaceQueryKey(runtime, ['native-body', binding, recordKey, options.readAction, options.writeAction]));
  const currentScope = useRef<string | null>(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => { currentScope.current = null; };
  }, [scope]);
  const [state, setState] = useState<{ scope: string; pending: number; error: Error | null }>({ scope, pending: 0, error: null });
  const query = useQuery<SpaceDocumentBodyRead>(['native-body', binding, recordKey, options.readAction], async () => {
    if (!recordKey || runtime?.resource?.kind !== 'space' || !runtime.documentBody) throw new Error('Open a Space document first.');
    const result = await runtime.documentBody({ operation: 'read', binding, recordKey, readAction: options.readAction });
    if (!('content_markdown' in result)) throw new Error('The document response is incomplete.');
    return result;
  }, { readOnly: true, enabled: Boolean(recordKey) && options.enabled !== false });
  const save = useCallback(async (draft: {
    contentMarkdown: string; expectedRevision: number; schemaRevision: number; requestId: string;
  }): Promise<SpaceDocumentBodySave> => {
    if (!recordKey || !options.writeAction || runtime?.resource?.kind !== 'space' || !runtime.documentBody) {
      throw new Error('This Space does not expose a body-edit action.');
    }
    setState(previous => ({ scope, pending: (previous.scope === scope ? previous.pending : 0) + 1, error: null }));
    try {
      const result = await runtime.documentBody({ operation: 'save', binding, recordKey,
        readAction: options.readAction, writeAction: options.writeAction, ...draft });
      if (currentScope.current !== scope) throw new SpaceActionError('This document view changed. Keep the original save request.', draft.requestId);
      if (!('status' in result)) throw new Error('The document save receipt is incomplete.');
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (currentScope.current === scope) setState(previous => ({ ...previous, error }));
      throw error;
    } finally {
      if (currentScope.current === scope) setState(previous => ({ ...previous, pending: Math.max(0, previous.pending - 1) }));
    }
  }, [runtime, binding, recordKey, options.readAction, options.writeAction, scope]);
  return { ...query, body: query.data, save, saving: state.scope === scope && state.pending > 0,
    saveError: state.scope === scope ? state.error : null };
}
