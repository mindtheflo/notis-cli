import test from 'node:test';
import assert from 'node:assert/strict';
import { CLI_UPDATE_COMMAND, SPACES_PROTOCOL, normalizeBackendError } from '../src/runtime/transport.js';

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

test('an old Spaces protocol tells the user to update the CLI with the exact command', () => {
  const payload = {
    error: 'client_update_required', message: 'server text', client: 'cli', required_protocol: 2, received_protocol: 1,
    update_command: 'npx --package @notis_ai/cli@latest -- notis',
  };
  const error = normalizeBackendError(410, payload, runtime);
  assert.equal(error.code, 'cli_update_required');
  assert.equal(error.message, 'This Notis CLI is too old for Spaces. Run the latest one with: npx --package @notis_ai/cli@latest -- notis');
  assert.deepEqual(error.hints.map((hint) => hint.command), ['npx --package @notis_ai/cli@latest -- notis']);
  assert.equal(error.details.required_protocol, 2);
  assert.equal(SPACES_PROTOCOL, 2);
  assert.equal(CLI_UPDATE_COMMAND, 'npx --package @notis_ai/cli@latest -- notis');
});

test('a Store install refused without a check says store_check_required and its reason, with the check as the next step', () => {
  const payload = {
    error: 'store_check_required', message: 'Check this Space with the person before installing it.',
    error_code: 'store_check_required', reason: 'missing',
    hint: 'Run the Store check (spaces store check, or LOCAL_NOTIS_MANAGE_SPACE operation check_install).',
  };
  const error = normalizeBackendError(409, payload, runtime);
  assert.equal(error.code, 'store_check_required');
  assert.equal(error.message, 'Check this Space with the person before installing it. (store_check_required: missing)');
  assert.equal(error.exitCode, 5);
  assert.equal(error.retryable, false);
  assert.equal(error.details.reason, 'missing');
  assert.equal(error.details.error_code, 'store_check_required');
  assert.equal(error.hints[0].command, 'notis spaces store check <listing-id>');
  assert.ok(error.hints.some((hint) => hint.command.includes('--receipt <receipt_id> --confirmed')));
  // Without a reason the code still leads, and any other 409 stays a conflict.
  assert.equal(normalizeBackendError(409, { error: 'store_check_required', message: 'Check it first.' }, runtime).message,
    'Check it first. (store_check_required)');
  assert.equal(normalizeBackendError(409, { error: 'store_up_to_date', message: 'Up to date.' }, runtime).code, 'conflict');
});
