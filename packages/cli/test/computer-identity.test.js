import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  COMPUTER_NAME_MAX_LENGTH,
  computerIdentityFile,
  defaultComputerName,
  normalizeComputerName,
  readComputerIdentity,
  setComputerName,
} from '../src/runtime/computer-identity.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A fixed machine keeps these tests off scutil and the real host name.
const machine = { platform: 'linux', hostname: () => 'studio.local' };

function tempConfigFile() {
  return join(mkdtempSync(join(tmpdir(), 'notis-cli-computer-')), 'config.json');
}

function storedIdentity(configFile) {
  return JSON.parse(readFileSync(computerIdentityFile(configFile), 'utf8'));
}

test('the computer identity is created once, next to the CLI config', () => {
  const configFile = tempConfigFile();
  const file = computerIdentityFile(configFile);
  assert.equal(file, join(dirname(configFile), 'computer.json'));
  assert.equal(existsSync(file), false);

  const first = readComputerIdentity({ configFile, ...machine });
  assert.match(first.computerId, UUID_V4);
  assert.equal(first.name, null);
  assert.equal(first.defaultName, 'studio');
  assert.equal(first.displayName, 'studio');
  assert.deepEqual(storedIdentity(configFile), { version: 1, computer_id: first.computerId });
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }

  assert.equal(readComputerIdentity({ configFile, ...machine }).computerId, first.computerId);
  assert.equal(setComputerName('Studio Mac', { configFile, ...machine }).computerId, first.computerId);
});

test('NOTIS_CLI_CONFIG_FILE moves the computer identity with the config', () => {
  const configFile = tempConfigFile();
  const previous = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  try {
    assert.equal(computerIdentityFile(), join(dirname(configFile), 'computer.json'));
    const identity = readComputerIdentity(machine);
    assert.equal(storedIdentity(configFile).computer_id, identity.computerId);
  } finally {
    if (previous === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previous;
  }
});

test('computer names are trimmed, collapsed and capped by character', () => {
  assert.equal(normalizeComputerName('  Studio \n\t Mac  '), 'Studio Mac');
  assert.equal(normalizeComputerName('   '), null);
  assert.equal(normalizeComputerName(''), null);
  assert.equal(normalizeComputerName(42), null);
  assert.equal(normalizeComputerName('x'.repeat(80)), 'x'.repeat(COMPUTER_NAME_MAX_LENGTH));
  // A character outside the basic plane counts once and is never cut in half.
  const wide = normalizeComputerName('\u{1D49C}'.repeat(70));
  assert.equal(Array.from(wide).length, COMPUTER_NAME_MAX_LENGTH);
  assert.equal(wide.length, COMPUTER_NAME_MAX_LENGTH * 2);
});

test('renaming the computer keeps its id, and an empty name resets it', () => {
  const configFile = tempConfigFile();
  const { computerId } = readComputerIdentity({ configFile, ...machine });

  const renamed = setComputerName("  Flo's   Studio\tMac  ", { configFile, ...machine });
  assert.deepEqual(renamed, {
    computerId,
    name: "Flo's Studio Mac",
    defaultName: 'studio',
    displayName: "Flo's Studio Mac",
  });
  assert.deepEqual(storedIdentity(configFile), {
    version: 1,
    computer_id: computerId,
    name: "Flo's Studio Mac",
  });
  assert.equal(readComputerIdentity({ configFile, ...machine }).displayName, "Flo's Studio Mac");

  const reset = setComputerName('   ', { configFile, ...machine });
  assert.equal(reset.name, null);
  assert.equal(reset.displayName, 'studio');
  assert.deepEqual(storedIdentity(configFile), { version: 1, computer_id: computerId });

  setComputerName('Desk', { configFile, ...machine });
  assert.equal(setComputerName(null, { configFile, ...machine }).name, null);
  assert.deepEqual(storedIdentity(configFile), { version: 1, computer_id: computerId });
});

test('a broken computer id is replaced and keeps the chosen name', () => {
  const configFile = tempConfigFile();
  const file = computerIdentityFile(configFile);

  writeFileSync(file, JSON.stringify({ version: 1, computer_id: 'not-a-uuid', name: 'Studio Mac' }));
  const repaired = readComputerIdentity({ configFile, ...machine });
  assert.match(repaired.computerId, UUID_V4);
  assert.equal(repaired.name, 'Studio Mac');
  assert.deepEqual(storedIdentity(configFile), {
    version: 1,
    computer_id: repaired.computerId,
    name: 'Studio Mac',
  });

  writeFileSync(file, '{not json');
  const recreated = readComputerIdentity({ configFile, ...machine });
  assert.match(recreated.computerId, UUID_V4);
  assert.notEqual(recreated.computerId, repaired.computerId);
  assert.equal(recreated.name, null);

  writeFileSync(file, JSON.stringify({ version: 1, computer_id: '9B2F7C1E-4D3A-4F6B-8A1C-2E5D7F9A0B3C' }));
  assert.equal(
    readComputerIdentity({ configFile, ...machine }).computerId,
    '9b2f7c1e-4d3a-4f6b-8a1c-2e5d7f9a0b3c',
  );
});

test('the default name is the Mac computer name, else the host name', () => {
  assert.equal(defaultComputerName({
    platform: 'darwin',
    readMacComputerName: () => " Flo's MacBook Pro\n",
    hostname: () => 'ignored.local',
  }), "Flo's MacBook Pro");
  assert.equal(defaultComputerName({
    platform: 'darwin',
    readMacComputerName: () => null,
    hostname: () => 'flos-mbp.local',
  }), 'flos-mbp');
  assert.equal(defaultComputerName({
    platform: 'linux',
    readMacComputerName: () => 'never read off a Mac',
    hostname: () => 'build-box',
  }), 'build-box');
  assert.equal(defaultComputerName({ platform: 'win32', hostname: () => '' }), 'Computer');
  assert.equal(defaultComputerName({
    platform: 'linux',
    hostname: () => {
      throw new Error('no host name');
    },
  }), 'Computer');
});
