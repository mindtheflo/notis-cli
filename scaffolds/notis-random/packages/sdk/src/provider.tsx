'use client';

import React, { createContext, useContext, type Context, type ReactNode } from 'react';
import type { NotisRuntime } from './runtime';

const NOTIS_CONTEXT_SYMBOL = Symbol.for('notis.sdk.runtime_context');

type NotisContextGlobal = typeof globalThis & {
  [NOTIS_CONTEXT_SYMBOL]?: Context<NotisRuntime | null>;
};

function getNotisContext(): Context<NotisRuntime | null> {
  const scope = globalThis as NotisContextGlobal;
  if (!scope[NOTIS_CONTEXT_SYMBOL]) {
    scope[NOTIS_CONTEXT_SYMBOL] = createContext<NotisRuntime | null>(null);
  }
  return scope[NOTIS_CONTEXT_SYMBOL]!;
}

const NotisContext = getNotisContext();

/**
 * Provides the Notis runtime context to all child components. The portal owns
 * the runtime and injects it into the rendered app tree.
 */
export function NotisProvider({ children, runtime }: { children: ReactNode; runtime: NotisRuntime | null }) {
  if (runtime === undefined) {
    throw new Error('NotisProvider requires an explicit runtime prop.');
  }
  return (
    <NotisContext.Provider value={runtime}>
      {children}
    </NotisContext.Provider>
  );
}

/**
 * Returns the raw NotisRuntime or null if not yet available.
 * Prefer the typed hooks (useTool, useNotis, etc.) over this.
 */
export function useNotisRuntime(): NotisRuntime | null {
  return useContext(NotisContext);
}
