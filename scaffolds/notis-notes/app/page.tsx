'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MultiSelectActionBar,
  MultiSelectCheckbox,
  MultiSelectDragOverlay,
  useMultiSelect,
  useBackend,
  useDatabaseSchema,
  useDocuments,
  useNotis,
  useNotisNavigation,
  useTopBarSearch,
  useUpsertDocument,
  asRecord,
  getDocumentPreview,
  getRelationIds,
  isPresentString,
  optionalString,
  type DatabaseProperty,
  type DocumentRecord,
  type MultiSelectController,
  type UpsertDocumentArgs,
} from '@notis/sdk';
import { ArrowUpRightIcon as ArrowUpRight, CubeIcon as Boxes, BookOpenIcon as BookOpen, BookOpenTextIcon as BookOpenText, CalendarIcon as CalendarDays, CaretDownIcon as ChevronDown, CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, FileTextIcon as FileText, FolderIcon as Folder, FolderMinusIcon as FolderMinus, FolderOpenIcon as FolderOpen, FolderPlusIcon as FolderPlus, FoldersIcon as Folders, SquaresFourIcon as LayoutGrid, CircleNotchIcon as Loader2, MagnifyingGlassIcon as Search, NotePencilIcon as NotebookPen, PencilIcon as Pencil, PlusIcon as Plus, NoteIcon as StickyNote, TableIcon as Table2, TrashIcon as Trash, XIcon as X, type Icon } from '@phosphor-icons/react';

import {
  PHOSPHOR_ICONS,
  PHOSPHOR_ICON_ALIASES,
  PHOSPHOR_ICON_NAMES,
} from './phosphor-icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  VISIBLE_PROPERTIES_PROPERTY,
  resolveVisibleColumns,
} from '@/lib/visible-properties';

type TabKey = 'gallery' | 'table' | 'calendar';

type TabConfig = {
  key: TabKey;
  label: string;
  icon: Icon;
};

type FolderOption = {
  id: string;
  title: string;
  parentId: string | null;
  pathLabel: string;
};

type CollectionItemContext = {
  id: string;
  title: string;
  icon?: string | null;
  properties: Record<string, unknown>;
};

const NOTE_DATABASE_SLUG = 'notes';
const FOLDER_DATABASE_SLUG = 'note_folders';
const DEFAULT_NOTE_TITLE = 'Untitled note';
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Sentinel for the built-in "Created" date, sourced from each document's
// created_at timestamp rather than a user-defined date property.
const CREATED_DATE_FIELD = '__created__';
const CREATED_DATE_LABEL = 'Created';

type CalendarDateField = {
  value: string;
  label: string;
};

const TABS: TabConfig[] = [
  { key: 'gallery', label: 'Gallery', icon: LayoutGrid },
  { key: 'table', label: 'Table', icon: Table2 },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
];

type IconName = string;

const PHOSPHOR_ICON_PREFIX = 'phosphor:';

const SUGGESTED_FOLDER_ICON_NAMES: IconName[] = [
  'folder',
  'folder-open',
  'folder-kanban',
  'archive',
  'bookmark',
  'book-open',
  'briefcase',
  'calendar',
  'file-text',
  'flag',
  'house',
  'lightbulb',
  'note-pencil',
  'palette',
  'rocket',
  'magnifying-glass',
  'sparkle',
  'tag',
];

function parsePhosphorIconName(icon: string | null | undefined): IconName | null {
  if (typeof icon !== 'string' || !icon.startsWith(PHOSPHOR_ICON_PREFIX)) {
    return null;
  }
  const name = icon.slice(PHOSPHOR_ICON_PREFIX.length).trim().replace(/_/g, '-').toLowerCase();
  return name && /^[a-z][a-z0-9-]*$/.test(name) ? name : null;
}

function getPhosphorIconComponent(icon: string | null | undefined): Icon | null {
  const name = parsePhosphorIconName(icon);
  return name ? getPhosphorIconComponentByName(name) : null;
}

function getPhosphorIconComponentByName(name: string): Icon | null {
  return PHOSPHOR_ICONS[name] ?? PHOSPHOR_ICONS[PHOSPHOR_ICON_ALIASES[name] ?? ''] ?? null;
}

const ALL_PHOSPHOR_ICON_NAMES = [...PHOSPHOR_ICON_NAMES].sort((a, b) => a.localeCompare(b));

function normalizeCollectionItem(value: unknown): CollectionItemContext | null {
  const record = asRecord(value);
  const id = optionalString(record?.id);
  if (!record || !id) return null;
  return {
    id,
    title: optionalString(record.title) ?? 'Untitled',
    icon: optionalString(record.icon),
    properties: asRecord(record.properties) ?? {},
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getDateKey(value: unknown): string | null {
  if (!isPresentString(value)) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function getDateInputValue(value: unknown): string {
  return getDateKey(value) ?? '';
}

function getNoteDateValue(note: DocumentRecord, field: string): unknown {
  if (field === CREATED_DATE_FIELD) return note.createdAt;
  return note.properties[field];
}

function getFolderTitle(document: DocumentRecord): string {
  const explicit = document.properties.Name;
  if (isPresentString(explicit)) return explicit;
  return document.title || 'Untitled folder';
}

function getNoteTitle(document: DocumentRecord): string {
  return isPresentString(document.title) ? document.title : DEFAULT_NOTE_TITLE;
}

function getNotePreviewText(document: DocumentRecord): string {
  return getDocumentPreview(document);
}

function buildFolderOptions(documents: DocumentRecord[]): FolderOption[] {
  const byId = new Map(documents.map((d) => [d.id, d]));

  function buildPath(id: string, seen: Set<string> = new Set()): string {
    const folder = byId.get(id);
    if (!folder) return 'Untitled folder';
    const title = getFolderTitle(folder);
    if (seen.has(id)) return title;
    seen.add(id);
    const parentId = getRelationIds(folder.properties.Parent)[0] ?? null;
    if (!parentId || !byId.has(parentId)) return title;
    return `${buildPath(parentId, seen)} / ${title}`;
  }

  return documents
    .map((d) => ({
      id: d.id,
      title: getFolderTitle(d),
      parentId: getRelationIds(d.properties.Parent)[0] ?? null,
      pathLabel: buildPath(d.id),
    }))
    .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
}

function getCoverUrl(document: DocumentRecord): string | null {
  if (isPresentString(document.cover)) {
    return document.cover.trim();
  }
  return null;
}

function NoteIcon({
  icon,
  className,
  fallbackClassName,
}: {
  icon: string | null | undefined;
  className?: string;
  fallbackClassName?: string;
}) {
  const Icon = getPhosphorIconComponent(icon);
  if (Icon) {
    return <Icon className={cn('h-3.5 w-3.5', className)} />;
  }
  if (typeof icon === 'string' && /^https?:\/\//i.test(icon.trim())) {
    return (
      <img
        src={icon.trim()}
        alt=""
        className={cn('h-3.5 w-3.5 rounded-sm object-cover', className)}
      />
    );
  }
  return <FileText className={cn('h-3.5 w-3.5', className, fallbackClassName)} />;
}

function formatDateLabel(value: unknown): string {
  const key = getDateKey(value);
  if (!key) return 'No date';
  const date = new Date(`${key}T12:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatPropertyValue(
  value: unknown,
  property: DatabaseProperty | null,
  folderNameById: Map<string, string>,
): string {
  if (property?.type === 'relation') {
    const ids = getRelationIds(value);
    if (!ids.length) return 'None';
    return ids.map((id) => folderNameById.get(id) ?? id).join(', ');
  }
  if (property?.type === 'date') return formatDateLabel(value);
  if (Array.isArray(value)) return value.length ? value.map((v) => String(v)).join(', ') : 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (isPresentString(value)) return value;
  return 'None';
}

function formatMonthLabel(month: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(month);
}

function startOfCalendarGrid(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const mondayIndex = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayIndex);
  return start;
}

function buildCalendarDays(month: Date): Date[] {
  const start = startOfCalendarGrid(month);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function isToday(day: Date): boolean {
  const t = new Date();
  return day.getFullYear() === t.getFullYear() && day.getMonth() === t.getMonth() && day.getDate() === t.getDate();
}

function getStatusLabel(value: unknown): string | null {
  return isPresentString(value) ? value : null;
}

type StatusTone = 'active' | 'review' | 'done' | 'blocked' | 'idea' | 'neutral';

function getStatusTone(status: string | null): StatusTone {
  if (!status) return 'neutral';
  const s = status.toLowerCase();
  if (s.includes('done') || s.includes('complete') || s.includes('ship')) return 'done';
  if (s.includes('progress') || s.includes('active') || s.includes('draft')) return 'active';
  if (s.includes('review') || s.includes('wait') || s.includes('hold')) return 'review';
  if (s.includes('block') || s.includes('stuck')) return 'blocked';
  if (s.includes('idea') || s.includes('backlog')) return 'idea';
  return 'neutral';
}

const statusPillClasses: Record<StatusTone, string> = {
  active: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  review: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  done: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  blocked: 'bg-red-500/10 text-red-700 dark:text-red-400',
  idea: 'bg-muted text-muted-foreground',
  neutral: 'bg-muted text-muted-foreground',
};

const statusDotClasses: Record<StatusTone, string> = {
  active: 'bg-amber-500',
  review: 'bg-blue-500',
  done: 'bg-emerald-500',
  blocked: 'bg-red-500',
  idea: 'bg-stone-400',
  neutral: 'bg-stone-400',
};

const statusBarClasses: Record<StatusTone, string> = {
  active: 'border-l-amber-500',
  review: 'border-l-blue-500',
  done: 'border-l-emerald-500',
  blocked: 'border-l-red-500',
  idea: 'border-l-stone-400',
  neutral: 'border-l-stone-400',
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const tone = getStatusTone(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-tight',
        statusPillClasses[tone],
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClasses[tone])} />
      {status}
    </span>
  );
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: Icon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <Icon className="mb-4 h-10 w-10 stroke-[1.5] text-muted-foreground/30" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading notes…
    </div>
  );
}

function PageIcon({ icon }: { icon: string | null | undefined }) {
  const Icon = getPhosphorIconComponent(icon);
  if (Icon) {
    return <Icon className="h-7 w-7 stroke-[1.5] text-foreground" />;
  }
  if (typeof icon === 'string' && /^https?:\/\//i.test(icon.trim())) {
    return (
      <img
        src={icon.trim()}
        alt=""
        className="h-7 w-7 rounded-md object-cover"
      />
    );
  }
  return <Boxes className="h-7 w-7 stroke-[1.5] text-foreground" />;
}

function FolderIconPicker({
  displayIcon,
  storedIcon,
  disabled,
  onChange,
  onRemove,
}: {
  displayIcon: string | null;
  storedIcon: string | null;
  disabled?: boolean;
  onChange: (icon: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedName = parsePhosphorIconName(storedIcon);
  const filteredIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return SUGGESTED_FOLDER_ICON_NAMES;
    return ALL_PHOSPHOR_ICON_NAMES
      .filter((name) => name.replace(/-/g, ' ').includes(normalizedQuery))
      .slice(0, 96);
  }, [query]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: Event) {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    const root = containerRef.current?.getRootNode();
    const eventTarget =
      root instanceof ShadowRoot || root instanceof Document
        ? root
        : document;
    eventTarget.addEventListener('pointerdown', handlePointerDown);
    return () => eventTarget.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-fit">
      <button
        type="button"
        aria-label="Edit folder icon"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="group/icon inline-flex size-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
      >
        <PageIcon icon={displayIcon} />
      </button>
      {open ? (
        <div className="absolute left-0 top-12 z-20 w-[320px] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl">
          <div className="mb-2 flex items-center gap-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search icons"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              aria-label="Close icon picker"
              onClick={() => setOpen(false)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid max-h-[220px] grid-cols-8 gap-1 overflow-y-auto pr-1">
            {filteredIcons.map((name) => {
              const Icon = getPhosphorIconComponentByName(name);
              if (!Icon) return null;

              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  aria-label={`Use ${name} icon`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onChange(`${PHOSPHOR_ICON_PREFIX}${name}`);
                    setOpen(false);
                  }}
                  className={cn(
                    'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                    selectedName === name && 'bg-muted text-foreground ring-1 ring-border',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
          {filteredIcons.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No icons found.</p>
          ) : null}
          <div className="mt-3 border-t border-border pt-2">
            <button
              type="button"
              disabled={!storedIcon}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!storedIcon) return;
                onRemove();
                setOpen(false);
              }}
              className="inline-flex h-8 w-full items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              Remove custom icon
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ViewPill({
  config,
  active,
  onSelect,
}: {
  config: TabConfig;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = config.icon;
  return (
    <button
      type="button"
      data-view={config.key}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </button>
  );
}

function PageHeader({
  title,
  icon,
  storedIcon = null,
  iconEditable = false,
  iconSaving = false,
  titleEditable = false,
  titleEditing = false,
  titleDraft = '',
  titleSaving = false,
  activeTab,
  onTabChange,
  onIconChange,
  onIconRemove,
  onStartTitleEdit,
  onTitleDraftChange,
  onSubmitTitleEdit,
  onCancelTitleEdit,
  onCreateNote,
  creatingNote = false,
}: {
  title: string;
  icon: string | null;
  storedIcon?: string | null;
  iconEditable?: boolean;
  iconSaving?: boolean;
  titleEditable?: boolean;
  titleEditing?: boolean;
  titleDraft?: string;
  titleSaving?: boolean;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onIconChange?: (icon: string) => void;
  onIconRemove?: () => void;
  onStartTitleEdit?: () => void;
  onTitleDraftChange?: (title: string) => void;
  onSubmitTitleEdit?: () => void;
  onCancelTitleEdit?: () => void;
  onCreateNote?: () => void;
  creatingNote?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 px-6 pt-6">
      {iconEditable ? (
        <FolderIconPicker
          displayIcon={icon}
          storedIcon={storedIcon}
          disabled={iconSaving}
          onChange={(nextIcon) => onIconChange?.(nextIcon)}
          onRemove={() => onIconRemove?.()}
        />
      ) : (
        <div className="flex size-10 items-center justify-center">
          <PageIcon icon={icon} />
        </div>
      )}
      {titleEditing ? (
        <input
          autoFocus
          value={titleDraft}
          onChange={(event) => onTitleDraftChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmitTitleEdit?.();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancelTitleEdit?.();
            }
          }}
          onBlur={() => onSubmitTitleEdit?.()}
          className="h-10 w-full max-w-xl rounded-md border border-border bg-background px-2 text-3xl font-bold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <h1
            className={cn(
              'min-w-0 truncate text-3xl font-bold tracking-tight text-foreground',
              titleEditable && 'cursor-text',
            )}
            onDoubleClick={titleEditable ? onStartTitleEdit : undefined}
          >
            {title}
          </h1>
          {titleEditable ? (
            <button
              type="button"
              aria-label="Rename folder"
              onClick={onStartTitleEdit}
              disabled={titleSaving}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {titleSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <ViewPill
              key={tab.key}
              config={tab}
              active={activeTab === tab.key}
              onSelect={() => onTabChange(tab.key)}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={onCreateNote}
            disabled={!onCreateNote || creatingNote}
            className="ml-1 inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60"
          >
            {creatingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {creatingNote ? 'Creating…' : 'New'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NotesPage() {
  const { app, route, collectionItem: rawCollectionItem } = useNotis();
  const navigation = useNotisNavigation();
  const { request } = useBackend();
  const { upsert: upsertNoteDocument } = useUpsertDocument(NOTE_DATABASE_SLUG);

  const [activeTab, setActiveTab] = useState<TabKey>('gallery');
  const [activeDateProperty, setActiveDateProperty] = useState(CREATED_DATE_FIELD);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [savingFolderTitle, setSavingFolderTitle] = useState(false);
  const [savingFolderIcon, setSavingFolderIcon] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderTitleDraft, setFolderTitleDraft] = useState('');
  const [editingFolderTitle, setEditingFolderTitle] = useState(false);
  const [folderTitleOverride, setFolderTitleOverride] = useState<{ id: string; title: string } | null>(null);
  const [folderIconOverride, setFolderIconOverride] = useState<{ id: string; icon: string | null } | null>(null);
  // Which bulk folder action is awaiting a target-folder pick, if any.
  const [pendingFolderAction, setPendingFolderAction] = useState<'move' | 'add' | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const folderRenameSubmittingRef = useRef(false);

  const collectionItem = normalizeCollectionItem(rawCollectionItem);
  const noteSchema = useDatabaseSchema(NOTE_DATABASE_SLUG);
  const noteProperties = noteSchema.properties;
  const titleProperty = noteProperties.find((p) => p.type === 'title');
  const titlePropertyName = titleProperty?.name ?? 'Title';
  const folderPropertyName = noteProperties.find((p) => p.type === 'relation')?.name ?? 'Folder';
  const statusPropertyName =
    noteProperties.find((p) => p.type === 'status' || p.name === 'Status')?.name ?? null;
  const dateProperties = noteProperties.filter((p) => p.type === 'date');
  const metadataProperties = noteProperties.filter((p) => p.name !== titlePropertyName);

  const activeFolderId = collectionItem?.id ?? null;
  const activeFolderTitle =
    activeFolderId && folderTitleOverride?.id === activeFolderId
      ? folderTitleOverride.title
      : collectionItem?.title ?? null;
  const activeFolderIcon =
    activeFolderId && folderIconOverride?.id === activeFolderId
      ? folderIconOverride.icon
      : collectionItem?.icon ?? null;

  const notesFilter = activeFolderId
    ? {
        filters: [
          {
            property: folderPropertyName,
            operator: 'contains',
            type: 'relation',
            value: activeFolderId,
          },
        ],
      }
    : undefined;

  const notesQuery = useDocuments(NOTE_DATABASE_SLUG, {
    filter: notesFilter,
    pageSize: 250,
    fetchAll: true,
  });
  const foldersQuery = useDocuments(FOLDER_DATABASE_SLUG, {
    pageSize: 500,
    fetchAll: true,
  });

  const { setLoading: setSearchLoading } = useTopBarSearch({
    value: searchQuery,
    onChange: setSearchQuery,
    placeholder: 'Search notes…',
    onSubmit: notesQuery.refetch,
  });

  useEffect(() => {
    setSearchLoading(notesQuery.loading);
  }, [notesQuery.loading, setSearchLoading]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const allNotes = notesQuery.documents;
  const notes = trimmedQuery
    ? allNotes.filter((note) => {
        if (getNoteTitle(note).toLowerCase().includes(trimmedQuery)) return true;
        if (isPresentString(note.plainText) && note.plainText.toLowerCase().includes(trimmedQuery)) return true;
        if (isPresentString(note.contentMarkdown) && note.contentMarkdown.toLowerCase().includes(trimmedQuery)) return true;
        return false;
      })
    : allNotes;
  const folders = foldersQuery.documents;
  const folderOptions = buildFolderOptions(folders);
  const folderNameById = new Map(folderOptions.map((f) => [f.id, f.title]));

  // Which columns the table shows is per-folder VIEW config: it never hides a
  // property from query and never changes what a note is. The active folder's
  // choice wins; with no folder selected the union across folders is shown.
  const { columns: visibleColumns } = resolveVisibleColumns({
    metadataProperties,
    activeFolderSelection: collectionItem?.properties?.[VISIBLE_PROPERTIES_PROPERTY],
    activeFolderSelected: Boolean(collectionItem),
    allFolderSelections: folders.map(
      (folder) => (folder.properties as Record<string, unknown> | undefined)?.[VISIBLE_PROPERTIES_PROPERTY],
    ),
  });

  // The calendar always offers a built-in "Created" field (sourced from each
  // note's created_at) plus any user-defined date properties on the database.
  const calendarDateFields: CalendarDateField[] = [
    { value: CREATED_DATE_FIELD, label: CREATED_DATE_LABEL },
    ...dateProperties.map((p) => ({ value: p.name, label: p.name })),
  ];
  const activeCalendarField = calendarDateFields.some((f) => f.value === activeDateProperty)
    ? activeDateProperty
    : CREATED_DATE_FIELD;

  const notesByDay = new Map<string, DocumentRecord[]>();
  for (const note of notes) {
    const key = getDateKey(getNoteDateValue(note, activeCalendarField));
    if (!key) continue;
    const bucket = notesByDay.get(key) ?? [];
    bucket.push(note);
    notesByDay.set(key, bucket);
  }
  const scheduledNotesCount = notes.filter((n) =>
    Boolean(getDateKey(getNoteDateValue(n, activeCalendarField))),
  ).length;

  const monthDays = buildCalendarDays(visibleMonth);
  const isLoading = notesQuery.loading || foldersQuery.loading || noteSchema.loading;
  const currentFolderLabel = activeFolderTitle ?? 'All notes';
  const topLevelError = errorMessage || notesQuery.error?.message || foldersQuery.error?.message || noteSchema.error?.message;
  const pageTitle = activeFolderTitle || route?.name || app?.name || 'Notes';
  const pageIcon = activeFolderIcon || route?.icon || null;

  useEffect(() => {
    setEditingFolderTitle(false);
    setFolderTitleDraft('');
    folderRenameSubmittingRef.current = false;
    setFolderIconOverride(null);
  }, [activeFolderId]);

  useEffect(() => {
    const valid =
      activeDateProperty === CREATED_DATE_FIELD ||
      dateProperties.some((p) => p.name === activeDateProperty);
    if (!valid) setActiveDateProperty(CREATED_DATE_FIELD);
  }, [activeDateProperty, dateProperties]);

  async function openNote(document: DocumentRecord) {
    navigation.toDocument(document.id, document.title);
  }

  async function createDocument() {
    setCreatingDocument(true);
    setErrorMessage(null);
    try {
      const document = await upsertNoteDocument({
        title: DEFAULT_NOTE_TITLE,
        properties: activeFolderId ? { [folderPropertyName]: [activeFolderId] } : undefined,
      });
      navigation.toDocument(document.id, document.title);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create note');
    } finally {
      setCreatingDocument(false);
    }
  }

  async function saveProperties(documentId: string, properties: Record<string, unknown>) {
    setSavingNoteId(documentId);
    setErrorMessage(null);
    try {
      await upsertNoteDocument({ documentId, properties });
      notesQuery.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save note');
    } finally {
      setSavingNoteId(null);
    }
  }

  async function saveTitle(documentId: string, nextTitle: string) {
    const normalized = nextTitle.trim() || DEFAULT_NOTE_TITLE;
    setSavingNoteId(documentId);
    setErrorMessage(null);
    try {
      await upsertNoteDocument({ documentId, title: normalized });
      notesQuery.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to rename note');
    } finally {
      setSavingNoteId(null);
    }
  }

  function startFolderTitleEdit() {
    if (!activeFolderId) return;
    setFolderTitleDraft(activeFolderTitle ?? '');
    setEditingFolderTitle(true);
  }

  function cancelFolderTitleEdit() {
    setEditingFolderTitle(false);
    setFolderTitleDraft('');
    folderRenameSubmittingRef.current = false;
  }

  async function submitFolderTitleEdit() {
    if (folderRenameSubmittingRef.current) return;
    if (!activeFolderId || !app?.id || !route?.slug) {
      cancelFolderTitleEdit();
      return;
    }

    const previousTitle = activeFolderTitle ?? collectionItem?.title ?? '';
    const nextTitle = folderTitleDraft.trim();
    if (!nextTitle || nextTitle === previousTitle) {
      cancelFolderTitleEdit();
      return;
    }

    folderRenameSubmittingRef.current = true;
    setEditingFolderTitle(false);
    setFolderTitleOverride({ id: activeFolderId, title: nextTitle });
    setSavingFolderTitle(true);
    setErrorMessage(null);
    try {
      const response = await request('/portal_views/collection_tree/rename', {
        method: 'POST',
        body: {
          app_id: app.id,
          route_slug: route.slug,
          item_id: activeFolderId,
          title: nextTitle,
        },
      }) as { item?: { title?: unknown } };
      const savedTitle = typeof response.item?.title === 'string' && response.item.title.trim()
        ? response.item.title
        : nextTitle;
      setFolderTitleOverride({ id: activeFolderId, title: savedTitle });
      foldersQuery.refetch();
    } catch (error) {
      setFolderTitleOverride(previousTitle ? { id: activeFolderId, title: previousTitle } : null);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to rename folder');
    } finally {
      setSavingFolderTitle(false);
      setFolderTitleDraft('');
      folderRenameSubmittingRef.current = false;
    }
  }

  async function saveFolderIcon(nextIcon: string | null) {
    if (!activeFolderId || !app?.id || !route?.slug) return;
    if (nextIcon === activeFolderIcon) return;

    const previousIcon = activeFolderIcon;
    setFolderIconOverride({ id: activeFolderId, icon: nextIcon });
    setSavingFolderIcon(true);
    setErrorMessage(null);
    try {
      const response = await request('/portal_views/collection_tree/icon', {
        method: 'POST',
        body: {
          app_id: app.id,
          route_slug: route.slug,
          item_id: activeFolderId,
          icon: nextIcon,
        },
      }) as { item?: { icon?: unknown } };
      const savedIcon = typeof response.item?.icon === 'string' ? response.item.icon : null;
      setFolderIconOverride({ id: activeFolderId, icon: savedIcon });
      foldersQuery.refetch();
    } catch (error) {
      setFolderIconOverride({ id: activeFolderId, icon: previousIcon });
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update folder icon');
    } finally {
      setSavingFolderIcon(false);
    }
  }

  // Holds both table rows and gallery cards so Shift+Arrow can scroll the head
  // into view regardless of the active view.
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const selectionEnabled = activeTab !== 'calendar';
  const multiSelect = useMultiSelect<DocumentRecord>({
    items: notes,
    getId: (note) => note.id,
    bindKeyboardShortcuts: selectionEnabled,
    enableDragSelect: selectionEnabled,
    onHeadChange: (id) => {
      if (!id) return;
      rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest' });
    },
  });

  // Clear the selection when the visible set changes out from under it (folder
  // switch) or when entering a view that can't act on a selection (calendar),
  // so bulk actions never apply to off-screen notes.
  const clearSelection = multiSelect.clear;
  useEffect(() => {
    clearSelection();
  }, [activeFolderId, clearSelection]);
  useEffect(() => {
    if (!selectionEnabled) clearSelection();
  }, [selectionEnabled, clearSelection]);

  // Runs `apply` for each selected note in parallel, then clears + refetches.
  // `apply` receives the full note so handlers can read its current properties.
  async function runBulk(
    apply: (note: DocumentRecord) => UpsertDocumentArgs,
    failureMessage: string,
  ) {
    const selected = multiSelect.getSelectedItems();
    if (selected.length === 0) return;
    setBulkRunning(true);
    setErrorMessage(null);
    try {
      await Promise.all(selected.map((note) => upsertNoteDocument(apply(note))));
      multiSelect.clear();
      notesQuery.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : failureMessage);
    } finally {
      setBulkRunning(false);
    }
  }

  function bulkClearFolder() {
    return runBulk(
      (note) => ({ documentId: note.id, properties: { [folderPropertyName]: [] } }),
      'Failed to update notes',
    );
  }

  function bulkDelete() {
    return runBulk(
      (note) => ({ documentId: note.id, operation: 'archive' }),
      'Failed to delete notes',
    );
  }

  function bulkMoveToFolder(folderId: string) {
    return runBulk(
      (note) => ({ documentId: note.id, properties: { [folderPropertyName]: [folderId] } }),
      'Failed to move notes',
    );
  }

  function bulkAddToFolder(folderId: string) {
    return runBulk(
      (note) => ({
        documentId: note.id,
        properties: {
          [folderPropertyName]: Array.from(
            new Set([...getRelationIds(note.properties[folderPropertyName]), folderId]),
          ),
        },
      }),
      'Failed to add notes to folder',
    );
  }

  async function handleFolderPick(folderId: string) {
    const action = pendingFolderAction;
    setPendingFolderAction(null);
    if (!action) return;
    if (action === 'move') await bulkMoveToFolder(folderId);
    else await bulkAddToFolder(folderId);
  }

  return (
    <main data-store-screenshot="notes" className="flex min-h-screen flex-col bg-background">
      <PageHeader
        title={pageTitle}
        icon={pageIcon}
        storedIcon={activeFolderIcon}
        iconEditable={Boolean(activeFolderId)}
        iconSaving={savingFolderIcon}
        onIconChange={(nextIcon) => void saveFolderIcon(nextIcon)}
        onIconRemove={() => void saveFolderIcon(null)}
        titleEditable={Boolean(activeFolderId)}
        titleEditing={editingFolderTitle}
        titleDraft={folderTitleDraft}
        titleSaving={savingFolderTitle}
        onStartTitleEdit={startFolderTitleEdit}
        onTitleDraftChange={setFolderTitleDraft}
        onSubmitTitleEdit={() => void submitFolderTitleEdit()}
        onCancelTitleEdit={cancelFolderTitleEdit}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onCreateNote={() => void createDocument()}
        creatingNote={creatingDocument}
      />

      {topLevelError ? (
        <div className="mx-6 mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {topLevelError}
        </div>
      ) : null}

      {isLoading ? <LoadingState /> : null}

      {!isLoading && activeTab === 'gallery' ? (
        <GalleryBody
          notes={notes}
          statusPropertyName={statusPropertyName}
          onOpenNote={openNote}
          onCreateDocument={createDocument}
          creatingDocument={creatingDocument}
          currentFolderLabel={currentFolderLabel}
          hasCollectionItem={Boolean(activeFolderId)}
          multiSelect={multiSelect}
          rowRefs={rowRefs.current}
        />
      ) : null}

      {!isLoading && activeTab === 'table' ? (
        <TableBody
          notes={notes}
          metadataProperties={metadataProperties}
          visibleColumns={visibleColumns}
          folderOptions={folderOptions}
          folderNameById={folderNameById}
          folderPropertyName={folderPropertyName}
          savingNoteId={savingNoteId}
          onOpen={openNote}
          onSaveTitle={saveTitle}
          onSaveProperties={saveProperties}
          currentFolderLabel={currentFolderLabel}
          hasCollectionItem={Boolean(activeFolderId)}
          multiSelect={multiSelect}
          rowRefs={rowRefs.current}
        />
      ) : null}

      {!isLoading && activeTab === 'calendar' ? (
        <CalendarBody
          monthDays={monthDays}
          visibleMonth={visibleMonth}
          setVisibleMonth={setVisibleMonth}
          notesByDay={notesByDay}
          statusPropertyName={statusPropertyName}
          calendarDateFields={calendarDateFields}
          activeDateProperty={activeCalendarField}
          setActiveDateProperty={setActiveDateProperty}
          scheduledNotesCount={scheduledNotesCount}
          onOpen={openNote}
        />
      ) : null}

      {selectionEnabled ? (
        <>
          <MultiSelectDragOverlay rect={multiSelect.dragRect} />
          {pendingFolderAction ? (
            <BulkFolderPicker
              mode={pendingFolderAction}
              folderOptions={folderOptions}
              busy={bulkRunning}
              onPick={(folderId) => void handleFolderPick(folderId)}
              onClose={() => setPendingFolderAction(null)}
            />
          ) : null}
          <MultiSelectActionBar
            selectedCount={multiSelect.selectedCount}
            itemLabel={{ singular: 'note', plural: 'notes' }}
            actions={[
              {
                id: 'move-folder',
                label: 'Move to folder',
                shortcut: 'M',
                icon: <FolderOpen className="h-3.5 w-3.5" />,
                onRun: () => setPendingFolderAction('move'),
              },
              {
                id: 'add-folder',
                label: 'Add to folder',
                shortcut: 'F',
                icon: <FolderPlus className="h-3.5 w-3.5" />,
                onRun: () => setPendingFolderAction('add'),
              },
              {
                id: 'clear-folder',
                label: 'Move out of folder',
                icon: <FolderMinus className="h-3.5 w-3.5" />,
                onRun: bulkClearFolder,
              },
              {
                id: 'delete',
                label: 'Delete',
                shortcut: '#',
                destructive: true,
                icon: <Trash className="h-3.5 w-3.5" />,
                onRun: bulkDelete,
              },
            ]}
          />
        </>
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Gallery view                                                                */
/* -------------------------------------------------------------------------- */

function GalleryBody({
  notes,
  statusPropertyName,
  onOpenNote,
  onCreateDocument,
  creatingDocument,
  currentFolderLabel,
  hasCollectionItem,
  multiSelect,
  rowRefs,
}: {
  notes: DocumentRecord[];
  statusPropertyName: string | null;
  onOpenNote: (doc: DocumentRecord) => void;
  onCreateDocument: () => Promise<void>;
  creatingDocument: boolean;
  currentFolderLabel: string;
  hasCollectionItem: boolean;
  multiSelect: MultiSelectController<DocumentRecord>;
  rowRefs: Map<string, HTMLElement>;
}) {
  if (!notes.length) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={hasCollectionItem ? 'No notes in this folder' : 'No notes yet'}
        description={
          hasCollectionItem
            ? `Create the first note in ${currentFolderLabel}.`
            : 'Folders live in the sidebar. Create a note here to get started.'
        }
        action={
          <Button
            size="sm"
            onClick={() => void onCreateDocument()}
            disabled={creatingDocument}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {creatingDocument ? 'Creating…' : 'New note'}
          </Button>
        }
      />
    );
  }

  return (
    <div
      {...multiSelect.getContainerProps()}
      className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 xl:grid-cols-4"
    >
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          statusPropertyName={statusPropertyName}
          onOpen={() => onOpenNote(note)}
          isSelected={multiSelect.isSelected(note.id)}
          itemProps={multiSelect.getItemProps(note.id)}
          checkboxProps={multiSelect.getCheckboxProps(note.id)}
          cardRef={(node) => {
            if (node) {
              rowRefs.set(note.id, node);
            } else {
              rowRefs.delete(note.id);
            }
          }}
        />
      ))}
    </div>
  );
}

function NoteCard({
  note,
  statusPropertyName,
  onOpen,
  isSelected,
  itemProps,
  checkboxProps,
  cardRef,
}: {
  note: DocumentRecord;
  statusPropertyName: string | null;
  onOpen: () => void;
  isSelected: boolean;
  itemProps: { 'data-notis-row-id': string; onMouseDown: (event: React.MouseEvent) => void };
  checkboxProps: { isSelected: boolean; onClick: (event: React.MouseEvent) => void };
  cardRef: (node: HTMLDivElement | null) => void;
}) {
  const status = statusPropertyName ? getStatusLabel(note.properties[statusPropertyName]) : null;
  const coverUrl = getCoverUrl(note);
  const title = getNoteTitle(note);
  const previewText = getNotePreviewText(note);

  // A plain div (no `role="button"`) so the SDK's drag-select can arm from a
  // card body; keyboard access is preserved via tabIndex + Enter.
  return (
    <div
      {...itemProps}
      ref={cardRef}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left',
        'transition-colors hover:border-foreground/20 hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected ? 'border-primary ring-2 ring-primary' : 'border-border',
      )}
    >
      <div className="absolute left-2 top-2 z-10">
        <MultiSelectCheckbox
          {...checkboxProps}
          alwaysVisible={isSelected}
          ariaLabel={isSelected ? 'Deselect note' : 'Select note'}
          className={cn(
            'transition-opacity',
            !isSelected && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        />
      </div>
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full bg-card px-5 py-5 text-foreground sm:px-6">
            <p className="line-clamp-5 text-xl font-semibold leading-snug text-foreground/75 sm:text-2xl">
              {previewText}
            </p>
          </div>
        )}
        {status ? (
          <div className="absolute right-2 top-2">
            <StatusPill status={status} />
          </div>
        ) : null}
      </div>
      <div className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2">
        <NoteIcon icon={note.icon} className="shrink-0 text-muted-foreground" />
        <span className="line-clamp-1 text-[12.5px] text-foreground">
          {title}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bulk folder picker (Move to / Add to folder)                                */
/* -------------------------------------------------------------------------- */

function BulkFolderPicker({
  mode,
  folderOptions,
  busy,
  onPick,
  onClose,
}: {
  mode: 'move' | 'add';
  folderOptions: FolderOption[];
  busy: boolean;
  onPick: (folderId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? folderOptions.filter((f) => f.pathLabel.toLowerCase().includes(normalizedQuery))
    : folderOptions;

  useEffect(() => {
    function handlePointerDown(event: Event) {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      onClose();
    }
    const root = containerRef.current?.getRootNode();
    const eventTarget =
      root instanceof ShadowRoot || root instanceof Document ? root : document;
    eventTarget.addEventListener('pointerdown', handlePointerDown);
    return () => eventTarget.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={mode === 'move' ? 'Move notes to folder' : 'Add notes to folder'}
      className="fixed bottom-16 left-1/2 z-[70] w-[320px] -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-foreground">
          {mode === 'move' ? 'Move to folder' : 'Add to folder'}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-background px-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search folders"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {filtered.length ? (
          filtered.map((folder) => (
            <button
              key={folder.id}
              type="button"
              disabled={busy}
              onClick={() => onPick(folder.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{folder.pathLabel}</span>
            </button>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No folders found.</p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Table view                                                                  */
/* -------------------------------------------------------------------------- */

function TableBody({
  notes,
  metadataProperties,
  visibleColumns,
  folderOptions,
  folderNameById,
  folderPropertyName,
  savingNoteId,
  onOpen,
  onSaveTitle,
  onSaveProperties,
  currentFolderLabel,
  hasCollectionItem,
  multiSelect,
  rowRefs,
}: {
  notes: DocumentRecord[];
  metadataProperties: DatabaseProperty[];
  visibleColumns?: DatabaseProperty[];
  folderOptions: FolderOption[];
  folderNameById: Map<string, string>;
  folderPropertyName: string;
  savingNoteId: string | null;
  onOpen: (doc: DocumentRecord) => void;
  onSaveTitle: (id: string, title: string) => void;
  onSaveProperties: (id: string, props: Record<string, unknown>) => void;
  currentFolderLabel: string;
  hasCollectionItem: boolean;
  multiSelect: MultiSelectController<DocumentRecord>;
  rowRefs: Map<string, HTMLElement>;
}) {
  const columns = visibleColumns ?? metadataProperties.slice(0, 6);
  const allSelected =
    notes.length > 0 && notes.every((note) => multiSelect.isSelected(note.id));
  const handleSelectAllToggle = () => {
    if (allSelected) {
      multiSelect.clear();
      return;
    }
    multiSelect.select(notes.map((note) => note.id));
  };

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-5">
      {!notes.length ? (
        <EmptyState
          icon={Table2}
          title={hasCollectionItem ? 'No rows in this folder' : 'No rows yet'}
          description={
            hasCollectionItem
              ? `Create a note in ${currentFolderLabel} to start editing metadata here.`
              : 'Notes become rows here. Create one to begin editing metadata inline.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div {...multiSelect.getContainerProps()} className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="w-10 px-3 py-2.5">
                    <MultiSelectCheckbox
                      isSelected={allSelected}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectAllToggle();
                      }}
                      alwaysVisible
                      ariaLabel={allSelected ? 'Deselect all notes' : 'Select all notes'}
                    />
                  </th>
                  <th className="px-3 py-2.5 text-left">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <Eyebrow>Note</Eyebrow>
                    </div>
                  </th>
                  {columns.map((p) => (
                    <th key={p.name} className="border-l border-border px-3 py-2.5 text-left">
                      <Eyebrow>{p.name}</Eyebrow>
                    </th>
                  ))}
                  <th className="w-10 border-l border-border" />
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <TableRow
                    key={note.id}
                    note={note}
                    columns={columns}
                    folderOptions={folderOptions}
                    folderNameById={folderNameById}
                    folderPropertyName={folderPropertyName}
                    saving={savingNoteId === note.id}
                    onOpen={() => onOpen(note)}
                    onSaveTitle={(title) => onSaveTitle(note.id, title)}
                    onSaveProperties={(props) => onSaveProperties(note.id, props)}
                    isSelected={multiSelect.isSelected(note.id)}
                    onCheckboxClick={multiSelect.onCheckboxClick(note.id)}
                    onRowMouseDown={multiSelect.onRowMouseDown(note.id)}
                    rowProps={multiSelect.getRowProps(note.id)}
                    rowRef={(node) => {
                      if (node) {
                        rowRefs.set(note.id, node);
                      } else {
                        rowRefs.delete(note.id);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TableRow({
  note,
  columns,
  folderOptions,
  folderNameById,
  folderPropertyName,
  saving,
  onOpen,
  onSaveTitle,
  onSaveProperties,
  isSelected,
  onCheckboxClick,
  onRowMouseDown,
  rowProps,
  rowRef,
}: {
  note: DocumentRecord;
  columns: DatabaseProperty[];
  folderOptions: FolderOption[];
  folderNameById: Map<string, string>;
  folderPropertyName: string;
  saving: boolean;
  onOpen: () => void;
  onSaveTitle: (title: string) => void;
  onSaveProperties: (props: Record<string, unknown>) => void;
  isSelected: boolean;
  onCheckboxClick: (event: React.MouseEvent) => void;
  onRowMouseDown: (event: React.MouseEvent) => void;
  rowProps: Record<string, string>;
  rowRef: (node: HTMLTableRowElement | null) => void;
}) {
  return (
    <tr
      {...rowProps}
      ref={rowRef}
      className={cn(
        'group border-b border-border last:border-b-0 transition-colors',
        saving ? 'bg-muted/20' : 'hover:bg-muted/30',
        isSelected && 'bg-primary/5 hover:bg-primary/10',
      )}
      onClick={onOpen}
      onMouseDown={onRowMouseDown}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
    >
      <td className="px-3 py-2">
        <MultiSelectCheckbox
          isSelected={isSelected}
          onClick={onCheckboxClick}
          alwaysVisible={isSelected}
          className={cn(
            'transition-opacity',
            !isSelected && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-muted">
            <FileText className="h-3 w-3 text-muted-foreground" />
          </div>
          <input
            type="text"
            defaultValue={getNoteTitle(note)}
            key={`${note.id}:title:${getNoteTitle(note)}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={(e) => onSaveTitle(e.target.value)}
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium text-foreground outline-none transition-colors focus:border-border focus:bg-background"
          />
          <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
        </div>
      </td>
      {columns.map((prop) => (
        <td key={prop.name} className="border-l border-border px-3 py-2 align-middle">
          <TableCell
            note={note}
            property={prop}
            folderOptions={folderOptions}
            folderNameById={folderNameById}
            folderPropertyName={folderPropertyName}
            onSaveProperties={onSaveProperties}
          />
        </td>
      ))}
      <td className="w-10 border-l border-border" />
    </tr>
  );
}

function TableCell({
  note,
  property,
  folderOptions,
  folderNameById,
  folderPropertyName,
  onSaveProperties,
}: {
  note: DocumentRecord;
  property: DatabaseProperty;
  folderOptions: FolderOption[];
  folderNameById: Map<string, string>;
  folderPropertyName: string;
  onSaveProperties: (props: Record<string, unknown>) => void;
}) {
  const value = note.properties[property.name];
  const selectClass =
    'w-full appearance-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12px] text-foreground outline-none transition-colors focus:border-border focus:bg-background';

  if (property.type === 'status' || property.type === 'select') {
    const label = isPresentString(value) ? value : '';
    return (
      <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
        {label ? (
          <StatusPill status={label} />
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">None</span>
        )}
        <select
          aria-label={property.name}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={label}
          onChange={(e) => onSaveProperties({ [property.name]: e.target.value || null })}
        >
          <option value="">None</option>
          {(property.options ?? []).map((opt) => (
            <option key={opt.id ?? opt.name} value={opt.name}>
              {opt.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (property.type === 'date') {
    return (
      <input
        type="date"
        value={getDateInputValue(value)}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onSaveProperties({ [property.name]: e.target.value || null })}
        className={cn(selectClass, 'text-[12px]')}
      />
    );
  }

  if (property.type === 'checkbox') {
    return (
      <label
        className="inline-flex items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onSaveProperties({ [property.name]: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-border"
        />
      </label>
    );
  }

  if (property.type === 'relation' && property.name === folderPropertyName) {
    const currentId = getRelationIds(value)[0] ?? '';
    return (
      <select
        className={cn(selectClass, 'text-[12px]')}
        value={currentId}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onSaveProperties({ [property.name]: e.target.value ? [e.target.value] : [] })}
      >
        <option value="">No folder</option>
        {folderOptions.map((f) => (
          <option key={f.id} value={f.id}>
            {f.pathLabel}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === 'number') {
    return (
      <input
        type="number"
        defaultValue={typeof value === 'number' ? String(value) : ''}
        inputMode="decimal"
        key={`${note.id}:${property.name}:${String(value ?? '')}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const v = e.target.value.trim();
          onSaveProperties({ [property.name]: v ? Number(v) : null });
        }}
        className={cn(selectClass, 'font-mono text-[12px]')}
      />
    );
  }

  if (property.type === 'rich_text') {
    return (
      <input
        type="text"
        defaultValue={isPresentString(value) ? value : ''}
        key={`${note.id}:${property.name}:${String(value ?? '')}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const v = e.target.value.trim();
          onSaveProperties({ [property.name]: v || null });
        }}
        className={cn(selectClass, 'text-[12px]')}
      />
    );
  }

  return (
    <span className="px-1.5 text-[12px] text-muted-foreground">
      {formatPropertyValue(value, property, folderNameById)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Calendar view                                                               */
/* -------------------------------------------------------------------------- */

function CalendarBody({
  monthDays,
  visibleMonth,
  setVisibleMonth,
  notesByDay,
  statusPropertyName,
  calendarDateFields,
  activeDateProperty,
  setActiveDateProperty,
  scheduledNotesCount,
  onOpen,
}: {
  monthDays: Date[];
  visibleMonth: Date;
  setVisibleMonth: (d: Date) => void;
  notesByDay: Map<string, DocumentRecord[]>;
  statusPropertyName: string | null;
  calendarDateFields: CalendarDateField[];
  activeDateProperty: string;
  setActiveDateProperty: (v: string) => void;
  scheduledNotesCount: number;
  onOpen: (doc: DocumentRecord) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-0 rounded-lg border border-border bg-background p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="px-2 text-[13px] font-semibold tracking-tight text-foreground">
            {formatMonthLabel(visibleMonth)}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setVisibleMonth(new Date())}>
          Today
        </Button>

        <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px]">
          <CalendarDays className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Date field</span>
          <select
            className="appearance-none bg-transparent pr-3 font-semibold text-foreground outline-none"
            value={activeDateProperty}
            onChange={(e) => setActiveDateProperty(e.target.value)}
          >
            {calendarDateFields.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </select>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </div>

        <div className="flex-1" />
        <Eyebrow>{pluralize(scheduledNotesCount, 'note')} scheduled</Eyebrow>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="grid grid-cols-7 border-b border-border bg-muted/40">
            {WEEKDAY_LABELS.map((label, i) => (
              <div
                key={label}
                className={cn(
                  'px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em]',
                  i >= 5 ? 'text-muted-foreground/60' : 'text-muted-foreground',
                )}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day) => {
              const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
              const dayNotes = notesByDay.get(key) ?? [];
              const inMonth = isSameMonth(day, visibleMonth);
              const today = isToday(day);
              return (
                <div
                  key={key}
                  className={cn(
                    'flex min-h-[110px] flex-col gap-1.5 border-b border-r border-border px-2 py-2',
                    !inMonth && 'bg-muted/30',
                  )}
                >
                  <div className="flex items-center justify-between">
                    {today ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                        {day.getDate()}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'text-[12px] font-medium',
                          inMonth ? 'text-foreground/80' : 'text-muted-foreground/50',
                        )}
                      >
                        {day.getDate()}
                      </span>
                    )}
                    {today ? <Eyebrow className="text-foreground">Today</Eyebrow> : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    {dayNotes.slice(0, 3).map((note) => {
                      const status = statusPropertyName
                        ? getStatusLabel(note.properties[statusPropertyName])
                        : null;
                      const tone = getStatusTone(status);
                      return (
                        <button
                          key={note.id}
                          type="button"
                          onClick={() => onOpen(note)}
                          className={cn(
                            'line-clamp-1 rounded-md border border-l-2 border-border bg-background px-2 py-1 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50',
                            statusBarClasses[tone],
                          )}
                        >
                          {getNoteTitle(note)}
                        </button>
                      );
                    })}
                    {dayNotes.length > 3 ? (
                      <span className="px-1 text-[10px] text-muted-foreground">+{dayNotes.length - 3} more</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
      </div>
    </div>
  );
}
