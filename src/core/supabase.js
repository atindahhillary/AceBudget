/**
 * supabase.js: a tiny, dependency-free Supabase client.
 *
 * The project carries no npm packages and loads nothing from a CDN, so rather
 * than pull in supabase-js this talks to the two REST APIs directly with
 * fetch: GoTrue (/auth/v1) for accounts and PostgREST (/rest/v1) for data.
 *
 * The publishable key below is meant to be public. It grants nothing on its
 * own: every AceBudget table is protected by row level security, so a signed
 * in user can only ever read and write their own rows.
 *
 * Nothing here runs unless the user chooses to sign in. Signed out, the apps
 * stay entirely local and this module makes no network calls at all.
 */

export const SUPABASE_URL = 'https://tyaergniqnrntaubpgiz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_24KrDbgnuRiVrpkXsj1eIg_8A5u_VJB';

/**
 * Google sign-in needs an OAuth client created in Google Cloud and pasted into
 * Supabase (Authentication > Providers > Google). Until that is done the
 * button would fail, so it stays hidden: flip this to true once it is set up.
 * See docs/SUPABASE-SETUP.md.
 */
export const GOOGLE_ENABLED = false;

const SESSION_KEY = 'acebudget.session.v1';

let session = loadSession();
const listeners = new Set();

// --- session -----------------------------------------------------------------

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.access_token ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private browsing: stay signed in for this tab only */ }
  for (const fn of listeners) {
    try { fn(session); } catch (err) { console.error('[acebudget] auth listener failed', err); }
  }
}

/** Shape a GoTrue token response into what we keep on disk. */
function toSession(payload) {
  if (!payload || !payload.access_token) return null;
  const expiresIn = Number(payload.expires_in) || 3600;
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Date.now() + expiresIn * 1000,
    user: payload.user ? { id: payload.user.id, email: payload.user.email } : (session && session.user) || null,
  };
}

export const getSession = () => session;
export const isSignedIn = () => !!(session && session.access_token);
export const currentUser = () => (session && session.user) || null;

/** Subscribe to sign in and sign out. Returns an unsubscribe function. */
export function onAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- auth --------------------------------------------------------------------

async function authFetch(path, body, { method = 'POST', token } = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* logout returns an empty body */ }
  if (!res.ok) {
    const message = (payload && (payload.error_description || payload.msg || payload.message)) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return payload;
}

/**
 * Create an account. Supabase sends a confirmation email by default, in which
 * case no session comes back and the user has to click the link first.
 * @returns {Promise<{ok:boolean, needsConfirmation?:boolean, error?:string}>}
 */
export async function signUp(email, password) {
  try {
    const payload = await authFetch('/signup', { email, password });
    const next = toSession(payload);
    if (next) {
      saveSession(next);
      return { ok: true, needsConfirmation: false };
    }
    return { ok: true, needsConfirmation: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function signIn(email, password) {
  try {
    const payload = await authFetch('/token?grant_type=password', { email, password });
    saveSession(toSession(payload));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Send a password reset email. */
export async function resetPassword(email, redirectTo = location.href.split('#')[0]) {
  try {
    await authFetch('/recover', { email, gotrue_meta_security: {} , redirect_to: redirectTo });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Hand off to Google. Comes back to `redirectTo` with tokens in the URL hash. */
export function signInWithGoogle(redirectTo = location.href.split('#')[0]) {
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  location.assign(url);
}

/**
 * Pick up tokens Google left in the URL hash after a redirect, then clean the
 * address bar so they are not left sitting in history.
 * @returns {{signedIn:boolean, error?:string}}
 */
export function consumeOAuthRedirect() {
  const hash = location.hash || '';
  if (!hash.includes('access_token=') && !hash.includes('error=')) return { signedIn: false };

  const params = new URLSearchParams(hash.slice(1));
  const clean = () => history.replaceState(null, '', location.pathname + location.search);

  const error = params.get('error_description') || params.get('error');
  if (error) {
    clean();
    return { signedIn: false, error };
  }

  const next = toSession({
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    expires_in: params.get('expires_in'),
  });
  clean();
  if (!next) return { signedIn: false };
  saveSession(next);
  return { signedIn: true };
}

export async function signOut() {
  const token = session && session.access_token;
  saveSession(null);
  if (!token) return;
  try { await authFetch('/logout', {}, { token }); } catch { /* local sign out already done */ }
}

/** Swap an expiring access token for a fresh one. */
async function refresh() {
  if (!session || !session.refresh_token) return false;
  try {
    const payload = await authFetch('/token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    saveSession(toSession(payload));
    return true;
  } catch {
    saveSession(null); // refresh token is dead: force a fresh sign in
    return false;
  }
}

/** Fetch the signed-in user, confirming the token still works. */
export async function fetchUser() {
  if (!(await ensureFreshToken())) return null;
  try {
    const user = await authFetch('/user', null, { method: 'GET', token: session.access_token });
    if (user && user.id) saveSession({ ...session, user: { id: user.id, email: user.email } });
    return user;
  } catch {
    return null;
  }
}

async function ensureFreshToken() {
  if (!isSignedIn()) return false;
  if (Date.now() < session.expires_at - 60_000) return true;
  return refresh();
}

// --- data (PostgREST) ----------------------------------------------------------

async function restFetch(path, { method = 'GET', body, headers = {} } = {}) {
  if (!(await ensureFreshToken())) throw new Error('Not signed in.');
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      detail = payload.message || payload.hint || detail;
    } catch { /* keep the status text */ }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  try { return await res.json(); } catch { return null; }
}

/**
 * Read this user's saved copy of an app's data.
 * @param {'full'|'free'} app
 * @returns {Promise<{data:object, updatedAt:string}|null>} null when nothing is saved yet
 */
export async function pullState(app) {
  const user = currentUser();
  if (!user) throw new Error('Not signed in.');
  const rows = await restFetch(`/acebudget_states?user_id=eq.${user.id}&app=eq.${app}&select=data,updated_at`);
  if (!Array.isArray(rows) || !rows.length) return null;
  return { data: rows[0].data || {}, updatedAt: rows[0].updated_at };
}

/**
 * Save this user's copy of an app's data, replacing whatever was there.
 * @param {'full'|'free'} app
 * @param {object} data
 */
export async function pushState(app, data) {
  const user = currentUser();
  if (!user) throw new Error('Not signed in.');
  await restFetch('/acebudget_states', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: [{ user_id: user.id, app, data, updated_at: new Date().toISOString() }],
  });
}

/** The signed-in user's AceBudget profile row, including which plan they are on. */
export async function fetchProfile() {
  const user = currentUser();
  if (!user) return null;
  const rows = await restFetch(`/acebudget_profiles?id=eq.${user.id}&select=id,email,household,plan`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
