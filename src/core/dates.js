/**
 * dates.js: month keys and calendar helpers.
 * Every month in the app is addressed by a "YYYY-MM" key so the ledger can be
 * sliced, rolled over and trended without timezone drift.
 */

export const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM" for a Date (or now). */
export function monthKey(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
}

/** "YYYY-MM-DD" for a Date (or now), local time. */
export function dayKey(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Month key shifted by n months (n may be negative). */
export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}

/** The n most recent month keys ending at `end`, oldest first. */
export function lastMonths(n, end = monthKey()) {
  return Array.from({ length: n }, (_, i) => shiftMonth(end, -(n - 1 - i)));
}

/** Whole months between two month keys (b - a). */
export function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Human month label, e.g. "Aug 2026". */
export function monthLabel(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString(undefined, { month: long ? 'long' : 'short', year: 'numeric' });
}

/** Human date label, e.g. "21 Aug". */
export function dayLabel(iso, withYear = false) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** Whole days from today until an ISO date. Negative means overdue. */
export function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - t0) / 86_400_000);
}

/** Add n days to an ISO date string, returning "YYYY-MM-DD". */
export function addDays(iso, n) {
  const d = new Date(iso || Date.now());
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Add n months to an ISO date string, returning "YYYY-MM-DD". */
export function addMonths(iso, n) {
  const d = new Date(iso || Date.now());
  d.setMonth(d.getMonth() + n);
  return dayKey(d);
}

/**
 * Roll a recurring charge date forward until it is in the future.
 * Subscription "next charge" dates go stale the moment they pass.
 */
export function advanceCycle(iso, cycle) {
  let d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) d = new Date();
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let guard = 0;
  while (d < now && guard++ < 600) {
    switch (cycle) {
      case 'weekly':    d.setDate(d.getDate() + 7); break;
      case 'fortnight': d.setDate(d.getDate() + 14); break;
      case 'quarterly': d.setMonth(d.getMonth() + 3); break;
      case 'annual':    d.setFullYear(d.getFullYear() + 1); break;
      default:          d.setMonth(d.getMonth() + 1);
    }
  }
  return dayKey(d);
}

/** Fraction of the current month already elapsed, 0..1. */
export function monthProgress(key = monthKey()) {
  if (key !== monthKey()) return 1;
  const now = new Date();
  return now.getDate() / daysInMonth(key);
}
