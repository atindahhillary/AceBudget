/**
 * render.js: dependency-free DOM and inline-SVG helpers shared by every view.
 * No external chart library, no CDN fonts or images: everything here is a
 * template string or a handful of DOM calls, so it stays usable even inside
 * a sandboxed Artifact preview.
 */

import { fmt, clamp } from '../core/money.js';

/**
 * Build a DOM element.
 * @param {string} tag
 * @param {object} [attrs] - `class`/`className`, `style` (object), `dataset` (object),
 *   `html` (raw innerHTML), `on*` event handlers, and any other value as a plain attribute.
 * @param {Array|Node|string|number} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (key === 'class' || key === 'className') node.className = val;
    else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
    else if (key === 'dataset' && typeof val === 'object') Object.assign(node.dataset, val);
    else if (key === 'html') node.innerHTML = val;
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
    else if (val === true) node.setAttribute(key, '');
    else node.setAttribute(key, val);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Format a signed delta (e.g. month-over-month change) with a sign and currency. */
export function fmtDelta(amount, code = 'USD') {
  return fmt(amount, code, { sign: true });
}

function r1(n) { return Math.round(n * 10) / 10; }

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/**
 * Inline SVG sparkline. Auto-scales to the value range; draws a dot on the
 * last point so a trend reads at a glance.
 * @param {number[]} values
 * @param {{w?:number, h?:number, color?:string}} [opts]
 * @returns {string} raw SVG markup
 */
export function sparkline(values, { w = 160, h = 40, color = 'currentColor' } = {}) {
  const vals = (values || []).map(Number).filter(Number.isFinite);
  if (vals.length < 2) return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="true"></svg>`;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = w / (vals.length - 1);
  const pad = 3;
  const points = vals.map((v, i) => {
    const x = r1(i * step);
    const y = r1(pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2));
    return [x, y];
  });
  const [lastX, lastY] = points.at(-1);
  const zeroY = r1(pad + (h - pad * 2) - ((0 - min) / range) * (h - pad * 2));
  const zeroLine = min < 0 && max > 0
    ? `<line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3" />`
    : '';

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" role="img" aria-hidden="true">
    ${zeroLine}
    <polyline points="${points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${lastX}" cy="${lastY}" r="2.6" fill="${color}" />
  </svg>`;
}

/**
 * Inline SVG donut for a spending breakdown.
 * @param {Array<{value:number, color:string, label?:string}>} segments
 * @param {{size?:number, stroke?:number}} [opts]
 * @returns {string} raw SVG markup
 */
export function donut(segments, { size = 120, stroke = 16 } = {}) {
  const total = (segments || []).reduce((a, s) => a + Math.max(0, Number(s.value) || 0), 0);
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;

  if (!total) {
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-hidden="true">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}" />
    </svg>`;
  }

  let offset = 0;
  const arcs = segments.map((seg) => {
    const value = Math.max(0, Number(seg.value) || 0);
    const frac = value / total;
    const dash = frac * circumference;
    const gap = circumference - dash;
    const arc = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${stroke}"
      stroke-dasharray="${r1(dash)} ${r1(gap)}" stroke-dashoffset="${r1(-offset)}" transform="rotate(-90 ${c} ${c})">
      <title>${escapeXml(seg.label || '')}</title>
    </circle>`;
    offset += dash;
    return arc;
  });

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-hidden="true">${arcs.join('')}</svg>`;
}

/**
 * A labelled progress-bar row for budget-vs-actual and similar views.
 * @param {{label:string, used:number, limit:number, state?:'ok'|'near'|'pace'|'over', currency?:string}} opts
 * @returns {HTMLElement}
 */
export function barRow({ label, used, limit, state = 'ok', currency = 'USD' }) {
  const pctFilled = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : (used > 0 ? 100 : 0);
  const tone = { ok: 'var(--ok)', near: 'var(--warn)', pace: 'var(--warn)', over: 'var(--bad)' }[state] || 'var(--ok)';
  return el('div', { class: 'bar-row' }, [
    el('div', { class: 'row-between' }, [
      el('span', {}, label),
      el('span', { class: 'num muted' }, `${fmt(used, currency)} / ${limit > 0 ? fmt(limit, currency) : '-'}`),
    ]),
    el('div', { class: 'bar-track' }, [
      el('div', { class: 'bar-fill', style: { width: `${pctFilled}%`, background: tone } }),
    ]),
  ]);
}

// --- interactive dashboard visuals ----------------------------------------
//
// The charts below build real DOM (not innerHTML strings) so they can own
// their own pointer listeners for hover/tap tooltips. They take a live
// container element rather than returning markup.

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortMonthLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  return `${MONTH_ABBR[(m || 1) - 1] || key} ${y || ''}`.trim();
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path `d` for an arc from startAngle to endAngle (degrees, 0 = top, clockwise). */
function arcPath(cx, cy, r, startAngle, endAngle) {
  const clampedEnd = endAngle - startAngle >= 359.999 ? startAngle + 359.999 : endAngle;
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, clampedEnd);
  const largeArc = clampedEnd - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function reducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Radial runway gauge: an inline-SVG arc scaled 0..scaleMax days, with tick
 * marks at the 90/180-day thresholds and a count-up center number. Animates
 * on first render via requestAnimationFrame; skips straight to the final
 * value when the user prefers reduced motion.
 * @param {HTMLElement} container - real DOM node this function owns.
 * @param {{days:number, band?:string, scaleMax?:number, size?:number, stroke?:number}} opts
 */
export function runwayGauge(container, { days = 0, band = 'thin', scaleMax = 270, size = 220, stroke = 16 } = {}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - stroke) / 2 - 6;
  const startAngle = -130;
  const endAngle = 130;
  const sweep = endAngle - startAngle;
  const color = {
    strong: 'var(--ok)', solid: 'var(--ok)', thin: 'var(--warn)', fragile: 'var(--bad)', exposed: 'var(--bad)',
  }[band] || 'var(--ok)';
  const targetFrac = clamp(days / scaleMax, 0, 1);

  container.classList.add('gauge');
  container.innerHTML = '';

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'gauge-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${Math.round(days)} days of runway`);

  const track = document.createElementNS(svgNS, 'path');
  track.setAttribute('d', arcPath(cx, cy, r, startAngle, endAngle));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--surface-3)');
  track.setAttribute('stroke-width', String(stroke));
  track.setAttribute('stroke-linecap', 'round');
  svg.appendChild(track);

  const value = document.createElementNS(svgNS, 'path');
  value.setAttribute('fill', 'none');
  value.setAttribute('stroke', color);
  value.setAttribute('stroke-width', String(stroke));
  value.setAttribute('stroke-linecap', 'round');
  svg.appendChild(value);

  [90, 180].filter((mark) => mark <= scaleMax).forEach((mark) => {
    const frac = mark / scaleMax;
    const angle = startAngle + frac * sweep;
    const p1 = polarToCartesian(cx, cy, r - stroke / 2 - 3, angle);
    const p2 = polarToCartesian(cx, cy, r + stroke / 2 + 4, angle);
    const tick = document.createElementNS(svgNS, 'line');
    tick.setAttribute('x1', String(p1.x)); tick.setAttribute('y1', String(p1.y));
    tick.setAttribute('x2', String(p2.x)); tick.setAttribute('y2', String(p2.y));
    tick.setAttribute('stroke', 'var(--text-mute)');
    tick.setAttribute('stroke-width', '1.5');
    svg.appendChild(tick);

    const lp = polarToCartesian(cx, cy, r + stroke / 2 + 14, angle);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', String(lp.x)); label.setAttribute('y', String(lp.y));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '9');
    label.setAttribute('fill', 'var(--text-mute)');
    label.textContent = `${mark}d`;
    svg.appendChild(label);
  });

  const center = document.createElement('div');
  center.className = 'gauge-center';
  const numberEl = document.createElement('div');
  numberEl.className = 'gauge-number num';
  numberEl.textContent = '0';
  const captionEl = document.createElement('div');
  captionEl.className = 'gauge-caption muted fs-xs';
  captionEl.textContent = days === 1 ? 'day of savings left' : 'days of savings left';
  center.append(numberEl, captionEl);

  container.append(svg, center);

  const setFrac = (f) => {
    value.setAttribute('d', f <= 0.0005 ? '' : arcPath(cx, cy, r, startAngle, startAngle + f * sweep));
  };

  if (reducedMotion()) {
    setFrac(targetFrac);
    numberEl.textContent = String(Math.round(days));
    return;
  }

  const duration = 750;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    setFrac(targetFrac * eased);
    numberEl.textContent = String(Math.round(days * eased));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * Interactive 12-month cash flow chart: income and spend area/line series
 * with a hover (or tap) tooltip, a vertical guide line, and a highlighted
 * point on the active month.
 * @param {HTMLElement} container - real DOM node this function owns and wires its own listeners on.
 * @param {Array<{key:string, income:number, spend:number, net:number}>} series
 * @param {{currency?:string, height?:number}} [opts]
 */
export function interactiveLineChart(container, series, { currency = 'USD', height = 220 } = {}) {
  const rows = (series || []).filter((s) => s && s.key);
  container.classList.add('flow-chart-wrap');
  container.innerHTML = '';

  if (rows.length < 2) {
    container.appendChild(el('p', { class: 'muted center', style: { padding: 'var(--sp-5) 0' } }, 'Not enough history yet.'));
    return;
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const w = 640;
  const h = height;
  const padL = 6, padR = 6, padT = 14, padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const incomeVals = rows.map((s) => Number(s.income) || 0);
  const spendVals = rows.map((s) => Number(s.spend) || 0);
  const all = [...incomeVals, ...spendVals, 0];
  const min = Math.min(...all);
  const max = Math.max(...all) || 1;
  const range = (max - min) || 1;

  const xFor = (i) => padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2);
  const yFor = (v) => padT + innerH - ((v - min) / range) * innerH;
  const zeroY = yFor(Math.max(min, 0));

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'flow-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '12-month income and spend history');
  svg.style.height = `${h}px`;

  const linePath = (vals) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(v)}`).join(' ');
  const areaPath = (vals) => `${linePath(vals)} L ${xFor(vals.length - 1)} ${zeroY} L ${xFor(0)} ${zeroY} Z`;

  const incomeArea = document.createElementNS(svgNS, 'path');
  incomeArea.setAttribute('d', areaPath(incomeVals));
  incomeArea.setAttribute('fill', 'var(--ok)');
  incomeArea.setAttribute('fill-opacity', '0.10');
  incomeArea.setAttribute('stroke', 'none');
  svg.appendChild(incomeArea);

  const spendArea = document.createElementNS(svgNS, 'path');
  spendArea.setAttribute('d', areaPath(spendVals));
  spendArea.setAttribute('fill', 'var(--bad)');
  spendArea.setAttribute('fill-opacity', '0.08');
  spendArea.setAttribute('stroke', 'none');
  svg.appendChild(spendArea);

  const incomeLine = document.createElementNS(svgNS, 'path');
  incomeLine.setAttribute('d', linePath(incomeVals));
  incomeLine.setAttribute('fill', 'none');
  incomeLine.setAttribute('stroke', 'var(--ok)');
  incomeLine.setAttribute('stroke-width', '2.25');
  incomeLine.setAttribute('stroke-linecap', 'round');
  incomeLine.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(incomeLine);

  const spendLine = document.createElementNS(svgNS, 'path');
  spendLine.setAttribute('d', linePath(spendVals));
  spendLine.setAttribute('fill', 'none');
  spendLine.setAttribute('stroke', 'var(--bad)');
  spendLine.setAttribute('stroke-width', '2.25');
  spendLine.setAttribute('stroke-linecap', 'round');
  spendLine.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(spendLine);

  const guide = document.createElementNS(svgNS, 'line');
  guide.setAttribute('y1', String(padT));
  guide.setAttribute('y2', String(padT + innerH));
  guide.setAttribute('stroke', 'var(--line)');
  guide.setAttribute('stroke-width', '1');
  guide.setAttribute('stroke-dasharray', '3 3');
  guide.setAttribute('opacity', '0');
  svg.appendChild(guide);

  const makeDot = (color) => {
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', color);
    dot.setAttribute('class', 'chart-dot');
    return dot;
  };
  const incomeDots = incomeVals.map((v, i) => {
    const dot = makeDot('var(--ok)');
    dot.setAttribute('cx', String(xFor(i))); dot.setAttribute('cy', String(yFor(v)));
    svg.appendChild(dot);
    return dot;
  });
  const spendDots = spendVals.map((v, i) => {
    const dot = makeDot('var(--bad)');
    dot.setAttribute('cx', String(xFor(i))); dot.setAttribute('cy', String(yFor(v)));
    svg.appendChild(dot);
    return dot;
  });

  const everyNth = Math.max(1, Math.ceil(rows.length / 6));
  rows.forEach((s, i) => {
    if (i % everyNth !== 0 && i !== rows.length - 1) return;
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', String(xFor(i)));
    t.setAttribute('y', String(h - 6));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '9');
    t.setAttribute('fill', 'var(--text-mute)');
    t.textContent = shortMonthLabel(s.key);
    svg.appendChild(t);
  });

  const tooltip = el('div', { class: 'chart-tooltip' });
  container.append(svg, tooltip);

  function setActive(idx) {
    incomeDots.forEach((d, i) => { d.classList.toggle('chart-dot-active', i === idx); d.setAttribute('r', i === idx ? '5' : '2.5'); });
    spendDots.forEach((d, i) => { d.classList.toggle('chart-dot-active', i === idx); d.setAttribute('r', i === idx ? '5' : '2.5'); });
  }

  function showTooltip(idx, clientX, clientY) {
    const s = rows[idx];
    guide.setAttribute('x1', String(xFor(idx)));
    guide.setAttribute('x2', String(xFor(idx)));
    guide.setAttribute('opacity', '1');
    setActive(idx);
    tooltip.innerHTML = `<strong>${shortMonthLabel(s.key)}</strong><br>Income ${fmt(s.income, currency)}<br>Spend ${fmt(s.spend, currency)}<br>Net ${fmt(s.net, currency)}`;
    tooltip.style.opacity = '1';
    const rect = container.getBoundingClientRect();
    tooltip.style.left = `${clamp(clientX - rect.left, 44, Math.max(44, rect.width - 44))}px`;
    tooltip.style.top = `${Math.max(clientY - rect.top - 12, 0)}px`;
  }

  function hideTooltip() {
    guide.setAttribute('opacity', '0');
    setActive(-1);
    tooltip.style.opacity = '0';
  }

  function handlePointer(evt) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const point = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
    const frac = clamp((point.clientX - rect.left) / rect.width, 0, 1);
    const idx = Math.round(frac * (rows.length - 1));
    showTooltip(idx, point.clientX, point.clientY);
  }

  svg.addEventListener('mousemove', handlePointer);
  svg.addEventListener('mouseleave', hideTooltip);
  svg.addEventListener('touchstart', handlePointer, { passive: true });
  svg.addEventListener('touchmove', handlePointer, { passive: true });
  svg.addEventListener('touchend', hideTooltip);
}

/**
 * Interactive category donut: hover/tap a segment for a tooltip and a
 * highlight; click (or the returned `select`) fires `opts.onSelect` so the
 * caller can filter or scroll a breakdown list into view.
 * @param {HTMLElement} container - real DOM node this function owns.
 * @param {Array<{value:number, color:string, name?:string, icon?:string, id?:string}>} segments
 * @param {{size?:number, stroke?:number, currency?:string, onSelect?:Function}} [opts]
 * @returns {{highlight:(i:?number)=>void, select:(i:number)=>void}}
 */
export function interactiveDonut(container, segments, { size = 150, stroke = 20, currency = 'USD', onSelect } = {}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const total = (segments || []).reduce((a, s) => a + Math.max(0, Number(s.value) || 0), 0);
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;

  container.classList.add('donut-wrap');
  container.innerHTML = '';

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Spending by category');

  if (!total) {
    const track = document.createElementNS(svgNS, 'circle');
    track.setAttribute('cx', String(c)); track.setAttribute('cy', String(c)); track.setAttribute('r', String(r));
    track.setAttribute('fill', 'none'); track.setAttribute('stroke', 'var(--line)'); track.setAttribute('stroke-width', String(stroke));
    svg.appendChild(track);
    container.appendChild(svg);
    return { highlight() {}, select() {} };
  }

  const tooltip = el('div', { class: 'chart-tooltip' });

  function highlight(idx, evt) {
    arcs.forEach((a, i) => {
      const active = i === idx;
      a.setAttribute('stroke-width', String(active ? stroke + 5 : stroke));
      a.style.opacity = idx == null || active ? '1' : '0.4';
    });
    if (idx == null) { tooltip.style.opacity = '0'; return; }
    const seg = segments[idx];
    const value = Math.max(0, Number(seg.value) || 0);
    const frac = total ? value / total : 0;
    tooltip.innerHTML = `<strong>${seg.icon ? `${seg.icon} ` : ''}${seg.name || seg.label || ''}</strong><br>${fmt(value, currency)} · ${(frac * 100).toFixed(0)}%`;
    tooltip.style.opacity = '1';
    const rect = container.getBoundingClientRect();
    const clientX = evt && evt.clientX != null ? evt.clientX : rect.left + rect.width / 2;
    const clientY = evt && evt.clientY != null ? evt.clientY : rect.top + rect.height / 2;
    tooltip.style.left = `${clamp(clientX - rect.left, 40, Math.max(40, rect.width - 40))}px`;
    tooltip.style.top = `${Math.max(clientY - rect.top - 14, 0)}px`;
  }

  let offset = 0;
  const arcs = segments.map((seg) => {
    const value = Math.max(0, Number(seg.value) || 0);
    const frac = total ? value / total : 0;
    const dash = frac * circumference;
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', String(c)); circle.setAttribute('cy', String(c)); circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', seg.color);
    circle.setAttribute('stroke-width', String(stroke));
    circle.setAttribute('stroke-dasharray', `${r1(dash)} ${r1(circumference - dash)}`);
    circle.setAttribute('stroke-dashoffset', String(r1(-offset)));
    circle.setAttribute('transform', `rotate(-90 ${c} ${c})`);
    circle.classList.add('donut-seg');
    offset += dash;
    svg.appendChild(circle);
    return circle;
  });

  arcs.forEach((circle, i) => {
    circle.addEventListener('mouseenter', (evt) => highlight(i, evt));
    circle.addEventListener('mousemove', (evt) => highlight(i, evt));
    circle.addEventListener('mouseleave', () => highlight(null));
    circle.addEventListener('click', () => { highlight(i); if (onSelect) onSelect(segments[i], i); });
    circle.addEventListener('touchstart', (evt) => highlight(i, evt.touches[0]), { passive: true });
  });

  container.append(svg, tooltip);

  return {
    highlight(i) { highlight(i); },
    select(i) { highlight(i); if (onSelect) onSelect(segments[i], i); },
  };
}
