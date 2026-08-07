import type { Mode } from '@/lib/rng';

export interface RollDocument {
  id: string;
  title?: string;
  properties?: Record<string, unknown>;
  createdAt?: string | null;
  created_at?: string | null;
  created_time?: string | null;
  createdTime?: string | null;
  lastEditedTime?: string | null;
  last_edited_time?: string | null;
  updated_at?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Flattens a Notion-shaped rich_text / title array to plain text. */
function flattenRichText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      const record = asRecord(item);
      const text = asRecord(record?.text);
      if (typeof text?.content === 'string') return text.content;
      if (typeof record?.plain_text === 'string') return record.plain_text;
      return '';
    })
    .join('');
}

/**
 * Collapses a Notion-shaped property value (`{type: 'number', number: 42}`)
 * to the underlying primitive. The native database tools return this shape,
 * while fixtures and older rows may already be flat, so both are accepted and
 * anything unrecognised passes straight through.
 */
export function unwrapProperty(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;

  const type = typeof record.type === 'string' ? record.type : null;
  if (!type) return value;

  if (type === 'title') return flattenRichText(record.title);
  if (type === 'rich_text') return flattenRichText(record.rich_text);
  if (type === 'select' || type === 'status') {
    const inner = asRecord(record[type]);
    return typeof inner?.name === 'string' ? inner.name : (record[type] ?? null);
  }
  if (type === 'date') {
    const inner = asRecord(record.date);
    return typeof inner?.start === 'string' ? inner.start : (record.date ?? null);
  }
  if (type in record) return record[type];
  return value;
}

function readString(value: unknown): string | null {
  const unwrapped = unwrapProperty(value);
  if (typeof unwrapped === 'string') {
    const trimmed = unwrapped.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof unwrapped === 'number' || typeof unwrapped === 'boolean') {
    return String(unwrapped);
  }
  const record = asRecord(unwrapped);
  if (record) {
    if (typeof record.name === 'string') return record.name;
    if (typeof record.start === 'string') return record.start;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  const unwrapped = unwrapProperty(value);
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) {
    return unwrapped;
  }
  const stringValue = readString(unwrapped);
  if (!stringValue) {
    return null;
  }
  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function readMode(value: unknown): Mode {
  const raw = readString(value)?.toLowerCase();
  if (raw === 'integer' || raw === 'decimal' || raw === 'dice') {
    return raw;
  }
  return 'integer';
}

function readTimestamp(doc: RollDocument): string {
  return (
    readString(doc.properties?.['Rolled At']) ||
    doc.createdAt ||
    doc.created_at ||
    doc.created_time ||
    doc.createdTime ||
    doc.lastEditedTime ||
    doc.last_edited_time ||
    doc.updated_at ||
    ''
  );
}

function sortTimestamp(value: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface RollRecord {
  id: string;
  value: number;
  mode: Mode;
  min: number | null;
  max: number | null;
  at: string;
}

export function normalizeRollRecord(doc: RollDocument): RollRecord {
  const value =
    readNumber(doc.properties?.['Value']) ??
    readNumber(doc.properties?.['Name']) ??
    readNumber(doc.title) ??
    0;

  return {
    id: doc.id,
    value,
    mode: readMode(doc.properties?.['Mode']),
    min: readNumber(doc.properties?.['Min']),
    max: readNumber(doc.properties?.['Max']),
    at: readTimestamp(doc),
  };
}

export function sortRollRecordsDesc(a: RollRecord, b: RollRecord): number {
  return sortTimestamp(b.at) - sortTimestamp(a.at);
}

/** Merges optimistic local rolls with fetched rows, newest first, id-deduped. */
export function mergeRollRecords(...groups: RollRecord[][]): RollRecord[] {
  const byId = new Map<string, RollRecord>();
  for (const group of groups) {
    for (const record of group) {
      if (!byId.has(record.id)) {
        byId.set(record.id, record);
      }
    }
  }
  return Array.from(byId.values()).sort(sortRollRecordsDesc);
}

export interface RollStats {
  count: number;
  lowest: number;
  highest: number;
  average: number;
}

/** Summary of a set of rolls. Returns null for an empty set. */
export function summarizeRolls(records: RollRecord[]): RollStats | null {
  if (records.length === 0) return null;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const record of records) {
    if (record.value < lowest) lowest = record.value;
    if (record.value > highest) highest = record.value;
    total += record.value;
  }
  return {
    count: records.length,
    lowest,
    highest,
    average: total / records.length,
  };
}
