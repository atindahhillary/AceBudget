/**
 * free.js: AceBudget Free, the free sample of the full app.
 *
 * A deliberately small, fully working budget: income, expenses, what is left,
 * and one savings goal. It reuses the full app's currency list, money
 * formatting, DOM helper, toasts, category icons and stylesheets, but keeps
 * its own storage key so it can never read, change or break the full app's
 * data. Nothing here imports the full app's store.
 */

import { el } from './ui/render.js';
import { CURRENCIES, fmt, num, r2, add, sub, ratio, clamp } from './core/money.js';
import { CAT_MAP } from './data/categories.js';
import { toastOk, toastError } from './ui/toast.js';

const KEY = 'acebudget.free.v1';
const FULL_APP_KEY = 'acebudget.state.v1'; // read only, for currency and theme defaults

/** The free sample's simple categories, borrowing the full app's icons. */
const CATEGORIES = [
  { id: 'housing',   name: 'Housing',   icon: CAT_MAP.housing.icon },
  { id: 'food',      name: 'Food',      icon: CAT_MAP.groceries.icon },
  { id: 'transport', name: 'Transport', icon: CAT_MAP.transport.icon },
  { id: 'bills',     name: 'Bills',     icon: CAT_MAP.utilities.icon },
  { id: 'personal',  name: 'Personal',  icon: CAT_MAP.personal.icon },
  { id: 'other',     name: 'Other',     icon: CAT_MAP.other.icon },
];
const catLabel = (id) => {
  const c = CATEGORIES.find((x) => x.id === id) || CATEGORIES.at(-1);
  return `${c.icon} ${c.name}`;
};

const SECTIONS = [
  { id: 'summary',  label: 'Summary',      icon: '🏠' },
  { id: 'income',   label: 'Income',       icon: '💰' },
  { id: 'expenses', label: 'Expenses',     icon: '🧾' },
  { id: 'savings',  label: 'Savings goal', icon: '🏦' },
];

/**
 * Sections that exist only in the full app. Shown in the menu and as cards so
 * people can see the complete app has more, but nothing about them is usable:
 * no links, no buttons, nothing focusable, and nothing leads to the full app.
 * Icons match the full app's nav.
 */
const LOCKED = [
  { id: 'budget',        label: 'Budget',        icon: '📊', title: 'Monthly budget limits', text: 'Set a spending limit for each category and see a warning before you go over.' },
  { id: 'goals',         label: 'Goals',         icon: '🎯', title: 'Several savings goals', text: 'Save for school fees, a trip and emergencies at once, each with its own target date.' },
  { id: 'debt',          label: 'Debt',          icon: '💳', title: 'Debt payoff planner', text: 'See which loan to clear first and the month you will be debt-free.' },
  { id: 'subscriptions', label: 'Subscriptions', icon: '🔁', title: 'Subscription tracker', text: 'Keep every monthly and yearly charge in one list and see what is due next.' },
  { id: 'cashflow',      label: 'Cash Flow',     icon: '📈', title: 'Safe Days and cash flow', text: 'See how many days your savings would last, with 12 months of history.' },
  { id: 'coach',         label: 'Coach',         icon: '🧭', title: 'Money coach', text: 'Plain tips from your own numbers, and answers to questions like "Can I afford this?"' },
];

// --- state -------------------------------------------------------------------

let state = load();
let editingIncomeId = null;
let editingExpenseId = null;

function readFullApp() {
  try { return JSON.parse(localStorage.getItem(FULL_APP_KEY)) || {}; } catch { return {}; }
}

function load() {
  const full = readFullApp();
  const fallbackCurrency = (full.profile && full.profile.currency) || 'USD';
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* start clean */ }
  saved = saved && typeof saved === 'object' ? saved : {};
  return {
    currency: CURRENCIES.some((c) => c.code === saved.currency) ? saved.currency : fallbackCurrency,
    income: Array.isArray(saved.income) ? saved.income : [],
    expenses: Array.isArray(saved.expenses) ? saved.expenses : [],
    savings: { goal: num(saved.savings && saved.savings.goal), current: num(saved.savings && saved.savings.current) },
  };
}

function commit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toastError("Could not save: your device's storage may be full or private browsing may block it.");
  }
  render();
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const money = (n) => fmt(n, state.currency, { decimals: 2 });
const totalIncome = () => add(...state.income.map((i) => i.amount));
const totalExpenses = () => add(...state.expenses.map((e) => e.amount));

// --- small form helpers (same markup and classes as the full app) --------------

function field({ label, id, type = 'text', value = '', attrs = {} }) {
  const input = el('input', { type, id, name: id, value, ...attrs });
  return { input, wrap: el('div', { class: 'field' }, [el('label', { for: id }, label), input]) };
}

function selectField({ label, id, options, value }) {
  const select = el('select', { id, name: id });
  for (const o of options) select.appendChild(el('option', { value: o.value, selected: o.value === value }, o.label));
  return { input: select, wrap: el('div', { class: 'field' }, [el('label', { for: id }, label), select]) };
}

const amountAttrs = { min: '0', step: '0.01', inputmode: 'decimal', required: true };

function sectionHead(id, title, caption) {
  return [el('h2', { id: `${id}-title` }, title), el('p', { class: 'hook-caption' }, caption)];
}

// --- summary -------------------------------------------------------------------

function summarySection() {
  const inc = totalIncome();
  const exp = totalExpenses();
  const left = sub(inc, exp);
  const tone = left > 0.004 ? 'is-positive' : left < -0.004 ? 'is-negative' : '';
  const note = !state.income.length && !state.expenses.length
    ? 'Add your income and expenses below to see your budget.'
    : left < -0.004
      ? 'You are spending more than you earn this month. Look at your biggest expenses first.'
      : left > 0.004
        ? 'Nice. Think about moving some of what is left into your savings goal.'
        : 'Every bit of your income is spoken for this month.';

  const stat = (label, value, cls = '') => el('div', { class: `card summary-stat ${cls}` }, [
    el('div', { class: 'muted fs-xs' }, label),
    el('div', { class: 'num' }, value),
  ]);

  return el('section', { class: 'free-section stack', id: 'summary', 'aria-labelledby': 'summary-title' }, [
    ...sectionHead('summary', 'Your budget', 'See where your money goes, and keep more of it.'),
    el('div', { class: 'grid summary-grid' }, [
      stat('Total income', money(inc)),
      stat('Total expenses', money(exp)),
      stat('Money remaining', money(left), tone),
    ]),
    el('p', { class: 'soft' }, note),
    lockedHint('See how many days your savings would last with Safe Days.'),
  ]);
}

// --- income --------------------------------------------------------------------

function incomeSection() {
  const editing = state.income.find((i) => i.id === editingIncomeId) || null;
  const nameF = field({ label: 'Income name or source', id: 'inc-name', value: editing ? editing.name : '', attrs: { required: true, placeholder: 'e.g. Salary' } });
  const amtF = field({ label: 'Amount', id: 'inc-amt', type: 'number', value: editing ? String(editing.amount) : '', attrs: amountAttrs });
  const err = el('div', { class: 'field-error', role: 'alert' });

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const name = nameF.input.value.trim();
    const amount = r2(num(amtF.input.value));
    if (!name) { err.textContent = 'Give this income a name.'; return; }
    if (amount <= 0) { err.textContent = 'Amount must be more than zero.'; return; }
    if (editing) {
      Object.assign(editing, { name, amount });
      editingIncomeId = null;
      toastOk('Income updated.');
    } else {
      state.income.push({ id: uid(), name, amount });
      toastOk('Income added.');
    }
    commit();
  } }, [
    el('h3', {}, editing ? 'Edit income' : 'Add income'),
    el('div', { class: 'form-row' }, [nameF.wrap, amtF.wrap]),
    err,
    el('div', { class: 'row form-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'submit' }, editing ? 'Save changes' : 'Add income'),
      editing ? el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { editingIncomeId = null; render(); } }, 'Cancel') : null,
    ]),
  ]);

  const list = state.income.length
    ? el('div', { class: 'card' }, el('div', { class: 'table-scroll' }, [el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Source'), el('th', { class: 'r' }, 'Amount'), el('th', { class: 'r' }, el('span', { class: 'sr-only' }, 'Actions'))])),
        el('tbody', {}, state.income.map((i) => el('tr', {}, [
          el('td', {}, i.name),
          el('td', { class: 'r num' }, money(i.amount)),
          el('td', {}, el('div', { class: 'row row-actions' }, [
            el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Edit ${i.name}`, onclick: () => { editingIncomeId = i.id; render(); focusForm('inc-name'); } }, 'Edit'),
            el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Delete ${i.name}`, onclick: () => {
              state.income = state.income.filter((x) => x.id !== i.id);
              if (editingIncomeId === i.id) editingIncomeId = null;
              toastOk('Income deleted.');
              commit();
            } }, 'Delete'),
          ])),
        ]))),
        el('tfoot', {}, el('tr', {}, [el('th', {}, 'Total income'), el('th', { class: 'r num' }, money(totalIncome())), el('th', {})])),
      ])]))
    : el('p', { class: 'muted center' }, 'No income added yet.');

  return el('section', { class: 'free-section stack', id: 'income', 'aria-labelledby': 'income-title' }, [
    ...sectionHead('income', 'Income', 'Know exactly what comes in, so you never plan to save more than you have.'),
    form, list,
  ]);
}

// --- expenses ------------------------------------------------------------------

function expensesSection() {
  const editing = state.expenses.find((x) => x.id === editingExpenseId) || null;
  const nameF = field({ label: 'Expense name', id: 'exp-name', value: editing ? editing.name : '', attrs: { required: true, placeholder: 'e.g. Rent' } });
  const catF = selectField({ label: 'Category', id: 'exp-cat', value: editing ? editing.category : 'housing', options: CATEGORIES.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` })) });
  const amtF = field({ label: 'Amount', id: 'exp-amt', type: 'number', value: editing ? String(editing.amount) : '', attrs: amountAttrs });
  const err = el('div', { class: 'field-error', role: 'alert' });

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const name = nameF.input.value.trim();
    const amount = r2(num(amtF.input.value));
    if (!name) { err.textContent = 'Give this expense a name.'; return; }
    if (amount <= 0) { err.textContent = 'Amount must be more than zero.'; return; }
    const record = { name, category: catF.input.value, amount };
    if (editing) {
      Object.assign(editing, record);
      editingExpenseId = null;
      toastOk('Expense updated.');
    } else {
      state.expenses.push({ id: uid(), ...record });
      toastOk('Expense added.');
    }
    commit();
  } }, [
    el('h3', {}, editing ? 'Edit expense' : 'Add expense'),
    el('div', { class: 'form-row' }, [nameF.wrap, catF.wrap, amtF.wrap]),
    err,
    el('div', { class: 'row form-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'submit' }, editing ? 'Save changes' : 'Add expense'),
      editing ? el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { editingExpenseId = null; render(); } }, 'Cancel') : null,
    ]),
  ]);

  const list = state.expenses.length
    ? el('div', { class: 'card' }, el('div', { class: 'table-scroll' }, [el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Expense'), el('th', { class: 'r' }, 'Amount'), el('th', { class: 'r' }, el('span', { class: 'sr-only' }, 'Actions'))])),
        el('tbody', {}, state.expenses.map((x) => el('tr', {}, [
          el('td', {}, [el('div', {}, x.name), el('div', { class: 'muted fs-xs' }, catLabel(x.category))]),
          el('td', { class: 'r num' }, money(x.amount)),
          el('td', {}, el('div', { class: 'row row-actions' }, [
            el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Edit ${x.name}`, onclick: () => { editingExpenseId = x.id; render(); focusForm('exp-name'); } }, 'Edit'),
            el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Delete ${x.name}`, onclick: () => {
              state.expenses = state.expenses.filter((y) => y.id !== x.id);
              if (editingExpenseId === x.id) editingExpenseId = null;
              toastOk('Expense deleted.');
              commit();
            } }, 'Delete'),
          ])),
        ]))),
        el('tfoot', {}, el('tr', {}, [el('th', {}, 'Total expenses'), el('th', { class: 'r num' }, money(totalExpenses())), el('th', {})])),
      ])]))
    : el('p', { class: 'muted center' }, 'No expenses added yet.');

  return el('section', { class: 'free-section stack', id: 'expenses', 'aria-labelledby': 'expenses-title' }, [
    ...sectionHead('expenses', 'Expenses', 'Track every expense, and the leaks stop hiding.'),
    form, list,
    lockedHint('Set a monthly limit for each category.'),
  ]);
}

// --- savings goal ----------------------------------------------------------------

function savingsSection() {
  const { goal, current } = state.savings;
  const goalF = field({ label: 'Savings goal', id: 'sav-goal', type: 'number', value: goal ? String(goal) : '', attrs: { min: '0', step: '0.01', inputmode: 'decimal', placeholder: '0.00' } });
  const curF = field({ label: 'Current savings', id: 'sav-current', type: 'number', value: current ? String(current) : '', attrs: { min: '0', step: '0.01', inputmode: 'decimal', placeholder: '0.00' } });
  const err = el('div', { class: 'field-error', role: 'alert' });

  const form = el('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    const g = r2(num(goalF.input.value));
    const c = r2(num(curF.input.value));
    if (g < 0 || c < 0) { err.textContent = 'Amounts cannot be negative.'; return; }
    state.savings = { goal: g, current: c };
    toastOk('Savings goal saved.');
    commit();
  } }, [
    el('h3', {}, 'Your savings goal'),
    el('div', { class: 'form-row' }, [goalF.wrap, curF.wrap]),
    err,
    el('div', { class: 'row form-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save goal'),
      goal || current ? el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
        state.savings = { goal: 0, current: 0 };
        toastOk('Savings goal cleared.');
        commit();
      } }, 'Clear goal') : null,
    ]),
  ]);

  let progress;
  if (goal > 0) {
    const share = clamp(ratio(current, goal), 0, 1);
    const toGo = Math.max(0, sub(goal, current));
    progress = el('div', { class: 'card stack' }, [
      el('div', { class: 'bar-row' }, [
        el('div', { class: 'row-between' }, [
          el('span', {}, `${Math.round(share * 100)}% of your goal`),
          el('span', { class: 'num muted' }, `${money(current)} / ${money(goal)}`),
        ]),
        el('div', { class: 'bar-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(share * 100)), 'aria-label': 'Savings goal progress' }, [
          el('div', { class: 'bar-fill', style: { width: `${share * 100}%`, background: 'var(--ok)' } }),
        ]),
      ]),
      el('p', { class: 'soft' }, toGo > 0 ? `${money(toGo)} to go.` : 'Goal reached. Well done!'),
    ]);
  } else {
    progress = el('p', { class: 'muted center' }, 'Set a goal above to see your progress.');
  }

  return el('section', { class: 'free-section stack', id: 'savings', 'aria-labelledby': 'savings-title' }, [
    ...sectionHead('savings', 'Savings goal', 'Save first. Spend what is left.'),
    form, progress,
  ]);
}

// --- full version pointers ---------------------------------------------------------

const lockBadge = () => el('span', { class: 'lock-badge', 'aria-hidden': 'true' }, '🔒');

/** One line of plain text noting a related full-version feature. Not a link. */
function lockedHint(text) {
  return el('p', { class: 'locked-hint' }, [lockBadge(), el('span', {}, `${text} `), el('strong', {}, 'Full version')]);
}

/** Read-only cards describing the locked sections. No links or controls inside. */
function fullVersionSection() {
  const cards = LOCKED.map((l) => el('article', { class: 'card locked-card' }, [
    el('span', { class: 'pill locked-pill' }, [lockBadge(), ' Locked']),
    el('h3', { class: 'locked-title' }, [el('span', { 'aria-hidden': 'true' }, l.icon), ` ${l.title}`]),
    el('p', { class: 'soft' }, l.text),
    // Faded stand-in for the real tool: purely visual.
    el('div', { class: 'locked-preview', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]),
  ]));

  return el('section', { class: 'free-section stack', id: 'full-version', 'aria-labelledby': 'full-version-title' }, [
    el('h2', { id: 'full-version-title' }, 'In the full version'),
    el('p', { class: 'hook-caption' }, 'You have the basics. The full AceBudget helps you plan ahead.'),
    el('p', { class: 'soft' }, 'These sections are part of the complete AceBudget and are locked in this free sample.'),
    el('div', { class: 'grid locked-grid' }, cards),
  ]);
}

// --- shell ----------------------------------------------------------------------

function focusForm(id) {
  requestAnimationFrame(() => {
    const input = document.getElementById(id);
    if (!input) return;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
  });
}

function currentSection() {
  const h = location.hash.slice(1);
  if (!h) return 'summary';
  return SECTIONS.some((s) => s.id === h) ? h : null;
}

function render() {
  const full = readFullApp();
  document.documentElement.setAttribute('data-theme', full.settings && full.settings.theme === 'dark' ? 'dark' : 'light');
  const active = currentSection();

  const currency = el('select', { id: 'free-currency', 'aria-label': 'Currency', onchange: (e) => {
    state.currency = e.target.value;
    toastOk(`Currency set to ${state.currency}.`);
    commit();
  } }, CURRENCIES.map((c) => el('option', { value: c.code, selected: c.code === state.currency }, `${c.symbol} ${c.code}`)));

  const topbar = el('header', { class: 'app-topbar' }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '🌱'),
      el('strong', {}, 'AceBudget'),
      el('span', { class: 'pill pill-ok' }, 'Free'),
    ]),
    el('div', { class: 'row free-topbar-actions' }, [currency]),
  ]);

  const nav = el('nav', { class: 'app-nav', 'aria-label': 'Sections' }, [
    ...SECTIONS.map((s) => el('a', {
      href: `#${s.id}`,
      class: `nav-link${s.id === active ? ' nav-link-active' : ''}`,
      'aria-current': s.id === active ? 'true' : null,
    }, [el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, s.icon), el('span', { class: 'nav-label' }, s.label)])),
    el('div', { class: 'nav-divider', 'aria-hidden': 'true' }, 'Full version'),
    // Plain labels, not links: they cannot be clicked, focused or followed.
    ...LOCKED.map((l) => el('div', { class: 'nav-link nav-link-locked', title: 'Available in the full version' }, [
      el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, [l.icon, lockBadge()]),
      el('span', { class: 'nav-label' }, l.label),
    ])),
  ]);

  const content = el('div', { class: 'app-content stack', id: 'main', tabindex: '-1' }, [
    summarySection(),
    incomeSection(),
    expensesSection(),
    savingsSection(),
    fullVersionSection(),
    el('p', { class: 'muted fs-xs center' }, 'Private by design: everything you type stays on this device. No account, no bank password.'),
  ]);

  const scrollY = window.scrollY;
  document.getElementById('app').replaceChildren(el('div', { class: 'app-shell' }, [topbar, nav, el('main', { class: 'app-main' }, content)]));
  window.scrollTo(0, scrollY);
}

window.addEventListener('hashchange', render);
window.addEventListener('storage', (e) => {
  // Keep two open tabs of the free sample in step with each other.
  if (e.key === KEY) { state = load(); render(); }
});
render();

// The browser tries to jump to a #section before it exists, so do it once rendered.
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
