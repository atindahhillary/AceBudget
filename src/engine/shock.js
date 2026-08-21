/**
 * shock.js: resilience simulator (Gap G10: no resilience metric).
 *
 * Runway answers "how long do we last at today's burn." Shock testing answers
 * the harder question households actually face: "what happens if income
 * drops for a few months, or a one-off cost lands on top of that." It reuses
 * the same essential-burn and liquid-savings definitions as runway() so the
 * two numbers stay consistent with each other.
 */

import { liquidSavings, essentialBurn, incomeVolatility, incomeFor } from './analytics.js';
import { monthKey, shiftMonth } from '../core/dates.js';
import { add, sub, r2, clamp } from '../core/money.js';

/**
 * Project liquid savings forward under an income-drop and/or one-off-cost
 * stress scenario.
 * @param {object} state
 * @param {{incomeDropPct?:number, months?:number, oneOffCost?:number}} [opts]
 *   incomeDropPct - fraction (0..1) income is reduced by, for `months` months
 *   months        - length of the stress window
 *   oneOffCost    - a one-time shock cost (e.g. a medical bill) applied in month 1
 * @returns {{series:Array<{month:number,income:number,burn:number,net:number,balance:number}>,
 *   verdict:{survives:boolean, monthsUntilZero:number|null, worstBalance:number}}}
 */
export function shockTest(state, { incomeDropPct = 0, months = 3, oneOffCost = 0 } = {}) {
  const baseIncome = incomeVolatility(state).mean || incomeFor(state, shiftMonth(monthKey(), -1));
  const burn = essentialBurn(state);
  const drop = clamp(incomeDropPct, 0, 1);

  let balance = liquidSavings(state);
  let worstBalance = balance;
  let monthsUntilZero = null;
  const series = [];

  const horizon = Math.max(1, Math.round(months));
  for (let i = 1; i <= horizon; i++) {
    const income = r2(baseIncome * (1 - drop));
    let net = sub(income, burn);
    if (i === 1) net = sub(net, oneOffCost);
    balance = add(balance, net);
    if (balance < worstBalance) worstBalance = balance;
    if (balance < 0 && monthsUntilZero === null) monthsUntilZero = i;
    series.push({ month: i, income, burn, net, balance: r2(balance) });
  }

  return {
    series,
    verdict: {
      survives: monthsUntilZero === null,
      monthsUntilZero,
      worstBalance: r2(worstBalance),
    },
  };
}
