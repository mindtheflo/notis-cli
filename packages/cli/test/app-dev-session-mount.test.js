import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  getAppDevSessionMountAcksFile,
  waitForAppDevSessionMountAcknowledgements,
  waitForAppDevSessionRenderAcknowledgements,
} from '../src/runtime/app-dev-sessions.js';

function expectedSession(overrides = {}) {
  return {
    sessionId: 'session-1',
    appId: 'app-1',
    devSlug: 'notes-dev',
    mountNonce: 'nonce-current',
    ...overrides,
  };
}

function writeAcknowledgements(sessionsFilePath, acknowledgements) {
  const filePath = getAppDevSessionMountAcksFile(sessionsFilePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ version: 1, acknowledgements }, null, 2));
}

function acknowledgement(session, overrides = {}) {
  return {
    ...session,
    stage: 'listed',
    acknowledgedAt: '2026-07-14T12:00:00.000Z',
    ...overrides,
  };
}

test('mount acknowledgement requires the exact session app slug and nonce', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-app-dev-mount-'));
  const sessionsFilePath = join(root, 'app-dev-sessions.json');
  const expected = expectedSession();
  writeAcknowledgements(sessionsFilePath, [
    acknowledgement(expected, { mountNonce: 'nonce-stale' }),
  ]);

  const stale = await waitForAppDevSessionMountAcknowledgements(expected, {
    sessionsFilePath,
    timeoutMs: 0,
  });
  assert.equal(stale.mounted, false);
  assert.deepEqual(stale.missing, [expected]);

  writeAcknowledgements(sessionsFilePath, [acknowledgement(expected)]);
  const current = await waitForAppDevSessionMountAcknowledgements(expected, {
    sessionsFilePath,
    timeoutMs: 0,
  });
  assert.equal(current.mounted, true);
  assert.deepEqual(current.missing, []);
});

test('mount acknowledgement waits for every app in a workspace session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-app-dev-mount-many-'));
  const sessionsFilePath = join(root, 'app-dev-sessions.json');
  const notes = expectedSession();
  const journal = expectedSession({
    appId: 'app-2',
    devSlug: 'journal-dev',
    mountNonce: 'nonce-journal',
  });
  writeAcknowledgements(sessionsFilePath, [acknowledgement(notes)]);

  const partial = await waitForAppDevSessionMountAcknowledgements([notes, journal], {
    sessionsFilePath,
    timeoutMs: 0,
  });
  assert.equal(partial.mounted, false);
  assert.deepEqual(partial.missing, [journal]);

  writeAcknowledgements(sessionsFilePath, [acknowledgement(notes), acknowledgement(journal)]);
  const complete = await waitForAppDevSessionMountAcknowledgements([notes, journal], {
    sessionsFilePath,
    timeoutMs: 0,
  });
  assert.equal(complete.mounted, true);
});

test('listed and rendered acknowledgements are separate lifecycle stages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-app-dev-render-'));
  const sessionsFilePath = join(root, 'app-dev-sessions.json');
  const expected = expectedSession();
  writeAcknowledgements(sessionsFilePath, [acknowledgement(expected)]);

  const listed = await waitForAppDevSessionMountAcknowledgements(expected, {
    sessionsFilePath,
    timeoutMs: 0,
  });
  const notRendered = await waitForAppDevSessionRenderAcknowledgements(expected, {
    sessionsFilePath,
    timeoutMs: 0,
  });
  assert.equal(listed.mounted, true);
  assert.equal(notRendered.mounted, false);

  writeAcknowledgements(sessionsFilePath, [
    acknowledgement(expected),
    acknowledgement(expected, { stage: 'rendered' }),
  ]);
  const rendered = await waitForAppDevSessionRenderAcknowledgements(expected, {
    sessionsFilePath,
    timeoutMs: 0,
  });
  assert.equal(rendered.mounted, true);
});
