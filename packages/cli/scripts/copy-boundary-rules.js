import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI_ROOT = resolve(scriptDir, '..');
const DEFAULT_REPO_ROOT = resolve(DEFAULT_CLI_ROOT, '../..');

// The published @notis_ai/cli package must carry its own copy of the app
// boundary rules. In the monorepo the validator reads them straight from
// server/config, but once installed via npm that path escapes the package and
// 404s (ENOENT). This copies the server source into the package at build time
// so the bundled copy ships in the tarball (see package.json "files": config/).
export const BOUNDARY_RULES_RELATIVE_PATH = 'config/notis_app_boundary_rules.json';

export function copyBoundaryRules({ repoRoot = DEFAULT_REPO_ROOT, cliRoot = DEFAULT_CLI_ROOT } = {}) {
  const source = join(repoRoot, 'server', 'config', 'notis_app_boundary_rules.json');
  if (!existsSync(source)) {
    throw new Error(`App boundary rules not found at ${source}`);
  }
  const target = join(cliRoot, BOUNDARY_RULES_RELATIVE_PATH);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return target;
}

// The design rules ship the same way: the CLI enforces them at build time and
// the server enforces them again on deploy, both from server/config.
export const DESIGN_RULES_RELATIVE_PATH = 'config/notis_app_design_rules.json';

export function copyDesignRules({ repoRoot = DEFAULT_REPO_ROOT, cliRoot = DEFAULT_CLI_ROOT } = {}) {
  const source = join(repoRoot, 'server', 'config', 'notis_app_design_rules.json');
  if (!existsSync(source)) {
    throw new Error(`App design rules not found at ${source}`);
  }
  const target = join(cliRoot, DESIGN_RULES_RELATIVE_PATH);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return target;
}

// Allow running directly: node ./scripts/copy-boundary-rules.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = copyBoundaryRules();
  process.stdout.write(`Copied app boundary rules to ${target}\n`);
  const designTarget = copyDesignRules();
  process.stdout.write(`Copied app design rules to ${designTarget}\n`);
}
