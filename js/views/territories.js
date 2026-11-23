// Territories: list, filters, detail page with map photo and work history.
import { $, $$, html, mount, haptic, debounce, plural } from '../util.js';
import { icon, statusIcon } from '../icons.js';
import {
  state, newTerritory, saveTerritory, deleteTerritory, lastWorked, savePhoto, deletePhoto, photoURL,
} from '../store.js';
import { openSheet, confirmDialog, toast, viewPhoto, segmented, emptyState } from '../ui.js';
import { processImage } from '../photos.js';
import { todayKey, fmtDate, fmtDateShort, relDays, diffDays, fromKey, isKey } from '../dates.js';
import { uid } from '../util.js';

export const STATUS = {
  new: 'Не розпочато',
  progress: 'В процесі',
  done: 'Опрацьовано',
};
const LONG_DAYS = 120;
const SHORT = { new: 'нова', progress: 'в процесі', done: 'готово' }; // highlight territories held longer than ~4 months

let filter = 'all';
let query = '';

const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), 'uk', { numeric: true }) || a.name.localeCompare(b.name, 'uk');
const title = (t) => (t.number ? `№ ${t.number}` : 'Без номера');

/* ---------------- list ---------------- */

export function renderList(root) {
  const all = [...state.territories].sort(byNumber);
  const count = (st) => all.filter((t) => t.status === st).length;
  const q = query.trim().toLowerCase();
  const items = all.filter((t) => (filter === 'all' || t.status === filter)
    && (!q || `${t.number} ${t.name} ${t.notes}`.toLowerCase().includes(q)));

  mount(root, html`
    <header class="top">
      <div class="top-title"><span class="mono-cap">${all.length} · ${count('done')} готово</span><h1>Території</h1></div>
      <button type="button" class="icon-btn icon-btn-accent" data-add aria-label="Додати територію">${icon('plus')}</button>
    </header>

    ${all.length ? html`
      <div class="filters" role="tablist">
        ${[['all', 'Усі', all.length], ['new', 'Нові', count('new')], ['progress', 'В процесі', count('progress')], ['done', 'Готові', count('done')]].map(([k, l, n]) => html`
          <button type="button" class="filter ${filter === k ? 'on' : ''}" data-filter="${k}" role="tab" aria-selected="${filter === k}">
            ${k !== 'all' ? statusIcon(k) : ''}<span>${l}</span><em>${n}</em>
          </button>`)}
      </div>
      ${all.length > 5 ? html`
        <label class="search">${icon('search')}<input type="search" placeholder="Пошук" value="${query}" data-q></label>` : ''}
      <div class="terr-list">
        ${items.length ? items.map(card) : html`<div class="empty-inline">Нічого не знайдено.</div>`}
      </div>` : emptyState('map', 'Поки порожньо', 'Номер, фото карти, статус.',
      html`<button type="button" class="btn btn-primary" data-add>${icon('plus')}Додати</button>`)}
  `);

  loadThumbs(root);

  root.onclick = (e) => {
    const t = e.target;
    if (t.closest('[data-add]')) { openAddSheet(); return; }
    const f = t.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; haptic(); renderList(root); return; }
    const o = t.closest('[data-open]');
    if (o) location.hash = `#/territory/${o.dataset.open}`;
  };
  const qi = $('[data-q]', root);
  qi?.addEventListener('input', debounce(() => {
    query = qi.value;
    const pos = qi.selectionStart;
    renderList(root);
    const n = $('[data-q]', root);
    n?.focus(); n?.setSelectionRange(pos, pos);
  }, 200));
  return () => { root.onclick = null; };
}

function card(t) {
  const lw = lastWorked(t);
  const held = t.status !== 'done' && isKey(t.assignedAt) ? diffDays(fromKey(t.assignedAt), new Date()) : 0;
  const sub = t.status === 'done'
    ? (t.completedAt ? fmtDateShort(t.completedAt) : '')
    : lw ? relDays(lw) : isKey(t.assignedAt) ? `взято ${relDays(t.assignedAt)}` : '';
  return html`
    <button type="button" class="terr" data-open="${t.id}">
      <span class="terr-thumb">${t.photoId ? html`<img alt="" data-photo="${t.photoId}">` : icon('map')}</span>
      <span class="terr-main">
        <span class="terr-title"><b>${t.number || '—'}</b>${t.name ? html` <span>${t.name}</span>` : ''}</span>
        <span class="terr-sub ${held > LONG_DAYS ? 'is-warn' : ''}">${sub}${held > LONG_DAYS ? ` · ${held} дн.` : ''}</span>
      </span>
      <span class="spill s-${t.status}">${statusIcon(t.status)}${SHORT[t.status]}</span>
    </button>`;
}

async function loadThumbs(root) {
  for (const img of $$('img[data-photo]', root)) {
    const url = await photoURL(img.dataset.photo, 'thumb');
    if (url) img.src = url;
  }
}

/* ---------------- add sheet ---------------- */

function openAddSheet() {
  const t = newTerritory();
  let picked = null;
  openSheet({
    title: 'Нова територія',
    body: html`
      <form class="form" novalidate>
        <div class="grid2 grid-num">
          <label class="field"><span class="field-label">Номер</span><input name="number" inputmode="text" maxlength="20" placeholder="14" required></label>
          <label class="field"><span class="field-label">Назва / район</span><input name="name" maxlength="80" placeholder="Центр, вул. Шевченка"></label>
        </div>
        <div class="field">
          <span class="field-label">Фото території</span>
          <label class="photo-pick" data-pick>
            <input type="file" accept="image/*" hidden data-file>
            <span class="photo-pick-empty">${icon('camera')}<span>Фото карти</span></span>
          </label>
        </div>
        <div class="field"><span class="field-label">Статус</span>
          ${segmented('status', [['new', 'Нова', statusIcon('new')], ['progress', 'В процесі', statusIcon('progress')], ['done', 'Готово', statusIcon('done')]], 'progress', 'seg-status')}
        </div>
        <label class="field"><span class="field-label">Дата, коли взяли</span><input type="date" name="assignedAt" value="${t.assignedAt}" max="${todayKey()}"></label>
        <button type="submit" class="btn btn-primary btn-block">${icon('check')}Зберегти</button>
      </form>`,
    onMount(el, close) {
      const form = $('form', el);
      const pick = $('[data-pick]', el);
      $('[data-file]', el).addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        pick.classList.add('is-loading');
        try {
          picked = await processImage(file);
          const url = URL.createObjectURL(picked.thumb);
          const box = $('.photo-pick-empty', pick);
          mount(box, html`<img alt="Фото території" src="${url}"><span class="photo-pick-change">${icon('camera')}Змінити</span>`);
          box.classList.add('has-img');
        } catch (err) {
          toast(err.message, { kind: 'warn' });
        } finally { pick.classList.remove('is-loading'); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const number = form.elements.number.value.trim();
        if (!number && !form.elements.name.value.trim()) { toast('Вкажіть номер або назву', { kind: 'warn' }); form.elements.number.focus(); return; }
        t.number = number;
        t.name = form.elements.name.value.trim();
        t.status = form.elements.status.value;
        t.assignedAt = isKey(form.elements.assignedAt.value) ? form.elements.assignedAt.value : todayKey();
        if (t.status === 'done') t.completedAt = todayKey();
        if (picked) t.photoId = await savePhoto(picked);
        await saveTerritory(t);
        haptic(15);
        close();
        toast(`Територію ${title(t)} додано`);
      });
    },
  });
}

/* ---------------- detail ---------------- */

export function renderDetail(root, [id]) {
  const t = state.territories.find((x) => x.id === id);
  if (!t) {
    mount(root, html`<header class="top top-back"><a class="icon-btn" href="#/territories" aria-label="Назад">${icon('left')}</a><h1>Не знайдено</h1></header>
      ${emptyState('map', 'Територію не знайдено', 'Можливо, її видалили.')}`);
    return;
  }
  const hist = [...(t.history || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const held = isKey(t.assignedAt) ? diffDays(fromKey(t.assignedAt), new Date()) : 0;

  mount(root, html`
    <header class="top top-back">
      <a class="icon-btn" href="#/territories" aria-label="Назад">${icon('left')}</a>
      <div class="top-title"><div class="eyebrow">Територія</div><h1>${title(t)}</h1></div>
      <span class="top-status">${statusIcon(t.status)}</span>
    </header>

    <section class="photo-box ${t.photoId ? 'has-photo' : ''}">
      ${t.photoId ? html`
        <button type="button" class="photo-main" data-view aria-label="Відкрити фото на весь екран">
          <img alt="Карта території ${title(t)}" data-full="${t.photoId}">
          <span class="photo-zoom">${icon('zoom')}</span>
        </button>
        <div class="photo-actions">
          <label class="btn btn-sm">${icon('camera')}Замінити<input type="file" accept="image/*" hidden data-file></label>
          <button type="button" class="btn btn-sm btn-ghost-danger" data-del-photo>${icon('trash')}Прибрати фото</button>
        </div>` : html`
        <label class="photo-pick photo-pick-lg">
          <input type="file" accept="image/*" hidden data-file>
          <span class="photo-pick-empty">${icon('camera')}<span>Фото карти</span></span>
        </label>`}
    </section>

    <section class="card form-card">
      <div class="grid2 grid-num">
        <label class="field"><span class="field-label">Номер</span><input data-f="number" value="${t.number}" maxlength="20"></label>
        <label class="field"><span class="field-label">Назва / район</span><input data-f="name" value="${t.name}" maxlength="80" placeholder="—"></label>
      </div>
      <div class="field"><span class="field-label">Статус</span>
        ${segmented('status', [['new', 'Нова', statusIcon('new')], ['progress', 'В процесі', statusIcon('progress')], ['done', 'Готово', statusIcon('done')]], t.status, 'seg-status')}
      </div>
      <div class="grid2">
        <label class="field"><span class="field-label">Взято</span><input type="date" data-f="assignedAt" value="${t.assignedAt || ''}" max="${todayKey()}"></label>
        <label class="field ${t.status !== 'done' ? 'is-dim' : ''}"><span class="field-label">Опрацьовано</span><input type="date" data-f="completedAt" value="${t.completedAt || ''}" max="${todayKey()}"></label>
      </div>
      ${t.status !== 'done' && held > 0 ? html`<p class="label ${held > LONG_DAYS ? 'is-warn' : ''}">${icon('clock', 'inline-i')} ${held} ${plural(held, ['день', 'дні', 'днів'])} у вас</p>` : ''}
      ${t.status === 'done' ? html`<button type="button" class="btn btn-block btn-soft" data-again>${icon('history')}Взяти знову</button>` : ''}
    </section>

    <section class="section">
      <div class="section-head"><h2>Опрацювання</h2><button type="button" class="btn btn-sm btn-primary" data-log>${icon('plus')}Запис</button></div>
      ${hist.length ? html`<div class="list">${hist.map((h) => html`
        <div class="row">
          <span class="row-ic">${icon('check')}</span>
          <span class="row-main"><span class="row-title">${fmtDate(h.date)}</span>${h.note ? html`<span class="row-sub">${h.note}</span>` : ''}</span>
          <button type="button" class="icon-btn icon-btn-sm" data-del-h="${h.id}" aria-label="Видалити запис">${icon('x')}</button>
        </div>`)}</div>` : ''}
    </section>

    <section class="section">
      <div class="section-head"><h2>Нотатки</h2><span class="saved" data-saved></span></div>
      <textarea class="note-area" data-f="notes" rows="3" maxlength="5000" placeholder="…">${t.notes}</textarea>
    </section>

    <button type="button" class="btn btn-block btn-ghost-danger" data-delete>${icon('trash')}Видалити територію</button>
  `);

  // Photo
  const full = $('img[data-full]', root);
  if (full) photoURL(t.photoId, 'full').then((u) => { if (u) full.src = u; });

  const save = async (patch, quiet = false, silent = false) => {
    Object.assign(t, patch);
    await saveTerritory(t, { silent });
    if (!quiet) toast('Збережено');
  };

  // Field autosave
  for (const inp of $$('[data-f]', root)) {
    const f = inp.dataset.f;
    if (f === 'notes') {
      const mark = $('[data-saved]', root);
      const d = debounce(async () => { t.notes = inp.value; await saveTerritory(t, { silent: true }); mark.textContent = 'Збережено'; }, 500);
      inp.addEventListener('input', () => { mark.textContent = '…'; d(); });
      inp.addEventListener('blur', () => d.flush());
    } else {
      inp.addEventListener('change', () => {
        let v = inp.value.trim();
        if ((f === 'assignedAt' || f === 'completedAt') && v && !isKey(v)) return;
        if (f === 'completedAt' && v && t.status !== 'done') { save({ completedAt: v, status: 'done' }); return; }
        save({ [f]: v || (f === 'completedAt' ? null : v) }, true, true).then(() => {
          if (f === 'number') $('.top-title h1', root).textContent = title(t);
          if (f === 'assignedAt') renderDetail(root, [t.id]);
        });
      });
    }
  }

  $$('input[name=status]', root).forEach((r) => r.addEventListener('change', () => {
    const st = r.value;
    const patch = { status: st };
    if (st === 'done' && !t.completedAt) patch.completedAt = todayKey();
    if (st !== 'done') patch.completedAt = null;
    haptic(12);
    save(patch, true).then(() => toast(STATUS[st]));
  }));

  root.onclick = async (e) => {
    const el = e.target;
    if (el.closest('[data-view]')) {
      const u = await photoURL(t.photoId, 'full');
      if (u) viewPhoto(u, `Карта території ${title(t)}`);
      return;
    }
    if (el.closest('[data-del-photo]')) {
      if (!(await confirmDialog('Прибрати фото цієї території?', { ok: 'Прибрати' }))) return;
      const pid = t.photoId;
      await save({ photoId: null }, true);
      await deletePhoto(pid);
      return;
    }
    if (el.closest('[data-log]')) { openLogSheet(t); return; }
    const dh = el.closest('[data-del-h]');
    if (dh) {
      const removed = t.history.find((h) => h.id === dh.dataset.delH);
      await save({ history: t.history.filter((h) => h.id !== dh.dataset.delH) }, true);
      toast('Запис видалено', { action: 'Повернути', onAction: () => save({ history: [...t.history, removed] }, true) });
      return;
    }
    if (el.closest('[data-again]')) {
      await save({ status: 'progress', assignedAt: todayKey(), completedAt: null }, true);
      toast('Нове коло розпочато');
      return;
    }
    if (el.closest('[data-delete]')) {
      if (!(await confirmDialog(`Видалити територію ${title(t)} разом з фото та історією? Це не можна скасувати.`))) return;
      await deleteTerritory(t.id);
      location.hash = '#/territories';
      toast('Територію видалено');
    }
  };

  for (const fi of $$('[data-file]', root)) {
    fi.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      toast('Обробка фото…', { ms: 8000 });
      try {
        const p = await processImage(file);
        const old = t.photoId;
        const pid = await savePhoto(p);
        await save({ photoId: pid }, true);
        if (old) await deletePhoto(old);
        toast('Фото збережено');
      } catch (err) {
        toast(err.message, { kind: 'warn' });
      }
    });
  }
  return () => { root.onclick = null; };
}

function openLogSheet(t) {
  openSheet({
    title: `Опрацювання ${title(t)}`,
    body: html`
      <form class="form" novalidate>
        <label class="field"><span class="field-label">Дата</span><input type="date" name="date" value="${todayKey()}" max="${todayKey()}"></label>
        <label class="field"><span class="label">нотатка</span>
          <textarea name="note" rows="2" maxlength="500"></textarea></label>
        <label class="check"><input type="checkbox" name="done" ${t.status === 'done' ? html`checked` : ''}><span class="check-box">${icon('check')}</span><span>Опрацьовано повністю</span></label>
        <button type="submit" class="btn btn-primary btn-block">${icon('check')}Зберегти</button>
      </form>`,
    onMount(el, close) {
      const form = $('form', el);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = isKey(form.elements.date.value) ? form.elements.date.value : todayKey();
        t.history = [...(t.history || []), { id: uid(), date, note: form.elements.note.value.trim() }];
        if (form.elements.done.checked) { t.status = 'done'; t.completedAt = date; } else if (t.status === 'new') t.status = 'progress';
        await saveTerritory(t);
        haptic(15);
        close();
        toast(form.elements.done.checked ? 'Територію опрацьовано' : 'Запис додано');
      });
    },
  });
}
