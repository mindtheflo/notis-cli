/**
 * Commands that write inside a source folder first prove the folder is one.
 *
 * 2026-10-02: `notis spaces build .` run from the Notis repository root treated
 * the repository as a Space source, refreshed "its" embedded SDK and deleted the
 * canonical packages/sdk/src/presentation.tsx. A source folder is identified by
 * a marker at its root, checked before any file is read for writing, staged,
 * refreshed or deleted.
 */
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { usageError } from './errors.js';

// The workspace Space index (also a legacy App's config) or a pulled Space's lock.
export const SOURCE_ROOT_MARKERS = Object.freeze(['notis.config.ts', 'notis.config.js', 'notis.config.mjs', '.notis/space-lock.json']);

export function isSourceRoot(directory) {
  return SOURCE_ROOT_MARKERS.some((name) => {
    try { return statSync(join(directory, name)).isFile(); } catch { return false; }
  });
}

/** Return the resolved folder, or refuse before anything inside it is touched. */
export function assertSourceRoot(directory) {
  const root = resolve(directory);
  if (!isSourceRoot(root)) {
    throw usageError(`${root} is not a Space source: it has no notis.config.ts (or .js, .mjs) and no .notis/space-lock.json `
      + 'at its root, so nothing was changed. Run the command in a Space source folder, or pass that folder.');
  }
  return root;
}
