/**
 * app.js: the AceBudget application controller.
 *
 * A single-page, hash-routed app with no framework and no build step. It
 * subscribes to the store once, re-renders the active view on every state
 * change, and gates everything behind a 60-second onboarding flow until
 * `profile.onboarded` is true.
 */

import {
  getState, subscribe, addItem, patchItem, removeItem,
  setProfile, setSetting, setBudget, copyBudget,
  exportJSON, importJSON, undoImport, resetAll,
  setPin, verifyPin, clearPin,
  exportXlsxBlob, importXlsx,
} from './core/store.js';
import { attachFile } from './core/attachments.js';
import { fmt, num, pct, clamp, CURRENCIES, realValue } from './core/money.js';
import { monthKey, monthLabel, shiftMonth, dayLabel } from './core/dates.js';
import {
  CATEGORIES, catName,
  METHODS, methodName, INCOME_SOURCES, sourceName, DEBT_TYPES, CYCLES,
} from './data/categories.js';
import { snapshot, inMonth } from './engine/analytics.js';
import { coachInsights, answerQuestion } from './engine/coach.js';
import { simulatePayoff, compareStrategies } from './engine/debtPlan.js';
import { shockTest } from './engine/shock.js';
import { el, sparkline, barRow, fmtDelta, runwayGauge, interactiveLineChart, interactiveDonut } from './ui/render.js';
import { toastOk, toastWarn, toastError } from './ui/toast.js';

// --- module state ------------------------------------------------------

let activeMonth = monthKey();
let debtStrategy = null; // overrides state.settings.strategy for the simulator UI only, per-session
let qaHistory = [];
let unlocked = false; // app-lock PIN gate, reset every fresh load by design

// --- boot ----------------------------------------------------------------

const mount = document.getElementById('app');

function boot() {
  subscribe(render);
  window.addEventListener('hashchange', render);
  document.addEventListener('acebudget:save-failed', () => {
    toastError("Could not save: your device's storage may be full or private browsing may block it.");
  });
  render();
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is best-effort */ });
  });
}

function render() {
  const state = getState();
  document.documentElement.setAttribute('data-theme', state.settings.theme === 'dark' ? 'dark' : 'light');
  const locked = state.profile.onboarded && state.settings.lockEnabled && state.settings.pinHash && !unlocked;
  mount.replaceChildren(
    locked ? buildLockScreen(state) : state.profile.onboarded ? buildShell(state) : buildOnboarding(state)
  );
}

// --- routing ---------------------------------------------------------------

const ROUTES = [
  { path: '/dashboard', label: 'Dashboard', icon: '🏠', render: renderDashboard },
  { path: '/transactions', label: 'Transactions', icon: '🧾', render: renderTransactions },
  { path: '/income', label: 'Income', icon: '💰', render: renderIncome },
  { path: '/budget', label: 'Budget', icon: '📊', render: renderBudget },
  { path: '/goals', label: 'Goals', icon: '🎯', render: renderGoals },
  { path: '/debt', label: 'Debt', icon: '💳', render: renderDebt },
  { path: '/subscriptions', label: 'Subscriptions', icon: '🔁', render: renderSubscriptions },
  { path: '/savings', label: 'Savings', icon: '🏦', render: renderSavings },
  { path: '/cashflow', label: 'Cash Flow', icon: '📈', render: renderCashflow },
  { path: '/coach', label: 'Coach', icon: '🧭', render: renderCoach },
  { path: '/profile', label: 'Profile', icon: '👤', render: renderProfile },
  { path: '/settings', label: 'Settings', icon: '⚙️', render: renderSettings },
];

function currentPath() {
  const h = (location.hash || '#/dashboard').slice(1);
  return ROUTES.some((r) => r.path === h) ? h : '/dashboard';
}

// --- shell ------------------------------------------------------------------

function buildShell(state) {
  const path = currentPath();
  const route = ROUTES.find((r) => r.path === path);
  const snap = snapshot(state, activeMonth);

  const nav = el('nav', { class: 'app-nav', 'aria-label': 'Primary' },
    ROUTES.map((r) => el('a', {
      href: `#${r.path}`,
      class: `nav-link${r.path === path ? ' nav-link-active' : ''}`,
      'aria-current': r.path === path ? 'page' : null,
    }, [el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, r.icon), el('span', { class: 'nav-label' }, r.label)]))
  );

  const topbar = el('header', { class: 'app-topbar' }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '🌱'),
      el('strong', {}, 'AceBudget'),
      state.profile.household ? el('span', { class: 'muted' }, `· ${state.profile.household}`) : null,
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: `pill ${runwayPillClass(snap.runway.band)}` }, `${snap.runway.days}d runway`),
    ]),
  ]);

  const content = el('div', { class: 'app-content', id: 'main', tabindex: '-1' }, []);
  route.render(content, state, snap);

  return el('div', { class: 'app-shell' }, [topbar, nav, el('main', { class: 'app-main' }, content)]);
}

function runwayPillClass(band) {
  if (band === 'strong' || band === 'solid') return 'pill-ok';
  if (band === 'thin') return 'pill-warn';
  return 'pill-bad';
}

/** Plain-language pill text: every band word is already simple except "exposed". */
function bandWord(band) {
  return band === 'exposed' ? 'no safety net' : band;
}

// --- onboarding --------------------------------------------------------------

function buildOnboarding(state) {
  const errBox = el('div', { class: 'field-error', role: 'alert' });

  const nameField = field({ label: 'Household name', id: 'ob-name', required: true, value: state.profile.household, hint: 'e.g. "The Otieno Household" (only ever stored on this device).' });
  const currencyField = selectField({
    label: 'Currency', id: 'ob-currency',
    options: CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol} ${c.name} (${c.code})` })),
    value: state.profile.currency,
  });
  const incomeTypeField = selectField({
    label: 'How does income arrive?', id: 'ob-income-type',
    options: [
      { value: 'regular', label: 'Regular: roughly the same amount, roughly on schedule' },
      { value: 'irregular', label: 'Irregular: lumpy, seasonal, or unpredictable' },
    ],
    value: state.profile.incomeType,
  });
  const dependantsField = field({ label: 'Dependants', id: 'ob-dependants', type: 'number', value: String(state.profile.dependants || 0), attrs: { min: '0', step: '1' } });

  const form = el('form', { class: 'card stack onboard-form', onsubmit: (e) => {
    e.preventDefault();
    const household = nameField.input.value.trim();
    if (!household) {
      errBox.textContent = 'Household name is required.';
      return;
    }
    const dependants = num(dependantsField.input.value);
    if (dependants < 0) {
      errBox.textContent = 'Dependants cannot be negative.';
      return;
    }
    errBox.textContent = '';
    setProfile({
      household,
      currency: currencyField.input.value,
      incomeType: incomeTypeField.input.value,
      dependants,
      onboarded: true,
    });
    toastOk(`Welcome, ${household}. Your data stays on this device.`);
  } }, [
    el('h1', {}, 'Set up AceBudget'),
    el('p', { class: 'soft' }, "60 seconds, no account, nothing leaves this device. Every other budgeting app asks for a bank password. This one just asks a few questions."),
    nameField.wrap, currencyField.wrap, incomeTypeField.wrap, dependantsField.wrap,
    errBox,
    el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Start budgeting'),
  ]);

  return el('div', { class: 'onboard-screen' }, [el('div', { class: 'wrap onboard-wrap' }, form)]);
}

// --- app lock ------------------------------------------------------------------

function buildLockScreen(state) {
  const errBox = el('div', { class: 'field-error', role: 'alert' });
  const pinField = field({
    label: 'PIN', id: 'lock-pin', type: 'password', required: true,
    attrs: { inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' },
  });

  const form = el('form', { class: 'card stack onboard-form', onsubmit: (e) => {
    e.preventDefault();
    const pin = pinField.input.value.trim();
    verifyPin(pin).then((ok) => {
      if (ok) {
        unlocked = true;
        render();
      } else {
        errBox.textContent = 'Wrong PIN. Try again.';
        pinField.input.value = '';
        pinField.input.focus();
      }
    });
  } }, [
    el('h1', {}, `🔒 ${state.profile.household || 'AceBudget'}`),
    el('p', { class: 'soft' }, 'Enter your PIN to open the app.'),
    pinField.wrap,
    errBox,
    el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Unlock'),
    el('button', { class: 'btn btn-quiet btn-block btn-sm', type: 'button', onclick: () => {
      if (confirm('A forgotten PIN cannot be recovered on this local-only app. The only way back in is to erase all data on this device and start over. Erase everything now?')) {
        resetAll();
        toastOk('All data has been reset.');
      }
    } }, 'Forgot PIN?'),
  ]);

  return el('div', { class: 'onboard-screen' }, [el('div', { class: 'wrap onboard-wrap' }, form)]);
}

function buildLockSettingsCard(state) {
  const enabled = !!(state.settings.lockEnabled && state.settings.pinHash);

  if (!enabled) {
    const pinF = field({
      label: 'Choose a PIN (4-8 digits)', id: 'set-pin', type: 'password', required: true,
      attrs: { inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' },
    });
    const confirmF = field({
      label: 'Confirm PIN', id: 'set-pin-confirm', type: 'password', required: true,
      attrs: { inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' },
    });
    const err = errorBox();

    const form = el('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      const pin = pinF.input.value.trim();
      const confirmPin = confirmF.input.value.trim();
      if (!/^\d{4,8}$/.test(pin)) { err.textContent = 'PIN must be 4 to 8 digits.'; return; }
      if (pin !== confirmPin) { err.textContent = 'PINs do not match.'; return; }
      err.textContent = '';
      setPin(pin).then(() => {
        toastOk('App lock turned on.');
        pinF.input.value = ''; confirmF.input.value = '';
      });
    } }, [
      el('div', { class: 'form-row' }, [pinF.wrap, confirmF.wrap]),
      err,
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Turn on app lock'),
    ]);

    return el('div', { class: 'card stack' }, [
      el('h3', {}, 'App lock'),
      el('p', { class: 'soft' }, 'Ask for a PIN every time the app opens. Good for a shared family device.'),
      el('p', { class: 'muted fs-xs' }, 'This is a privacy screen, not encryption: the data on this device is not scrambled. If the PIN is forgotten, there is no recovery, only a full local data reset.'),
      form,
    ]);
  }

  const currentF = field({
    label: 'Current PIN', id: 'off-pin', type: 'password', required: true,
    attrs: { inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' },
  });
  const err = errorBox();

  const form = el('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    verifyPin(currentF.input.value.trim()).then((ok) => {
      if (!ok) { err.textContent = 'Wrong PIN.'; return; }
      err.textContent = '';
      clearPin();
      toastOk('App lock turned off.');
    });
  } }, [
    el('div', { class: 'form-row' }, [currentF.wrap]),
    err,
    el('button', { class: 'btn btn-danger', type: 'submit' }, 'Turn off app lock'),
  ]);

  return el('div', { class: 'card stack' }, [
    el('h3', {}, 'App lock'),
    el('div', { class: 'row-between' }, [el('span', { class: 'soft' }, 'A PIN is required to open the app.'), el('span', { class: 'pill pill-ok' }, 'On')]),
    form,
  ]);
}

// --- shared form helpers -----------------------------------------------------

function field({ label, id, type = 'text', value = '', required = false, hint, attrs = {} }) {
  const input = el('input', { type, id, name: id, value, required, ...attrs });
  return {
    input,
    wrap: el('div', { class: 'field' }, [
      el('label', { for: id }, label),
      input,
      hint ? el('div', { class: 'hint' }, hint) : null,
    ]),
  };
}

function selectField({ label, id, options, value = '', required = false }) {
  const select = el('select', { id, name: id, required });
  for (const opt of options) {
    select.appendChild(el('option', { value: opt.value, selected: opt.value === value }, opt.label));
  }
  return { input: select, wrap: el('div', { class: 'field' }, [el('label', { for: id }, label), select]) };
}

function checkboxField({ label, id, checked = false }) {
  const input = el('input', { type: 'checkbox', id, name: id, checked });
  return { input, wrap: el('label', { class: 'row', for: id, style: { cursor: 'pointer' } }, [input, label]) };
}

function errorBox() {
  return el('div', { class: 'field-error', role: 'alert' });
}

function deleteBtn(onClick, labelText = 'Remove') {
  return el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': labelText, onclick: onClick }, '✕');
}

function money(state, amount) { return fmt(amount, state.profile.currency); }

function monthNav(onChange) {
  return el('div', { class: 'row month-nav' }, [
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { activeMonth = shiftMonth(activeMonth, -1); onChange(); } }, '‹'),
    el('strong', {}, monthLabel(activeMonth, true)),
    el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { activeMonth = shiftMonth(activeMonth, 1); onChange(); } }, '›'),
  ]);
}

function emptyState(text) {
  return el('p', { class: 'muted center', style: { padding: 'var(--sp-5) 0' } }, text);
}

/** Rebuild the active route in place: used after local (non-store) UI state changes like month nav. */
function refresh() { render(); }

// --- dashboard ---------------------------------------------------------------

function renderDashboard(container, state, snap) {
  const cur = state.profile.currency;

  // --- runway hero ---
  const gaugeHost = el('div', { class: 'gauge-host' });
  const runwayCard = el('div', { class: 'card rise runway-card' }, [
    el('div', { class: 'row-between' }, [
      el('h2', {}, 'Runway'),
      el('span', { class: `pill ${runwayPillClass(snap.runway.band)}` }, bandWord(snap.runway.band)),
    ]),
    gaugeHost,
    el('p', { class: 'soft center' }, 'This is how many days your family could live on savings alone if all income stopped.'),
    el('p', { class: 'muted fs-xs center' }, snap.runway.label),
    el('div', { class: 'row-between muted fs-xs' }, [
      el('span', {}, `Savings you can use: ${money(state, snap.runway.liquid)}`),
      el('span', {}, `Monthly must-pay costs: ${money(state, snap.runway.burn)}`),
    ]),
  ]);
  runwayGauge(gaugeHost, { days: snap.runway.days, band: snap.runway.band });

  // --- month-over-month comparison ---
  const current = snap.series.at(-1) || { key: snap.month.key, income: 0, spend: 0, net: 0 };
  const previous = snap.series.length > 1 ? snap.series.at(-2) : null;
  const savingsRate = (m) => (m && m.income ? m.net / m.income : 0);

  function deltaBadge(delta, { inverse = false, isRate = false } = {}) {
    const flat = !Number.isFinite(delta) || Math.abs(delta) < (isRate ? 0.0005 : 0.005);
    if (flat) return el('span', { class: 'delta delta-flat' }, 'flat');
    const up = delta > 0;
    const good = inverse ? !up : up;
    const arrow = up ? '▲' : '▼';
    const text = isRate ? `${up ? '+' : ''}${(delta * 100).toFixed(1)}pp` : fmtDelta(delta, cur);
    return el('span', { class: `delta ${good ? 'delta-good' : 'delta-bad'}` }, `${arrow} ${text}`);
  }

  function compareStat(label, valueText, delta) {
    return el('div', { class: 'compare-stat' }, [
      el('div', { class: 'muted fs-xs' }, label),
      el('div', { class: 'row' }, [el('span', { class: 'num fs-lg' }, valueText), delta]),
    ]);
  }

  const comparisonCard = el('div', { class: 'card rise' }, [
    el('div', { class: 'row-between' }, [
      el('h3', {}, monthLabel(current.key, true)),
      previous ? el('span', { class: 'muted fs-xs' }, `vs ${monthLabel(previous.key, true)}`) : null,
    ]),
    el('div', { class: 'grid compare-grid' }, [
      compareStat('Income', money(state, current.income), previous ? deltaBadge(current.income - previous.income) : null),
      compareStat('Spend', money(state, current.spend), previous ? deltaBadge(current.spend - previous.spend, { inverse: true }) : null),
      compareStat('Net', money(state, current.net), previous ? deltaBadge(current.net - previous.net) : null),
      compareStat('Savings rate', pct(savingsRate(current)), previous ? deltaBadge(savingsRate(current) - savingsRate(previous), { isRate: true }) : null),
    ]),
  ]);

  // --- interactive 12-month cash flow chart ---
  // (no extra overflow-x wrapper here: the chart scales fluidly via its own
  // viewBox + width:100%, and overflow:auto would clip the hover tooltip;
  // see .flow-chart-wrap in app.css)
  const chartHost = el('div', {});
  const flowCard = el('div', { class: 'card rise' }, [
    el('div', { class: 'row-between' }, [
      el('h3', {}, '12-month cash flow'),
      el('div', { class: 'row fs-xs muted' }, [
        el('span', { class: 'legend-swatch', style: { background: 'var(--ok)' } }), 'Income',
        el('span', { class: 'legend-swatch', style: { background: 'var(--bad)' } }), 'Spend',
      ]),
    ]),
    chartHost,
  ]);
  interactiveLineChart(chartHost, snap.series, { currency: cur });

  // --- interactive category donut ---
  const segments = snap.categories.slice(0, 8).map((c) => ({ value: c.amount, color: c.color, name: c.name, icon: c.icon, id: c.id }));
  const legendItems = snap.categories.slice(0, 6).map((c) => el('li', {
    class: 'legend-item', tabindex: '0', role: 'button', 'aria-label': `${c.name}, ${money(state, c.amount)}`,
  }, [
    el('span', { class: 'dot', style: { color: c.color } }), `${c.icon} ${c.name}`, el('span', { class: 'num muted' }, money(state, c.amount)),
  ]));
  const breakdownRows = snap.categories.map((c) => el('li', { class: 'row-between breakdown-row', 'data-cat': c.id }, [
    el('span', {}, `${c.icon} ${c.name}`),
    el('span', { class: 'row' }, [el('span', { class: 'muted fs-xs' }, pct(c.share)), el('span', { class: 'num' }, money(state, c.amount))]),
  ]));
  const breakdownList = el('ul', { class: 'plain-list breakdown-list' }, breakdownRows);
  const donutHost = el('div', { class: 'donut-host' });

  const donutCard = el('div', { class: 'card rise' }, [
    el('h3', {}, 'Spend by category'),
    snap.categories.length
      ? el('div', { class: 'row donut-row' }, [donutHost, el('ul', { class: 'legend' }, legendItems)])
      : emptyState('No transactions logged yet this month.'),
    snap.categories.length
      ? el('div', { class: 'stack' }, [el('div', { class: 'muted fs-xs' }, 'Tap a slice for details.'), breakdownList])
      : null,
  ]);

  if (snap.categories.length) {
    const chart = interactiveDonut(donutHost, segments, {
      currency: cur,
      onSelect: (seg) => {
        const row = breakdownList.querySelector(`[data-cat="${seg.id}"]`);
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        row.classList.add('breakdown-row-flash');
        setTimeout(() => row.classList.remove('breakdown-row-flash'), 900);
      },
    });
    legendItems.forEach((li, i) => {
      li.addEventListener('mouseenter', () => chart.highlight(i));
      li.addEventListener('mouseleave', () => chart.highlight(null));
      li.addEventListener('click', () => chart.select(i));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chart.select(i); } });
    });
  }

  // --- supporting cards ---
  const tierCard = el('div', { class: 'card rise' }, [
    el('h3', {}, 'Spend by tier'),
    ...['essential', 'lifestyle', 'financial'].map((tier) => barRow({
      label: tier[0].toUpperCase() + tier.slice(1),
      used: snap.month.tiers[tier],
      limit: snap.month.spend,
      state: 'ok',
      currency: cur,
    })),
  ]);

  const insight = coachInsights(state)[0];
  const coachCard = el('div', { class: 'card rise' }, [
    el('div', { class: 'row-between' }, [el('h3', {}, 'Top insight'), el('a', { href: '#/coach', class: 'btn btn-quiet btn-sm' }, 'All insights')]),
    insight
      ? el('div', { class: `insight insight-${insight.severity}` }, [
          el('strong', {}, insight.title),
          el('p', { class: 'soft' }, insight.body),
        ])
      : emptyState('No insights yet: add some income and spending to get started.'),
  ]);

  const subsCard = el('div', { class: 'card rise' }, [
    el('div', { class: 'row-between' }, [el('h3', {}, 'Upcoming charges'), el('a', { href: '#/subscriptions', class: 'btn btn-quiet btn-sm' }, 'Manage')]),
    snap.subs.next7.length
      ? el('ul', { class: 'plain-list' }, snap.subs.next7.map((x) => el('li', { class: 'row-between' }, [
          el('span', {}, `${x.name}, ${dayLabel(x.nextCharge)}`), el('span', { class: 'num' }, money(state, x.amount)),
        ])))
      : emptyState('Nothing due in the next 7 days.'),
  ]);

  const goalsCard = el('div', { class: 'card rise' }, [
    el('div', { class: 'row-between' }, [el('h3', {}, 'Goals'), el('a', { href: '#/goals', class: 'btn btn-quiet btn-sm' }, 'Manage')]),
    snap.goals.length
      ? el('div', { class: 'stack' }, snap.goals.slice(0, 4).map((g) => barRow({ label: g.name, used: num(g.saved), limit: num(g.target) || 1, state: g.onTrack === false ? 'pace' : 'ok', currency: cur })))
      : emptyState('No goals yet.'),
  ]);

  container.replaceChildren(el('div', { class: 'stack dashboard-stack' }, [
    el('p', { class: 'hook-caption' }, 'Every day of runway is a day of freedom you already paid for.'),
    el('div', { class: 'grid dashboard-hero' }, [runwayCard, comparisonCard]),
    el('div', { class: 'grid dashboard-charts' }, [flowCard, donutCard]),
    el('div', { class: 'grid dashboard-cards' }, [coachCard, subsCard, goalsCard, tierCard]),
  ]));
}

function statBlock(label, value) {
  return el('div', {}, [el('div', { class: 'muted fs-xs' }, label), el('div', { class: 'num fs-lg' }, value)]);
}

// --- transactions --------------------------------------------------------------

function renderTransactions(container, state, snap) {
  const cur = state.profile.currency;
  const rows = inMonth(state.transactions, activeMonth).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const dateF = field({ label: 'Date', id: 'tx-date', type: 'date', value: todayISO(), required: true });
  const catF = selectField({ label: 'Category', id: 'tx-cat', options: CATEGORIES.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` })) });
  const amtF = field({ label: 'Amount', id: 'tx-amt', type: 'number', attrs: { min: '0', step: '0.01' }, required: true });
  const methodF = selectField({ label: 'Method', id: 'tx-method', options: METHODS.map((m) => ({ value: m.id, label: `${m.icon} ${m.name}` })) });
  const noteF = field({ label: 'Note (optional)', id: 'tx-note' });
  const err = errorBox();

  let pendingAttachment = null;
  const attachStatus = el('span', { class: 'muted fs-xs' }, 'No receipt attached.');
  const attachInput = el('input', {
    type: 'file', accept: '.pdf,.doc,.docx,image/*', class: 'hidden', id: 'tx-attach',
    onchange: (e) => {
      const file = e.target.files[0];
      if (!file) return;
      attachStatus.textContent = 'Processing...';
      attachFile(file).then((result) => {
        if (result.ok) {
          pendingAttachment = result.attachment;
          attachStatus.textContent = `Attached: ${result.attachment.name}`;
        } else {
          pendingAttachment = null;
          attachStatus.textContent = result.error;
        }
      });
    },
  });
  const attachBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => attachInput.click() }, '📎 Attach receipt');

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const amount = num(amtF.input.value);
    if (!dateF.input.value) { err.textContent = 'A date is required.'; return; }
    if (amount <= 0) { err.textContent = 'Amount must be greater than zero.'; return; }
    err.textContent = '';
    addItem('transactions', { date: dateF.input.value, category: catF.input.value, amount, method: methodF.input.value, note: noteF.input.value.trim(), attachment: pendingAttachment });
    toastOk('Transaction added.');
    amtF.input.value = ''; noteF.input.value = ''; attachInput.value = '';
    pendingAttachment = null; attachStatus.textContent = 'No receipt attached.';
  } }, [
    el('h3', {}, 'Add transaction'),
    el('div', { class: 'form-row' }, [dateF.wrap, catF.wrap, amtF.wrap, methodF.wrap]),
    noteF.wrap,
    el('div', { class: 'row' }, [attachBtn, attachStatus]),
    el('p', { class: 'muted fs-xs' }, 'PDF, Word doc, or a photo of the receipt: attached for reference only, never auto-read.'),
    attachInput,
    err,
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Add'),
  ]);

  const table = rows.length
    ? el('div', { class: 'table-scroll' }, [el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, ['Date', 'Category', 'Method', 'Note', 'Amount', '', ''].map((h, i) => el('th', { class: i === 4 ? 'r' : null }, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, [
          el('td', {}, dayLabel(r.date, true)),
          el('td', {}, `${catName(r.category)}`),
          el('td', {}, methodName(r.method)),
          el('td', {}, r.note || '-'),
          el('td', { class: 'r num' }, money(state, r.amount)),
          el('td', {}, r.attachment ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `View receipt for ${catName(r.category)}`, onclick: () => openAttachment(r.attachment) }, '📎') : null),
          el('td', {}, deleteBtn(() => { removeItem('transactions', r.id); toastOk('Transaction removed.'); })),
        ]))),
      ])])
    : emptyState('No transactions for this month yet.');

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('div', { class: 'row-between' }, [el('h2', {}, 'Transactions'), monthNav(refresh)]),
    el('p', { class: 'hook-caption' }, 'Track every expense, and the leaks stop hiding.'),
    form, el('div', { class: 'card' }, table),
  ]));
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// --- income ----------------------------------------------------------------

function renderIncome(container, state, snap) {
  const rows = inMonth(state.income, activeMonth).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const dateF = field({ label: 'Date', id: 'inc-date', type: 'date', value: todayISO(), required: true });
  const srcF = selectField({ label: 'Source', id: 'inc-src', options: INCOME_SOURCES.map((s) => ({ value: s.id, label: s.name })) });
  const amtF = field({ label: 'Amount', id: 'inc-amt', type: 'number', attrs: { min: '0', step: '0.01' }, required: true });
  const methodF = selectField({ label: 'Method', id: 'inc-method', options: METHODS.map((m) => ({ value: m.id, label: `${m.icon} ${m.name}` })) });
  const noteF = field({ label: 'Note (optional)', id: 'inc-note' });
  const err = errorBox();

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const amount = num(amtF.input.value);
    if (amount <= 0) { err.textContent = 'Amount must be greater than zero.'; return; }
    err.textContent = '';
    addItem('income', { date: dateF.input.value, source: srcF.input.value, amount, method: methodF.input.value, note: noteF.input.value.trim() });
    toastOk('Income logged.');
    amtF.input.value = ''; noteF.input.value = '';
  } }, [
    el('h3', {}, 'Log income'),
    el('div', { class: 'form-row' }, [dateF.wrap, srcF.wrap, amtF.wrap, methodF.wrap]),
    noteF.wrap, err,
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Add'),
  ]);

  const volCard = el('div', { class: 'card' }, [
    el('h3', {}, 'How steady is your income?'),
    el('p', { class: 'soft' }, `Your income has been ${snap.volatility.band} over the last ${snap.volatility.months} months.`),
    snap.draw.amount ? el('p', { class: 'muted' }, `Suggested safe monthly draw: ${money(state, snap.draw.amount)} (${snap.draw.basis}).`) : null,
  ]);

  const table = rows.length
    ? el('div', { class: 'table-scroll' }, [el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, ['Date', 'Source', 'Method', 'Note', 'Amount', ''].map((h, i) => el('th', { class: i === 4 ? 'r' : null }, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, [
          el('td', {}, dayLabel(r.date, true)), el('td', {}, sourceName(r.source)), el('td', {}, methodName(r.method)), el('td', {}, r.note || '-'),
          el('td', { class: 'r num' }, money(state, r.amount)),
          el('td', {}, deleteBtn(() => { removeItem('income', r.id); toastOk('Income entry removed.'); })),
        ]))),
      ])])
    : emptyState('No income logged for this month yet.');

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('div', { class: 'row-between' }, [el('h2', {}, 'Income'), monthNav(refresh)]),
    el('p', { class: 'hook-caption' }, 'Know exactly what comes in, so you never plan to save more than you have.'),
    form, volCard, el('div', { class: 'card' }, table),
  ]));
}

// --- budget ------------------------------------------------------------------

function renderBudget(container, state, snap) {
  const cur = state.profile.currency;
  const limits = state.budgets[activeMonth] || {};
  const usedById = Object.fromEntries(snap.categories.map((c) => [c.id, c.amount]));

  const rows = CATEGORIES.map((c) => {
    const limit = num(limits[c.id]);
    const used = num(usedById[c.id] || 0);
    const rowMeta = snap.budget.rows.find((r) => r.id === c.id);
    const state2 = rowMeta ? rowMeta.state : (limit === 0 ? 'ok' : 'ok');
    return el('div', { class: 'row-between budget-row' }, [
      el('div', { class: 'grow' }, barRow({ label: `${c.icon} ${c.name}`, used, limit, state: state2, currency: cur })),
      el('input', {
        type: 'number', min: '0', step: '1', value: limit || '', placeholder: 'no limit',
        style: { width: '110px' }, 'aria-label': `Budget limit for ${c.name}`,
        onchange: (e) => setBudget(activeMonth, c.id, e.target.value),
      }),
    ]);
  });

  const copyBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
    copyBudget(shiftMonth(activeMonth, -1), activeMonth);
    toastOk('Copied last month\'s budget forward.');
  } }, 'Copy last month');

  const summary = el('div', { class: 'card row-between' }, [
    statBlock('Total limit', money(state, snap.budget.totalLimit)),
    statBlock('Total used', money(state, snap.budget.totalUsed)),
    statBlock('Over budget', String(snap.budget.overCount)),
    statBlock('On pace to overspend', String(snap.budget.paceCount)),
  ]);

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('div', { class: 'row-between' }, [el('h2', {}, 'Budget'), el('div', { class: 'row' }, [copyBtn, monthNav(refresh)])]),
    el('p', { class: 'hook-caption' }, 'Plan your limits early so nothing surprises you.'),
    summary,
    el('div', { class: 'card stack' }, rows),
  ]));
}

// --- goals -----------------------------------------------------------------

function renderGoals(container, state, snap) {
  const cur = state.profile.currency;
  const nameF = field({ label: 'Goal name', id: 'g-name', required: true });
  const targetF = field({ label: 'Target', id: 'g-target', type: 'number', attrs: { min: '0', step: '0.01' }, required: true });
  const savedF = field({ label: 'Already saved', id: 'g-saved', type: 'number', attrs: { min: '0', step: '0.01' }, value: '0' });
  const monthlyF = field({ label: 'Planned monthly contribution', id: 'g-monthly', type: 'number', attrs: { min: '0', step: '0.01' }, value: '0' });
  const deadlineF = field({ label: 'Deadline (optional)', id: 'g-deadline', type: 'date' });
  const priorityF = field({ label: 'Priority (higher = shown first)', id: 'g-priority', type: 'number', attrs: { min: '0', step: '1' }, value: '1' });
  const err = errorBox();

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const target = num(targetF.input.value);
    const saved = num(savedF.input.value);
    const monthly = num(monthlyF.input.value);
    if (!nameF.input.value.trim()) { err.textContent = 'Name is required.'; return; }
    if (target <= 0) { err.textContent = 'Target must be greater than zero.'; return; }
    if (saved < 0 || monthly < 0) { err.textContent = 'Amounts cannot be negative.'; return; }
    err.textContent = '';
    addItem('goals', { name: nameF.input.value.trim(), target, saved, monthly, deadline: deadlineF.input.value || null, priority: num(priorityF.input.value) });
    toastOk('Goal added.');
    nameF.input.value = ''; targetF.input.value = ''; savedF.input.value = '0'; monthlyF.input.value = '0';
  } }, [
    el('h3', {}, 'Add a goal'),
    el('div', { class: 'form-row' }, [nameF.wrap, targetF.wrap, savedF.wrap, monthlyF.wrap, deadlineF.wrap, priorityF.wrap]),
    err,
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Add goal'),
  ]);

  const feasCard = el('div', { class: `card ${snap.feasibility.feasible ? '' : 'insight-warning'}` }, [
    el('h3', {}, 'Are goals affordable?'),
    el('p', { class: 'soft' }, snap.feasibility.feasible
      ? `Yes: your goals need ${money(state, snap.feasibility.claimed)}/month, and you have ${money(state, snap.feasibility.surplus)} left over each month.`
      : `Your goals need ${money(state, snap.feasibility.claimed)}/month, which is ${money(state, snap.feasibility.gap)} more than the ${money(state, snap.feasibility.surplus)} you have left over this month.`),
  ]);

  const list = snap.goals.length ? el('div', { class: 'stack' }, snap.goals.map((g) => {
    const target = state.settings.realTerms ? g.realTarget : num(g.target);
    return el('div', { class: 'card goal-card' }, [
      el('div', { class: 'row-between' }, [
        el('strong', {}, g.name),
        el('div', { class: 'row' }, [
          g.onTrack === false ? el('span', { class: 'pill pill-warn' }, 'off track') : g.onTrack === true ? el('span', { class: 'pill pill-ok' }, 'on track') : null,
          deleteBtn(() => { removeItem('goals', g.id); toastOk('Goal removed.'); }),
        ]),
      ]),
      barRow({ label: state.settings.realTerms ? 'Progress (real terms)' : 'Progress', used: num(g.saved), limit: target || 1, state: g.onTrack === false ? 'pace' : 'ok', currency: cur }),
      el('p', { class: 'muted' }, [
        `${money(state, num(g.monthly))}/month planned. `,
        g.eta ? `ETA: ${monthLabel(g.eta, true)}. ` : 'No monthly amount set, so no ETA. ',
        g.deadline ? (g.onTrack === false ? `Needs ${money(state, g.requiredForDeadline)}/month to hit the ${dayLabel(g.deadline, true)} deadline.` : `Deadline ${dayLabel(g.deadline, true)}.`) : '',
      ]),
    ]);
  })) : emptyState('No goals yet: add one above.');

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('h2', {}, 'Goals'),
    el('p', { class: 'hook-caption' }, 'A goal with a monthly number attached is a plan. Without one, it is just a wish.'),
    form, feasCard, list,
  ]));
}

// --- debt ------------------------------------------------------------------

function renderDebt(container, state, snap) {
  const nameF = field({ label: 'Name', id: 'd-name', required: true });
  const typeF = selectField({ label: 'Type', id: 'd-type', options: DEBT_TYPES.map((t) => ({ value: t.id, label: t.name })) });
  const balF = field({ label: 'Balance', id: 'd-bal', type: 'number', attrs: { min: '0', step: '0.01' }, required: true });
  const aprF = field({ label: 'APR %', id: 'd-apr', type: 'number', attrs: { min: '0', step: '0.1' }, required: true });
  const minF = field({ label: 'Min. monthly payment', id: 'd-min', type: 'number', attrs: { min: '0', step: '0.01' }, required: true });
  const lenderF = field({ label: 'Lender (optional)', id: 'd-lender' });
  const err = errorBox();

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const balance = num(balF.input.value);
    const apr = num(aprF.input.value);
    const minPayment = num(minF.input.value);
    if (!nameF.input.value.trim()) { err.textContent = 'Name is required.'; return; }
    if (balance <= 0) { err.textContent = 'Balance must be greater than zero.'; return; }
    if (apr < 0 || minPayment < 0) { err.textContent = 'APR and payment cannot be negative.'; return; }
    err.textContent = '';
    addItem('debts', { name: nameF.input.value.trim(), type: typeF.input.value, balance, apr, minPayment, lender: lenderF.input.value.trim() });
    toastOk('Debt added.');
    nameF.input.value = ''; balF.input.value = ''; aprF.input.value = ''; minF.input.value = '';
  } }, [
    el('h3', {}, 'Add a debt'),
    el('div', { class: 'form-row' }, [nameF.wrap, typeF.wrap, balF.wrap, aprF.wrap, minF.wrap, lenderF.wrap]),
    err,
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Add debt'),
  ]);

  const summary = el('div', { class: 'card row-between' }, [
    statBlock('Total balance', money(state, snap.debt.total)),
    statBlock('Monthly interest', money(state, snap.debt.monthlyInterest)),
    statBlock('Debt-to-income', pct(snap.debt.dti)),
    statBlock('Avg. APR', `${snap.debt.avgApr}%`),
  ]);

  const list = snap.debt.debts.length ? el('div', { class: 'table-scroll' }, [el('table', { class: 'data' }, [
    el('thead', {}, el('tr', {}, ['Name', 'Type', 'Balance', 'APR', 'Min. payment', ''].map((h, i) => el('th', { class: i >= 2 && i <= 4 ? 'r' : null }, h)))),
    el('tbody', {}, snap.debt.debts.map((d) => el('tr', {}, [
      el('td', {}, d.name), el('td', {}, DEBT_TYPES.find((t) => t.id === d.type)?.name || '-'),
      el('td', { class: 'r num' }, money(state, d.balance)), el('td', { class: 'r num' }, `${num(d.apr)}%`), el('td', { class: 'r num' }, money(state, num(d.minPayment))),
      el('td', {}, deleteBtn(() => { removeItem('debts', d.id); toastOk('Debt removed.'); })),
    ]))),
  ])]) : emptyState('No debts on record.');

  // --- payoff simulator ---
  const strategyF = selectField({ label: 'Strategy', id: 'sim-strategy', options: [
    { value: 'avalanche', label: 'Avalanche: highest APR first' },
    { value: 'snowball', label: 'Snowball: smallest balance first' },
  ], value: debtStrategy || state.settings.strategy || 'avalanche' });
  const extraF = field({ label: 'Extra monthly payment', id: 'sim-extra', type: 'number', attrs: { min: '0', step: '1' }, value: '0' });

  const simResult = el('div', { class: 'stack', id: 'sim-result' });

  const runSim = () => {
    const extra = Math.max(0, num(extraF.input.value));
    debtStrategy = strategyF.input.value;
    if (!snap.debt.debts.length) { simResult.replaceChildren(emptyState('Add a debt to run the simulator.')); return; }
    const cmp = compareStrategies(snap.debt.debts, extra);
    const chosen = debtStrategy === 'snowball' ? cmp.snowball : cmp.avalanche;
    const other = debtStrategy === 'snowball' ? cmp.avalanche : cmp.snowball;
    simResult.replaceChildren(el('div', { class: 'row-between' }, [
      el('div', { class: 'card grow' }, [
        el('h4', {}, debtStrategy === 'snowball' ? 'Snowball' : 'Avalanche'),
        el('p', {}, `Debt-free in ${chosen.months} months (${monthLabel(chosen.payoffDate || monthKey())}).`),
        el('p', { class: 'muted' }, `Total interest paid: ${money(state, chosen.totalInterest)}.`),
      ]),
      el('div', { class: 'card grow' }, [
        el('h4', {}, debtStrategy === 'snowball' ? 'Avalanche (comparison)' : 'Snowball (comparison)'),
        el('p', {}, `Debt-free in ${other.months} months.`),
        el('p', { class: 'muted' }, `Total interest paid: ${money(state, other.totalInterest)}.`),
      ]),
    ]));
  };

  const simForm = el('div', { class: 'card stack' }, [
    el('h3', {}, 'Payoff simulator'),
    el('div', { class: 'form-row' }, [strategyF.wrap, extraF.wrap]),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: runSim }, 'Run simulation'),
    simResult,
  ]);
  runSim();

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('h2', {}, 'Debt'),
    el('p', { class: 'hook-caption' }, 'Every extra payment today is interest you will never pay tomorrow.'),
    form, summary, el('div', { class: 'card' }, list), simForm,
  ]));
}

// --- subscriptions -----------------------------------------------------------

function renderSubscriptions(container, state, snap) {
  const nameF = field({ label: 'Name', id: 's-name', required: true });
  const amtF = field({ label: 'Amount', id: 's-amt', type: 'number', attrs: { min: '0', step: '0.01' }, required: true });
  const cycleF = selectField({ label: 'Cycle', id: 's-cycle', options: CYCLES.map((c) => ({ value: c.id, label: c.name })), value: 'monthly' });
  const catF = selectField({ label: 'Category', id: 's-cat', options: CATEGORIES.map((c) => ({ value: c.id, label: c.name })), value: 'subs' });
  const nextF = field({ label: 'Next charge', id: 's-next', type: 'date', value: todayISO(), required: true });
  const statusF = selectField({ label: 'Status', id: 's-status', options: [{ value: 'active', label: 'Active' }, { value: 'unused', label: 'Unused (dormant)' }] });
  const err = errorBox();

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const amount = num(amtF.input.value);
    if (!nameF.input.value.trim()) { err.textContent = 'Name is required.'; return; }
    if (amount <= 0) { err.textContent = 'Amount must be greater than zero.'; return; }
    err.textContent = '';
    addItem('subscriptions', { name: nameF.input.value.trim(), amount, cycle: cycleF.input.value, category: catF.input.value, nextCharge: nextF.input.value, status: statusF.input.value, lastUsed: null });
    toastOk('Subscription added.');
    nameF.input.value = ''; amtF.input.value = '';
  } }, [
    el('h3', {}, 'Add subscription'),
    el('div', { class: 'form-row' }, [nameF.wrap, amtF.wrap, cycleF.wrap, catF.wrap, nextF.wrap, statusF.wrap]),
    err,
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Add'),
  ]);

  const summary = el('div', { class: 'card row-between' }, [
    statBlock('Monthly load', money(state, snap.subs.monthly)),
    statBlock('Yearly load', money(state, snap.subs.yearly)),
    statBlock('Active', String(snap.subs.count)),
    statBlock('Dormant leakage', money(state, snap.subs.leakage)),
  ]);

  const list = snap.subs.upcoming.length ? el('div', { class: 'table-scroll' }, [el('table', { class: 'data' }, [
    el('thead', {}, el('tr', {}, ['Name', 'Cycle', 'Next charge', 'Status', 'Amount', ''].map((h, i) => el('th', { class: i === 4 ? 'r' : null }, h)))),
    el('tbody', {}, snap.subs.upcoming.map((x) => el('tr', {}, [
      el('td', {}, x.name), el('td', {}, CYCLES.find((c) => c.id === x.cycle)?.name || x.cycle),
      el('td', {}, `${dayLabel(x.nextCharge)}${x.inDays != null ? ` (${x.inDays}d)` : ''}`),
      el('td', {}, [
        x.status === 'unused' ? el('span', { class: 'pill pill-warn' }, 'unused') : el('span', { class: 'pill pill-ok' }, 'active'),
        ' ',
        el('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => patchItem('subscriptions', x.id, { status: x.status === 'unused' ? 'active' : 'unused' }) }, x.status === 'unused' ? 'Mark used' : 'Mark unused'),
      ]),
      el('td', { class: 'r num' }, money(state, x.amount)),
      el('td', {}, deleteBtn(() => { removeItem('subscriptions', x.id); toastOk('Subscription removed.'); })),
    ]))),
  ])]) : emptyState('No subscriptions on record.');

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('h2', {}, 'Subscriptions: Renewal Radar'),
    el('p', { class: 'hook-caption' }, 'Cancel one forgotten charge and you just gave yourself a raise.'),
    form, summary, el('div', { class: 'card' }, list),
  ]));
}

// --- savings -----------------------------------------------------------------

function renderSavings(container, state, snap) {
  const nameF = field({ label: 'Name', id: 'sv-name', required: true });
  const balF = field({ label: 'Balance', id: 'sv-bal', type: 'number', attrs: { min: '0', step: '0.01' }, required: true });
  const targetF = field({ label: 'Target (optional)', id: 'sv-target', type: 'number', attrs: { min: '0', step: '0.01' }, value: '0' });
  const aprF = field({ label: 'APR % (optional)', id: 'sv-apr', type: 'number', attrs: { min: '0', step: '0.1' }, value: '0' });
  const kindF = selectField({ label: 'Kind', id: 'sv-kind', options: [
    { value: 'cash', label: 'Cash / mobile money' }, { value: 'bank', label: 'Bank savings' }, { value: 'sacco', label: 'SACCO / Chama' }, { value: 'invest', label: 'Investment' },
  ] });
  const liquidF = checkboxField({ label: 'Liquid: counts toward runway', id: 'sv-liquid', checked: true });
  const err = errorBox();

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const balance = num(balF.input.value);
    if (!nameF.input.value.trim()) { err.textContent = 'Name is required.'; return; }
    if (balance < 0) { err.textContent = 'Balance cannot be negative.'; return; }
    err.textContent = '';
    addItem('savings', { name: nameF.input.value.trim(), balance, target: num(targetF.input.value), apr: num(aprF.input.value), kind: kindF.input.value, liquid: liquidF.input.checked });
    toastOk('Savings account added.');
    nameF.input.value = ''; balF.input.value = '';
  } }, [
    el('h3', {}, 'Add a savings account'),
    el('div', { class: 'form-row' }, [nameF.wrap, balF.wrap, targetF.wrap, aprF.wrap, kindF.wrap]),
    liquidF.wrap, err,
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Add'),
  ]);

  const list = state.savings.length ? el('div', { class: 'stack' }, state.savings.map((a) => {
    const realBalance = state.settings.realTerms ? realValue(num(a.balance), state.profile.inflation, 12) : null;
    return el('div', { class: 'card row-between' }, [
      el('div', {}, [
        el('div', { class: 'row' }, [el('strong', {}, a.name), a.liquid === false ? el('span', { class: 'pill' }, 'not liquid') : el('span', { class: 'pill pill-ok' }, 'liquid')]),
        el('div', { class: 'muted' }, `${a.kind || 'cash'} · APR ${num(a.apr)}%${a.target ? ` · target ${money(state, num(a.target))}` : ''}`),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'num fs-lg' }, [
          money(state, num(a.balance)),
          realBalance != null ? el('div', { class: 'muted fs-xs' }, `≈ ${money(state, realBalance)} in a year, real terms`) : null,
        ]),
        deleteBtn(() => { removeItem('savings', a.id); toastOk('Account removed.'); }),
      ]),
    ]);
  })) : emptyState('No savings accounts yet.');

  const totals = el('div', { class: 'card row-between' }, [
    statBlock('Total savings', money(state, snap.worth.assets)),
    statBlock('Liquid (counts toward runway)', money(state, snap.runway.liquid)),
    statBlock('Net worth', money(state, snap.worth.net)),
  ]);

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('h2', {}, 'Savings'),
    el('p', { class: 'hook-caption' }, 'Save first. Spend what is left.'),
    form, totals, list,
  ]));
}

// --- cashflow ----------------------------------------------------------------

function renderCashflow(container, state, snap) {
  const seriesCard = el('div', { class: 'card' }, [
    el('h3', {}, '12-month history'),
    el('div', { class: 'row-between' }, [
      el('div', {}, [el('div', { class: 'muted fs-xs' }, 'Income vs spend'), el('div', { html: sparkline(snap.series.map((s) => s.income), { color: 'var(--ok)' }) })]),
      el('div', {}, [el('div', { class: 'muted fs-xs' }, 'Net'), el('div', { html: sparkline(snap.series.map((s) => s.net), { color: 'var(--brand-500)' }) })]),
    ]),
    el('div', { class: 'table-scroll' }, [el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, ['Month', 'Income', 'Spend', 'Net'].map((h, i) => el('th', { class: i > 0 ? 'r' : null }, h)))),
      el('tbody', {}, snap.series.map((s) => el('tr', {}, [
        el('td', {}, monthLabel(s.key)), el('td', { class: 'r num' }, money(state, s.income)), el('td', { class: 'r num' }, money(state, s.spend)), el('td', { class: 'r num' }, money(state, s.net)),
      ]))),
    ])]),
  ]);

  // --- shock test ---
  const dropF = field({ label: 'Income drop %', id: 'shock-drop', type: 'number', attrs: { min: '0', max: '100', step: '5' }, value: '30' });
  const monthsF = field({ label: 'Months of stress', id: 'shock-months', type: 'number', attrs: { min: '1', max: '24', step: '1' }, value: '3' });
  const costF = field({ label: 'One-off cost (optional)', id: 'shock-cost', type: 'number', attrs: { min: '0', step: '1' }, value: '0' });
  const shockResult = el('div', { class: 'stack' });

  const runShock = () => {
    const result = shockTest(state, { incomeDropPct: clamp(num(dropF.input.value) / 100, 0, 1), months: Math.max(1, num(monthsF.input.value)), oneOffCost: Math.max(0, num(costF.input.value)) });
    shockResult.replaceChildren(
      el('div', { class: `insight ${result.verdict.survives ? 'insight-positive' : 'insight-critical'}` }, [
        el('strong', {}, result.verdict.survives ? 'The household survives this scenario' : `Runs out of liquid savings in month ${result.verdict.monthsUntilZero}`),
        el('p', {}, `Worst balance reached: ${money(state, result.verdict.worstBalance)}.`),
      ]),
      el('div', { class: 'table-scroll' }, [el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, ['Month', 'Income', 'Essential burn', 'Net', 'Balance'].map((h, i) => el('th', { class: i > 0 ? 'r' : null }, h)))),
        el('tbody', {}, result.series.map((m) => el('tr', {}, [
          el('td', {}, `M${m.month}`), el('td', { class: 'r num' }, money(state, m.income)), el('td', { class: 'r num' }, money(state, m.burn)), el('td', { class: 'r num' }, money(state, m.net)),
          el('td', { class: `r num${m.balance < 0 ? ' text-bad' : ''}` }, money(state, m.balance)),
        ]))),
      ])]),
    );
  };

  const shockCard = el('div', { class: 'card stack' }, [
    el('h3', {}, 'Shock test'),
    el('p', { class: 'soft' }, 'Model an income drop and an optional one-off cost against current liquid savings and essential burn.'),
    el('div', { class: 'form-row' }, [dropF.wrap, monthsF.wrap, costF.wrap]),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: runShock }, 'Run shock test'),
    shockResult,
  ]);
  runShock();

  const projCard = el('div', { class: 'card' }, [
    el('h3', {}, 'Projected balance (12 months)'),
    el('div', { html: sparkline(monthlyProjectionBalances(state), { color: 'var(--violet-500)' }) }),
  ]);

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('h2', {}, 'Cash Flow'),
    el('p', { class: 'hook-caption' }, 'See the shock before it arrives, and it stops being a shock.'),
    seriesCard, shockCard, projCard,
  ]));
}

function monthlyProjectionBalances(state) {
  // A lightweight 12-point projection reusing safe-draw/volatility, mirroring analytics.projectCashflow.
  const snap = snapshot(state);
  let balance = snap.runway.liquid;
  const income = state.profile.incomeType === 'irregular' ? snap.draw.amount : snap.volatility.mean;
  const out = [];
  for (let i = 0; i < 12; i++) {
    const net = income - snap.runway.comfort - snap.subs.monthly;
    balance += net;
    out.push(balance);
  }
  return out;
}

// --- coach -------------------------------------------------------------------

function renderCoach(container, state, snap) {
  const insights = coachInsights(state);
  const list = insights.length ? el('div', { class: 'stack' }, insights.map((ins) => el('div', { class: `card insight insight-${ins.severity}` }, [
    el('div', { class: 'row-between' }, [el('strong', {}, ins.title), el('span', { class: `pill pill-${severityPillTone(ins.severity)}` }, ins.severity)]),
    el('p', { class: 'soft' }, ins.body),
    ins.action ? el('a', { href: ins.action, class: 'btn btn-ghost btn-sm' }, ins.cta || 'View') : null,
  ]))) : emptyState('No insights right now: the household looks steady.');

  const qaInput = field({ label: 'Ask a question', id: 'qa-input', hint: 'e.g. "How many days of runway do I have?" or "Can I afford 5000?"' });
  const qaLog = el('div', { class: 'stack qa-log' }, qaHistory.map((entry) => el('div', { class: 'card' }, [
    el('p', {}, [el('strong', {}, 'Q: '), entry.q]),
    el('p', { class: 'soft' }, [el('strong', {}, 'A: '), entry.a]),
  ])));

  const qaForm = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const q = qaInput.input.value.trim();
    if (!q) return;
    const a = answerQuestion(state, q);
    qaHistory = [{ q, a }, ...qaHistory].slice(0, 8);
    qaInput.input.value = '';
    render();
  } }, [
    el('h3', {}, 'Ask AceBudget'),
    el('p', { class: 'muted fs-xs' }, 'Answers come from your own numbers, worked out right here on your device. Nothing is sent online.'),
    qaInput.wrap,
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Ask'),
  ]);

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('h2', {}, 'Coach'),
    el('p', { class: 'hook-caption' }, 'The best advice is the advice that fits your own numbers, not someone else\'s.'),
    list, qaForm, qaLog,
  ]));
}

function severityPillTone(sev) {
  return { critical: 'bad', warning: 'warn', opportunity: 'info', positive: 'ok' }[sev] || 'info';
}

// --- profile -------------------------------------------------------------------

/** Household & financial-modeling configuration, distinct from app/system Settings. */
function renderProfile(container, state, snap) {
  const profileForm = buildProfileForm(state);

  const realTermsToggle = el('div', { class: 'row-between' }, [
    el('div', {}, [el('strong', {}, 'Real terms'), el('div', { class: 'muted fs-xs' }, 'Show what your savings and goals will really be worth later, after prices go up (inflation).')]),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setSetting('realTerms', !state.settings.realTerms) }, state.settings.realTerms ? 'On' : 'Off'),
  ]);

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('h2', {}, 'Profile'),
    el('p', { class: 'hook-caption' }, 'Get the assumptions right here, and every number downstream tells the truth.'),
    el('p', { class: 'soft' }, 'Household details and the financial assumptions AceBudget uses to compute runway, real-terms values and safe income draws.'),
    profileForm,
    el('div', { class: 'card stack' }, [realTermsToggle]),
  ]));
}

// --- settings ----------------------------------------------------------------

/** Pure app & system settings: appearance, offline status, data, and danger zone. */
function renderSettings(container, state, snap) {
  const themeToggle = el('div', { class: 'row-between' }, [
    el('div', {}, [el('strong', {}, 'Theme'), el('div', { class: 'muted fs-xs' }, 'Light or dark, stored on this device.')]),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setSetting('theme', state.settings.theme === 'dark' ? 'light' : 'dark') }, state.settings.theme === 'dark' ? '☀️ Light' : '🌙 Dark'),
  ]);

  const offlineStatus = ('serviceWorker' in navigator);
  const pwaCard = el('div', { class: 'card stack' }, [
    el('h3', {}, 'App & offline'),
    el('div', { class: 'row-between' }, [
      el('div', {}, [el('strong', {}, 'Offline support'), el('div', { class: 'muted fs-xs' }, 'AceBudget caches itself for use without a network connection.')]),
      el('span', { class: `pill ${offlineStatus ? 'pill-ok' : 'pill-warn'}` }, offlineStatus ? 'Available' : 'Unsupported'),
    ]),
    el('div', { class: 'row-between' }, [
      el('div', {}, [el('strong', {}, 'Network calls')]),
      el('span', { class: 'pill pill-ok' }, 'None (local-first)'),
    ]),
  ]);

  const exportXlsxBtn = el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
    downloadBlob(exportXlsxBlob(), `acebudget-${todayISO()}.xlsx`);
  } }, 'Export to Excel (.xlsx)');
  const exportJsonBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => downloadJSON(exportJSON()) }, 'Full backup (.json)');

  const xlsxInput = el('input', { type: 'file', accept: '.xlsx', class: 'hidden', onchange: (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.arrayBuffer().then(importXlsx).then((result) => {
      if (result.ok) toastOk(`Imported ${result.added} row${result.added === 1 ? '' : 's'} from Excel.`);
      else toastError(result.error || 'Import failed.');
      e.target.value = '';
    });
  } });
  const importXlsxBtn = el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => xlsxInput.click() }, 'Import from Excel (.xlsx)');

  const jsonInput = el('input', { type: 'file', accept: 'application/json', class: 'hidden', onchange: (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importJSON(String(reader.result));
      if (result.ok) toastOk('Backup restored. Previous data was backed up for undo.');
      else toastError(result.error || 'Import failed.');
      e.target.value = '';
    };
    reader.readAsText(file);
  } });
  const importJsonBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => jsonInput.click() }, 'Restore full backup (.json)');
  const undoBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => { if (undoImport()) toastOk('Import undone.'); else toastWarn('Nothing to undo.'); } }, 'Undo last import');

  const dangerZone = el('div', { class: 'card', style: { borderColor: 'var(--bad)' } }, [
    el('h3', {}, 'Danger zone'),
    el('p', { class: 'soft' }, 'Permanently erase everything stored on this device. This cannot be undone.'),
    el('button', { class: 'btn btn-danger', type: 'button', onclick: () => {
      if (confirm('This will permanently delete all AceBudget data on this device. Continue?')) {
        resetAll();
        toastOk('All data has been reset.');
      }
    } }, 'Reset all data'),
  ]);

  const aboutCard = el('div', { class: 'card stack' }, [
    el('h3', {}, 'About'),
    el('p', { class: 'soft' }, 'AceBudget is a free, local-first budgeting tool. It is a planning and record-keeping aid, not a licensed financial adviser, and does not provide personalised investment advice.'),
    el('p', { class: 'muted fs-xs' }, 'Household details, currency and inflation assumptions live under Profile.'),
  ]);

  const dataCard = el('div', { class: 'card stack' }, [
    el('h3', {}, 'Your data'),
    el('p', { class: 'soft' }, 'Everything lives in this browser\'s local storage. Nothing is ever sent anywhere.'),
    el('div', { class: 'row' }, [exportXlsxBtn, importXlsxBtn]),
    el('p', { class: 'muted fs-xs' }, 'Excel import reads rows from "Transactions" and "Income" sheets, matching the layout of the export.'),
    el('div', { class: 'row' }, [exportJsonBtn, importJsonBtn, undoBtn]),
    el('p', { class: 'muted fs-xs' }, 'The full backup (.json) is the only format that restores everything exactly, including budgets, goals, debts and settings.'),
    xlsxInput, jsonInput,
  ]);

  container.replaceChildren(el('div', { class: 'stack' }, [
    el('h2', {}, 'Settings'),
    el('p', { class: 'hook-caption' }, 'Your data, your device, your rules. Nothing leaves without your say.'),
    el('div', { class: 'card stack' }, [themeToggle]),
    pwaCard,
    buildLockSettingsCard(state),
    dataCard,
    aboutCard,
    dangerZone,
  ]));
}

function buildProfileForm(state) {
  const nameF = field({ label: 'Household name', id: 'set-name', value: state.profile.household, required: true });
  const currencyF = selectField({ label: 'Currency', id: 'set-currency', options: CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol} ${c.name} (${c.code})` })), value: state.profile.currency });
  const incomeTypeF = selectField({ label: 'Income type', id: 'set-income-type', options: [{ value: 'regular', label: 'Regular' }, { value: 'irregular', label: 'Irregular' }], value: state.profile.incomeType });
  const dependantsF = field({ label: 'Dependants', id: 'set-dependants', type: 'number', attrs: { min: '0', step: '1' }, value: String(state.profile.dependants || 0) });
  const inflationF = field({ label: 'Annual inflation %', id: 'set-inflation', type: 'number', attrs: { min: '0', step: '0.1' }, value: String(num(state.profile.inflation) * 100) });
  const err = errorBox();

  return el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const dependants = num(dependantsF.input.value);
    const inflation = num(inflationF.input.value) / 100;
    if (!nameF.input.value.trim()) { err.textContent = 'Household name is required.'; return; }
    if (dependants < 0 || inflation < 0) { err.textContent = 'Values cannot be negative.'; return; }
    err.textContent = '';
    setProfile({ household: nameF.input.value.trim(), currency: currencyF.input.value, incomeType: incomeTypeF.input.value, dependants, inflation });
    toastOk('Profile updated.');
  } }, [
    el('h3', {}, 'Household profile'),
    el('div', { class: 'form-row' }, [nameF.wrap, currencyF.wrap, incomeTypeF.wrap, dependantsF.wrap, inflationF.wrap]),
    err,
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save profile'),
  ]);
}

function downloadJSON(text) {
  downloadBlob(new Blob([text], { type: 'application/json' }), `acebudget-backup-${todayISO()}.json`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Open a stored receipt (data URL) in a new tab via a short-lived blob URL. */
function openAttachment(attachment) {
  fetch(attachment.dataUrl)
    .then((res) => res.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })
    .catch(() => toastError('Could not open that receipt.'));
}

boot();
