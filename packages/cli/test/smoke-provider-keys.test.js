import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

async function runLifecycle(t, idempotencyKey) {
  const text = 'Owned smoke fixture: été Zürich 東京\n';
  const bytes = Buffer.from(text);
  const calls = [];
  let deleted = false;
  let destination;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/download') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(bytes);
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(request.headers['content-type']?.includes('multipart/form-data')
      ? raw.match(/name="payload"\r\n\r\n([^\r]+)/)[1] : raw);
    let payload;
    if (body.tool_name === 'COMPOSIO_SEARCH_TOOLS') {
      payload = { results: [{ primary_tool_slugs: ['DROPBOX_UPLOAD_FILE', 'DROPBOX_GET_METADATA', 'DROPBOX_READ_FILE', 'DROPBOX_DELETE_FILE'] }] };
    } else if (body.tool_name === 'COMPOSIO_GET_TOOL_SCHEMAS') {
      payload = { tool_schemas: { DROPBOX_UPLOAD_FILE: { input_schema: {
        type: 'object', properties: { content: { type: 'string', file_uploadable: true } },
      } } } };
    } else if (body.tool_name === 'COMPOSIO_MULTI_EXECUTE_TOOL') {
      const tool = body.arguments.tools[0];
      calls.push({ slug: tool.tool_slug, key: body.idempotency_key });
      if (!body.idempotency_key) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'idempotency_key_required', message: 'Wrapper requires a key' } }));
        return;
      }
      let data;
      let successful = true;
      if (tool.tool_slug === 'DROPBOX_UPLOAD_FILE') {
        destination = tool.arguments.path;
        assert.ok(raw.includes(text), 'the upload carries the owned fixture bytes');
        data = { path_display: destination, rev: 'fixture-revision', size: bytes.length };
      } else if (tool.tool_slug === 'DROPBOX_GET_METADATA' && deleted) {
        successful = false;
        data = { error: 'path/not_found' };
      } else if (tool.tool_slug === 'DROPBOX_GET_METADATA') {
        data = { metadata: { path_display: destination, rev: 'fixture-revision', size: bytes.length } };
      } else if (tool.tool_slug === 'DROPBOX_READ_FILE') {
        data = { content: { s3url: `http://127.0.0.1:${server.address().port}/download` } };
      } else if (tool.tool_slug === 'DROPBOX_DELETE_FILE') {
        assert.equal(tool.arguments.parent_rev, 'fixture-revision');
        deleted = true;
        data = {};
      }
      payload = { results: [{ response: { successful, data } }] };
    } else {
      response.writeHead(400);
      response.end('{}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const home = await mkdtemp(join(tmpdir(), 'notis-smoke-keys-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = join(home, 'fixture.txt');
  await writeFile(source, bytes);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub: 'smoke-fixture', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL('../bin/notis.js', import.meta.url).pathname,
    '--api-base', `http://127.0.0.1:${server.address().port}`, '--idempotency-key', idempotencyKey,
    'smoke', 'file-upload', '--source-file', source, '--json',
  ], { timeout: 10000, env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'test', NOTIS_JWT: jwt, NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1' } });
  const output = JSON.parse(stdout);
  assert.equal(output.ok, true);
  assert.equal(output.data.download.hash_match, true);
  assert.equal(output.data.cleanup.not_found_verified, true);
  return calls.map((c) => c.key);
}

test('Dropbox smoke keys every wrapper phase and verifies matching bytes and deletion', async (t) => {
  const keys = await runLifecycle(t, 'fixture-smoke');
  assert.deepEqual(keys, ['fixture-smoke:upload', 'fixture-smoke:metadata', 'fixture-smoke:download', 'fixture-smoke:delete', 'fixture-smoke:verify-not-found']);
});

test('a maximum-length supplied key keeps phase keys bounded, distinct and stable', async (t) => {
  const base = 'x'.repeat(160);
  const first = await runLifecycle(t, base);
  const second = await runLifecycle(t, base);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, 5);
  for (const key of first) {
    assert.ok(key.length >= 8 && key.length <= 160);
    assert.match(key, /^[A-Za-z0-9._:-]+$/);
  }
});
