/**
 * auth.js: the shared sign-in panel used by the full app and the free sample.
 *
 * Signing in is always optional. Both apps work fully signed out; an account
 * only adds a backup you can open on another device.
 */

import { el } from './render.js';
import { passwordInput } from './password.js';
import { toastOk, toastError } from './toast.js';
import {
  GOOGLE_ENABLED, isSignedIn, currentUser,
  signIn, signUp, signOut, signInWithGoogle, resetPassword, updatePassword,
} from '../core/supabase.js';

const STATUS_TONE = { synced: 'pill-ok', syncing: 'pill-info', error: 'pill-bad', offline: 'pill', idle: 'pill-info' };

/**
 * The full-screen sign-in gate. Both apps show this until someone is signed in.
 *
 * An existing session is enough to get in, so the app still opens offline;
 * only a token the server actively rejects sends someone back here.
 *
 * @param {object} opts
 * @param {Function} opts.rerender  redraw the host app once signed in
 * @param {string} [opts.title]
 * @param {string} [opts.subtitle]
 * @returns {HTMLElement}
 */
export function authGate({ rerender, title = 'Sign in to AceBudget', subtitle = 'Your budget is saved to your account, so you can open it on any device.' }) {
  return el('div', { class: 'onboard-body' }, [
    el('div', { class: 'wrap onboard-wrap stack' }, [
      el('h1', {}, title),
      el('p', { class: 'soft' }, subtitle),
      accountPanel({ sync: null, rerender, gate: true }),
    ]),
  ]);
}

/**
 * Shown after someone opens a password-reset link: they are signed in, but must
 * choose a new password before the app opens.
 */
export function newPasswordGate({ rerender }) {
  const err = el('div', { class: 'field-error', role: 'alert' });
  const mk = (label, id) => {
    const input = el('input', { type: 'password', id, name: id, autocomplete: 'new-password' });
    return { input, wrap: el('div', { class: 'field' }, [el('label', { for: id }, label), passwordInput(input)]) };
  };
  const pw = mk('New password', 'new-password');
  const again = mk('Confirm new password', 'new-password-confirm');
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save password');

  const form = el('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pw.input.value.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }
    if (pw.input.value !== again.input.value) { err.textContent = 'The two passwords do not match.'; return; }
    btn.disabled = true;
    const result = await updatePassword(pw.input.value);
    btn.disabled = false;
    if (!result.ok) { err.textContent = result.error || 'Could not save the password.'; return; }
    toastOk('Password saved. You are signed in.');
    rerender();
  } }, [
    el('div', { class: 'form-row' }, [pw.wrap, again.wrap]),
    err,
    el('div', { class: 'row form-actions' }, [btn]),
  ]);

  return el('div', { class: 'onboard-body' }, [
    el('div', { class: 'wrap onboard-wrap stack' }, [
      el('h1', {}, 'Set your password'),
      el('p', { class: 'soft' }, 'Choose a password for your AceBudget account. You will use it to sign in from now on.'),
      el('div', { class: 'card stack' }, [form]),
    ]),
  ]);
}

/**
 * Build the account panel.
 * @param {object} opts
 * @param {object} opts.sync       the sync handle from createSync()
 * @param {Function} opts.rerender call to redraw the host view after auth changes
 * @param {boolean} [opts.compact] tighter copy for the free sample
 * @returns {HTMLElement}
 */
export function accountPanel({ sync, rerender, compact = false, gate = false }) {
  return isSignedIn() ? signedInPanel({ sync, rerender }) : signedOutPanel({ sync, rerender, compact, gate });
}

const STATUS_LABEL = {
  syncing: 'Syncing',
  synced: 'Backed up',
  error: 'Sync problem',
  idle: 'Signed in',
  offline: 'This device only',
};

function statusPill(sync) {
  const s = sync ? sync.getStatus() : { state: 'offline', message: '' };
  return el('span', { class: `pill ${STATUS_TONE[s.state] || 'pill'}` }, STATUS_LABEL[s.state] || 'This device only');
}

function signedInPanel({ sync, rerender }) {
  const user = currentUser() || {};
  const status = sync ? sync.getStatus() : null;

  return el('div', { class: 'card stack' }, [
    el('div', { class: 'row-between' }, [
      el('h3', {}, 'Your account'),
      statusPill(sync),
    ]),
    el('p', { class: 'soft' }, `Signed in as ${user.email || 'your account'}.`),
    status && status.message ? el('p', { class: 'muted fs-xs' }, status.message) : null,
    el('div', { class: 'row form-actions' }, [
      el('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          const result = await sync.syncNow();
          btn.disabled = false;
          if (result.ok) toastOk(result.direction === 'down' ? 'Pulled your saved budget from your account.' : 'Backed up to your account.');
          else toastError(result.error || 'Could not sync.');
          rerender();
        },
      }, 'Sync now'),
      el('button', {
        class: 'btn btn-quiet', type: 'button',
        onclick: async () => {
          await signOut();
          toastOk('Signed out. Your budget stays on this device.');
          rerender();
        },
      }, 'Sign out'),
    ]),
  ]);
}

function signedOutPanel({ sync, rerender, compact, gate = false }) {
  let mode = 'in'; // 'in' or 'up'
  const err = el('div', { class: 'field-error', role: 'alert' });
  const note = el('p', { class: 'muted fs-xs' });

  const emailF = field('Email', 'auth-email', 'email');
  const passF = field('Password', 'auth-password', 'password');

  const submitBtn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
  const switchBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'New here? Create an account');

  switchBtn.addEventListener('click', () => {
    mode = mode === 'in' ? 'up' : 'in';
    submitBtn.textContent = mode === 'in' ? 'Sign in' : 'Create account';
    switchBtn.textContent = mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in';
    err.textContent = '';
    note.textContent = '';
  });

  const form = el('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const email = emailF.input.value.trim();
    const password = passF.input.value;
    err.textContent = '';
    note.textContent = '';
    if (!email) { err.textContent = 'Enter your email.'; return; }
    if (password.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }

    submitBtn.disabled = true;
    const result = mode === 'in' ? await signIn(email, password) : await signUp(email, password);
    submitBtn.disabled = false;

    if (!result.ok) { err.textContent = result.error || 'That did not work.'; return; }
    if (result.needsConfirmation) {
      note.textContent = 'Check your email for a confirmation link, then come back and sign in.';
      return;
    }
    toastOk('Signed in. Your budget will be backed up to your account.');
    rerender();
  } }, [
    el('div', { class: 'form-row' }, [emailF.wrap, passF.wrap]),
    err,
    el('div', { class: 'row form-actions' }, [submitBtn, switchBtn]),
    note,
  ]);

  const googleBtn = GOOGLE_ENABLED
    ? el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => signInWithGoogle() }, 'Continue with Google')
    : null;

  const forgot = el('button', {
    class: 'btn btn-quiet btn-sm', type: 'button',
    onclick: async () => {
      const email = emailF.input.value.trim();
      if (!email) { err.textContent = 'Enter your email first, then tap this again.'; return; }
      const result = await resetPassword(email);
      if (result.ok) note.textContent = 'If that email has an account, a reset link is on its way.';
      else err.textContent = result.error || 'Could not send a reset link.';
    },
  }, 'Forgot password?');

  return el('div', { class: 'card stack' }, [
    el('div', { class: 'row-between' }, [
      el('h3', {}, gate ? 'Sign in or create an account' : compact ? 'Save your budget' : 'Sign in to back up your budget'),
      gate ? null : statusPill(sync),
    ]),
    el('p', { class: 'soft' }, gate
      ? 'Your budget is saved to your account and kept on this device too, so it keeps working offline once you are in.'
      : compact
        ? 'Create a free account to keep this budget if you change device or clear your browser.'
        : 'Sign in and your budget is saved to your account as well as this device, so you can open it anywhere.'),
    googleBtn,
    googleBtn ? el('p', { class: 'muted fs-xs center' }, 'or use email') : null,
    form,
    forgot,
  ]);
}

function field(label, id, type) {
  const input = el('input', { type, id, name: id, autocomplete: type === 'password' ? 'current-password' : 'email' });
  const control = type === 'password' ? passwordInput(input) : input;
  return { input, wrap: el('div', { class: 'field' }, [el('label', { for: id }, label), control]) };
}
