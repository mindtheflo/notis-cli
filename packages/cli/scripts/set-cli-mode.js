#!/usr/bin/env node
/**
 * Stamp `src/runtime/cli-mode.generated.js` with 'local' or 'published'.
 *
 * Called by CI before `npm publish` to ensure the baked mode is 'published'.
 * 'local' remains available for labeling the in-repo apps-dev helper only;
 * it no longer switches the default API to localhost.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, '..', 'src', 'runtime', 'cli-mode.generated.js');

const mode = process.argv[2];
if (mode !== 'local' && mode !== 'published') {
  console.error(`usage: set-cli-mode.js <local|published>`);
  process.exit(2);
}

const body = `// Auto-generated on npm publish.
// Committed value is 'published' so the CLI defaults to the live Notis API.
// Localhost overrides come only from the worktree test lease (\`./dev.sh\`).
// scripts/set-cli-mode.js can rewrite this for publish/labeling experiments.
export const MODE = '${mode}';
`;

writeFileSync(TARGET, body);
console.log(`set cli mode to '${mode}'`);
