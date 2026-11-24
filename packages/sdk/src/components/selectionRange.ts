// Node and NodeFilter constants, without their globals (absent from some test and frame realms).
const TEXT_NODE = 3;
const SHOW_TEXT = 0x4;
// Text nobody reads as selected words: code, styles and the selection bar's own labels.
const UNREAD = 'script,style,noscript,template,[data-notis-selection-ui]';

function isText(node: Node): node is Text {
  return node.nodeType === TEXT_NODE;
}

function blankBefore(text: string, end: number): number {
  let index = end;
  while (index > 0 && /\s/.test(text[index - 1]!)) index -= 1;
  return index;
}

function blankAfter(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  return index;
}

/**
 * A copy of `range` reduced to its selected words. Selecting a whole sentence or paragraph by clicking ends the
 * browser's range at the start of the next block (Chrome, Safari) or starts it before the block (Firefox), which may
 * lie outside the surface or be the selection bar itself: the words are the same, so the surface reads them and its
 * bar stays. Returns `range` itself when both its ends already sit on selected words.
 */
export function trimRange(range: Range): Range {
  const { startContainer, startOffset, endContainer, endOffset, commonAncestorContainer } = range;
  const startsOnWords = isText(startContainer) && startContainer.data.slice(startOffset,
    startContainer === endContainer ? endOffset : undefined).trim();
  const endsOnWords = isText(endContainer) && endContainer.data.slice(
    endContainer === startContainer ? startOffset : 0, endOffset).trim();
  if ((startsOnWords && endsOnWords) || isText(commonAncestorContainer)) return range;
  const document = commonAncestorContainer.ownerDocument;
  if (!document) return range;
  const walker = document.createTreeWalker(commonAncestorContainer, SHOW_TEXT);
  // Start at the range's start, not at the top of a container that may hold the whole page.
  let node: Node | null = null;
  const child = isText(startContainer) ? startContainer : startContainer.childNodes[startOffset];
  if (child && isText(child)) node = child;
  else {
    walker.currentNode = child ?? commonAncestorContainer;
    node = walker.nextNode();
  }
  let first: { node: Text; offset: number } | null = null;
  let last: { node: Text; offset: number } | null = null;
  for (; node; walker.currentNode = node, node = walker.nextNode()) {
    if (range.comparePoint(node, 0) > 0) break;
    if (!isText(node) || !range.intersectsNode(node) || node.parentElement?.closest(UNREAD)) continue;
    const from = node === startContainer ? startOffset : 0;
    const to = node === endContainer ? endOffset : node.data.length;
    const words = node.data.slice(from, to);
    if (!words.trim()) continue;
    if (!first) first = { node, offset: blankAfter(node.data, from) };
    last = { node, offset: blankBefore(node.data, to) };
    if (node === endContainer) break;
  }
  if (!first || !last) return range;
  const trimmed = range.cloneRange();
  if (!startsOnWords) trimmed.setStart(first.node, first.offset);
  if (!endsOnWords) trimmed.setEnd(last.node, last.offset);
  return trimmed;
}
