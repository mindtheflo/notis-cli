/** One authoring project, one selected immutable Space release at a time. */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { appFilesDigest, buildArtifact, freezeSourceWorkspace, prepareAppRelease, prepareSelectedBuild, saveSelectedBuild, syncEmbeddedSdk } from './app-platform.js';
import { validateProjectBoundary, validateProjectDesign } from './app-boundary-validator.js';
import { collectSelectedSpaceSource, loadSelectedSpace } from './space-source.js';
import { viewManifestFields } from './space-view-manifest.js';
import { usageError } from './errors.js';
import { assertSourceRoot } from './source-root.js';

export function generateSpaceManifest(selection) {
  const definition = selection.definition;
  return { schema: 'notis-space/v1', kind: selection.entry ? 'presentation' : 'container', local_key: selection.key,
    name: definition.name, description: definition.description || '', icon: definition.icon || null, accent: definition.accent || null,
    resources: definition.resources || {}, actions: definition.actions || {},
    ...(definition.navigation ? { navigation: definition.navigation } : {}),
    // Absent when none, so manifests without viewer reads stay byte-identical.
    ...(definition.viewerReads?.length ? { viewer_reads: [...definition.viewerReads].sort() } : {}),
    // Absent when undeclared, for the same reason.
    ...(definition.cloudComputer ? { cloud_computer: definition.cloudComputer } : {}),
    readable_context: definition.readableContext || '', collection: definition.collection || null,
    // V4 declarations are mandatory for every presentation; the wire schema stays v1.
    ...viewManifestFields(definition, { entry: selection.entry, resources: definition.resources || {} }),
    ...(selection.entry ? { presentation: { export_name: 'SpaceView' }, bundle: { js: 'bundle/app.js', css: 'bundle/app.css' } } : {}),
  };
}

function prepareSelectedArtifact(projectDir, selection) {
  validateProjectBoundary(projectDir);
  validateProjectDesign(projectDir);
  const entryPath = join(projectDir, '.notis/_entry.tsx');
  const manifestPath = join(projectDir, '.notis/output/manifest.json');
  mkdirSync(dirname(entryPath), { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  if (selection.entry) {
    const reference = path => JSON.stringify('./' + relative(dirname(entryPath), join(projectDir, path)).replaceAll('\\', '/'));
    const lines = [`export { default as SpaceView } from ${reference(selection.entry)};`];
    if (selection.layout) lines.push(`export { default as __AppShell } from ${reference(selection.layout)};`);
    if (selection.markdown) lines.push(`export { default as SpaceMarkdown } from ${reference(selection.markdown)};`);
    writeFileSync(entryPath, lines.join('\n') + '\n');
  }
  writeFileSync(manifestPath, JSON.stringify(generateSpaceManifest(selection), null, 2) + '\n');
}

function finalizeSelectedArtifact(projectDir) {
  const manifestPath = join(projectDir, '.notis/output/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // A CSS-free Vite entry legitimately emits only JavaScript. Declare actual
  // output before the immutable build receipt, not a nonexistent stylesheet.
  if (manifest.bundle?.css && !existsSync(join(projectDir, '.notis/output', manifest.bundle.css))) {
    delete manifest.bundle.css;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
}

/**
 * Build from the selected source slice so CSS scans/config loaders cannot pull
 * in unshared sibling files. Staging resolves the original project's installed
 * dependencies; it is not another authoring project or dependency installation.
 * The existing pinned freeze/receipt code owns all staging writes and cleanup.
 */
export async function buildSpaceRelease(projectDir, selectedKey, { stdio = 'inherit', refreshSdk = true, runBuild } = {}) {
  projectDir = assertSourceRoot(projectDir);
  if (refreshSdk) syncEmbeddedSdk(projectDir);
  const selection = await loadSelectedSpace(projectDir, selectedKey);
  const sourceFiles = collectSelectedSpaceSource(projectDir, selection);
  const sourceHash = appFilesDigest(sourceFiles);
  const staging = freezeSourceWorkspace(projectDir, sourceFiles);
  let release;
  try {
    if (existsSync(join(projectDir, 'node_modules'))) {
      symlinkSync(join(projectDir, 'node_modules'), join(staging.projectDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    const frozenSelection = await loadSelectedSpace(staging.projectDir, selectedKey);
    await buildArtifact(staging.projectDir, { stdio, refreshSdk: false, executable: Boolean(selection.entry), includeMetadata: false,
      prepare: directory => prepareSelectedArtifact(directory, frozenSelection), finalize: finalizeSelectedArtifact,
      ...(runBuild ? { runBuild } : {}) });
    const current = await loadSelectedSpace(projectDir, selectedKey);
    if (sourceHash !== appFilesDigest(collectSelectedSpaceSource(projectDir, current))) throw usageError('This Space source changed during the selected build. Build again.');
    release = prepareAppRelease(staging.projectDir);
    const close = release.close;
    return { ...release, selectedKey, sourceHash, fixturePath: selection.fixturePath, close() { try { close(); } finally { staging.close(); } } };
  } catch (error) {
    try { release?.close(); } finally { staging.close(); }
    throw error;
  }
}

export async function buildSpaceArtifact(projectDir, selectedKey, options) {
  const release = await buildSpaceRelease(projectDir, selectedKey, options);
  try {
    const receiptPath = saveSelectedBuild(projectDir, selectedKey, release);
    return { manifest: release.manifest, receiptPath, sourceHash: release.sourceHash };
  } finally { release.close(); }
}

export async function prepareSpaceRelease(projectDir, selectedKey) {
  const selection = await loadSelectedSpace(projectDir, selectedKey);
  const source = collectSelectedSpaceSource(projectDir, selection);
  const release = prepareSelectedBuild(projectDir, selectedKey, source);
  if (release.manifest?.schema !== 'notis-space/v1' || release.manifest.local_key !== selectedKey) {
    release.close(); throw usageError('The saved build belongs to a different Space.');
  }
  return { ...release, fixturePath: selection.fixturePath };
}
