/** Inclusive calendar ranges; Monday starts a week. Matches the server's shown reader. */
export const VIEW_PERIODS = ['today', 'tomorrow', 'this_week', 'last_week', 'this_month', 'last_month'] as const;
export function isViewDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function isViewPeriod(value: string): boolean {
  if ((VIEW_PERIODS as readonly string[]).includes(value)) return true;
  const parts = value.split('/');
  return parts.length === 2 && parts.every(isViewDate) && parts[0] <= parts[1];
}
export function resolveViewPeriod(value: string, timeZone = 'UTC', now = new Date()): { start: string; end: string } {
  if (!isViewPeriod(value)) throw new Error('Invalid view period');
  if (value.includes('/')) { const [start, end] = value.split('/'); return { start, end }; }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  const start = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  if (value === 'tomorrow') start.setUTCDate(start.getUTCDate() + 1);
  if (value.endsWith('week')) start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7 - (value === 'last_week' ? 7 : 0));
  if (value.endsWith('month')) { start.setUTCDate(1); if (value === 'last_month') start.setUTCMonth(start.getUTCMonth() - 1); }
  const end = new Date(start);
  if (value.endsWith('week')) end.setUTCDate(end.getUTCDate() + 6);
  if (value.endsWith('month')) { end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0); }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
