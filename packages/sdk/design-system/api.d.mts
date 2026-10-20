export type ComponentEntry = '@notis/sdk' | '@notis/sdk/ui' | '@notis/sdk/interactions';
export type NoComponentEntry = '@notis/sdk/words' | '@notis/sdk/config' | '@notis/sdk/vite';
export type PackageEntryName = ComponentEntry | NoComponentEntry;

export interface PackageEntry {
  /** `@notis/sdk` or `@notis/sdk/<subpath>`. Typed as a string: a new export path is a problem, not a type. */
  name: string;
  /** The key of `exports`, e.g. `./ui`. */
  subpath: string;
  /** Relative to the checkout root, forward slashes. */
  file: string;
}

export interface EntryListProblem {
  code: 'entry-list';
  export: string;
  file: string;
  message: string;
}

export interface ApiExport {
  name: string;
  entry: string;
  kind: 'component' | 'hook' | 'helper' | 'class' | 'constant' | 'type';
  file: string | null;
  line: number | null;
  doc: string;
  decl_sha256: string | null;
  declared_as: string;
}
export const DEFAULT_ROOT: string;
export const COMPONENT_ENTRIES: readonly ComponentEntry[];
export const NO_COMPONENT_ENTRIES: readonly NoComponentEntry[];
export const SPECIMEN_IMPORT_ENTRIES: readonly PackageEntryName[];
export function packageEntries(options?: { root?: string }): PackageEntry[];
export function entryListProblems(entries?: PackageEntry[]): EntryListProblem[];
export function entryFiles(options?: { root?: string }): Readonly<Record<string, string>>;
export const ENTRY_FILES: Readonly<Record<string, string>>;
export function readApi(options?: { root?: string }): ApiExport[];
