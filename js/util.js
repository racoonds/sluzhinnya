// Small helpers: safe HTML templating, DOM shortcuts, ids, formatting.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));

function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

/** Tagged template: every interpolation is HTML-escaped unless wrapped in raw()/html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Put trusted markup into an element and apply data-vars (CSP forbids inline style attributes). */
export function mount(el, markup) {
  el.innerHTML = String(markup);
  applyVars(el);
  return el;
}

export function applyVars(root) {
  const nodes = root.matches?.('[data-vars]') ? [root, ...$$('[data-vars]', root)] : $$('[data-vars]', root);
  for (const n of nodes) {
    for (const pair of n.dataset.vars.split(';')) {
      const i = pair.indexOf(':');
      if (i > 0) n.style.setProperty(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const pad = (n) => String(n).padStart(2, '0');

export function debounce(fn, ms = 400) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

/** Ukrainian plural: plural(5, ['день','дні','днів']) */
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (!Number.isInteger(n)) return few;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** 60 -> "1:00", 90 -> "1:30" (always with minutes; for compact time labels) */
export function fmtClock(min) {
  min = Math.max(0, Math.round(min));
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}

/** 750 -> "12 год 30 хв" */
export function fmtHM(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h} год ${m} хв`;
  if (h) return `${h} год`;
  return `${m} хв`;
}

/** 105 -> "1:45", 120 -> "2" */
export function fmtShort(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}:${pad(m)}` : `${h}`;
}

/** 486 -> "8,1" */
export function fmtDec(min, digits = 1) {
  const v = Math.max(0, min) / 60;
  return v.toLocaleString('uk-UA', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function bytes(n) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}
