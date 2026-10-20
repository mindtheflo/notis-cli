// Source aliases of the design system book.
//
// `packages/sdk/src/ui.ts` is a legacy placeholder (`export {}`) that sits next to the `src/ui/` folder. A
// relative import of `../../../src/ui` (the form the specimen contract uses) resolves to that file before the
// folder's index in Node, tsx, esbuild and TypeScript alike, while the package export `@notis/sdk/ui` maps to
// `src/ui/index.ts`. The book follows the package export everywhere:
//
// - Node and tsx (the inventory, the tests): `registerSourceAliases()` installs a `module.registerHooks` resolve
//   hook before any specimen loads;
// - esbuild (`build.mjs`): `sourceAliasPlugin()`;
// - TypeScript (`tsc -p design-system`): `moduleSuffixes: ["/index", ""]` in `design-system/tsconfig.json`.
//
// Once the placeholder is deleted the three become no-ops.
import { existsSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SDK_DIR = path.resolve(HERE, '..');

/**
 * Each shadowed path (without extension) mapped to the file the package export points at. Keyed by both the
 * given and the real path: esbuild and Node report importers by their real path (macOS `/tmp` is
 * `/private/tmp`), while `--root` may name a symlinked folder.
 */
export function sourceAliases(sdkDir = DEFAULT_SDK_DIR) {
  const aliases = new Map();
  const dirs = new Set([sdkDir]);
  try {
    dirs.add(realpathSync(sdkDir));
  } catch {
    // A missing folder has no aliases; existsSync below says so.
  }
  for (const dir of dirs) {
    const index = path.join(dir, 'src', 'ui', 'index.ts');
    if (existsSync(index)) aliases.set(path.join(dir, 'src', 'ui'), index);
  }
  return aliases;
}

function stripTsExtension(file) {
  return file.replace(/\.(?:ts|tsx|mts|js|mjs)$/, '');
}

let registered = false;

/** Installs the Node resolve hook once per process. Safe to call more than once. */
export function registerSourceAliases(sdkDir = DEFAULT_SDK_DIR) {
  if (registered) return;
  registered = true;
  const aliases = sourceAliases(sdkDir);
  if (aliases.size === 0) return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL && context.parentURL.startsWith('file:') && (specifier.startsWith('./') || specifier.startsWith('../'))) {
        const target = fileURLToPath(new URL(specifier, context.parentURL));
        const mapped = aliases.get(target) ?? aliases.get(stripTsExtension(target));
        if (mapped) return nextResolve(pathToFileURL(mapped).href, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

/** The esbuild twin: a relative import landing on a shadowed path resolves to the package export's file. */
export function sourceAliasPlugin(sdkDir = DEFAULT_SDK_DIR) {
  const aliases = sourceAliases(sdkDir);
  return {
    name: 'notis-design-source-aliases',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (!args.resolveDir) return undefined;
        const target = path.resolve(args.resolveDir, args.path);
        const mapped = aliases.get(target) ?? aliases.get(stripTsExtension(target));
        return mapped ? { path: mapped } : undefined;
      });
    },
  };
}
