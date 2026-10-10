import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBackendError } from '../src/runtime/transport.js';

const runtime = { profileName: 'default', apiBase: 'https://api.example.com' };

test('a coded Space error shows its readable message and keeps the code in details', () => {
  const payload = { error: 'main_view_conflict', message: '"Tasks" is already main for this database. Move the main view first.' };
  const error = normalizeBackendError(409, payload, runtime);
  assert.equal(error.code, 'conflict');
  assert.equal(error.message, payload.message);
  assert.equal(error.details.error, 'main_view_conflict');
});

test('legacy payloads whose error is the message are unchanged', () => {
  assert.equal(normalizeBackendError(409, { error: 'This name is taken.' }, runtime).message, 'This name is taken.');
  assert.equal(normalizeBackendError(409, { error: { message: 'Nested message' }, message: 'outer' }, runtime).message, 'Nested message');
  assert.equal(normalizeBackendError(409, { error: 'main_view_conflict' }, runtime).message, 'main_view_conflict');
});
