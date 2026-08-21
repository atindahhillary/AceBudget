/**
 * store.js: the single source of truth.
 *
 * Design constraints that are not negotiable:
 *   1. Data never leaves the device. localStorage only, no network, no telemetry.
 *   2. Every write is atomic and versioned so an import can be rolled back.
 *   3. Subscribers re-render from state; nothing mutates the DOM from a handler.
 */

import { monthKey } from './dates.js';
import { buildXlsxBlob, parseXlsxRows } from './xlsx.js';
import { CATEGORIES, METHODS, INCOME_SOURCES } from '../data/categories.js';

const KEY = 'acebudget.state.v1';
const BACKUP_KEY = 'acebudget.backup.v1';
export const SCHEMA_VERSION = 1;

/** Short, collision-resistant-enough id for a single-device ledger. */
export const uid = (p = 'i') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function emptyState() {
  return {
    schema: SCHEMA_VERSION,
    profile: {
      household: '',
      currency: 'USD',
      incomeType: 'regular',      // 'regular' | 'irregular'
      dependants: 0,
      inflation: 0.06,            // annual, used by the real-terms lens
      createdAt: new Date().toISOString(),
      onboarded: false,
    },
    income: [],          // { id, date, source, amount, method, note }
    transactions: [],    // { id, date, category, amount, method, note }
    budgets: {},         // { 'YYYY-MM': { categoryId: limit } }
    savings: [],         // { id, name, balance, target, kind, apr, liquid }
    goals: [],           // { id, name, target, saved, deadline, priority, monthly }
    debts: [],           // { id, name, balance, apr, minPayment, type, lender }
    subscriptions: [],   // { id, name, amount, cycle, nextCharge, category, status, lastUsed }
    settings: {
      theme: 'light',
      realTerms: false,
      strategy: 'avalanche',      // debt payoff default
      dismissed: [],              // coach insight ids the user has cleared
      lastOpened: monthKey(),
    },
  };
}

let state = load();
const subscribers = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (err) {
    console.warn('[acebudget] state unreadable, starting clean', err);
    return emptyState();
  }
}

/** Fill in anything a older/partial payload is missing. Never throws. */
function migrate(incoming) {
  const base = emptyState();
  if (!incoming || typeof incoming !== 'object') return base;
  const out = {
    ...base,
    ...incoming,
    profile:  { ...base.profile,  ...(incoming.profile  || {}) },
    settings: { ...base.settings, ...(incoming.settings || {}) },
    budgets:  { ...(incoming.budgets || {}) },
  };
  for (const list of ['income', 'transactions', 'savings', 'goals', 'debts', 'subscriptions']) {
    out[list] = Array.isArray(incoming[list]) ? incoming[list] : [];
  }
  out.schema = SCHEMA_VERSION;
  return out;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    // Quota exceeded is the realistic failure here: surface it, never swallow.
    console.error('[acebudget] could not save', err);
    document.dispatchEvent(new CustomEvent('acebudget:save-failed', { detail: err }));
    return false;
  }
}

/** Read-only-by-convention snapshot. */
export const getState = () => state;

/** Subscribe to every committed change. Returns an unsubscribe function. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify() {
  for (const fn of subscribers) {
    try { fn(state); } catch (err) { console.error('[acebudget] subscriber failed', err); }
  }
}

/**
 * Commit a change. `recipe` receives a draft and mutates it in place.
 *   update(d => { d.debts.push(debt); });
 */
export function update(recipe) {
  const draft = structuredClone(state);
  recipe(draft);
  state = draft;
  persist();
  notify();
  return state;
}

// --- collection helpers ---------------------------------------------------

export function addItem(list, item) {
  const record = { id: uid(list.slice(0, 3)), ...item };
  update((d) => { d[list].unshift(record); });
  return record;
}

export function patchItem(list, id, patch) {
  update((d) => {
    const i = d[list].findIndex((x) => x.id === id);
    if (i > -1) d[list][i] = { ...d[list][i], ...patch };
  });
}

export function removeItem(list, id) {
  update((d) => { d[list] = d[list].filter((x) => x.id !== id); });
}

export function setProfile(patch) {
  update((d) => { d.profile = { ...d.profile, ...patch }; });
}

export function setSetting(key, value) {
  update((d) => { d.settings[key] = value; });
}

export function setBudget(month, category, limit) {
  update((d) => {
    d.budgets[month] = d.budgets[month] || {};
    if (limit === null || limit === '' || Number(limit) === 0) delete d.budgets[month][category];
    else d.budgets[month][category] = Number(limit);
  });
}

/** Copy an entire month of category limits forward: the rollover a doc cannot do. */
export function copyBudget(fromMonth, toMonth) {
  update((d) => { d.budgets[toMonth] = { ...(d.budgets[fromMonth] || {}) }; });
}

// --- portability ----------------------------------------------------------

/** Everything, as a pretty-printed JSON string. This is the user's data, whole. */
export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

/**
 * Replace state from a JSON payload, keeping a one-step undo.
 * @returns {{ok:boolean, error?:string}}
 */
export function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || !('profile' in parsed)) {
    return { ok: false, error: 'That does not look like an AceBudget backup.' };
  }
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(state)); } catch { /* best effort */ }
  state = migrate(parsed);
  persist();
  notify();
  return { ok: true };
}

/** Restore the snapshot taken immediately before the last import. */
export function undoImport() {
  const raw = localStorage.getItem(BACKUP_KEY);
  if (!raw) return false;
  state = migrate(JSON.parse(raw));
  persist();
  notify();
  return true;
}

// --- Excel (.xlsx) export/import ------------------------------------------
//
// Word, PDF and photo files are attach-only in AceBudget (stored as a
// reference on a transaction, never auto-read): parsing those formats
// reliably needs libraries this project deliberately doesn't carry. Excel
// is different: a spreadsheet is already structured rows and columns, so
// reading it back is safe and genuinely useful, not a guess.

const findByName = (list, name) => list.find((x) => x.name.toLowerCase() === String(name || '').toLowerCase());

function nameToId(list, name, fallbackId) {
  const hit = findByName(list, name) || list.find((x) => x.id === name);
  return hit ? hit.id : fallbackId;
}

/** Build a real .xlsx Blob covering every record in the ledger, one sheet per list. */
export function exportXlsxBlob() {
  const s = state;
  const catName = (id) => (CATEGORIES.find((c) => c.id === id) || { name: id || 'Other' }).name;
  const methodName = (id) => (METHODS.find((m) => m.id === id) || { name: id || '' }).name;
  const sourceName = (id) => (INCOME_SOURCES.find((x) => x.id === id) || { name: id || 'Other' }).name;

  const sheets = [
    {
      name: 'Transactions',
      rows: [
        ['Date', 'Category', 'Amount', 'Method', 'Note'],
        ...s.transactions.map((t) => [t.date || '', catName(t.category), Number(t.amount) || 0, methodName(t.method), t.note || '']),
      ],
    },
    {
      name: 'Income',
      rows: [
        ['Date', 'Source', 'Amount', 'Method', 'Note'],
        ...s.income.map((i) => [i.date || '', sourceName(i.source), Number(i.amount) || 0, methodName(i.method), i.note || '']),
      ],
    },
    {
      name: 'Savings',
      rows: [
        ['Name', 'Balance', 'Target', 'APR %', 'Kind', 'Liquid'],
        ...s.savings.map((a) => [a.name || '', Number(a.balance) || 0, Number(a.target) || 0, Number(a.apr) || 0, a.kind || '', a.liquid === false ? 'No' : 'Yes']),
      ],
    },
    {
      name: 'Goals',
      rows: [
        ['Name', 'Target', 'Saved', 'Monthly', 'Deadline', 'Priority'],
        ...s.goals.map((g) => [g.name || '', Number(g.target) || 0, Number(g.saved) || 0, Number(g.monthly) || 0, g.deadline || '', Number(g.priority) || 0]),
      ],
    },
    {
      name: 'Debts',
      rows: [
        ['Name', 'Type', 'Balance', 'APR %', 'Min. payment', 'Lender'],
        ...s.debts.map((d) => [d.name || '', d.type || '', Number(d.balance) || 0, Number(d.apr) || 0, Number(d.minPayment) || 0, d.lender || '']),
      ],
    },
    {
      name: 'Subscriptions',
      rows: [
        ['Name', 'Amount', 'Cycle', 'Next charge', 'Status'],
        ...s.subscriptions.map((x) => [x.name || '', Number(x.amount) || 0, x.cycle || '', x.nextCharge || '', x.status || 'active']),
      ],
    },
  ];
  return buildXlsxBlob(sheets);
}

/**
 * Import transactions/income from an .xlsx workbook. Reads sheets named
 * "Transactions" and "Income" (case-insensitive), matching the layout
 * `exportXlsxBlob()` produces. Rows are appended, not merged: re-importing
 * the same file twice will duplicate entries.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ok:boolean, added?:number, error?:string}>}
 */
export async function importXlsx(buffer) {
  let sheets;
  try {
    sheets = await parseXlsxRows(buffer);
  } catch (err) {
    return { ok: false, error: err.message || 'Could not read that Excel file.' };
  }

  const byName = (n) => sheets.find((s) => s.name.toLowerCase() === n);
  const txSheet = byName('transactions');
  const incSheet = byName('income');
  if (!txSheet && !incSheet) {
    return { ok: false, error: 'No "Transactions" or "Income" sheet found. Expected columns: Date, Category/Source, Amount, Method, Note.' };
  }

  let added = 0;
  update((d) => {
    for (const row of (txSheet?.rows || []).slice(1)) {
      if (!row || !row.some((c) => c !== undefined && c !== '')) continue;
      const amount = Number(row[2]);
      if (!row[0] || !Number.isFinite(amount) || amount <= 0) continue;
      d.transactions.unshift({
        id: uid('tx'), date: String(row[0]), category: nameToId(CATEGORIES, row[1], 'other'),
        amount, method: nameToId(METHODS, row[3], 'cash'), note: row[4] ? String(row[4]) : '',
      });
      added++;
    }
    for (const row of (incSheet?.rows || []).slice(1)) {
      if (!row || !row.some((c) => c !== undefined && c !== '')) continue;
      const amount = Number(row[2]);
      if (!row[0] || !Number.isFinite(amount) || amount <= 0) continue;
      d.income.unshift({
        id: uid('inc'), date: String(row[0]), source: nameToId(INCOME_SOURCES, row[1], 'other-inc'),
        amount, method: nameToId(METHODS, row[3], 'cash'), note: row[4] ? String(row[4]) : '',
      });
      added++;
    }
  });
  return { ok: true, added };
}

/** Wipe everything on this device. Irreversible by design. */
export function resetAll() {
  state = emptyState();
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(BACKUP_KEY);
  } catch { /* ignore */ }
  persist();
  notify();
}
