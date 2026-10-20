// Token extraction of the design system book (design review spec, section 2.3).
//
// `portalTokens(text, file).text` is the JS twin of `design_review.portal_tokens(text)`: both give exactly
// `fixtures/tokens-sample.expected.txt` for `fixtures/tokens-sample.css`. Both read one file at a time: the book
// merges `PORTAL_TOKEN_FILES`, and `design_review.py` keeps the same list (`PORTAL_TOKEN_FILES`), one `#tokens`
// digest entry per file. `toolkitTokens(text, file)` lists the
// toolkit's `--nui-*` custom properties for the book's Tokens section.

/**
 * The Portal token files, in the order the Portal stylesheet reads them: `theme-tokens.css` (`:root` and `.dark`
 * inside `@layer base`, imported at the top of `globals.css`), then `globals.css` (`@theme`).
 */
export const PORTAL_TOKEN_FILES = ['portal/src/app/theme-tokens.css', 'portal/src/app/globals.css'];

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/**
 * Every custom property declaration in source order: `{stack, name, value, line}`. One pass that honours quotes
 * and drops comments; `stack` holds the block preludes (trimmed, whitespace collapsed), outermost first.
 */
export function scanCustomProperties(text) {
  const lineOf = lineIndex(text);
  const out = [];
  const stack = [];
  let buffer = '';
  let start = -1;
  let quote = null;
  const append = (ch, offset) => {
    if (start < 0 && !/\s/.test(ch)) start = offset;
    buffer += ch;
  };
  const reset = () => {
    buffer = '';
    start = -1;
  };
  const declaration = () => {
    const trimmed = buffer.trim();
    if (!trimmed.startsWith('--') || !trimmed.includes(':')) return;
    const colon = trimmed.indexOf(':');
    out.push({ stack: [...stack], name: trimmed.slice(0, colon).trim(), value: collapse(trimmed.slice(colon + 1)), line: lineOf(start) });
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      append(ch, i);
      if (ch === '\\' && i + 1 < text.length) {
        append(text[i + 1], i + 1);
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      append(ch, i);
      i += 1;
      continue;
    }
    if (ch === '{') {
      stack.push(collapse(buffer));
      reset();
    } else if (ch === ';') {
      declaration();
      reset();
    } else if (ch === '}') {
      declaration();
      stack.pop();
      reset();
    } else {
      append(ch, i);
    }
    i += 1;
  }
  return out;
}

function keptAsPortalToken(stack) {
  const innermost = stack[stack.length - 1];
  return innermost === ':root' || innermost === '.dark' || stack.some((prelude) => prelude.startsWith('@theme'));
}

/**
 * The Portal tokens of one Portal token file's text: the declarations of `:root` and `.dark` blocks (the innermost
 * prelude exactly one of them) and of anything inside `@theme`. `text` is the twin output, one
 * `chain + "\t" + name + ": " + value + "\n"` per token; `tokens` adds each file (null when not given) and line.
 */
export function portalTokens(text, file = null) {
  const tokens = scanCustomProperties(text)
    .filter((item) => keptAsPortalToken(item.stack))
    .map((item) => ({ chain: item.stack.join(' > '), name: item.name, value: item.value, file, line: item.line }));
  return { text: tokens.map((token) => `${token.chain}\t${token.name}: ${token.value}\n`).join(''), tokens };
}

/** The toolkit's `--nui-*` declarations, each with its block chain, file and line. */
export function toolkitTokens(text, file) {
  return scanCustomProperties(text)
    .filter((item) => item.name.startsWith('--nui-'))
    .map((item) => ({ chain: item.stack.join(' > '), name: item.name, value: item.value, file, line: item.line }));
}
