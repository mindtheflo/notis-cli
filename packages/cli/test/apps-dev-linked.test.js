import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertDirectDeployAccess,
  assertLinkTarget,
  buildLinkedAppState,
  ensureDevInstall,
} from '../src/command-specs/apps.js';
import { readLinkedState } from '../src/runtime/app-platform.js';

function createProject(state = null) {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-dev-linked-'));
  if (state) {
    mkdirSync(join(projectDir, '.notis'), { recursive: true });
    writeFileSync(
      join(projectDir, '.notis', 'state.json'),
      JSON.stringify({ linked_at: new Date(0).toISOString(), ...state }, null, 2),
    );
  }
  return projectDir;
}

function appConfig() {
  return {
    name: 'Notes',
    databases: ['notes'],
    routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    tools: ['LOCAL_NOTIS_DATABASE_QUERY'],
  };
}

function fakeCtx() {
  return {
    runtime: { apiBase: 'http://localhost:3001', jwt: 'token' },
    globalOptions: {},
  };
}

test('linking an installed app preserves the separate development runtime link', () => {
  assert.deepEqual(
    buildLinkedAppState(
      {
        dev_app_id: 'dev-app-1',
        dev_linked_at: '2026-07-01T00:00:00.000Z',
        app_id: 'old-installed-app',
        version: 7,
        deployed_at: '2026-07-02T00:00:00.000Z',
      },
      'installed-app-1',
      '2026-07-03T00:00:00.000Z',
    ),
    {
      dev_app_id: 'dev-app-1',
      dev_linked_at: '2026-07-01T00:00:00.000Z',
      app_id: 'installed-app-1',
      linked_at: '2026-07-03T00:00:00.000Z',
    },
  );
});

test('ensureDevInstall does not pass installed app_id as development app id', async () => {
  const projectDir = createProject({ app_id: 'installed-app-1' });
  let captured = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-1',
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return {
          payload: {
            app: {
              id: 'installed-app-1',
              slug: 'installed-notes',
              manifest: { is_dev: false },
            },
          },
        };
      }
      captured = call;
      return {
        payload: {
          app_id: 'dev-app-1',
          slug: 'notes',
          created: false,
          database_materialization: { created: ['notes'], unresolved: [] },
        },
      };
    },
  });

  assert.equal(captured.toolName, 'LOCAL_NOTIS_ENSURE_DEV_APP_INSTALLATION');
  assert.equal(captured.arguments_.app_id, undefined);
  assert.equal(captured.arguments_.dev_slug, 'notes-dev');
  assert.deepEqual(captured.arguments_.manifest.databases, ['notes']);
  assert.equal(result.appId, 'dev-app-1');
  assert.equal(result.linkedAppId, 'installed-app-1');
  assert.equal(result.targetAppId, 'installed-app-1');
  assert.equal(result.targetAppSlug, 'installed-notes');
  assert.deepEqual(result.databaseMaterialization, { created: ['notes'], unresolved: [] });
});

test('ensureDevInstall sends source-owned skill content and onboarding metadata', async () => {
  const projectDir = createProject();
  const skillDir = join(projectDir, 'skills', 'journal-onboarding');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# Journal Onboarding\n\nCurrent local instructions.\n');
  let captured = null;

  await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: {
      ...appConfig(),
      skills: [
        {
          key: 'journal-onboarding',
          path: './skills/journal-onboarding/SKILL.md',
          name: 'journal-onboarding',
          description: 'Set up the journal routine.',
        },
      ],
      onboarding: {
        skill: 'journal-onboarding',
        prompt: 'Help me set up my Journal reminders.',
      },
    },
    projectDir,
    idempotencyKey: 'idem-skills',
    runTool: async (call) => {
      captured = call;
      return {
        payload: {
          app_id: 'dev-app-1',
          slug: 'notes-dev',
          created: true,
          database_materialization: { created: [], unresolved: [] },
        },
      };
    },
  });

  assert.equal(captured.arguments_.manifest.skills[0].path, 'skills/journal-onboarding/SKILL.md');
  assert.deepEqual(captured.arguments_.manifest.onboarding, {
    skill: 'journal-onboarding',
    prompt: 'Help me set up my Journal reminders.',
  });
  assert.equal(captured.arguments_.skills[0].skill_md, '# Journal Onboarding\n\nCurrent local instructions.\n');
});

test('ensureDevInstall passes explicit dev_app_id when state has one', async () => {
  const projectDir = createProject({ app_id: 'installed-app-1', dev_app_id: 'dev-app-1' });
  let captured = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-dev',
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return call.arguments_.app_id === 'dev-app-1'
          ? { payload: { app: { id: 'dev-app-1', manifest: { is_dev: true } } } }
          : { payload: { app: { id: 'installed-app-1', manifest: { is_dev: false } } } };
      }
      captured = call;
      return {
        payload: {
          app_id: 'dev-app-1',
          slug: 'notes',
          created: false,
          database_materialization: { created: ['notes'], unresolved: [] },
        },
      };
    },
  });

  assert.equal(captured.arguments_.app_id, 'dev-app-1');
  assert.equal(result.appId, 'dev-app-1');
  assert.equal(result.linkedAppId, 'installed-app-1');
  assert.equal(result.targetAppId, 'installed-app-1');
});

test('ensureDevInstall repairs a development id from another runtime before mounting', async () => {
  const projectDir = createProject({ dev_app_id: 'worktree-dev-app' });
  let ensureCall = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-cross-runtime',
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        assert.equal(call.arguments_.app_id, 'worktree-dev-app');
        assert.equal(call.arguments_.include_documents, false);
        return { payload: { status: 'error', message: 'App not found' } };
      }
      ensureCall = call;
      return {
        payload: {
          app_id: 'beta-dev-app',
          slug: 'notes-dev',
          created: false,
        },
      };
    },
  });

  assert.equal(ensureCall.arguments_.app_id, undefined);
  assert.equal(result.appId, 'beta-dev-app');
  const repairedState = readLinkedState(projectDir);
  assert.equal(repairedState.linked_at, new Date(0).toISOString());
  assert.equal(repairedState.dev_app_id, 'beta-dev-app');
  assert.ok(Date.parse(repairedState.dev_linked_at) > 0);
});

test('ensureDevInstall clears a hidden runtime target while preserving the current dev app id', async () => {
  const projectDir = createProject({ app_id: 'stale-dev-app', dev_app_id: 'current-dev-app' });

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-repair',
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return { payload: { app: { id: 'stale-dev-app', manifest: { is_dev: true } } } };
      }
      assert.equal(call.arguments_.app_id, 'current-dev-app');
      return {
        payload: {
          app_id: 'current-dev-app',
          slug: 'notes-dev',
          created: false,
        },
      };
    },
  });

  assert.equal(result.targetAppId, null);
  assert.equal(result.linkedAppId, null);
  assert.deepEqual(readLinkedState(projectDir), {
    dev_app_id: 'current-dev-app',
    dev_linked_at: new Date(0).toISOString(),
  });
});

test('ensureDevInstall fails closed on an unstructured database absence error', async () => {
  const projectDir = createProject({ app_id: 'deleted-installed-app', version: 2 });

  await assert.rejects(
    ensureDevInstall({
      ctx: fakeCtx(),
      appConfig: appConfig(),
      projectDir,
      idempotencyKey: 'idem-missing-target',
      runTool: async () => ({
        payload: { status: 'error', message: 'PGRST116: The result contains 0 rows' },
      }),
    }),
    /Could not verify access to app deleted-installed-app/,
  );

  assert.deepEqual(readLinkedState(projectDir), {
    linked_at: new Date(0).toISOString(),
    app_id: 'deleted-installed-app',
    version: 2,
  });
});

test('ensureDevInstall does not erase a dev id for an unrelated not-found backend error', async () => {
  const projectDir = createProject({ dev_app_id: 'current-dev-app' });

  await assert.rejects(
    ensureDevInstall({
      ctx: fakeCtx(),
      appConfig: appConfig(),
      projectDir,
      idempotencyKey: 'idem-unrelated-not-found',
      runTool: async () => ({
        payload: { status: 'error', message: 'relation app_documents not found' },
      }),
    }),
    /Could not verify access to app current-dev-app/,
  );

  assert.deepEqual(readLinkedState(projectDir), {
    linked_at: new Date(0).toISOString(),
    dev_app_id: 'current-dev-app',
  });
});

test('ensureDevInstall preserves its installed target when verification fails unexpectedly', async () => {
  const projectDir = createProject({ app_id: 'installed-app', version: 2 });

  await assert.rejects(
    ensureDevInstall({
      ctx: fakeCtx(),
      appConfig: appConfig(),
      projectDir,
      idempotencyKey: 'idem-verification-error',
      runTool: async () => ({ payload: { status: 'error', message: 'Database temporarily unavailable' } }),
    }),
    /Could not verify access to app installed-app/,
  );

  assert.deepEqual(readLinkedState(projectDir), {
    linked_at: new Date(0).toISOString(),
    app_id: 'installed-app',
    version: 2,
  });
});

test('assertLinkTarget rejects hidden development runtime apps', async () => {
  await assert.rejects(
    assertLinkTarget(fakeCtx().runtime, 'dev-runtime-app', async () => ({
      payload: {
        app: { id: 'dev-runtime-app', manifest: { is_dev: true } },
        apps_access: { has_access: true, reason: 'price_plan' },
      },
    })),
    /Cannot link to development runtime app dev-runtime-app/,
  );
});

test('assertDirectDeployAccess blocks direct upload when the Apps entitlement is absent', async () => {
  await assert.rejects(
    assertDirectDeployAccess(fakeCtx().runtime, 'installed-app', async () => ({
      payload: {
        app: { id: 'installed-app', manifest: { is_dev: false } },
        apps_access: { has_access: false },
      },
    })),
    /PRO\+ or ULTRA/,
  );
});

test('ensureDevInstall keeps unlinked dev installs separate and reports unresolved databases', async () => {
  const projectDir = createProject();
  let captured = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-2',
    runTool: async (call) => {
      captured = call;
      return {
        payload: {
          app_id: 'dev-app-1',
          slug: 'notes-dev',
          created: true,
          database_materialization: { created: [], unresolved: ['notes'] },
        },
      };
    },
  });

  assert.equal(captured.arguments_.app_id, undefined);
  assert.equal(result.appId, 'dev-app-1');
  assert.equal(result.linkedAppId, null);
  assert.deepEqual(result.databaseMaterialization, { created: [], unresolved: ['notes'] });
});
