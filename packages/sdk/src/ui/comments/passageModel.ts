/**
 * Comments on a passage of a record's text (pure; no React). A thread can sit on words of a property (a subject, a
 * Markdown body) instead of a pin: the comment row keeps which field it is on, the quoted words and a few words
 * before and after them. The quote is found again in the text as it is now, white space ignored, the surrounding
 * words telling apart several matches; when the quoted words are gone the thread reads Text changed.
 *
 * The Comments table needs these columns besides the `CommentColumns` ones:
 *
 * | Column | Type | Meaning                                                                 |
 * | ------ | ---- | ----------------------------------------------------------------------- |
 * | Field  | text or select | Which field the passage is in (the field's key by default).   |
 * | Quote  | text | The selected words (white space collapsed, at most 1000 characters).    |
 * | Prefix | text | Up to 40 characters before the quote, to tell apart repeated words.     |
 * | Suffix | text | Up to 40 characters after it.                                           |
 *
 * Every name can be changed with `PassageColumns`. A field can also be named by several columns (`values`), for
 * example a Field and a Language column for the same property in two languages.
 */

import type { Words } from '../../words';
import { commentText, type CommentRow } from './commentModel';

/** The words a thread sits on, with the words around them. */
export interface TextPassage { quote: string; prefix: string; suffix: string }
/** A passage in one field of the record. */
export interface PassageAnchor extends TextPassage { field: string }

/** A text property comments can sit on. */
export interface PassageField {
  /** The Space's own name for the field (`subject`, `bodyEn`). */
  key: string;
  /** Its name in the pane, above each quote. */
  label: Words;
  /**
   * The values that name this field on a comment row: written with each new comment, and a row whose columns hold
   * all of them is on this field. Default `{ [columns.field]: key }`.
   */
  values?: Readonly<Record<string, string>>;
  /** Fields shown together, such as one language. The pane lists the threads of the group on screen. */
  group?: string;
  /** The value is Markdown: Text changed and the reading order look at its words, not its syntax. */
  markdown?: boolean;
}

export interface PassageColumns { field: string; quote: string; prefix: string; suffix: string }

export const PASSAGE_COLUMNS: Readonly<PassageColumns> = Object.freeze({
  field: 'Field', quote: 'Quote', prefix: 'Prefix', suffix: 'Suffix',
});

export function passageColumns(columns?: Partial<PassageColumns>): PassageColumns {
  return { ...PASSAGE_COLUMNS, ...(columns ?? {}) };
}

/** Characters kept before and after a quote. */
export const PASSAGE_CONTEXT = 40;
/** The longest quote kept. */
export const PASSAGE_MAX_QUOTE = 1000;

const collapse = (value: string) => value.replace(/\s+/g, ' ');
const squeeze = (value: string) => value.replace(/\s+/g, '');

/** The column values naming a field on a comment row. */
export function passageFieldValues(field: PassageField, columns: PassageColumns = PASSAGE_COLUMNS): Readonly<Record<string, string>> {
  return field.values ?? { [columns.field]: field.key };
}

/**
 * Finds a passage in `text`, white space ignored (line breaks and block gaps move with edits). With several matches,
 * the one whose surrounding words best match the stored prefix and suffix. Offsets in `text`, or null when the quoted
 * words are gone.
 */
export function locatePassage(text: string, passage: TextPassage): { start: number; end: number } | null {
  const quote = squeeze(passage.quote);
  if (!quote) return null;
  const at: number[] = [];
  let flat = '';
  for (let i = 0; i < text.length; i += 1) if (!/\s/.test(text[i]!)) { at.push(i); flat += text[i]; }
  const before = squeeze(passage.prefix);
  const after = squeeze(passage.suffix);
  let best = -1;
  let bestScore = -1;
  for (let k = flat.indexOf(quote); k !== -1; k = flat.indexOf(quote, k + 1)) {
    let score = 0;
    while (score < before.length && k - 1 - score >= 0 && flat[k - 1 - score] === before[before.length - 1 - score]) score += 1;
    let tail = 0;
    const end = k + quote.length;
    while (tail < after.length && end + tail < flat.length && flat[end + tail] === after[tail]) tail += 1;
    if (score + tail > bestScore) { best = k; bestScore = score + tail; }
  }
  if (best < 0) return null;
  return { start: at[best]!, end: at[best + quote.length - 1]! + 1 };
}

/** The passage between two offsets of `text`, with its prefix and suffix; null when only white space is selected. */
export function passageAt(text: string, start: number, end: number): TextPassage | null {
  const quote = collapse(text.slice(start, end)).trim().slice(0, PASSAGE_MAX_QUOTE);
  if (!squeeze(quote)) return null;
  const prefix = collapse(text.slice(Math.max(0, start - PASSAGE_CONTEXT * 2), start)).trimStart().slice(-PASSAGE_CONTEXT);
  const suffix = collapse(text.slice(end, end + PASSAGE_CONTEXT * 2)).trimEnd().slice(0, PASSAGE_CONTEXT);
  return { quote, prefix, suffix };
}

/** The words a reader sees in Markdown source: link and image targets, HTML tags and markup characters left out. */
export function markdownReadableText(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`#>|~\\]/g, '');
}

/**
 * Where a passage starts in a field's value, or null when its words are no longer there. For Markdown the words are
 * looked for in what a reader sees (the offset is then proportional), then in the source itself.
 */
export function passageOffset(value: string, passage: TextPassage, markdown = false): number | null {
  if (!markdown) return locatePassage(value, passage)?.start ?? null;
  const words = markdownReadableText(value);
  const hit = locatePassage(words, passage);
  if (hit) return Math.round((hit.start / Math.max(1, words.length)) * value.length);
  return locatePassage(value, passage)?.start ?? null;
}

/** The passage a comment row sits on, with its field, or null when it has none or its field is not declared. */
export function readPassage(row: CommentRow, fields: readonly PassageField[], columns: PassageColumns = PASSAGE_COLUMNS): PassageAnchor | null {
  const quote = commentText(row, columns.quote);
  if (!squeeze(quote)) return null;
  const field = fields.find(item => Object.entries(passageFieldValues(item, columns))
    .every(([column, value]) => commentText(row, column) === value));
  if (!field) return null;
  return { field: field.key, quote, prefix: commentText(row, columns.prefix), suffix: commentText(row, columns.suffix) };
}

/** The properties a new comment on `passage` writes besides its body, author and status. */
export function passageProperties(passage: PassageAnchor, field: PassageField, columns: PassageColumns = PASSAGE_COLUMNS): Record<string, unknown> {
  return {
    ...passageFieldValues(field, columns),
    [columns.quote]: passage.quote,
    [columns.prefix]: passage.prefix || null,
    [columns.suffix]: passage.suffix || null,
  };
}
