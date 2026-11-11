/** A fresh id for a quote or a comment taken from the selection. */
export function newSelectionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
