import type { ReactNode } from 'react';

export type CollectionActionIntent =
  | 'archive' | 'star' | 'delete'
  | 'enable' | 'disable' | 'pause' | 'resume'
  | 'move' | 'add-to-folder' | 'complete' | 'start-progress'
  | 'custom';

export interface CollectionActionContext<T> {
  selectedIds: string[];
  selectedItems: T[];
  clearSelection: () => void;
}

export interface CollectionAction<T> {
  id: string;
  intent?: CollectionActionIntent;
  label?: string;
  icon?: ReactNode;
  /** Omit to use the intent default, supply a key to override, or false to remove it. */
  shortcut?: string | false;
  destructive?: boolean;
  disabled?: boolean | ((context: CollectionActionContext<T>) => boolean);
  pending?: boolean;
  onRun: (context: CollectionActionContext<T>) => void | Promise<void>;
}

export interface ResolvedCollectionAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onRun: () => void | Promise<void>;
}

const ACTION_DEFAULTS: Record<Exclude<CollectionActionIntent, 'custom'>, { label: string; shortcut: string }> = {
  archive: { label: 'Archive', shortcut: 'E' },
  star: { label: 'Star', shortcut: 'S' },
  delete: { label: 'Delete', shortcut: '#' },
  enable: { label: 'Enable', shortcut: 'E' },
  disable: { label: 'Disable', shortcut: 'D' },
  pause: { label: 'Pause', shortcut: 'P' },
  resume: { label: 'Resume', shortcut: 'R' },
  move: { label: 'Move', shortcut: 'M' },
  'add-to-folder': { label: 'Add to folder', shortcut: 'F' },
  complete: { label: 'Mark complete', shortcut: 'C' },
  'start-progress': { label: 'Start progress', shortcut: 'P' },
};

export function collectionActionDefaults(intent: CollectionActionIntent | undefined): {
  label?: string;
  shortcut?: string;
} {
  if (!intent || intent === 'custom') return {};
  return ACTION_DEFAULTS[intent];
}
