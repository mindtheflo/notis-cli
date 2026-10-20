// Compiles the design system book (design review spec, section 3).
//
//   node packages/sdk/design-system/build.mjs --out <dir> [--root <checkout root>] [--digest <hex>] [--allow-incomplete]
//
// Writes `<dir>/index.html` (one self-contained file: shell, frame code, CSS and the manifest inline) and
// `<dir>/manifest.json`. `--root` defaults to the checkout holding this script; every input is read from it, so
// the same script builds a base tree extracted elsewhere. esbuild comes from `<root>/packages/sdk/node_modules`,
// Tailwind from `<root>/portal/node_modules`.
//
// Exit 0 when the book is written and complete. An incomplete inventory (section 5) or an ownership mismatch
// still writes the book, with the problems in `manifest.inventory`, prints them on stderr and exits 1, unless
// `--allow-incomplete` is given (then it exits 0). Any other error exits 1 with the error on stderr.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readApi } from './api.mjs';
import { sourceAliasPlugin } from './resolve.mjs';
import { PORTAL_TOKEN_FILES, portalTokens, toolkitTokens } from './tokens.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'notis-design-book/v1';
const SRC_PREFIX = 'packages/sdk/src/';
const DS_PREFIX = 'packages/sdk/design-system/';
const SDK_VERSIONS = ['react', 'react-dom', 'recharts', 'react-day-picker', 'date-fns', 'react-markdown', 'remark-gfm'];

class BuildError extends Error {}

function parseArgs(argv) {
  const options = { out: null, root: path.resolve(HERE, '..', '..', '..'), digest: null, allowIncomplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new BuildError(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '--out') options.out = path.resolve(value());
    else if (arg === '--root') options.root = path.resolve(value());
    else if (arg === '--digest') options.digest = value();
    else if (arg === '--allow-incomplete') options.allowIncomplete = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('node packages/sdk/design-system/build.mjs --out <dir> [--root <checkout root>] [--digest <hex>] [--allow-incomplete]\n');
      process.exit(0);
    } else throw new BuildError(`unknown argument ${arg}`);
  }
  if (!options.out) throw new BuildError('--out <dir> is required');
  if (options.digest !== null && !/^[0-9a-f]{1,128}$/i.test(options.digest)) throw new BuildError('--digest must be hex');
  return options;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function say(line) {
  process.stdout.write(`${line}\n`);
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new BuildError(`cannot read ${file}: ${error.message}`);
  }
}

/** Step 1: the inventory, in its own process (it imports the SDK, recharts and every specimen). */
function runInventory(root) {
  const sdkDir = path.join(root, 'packages', 'sdk');
  const proc = spawnSync(process.execPath, ['--import', './design-system/tsx.mjs', 'design-system/inventory.ts', '--json'], {
    cwd: sdkDir,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  if (proc.error) throw new BuildError(`the inventory did not start: ${proc.error.message}`);
  const line = (proc.stdout ?? '').split('\n').reverse().find((item) => item.startsWith('{'));
  if (proc.status !== 0 || !line) {
    const tail = (proc.stderr || proc.stdout || '').trim().split('\n').slice(-20).join('\n');
    throw new BuildError(`the inventory failed (exit ${proc.status}):\n${tail}`);
  }
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new BuildError(`the inventory printed no JSON: ${error.message}`);
  }
}

/** The group owning a source file (path relative to `packages/sdk/src/`), section 11. */
function groupOfSource(groups, fromSrc) {
  return groups.find((group) => group.owns.some((prefix) => fromSrc.startsWith(prefix)))?.key ?? null;
}

/** The declaration row of a component name in the API index, preferring a file under `packages/sdk/src/`. */
function declaration(api, name, entries) {
  const rows = api.filter((row) => row.name === name && (!entries || entries.includes(row.entry)));
  return rows.find((row) => row.file?.startsWith(SRC_PREFIX)) ?? rows[0] ?? null;
}

function ownershipProblems(report, api, groups) {
  const problems = [];
  for (const component of report.components) {
    if (!component.specimen_file) continue;
    const specimen = report.specimens.find((item) => item.file === component.specimen_file);
    if (!specimen) continue;
    const row = declaration(api, component.name, component.entries);
    if (!row?.file?.startsWith(SRC_PREFIX)) continue;
    const owner = groupOfSource(groups, row.file.slice(SRC_PREFIX.length));
    if (owner !== specimen.group) {
      problems.push({
        code: 'ownership',
        export: component.name,
        file: DS_PREFIX + component.specimen_file,
        message: `${component.name} is declared in ${row.file}:${row.line}, owned by group "${owner}", but its specimen ${component.specimen_file} is in group "${specimen.group}": move the specimen to specimens/${owner}/.`,
      });
    }
  }
  return problems;
}

/**
 * The API rows with the inventory's kind (section 5.1). `api.mjs` reads kinds from declarations, so a
 * `forwardRef` or `memo` component reads as a constant and a recharts re-export as a component; the inventory
 * classifies the runtime values, which is what the book means. A row declared like a component that the inventory
 * does not list as a component or a third-party re-export would vanish from the book, so it is a problem.
 */
function classifyApi(api, report) {
  const key = (entry, name) => `${entry} ${name}`;
  const components = new Set(report.components.flatMap((component) => component.entries.map((entry) => key(entry, component.name))));
  const thirdParty = new Set(report.third_party.map((item) => key(item.entry, item.name)));
  const runtime = new Map((report.exports ?? []).map((item) => [key(item.entry, item.name), item.kind]));
  const rows = [];
  const problems = [];
  for (const { declared_as: _declaredAs, ...row } of api) {
    const id = key(row.entry, row.name);
    const kind = runtime.get(id);
    if (components.has(id)) {
      rows.push({ ...row, kind: 'component' });
    } else if (thirdParty.has(id)) {
      rows.push({ ...row, kind: 'third_party' });
    } else if (row.kind === 'component' || kind === 'component' || kind === 'third_party') {
      rows.push({ ...row, kind: 'component' });
      if (kind !== 'component' && kind !== 'third_party') {
        const where = row.file ? `${row.file}:${row.line}` : 'an unknown file';
        problems.push({
          code: 'unclassified',
          export: row.name,
          file: row.file ?? 'design-system/inventory.ts',
          message: `${row.name} of ${row.entry} (${where}) is declared like a component, but the inventory classifies it as ${kind ?? 'no runtime export'}, so the book lists it under Unclassified: make it a component of a component entry (it then needs a specimen), add it to THIRD_PARTY in design-system/inventory.ts if it is a recharts re-export, or rename it if it is not a component.`,
        });
      }
    } else {
      rows.push(row);
    }
  }
  return { rows, problems };
}

/** Step 2: every `specimens/**\/*.specimen.tsx`, absolute, sorted. */
function specimenFiles(dsDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.specimen.tsx')) out.push(full);
    }
  };
  walk(path.join(dsDir, 'specimens'));
  return out;
}

function loadEsbuild(root) {
  try {
    return createRequire(path.join(root, 'packages', 'sdk', 'package.json'))('esbuild');
  } catch (error) {
    throw new BuildError(`esbuild is not installed in ${path.join(root, 'packages', 'sdk', 'node_modules')}: ${error.message}`);
  }
}

function esbuildOptions(root) {
  const dsDir = path.join(root, 'packages', 'sdk', 'design-system');
  return {
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: false,
    sourcemap: false,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    tsconfig: path.join(dsDir, 'tsconfig.json'),
    plugins: [sourceAliasPlugin(path.join(root, 'packages', 'sdk'))],
  };
}

function esbuildFailure(what, error) {
  const messages = (error?.errors ?? []).slice(0, 10).map((item) => {
    const where = item.location ? `${item.location.file}:${item.location.line}:${item.location.column}: ` : '';
    return `${where}${item.text}`;
  });
  return new BuildError(`${what} failed:\n${messages.length ? messages.join('\n') : error?.message ?? String(error)}`);
}

/** The repo inputs of one metafile output: inside the root, outside node_modules, with bytes in the output. */
function repoInputs(root, output) {
  const inputs = {};
  for (const [input, info] of Object.entries(output?.inputs ?? {})) {
    if (!info || info.bytesInOutput <= 0) continue;
    if (input.includes(':') || input.startsWith('..') || path.isAbsolute(input)) continue;
    const posix = toPosix(input);
    if (posix.split('/').includes('node_modules')) continue;
    const file = path.join(root, input);
    if (!existsSync(file)) continue;
    inputs[posix] = sha256(readFileSync(file));
  }
  return Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)));
}

/** Step 3: one metafile pass with an entry per specimen plus the frame. */
async function metafileInputs(esbuild, root, files) {
  const dsDir = path.join(root, 'packages', 'sdk', 'design-system');
  const frameEntry = path.join(dsDir, 'frame', 'frame.tsx');
  let result;
  try {
    result = await esbuild.build({
      ...esbuildOptions(root),
      entryPoints: [...files, frameEntry],
      format: 'esm',
      metafile: true,
      outdir: path.join(dsDir, '.metafile-out'),
      outbase: dsDir,
    });
  } catch (error) {
    throw esbuildFailure('the specimen inputs pass', error);
  }
  const byEntry = new Map();
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.entryPoint) byEntry.set(toPosix(output.entryPoint), output);
  }
  const specimens = new Map();
  for (const file of files) {
    const rel = toPosix(path.relative(root, file));
    specimens.set(rel, repoInputs(root, byEntry.get(rel)));
  }
  return { specimens, frame: repoInputs(root, byEntry.get(toPosix(path.relative(root, frameEntry)))) };
}

/** Step 4: the shell and frame scripts, as IIFE text. */
async function bundles(esbuild, root, files) {
  const dsDir = path.join(root, 'packages', 'sdk', 'design-system');
  const options = { ...esbuildOptions(root), format: 'iife' };
  let shell;
  try {
    shell = await esbuild.build({ ...options, entryPoints: [path.join(dsDir, 'shell', 'shell.ts')], outfile: path.join(dsDir, '.out', 'shell.js') });
  } catch (error) {
    throw esbuildFailure('the shell bundle', error);
  }
  const imports = files.map((file, index) => {
    const spec = `./${toPosix(path.relative(dsDir, file)).replace(/\.tsx$/, '')}`;
    return `import * as s${index} from ${JSON.stringify(spec)};`;
  });
  const list = files.map((file, index) => `{ file: ${JSON.stringify(toPosix(path.relative(root, file)))}, module: s${index} }`);
  const contents = [
    "import './frame/determinism';",
    "import { startFrame } from './frame/frame';",
    ...imports,
    `startFrame([${list.join(', ')}]);`,
    '',
  ].join('\n');
  let frame;
  try {
    frame = await esbuild.build({
      ...options,
      stdin: { contents, resolveDir: dsDir, sourcefile: 'frame-entry.ts', loader: 'ts' },
      outfile: path.join(dsDir, '.out', 'frame.js'),
    });
  } catch (error) {
    throw esbuildFailure('the frame bundle', error);
  }
  return { shell: shell.outputFiles[0].text, frame: frame.outputFiles[0].text };
}

/** Step 5, layer 3: `src/styles.css` plus Tailwind over the SDK source and the specimens. */
async function spaceCss(root) {
  const portal = path.join(root, 'portal');
  const require = createRequire(path.join(portal, 'package.json'));
  let twNode;
  let oxide;
  try {
    twNode = await import(pathToFileURL(require.resolve('@tailwindcss/node')).href);
    oxide = require('@tailwindcss/oxide');
  } catch (error) {
    throw new BuildError(`Tailwind is not installed in ${path.join(portal, 'node_modules')}: ${error.message}`);
  }
  const posixRoot = toPosix(root);
  const input = [
    '@import "tailwindcss" source(none);',
    `@config "${posixRoot}/portal/tailwind.config.js";`,
    `@source "${posixRoot}/packages/sdk/src";`,
    `@source "${posixRoot}/packages/sdk/design-system/specimens";`,
    '',
  ].join('\n');
  let css;
  try {
    const compiler = await twNode.compile(input, { base: portal, onDependency() {} });
    const scanner = new oxide.Scanner({ sources: compiler.sources });
    css = compiler.build(scanner.scan());
  } catch (error) {
    throw new BuildError(`Tailwind failed: ${error.message}`);
  }
  const styles = readText(path.join(root, 'packages', 'sdk', 'src', 'styles.css'));
  return `${styles}\n${css}`;
}

/** Step 5, layer 1: the Portal tokens as `:root` and `.dark` rules (`@theme` values as `:root`), then book.css. */
function documentCss(tokens, bookCss) {
  const groups = [];
  for (const token of tokens) {
    const parts = token.chain.split(' > ').map((part) => part.trim());
    const media = parts.filter((part) => part.startsWith('@media'));
    const last = parts[parts.length - 1];
    let selector = ':root';
    if (/(^|[\s,])\.dark\b/.test(last)) selector = '.dark';
    else if (!last.startsWith('@') && !last.includes(':root')) selector = last;
    const key = `${media.join(' ')}|${selector}`;
    const previous = groups[groups.length - 1];
    if (previous && previous.key === key) previous.lines.push(`  ${token.name}: ${token.value};`);
    else groups.push({ key, media, selector, lines: [`  ${token.name}: ${token.value};`] });
  }
  const rules = groups.map((group) => {
    let rule = `${group.selector} {\n${group.lines.join('\n')}\n}`;
    for (const media of [...group.media].reverse()) rule = `${media} {\n${rule}\n}`;
    return rule;
  });
  const files = [...new Set(tokens.map((token) => token.file))].join(', ');
  return `/* Portal tokens (${files}). */\n${rules.join('\n')}\n\n${bookCss}`;
}

function readVersion(dir, name) {
  try {
    return JSON.parse(readFileSync(path.join(dir, name, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

function versions(root) {
  const sdkModules = path.join(root, 'packages', 'sdk', 'node_modules');
  const out = {};
  for (const name of SDK_VERSIONS) out[name] = readVersion(sdkModules, name);
  out.tailwindcss = readVersion(path.join(root, 'portal', 'node_modules'), 'tailwindcss');
  return out;
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** Text safe inside a `<script>` element whose content is copied into a new script. */
function scriptText(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '\\x3C!--');
}

function jsonText(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function styleText(css) {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

const BOOT = [
  '(function () {',
  '  var query = new URLSearchParams(location.search);',
  "  var frame = query.has('frame');",
  "  if (frame) { var host = document.createElement('div'); host.id = 'ds-frame'; document.body.prepend(host); }",
  "  var script = document.createElement('script');",
  "  script.textContent = document.getElementById(frame ? 'ds-frame-js' : 'ds-shell-js').textContent;",
  '  document.body.append(script);',
  '})();',
].join('\n');

function indexHtml({ manifest, document, css, shell, frame }) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Notis design system</title>',
    `<style id="ds-document-css">\n${styleText(document)}\n</style>`,
    `<script type="application/json" id="ds-manifest">${jsonText(manifest)}</script>`,
    `<script type="application/json" id="ds-css">${jsonText(css)}</script>`,
    '</head>',
    '<body>',
    `<script type="text/x-ds-frame" id="ds-frame-js">\n${scriptText(frame)}\n</script>`,
    `<script type="text/x-ds-shell" id="ds-shell-js">\n${scriptText(shell)}\n</script>`,
    `<script>\n${BOOT}\n</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

async function build(options) {
  const { root, out } = options;
  const sdkDir = path.join(root, 'packages', 'sdk');
  const dsDir = path.join(sdkDir, 'design-system');
  if (!existsSync(path.join(dsDir, 'groups.json'))) throw new BuildError(`${root} has no packages/sdk/design-system/groups.json`);
  const groups = JSON.parse(readText(path.join(dsDir, 'groups.json')));

  say('Reading the inventory');
  const report = runInventory(root);
  say('Reading the API index');
  let api;
  try {
    api = readApi({ root });
  } catch (error) {
    throw new BuildError(`the API index failed: ${error.message}`);
  }
  const classifiedApi = classifyApi(api, report);
  const problems = [...(report.problems ?? []), ...ownershipProblems(report, api, groups), ...classifiedApi.problems];

  const files = specimenFiles(dsDir);
  const esbuild = loadEsbuild(root);
  say(`Bundling ${files.length} specimen files`);
  const inputs = await metafileInputs(esbuild, root, files);
  const scripts = await bundles(esbuild, root, files);

  say('Compiling the CSS');
  // In cascade order. A tree older than theme-tokens.css has its :root and .dark in globals.css, which must exist.
  const portal = PORTAL_TOKEN_FILES.flatMap((file) => {
    const full = path.join(root, file);
    return file.endsWith('/globals.css') || existsSync(full) ? portalTokens(readText(full), file).tokens : [];
  });
  const toolkitText = readText(path.join(sdkDir, 'src', 'ui', 'toolkit.css'));
  const toolkit = toolkitTokens(toolkitText, `${SRC_PREFIX}ui/toolkit.css`);
  const document = documentCss(portal, readText(path.join(dsDir, 'shell', 'book.css')));
  const space = await spaceCss(root);
  const css = { toolkit: toolkitText, space };

  const sourceOf = (name) => {
    const row = declaration(api, name, null);
    return { name, file: row?.file ?? null, line: row?.line ?? null };
  };
  const specimens = report.specimens.map((specimen) => {
    const file = DS_PREFIX + specimen.file;
    return {
      id: specimen.id,
      name: specimen.name,
      group: specimen.group,
      from: specimen.from,
      covers: specimen.covers,
      summary: specimen.summary,
      file,
      sources: specimen.covers.map(sourceOf),
      states: specimen.states,
      inputs: inputs.specimens.get(file) ?? {},
    };
  });
  const components = report.components.map((component) => {
    const row = declaration(api, component.name, component.entries);
    const file = row?.file ?? null;
    return {
      name: component.name,
      of: component.of,
      entries: component.entries,
      specimen: component.specimen,
      file,
      line: row?.line ?? null,
      group: file?.startsWith(SRC_PREFIX) ? groupOfSource(groups, file.slice(SRC_PREFIX.length)) : null,
    };
  });

  const manifest = {
    schema: SCHEMA,
    scope_digest: options.digest,
    built: stamp(),
    groups: groups.map((group) => ({ key: group.key, title: group.title })),
    specimens,
    aliases: report.aliases,
    components,
    third_party: report.third_party,
    api: classifiedApi.rows,
    tokens: { portal, toolkit },
    words: report.words,
    css_sha256: sha256([document, css.toolkit, css.space].join('\n')),
    frame_inputs: inputs.frame,
    build_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    versions: versions(root),
    inventory: { ok: problems.length === 0, problems },
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(out, 'index.html'), indexHtml({ manifest, document, css, shell: scripts.shell, frame: scripts.frame }));
  const values = new Set(components.map((item) => item.of));
  const states = specimens.reduce((sum, item) => sum + item.states.length, 0);
  say(`Wrote ${path.join(out, 'index.html')}: ${components.length} component names (${values.size} values), ${specimens.length} specimens, ${states} states, ${groups.length} groups`);
  return manifest;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ERROR ${error.message}\n`);
    process.exit(1);
  }
  let manifest;
  try {
    manifest = await build(options);
  } catch (error) {
    const text = error instanceof BuildError ? error.message : error?.stack ?? String(error);
    process.stderr.write(`ERROR the book did not build: ${text}\n`);
    process.exit(1);
  }
  const { problems } = manifest.inventory;
  if (problems.length === 0) process.exit(0);
  const uncovered = problems.filter((problem) => problem.code === 'uncovered').length;
  process.stderr.write(`ERROR the inventory is incomplete: ${problems.length} problems (${uncovered} components without a specimen)\n`);
  for (const problem of problems) process.stderr.write(`PROBLEM ${problem.message}\n`);
  process.exit(options.allowIncomplete ? 0 : 1);
}

await main();
