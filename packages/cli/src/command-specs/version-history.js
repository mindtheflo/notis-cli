import { usageError } from '../runtime/errors.js';

/** The human output of a version comparison: the unified diff text, then its totals. */
export function unifiedDiffSummary(payload) {
  const diff = payload && typeof payload === 'object' ? payload : {};
  const text = typeof diff.unified_diff === 'string' ? diff.unified_diff.replace(/\n$/, '') : '';
  const files = Array.isArray(diff.files) ? diff.files.length : 0;
  const count = Number.isInteger(diff.file_count) ? diff.file_count : files;
  const totals = `${count} ${count === 1 ? 'file' : 'files'} changed, +${diff.additions ?? 0} -${diff.deletions ?? 0}`
    + (diff.truncated ? ' (comparison cut short; narrow it with --path or use --json)' : '');
  return text ? `${text}\n\n${totals}` : `No changes. ${totals}`;
}

/** `--name <name>` sets a version name, `--clear` removes it; exactly one of the two. */
export function versionName(options) {
  const hasName = typeof options.name === 'string';
  if (hasName === Boolean(options.clear)) throw usageError('Pass --name <name>, or --clear to remove the name.');
  if (hasName && !options.name.trim()) throw usageError('Pass a non-empty --name, or --clear to remove the name.');
  return hasName ? options.name : null;
}
