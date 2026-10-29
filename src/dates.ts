/**
 * Date helpers. All dates are calendar dates in ISO form (YYYY-MM-DD) and are
 * compared in UTC so results do not depend on the machine's time zone.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const ms = toUtcMs(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Today's date in UTC, or the value of EOL_CHECK_TODAY when it is set to a valid date. */
export function todayIso(env: NodeJS.ProcessEnv = process.env): string {
  const pinned = env.EOL_CHECK_TODAY;
  if (pinned && isIsoDate(pinned)) return pinned;
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** "10 November 2026" */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "1 day", "13 days", "1,762 days" */
export function formatDays(days: number): string {
  const n = Math.abs(days);
  return `${n.toLocaleString('en-GB')} ${n === 1 ? 'day' : 'days'}`;
}
