/** Visibility across light and Shadow DOM, without relying on layout (virtual rows may have no rect). */
export function isInteractionElementVisible(element: HTMLElement | null): boolean {
  if (!element?.isConnected) return false;
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    const root: Node = current.getRootNode();
    current = current.parentElement ?? ('host' in root ? (root as ShadowRoot).host : null);
  }
  return true;
}
