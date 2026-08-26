/**
 * Store-backed scaffold catalog for the Notis CLI.
 *
 * Every app published to the public Store lives with its full source in the
 * public registry repository (github.com/mindtheflo/notis-apps, one app per
 * `apps/<slug>/` directory). That repository IS the scaffold catalog:
 * `apps scaffolds list` reads the published listings and `apps init --from
 * <slug>` downloads the listed app's source. Publishing an app automatically
 * makes it a scaffold — the CLI bundles nothing besides the bare template.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { usageError } from './errors.js';

const DEFAULT_REGISTRY_REPO = 'mindtheflo/notis-apps';
const DEFAULT_REGISTRY_REF = 'main';
// How many registry files to download at once when materializing a scaffold.
const DOWNLOAD_CONCURRENCY = 4;
const MAX_SCAFFOLD_FILES = 2_000;
const MAX_SCAFFOLD_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SCAFFOLD_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_CATALOG_ENTRIES = 1_000;
const MAX_REGISTRY_COMMIT_BYTES = 2 * 1024 * 1024;
const MAX_REGISTRY_API_BYTES = 10 * 1024 * 1024;
const MAX_CATALOG_METADATA_BYTES = 1024 * 1024;
const MAX_CATALOG_TOTAL_BYTES = 20 * 1024 * 1024;
// Registry bookkeeping that must never enter a new project: the listing
// descriptor and the rendered Store gallery describe the published app, and a
// scaffold copy starts a new identity.
const REGISTRY_ARTIFACT = /^(notis-listing\.json$|screenshots(\/|$))/;
// Files the scaffold copy step would drop anyway — skip the download.
const SKIPPED_SOURCE = /(^|\/)(node_modules|\.notis|\.git|dist|coverage|\.next|\.turbo)(\/|$)|(^|\/)\.env|\.(test|spec)\.[cm]?[jt]sx?$/;

function registryRepo() {
  return process.env.NOTIS_APP_REGISTRY_REPO || DEFAULT_REGISTRY_REPO;
}

function registryRef() {
  return process.env.NOTIS_APP_REGISTRY_REF || DEFAULT_REGISTRY_REF;
}

/**
 * Local registry checkout override (`<dir>/apps/<slug>/…`). Used by tests and
 * by offline development against a clone of the registry repository.
 */
function localRegistryDir() {
  return process.env.NOTIS_APP_REGISTRY_DIR || null;
}

export function scaffoldRegistryLabel() {
  return localRegistryDir() || `github.com/${registryRepo()}`;
}

async function fetchRegistry(url, { binary = false, maxBytes = null } = {}) {
  let response;
  try {
    response = await fetch(url, { headers: { 'user-agent': 'notis-cli' } });
  } catch (error) {
    throw usageError(
      `Could not reach the Notis app registry (${scaffoldRegistryLabel()}): ${error.message}. ` +
        'Scaffolds are downloaded from published Store apps and need network access.',
    );
  }
  if (!response.ok) {
    throw usageError(`Notis app registry request failed (${response.status}) for ${url}.`);
  }
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (maxBytes && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw usageError(`Notis app registry response exceeds the ${maxBytes}-byte limit.`);
  }
  let data;
  if (maxBytes && response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw usageError(`Notis app registry response exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(chunk);
    }
    data = Buffer.concat(chunks, total);
  } else {
    data = Buffer.from(await response.arrayBuffer());
  }
  if (maxBytes && data.length > maxBytes) {
    throw usageError(`Notis app registry response exceeds the ${maxBytes}-byte limit.`);
  }
  return binary ? data : data.toString('utf8');
}

function encodedRegistryRepoPath() {
  const parts = registryRepo().split('/');
  if (
    parts.length !== 2
    || parts.some((part) => !part || !/^[A-Za-z0-9_.-]+$/.test(part))
  ) {
    throw usageError('Notis app registry repository must use the owner/repository form.');
  }
  return parts.map((part) => encodeURIComponent(part)).join('/');
}

async function resolveRegistryCommit() {
  const url = `https://api.github.com/repos/${encodedRegistryRepoPath()}/commits/${encodeURIComponent(registryRef())}`;
  // GitHub's commit-detail response includes changed-file metadata and can be
  // substantially larger than the SHA we read from it. Keep a bounded limit,
  // but allow normal registry commits with a long file list.
  const payload = JSON.parse(await fetchRegistry(url, { maxBytes: MAX_REGISTRY_COMMIT_BYTES }));
  const commitSha = typeof payload?.sha === 'string' ? payload.sha.trim() : '';
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw usageError(
      `Notis app registry returned no immutable commit for ${registryRepo()}@${registryRef()}.`,
    );
  }
  return commitSha;
}

async function fetchRegistryTree(commitSha) {
  const url = `https://api.github.com/repos/${encodedRegistryRepoPath()}/git/trees/${commitSha}?recursive=1`;
  const payload = JSON.parse(await fetchRegistry(url, { maxBytes: MAX_REGISTRY_API_BYTES }));
  if (!Array.isArray(payload?.tree)) {
    throw usageError(`Notis app registry returned no file tree for ${registryRepo()}@${commitSha}.`);
  }
  if (payload.truncated === true) {
    throw usageError(
      `Notis app registry tree was truncated for ${registryRepo()}@${commitSha}; refusing an incomplete scaffold catalog.`,
    );
  }
  return payload.tree
    .filter((entry) => entry?.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => ({ path: entry.path, size: Number(entry.size) }));
}

function fetchRegistryFile(path, commitSha, options) {
  const encodedPath = String(path).split('/').map((part) => encodeURIComponent(part)).join('/');
  return fetchRegistry(
    `https://raw.githubusercontent.com/${encodedRegistryRepoPath()}/${commitSha}/${encodedPath}`,
    options,
  );
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function assertSafeScaffoldSlug(value) {
  const slug = String(value || '');
  if (!slug || slug === '.' || slug === '..' || /[\\/\0]/.test(slug)) {
    throw usageError(`Unsafe scaffold slug: ${value}`);
  }
  return slug;
}

/**
 * Resolve a registry-owned relative path without allowing either slash style,
 * drive-letter paths, or dot segments to escape the temporary scaffold root.
 * Exported so the platform-independent boundary contract can be unit tested on
 * every host, including macOS CI for the Windows backslash case.
 */
export function resolveScaffoldTargetPath(tempRoot, registryRelativePath) {
  const raw = String(registryRelativePath || '');
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (
    !normalized
    || normalized.includes('\0')
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw usageError(`Refusing unsafe path from Notis app registry: ${registryRelativePath}`);
  }

  const root = resolve(tempRoot);
  const target = resolve(root, ...parts);
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    throw usageError(`Refusing path outside scaffold directory: ${registryRelativePath}`);
  }
  return target;
}

function readTsStringProperty(source, propertyName) {
  const match = source.match(new RegExp(`\\b${propertyName}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`));
  return match ? match[2] : null;
}

function catalogEntry(slug, listing, configSource) {
  const description = listing?.description || readTsStringProperty(configSource, 'description') || '';
  return {
    slug,
    name: listing?.name || readTsStringProperty(configSource, 'title') || slug,
    description,
    icon: readTsStringProperty(configSource, 'icon') || 'phosphor:squares-four',
    categories: Array.isArray(listing?.categories) ? listing.categories.filter(Boolean) : [],
    tagline: listing?.tagline || readTsStringProperty(configSource, 'tagline') || description,
  };
}

function readOptionalFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function loadLocalCatalog(registryDir) {
  const appsDir = join(registryDir, 'apps');
  if (!existsSync(appsDir)) {
    return [];
  }
  const scaffolds = [];
  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue;
    }
    const appDir = join(appsDir, entry.name);
    if (!existsSync(join(appDir, 'notis.config.ts'))) {
      continue;
    }
    const listingPath = join(appDir, 'notis-listing.json');
    const listing = existsSync(listingPath) ? JSON.parse(readFileSync(listingPath, 'utf-8')) : null;
    scaffolds.push(catalogEntry(entry.name, listing, readOptionalFile(join(appDir, 'notis.config.ts'))));
  }
  return scaffolds.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * List every published Store app as a scaffold.
 */
export async function loadScaffoldCatalog() {
  const registryDir = localRegistryDir();
  if (registryDir) {
    return loadLocalCatalog(registryDir);
  }
  const commitSha = await resolveRegistryCommit();
  const tree = (await fetchRegistryTree(commitSha)).map((entry) => entry.path);
  const slugs = [...new Set(
    tree
      .filter((path) => /^apps\/[^/]+\//.test(path))
      .map((path) => path.split('/')[1]),
  )].filter((slug) => tree.includes(`apps/${slug}/notis.config.ts`));
  if (slugs.length > MAX_CATALOG_ENTRIES) {
    throw usageError(`Notis app registry contains too many scaffold entries (${slugs.length}; maximum ${MAX_CATALOG_ENTRIES}).`);
  }
  let catalogBytes = 0;
  const scaffolds = await mapWithConcurrency(slugs, DOWNLOAD_CONCURRENCY, async (slug) => {
    const [listingText, configSource] = await Promise.all([
      tree.includes(`apps/${slug}/notis-listing.json`)
        ? fetchRegistryFile(`apps/${slug}/notis-listing.json`, commitSha, { maxBytes: MAX_CATALOG_METADATA_BYTES })
        : Promise.resolve(''),
      fetchRegistryFile(`apps/${slug}/notis.config.ts`, commitSha, { maxBytes: MAX_CATALOG_METADATA_BYTES }),
    ]);
    catalogBytes += Buffer.byteLength(listingText) + Buffer.byteLength(configSource);
    if (catalogBytes > MAX_CATALOG_TOTAL_BYTES) {
      throw usageError(
        `Notis app scaffold catalog exceeds the ${MAX_CATALOG_TOTAL_BYTES}-byte aggregate metadata limit.`,
      );
    }
    const listing = listingText ? JSON.parse(listingText) : null;
    return catalogEntry(slug, listing, configSource);
  });
  return scaffolds.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Case-insensitive match over slug, name, tagline, description, and categories.
 */
export function filterScaffoldCatalog(catalog, searchTerm) {
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) {
    return catalog;
  }
  const words = term.split(/\s+/);
  return catalog.filter((entry) => {
    const haystack = [entry.slug, entry.name, entry.tagline, entry.description, ...(entry.categories || [])]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Materialize one published app's source for `apps init --from`.
 *
 * Returns `{ dir, cleanup }` or null when the slug is not in the registry.
 * The caller copies out of `dir` and must call `cleanup()` afterwards.
 */
export async function acquireScaffoldSource(fromSlug) {
  const safeSlug = assertSafeScaffoldSlug(fromSlug);
  const registryDir = localRegistryDir();
  if (registryDir) {
    const appDir = join(registryDir, 'apps', safeSlug);
    if (!existsSync(join(appDir, 'notis.config.ts'))) {
      return null;
    }
    return { dir: appDir, cleanup: () => {} };
  }

  const commitSha = await resolveRegistryCommit();
  const tree = await fetchRegistryTree(commitSha);
  const prefix = `apps/${safeSlug}/`;
  const files = tree
    .filter((entry) => entry.path.startsWith(prefix))
    .map((entry) => ({ ...entry, rel: entry.path.slice(prefix.length) }))
    .filter((entry) => entry.rel && !REGISTRY_ARTIFACT.test(entry.rel) && !SKIPPED_SOURCE.test(entry.rel));
  if (!files.some((entry) => entry.rel === 'notis.config.ts')) {
    return null;
  }
  if (files.length > MAX_SCAFFOLD_FILES) {
    throw usageError(`Published scaffold contains too many files (${files.length}; maximum ${MAX_SCAFFOLD_FILES}).`);
  }
  const declaredBytes = files.reduce((total, entry) => (
    Number.isFinite(entry.size) && entry.size >= 0 ? total + entry.size : total
  ), 0);
  if (files.some((entry) => Number.isFinite(entry.size) && entry.size > MAX_SCAFFOLD_FILE_BYTES)) {
    throw usageError(`Published scaffold contains a file larger than ${MAX_SCAFFOLD_FILE_BYTES} bytes.`);
  }
  if (declaredBytes > MAX_SCAFFOLD_TOTAL_BYTES) {
    throw usageError(`Published scaffold source exceeds ${MAX_SCAFFOLD_TOTAL_BYTES} bytes.`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'notis-scaffold-'));
  let downloadedBytes = 0;
  try {
    for (let index = 0; index < files.length; index += DOWNLOAD_CONCURRENCY) {
      const settled = await Promise.allSettled(
        files.slice(index, index + DOWNLOAD_CONCURRENCY).map(async (entry) => {
          const target = resolveScaffoldTargetPath(tempRoot, entry.rel);
          const data = await fetchRegistryFile(prefix + entry.rel, commitSha, {
            binary: true,
            maxBytes: MAX_SCAFFOLD_FILE_BYTES,
          });
          downloadedBytes += data.length;
          if (downloadedBytes > MAX_SCAFFOLD_TOTAL_BYTES) {
            throw usageError(`Published scaffold source exceeds ${MAX_SCAFFOLD_TOTAL_BYTES} bytes.`);
          }
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, data);
        }),
      );
      const failed = settled.find((result) => result.status === 'rejected');
      if (failed) {
        throw failed.reason;
      }
    }
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
  return { dir: tempRoot, cleanup: () => rmSync(tempRoot, { recursive: true, force: true }) };
}
