import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APP_DEV_CONSUMER_EXPIRES_AFTER_MS,
  heartbeatAppDevConsumer,
  hasAppDevConsumer,
  readAppDevConsumers,
  removeAppDevConsumer,
} from '../src/runtime/app-dev-consumers.js';

test('a manual CLI mount heartbeats and removes only its own consumer lease', () => {
  const filePath = join(mkdtempSync(join(tmpdir(), 'notis-cli-manual-consumer-')), 'consumers.json');
  heartbeatAppDevConsumer({
    instanceId: 'cli-1',
    userId: 'beta-user',
    apiBase: 'https://api-beta.notis.ai/',
    pid: process.pid,
  }, filePath);
  heartbeatAppDevConsumer({
    instanceId: 'desktop-1',
    userId: 'prod-user',
    apiBase: 'https://api.notis.ai',
    pid: process.pid,
  }, filePath);

  assert.deepEqual(
    readAppDevConsumers(filePath).map(({ instanceId, apiBase }) => ({ instanceId, apiBase })),
    [
      { instanceId: 'cli-1', apiBase: 'https://api-beta.notis.ai' },
      { instanceId: 'desktop-1', apiBase: 'https://api.notis.ai' },
    ],
  );
  removeAppDevConsumer('cli-1', filePath);
  assert.deepEqual(readAppDevConsumers(filePath).map(({ instanceId }) => instanceId), ['desktop-1']);
});

test('the shared source host stays alive while any fresh Desktop consumer remains', () => {
  const filePath = join(mkdtempSync(join(tmpdir(), 'notis-cli-consumers-')), 'consumers.json');
  const now = Date.parse('2026-08-25T10:00:00.000Z');
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify({
    version: 1,
    consumers: [
      {
        instanceId: 'prod',
        userId: 'user-1',
        apiBase: 'https://api.notis.ai',
        pid: 11,
        lastHeartbeatAt: new Date(now).toISOString(),
      },
      {
        instanceId: 'expired-beta',
        userId: 'user-1',
        apiBase: 'https://api-beta.notis.ai',
        pid: 12,
        lastHeartbeatAt: new Date(now - APP_DEV_CONSUMER_EXPIRES_AFTER_MS - 1).toISOString(),
      },
    ],
  }));

  const consumers = readAppDevConsumers(filePath, now);
  assert.equal(consumers.length, 1);
  assert.equal(hasAppDevConsumer(consumers, {
    mode: 'machine',
    userId: 'unused',
    apiBase: 'unused',
  }), true);
});

test('an environment mount exits after its final matching consumer lease expires', () => {
  const consumers = [
    {
      instanceId: 'beta',
      userId: 'user-1',
      apiBase: 'https://api-beta.notis.ai',
      pid: 12,
      lastHeartbeatAt: '2026-08-25T10:00:00.000Z',
    },
  ];
  assert.equal(hasAppDevConsumer(consumers, {
    mode: 'environment',
    userId: 'user-1',
    apiBase: 'https://api.notis.ai/',
  }), false);
  assert.equal(hasAppDevConsumer(consumers, {
    mode: 'environment',
    userId: 'user-1',
    apiBase: 'https://api-beta.notis.ai/',
  }), true);
});
