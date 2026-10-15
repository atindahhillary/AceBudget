/**
 * password.js: the show/hide eye for password fields.
 *
 * Wraps an existing <input type="password"> in a box with a button inside its
 * right edge. Pressing the button flips the input between hidden dots and
 * readable text, and pressing it again hides it. Only the input's `type`
 * changes: the value, the form and anything that reads `input.value` behave
 * exactly as they did before, so sign-in, sign-up and PIN checks are untouched.
 */

import { el } from './render.js';

/** Build an SVG node from a fixed markup string (never user input). */
function svgNode(body) {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  return new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
}

// 24px line icons, drawn in currentColor so they follow the theme.
const EYE = svgNode('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>');
const EYE_OFF = svgNode('<path d="M3 3l18 18"/><path d="M10.6 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.1 3.8M6.5 7.3A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>');

/**
 * Add a show/hide eye to a password input.
 * @param {HTMLInputElement} input  an input that starts as type="password"
 * @returns {HTMLElement} a wrapper that holds the input and its eye button
 */
export function passwordInput(input) {
  // Once revealed the field is a plain text box, and phone keyboards would
  // otherwise capitalise or "correct" what is typed. Passwords must stay exact.
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('autocorrect', 'off');
  input.spellcheck = false;

  const status = el('span', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const button = el('button', { type: 'button', class: 'pw-toggle' });
  if (input.id) button.setAttribute('aria-controls', input.id);

  // The icon shows what a press will do: an open eye to show, a crossed eye to hide.
  const paint = (visible) => {
    const label = visible ? 'Hide password' : 'Show password';
    button.replaceChildren((visible ? EYE_OFF : EYE).cloneNode(true));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.classList.toggle('is-on', visible);
  };
  paint(false);

  // Remember whether the field had focus before the press, so typing can carry
  // on in the field afterwards. Keyboard users who tab to the button keep their
  // focus on the button instead.
  let refocus = false;
  button.addEventListener('pointerdown', () => { refocus = document.activeElement === input; });
  // A mouse press would otherwise pull focus out of the field.
  button.addEventListener('mousedown', (e) => e.preventDefault());

  button.addEventListener('click', () => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    paint(reveal);
    status.textContent = reveal ? 'Password shown' : 'Password hidden';
    if (refocus) {
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(start, end); } catch { /* the caret simply lands at the end */ }
    }
    refocus = false;
  });

  return el('div', { class: 'pw-field' }, [input, button, status]);
}
