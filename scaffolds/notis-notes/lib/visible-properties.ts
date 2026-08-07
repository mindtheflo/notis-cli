/**
 * Per-folder column selection for the notes table.
 *
 * A folder decides what you SEE, never what a note IS. This is view config:
 * hiding a column never removes a property, never hides it from query, and
 * moving a note between folders changes only its folder.
 *
 * The selection is stored on the folder as a JSON array of note PROPERTY IDS in
 * a rich_text property. Ids rather than names because a property id is stable
 * across renames, and rich_text rather than multi_select because a multi_select
 * would silently drop any selection whose name is not already an option, would
 * need its option list kept in sync with the notes schema forever, and would
 * leak note column names into the agent's folder-writing tool as an enum.
 */

export const VISIBLE_PROPERTIES_PROPERTY = 'Visible properties';

/** Columns shown when a folder expresses no preference. */
export const DEFAULT_VISIBLE_COLUMN_COUNT = 6;

export interface SchemaProperty {
  id?: string | null;
  name: string;
}

export type VisibleColumnSource = 'folder' | 'union' | 'fallback';

export interface ResolvedVisibleColumns<T extends SchemaProperty> {
  columns: T[];
  source: VisibleColumnSource;
}

/**
 * Read a stored selection into a list of tokens.
 *
 * Tolerant on purpose: the value may arrive as a JSON array (the format written
 * here), as a plain array once projected, or as a comma-separated string typed
 * by a human or an agent.
 */
export function parseVisibleProperties(rawValue: unknown): string[] {
  if (rawValue == null) return [];

  if (Array.isArray(rawValue)) {
    return rawValue.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof rawValue !== 'string') return [];
  const trimmed = rawValue.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch {
      // Fall through to the comma-separated reading below.
    }
  }

  return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function serializeVisibleProperties(propertyIds: string[]): string {
  return JSON.stringify(propertyIds.filter(Boolean));
}

/**
 * Resolve tokens against the live schema, by id first and then by name.
 *
 * Name matching keeps a hand-written or pre-rename selection working. Tokens
 * that match nothing are dropped rather than rendered as empty columns.
 */
function resolveTokens<T extends SchemaProperty>(tokens: string[], properties: T[]): T[] {
  const byId = new Map<string, T>();
  const byName = new Map<string, T>();
  for (const property of properties) {
    if (property.id) byId.set(property.id, property);
    byName.set(property.name.toLowerCase(), property);
  }

  const resolved: T[] = [];
  const seen = new Set<T>();
  for (const token of tokens) {
    const match = byId.get(token) ?? byName.get(token.toLowerCase());
    if (match && !seen.has(match)) {
      seen.add(match);
      resolved.push(match);
    }
  }
  return resolved;
}

/**
 * Decide which columns the table shows.
 *
 * - A folder with a usable selection gets exactly that, in schema order.
 * - With no folder selected, the union of every folder's selection, so the
 *   unfiltered view still reflects how the user has set their folders up.
 * - Otherwise today's behaviour: the first few properties after the title.
 *
 * Never returns an empty column set - a folder configured entirely from
 * properties that no longer exist falls back rather than rendering nothing.
 */
export function resolveVisibleColumns<T extends SchemaProperty>({
  metadataProperties,
  activeFolderSelection,
  activeFolderSelected = false,
  allFolderSelections = [],
  limit = DEFAULT_VISIBLE_COLUMN_COUNT,
}: {
  metadataProperties: T[];
  activeFolderSelection: unknown;
  activeFolderSelected?: boolean;
  allFolderSelections?: unknown[];
  limit?: number;
}): ResolvedVisibleColumns<T> {
  const fallback = { columns: metadataProperties.slice(0, limit), source: 'fallback' as const };

  const activeTokens = parseVisibleProperties(activeFolderSelection);
  if (activeTokens.length) {
    const resolved = resolveTokens(activeTokens, metadataProperties);
    if (resolved.length) {
      // An explicit per-folder choice is honoured in full; the table scrolls.
      const order = new Map(metadataProperties.map((property, index) => [property, index]));
      resolved.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      return { columns: resolved, source: 'folder' };
    }
    return fallback;
  }

  if (!activeFolderSelected && allFolderSelections.length) {
    const unionTokens = allFolderSelections.flatMap((value) => parseVisibleProperties(value));
    const resolved = resolveTokens(unionTokens, metadataProperties);
    if (resolved.length) {
      const order = new Map(metadataProperties.map((property, index) => [property, index]));
      resolved.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      return { columns: resolved.slice(0, limit), source: 'union' };
    }
  }

  return fallback;
}
