import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseVisibleProperties,
  resolveVisibleColumns,
  serializeVisibleProperties,
} from './visible-properties';

const PROPERTIES = [
  { id: 'prop_folder', name: 'Folder' },
  { id: 'prop_status', name: 'Status' },
  { id: 'prop_due', name: 'Due' },
  { id: 'prop_url', name: 'URL' },
  { id: 'prop_tags', name: 'Tags' },
  { id: 'prop_owner', name: 'Owner' },
  { id: 'prop_extra', name: 'Extra' },
];

test('parses the JSON array form it writes', () => {
  assert.deepEqual(parseVisibleProperties('["prop_status","prop_due"]'), ['prop_status', 'prop_due']);
});

test('parses an already-projected array and a comma-separated string', () => {
  assert.deepEqual(parseVisibleProperties(['prop_status']), ['prop_status']);
  assert.deepEqual(parseVisibleProperties('Status, Due'), ['Status', 'Due']);
});

test('treats empty and malformed values as no preference', () => {
  for (const value of [null, undefined, '', '   ', 42, {}]) {
    assert.deepEqual(parseVisibleProperties(value), []);
  }
});

test('round-trips through serialize', () => {
  const ids = ['prop_url', 'prop_status'];
  assert.deepEqual(parseVisibleProperties(serializeVisibleProperties(ids)), ids);
});

test('a folder selection wins and renders in schema order', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    // Deliberately out of schema order.
    activeFolderSelection: '["prop_url","prop_status"]',
  });

  assert.equal(result.source, 'folder');
  assert.deepEqual(result.columns.map((p) => p.name), ['Status', 'URL']);
});

test('a folder selection is honoured beyond the default column count', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    activeFolderSelection: PROPERTIES.map((p) => p.id),
  });

  assert.equal(result.source, 'folder');
  assert.equal(result.columns.length, 7);
});

test('selections still resolve by name after being written by hand', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    activeFolderSelection: 'URL, status',
  });

  assert.equal(result.source, 'folder');
  assert.deepEqual(result.columns.map((p) => p.name), ['Status', 'URL']);
});

test('unknown tokens are dropped rather than rendered as empty columns', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    activeFolderSelection: '["prop_status","prop_deleted"]',
  });

  assert.deepEqual(result.columns.map((p) => p.name), ['Status']);
});

test('a selection naming only removed properties falls back, never to nothing', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    activeFolderSelection: '["prop_gone","prop_also_gone"]',
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.columns.length, 6);
});

test('with no folder selected, the union of every folder is shown', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    activeFolderSelection: null,
    allFolderSelections: ['["prop_status","prop_due"]', '["prop_folder","prop_url"]'],
  });

  assert.equal(result.source, 'union');
  // Schema order, not the order folders were encountered.
  assert.deepEqual(result.columns.map((p) => p.name), ['Folder', 'Status', 'Due', 'URL']);
});

test('an active folder with no preference uses the fallback', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    activeFolderSelection: undefined,
    activeFolderSelected: true,
    allFolderSelections: ['["prop_status","prop_due"]'],
  });

  assert.equal(result.source, 'fallback');
  assert.deepEqual(result.columns, PROPERTIES.slice(0, 6));
});

test('the derived union is capped', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    activeFolderSelection: null,
    allFolderSelections: [PROPERTIES.map((p) => p.id)],
  });

  assert.equal(result.source, 'union');
  assert.equal(result.columns.length, 6);
});

test('no folder and no configured folders reproduces the previous behaviour', () => {
  const result = resolveVisibleColumns({
    metadataProperties: PROPERTIES,
    activeFolderSelection: null,
    allFolderSelections: [],
  });

  assert.equal(result.source, 'fallback');
  assert.deepEqual(result.columns, PROPERTIES.slice(0, 6));
});
