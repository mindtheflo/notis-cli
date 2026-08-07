import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeRollRecords,
  normalizeRollRecord,
  sortRollRecordsDesc,
  summarizeRolls,
} from './roll-record';

test('normalizeRollRecord falls back to legacy title and Name-only documents', () => {
  const record = normalizeRollRecord({
    id: 'doc-1',
    title: '25',
    properties: { Name: '25' },
    createdAt: '2026-04-24T16:27:36.144829+00:00',
    lastEditedTime: '2026-04-24T16:27:36.144829+00:00',
  });

  assert.deepEqual(record, {
    id: 'doc-1',
    value: 25,
    mode: 'integer',
    min: null,
    max: null,
    at: '2026-04-24T16:27:36.144829+00:00',
  });
});

test('normalizeRollRecord preserves rich roll fields when the schema exists', () => {
  const record = normalizeRollRecord({
    id: 'doc-2',
    title: '42',
    properties: {
      Value: 42,
      Mode: 'Dice',
      Min: 1,
      Max: 6,
      'Rolled At': '2026-04-24T16:46:00.000Z',
    },
    createdAt: '2026-04-24T16:46:00.000Z',
    lastEditedTime: '2026-04-24T16:46:00.000Z',
  });

  assert.deepEqual(record, {
    id: 'doc-2',
    value: 42,
    mode: 'dice',
    min: 1,
    max: 6,
    at: '2026-04-24T16:46:00.000Z',
  });
});

test('normalizeRollRecord unwraps Notion-shaped property values', () => {
  const record = normalizeRollRecord({
    id: 'doc-3',
    title: '17',
    properties: {
      Name: { type: 'title', title: [{ type: 'text', text: { content: '17' } }] },
      Value: { type: 'number', number: 17 },
      Mode: { type: 'select', select: { name: 'Integer', color: 'blue' } },
      Min: { type: 'number', number: 1 },
      Max: { type: 'number', number: 100 },
      'Rolled At': { type: 'date', date: { start: '2026-07-27T09:12:00.000Z', end: null } },
    },
    created_time: '2026-07-27T09:12:00.000Z',
  });

  assert.deepEqual(record, {
    id: 'doc-3',
    value: 17,
    mode: 'integer',
    min: 1,
    max: 100,
    at: '2026-07-27T09:12:00.000Z',
  });
});

test('normalizeRollRecord reads a Notion-shaped decimal roll', () => {
  const record = normalizeRollRecord({
    id: 'doc-4',
    title: '0.4271',
    properties: {
      Value: { type: 'number', number: 0.4271 },
      Mode: { type: 'select', select: { name: 'Decimal', color: 'purple' } },
      Min: { type: 'number', number: 0 },
      Max: { type: 'number', number: 1 },
      'Rolled At': { type: 'date', date: { start: '2026-07-27T08:00:00.000Z' } },
    },
  });

  assert.equal(record.value, 0.4271);
  assert.equal(record.mode, 'decimal');
  assert.equal(record.min, 0);
  assert.equal(record.max, 1);
});

test('normalizeRollRecord tolerates a document with no properties at all', () => {
  const record = normalizeRollRecord({ id: 'doc-5', title: 'Untitled' });
  assert.deepEqual(record, {
    id: 'doc-5',
    value: 0,
    mode: 'integer',
    min: null,
    max: null,
    at: '',
  });
});

test('sortRollRecordsDesc keeps newest rolls first', () => {
  const rows = [
    { id: 'old', value: 1, mode: 'integer' as const, min: 1, max: 10, at: '2026-04-24T16:20:00.000Z' },
    { id: 'new', value: 2, mode: 'integer' as const, min: 1, max: 10, at: '2026-04-24T16:30:00.000Z' },
  ];

  rows.sort(sortRollRecordsDesc);
  assert.deepEqual(rows.map((row) => row.id), ['new', 'old']);
});

test('mergeRollRecords dedupes by id and keeps the newest first', () => {
  const fetched = [
    { id: 'a', value: 1, mode: 'integer' as const, min: 1, max: 10, at: '2026-07-27T10:00:00.000Z' },
    { id: 'b', value: 2, mode: 'integer' as const, min: 1, max: 10, at: '2026-07-27T09:00:00.000Z' },
  ];
  const optimistic = [
    { id: 'a', value: 99, mode: 'integer' as const, min: 1, max: 10, at: '2026-07-27T10:00:00.000Z' },
    { id: 'c', value: 3, mode: 'integer' as const, min: 1, max: 10, at: '2026-07-27T11:00:00.000Z' },
  ];

  const merged = mergeRollRecords(optimistic, fetched);
  assert.deepEqual(merged.map((row) => row.id), ['c', 'a', 'b']);
  // The optimistic copy wins the id collision, so no row flickers back.
  assert.equal(merged[1]?.value, 99);
});

test('summarizeRolls reports count, extremes, and mean', () => {
  const stats = summarizeRolls([
    { id: 'a', value: 4, mode: 'integer', min: 1, max: 10, at: '' },
    { id: 'b', value: 10, mode: 'integer', min: 1, max: 10, at: '' },
    { id: 'c', value: 1, mode: 'integer', min: 1, max: 10, at: '' },
  ]);

  assert.deepEqual(stats, { count: 3, lowest: 1, highest: 10, average: 5 });
});

test('summarizeRolls returns null for an empty set', () => {
  assert.equal(summarizeRolls([]), null);
});
