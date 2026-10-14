#!/usr/bin/env node
// CI adapter only: preserve npm's command/status/output and retain its exact tgz.
const { spawnSync } = require('node:child_process');
const { copyFileSync, readFileSync, realpathSync } = require('node:fs');
const { basename, resolve } = require('node:path');
const args = process.argv.slice(2);
const result = spawnSync(process.env.NOTIS_REAL_NPM, args, { stdio: 'inherit', env: process.env });
if (result.status !== 0) process.exit(result.status || 1);
if (args[0] === 'pack') {
  if (realpathSync(process.cwd()) !== realpathSync(process.env.NOTIS_PACK_SOURCE_DIR)) throw Error('Unexpected native npm pack directory');
  const pkg = JSON.parse(readFileSync('package.json'));
  const filename = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
  if (basename(filename) !== filename) throw Error('Invalid retained package name');
  copyFileSync(resolve(filename), process.env.NOTIS_RETAINED_TARBALL);
}
