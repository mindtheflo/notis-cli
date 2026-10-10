'use client';

import type { ReactNode } from 'react';

/** A chart's data, available to view Markdown without adding a second visible table.
 * Keep labels/values identical to the chart. The renderer recognizes this semantic
 * table inside Shadow DOM; snapshots never infer numbers from SVG geometry.
 */
export function RenderChartData({ title, columns, rows, children }: {
  title: string;
  columns: readonly string[];
  rows: readonly (readonly (string | number | boolean | null)[])[];
  children?: ReactNode;
}) {
  return <>{children}<table hidden data-notis-render="chart-data" aria-label={title}>
    <thead><tr>{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((_, column) => <td key={column}>{row[column] == null ? '' : String(row[column])}</td>)}</tr>)}</tbody>
  </table></>;
}
