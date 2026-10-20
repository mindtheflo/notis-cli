/** Row state (toolkit spec 2.3, 2.5): what a row needs to draw its cursor, open and selected looks. */

import { createContext, useContext, type ReactNode } from 'react';

export interface RowState {
  cursor: boolean;
  open: boolean;
  selected: boolean;
  /** Something in the list is selected (rows show their checkbox). */
  anySelected: boolean;
  index: number;
}

export const IDLE_ROW_STATE: RowState = Object.freeze({ cursor: false, open: false, selected: false, anySelected: false, index: -1 });

export interface RowStateSource {
  stateOf(id: string): RowState;
  /** Toggle the row in the selection (the lead checkbox); null when the list is not selectable. */
  toggle: ((id: string) => void) | null;
  /** The row-more button content; null when the list has no actions. */
  more: ((id: string) => ReactNode) | null;
}

export const RowStateContext = createContext<RowStateSource | null>(null);
export const RowIdContext = createContext<string | null>(null);

/** The state of row `id` inside a ListReader (or a list that provides RowStateContext). */
export function useRowState(id?: string): RowState {
  const source = useContext(RowStateContext);
  const contextId = useContext(RowIdContext);
  const rowId = id ?? contextId;
  if (!source || rowId === null) return IDLE_ROW_STATE;
  return source.stateOf(rowId);
}
