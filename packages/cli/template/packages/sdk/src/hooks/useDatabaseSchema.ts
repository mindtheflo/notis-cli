'use client';

import { useCallback, useEffect, useState } from 'react';
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
  error: Error | null;
  refetch: () => void;
}

/** Fetch a database's schema (normalized properties + metadata). */
export function useDatabaseSchema(databaseSlug: string): UseDatabaseSchemaResult {
  const runtime = useNotisRuntime();
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [properties, setProperties] = useState<DatabaseProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => {
    setFetchKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!runtime) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    runtime
      .callTool<GetDatabaseResult>('LOCAL_NOTIS_DATABASE_GET_DATABASE', {
        database_slug: databaseSlug,
      })
      .then((result) => {
        if (cancelled) return;
        const message = result.error ?? result.message;
        if (!result.database && message) {
          throw new Error(message);
        }
        setName(optionalString(result.database?.name));
        setDescription(optionalString(result.database?.description));
        const rawProperties = result.database?.schema?.properties ?? [];
        setProperties(
          rawProperties
            .map(normalizeDatabaseProperty)
            .filter((property): property is DatabaseProperty => Boolean(property)),
        );
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runtime, databaseSlug, fetchKey]);

  return { name, description, properties, loading, error, refetch };
}
