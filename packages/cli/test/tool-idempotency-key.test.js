import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';

import { runToolCommand } from '../src/command-specs/helpers.js';

// `credentialKind: 'env'` keeps these tests hermetic: it is the one kind whose
// expiry is read from `runtime.jwt` alone, and it short-circuits the reload that
// would otherwise pull a real credential off disk. Without it the transport auth
// precheck resolves the developer's own profile, so the suite passes locally and
// fails in CI with auth_expired.
function makeJwt(sub = 'idempotency-test-user') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub, exp })}.sig`;
}

// The server owns effect classification and rejects anything it classifies as
// write *or unknown* when no idempotency key is present. A client-side
// `mutating: false` hint does not exempt the call, so read-only commands that
// dispatch through an unknown-classified wrapper must still send a key.
async function captureToolRequest({ port, ...options }) {
  const received = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ successful: true, data: {} }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await runToolCommand({
      runtime: {
        apiBase: `http://127.0.0.1:${server.address().port}`,
        credentialKind: 'env',
        jwt: makeJwt(),
        timeoutMs: 5000,
        cliVersion: 'test',
        outputMode: 'json',
        profileName: 'default',
      },
      toolName: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      arguments_: { tools: [] },
      ...options,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  return received[0];
}

test('a read-only tool call sends no idempotency key by default', async () => {
  const request = await captureToolRequest({ mutating: false });
  assert.equal(request.idempotency_key, null);
});

test('a mutating tool call forwards its idempotency key', async () => {
  const request = await captureToolRequest({ mutating: true, idempotencyKey: 'write-key-123' });
  assert.equal(request.idempotency_key, 'write-key-123');
});

test('a read-only call opting in forwards its idempotency key', async () => {
  // Guards `notis debug user-context` / `debug trace-cost`: both run read-only
  // SQL through COMPOSIO_MULTI_EXECUTE_TOOL, which the server classifies as
  // unknown. Dropping the key here returns 400 idempotency_key_required and
  // breaks the documented debugging baseline.
  const request = await captureToolRequest({
    mutating: false,
    idempotencyKey: 'diagnostic-key-123',
    sendIdempotencyKeyWhenReading: true,
  });
  assert.equal(request.idempotency_key, 'diagnostic-key-123');
});
