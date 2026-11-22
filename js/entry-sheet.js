// Day sheet: the day's entries + quick add. Edit sheet for a single entry.
import { $, $$, html, mount, fmtClock, haptic, clamp, pad } from './util.js';
import { icon } from './icons.js';
import { openSheet, toast, confirmDialog } from './ui.js';
import { addEntry, updateEntry, deleteEntry, entriesOn, state } from './store.js';
import { todayKey, addKey, fmtDate, fromKey, isKey, WD_SHORT, weekday, MONTHS_SHORT } from './dates.js';

const QUICK = [30, 60, 90, 120, 180];

export function dayTitle(key) {
  const tk = todayKey();
  if (key === tk) return 'Сьогодні';
  if (key === addKey(tk, -1)) return 'Вчора';
  const d = fromKey(key);
  return `${WD_SHORT[weekday(d)]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** Shared hours:minutes picker. Returns { get, set } bound to the form. */
function durationPicker(form, root, initial) {
  let min = initial;
  const hIn = form.elements.h, mIn = form.elements.m;
  const chips = () => $$('[data-set]', root).forEach((c) => c.classList.toggle('on', Number(c.dataset.set) === min));
  const sync = () => { hIn.value = String(Math.floor(min / 60)); mIn.value = pad(min % 60); chips(); };
  const read = () => {
    const h = clamp(parseInt(hIn.value, 10) || 0, 0, 24);
    const m = clamp(parseInt(mIn.value, 10) || 0, 0, 59);
    min = clamp(h * 60 + m, 0, 24 * 60);
    chips();
  };
  sync();
  for (const inp of [hIn, mIn]) {
    inp.addEventListener('input', read);
    inp.addEventListener('blur', sync);
    inp.addEventListener('focus', () => inp.select());
  }
  root.addEventListener('click', (e) => {
    const st = e.target.closest('[data-step]');
    if (st) { read(); min = clamp(min + Number(st.dataset.step), 0, 24 * 60); sync(); haptic(); }
    const set = e.target.closest('[data-set]');
    if (set) { min = Number(set.dataset.set); sync(); haptic(); }
  });
  return { get: () => { read(); return min; } };
}

const durMarkup = () => html`
  <div class="dur">
    <button type="button" class="round-btn" data-step="-15" aria-label="Мінус 15 хвилин">${icon('minus')}</button>
    <div class="dur-value">
      <input class="dur-in" name="h" type="text" inputmode="numeric" maxlength="2" aria-label="Години" autocomplete="off">
      <span class="dur-sep">:</span>
      <input class="dur-in" name="m" type="text" inputmode="numeric" maxlength="2" aria-label="Хвилини" autocomplete="off">
    </div>
    <button type="button" class="round-btn" data-step="15" aria-label="Плюс 15 хвилин">${icon('plus')}</button>
  </div>
  <div class="chips chips-center">${QUICK.map((v) => html`<button type="button" class="chip" data-set="${v}">${fmtClock(v)}</button>`)}</div>`;

export function openEntrySheet({ entry = null, date = null, minutes = null, onSaved = null } = {}) {
  if (entry) return editSheet(entry);
  return daySheet(date || todayKey(), minutes ?? 60, onSaved);
}

function daySheet(initialDate, initialMin, onSaved) {
  let day = initialDate;
  const tk = todayKey();
  openSheet({
    title: dayTitle(day),
    body: html`
      <div class="day-list" data-list></div>
      <form class="form" novalidate>
        ${durMarkup()}
        <div class="chips chips-center" data-days>
          <button type="button" class="chip" data-day="${tk}">Сьогодні</button>
          <button type="button" class="chip" data-day="${addKey(tk, -1)}">Вчора</button>
          <label class="chip chip-date">${icon('calendar')}<input type="date" name="date" value="${day}" max="${tk}" aria-label="Дата"></label>
        </div>
        <button type="button" class="link link-muted note-toggle" data-note-toggle>${icon('plus', 'link-i')}Нотатка</button>
        <textarea class="note-in" name="note" rows="2" maxlength="500" placeholder="Нотатка" hidden></textarea>
        <button type="submit" class="btn btn-primary btn-block">Додати</button>
      </form>`,
    onMount(el, close) {
      const form = $('form', el);
      const dur = durationPicker(form, el, initialMin);
      const title = $('.sheet-head h2', el);
      const drawDay = () => {
        title.textContent = dayTitle(day);
        form.elements.date.value = day;
        $$('[data-day]', el).forEach((c) => c.classList.toggle('on', c.dataset.day === day));
        $('.chip-date', el).classList.toggle('on', day !== tk && day !== addKey(tk, -1));
        const items = entriesOn(day);
        mount($('[data-list]', el), items.length ? html`
          ${items.map((e) => html`
            <button type="button" class="day-item" data-edit="${e.id}">
              <span class="num">${fmtClock(e.minutes)}</span>
              <span class="day-note">${e.note}</span>
              ${icon('edit', 'day-edit')}
            </button>`)}` : '');
      };
      drawDay();
      el.addEventListener('click', async (e) => {
        const d = e.target.closest('[data-day]');
        if (d) { day = d.dataset.day; drawDay(); haptic(); return; }
        if (e.target.closest('[data-note-toggle]')) {
          e.target.closest('[data-note-toggle]').hidden = true;
          form.elements.note.hidden = false;
          form.elements.note.focus();
          return;
        }
        const ed = e.target.closest('[data-edit]');
        if (ed) {
          const en = state.entries.find((x) => x.id === ed.dataset.edit);
          await close();
          if (en) editSheet(en);
        }
      });
      form.elements.date.addEventListener('change', () => { if (isKey(form.elements.date.value)) { day = form.elements.date.value; drawDay(); } });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const min = dur.get();
        if (day > todayKey()) { toast('Дата в майбутньому', { kind: 'warn' }); return; }
        if (min <= 0) { toast('Вкажіть час', { kind: 'warn' }); return; }
        haptic(15);
        const added = await addEntry({ date: day, minutes: min, note: form.elements.note.value });
        close();
        onSaved?.(added);
        toast(`+${fmtClock(min)} · ${dayTitle(day).toLowerCase()}`, { action: 'Скасувати', onAction: () => deleteEntry(added.id) });
      });
    },
  });
}

function editSheet(entry) {
  openSheet({
    title: dayTitle(entry.date),
    body: html`
      <form class="form" novalidate>
        ${durMarkup()}
        <label class="field"><span class="label">дата</span>
          <input type="date" name="date" value="${entry.date}" max="${todayKey()}"></label>
        <label class="field"><span class="label">нотатка</span>
          <textarea name="note" rows="2" maxlength="500">${entry.note || ''}</textarea></label>
        <div class="btn-row">
          <button type="button" class="round-btn danger" data-del aria-label="Видалити">${icon('trash')}</button>
          <button type="submit" class="btn btn-primary btn-grow">Зберегти</button>
        </div>
      </form>`,
    onMount(el, close) {
      const form = $('form', el);
      const dur = durationPicker(form, el, entry.minutes);
      $('[data-del]', el).addEventListener('click', async () => {
        if (!(await confirmDialog(`Видалити ${fmtClock(entry.minutes)} за ${fmtDate(entry.date)}?`))) return;
        const removed = await deleteEntry(entry.id);
        close();
        toast('Видалено', { action: 'Повернути', onAction: () => updateEntry(removed) });
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const min = dur.get();
        const date = form.elements.date.value;
        if (!isKey(date) || date > todayKey()) { toast('Перевірте дату', { kind: 'warn' }); return; }
        if (min <= 0) { toast('Вкажіть час', { kind: 'warn' }); return; }
        haptic(15);
        await updateEntry({ ...entry, date, minutes: min, note: form.elements.note.value.trim() });
        close();
        toast('Збережено');
      });
    },
  });
}
