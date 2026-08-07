export type Mode = 'integer' | 'decimal' | 'dice';

export interface Roll {
  value: number;
  mode: Mode;
  min: number;
  max: number;
  at: string;
}

/** Standard polyhedral dice offered in dice mode. */
export const DICE_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type DiceSides = (typeof DICE_SIDES)[number];
export const DEFAULT_DICE_SIDES: DiceSides = 6;

/** Largest span we accept for an integer draw (stays inside Number.MAX_SAFE_INTEGER). */
export const MAX_INTEGER_SPAN = 2 ** 32;

const UINT32_RANGE = 0x1_0000_0000; // 2 ** 32

/** Convert an editable numeric draft without treating an empty field as zero. */
export function parseBoundDraft(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function randomUint32(): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] ?? 0;
}

/**
 * Uniform float in [0, 1) — note the exclusive upper bound. Dividing by 2**32
 * (not 2**32 - 1) is what keeps 1.0 unreachable, so callers can safely scale
 * the result without ever landing one past the top of their range.
 */
export function randomUnit(): number {
  return randomUint32() / UINT32_RANGE;
}

/**
 * Uniform integer in [lo, hi], both inclusive.
 *
 * `Math.floor(randomUnit() * span)` alone is biased whenever `span` does not
 * divide 2**32 evenly: the first `2**32 % span` buckets would each get one
 * extra source value. We remove that by rejecting draws that fall in the
 * ragged tail of the uint32 space, which makes every bucket exactly the same
 * size. The expected number of retries is below 1 for any span we allow.
 */
export function randomIntInclusive(lo: number, hi: number): number {
  const low = Math.ceil(lo);
  const high = Math.floor(hi);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) {
    throw new RangeError(`Invalid integer range [${lo}, ${hi}]`);
  }
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high)) {
    throw new RangeError(`Integer bounds must be safe integers: [${lo}, ${hi}]`);
  }

  const span = high - low + 1;
  if (span <= 1) return low;
  if (span > MAX_INTEGER_SPAN) {
    throw new RangeError(`Integer range too wide: ${span} values`);
  }
  if (span === UINT32_RANGE) {
    return low + randomUint32();
  }

  // Values at or above `limit` fall outside the last whole bucket; redraw them.
  const limit = UINT32_RANGE - (UINT32_RANGE % span);
  let draw = randomUint32();
  while (draw >= limit) {
    draw = randomUint32();
  }
  return low + (draw % span);
}

/** Uniform float in [lo, hi) — inclusive low, exclusive high. */
export function randomFloat(lo: number, hi: number): number {
  if (hi === lo) return lo;
  const span = hi - lo;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(span) || span < 0) {
    throw new RangeError(`Invalid decimal range [${lo}, ${hi}]`);
  }
  return lo + randomUnit() * span;
}

export type BoundsIssue =
  | { code: 'min-not-a-number'; message: string }
  | { code: 'max-not-a-number'; message: string }
  | { code: 'min-not-finite'; message: string }
  | { code: 'max-not-finite'; message: string }
  | { code: 'min-not-below-max'; message: string }
  | { code: 'empty-integer-range'; message: string }
  | { code: 'range-too-wide'; message: string };

export interface BoundsCheck {
  ok: boolean;
  issue: BoundsIssue | null;
  /** Bounds actually used by `roll`, after integer snapping. Null when invalid. */
  min: number | null;
  max: number | null;
}

/**
 * Validates a min/max pair for a given mode and reports the bounds that would
 * actually be used. Integer and dice modes snap inward (ceil the low end, floor
 * the high end) so a range like [1.2, 4.8] draws from {2, 3, 4} rather than
 * producing fractional "integers".
 */
export function checkBounds(min: number, max: number, mode: Mode): BoundsCheck {
  const invalid = (issue: BoundsIssue): BoundsCheck => ({ ok: false, issue, min: null, max: null });

  if (Number.isNaN(min)) {
    return invalid({ code: 'min-not-a-number', message: 'Minimum must be a number.' });
  }
  if (Number.isNaN(max)) {
    return invalid({ code: 'max-not-a-number', message: 'Maximum must be a number.' });
  }
  if (!Number.isFinite(min)) {
    return invalid({ code: 'min-not-finite', message: 'Minimum must be finite.' });
  }
  if (!Number.isFinite(max)) {
    return invalid({ code: 'max-not-finite', message: 'Maximum must be finite.' });
  }
  if (min >= max) {
    return invalid({
      code: 'min-not-below-max',
      message: 'Minimum must be strictly lower than maximum.',
    });
  }

  if (mode === 'decimal') {
    if (!Number.isFinite(max - min)) {
      return invalid({
        code: 'range-too-wide',
        message: 'Range is too wide for a decimal draw.',
      });
    }
    return { ok: true, issue: null, min, max };
  }

  const low = Math.ceil(min);
  const high = Math.floor(max);
  if (high < low) {
    return invalid({
      code: 'empty-integer-range',
      message: `No whole number sits between ${min} and ${max}.`,
    });
  }
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high)) {
    return invalid({
      code: 'range-too-wide',
      message: 'Whole-number bounds must be safe integers.',
    });
  }
  if (high - low + 1 > MAX_INTEGER_SPAN) {
    return invalid({
      code: 'range-too-wide',
      message: 'Range is too wide for a whole-number draw.',
    });
  }
  return { ok: true, issue: null, min: low, max: high };
}

/**
 * Draws one value.
 *
 * - `integer` / `dice`: uniform over the whole numbers in [min, max], both ends
 *   inclusive and equally likely.
 * - `decimal`: uniform over the continuous interval [min, max) — the low bound
 *   is reachable, the high bound is not.
 *
 * Throws a `RangeError` when the bounds are unusable; call `checkBounds` first
 * to surface the reason to the user.
 */
export function roll(min: number, max: number, mode: Mode): Roll {
  const check = checkBounds(min, max, mode);
  if (!check.ok || check.min == null || check.max == null) {
    throw new RangeError(check.issue?.message ?? 'Invalid range.');
  }

  const value =
    mode === 'decimal'
      ? randomFloat(check.min, check.max)
      : randomIntInclusive(check.min, check.max);

  return {
    value,
    mode,
    min: check.min,
    max: check.max,
    at: new Date().toISOString(),
  };
}

/** Human label for a mode, matching the `Mode` select options in the database. */
export function modeLabel(mode: Mode): string {
  if (mode === 'decimal') return 'Decimal';
  if (mode === 'dice') return 'Dice';
  return 'Integer';
}
