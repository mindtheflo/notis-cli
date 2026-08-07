'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeDocumentRecord, useTool, useTopBarSearch } from '@notis/sdk';
import { WarningCircleIcon as AlertCircle, AtIcon as AtSign, CalendarIcon as Calendar, CheckSquareIcon as CheckSquare, CaretDownIcon as ChevronDown, CircleIcon as Circle, CircleIcon as CircleDot, DatabaseIcon as Database, FileTextIcon as FileText, HashIcon as Hash, LinkIcon as Link2, ListChecksIcon as ListChecks, CircleNotchIcon as Loader2, EnvelopeIcon as Mail, PaperclipIcon as Paperclip, PhoneIcon as Phone, SigmaIcon as Sigma, TagIcon as Tag, TextTIcon as Type, UserIcon as User } from '@phosphor-icons/react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type {
  DatabaseCatalogRow,
  DatabaseDetail,
  DatabaseDocument,
  DatabaseProperty,
  DocumentPropertyValue,
  GetDatabaseArgs,
  GetDatabaseResult,
  ListDatabasesArgs,
  ListDatabasesResult,
  QueryDatabaseArgs,
  QueryDatabaseResult,
} from '@/lib/types';

const TYPE_LABEL: Record<string, string> = {
  title: 'Text',
  rich_text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  status: 'Status',
  checkbox: 'Checkbox',
  url: 'URL',
  email: 'Email',
  phone_number: 'Phone',
  date: 'Date',
  files: 'Files',
  relation: 'Relation',
  formula: 'Formula',
  people: 'People',
};

function PropertyTypeIcon({ type }: { type: string }) {
  const className = 'h-3.5 w-3.5 text-muted-foreground';
  switch (type) {
    case 'title':
      return <FileText className={className} />;
    case 'rich_text':
      return <Type className={className} />;
    case 'number':
      return <Hash className={className} />;
    case 'select':
      return <CircleDot className={className} />;
    case 'multi_select':
      return <Tag className={className} />;
    case 'status':
      return <Circle className={className} />;
    case 'checkbox':
      return <CheckSquare className={className} />;
    case 'url':
      return <Link2 className={className} />;
    case 'email':
      return <Mail className={className} />;
    case 'phone_number':
      return <Phone className={className} />;
    case 'date':
      return <Calendar className={className} />;
    case 'files':
      return <Paperclip className={className} />;
    case 'relation':
      return <Link2 className={className} />;
    case 'formula':
      return <Sigma className={className} />;
    case 'people':
      return <User className={className} />;
    default:
      return <AtSign className={className} />;
  }
}

const TILE_TINTS = [
  'bg-blue-100/70 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200',
  'bg-amber-100/70 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  'bg-pink-100/70 text-pink-900 dark:bg-pink-500/15 dark:text-pink-200',
  'bg-emerald-100/70 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
  'bg-violet-100/70 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200',
  'bg-rose-100/70 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200',
  'bg-sky-100/70 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200',
  'bg-orange-100/70 text-orange-900 dark:bg-orange-500/15 dark:text-orange-200',
];

function tileTintFor(seed: string | null | undefined): string {
  if (!seed) return TILE_TINTS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TILE_TINTS[hash % TILE_TINTS.length];
}

function compactNumber(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US').format(n);
}

function resolvedDocumentCount(
  database: Pick<DatabaseCatalogRow, 'documents_count' | 'successful_documents' | 'total_documents'> | null | undefined,
): number {
  const count = database?.documents_count ?? database?.successful_documents ?? database?.total_documents;
  if (typeof count !== 'number' || !Number.isFinite(count)) return 0;
  return Math.max(0, count);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function textFromRichText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return '';
      const item = chunk as Record<string, unknown>;
      if (typeof item.plain_text === 'string') return item.plain_text;
      const text = item.text;
      if (text && typeof text === 'object') {
        const content = (text as Record<string, unknown>).content;
        if (typeof content === 'string') return content;
      }
      if (typeof item.content === 'string') return item.content;
      return '';
    })
    .join('');
}

function relationLabel(value: unknown, noun: string): string {
  const count = Array.isArray(value) ? value.length : 0;
  return `${compactNumber(count)} ${noun}${count === 1 ? '' : 's'}`;
}

const SELECT_TINTS: Record<string, string> = {
  default: 'bg-muted text-foreground',
  gray: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-500/20 dark:text-zinc-200',
  brown: 'bg-amber-200/60 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  orange: 'bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200',
  yellow: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  green: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  blue: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
  purple: 'bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-200',
  pink: 'bg-pink-100 text-pink-900 dark:bg-pink-500/20 dark:text-pink-200',
  red: 'bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200',
};

function selectTint(color: string | null | undefined): string {
  if (!color) return SELECT_TINTS.default;
  return SELECT_TINTS[color] ?? SELECT_TINTS.default;
}

type Group = {
  key: string;
  label: string;
  rows: DatabaseCatalogRow[];
};

function groupRows(rows: DatabaseCatalogRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const row of rows) {
    const key = row.owner_app_id ?? '__workspace__';
    const label = row.owner_app_name ?? 'Workspace';
    if (!map.has(key)) {
      map.set(key, { key, label, rows: [] });
    }
    map.get(key)!.rows.push(row);
  }
  for (const group of map.values()) {
    group.rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function relationCount(database: DatabaseDetail | null): number {
  if (!database?.schema?.properties) return 0;
  return database.schema.properties.filter((p) => p.type === 'relation').length;
}

function nonRelationProps(database: DatabaseDetail | null): DatabaseProperty[] {
  if (!database?.schema?.properties) return [];
  return database.schema.properties.filter((p) => p.type !== 'relation');
}

function relationProps(database: DatabaseDetail | null): DatabaseProperty[] {
  if (!database?.schema?.properties) return [];
  return database.schema.properties.filter((p) => p.type === 'relation');
}

type ActiveTab = 'properties' | 'relations' | 'documents';

export default function CatalogPage() {
  const listDatabases = useTool<ListDatabasesArgs, ListDatabasesResult>(
    'LOCAL_NOTIS_DATABASE_LIST_DATABASES',
  );
  const getDatabase = useTool<GetDatabaseArgs, GetDatabaseResult>(
    'LOCAL_NOTIS_DATABASE_GET_DATABASE',
  );
  const queryDatabase = useTool<QueryDatabaseArgs, QueryDatabaseResult>(
    'LOCAL_NOTIS_DATABASE_QUERY',
  );

  const [rows, setRows] = useState<DatabaseCatalogRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  const [detail, setDetail] = useState<DatabaseDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('properties');

  const detailRequestId = useRef(0);
  const documentRequestId = useRef(0);

  const [documents, setDocuments] = useState<DatabaseDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);

  const listCall = listDatabases.call;
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    listCall({} as ListDatabasesArgs)
      .then((result) => {
        if (cancelled) return;
        const next = (result?.databases ?? []).filter((db): db is DatabaseCatalogRow =>
          Boolean(db && typeof db.id === 'string'),
        );
        setRows(next);
        setSelectedId((current) => {
          if (current && next.some((row) => row.id === current)) return current;
          return next[0]?.id ?? null;
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListError(err instanceof Error ? err.message : 'Failed to load databases.');
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listCall]);

  const getCall = getDatabase.call;
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    const requestId = ++detailRequestId.current;
    setDetailLoading(true);
    setDetailError(null);
    setActiveTab('properties');
    setDocuments([]);
    setDocumentsError(null);
    setDocumentsLoading(false);
    getCall({ database_id: selectedId })
      .then((result) => {
        if (requestId !== detailRequestId.current) return;
        if (result && 'database' in result && result.database) {
          setDetail(result.database);
        } else {
          const message =
            result && 'message' in result && typeof result.message === 'string'
              ? result.message
              : 'Database not found.';
          setDetail(null);
          setDetailError(message);
        }
      })
      .catch((err: unknown) => {
        if (requestId !== detailRequestId.current) return;
        setDetail(null);
        setDetailError(err instanceof Error ? err.message : 'Failed to load database.');
      })
      .finally(() => {
        if (requestId === detailRequestId.current) setDetailLoading(false);
      });
  }, [selectedId, getCall]);

  const queryCall = queryDatabase.call;
  useEffect(() => {
    if (activeTab !== 'documents') return;
    if (!detail) return;

    const databaseId = detail.id;
    if (!databaseId) {
      setDocuments([]);
      setDocumentsError('This database does not have a stable ID.');
      setDocumentsLoading(false);
      return;
    }

    const requestId = ++documentRequestId.current;
    setDocuments([]);
    setDocumentsError(null);
    setDocumentsLoading(true);

    const loadDocuments = async () => {
      const pageSize = 100;
      const maxPages = 1000;
      let offset = 0;
      let collected: DatabaseDocument[] = [];

      for (let page = 0; page < maxPages; page += 1) {
        const result = await queryCall({
          database_id: databaseId,
          query: { page_size: pageSize },
          offset,
        });
        if (requestId !== documentRequestId.current) return;

        if (!result || result.status === 'error') {
          throw new Error(result?.message || 'Failed to load documents.');
        }

          collected = [
            ...collected,
            ...(result.documents ?? []).map((document) => normalizeDocumentRecord(document)),
          ];
        setDocuments(collected);

        if (!result.has_more) return;
        if (typeof result.next_offset !== 'number') {
          throw new Error('The document query did not return the next page offset.');
        }
        offset = result.next_offset;
      }

      throw new Error('Document query exceeded the pagination safety limit.');
    };

    loadDocuments()
      .catch((err: unknown) => {
        if (requestId !== documentRequestId.current) return;
        setDocumentsError(err instanceof Error ? err.message : 'Failed to load documents.');
      })
      .finally(() => {
        if (requestId === documentRequestId.current) setDocumentsLoading(false);
      });

    return () => {
      if (requestId === documentRequestId.current) {
        documentRequestId.current += 1;
      }
    };
  }, [activeTab, detail, queryCall]);

  const handleSearchChange = useCallback((next: string) => setSearch(next), []);
  useTopBarSearch({
    value: search,
    onChange: handleSearchChange,
    placeholder: 'Search databases',
  });

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = [row.name, row.slug, row.description, row.owner_app_name]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  const groups = useMemo(() => groupRows(filteredRows), [filteredRows]);
  const docCount = resolvedDocumentCount(detail);
  const relCount = relationCount(detail);
  const propCount = nonRelationProps(detail).length;

  return (
    <div
      data-store-screenshot="catalog"
      className="flex h-screen w-full overflow-hidden bg-background text-foreground antialiased"
    >
      <aside className="flex h-full w-[288px] flex-shrink-0 flex-col border-r border-border bg-background">
        <div className="flex items-baseline justify-between gap-2 px-4 pb-3 pt-4">
          <h1 className="text-lg font-semibold tracking-tight">Databases</h1>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {compactNumber(rows.length)}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-4">
          {listLoading ? (
            <ListSkeleton />
          ) : listError ? (
            <ListError message={listError} />
          ) : groups.length === 0 ? (
            <ListEmpty hasSearch={Boolean(search.trim())} />
          ) : (
            groups.map((group) => {
              const collapsed = collapsedGroups[group.key];
              return (
                <div key={group.key} className="mt-2 first:mt-0">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.key]: !prev[group.key],
                      }))
                    }
                    className="flex w-full items-center gap-1.5 px-2 pb-1.5 pt-1 text-left transition-colors hover:text-foreground"
                  >
                    <ChevronDown
                      className={cn(
                        'h-2.5 w-2.5 text-foreground transition-transform',
                        collapsed && '-rotate-90',
                      )}
                    />
                    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                      {group.label}
                    </span>
                    <span className="ml-1 h-px flex-1 bg-border/70" />
                  </button>
                  {!collapsed &&
                    group.rows.map((row) => (
                      <CatalogRow
                        key={row.id}
                        row={row}
                        active={row.id === selectedId}
                        onSelect={() => setSelectedId(row.id)}
                      />
                    ))}
                </div>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {listLoading || detailLoading || (selectedId && !detail && !detailError) ? (
          <DetailSkeleton />
        ) : detailError ? (
          <DetailError message={detailError} />
        ) : !detail ? (
          <DetailEmpty hasRows={rows.length > 0} />
        ) : (
          <>
            <DetailHeader
              database={detail}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              propCount={propCount}
              relCount={relCount}
              docCount={docCount}
            />
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {activeTab === 'properties' && (
                <PropertyList properties={nonRelationProps(detail)} />
              )}
              {activeTab === 'relations' && (
                <RelationsList properties={relationProps(detail)} />
              )}
              {activeTab === 'documents' && (
                <DocumentsTable
                  database={detail}
                  documents={documents}
                  loading={documentsLoading}
                  error={documentsError}
                  expectedCount={docCount}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function CatalogRow({
  row,
  active,
  onSelect,
}: {
  row: DatabaseCatalogRow;
  active: boolean;
  onSelect: () => void;
}) {
  const docs = resolvedDocumentCount(row);
  const tint = tileTintFor(row.slug ?? row.id);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors',
        active ? 'bg-foreground text-background' : 'hover:bg-muted/60 text-foreground',
      )}
    >
      <span
        className={cn(
          'flex size-6 flex-shrink-0 items-center justify-center rounded-md',
          active ? 'bg-background/15 text-background' : tint,
        )}
      >
        <Database className="h-3 w-3" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-[13px] font-medium tracking-[-0.005em]',
            active ? 'text-background' : 'text-foreground',
          )}
        >
          {row.name ?? row.slug ?? 'Untitled'}
        </span>
        <span
          className={cn(
            'truncate text-[11px] tabular-nums',
            active ? 'text-background/60' : 'text-muted-foreground',
          )}
        >
          {compactNumber(docs)} docs
        </span>
      </span>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1.5 p-1.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-md p-2"
        >
          <div className="size-6 animate-pulse rounded-md bg-muted" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-2 w-16 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListError({ message }: { message: string }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-3 py-6 text-center">
      <AlertCircle className="h-4 w-4 text-destructive" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function ListEmpty({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="mt-12 flex flex-col items-center px-3 text-center">
      <Database className="mb-3 h-8 w-8 text-muted-foreground/30" strokeWidth={1.5} />
      <p className="text-sm font-medium text-foreground">
        {hasSearch ? 'No matches' : 'No databases yet'}
      </p>
      <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">
        {hasSearch
          ? 'Try a different name or app.'
          : 'Databases created in your Notis workspace will appear here.'}
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function DetailError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 text-center">
      <AlertCircle className="h-6 w-6 text-destructive" />
      <p className="text-sm font-medium text-foreground">Couldn't load this database</p>
      <p className="max-w-[42ch] text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function DetailEmpty({ hasRows }: { hasRows: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <Database className="h-10 w-10 text-muted-foreground/25" strokeWidth={1.4} />
      <p className="text-sm font-semibold text-foreground">
        {hasRows ? 'Select a database' : 'No databases yet'}
      </p>
      <p className="max-w-[42ch] text-xs text-muted-foreground">
        {hasRows
          ? 'Pick a database on the left to view its schema, properties, and relations.'
          : 'Databases created in your Notis workspace will appear here.'}
      </p>
    </div>
  );
}

function DetailHeader({
  database,
  activeTab,
  onTabChange,
  propCount,
  relCount,
  docCount,
}: {
  database: DatabaseDetail;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  propCount: number;
  relCount: number;
  docCount: number;
}) {
  const tint = tileTintFor(database.slug ?? database.id);
  const eyebrow = [database.owner_app_name ?? 'Workspace', 'Database']
    .filter(Boolean)
    .join(' · ');

  return (
    <header className="flex flex-col gap-3.5 border-b border-border px-10 pb-5 pt-9">
      <div className="flex items-center gap-3.5">
        <span
          className={cn(
            'flex size-11 flex-shrink-0 items-center justify-center rounded-[11px]',
            tint,
          )}
        >
          <Database className="h-[22px] w-[22px]" strokeWidth={1.7} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {eyebrow.toUpperCase()}
          </span>
          <h2 className="truncate text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {database.name ?? database.slug ?? 'Untitled database'}
          </h2>
        </div>
      </div>

      {database.description ? (
        <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
          {database.description}
        </p>
      ) : null}

      <div className="mt-1.5 flex items-center gap-1">
        <TabButton
          icon={<ListChecks className="h-3 w-3" />}
          label="Properties"
          count={propCount}
          active={activeTab === 'properties'}
          tab="properties"
          onClick={() => onTabChange('properties')}
        />
        <TabButton
          icon={<Link2 className="h-3 w-3" />}
          label="Relations"
          count={relCount}
          active={activeTab === 'relations'}
          tab="relations"
          onClick={() => onTabChange('relations')}
        />
        <TabButton
          icon={<Database className="h-3 w-3" />}
          label="Documents"
          count={docCount}
          active={activeTab === 'documents'}
          tab="documents"
          onClick={() => onTabChange('documents')}
        />
      </div>
    </header>
  );
}

function TabButton({
  icon,
  label,
  count,
  active,
  tab,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  tab: ActiveTab;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tab={tab}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] transition-colors',
        active
          ? 'border-b-[1.5px] border-foreground font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
      <span className={cn('tabular-nums', active ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
        {compactNumber(count)}
      </span>
    </button>
  );
}

function PropertyList({ properties }: { properties: DatabaseProperty[] }) {
  if (properties.length === 0) {
    return <SectionEmpty label="No properties defined." />;
  }
  return (
    <div className="flex flex-col">
      {properties.map((prop, index) => (
        <PropertyRow key={prop.id} property={prop} striped={index % 2 === 1} />
      ))}
    </div>
  );
}

function PropertyRow({ property, striped }: { property: DatabaseProperty; striped: boolean }) {
  const typeLabel = TYPE_LABEL[property.type] ?? property.type;
  const isTitle = property.type === 'title';
  const options = property.options ?? [];

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-lg px-4 py-3.5',
        striped && 'bg-muted/40',
      )}
    >
      <div className="flex items-center gap-2.5">
        <PropertyTypeIcon type={property.type} />
        <span className="text-[13.5px] font-semibold tracking-[-0.005em] text-foreground">
          {property.name ?? 'Untitled'}
        </span>
        {isTitle ? (
          <Badge
            variant="secondary"
            className="rounded-sm border-transparent bg-foreground/[0.08] px-1.5 py-px text-[10.5px] font-medium uppercase tracking-[0.02em] text-muted-foreground"
          >
            Title
          </Badge>
        ) : null}
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">{typeLabel}</span>
      </div>

      {options.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          {options.map((option, index) => (
            <span
              key={option.id ?? option.name ?? index}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                selectTint(option.color),
              )}
            >
              {option.name ?? '—'}
            </span>
          ))}
        </div>
      ) : null}

      {property.format ? (
        <div className="pl-6">
          <span className="inline-flex items-center rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
            Format · {property.format}
          </span>
        </div>
      ) : null}

      {property.expression ? (
        <div className="max-w-[60ch] pl-6">
          <code className="block truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {property.expression}
          </code>
        </div>
      ) : null}

      {property.description ? (
        <div className="max-w-[52ch] pl-6">
          <p className="text-[13px] leading-5 text-muted-foreground">{property.description}</p>
        </div>
      ) : null}
    </div>
  );
}

function RelationsList({ properties }: { properties: DatabaseProperty[] }) {
  if (properties.length === 0) {
    return <SectionEmpty label="No relations defined." />;
  }
  return (
    <div className="flex flex-col">
      {properties.map((prop, index) => (
        <RelationRow key={prop.id} property={prop} striped={index % 2 === 1} />
      ))}
    </div>
  );
}

function RelationRow({ property, striped }: { property: DatabaseProperty; striped: boolean }) {
  const target = property.relation_target;
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-lg px-4 py-3.5',
        striped && 'bg-muted/40',
      )}
    >
      <div className="flex items-center gap-2.5">
        <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[13.5px] font-semibold tracking-[-0.005em] text-foreground">
          {property.name ?? 'Untitled'}
        </span>
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">Relation</span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        <span className="text-[11px] text-muted-foreground">→</span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-[11.5px] font-medium text-foreground">
          <Database className="h-3 w-3 text-muted-foreground" />
          {target?.database_name ?? target?.database_slug ?? 'Unknown database'}
        </span>
      </div>
      {property.description ? (
        <div className="max-w-[52ch] pl-6">
          <p className="text-[13px] leading-5 text-muted-foreground">{property.description}</p>
        </div>
      ) : null}
    </div>
  );
}

function DocumentsTable({
  database,
  documents,
  loading,
  error,
  expectedCount,
}: {
  database: DatabaseDetail;
  documents: DatabaseDocument[];
  loading: boolean;
  error: string | null;
  expectedCount: number;
}) {
  const properties = (database.schema?.properties ?? []).filter((property) => property.type !== 'title');

  if (loading && documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-[12.5px] text-muted-foreground">Loading documents</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-sm font-medium text-foreground">Couldn't load documents</p>
        <p className="max-w-[44ch] text-[12.5px] text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (documents.length === 0) {
    return <DocumentsEmpty count={expectedCount} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[12.5px] text-muted-foreground">
          {compactNumber(documents.length)} loaded
        </p>
        {loading ? (
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Loading more</span>
          </div>
        ) : null}
      </div>
      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[260px]">Document</TableHead>
              <TableHead className="min-w-[150px]">Created</TableHead>
              <TableHead className="min-w-[150px]">Last edited</TableHead>
              {properties.map((property) => (
                <TableHead key={property.id} className="min-w-[160px]">
                  {property.name ?? property.id}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => (
              <TableRow key={document.id}>
                <TableCell className="min-w-[260px]">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-medium text-foreground">
                      {document.title || 'Untitled document'}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {document.id}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(document.createdAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(document.lastEditedTime)}
                </TableCell>
                {properties.map((property) => {
                  const propertyName = property.name ?? property.id;
                  return (
                    <TableCell key={`${document.id}-${property.id}`} className="max-w-[260px]">
                      <PropertyValue
                        property={property}
                        value={document.properties?.[propertyName]}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DocumentsEmpty({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Database className="h-8 w-8 text-muted-foreground/25" strokeWidth={1.4} />
      <p className="text-sm font-medium text-foreground">{compactNumber(count)} documents</p>
    </div>
  );
}

function PropertyValue({
  property,
  value,
}: {
  property: DatabaseProperty;
  value: DocumentPropertyValue | undefined;
}) {
  if (value == null || value === '') return <MutedDash />;

  switch (property.type) {
    case 'title':
    case 'rich_text':
      return <TextValue value={typeof value === 'string' ? value : stringifyFallback(value)} />;
    case 'number':
      return <TextValue value={typeof value === 'number' ? compactNumber(value) : ''} />;
    case 'select':
    case 'status':
      if (typeof value !== 'string') return <MutedDash />;
      return (
        <Badge variant="secondary" className="rounded-sm px-1.5 py-px">
          {value}
        </Badge>
      );
    case 'multi_select': {
      const options = Array.isArray(value) ? value : [];
      if (options.length === 0) return <MutedDash />;
      return (
        <div className="flex max-w-[240px] flex-wrap gap-1">
          {options.map((option, index) => {
            const label = typeof option === 'string' ? option : stringifyFallback(option);
            return (
              <Badge
                key={`${label}-${index}`}
                variant="secondary"
                className="rounded-sm px-1.5 py-px"
              >
                {label || 'Untitled'}
              </Badge>
            );
          })}
        </div>
      );
    }
    case 'checkbox':
      return <TextValue value={value === true ? 'Yes' : 'No'} />;
    case 'date':
      return <TextValue value={typeof value === 'string' ? formatDate(value) : ''} />;
    case 'url':
    case 'email':
    case 'phone_number':
      return <TextValue value={typeof value === 'string' ? value : ''} />;
    case 'relation':
    case 'people':
    case 'files':
      return <TextValue value={relationLabel(value, property.type === 'people' ? 'person' : property.type === 'files' ? 'file' : 'linked record')} />;
    default:
      return <TextValue value={stringifyFallback(value)} />;
  }
}

function TextValue({ value }: { value: string }) {
  if (!value) return <MutedDash />;
  return <span className="block truncate text-[12.5px] text-foreground">{value}</span>;
}

function MutedDash() {
  return <span className="text-muted-foreground/60">—</span>;
}

function stringifyFallback(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function SectionEmpty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
    </div>
  );
}
