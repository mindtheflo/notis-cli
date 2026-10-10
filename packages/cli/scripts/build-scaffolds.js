import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

import { copyBoundaryRules, copyDesignRules } from './copy-boundary-rules.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(scriptDir, '..');
const repoRoot = resolve(cliRoot, '../..');
execFileSync(process.execPath, [join(repoRoot, 'scripts/generate-portal-route-roots.mjs')]);
const baseSkillNames = ['notis-apps', 'notis-query', 'notis-cli'];

// Bundle the app boundary rules into the package so the validator works once
// installed via npm (the in-repo server/config path escapes the package).
const boundaryRulesTarget = copyBoundaryRules({ repoRoot, cliRoot });
process.stdout.write(`Copied app boundary rules to ${boundaryRulesTarget}\n`);
const designRulesTarget = copyDesignRules({ repoRoot, cliRoot });
process.stdout.write(`Copied app design rules to ${designRulesTarget}\n`);
const distDir = join(cliRoot, 'dist');
const outputBaseSkillsDir = join(distDir, 'base-skills');

// The canonical SDK is bundled at build time, never hand-mirrored in templates.
const sdkSource = join(repoRoot, 'packages', 'sdk');
const sdkTarget = join(distDir, 'sdk');
if (!existsSync(join(sdkSource, 'package.json'))) {
  throw new Error(`Canonical SDK source not found at ${sdkSource}`);
}
rmSync(sdkTarget, { recursive: true, force: true });
mkdirSync(sdkTarget, { recursive: true });
cpSync(join(sdkSource, 'src'), join(sdkTarget, 'src'), { recursive: true });
cpSync(join(sdkSource, 'package.json'), join(sdkTarget, 'package.json'));

// One compiled renderer, shared with Portal; no CDN React or credentialed page.
const require = createRequire(import.meta.url);
const reactAliases = Object.fromEntries(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime']
  .map(name => [name, require.resolve(name)]));
await build({
  entryPoints: { host: join(cliRoot, 'src/space-harness-host.ts') },
  outdir: join(distDir, 'space-harness'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
  alias: reactAliases, define: { 'process.env.NODE_ENV': '"production"' }, minify: true,
});
rmSync(join(distDir, 'space-harness/frame.js'), { force: true });

// The live CLI and warm sidecar execute the same read-only render library.
const renderSource = join(repoRoot, 'packages/view-renderer');
execFileSync(process.execPath, [join(renderSource, 'scripts/build-host.mjs')], { stdio: 'inherit' });
const renderTarget = join(distDir, 'view-renderer');
rmSync(renderTarget, { recursive: true, force: true });
for (const folder of ['src', 'dist']) cpSync(join(renderSource, folder), join(renderTarget, folder), { recursive: true });


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

await build({
  entryPoints: [join(cliRoot, 'src', 'skill-sync-worker-entry.js')],
  outfile: join(distDir, 'skill-sync-worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
});

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
