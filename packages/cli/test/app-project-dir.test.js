// `apps init` / `apps pull` default to ~/.notis/apps/<slug> instead of the
// caller's working directory: an agent's shell sits wherever the previous
// command left it, so a cwd-relative default scattered projects into unrelated
// checkouts. An explicit [dir] still wins, which is how an app lands in a
// tracked git repo.
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_APPS_ROOT,
  defaultAppProjectDir,
  expandHomePath,
  resolveProjectDir,
} from '../src/runtime/app-platform.js';

test('the default apps root lives under the CLI home directory', () => {
  assert.equal(DEFAULT_APPS_ROOT, join(homedir(), '.notis', 'apps'));
});

test('a slug resolves to its project directory under the default root', () => {
  assert.equal(defaultAppProjectDir('my-app'), join(DEFAULT_APPS_ROOT, 'my-app'));
});

test('a slug that would escape the default root is rejected', () => {
  for (const slug of ['', '   ', '../evil', 'nested/app', '.hidden']) {
    assert.throws(
      () => defaultAppProjectDir(slug),
      /Pass an explicit target directory/,
      `expected ${JSON.stringify(slug)} to be rejected`,
    );
  }
});

test('an explicit directory still resolves against the working directory', () => {
  assert.equal(resolveProjectDir('./my-app'), resolve(process.cwd(), 'my-app'));
  assert.equal(resolveProjectDir('/tmp/my-app'), '/tmp/my-app');
});

test('a tilde path expands without a shell', () => {
  // Agents spawn the CLI without a shell, so `~/code/app` would otherwise
  // create a literal "~" directory next to the current working directory.
  assert.equal(expandHomePath('~'), homedir());
  assert.equal(expandHomePath('~/code/app'), join(homedir(), 'code/app'));
  assert.equal(expandHomePath('~notauser/app'), '~notauser/app');
  assert.equal(resolveProjectDir('~/code/app'), join(homedir(), 'code/app'));
});
