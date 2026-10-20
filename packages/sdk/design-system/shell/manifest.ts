/**
 * The book manifest (`notis-design-book/v1`, design review spec, section 3.1), as `build.mjs` writes it to
 * `manifest.json` and inlines it in `index.html` (`#ds-manifest`). Types only: the shell imports nothing from the SDK.
 */
export type BookEntry = '@notis/sdk' | '@notis/sdk/ui' | '@notis/sdk/interactions' | '@notis/sdk/words';
export type BookTheme = 'light' | 'dark';
export type BookLang = 'en' | 'fr';

export interface BookState {
  id: string;
  label: string;
  width: number | null;
  height: number | null;
  theme: BookTheme | null;
  interact: boolean;
}

export interface BookSpecimen {
  id: string;
  name: string;
  group: string;
  from: BookEntry;
  covers: string[];
  summary: string;
  file: string;
  sources: Array<{ name: string; file: string | null; line: number | null }>;
  states: BookState[];
  inputs: Record<string, string>;
}

export interface BookComponent {
  name: string;
  /** The canonical value name when this name is an alias. */
  of: string;
  entries: BookEntry[];
  specimen: string | null;
  file: string | null;
  line: number | null;
  /** The group its declaration file belongs to (section 11), so an uncovered component shows where it goes. */
  group: string | null;
}

export interface BookApiExport {
  name: string;
  entry: BookEntry;
  kind: 'component' | 'third_party' | 'hook' | 'helper' | 'class' | 'constant' | 'type';
  file: string | null;
  line: number | null;
  doc: string;
  decl_sha256: string | null;
}

export interface BookToken {
  chain: string;
  name: string;
  value: string;
  line: number;
  file?: string;
}

export interface BookWords {
  entry: string;
  name: string;
  rows: Array<{ key: string; en: string; fr: string; raw?: boolean }>;
}

export interface BookProblem {
  code: string;
  export?: string;
  file?: string;
  message: string;
}

export interface BookManifest {
  schema: 'notis-design-book/v1';
  scope_digest: string | null;
  built: string;
  groups: Array<{ key: string; title: string }>;
  specimens: BookSpecimen[];
  aliases: Array<{ name: string; of: string; entry: BookEntry }>;
  components: BookComponent[];
  third_party: Array<{ name: string; entry: BookEntry; from: 'recharts'; as: string }>;
  api: BookApiExport[];
  tokens: { portal: BookToken[]; toolkit: BookToken[] };
  words: BookWords[];
  css_sha256: string;
  frame_inputs: Record<string, string>;
  /** sha256 of the build.mjs that built this book (an addition to the spec manifest, part of the shot cache key). */
  build_sha256?: string;
  versions: Record<string, string | null>;
  inventory: { ok: boolean; problems: BookProblem[] };
}

/** The book's widths and the defaults of its toggles. */
export const BOOK_WIDTHS = [390, 768, 1440] as const;
export const ENTRY_ORDER: readonly BookEntry[] = ['@notis/sdk', '@notis/sdk/ui', '@notis/sdk/interactions', '@notis/sdk/words'];

export type RowKind = 'api' | 'token' | 'word';

/**
 * The key of a row of the Tokens, Words or API section, shared with the review page:
 * - api: `<entry> <name>` (third party rows included);
 * - token: `portal <chain> <name>` or `toolkit <chain> <name>`, with the manifest's chain (a Portal row shows
 *   the `:root` and `.dark` values together and answers to both keys);
 * - word: `<entry> <table> <key>`.
 */
export function rowKey(kind: 'api', item: { entry: string; name: string }): string;
export function rowKey(kind: 'token', item: { source: 'portal' | 'toolkit'; chain: string; name: string }): string;
export function rowKey(kind: 'word', item: { entry: string; table: string; key: string }): string;
export function rowKey(kind: RowKind, item: Record<string, string>): string {
  if (kind === 'api') return `${item.entry} ${item.name}`;
  if (kind === 'token') return `${item.source} ${item.chain} ${item.name}`;
  return `${item.entry} ${item.table} ${item.key}`;
}

/** One cell of the shot matrix (design review spec, section 6.3). */
export interface ShotCell {
  theme: BookTheme;
  lang: BookLang;
  width: number;
}

/** The four cells every state is shot at, before a fixed width or theme collapses them. */
export const SHOT_CELLS: readonly ShotCell[] = [
  { theme: 'light', lang: 'en', width: 1440 },
  { theme: 'dark', lang: 'en', width: 1440 },
  { theme: 'light', lang: 'fr', width: 390 },
  { theme: 'dark', lang: 'fr', width: 768 },
];

/** The key of a shot cell in `shots.json` and in the review data: `<theme>-<lang>-<width>`, with the state's
 * fixed width and theme applied. `shoot.mjs` builds the same key. */
export function cellKey(cell: ShotCell): string {
  return `${cell.theme}-${cell.lang}-${cell.width}`;
}
