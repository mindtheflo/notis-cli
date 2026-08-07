'use client';

import { useNotisRuntime } from '../provider';
import type { AppDescriptor, CollectionItemDetail, DatabaseDescriptor, RouteDescriptor } from '../runtime';

interface NotisContext {
  /** App metadata (id, name, icon, description). Null before runtime loads. */
  app: AppDescriptor | null;
  /** Current route descriptor. Null before runtime loads. */
  route: RouteDescriptor | null;
  /** Databases declared by this app. Empty before runtime loads. */
  databases: DatabaseDescriptor[];
  /** Selected collection item for the current route, when applicable. */
  collectionItem: CollectionItemDetail | null;
  /** Whether the runtime is loaded and available. */
  ready: boolean;
}

/**
 * Access app-level metadata, the current route, declared databases, and the
 * selected collection item. Returns safe defaults when the portal runtime is
 * not available.
 */
export function useNotis(): NotisContext {
  const runtime = useNotisRuntime();

  return {
    app: runtime?.app ?? null,
    route: runtime?.route ?? null,
    databases: runtime?.databases ?? [],
    collectionItem: runtime?.context?.collectionItem ?? null,
    ready: runtime !== null,
  };
}
