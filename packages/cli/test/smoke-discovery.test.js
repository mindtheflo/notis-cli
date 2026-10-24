import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const baseTools = ['DROPBOX_UPLOAD_FILE', 'DROPBOX_GET_METADATA', 'DROPBOX_DELETE_FILE'];

async function runSmoke(t, { broadHasRead = false, focusedHasRead = true } = {}) {
  const requests = [];
  let searches = 0;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    let payload;
    if (body.tool_name === 'COMPOSIO_SEARCH_TOOLS') {
      searches += 1;
      const includeRead = searches <= 2 ? broadHasRead : focusedHasRead;
      payload = { results: [{ primary_tool_slugs: [...baseTools, ...(includeRead ? ['DROPBOX_READ_FILE'] : [])] }] };
    } else if (body.tool_name === 'COMPOSIO_GET_TOOL_SCHEMAS') {
      // Stop at the upload-schema guard. This proves selection reached the
      // next safety boundary without exercising a provider write or upload.
      payload = { tool_schemas: { DROPBOX_UPLOAD_FILE: {
        input_schema: { type: 'object', properties: { content: { type: 'string' } } },
      } } };
    } else {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Unexpected mutation or execution' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const home = await mkdtemp(join(tmpdir(), 'notis-smoke-discovery-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub: 'smoke-fixture', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  let output;
  try {
    await promisify(execFile)(process.execPath, [
      new URL('../bin/notis.js', import.meta.url).pathname,
      '--api-base', `http://127.0.0.1:${server.address().port}`, 'smoke', 'file-upload', '--json',
    ], { env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'test', NOTIS_JWT: jwt, NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1' } });
    assert.fail('Smoke must stop before upload at the fixture schema guard');
  } catch (error) {
    assert.equal(error.code, 2);
    output = JSON.parse(error.stdout);
  }
  assert.equal(output.ok, false);
  assert.equal(requests.some((r) => r.tool_name === 'COMPOSIO_MULTI_EXECUTE_TOOL'), false);
  return { output, requests, searches };
}

test('Dropbox smoke discovers an accessible reader missed by broad search before considering an upload', async (t) => {
  const { output, requests, searches } = await runSmoke(t);
  assert.match(output.error.message, /content is not marked file_uploadable/);
  assert.equal(searches, 3);
  assert.equal(requests.at(-1).tool_name, 'COMPOSIO_GET_TOOL_SCHEMAS');
});

test('Dropbox smoke stops without upload when focused discovery also lacks a reader', async (t) => {
  const { output, requests, searches } = await runSmoke(t, { focusedHasRead: false });
  assert.match(output.error.message, /could not discover: read/);
  assert.equal(searches, 3);
  assert.equal(requests.length, 3);
});

test('Dropbox smoke keeps its broad discovery fast path when the reader is already known', async (t) => {
  const { output, searches } = await runSmoke(t, { broadHasRead: true });
  assert.match(output.error.message, /content is not marked file_uploadable/);
  assert.equal(searches, 2);
});
