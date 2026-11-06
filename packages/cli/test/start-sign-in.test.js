// `notis start` run by a code agent: the sign-in page opens by itself, and confirming waits for the person.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startConfirmCommand, waitForSignIn } from '../src/command-specs/onboarding.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'notis.js');
const LISTING = '5a7243d0-0a9a-4cbc-b8c3-76fef03f4f88';

test('confirming a sign-in keeps the Space the person came for and waits for them', () => {
  const base = 'npx --package @notis_ai/cli@latest -- notis --profile default start';
  assert.equal(startConfirmCommand(base, LISTING), `${base} --space ${LISTING} --wait 90`);
  assert.equal(startConfirmCommand(base), `${base} --wait 90`);
});

test('waiting returns as soon as the background listener stores the sign-in', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-start-wait-')), 'config.json');
  const empty = { current_profile: 'default', profiles: { default: { api_base: 'https://api.notis.ai' } } };
  writeFileSync(configFile, JSON.stringify(empty));
  const previous = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  try {
    const runtime = { profileName: 'default' };
    let naps = 0;
    const signed = await waitForSignIn(runtime, 60, async () => {
      naps += 1;
      // The listener writes the credential while the person finishes in the browser.
      if (naps === 2) {
        writeFileSync(configFile, JSON.stringify({ ...empty, profiles: { default: { ...empty.profiles.default,
          oauth_access_token: 'header.payload.signature', oauth_access_expires_at: 4102444800 } } }));
      }
    });
    assert.equal(signed, true);
    assert.equal(naps, 2);
    writeFileSync(configFile, JSON.stringify(empty));
    assert.equal(await waitForSignIn(runtime, 0, async () => { throw new Error('no wait asked'); }), false);
  } finally {
    if (previous === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previous;
  }
});

test('start refuses a --wait that is not a number of seconds before any request', () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-start-wait-bad-')), 'config.json');
  const result = spawnSync(process.execPath, [CLI, '--json', '--api-base', 'http://127.0.0.1:9', 'start', '--wait', 'soon'], {
    env: { PATH: process.env.PATH, HOME: dirname(configFile), NODE_ENV: 'test', NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
      NOTIS_CLI_CONFIG_FILE: configFile }, encoding: 'utf-8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /--wait <seconds>/);
});
