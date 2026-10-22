/**
 * BoardView (toolkit spec 2.3, board layout): a Kanban board, one column per stage, built on ListReader so the reader,
 * open modes, `openParam`, selection, the selection bar and actions behave exactly as in a list.
 *
 * - Columns sit side by side (gap 12, padding 12) and each scrolls on its own; the board scrolls sideways. On a phone
 *   each column takes about 85% of the width and snaps into place.
 * - Tiles are ListReader tiles (`renderTile`): a ring on all four sides, never a coloured edge or a shadow.
 * - Arrows move the cursor: Up/Down (and J/K) within a column, Left/Right to the nearest column with tiles. Enter or
 *   a click opens the tile in the reader beside the board, or as a slide when there is no room. Esc closes it. With
 *   nothing open the board runs full width, and nothing opens or closes on its own when the width changes.
 * - Selection: X, Shift+Up/Down, Mod+A, Mod-click and Shift-click; the selection bar floats as a pill.
 * - Moving (with `onMove`): drag a tile or the selection to a column (a line shows where it lands), Shift+Left/Right
 *   to the next column, or M (Move to) and pick a column. The page moves the items (optimistically, if it likes); the
 *   cursor stays on the moved tile.
 */

import type { ReactNode } from 'react';
import type { Words } from '../../words';
import { ListReader, type ListReaderProps, type TileParts } from '../list/ListReader';
import type { BoardColumn, BoardMoveHandler } from './boardModel';

/** The props of `BoardView`: ListReader's, with the board's columns instead of rows and groups. */
export interface BoardViewProps<T> extends Omit<ListReaderProps<T>,
  'row' | 'layout' | 'renderTile' | 'columns' | 'groupBy' | 'collapsible' | 'collapsed' | 'onCollapsedChange'
  | 'tileVariant' | 'autoOpen' | 'hasMore' | 'onLoadMore' | 'loadingMore' | 'empty' | 'density' | 'board'> {
  /** The stages, left to right. A `tone` adds a small dot before the label. */
  columns: readonly BoardColumn[];
  /** The id of the column an item sits in. An item whose column is not listed is not shown. */
  getColumn(item: T): string;
  /** One tile: title, subtitle, body, figure, trailing (and a mark). */
  renderTile(item: T): TileParts;
  /**
   * Moves tiles to `toColumnId`: drag and drop (with `index`, the place among the tiles that stay in that column),
   * Shift+Left/Right and the M (Move to) menu (without). Return an UndoFn for Undo in the toast. Leave out for a board
   * that only reads.
   */
  onMove?: BoardMoveHandler;
  /** Shown in a column with no tiles. Default "No items" / "Aucun élément". */
  emptyColumn?: Words | string;
}

const noRow = (): ReactNode => null;

export function BoardView<T>({ columns, getColumn, renderTile, onMove, emptyColumn, ...rest }: BoardViewProps<T>) {
  return (
    <ListReader<T> {...rest} layout="board" row={noRow} renderTile={renderTile}
      board={{ columns, getColumn, onMove, emptyColumn }} />
  );
}
