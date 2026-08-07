import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const cliRoot = resolve(import.meta.dirname, '..');
const binPath = join(cliRoot, 'bin', 'notis.js');
const execFileAsync = promisify(execFile);

function makeJwt(sub = 'smoke-user', exp = 4102444800) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub, exp })}.sig`;
}

async function runCli(args, { homeDir, env = {} }) {
  const options = {
    cwd: cliRoot,
    env: {
      PATH: process.env.PATH,
      HOME: homeDir,
      NOTIS_JWT: makeJwt(),
      NODE_ENV: 'test',
      NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
      ...env,
    },
    encoding: 'utf-8',
  };

  try {
    const result = await execFileAsync('node', [binPath, ...args], options);
    return {
      status: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      status: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

function startFakeBackend() {
  const state = {
    app: null,
    version: 1,
    updatedAt: '2026-03-25T00:00:00.000Z',
    files: {
      'bundle/app.js': Buffer.from(
        [
          'import React from "react";',
          'export function home() {',
          '  return React.createElement("div", null, "Hello from smoke test");',
          '}',
          '',
        ].join('\n'),
        'utf-8',
      ).toString('base64'),
      'bundle/app.css': Buffer.from('[data-notis-app-root] {}\n', 'utf-8').toString('base64'),
    },
    requests: [],
  };

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/cli_tools') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    state.requests.push(payload);

    if (!req.headers.authorization) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'missing auth' } }));
      return;
    }

    if (payload.tool_name === 'LOCAL_NOTIS_CREATE_APP') {
      state.app = {
        id: 'app-smoke-123',
        name: payload.arguments?.name || 'Smoke App',
        description: payload.arguments?.description || null,
        icon: payload.arguments?.icon || null,
        current_version: state.version,
        status: 'draft',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          app: state.app,
          request_id: 'req_create',
          warnings: [],
          hints: [],
        }),
      );
      return;
    }

    if (payload.tool_name === 'LOCAL_NOTIS_LOAD_APP_FILES') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          files: state.files,
          routes: [{ slug: 'home', name: 'Home' }],
          version: state.version,
          updated_at: state.updatedAt,
          request_id: 'req_pull',
          warnings: [],
          hints: [],
        }),
      );
      return;
    }

    if (payload.tool_name === 'LOCAL_NOTIS_LINT_APP_FILES') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          manifest: payload.arguments?.manifest || null,
          request_id: 'req_lint',
          warnings: [],
          hints: [],
        }),
      );
      return;
    }

    if (payload.tool_name === 'LOCAL_NOTIS_SAVE_APP_FILES') {
      assert.equal(payload.arguments?.app_id, state.app?.id);
      assert.ok(payload.arguments?.files && typeof payload.arguments.files === 'object');
      assert.ok(payload.arguments?.manifest && typeof payload.arguments.manifest === 'object');

      state.version += 1;
      state.updatedAt = '2026-03-25T00:05:00.000Z';
      state.files = payload.arguments.files;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          version: state.version,
          updated_at: state.updatedAt,
          manifest: {
            version: state.version,
            spec_version: 3,
            routes: [{ path: '/', slug: 'home', name: 'Home' }],
            bundle: { js: 'bundle/app.js', css: 'bundle/app.css' },
          },
          request_id: 'req_push',
          warnings: [],
          hints: [],
        }),
      );
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `unexpected tool ${payload.tool_name}` } }));
  });

  return new Promise((resolvePromise, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind fake backend server'));
        return;
      }
      resolvePromise({
        state,
        apiBase: `http://127.0.0.1:${address.port}`,
        async close() {
          await new Promise((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          });
        },
      });
    });
  });
}

test('CLI happy path smoke test covers create', async () => {
  const fakeBackend = await startFakeBackend();
  const homeDir = mkdtempSync(join(tmpdir(), 'notis-cli-smoke-'));

  try {
    const sharedEnv = {
      NOTIS_API_BASE: fakeBackend.apiBase,
      NOTIS_NON_INTERACTIVE: '1',
    };

    const createResult = await runCli(['apps', 'create', 'Smoke App', '--json'], { homeDir, env: sharedEnv });
    assert.equal(createResult.status, 0, createResult.stderr);
    const createPayload = JSON.parse(createResult.stdout);
    assert.equal(createPayload.ok, true);
    assert.equal(createPayload.data.app.id, 'app-smoke-123');
    assert.ok(createPayload.data.idempotency_key);

    const createRequest = fakeBackend.state.requests.find((request) => request.tool_name === 'LOCAL_NOTIS_CREATE_APP');
    assert.ok(createRequest, 'expected a create_app request to be sent');
    assert.equal(createRequest.arguments.name, 'Smoke App');
    assert.equal(createRequest.arguments.description, undefined);
  } finally {
    await fakeBackend.close();
  }
});
