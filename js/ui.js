// Bottom sheets, dialogs, toasts and the photo viewer.
import { $, html, mount, haptic } from './util.js';
import { icon } from './icons.js';

/* ---------- overlay stack + Android back button ---------- */

const stack = [];
let skipPops = 0;

window.addEventListener('popstate', () => {
  if (skipPops > 0) { skipPops--; return; }
  const top = stack[stack.length - 1];
  if (top) top.close(undefined, true);
});

/** Router asks this before handling a hash change. */
export const overlayOpen = () => stack.length > 0;

function pushOverlay(entry) {
  stack.push(entry);
  history.pushState({ overlay: stack.length }, '');
}

function popOverlay(entry, fromPop) {
  const i = stack.indexOf(entry);
  if (i < 0) return Promise.resolve();
  stack.splice(i, 1);
  if (fromPop) return Promise.resolve();
  return new Promise((resolve) => {
    skipPops++;
    const done = () => { window.removeEventListener('popstate', done); resolve(); };
    window.addEventListener('popstate', done);
    history.back();
    setTimeout(done, 400); // safety net
  });
}

export function closeAllOverlays() {
  for (const e of [...stack].reverse()) e.close(undefined, false);
}

/* ---------- bottom sheet ---------- */

export function openSheet({ title, body, className = '', onMount, onClose }) {
  const layer = $('#layer');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  mount(wrap, html`
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head">
        <h2>${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Закрити">${icon('x')}</button>
      </header>
      <div class="sheet-body">${body}</div>
    </section>`);
  layer.append(wrap);
  const sheet = $('.sheet', wrap);
  const prevFocus = document.activeElement;
  let closed = false;

  const entry = {
    close(value, fromPop = false) {
      if (closed) return Promise.resolve();
      closed = true;
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 280);
      document.removeEventListener('keydown', onKey);
      try { prevFocus?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
      // Run onClose only after the history entry is gone, so callers can navigate safely.
      return popOverlay(entry, fromPop).then(() => onClose?.(value));
    },
  };
  const close = (v) => entry.close(v);
  const onKey = (e) => { if (e.key === 'Escape' && stack[stack.length - 1] === entry) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });

  // Drag the header down to dismiss.
  let y0 = null, dy = 0, t0 = 0;
  const head = $('.sheet-head', wrap), grip = $('.sheet-grip', wrap);
  for (const h of [head, grip]) {
    h.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      y0 = e.clientY; dy = 0; t0 = Date.now();
      sheet.classList.add('dragging');
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.clientY - y0);
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (y0 == null) return;
      sheet.classList.remove('dragging');
      const v = dy / Math.max(1, Date.now() - t0);
      y0 = null;
      if (dy > 110 || v > 0.6) close();
      else sheet.style.transform = '';
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  }

  pushOverlay(entry);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  onMount?.(sheet, close);
  return close;
}

/* ---------- confirm ---------- */

export function confirmDialog(message, { title = 'Підтвердіть', ok = 'Видалити', cancel = 'Скасувати', danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      className: 'sheet-compact',
      body: html`
        <p class="muted confirm-text">${message}</p>
        <div class="btn-row">
          <button type="button" class="btn" data-close>${cancel}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button>
        </div>`,
      onMount(el, close) {
        $('[data-ok]', el).addEventListener('click', () => { answered = true; haptic(12); close(true); });
      },
      onClose() { resolve(answered); },
    });
  });
}

/* ---------- toast ---------- */

let toastTimer;
export function toast(message, { action, onAction, ms = 3200, kind = '' } = {}) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  mount(el, html`<span>${message}</span>${action ? html`<button type="button" class="toast-action">${action}</button>` : ''}`);
  el.className = `toast show ${kind}`;
  if (action) $('.toast-action', el).addEventListener('click', () => { el.classList.remove('show'); onAction?.(); }, { once: true });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- photo viewer with pinch-zoom ---------- */

export function viewPhoto(url, alt = 'Фото') {
  const wrap = document.createElement('div');
  wrap.className = 'viewer';
  mount(wrap, html`
    <img src="${url}" alt="${alt}" draggable="false">
    <button type="button" class="icon-btn viewer-close" aria-label="Закрити">${icon('x')}</button>
    <div class="viewer-hint">Зведіть або розведіть пальці · подвійний дотик — збільшити</div>`);
  $('#layer').append(wrap);
  const img = $('img', wrap);
  let s = 1, tx = 0, ty = 0;
  const pts = new Map();
  let g = null, lastTap = 0;

  const apply = (anim) => {
    img.classList.toggle('anim', !!anim);
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };
  const center = () => ({ x: innerWidth / 2, y: innerHeight / 2 });
  const zoomAt = (p, ns, base) => {
    const C = center();
    const q = { x: (base.p.x - C.x - base.tx) / base.s, y: (base.p.y - C.y - base.ty) / base.s };
    s = Math.min(6, Math.max(1, ns));
    tx = p.x - C.x - s * q.x;
    ty = p.y - C.y - s * q.y;
  };

  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    wrap.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const arr = [...pts.values()];
    if (arr.length === 2) {
      const mid = { x: (arr[0].x + arr[1].x) / 2, y: (arr[0].y + arr[1].y) / 2 };
      g = { kind: 'pinch', d: Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y), base: { p: mid, s, tx, ty } };
    } else if (arr.length === 1) {
      g = { kind: 'pan', p: { x: e.clientX, y: e.clientY }, tx, ty, moved: false };
    }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const arr = [...pts.values()];
    if (g?.kind === 'pinch' && arr.length >= 2) {
      const mid = { x: (arr[0].x + arr[1].x) / 2, y: (arr[0].y + arr[1].y) / 2 };
      const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      zoomAt(mid, g.base.s * (d / g.d), g.base);
      apply();
    } else if (g?.kind === 'pan') {
      const dx = e.clientX - g.p.x, dy = e.clientY - g.p.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (s > 1) { tx = g.tx + dx; ty = g.ty + dy; apply(); }
      else if (dy > 0) { ty = dy; apply(); wrap.style.setProperty('--fade', String(Math.max(0.3, 1 - dy / 400))); }
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (g?.kind === 'pan' && pts.size === 0) {
      if (s <= 1 && ty > 120) { entry.close(); return; }
      if (!g.moved) {
        const now = Date.now();
        if (now - lastTap < 300) {
          const p = { x: e.clientX, y: e.clientY };
          if (s > 1.05) { s = 1; tx = 0; ty = 0; } else zoomAt(p, 2.5, { p, s, tx, ty });
          apply(true);
          lastTap = 0;
        } else lastTap = now;
      }
    }
    if (pts.size === 0) {
      if (s <= 1.01) { s = 1; tx = 0; ty = 0; apply(true); }
      wrap.style.removeProperty('--fade');
      g = null;
    } else if (pts.size === 1) {
      const p = [...pts.values()][0];
      g = { kind: 'pan', p, tx, ty, moved: true };
    }
  };
  wrap.addEventListener('pointerup', up);
  wrap.addEventListener('pointercancel', up);

  let closed = false;
  const entry = {
    close(_v, fromPop = false) {
      if (closed) return Promise.resolve();
      closed = true;
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 220);
      return popOverlay(entry, fromPop);
    },
  };
  $('.viewer-close', wrap).addEventListener('click', () => entry.close());
  pushOverlay(entry);
  requestAnimationFrame(() => wrap.classList.add('open'));
}

/* ---------- small markup helpers ---------- */

export function segmented(name, options, value, cls = '') {
  return html`<div class="seg ${cls}" role="radiogroup">${options.map(([v, label, extra]) => html`
    <label class="seg-item"><input type="radio" name="${name}" value="${v}" ${v === value ? html`checked` : ''}><span>${extra || ''}${label}</span></label>`)}</div>`;
}

export function emptyState(ic, title, text, actionHtml = '') {
  return html`<div class="empty">${icon(ic, 'empty-i')}<h3>${title}</h3><p>${text}</p>${actionHtml}</div>`;
}
