'use client';
import { useMemo } from 'react';
import { useNotisRuntime } from '../provider';
import type { AgentContextItem } from '../agentContext';

/** Share context without owning storage, opening a new thread, or sending a message. */
export function useAgentContext() {
  const runtime = useNotisRuntime();
  return useMemo(() => ({
    add(item: AgentContextItem): Promise<boolean> {
      if (!runtime?.addContext) return Promise.reject(new Error('Chat context is unavailable in this host.'));
      return runtime.addContext(item);
    },
    update(item: AgentContextItem): Promise<boolean> {
      if (!runtime?.updateContext) return Promise.reject(new Error('Chat context is unavailable in this host.'));
      return runtime.updateContext(item);
    },
    remove(id: string): Promise<boolean> {
      if (!runtime?.removeContext) return Promise.reject(new Error('Chat context is unavailable in this host.'));
      return runtime.removeContext(id);
    },
  }), [runtime]);
}
