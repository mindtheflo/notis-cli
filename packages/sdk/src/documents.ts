/**
 * Document data helpers: normalize raw tool results (Notion-shaped property
 * values, snake_case fields) into the SDK's `DocumentRecord`/`DatabaseProperty`
 * shapes, and derive plain-text projections from typed content.
 *
 * These are pure functions — safe in any context (portal, dev harness, tests).
 */

import type {
  DatabaseProperty,
  DatabasePropertyOption,
  DatabasePropertyType,
  DocumentContentType,
  DocumentRecord,
  SecretPropertyValue,
} from './runtime';

// ---------------------------------------------------------------------------
// Value primitives
// ---------------------------------------------------------------------------

export function isPresentString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function optionalString(value: unknown): string | null {
  return isPresentString(value) ? value.trim() : null;
}

/** Flattens a Notion-shaped rich_text array (or plain string) to text. */
export function extractRichText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      const record = asRecord(item);
      const text = asRecord(record?.text);
      return optionalString(text?.content) ?? optionalString(record?.plain_text) ?? '';
    })
    .join('');
}

/**
 * Reads a `secret` property value. The platform only ever sends the pointer
 * ({present, reference, status, metadata}), so this rebuilds it field by field
 * rather than passing the payload through — an app can never surface secret
 * material through this helper, whatever the server sent.
 */
export function getSecretValue(value: unknown): SecretPropertyValue {
  const record = asRecord(value);
  const metadata = asRecord(record?.metadata);
  return {
    present: record?.present === true,
    reference: optionalString(record?.reference),
    status: optionalString(record?.status),
    metadata,
  };
}

/** Extracts the ids of a normalized relation property value. */
export function getRelationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => isPresentString(item));
}

// ---------------------------------------------------------------------------
// Property + document normalization
// ---------------------------------------------------------------------------

/**
 * Collapses a Notion-shaped property value ({type: 'select', select: {...}})
 * into a plain JS value (string, string[], number, boolean, ...). Values that
 * are already plain pass through unchanged.
 */
export function normalizePropertyValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;

  const type = optionalString(record.type);
  if (!type) return value;

  if (type === 'title') return extractRichText(record.title);
  if (type === 'rich_text') return extractRichText(record.rich_text);
  if (type === 'select' || type === 'status') {
    return optionalString(asRecord(record[type])?.name) ?? record[type] ?? null;
  }
  if (type === 'multi_select') {
    const items = Array.isArray(record.multi_select) ? record.multi_select : [];
    return items.map((item) => optionalString(asRecord(item)?.name) ?? item).filter(Boolean);
  }
  if (type === 'relation') {
    const items = Array.isArray(record.relation) ? record.relation : [];
    return items.map((item) => optionalString(asRecord(item)?.id) ?? item).filter(Boolean);
  }
  if (type === 'date') return optionalString(asRecord(record.date)?.start) ?? record.date ?? null;
  // Before the `type in record` fallthrough: a secret value has no `secret`
  // key, so passing it through would hand the caller the raw payload.
  if (type === 'secret') return getSecretValue(record);
  if (type in record) return record[type];
  return value;
}

function normalizeContentType(value: unknown): DocumentContentType | null {
  return value === 'markdown' || value === 'file' || value === 'view' ? value : null;
}

/**
 * Normalizes a raw document from a Notis database tool result
 * (LOCAL_NOTIS_DATABASE_QUERY / GET_DOCUMENT / UPSERT_*) into a
 * `DocumentRecord`: camelCases fields and collapses property values.
 */
export function normalizeDocumentRecord(value: unknown): DocumentRecord {
  const record = asRecord(value) ?? {};
  const rawProperties = asRecord(record.properties) ?? {};
  const properties: Record<string, unknown> = {};
  for (const [key, propertyValue] of Object.entries(rawProperties)) {
    properties[key] = normalizePropertyValue(propertyValue);
  }

  return {
    id: optionalString(record.id) ?? '',
    title: optionalString(record.title) ?? 'Untitled',
    url: optionalString(record.url),
    properties,
    icon: optionalString(record.icon),
    cover: optionalString(record.cover),
    databaseSlug: optionalString(record.databaseSlug) ?? optionalString(record.database_slug) ?? undefined,
    contentType: normalizeContentType(record.contentType ?? record.content_type),
    fileType: optionalString(record.fileType) ?? optionalString(record.file_type),
    contentBlocknote: Array.isArray(record.contentBlocknote)
      ? (record.contentBlocknote as Array<Record<string, unknown>>)
      : Array.isArray(record.content_blocknote)
        ? (record.content_blocknote as Array<Record<string, unknown>>)
        : null,
    contentMarkdown: optionalString(record.contentMarkdown) ?? optionalString(record.content_markdown),
    plainText: optionalString(record.plainText) ?? optionalString(record.plain_text),
    viewType: optionalString(record.viewType) ?? optionalString(record.view_type),
    viewState: asRecord(record.viewState) ?? asRecord(record.view_state),
    viewRevision:
      typeof (record.viewRevision ?? record.view_revision) === 'number'
        ? Number(record.viewRevision ?? record.view_revision)
        : null,
    createdAt:
      optionalString(record.createdAt)
      ?? optionalString(record.created_at)
      ?? optionalString(record.created_time),
    lastEditedTime:
      optionalString(record.lastEditedTime)
      ?? optionalString(record.last_edited_time)
      ?? optionalString(record.updated_at),
  };
}

/** Normalizes a raw schema property from LOCAL_NOTIS_DATABASE_GET_DATABASE. */
export function normalizeDatabaseProperty(value: unknown): DatabaseProperty | null {
  const record = asRecord(value);
  const name = optionalString(record?.name);
  if (!record || !name) return null;

  const rawOptions = Array.isArray(record.options) ? record.options : [];
  const options = rawOptions.flatMap((option): DatabasePropertyOption[] => {
    const optionRecord = asRecord(option);
    const optionName = optionalString(optionRecord?.name);
    if (!optionRecord || !optionName) return [];
    return [{
      id: optionalString(optionRecord.id),
      name: optionName,
      color: optionalString(optionRecord.color),
      order: typeof optionRecord.order === 'number' ? optionRecord.order : undefined,
    }];
  });

  return {
    id: optionalString(record.id),
    name,
    type: (optionalString(record.type) ?? 'rich_text') as DatabasePropertyType,
    description: optionalString(record.description),
    options,
  };
}

// ---------------------------------------------------------------------------
// Plain-text projections
// ---------------------------------------------------------------------------

/** Strips markdown syntax to readable plain text (previews, search). */
export function markdownToPlainText(markdown: string): string {
  return markdown
    // fenced code blocks: keep the code, drop the fences
    .replace(/```[^\n]*\n?/g, '')
    // images: keep alt text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // links: keep link text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // html tags
    .replace(/<[^>]+>/g, ' ')
    // headings, blockquotes, list markers, task boxes
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/gm, '')
    // emphasis / strikethrough / inline code
    .replace(/(\*\*|__|[*_~`])/g, '')
    // table separators and pipes
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, '')
    .replace(/\|/g, ' ')
    // horizontal rules
    .replace(/^\s*([-*_]\s*){3,}$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Flattens BlockNote block JSON to plain text. */
export function blockNoteToPlainText(blocks: unknown): string {
  const segments: string[] = [];

  function visit(node: unknown): void {
    if (typeof node === 'string') {
      if (node.trim()) segments.push(node.trim());
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    if (typeof record.text === 'string' && record.text.trim()) {
      segments.push(record.text.trim());
    }
    visit(record.content);
    visit(record.children);
  }

  visit(blocks);
  return segments.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Best-available plain-text preview for a document:
 * plainText -> contentMarkdown -> contentBlocknote -> title.
 */
export function getDocumentPreview(document: DocumentRecord): string {
  if (isPresentString(document.plainText)) {
    return document.plainText.replace(/\s+/g, ' ').trim();
  }
  if (isPresentString(document.contentMarkdown)) {
    return markdownToPlainText(document.contentMarkdown);
  }
  const fromBlocks = blockNoteToPlainText(document.contentBlocknote);
  if (fromBlocks) return fromBlocks;
  return isPresentString(document.title) ? document.title : 'Untitled';
}
