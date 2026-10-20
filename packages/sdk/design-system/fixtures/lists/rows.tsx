import type { ReactNode } from 'react';
import { IDLE_ROW_STATE, RowIdContext, RowStateContext, type RowState, type RowStateSource } from '../../../src/ui';

export interface ListRowsProps {
  /** Row ids in list order, each drawn by `row`. */
  ids: readonly string[];
  selected?: readonly string[];
  open?: string | null;
  cursor?: string | null;
  row: (id: string) => ReactNode;
  /** What RowMore and a list row's More slot draw for a row; omit for a list with no actions. */
  more?: (id: string) => ReactNode;
  /** Extra classes on a row element (a specimen draws the pointer-over look with them). */
  rowClassName?: (id: string) => string | undefined;
}

const flag = (on: boolean): '' | undefined => (on ? '' : undefined);

/**
 * Rows as a selectable list draws them, without a ListReader around them. The list owns each row element and its
 * states ("a list that provides RowStateContext", src/ui/list/rowState.ts), so selected rows show their checked box
 * and the others an empty one, as in the Tickets list. A standalone Row given `state.selected` hides its icon and has
 * no box to show instead, which is why the specimens draw selected rows through this.
 */
export function ListRows({ ids, selected = [], open = null, cursor = null, row, more, rowClassName }: ListRowsProps) {
  const stateOf = (id: string): RowState => ({
    ...IDLE_ROW_STATE,
    index: ids.indexOf(id),
    selected: selected.includes(id),
    anySelected: selected.length > 0,
    open: id === open,
    cursor: id === cursor,
  });
  const source: RowStateSource = { stateOf, toggle: () => undefined, more: more ?? null };
  return (
    <div className="flex flex-col" data-has-selection={flag(selected.length > 0)}>
      <RowStateContext.Provider value={source}>
        {ids.map((id) => {
          const state = stateOf(id);
          return (
            <div key={id} className={['nui-row', rowClassName?.(id)].filter(Boolean).join(' ')} data-selected={flag(state.selected)} data-open={flag(state.open)}
              data-cursor={flag(state.cursor)}>
              <RowIdContext.Provider value={id}>{row(id)}</RowIdContext.Provider>
            </div>
          );
        })}
      </RowStateContext.Provider>
    </div>
  );
}
