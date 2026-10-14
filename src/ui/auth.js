/**
 * auth.js: the shared sign-in panel used by the full app and the free sample.
 *
 * Signing in is always optional. Both apps work fully signed out; an account
 * only adds a backup you can open on another device.
 */

import { el } from './render.js';
import { toastOk, toastError } from './toast.js';
import {
  GOOGLE_ENABLED, isSignedIn, currentUser,
  signIn, signUp, signOut, signInWithGoogle, resetPassword,
} from '../core/supabase.js';

const STATUS_TONE = { synced: 'pill-ok', syncing: 'pill-info', error: 'pill-bad', offline: 'pill', idle: 'pill-info' };

/**
 * Build the account panel.
 * @param {object} opts
 * @param {object} opts.sync       the sync handle from createSync()
 * @param {Function} opts.rerender call to redraw the host view after auth changes
 * @param {boolean} [opts.compact] tighter copy for the free sample
 * @returns {HTMLElement}
 */
export function accountPanel({ sync, rerender, compact = false }) {
  return isSignedIn() ? signedInPanel({ sync, rerender }) : signedOutPanel({ sync, rerender, compact });
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

function signedOutPanel({ sync, rerender, compact }) {
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
      el('h3', {}, compact ? 'Save your budget' : 'Sign in to back up your budget'),
      statusPill(sync),
    ]),
    el('p', { class: 'soft' }, compact
      ? 'Optional. Create a free account to keep this budget if you change device or clear your browser.'
      : 'Optional. Without an account everything stays on this device. Sign in and your budget is also saved to your account, so you can open it on another device.'),
    googleBtn,
    googleBtn ? el('p', { class: 'muted fs-xs center' }, 'or use email') : null,
    form,
    forgot,
  ]);
}

function field(label, id, type) {
  const input = el('input', { type, id, name: id, autocomplete: type === 'password' ? 'current-password' : 'email' });
  return { input, wrap: el('div', { class: 'field' }, [el('label', { for: id }, label), input]) };
}
