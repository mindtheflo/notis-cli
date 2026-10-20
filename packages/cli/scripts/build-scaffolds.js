import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

import { stageBaseSkills } from './base-skill-stamps.js';
import { copyBoundaryRules, copyDesignRules } from './copy-boundary-rules.js';
import { buildSpaceSdk } from './build-space-sdk.js';
import { buildLegacySdk } from './build-legacy-sdk.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(scriptDir, '..');
const repoRoot = resolve(cliRoot, '../..');
execFileSync(process.execPath, [join(repoRoot, 'scripts/generate-portal-route-roots.mjs')]);

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
// Legacy apps vendor and bundle it, without the Spaces toolkit they never use.
const legacySdk = buildLegacySdk({ sdkDir: sdkSource, targetDir: sdkTarget });
process.stdout.write(`Built the legacy app SDK (${legacySdk.files.length} files)\n`);

// Spaces get types for the host-provided SDK (the host shares its own copy at
// runtime) plus a Node-only copy of it for their tests.
const spaceSdk = await buildSpaceSdk({ sdkDir: sdkSource, targetDir: join(distDir, 'space-sdk') });
process.stdout.write(`Built the Space SDK types (${spaceSdk.files.length} files, ${spaceSdk.candidates} class candidates) and its test runtime (${spaceSdk.runtime.length} files)\n`);

// One compiled renderer, shared with Portal; no CDN React or credentialed page.
const require = createRequire(import.meta.url);
const reactAliases = Object.fromEntries(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime']
  .map(name => [name, require.resolve(name)]));
await build({
  entryPoints: { host: join(cliRoot, 'src/space-harness-host.ts') },
  outdir: join(distDir, 'space-harness'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
  alias: reactAliases, define: { 'process.env.NODE_ENV': '"production"' }, minify: true,
  // The host provides the whole SDK to verified Spaces; its dependencies resolve
  // from the SDK's own install, else from the renderer's.
  nodePaths: [join(repoRoot, 'packages/sdk/node_modules'), join(repoRoot, 'packages/view-renderer/node_modules')],
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
// duplicates or a partial skill folder. Each copy carries a version stamp, so
// the CLI and Desktop keep whichever installed copy is newest.
const baseSkillStamps = stageBaseSkills({ repoRoot, targetRoot: outputBaseSkillsDir });
process.stdout.write(`Copied ${Object.keys(baseSkillStamps).length} stamped base skills to ${outputBaseSkillsDir}\n`);

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
// into an ephemeral npx cache or source checkout.
const hookBundlePath = join(distDir, 'agent-hooks', 'notis-agent-hook.mjs');
await build({
  entryPoints: [join(cliRoot, 'src', 'agent-hook-entry.js')],
  outfile: hookBundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  banner: {
    js: "import { createRequire as __notisCreateRequire } from 'node:module'; const require = __notisCreateRequire(import.meta.url);",
  },
});
process.stdout.write(`Built immutable agent hook runtime at ${hookBundlePath}\n`);
