/**
 * analytics.js: derived truth.
 *
 * Everything the UI shows is computed here from the raw ledger. No derived
 * value is ever stored, so there is no possibility of the dashboard and the
 * data disagreeing: the failure mode that makes spreadsheets untrustworthy.
 */

import { add, sub, r2, num, div, ratio, clamp, perMonth, perYear, realValue } from '../core/money.js';
import { monthKey, lastMonths, shiftMonth, daysInMonth, monthProgress, daysUntil, advanceCycle } from '../core/dates.js';
import { CATEGORIES, catTier, isEssential } from '../data/categories.js';

// --- slicing --------------------------------------------------------------

export const inMonth = (rows, key) => rows.filter((r) => (r.date || '').startsWith(key));

export const sumOf = (rows) => add(...rows.map((r) => num(r.amount)));

// --- income ---------------------------------------------------------------

export function incomeFor(s, key) { return sumOf(inMonth(s.income, key)); }

/**
 * Income volatility: the number nearly every budgeting product ignores.
 * Coefficient of variation over trailing months, expressed 0..100.
 *   < 15  steady      15-35 variable      35-60 lumpy      > 60 highly irregular
 */
export function incomeVolatility(s, months = 6) {
  const keys = lastMonths(months);
  const vals = keys.map((k) => incomeFor(s, k)).filter((v, i, arr) => !(i === arr.length - 1 && v === 0));
  const real = vals.filter((v) => v > 0);
  if (real.length < 2) return { score: 0, band: 'unknown', mean: real[0] || 0, months: real.length };

  const mean = real.reduce((a, b) => a + b, 0) / real.length;
  const variance = real.reduce((a, b) => a + (b - mean) ** 2, 0) / real.length;
  const cv = mean === 0 ? 0 : Math.sqrt(variance) / mean;
  const score = Math.round(clamp(cv * 100, 0, 100));

  const band = score < 15 ? 'steady' : score < 35 ? 'variable' : score < 60 ? 'lumpy' : 'irregular';
  return { score, band, mean: r2(mean), months: real.length, min: Math.min(...real), max: Math.max(...real) };
}

/**
 * Safe monthly draw for an irregular earner.
 *
 * A household with lumpy income should not spend to the average: the average
 * is exceeded only half the time. We discount toward the lower end in
 * proportion to measured volatility, which is the smoothing a monthly-salary
 * budget template structurally cannot express.
 */
export function safeDraw(s, months = 6) {
  const v = incomeVolatility(s, months);
  if (!v.months) return { amount: 0, basis: 'no history', volatility: v };
  if (v.band === 'steady') return { amount: v.mean, basis: 'steady income, use the average', volatility: v };

  const keys = lastMonths(months).map((k) => incomeFor(s, k)).filter((x) => x > 0).sort((a, b) => a - b);
  const p35 = keys[Math.floor(keys.length * 0.35)] ?? v.mean;
  const discount = 1 - clamp(v.score / 100, 0, 0.35) * 0.5;  // up to 17.5% haircut
  const amount = r2(Math.min(v.mean, p35) * discount);

  return {
    amount,
    basis: `smoothed from ${v.months} months, discounted ${Math.round((1 - discount) * 100)}% for volatility`,
    volatility: v,
  };
}

// --- spending -------------------------------------------------------------

export function spendFor(s, key) { return sumOf(inMonth(s.transactions, key)); }

/** Spend split by tier: what is truly non-negotiable vs what is compressible. */
export function spendByTier(s, key) {
  const rows = inMonth(s.transactions, key);
  const out = { essential: 0, lifestyle: 0, financial: 0 };
  for (const r of rows) out[catTier(r.category)] = add(out[catTier(r.category)], r.amount);
  return out;
}

export function spendByCategory(s, key) {
  const rows = inMonth(s.transactions, key);
  const map = new Map();
  for (const r of rows) map.set(r.category, add(map.get(r.category) || 0, r.amount));
  const total = sumOf(rows);
  return [...map.entries()]
    .map(([id, amount]) => {
      const cat = CATEGORIES.find((c) => c.id === id) || CATEGORIES.at(-1);
      return { id, amount, share: ratio(amount, total), name: cat.name, color: cat.color, icon: cat.icon, tier: cat.tier };
    })
    .sort((a, b) => b.amount - a.amount);
}

export function spendByMethod(s, key) {
  const rows = inMonth(s.transactions, key);
  const map = new Map();
  for (const r of rows) map.set(r.method || 'cash', add(map.get(r.method || 'cash') || 0, r.amount));
  return [...map.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount);
}

/**
 * Essential monthly burn: the denominator of runway.
 * Uses a trailing median so one heavy month (a school-fee cycle) does not
 * flatter or wreck the figure.
 */
export function essentialBurn(s, months = 3) {
  const keys = lastMonths(months + 1).slice(0, months);   // exclude partial current month
  const vals = keys.map((k) => spendByTier(s, k).essential).filter((v) => v > 0);
  if (!vals.length) {
    const now = spendByTier(s, monthKey()).essential;
    const p = monthProgress();
    return p > 0.2 ? r2(now / p) : now;   // annualise a partial month once it is meaningful
  }
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;

  // Recurring subscriptions are a committed obligation even if not yet charged.
  return r2(median);
}

/** Total monthly burn including lifestyle, used for "comfortable" runway. */
export function totalBurn(s, months = 3) {
  const keys = lastMonths(months + 1).slice(0, months);
  const vals = keys.map((k) => spendFor(s, k)).filter((v) => v > 0);
  if (!vals.length) {
    const p = monthProgress();
    const now = spendFor(s, monthKey());
    return p > 0.2 ? r2(now / p) : now;
  }
  return div(add(...vals), vals.length);
}

// --- savings & runway -----------------------------------------------------

export const liquidSavings = (s) =>
  add(...s.savings.filter((x) => x.liquid !== false).map((x) => num(x.balance)));

export const totalSavings = (s) => add(...s.savings.map((x) => num(x.balance)));

/**
 * RUNWAY: the north-star metric.
 * How many days the household survives on liquid savings at essential burn
 * if every source of income stopped today.
 */
export function runway(s) {
  const liquid = liquidSavings(s);
  const burn = essentialBurn(s);
  const comfort = totalBurn(s);
  const dailyEssential = div(burn, 30.44);
  const dailyTotal = div(comfort, 30.44);

  const days = dailyEssential > 0 ? Math.floor(liquid / dailyEssential) : (liquid > 0 ? 999 : 0);
  const comfortDays = dailyTotal > 0 ? Math.floor(liquid / dailyTotal) : (liquid > 0 ? 999 : 0);

  const band =
    days >= 180 ? 'strong' : days >= 90 ? 'solid' : days >= 30 ? 'thin' : days > 0 ? 'fragile' : 'exposed';

  const label = {
    strong:  'Strong: six months or more of cover',
    solid:   'Solid: three months or more of cover',
    thin:    'Thin: one shock away from borrowing',
    fragile: 'Fragile: under a month of cover',
    exposed: 'No safety net: no savings to fall back on',
  }[band];

  return { days, comfortDays, months: r2(days / 30.44), liquid, burn, comfort, band, label,
           target90: r2(dailyEssential * 90), target180: r2(dailyEssential * 180) };
}

// --- cash flow ------------------------------------------------------------

export function monthSummary(s, key = monthKey()) {
  const income = incomeFor(s, key);
  const spend = spendFor(s, key);
  const tiers = spendByTier(s, key);
  const net = sub(income, spend);
  return {
    key, income, spend, net, tiers,
    savingsRate: ratio(net, income),
    essentialRatio: ratio(tiers.essential, income),
  };
}

/** Trailing series for sparklines and trend copy. */
export function cashflowSeries(s, months = 12) {
  return lastMonths(months).map((key) => {
    const m = monthSummary(s, key);
    return { key, income: m.income, spend: m.spend, net: m.net };
  });
}

/**
 * Forward projection. Uses safe draw for irregular earners, trailing average
 * otherwise, and carries the current liquid balance forward month by month.
 */
export function projectCashflow(s, months = 12) {
  const draw = s.profile.incomeType === 'irregular' ? safeDraw(s).amount : incomeVolatility(s).mean;
  const expectedIncome = draw || incomeFor(s, shiftMonth(monthKey(), -1));
  const burn = totalBurn(s);
  const subs = subscriptionLoad(s).monthly;
  const debtService = add(...s.debts.map((d) => num(d.minPayment)));

  let balance = liquidSavings(s);
  const out = [];
  for (let i = 1; i <= months; i++) {
    const key = shiftMonth(monthKey(), i);
    const outflow = add(burn, subs, debtService);
    const net = sub(expectedIncome, outflow);
    balance = add(balance, net);
    out.push({ key, income: expectedIncome, outflow, net, balance: r2(balance),
               real: realValue(balance, s.profile.inflation, i) });
  }
  return out;
}

// --- budgets --------------------------------------------------------------

/** Budget vs actual, with a pace flag that catches overspend mid-month. */
export function budgetStatus(s, key = monthKey()) {
  const limits = s.budgets[key] || {};
  const spent = Object.fromEntries(spendByCategory(s, key).map((c) => [c.id, c.amount]));
  const progress = monthProgress(key);

  const rows = Object.keys(limits).map((id) => {
    const limit = num(limits[id]);
    const used = num(spent[id] || 0);
    const share = ratio(used, limit);
    const expected = limit * progress;
    let state = 'ok';
    if (used > limit) state = 'over';
    else if (progress > 0.15 && used > expected * 1.15) state = 'pace';
    else if (share > 0.85) state = 'near';
    return { id, limit, used, left: sub(limit, used), share, state, expected: r2(expected) };
  }).sort((a, b) => b.share - a.share);

  // Spending in categories with no limit set at all: the invisible leak.
  const unbudgeted = spendByCategory(s, key).filter((c) => !(c.id in limits));

  return {
    rows,
    unbudgeted,
    totalLimit: add(...rows.map((r) => r.limit)),
    totalUsed: add(...rows.map((r) => r.used)),
    overCount: rows.filter((r) => r.state === 'over').length,
    paceCount: rows.filter((r) => r.state === 'pace').length,
  };
}

// --- subscriptions --------------------------------------------------------

export function subscriptionLoad(s) {
  const live = s.subscriptions.filter((x) => x.status !== 'cancelled');
  const monthly = add(...live.map((x) => perMonth(x.amount, x.cycle)));
  const yearly = add(...live.map((x) => perYear(x.amount, x.cycle)));

  const upcoming = live
    .map((x) => {
      const next = advanceCycle(x.nextCharge, x.cycle);
      return { ...x, nextCharge: next, inDays: daysUntil(next), monthlyEq: perMonth(x.amount, x.cycle),
               yearlyEq: perYear(x.amount, x.cycle) };
    })
    .sort((a, b) => (a.inDays ?? 999) - (b.inDays ?? 999));

  // Dormant = flagged unused, or an annual renewal the user has never marked used.
  const dormant = upcoming.filter((x) => x.status === 'unused');
  const leakage = add(...dormant.map((x) => x.yearlyEq));

  return { monthly, yearly, count: live.length, upcoming, dormant, leakage,
           next7: upcoming.filter((x) => x.inDays !== null && x.inDays <= 7 && x.inDays >= 0) };
}

// --- debt -----------------------------------------------------------------

export function debtSummary(s) {
  const debts = s.debts.filter((d) => num(d.balance) > 0);
  const total = add(...debts.map((d) => num(d.balance)));
  const minTotal = add(...debts.map((d) => num(d.minPayment)));
  const monthlyInterest = add(...debts.map((d) => (num(d.balance) * (num(d.apr) / 100)) / 12));
  const worst = [...debts].sort((a, b) => num(b.apr) - num(a.apr))[0] || null;
  const income = incomeVolatility(s).mean || incomeFor(s, monthKey());

  return {
    debts, total, minTotal, monthlyInterest: r2(monthlyInterest),
    dailyInterest: div(monthlyInterest, 30.44),
    worst,
    dti: ratio(minTotal, income),           // debt-service-to-income
    avgApr: debts.length ? r2(add(...debts.map((d) => num(d.apr) * num(d.balance))) / (total || 1)) : 0,
  };
}

// --- goals ----------------------------------------------------------------

/** Goal ETA bound to real projected surplus, not to wishful thinking. */
export function goalProjections(s) {
  const surplus = Math.max(0, monthSummary(s).net);
  const claimed = add(...s.goals.map((g) => num(g.monthly)));

  return s.goals.map((g) => {
    const remaining = Math.max(0, sub(g.target, g.saved));
    const monthly = num(g.monthly);
    const pace = monthly > 0 ? Math.ceil(remaining / monthly) : null;
    const eta = pace === null ? null : shiftMonth(monthKey(), pace);
    const deadlineGap = g.deadline && pace !== null
      ? Math.round((new Date(g.deadline) - new Date()) / 86_400_000) - pace * 30.44
      : null;
    const requiredForDeadline = g.deadline
      ? (() => {
          const monthsLeft = Math.max(1, Math.round((new Date(g.deadline) - new Date()) / (86_400_000 * 30.44)));
          return div(remaining, monthsLeft);
        })()
      : null;

    return {
      ...g, remaining, pace, eta, deadlineGap, requiredForDeadline,
      progress: clamp(ratio(num(g.saved), num(g.target)), 0, 1),
      onTrack: deadlineGap === null ? null : deadlineGap >= 0,
      realTarget: realValue(num(g.target), s.profile.inflation, pace || 0),
    };
  }).sort((a, b) => (num(b.priority) || 0) - (num(a.priority) || 0));
}

/** Are the goals collectively affordable out of actual surplus? */
export function goalFeasibility(s) {
  const claimed = add(...s.goals.map((g) => num(g.monthly)));
  const surplus = monthSummary(s).net;
  return { claimed, surplus, gap: sub(claimed, surplus), feasible: claimed <= surplus };
}

// --- net position ---------------------------------------------------------

export function netWorth(s) {
  const assets = totalSavings(s);
  const liabilities = add(...s.debts.map((d) => num(d.balance)));
  return { assets, liabilities, net: sub(assets, liabilities) };
}

/** One object with everything the dashboard needs, computed once per render. */
export function snapshot(s, key = monthKey()) {
  return {
    month: monthSummary(s, key),
    runway: runway(s),
    volatility: incomeVolatility(s),
    draw: safeDraw(s),
    budget: budgetStatus(s, key),
    subs: subscriptionLoad(s),
    debt: debtSummary(s),
    goals: goalProjections(s),
    feasibility: goalFeasibility(s),
    worth: netWorth(s),
    series: cashflowSeries(s, 12),
    categories: spendByCategory(s, key),
  };
}
