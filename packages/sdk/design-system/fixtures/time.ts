/** Dates relative to the book's fixed clock (2026-06-15T09:30:00Z). */
import { FIXED_NOW } from '../specimen';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant `days` days (and optional hours) from the fixed clock. */
export function fromNow(days: number, hours = 0): Date {
  return new Date(FIXED_NOW + days * DAY_MS + hours * 60 * 60 * 1000);
}

/** The ISO timestamp `days` days from the fixed clock. */
export function isoFromNow(days: number, hours = 0): string {
  return fromNow(days, hours).toISOString();
}

/** The ISO day (YYYY-MM-DD) `days` days from the fixed clock. */
export function dayFromNow(days: number): string {
  return isoFromNow(days).slice(0, 10);
}
