'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTool } from '@notis/sdk';
import type { RollDocument } from '@/lib/roll-record';
import type { Roll } from '@/lib/rng';
import { formatNumber } from '@/lib/utils';

type QueryRollsArgs = {
  database_slug: 'rolls';
  query?: {
    page_size?: number;
  };
  offset?: number;
};

type QueryRollsResult = {
  documents?: RollDocument[];
  has_more?: boolean;
  next_offset?: number | null;
  message?: string;
  error?: string;
};

type UpsertRollArgs = {
  title: string;
  Value: number;
  Mode: Roll['mode'];
  Min: number;
  Max: number;
  'Rolled At': string;
};

type UpsertRollResult = {
  status?: string;
  document?: RollDocument;
  message?: string;
  error?: string;
};

export function useRollDocuments(pageSize = 20, fetchAll = false) {
  const queryRolls = useTool<QueryRollsArgs, QueryRollsResult>('LOCAL_NOTIS_DATABASE_QUERY');
  const [documents, setDocuments] = useState<RollDocument[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => {
    setFetchKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const fetchRolls = async (): Promise<RollDocument[]> => {
      const allDocuments: RollDocument[] = [];
      let offset = 0;
      while (true) {
        const result = await queryRolls.call({
          database_slug: 'rolls',
          query: { page_size: pageSize },
          ...(offset > 0 ? { offset } : {}),
        });
        const message = result.error ?? result.message;
        if (message && !result.documents) {
          throw new Error(message);
        }
        allDocuments.push(...(result.documents ?? []));
        if (!fetchAll || !result.has_more) return allDocuments;
        if (typeof result.next_offset !== 'number' || result.next_offset <= offset) {
          throw new Error('Roll history returned an invalid pagination offset.');
        }
        offset = result.next_offset;
      }
    };

    fetchRolls()
      .then((result) => {
        if (cancelled) return;
        setDocuments(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setDocuments([]);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchAll, fetchKey, pageSize, queryRolls.call]);

  return {
    documents,
    loading: queryRolls.loading,
    error: queryRolls.error ?? error,
    refetch,
  };
}

export function usePersistRoll() {
  const upsertRoll = useTool<UpsertRollArgs, UpsertRollResult>('LOCAL_NOTIS_DATABASE_UPSERT_ROLLS');

  const persist = useCallback(
    async (roll: Roll) => {
      const result = await upsertRoll.call({
        title: formatNumber(roll.value),
        Value: roll.value,
        Mode: roll.mode,
        Min: roll.min,
        Max: roll.max,
        'Rolled At': roll.at,
      });
      const message = result.error ?? result.message;
      if (message && result.status === 'error') {
        throw new Error(message);
      }
      return result.document ?? null;
    },
    [upsertRoll.call],
  );

  return {
    persist,
    loading: upsertRoll.loading,
    error: upsertRoll.error,
  };
}
