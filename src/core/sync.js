/**
 * sync.js: local-first cloud sync, shared by the full app and the free sample.
 *
 * The device stays the source of truth. Everything is written to localStorage
 * first, so the app keeps working with no network once someone is signed in.
 * This mirrors that local copy to Supabase and pulls it back on other devices.
 *
 * Conflicts are settled by "newest wins" on a timestamp stamped at save time.
 * That is the honest limit of this design: if the same household edits on two
 * devices while offline, the later save replaces the earlier one rather than
 * merging them line by line.
 */

import { isSignedIn, pullState, pushState, onAuth } from './supabase.js';

const PUSH_DELAY_MS = 1500;

/**
 * Wire one app's local store to the cloud copy.
 *
 * @param {object} opts
 * @param {'full'|'free'} opts.app          which saved copy this is
 * @param {() => object} opts.readLocal     current local state
 * @param {(data:object) => void} opts.writeLocal  replace local state
 * @param {(state:object) => string} opts.stampOf  that state's last-changed time
 * @param {(status:object) => void} [opts.onStatus] told about every change
 * @returns {{syncNow:Function, schedulePush:Function, getStatus:Function}}
 */
export function createSync({ app, readLocal, writeLocal, stampOf, onStatus }) {
  let status = { state: 'offline', message: '', at: null, pending: false };
  let timer = null;

  const setStatus = (state, message = '') => {
    status = { state, message, at: new Date().toISOString(), pending: status.pending };
    if (onStatus) onStatus(status);
  };

  const getStatus = () => status;

  /** Newer of the two wins. Missing stamps are treated as very old. */
  const isRemoteNewer = (remoteUpdatedAt, localStamp) => {
    const remote = Date.parse(remoteUpdatedAt || '') || 0;
    const local = Date.parse(localStamp || '') || 0;
    return remote > local;
  };

  /** Pull, decide which copy is newer, and settle the difference. */
  async function syncNow({ silent = false } = {}) {
    if (!isSignedIn()) {
      setStatus('offline', 'Not signed in. Saved on this device only.');
      return { ok: false };
    }
    if (!silent) setStatus('syncing', 'Syncing...');
    try {
      const remote = await pullState(app);
      const local = readLocal();
      const localStamp = stampOf(local);

      if (!remote) {
        await pushState(app, local);
        setStatus('synced', 'Backed up to your account.');
        return { ok: true, direction: 'up' };
      }

      if (isRemoteNewer(remote.updatedAt, localStamp)) {
        writeLocal(remote.data);
        setStatus('synced', 'Updated from your account.');
        return { ok: true, direction: 'down' };
      }

      await pushState(app, local);
      setStatus('synced', 'Backed up to your account.');
      return { ok: true, direction: 'up' };
    } catch (err) {
      setStatus('error', err.message || 'Could not sync.');
      return { ok: false, error: err.message };
    }
  }

  /** Called after every local change. Batches rapid edits into one upload. */
  function schedulePush() {
    if (!isSignedIn()) return;
    status.pending = true;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await pushState(app, readLocal());
        status.pending = false;
        setStatus('synced', 'Backed up to your account.');
      } catch (err) {
        status.pending = false;
        setStatus('error', err.message || 'Could not save to your account.');
      }
    }, PUSH_DELAY_MS);
  }

  // Sync on sign in, and stop claiming to be synced on sign out.
  onAuth((session) => {
    if (session) syncNow();
    else setStatus('offline', 'Signed out. Saved on this device only.');
  });

  // Last chance to flush a pending edit when the tab goes away.
  window.addEventListener('pagehide', () => {
    if (status.pending && isSignedIn()) {
      clearTimeout(timer);
      pushState(app, readLocal()).catch(() => { /* nothing more we can do here */ });
    }
  });

  if (isSignedIn()) setStatus('idle', 'Signed in.');
  else setStatus('offline', 'Saved on this device only.');

  return { syncNow, schedulePush, getStatus };
}
