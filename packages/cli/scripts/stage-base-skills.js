#!/usr/bin/env node
// Desktop's packaging hook stages the base skills it ships with this script:
//   node packages/cli/scripts/stage-base-skills.js <target folder>
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stageBaseSkills } from './base-skill-stamps.js';

const targetRoot = process.argv[2];
if (!targetRoot) {
  process.stderr.write('Usage: stage-base-skills.js <target folder>\n');
  process.exit(2);
}
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const stamps = stageBaseSkills({ repoRoot, targetRoot: resolve(targetRoot) });
for (const [name, { stamp, commit }] of Object.entries(stamps)) {
  const source = commit ? `commit ${commit.slice(0, 12)}` : 'uncommitted edits';
  process.stdout.write(`Staged ${name} with stamp ${stamp} (${source})\n`);
}
