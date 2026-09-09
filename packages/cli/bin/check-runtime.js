// Keep this dependency-free: npm engines are advisory unless engine-strict is set.
// Both installation and the public entry point check before loading dependencies.
import { readFileSync } from 'node:fs';

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// This package declares one inclusive minimum, not a compound semver range.
const minimum = engines.node.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
if (!minimum) throw new Error('CLI engines.node must declare one inclusive minimum version.');
const required = minimum.slice(1).map(Number);
const current = process.versions.node.split('.').map(Number);
const difference = current.map((part, index) => part - required[index]).find((part) => part !== 0);
if (difference < 0) {
  process.stderr.write(`Notis CLI requires Node.js ${engines.node}; found ${process.versions.node}. Upgrade Node.js before running or installing the CLI.\n`);
  process.exit(1);
}
