import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertDirectDeployAccess,
  assertLinkTarget,
  buildLinkedAppState,
  compareNotisAppVersions,
  discoverAppDevLaunchProjects,
  ensureDevInstall,
  selectCanonicalDevApps,
} from '../src/command-specs/apps.js';
import { appLinkedStateProfileKey, readLinkedState } from '../src/runtime/app-platform.js';

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

function writeNotisAppVersion(projectDir, version) {
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify(version ? { name: 'notes', notisAppVersion: version } : { name: 'notes' }, null, 2),
  );
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

function jwtFor(sub) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub })).toString('base64url'),
    'signature',
  ].join('.');
}

test('an explicitly registered source replaces a duplicate from the implicit default root', () => {
  const implicitRoot = '/Users/test/.notis/apps';
  const explicitRoot = '/Users/test/projects/notes';
  const result = selectCanonicalDevApps([
    { devSlug: 'notes-dev', projectDir: `${implicitRoot}/notes` },
    { devSlug: 'notes-dev', projectDir: explicitRoot },
    { devSlug: 'calendar-dev', projectDir: `${implicitRoot}/calendar` },
  ], {
    roots: [
      { path: implicitRoot, implicit: true, registeredAt: null },
      { path: explicitRoot, implicit: false, registeredAt: '2026-08-25T00:00:00.000Z' },
    ],
  });

  assert.deepEqual(
    result.selected.map(({ projectDir }) => projectDir),
    [explicitRoot, `${implicitRoot}/calendar`],
  );
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /ignored duplicate source/);
});

test('apps dev registers the requested root and always discovers the complete registry', () => {
  const calls = [];
  const discovered = discoverAppDevLaunchProjects('/projects/new-root', {
    registerRoot: (root) => calls.push(['register', root]),
    discoverProjects: () => {
      calls.push(['discover']);
      return ['/default/app', '/projects/older-root/app', '/projects/new-root/app'];
    },
  });

  assert.deepEqual(calls, [
    ['register', '/projects/new-root'],
    ['discover'],
  ]);
  assert.deepEqual(discovered, [
    '/default/app',
    '/projects/older-root/app',
    '/projects/new-root/app',
  ]);
});

test('Desktop reconciliation skips registration but still discovers the complete registry', () => {
  const calls = [];
  const discovered = discoverAppDevLaunchProjects('/already/discovered/app', {
    skipRootRegistration: true,
    registerRoot: (root) => calls.push(['register', root]),
    discoverProjects: () => {
      calls.push(['discover']);
      return ['/default/app', '/registered/app'];
    },
  });

  assert.deepEqual(calls, [['discover']]);
  assert.deepEqual(discovered, ['/default/app', '/registered/app']);
});

test('equally ranked duplicate local sources fail closed without hiding unrelated apps', () => {
  const result = selectCanonicalDevApps([
    { devSlug: 'notes-dev', projectDir: '/Users/test/projects/one' },
    { devSlug: 'notes-dev', projectDir: '/Users/test/projects/two' },
    { devSlug: 'calendar-dev', projectDir: '/Users/test/projects/calendar' },
  ], {
    roots: [
      { path: '/Users/test/projects', implicit: false, registeredAt: '2026-08-25T00:00:00.000Z' },
    ],
  });

  assert.deepEqual(
    result.selected.map(({ projectDir }) => projectDir),
    ['/Users/test/projects/calendar'],
  );
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Skipped ambiguous development slug/);
});

test('apps dev publishes each ready mount before later registrations finish', () => {
  const source = readFileSync(new URL('../src/command-specs/apps.js', import.meta.url), 'utf8');
  const handler = source.slice(
    source.indexOf('async function appsDevHandler'),
    source.indexOf('async function appsRootsListHandler'),
  );
  const registrationLoop = handler.indexOf('for (const {\n    appConfig,');
  const publishSession = handler.indexOf('upsertAppDevSessions(sessionRecord');
  const allRegistrationsFinished = handler.indexOf("logAppsTiming('ensure-dev-install:all'");

  assert.ok(registrationLoop >= 0, 'registration loop must remain explicit');
  assert.ok(publishSession > registrationLoop, 'a completed app must publish inside the registration loop');
  assert.ok(
    publishSession < allRegistrationsFinished,
    'the first mount must publish before unrelated registrations finish',
  );
});

test('apps dev installs watcher cleanup before remote registration begins', () => {
  const source = readFileSync(new URL('../src/command-specs/apps.js', import.meta.url), 'utf8');
  const handler = source.slice(
    source.indexOf('async function appsDevHandler'),
    source.indexOf('async function appsRootsListHandler'),
  );
  const devServerStarted = handler.indexOf('await startAppDevServer({');
  const sigtermHandler = handler.indexOf("process.on('SIGTERM', handleSigterm)");
  const registrationLoop = handler.indexOf('for (const {\n    appConfig,');

  assert.ok(devServerStarted >= 0, 'source host must start its watcher groups');
  assert.ok(sigtermHandler > devServerStarted, 'cleanup requires the started dev server');
  assert.ok(
    sigtermHandler < registrationLoop,
    'SIGTERM cleanup must be active before the first remote registration can block',
  );
});

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

test('link does not treat a remote version as deployment provenance', () => {
  assert.deepEqual(
    buildLinkedAppState(
      {
        dev_app_id: 'dev-app-1',
        dev_linked_at: '2026-07-01T00:00:00.000Z',
      },
      'installed-app-1',
      '2026-07-03T00:00:00.000Z',
      9,
    ),
    {
      dev_app_id: 'dev-app-1',
      dev_linked_at: '2026-07-01T00:00:00.000Z',
      app_id: 'installed-app-1',
      linked_at: '2026-07-03T00:00:00.000Z',
    },
  );
});

test('same-id link clears dev identity without claiming deployment provenance', () => {
  assert.deepEqual(
    buildLinkedAppState(
      {
        dev_app_id: 'app-1',
        dev_linked_at: '2026-07-01T00:00:00.000Z',
      },
      'app-1',
      '2026-07-03T00:00:00.000Z',
      4,
    ),
    {
      app_id: 'app-1',
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
    useInstalledDatabases: true,
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
  assert.equal(captured.arguments_.installed_app_id, 'installed-app-1');
  assert.equal(captured.arguments_.dev_slug, 'notes-dev');
  assert.deepEqual(captured.arguments_.manifest.databases, ['notes']);
  assert.equal(result.appId, 'dev-app-1');
  assert.equal(result.linkedAppId, 'installed-app-1');
  assert.equal(result.targetAppId, 'installed-app-1');
  assert.equal(result.targetAppSlug, 'installed-notes');
  assert.deepEqual(result.databaseMaterialization, { created: ['notes'], unresolved: [] });
});

test('apps dev reports mount eligibility only when local semver is strictly newer', async (t) => {
  const cases = [
    { name: 'greater', local: '1.2.4', installed: '1.2.3', eligible: true },
    { name: 'equal', local: '1.2.3', installed: '1.2.3', eligible: false },
    { name: 'lower', local: '1.2.2', installed: '1.2.3', eligible: false },
    { name: 'missing', local: null, installed: '1.2.3', eligible: false },
    { name: 'invalid', local: '1.2.3-01', expectedLocal: null, installed: '1.2.3', eligible: false },
  ];

  for (const example of cases) {
    await t.test(example.name, async () => {
      const projectDir = createProject({ app_id: 'installed-app-1' });
      writeNotisAppVersion(projectDir, example.local);
      const result = await ensureDevInstall({
        ctx: fakeCtx(),
        appConfig: appConfig(),
        projectDir,
        idempotencyKey: `idem-version-${example.name}`,
        runTool: async (call) => {
          if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
            return {
              payload: {
                app: {
                  id: 'installed-app-1',
                  slug: 'notes',
                  manifest: {
                    is_dev: false,
                    app: { name: 'Notes', release_version: example.installed },
                  },
                },
              },
            };
          }
          return { payload: { app_id: 'dev-app-1', slug: 'notes-dev', created: false } };
        },
      });

      assert.equal(
        result.localReleaseVersion,
        Object.hasOwn(example, 'expectedLocal') ? example.expectedLocal : example.local,
      );
      assert.equal(result.installedReleaseVersion, example.installed);
      assert.equal(result.mountEligible, example.eligible);
    });
  }
});

test('CLI Notis app comparison follows semver prerelease rules', () => {
  assert.equal(compareNotisAppVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareNotisAppVersions('1.0.0+local', '1.0.0+online'), 0);
  assert.equal(compareNotisAppVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareNotisAppVersions('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareNotisAppVersions(null, '1.0.0'), null);
  assert.equal(compareNotisAppVersions('1.0.0-01', '1.0.0'), null);
  assert.equal(
    compareNotisAppVersions('999999999999999999999.0.0', '999999999999999999998.0.0'),
    1,
  );
});

test('apps dev reports release eligibility and a preserve-pull-bump recovery path', () => {
  const source = readFileSync(new URL('../src/command-specs/apps.js', import.meta.url), 'utf8');
  const handler = source.slice(
    source.indexOf('async function appsDevHandler'),
    source.indexOf('async function appsRootsListHandler'),
  );
  assert.match(handler, /local_release_version: app\.localReleaseVersion/);
  assert.match(handler, /installed_release_version: app\.installedReleaseVersion/);
  assert.match(handler, /mount_eligible: app\.mountEligible/);

  const warning = source.slice(
    source.indexOf('function versionPrecedenceWarnings'),
    source.indexOf('async function getAccessibleApp'),
  );
  assert.match(warning, /Preserve any local edits, pull latest with .* then bump package\.json notisAppVersion/);
  assert.match(warning, /notis apps pull .* --force/);
});

test('ensureDevInstall keeps an explicit devSlug after the display name changes', async () => {
  const projectDir = createProject();
  let captured = null;

  await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: {
      ...appConfig(),
      name: 'Renamed Notes',
      devSlug: 'notes',
    },
    projectDir,
    idempotencyKey: 'idem-stable-dev-slug',
    runTool: async (call) => {
      captured = call;
      return {
        payload: {
          app_id: 'dev-app-1',
          slug: 'notes-dev',
          created: false,
        },
      };
    },
  });

  assert.equal(captured.arguments_.dev_slug, 'notes-dev');
  assert.equal(captured.arguments_.name, 'Renamed Notes');
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

test('ensureDevInstall sends a directory skill with its supporting files', async () => {
  const projectDir = createProject();
  const skillDir = join(projectDir, 'skills', 'new-workspace');
  mkdirSync(join(skillDir, 'scripts'), { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# New workspace\n\nRun the scripts.\n');
  writeFileSync(join(skillDir, 'scripts', 'run_job.sh'), '#!/bin/bash\necho job\n');
  let captured = null;

  await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: {
      ...appConfig(),
      skills: [
        { key: 'new-workspace', path: './skills/new-workspace/', name: 'New workspace' },
      ],
    },
    projectDir,
    idempotencyKey: 'idem-skill-dir',
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

  assert.equal(captured.arguments_.manifest.skills[0].path, 'skills/new-workspace');
  assert.equal(captured.arguments_.skills[0].skill_md, '# New workspace\n\nRun the scripts.\n');
  assert.deepEqual(
    captured.arguments_.skills[0].bundle_files.map((entry) => entry.path),
    ['SKILL.md', 'scripts/run_job.sh'],
  );
  assert.equal(
    Buffer.from(
      captured.arguments_.skills[0].bundle_files.find((entry) => entry.path === 'scripts/run_job.sh').content_b64,
      'base64',
    ).toString('utf8'),
    '#!/bin/bash\necho job\n',
  );
});

test('ensureDevInstall passes explicit dev_app_id when state has one', async () => {
  const projectDir = createProject({ app_id: 'installed-app-1', dev_app_id: 'dev-app-1' });
  let captured = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-dev',
    useInstalledDatabases: true,
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
  assert.equal(captured.arguments_.installed_app_id, 'installed-app-1');
  assert.equal(result.appId, 'dev-app-1');
  assert.equal(result.linkedAppId, 'installed-app-1');
  assert.equal(result.targetAppId, 'installed-app-1');
});

test('ensureDevInstall persistently auto-links one accessible exact-slug installed app', async () => {
  const projectDir = createProject({ dev_app_id: 'dev-app-1' });
  let ensureCall = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-legacy-live-data',
    useInstalledDatabases: true,
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return { payload: { app: { id: 'dev-app-1', slug: 'notes-dev', manifest: { is_dev: true } } } };
      }
      if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
        return {
          payload: {
            apps: [
              { app_id: 'dev-app-1', slug: 'notes-dev', manifest: { is_dev: true } },
              { app_id: 'installed-app-1', slug: 'notes', manifest: { is_dev: false } },
            ],
          },
        };
      }
      ensureCall = call;
      return { payload: { app_id: 'dev-app-1', slug: 'notes-dev', created: false } };
    },
  });

  assert.equal(ensureCall.arguments_.installed_app_id, 'installed-app-1');
  assert.equal(result.targetAppId, 'installed-app-1');
  assert.equal(readLinkedState(projectDir).app_id, 'installed-app-1');
});

test('ensureDevInstall matches the canonical source slug when the installed row slug changed', async () => {
  const projectDir = createProject({ dev_app_id: 'dev-app-1' });
  let ensureCall = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-source-slug',
    useInstalledDatabases: true,
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return { payload: { app: { id: 'dev-app-1', slug: 'notes-dev', manifest: { is_dev: true } } } };
      }
      if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
        return {
          payload: {
            apps: [{
              app_id: 'installed-app-1',
              slug: 'five-minute-notes',
              manifest: { app: { slug: 'notes' }, is_dev: false },
            }],
          },
        };
      }
      ensureCall = call;
      return { payload: { app_id: 'dev-app-1', slug: 'notes-dev', created: false } };
    },
  });

  assert.equal(ensureCall.arguments_.installed_app_id, 'installed-app-1');
  assert.equal(result.targetAppId, 'installed-app-1');
  assert.equal(readLinkedState(projectDir).app_id, 'installed-app-1');
});

test('ensureDevInstall migrates one accessible explicit project link into the current profile', async () => {
  const apiBase = 'http://localhost:50371';
  const userId = 'current-user';
  const currentProfile = appLinkedStateProfileKey({ apiBase, userId });
  const priorProfile = appLinkedStateProfileKey({
    apiBase: 'http://localhost:55011',
    userId: 'prior-user',
  });
  const projectDir = createProject({
    profiles: {
      [currentProfile]: { dev_app_id: 'dev-app-1' },
      [priorProfile]: { app_id: 'installed-app-1', dev_app_id: 'prior-dev-app' },
    },
  });
  let ensureCall = null;

  const result = await ensureDevInstall({
    ctx: {
      runtime: { apiBase, jwt: jwtFor(userId) },
      globalOptions: {},
    },
    appConfig: { ...appConfig(), devSlug: 'notes-local' },
    projectDir,
    idempotencyKey: 'idem-profile-link-migration',
    useInstalledDatabases: true,
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return { payload: { app: { id: 'dev-app-1', slug: 'notes-local-dev', manifest: { is_dev: true } } } };
      }
      if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
        return {
          payload: {
            apps: [{
              app_id: 'installed-app-1',
              slug: 'completely-different',
              manifest: { app: { slug: 'also-different' }, is_dev: false },
            }],
          },
        };
      }
      ensureCall = call;
      return { payload: { app_id: 'dev-app-1', slug: 'notes-local-dev', created: false } };
    },
  });

  assert.equal(ensureCall.arguments_.installed_app_id, 'installed-app-1');
  assert.equal(result.targetAppId, 'installed-app-1');
  assert.equal(readLinkedState(projectDir, currentProfile).app_id, 'installed-app-1');
  assert.equal(readLinkedState(projectDir, priorProfile).app_id, 'installed-app-1');
});

test('ensureDevInstall fails closed when older profiles persist multiple accessible installed apps', async () => {
  const apiBase = 'http://localhost:50371';
  const userId = 'current-user';
  const currentProfile = appLinkedStateProfileKey({ apiBase, userId });
  const projectDir = createProject({
    profiles: {
      [currentProfile]: { dev_app_id: 'dev-app-1' },
      [appLinkedStateProfileKey({ apiBase: 'http://localhost:55011', userId: 'prior-a' })]: {
        app_id: 'installed-app-1',
      },
      [appLinkedStateProfileKey({ apiBase: 'http://localhost:55012', userId: 'prior-b' })]: {
        app_id: 'installed-app-2',
      },
    },
  });

  await assert.rejects(ensureDevInstall({
    ctx: {
      runtime: { apiBase, jwt: jwtFor(userId) },
      globalOptions: {},
    },
    appConfig: { ...appConfig(), devSlug: 'notes-local' },
    projectDir,
    idempotencyKey: 'idem-ambiguous-profile-links',
    useInstalledDatabases: true,
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return { payload: { app: { id: 'dev-app-1', slug: 'notes-local-dev', manifest: { is_dev: true } } } };
      }
      if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
        return { payload: { apps: [
          { app_id: 'installed-app-1', slug: 'one', manifest: { is_dev: false } },
          { app_id: 'installed-app-2', slug: 'two', manifest: { is_dev: false } },
        ] } };
      }
      assert.fail('ensure must not run for ambiguous persisted links');
    },
  }), /Multiple accessible installed apps are persisted/);

  assert.equal(readLinkedState(projectDir, currentProfile).app_id, undefined);
});

test('ensureDevInstall fails closed when exact-slug installed matches are ambiguous', async () => {
  const projectDir = createProject();
  await assert.rejects(ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-ambiguous-slug',
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
        return { payload: { apps: [
          { app_id: 'notes-1', slug: 'notes' },
          { app_id: 'notes-2', slug: 'notes' },
        ] } };
      }
      assert.fail('ensure must not run for an ambiguous exact slug');
    },
  }), /Multiple accessible installed apps use the exact slug/);
  assert.equal(readLinkedState(projectDir), null);
});

test('ensureDevInstall permits a legacy pre-deploy state when no installed target exists', async () => {
  const projectDir = createProject({ dev_app_id: 'dev-app-1' });
  let ensureCall = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-legacy-predeploy',
    useInstalledDatabases: true,
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        return { payload: { app: { id: 'dev-app-1', slug: 'notes-dev', manifest: { is_dev: true } } } };
      }
      if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
        return { payload: { apps: [{ app_id: 'another-app', slug: 'tasks' }] } };
      }
      ensureCall = call;
      return { payload: { app_id: 'dev-app-1', slug: 'notes-dev', created: false } };
    },
  });

  assert.equal(ensureCall.arguments_.installed_app_id, undefined);
  assert.equal(result.targetAppId, null);
  assert.equal(readLinkedState(projectDir).app_id, undefined);
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

test('ensureDevInstall adopts the canonical dev slug owner when the profile dev id is stale', async () => {
  const projectDir = createProject({
    app_id: 'installed-app-1',
    dev_app_id: 'stale-dev-app',
    dev_linked_at: new Date(0).toISOString(),
  });
  const ensureCalls = [];

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-adopt-slug-owner',
    useInstalledDatabases: true,
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        const appId = call.arguments_.app_id;
        if (appId === 'stale-dev-app') {
          return { payload: { app: { id: appId, slug: 'old-notes-dev', manifest: { is_dev: true } } } };
        }
        return { payload: { app: { id: appId, slug: 'notes', manifest: { is_dev: false } } } };
      }
      ensureCalls.push(call);
      if (ensureCalls.length === 1) {
        const conflict = new Error("Dev slug 'notes-dev' is already used by another development app.");
        conflict.details = { error: { code: 'dev_app_slug_conflict' } };
        throw conflict;
      }
      return { payload: { app_id: 'canonical-dev-app', slug: 'notes-dev', created: false } };
    },
  });

  assert.equal(ensureCalls[0].arguments_.app_id, 'stale-dev-app');
  assert.equal(ensureCalls[0].arguments_.installed_app_id, 'installed-app-1');
  assert.equal(ensureCalls[1].arguments_.app_id, undefined);
  assert.equal(ensureCalls[1].arguments_.installed_app_id, 'installed-app-1');
  assert.equal(
    ensureCalls[1].idempotencyKey,
    'idem-adopt-slug-owner:adopt-slug-owner:stale-dev-app',
  );
  assert.equal(result.appId, 'canonical-dev-app');
  assert.equal(result.targetAppId, 'installed-app-1');
  assert.equal(readLinkedState(projectDir).app_id, 'installed-app-1');
  assert.equal(readLinkedState(projectDir).dev_app_id, 'canonical-dev-app');
});

test('ensureDevInstall preserves an installed link from another runtime without using it locally', async () => {
  const projectDir = createProject({ app_id: 'beta-installed-app' });
  let ensureCall = null;

  const result = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir,
    idempotencyKey: 'idem-cross-runtime-installed',
    useInstalledDatabases: true,
    runTool: async (call) => {
      if (call.toolName === 'LOCAL_NOTIS_GET_APP') {
        assert.equal(call.arguments_.app_id, 'beta-installed-app');
        return { payload: { status: 'error', message: 'App not found' } };
      }
      ensureCall = call;
      return {
        payload: {
          app_id: 'worktree-dev-app',
          slug: 'notes-dev',
          created: true,
        },
      };
    },
  });

  assert.equal(ensureCall.arguments_.installed_app_id, undefined);
  assert.equal(result.linkedAppId, null);
  assert.equal(result.targetAppId, null);
  assert.deepEqual(readLinkedState(projectDir), {
    linked_at: new Date(0).toISOString(),
    app_id: 'beta-installed-app',
    dev_app_id: 'worktree-dev-app',
    dev_linked_at: readLinkedState(projectDir).dev_linked_at,
  });
  assert.ok(Date.parse(readLinkedState(projectDir).dev_linked_at) > 0);
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
      if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
        return { payload: { apps: [] } };
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

test('ensureDevInstall sends the live-data choice on every call', async () => {
  const calls = [];
  const runTool = async (call) => {
    if (call.toolName === 'LOCAL_NOTIS_LIST_APPS') {
      return { payload: { apps: [] } };
    }
    calls.push(call);
    return {
      payload: {
        app_id: 'dev-app-1',
        slug: 'notes-dev',
        created: false,
        database_materialization: { created: [], unresolved: [] },
        live_data: {
          requested: true,
          enabled: true,
          installed_app_id: 'installed-app-1',
          warning: null,
        },
      },
    };
  };

  const live = await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir: createProject(),
    idempotencyKey: 'idem-live',
    useInstalledDatabases: true,
    runTool,
  });

  assert.equal(calls[0].arguments_.use_installed_databases, true);
  assert.equal(live.liveData.installed_app_id, 'installed-app-1');

  // Dropping the flag has to put the next session back on its dev copies, so
  // `false` is sent rather than omitted.
  await ensureDevInstall({
    ctx: fakeCtx(),
    appConfig: appConfig(),
    projectDir: createProject(),
    idempotencyKey: 'idem-dev-copies',
    runTool,
  });

  assert.equal(calls[1].arguments_.use_installed_databases, false);
});
