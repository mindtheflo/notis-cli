import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_APP_DEV_SESSIONS_FILE,
  getAppDevSessionsFile,
} from '../src/runtime/app-dev-sessions.js';

// Resolve symlinks (macOS tmpdir is /var -> /private/var) so paths compare
// equal to `process.cwd()` after chdir.
function makeWorkspace() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'notis-ws-')));
  mkdirSync(join(workspace, '.context'), { recursive: true });
  const appDir = join(workspace, 'my-app');
  mkdirSync(appDir, { recursive: true });
  return { workspace, appDir };
}

test('getAppDevSessionsFile uses only explicit test paths or the global registry', (t) => {
  const { appDir } = makeWorkspace();
  const cwd = process.cwd();
  t.after(() => {
    process.chdir(cwd);
  });

  process.chdir(appDir);

  // Explicit path always wins.
  assert.equal(getAppDevSessionsFile('/explicit/path.json'), '/explicit/path.json');
  assert.equal(getAppDevSessionsFile(), DEFAULT_APP_DEV_SESSIONS_FILE);
});

test('getAppDevSessionsFile falls back to the global default outside any workspace', (t) => {
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'notis-nows-')));
  const cwd = process.cwd();
  t.after(() => {
    process.chdir(cwd);
  });
  process.chdir(bare);
  assert.equal(getAppDevSessionsFile(), DEFAULT_APP_DEV_SESSIONS_FILE);
});
