import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { Pagination } from '../../../src/ui/index';

/** A pager the reviewer can press through. */
function LivePager({ start, pageCount, total, pageSize, busy }: {
  start: number; pageCount?: number; total?: number; pageSize?: number; busy?: boolean;
}) {
  const [page, setPage] = useState(start);
  return <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} busy={busy} onChange={setPage} />;
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-4">{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs text-muted-foreground">{children}</code>;
}

/** The run history of an automation: 134 runs, 20 a page. */
const RUNS = 134;
const PAGE_SIZE = 20;

export const specimen = defineSpecimen({
  id: 'pagination',
  name: 'Pagination',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Pagination'],
  summary: 'Previous and next page buttons with "Page 2 of 5", or "21 to 40 of 134" when the total is known.',
  states: [
    {
      id: 'page-of',
      label: 'Page count known (press the arrows)',
      render: () => (
        <Rows>
          <Code>page=2 pageCount=5</Code>
          <div><LivePager start={2} pageCount={5} /></div>
        </Rows>
      ),
    },
    {
      id: 'range-of',
      label: 'Total known: the run history of an automation, 20 a page',
      render: () => (
        <Rows>
          <Code>{`page=2 total=${RUNS} pageSize=${PAGE_SIZE}`}</Code>
          <div><LivePager start={2} total={RUNS} pageSize={PAGE_SIZE} /></div>
        </Rows>
      ),
    },
    {
      id: 'first-last',
      label: 'First page (previous off) and last page (next off)',
      render: () => (
        <Rows>
          <Code>page=1</Code>
          <div><LivePager start={1} total={RUNS} pageSize={PAGE_SIZE} /></div>
          <Code>page=7</Code>
          <div><LivePager start={7} total={RUNS} pageSize={PAGE_SIZE} /></div>
        </Rows>
      ),
    },
    {
      id: 'single-page',
      label: 'Everything on one page: both arrows off',
      render: () => (
        <Rows>
          <Code>total=12 pageSize=20</Code>
          <div><LivePager start={1} total={12} pageSize={PAGE_SIZE} /></div>
          <Code>pageCount=1</Code>
          <div><LivePager start={1} pageCount={1} /></div>
        </Rows>
      ),
    },
    {
      id: 'busy',
      label: 'Loading the next page: the buttons wait',
      render: () => (
        <Rows>
          <Code>busy</Code>
          <div><LivePager start={3} total={RUNS} pageSize={PAGE_SIZE} busy /></div>
        </Rows>
      ),
    },
    {
      id: 'empty',
      label: 'No items (total 0)',
      render: () => (
        <Rows>
          <Code>total=0</Code>
          <div><LivePager start={1} total={0} pageSize={PAGE_SIZE} /></div>
        </Rows>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390px) at the end of a list',
      width: 390,
      render: ({ t }) => (
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm text-muted-foreground">{t({ en: 'Run history', fr: 'Historique des exécutions' })}</span>
          <LivePager start={2} total={RUNS} pageSize={PAGE_SIZE} />
        </div>
      ),
    },
  ],
});
