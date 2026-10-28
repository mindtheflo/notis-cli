'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { normalizeDocumentRecord } from '../documents';
import type { DocumentRecord, NotisRuntime } from '../runtime';
import type { NativeDelete, NativeInsert, NativeMutationReceipt, NativeQuery, NativeUpdate } from '../nativeData';
import { insertChange, tempRecordKey, updateChange } from '../optimisticRows';
import { useQuery, type UseQueryResult } from './useQuery';
import { SdkQueryError } from '../queryErrors';
import { NATIVE_ROWS } from '../queryCache';

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
  const locale = runtime?.context?.locale === 'fr' ? 'fr' : 'en';
  const query = useQuery<{ documents: DocumentRecord[]; schemaRevision: number }>(['native-documents', binding, options.query ?? {}, Boolean(options.fetchAll), locale], async (publish) => {
    const action = actionFor(runtime, binding, 'query');
    if (options.query?.mode && !['rows', 'search'].includes(options.query.mode)) throw new Error('Use useActionQuery for counts and aggregates.');
    const rows: unknown[] = [];
    let offset = options.query?.offset ?? 0;
    let revision: number | undefined;
    const answerOf = (list: unknown[]) => {
      const answer = { documents: list.map((row) => normalizeDocumentRecord(row, { locale })), schemaRevision: revision! };
      // The flattened documents drop property types and option ids; writes shown at once need them.
      Object.defineProperty(answer, NATIVE_ROWS, { value: list, enumerable: false });
      return answer;
    };
    while (true) {
      const result = await runtime!.callAction!<{ rows: unknown[]; schema_revision: number; has_more: boolean; next_offset: number | null }>(
        action, { request: { ...options.query, offset } }, { readOnly: true, dedupe: true, schemaRevision: revision });
      if (!result || !Array.isArray(result.rows) || !Number.isSafeInteger(result.schema_revision)) throw new SdkQueryError('responseIncomplete', 'Native query must return rows and a safe integer schema_revision.');
      if (revision !== undefined && revision !== result.schema_revision) throw new SdkQueryError('schemaChanged');
      const first = revision === undefined;
      revision = result.schema_revision;
      rows.push(...result.rows);
      if (!options.fetchAll || !result.has_more) break;
      if (typeof result.next_offset !== 'number' || result.next_offset <= offset) throw new SdkQueryError('responseIncomplete', 'Native query pagination did not advance next_offset.');
      // Every page is asked for: the first one shows at once (still fetching) while the next ones load.
      if (first) publish?.(answerOf(rows.slice()));
      offset = result.next_offset;
    }
    return answerOf(rows);
  }, { readOnly: true, enabled: options.enabled, staleTimeMs: options.staleTimeMs,
    rows: { binding, at: 'documents', shape: 'document', query: options.query ?? {} } });
  return { ...query, documents: query.data?.documents ?? EMPTY_DOCUMENTS, schemaRevision: query.data?.schemaRevision, live };
}

/** Options of one native write. */
export interface NativeMutationOptions {
  schemaRevision: number;
  requestId: string;
  /**
   * Inserts: the Space `shows` lists the new row shows in before the server answers (their filters stay on the
   * server). By default the view's only list over this database, if it has exactly one.
   */
  showIn?: string | readonly string[];
  /** One step of a batch that refreshes the lists itself at the end. */
  deferRefresh?: boolean;
}

/**
 * Explicit insert/update/trash; update never silently creates a missing row.
 *
 * The write shows in every cached read of the database at once: an edited row changes where it is (and moves to its
 * sorted place, or leaves a read whose filter the page sent and no longer keeps it), a new row joins the reads whose
 * filter it passes and the `showIn` lists, a trashed row leaves. A failed write puts the server's rows back.
 */
export function useNativeMutation<TOperation extends 'insert' | 'update' | 'delete'>(binding: string, operation: TOperation): {
  mutate: (input: TOperation extends 'insert' ? NativeInsert : TOperation extends 'update' ? NativeUpdate : NativeDelete,
    options: NativeMutationOptions) => Promise<NativeMutationReceipt>;
  loading: boolean; error: Error | null;
} {
  const runtime = useNotisRuntime();
  const [pending, setPending] = useState(0), [error, setError] = useState<Error | null>(null);
  const mutate = useCallback(async (input: NativeInsert | NativeUpdate | NativeDelete, options: NativeMutationOptions) => {
    const action = actionFor(runtime, binding, operation);
    setPending((value) => value + 1); setError(null);
    const client = runtime?.queryClient;
    // A trashed row leaves every cached read at once and comes back if the write fails.
    const key = operation === 'delete' && typeof (input as NativeDelete).record_key === 'string' ? (input as NativeDelete).record_key : null;
    const hidden = key ? client?.hideRecords?.([key]) : undefined;
    const shown = operation === 'update' && typeof (input as NativeUpdate).record_key === 'string'
      ? client?.optimistic?.([updateChange(binding, input as NativeUpdate)])
      : operation === 'insert' ? client?.optimistic?.([insertChange(binding, input as NativeInsert, tempRecordKey(), showInLists(runtime, binding, options.showIn))])
        : undefined;
    const { showIn: _showIn, ...callOptions } = options;
    try {
      // A shown write refreshes the lists itself, after it is confirmed: every read of that refresh then holds it,
      // so none can keep the change on top of rows the server already answered without it.
      const receipt = await runtime!.callAction!<NativeMutationReceipt>(action, { request: input },
        shown ? { ...callOptions, deferRefresh: true } : callOptions);
      hidden?.commit();
      shown?.commit(receipt && typeof receipt.record_key === 'string'
        ? { recordKey: receipt.record_key, id: receipt.id, revision: receipt.revision } : undefined);
      if (shown && !callOptions.deferRefresh) client?.invalidate();
      return receipt;
    } catch (cause) {
      hidden?.restore();
      shown?.rollback();
      // The write may still have landed (an unknown outcome): read the server's rows again.
      if (shown) client?.invalidate();
      const failure = cause instanceof Error ? cause : new Error(String(cause)); setError(failure); throw failure;
    } finally { setPending((value) => value - 1); }
  }, [runtime, binding, operation]);
  return { mutate, loading: pending > 0, error };
}

/** The `shows` lists a new row of `binding` shows in: the ones named, else the view's only list over it. */
function showInLists(runtime: NotisRuntime | null, binding: string, showIn: NativeMutationOptions['showIn']): string[] {
  if (showIn !== undefined) return typeof showIn === 'string' ? [showIn] : [...showIn];
  const lists = Object.entries(runtime?.space?.shows ?? {}).filter(([, list]) => 'database' in list && list.database === binding);
  return lists.length === 1 ? [lists[0]![0]] : [];
}

export interface NativeDeleteManyResult {
  done: NativeDelete[];
  failed: Array<{ input: NativeDelete; error: Error }>;
}

/**
 * Trashes many rows of one database binding: every row leaves the cached reads at once, the writes run a few at
 * a time (each with its own request ID, `${requestId}:${record_key}`, so a retry with the same `requestId` replays
 * instead of trashing twice), the reads refresh once at the end, and a row whose write failed comes back. It never
 * throws for a failed row: `failed` lists them.
 */
export function useNativeDelete(binding: string): {
  deleteMany: (inputs: readonly NativeDelete[], options: { schemaRevision: number; requestId: string }) => Promise<NativeDeleteManyResult>;
  loading: boolean; error: Error | null;
} {
  const runtime = useNotisRuntime();
  const [pending, setPending] = useState(0), [error, setError] = useState<Error | null>(null);
  const deleteMany = useCallback(async (inputs: readonly NativeDelete[], options: { schemaRevision: number; requestId: string }) => {
    const action = actionFor(runtime, binding, 'delete');
    const result: NativeDeleteManyResult = { done: [], failed: [] };
    if (!inputs.length) return result;
    setPending((value) => value + 1); setError(null);
    const hidden = runtime?.queryClient?.hideRecords?.(inputs.map((input) => input.record_key));
    let next = 0;
    const worker = async () => {
      while (next < inputs.length) {
        const input = inputs[next++];
        try {
          await runtime!.callAction!<NativeMutationReceipt>(action, { request: input },
            { schemaRevision: options.schemaRevision, requestId: `${options.requestId}:${input.record_key}`, deferRefresh: true });
          result.done.push(input);
        } catch (cause) {
          result.failed.push({ input, error: cause instanceof Error ? cause : new Error(String(cause)) });
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, inputs.length) }, worker));
    } finally {
      hidden?.commit(result.done.map((input) => input.record_key));
      hidden?.restore(result.failed.map((item) => item.input.record_key));
      runtime?.queryClient?.invalidate();
      if (result.failed.length) setError(result.failed[0].error);
      setPending((value) => value - 1);
    }
    return result;
  }, [runtime, binding]);
  return { deleteMany, loading: pending > 0, error };
}
const DELETE_CONCURRENCY = 4;
const EMPTY_DOCUMENTS: DocumentRecord[] = [];
