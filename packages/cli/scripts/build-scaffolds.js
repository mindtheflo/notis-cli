import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { loadAppConfig } from '../src/runtime/app-platform.js';
import { copyBoundaryRules } from './copy-boundary-rules.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(scriptDir, '..');
const repoRoot = resolve(cliRoot, '../..');
const scaffoldsDir = join(repoRoot, 'scaffolds');
const baseSkillNames = ['notis-apps', 'notis-query', 'notis-cli'];

// Bundle the app boundary rules into the package so the validator works once
// installed via npm (the in-repo server/config path escapes the package).
const boundaryRulesTarget = copyBoundaryRules({ repoRoot, cliRoot });
process.stdout.write(`Copied app boundary rules to ${boundaryRulesTarget}\n`);
const distDir = join(cliRoot, 'dist');
const outputScaffoldsDir = join(distDir, 'scaffolds');
const outputCatalogPath = join(distDir, 'scaffolds.json');
const outputBaseSkillsDir = join(distDir, 'base-skills');

const EXCLUDES = new Set([
  'node_modules',
  '.notis',
  '.git',
  'dist',
  'coverage',
  '.next',
  '.turbo',
  'tsconfig.tsbuildinfo',
  '.DS_Store',
]);

function shouldCopy(path) {
  const name = path.split(/[\\/]/).pop();
  return Boolean(name)
    && !EXCLUDES.has(name)
    && !name.startsWith('.env')
    && !/\.(test|spec)\.[cm]?[jt]sx?$/i.test(name);
}

function copyScaffold(sourceDir, targetDir) {
  cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => shouldCopy(source),
  });
}

function normalizeCategories(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : [];
}

if (!existsSync(scaffoldsDir)) {
  throw new Error(`Scaffolds directory not found at ${scaffoldsDir}`);
}

rmSync(outputScaffoldsDir, { recursive: true, force: true });
mkdirSync(outputScaffoldsDir, { recursive: true });

const scaffolds = [];
for (const entry of readdirSync(scaffoldsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
    continue;
  }
  const sourceDir = join(scaffoldsDir, entry.name);
  if (!existsSync(join(sourceDir, 'notis.config.ts'))) {
    continue;
  }

  const config = await loadAppConfig(sourceDir);
  const slug = entry.name;
  copyScaffold(sourceDir, join(outputScaffoldsDir, slug));
  scaffolds.push({
    slug,
    name: config.title || config.name || slug,
    description: config.description || '',
    icon: config.icon || 'phosphor:squares-four',
    categories: normalizeCategories(config.categories),
    tagline: config.tagline || config.description || '',
  });
}

scaffolds.sort((a, b) => a.slug.localeCompare(b.slug));
mkdirSync(distDir, { recursive: true });
writeFileSync(
  outputCatalogPath,
  JSON.stringify(
    {
      source: 'scaffolds/*/notis.config.ts',
      scaffolds,
    },
    null,
    2,
  ) + '\n',
);

process.stdout.write(`Wrote ${scaffolds.length} scaffolds to ${outputCatalogPath}\n`);

// The CLI is the distribution owner for the three system skills. Copy from
// server/skills, the product source of truth, so npm never ships hand-maintained
// duplicates or a partial skill folder.
rmSync(outputBaseSkillsDir, { recursive: true, force: true });
mkdirSync(outputBaseSkillsDir, { recursive: true });
for (const name of baseSkillNames) {
  const source = join(repoRoot, 'server', 'skills', name);
  if (!existsSync(join(source, 'SKILL.md'))) {
    throw new Error(`Base skill source not found at ${source}`);
  }
  cpSync(source, join(outputBaseSkillsDir, name), { recursive: true });
}
process.stdout.write(`Copied ${baseSkillNames.length} base skills to ${outputBaseSkillsDir}\n`);

await build({
  entryPoints: [join(cliRoot, 'src', 'runtime', 'skill-sync', 'index.ts')],
  outfile: join(distDir, 'skill-sync', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: true,
});
process.stdout.write(`Built CLI skill sync engine in ${join(distDir, 'skill-sync')}\n`);

// Memory hooks need an immutable, self-contained CLI runtime. The installed
// launcher copies this exact bundle into ~/.notis rather than retaining a path
// into an ephemeral npx cache or source checkout. Sharp is lazy-loaded and is
// unrelated to hook commands, so leave it external to keep this bundle small.
const hookBundlePath = join(distDir, 'agent-hooks', 'notis-agent-hook.mjs');
await build({
  entryPoints: [join(cliRoot, 'src', 'agent-hook-entry.js')],
  outfile: hookBundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external: ['sharp'],
  banner: {
    js: "import { createRequire as __notisCreateRequire } from 'node:module'; const require = __notisCreateRequire(import.meta.url);",
  },
});
process.stdout.write(`Built immutable agent hook runtime at ${hookBundlePath}\n`);
