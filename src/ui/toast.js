/**
 * toast.js: a tiny, dependency-free toast/notification helper.
 * Mounts a single stack container lazily and reuses it for every call.
 */

let container = null;

function ensureContainer() {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'toast-stack';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

/**
 * Show a toast.
 * @param {string} message
 * @param {{type?:'info'|'ok'|'warn'|'bad', duration?:number}} [opts]
 * @returns {() => void} a function that dismisses the toast early
 */
export function toast(message, opts = {}) {
  const { type = 'info', duration = 4200 } = opts;
  const host = ensureContainer();
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.textContent = message;
  node.tabIndex = 0;
  host.appendChild(node);

  requestAnimationFrame(() => node.classList.add('toast-in'));

  let dismissed = false;
  const remove = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    node.classList.remove('toast-in');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };

  const timer = setTimeout(remove, duration);
  node.addEventListener('click', remove);
  return remove;
}

export const toastOk = (msg, opts) => toast(msg, { ...opts, type: 'ok' });
export const toastWarn = (msg, opts) => toast(msg, { ...opts, type: 'warn' });
export const toastError = (msg, opts) => toast(msg, { ...opts, type: 'bad' });
