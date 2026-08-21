/**
 * money.js: currency, rounding and formatting.
 *
 * Amounts are held in MAJOR units as numbers, but every arithmetic result is
 * pushed back through r2() so binary-float drift never accumulates across a
 * ledger. Comparisons use a cent-level epsilon rather than ===.
 */

export const CURRENCIES = [
  { code: 'USD', symbol: '$',   name: 'US Dollar' },
  { code: 'EUR', symbol: '€',   name: 'Euro' },
  { code: 'GBP', symbol: '£',   name: 'British Pound' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling' },
  { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling' },
  { code: 'NGN', symbol: '₦',   name: 'Nigerian Naira' },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
  { code: 'ZAR', symbol: 'R',   name: 'South African Rand' },
  { code: 'INR', symbol: '₹',   name: 'Indian Rupee' },
  { code: 'PHP', symbol: '₱',   name: 'Philippine Peso' },
  { code: 'BRL', symbol: 'R$',  name: 'Brazilian Real' },
  { code: 'CAD', symbol: 'C$',  name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$',  name: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥',   name: 'Japanese Yen' },
];

/** Currencies conventionally written without decimal places. */
const ZERO_DECIMAL = new Set(['JPY', 'UGX', 'TZS']);

/** Round to 2 decimal places, correcting float representation error. */
export function r2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const add = (...xs) => r2(xs.reduce((a, b) => a + num(b), 0));
export const sub = (a, b) => r2(num(a) - num(b));
export const mul = (a, f) => r2(num(a) * num(f));
export const div = (a, d) => (num(d) === 0 ? 0 : r2(num(a) / num(d)));

/** Coerce anything user-typed into a finite number. */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Cent-level equality: never compare currency with ===. */
export const eq = (a, b) => Math.abs(num(a) - num(b)) < 0.005;
export const isZero = (a) => Math.abs(num(a)) < 0.005;

export function symbolOf(code) {
  return (CURRENCIES.find((c) => c.code === code) || { symbol: '$' }).symbol;
}

/**
 * Format an amount for display.
 * @param {number} amount
 * @param {string} code   ISO currency code
 * @param {{compact?:boolean, sign?:boolean, decimals?:number}} [opts]
 */
export function fmt(amount, code = 'USD', opts = {}) {
  const n = num(amount);
  const zeroDec = ZERO_DECIMAL.has(code);
  const decimals = opts.decimals ?? (zeroDec ? 0 : Math.abs(n) >= 1000 ? 0 : 2);
  const sym = symbolOf(code);

  if (opts.compact && Math.abs(n) >= 1_000_000) {
    return `${n < 0 ? '-' : opts.sign ? '+' : ''}${sym}${abbr(Math.abs(n))}`;
  }

  const body = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const prefix = n < 0 ? '-' : opts.sign && n > 0 ? '+' : '';
  return `${prefix}${sym}${body}`;
}

function abbr(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

/** Percentage string. pct(0.184) -> "18%" */
export function pct(fraction, decimals = 0) {
  const n = num(fraction) * 100;
  return `${n.toFixed(decimals)}%`;
}

/** Safe ratio that returns 0 instead of NaN/Infinity. */
export const ratio = (a, b) => (num(b) === 0 ? 0 : num(a) / num(b));

/** Clamp to a range. */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, num(n)));

/**
 * Convert a nominal future amount into today's purchasing power.
 * @param {number} amount   nominal amount
 * @param {number} annualInflation e.g. 0.07
 * @param {number} months   months into the future
 */
export function realValue(amount, annualInflation, months) {
  const monthly = Math.pow(1 + num(annualInflation), 1 / 12) - 1;
  return r2(num(amount) / Math.pow(1 + monthly, Math.max(0, months)));
}

/** Monthly-equivalent of a recurring amount on a given cycle. */
export function perMonth(amount, cycle) {
  const a = num(amount);
  switch (cycle) {
    case 'weekly':    return r2((a * 52) / 12);
    case 'fortnight': return r2((a * 26) / 12);
    case 'monthly':   return r2(a);
    case 'quarterly': return r2(a / 3);
    case 'annual':    return r2(a / 12);
    default:          return r2(a);
  }
}

/** Annual-equivalent of a recurring amount on a given cycle. */
export const perYear = (amount, cycle) => r2(perMonth(amount, cycle) * 12);
