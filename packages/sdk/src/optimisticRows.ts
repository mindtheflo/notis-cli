/**
 * What a native insert or update looks like in the rows a view already holds, before the server answers.
 *
 * Writes and reads use different shapes: a write keys properties by id or name and sends plain values (a select as
 * an option id or label), a native read keys them by name in typed envelopes (`{type: 'select', select: {id, name,
 * color}}`), and `useNativeDocuments` flattens those envelopes. Property types and options are learned from every
 * row of the database the cache holds. A value is shown only when it can be put in the read's shape for certain;
 * anything else (a property named by id, an unseen option, a relation) keeps its old value until the server's rows
 * arrive, which never takes long: the host reads every list again after each write.
 *
 * A row leaves or joins a read only by the read's own filter, evaluated here when the page sent it and every field it
 * reads is understood; a Space's `shows` filter stays on the server, so there a row changes in place and a new row
 * shows only in the list it was created from. Rows move to their sorted place when the read's sorts are understood.
 */

import type { NativeField, NativeFilter, NativeInsert, NativeQuery, NativeUpdate } from './nativeData';
import { recordKeyOf, type RowChange, type RowsRead } from './queryCache';

type Row = Record<string, unknown>;

const isObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: string) => (value ? [{ type: 'text', text: { content: value } }] : []);

/** What the cached rows of a database say about its properties: names, native types and select options. */
type Learned = { names: Set<string>; types: Map<string, string>; options: Map<string, Map<string, Row>> };
const learnedFor = new WeakMap<readonly Row[], Learned>();
function learn(rows: readonly Row[]): Learned {
  const cached = learnedFor.get(rows);
  if (cached) return cached;
  const names = new Set<string>();
  const types = new Map<string, string>();
  const options = new Map<string, Map<string, Row>>();
  for (const row of rows) {
    const properties = isObject(row.properties) ? row.properties : {};
    for (const [name, value] of Object.entries(properties)) {
      names.add(name);
      if (!isObject(value) || typeof value.type !== 'string') continue;
      types.set(name, value.type);
      const picked = value[value.type];
      for (const option of Array.isArray(picked) ? picked : [picked]) {
        if (!isObject(option) || typeof option.id !== 'string' || typeof option.name !== 'string') continue;
        let known = options.get(name);
        if (!known) options.set(name, known = new Map());
        known.set(`id:${option.id}`, option);
        known.set(`name:${option.name.toLowerCase()}`, option);
      }
    }
  }
  const learned = { names, types, options };
  learnedFor.set(rows, learned);
  return learned;
}

function findOption(options: Map<string, Row> | undefined, raw: unknown): Row | undefined {
  if (typeof raw !== 'string') return undefined;
  return options?.get(`id:${raw}`) ?? options?.get(`name:${raw.toLowerCase()}`);
}

const SKIP = Symbol('skip');

/** A written value in the native read envelope, or SKIP when it cannot be shown for certain. */
function nativeValue(type: string, value: unknown, options: Map<string, Row> | undefined): unknown {
  if (value === null) {
    if (['multi_select', 'relation', 'people', 'files', 'title', 'rich_text'].includes(type)) {
      return type === 'title' ? { type, title: [], rich_text: [] } : { type, [type]: [] };
    }
    if (type === 'checkbox') return { type, checkbox: false };
    return type ? { type, [type]: null } : SKIP;
  }
  switch (type) {
    case 'title': return typeof value === 'string' ? { type, title: text(value), rich_text: text(value) } : SKIP;
    case 'rich_text': return typeof value === 'string' ? { type, rich_text: text(value) } : SKIP;
    case 'url': case 'email': return typeof value === 'string' ? { type, [type]: value } : SKIP;
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? { type, number: value } : SKIP;
    case 'checkbox': return typeof value === 'boolean' ? { type, checkbox: value } : SKIP;
    case 'select': case 'status': {
      const found = findOption(options, value);
      return found ? { type, [type]: { ...found } } : SKIP;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return SKIP;
      const found = value.map((item) => findOption(options, item));
      return found.every(Boolean) ? { type, multi_select: found.map((item) => ({ ...item })) } : SKIP;
    }
    case 'date': {
      if (typeof value === 'string') return { type, date: { start: value, end: null, timezone: null } };
      if (isObject(value) && typeof value.start === 'string') {
        return { type, date: { start: value.start, end: value.end ?? null, timezone: value.timezone ?? null } };
      }
      return SKIP;
    }
    default: return SKIP;
  }
}

/** A written value as `useNativeDocuments` flattens it, or SKIP when it cannot be shown for certain. */
function documentValue(type: string | undefined, current: unknown, value: unknown, options: Map<string, Row> | undefined): unknown {
  if (type) {
    const envelope = nativeValue(type, value, options);
    if (envelope === SKIP) return SKIP;
    const record = envelope as Row;
    if (type === 'title' || type === 'rich_text') return typeof value === 'string' ? value : '';
    if (type === 'select' || type === 'status') return isObject(record[type]) ? (record[type] as Row).name : null;
    if (type === 'multi_select') return (record.multi_select as Row[]).map((item) => item.name);
    if (type === 'date') return isObject(record.date) ? (record.date as Row).start : null;
    return record[type];
  }
  // Without the native type the flattened value is ambiguous (an option id and its label are both strings).
  return value === null && current === null ? null : SKIP;
}

/** The property a write names, by its name as the rows key it (exact, else case-insensitive); never by id. */
function propertyName(names: Iterable<string>, written: string): string | null {
  const list = [...names];
  if (list.includes(written)) return written;
  const lower = written.toLowerCase();
  return list.find((name) => name.toLowerCase() === lower) ?? null;
}

/** `row` with `fields` written into it, in the read's shape. */
function written(row: Row, fields: NativeInsert, read: RowsRead, learned: Learned): Row {
  const next: Row = { ...row };
  const document = read.shape === 'document';
  const properties: Row = { ...(isObject(row.properties) ? row.properties : {}) };
  const names = new Set([...learned.names, ...Object.keys(properties)]);
  let skipped = false;
  for (const [key, value] of Object.entries(fields.properties ?? {})) {
    const name = propertyName(names, key);
    if (!name) { skipped = true; continue; }
    const type = learned.types.get(name) ?? (isObject(properties[name]) ? String((properties[name] as Row).type ?? '') : '');
    const shown = document ? documentValue(type || undefined, properties[name], value, learned.options.get(name))
      : nativeValue(type, value, learned.options.get(name));
    if (shown === SKIP) { skipped = true; continue; }
    properties[name] = shown;
    if (type === 'title') next.title = typeof value === 'string' ? value : '';
  }
  const title = fields.columns?.title;
  if (title !== undefined) {
    next.title = title ?? '';
    for (const [name, type] of learned.types) {
      if (type === 'title') properties[name] = document ? title ?? '' : nativeValue('title', title, undefined);
    }
  }
  if (fields.columns?.icon !== undefined) next.icon = fields.columns.icon;
  if (fields.columns?.cover !== undefined) next.cover = fields.columns.cover;
  next.properties = properties;
  if (skipped) partial.add(next);
  return next;
}

/** Rows that could not show every written value: they wait for the server's rows before taking its revision. */
const partial = new WeakSet<Row>();

// ---- the read's own filter and sorts ----

const UNKNOWN = Symbol('unknown');

/** The comparable value of one field of a row (a list for options and multi-selects), or UNKNOWN. */
function fieldValue(row: Row, field: NativeField, read: RowsRead, learned: Learned): unknown {
  if ('column' in field) {
    if (field.column === 'record_key') return recordKeyOf(row) ?? UNKNOWN;
    // A flattened document titles an empty title "Untitled" in the reader's language: not the stored value.
    if (field.column === 'title') return typeof row.title === 'string' && read.shape !== 'document' ? row.title : UNKNOWN;
    if (field.column === 'created_at') return row.created_at ?? row.createdAt ?? UNKNOWN;
    if (field.column === 'updated_at' || field.column === 'last_edited_time') {
      return row.updated_at ?? row.last_edited_time ?? row.lastEditedTime ?? UNKNOWN;
    }
    return UNKNOWN;
  }
  if (!('property' in field)) return UNKNOWN;
  const properties = isObject(row.properties) ? row.properties : {};
  const name = propertyName(Object.keys(properties), field.property);
  if (!name) return UNKNOWN;
  const value = properties[name];
  if (read.shape === 'document') {
    const type = learned.types.get(name);
    if (!type) return UNKNOWN;
    if (type === 'select' || type === 'status' || type === 'multi_select') {
      // Flattened rows keep option names only; a filter may name the option by id.
      const labels = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
      return labels.flatMap((label) => {
        const option = findOption(learned.options.get(name), label);
        return option ? [option.id, option.name] : [label];
      });
    }
    return value ?? null;
  }
  if (!isObject(value) || typeof value.type !== 'string') return UNKNOWN;
  const inner = value[value.type];
  switch (value.type) {
    case 'title': case 'rich_text':
      return Array.isArray(inner) ? inner.map((chunk) => (isObject(chunk) && isObject(chunk.text) ? String(chunk.text.content ?? '') : '')).join('') : '';
    case 'select': case 'status': return isObject(inner) ? [inner.id, inner.name] : [];
    case 'multi_select': return Array.isArray(inner) ? inner.flatMap((item) => (isObject(item) ? [item.id, item.name] : [])) : [];
    case 'date': return isObject(inner) ? inner.start ?? null : null;
    case 'number': case 'checkbox': case 'url': case 'email': return inner ?? null;
    default: return UNKNOWN;
  }
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
const same = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return Number.NaN;
}

/** Whether `row` passes `filter`: true, false, or UNKNOWN when a field or operator is not understood here. */
function matches(row: Row, filter: NativeFilter | undefined, read: RowsRead, learned: Learned): boolean | typeof UNKNOWN {
  if (!filter) return true;
  if ('and' in filter || 'or' in filter) {
    const all = 'and' in filter;
    const results = (all ? (filter as { and: NativeFilter[] }).and : (filter as { or: NativeFilter[] }).or)
      .map((part) => matches(row, part, read, learned));
    if (all) return results.includes(false) ? false : results.includes(UNKNOWN) ? UNKNOWN : true;
    return results.includes(true) ? true : results.includes(UNKNOWN) ? UNKNOWN : false;
  }
  const value = fieldValue(row, filter.field, read, learned);
  if (value === UNKNOWN) return UNKNOWN;
  const values = Array.isArray(value) ? value : [value];
  const wanted = filter.value;
  const ordered = (test: (result: number) => boolean) => {
    const result = compare(value, wanted);
    return Number.isNaN(result) ? (isEmpty(value) ? false : UNKNOWN) : test(result);
  };
  switch (filter.op) {
    case 'is_empty': return values.every(isEmpty);
    case 'is_not_empty': return !values.every(isEmpty);
    case 'equals': return values.some((item) => same(item, wanted));
    case 'not_equals': return !values.some((item) => same(item, wanted));
    case 'in': return Array.isArray(wanted) ? values.some((item) => wanted.some((one) => same(item, one))) : UNKNOWN;
    case 'contains': case 'not_contains': case 'does_not_contain': {
      if (typeof wanted !== 'string') return UNKNOWN;
      const found = Array.isArray(value) ? values.some((item) => same(item, wanted))
        : typeof value === 'string' && value.toLowerCase().includes(wanted.toLowerCase());
      return filter.op === 'contains' ? found : !found;
    }
    case 'greater_than': case 'after': return ordered((result) => result > 0);
    case 'less_than': case 'before': return ordered((result) => result < 0);
    case 'greater_than_or_equal_to': case 'on_or_after': return ordered((result) => result >= 0);
    case 'less_than_or_equal_to': case 'on_or_before': return ordered((result) => result <= 0);
    default: return UNKNOWN;
  }
}

/** Where `row` goes among `rows` by the read's sorts, or -1 when they are not understood here. */
function sortedPlace(rows: readonly Row[], row: Row, read: RowsRead, learned: Learned): number {
  const sorts = (read.query as NativeQuery | undefined)?.sorts;
  if (!sorts?.length) return -1;
  // An option sorts by its name; empty values sort last either way.
  const keyOf = (item: Row) => sorts.map((sort) => {
    const value = fieldValue(item, sort.field, read, learned);
    return Array.isArray(value) ? value[1] ?? value[0] ?? null : value;
  });
  const mine = keyOf(row);
  if (mine.includes(UNKNOWN)) return -1;
  for (let index = 0; index < rows.length; index += 1) {
    const theirs = keyOf(rows[index]!);
    let result = 0;
    for (let at = 0; at < sorts.length && !result; at += 1) {
      const a = mine[at], b = theirs[at];
      if (b === UNKNOWN) return -1;
      if (isEmpty(a) !== isEmpty(b)) { result = isEmpty(a) ? 1 : -1; break; }
      if (isEmpty(a)) continue;
      const order = compare(a, b);
      if (Number.isNaN(order)) return -1;
      result = sorts[at]!.direction === 'desc' ? -order : order;
    }
    if (result < 0) return index;
  }
  return rows.length;
}

// ---- the changes ----

/**
 * The change a native update makes: the row is rewritten where it is, leaves a read whose own filter it no longer
 * passes, and moves to its sorted place.
 */
export function updateChange(binding: string, input: NativeUpdate): RowChange {
  return {
    binding,
    recordKey: input.record_key,
    project: (row, read, related) => (row ? written(row, input, read, learn(related())) : undefined),
    keeps: (row, read, related) => matches(row, (read.query as NativeQuery | undefined)?.filter, read, learn(related())) !== false,
    exact: (row) => !partial.has(row),
    position: (rows, row, read, related) => sortedPlace(rows, row, read, learn(related())),
  };
}

/**
 * The change a native insert makes: a new row with the temporary key `tempKey`, at its sorted place or the top, in
 * every read of the database whose own filter it passes for certain. A Space `shows` list's filter stays on the
 * server, so a new row shows there only in the lists `showIn` names (the lists it was created from).
 */
export function insertChange(binding: string, input: NativeInsert, tempKey: string, showIn: readonly string[] = []): RowChange {
  return {
    binding,
    recordKey: tempKey,
    insert: true,
    project: (row, read, related) => {
      if (row) return undefined;
      const query = read.query as NativeQuery | undefined;
      if (read.list ? !showIn.includes(read.list) : !query || query.search || query.mode === 'search' || (query.offset ?? 0) > 0) {
        return undefined;
      }
      const learned = learn(related());
      const blank: Row = read.shape === 'document'
        ? { id: tempKey, recordKey: tempKey, title: '', properties: {} }
        : { id: tempKey, record_key: tempKey, title: '', properties: {} };
      const next = written(blank, input, read, learned);
      if (read.list) return next;
      return matches(next, query!.filter, read, learned) === true ? next : undefined;
    },
    position: (rows, row, read, related) => Math.max(0, sortedPlace(rows, row, read, learn(related()))),
  };
}

/** A temporary key for a row being created. */
export function tempRecordKey(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `pending:${random}`;
}
export function isTempRecordKey(key: unknown): boolean {
  return typeof key === 'string' && key.startsWith('pending:');
}
