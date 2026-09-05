'use client';

import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import { normalizeDatabaseProperty, optionalString } from '../documents';
import type { DatabaseProperty } from '../runtime';

interface GetDatabaseResult {
  database?: {
    name?: string;
    description?: string | null;
    schema?: {
      properties?: unknown[];
    };
  };
  message?: string;
  error?: string;
}

export interface UseDatabaseSchemaResult {
  name: string | null;
  description: string | null;
  properties: DatabaseProperty[];
  loading: boolean;
  isFetching: boolean;
  hasData: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Fetch a database's schema (normalized properties + metadata). */
export function useDatabaseSchema(databaseSlug: string): UseDatabaseSchemaResult {
  const runtime = useNotisRuntime();
  const query = useQuery(['database-schema', databaseSlug], async () => {
    const result = await runtime!.callTool<GetDatabaseResult>('LOCAL_NOTIS_DATABASE_GET_DATABASE', {
      database_slug: databaseSlug,
    }, { dedupe: true, readOnly: true });
    if (!result.database) throw new Error(result.error || result.message || 'Database not found');
    return {
      name: optionalString(result.database.name),
      description: optionalString(result.database.description),
      properties: (result.database.schema?.properties ?? []).map(normalizeDatabaseProperty)
        .filter((property): property is DatabaseProperty => Boolean(property)),
    };
  }, { readOnly: true });
  return { ...query, name: query.data?.name ?? null, description: query.data?.description ?? null,
    properties: query.data?.properties ?? EMPTY_PROPERTIES };
}
const EMPTY_PROPERTIES: DatabaseProperty[] = [];
