import type { NotisRuntime } from '@notis/sdk';

interface MockDoc {
  id: string;
  title: string;
  properties: Record<string, unknown>;
  icon?: string | null;
  databaseSlug?: string;
  createdAt?: string | null;
  lastEditedTime?: string | null;
  contentBlocknote?: Array<Record<string, unknown>> | null;
  contentMarkdown?: string | null;
  plainText?: string | null;
}

const STATE: Record<string, MockDoc[]> = { rolls: [] };

declare global {
  interface Window {
    __NOTIS_RANDOM_RUNTIME__?: NotisRuntime;
  }
}

export function installMockRuntime(initialRoute: 'home' | 'history' = 'home'): NotisRuntime {
  const runtime: NotisRuntime = {
    app: {
      id: 'dev-notis-random',
      name: 'Random Number Generator',
      icon: 'phosphor:dice-five',
      description: 'Dev preview — data is in-memory only.',
    },
    route: currentRoute(initialRoute),
    databases: [],
    context: {},

    listTools: async () => [
      {
        name: 'LOCAL_NOTIS_DATABASE_QUERY',
        inputSchema: { type: 'object', properties: { database_slug: { type: 'string' } } },
      },
      {
        name: 'LOCAL_NOTIS_DATABASE_UPSERT_ROLLS',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    callTool: async <TResult = unknown>(name: string, args?: Record<string, unknown>): Promise<TResult> => {
      if (name === 'LOCAL_NOTIS_DATABASE_QUERY') {
        const request = args ?? {};
        const databaseSlug = typeof request.database_slug === 'string' ? request.database_slug : 'rolls';
        const query = request.query && typeof request.query === 'object'
          ? request.query as Record<string, unknown>
          : {};
        const offset = typeof request.offset === 'number' ? request.offset : 0;
        const all = STATE[databaseSlug] ?? [];
        const sliced = all.slice(offset);
        const pageSize = typeof query.page_size === 'number' ? query.page_size : undefined;
        return { documents: typeof pageSize === 'number' ? sliced.slice(0, pageSize) : sliced } as TResult;
      }

      if (name === 'LOCAL_NOTIS_DATABASE_UPSERT_ROLLS') {
        const request = args ?? {};
        const docs = STATE.rolls ?? [];
        const now = new Date().toISOString();
        const documentId = typeof request.document_id === 'string' ? request.document_id : undefined;
        const existing = documentId ? docs.find((d) => d.id === documentId) : undefined;
        const controlKeys = new Set(['document_id', 'title']);
        const properties = Object.fromEntries(
          Object.entries(request).filter(([key]) => !controlKeys.has(key)),
        );
        const doc: MockDoc = {
          id: existing?.id ?? `dev-rolls-${Date.now()}`,
          title: typeof request.title === 'string' ? request.title : existing?.title ?? 'Untitled',
          properties: { ...(existing?.properties ?? {}), ...properties },
          databaseSlug: 'rolls',
          icon: null,
          createdAt: existing?.createdAt ?? now,
          lastEditedTime: now,
        };
        if (existing) docs[docs.indexOf(existing)] = doc;
        else docs.unshift(doc);
        STATE.rolls = docs;
        return { status: 'success', document: doc } as TResult;
      }

      throw new Error(`Tool calls unavailable in dev preview (${name}).`);
    },

    request: async () => {
      throw new Error('Backend requests unavailable in dev preview.');
    },
  };

  window.__NOTIS_RANDOM_RUNTIME__ = runtime;
  return runtime;
}

export function setMockRoute(route: 'home' | 'history') {
  if (window.__NOTIS_RANDOM_RUNTIME__) {
    window.__NOTIS_RANDOM_RUNTIME__.route = currentRoute(route);
  }
}

function currentRoute(route: 'home' | 'history') {
  if (route === 'history') {
    return {
      slug: 'history',
      path: '/history',
      name: 'History',
      icon: null,
      parentSlug: null,
      default: false,
      collection: {
        database: 'rolls',
        titleProperty: 'Value',
        parentProperty: null,
        sidebar: { mode: 'flat-list' as const, allowCreate: false },
      },
    };
  }
  return {
    slug: 'home',
    path: '/',
    name: 'Generator',
    icon: 'phosphor:sparkle',
    parentSlug: null,
    default: true,
    collection: null,
  };
}
