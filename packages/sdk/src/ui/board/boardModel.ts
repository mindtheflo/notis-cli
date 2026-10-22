/**
 * The board model (toolkit spec 2.3, board layout): its columns, how a ListReader in `layout="board"` is told about
 * them, and the pure helpers the board uses (column order, the neighbour column, the drop index).
 */

import type { ActionRunResult, Words } from '../../words';
import type { Tone } from '../list/Row';

/** One column of a board: a stage. `tone` adds a small dot before its label (never a coloured edge). */
export interface BoardColumn {
  id: string;
  label: Words | string;
  tone?: Tone;
}

/**
 * Where tiles go. `toColumnId` is the column; `index` is the place in that column among the tiles that stay there
 * (0 = first), given by a drop. A keyboard or menu move leaves it out: the tiles join the column wherever the page puts
 * them. The page moves the items (optimistically, if it likes); the board keeps the cursor on the moved tile. Return
 * an UndoFn for Undo in the toast, or `{ failed }` / throw to say it did not work.
 */
export type BoardMoveHandler = (ids: string[], toColumnId: string, index?: number)
  => ActionRunResult | Promise<ActionRunResult>;

/** The board of a ListReader in `layout="board"` (BoardView builds it). */
export interface ListBoard<T> {
  columns: readonly BoardColumn[];
  /** The id of the column an item sits in. An item whose column is not in `columns` is not shown. */
  getColumn(item: T): string;
  /** Moves tiles: drag and drop, Shift+Left/Right and the M (Move to) menu. Leave out for a board that only reads. */
  onMove?: BoardMoveHandler;
  /** Shown in a column with no tiles. Default "No items" / "Aucun élément". */
  emptyColumn?: Words | string;
}

/** Items in board order: column by column (as `columns` lists them), each keeping the order `items` gave. */
export function boardOrder<T>(items: readonly T[], columns: readonly BoardColumn[], getColumn: (item: T) => string): T[] {
  const lanes = new Map<string, T[]>(columns.map((column) => [column.id, []]));
  for (const item of items) lanes.get(getColumn(item))?.push(item);
  return columns.flatMap((column) => lanes.get(column.id)!);
}

/** The column next to `columnId` (`-1` left, `1` right), empty or not; null at the edge or for an unknown column. */
export function neighbourColumn(columns: readonly BoardColumn[], columnId: string, delta: -1 | 1): string | null {
  const index = columns.findIndex((column) => column.id === columnId);
  if (index === -1) return null;
  return columns[index + delta]?.id ?? null;
}

/**
 * Where a drop at `pointerY` lands in a column: the index among `tiles` (the column's tiles in order, the dragged ones
 * left out) of the first tile whose middle is below the pointer, else the end. `before` is that tile's id (null at the
 * end), where the drop line shows.
 */
export function dropIndex(tiles: ReadonlyArray<{ id: string; top: number; height: number }>, pointerY: number):
  { index: number; before: string | null } {
  const index = tiles.findIndex((tile) => tile.top + tile.height / 2 > pointerY);
  if (index === -1) return { index: tiles.length, before: null };
  return { index, before: tiles[index]!.id };
}
