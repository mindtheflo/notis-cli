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

/** The way the cursor last moved through a list. A removal continues that way (iOS Photos). */
export type TravelDirection = 'next' | 'previous';

/** The way a move from `from` to `to` went in `ids`; null when either is not in the list or nothing moved. */
export function travelBetween(ids: readonly string[], from: string | null | undefined,
  to: string | null | undefined): TravelDirection | null {
  if (from == null || to == null || from === to) return null;
  const a = ids.indexOf(from);
  const b = ids.indexOf(to);
  if (a === -1 || b === -1) return null;
  return b > a ? 'next' : 'previous';
}

/**
 * The id that takes `gone`'s place after it left `previous` (`now` holds the ids still listed): the nearest one still
 * there in the travel direction, else the nearest the other way. Null when none is left.
 */
export function continuationOf(previous: readonly string[], now: readonly string[] | ReadonlySet<string>,
  gone: string, direction: TravelDirection = 'next'): string | null {
  const present = now instanceof Set ? now : new Set(now as readonly string[]);
  const index = previous.indexOf(gone);
  if (index === -1) return null;
  const scan = (delta: number) => {
    for (let i = index + delta; i >= 0 && i < previous.length; i += delta) if (present.has(previous[i]!)) return previous[i]!;
    return null;
  };
  const first = direction === 'next' ? 1 : -1;
  return scan(first) ?? scan(-first);
}
