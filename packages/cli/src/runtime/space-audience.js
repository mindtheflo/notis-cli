/**
 * Editor-only parts of a Space (truths SPC-069 to SPC-074). A source marks the whole view, a list
 * (`shows`), an action or a param with `editorsOnly: true`, and a database column with
 * `resources[alias].columns: { Column: { editorsOnly: true } }`. Unmarked parts are public.
 *
 * The manifest never carries the markers on the items it copies: it carries one top-level
 * `editors_only` summary instead (absent when nothing is marked, so unmarked manifests stay
 * byte-identical). server/lib/space_audience.py re-checks it on every release.
 */
import { usageError } from './errors.js';

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// Python's casefold, closely enough for property names (as space-view-manifest.js matches them).
const fold = value => String(value).toUpperCase().toLowerCase();

/** Whether `value` marks a part editor-only: absent is public, the literal true is editors only. */
export function editorsOnlyFlag(value, where) {
  if (value === undefined) return false;
  if (value !== true) throw usageError(`${where}: editorsOnly is true, or left out for a part the public sees.`);
  return true;
}

/** A copy without the editorsOnly marker, so the manifest item reads exactly as an unmarked one. */
export function withoutMarker(value) {
  if (!plain(value) || !Object.hasOwn(value, 'editorsOnly')) return value;
  const { editorsOnly, ...rest } = value;
  return rest;
}

/**
 * The editor-only column names of one database resource (`columns`), checked against the schema of a
 * database the same release creates. A linked database's schema is checked on the server at verify and deploy.
 */
export function editorOnlyColumns(alias, resource) {
  if (!plain(resource) || resource.columns === undefined) return [];
  const columns = resource.columns;
  if (resource.kind !== 'database') throw usageError(`Resource ${alias}: only a database declares editor-only columns.`);
  if (!plain(columns) || !Object.keys(columns).length || Object.keys(columns).length > 200) {
    throw usageError(`Database ${alias}: declare columns as { Column: { editorsOnly: true } }, naming at least one property.`);
  }
  const schema = resource.create?.schema;
  const properties = plain(schema?.properties) ? Object.entries(schema.properties).filter(([, prop]) => plain(prop)) : null;
  for (const [name, marker] of Object.entries(columns)) {
    if (!name.trim() || name.length > 200) throw usageError(`Database ${alias}: a column names a property of 1 to 200 characters.`);
    if (!plain(marker) || Object.keys(marker).join(',') !== 'editorsOnly' || marker.editorsOnly !== true) {
      throw usageError(`Database ${alias}: column "${name}" is { editorsOnly: true }.`);
    }
    if (properties && !properties.some(([key, prop]) => key === name || fold(prop.name ?? key) === fold(name))) {
      throw usageError(`Database ${alias}: "${name}" is not a property of the database this Space creates.`);
    }
  }
  return Object.keys(columns).sort();
}

/** The resources as the manifest carries them: without their `columns` markers. */
export function manifestResources(resources) {
  return Object.fromEntries(Object.entries(resources || {}).map(([alias, resource]) => {
    if (!plain(resource) || !Object.hasOwn(resource, 'columns')) return [alias, resource];
    const { columns, ...rest } = resource;
    return [alias, rest];
  }));
}

/** The actions as the manifest (and so the release) carries them: without their editorsOnly markers. */
export function manifestActions(actions) {
  return Object.fromEntries(Object.entries(actions || {}).map(([id, template]) => [id, withoutMarker(template)]));
}

/** The view's params or shows as the manifest carries them: without their editorsOnly markers. */
export function manifestDeclarations(declarations) {
  return Object.fromEntries(Object.entries(declarations).map(([name, value]) => [name, withoutMarker(value)]));
}

const marked = items => Object.entries(items || {}).filter(([, value]) => plain(value) && value.editorsOnly === true)
  .map(([name]) => name).sort();

/**
 * The one `editors_only` manifest key: `{ view?, shows?, actions?, params?, columns? }`, sorted and
 * without empty members, or undefined when nothing is editor-only. The markers are validated where
 * each part is (space-source.js and space-view-manifest.js).
 */
export function editorsOnlySummary(definition) {
  const columns = Object.fromEntries(Object.entries(definition.resources || {})
    .map(([alias, resource]) => [alias, plain(resource?.columns) ? Object.keys(resource.columns).sort() : []])
    .filter(([, names]) => names.length).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
  const summary = {
    ...(definition.editorsOnly === true ? { view: true } : {}),
    ...(marked(definition.shows).length ? { shows: marked(definition.shows) } : {}),
    ...(marked(definition.actions).length ? { actions: marked(definition.actions) } : {}),
    ...(marked(definition.params).length ? { params: marked(definition.params) } : {}),
    ...(Object.keys(columns).length ? { columns } : {}),
  };
  return Object.keys(summary).length ? summary : undefined;
}
