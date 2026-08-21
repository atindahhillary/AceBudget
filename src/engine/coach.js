/**
 * coach.js: the insight/recommendation engine (Gap G8: "data without counsel").
 *
 * A donut chart shows what happened. This module is the layer that decides
 * what a household should do about it. Every rule below is a pure function of
 * `snapshot()` (no DOM, no storage, no network) and every sentence it writes
 * names a real number pulled straight from the ledger.
 */

import { snapshot } from './analytics.js';
import { simulatePayoff } from './debtPlan.js';
import { fmt, num, pct, add, sub, realValue } from '../core/money.js';
import { monthLabel, dayLabel } from '../core/dates.js';
import { CATEGORIES, catName } from '../data/categories.js';

const SEVERITY_RANK = { critical: 0, warning: 1, opportunity: 2, positive: 3 };
const MAX_INSIGHTS = 8;

/**
 * Compute the ranked list of coach insights for the current state.
 * @param {object} state
 * @returns {Array<{id:string, severity:'critical'|'warning'|'opportunity'|'positive',
 *   title:string, body:string, metric?:string, cta?:string, action?:string}>}
 */
export function coachInsights(state) {
  const snap = snapshot(state);
  const cur = state.profile.currency;
  const money = (n) => fmt(n, cur);
  const rows = [];

  // --- runway ---------------------------------------------------------
  if (snap.runway.band === 'fragile' || snap.runway.band === 'exposed') {
    rows.push({
      id: 'runway-critical',
      severity: 'critical',
      title: snap.runway.days > 0 ? `Only ${snap.runway.days} days of runway left` : 'No liquid buffer left',
      body: snap.runway.days > 0
        ? `Essential spending is running at ${money(snap.runway.burn)} a month (${money(snap.runway.burn / 30.44)}/day). ` +
          `At that burn rate, ${money(snap.runway.liquid)} in liquid savings covers ${snap.runway.days} day${snap.runway.days === 1 ? '' : 's'} if income stopped today.`
        : `There is no liquid savings buffer on record, and essential burn is ${money(snap.runway.burn)} a month. ` +
          `A single missed pay cycle would leave nothing to draw on.`,
      metric: `${snap.runway.days} days`,
      cta: 'Build a starter buffer',
      action: '#/savings',
    });
  }

  // --- budget: over -----------------------------------------------------
  for (const row of snap.budget.rows.filter((r) => r.state === 'over')) {
    const overage = sub(row.used, row.limit);
    rows.push({
      id: `budget-over-${row.id}`,
      severity: 'warning',
      title: `${catName(row.id)} is over budget by ${money(overage)}`,
      body: `${monthLabel(snap.month.key)} spending on ${catName(row.id)} reached ${money(row.used)} against a ${money(row.limit)} limit, ${money(overage)} over.`,
      metric: money(overage),
      cta: 'Review this category',
      action: '#/budget',
    });
  }

  // --- budget: pace -------------------------------------------------
  const pacing = snap.budget.rows.filter((r) => r.state === 'pace');
  if (pacing.length) {
    const names = pacing.map((r) => catName(r.id)).join(', ');
    rows.push({
      id: 'budget-pace',
      severity: 'warning',
      title: pacing.length === 1
        ? `${catName(pacing[0].id)} is on pace to overspend`
        : `${pacing.length} categories are on pace to overspend`,
      body: `Given how far through ${monthLabel(snap.month.key)} we are, spending is running ahead of budget in: ${names}. ` +
        `Slow these down now to avoid an overage at month end.`,
      metric: `${pacing.length}`,
      cta: 'Check budget pace',
      action: '#/budget',
    });
  }

  // --- debt: worst APR (avalanche logic) ---------------------------------
  const debts = snap.debt.debts;
  if (debts.length >= 1 && snap.debt.worst) {
    const worst = snap.debt.worst;
    const others = debts.filter((d) => d.id !== worst.id);
    const avgOthersApr = others.length
      ? others.reduce((a, d) => a + num(d.apr), 0) / others.length
      : 0;
    const materiallyWorse = others.length === 0 || num(worst.apr) >= Math.max(20, avgOthersApr * 2);

    if (materiallyWorse && num(worst.apr) > 0) {
      const worstMonthlyInterest = (num(worst.balance) * (num(worst.apr) / 100)) / 12;
      const surplus = Math.max(0, snap.month.net);
      let savedLine = '';
      if (surplus > 0 && debts.length >= 1) {
        const baseline = simulatePayoff(debts, 0, 'avalanche');
        const accelerated = simulatePayoff(debts, surplus, 'avalanche');
        const saved = sub(baseline.totalInterest, accelerated.totalInterest);
        if (saved > 0) {
          savedLine = ` Redirecting this month's ${money(surplus)} surplus toward it first (avalanche order) would ` +
            `cut total interest paid across all debts by roughly ${money(saved)} and clear everything ${baseline.months - accelerated.months} month${(baseline.months - accelerated.months) === 1 ? '' : 's'} sooner.`;
        }
      }
      rows.push({
        id: 'debt-worst-apr',
        severity: 'critical',
        title: `${worst.name || 'A debt'} at ${num(worst.apr)}% APR is bleeding ${money(worstMonthlyInterest)}/month`,
        body: `This balance carries a materially higher rate than the rest of the debt load` +
          (others.length ? ` (average of the others is ${avgOthersApr.toFixed(1)}%)` : '') +
          `. It costs about ${money(worstMonthlyInterest)} in interest every month it sits untouched.${savedLine}`,
        metric: money(worstMonthlyInterest),
        cta: 'Open the payoff simulator',
        action: '#/debt',
      });
    }
  }

  // --- debt-to-income --------------------------------------------------
  if (snap.debt.dti > 0.4) {
    rows.push({
      id: 'debt-dti',
      severity: 'critical',
      title: `Debt payments take ${pct(snap.debt.dti)} of income`,
      body: `Minimum debt payments total ${money(snap.debt.minTotal)} a month against typical income: ${pct(snap.debt.dti)} of every shilling/dollar earned. ` +
        `Above 40% is the zone where a single missed payment cascades. New borrowing should stop until this ratio comes down.`,
      metric: pct(snap.debt.dti),
      cta: 'Review debts',
      action: '#/debt',
    });
  }

  // --- dormant subscriptions (Renewal Radar) -----------------------------
  if (snap.subs.dormant.length) {
    const names = snap.subs.dormant.map((x) => x.name).join(', ');
    rows.push({
      id: 'subs-dormant',
      severity: 'warning',
      title: `Renewal Radar: ${money(snap.subs.leakage)}/year on unused subscriptions`,
      body: `${snap.subs.dormant.length} subscription${snap.subs.dormant.length === 1 ? ' is' : 's are'} marked unused but still renewing: ${names}. ` +
        `Cancelling them recovers ${money(snap.subs.leakage)} a year.`,
      metric: money(snap.subs.leakage),
      cta: 'Review subscriptions',
      action: '#/subscriptions',
    });
  }

  // --- upcoming charges within 7 days ------------------------------------
  if (snap.subs.next7.length) {
    const list = snap.subs.next7
      .map((x) => `${x.name} (${money(x.monthlyEq === x.amount ? x.amount : x.amount)}) on ${dayLabel(x.nextCharge)}`)
      .join('; ');
    rows.push({
      id: 'subs-next7',
      severity: 'opportunity',
      title: `${snap.subs.next7.length} subscription charge${snap.subs.next7.length === 1 ? '' : 's'} due within 7 days`,
      body: `Coming up: ${list}. Make sure the funds are set aside.`,
      metric: `${snap.subs.next7.length}`,
      cta: 'View subscriptions',
      action: '#/subscriptions',
    });
  }

  // --- goal feasibility ---------------------------------------------------
  if (!snap.feasibility.feasible && snap.feasibility.claimed > 0) {
    rows.push({
      id: 'goals-infeasible',
      severity: 'warning',
      title: `Goal plans claim ${money(snap.feasibility.gap)}/month more than the household has`,
      body: `Goals are funded for ${money(snap.feasibility.claimed)}/month in total, but this month's actual surplus is ${money(snap.feasibility.surplus)}. ` +
        `That is a gap of ${money(snap.feasibility.gap)}: either trim a goal's monthly amount or increase surplus.`,
      metric: money(snap.feasibility.gap),
      cta: 'Review goal funding',
      action: '#/goals',
    });
  }

  // --- goals off track -----------------------------------------------------
  for (const g of snap.goals.filter((g) => g.onTrack === false)) {
    rows.push({
      id: `goal-offtrack-${g.id}`,
      severity: 'warning',
      title: `${g.name} won't make its deadline at the current pace`,
      body: `Saving ${money(num(g.monthly))}/month reaches the ${money(g.target)} target after its deadline. ` +
        `Hitting the deadline requires ${money(g.requiredForDeadline)}/month instead of ${money(num(g.monthly))}/month.`,
      metric: money(g.requiredForDeadline),
      cta: 'Adjust this goal',
      action: '#/goals',
    });
  }

  // --- income volatility vs profile mode ---------------------------------
  if ((snap.volatility.band === 'lumpy' || snap.volatility.band === 'irregular') && state.profile.incomeType !== 'irregular') {
    rows.push({
      id: 'income-volatility-mode',
      severity: 'opportunity',
      title: 'Income looks irregular: consider switching modes',
      body: `Income volatility over the last ${snap.volatility.months} months scores ${snap.volatility.score}/100 (${snap.volatility.band}), ` +
        `but the profile is set to regular income. Switching to irregular-income mode uses a smoothed safe monthly draw of ${money(snap.draw.amount)} ` +
        `instead of the raw average, which better matches how this money actually arrives.`,
      metric: money(snap.draw.amount),
      cta: 'Switch income mode',
      action: '#/settings',
    });
  }

  // --- negative savings rate ----------------------------------------------
  if (snap.month.net < 0) {
    rows.push({
      id: 'net-negative',
      severity: 'critical',
      title: `Spending exceeded income by ${money(Math.abs(snap.month.net))} this month`,
      body: `${monthLabel(snap.month.key)}: income of ${money(snap.month.income)} against spend of ${money(snap.month.spend)} ` +
        `leaves a shortfall of ${money(Math.abs(snap.month.net))}. That gap is being covered from savings, credit, or informal borrowing.`,
      metric: money(Math.abs(snap.month.net)),
      cta: 'Review spending',
      action: '#/transactions',
    });
  }

  // --- strong month reinforcement ------------------------------------------
  if (snap.month.savingsRate > 0.2 && snap.runway.band === 'strong') {
    const topGoal = snap.goals[0];
    rows.push({
      id: 'positive-strong-month',
      severity: 'positive',
      title: `Strong month: saving ${pct(snap.month.savingsRate)} of income`,
      body: `Runway is strong at ${snap.runway.days} days and this month's savings rate is ${pct(snap.month.savingsRate)}, well above the 20% mark. ` +
        (topGoal
          ? `Consider directing some of that surplus (${money(snap.month.net)}) into "${topGoal.name}" to pull its ETA forward.`
          : `Consider setting a savings goal to put this surplus to work.`),
      metric: pct(snap.month.savingsRate),
      cta: topGoal ? 'Boost a goal' : 'Set a goal',
      action: '#/goals',
    });
  }

  // --- no essential budgets set --------------------------------------------
  const essentialIds = new Set(CATEGORIES.filter((c) => c.tier === 'essential').map((c) => c.id));
  const limitsSet = new Set(snap.budget.rows.map((r) => r.id));
  const anyEssentialBudgeted = [...essentialIds].some((id) => limitsSet.has(id));
  if (!anyEssentialBudgeted) {
    const unbudgetedTotal = add(...snap.budget.unbudgeted.map((c) => c.amount));
    rows.push({
      id: 'no-essential-budgets',
      severity: 'opportunity',
      title: 'No essential-category budgets are set',
      body: unbudgetedTotal > 0
        ? `${money(unbudgetedTotal)} was spent this month with no budget limit tracking it. ` +
          `Setting limits on essentials (rent, utilities, groceries) makes overspend visible while it can still be corrected.`
        : `Setting limits on essentials (rent, utilities, groceries) turns overspend into something visible early instead of a surprise at month end.`,
      metric: money(unbudgetedTotal),
      cta: 'Set a budget',
      action: '#/budget',
    });
  }

  // --- inflation eroding low-yield savings ----------------------------------
  const inflation = num(state.profile.inflation);
  if (inflation > 0) {
    const laggingAccounts = (state.savings || []).filter((a) => num(a.apr) < inflation * 100 && num(a.balance) > 0);
    if (laggingAccounts.length) {
      const worstAcct = laggingAccounts[0];
      const erosion = sub(num(worstAcct.balance), realValue(num(worstAcct.balance), inflation, 12));
      rows.push({
        id: 'inflation-erosion',
        severity: 'opportunity',
        title: `${laggingAccounts.length} savings account${laggingAccounts.length === 1 ? '' : 's'} losing value in real terms`,
        body: `Inflation is set at ${pct(inflation)} a year. "${worstAcct.name}" earns ${num(worstAcct.apr)}% APR, below inflation: ` +
          `${money(num(worstAcct.balance))} today would be worth about ${money(realValue(num(worstAcct.balance), inflation, 12))} in a year's ` +
          `purchasing power if nothing changes, an erosion of roughly ${money(erosion)}.`,
        metric: money(erosion),
        cta: 'Review savings',
        action: '#/savings',
      });
    }
  }

  rows.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return rows.slice(0, MAX_INSIGHTS);
}

// --- Q&A -------------------------------------------------------------------

/**
 * Deterministic, keyword-based question answering. No LLM, no network.
 * This is the "automated assistance" the product spec calls for, implemented
 * as honest logic over `snapshot()` rather than a simulated conversation.
 * @param {object} state
 * @param {string} question
 * @returns {string}
 */
export function answerQuestion(state, question) {
  const snap = snapshot(state);
  const cur = state.profile.currency;
  const money = (n) => fmt(n, cur);
  const q = String(question || '').toLowerCase().trim();

  if (!q) {
    return fallback();
  }

  if (/\brunway\b|how many days|how long.*(last|survive|hold)/.test(q)) {
    return `Runway is ${snap.runway.days} days (${snap.runway.label}). That's ${money(snap.runway.liquid)} in liquid savings ` +
      `against essential burn of ${money(snap.runway.burn)}/month (${money(snap.runway.burn / 30.44)}/day). ` +
      `A comfortable-spending runway, including lifestyle spend, is ${snap.runway.comfortDays} days.`;
  }

  if (/\bafford\b/.test(q)) {
    const amountMatch = q.match(/[\d,]+(\.\d+)?/);
    const amount = amountMatch ? num(amountMatch[0].replace(/,/g, '')) : null;
    if (amount != null) {
      const surplus = snap.month.net;
      if (amount <= surplus) {
        return `Likely yes: this month's surplus so far is ${money(surplus)}, which covers ${money(amount)} with ${money(sub(surplus, amount))} left over.`;
      }
      const daysOfRunwayLost = snap.runway.burn > 0 ? Math.round((amount / (snap.runway.burn / 30.44))) : null;
      return `Tight: ${money(amount)} is more than this month's surplus of ${money(surplus)}. Paying it from liquid savings ` +
        `(${money(snap.runway.liquid)}) would use up roughly ${daysOfRunwayLost ?? 'several'} days of runway.`;
    }
    return `Current month surplus is ${money(snap.month.net)}, and liquid savings stand at ${money(snap.runway.liquid)} ` +
      `(${snap.runway.days} days of runway). Compare that against the cost to judge affordability.`;
  }

  if (/\bdebt\b|\bloan\b/.test(q)) {
    if (!snap.debt.debts.length) return 'No debts are on record.';
    const worst = snap.debt.worst;
    return `Total debt is ${money(snap.debt.total)} across ${snap.debt.debts.length} debt${snap.debt.debts.length === 1 ? '' : 's'}, ` +
      `costing about ${money(snap.debt.monthlyInterest)}/month in interest. Debt service is ${pct(snap.debt.dti)} of income. ` +
      (worst ? `The highest-rate debt is ${worst.name || 'unnamed'} at ${num(worst.apr)}% APR: attack that one first.` : '');
  }

  if (/subscription|recurring|renewal/.test(q)) {
    if (!snap.subs.count) return 'No subscriptions are on record.';
    const dormantLine = snap.subs.dormant.length
      ? ` ${snap.subs.dormant.length} look unused, wasting about ${money(snap.subs.leakage)}/year.`
      : ' None are flagged as unused.';
    return `${snap.subs.count} active subscriptions cost ${money(snap.subs.monthly)}/month (${money(snap.subs.yearly)}/year).${dormantLine}`;
  }

  if (/\bgoal/.test(q)) {
    if (!snap.goals.length) return 'No goals are set yet.';
    const lines = snap.goals.slice(0, 3).map((g) =>
      `"${g.name}": ${pct(g.progress)} funded, ${g.eta ? `on pace to finish around ${monthLabel(g.eta)}` : 'no funding pace set'}.`
    );
    return lines.join(' ');
  }

  if (/\bsave\b|\bsaving/.test(q)) {
    return `This month's savings rate is ${pct(snap.month.savingsRate)} (${money(snap.month.net)} of ${money(snap.month.income)} income). ` +
      `Total savings across all accounts is ${money(snap.worth.assets)}, of which ${money(snap.runway.liquid)} is liquid.`;
  }

  return fallback();

  function fallback() {
    return "I couldn't match that to a question I know how to answer. Try asking things like: " +
      '"How many days of runway do I have?", "Can I afford 5000?", "What is my debt situation?", ' +
      '"Any dormant subscriptions?", "How are my goals doing?", or "What is my savings rate?"';
  }
}
