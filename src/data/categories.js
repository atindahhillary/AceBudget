/**
 * categories.js: the spending taxonomy.
 *
 * `tier` is the load-bearing field. Runway, shock tests and the coach all
 * depend on knowing which spending is genuinely non-negotiable:
 *   essential  : stops only if the household stops
 *   lifestyle  : discretionary, compressible under stress
 *   financial  : debt service, saving, investing (flows, not consumption)
 */

export const CATEGORIES = [
  // --- essential ---------------------------------------------------------
  { id: 'housing',    name: 'Rent / Mortgage',   tier: 'essential', icon: '🏠', color: '#0a7d5b' },
  { id: 'utilities',  name: 'Utilities',         tier: 'essential', icon: '💡', color: '#129c70' },
  { id: 'groceries',  name: 'Groceries',         tier: 'essential', icon: '🧺', color: '#2fba89' },
  { id: 'transport',  name: 'Transport / Fuel',  tier: 'essential', icon: '🚌', color: '#63d2a8' },
  { id: 'health',     name: 'Health & Medical',  tier: 'essential', icon: '⚕️', color: '#0e8f96' },
  { id: 'education',  name: 'School Fees',       tier: 'essential', icon: '🎓', color: '#1a7fa8' },
  { id: 'childcare',  name: 'Childcare',         tier: 'essential', icon: '🧸', color: '#3a93bd' },
  { id: 'insurance',  name: 'Insurance',         tier: 'essential', icon: '🛡️', color: '#5aa7cc' },
  { id: 'comms',      name: 'Phone & Internet',  tier: 'essential', icon: '📶', color: '#7cb9d6' },

  // --- lifestyle ---------------------------------------------------------
  { id: 'dining',     name: 'Eating Out',        tier: 'lifestyle', icon: '🍽️', color: '#e9a530' },
  { id: 'shopping',   name: 'Shopping',          tier: 'lifestyle', icon: '🛍️', color: '#f8c15c' },
  { id: 'fun',        name: 'Entertainment',     tier: 'lifestyle', icon: '🎬', color: '#ffd98a' },
  { id: 'subs',       name: 'Subscriptions',     tier: 'lifestyle', icon: '🔁', color: '#e5533d' },
  { id: 'personal',   name: 'Personal Care',     tier: 'lifestyle', icon: '💈', color: '#ff9d8a' },
  { id: 'travel',     name: 'Travel',            tier: 'lifestyle', icon: '✈️', color: '#ffb3a7' },
  { id: 'gifts',      name: 'Gifts & Giving',    tier: 'lifestyle', icon: '🎁', color: '#d98ac4' },
  { id: 'family',     name: 'Family Support',    tier: 'lifestyle', icon: '🤝', color: '#b57fd6' },

  // --- financial ---------------------------------------------------------
  { id: 'debt',       name: 'Debt Repayment',    tier: 'financial', icon: '💳', color: '#6b5ce0' },
  { id: 'saving',     name: 'Savings Transfer',  tier: 'financial', icon: '🏦', color: '#8b7ff0' },
  { id: 'invest',     name: 'Investing',         tier: 'financial', icon: '📈', color: '#a99cf5' },
  { id: 'fees',       name: 'Bank & Wallet Fees',tier: 'financial', icon: '🧾', color: '#8d9aa6' },
  { id: 'other',      name: 'Other',             tier: 'lifestyle', icon: '•',  color: '#9aada6' },
];

export const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const catName  = (id) => (CAT_MAP[id] || CAT_MAP.other).name;
export const catIcon  = (id) => (CAT_MAP[id] || CAT_MAP.other).icon;
export const catColor = (id) => (CAT_MAP[id] || CAT_MAP.other).color;
export const catTier  = (id) => (CAT_MAP[id] || CAT_MAP.other).tier;
export const isEssential = (id) => catTier(id) === 'essential';

/** Payment rails: deliberately not bank-centric. */
export const METHODS = [
  { id: 'cash',   name: 'Cash',         icon: '💵' },
  { id: 'mobile', name: 'Mobile Money', icon: '📱' },
  { id: 'bank',   name: 'Bank Transfer',icon: '🏛️' },
  { id: 'card',   name: 'Card',         icon: '💳' },
];
export const METHOD_MAP = Object.fromEntries(METHODS.map((m) => [m.id, m]));
export const methodName = (id) => (METHOD_MAP[id] || { name: '-' }).name;
export const methodIcon = (id) => (METHOD_MAP[id] || { icon: '•' }).icon;

/** Income source archetypes, used to seed volatility expectations. */
export const INCOME_SOURCES = [
  { id: 'salary',     name: 'Salary',            regular: true },
  { id: 'business',   name: 'Business / Trading',regular: false },
  { id: 'freelance',  name: 'Freelance / Gig',   regular: false },
  { id: 'commission', name: 'Commission',        regular: false },
  { id: 'farm',       name: 'Farm / Seasonal',   regular: false },
  { id: 'rental',     name: 'Rental Income',     regular: true },
  { id: 'remittance', name: 'Remittance',        regular: false },
  { id: 'pension',    name: 'Pension / Grant',   regular: true },
  { id: 'other-inc',  name: 'Other',             regular: false },
];
export const INCOME_MAP = Object.fromEntries(INCOME_SOURCES.map((s) => [s.id, s]));
export const sourceName = (id) => (INCOME_MAP[id] || { name: 'Other' }).name;

/** Debt archetypes. `typicalApr` only seeds the form: users override it. */
export const DEBT_TYPES = [
  { id: 'card',     name: 'Credit Card',        typicalApr: 24 },
  { id: 'mobile',   name: 'Mobile Loan',        typicalApr: 120 },
  { id: 'bnpl',     name: 'Buy Now Pay Later',  typicalApr: 30 },
  { id: 'personal', name: 'Personal Loan',      typicalApr: 18 },
  { id: 'salary',   name: 'Salary Advance',     typicalApr: 60 },
  { id: 'sacco',    name: 'SACCO / Chama',      typicalApr: 12 },
  { id: 'auto',     name: 'Car Loan',           typicalApr: 11 },
  { id: 'student',  name: 'Student Loan',       typicalApr: 7 },
  { id: 'mortgage', name: 'Mortgage',           typicalApr: 8 },
  { id: 'family',   name: 'Family / Informal',  typicalApr: 0 },
];
export const DEBT_MAP = Object.fromEntries(DEBT_TYPES.map((d) => [d.id, d]));
export const debtTypeName = (id) => (DEBT_MAP[id] || { name: 'Loan' }).name;

export const CYCLES = [
  { id: 'weekly',    name: 'Weekly' },
  { id: 'fortnight', name: 'Every 2 weeks' },
  { id: 'monthly',   name: 'Monthly' },
  { id: 'quarterly', name: 'Quarterly' },
  { id: 'annual',    name: 'Annually' },
];
