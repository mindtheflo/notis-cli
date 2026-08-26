import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { getAvailablePort, getAvailablePortPreferring } from '../src/runtime/ports.js';

test('getAvailablePortPreferring returns the preferred port when free', async () => {
  const probe = await getAvailablePort();
  const port = await getAvailablePortPreferring(probe);
  assert.equal(port, probe);
});

test('getAvailablePortPreferring falls back when the preferred port is busy', async () => {
  const occupant = createServer();
  const busyPort = await new Promise((resolvePromise) => {
    occupant.listen(0, '127.0.0.1', () => resolvePromise(occupant.address().port));
  });
  try {
    const port = await getAvailablePortPreferring(busyPort);
    assert.notEqual(port, busyPort);
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  } finally {
    await new Promise((resolvePromise) => occupant.close(resolvePromise));
  }
});

test('getAvailablePortPreferring ignores invalid preferences', async () => {
  const port = await getAvailablePortPreferring(undefined);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
});
