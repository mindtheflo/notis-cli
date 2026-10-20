export interface StepOptions {
  /** Wrap from the last item to the first (and back). Default true. */
  wrap?: boolean;
  /** The key is held (`event.repeat`): never wrap, stop at the edge. */
  repeat?: boolean;
}

/**
 * Next cursor id for J/K stepping. Wraps only on a fresh press, so holding J stops at the last row instead of
 * spinning back to the top. No cursor: J lands on the first item, K on the last.
 */
export function stepCursor(ids: readonly string[], cursor: string | null | undefined, delta: number,
  options: StepOptions = {}): string | null {
  if (!ids.length) return null;
  const { wrap = true, repeat = false } = options;
  const index = cursor == null ? -1 : ids.indexOf(cursor);
  if (index === -1) return delta >= 0 ? ids[0]! : ids[ids.length - 1]!;
  let next = index + delta;
  if (next < 0 || next >= ids.length) {
    if (wrap && !repeat) next = ((next % ids.length) + ids.length) % ids.length;
    else next = Math.max(0, Math.min(ids.length - 1, next));
  }
  return ids[next]!;
}
