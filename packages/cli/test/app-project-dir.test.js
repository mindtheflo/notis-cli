// Space source commands resolve a [dir] argument the same way a shell would,
// against the working directory, and expand a leading tilde themselves.
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { expandHomePath, resolveProjectDir } from '../src/runtime/app-platform.js';

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
