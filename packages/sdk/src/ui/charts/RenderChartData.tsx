'use client';

import * as React from 'react';
import type { ReactNode } from 'react';

export interface RenderChartDataProps {
  title: string;
  columns: readonly string[];
  rows: readonly (readonly (string | number | boolean | null)[])[];
  /** The visible chart. `Chart` and `ChartTable` already render their own data table. */
  children?: ReactNode;
}

/**
 * A chart's data, available to view Markdown without adding a second visible table (toolkit spec 2.11; moved from
 * `src/components/RenderChartData.tsx`). Keep labels and values identical to the chart. The renderer recognizes this
 * semantic table inside Shadow DOM; snapshots never infer numbers from SVG geometry. `Chart` renders its numbers
 * through it.
 */
export function RenderChartData({ title, columns, rows, children }: RenderChartDataProps) {
  return <>{children}<table hidden data-notis-render="chart-data" aria-label={title}>
    <thead><tr>{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((_, column) => <td key={column}>{row[column] == null ? '' : String(row[column])}</td>)}</tr>)}</tbody>
  </table></>;
}
