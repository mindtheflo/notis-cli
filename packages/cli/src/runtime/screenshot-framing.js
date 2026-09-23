/** Runs only in the capture harness, never in an installed app. */
export function measureScreenshotContent() {
  const root = document.getElementById('root');
  if (!root) return null;
  const viewportWidth = document.documentElement.clientWidth;
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden';
  };

  // Follow layout wrappers only while they contain the entire visible app.
  // Never select one column, card, or control out of a multi-pane layout.
  let node = root;
  let content = null;
  while (node) {
    const hasOwnText = Array.from(node.childNodes).some(
      (child) => child.nodeType === 3 && child.textContent.trim(),
    );
    const children = Array.from(node.children).filter(visible);
    if (hasOwnText || children.length !== 1) break;
    node = children[0];
    const rect = node.getBoundingClientRect();
    if (['DIV', 'MAIN', 'SECTION', 'ARTICLE', 'FORM'].includes(node.tagName)
      && rect.width >= 320 && rect.height >= 160
      && rect.width < viewportWidth * 0.9) {
      content = node;
    }
  }
  if (!content) return null;
  content.setAttribute('data-notis-screenshot-content', '');
  const rect = content.getBoundingClientRect();
  return {
    selector: '[data-notis-screenshot-content]',
    width: rect.width,
    height: rect.height,
    viewport_width: viewportWidth,
  };
}

export const MEASURE_SCREENSHOT_CONTENT_SCRIPT = `(${measureScreenshotContent.toString()})()`;

/** Keep long pages readable, and rasterize bounded views at their final width. */
export function contentCapturePlan(bounds, viewport, outputWidth, outputHeight) {
  const aspect = outputWidth / outputHeight;
  if (bounds.width / bounds.height < aspect * 0.75) {
    const width = Math.max(768, Math.ceil((bounds.width + 32) / 8) * 8);
    return { focus: false, width, height: Math.round(width / aspect), scale: outputWidth / width };
  }
  return {
    focus: true,
    width: viewport.width,
    height: viewport.height,
    scale: Math.min(4, outputWidth / bounds.width),
  };
}

export function safeViewportHeight(rectangles, height) {
  const crossing = rectangles.filter((rect) => rect.top < height && rect.bottom > height
    && rect.top >= height * 0.85);
  return crossing.length
    ? Math.max(Math.ceil(height * 0.85), Math.floor(Math.min(...crossing.map((rect) => rect.top)) - 8))
    : height;
}

// End a long-page viewport in whitespace rather than through a text line or
// control. Only geometry leaves the browser; no page text is returned.
export const SAFE_VIEWPORT_HEIGHT_SCRIPT = `(() => {
  const root = document.getElementById('root');
  if (!root) return innerHeight;
  const rects = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim() || getComputedStyle(node.parentElement).visibility !== 'visible') continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const rect of range.getClientRects()) rects.push({ top: rect.top, bottom: rect.bottom });
  }
  for (const control of root.querySelectorAll('button,input,select,textarea')) {
    const rect = control.getBoundingClientRect();
    rects.push({ top: rect.top, bottom: rect.bottom });
  }
  return (${safeViewportHeight.toString()})(rects, innerHeight);
})()`;
