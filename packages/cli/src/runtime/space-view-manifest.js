/**
 * What a view declares (V4): path, typed params, shows, memory, chrome and a Markdown override.
 * Mirrors server/lib/space_view_manifest.py, which re-checks every release; property-level checks
 * need the linked schemas and run on the server during `spaces verify` and deploy.
 * Every presentation requires path, description and memory, including sources that omit
 * specVersion. Containers remain non-executable; explicit specVersion 2 is unchanged.
 */
import { usageError } from './errors.js';
import portalRouteRoots from '../../config/portal-route-roots.json' with { type: 'json' };
const RESERVED_PATHS = new Set(portalRouteRoots);

export const VIEW_SPEC_VERSION = 2;
export const VIEW_DEFINITION_FIELDS = Object.freeze(['specVersion', 'path', 'params', 'shows', 'memory', 'chrome', 'markdown']);
export const VIEW_PARAM_TYPES = Object.freeze(['record', 'enum', 'text', 'number', 'date', 'boolean']);
const RESERVED_PARAMS = new Set(['record', 'assistantThread']);
const PAGE_ONLY = ['params', 'shows', 'memory', 'chrome', 'markdown'];
const NAME = /^[a-z][A-Za-z0-9_]{0,63}$/;
// Credentials never ride in links, so no view param may look like one (the Portal drops these names).
const CREDENTIAL_PARAM = /^(?:jwt|code|state|key)$|token|secret|password|credential|session|auth|api_?key/i;
const WORD = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_TAIL = /(?:^|-)(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const PLACEHOLDER = /^\{([a-z][A-Za-z0-9_]{0,63})(?:\.([^{}.\s][^{}]{0,199}))?\}$/;
const RECORD_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const FIELD_KEYS = ['property', 'property_id', 'column'];
const OPS = new Set(['equals', 'not_equals', 'in', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
  'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to', 'does_not_contain', 'before', 'after',
  'on_or_before', 'on_or_after']);
const CRON_BOUNDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const DEBOUNCE = [60, 86400];

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= limit && !CONTROL.test(value);
const isoDate = value => typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validateViewPath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
    throw usageError('Declare path as the words of this view\'s links, such as "notes" or "seo/keywords".');
  }
  const segments = value.split('/');
  if (segments.length > 4 || segments.some(segment => !WORD.test(segment) || ID_TAIL.test(segment))) {
    throw usageError('A path is up to four lowercase words (a-z, 0-9, dashes) separated by "/", without ids.');
  }
  if (RESERVED_PATHS.has(segments[0])) throw usageError(`The path "${segments[0]}" belongs to the Portal. Choose another first word.`);
  return value;
}

function validCron(value) {
  const fields = typeof value === 'string' ? value.split(' ') : [];
  if (fields.length !== 5) return false;
  return fields.every((field, index) => {
    const [low, high] = CRON_BOUNDS[index];
    const inRange = number => /^\d+$/.test(number) && Number(number) >= low && Number(number) <= high;
    if (index === 0) return inRange(field);
    return field.split(',').every(part => {
      const [base, step, extra] = part.split('/');
      if (extra !== undefined || (step !== undefined && !(/^\d+$/.test(step) && Number(step) >= 1 && Number(step) <= high))) return false;
      if (base === '*') return true;
      const [start, end, more] = base.split('-');
      if (more !== undefined || !inRange(start) || (end !== undefined && (!inRange(end) || Number(start) > Number(end)))) return false;
      return true;
    });
  });
}

function validateMemory(memory) {
  if (!plain(memory) || Object.keys(memory).sort().join(',') !== 'attachments,markdown,screenshot,snapshots') {
    throw usageError('Declare memory as { markdown, attachments, screenshot, snapshots }; see the memory guide.');
  }
  if (['markdown', 'attachments', 'screenshot'].some(name => typeof memory[name] !== 'boolean')) {
    throw usageError('memory.markdown, memory.attachments and memory.screenshot are true or false.');
  }
  if (!Array.isArray(memory.snapshots) || memory.snapshots.length > 3) {
    throw usageError('memory.snapshots lists on_render, { scheduled } and { on_change }, each at most once ([] for none).');
  }
  const seen = new Set();
  for (const strategy of memory.snapshots) {
    let kind;
    if (strategy === 'on_render') kind = 'on_render';
    else if (plain(strategy) && Object.keys(strategy).join(',') === 'scheduled') {
      kind = 'scheduled';
      if (!validCron(strategy.scheduled)) throw usageError('A scheduled snapshot uses a five-field UTC cron with a fixed minute, such as "0 7 * * 1".');
    } else if (plain(strategy) && Object.keys(strategy).join(',') === 'on_change') {
      kind = 'on_change';
      const debounce = strategy.on_change?.debounceSeconds;
      if (!plain(strategy.on_change) || Object.keys(strategy.on_change).join(',') !== 'debounceSeconds' || !Number.isInteger(debounce)
        || debounce < DEBOUNCE[0] || debounce > DEBOUNCE[1]) {
        throw usageError(`An on_change snapshot waits debounceSeconds (${DEBOUNCE[0]} to ${DEBOUNCE[1]}) after the last change.`);
      }
    } else throw usageError('memory.snapshots lists on_render, { scheduled: "<cron>" } or { on_change: { debounceSeconds } }.');
    if (seen.has(kind)) throw usageError('Declare each memory snapshot strategy at most once.');
    seen.add(kind);
  }
}

/** One typed param value, as the SDK and the server accept it. */
export function viewParamValue(declaration, value) {
  switch (declaration.type) {
    case 'text': return typeof value === 'string' && value.length <= 500 && !CONTROL.test(value);
    case 'enum': return typeof value === 'string' && (declaration.values || []).includes(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'date': return isoDate(value);
    case 'record': return typeof value === 'string' && RECORD_KEY.test(value);
    default: return false;
  }
}

function validateParam(name, declaration, resources) {
  if (!NAME.test(name) || RESERVED_PARAMS.has(name) || CREDENTIAL_PARAM.test(name)) throw usageError(`Param names are camelCase words; "${name}" is not available.`);
  const allowed = new Set(['type', 'description', 'required', 'default', 'values', 'database', 'main', 'slugProperty']);
  if (!plain(declaration) || Object.keys(declaration).some(field => !allowed.has(field)) || !VIEW_PARAM_TYPES.includes(declaration.type)) {
    throw usageError(`Declare param "${name}" as { type, description, ... } with type ${VIEW_PARAM_TYPES.join(', ')}.`);
  }
  if (!text(declaration.description, 500)) throw usageError(`Describe param "${name}": what it selects, for agents and people.`);
  if ('required' in declaration && typeof declaration.required !== 'boolean') throw usageError(`Param "${name}": required is true or false.`);
  if (declaration.type === 'enum') {
    const values = declaration.values;
    if (!Array.isArray(values) || values.length < 1 || values.length > 100 || new Set(values).size !== values.length
      || values.some(value => !text(value, 100))) throw usageError(`Param "${name}": an enum lists its distinct values.`);
  } else if ('values' in declaration) throw usageError(`Param "${name}": only enum params list values.`);
  if (declaration.type === 'record') {
    if (resources[declaration.database]?.kind !== 'database') {
      throw usageError(`Param "${name}": a record param names a database this Space declares in resources.`);
    }
    if ('main' in declaration && typeof declaration.main !== 'boolean') throw usageError(`Param "${name}": main is true or false.`);
    if ('slugProperty' in declaration && !text(declaration.slugProperty, 200)) throw usageError(`Param "${name}": slugProperty names a property of its database.`);
    if ('default' in declaration) throw usageError(`Param "${name}": a record param has no default record.`);
  } else if (['database', 'main', 'slugProperty'].some(field => field in declaration)) {
    throw usageError(`Param "${name}": database, main and slugProperty belong to record params.`);
  }
  if ('default' in declaration) {
    if (declaration.required === true) throw usageError(`Param "${name}": a required param has no default.`);
    if (!viewParamValue(declaration, declaration.default)) throw usageError(`Param "${name}": its default must be a valid ${declaration.type} value.`);
  }
}

function checkPlaceholder(value, params, collection, where) {
  const match = typeof value === 'string' ? PLACEHOLDER.exec(value) : null;
  if (!match) return;
  const [, name, property] = match;
  if (name === 'record') {
    const records = Object.values(params).filter(declaration => declaration.type === 'record');
    if (records.length === 1 || (!records.length && collection)) return;
    throw usageError('Use {record} only in a view with exactly one record param (or a collection); otherwise name the param, such as {project}.');
  }
  if (!Object.hasOwn(params, name)) throw usageError(`${where}: "{${name}}" names no declared param.`);
  if (property !== undefined && params[name].type !== 'record') throw usageError(`${where}: only record params have properties, such as {${name}}.`);
}

function walkFilter(node, visit, where, depth = 0, budget = { left: 200 }) {
  budget.left -= 1;
  if (depth > 12 || budget.left < 0) throw usageError(`${where}: the filter is too complex; use fewer conditions.`);
  if (depth === 0 && plain(node) && !Object.keys(node).length) return;
  if (!plain(node)) throw usageError(`${where}: a filter is an object.`);
  for (const group of ['and', 'or']) {
    if (!Object.hasOwn(node, group)) continue;
    const children = node[group];
    if (Object.keys(node).length !== 1 || !Array.isArray(children) || !children.length) throw usageError(`${where}: filter groups need at least one condition.`);
    children.forEach(child => walkFilter(child, visit, where, depth + 1, budget));
    return;
  }
  const field = node.field;
  if (Object.keys(node).some(key => !['field', 'op', 'value'].includes(key)) || !('field' in node) || !('op' in node)
    || !plain(field) || Object.keys(field).length !== 1 || !FIELD_KEYS.includes(Object.keys(field)[0])
    || typeof Object.values(field)[0] !== 'string' || !OPS.has(node.op)) {
    throw usageError(`${where}: each condition is { field: { property }, op, value } in the native filter language.`);
  }
  visit(node);
}

function validateShows(name, declaration, params, resources, collection) {
  const where = `shows.${name}`;
  if (!NAME.test(name)) throw usageError(`Shows names are camelCase words; "${name}" is not available.`);
  if (plain(declaration) && 'about' in declaration) {
    const services = declaration.services ?? [];
    if (Object.keys(declaration).some(field => !['about', 'services'].includes(field)) || !text(declaration.about, 500)
      || !Array.isArray(services) || services.length > 20 || services.some(service => typeof service !== 'string' || !SERVICE.test(service))) {
      throw usageError(`${where}: describe what it shows as { about, services? }.`);
    }
    return;
  }
  if (!plain(declaration) || Object.keys(declaration).some(field => !['database', 'where', 'open'].includes(field)) || !('where' in declaration)) {
    throw usageError(`${where}: declare { database, where, open? } for Notis data or { about, services? } otherwise.`);
  }
  if (resources[declaration.database]?.kind !== 'database') {
    throw usageError(`${where}: "${declaration.database}" is not a database this Space declares and links.`);
  }
  if (declaration.open !== undefined && (params[declaration.open]?.type !== 'record' || params[declaration.open].database !== declaration.database)) {
    throw usageError(`${where}: open names a record param over the same database.`);
  }
  walkFilter(declaration.where, condition => {
    if (!('value' in condition)) return;
    const values = condition.op === 'in' && Array.isArray(condition.value) ? condition.value : [condition.value];
    values.forEach(value => checkPlaceholder(value, params, collection, where));
  }, where);
}

/**
 * Validates V4 declarations independently of the optional version marker, then returns
 * their manifest form without inventing a version or page fields for containers.
 */
export function viewManifestFields(definition, { entry, resources }) {
  const container = !entry;
  const version = definition.specVersion;
  if (version !== undefined && version !== VIEW_SPEC_VERSION) throw usageError(`specVersion is ${VIEW_SPEC_VERSION} for sources that declare the view manifest.`);
  if (container && PAGE_ONLY.some(field => definition[field] !== undefined)) {
    throw usageError('A container has no page: params, shows, memory, chrome and markdown belong to its views.');
  }
  if (!container || version === VIEW_SPEC_VERSION) {
    const missing = ['path', 'description'].filter(field => !definition[field]);
    if (!container && definition.memory === undefined) missing.push('memory');
    if (missing.length) throw usageError(`This view needs ${missing.join(', ')} (specVersion 2).`);
    if (!text(definition.description, 300)) throw usageError('Describe this view in one line (up to 300 characters).');
  }
  if (definition.path !== undefined) validateViewPath(definition.path);
  const params = definition.params ?? {};
  if (definition.params !== undefined) {
    if (!plain(params) || Object.keys(params).length > 50) throw usageError('Declare params as { name: { type, description, ... } }.');
    const mains = new Map();
    for (const [name, declaration] of Object.entries(params)) {
      validateParam(name, declaration, resources);
      if (declaration.type !== 'record' || declaration.main !== true) continue;
      if (mains.has(declaration.database)) {
        throw usageError(`Params "${mains.get(declaration.database)}" and "${name}" both claim main for database "${declaration.database}"; a database has one main view.`);
      }
      mains.set(declaration.database, name);
    }
  }
  if (definition.shows !== undefined) {
    if (!plain(definition.shows) || Object.keys(definition.shows).length > 50) {
      throw usageError('Declare shows as { name: { database, where, open? } } or { name: { about, services? } }.');
    }
    for (const [name, declaration] of Object.entries(definition.shows)) validateShows(name, declaration, params, resources, definition.collection);
  }
  if (definition.memory !== undefined) validateMemory(definition.memory);
  if (definition.chrome !== undefined && !['portal', 'hidden'].includes(definition.chrome)) throw usageError("chrome is 'portal' (default) or 'hidden'.");
  if (definition.markdown !== undefined && (typeof definition.markdown !== 'string' || !definition.markdown)) {
    throw usageError('markdown names a source module whose default export renders this view as Markdown.');
  }
  return {
    ...(version !== undefined ? { spec_version: version } : {}),
    ...(definition.path !== undefined ? { path: definition.path } : {}),
    ...(definition.params !== undefined ? { params } : {}),
    ...(definition.shows !== undefined ? { shows: definition.shows } : {}),
    ...(definition.memory !== undefined ? { memory: definition.memory } : {}),
    ...(definition.chrome !== undefined ? { chrome: definition.chrome } : {}),
    ...(definition.markdown !== undefined ? { markdown: { export_name: 'SpaceMarkdown' } } : {}),
  };
}
