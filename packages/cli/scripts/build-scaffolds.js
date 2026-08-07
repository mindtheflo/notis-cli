import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAppConfig } from '../src/runtime/app-platform.js';
import { copyBoundaryRules } from './copy-boundary-rules.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(scriptDir, '..');
const repoRoot = resolve(cliRoot, '../..');
const scaffoldsDir = join(repoRoot, 'scaffolds');

// Bundle the app boundary rules into the package so the validator works once
// installed via npm (the in-repo server/config path escapes the package).
const boundaryRulesTarget = copyBoundaryRules({ repoRoot, cliRoot });
process.stdout.write(`Copied app boundary rules to ${boundaryRulesTarget}\n`);
const distDir = join(cliRoot, 'dist');
const outputScaffoldsDir = join(distDir, 'scaffolds');
const outputCatalogPath = join(distDir, 'scaffolds.json');

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
