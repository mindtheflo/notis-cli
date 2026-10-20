/**
 * Room for the labels of a horizontal bar chart: the categories before the bars, on at most two lines, and the values
 * after them. Pure but for `textWidth`: the caller passes how wide a line is, so the browser measures and the tests count
 * characters. Not exported from the toolkit.
 */

/** Width in px of one line of label text. */
export type Measure = (line: string) => number;

/** Ends a cut category label. */
export const ELLIPSIS = '…';

/** A category label sits past the axis' 8px tick margin and recharts' 6px tick size, with 2px to spare: the axis width
 * minus this is the label's room. */
export const TICK_INSET = 8 + 6 + 2;

/** recharts sets a label placed after a bar 5px after its end. */
export const LABEL_OFFSET = 5;

const AXIS_MIN = 112;
const AXIS_MAX = 196;

/** The words of a label, split at breaking spaces only: a no-break space ("60,0 %", "1 234") keeps its words together. */
function labelWords(text: string): string[] {
  return text.split(/[ \t\n\r\f\v]+/).filter(Boolean);
}

/** At most two lines of a category label, each one passing `fits`; a cut line ends in an ellipsis. */
export function wrapLabel(text: string, fits: (line: string) => boolean): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of labelWords(text)) {
    if (!line) line = word;
    else if (fits(`${line} ${word}`)) line = `${line} ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  const clip = (l: string) => {
    if (fits(l)) return l;
    let cut = l;
    while (cut && !fits(`${cut}${ELLIPSIS}`)) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}${ELLIPSIS}`;
  };
  // A third line joins the second, which then no longer fits and ends in an ellipsis.
  return (lines.length <= 2 ? lines : [lines[0]!, lines.slice(1).join(' ')]).map(clip);
}

/** The narrowest room in which `text` shows whole on at most two lines (`wrapLabel` fills the first line first). */
function twoLineWidth(text: string, measure: Measure): number {
  const words = labelWords(text);
  if (words.length <= 1) return measure(words[0] ?? '');
  let best = Number.POSITIVE_INFINITY;
  for (let k = 1; k < words.length; k++) {
    best = Math.min(best, Math.max(measure(words.slice(0, k).join(' ')), measure(words.slice(k).join(' '))));
  }
  return best;
}

/**
 * The category axis width of a chart `chartWidth` wide: room for every label whole on two lines, from 112px up to 196px
 * and never more than 40% of the chart. A label that still does not fit ends in an ellipsis.
 */
export function axisWidth(categories: readonly string[], chartWidth: number, measure: Measure): number {
  const needed = categories.reduce((most, c) => Math.max(most, twoLineWidth(c, measure)), 0);
  const cap = Math.max(AXIS_MIN, Math.min(AXIS_MAX, Math.floor(chartWidth * 0.4)));
  return Math.min(cap, Math.max(AXIS_MIN, Math.ceil(needed) + TICK_INSET));
}

/** The right margin: room for the widest value label after the longest bar, which ends at the plot edge. */
export function valueMargin(labels: readonly string[], measure: Measure): number {
  const widest = labels.reduce((most, l) => Math.max(most, measure(l)), 0);
  return Math.max(24, Math.ceil(widest) + LABEL_OFFSET + 4);
}

/** Roughly the width of a 12px label character, where no canvas can measure (tests, server render). */
const LABEL_CHAR = 7;
let canvas: CanvasRenderingContext2D | null | undefined;

/** Width in px of a 12px chart label in `family`, measured on a canvas (7px a character without one). */
export function textWidth(text: string, family: string): number {
  if (canvas === undefined) {
    try {
      // jsdom (the tests) has no canvas and warns when asked for one.
      const bare = typeof document === 'undefined' || /jsdom/.test(globalThis.navigator?.userAgent ?? '');
      canvas = bare ? null : document.createElement('canvas').getContext('2d');
    } catch {
      canvas = null;
    }
  }
  if (!canvas) return text.length * LABEL_CHAR;
  canvas.font = `12px ${family}`;
  return canvas.measureText(text).width;
}
