/**
 * debtPlan.js: payoff simulator (Gap G6: debt strategy is opaque).
 *
 * Month-by-month amortization: every debt pays at least its minimum, and the
 * chosen strategy's extra payment lands on one targeted debt at a time. When
 * a debt reaches zero, its minimum payment rolls into the pool applied to the
 * next target, the "avalanche"/"snowball" effect a static balance list
 * cannot show.
 */

import { add, sub, r2, num } from '../core/money.js';
import { dayKey, addMonths } from '../core/dates.js';

const MAX_MONTHS = 600;
const EPSILON = 0.005;

/**
 * Simulate payoff of a debt list under one strategy.
 * @param {Array<{id:string, name?:string, balance:number, apr:number, minPayment:number}>} debts
 * @param {number} extraMonthly - additional amount applied to the current target debt each month
 * @param {'avalanche'|'snowball'} strategy - avalanche targets highest APR first, snowball targets smallest balance first
 * @returns {{months:number, payoffDate:string|null, totalInterest:number, order:string[], schedule:Array<{month:number,totalBalance:number,totalPaid:number}>}}
 */
export function simulatePayoff(debts, extraMonthly = 0, strategy = 'avalanche') {
  const working = (debts || [])
    .filter((d) => num(d.balance) > 0)
    .map((d) => ({ id: d.id, apr: num(d.apr), minPayment: num(d.minPayment), balance: num(d.balance) }));

  if (!working.length) {
    return { months: 0, payoffDate: null, totalInterest: 0, order: [], schedule: [] };
  }

  const order = strategy === 'snowball'
    ? [...working].sort((a, b) => a.balance - b.balance).map((d) => d.id)
    : [...working].sort((a, b) => b.apr - a.apr).map((d) => d.id);

  const rolledOver = new Set();
  let freed = 0;
  let totalInterest = 0;
  const schedule = [];
  let month = 0;

  while (working.some((d) => d.balance > EPSILON) && month < MAX_MONTHS) {
    month++;
    const targetId = order.find((id) => working.find((d) => d.id === id).balance > EPSILON);
    let totalPaid = 0;

    for (const d of working) {
      if (d.balance <= EPSILON) continue;
      const interest = r2((d.balance * (d.apr / 100)) / 12);
      totalInterest = add(totalInterest, interest);

      let payment = d.minPayment;
      if (d.id === targetId) payment = add(payment, extraMonthly, freed);

      const owed = add(d.balance, interest);
      payment = Math.min(payment, owed);
      d.balance = sub(owed, payment);
      if (d.balance < EPSILON) d.balance = 0;
      totalPaid = add(totalPaid, payment);
    }

    for (const d of working) {
      if (d.balance === 0 && !rolledOver.has(d.id)) {
        rolledOver.add(d.id);
        freed = add(freed, d.minPayment);
      }
    }

    schedule.push({
      month,
      totalBalance: add(...working.map((d) => d.balance)),
      totalPaid: r2(totalPaid),
    });
  }

  const payoffDate = addMonths(dayKey(), month);
  return { months: month, payoffDate, totalInterest: r2(totalInterest), order, schedule };
}

/**
 * Run both strategies for the same debt list and extra payment, and report
 * the honest trade-off between them rather than declaring a single winner.
 * @param {Array} debts
 * @param {number} extraMonthly
 * @returns {{avalanche:object, snowball:object, interestSaved:number}}
 *   interestSaved = avalanche.totalInterest - snowball.totalInterest.
 *   Negative means avalanche costs less interest than snowball (the usual
 *   case); positive means snowball happened to cost less this time. Snowball
 *   typically still wins on the number of debts closed early, which is not
 *   captured by this single number: read `order`/`months` on each result too.
 */
export function compareStrategies(debts, extraMonthly = 0) {
  const avalanche = simulatePayoff(debts, extraMonthly, 'avalanche');
  const snowball = simulatePayoff(debts, extraMonthly, 'snowball');
  return { avalanche, snowball, interestSaved: sub(avalanche.totalInterest, snowball.totalInterest) };
}
