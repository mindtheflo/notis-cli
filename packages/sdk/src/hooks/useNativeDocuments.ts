'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { normalizeDocumentRecord } from '../documents';
import type { DocumentRecord, NotisRuntime } from '../runtime';
import type { NativeDelete, NativeInsert, NativeMutationReceipt, NativeQuery, NativeUpdate } from '../nativeData';
import { useQuery, type UseQueryResult } from './useQuery';
import { SdkQueryError } from '../queryErrors';

function actionFor(runtime: NotisRuntime | null, binding: string, operation: 'query' | 'insert' | 'update' | 'delete'): string {
  const descriptor = runtime?.space?.bindings[binding];
  const action = descriptor?.kind === 'database' ? descriptor.operations?.[operation] : undefined;
  if (runtime?.resource?.kind !== 'space' || !runtime.callAction || !action) {
    const diagnostic = `This Space does not expose ${operation} for database binding "${binding}".`;
    if (operation === 'query') throw new SdkQueryError('bindingUnavailable', diagnostic);
    throw new Error(`This Space does not expose ${operation} for that database binding.`);
  }
  return action;
}

/**
 * A declared query adapter, never an account-wide slug or owner lookup.
 *
 * `subscribe: true` follows the binding's live change feed where the host has one (a
 * signed-in Editor of the Space, owner or teammate): `live` is then true and changes made
 * elsewhere (another device, a teammate, an agent, an automation) re-read the rows on their
 * own. Where `live` is false, keep offering a manual reload.
 */
export function useNativeDocuments(binding: string, options: {
  query?: NativeQuery; fetchAll?: boolean; enabled?: boolean; staleTimeMs?: number; subscribe?: boolean;
} = {}): UseQueryResult<{ documents: DocumentRecord[]; schemaRevision: number }> & { documents: DocumentRecord[]; schemaRevision?: number; live: boolean } {
  const runtime = useNotisRuntime();
  const [live, setLive] = useState(false);
  const follow = options.subscribe === true && options.enabled !== false;
  useEffect(() => {
    if (!follow || !runtime?.subscribeDatabase) { setLive(false); return; }
    let cancelled = false;
    // The Space host re-reads every query of the view when the database changes, so the
    // change callback has nothing left to do; the feed is a signal and never carries rows.
    const stop = runtime.subscribeDatabase(binding, () => {}, { onStatusChange: value => { if (!cancelled) setLive(value); } });
    return () => { cancelled = true; setLive(false); stop?.(); };
  }, [runtime, binding, follow]);
  const query = useQuery(['native-documents', binding, options.query ?? {}, Boolean(options.fetchAll)], async () => {
    const action = actionFor(runtime, binding, 'query');
    if (options.query?.mode && !['rows', 'search'].includes(options.query.mode)) throw new Error('Use useActionQuery for counts and aggregates.');
    const rows: unknown[] = [];
    let offset = options.query?.offset ?? 0;
    let revision: number | undefined;
    while (true) {
      const result = await runtime!.callAction!<{ rows: unknown[]; schema_revision: number; has_more: boolean; next_offset: number | null }>(
        action, { request: { ...options.query, offset } }, { readOnly: true, dedupe: true, schemaRevision: revision });
      if (!result || !Array.isArray(result.rows) || !Number.isSafeInteger(result.schema_revision)) throw new SdkQueryError('responseIncomplete', 'Native query must return rows and a safe integer schema_revision.');
      if (revision !== undefined && revision !== result.schema_revision) throw new SdkQueryError('schemaChanged');
      revision = result.schema_revision;
      rows.push(...result.rows);
      if (!options.fetchAll || !result.has_more) break;
      if (typeof result.next_offset !== 'number' || result.next_offset <= offset) throw new SdkQueryError('responseIncomplete', 'Native query pagination did not advance next_offset.');
      offset = result.next_offset;
    }
    return { documents: rows.map(normalizeDocumentRecord), schemaRevision: revision! };
  }, { readOnly: true, enabled: options.enabled, staleTimeMs: options.staleTimeMs });
  return { ...query, documents: query.data?.documents ?? EMPTY_DOCUMENTS, schemaRevision: query.data?.schemaRevision, live };
}

/** Explicit insert/update/trash; update never silently creates a missing row. */
export function useNativeMutation<TOperation extends 'insert' | 'update' | 'delete'>(binding: string, operation: TOperation): {
  mutate: (input: TOperation extends 'insert' ? NativeInsert : TOperation extends 'update' ? NativeUpdate : NativeDelete,
    options: { schemaRevision: number; requestId: string }) => Promise<NativeMutationReceipt>;
  loading: boolean; error: Error | null;
} {
  const runtime = useNotisRuntime();
  const [pending, setPending] = useState(0), [error, setError] = useState<Error | null>(null);
  const mutate = useCallback(async (input: NativeInsert | NativeUpdate | NativeDelete, options: { schemaRevision: number; requestId: string }) => {
    const action = actionFor(runtime, binding, operation);
    setPending((value) => value + 1); setError(null);
    try { return await runtime!.callAction!<NativeMutationReceipt>(action, { request: input }, options); }
    catch (cause) { const failure = cause instanceof Error ? cause : new Error(String(cause)); setError(failure); throw failure; }
    finally { setPending((value) => value - 1); }
  }, [runtime, binding, operation]);
  return { mutate, loading: pending > 0, error };
}
const EMPTY_DOCUMENTS: DocumentRecord[] = [];
