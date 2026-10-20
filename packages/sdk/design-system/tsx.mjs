// Registers tsx with design-system/tsconfig.json, so specimens, fixtures and tests get the automatic JSX runtime
// like src/ does. tsx applies a tsconfig only to the files its `include` matches, and the package tsconfig
// includes src/ only; this one extends it and includes both src/ and design-system/.
//
//   node --import ./design-system/tsx.mjs --test ...        (cwd packages/sdk; `npm test` does this)
//
// `node --test` hands this flag and the environment to every test process.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.TSX_TSCONFIG_PATH ??= path.join(path.dirname(fileURLToPath(import.meta.url)), 'tsconfig.json');
await import('tsx');
