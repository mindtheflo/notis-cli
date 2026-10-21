import test from 'node:test';
import assert from 'node:assert/strict';
import { viewManifestFields, viewParamValue } from '../src/runtime/space-view-manifest.js';

const definition = { specVersion: 2, path: 'journal', description: 'Journal periods',
  memory: { markdown: false, attachments: false, screenshot: false, snapshots: [] },
  params: { period: { type: 'period', description: 'Which dates?', timezone: 'Europe/Madrid' } },
  shows: { entries: { database: 'entries', where: { and: [
    { field: { property: 'Date' }, op: 'on_or_after', value: '{period.start}' },
    { field: { property: 'Date' }, op: 'on_or_before', value: '{period.end}' },
  ] } } }, questions: ['What did I write last week?'] };
const compile = value => viewManifestFields(value, { entry: 'view.tsx', resources: { entries: { kind: 'database' } } });

test('CLI accepts the same relative and exact calendar ranges as the host', () => {
  for (const value of ['today', 'tomorrow', 'this_week', 'last_week', 'this_month', 'last_month', '2024-02-01/2024-02-29']) {
    assert.equal(viewParamValue({ type: 'period' }, value), true, value);
  }
  for (const value of ['0000-01-01/0000-12-31', '2026-02-29/2026-03-01', '2026-03-02/2026-03-01', 'last_year', 1, null]) {
    assert.equal(viewParamValue({ type: 'period' }, value), false, String(value));
  }
  assert.equal(viewParamValue({ type: 'date' }, 'today'), true);
  assert.equal(viewParamValue({ type: 'date' }, 'this_week'), false);
});

test('period declarations keep discoverable questions and reject ambiguous boundaries', () => {
  assert.deepEqual(compile(definition).questions, definition.questions);
  assert.throws(() => compile({ ...definition, questions: ['Same', 'Same'] }));
  assert.throws(() => compile({ ...definition, params: { period: { ...definition.params.period, timezone: 'Moon/Sea' } } }));
  assert.throws(() => compile({ ...definition, shows: { entries: { database: 'entries', where: {
    field: { property: 'Date' }, op: 'equals', value: '{period}',
  } } } }));
});

test('conditional filters require boolean settings, including empty-value conditions', () => {
  const gated = { ...definition, params: { ...definition.params, notPlanned: { type: 'boolean', description: 'Unplanned' } },
    shows: { entries: { database: 'entries', where: { field: { property: 'Date' }, op: 'is_empty', when: 'notPlanned' } } } };
  assert.equal(compile(gated).shows.entries.where.when, 'notPlanned');
  for (const when of ['period', 'unknown', true, {}]) {
    assert.throws(() => compile({ ...gated, shows: { entries: { ...gated.shows.entries, where: { ...gated.shows.entries.where, when } } } }));
  }
});
