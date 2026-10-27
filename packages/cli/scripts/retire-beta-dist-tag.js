// Retires the pre-nightly `beta` npm tag of the Notis CLI, once.
//
//   node packages/cli/scripts/retire-beta-dist-tag.js           # print the plan
//   node packages/cli/scripts/retire-beta-dist-tag.js --apply   # run it
//
// The beta branch now publishes the `nightly` tag. Anyone still running
// `@notis_ai/cli@beta` should land on the current stable build, which then
// re-executes the build their profile's channel needs, so `beta` is pointed at
// whatever `latest` ships and every beta prerelease is deprecated with a
// pointer to `@latest`. Re-running is safe: it moves the tag again and skips
// versions that already carry the message.
//
// Run it from a maintainer's terminal signed in to npm (`npm login`). npm
// trusted publishing (OIDC) can publish and, when enabled, move dist-tags, but
// it cannot run `npm deprecate`, so this is not a CI step.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { RETIRED_DIST_TAG, distTagForChannel } from './release-channels.cjs';
import { readReleaseHistory } from './release-registry.js';

export const PACKAGE_NAME = '@notis_ai/cli';
export const DEPRECATION_MESSAGE = 'Notis CLI beta is now nightly: npm i -g @notis_ai/cli@latest';

// The npm commands that retire the tag, given the registry packument.
export function planBetaRetirement(history, { packageName = PACKAGE_NAME } = {}) {
  const stable = history?.['dist-tags']?.[distTagForChannel('stable')];
  if (!stable || stable.includes('-')) throw new Error('npm has no stable release to point the beta tag at');
  const pending = Object.values(history.versions || {})
    .filter(receipt => typeof receipt?.version === 'string' && receipt.version.includes(`-${RETIRED_DIST_TAG}.`))
    .filter(receipt => receipt.deprecated !== DEPRECATION_MESSAGE)
    .map(receipt => receipt.version);
  const commands = [];
  if (history['dist-tags'][RETIRED_DIST_TAG] !== stable) {
    commands.push(['dist-tag', 'add', `${packageName}@${stable}`, RETIRED_DIST_TAG]);
  }
  if (pending.length) {
    // One range of exact versions, so a 2FA account answers one prompt.
    commands.push(['deprecate', `${packageName}@${pending.join(' || ')}`, DEPRECATION_MESSAGE]);
  }
  return { stable, deprecate: pending, commands };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const plan = planBetaRetirement(await readReleaseHistory(PACKAGE_NAME));
  console.log(`${RETIRED_DIST_TAG} -> ${plan.stable}; ${plan.deprecate.length} beta version(s) to deprecate.`);
  for (const args of plan.commands) {
    console.log(`npm ${args.map(arg => (/[\s|:@]/.test(arg) ? JSON.stringify(arg) : arg)).join(' ')}`);
    if (!apply) continue;
    const result = spawnSync('npm', args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`npm ${args[0]} failed; fix it and re-run, the plan is idempotent`);
  }
  if (!apply && plan.commands.length) console.log('Dry run. Re-run with --apply to execute.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
