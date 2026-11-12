/**
 * DataTable: a read-only table for a dashboard `Section kind="data"` (machines, threads, jobs), styled like the
 * ChartTable: 40px rows with a hairline above each, a sticky 36px muted header, the edge cells 24px in. Cells never
 * wrap: they truncate. One primary column takes the room left, never under its `minWidth` (default 120 px); the others
 * fit their content or a fixed width, and a column can hide under a container width so a phone never scrolls
 * sideways. When the columns kept still do not fit, the last ones hide on their own, so the primary text is never
 * crushed. A real table, so view Markdown reads it.
 */

import React, { useRef, useState, type ReactNode } from 'react';
import { type Words } from '../../words/types';
import { formatNumber } from '../period/dateFormat';
import { useToolkitLocale } from '../engine/hooks';
import { cx, useIsoLayoutEffect, useStableId, useT } from '../util';
import { EmptyState } from './blocks';

type Text = Words | string;

export interface DataTableColumn<R> {
  /** Stable key of the column. */
  id: string;
  /** The header text. */
  label: Text;
  /** The cell of one row. Text truncates with an ellipsis; it never wraps. */
  cell: (row: R) => ReactNode;
  /** Default 'start'. Use 'end' for numbers. */
  align?: 'start' | 'end';
  /** A fixed width in px (padding included); the cell truncates inside it. */
  width?: number;
  /** Muted 12px monospace (ids, paths, versions); truncates. */
  mono?: boolean;
  /**
   * Takes the room the other columns leave and truncates. Exactly one column should be primary; when none is, the
   * first column is, and when several are, the first of them. It holds the row's press target and never hides. With
   * `onRowPress` its cell sits inside the row's button, so keep it to text and icons: no link, button or InfoTip.
   */
  primary?: boolean;
  /** The column hides while the table is narrower than this many px (its own container width). */
  hideBelow?: number;
  /** On the primary column: the narrowest it gets, in px (padding excluded). Default 120. */
  minWidth?: number;
}

export interface DataTableGroup<R> {
  key: string;
  label: Text;
  rows: readonly R[];
}

export interface DataTableProps<R> {
  columns: readonly DataTableColumn<R>[];
  /** The rows, when the table has no groups. */
  rows?: readonly R[];
  /** Rows under muted group headings (label and count), in this order. A group with no rows is left out. Wins over `rows`. */
  groups?: readonly DataTableGroup<R>[];
  rowKey: (row: R) => string;
  /** Makes rows pressable: a button in the primary cell covers the row and takes Tab focus. */
  onRowPress?: (row: R) => void;
  /** The accessible name of a row's press target. Default the primary cell's text. */
  rowLabel?: (row: R) => string;
  /** The table's accessible name (the Section title, usually). */
  label?: Text;
  /** Shown in place of the rows when there are none. Default an EmptyState. */
  empty?: ReactNode;
  className?: string;
}

/** The hideBelow of a column as a whole px count, or undefined when it never hides. */
function threshold<R>(column: DataTableColumn<R>, primary: boolean): number | undefined {
  const value = column.hideBelow;
  if (primary || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

/** Columns hidden because they did not fit, with the first and last columns still shown (they take the edge insets). */
interface AutoFit { hidden: number[]; first: number; last: number }
const NO_FIT: AutoFit = { hidden: [], first: -1, last: -1 };

/** What a column gains when it becomes an edge one: its 24px inset in place of the 12px padding. */
const EDGE_GROWTH = 12;

/**
 * What to hide so `overflow` px fit again, last first and never the primary, and the edge columns left: `widths` are
 * the drawn widths, 0 for a column a `hideBelow` rule already hides. A column that becomes the new edge takes the
 * 24px inset, so the freed room covers that growth too, except for a column of fixed `width` (`fixed[index]`), which
 * holds its padding inside that width. Exported for tests.
 */
export function autoFit(overflow: number, widths: readonly number[], primaryIndex: number,
  fixed: readonly boolean[] = []): AutoFit {
  if (!(overflow > 0.5)) return NO_FIT;
  const before = widths.map((width, index) => (width > 0 ? index : -1)).filter((i) => i >= 0);
  const hidden: number[] = [];
  let freed = 0;
  let shown = before;
  for (let index = widths.length - 1; index >= 0; index -= 1) {
    const width = widths[index] ?? 0;
    if (index === primaryIndex || width <= 0) continue;
    hidden.push(index);
    freed += width;
    shown = before.filter((i) => !hidden.includes(i));
    const grows = (edge: number | undefined, was: number | undefined) =>
      edge !== undefined && edge !== was && !fixed[edge] ? EDGE_GROWTH : 0;
    const growth = grows(shown[0], before[0]) + grows(shown[shown.length - 1], before[before.length - 1]);
    if (freed >= overflow + growth - 0.5) break;
  }
  if (!hidden.length) return NO_FIT;
  return { hidden: hidden.sort((a, b) => a - b), first: shown[0] ?? -1, last: shown[shown.length - 1] ?? -1 };
}

/** The primary column's min-width when it is an edge column: its minWidth, the 12px padding and the 24px inset. */
const PRIMARY_EDGE_MIN = 'min-width: calc(var(--nui-dtable-primary-min, 120px) + 36px);';

/**
 * The rules of the columns hidden because they did not fit, the 24px insets of the edge columns still shown, and the
 * wider min-width of the primary column when it became one of them.
 */
function autoHideCss(tableId: string, fit: AutoFit, primaryIndex: number): string {
  if (!fit.hidden.length) return '';
  // The table's own cells only: a table inside a cell has cells of its own.
  const scope = `.nui-dtable[data-dtable="${tableId}"]:not([data-measuring]) > * > :where(tr) >`;
  const rules = fit.hidden.map((index) => `${scope} [data-ci="${index}"] { display: none; }`);
  if (fit.first >= 0) rules.push(`${scope} [data-ci="${fit.first}"] { padding-left: 24px; }`);
  if (fit.last >= 0) rules.push(`${scope} [data-ci="${fit.last}"] { padding-right: 24px; }`);
  if (fit.first === primaryIndex || fit.last === primaryIndex) rules.push(`${scope} [data-ci="${primaryIndex}"] { ${PRIMARY_EDGE_MIN} }`);
  return rules.join('\n');
}

/** A control a press inside a cell belongs to, other than the row's own press button. */
function pressedControl(target: EventTarget | null, row: Element): boolean {
  const control = target instanceof Element
    ? target.closest('a, button, input, select, textarea, label, summary, [role="button"], [tabindex]:not([tabindex="-1"]), [aria-haspopup]')
    : null;
  return !!control && row.contains(control) && !control.classList.contains('nui-dtable-pick');
}

/**
 * The container rules of the columns that hide: under each width the hiding columns go, the first and last columns
 * still shown take the 24px edge inset, and the primary column (`primaryIndex`) takes its edge min-width when it is one
 * of them. A column only ever hides as the table narrows, so each band's rules add to the wider bands' ones. Exported
 * for tests.
 */
export function dataTableHideCss(tableId: string, limits: readonly (number | undefined)[], primaryIndex = -1): string {
  const widths = [...new Set(limits.filter((n): n is number => n !== undefined))].sort((a, b) => b - a);
  // The table's own cells only: a table inside a cell has cells of its own.
  const scope = `.nui-dtable[data-dtable="${tableId}"] > * > :where(tr) >`;
  return widths.map((width) => {
    const shown = limits.map((limit, index) => (limit === undefined || limit < width ? index : -1)).filter((i) => i >= 0);
    const rules = [`${scope} [data-hide-below="${width}"] { display: none; }`];
    if (shown.length) {
      rules.push(`${scope} [data-ci="${shown[0]}"] { padding-left: 24px; }`);
      rules.push(`${scope} [data-ci="${shown[shown.length - 1]}"] { padding-right: 24px; }`);
      if (primaryIndex >= 0 && (shown[0] === primaryIndex || shown[shown.length - 1] === primaryIndex)) {
        rules.push(`${scope} [data-ci="${primaryIndex}"] { ${PRIMARY_EDGE_MIN} }`);
      }
    }
    // max-width a hair under the limit, not a `<` range, so the rule text needs no escaping in a style element.
    return `@container nui-dtable (max-width: ${width - 0.02}px) { ${rules.join(' ')} }`;
  }).join('\n');
}

/**
 * A read-only table: 40px rows, a sticky 36px header, cells that truncate, optional group headings with their
 * counts and pressable rows. Columns with `hideBelow` hide under that container width.
 */
export function DataTable<R>({ columns, rows, groups, rowKey, onRowPress, rowLabel, label, empty, className }:
  DataTableProps<R>) {
  const t = useT();
  const locale = useToolkitLocale();
  const tableId = useStableId('nui-dtable');
  const primaryIndex = Math.max(0, columns.findIndex((column) => column.primary));
  const limits = columns.map((column, index) => threshold(column, index === primaryIndex));
  const hideCss = dataTableHideCss(tableId, limits, primaryIndex);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [fit, setFit] = useState<AutoFit>(NO_FIT);
  // Hides the last columns while they do not fit: measured with every column back, before paint. Measured after each
  // render (a cell's content can grow or shrink under the same row keys) and on each resize of the container or the
  // table; a measure that finds the same fit sets no state, so it never loops.
  const fixedWidths = columns.map((column) => typeof column.width === 'number' && column.width > 0);
  const measureRef = useRef<() => void>(() => undefined);
  measureRef.current = () => {
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table) return;
    // Nothing hidden and nothing overflowing: no need to bring the columns back to measure them.
    if (!fit.hidden.length && table.scrollWidth <= wrap.clientWidth + 0.5) return;
    table.setAttribute('data-measuring', '');
    const overflow = table.scrollWidth - wrap.clientWidth;
    // Its own header row only: a table inside a cell has header cells of its own.
    const heads = [...(table.tHead?.rows[0]?.cells ?? [])] as HTMLElement[];
    const widths = heads.map((th) => th.offsetWidth);
    table.removeAttribute('data-measuring');
    const next = wrap.clientWidth > 0 ? autoFit(overflow, widths, primaryIndex, fixedWidths) : NO_FIT;
    setFit((current) => (current.hidden.join() === next.hidden.join() && current.first === next.first
      && current.last === next.last ? current : next));
  };
  useIsoLayoutEffect(() => { measureRef.current(); });
  useIsoLayoutEffect(() => {
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(wrap);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);
  const fitCss = autoHideCss(tableId, fit, primaryIndex);
  const primaryMin = columns[primaryIndex]?.minWidth;
  const minStyle = typeof primaryMin === 'number' && Number.isFinite(primaryMin) && primaryMin >= 0
    ? ({ '--nui-dtable-primary-min': `${primaryMin}px` } as React.CSSProperties) : undefined;
  const sections = groups
    ? groups.filter((group) => group.rows.length > 0)
    : [{ key: '', label: '', rows: rows ?? [] }];
  const hasRows = sections.some((section) => section.rows.length > 0);

  const cellProps = (column: DataTableColumn<R>, index: number) => ({
    'data-ci': index,
    'data-align': column.align === 'end' ? 'end' : undefined,
    'data-mono': column.mono ? '' : undefined,
    'data-primary': index === primaryIndex ? '' : undefined,
    'data-hide-below': limits[index],
    style: typeof column.width === 'number' && column.width > 0
      ? { width: column.width, minWidth: column.width, maxWidth: column.width }
      : undefined,
  });

  const renderRow = (row: R) => {
    const key = rowKey(row);
    return (
      <tr key={key} data-pressable={onRowPress ? '' : undefined}
        onClick={onRowPress ? (event) => { if (!pressedControl(event.target, event.currentTarget)) onRowPress(row); } : undefined}>
        {columns.map((column, index) => {
          const content = column.cell(row);
          const props = cellProps(column, index);
          if (index !== primaryIndex) return <td key={column.id} {...props}>{content}</td>;
          return (
            <th key={column.id} scope="row" {...props}>
              {onRowPress ? (
                <button type="button" className="nui-dtable-pick" aria-label={rowLabel?.(row)}
                  onClick={(event) => { event.stopPropagation(); onRowPress(row); }}>{content}</button>
              ) : content}
            </th>
          );
        })}
      </tr>
    );
  };

  return (
    <div ref={wrapRef} className={cx('nui-dtable-wrap', className)} data-notis-ui="">
      {hideCss || fitCss ? <style>{[hideCss, fitCss].filter(Boolean).join('\n')}</style> : null}
      <table ref={tableRef} className="nui-dtable" data-dtable={tableId} style={minStyle}
        aria-label={label !== undefined ? t(label) : undefined}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column.id} scope="col" {...cellProps(column, index)}>{t(column.label)}</th>
            ))}
          </tr>
        </thead>
        {hasRows ? sections.map((section) => (
          <tbody key={section.key}>
            {groups && (
              <tr className="nui-dtable-group">
                <th scope="colgroup" colSpan={columns.length}>
                  <span className="nui-dtable-group-label">{t(section.label)}</span>
                  <span className="nui-dtable-group-count">{formatNumber(section.rows.length, locale)}</span>
                </th>
              </tr>
            )}
            {section.rows.map(renderRow)}
          </tbody>
        )) : (
          <tbody>
            <tr className="nui-dtable-empty">
              <td colSpan={columns.length}>{empty ?? <EmptyState />}</td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}
DataTable.displayName = 'DataTable';
